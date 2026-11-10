/**
 * NUVEM V3 — SERVIÇO DE SINCRONIZAÇÃO E PUBLICAÇÃO DO SAEOU060
 *
 * Atende aos requisitos da Filial 172:
 * 1. Armazenamento versionado no Firestore em /filiais/{filialId}/saeou_versoes/{versaoId}.
 * 2. Upload fracionado por tamanho (chunks <= 400 KB), concorrência limitada a 2.
 * 3. Checksum SHA-256 de integridade + validação integral no servidor antes da ativação.
 * 4. Controle de tempo limite sem acumular escritas concorrentes no WriteStream.
 * 5. Comutação atômica + confirmação pós-gravação do ponteiro ativo em /filiais/{filialId}/config/versao_ativa_saeou.
 * 6. Status explícito: LOCAL | PUBLICANDO | SINCRONIZADO | PENDENTE_CONFIRMACAO | ERRO.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { detectQuotaResourceType } from './firebase';
import { authRoleService, UsuarioOperacional } from './authRoleService';
import { dbClear, dbGetMeta, dbSetMeta, STORES } from './db';
import { RegistroSaeou060 } from '../types';
import { productRepository } from './productRepository';
import { cleanForFirestore } from './deviceId';
import { isModoAtualizacaoLocalAtivo } from './localPackageMode';
import {
  buildSafeChunks,
  calcularChecksumSha256,
  confirmarPonteiroAtivoNoServidor,
  createDefaultPublishAdapter,
  DEFAULT_CONCURRENCY_LIMIT,
  DEFAULT_READ_TIMEOUT_MS,
  DEFAULT_WRITE_TIMEOUT_MS,
  executarEnvioChunksControlado,
  PendingWriteTracker,
  PublishAdapter,
  PublishIntegrityError,
  PublishTimeoutError,
  ResultadoPublicacaoBase,
  runTrackedWithTimeout,
  StatusSyncBase,
  validarIntegridadeVersaoNoServidor,
  verificarEstadoRemotoAntesDePublicar,
  verificarVersaoAtivaIdenticaEIntegra,
} from './firestorePublishGuard';

export type { StatusSyncBase, ResultadoPublicacaoBase };

export interface PublicacaoSaeouStatus {
  status: StatusSyncBase;
  emAndamento: boolean;
  etapa:
    | 'OCIOSO'
    | 'GERANDO_CHUNKS'
    | 'CALCULANDO_CHECKSUM'
    | 'VERIFICANDO_REMOTO'
    | 'ENVIANDO_CHUNKS'
    | 'VALIDANDO_INTEGRIDADE'
    | 'COMUTANDO_PONTEIRO'
    | 'CONFIRMANDO_ATIVA'
    | 'CONCLUIDO'
    | 'PENDENTE_CONFIRMACAO'
    | 'ERRO';
  progressoPorcentagem: number;
  mensagem: string;
  versaoPublicada?: string;
  versaoPendente?: string;
  chunkFalhou?: number;
  aguardandoConfirmacaoNuvem?: boolean;
  erro?: string;
  ultimaSincronizacao?: string;
}

export interface VersaoAtivaSaeouInfo {
  versaoId: string;
  filialId: string;
  dataPublicacaoIso: string;
  publicadoPor: string;
  totalRegistros: number;
  totalChunks: number;
  checksumBase: string;
  versaoAnteriorId?: string | null;
}

export interface SaeouSyncServiceOptions {
  autoStart?: boolean;
  adapter?: PublishAdapter;
  writeTimeoutMs?: number;
  readTimeoutMs?: number;
  concurrencyLimit?: number;
  setMetaFn?: (key: string, val: any) => Promise<void>;
  getUsuarioFn?: () => UsuarioOperacional;
}

export class SaeouSyncService {
  private _status: PublicacaoSaeouStatus = {
    status: 'LOCAL',
    emAndamento: false,
    etapa: 'OCIOSO',
    progressoPorcentagem: 0,
    mensagem: 'Pronto (IndexedDB)',
  };

  private _versaoAtivaRemota: VersaoAtivaSaeouInfo | null = null;
  private _versaoLocalId: string | null = null;
  private _unsubSnapshot: Unsubscribe | null = null;
  private _listenersStatus: Array<(status: PublicacaoSaeouStatus) => void> = [];
  private _listenersVersao: Array<(versao: VersaoAtivaSaeouInfo | null) => void> = [];
  private _isDownloading = false;
  private _onSaeouClearedCallback?: () => void;

  private readonly _writeTracker = new PendingWriteTracker();
  private readonly _adapter: PublishAdapter;
  private readonly _writeTimeoutMs: number;
  private readonly _readTimeoutMs: number;
  private readonly _concurrencyLimit: number;
  private readonly _setMetaFn: (key: string, val: any) => Promise<void>;
  private readonly _getUsuarioFn: () => UsuarioOperacional;

  private _unsubQuota: (() => void) | null = null;

  constructor(options?: SaeouSyncServiceOptions) {
    this._adapter = options?.adapter ?? createDefaultPublishAdapter();
    this._writeTimeoutMs = options?.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    this._readTimeoutMs = options?.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this._concurrencyLimit = options?.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT;
    this._setMetaFn = options?.setMetaFn ?? dbSetMeta;
    this._getUsuarioFn = options?.getUsuarioFn ?? (() => authRoleService.getUsuarioAtual());

    if (options?.autoStart !== false) {
      this.carregarVersaoLocal();
      this.iniciarMonitoramentoVersaoAtiva('172');

      if (this._adapter.subscribeQuotaStatus) {
        this._unsubQuota = this._adapter.subscribeQuotaStatus((qState) => {
          if (qState.bloqueado) {
            if (this._unsubSnapshot) {
              this._unsubSnapshot();
              this._unsubSnapshot = null;
            }
            if (!this._status.emAndamento && this._status.status !== 'BLOQUEADO_COTA') {
              this.atualizarStatus({
                status: 'BLOQUEADO_COTA',
                emAndamento: false,
                etapa: 'OCIOSO',
                mensagem:
                  'Cota diária do Firebase Spark aguardando liberação — operando 100% local via IndexedDB.',
                aguardandoConfirmacaoNuvem: false,
              });
            }
          } else if (this._status.status === 'BLOQUEADO_COTA') {
            this.atualizarStatus({
              status: 'LOCAL',
              emAndamento: false,
              etapa: 'OCIOSO',
              mensagem: 'Cota liberada — pronto para sincronização',
            });
            this.iniciarMonitoramentoVersaoAtiva('172');
          }
        });
      }

      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          if (!this._adapter.isFirestoreQuotaExceeded() && !isModoAtualizacaoLocalAtivo()) {
            this.verificarSincronizacaoComRemoto('172');
          }
        });
      }
    }
  }

  public getWriteTracker(): PendingWriteTracker {
    return this._writeTracker;
  }

  private async carregarVersaoLocal(): Promise<void> {
    try {
      const meta = await dbGetMeta<any>('meta_saeou_sync', null);
      if (meta && meta.versaoId) {
        this._versaoLocalId = meta.versaoId;
      }
    } catch (e) {
      console.warn('[SaeouSyncService] Erro ao carregar versão local:', e);
    }
  }

  public registerSaeouClearedCallback(cb: () => void): void {
    this._onSaeouClearedCallback = cb;
  }

  // =========================================================================
  // MONITORAMENTO EM TEMPO REAL DA VERSÃO ATIVA DO SAEOU060 NO FIRESTORE
  // =========================================================================

  public iniciarMonitoramentoVersaoAtiva(filialId: string = '172'): void {
    if (this._unsubSnapshot) {
      this._unsubSnapshot();
      this._unsubSnapshot = null;
    }

    if (filialId === '172' && isModoAtualizacaoLocalAtivo()) {
      this.atualizarStatus({
        status: 'LOCAL',
        emAndamento: false,
        etapa: 'OCIOSO',
        mensagem: 'Modo Pacote Local Único (.zip) ativo na Filial 172 — IndexedDB protegido.',
      });
      return;
    }

    if (this._adapter.isFirestoreQuotaExceeded()) {
      this.atualizarStatus({
        status: 'BLOQUEADO_COTA',
        emAndamento: false,
        etapa: 'OCIOSO',
        mensagem:
          'Cota diária do Firebase Spark aguardando liberação — monitoramento remoto pausado (IndexedDB local ativo).',
      });
      return;
    }

    if (!this._adapter.db) return;

    try {
      const configDocRef = doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_saeou');
      this._unsubSnapshot = onSnapshot(
        configDocRef,
        async (snap) => {
          if (snap.exists()) {
            const data = snap.data() as VersaoAtivaSaeouInfo & { status?: string; limpaEm?: string; ativa?: boolean };

            // Se o SAEOU060 foi limpo centralmente
            if (!data.versaoId || data.ativa === false || data.status === 'LIMPA_AGUARDANDO_IMPORTACAO') {
              this._versaoAtivaRemota = null;
              this.notificarVersao();

              if (this._versaoLocalId !== null) {
                console.log('[SaeouSyncService] SAEOU060 foi limpo na nuvem central. Sincronizando limpeza local...');
                try {
                  await dbClear(STORES.SAEOU060);
                  await dbSetMeta('meta_saeou_sync', {
                    versaoId: null,
                    status: 'LIMPA_AGUARDANDO_IMPORTACAO',
                    limpaEm: data.limpaEm || new Date().toISOString(),
                    totalRegistros: 0,
                  });
                } catch (e) {
                  console.warn('[SaeouSyncService] Erro ao limpar store local do SAEOU060:', e);
                }

                this._versaoLocalId = null;

                try {
                  productRepository.redefinirBasesOperacionaisAposLimpeza();
                } catch (err) {
                  console.warn('[SaeouSyncService] Erro ao notificar repositório:', err);
                }

                if (this._onSaeouClearedCallback) {
                  try {
                    this._onSaeouClearedCallback();
                  } catch (cbErr) {
                    console.warn('[SaeouSyncService] Erro no callback de limpeza:', cbErr);
                  }
                }
              }

              this.atualizarStatus({
                status: 'LOCAL',
                emAndamento: false,
                etapa: 'OCIOSO',
                mensagem: 'SAEOU060 limpo centralmente. Pronto para receber nova importação.',
                ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
              });
              return;
            }

            this._versaoAtivaRemota = data;
            this.notificarVersao();

            // Se detectou versão mais recente na nuvem que a versão local
            if (this._versaoLocalId !== data.versaoId && !this._status.emAndamento && !this._isDownloading) {
              console.log(`[SaeouSyncService] Nova versão remota detectada: ${data.versaoId} (local: ${this._versaoLocalId}). Baixando...`);
              await this.baixarSaeouAtivoParaDispositivo(filialId);
            } else if (
              this._versaoLocalId === data.versaoId &&
              !this._status.emAndamento &&
              this._status.status !== 'PENDENTE_CONFIRMACAO' &&
              this._status.status !== 'ERRO'
            ) {
              this.atualizarStatus({
                status: 'SINCRONIZADO',
                mensagem: `Sincronizado com a nuvem central (${data.totalRegistros} registros SAEOU060)`,
                ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
              });
            }
          } else {
            this._versaoAtivaRemota = null;
            this.notificarVersao();
          }
        },
        (err) => {
          console.warn('[SaeouSyncService] Erro no listener de SAEOU060:', err?.message);
          if (this._adapter.isQuotaError(err)) {
            this._adapter.markQuotaExceeded(err?.message, detectQuotaResourceType(err));
            if (this._unsubSnapshot) {
              this._unsubSnapshot();
              this._unsubSnapshot = null;
            }
            this.atualizarStatus({
              status: 'BLOQUEADO_COTA',
              emAndamento: false,
              etapa: 'OCIOSO',
              mensagem:
                'Cota diária gratuita do Firebase Spark atingida. Monitoramento pausado e dados locais preservados.',
            });
          }
        }
      );
    } catch (e) {
      console.warn('[SaeouSyncService] Falha ao configurar listener:', e);
    }
  }

  // =========================================================================
  // PUBLICAÇÃO CENTRAL MESTRE DO SAEOU060
  // =========================================================================

  public async publicarSaeouCentral(
    registros: RegistroSaeou060[],
    filialId: string = '172',
    onProgress?: (pct: number, msg: string, chunkAtual?: number, totalChunks?: number) => void
  ): Promise<ResultadoPublicacaoBase> {
    if (!registros || registros.length === 0) {
      return {
        sucesso: false,
        estadoPublicacao: 'ERRO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Não há registros SAEOU060 para publicação.',
      };
    }

    if (this._status.emAndamento) {
      return {
        sucesso: false,
        estadoPublicacao: 'ERRO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Já existe uma publicação de SAEOU060 em andamento. Aguarde a conclusão antes de iniciar outra.',
      };
    }

    if (!this._adapter.db) {
      this.atualizarStatus({
        status: 'LOCAL',
        mensagem: 'Firestore indisponível — base salva no IndexedDB',
        aguardandoConfirmacaoNuvem: false,
      });
      return {
        sucesso: false,
        estadoPublicacao: 'LOCAL_SEM_NUVEM',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Banco Firestore central indisponível. Dados preservados localmente no IndexedDB.',
      };
    }

    if (this._adapter.isFirestoreQuotaExceeded()) {
      const msgCota =
        'Publicação pausada: cota diária gratuita do Firebase Spark aguardando liberação. Dados do SAEOU060 preservados localmente no IndexedDB.';
      this.atualizarStatus({
        status: 'BLOQUEADO_COTA',
        emAndamento: false,
        etapa: 'OCIOSO',
        progressoPorcentagem: 0,
        mensagem: msgCota,
        aguardandoConfirmacaoNuvem: false,
      });
      return {
        sucesso: false,
        estadoPublicacao: 'AGUARDANDO_COTA',
        versaoConfirmadaNoServidor: false,
        aguardandoCota: true,
        mensagem: msgCota,
      };
    }

    const usuario = this._getUsuarioFn();
    let versaoId = '';
    let totalChunksPlanejados = 0;
    let ultimoPercentual = 5;

    this.atualizarStatus({
      status: 'PUBLICANDO',
      emAndamento: true,
      etapa: 'VERIFICANDO_REMOTO',
      progressoPorcentagem: 5,
      mensagem: 'Verificando estado remoto e gravações pendentes do SAEOU060...',
      aguardandoConfirmacaoNuvem: false,
      erro: undefined,
      chunkFalhou: undefined,
    });
    onProgress?.(5, 'Verificando estado remoto e gravações pendentes do SAEOU060...');

    try {
      await this._adapter.ensureAuth().catch(() => null);

      // 1. Verificar estado remoto e impedir acúmulo enquanto escrita anterior estiver pendente
      const preCheck = await verificarEstadoRemotoAntesDePublicar<VersaoAtivaSaeouInfo>(
        this._adapter,
        this._writeTracker,
        filialId,
        'versao_ativa_saeou',
        'saeou_versoes',
        this._readTimeoutMs
      );

      if (!preCheck.podeIniciar) {
        const isPending = preCheck.estadoPublicacao === 'PENDENTE_CONFIRMACAO';
        this.atualizarStatus({
          status: isPending ? 'PENDENTE_CONFIRMACAO' : 'ERRO',
          emAndamento: false,
          etapa: isPending ? 'PENDENTE_CONFIRMACAO' : 'ERRO',
          progressoPorcentagem: 0,
          mensagem: preCheck.mensagem || 'Publicação do SAEOU060 bloqueada pela verificação prévia.',
          chunkFalhou: preCheck.chunkFalhou,
          aguardandoConfirmacaoNuvem: isPending,
          erro: preCheck.mensagem,
        });
        return {
          sucesso: false,
          estadoPublicacao: preCheck.estadoPublicacao || 'PENDENTE_CONFIRMACAO',
          versaoConfirmadaNoServidor: false,
          mensagem: preCheck.mensagem || 'Publicação do SAEOU060 bloqueada pela verificação prévia.',
          chunkFalhou: preCheck.chunkFalhou,
        };
      }

      if (preCheck.versaoAtivaServidor) {
        this._versaoAtivaRemota = preCheck.versaoAtivaServidor;
      } else {
        this._versaoAtivaRemota = null;
      }

      // 2. Sanitizar e dividir em chunks <= 400 KB
      ultimoPercentual = 12;
      this.atualizarStatus({
        etapa: 'GERANDO_CHUNKS',
        progressoPorcentagem: 12,
        mensagem: 'Fracionando registros SAEOU060 em partes seguras...',
      });
      onProgress?.(12, 'Fracionando registros SAEOU060 em partes seguras...');

      const sanitized = registros.map((item) => cleanForFirestore(item));
      const chunks = buildSafeChunks(sanitized, 400 * 1024);
      totalChunksPlanejados = chunks.length;

      ultimoPercentual = 22;
      this.atualizarStatus({
        etapa: 'CALCULANDO_CHECKSUM',
        progressoPorcentagem: 22,
        mensagem: `Calculando checksum de integridade (${chunks.length} partes)...`,
      });
      onProgress?.(22, `Calculando checksum de integridade (${chunks.length} partes)...`, 0, chunks.length);

      // 3. Checksum
      const sample =
        JSON.stringify(registros.slice(0, 50)) +
        `_len_${registros.length}_` +
        JSON.stringify(registros.slice(-50));
      const checksum = await calcularChecksumSha256(sample);

      // 3.1 Economia Spark: evitar reenvio de chunks se a versão ativa no servidor já for idêntica e íntegra
      const idempotencia = await verificarVersaoAtivaIdenticaEIntegra({
        adapter: this._adapter,
        filialId,
        versoesCollectionName: 'saeou_versoes',
        versaoAtivaServidor: this._versaoAtivaRemota,
        expectedChecksum: checksum,
        expectedTotalChunks: chunks.length,
        expectedCountField: 'totalRegistros',
        expectedCountValue: registros.length,
        readTimeoutMs: this._readTimeoutMs,
      });

      if (idempotencia.reutilizavel && idempotencia.versaoId) {
        const agoraReuso = new Date().toISOString();
        this._writeTracker.setPendingVersion(null);
        this._versaoLocalId = idempotencia.versaoId;
        await this._setMetaFn('meta_saeou_sync', {
          versaoId: idempotencia.versaoId,
          dataPublicacaoIso: this._versaoAtivaRemota?.dataPublicacaoIso || agoraReuso,
          totalRegistros: registros.length,
        });

        this.atualizarStatus({
          status: 'SINCRONIZADO',
          emAndamento: false,
          etapa: 'CONCLUIDO',
          progressoPorcentagem: 100,
          mensagem: `SAEOU060 sem alterações: versão ${idempotencia.versaoId} já está íntegra e ativa na nuvem (0 escritas).`,
          versaoPublicada: idempotencia.versaoId,
          versaoPendente: undefined,
          chunkFalhou: undefined,
          aguardandoConfirmacaoNuvem: false,
          ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
        });
        onProgress?.(
          100,
          `SAEOU060 idêntico à versão ativa (${idempotencia.versaoId}). Reenvio ignorado para economizar cota (0 escritas).`,
          chunks.length,
          chunks.length
        );

        return {
          sucesso: true,
          estadoPublicacao: 'CONFIRMADA',
          versaoConfirmadaNoServidor: true,
          semAlteracoesPulouEnvio: true,
          mensagem: `SAEOU060 já estava atualizado e íntegro na nuvem central (versão ${idempotencia.versaoId}). Nenhuma escrita redundante executada.`,
          versaoId: idempotencia.versaoId,
          chunksEnviados: 0,
          totalChunks: chunks.length,
        };
      }

      const agora = new Date().toISOString();
      versaoId = `saeou_${filialId}_${Date.now()}`;

      // 4. Enviar chunks exclusivamente para a coleção versionada V3 com concorrência máxima de 2 e timeout
      ultimoPercentual = 35;
      this.atualizarStatus({
        etapa: 'ENVIANDO_CHUNKS',
        progressoPorcentagem: 35,
        mensagem: `Enviando partes para a nuvem (0 de ${chunks.length})...`,
      });
      onProgress?.(35, `Enviando partes para a nuvem (0 de ${chunks.length})...`, 0, chunks.length);

      const { confirmedIndices } = await executarEnvioChunksControlado({
        adapter: this._adapter,
        tracker: this._writeTracker,
        filialId,
        versoesCollectionName: 'saeou_versoes',
        versaoId,
        chunks,
        concurrencyLimit: this._concurrencyLimit,
        writeTimeoutMs: this._writeTimeoutMs,
        buildPayload: (chunkItems, chunkIdx, total) => ({
          versaoId,
          index: chunkIdx,
          totalChunks: total,
          itemsCount: chunkItems.length,
          items: chunkItems,
          atualizadoEm: agora,
        }),
        onChunkBatchConfirmed: (chunksConcluidos, total) => {
          const pct = Math.round(35 + (chunksConcluidos / total) * 47); // 35% a 82%
          ultimoPercentual = pct;
          const msg = `Enviando partes para a nuvem (${chunksConcluidos} de ${total})...`;
          this.atualizarStatus({ progressoPorcentagem: pct, mensagem: msg });
          onProgress?.(pct, msg, chunksConcluidos, total);
        },
      });

      // 5. Salvar metadados da versão com timeout controlado
      ultimoPercentual = 86;
      onProgress?.(86, 'Gravando metadados oficiais da versão SAEOU060...', chunks.length, chunks.length);
      const versaoMetaDocRef = this._adapter.doc(
        this._adapter.db,
        'filiais',
        filialId,
        'saeou_versoes',
        versaoId
      );
      await runTrackedWithTimeout(
        this._writeTracker,
        () =>
          this._adapter.setDoc(versaoMetaDocRef, {
            versaoId,
            filialId,
            dataPublicacaoIso: agora,
            publicadoPor: `${usuario.nome} (${usuario.matricula})`,
            totalRegistros: registros.length,
            totalChunks: chunks.length,
            checksumBase: checksum,
            versaoAnteriorId: this._versaoAtivaRemota?.versaoId || null,
          }),
        this._writeTimeoutMs,
        'gravação de metadados da versão SAEOU060'
      );

      // 6. Validação integral no servidor antes de comutar ponteiro
      ultimoPercentual = 90;
      this.atualizarStatus({
        etapa: 'VALIDANDO_INTEGRIDADE',
        progressoPorcentagem: 90,
        mensagem: 'Validando integridade de chunks, metadados e checksum no servidor...',
      });
      onProgress?.(
        90,
        'Validando integridade de chunks, metadados e checksum no servidor...',
        chunks.length,
        chunks.length
      );

      await validarIntegridadeVersaoNoServidor({
        adapter: this._adapter,
        filialId,
        versoesCollectionName: 'saeou_versoes',
        versaoId,
        expectedTotalChunks: chunks.length,
        expectedChecksum: checksum,
        confirmedIndices,
        expectedCountField: 'totalRegistros',
        expectedCountValue: registros.length,
        readTimeoutMs: this._readTimeoutMs,
      });

      // 7. Comutação Atômica do Ponteiro Oficial com timeout controlado
      ultimoPercentual = 94;
      this.atualizarStatus({
        etapa: 'COMUTANDO_PONTEIRO',
        progressoPorcentagem: 94,
        mensagem: 'Ativando versão central do SAEOU060...',
      });
      onProgress?.(94, 'Ativando versão central do SAEOU060...', chunks.length, chunks.length);

      const configRef = this._adapter.doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_saeou');
      await runTrackedWithTimeout(
        this._writeTracker,
        () =>
          this._adapter.runTransaction(this._adapter.db!, async (txn) => {
            const snap = await txn.get(configRef);
            const rawPrev = snap.exists() ? (snap.data() as any) : null;
            const versaoAnterior =
              rawPrev && rawPrev.versaoId && rawPrev.ativa !== false ? rawPrev.versaoId : null;
            txn.set(configRef, {
              versaoId,
              filialId,
              dataPublicacaoIso: agora,
              publicadoPor: `${usuario.nome} (${usuario.matricula})`,
              totalRegistros: registros.length,
              totalChunks: chunks.length,
              checksumBase: checksum,
              versaoAnteriorId: versaoAnterior,
              atualizadoEm: agora,
            });
          }),
        this._writeTimeoutMs,
        'ativação transacional do ponteiro SAEOU060'
      );

      // 8. Confirmação pós-transação do ponteiro ativo no servidor antes de reportar 100%
      ultimoPercentual = 98;
      this.atualizarStatus({
        etapa: 'CONFIRMANDO_ATIVA',
        progressoPorcentagem: 98,
        mensagem: 'Confirmando ponteiro ativo do SAEOU060 no Firestore...',
      });
      onProgress?.(98, 'Confirmando ponteiro ativo do SAEOU060 no Firestore...', chunks.length, chunks.length);

      await confirmarPonteiroAtivoNoServidor(
        this._adapter,
        filialId,
        'versao_ativa_saeou',
        versaoId,
        checksum,
        chunks.length,
        this._readTimeoutMs
      );

      this._writeTracker.setPendingVersion(null);
      this._versaoLocalId = versaoId;
      await this._setMetaFn('meta_saeou_sync', {
        versaoId,
        dataPublicacaoIso: agora,
        totalRegistros: registros.length,
      });

      this.atualizarStatus({
        status: 'SINCRONIZADO',
        emAndamento: false,
        etapa: 'CONCLUIDO',
        progressoPorcentagem: 100,
        mensagem: `SAEOU060 publicado e sincronizado com sucesso! (${registros.length} registros)`,
        versaoPublicada: versaoId,
        versaoPendente: undefined,
        chunkFalhou: undefined,
        aguardandoConfirmacaoNuvem: false,
        ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
      });
      onProgress?.(
        100,
        `SAEOU060 publicado e confirmado na nuvem central! (${registros.length} registros)`,
        chunks.length,
        chunks.length
      );

      return {
        sucesso: true,
        estadoPublicacao: 'CONFIRMADA',
        versaoConfirmadaNoServidor: true,
        mensagem: `SAEOU060 publicado e confirmado na nuvem central com sucesso (${registros.length} registros em ${chunks.length} partes).`,
        versaoId,
        chunksEnviados: chunks.length,
        totalChunks: chunks.length,
      };
    } catch (err: any) {
      console.error('[SaeouSyncService] Erro ao publicar SAEOU060:', err);

      if (err instanceof PublishTimeoutError || err?.name === 'PublishTimeoutError') {
        if (versaoId) {
          this._writeTracker.setPendingVersion({
            versaoId,
            chunkFalhou: err.chunkIndex,
            motivo: err.message,
            registradoEmMs: Date.now(),
          });
        }
        this.atualizarStatus({
          status: 'PENDENTE_CONFIRMACAO',
          emAndamento: false,
          etapa: 'PENDENTE_CONFIRMACAO',
          progressoPorcentagem: Math.min(95, ultimoPercentual),
          mensagem: err.message,
          versaoPendente: versaoId || undefined,
          chunkFalhou: err.chunkIndex,
          aguardandoConfirmacaoNuvem: true,
          erro: err.message,
        });
        return {
          sucesso: false,
          estadoPublicacao: 'PENDENTE_CONFIRMACAO',
          versaoConfirmadaNoServidor: false,
          mensagem: `${err.message} A versão NÃO foi ativada no Firestore. Dados locais preservados.`,
          versaoId: versaoId || undefined,
          chunkFalhou: err.chunkIndex,
          totalChunks: totalChunksPlanejados || undefined,
        };
      }

      if (this._adapter.isQuotaError(err)) {
        const recurso = detectQuotaResourceType(err);
        this._adapter.markQuotaExceeded(err?.message, recurso);
        const msgCota =
          'Cota diária gratuita do Firebase Spark esgotada (resource-exhausted). Envios interrompidos sem retentativas; versão anterior na nuvem e dados locais preservados.';
        this.atualizarStatus({
          status: 'BLOQUEADO_COTA',
          emAndamento: false,
          etapa: 'OCIOSO',
          progressoPorcentagem: Math.min(95, ultimoPercentual),
          mensagem: msgCota,
          aguardandoConfirmacaoNuvem: false,
          erro: err?.message || 'resource-exhausted',
        });
        return {
          sucesso: false,
          estadoPublicacao: 'AGUARDANDO_COTA',
          versaoConfirmadaNoServidor: false,
          aguardandoCota: true,
          mensagem: msgCota,
          versaoId: versaoId || undefined,
          totalChunks: totalChunksPlanejados || undefined,
        };
      }

      const msgErro =
        err instanceof PublishIntegrityError
          ? err.message
          : `Erro na publicação no Firebase: ${err?.message || 'Falha inesperada'}. Dados locais preservados.`;

      this.atualizarStatus({
        status: 'ERRO',
        emAndamento: false,
        etapa: 'ERRO',
        progressoPorcentagem: Math.min(95, ultimoPercentual),
        mensagem: msgErro,
        aguardandoConfirmacaoNuvem: false,
        erro: err?.message || 'Falha de comunicação',
      });
      return {
        sucesso: false,
        estadoPublicacao: 'ERRO',
        versaoConfirmadaNoServidor: false,
        mensagem: msgErro,
        versaoId: versaoId || undefined,
        totalChunks: totalChunksPlanejados || undefined,
      };
    }
  }

  // =========================================================================
  // DOWNLOAD DA VERSÃO ATIVA DO SAEOU060 PARA O DISPOSITIVO LOCAL
  // =========================================================================

  public async baixarSaeouAtivoParaDispositivo(
    filialId: string = '172',
    onProgress?: (pct: number, msg: string) => void
  ): Promise<{ sucesso: boolean; mensagem: string; totalRegistros?: number }> {
    if (this._isDownloading) {
      return { sucesso: false, mensagem: 'Download de SAEOU060 já em andamento.' };
    }
    if (this._adapter.isFirestoreQuotaExceeded()) {
      this.atualizarStatus({
        status: 'BLOQUEADO_COTA',
        emAndamento: false,
        mensagem: 'Download remoto pausado por bloqueio de cota — operando com IndexedDB local.',
      });
      return {
        sucesso: false,
        mensagem: 'Cota do Firebase Spark aguardando liberação. Operando com dados locais do IndexedDB.',
      };
    }
    if (!this._adapter.db) {
      return { sucesso: false, mensagem: 'Firestore indisponível.' };
    }

    this._isDownloading = true;

    try {
      await this._adapter.ensureAuth().catch(() => null);
      if (onProgress) onProgress(5, 'Consultando versão oficial do SAEOU060...');

      const configSnap = await getDoc(doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_saeou'));
      let versaoId = '';
      let dataIso = '';

      if (configSnap.exists()) {
        const versaoInfo = configSnap.data() as VersaoAtivaSaeouInfo;
        versaoId = versaoInfo.versaoId;
        dataIso = versaoInfo.dataPublicacaoIso;
      } else {
        // Fallback para metadados/geral e saeou060_chunks
        const metaSnap = await getDoc(doc(this._adapter.db, 'metadados', 'geral'));
        if (!metaSnap.exists()) {
          this.atualizarStatus({ status: 'LOCAL', mensagem: 'Nenhum SAEOU060 publicado na nuvem' });
          return { sucesso: false, mensagem: 'Nenhum SAEOU060 oficial publicado.' };
        }
        const metaData = metaSnap.data();
        versaoId = `legacy_${metaData.saeou060_version || Date.now()}`;
      }

      if (onProgress) onProgress(20, 'Baixando partes do SAEOU060 da nuvem...');

      // Buscar chunks (tentando a coleção versionada primeiro, ou saeou060_chunks como fallback)
      let chunksSnap = await getDocs(
        collection(this._adapter.db, 'filiais', filialId, 'saeou_versoes', versaoId, 'chunks')
      );

      if (chunksSnap.empty) {
        chunksSnap = await getDocs(collection(this._adapter.db, 'saeou060_chunks'));
      }

      const chunkDocs: { index: number; items: RegistroSaeou060[] }[] = [];
      chunksSnap.forEach((d) => {
        const cData = d.data();
        if (cData.items && Array.isArray(cData.items)) {
          chunkDocs.push({ index: cData.index ?? 0, items: cData.items });
        }
      });

      chunkDocs.sort((a, b) => a.index - b.index);

      const todosRegistros: RegistroSaeou060[] = [];
      chunkDocs.forEach((c) => todosRegistros.push(...c.items));

      if (todosRegistros.length === 0) {
        throw new Error('As partes baixadas do SAEOU060 estão vazias. Abortando para proteger a base local.');
      }

      if (onProgress) onProgress(70, 'Reconciliando e gravando no IndexedDB...');

      // Aplicar snapshot reconciliado sem duplicar registros e sem disparar sync legado
      await productRepository.aplicarNovoSnapshotSaeou060(
        todosRegistros,
        `NUVEM_${versaoId}`,
        { skipLegacyCloudSync: true }
      );

      this._versaoLocalId = versaoId;
      await dbSetMeta('meta_saeou_sync', {
        versaoId,
        dataPublicacaoIso: dataIso || new Date().toISOString(),
        totalRegistros: todosRegistros.length,
      });

      this.atualizarStatus({
        status: 'SINCRONIZADO',
        emAndamento: false,
        etapa: 'CONCLUIDO',
        progressoPorcentagem: 100,
        mensagem: `SAEOU060 sincronizado com a nuvem (${todosRegistros.length} registros)`,
        versaoPublicada: versaoId,
        ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
      });

      if (onProgress) onProgress(100, `SAEOU060 atualizado com sucesso! (${todosRegistros.length} registros)`);

      return {
        sucesso: true,
        mensagem: 'SAEOU060 atualizado com sucesso no dispositivo.',
        totalRegistros: todosRegistros.length,
      };
    } catch (err: any) {
      console.error('[SaeouSyncService] Erro ao baixar SAEOU060:', err);
      if (this._adapter.isQuotaError(err)) {
        this._adapter.markQuotaExceeded(err?.message, detectQuotaResourceType(err));
        this.atualizarStatus({
          status: 'BLOQUEADO_COTA',
          emAndamento: false,
          etapa: 'OCIOSO',
          progressoPorcentagem: 0,
          mensagem: 'Cota diária do Firebase Spark atingida ao baixar SAEOU060. Dados locais preservados.',
          erro: err?.message || 'resource-exhausted',
        });
        return {
          sucesso: false,
          mensagem: 'Cota diária gratuita do Firebase Spark esgotada. Base local do IndexedDB preservada.',
        };
      }
      this.atualizarStatus({
        status: 'ERRO',
        emAndamento: false,
        etapa: 'ERRO',
        progressoPorcentagem: 0,
        mensagem: 'Erro ao baixar SAEOU060 da nuvem',
        erro: err?.message || 'Erro de rede',
      });
      return {
        sucesso: false,
        mensagem: `Falha ao baixar SAEOU060: ${err?.message || 'Erro de rede'}. Dados locais preservados.`,
      };
    } finally {
      this._isDownloading = false;
    }
  }

  public async verificarSincronizacaoComRemoto(filialId: string = '172'): Promise<void> {
    if (
      (filialId === '172' && isModoAtualizacaoLocalAtivo()) ||
      !this._adapter.db ||
      this._isDownloading ||
      this._status.emAndamento ||
      this._adapter.isFirestoreQuotaExceeded()
    ) {
      return;
    }
    try {
      const snap = await getDoc(doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_saeou'));
      if (snap.exists()) {
        const remota = snap.data() as VersaoAtivaSaeouInfo;
        if (this._versaoLocalId !== remota.versaoId) {
          await this.baixarSaeouAtivoParaDispositivo(filialId);
        } else {
          this.atualizarStatus({
            status: 'SINCRONIZADO',
            mensagem: `SAEOU060 em dia com a nuvem central (${remota.totalRegistros} registros)`,
            ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
          });
        }
      }
    } catch (e: any) {
      if (this._adapter.isQuotaError(e)) {
        this._adapter.markQuotaExceeded(e?.message, detectQuotaResourceType(e));
      }
      console.warn('[SaeouSyncService] Falha na checagem de sincronização:', e);
    }
  }

  public getStatus(): PublicacaoSaeouStatus {
    return { ...this._status };
  }

  public getVersaoAtivaRemota(): VersaoAtivaSaeouInfo | null {
    return this._versaoAtivaRemota ? { ...this._versaoAtivaRemota } : null;
  }

  public getVersaoLocalId(): string | null {
    return this._versaoLocalId;
  }

  public subscribeStatus(cb: (status: PublicacaoSaeouStatus) => void): () => void {
    this._listenersStatus.push(cb);
    cb(this.getStatus());
    return () => {
      this._listenersStatus = this._listenersStatus.filter((l) => l !== cb);
    };
  }

  public subscribeVersao(cb: (versao: VersaoAtivaSaeouInfo | null) => void): () => void {
    this._listenersVersao.push(cb);
    cb(this.getVersaoAtivaRemota());
    return () => {
      this._listenersVersao = this._listenersVersao.filter((l) => l !== cb);
    };
  }

  public redefinirEstadoLocalAposLimpeza(): void {
    this._versaoLocalId = null;
    this._versaoAtivaRemota = null;
    this.atualizarStatus({
      status: 'LOCAL',
      emAndamento: false,
      etapa: 'OCIOSO',
      progressoPorcentagem: 0,
      mensagem: 'SAEOU060 limpo centralmente. Pronto para receber nova importação.',
      versaoPublicada: undefined,
      versaoPendente: undefined,
      chunkFalhou: undefined,
      aguardandoConfirmacaoNuvem: false,
      ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
    });
    this.notificarVersao();
  }

  private atualizarStatus(patch: Partial<PublicacaoSaeouStatus>): void {
    this._status = { ...this._status, ...patch };
    this._listenersStatus.forEach((cb) => {
      try {
        cb(this.getStatus());
      } catch (e) {
        console.error(e);
      }
    });
  }

  private notificarVersao(): void {
    const v = this.getVersaoAtivaRemota();
    this._listenersVersao.forEach((cb) => {
      try {
        cb(v);
      } catch (e) {
        console.error(e);
      }
    });
  }
}

export const saeouSyncService = new SaeouSyncService();
