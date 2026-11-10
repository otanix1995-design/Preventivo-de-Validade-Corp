/**
 * NUVEM V3 — SERVIÇO DE SINCRONIZAÇÃO E PUBLICAÇÃO CENTRAL DO SPCOI007
 *
 * Atende aos requisitos da Filial 172:
 * 1. Armazenamento versionado no Firestore sob /filiais/{filialId}/spcoi_versoes/{versaoId}.
 * 2. Upload fracionado por tamanho real em bytes (chunks <= 400 KB), concorrência limitada a 2.
 * 3. Checksum SHA-256 de integridade + validação completa no servidor antes da ativação.
 * 4. Controle de tempo limite sem acumular escritas concorrentes no WriteStream.
 * 5. Comutação transacional atômica + confirmação pós-gravação do ponteiro ativo.
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
import { dbClear, dbSetMeta, dbGetMeta, STORES } from './db';
import { FornecedorSPCOI007, Industria, ResumoImportacaoSPCOI007 } from '../types';
import { isvService } from './isvService';
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

export interface PublicacaoSpcoiStatus {
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

export interface VersaoAtivaSpcoiInfo {
  versaoId: string;
  filialId: string;
  dataPublicacaoIso: string;
  publicadoPor: string;
  totalFornecedores: number;
  totalIndustrias: number;
  totalChunks: number;
  checksumBase: string;
  versaoAnteriorId?: string | null;
}

export interface SpcoiSyncServiceOptions {
  autoStart?: boolean;
  adapter?: PublishAdapter;
  writeTimeoutMs?: number;
  readTimeoutMs?: number;
  concurrencyLimit?: number;
  setMetaFn?: (key: string, val: any) => Promise<void>;
  getUsuarioFn?: () => UsuarioOperacional;
}

export class SpcoiSyncService {
  private _status: PublicacaoSpcoiStatus = {
    status: 'LOCAL',
    emAndamento: false,
    etapa: 'OCIOSO',
    progressoPorcentagem: 0,
    mensagem: 'Pronto (IndexedDB)',
  };

  private _versaoAtivaRemota: VersaoAtivaSpcoiInfo | null = null;
  private _versaoLocalId: string | null = null;
  private _unsubSnapshot: Unsubscribe | null = null;
  private _listenersStatus: Array<(status: PublicacaoSpcoiStatus) => void> = [];
  private _listenersVersao: Array<(versao: VersaoAtivaSpcoiInfo | null) => void> = [];
  private _isDownloading = false;
  private _onSpcoiClearedCallback?: () => void;

  private readonly _writeTracker = new PendingWriteTracker();
  private readonly _adapter: PublishAdapter;
  private readonly _writeTimeoutMs: number;
  private readonly _readTimeoutMs: number;
  private readonly _concurrencyLimit: number;
  private readonly _setMetaFn: (key: string, val: any) => Promise<void>;
  private readonly _getUsuarioFn: () => UsuarioOperacional;

  private _unsubQuota: (() => void) | null = null;

  constructor(options?: SpcoiSyncServiceOptions) {
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
      const meta = await dbGetMeta<any>('meta_spcoi_sync', null);
      if (meta && meta.versaoId) {
        this._versaoLocalId = meta.versaoId;
      }
    } catch (e) {
      console.warn('[SpcoiSyncService] Erro ao ler metadados locais:', e);
    }
  }

  public registerSpcoiClearedCallback(cb: () => void): void {
    this._onSpcoiClearedCallback = cb;
  }

  // =========================================================================
  // MONITORAMENTO EM TEMPO REAL DA VERSÃO ATIVA NO FIRESTORE
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
      const configDocRef = doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_spcoi');
      this._unsubSnapshot = onSnapshot(
        configDocRef,
        async (snap) => {
          if (snap.exists()) {
            const data = snap.data() as VersaoAtivaSpcoiInfo & { status?: string; limpaEm?: string; ativa?: boolean };

            // Se a base SPCOI007 foi limpa pela gerência na nuvem central
            if (!data.versaoId || data.ativa === false || data.status === 'LIMPA_AGUARDANDO_IMPORTACAO') {
              this._versaoAtivaRemota = null;
              this.notificarVersao();

              if (this._versaoLocalId !== null) {
                console.log('[SpcoiSyncService] Base SPCOI007 foi limpa na nuvem central. Sincronizando limpeza local...');
                try {
                  await dbClear(STORES.SPCOI007_FORNECEDORES);
                  await dbClear(STORES.INDUSTRIAS);
                  await dbClear(STORES.ISV_REGISTROS_OPERACIONAIS);
                  await dbClear(STORES.HISTORICO_IMPORTACOES_SPCOI007);
                  await dbClear(STORES.HISTORICO_IMPORTACOES_ISV);
                  await dbSetMeta('meta_spcoi_sync', {
                    versaoId: null,
                    status: 'LIMPA_AGUARDANDO_IMPORTACAO',
                    limpaEm: data.limpaEm || new Date().toISOString(),
                    totalFornecedores: 0,
                    totalIndustrias: 0,
                  });
                } catch (e) {
                  console.warn('[SpcoiSyncService] Erro ao limpar stores locais:', e);
                }

                this._versaoLocalId = null;

                try {
                  isvService.redefinirSpcoiAposLimpeza();
                } catch (err) {
                  console.warn('[SpcoiSyncService] Erro ao redefinir isvService em memória:', err);
                }

                if (this._onSpcoiClearedCallback) {
                  try {
                    this._onSpcoiClearedCallback();
                  } catch (cbErr) {
                    console.warn('[SpcoiSyncService] Erro no callback de limpeza:', cbErr);
                  }
                }
              }

              this.atualizarStatus({
                status: 'LOCAL',
                emAndamento: false,
                etapa: 'OCIOSO',
                mensagem: 'SPCOI007 limpo centralmente. Pronto para receber nova importação.',
                ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
              });
              return;
            }

            this._versaoAtivaRemota = data;
            this.notificarVersao();

            // Se a versão remota é diferente da versão local salva no IndexedDB,
            // sincroniza automaticamente em segundo plano para manter todos os dispositivos alinhados
            if (this._versaoLocalId !== data.versaoId && !this._status.emAndamento && !this._isDownloading) {
              console.log(`[SpcoiSyncService] Nova versão remota detectada: ${data.versaoId} (local: ${this._versaoLocalId}). Baixando...`);
              await this.baixarSpcoiAtivoParaDispositivo(filialId);
            } else if (
              this._versaoLocalId === data.versaoId &&
              !this._status.emAndamento &&
              this._status.status !== 'PENDENTE_CONFIRMACAO' &&
              this._status.status !== 'ERRO'
            ) {
              this.atualizarStatus({
                status: 'SINCRONIZADO',
                mensagem: `Sincronizado com a nuvem central (${data.totalFornecedores} fornecedores)`,
                ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
              });
            }
          } else {
            this._versaoAtivaRemota = null;
            this.notificarVersao();
          }
        },
        (err) => {
          console.warn('[SpcoiSyncService] Erro ao monitorar versão SPCOI007:', err?.message);
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
      console.warn('[SpcoiSyncService] Falha ao configurar listener:', e);
    }
  }

  // =========================================================================
  // PUBLICAÇÃO CENTRAL MESTRE DO SPCOI007
  // =========================================================================

  public async publicarSpcoiCentral(
    fornecedores: FornecedorSPCOI007[],
    industrias: Industria[],
    resumo?: ResumoImportacaoSPCOI007,
    filialId: string = '172',
    onProgress?: (pct: number, msg: string, chunkAtual?: number, totalChunks?: number) => void
  ): Promise<ResultadoPublicacaoBase> {
    if (!fornecedores || fornecedores.length === 0) {
      return {
        sucesso: false,
        estadoPublicacao: 'ERRO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Não há registros de fornecedores SPCOI007 para publicação.',
      };
    }

    if (this._status.emAndamento) {
      return {
        sucesso: false,
        estadoPublicacao: 'ERRO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Já existe uma publicação de SPCOI007 em andamento. Aguarde a conclusão antes de iniciar outra.',
      };
    }

    if (!this._adapter.db) {
      this.atualizarStatus({
        status: 'LOCAL',
        mensagem: 'Firestore indisponível — base salva localmente',
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
        'Publicação pausada: cota diária gratuita do Firebase Spark aguardando liberação. Dados do SPCOI007 preservados localmente no IndexedDB.';
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
      mensagem: 'Verificando estado remoto e gravações pendentes do SPCOI007...',
      aguardandoConfirmacaoNuvem: false,
      erro: undefined,
      chunkFalhou: undefined,
    });
    onProgress?.(5, 'Verificando estado remoto e gravações pendentes do SPCOI007...');

    try {
      await this._adapter.ensureAuth().catch(() => null);

      // 1. Verificar estado remoto e bloquear caso gravação anterior ainda esteja pendente
      const preCheck = await verificarEstadoRemotoAntesDePublicar<VersaoAtivaSpcoiInfo>(
        this._adapter,
        this._writeTracker,
        filialId,
        'versao_ativa_spcoi',
        'spcoi_versoes',
        this._readTimeoutMs
      );

      if (!preCheck.podeIniciar) {
        const isPending = preCheck.estadoPublicacao === 'PENDENTE_CONFIRMACAO';
        this.atualizarStatus({
          status: isPending ? 'PENDENTE_CONFIRMACAO' : 'ERRO',
          emAndamento: false,
          etapa: isPending ? 'PENDENTE_CONFIRMACAO' : 'ERRO',
          progressoPorcentagem: 0,
          mensagem: preCheck.mensagem || 'Publicação do SPCOI007 bloqueada pela verificação prévia.',
          chunkFalhou: preCheck.chunkFalhou,
          aguardandoConfirmacaoNuvem: isPending,
          erro: preCheck.mensagem,
        });
        return {
          sucesso: false,
          estadoPublicacao: preCheck.estadoPublicacao || 'PENDENTE_CONFIRMACAO',
          versaoConfirmadaNoServidor: false,
          mensagem: preCheck.mensagem || 'Publicação do SPCOI007 bloqueada pela verificação prévia.',
          chunkFalhou: preCheck.chunkFalhou,
        };
      }

      if (preCheck.versaoAtivaServidor) {
        this._versaoAtivaRemota = preCheck.versaoAtivaServidor;
      } else {
        this._versaoAtivaRemota = null;
      }

      // 2. Chunks <= 400 KB
      ultimoPercentual = 12;
      this.atualizarStatus({
        etapa: 'GERANDO_CHUNKS',
        progressoPorcentagem: 12,
        mensagem: 'Fracionando dados do SPCOI007 em partes seguras...',
      });
      onProgress?.(12, 'Fracionando dados do SPCOI007 em partes seguras...');

      const chunks = buildSafeChunks(fornecedores, 400 * 1024);
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
        JSON.stringify(fornecedores.slice(0, 50)) +
        `_len_${fornecedores.length}_ind_${industrias.length}_` +
        JSON.stringify(fornecedores.slice(-50));
      const checksum = await calcularChecksumSha256(sample);

      // 3.1 Economia Spark: evitar reenvio de chunks se a versão ativa no servidor já for idêntica e íntegra
      const idempotencia = await verificarVersaoAtivaIdenticaEIntegra({
        adapter: this._adapter,
        filialId,
        versoesCollectionName: 'spcoi_versoes',
        versaoAtivaServidor: this._versaoAtivaRemota,
        expectedChecksum: checksum,
        expectedTotalChunks: chunks.length,
        expectedCountField: 'totalFornecedores',
        expectedCountValue: fornecedores.length,
        readTimeoutMs: this._readTimeoutMs,
      });

      if (idempotencia.reutilizavel && idempotencia.versaoId) {
        const agoraReuso = new Date().toISOString();
        this._writeTracker.setPendingVersion(null);
        this._versaoLocalId = idempotencia.versaoId;
        await this._setMetaFn('meta_spcoi_sync', {
          versaoId: idempotencia.versaoId,
          dataPublicacaoIso: this._versaoAtivaRemota?.dataPublicacaoIso || agoraReuso,
          totalFornecedores: fornecedores.length,
          totalIndustrias: industrias.length,
        });

        this.atualizarStatus({
          status: 'SINCRONIZADO',
          emAndamento: false,
          etapa: 'CONCLUIDO',
          progressoPorcentagem: 100,
          mensagem: `SPCOI007 sem alterações: versão ${idempotencia.versaoId} já está íntegra e ativa na nuvem (0 escritas).`,
          versaoPublicada: idempotencia.versaoId,
          versaoPendente: undefined,
          chunkFalhou: undefined,
          aguardandoConfirmacaoNuvem: false,
          ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
        });
        onProgress?.(
          100,
          `SPCOI007 idêntico à versão ativa (${idempotencia.versaoId}). Reenvio ignorado para economizar cota (0 escritas).`,
          chunks.length,
          chunks.length
        );

        return {
          sucesso: true,
          estadoPublicacao: 'CONFIRMADA',
          versaoConfirmadaNoServidor: true,
          semAlteracoesPulouEnvio: true,
          mensagem: `SPCOI007 já estava atualizado e íntegro na nuvem central (versão ${idempotencia.versaoId}). Nenhuma escrita redundante executada.`,
          versaoId: idempotencia.versaoId,
          chunksEnviados: 0,
          totalChunks: chunks.length,
        };
      }

      const agora = new Date().toISOString();
      versaoId = `spcoi_${filialId}_${Date.now()}`;

      // 4. Enviar chunks com concorrência máxima de 2 chunks simultâneos e timeout explícito
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
        versoesCollectionName: 'spcoi_versoes',
        versaoId,
        chunks,
        concurrencyLimit: this._concurrencyLimit,
        writeTimeoutMs: this._writeTimeoutMs,
        buildPayload: (chunkData, chunkIdx, total) => ({
          versaoId,
          index: chunkIdx,
          totalChunks: total,
          itemsCount: chunkData.length,
          items: chunkData,
          atualizadoEm: agora,
        }),
        onChunkBatchConfirmed: (chunksConcluidos, total) => {
          const pct = Math.round(35 + (chunksConcluidos / total) * 45); // 35% a 80%
          ultimoPercentual = pct;
          const msg = `Enviando partes para a nuvem (${chunksConcluidos} de ${total})...`;
          this.atualizarStatus({ progressoPorcentagem: pct, mensagem: msg });
          onProgress?.(pct, msg, chunksConcluidos, total);
        },
      });

      // 5. Salvar indústrias e metadados da versão com timeout controlado
      ultimoPercentual = 84;
      onProgress?.(84, 'Salvando cadastro de indústrias e metadados da versão...', chunks.length, chunks.length);
      const versaoMetaDocRef = this._adapter.doc(
        this._adapter.db,
        'filiais',
        filialId,
        'spcoi_versoes',
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
            totalFornecedores: fornecedores.length,
            totalIndustrias: industrias.length,
            totalChunks: chunks.length,
            checksumBase: checksum,
            versaoAnteriorId: this._versaoAtivaRemota?.versaoId || null,
            industrias: industrias,
            resumo: resumo || null,
          }),
        this._writeTimeoutMs,
        'gravação de metadados da versão SPCOI007'
      );

      // 6. Validação integral no servidor antes de comutar ponteiro
      ultimoPercentual = 89;
      this.atualizarStatus({
        etapa: 'VALIDANDO_INTEGRIDADE',
        progressoPorcentagem: 89,
        mensagem: 'Validando integridade de chunks, indústrias e checksum no servidor...',
      });
      onProgress?.(
        89,
        'Validando integridade de chunks, indústrias e checksum no servidor...',
        chunks.length,
        chunks.length
      );

      await validarIntegridadeVersaoNoServidor({
        adapter: this._adapter,
        filialId,
        versoesCollectionName: 'spcoi_versoes',
        versaoId,
        expectedTotalChunks: chunks.length,
        expectedChecksum: checksum,
        confirmedIndices,
        expectedCountField: 'totalFornecedores',
        expectedCountValue: fornecedores.length,
        readTimeoutMs: this._readTimeoutMs,
      });

      // 7. Comutação Atômica do Ponteiro Oficial com timeout controlado
      ultimoPercentual = 94;
      this.atualizarStatus({
        etapa: 'COMUTANDO_PONTEIRO',
        progressoPorcentagem: 94,
        mensagem: 'Ativando versão central do SPCOI007...',
      });
      onProgress?.(94, 'Ativando versão central do SPCOI007...', chunks.length, chunks.length);

      const configRef = this._adapter.doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_spcoi');
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
              totalFornecedores: fornecedores.length,
              totalIndustrias: industrias.length,
              totalChunks: chunks.length,
              checksumBase: checksum,
              versaoAnteriorId: versaoAnterior,
              atualizadoEm: agora,
            });
          }),
        this._writeTimeoutMs,
        'ativação transacional do ponteiro SPCOI007'
      );

      // 8. Confirmação pós-transação da versão ativa diretamente no servidor antes de reportar 100%
      ultimoPercentual = 98;
      this.atualizarStatus({
        etapa: 'CONFIRMANDO_ATIVA',
        progressoPorcentagem: 98,
        mensagem: 'Confirmando ponteiro ativo do SPCOI007 no Firestore...',
      });
      onProgress?.(98, 'Confirmando ponteiro ativo do SPCOI007 no Firestore...', chunks.length, chunks.length);

      await confirmarPonteiroAtivoNoServidor(
        this._adapter,
        filialId,
        'versao_ativa_spcoi',
        versaoId,
        checksum,
        chunks.length,
        this._readTimeoutMs
      );

      this._writeTracker.setPendingVersion(null);
      this._versaoLocalId = versaoId;
      await this._setMetaFn('meta_spcoi_sync', {
        versaoId,
        dataPublicacaoIso: agora,
        totalFornecedores: fornecedores.length,
        totalIndustrias: industrias.length,
      });

      this.atualizarStatus({
        status: 'SINCRONIZADO',
        emAndamento: false,
        etapa: 'CONCLUIDO',
        progressoPorcentagem: 100,
        mensagem: `SPCOI007 publicado e sincronizado com sucesso! (${fornecedores.length} fornecedores, ${industrias.length} indústrias)`,
        versaoPublicada: versaoId,
        versaoPendente: undefined,
        chunkFalhou: undefined,
        aguardandoConfirmacaoNuvem: false,
        ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
      });
      onProgress?.(
        100,
        `SPCOI007 publicado e confirmado na nuvem central! (${fornecedores.length} fornecedores)`,
        chunks.length,
        chunks.length
      );

      return {
        sucesso: true,
        estadoPublicacao: 'CONFIRMADA',
        versaoConfirmadaNoServidor: true,
        mensagem: `SPCOI007 publicado e confirmado na nuvem central com sucesso (${fornecedores.length} fornecedores, ${chunks.length} partes).`,
        versaoId,
        chunksEnviados: chunks.length,
        totalChunks: chunks.length,
      };
    } catch (err: any) {
      console.error('[SpcoiSyncService] Erro ao publicar SPCOI007:', err);

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
          mensagem: `${err.message} A versão NÃO foi ativada e o ponteiro anterior foi preservado. Dados locais preservados.`,
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
  // DOWNLOAD DA VERSÃO ATIVA DO SPCOI007 PARA O DISPOSITIVO LOCAL
  // =========================================================================

  public async baixarSpcoiAtivoParaDispositivo(
    filialId: string = '172',
    onProgress?: (pct: number, msg: string) => void
  ): Promise<{ sucesso: boolean; mensagem: string; totalFornecedores?: number }> {
    if (this._isDownloading) {
      return { sucesso: false, mensagem: 'Download de SPCOI007 já em andamento.' };
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
      if (onProgress) onProgress(5, 'Consultando versão oficial do SPCOI007...');

      const configSnap = await getDoc(doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_spcoi'));
      if (!configSnap.exists()) {
        this.atualizarStatus({ status: 'LOCAL', mensagem: 'Nenhum SPCOI007 publicado na nuvem' });
        return { sucesso: false, mensagem: 'Nenhum SPCOI007 oficial publicado para esta filial.' };
      }

      const versaoInfo = configSnap.data() as VersaoAtivaSpcoiInfo;
      const versaoId = versaoInfo.versaoId;

      if (onProgress) onProgress(15, `Baixando metadados da versão ${versaoId}...`);

      const versaoMetaSnap = await getDoc(doc(this._adapter.db, 'filiais', filialId, 'spcoi_versoes', versaoId));
      if (!versaoMetaSnap.exists()) {
        throw new Error('Metadados da versão remota não encontrados.');
      }
      const versaoMetaData = versaoMetaSnap.data();
      const industriasRemotas: Industria[] = versaoMetaData.industrias || [];

      if (onProgress) onProgress(25, `Baixando ${versaoInfo.totalChunks} partes do SPCOI007...`);

      const chunksSnap = await getDocs(
        collection(this._adapter.db, 'filiais', filialId, 'spcoi_versoes', versaoId, 'chunks')
      );

      const chunkDocs: { index: number; items: FornecedorSPCOI007[] }[] = [];
      chunksSnap.forEach((d) => {
        const cData = d.data();
        if (cData.items && Array.isArray(cData.items)) {
          chunkDocs.push({ index: cData.index ?? 0, items: cData.items });
        }
      });

      chunkDocs.sort((a, b) => a.index - b.index);

      const todosFornecedores: FornecedorSPCOI007[] = [];
      chunkDocs.forEach((c) => todosFornecedores.push(...c.items));

      if (todosFornecedores.length === 0) {
        throw new Error('As partes baixadas estão vazias. Abortando para proteger a base local.');
      }

      if (onProgress) onProgress(75, 'Atualizando banco local IndexedDB e memória...');

      // Integração segura no isvService e IndexedDB (sem duplicação)
      await isvService.salvarImportacaoSpcoi(
        todosFornecedores,
        industriasRemotas,
        versaoMetaData.resumo || {
          data_hora: versaoInfo.dataPublicacaoIso,
          arquivo: `NUVEM_SPCOI007_${versaoId}.xlsx`,
          total_linhas: todosFornecedores.length,
          linhas_validas: todosFornecedores.length,
          produtos_com_cnpj: todosFornecedores.length,
          produtos_sem_cnpj: 0,
          industrias_distintas: industriasRemotas.length,
          produtos_multiplos_cnpjs: 0,
          produtos_nao_encontrados_smg: 0,
        }
      );

      this._versaoLocalId = versaoId;
      await dbSetMeta('meta_spcoi_sync', {
        versaoId,
        dataPublicacaoIso: versaoInfo.dataPublicacaoIso,
        totalFornecedores: todosFornecedores.length,
        totalIndustrias: industriasRemotas.length,
      });

      this.atualizarStatus({
        status: 'SINCRONIZADO',
        emAndamento: false,
        etapa: 'CONCLUIDO',
        progressoPorcentagem: 100,
        mensagem: `SPCOI007 sincronizado com a nuvem (${todosFornecedores.length} fornecedores)`,
        versaoPublicada: versaoId,
        ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
      });

      if (onProgress) onProgress(100, `SPCOI007 atualizado com sucesso! (${todosFornecedores.length} registros)`);

      return {
        sucesso: true,
        mensagem: `SPCOI007 atualizado com sucesso no dispositivo.`,
        totalFornecedores: todosFornecedores.length,
      };
    } catch (err: any) {
      console.error('[SpcoiSyncService] Erro ao baixar SPCOI007:', err);
      if (this._adapter.isQuotaError(err)) {
        this._adapter.markQuotaExceeded(err?.message, detectQuotaResourceType(err));
        this.atualizarStatus({
          status: 'BLOQUEADO_COTA',
          emAndamento: false,
          etapa: 'OCIOSO',
          progressoPorcentagem: 0,
          mensagem: 'Cota diária do Firebase Spark atingida ao baixar SPCOI007. Dados locais preservados.',
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
        mensagem: 'Erro ao baixar SPCOI007 da nuvem',
        erro: err?.message || 'Erro de rede',
      });
      return {
        sucesso: false,
        mensagem: `Falha ao baixar SPCOI007: ${err?.message || 'Erro de rede'}. Dados locais preservados.`,
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
      const snap = await getDoc(doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_spcoi'));
      if (snap.exists()) {
        const remota = snap.data() as VersaoAtivaSpcoiInfo;
        if (this._versaoLocalId !== remota.versaoId) {
          await this.baixarSpcoiAtivoParaDispositivo(filialId);
        } else {
          this.atualizarStatus({
            status: 'SINCRONIZADO',
            mensagem: `SPCOI007 em dia com a nuvem central (${remota.totalFornecedores} fornecedores)`,
            ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
          });
        }
      }
    } catch (e: any) {
      if (this._adapter.isQuotaError(e)) {
        this._adapter.markQuotaExceeded(e?.message, detectQuotaResourceType(e));
      }
      console.warn('[SpcoiSyncService] Falha na checagem de sincronização:', e);
    }
  }

  public getStatus(): PublicacaoSpcoiStatus {
    return { ...this._status };
  }

  public getVersaoAtivaRemota(): VersaoAtivaSpcoiInfo | null {
    return this._versaoAtivaRemota ? { ...this._versaoAtivaRemota } : null;
  }

  public getVersaoLocalId(): string | null {
    return this._versaoLocalId;
  }

  public subscribeStatus(cb: (status: PublicacaoSpcoiStatus) => void): () => void {
    this._listenersStatus.push(cb);
    cb(this.getStatus());
    return () => {
      this._listenersStatus = this._listenersStatus.filter((l) => l !== cb);
    };
  }

  public subscribeVersao(cb: (versao: VersaoAtivaSpcoiInfo | null) => void): () => void {
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
      mensagem: 'SPCOI007 limpo centralmente. Pronto para receber nova importação.',
      versaoPublicada: undefined,
      versaoPendente: undefined,
      chunkFalhou: undefined,
      aguardandoConfirmacaoNuvem: false,
      ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
    });
    this.notificarVersao();
  }

  private atualizarStatus(patch: Partial<PublicacaoSpcoiStatus>): void {
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

export const spcoiSyncService = new SpcoiSyncService();
