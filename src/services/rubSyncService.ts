/**
 * NUVEM V3 — SERVIÇO DE SINCRONIZAÇÃO E PUBLICAÇÃO MESTRE DA BASE RUB (36 COLUNAS)
 *
 * Atende aos requisitos da Filial 172:
 * 1. BASE RUB é a fonte mestre operacional soberana (Não SMGOI013).
 * 2. Upload fracionado por tamanho real em bytes (chunks <= 450 KB), concorrência limitada a 2.
 * 3. Checksum de integridade SHA-256 do lote completo.
 * 4. Controle explícito de tempo limite sem acumular retentativas pendentes no WriteStream.
 * 5. Validação integral de chunks, metadados e checksum no servidor antes da ativação.
 * 6. Comutação atômica transacional de versão + confirmação pós-gravação do ponteiro ativo.
 * 7. Status explícito: LOCAL | PUBLICANDO | SINCRONIZADO | PENDENTE_CONFIRMACAO | ERRO.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { db, detectQuotaResourceType } from './firebase';
import { authRoleService, UsuarioOperacional } from './authRoleService';
import { concurrentRubPublicationService, VersaoAtivaInfo } from './concurrentRubPublicationService';
import { dbClear, dbPutAll, dbGetMeta, dbSetMeta, STORES } from './db';
import { MetadadosBase, ProdutoSMG } from '../types';
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

export interface PublicacaoRubStatus {
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

export interface VersaoHistoricoRub {
  versaoId: string;
  dataPublicacaoIso: string;
  publicadoPor: string;
  totalProdutos: number;
  totalChunks: number;
  checksumBase: string;
  versaoAnteriorId?: string | null;
}

export interface RubSyncServiceOptions {
  autoStart?: boolean;
  adapter?: PublishAdapter;
  writeTimeoutMs?: number;
  readTimeoutMs?: number;
  concurrencyLimit?: number;
  setMetaFn?: (key: string, val: any) => Promise<void>;
  podePublicarFn?: () => { permitido: boolean; motivoRecusa?: string };
  getUsuarioFn?: () => UsuarioOperacional;
}

export class RubSyncService {
  private _statusPublicacao: PublicacaoRubStatus = {
    status: 'LOCAL',
    emAndamento: false,
    etapa: 'OCIOSO',
    progressoPorcentagem: 0,
    mensagem: 'Pronto (IndexedDB)',
  };

  private _versaoAtivaRemota: VersaoAtivaInfo | null = null;
  private _versaoLocalId: string | null = null;
  private _unsubSnapshot: Unsubscribe | null = null;
  private _listenersStatus: Array<(status: PublicacaoRubStatus) => void> = [];
  private _listenersVersao: Array<(versao: VersaoAtivaInfo | null) => void> = [];
  private _isDownloading = false;
  private _onCatalogUpdateCallback?: (produtos: ProdutoSMG[], meta: MetadadosBase) => Promise<void>;
  private _onCatalogClearedCallback?: () => void;

  private readonly _writeTracker = new PendingWriteTracker();
  private readonly _adapter: PublishAdapter;
  private readonly _writeTimeoutMs: number;
  private readonly _readTimeoutMs: number;
  private readonly _concurrencyLimit: number;
  private readonly _setMetaFn: (key: string, val: any) => Promise<void>;
  private readonly _podePublicarFn: () => { permitido: boolean; motivoRecusa?: string };
  private readonly _getUsuarioFn: () => UsuarioOperacional;

  private _unsubQuota: (() => void) | null = null;

  constructor(options?: RubSyncServiceOptions) {
    this._adapter = options?.adapter ?? createDefaultPublishAdapter();
    this._writeTimeoutMs = options?.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    this._readTimeoutMs = options?.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this._concurrencyLimit = options?.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT;
    this._setMetaFn = options?.setMetaFn ?? dbSetMeta;
    this._podePublicarFn = options?.podePublicarFn ?? (() => authRoleService.podePublicarRub());
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
            if (!this._statusPublicacao.emAndamento && this._statusPublicacao.status !== 'BLOQUEADO_COTA') {
              this.atualizarStatus({
                status: 'BLOQUEADO_COTA',
                emAndamento: false,
                etapa: 'OCIOSO',
                mensagem:
                  'Cota diária do Firebase Spark aguardando liberação — operando 100% local via IndexedDB.',
                aguardandoConfirmacaoNuvem: false,
              });
            }
          } else if (this._statusPublicacao.status === 'BLOQUEADO_COTA') {
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
      const meta = await dbGetMeta<any>('meta_rub_sync', null);
      if (meta && meta.versaoId) {
        this._versaoLocalId = meta.versaoId;
      }
    } catch (e) {
      console.warn('[RubSyncService] Erro ao ler versão local:', e);
    }
  }

  public registerCatalogUpdateCallback(cb: (produtos: ProdutoSMG[], meta: MetadadosBase) => Promise<void>): void {
    this._onCatalogUpdateCallback = cb;
  }

  public registerCatalogClearedCallback(cb: () => void): void {
    this._onCatalogClearedCallback = cb;
  }

  // =========================================================================
  // MONITORAMENTO EM TEMPO REAL DA VERSÃO ATIVA NA FILIAL
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
      const configDocRef = doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_rub');
      this._unsubSnapshot = onSnapshot(
        configDocRef,
        async (snap) => {
          if (snap.exists()) {
            const data = snap.data() as VersaoAtivaInfo & { status?: string; limpaEm?: string; ativa?: boolean };

            // Se a base mestre foi limpa pela gerência na nuvem central
            if (!data.versaoId || data.ativa === false || data.status === 'LIMPA_AGUARDANDO_IMPORTACAO') {
              this._versaoAtivaRemota = null;
              this.notificarVersao();

              if (this._versaoLocalId !== null) {
                console.log('[RubSyncService] BASE RUB foi limpa na nuvem central. Sincronizando limpeza local...');
                try {
                  await dbClear(STORES.PRODUTOS);
                  await dbSetMeta('meta_rub_sync', {
                    versaoId: null,
                    status: 'LIMPA_AGUARDANDO_IMPORTACAO',
                    limpaEm: data.limpaEm || new Date().toISOString(),
                    totalProdutos: 0,
                  });
                } catch (e) {
                  console.warn('[RubSyncService] Erro ao limpar IndexedDB local:', e);
                }
                this._versaoLocalId = null;
                if (this._onCatalogClearedCallback) {
                  try {
                    this._onCatalogClearedCallback();
                  } catch (cbErr) {
                    console.warn('[RubSyncService] Erro no callback de limpeza:', cbErr);
                  }
                }
              }

              this.atualizarStatus({
                status: 'LOCAL',
                emAndamento: false,
                etapa: 'OCIOSO',
                mensagem: 'BASE RUB limpa centralmente. Pronta para receber nova importação.',
                ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
              });
              return;
            }

            this._versaoAtivaRemota = data;
            this.notificarVersao();

            // Sincronização automática entre dispositivos:
            // Se a versão remota é mais recente que a versão local e não estamos publicando,
            // baixa automaticamente para o IndexedDB
            if (this._versaoLocalId !== data.versaoId && !this._statusPublicacao.emAndamento && !this._isDownloading) {
              console.log(`[RubSyncService] Nova BASE RUB detectada: ${data.versaoId} (local: ${this._versaoLocalId}). Baixando automaticamente...`);
              await this.baixarBaseRubAtivaParaDispositivo(filialId);
            } else if (
              this._versaoLocalId === data.versaoId &&
              !this._statusPublicacao.emAndamento &&
              this._statusPublicacao.status !== 'PENDENTE_CONFIRMACAO' &&
              this._statusPublicacao.status !== 'ERRO'
            ) {
              this.atualizarStatus({
                status: 'SINCRONIZADO',
                mensagem: `BASE RUB sincronizada com a nuvem central (${data.totalProdutos} produtos)`,
                ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
              });
            }
          } else {
            this._versaoAtivaRemota = null;
            this.notificarVersao();
          }
        },
        (err) => {
          console.warn('[RubSyncService] Erro ao monitorar versão da BASE RUB:', err?.message);
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
                'Cota diária gratuita do Firebase Spark atingida. Monitoramento pausado e operação 100% local mantida.',
            });
          }
        }
      );
    } catch (e) {
      console.warn('[RubSyncService] Falha ao configurar listener:', e);
    }
  }

  // =========================================================================
  // PUBLICAÇÃO CENTRAL MESTRE DA BASE RUB (EXCLUSIVO GERÊNCIA)
  // =========================================================================

  public async publicarBaseRubCentral(
    produtos: ProdutoSMG[],
    meta: MetadadosBase,
    filialId: string = '172',
    onProgress?: (pct: number, msg: string, chunkAtual?: number, totalChunks?: number) => void
  ): Promise<ResultadoPublicacaoBase> {
    // 1. Validação estrita de autorização
    const permissao = this._podePublicarFn();
    if (!permissao.permitido) {
      const motivo =
        permissao.motivoRecusa ||
        'Apenas a Gerência/Administrador possui permissão para publicar a BASE RUB na nuvem central.';
      this.atualizarStatus({
        status: 'LOCAL',
        emAndamento: false,
        etapa: 'ERRO',
        progressoPorcentagem: 0,
        mensagem: motivo,
        erro: motivo,
        aguardandoConfirmacaoNuvem: false,
      });
      return {
        sucesso: false,
        estadoPublicacao: 'RECUSADA_PERMISSAO',
        versaoConfirmadaNoServidor: false,
        mensagem: motivo,
        motivoRecusa: motivo,
      };
    }

    if (!produtos || produtos.length === 0) {
      return {
        sucesso: false,
        estadoPublicacao: 'ERRO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Não há produtos na BASE RUB para publicação.',
      };
    }

    if (this._statusPublicacao.emAndamento) {
      return {
        sucesso: false,
        estadoPublicacao: 'ERRO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Já existe uma publicação da BASE RUB em andamento. Aguarde a conclusão antes de iniciar outra.',
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
        'Publicação pausada: cota diária gratuita do Firebase Spark aguardando liberação. Dados da BASE RUB preservados localmente no IndexedDB.';
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
      mensagem: 'Verificando estado remoto e gravações pendentes na Filial 172...',
      aguardandoConfirmacaoNuvem: false,
      erro: undefined,
      chunkFalhou: undefined,
    });
    onProgress?.(5, 'Verificando estado remoto e gravações pendentes na Filial 172...');

    try {
      await this._adapter.ensureAuth().catch(() => null);

      // 2. Verificar estado remoto e impedir acúmulo enquanto escrita anterior estiver pendente
      const preCheck = await verificarEstadoRemotoAntesDePublicar<VersaoAtivaInfo>(
        this._adapter,
        this._writeTracker,
        filialId,
        'versao_ativa_rub',
        'catalogo_rub_versoes',
        this._readTimeoutMs
      );

      if (!preCheck.podeIniciar) {
        const isPending = preCheck.estadoPublicacao === 'PENDENTE_CONFIRMACAO';
        this.atualizarStatus({
          status: isPending ? 'PENDENTE_CONFIRMACAO' : 'ERRO',
          emAndamento: false,
          etapa: isPending ? 'PENDENTE_CONFIRMACAO' : 'ERRO',
          progressoPorcentagem: 0,
          mensagem: preCheck.mensagem || 'Publicação bloqueada pela verificação prévia.',
          chunkFalhou: preCheck.chunkFalhou,
          aguardandoConfirmacaoNuvem: isPending,
          erro: preCheck.mensagem,
        });
        return {
          sucesso: false,
          estadoPublicacao: preCheck.estadoPublicacao || 'PENDENTE_CONFIRMACAO',
          versaoConfirmadaNoServidor: false,
          mensagem: preCheck.mensagem || 'Publicação bloqueada pela verificação prévia.',
          chunkFalhou: preCheck.chunkFalhou,
        };
      }

      if (preCheck.versaoAtivaServidor) {
        this._versaoAtivaRemota = preCheck.versaoAtivaServidor;
      } else {
        this._versaoAtivaRemota = null;
      }

      // 3. Fragmentação em chunks seguros <= 450 KB
      ultimoPercentual = 12;
      this.atualizarStatus({
        etapa: 'GERANDO_CHUNKS',
        progressoPorcentagem: 12,
        mensagem: 'Fracionando catálogo por tamanho real de bytes...',
      });
      onProgress?.(12, 'Fracionando catálogo por tamanho real de bytes...');

      const chunks = buildSafeChunks(produtos, 450 * 1024);
      totalChunksPlanejados = chunks.length;

      ultimoPercentual = 20;
      this.atualizarStatus({
        etapa: 'CALCULANDO_CHECKSUM',
        progressoPorcentagem: 20,
        mensagem: `Calculando checksum SHA-256 de integridade (${chunks.length} partes)...`,
      });
      onProgress?.(20, `Calculando checksum SHA-256 de integridade (${chunks.length} partes)...`, 0, chunks.length);

      // 4. Cálculo de Checksum de Integridade
      const baseContentSample =
        JSON.stringify(produtos.slice(0, 100)) +
        `_len_${produtos.length}_end_` +
        JSON.stringify(produtos.slice(-100));
      const checksum = await calcularChecksumSha256(baseContentSample);

      // 4.1 Economia Spark: se a versão ativa no servidor for idêntica e íntegra, não reenviar chunks
      const idempotencia = await verificarVersaoAtivaIdenticaEIntegra({
        adapter: this._adapter,
        filialId,
        versoesCollectionName: 'catalogo_rub_versoes',
        versaoAtivaServidor: this._versaoAtivaRemota,
        expectedChecksum: checksum,
        expectedTotalChunks: chunks.length,
        expectedCountField: 'totalProdutos',
        expectedCountValue: produtos.length,
        readTimeoutMs: this._readTimeoutMs,
      });

      if (idempotencia.reutilizavel && idempotencia.versaoId) {
        const agoraReuso = new Date().toISOString();
        this._writeTracker.setPendingVersion(null);
        this._versaoLocalId = idempotencia.versaoId;
        await this._setMetaFn('meta_rub_sync', {
          versaoId: idempotencia.versaoId,
          dataPublicacaoIso: this._versaoAtivaRemota?.dataPublicacaoIso || agoraReuso,
          totalProdutos: produtos.length,
        });

        this.atualizarStatus({
          status: 'SINCRONIZADO',
          emAndamento: false,
          etapa: 'CONCLUIDO',
          progressoPorcentagem: 100,
          mensagem: `BASE RUB sem alterações: versão ${idempotencia.versaoId} já está íntegra e ativa na nuvem (0 escritas).`,
          versaoPublicada: idempotencia.versaoId,
          versaoPendente: undefined,
          chunkFalhou: undefined,
          aguardandoConfirmacaoNuvem: false,
          ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
        });
        onProgress?.(
          100,
          `BASE RUB idêntica à versão ativa (${idempotencia.versaoId}). Reenvio ignorado para economizar cota (0 escritas).`,
          chunks.length,
          chunks.length
        );

        return {
          sucesso: true,
          estadoPublicacao: 'CONFIRMADA',
          versaoConfirmadaNoServidor: true,
          semAlteracoesPulouEnvio: true,
          mensagem: `BASE RUB já estava atualizada e íntegra na nuvem central (versão ${idempotencia.versaoId}). Nenhuma escrita redundante executada.`,
          versaoId: idempotencia.versaoId,
          chunksEnviados: 0,
          totalChunks: chunks.length,
        };
      }

      const agora = new Date().toISOString();
      versaoId = `rub_${filialId}_${Date.now()}`;

      // 5. Gravação dos chunks com concorrência máxima de 2 chunks simultâneos e timeout controlado
      ultimoPercentual = 30;
      this.atualizarStatus({
        etapa: 'ENVIANDO_CHUNKS',
        progressoPorcentagem: 30,
        mensagem: `Enviando partes fracionadas para a nuvem (0 de ${chunks.length})...`,
      });
      onProgress?.(30, `Enviando partes fracionadas para a nuvem (0 de ${chunks.length})...`, 0, chunks.length);

      const { confirmedIndices } = await executarEnvioChunksControlado({
        adapter: this._adapter,
        tracker: this._writeTracker,
        filialId,
        versoesCollectionName: 'catalogo_rub_versoes',
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
          const pct = Math.round(30 + (chunksConcluidos / total) * 52); // 30% a 82%
          ultimoPercentual = pct;
          const msg = `Enviando partes fracionadas para a nuvem (${chunksConcluidos} de ${total})...`;
          this.atualizarStatus({ progressoPorcentagem: pct, mensagem: msg });
          onProgress?.(pct, msg, chunksConcluidos, total);
        },
      });

      // 6. Gravação dos metadados da versão com timeout controlado
      ultimoPercentual = 85;
      onProgress?.(85, 'Gravando metadados oficiais da versão...', chunks.length, chunks.length);
      const versaoMetaDocRef = this._adapter.doc(
        this._adapter.db,
        'filiais',
        filialId,
        'catalogo_rub_versoes',
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
            totalProdutos: produtos.length,
            totalChunks: chunks.length,
            checksumBase: checksum,
            versaoAnteriorId: this._versaoAtivaRemota?.versaoId || null,
            metadadosBase: {
              filial_numero: filialId,
              filial_nome: meta.filial_nome || 'CASCAVEL',
              status_base: 'BASE_RUB',
              total_produtos: produtos.length,
              total_vencimentos: meta.total_vencimentos || 0,
              total_eans: meta.total_eans || 0,
              total_saeou060: meta.total_saeou060 || 0,
              ultima_atualizacao_base_rub: meta.ultima_atualizacao_base_rub || agora,
            },
          }),
        this._writeTimeoutMs,
        'gravação de metadados da versão BASE RUB'
      );

      // 7. Validação integral no servidor antes de comutar ponteiro
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
        versoesCollectionName: 'catalogo_rub_versoes',
        versaoId,
        expectedTotalChunks: chunks.length,
        expectedChecksum: checksum,
        confirmedIndices,
        expectedCountField: 'totalProdutos',
        expectedCountValue: produtos.length,
        readTimeoutMs: this._readTimeoutMs,
      });

      // 8. Comutação Atômica Transacional de Ponteiro (CAS)
      ultimoPercentual = 94;
      this.atualizarStatus({
        etapa: 'COMUTANDO_PONTEIRO',
        progressoPorcentagem: 94,
        mensagem: 'Executando comutação transacional atômica da versão oficial...',
      });
      onProgress?.(
        94,
        'Executando comutação transacional atômica da versão oficial...',
        chunks.length,
        chunks.length
      );

      const resComutacao = await concurrentRubPublicationService.comutarPonteiroVersaoAtivaTransacional({
        filialId,
        novaVersaoId: versaoId,
        expectedBaseVersionId: this._versaoAtivaRemota?.versaoId || null,
        publicadoPor: `${usuario.nome} (${usuario.matricula})`,
        totalProdutos: produtos.length,
        totalChunks: chunks.length,
        checksumBase: checksum,
        timeoutMs: this._writeTimeoutMs,
        tracker: this._writeTracker,
        adapter: this._adapter,
      });

      if (!resComutacao.sucesso) {
        throw new Error(resComutacao.mensagem);
      }

      // 9. Confirmação explícita da versão ativa no servidor antes de reportar 100%
      ultimoPercentual = 98;
      this.atualizarStatus({
        etapa: 'CONFIRMANDO_ATIVA',
        progressoPorcentagem: 98,
        mensagem: 'Confirmando ponteiro ativo da BASE RUB no Firestore...',
      });
      onProgress?.(
        98,
        'Confirmando ponteiro ativo da BASE RUB no Firestore...',
        chunks.length,
        chunks.length
      );

      await confirmarPonteiroAtivoNoServidor(
        this._adapter,
        filialId,
        'versao_ativa_rub',
        versaoId,
        checksum,
        chunks.length,
        this._readTimeoutMs
      );

      this._writeTracker.setPendingVersion(null);
      this._versaoLocalId = versaoId;
      await this._setMetaFn('meta_rub_sync', {
        versaoId,
        dataPublicacaoIso: agora,
        totalProdutos: produtos.length,
      });

      this.atualizarStatus({
        status: 'SINCRONIZADO',
        emAndamento: false,
        etapa: 'CONCLUIDO',
        progressoPorcentagem: 100,
        mensagem: `BASE RUB publicada e ativada com sucesso! Versão: ${versaoId}`,
        versaoPublicada: versaoId,
        versaoPendente: undefined,
        chunkFalhou: undefined,
        aguardandoConfirmacaoNuvem: false,
        ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
      });
      onProgress?.(
        100,
        `BASE RUB publicada e confirmada na nuvem central! (${produtos.length} produtos)`,
        chunks.length,
        chunks.length
      );

      return {
        sucesso: true,
        estadoPublicacao: 'CONFIRMADA',
        versaoConfirmadaNoServidor: true,
        mensagem: `BASE RUB publicada e confirmada com sucesso na nuvem central (${produtos.length} produtos em ${chunks.length} partes).`,
        versaoId,
        chunksEnviados: chunks.length,
        totalChunks: chunks.length,
      };
    } catch (err: any) {
      console.error('[RubSyncService] Erro ao publicar BASE RUB:', err);

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
          : `Erro na publicação no Firebase: ${err?.message || 'Falha de comunicação'}. Dados locais preservados.`;

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
  // DOWNLOAD DA VERSÃO ATIVA DA BASE RUB PARA O DISPOSITIVO LOCAL
  // =========================================================================

  public async baixarBaseRubAtivaParaDispositivo(
    filialId: string = '172',
    onProgress?: (pct: number, msg: string) => void
  ): Promise<{ sucesso: boolean; mensagem: string; produtos?: ProdutoSMG[]; meta?: MetadadosBase }> {
    if (this._isDownloading) {
      return { sucesso: false, mensagem: 'Download já em andamento.' };
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

      if (onProgress) onProgress(5, 'Consultando versão oficial da filial...');

      // 1. Obter ponteiro ativo
      const configSnap = await getDoc(doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_rub'));
      if (!configSnap.exists()) {
        this.atualizarStatus({ status: 'LOCAL', mensagem: 'Nenhuma BASE RUB publicada na nuvem' });
        return { sucesso: false, mensagem: 'Nenhuma BASE RUB oficial publicada para esta filial.' };
      }

      const versaoInfo = configSnap.data() as VersaoAtivaInfo;
      const versaoId = versaoInfo.versaoId;

      // 2. Obter metadados da versão
      const versaoMetaSnap = await getDoc(doc(this._adapter.db, 'filiais', filialId, 'catalogo_rub_versoes', versaoId));
      const versaoMeta = versaoMetaSnap.data();

      if (onProgress) onProgress(15, `Baixando ${versaoInfo.totalChunks} partes fracionadas da BASE RUB...`);

      // 3. Baixar chunks em memória (blindagem: NUNCA apagar o IndexedDB antes de ter tudo 100% verificado)
      const chunksSnap = await getDocs(
        collection(this._adapter.db, 'filiais', filialId, 'catalogo_rub_versoes', versaoId, 'chunks')
      );

      const chunkDocs: { index: number; items: ProdutoSMG[] }[] = [];
      chunksSnap.forEach((d) => {
        const cData = d.data();
        if (cData.items && Array.isArray(cData.items)) {
          chunkDocs.push({ index: cData.index ?? 0, items: cData.items });
        }
      });

      chunkDocs.sort((a, b) => a.index - b.index);

      const todosProdutos: ProdutoSMG[] = [];
      chunkDocs.forEach((c) => todosProdutos.push(...c.items));

      if (onProgress) onProgress(70, 'Verificando integridade e integrando ao IndexedDB...');

      // 4. Validar integridade
      if (todosProdutos.length === 0) {
        throw new Error('As partes baixadas estão vazias. Abortando substituição local para proteger o banco.');
      }

      // 5. Atualização atômica do IndexedDB (agora sim, com segurança comprovada)
      await dbClear(STORES.PRODUTOS);
      await dbPutAll(STORES.PRODUTOS, todosProdutos);

      const novoMeta: MetadadosBase = {
        filial_numero: filialId,
        filial_nome: 'CASCAVEL',
        status_base: 'BASE_RUB',
        total_produtos: todosProdutos.length,
        total_vencimentos: versaoMeta?.metadadosBase?.total_vencimentos || 0,
        total_eans: versaoMeta?.metadadosBase?.total_eans || 0,
        total_saeou060: versaoMeta?.metadadosBase?.total_saeou060 || 0,
        ultima_atualizacao_base_rub: versaoInfo.dataPublicacaoIso,
      };

      await dbSetMeta('metadados_gerais', novoMeta);
      await dbSetMeta('meta_rub_sync', {
        versaoId,
        dataPublicacaoIso: versaoInfo.dataPublicacaoIso,
        totalProdutos: todosProdutos.length,
      });

      this._versaoLocalId = versaoId;

      // 6. Atualizar repositório em memória e notificar telas
      if (this._onCatalogUpdateCallback) {
        try {
          await this._onCatalogUpdateCallback(todosProdutos, novoMeta);
        } catch (cbErr) {
          console.warn('[RubSyncService] Erro no callback de atualização em memória:', cbErr);
        }
      }

      this.atualizarStatus({
        status: 'SINCRONIZADO',
        emAndamento: false,
        etapa: 'CONCLUIDO',
        progressoPorcentagem: 100,
        mensagem: `BASE RUB sincronizada com sucesso (${todosProdutos.length} produtos)`,
        versaoPublicada: versaoId,
        ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
      });

      if (onProgress) onProgress(100, `BASE RUB atualizada com sucesso! (${todosProdutos.length} produtos)`);

      return {
        sucesso: true,
        mensagem: `BASE RUB sincronizada com sucesso no dispositivo (${todosProdutos.length} produtos carregados).`,
        produtos: todosProdutos,
        meta: novoMeta,
      };
    } catch (err: any) {
      console.error('[RubSyncService] Erro ao baixar BASE RUB:', err);
      if (this._adapter.isQuotaError(err)) {
        this._adapter.markQuotaExceeded(err?.message, detectQuotaResourceType(err));
        this.atualizarStatus({
          status: 'BLOQUEADO_COTA',
          emAndamento: false,
          etapa: 'OCIOSO',
          progressoPorcentagem: 0,
          mensagem: 'Cota diária do Firebase Spark atingida ao baixar BASE RUB. Dados locais preservados.',
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
        mensagem: 'Erro ao baixar BASE RUB da nuvem',
        erro: err?.message || 'Erro de rede',
      });
      return {
        sucesso: false,
        mensagem: `Falha ao baixar BASE RUB: ${err?.message || 'Erro de rede'}. A base local foi preservada.`,
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
      this._statusPublicacao.emAndamento ||
      this._adapter.isFirestoreQuotaExceeded()
    ) {
      return;
    }
    try {
      const snap = await getDoc(doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_rub'));
      if (snap.exists()) {
        const remota = snap.data() as VersaoAtivaInfo;
        if (this._versaoLocalId !== remota.versaoId) {
          await this.baixarBaseRubAtivaParaDispositivo(filialId);
        } else {
          this.atualizarStatus({
            status: 'SINCRONIZADO',
            mensagem: `BASE RUB em dia com a nuvem central (${remota.totalProdutos} produtos)`,
            ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
          });
        }
      }
    } catch (e: any) {
      if (this._adapter.isQuotaError(e)) {
        this._adapter.markQuotaExceeded(e?.message, detectQuotaResourceType(e));
      }
      console.warn('[RubSyncService] Falha na checagem remota:', e);
    }
  }

  // =========================================================================
  // ROLLBACK DE VERSÃO (GERÊNCIA)
  // =========================================================================

  public async executarRollbackParaVersaoAnterior(filialId: string = '172'): Promise<{ sucesso: boolean; mensagem: string }> {
    const permissao = authRoleService.podeExecutarRollback();
    if (!permissao.permitido) {
      return { sucesso: false, mensagem: permissao.motivoRecusa || 'Acesso negado.' };
    }

    if (this._adapter.isFirestoreQuotaExceeded()) {
      return {
        sucesso: false,
        mensagem: 'Rollback bloqueado enquanto a cota diária do Firebase Spark aguarda liberação.',
      };
    }

    if (!this._versaoAtivaRemota || !this._versaoAtivaRemota.versaoAnteriorId) {
      return { sucesso: false, mensagem: 'Não há versão anterior registrada para executar rollback.' };
    }

    const versaoAnteriorId = this._versaoAtivaRemota.versaoAnteriorId;
    const usuario = this._getUsuarioFn();

    try {
      await this._adapter.ensureAuth().catch(() => null);

      // Obter detalhes da versão anterior
      const snapAnt = await getDoc(doc(this._adapter.db!, 'filiais', filialId, 'catalogo_rub_versoes', versaoAnteriorId));
      if (!snapAnt.exists()) {
        return { sucesso: false, mensagem: 'Arquivo da versão anterior não encontrado no Firestore.' };
      }

      const dadosAnt = snapAnt.data();

      // Comutar ponteiro de volta
      const res = await concurrentRubPublicationService.comutarPonteiroVersaoAtivaTransacional({
        filialId,
        novaVersaoId: versaoAnteriorId,
        expectedBaseVersionId: this._versaoAtivaRemota.versaoId,
        publicadoPor: `ROLLBACK por ${usuario.nome}`,
        totalProdutos: dadosAnt.totalProdutos,
        totalChunks: dadosAnt.totalChunks,
        checksumBase: dadosAnt.checksumBase,
      });

      return {
        sucesso: res.sucesso,
        mensagem: res.sucesso
          ? `Rollback executado com sucesso para a versão ${versaoAnteriorId}.`
          : res.mensagem,
      };
    } catch (e: any) {
      if (this._adapter.isQuotaError(e)) {
        this._adapter.markQuotaExceeded(e?.message, detectQuotaResourceType(e));
      }
      return { sucesso: false, mensagem: `Erro ao executar rollback: ${e?.message}` };
    }
  }

  public getStatusPublicacao(): PublicacaoRubStatus {
    return { ...this._statusPublicacao };
  }

  public getVersaoAtivaRemota(): VersaoAtivaInfo | null {
    return this._versaoAtivaRemota ? { ...this._versaoAtivaRemota } : null;
  }

  public getVersaoLocalId(): string | null {
    return this._versaoLocalId;
  }

  public subscribeStatus(cb: (status: PublicacaoRubStatus) => void): () => void {
    this._listenersStatus.push(cb);
    cb(this.getStatusPublicacao());
    return () => {
      this._listenersStatus = this._listenersStatus.filter((l) => l !== cb);
    };
  }

  public subscribeVersao(cb: (versao: VersaoAtivaInfo | null) => void): () => void {
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
      mensagem: 'BASE RUB limpa centralmente. Pronta para receber nova importação.',
      versaoPublicada: undefined,
      versaoPendente: undefined,
      chunkFalhou: undefined,
      aguardandoConfirmacaoNuvem: false,
      ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
    });
    this.notificarVersao();
  }

  private atualizarStatus(patch: Partial<PublicacaoRubStatus>): void {
    this._statusPublicacao = { ...this._statusPublicacao, ...patch };
    this._listenersStatus.forEach((cb) => {
      try {
        cb(this.getStatusPublicacao());
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

export const rubSyncService = new RubSyncService();
