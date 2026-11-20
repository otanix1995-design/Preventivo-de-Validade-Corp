/**
 * ARQUITETURA HÍBRIDA V1.0 — ETAPA 2: SINCRONIZAÇÃO CENTRAL DO SPCOI007 (FILIAL 172 — CASCAVEL)
 *
 * Atende integralmente aos requisitos Spark gratuito + integridade ponta a ponta:
 * 1. Compactação tabular + fflate (zlib) + Firestore Bytes (reduz ~46 mil registros em ~10-15x).
 * 2. Divisão automática em chunks binários dentro do limite seguro do Firestore (< 400 KB).
 * 3. Controle de versão (/filiais/172/config/versao_ativa_spcoi) e checksum SHA-256 integral.
 * 4. Publicação exclusiva por GERENCIA_ADMIN autenticada e verificada no servidor.
 * 5. Download automático nos dispositivos SOMENTE quando houver nova versão remota.
 * 6. Armazenamento persistente no IndexedDB com operação 100% offline.
 * 7. Substituição atômica com validação integral prévia e rollback automático em caso de falha.
 * 8. Preservação integral das configurações das indústrias e de todos os vínculos comerciais.
 * 9. Proteção contra publicações incompletas, fila presa no SDK e estouro da cota Spark.
 */

import {
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import {
  detectQuotaResourceType,
  handleFirestoreError,
  OperationType,
} from './firebase';
import { authRoleService, UsuarioOperacional } from './authRoleService';
import { AtomicBatchOp, dbGetMeta, dbRunAtomicBatch, dbSetMeta, STORES } from './db';
import { FornecedorSPCOI007, Industria, ResumoImportacaoSPCOI007 } from '../types';
import { isvService } from './isvService';
import { sha256HexBytes } from './localPackageMode';
import {
  buildSafeCompressedSpcoiChunks,
  calcularChecksumIntegralSpcoi,
  decompressTabularFromBytes,
  DEFAULT_SPCOI_MAX_CHUNK_BYTES,
  encodeIndustriasToCompressedBytes,
  extractUint8ArrayFromFirestoreValue,
  SPCOI_TABULAR_FORMAT_V1,
  SpcoiCompressedChunk,
  uint8ArrayToFirestoreBytes,
} from './spcoiCompactCodec';
import {
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
  readDocFromServerWithTimeout,
  ResultadoPublicacaoBase,
  runReadWithTimeout,
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
  formato?: string;
  versaoAnteriorId?: string | null;
}

export interface DownloadSpcoiResultado {
  sucesso: boolean;
  mensagem: string;
  totalFornecedores?: number;
  totalIndustrias?: number;
  versaoId?: string;
  jaAtualizado?: boolean;
  rollbackExecutado?: boolean;
}

export interface SpcoiSyncServiceOptions {
  autoStart?: boolean;
  adapter?: PublishAdapter;
  writeTimeoutMs?: number;
  readTimeoutMs?: number;
  concurrencyLimit?: number;
  maxChunkBytes?: number;
  setMetaFn?: (key: string, val: any) => Promise<void>;
  getMetaFn?: <T>(key: string, fallback: T) => Promise<T>;
  podePublicarFn?: () => { permitido: boolean; motivoRecusa?: string };
  getUsuarioFn?: () => UsuarioOperacional;
  salvarImportacaoSpcoiFn?: (
    fornecedores: FornecedorSPCOI007[],
    industrias: Industria[],
    resumo: ResumoImportacaoSPCOI007,
    opcoes?: {
      metaSpcoiSync?: Record<string, any>;
      persistirAtomicamente?: (ops: AtomicBatchOp[]) => Promise<void>;
    }
  ) => Promise<void>;
  getLocalFornecedoresCountFn?: () => number;
}

function logAndCaptureFirestoreDiagnostic(
  err: unknown,
  opType: OperationType,
  path: string | null
): void {
  const code = String((err as any)?.code || '').toLowerCase();
  const msg = String((err as any)?.message || '').toLowerCase();
  if (
    code.includes('permission') ||
    msg.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions')
  ) {
    try {
      handleFirestoreError(err, opType, path);
    } catch {
      // handleFirestoreError já emitiu o log JSON estruturado
    }
  }
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
  private _versaoLocalChecksum: string | null = null;
  private _localMetaLoaded = false;
  private _localMetaPromise: Promise<void> | null = null;
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
  private readonly _maxChunkBytes: number;
  private readonly _hasCustomSetMeta: boolean;
  private readonly _setMetaFn: (key: string, val: any) => Promise<void>;
  private readonly _getMetaFn: <T>(key: string, fallback: T) => Promise<T>;
  private readonly _podePublicarFn: () => { permitido: boolean; motivoRecusa?: string };
  private readonly _getUsuarioFn: () => UsuarioOperacional;
  private readonly _salvarImportacaoSpcoiFn: (
    fornecedores: FornecedorSPCOI007[],
    industrias: Industria[],
    resumo: ResumoImportacaoSPCOI007,
    opcoes?: {
      metaSpcoiSync?: Record<string, any>;
      persistirAtomicamente?: (ops: AtomicBatchOp[]) => Promise<void>;
    }
  ) => Promise<void>;
  private readonly _getLocalFornecedoresCountFn: () => number;

  private _unsubQuota: (() => void) | null = null;

  constructor(options?: SpcoiSyncServiceOptions) {
    this._adapter = options?.adapter ?? createDefaultPublishAdapter();
    this._writeTimeoutMs = options?.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    this._readTimeoutMs = options?.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this._concurrencyLimit = options?.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT;
    this._maxChunkBytes = options?.maxChunkBytes ?? DEFAULT_SPCOI_MAX_CHUNK_BYTES;
    this._hasCustomSetMeta = Boolean(options?.setMetaFn);
    this._setMetaFn = options?.setMetaFn ?? dbSetMeta;
    this._getMetaFn = options?.getMetaFn ?? dbGetMeta;
    this._getUsuarioFn = options?.getUsuarioFn ?? (() => authRoleService.getUsuarioAtual());
    this._salvarImportacaoSpcoiFn =
      options?.salvarImportacaoSpcoiFn ??
      ((f, i, r, op) => isvService.salvarImportacaoSpcoi(f, i, r, op));
    this._getLocalFornecedoresCountFn =
      options?.getLocalFornecedoresCountFn ?? (() => isvService.getFornecedores().length);

    this._podePublicarFn =
      options?.podePublicarFn ??
      (options?.getUsuarioFn
        ? () => {
            const u = this._getUsuarioFn();
            if (u.papel !== 'GERENCIA_ADMIN') {
              return {
                permitido: false,
                motivoRecusa:
                  'Apenas a Gerência/Administrador possui permissão para publicar o SPCOI007 na nuvem central.',
              };
            }
            return { permitido: true };
          }
        : () => authRoleService.podePublicarRub());

    if (options?.autoStart !== false) {
      // Aguarda leitura inicial do IndexedDB antes de ativar o listener remoto para evitar downloads duplicados no boot
      void this._bootstrapAutoStart();
    }
  }

  private async _bootstrapAutoStart(): Promise<void> {
    await this._ensureLocalVersionLoaded();
    this.iniciarMonitoramentoVersaoAtiva('172');

    if (this._adapter.subscribeQuotaStatus) {
      this._unsubQuota = this._adapter.subscribeQuotaStatus((qState) => {
        if (qState.bloqueado) {
          this.stopMonitoring();
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
            mensagem: 'Cota liberada — pronto para sincronização do SPCOI007',
          });
          this.iniciarMonitoramentoVersaoAtiva('172');
        }
      });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        if (!this._adapter.isFirestoreQuotaExceeded()) {
          void this.verificarSincronizacaoComRemoto('172');
        }
      });
    }
  }

  public getWriteTracker(): PendingWriteTracker {
    return this._writeTracker;
  }

  public stopMonitoring(): void {
    if (this._unsubSnapshot) {
      this._unsubSnapshot();
      this._unsubSnapshot = null;
    }
  }

  private async _ensureLocalVersionLoaded(): Promise<void> {
    if (this._localMetaLoaded) return;
    if (this._localMetaPromise) return this._localMetaPromise;

    this._localMetaPromise = (async () => {
      try {
        const meta = await this._getMetaFn<any>('meta_spcoi_sync', null);
        if (meta && meta.versaoId) {
          this._versaoLocalId = meta.versaoId;
          this._versaoLocalChecksum = meta.checksumBase || null;
        }
      } catch (e) {
        console.warn('[SpcoiSyncService] Erro ao ler metadados locais:', e);
      } finally {
        this._localMetaLoaded = true;
      }
    })();

    return this._localMetaPromise;
  }

  public registerSpcoiClearedCallback(cb: () => void): void {
    this._onSpcoiClearedCallback = cb;
  }

  // =========================================================================
  // MONITORAMENTO EM TEMPO REAL DA VERSÃO ATIVA DO SPCOI007 NO FIRESTORE
  // =========================================================================

  public iniciarMonitoramentoVersaoAtiva(filialId: string = '172'): void {
    this.stopMonitoring();

    if (this._adapter.isFirestoreQuotaExceeded()) {
      this.atualizarStatus({
        status: 'BLOQUEADO_COTA',
        emAndamento: false,
        etapa: 'OCIOSO',
        mensagem:
          'Cota diária do Firebase Spark aguardando liberação — operando offline com SPCOI007 local (IndexedDB).',
      });
      return;
    }

    if (!this._adapter.db) return;

    try {
      const configDocRef = this._adapter.doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_spcoi');
      this._unsubSnapshot = onSnapshot(
        configDocRef,
        async (snap) => {
          await this._ensureLocalVersionLoaded();
          await this.processarPonteiroRemotoSnapshot(
            filialId,
            snap.exists() ? (snap.data() as any) : null
          );
        },
        (err) => {
          console.warn('[SpcoiSyncService] Erro ao monitorar versão SPCOI007:', err?.message);
          if (this._adapter.isQuotaError(err)) {
            this._adapter.markQuotaExceeded(err?.message, detectQuotaResourceType(err));
            this.stopMonitoring();
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

  /**
   * Processa uma leitura/snapshot do ponteiro ativo de SPCOI007.
   * Dispara download SOMENTE quando houver versão remota nova ou divergente da local.
   */
  public async processarPonteiroRemotoSnapshot(
    filialId: string,
    data: (VersaoAtivaSpcoiInfo & { status?: string; limpaEm?: string; ativa?: boolean }) | null
  ): Promise<{ acao: 'NENHUMA' | 'LIMPOU' | 'BAIXOU' | 'SINCRONIZADO' }> {
    await this._ensureLocalVersionLoaded();

    if (!data) {
      this._versaoAtivaRemota = null;
      this.notificarVersao();
      return { acao: 'NENHUMA' };
    }

    // Se a base SPCOI007 foi explicitamente limpa pela gerência na nuvem central
    if (!data.versaoId || data.ativa === false || data.status === 'LIMPA_AGUARDANDO_IMPORTACAO') {
      this._versaoAtivaRemota = null;
      this.notificarVersao();

      if (this._versaoLocalId !== null) {
        console.log('[SpcoiSyncService] Base SPCOI007 limpa na nuvem central. Limpando apenas stores SPCOI007...');
        try {
          // Blindagem Etapa 1 + Etapa 2: Limpar APENAS stores da SPCOI007 e Indústrias.
          // JAMAIS limpar BASE RUB, SAEOU060, promotores, agências, vínculos comerciais, vínculos EAN ou vencimentos.
          const metaLimpa = {
            versaoId: null,
            checksumBase: null,
            status: 'LIMPA_AGUARDANDO_IMPORTACAO',
            limpaEm: data.limpaEm || new Date().toISOString(),
            totalFornecedores: 0,
            totalIndustrias: 0,
          };
          await dbRunAtomicBatch([
            { storeName: STORES.SPCOI007_FORNECEDORES, type: 'putAll', items: [], clearFirst: true },
            { storeName: STORES.INDUSTRIAS, type: 'putAll', items: [], clearFirst: true },
            { storeName: STORES.HISTORICO_IMPORTACOES_SPCOI007, type: 'putAll', items: [], clearFirst: true },
            { storeName: STORES.METADADOS, type: 'setMeta', key: 'meta_spcoi_sync', value: metaLimpa },
          ]);
          if (this._hasCustomSetMeta) {
            await this._setMetaFn('meta_spcoi_sync', metaLimpa);
          }
        } catch (e) {
          console.warn('[SpcoiSyncService] Erro ao limpar stores locais do SPCOI007:', e);
        }

        this._versaoLocalId = null;
        this._versaoLocalChecksum = null;

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
      return { acao: 'LIMPOU' };
    }

    this._versaoAtivaRemota = data;
    this.notificarVersao();

    const precisaAtualizar = this.precisaBaixarVersaoRemota(data);

    if (precisaAtualizar && !this._status.emAndamento && !this._isDownloading) {
      console.log(
        `[SpcoiSyncService] Nova versão remota detectada: ${data.versaoId} (local: ${this._versaoLocalId}). Baixando...`
      );
      await this.baixarSpcoiAtivoParaDispositivo(filialId);
      return { acao: 'BAIXOU' };
    }

    if (
      !precisaAtualizar &&
      !this._status.emAndamento &&
      this._status.status !== 'PENDENTE_CONFIRMACAO' &&
      this._status.status !== 'ERRO'
    ) {
      this.atualizarStatus({
        status: 'SINCRONIZADO',
        etapa: 'CONCLUIDO',
        progressoPorcentagem: 100,
        versaoPublicada: data.versaoId,
        mensagem: `SPCOI007 em dia com a nuvem central (${data.totalFornecedores} fornecedores)`,
        ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
      });
      return { acao: 'SINCRONIZADO' };
    }

    return { acao: 'NENHUMA' };
  }

  private precisaBaixarVersaoRemota(remota: VersaoAtivaSpcoiInfo): boolean {
    if (!remota?.versaoId) return false;
    if (this._versaoLocalId !== remota.versaoId) return true;
    if (
      remota.checksumBase &&
      this._versaoLocalChecksum &&
      this._versaoLocalChecksum !== remota.checksumBase
    ) {
      return true;
    }
    if (
      Number(remota.totalFornecedores || 0) > 0 &&
      isvService.isInitialized() &&
      this._getLocalFornecedoresCountFn() === 0
    ) {
      return true;
    }
    return false;
  }

  // =========================================================================
  // PUBLICAÇÃO CENTRAL MESTRE DO SPCOI007 (TABULAR + FFLATE + BYTES + SHA-256)
  // =========================================================================

  public async publicarSpcoiCentral(
    fornecedores: FornecedorSPCOI007[],
    industrias: Industria[],
    resumo?: ResumoImportacaoSPCOI007,
    filialId: string = '172',
    onProgress?: (pct: number, msg: string, chunkAtual?: number, totalChunks?: number) => void
  ): Promise<ResultadoPublicacaoBase> {
    const permissao = this._podePublicarFn();
    if (!permissao.permitido) {
      const motivo =
        permissao.motivoRecusa ||
        'Apenas a Gerência/Administrador autenticada (Filial 172) possui permissão para publicar o SPCOI007 na nuvem central.';
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

      // 1. Verificar estado remoto e bloquear caso gravação anterior ainda esteja pendente no SDK
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

      // 2. Compactação tabular + fflate (zlib) + divisão automática dentro do limite Firestore
      ultimoPercentual = 12;
      this.atualizarStatus({
        etapa: 'GERANDO_CHUNKS',
        progressoPorcentagem: 12,
        mensagem: 'Compactando SPCOI007 em blocos tabulares binários (fflate)...',
      });
      onProgress?.(12, 'Compactando SPCOI007 em blocos tabulares binários (fflate)...');

      const chunks: SpcoiCompressedChunk[] = await buildSafeCompressedSpcoiChunks(
        fornecedores,
        this._maxChunkBytes
      );
      const industriasEncoded = await encodeIndustriasToCompressedBytes(industrias || []);
      totalChunksPlanejados = chunks.length;

      ultimoPercentual = 22;
      this.atualizarStatus({
        etapa: 'CALCULANDO_CHECKSUM',
        progressoPorcentagem: 22,
        mensagem: `Calculando SHA-256 integral da base (${chunks.length} bloco(s) compactado(s))...`,
      });
      onProgress?.(
        22,
        `Calculando SHA-256 integral da base (${chunks.length} bloco(s) compactado(s))...`,
        0,
        chunks.length
      );

      // 3. Checksum SHA-256 INTEGRAL sobre 100% dos fornecedores e indústrias
      const checksum = await calcularChecksumIntegralSpcoi(fornecedores, industrias || []);

      // 3.1 Economia Spark: evitar reenvio se a versão ativa no servidor já for idêntica e íntegra
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
        this._versaoLocalChecksum = checksum;
        await this._setMetaFn('meta_spcoi_sync', {
          versaoId: idempotencia.versaoId,
          checksumBase: checksum,
          formato: SPCOI_TABULAR_FORMAT_V1,
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

      // 4. Enviar blocos compactados Bytes com concorrência máxima de 2 e timeout explícito
      ultimoPercentual = 35;
      this.atualizarStatus({
        etapa: 'ENVIANDO_CHUNKS',
        progressoPorcentagem: 35,
        mensagem: `Enviando blocos compactados para a nuvem (0 de ${chunks.length})...`,
      });
      onProgress?.(
        35,
        `Enviando blocos compactados para a nuvem (0 de ${chunks.length})...`,
        0,
        chunks.length
      );

      const { confirmedIndices } = await executarEnvioChunksControlado<SpcoiCompressedChunk>({
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
          itemsCount: chunkData.itemsCount,
          compressedBytesCount: chunkData.compressedBytes.byteLength,
          uncompressedBytesCount: chunkData.uncompressedBytes,
          checksumChunk: chunkData.chunkSha256,
          formato: SPCOI_TABULAR_FORMAT_V1,
          dadosBytes: uint8ArrayToFirestoreBytes(chunkData.compressedBytes),
          atualizadoEm: agora,
        }),
        onChunkBatchConfirmed: (chunksConcluidos, total) => {
          const pct = Math.round(35 + (chunksConcluidos / total) * 45);
          ultimoPercentual = pct;
          const msg = `Enviando blocos compactados para a nuvem (${chunksConcluidos} de ${total})...`;
          this.atualizarStatus({ progressoPorcentagem: pct, mensagem: msg });
          onProgress?.(pct, msg, chunksConcluidos, total);
        },
      });

      // 5. Salvar indústrias compactadas em Bytes e metadados da versão
      ultimoPercentual = 84;
      onProgress?.(
        84,
        'Salvando indústrias compactadas e metadados da versão...',
        chunks.length,
        chunks.length
      );
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
            formato: SPCOI_TABULAR_FORMAT_V1,
            versaoAnteriorId: this._versaoAtivaRemota?.versaoId || null,
            industriasFormato: SPCOI_TABULAR_FORMAT_V1,
            industriasChecksum: industriasEncoded.checksumSha256,
            industriasBytes: industriasEncoded.bytesField,
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
        mensagem: 'Validando integridade de blocos, indústrias e SHA-256 no servidor...',
      });
      onProgress?.(
        89,
        'Validando integridade de blocos, indústrias e SHA-256 no servidor...',
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

      // 7. Comutação Transacional Atômica do Ponteiro Oficial
      ultimoPercentual = 94;
      this.atualizarStatus({
        etapa: 'COMUTANDO_PONTEIRO',
        progressoPorcentagem: 94,
        mensagem: 'Ativando versão central do SPCOI007...',
      });
      onProgress?.(94, 'Ativando versão central do SPCOI007...', chunks.length, chunks.length);

      const configRef = this._adapter.doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_spcoi');
      const novoPonteiro: VersaoAtivaSpcoiInfo & { atualizadoEm: string } = {
        versaoId,
        filialId,
        dataPublicacaoIso: agora,
        publicadoPor: `${usuario.nome} (${usuario.matricula})`,
        totalFornecedores: fornecedores.length,
        totalIndustrias: industrias.length,
        totalChunks: chunks.length,
        checksumBase: checksum,
        formato: SPCOI_TABULAR_FORMAT_V1,
        versaoAnteriorId: null,
        atualizadoEm: agora,
      };

      await runTrackedWithTimeout(
        this._writeTracker,
        () =>
          this._adapter.runTransaction(this._adapter.db!, async (txn) => {
            const snap = await txn.get(configRef);
            const rawPrev = snap.exists() ? (snap.data() as any) : null;
            const versaoAnterior =
              rawPrev && rawPrev.versaoId && rawPrev.ativa !== false ? rawPrev.versaoId : null;
            txn.set(configRef, {
              ...novoPonteiro,
              versaoAnteriorId: versaoAnterior,
            });
            novoPonteiro.versaoAnteriorId = versaoAnterior;
          }),
        this._writeTimeoutMs,
        'ativação transacional do ponteiro SPCOI007'
      );

      // 8. Confirmação pós-transação no servidor antes de reportar 100%
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
      this._versaoLocalChecksum = checksum;
      this._versaoAtivaRemota = { ...novoPonteiro };
      this.notificarVersao();

      await this._setMetaFn('meta_spcoi_sync', {
        versaoId,
        checksumBase: checksum,
        formato: SPCOI_TABULAR_FORMAT_V1,
        dataPublicacaoIso: agora,
        totalFornecedores: fornecedores.length,
        totalIndustrias: industrias.length,
      });

      this.atualizarStatus({
        status: 'SINCRONIZADO',
        emAndamento: false,
        etapa: 'CONCLUIDO',
        progressoPorcentagem: 100,
        mensagem: `SPCOI007 publicado e sincronizado com sucesso! (${fornecedores.length} fornecedores, ${industrias.length} indústrias, ${chunks.length} bloco(s))`,
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
        mensagem: `SPCOI007 publicado e confirmado na nuvem central com sucesso (${fornecedores.length} fornecedores, ${chunks.length} parte(s) compactada(s)).`,
        versaoId,
        chunksEnviados: chunks.length,
        totalChunks: chunks.length,
      };
    } catch (err: any) {
      console.error('[SpcoiSyncService] Erro ao publicar SPCOI007:', err);
      logAndCaptureFirestoreDiagnostic(
        err,
        OperationType.WRITE,
        `filiais/${filialId}/spcoi_versoes/${versaoId || 'pendente'}`
      );

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

      const code = String(err?.code || '').toLowerCase();
      const rawMsg = String(err?.message || '').toLowerCase();
      if (
        code.includes('permission') ||
        rawMsg.includes('permission-denied') ||
        rawMsg.includes('missing or insufficient permissions')
      ) {
        const motivoPerm =
          'Permissão recusada pelas regras de segurança do Firestore: apenas GERENCIA_ADMIN autenticada pode publicar o SPCOI007.';
        this.atualizarStatus({
          status: 'ERRO',
          emAndamento: false,
          etapa: 'ERRO',
          progressoPorcentagem: Math.min(95, ultimoPercentual),
          mensagem: motivoPerm,
          aguardandoConfirmacaoNuvem: false,
          erro: err?.message || 'permission-denied',
        });
        return {
          sucesso: false,
          estadoPublicacao: 'RECUSADA_PERMISSAO',
          versaoConfirmadaNoServidor: false,
          mensagem: motivoPerm,
          motivoRecusa: motivoPerm,
          versaoId: versaoId || undefined,
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
  // DOWNLOAD, VALIDAÇÃO INTEGRAL E SUBSTITUIÇÃO ATÔMICA NO DISPOSITIVO
  // =========================================================================

  public async baixarSpcoiAtivoParaDispositivo(
    filialId: string = '172',
    onProgress?: (pct: number, msg: string) => void,
    opcoes?: { forcarDownload?: boolean }
  ): Promise<DownloadSpcoiResultado> {
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
      return { sucesso: false, mensagem: 'Firestore indisponível. Operando offline com dados do IndexedDB.' };
    }

    this._isDownloading = true;

    try {
      await this._ensureLocalVersionLoaded();
      await this._adapter.ensureAuth().catch(() => null);
      if (onProgress) onProgress(5, 'Consultando versão oficial do SPCOI007...');

      const configRef = this._adapter.doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_spcoi');
      const configSnap = await readDocFromServerWithTimeout(
        this._adapter,
        configRef,
        this._readTimeoutMs,
        'consulta da versão ativa SPCOI007'
      );

      if (!configSnap.exists()) {
        this.atualizarStatus({ status: 'LOCAL', mensagem: 'Nenhum SPCOI007 publicado na nuvem' });
        return { sucesso: false, mensagem: 'Nenhum SPCOI007 oficial publicado para esta filial.' };
      }

      const versaoInfo = configSnap.data() as VersaoAtivaSpcoiInfo & { ativa?: boolean; status?: string };
      if (!versaoInfo.versaoId || versaoInfo.ativa === false || versaoInfo.status === 'LIMPA_AGUARDANDO_IMPORTACAO') {
        this._versaoAtivaRemota = null;
        this.notificarVersao();
        return { sucesso: false, mensagem: 'Base SPCOI007 central está vazia aguardando importação.' };
      }

      this._versaoAtivaRemota = versaoInfo;
      this.notificarVersao();

      const versaoId = versaoInfo.versaoId;

      // Economia Spark: 0 leituras de chunks se o dispositivo já tiver exatamente a versão ativa e íntegra no IndexedDB
      if (!opcoes?.forcarDownload && !this.precisaBaixarVersaoRemota(versaoInfo)) {
        const totalLocal = this._getLocalFornecedoresCountFn();
        this.atualizarStatus({
          status: 'SINCRONIZADO',
          emAndamento: false,
          etapa: 'CONCLUIDO',
          progressoPorcentagem: 100,
          versaoPublicada: versaoId,
          mensagem: `SPCOI007 já atualizado localmente (${totalLocal || versaoInfo.totalFornecedores} fornecedores)`,
          ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
        });
        return {
          sucesso: true,
          jaAtualizado: true,
          versaoId,
          totalFornecedores: totalLocal || versaoInfo.totalFornecedores,
          totalIndustrias: versaoInfo.totalIndustrias,
          mensagem: `SPCOI007 já está na versão mais recente (${versaoId}). Download ignorado.`,
        };
      }

      if (onProgress) onProgress(15, `Baixando metadados da versão ${versaoId}...`);

      const versaoMetaRef = this._adapter.doc(
        this._adapter.db,
        'filiais',
        filialId,
        'spcoi_versoes',
        versaoId
      );
      const versaoMetaSnap = await readDocFromServerWithTimeout(
        this._adapter,
        versaoMetaRef,
        this._readTimeoutMs,
        'download dos metadados da versão SPCOI007'
      );

      if (!versaoMetaSnap.exists()) {
        throw new Error(`Metadados da versão ${versaoId} não encontrados no Firestore.`);
      }
      const versaoMetaData = versaoMetaSnap.data() || {};

      if (versaoMetaData.versaoId && versaoMetaData.versaoId !== versaoId) {
        throw new Error('Divergência de identificador de versão nos metadados do SPCOI007.');
      }

      // Decodificar indústrias (suporta Bytes fflate tabular V1 e fallback legado array)
      let industriasRemotas: Industria[] = [];
      if (versaoMetaData.industriasBytes) {
        const indU8 = extractUint8ArrayFromFirestoreValue(versaoMetaData.industriasBytes);
        if (!indU8) {
          throw new Error('Bloco compactado de indústrias inválido ou corrompido.');
        }
        if (versaoMetaData.industriasChecksum) {
          const chkInd = await sha256HexBytes(indU8);
          if (chkInd !== versaoMetaData.industriasChecksum) {
            throw new Error('Checksum do bloco de indústrias diverge do esperado.');
          }
        }
        industriasRemotas = decompressTabularFromBytes<Industria>(indU8, 'INDUSTRIAS');
      } else if (Array.isArray(versaoMetaData.industrias)) {
        industriasRemotas = versaoMetaData.industrias;
      }

      const expectedTotalChunks = Number(versaoInfo.totalChunks || versaoMetaData.totalChunks || 0);
      if (expectedTotalChunks <= 0) {
        throw new Error('Metadados da versão SPCOI007 indicam zero chunks disponíveis.');
      }

      if (onProgress) onProgress(25, `Baixando ${expectedTotalChunks} parte(s) do SPCOI007...`);

      const chunksColRef = this._adapter.collection(
        this._adapter.db,
        'filiais',
        filialId,
        'spcoi_versoes',
        versaoId,
        'chunks'
      );
      const chunksSnap = await runReadWithTimeout(
        () => this._adapter.getDocs(chunksColRef),
        this._readTimeoutMs,
        'download dos blocos SPCOI007'
      );

      const rawChunks: Array<{ index: number; data: any }> = [];
      chunksSnap.forEach((d: any) => {
        const cData = typeof d.data === 'function' ? d.data() : d;
        rawChunks.push({
          index: Number(cData?.index ?? -1),
          data: cData,
        });
      });

      // Validar completude integral dos índices 0..N-1 antes de descomprimir ou alterar o IndexedDB
      if (rawChunks.length !== expectedTotalChunks) {
        throw new Error(
          `Download incompleto do SPCOI007: recebidos ${rawChunks.length} de ${expectedTotalChunks} chunks esperados. Base local preservada.`
        );
      }

      rawChunks.sort((a, b) => a.index - b.index);
      for (let expectedIdx = 0; expectedIdx < expectedTotalChunks; expectedIdx++) {
        const chunkEntry = rawChunks[expectedIdx];
        if (!chunkEntry || chunkEntry.index !== expectedIdx) {
          throw new Error(
            `Chunk obrigatório #${expectedIdx} ausente ou duplicado na versão ${versaoId}. Base local preservada.`
          );
        }
        if (chunkEntry.data?.versaoId && chunkEntry.data.versaoId !== versaoId) {
          throw new Error(
            `Chunk #${expectedIdx} pertence a outra versão (${chunkEntry.data.versaoId}). Base local preservada.`
          );
        }
      }

      if (onProgress) onProgress(55, 'Descomprimindo e validando integridade SHA-256...');

      const todosFornecedores: FornecedorSPCOI007[] = [];
      let isFormatoCompactadoV1 =
        versaoInfo.formato === SPCOI_TABULAR_FORMAT_V1 ||
        versaoMetaData.formato === SPCOI_TABULAR_FORMAT_V1;

      for (const entry of rawChunks) {
        const cData = entry.data;
        if (cData?.dadosBytes !== undefined || cData?.formato === SPCOI_TABULAR_FORMAT_V1) {
          isFormatoCompactadoV1 = true;
          const u8 = extractUint8ArrayFromFirestoreValue(cData.dadosBytes);
          if (!u8 || u8.byteLength === 0) {
            throw new Error(`Dados binários ausentes no chunk #${entry.index}. Base local preservada.`);
          }
          if (cData.checksumChunk) {
            const actualChunkSha = await sha256HexBytes(u8);
            if (actualChunkSha !== cData.checksumChunk) {
              throw new Error(
                `Falha de integridade SHA-256 no bloco chunk_${entry.index}. Base local preservada.`
              );
            }
          }
          const decodedItems = decompressTabularFromBytes<FornecedorSPCOI007>(u8, 'FORNECEDORES');
          if (cData.itemsCount !== undefined && decodedItems.length !== Number(cData.itemsCount)) {
            throw new Error(
              `Contagem de itens divergente no bloco chunk_${entry.index} (obtido ${decodedItems.length}, esperado ${cData.itemsCount}).`
            );
          }
          for (let k = 0; k < decodedItems.length; k++) {
            todosFornecedores.push(decodedItems[k]);
          }
        } else if (Array.isArray(cData?.items)) {
          for (let k = 0; k < cData.items.length; k++) {
            todosFornecedores.push(cData.items[k]);
          }
        } else {
          throw new Error(`Formato de payload desconhecido no chunk #${entry.index}.`);
        }
      }

      if (todosFornecedores.length === 0) {
        throw new Error('As partes baixadas estão vazias. Abortando para proteger a base local.');
      }

      const expectedTotalFornecedores = Number(
        versaoInfo.totalFornecedores || versaoMetaData.totalFornecedores || 0
      );
      if (expectedTotalFornecedores > 0 && todosFornecedores.length !== expectedTotalFornecedores) {
        throw new Error(
          `Contagem total de fornecedores diverge da versão oficial (recebidos ${todosFornecedores.length}, esperado ${expectedTotalFornecedores}). Base local preservada.`
        );
      }

      const expectedChecksum = versaoInfo.checksumBase || versaoMetaData.checksumBase;
      if (isFormatoCompactadoV1 && expectedChecksum) {
        const checksumRecomputado = await calcularChecksumIntegralSpcoi(
          todosFornecedores,
          industriasRemotas
        );
        if (checksumRecomputado !== expectedChecksum) {
          throw new Error(
            `Checksum SHA-256 integral reprovado na validação do download (esperado ${expectedChecksum.slice(
              0,
              12
            )}..., obtido ${checksumRecomputado.slice(0, 12)}...). Substituição abortada.`
          );
        }
      }

      if (onProgress) onProgress(78, 'Executando substituição atômica no IndexedDB...');

      const metaSpcoiSync = {
        versaoId,
        checksumBase: expectedChecksum || null,
        formato: isFormatoCompactadoV1 ? SPCOI_TABULAR_FORMAT_V1 : 'JSON_LEGADO',
        dataPublicacaoIso: versaoInfo.dataPublicacaoIso,
        totalFornecedores: todosFornecedores.length,
        totalIndustrias: industriasRemotas.length,
        sincronizadoEmIso: new Date().toISOString(),
      };

      try {
        // Substituição ATÔMICA no isvService + IndexedDB (preservando configurações das indústrias e TODOS os vínculos comerciais)
        // Em caso de falha interna, isvService já executa rollback integral para o snapshot anterior!
        await this._salvarImportacaoSpcoiFn(
          todosFornecedores,
          industriasRemotas,
          versaoMetaData.resumo || {
            data_hora: versaoInfo.dataPublicacaoIso,
            arquivo: `NUVEM_SPCOI007_${versaoId}.xlsx`,
            total_lidos: todosFornecedores.length,
            total_validos: todosFornecedores.length,
            total_encontrados_smg: todosFornecedores.length,
            total_sem_correspondencia: 0,
            total_multiplos_cnpjs: 0,
            total_industrias: industriasRemotas.length,
            nome_arquivo: `NUVEM_SPCOI007_${versaoId}.xlsx`,
          },
          { metaSpcoiSync }
        );
      } catch (replaceErr: any) {
        throw Object.assign(
          new Error(
            `Falha durante substituição atômica do SPCOI007 (rollback executado): ${
              replaceErr?.message || 'Erro de gravação'
            }`
          ),
          { rollbackExecutado: true }
        );
      }

      if (this._hasCustomSetMeta) {
        await this._setMetaFn('meta_spcoi_sync', metaSpcoiSync);
      }

      this._versaoLocalId = versaoId;
      this._versaoLocalChecksum = expectedChecksum || null;

      this.atualizarStatus({
        status: 'SINCRONIZADO',
        emAndamento: false,
        etapa: 'CONCLUIDO',
        progressoPorcentagem: 100,
        mensagem: `SPCOI007 sincronizado com a nuvem (${todosFornecedores.length} fornecedores)`,
        versaoPublicada: versaoId,
        erro: undefined,
        ultimaSincronizacao: new Date().toLocaleTimeString('pt-BR'),
      });

      if (onProgress) {
        onProgress(100, `SPCOI007 atualizado com sucesso! (${todosFornecedores.length} registros)`);
      }

      return {
        sucesso: true,
        versaoId,
        mensagem: 'SPCOI007 atualizado com sucesso no dispositivo.',
        totalFornecedores: todosFornecedores.length,
        totalIndustrias: industriasRemotas.length,
        jaAtualizado: false,
      };
    } catch (err: any) {
      console.error('[SpcoiSyncService] Erro ao baixar SPCOI007:', err);
      logAndCaptureFirestoreDiagnostic(
        err,
        OperationType.GET,
        `filiais/${filialId}/spcoi_versoes`
      );

      if (!err?.rollbackExecutado && this._adapter.isQuotaError(err)) {
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
        mensagem: err?.message || 'Erro ao baixar SPCOI007 da nuvem',
        erro: err?.message || 'Erro de rede',
      });
      return {
        sucesso: false,
        rollbackExecutado: Boolean(err?.rollbackExecutado),
        mensagem: `Falha ao baixar SPCOI007: ${err?.message || 'Erro de rede'}. Dados locais preservados.`,
      };
    } finally {
      this._isDownloading = false;
    }
  }

  public async verificarSincronizacaoComRemoto(
    filialId: string = '172'
  ): Promise<{ verificado: boolean; baixouNovaVersao: boolean; versaoId?: string }> {
    await this._ensureLocalVersionLoaded();

    if (
      !this._adapter.db ||
      this._isDownloading ||
      this._status.emAndamento ||
      this._adapter.isFirestoreQuotaExceeded()
    ) {
      return { verificado: false, baixouNovaVersao: false };
    }

    try {
      const configRef = this._adapter.doc(this._adapter.db, 'filiais', filialId, 'config', 'versao_ativa_spcoi');
      const snap = await readDocFromServerWithTimeout(
        this._adapter,
        configRef,
        this._readTimeoutMs,
        'verificação de versão ativa do SPCOI007'
      );

      if (snap.exists()) {
        const remota = snap.data() as VersaoAtivaSpcoiInfo & { ativa?: boolean; status?: string };
        const res = await this.processarPonteiroRemotoSnapshot(filialId, remota);
        return {
          verificado: true,
          baixouNovaVersao: res.acao === 'BAIXOU',
          versaoId: remota.versaoId,
        };
      }

      return { verificado: true, baixouNovaVersao: false };
    } catch (e: any) {
      if (this._adapter.isQuotaError(e)) {
        this._adapter.markQuotaExceeded(e?.message, detectQuotaResourceType(e));
        this.atualizarStatus({
          status: 'BLOQUEADO_COTA',
          emAndamento: false,
          etapa: 'OCIOSO',
          mensagem: 'Cota diária do Firebase Spark atingida na checagem do SPCOI007. IndexedDB local mantido.',
        });
      }
      logAndCaptureFirestoreDiagnostic(
        e,
        OperationType.GET,
        `filiais/${filialId}/config/versao_ativa_spcoi`
      );
      console.warn('[SpcoiSyncService] Falha na checagem de sincronização:', e);
      return { verificado: false, baixouNovaVersao: false };
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

  public getVersaoLocalChecksum(): string | null {
    return this._versaoLocalChecksum;
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
    this._versaoLocalChecksum = null;
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
