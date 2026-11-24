/**
 * Cloud Synchronization Service (Firebase Firestore)
 * 
 * Enables multi-device, real-time collaboration across supermarket handhelds and computers.
 * - Synchronizes SMGOI013 product catalog across all devices using efficient chunking.
 * - Provides sub-second real-time sync of expiration lots (vencimentos) via onSnapshot.
 * - Automatically pulls updates when another phone or workstation imports a spreadsheet.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  LoteVencimento,
  MetadadosBase,
  ProdutoSMG,
  RegistroSaeou060,
  ResumoImportacao,
  VinculoEan,
} from '../types';
import {
  db,
  detectQuotaResourceType,
  ensureAuth,
  formatarErroSyncPorServico,
  isFirestoreQuotaExceeded,
  isQuotaError,
  logFirestoreRead,
  markQuotaExceeded,
  OperationType,
  subscribeQuotaStatus,
  SyncServiceErrorDetail,
} from './firebase';
import {
  buildVencimentoCentralPayload,
  getDeviceId,
  normalizeVencimentoRecord,
  sanitizeLoteForFirestore,
} from './deviceId';
import { authRoleService } from './authRoleService';
import { nuvemSyncEngine } from './nuvemSyncEngine';

export type SyncState = 'connecting' | 'connected' | 'syncing' | 'offline' | 'error';

export interface SyncStatusInfo {
  state: SyncState;
  lastSyncTime: string | null;
  message?: string;
  isOnline: boolean;
}

export type SyncListener = (info: SyncStatusInfo) => void;

/**
 * Strips or converts undefined values to null or valid JSON types
 * to ensure Firestore setDoc/updateDoc never fails on optional fields.
 */
export function cleanForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as unknown as T;
  }
  if (Array.isArray(data)) {
    return data.map((item) => cleanForFirestore(item)) as unknown as T;
  }
  if (typeof data === 'object') {
    const res: Record<string, any> = {};
    for (const [key, value] of Object.entries(data as Record<string, any>)) {
      if (value !== undefined) {
        res[key] = cleanForFirestore(value);
      } else {
        res[key] = null;
      }
    }
    return res as T;
  }
  return data;
}

class CloudSyncService {
  private _status: SyncStatusInfo = {
    state: 'connecting',
    lastSyncTime: null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  };

  private _listeners = new Set<SyncListener>();
  private _unsubscribers: Unsubscribe[] = [];
  private _isInitialized = false;
  private _isSyncing = false;

  // Track remote version to prevent redundant downloads
  private _localCatalogoVersion = 0;
  private _localVinculosVersion = 0;
  private _localSaeou060Version = 0;
  private _lastPullCheckMs = 0;
  private _usaVersionadoFilial172 = true;

  // External repository callback hooks (injected to avoid circular import issues)
  private _onRemoteCatalogoReceived?: (produtos: ProdutoSMG[], meta: MetadadosBase) => Promise<void>;
  private _onRemoteVinculosReceived?: (vinculos: VinculoEan[]) => Promise<void>;
  private _onRemoteSaeou060Received?: (registros: RegistroSaeou060[]) => Promise<void>;
  private _onRemoteVencimentosReceived?: (vencimentos: LoteVencimento[]) => void;
  private _onRemoteHistoricoReceived?: (historico: ResumoImportacao[]) => void;

  constructor() {
    subscribeQuotaStatus((qState) => {
      if (qState.bloqueado) {
        this.destroy();
        this.updateStatus({
          state: 'connected',
          message: 'Modo local offline ativo (Cota diária Spark protegida — IndexedDB seguro)',
        });
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.updateStatus({ isOnline: true, state: 'connected' });
        if (!isFirestoreQuotaExceeded()) {
          this.pullLatestIfOutdated();
        }
      });
      window.addEventListener('offline', () => {
        this.updateStatus({ isOnline: false, state: 'offline', message: 'Sem conexão com a internet' });
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && !isFirestoreQuotaExceeded()) {
            this.pullLatestIfOutdated();
          }
        });
      }
    }
  }

  public registerCallbacks(callbacks: {
    onRemoteCatalogoReceived: (produtos: ProdutoSMG[], meta: MetadadosBase) => Promise<void>;
    onRemoteVinculosReceived: (vinculos: VinculoEan[]) => Promise<void>;
    onRemoteSaeou060Received: (registros: RegistroSaeou060[]) => Promise<void>;
    onRemoteVencimentosReceived: (vencimentos: LoteVencimento[]) => void;
    onRemoteHistoricoReceived: (historico: ResumoImportacao[]) => void;
  }) {
    this._onRemoteCatalogoReceived = callbacks.onRemoteCatalogoReceived;
    this._onRemoteVinculosReceived = callbacks.onRemoteVinculosReceived;
    this._onRemoteSaeou060Received = callbacks.onRemoteSaeou060Received;
    this._onRemoteVencimentosReceived = callbacks.onRemoteVencimentosReceived;
    this._onRemoteHistoricoReceived = callbacks.onRemoteHistoricoReceived;
  }

  public subscribeStatus(listener: SyncListener): () => void {
    this._listeners.add(listener);
    listener(this._status);
    return () => {
      this._listeners.delete(listener);
    };
  }

  public getStatus(): SyncStatusInfo {
    return this._status;
  }

  private updateStatus(patch: Partial<SyncStatusInfo>) {
    this._status = { ...this._status, ...patch };
    this._listeners.forEach((l) => {
      try {
        l(this._status);
      } catch (e) {
        console.error('Error in sync listener:', e);
      }
    });
  }

  public setLocalVersions(versions: {
    catalogoVersion?: number;
    vinculosVersion?: number;
    saeou060Version?: number;
  }) {
    if (versions.catalogoVersion !== undefined) this._localCatalogoVersion = versions.catalogoVersion;
    if (versions.vinculosVersion !== undefined) this._localVinculosVersion = versions.vinculosVersion;
    if (versions.saeou060Version !== undefined) this._localSaeou060Version = versions.saeou060Version;
  }

  /**
   * Initializes real-time subscriptions to Firestore collections and documents.
   */
  public async init(): Promise<void> {
    if (this._isInitialized) return;

    if (isFirestoreQuotaExceeded()) {
      this._isInitialized = true;
      this.updateStatus({
        state: 'connected',
        message: 'Modo local offline ativo (Cota diária da nuvem protegida — base IndexedDB segura)',
        lastSyncTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    }

    try {
      this.updateStatus({ state: 'connecting', message: 'Conectando à Nuvem...' });
      await ensureAuth().catch(() => null);

      // Clean existing listeners if any
      this._unsubscribers.forEach((u) => {
        try { u(); } catch {}
      });
      this._unsubscribers = [];

      // 1. Listen to Metadata (Requisito 1: Apenas metadados leves; NÃO baixar catálogo integral automaticamente)
      const metaDocRef = doc(db, 'metadados', 'geral');
      const unsubMeta = onSnapshot(
        metaDocRef,
        (snapshot) => {
          if (!snapshot.exists()) return;
          const data = snapshot.data();
          if (data) {
            logFirestoreRead('escutarMetadados', 'metadados/geral', 1);
          }
        },
        (err) => {
          if (isQuotaError(err)) {
            markQuotaExceeded();
            this.destroy();
            this.updateStatus({
              state: 'connected',
              message: 'Modo local offline ativo (Cota da nuvem atingida — IndexedDB 100% seguro)',
            });
          } else {
            console.warn('[CloudSync] Metadata listener aviso:', err?.message);
          }
        }
      );
      this._unsubscribers.push(unsubMeta);

      // 2. Real-Time Vencimentos Listener (Requisitos 8 e 9: SOMENTE Filial 172)
      const vencimentosQuery = query(
        collection(db, 'vencimentos'),
        where('filialId', '==', '172')
      );

      const unsubVenc = onSnapshot(
        vencimentosQuery,
        (snapshot) => {
          logFirestoreRead('sincronizarVencimentos', 'vencimentos', snapshot.size);

          const lotes: LoteVencimento[] = [];
          snapshot.forEach((docSnap) => {
            const raw = docSnap.data();
            if (raw) {
              try {
                const norm = normalizeVencimentoRecord({
                  ...raw,
                  id: raw.vencimentoId || docSnap.id,
                  vencimentoId: raw.vencimentoId || docSnap.id,
                });
                if (!norm.filialId || norm.filialId === '172') {
                  lotes.push(norm);
                }
              } catch (errNorm) {
                console.warn('[CloudSync] Aviso ao normalizar vencimento remoto:', errNorm);
              }
            }
          });

          if (this._onRemoteVencimentosReceived) {
            this._onRemoteVencimentosReceived(lotes);
          }
          this.updateStatus({
            state: 'connected',
            lastSyncTime: new Date().toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            message: 'Nuvem Conectada',
          });
        },
        (err) => {
          if (isQuotaError(err)) {
            markQuotaExceeded();
            this.destroy();
            this.updateStatus({
              state: 'connected',
              message: 'Modo local offline ativo (Cota da nuvem atingida — IndexedDB 100% seguro)',
            });
          } else {
            console.warn('[CloudSync] Vencimentos listener error:', err?.message);
          }
        }
      );
      this._unsubscribers.push(unsubVenc);

      this._isInitialized = true;
      this.updateStatus({
        state: 'connected',
        message: 'Conectado à Nuvem',
        lastSyncTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (err: any) {
      if (isQuotaError(err)) {
        markQuotaExceeded();
        this.destroy();
        this._isInitialized = true;
        this.updateStatus({
          state: 'connected',
          message: 'Modo local offline ativo (Cota da nuvem atingida — IndexedDB 100% seguro)',
        });
        return;
      }
      console.warn('[CloudSync] Initialization warning:', err?.message);
      this._isInitialized = false;
      this.updateStatus({
        state: 'error',
        message: 'Erro ao conectar com a Nuvem',
      });
    }
  }

  /**
   * Checks if remote Firestore has data that local device doesn't have yet.
   * Arquitetura Híbrida V1.0: verifica apenas Vínculos EAN (BASE RUB e SAEOU060 são exclusivos locais via .zip).
   */
  public async pullLatestIfOutdated(): Promise<void> {
    if (isFirestoreQuotaExceeded()) return;
    const agora = Date.now();
    if (agora - this._lastPullCheckMs < 60_000) return;
    this._lastPullCheckMs = agora;

    try {
      await ensureAuth().catch(() => null);
      const metaDocRef = doc(db, 'metadados', 'geral');
      const metaSnap = await getDoc(metaDocRef);
      if (!metaSnap.exists()) return;

      const data = metaSnap.data();
      this._usaVersionadoFilial172 = (data.filial_numero || '172') === '172';

      if ((data.vinculos_version || 0) > this._localVinculosVersion && data.total_eans > 0) {
        await this.pullVinculosFromCloud(data.vinculos_version);
      }
    } catch (err: any) {
      if (isQuotaError(err)) {
        markQuotaExceeded(err?.message, detectQuotaResourceType(err));
        this.destroy();
        this.updateStatus({
          state: 'connected',
          message: 'Modo local offline ativo (Cota da nuvem atingida — IndexedDB 100% seguro)',
        });
        return;
      }
      const detail = formatarErroSyncPorServico(err, 'Vínculos EAN', 'metadados/geral', OperationType.GET);
      console.warn('[CloudSync] Pull check failed:', detail.mensagemUsuario);
    }
  }

  /**
   * Sincronização preservada da Arquitetura Híbrida V1.0:
   * - NÃO envia nem baixa BASE RUB ou SAEOU060 (exclusivos locais via .zip / IndexedDB)
   * - Sincroniza Vencimentos (fila transacional + pull paginado + lotes locais)
   * - Sincroniza Vínculos EAN (respeitando permissão GERENCIA_ADMIN para escrita em vinculos_chunks / metadados/geral)
   */
  public async syncFull(
    _localProdutos: ProdutoSMG[],
    _localMeta: MetadadosBase,
    localVinculos: VinculoEan[],
    _localSaeou: RegistroSaeou060[],
    localVencimentos: LoteVencimento[]
  ): Promise<{ success: boolean; message: string; detalhesErros?: SyncServiceErrorDetail[] }> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.updateStatus({ state: 'offline', message: 'Dispositivo sem internet' });
      return { success: false, message: 'Dispositivo sem conexão à internet.' };
    }

    if (isFirestoreQuotaExceeded()) {
      const msg = 'Modo local offline ativo. Cota da nuvem temporariamente indisponível. Operação normal mantida com segurança no IndexedDB.';
      this.updateStatus({ state: 'connected', message: msg });
      return { success: true, message: msg };
    }

    this.updateStatus({ state: 'syncing', message: 'Sincronizando Vencimentos e Vínculos EAN com a Nuvem...' });
    const detalhesErros: SyncServiceErrorDetail[] = [];

    try {
      await ensureAuth().catch(() => null);

      if (!this._isInitialized) {
        await this.init();
      }

      const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const isAdmin = authRoleService.isGerenciaAdminVerificadaNoServidor();
      this._usaVersionadoFilial172 = true;

      // 1. VENCIMENTOS: processar pendências da fila V3 + buscar atualizações paginadas
      try {
        const resFila = await nuvemSyncEngine.processarFila();
        if (resFila.erros > 0) {
          const opsErro = nuvemSyncEngine.getFila().filter((o) => o.status === 'ERRO' && o.erroMensagem);
          if (opsErro[0]?.erroMensagem) {
            detalhesErros.push({
              servico: 'Vencimentos (Fila)',
              colecao: 'vencimentos / filiais/172/vencimentos',
              operacao: OperationType.WRITE,
              codigoErro: 'sync-error',
              exigeGerenciaAdmin: opsErro[0].erroMensagem.includes('permission'),
              isCotaExcedida: false,
              mensagemOriginal: opsErro[0].erroMensagem,
              mensagemUsuario: opsErro[0].erroMensagem,
            });
          }
        }
      } catch (e: any) {
        detalhesErros.push(
          formatarErroSyncPorServico(e, 'Vencimentos (Fila)', 'vencimentos / filiais/172/vencimentos', OperationType.WRITE)
        );
      }

      try {
        const remoteLotes = await nuvemSyncEngine.carregarTodosVencimentosPaginados('172');
        logFirestoreRead('syncFullVencimentosPaginado', 'vencimentos', remoteLotes.length);
        if (remoteLotes.length > 0 && this._onRemoteVencimentosReceived) {
          this._onRemoteVencimentosReceived(remoteLotes);
        }
      } catch (e: any) {
        if (isQuotaError(e)) {
          markQuotaExceeded();
        } else {
          detalhesErros.push(
            formatarErroSyncPorServico(e, 'Vencimentos (Leitura)', 'vencimentos', OperationType.LIST)
          );
        }
      }

      if (localVencimentos.length > 0 && !isFirestoreQuotaExceeded()) {
        const resVenc = await this.sincronizarVencimentosExistentesDetailed(localVencimentos);
        if (resVenc.erroDetalhe) {
          detalhesErros.push(resVenc.erroDetalhe);
        }
      }

      // 2. VÍNCULOS EAN (metadados/geral e vinculos_chunks)
      if (!isFirestoreQuotaExceeded()) {
        try {
          const metaDocRef = doc(db, 'metadados', 'geral');
          const metaSnap = await getDoc(metaDocRef);
          logFirestoreRead('verificarMetadadosEan', 'metadados/geral', metaSnap.exists() ? 1 : 0);

          if (metaSnap.exists()) {
            const data = metaSnap.data();
            const remoteVincVersion = data.vinculos_version || 0;
            const localVincVersion = _localMeta?.vinculos_version || this._localVinculosVersion || 0;

            if (remoteVincVersion > localVincVersion || (localVinculos.length === 0 && (data.total_eans || 0) > 0)) {
              const pullRes = await this.pullVinculosFromCloudDetailed(remoteVincVersion);
              if (!pullRes.sucesso && pullRes.erroDetalhe) {
                detalhesErros.push(pullRes.erroDetalhe);
              }
            } else if (
              localVinculos.length > 0 &&
              isAdmin &&
              ((data.total_eans || 0) === 0 || localVincVersion > remoteVincVersion)
            ) {
              const pushRes = await this.pushVinculosToCloudDetailed(localVinculos);
              if (!pushRes.sucesso && pushRes.erroDetalhe) {
                detalhesErros.push(pushRes.erroDetalhe);
              }
            }
          } else if (localVinculos.length > 0 && isAdmin) {
            const pushRes = await this.pushVinculosToCloudDetailed(localVinculos);
            if (!pushRes.sucesso && pushRes.erroDetalhe) {
              detalhesErros.push(pushRes.erroDetalhe);
            }
          }
        } catch (errEan: any) {
          detalhesErros.push(
            formatarErroSyncPorServico(errEan, 'Vínculos EAN', 'metadados/geral', OperationType.GET)
          );
        }
      }

      const temErro = detalhesErros.length > 0;
      const msg = temErro
        ? detalhesErros.map((d) => d.mensagemUsuario).join(' | ')
        : `Vencimentos e Vínculos EAN sincronizados com sucesso! (BASE RUB e SAEOU060 mantidos localmente via .zip).`;

      this.updateStatus({
        state: temErro ? 'error' : 'connected',
        lastSyncTime: nowStr,
        message: temErro ? detalhesErros[0].mensagemUsuario : 'Nuvem Conectada e Sincronizada (Híbrida V1.0)',
      });

      return { success: !temErro, message: msg, detalhesErros };
    } catch (err: any) {
      if (isQuotaError(err)) {
        markQuotaExceeded();
        this.destroy();
        const quotaMsg = 'Modo local offline ativo: Cota diária da nuvem atingida. Todos os dados permanecem 100% seguros no IndexedDB.';
        this.updateStatus({
          state: 'connected',
          message: quotaMsg,
        });
        return { success: true, message: quotaMsg };
      }
      const detail = formatarErroSyncPorServico(err, 'CloudSyncService', 'vencimentos / metadados/geral', OperationType.WRITE);
      console.error('[CloudSync] Error in syncFull:', detail.mensagemUsuario);
      this.updateStatus({
        state: 'error',
        message: detail.mensagemUsuario,
      });
      return { success: false, message: detail.mensagemUsuario, detalhesErros: [detail] };
    }
  }

  // ==========================================
  // MÉTODOS LEGADOS BASE RUB / SAEOU060 PERMANENTEMENTE DESATIVADOS
  // (Arquitetura Híbrida V1.0: BASE RUB e SAEOU060 exclusivos locais via .zip)
  // ==========================================

  public async pullCatalogoFromCloud(_version?: number): Promise<boolean> {
    console.info('[CloudSync] pullCatalogoFromCloud desativado permanentemente pela Arquitetura Híbrida V1.0 (BASE RUB local via .zip).');
    return false;
  }

  public async pullVinculosFromCloudDetailed(version?: number): Promise<{
    sucesso: boolean;
    total: number;
    erroDetalhe?: SyncServiceErrorDetail;
  }> {
    if (isFirestoreQuotaExceeded()) {
      return { sucesso: false, total: 0 };
    }
    try {
      await ensureAuth();
      const chunksSnap = await getDocs(collection(db, 'vinculos_chunks'));
      const chunkDocs: { index: number; items: VinculoEan[] }[] = [];
      chunksSnap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.items && Array.isArray(d.items)) {
          chunkDocs.push({ index: d.index ?? 0, items: d.items });
        }
      });
      chunkDocs.sort((a, b) => a.index - b.index);

      const allVinculos: VinculoEan[] = [];
      chunkDocs.forEach((c) => allVinculos.push(...c.items));

      if (allVinculos.length > 0 && this._onRemoteVinculosReceived) {
        await this._onRemoteVinculosReceived(allVinculos);
        this._localVinculosVersion = version || Date.now();
      }
      return { sucesso: true, total: allVinculos.length };
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Vínculos EAN', 'vinculos_chunks', OperationType.LIST);
      console.warn('[CloudSync] Error pulling vinculos:', detail.mensagemUsuario);
      return { sucesso: false, total: 0, erroDetalhe: detail };
    }
  }

  public async pullVinculosFromCloud(version?: number): Promise<boolean> {
    const res = await this.pullVinculosFromCloudDetailed(version);
    return res.sucesso;
  }

  public async pullSaeou060FromCloud(_version?: number): Promise<boolean> {
    console.info('[CloudSync] pullSaeou060FromCloud desativado permanentemente pela Arquitetura Híbrida V1.0 (SAEOU060 local via .zip).');
    return false;
  }

  // ==========================================
  // PUSH METHODS (TRANSMITTING TO CLOUD)
  // ==========================================

  public async pushCatalogoToCloud(
    _produtos: ProdutoSMG[],
    _meta: MetadadosBase,
    _onProgress?: (pct: number, msg: string) => void
  ): Promise<boolean> {
    console.warn('[CloudSync] pushCatalogoToCloud bloqueado permanentemente pela Arquitetura Híbrida V1.0 (BASE RUB exclusiva local via .zip / IndexedDB).');
    return false;
  }

  public async pushVinculosToCloudDetailed(vinculos: VinculoEan[]): Promise<{
    sucesso: boolean;
    total: number;
    erroDetalhe?: SyncServiceErrorDetail;
  }> {
    if (isFirestoreQuotaExceeded()) {
      return { sucesso: false, total: 0 };
    }
    if (!authRoleService.isGerenciaAdminVerificadaNoServidor()) {
      const msg =
        '[Vínculos EAN • Coleção: vinculos_chunks / metadados/geral] Escrita na nuvem exige login Google verificado da Gerência (GERENCIA_ADMIN). Dados salvos localmente no IndexedDB.';
      return {
        sucesso: false,
        total: 0,
        erroDetalhe: {
          servico: 'Vínculos EAN',
          colecao: 'vinculos_chunks / metadados/geral',
          operacao: OperationType.WRITE,
          codigoErro: 'permission-denied',
          exigeGerenciaAdmin: true,
          isCotaExcedida: false,
          mensagemOriginal: 'GERENCIA_ADMIN não autenticado',
          mensagemUsuario: msg,
        },
      };
    }

    try {
      await ensureAuth();
      const CHUNK_SIZE = 500;
      const totalChunks = Math.max(1, Math.ceil(vinculos.length / CHUNK_SIZE));
      const newVersion = Date.now();

      for (let i = 0; i < totalChunks; i++) {
        const chunkItems = vinculos.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkDocRef = doc(db, 'vinculos_chunks', `chunk_${String(i).padStart(3, '0')}`);
        await setDoc(
          chunkDocRef,
          cleanForFirestore({
            index: i,
            total: totalChunks,
            items: chunkItems,
            updatedAt: new Date().toISOString(),
          })
        );
      }

      await setDoc(
        doc(db, 'metadados', 'geral'),
        cleanForFirestore({
          total_eans: vinculos.length,
          vinculos_version: newVersion,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true }
      );

      this._localVinculosVersion = newVersion;
      return { sucesso: true, total: vinculos.length };
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(
        err,
        'Vínculos EAN',
        'vinculos_chunks / metadados/geral',
        OperationType.WRITE
      );
      console.warn('[CloudSync] Error pushing vinculos:', detail.mensagemUsuario);
      return { sucesso: false, total: 0, erroDetalhe: detail };
    }
  }

  public async pushVinculosToCloud(vinculos: VinculoEan[]): Promise<boolean> {
    const res = await this.pushVinculosToCloudDetailed(vinculos);
    return res.sucesso;
  }

  public async pushSaeou060ToCloud(_registros: RegistroSaeou060[]): Promise<boolean> {
    console.warn('[CloudSync] pushSaeou060ToCloud bloqueado permanentemente pela Arquitetura Híbrida V1.0 (SAEOU060 exclusivo local via .zip / IndexedDB).');
    return false;
  }

  // ==========================================
  // REAL-TIME VENCIMENTOS (INDIVIDUAL DOCS)
  // ==========================================

  public async pullVencimentosFromCloud(): Promise<LoteVencimento[]> {
    if (!db) return [];
    if (isFirestoreQuotaExceeded()) {
      return [];
    }
    try {
      await ensureAuth().catch(() => null);
      const lotes = await nuvemSyncEngine.carregarTodosVencimentosPaginados('172');
      logFirestoreRead('pullVencimentosPaginado', 'vencimentos', lotes.length);

      if (this._onRemoteVencimentosReceived && lotes.length > 0) {
        this._onRemoteVencimentosReceived(lotes);
      }
      return lotes;
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Vencimentos', 'vencimentos', OperationType.LIST);
      console.warn('[CloudSync] Erro ao buscar vencimentos da nuvem:', detail.mensagemUsuario);
      if (detail.isCotaExcedida) {
        this.updateStatus({
          state: 'error',
          message: detail.mensagemUsuario,
        });
      }
      return [];
    }
  }

  public async pushLoteToCloud(lote: LoteVencimento): Promise<void> {
    if (isFirestoreQuotaExceeded()) return;
    const rawPayload = buildVencimentoCentralPayload(lote);
    const docId = rawPayload.vencimentoId || lote.id;
    const docPath = `vencimentos/${docId}`;
    try {
      await ensureAuth().catch(() => null);
      const loteDocRef = doc(db, 'vencimentos', docId);
      const snap = await getDoc(loteDocRef);
      const payload = sanitizeLoteForFirestore(rawPayload, {
        isUpdate: snap.exists(),
        remoteData: snap.exists() ? snap.data() : undefined,
      });
      await setDoc(loteDocRef, payload, { merge: true });
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Vencimentos', docPath, OperationType.WRITE);
      console.warn('[CloudSync] Error saving lote to cloud:', detail.mensagemUsuario);
    }
  }

  public async pushAllLotesToCloud(lotes: LoteVencimento[]): Promise<void> {
    if (isFirestoreQuotaExceeded()) return;
    try {
      await ensureAuth().catch(() => null);
      const batchSize = 300;
      for (let i = 0; i < lotes.length; i += batchSize) {
        const batch = writeBatch(db);
        const slice = lotes.slice(i, i + batchSize);
        slice.forEach((lote) => {
          if (lote.isDeleted) return;
          const rawPayload = buildVencimentoCentralPayload(lote);
          const isExistingSynced = Boolean((lote as any)._serverVersion);
          const payload = sanitizeLoteForFirestore(rawPayload, { isUpdate: isExistingSynced });
          const docRef = doc(db, 'vencimentos', rawPayload.vencimentoId || lote.id);
          batch.set(docRef, payload, { merge: true });
        });
        await batch.commit();
      }
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Vencimentos', 'vencimentos', OperationType.WRITE);
      console.warn('[CloudSync] Error batch saving lotes to cloud:', detail.mensagemUsuario);
    }
  }

  public async deleteLoteFromCloud(loteId: string, motivoExclusao = 'Exclusão lógica local'): Promise<void> {
    if (isFirestoreQuotaExceeded()) return;
    const docPath = `vencimentos/${loteId}`;
    try {
      await ensureAuth().catch(() => null);
      const loteDocRef = doc(db, 'vencimentos', loteId);
      const snap = await getDoc(loteDocRef);
      if (!snap.exists() && !authRoleService.isGerenciaAdminVerificadaNoServidor()) {
        return;
      }
      const agora = new Date().toISOString();
      const motivoSeguro =
        motivoExclusao && motivoExclusao.trim().length >= 3
          ? motivoExclusao.trim().slice(0, 200)
          : 'Exclusão lógica local';
      const payload = sanitizeLoteForFirestore(
        {
          vencimentoId: loteId,
          id: loteId,
          filialId: '172',
          isDeleted: true,
          deletedAt: agora,
          motivoExclusao: motivoSeguro,
          updatedAt: agora,
          deviceId: getDeviceId(),
        },
        {
          isUpdate: snap.exists(),
          remoteData: snap.exists() ? snap.data() : undefined,
        }
      );
      await setDoc(loteDocRef, payload, { merge: true });
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Vencimentos', docPath, OperationType.UPDATE);
      console.warn('[CloudSync] Error deleting lote from cloud:', detail.mensagemUsuario);
    }
  }

  public async sincronizarVencimentosExistentesDetailed(
    locais: LoteVencimento[]
  ): Promise<{ enviados: number; ignorados: number; erroDetalhe?: SyncServiceErrorDetail }> {
    if (!db) return { enviados: 0, ignorados: 0 };
    if (isFirestoreQuotaExceeded()) {
      return { enviados: 0, ignorados: 0 };
    }
    try {
      await ensureAuth().catch(() => null);
      let enviados = 0;
      let ignorados = 0;
      let batch = writeBatch(db);
      let countInBatch = 0;

      for (const lote of locais) {
        if (lote.isDeleted) {
          ignorados++;
          continue;
        }

        const rawPayload = buildVencimentoCentralPayload(lote);
        const isExistingSynced = Boolean((lote as any)._serverVersion);
        const payload = sanitizeLoteForFirestore(rawPayload, { isUpdate: isExistingSynced });
        const docRef = doc(db, 'vencimentos', rawPayload.vencimentoId || lote.id);
        batch.set(docRef, payload, { merge: true });
        enviados++;
        countInBatch++;

        if (countInBatch >= 300) {
          await batch.commit();
          batch = writeBatch(db);
          countInBatch = 0;
        }
      }

      if (countInBatch > 0) {
        await batch.commit();
      }

      return { enviados, ignorados };
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Vencimentos', 'vencimentos', OperationType.WRITE);
      console.warn('[CloudSync] Erro na sincronização de vencimentos existentes:', detail.mensagemUsuario);
      return { enviados: 0, ignorados: 0, erroDetalhe: detail };
    }
  }

  public async sincronizarVencimentosExistentes(
    locais: LoteVencimento[]
  ): Promise<{ enviados: number; ignorados: number }> {
    const res = await this.sincronizarVencimentosExistentesDetailed(locais);
    return { enviados: res.enviados, ignorados: res.ignorados };
  }

  public async pushHistoricoToCloud(hist: ResumoImportacao): Promise<void> {
    if (isFirestoreQuotaExceeded()) return;
    // Regra de segurança exige GERENCIA_ADMIN para /historico_importacoes
    if (!authRoleService.isGerenciaAdminVerificadaNoServidor()) return;
    try {
      await ensureAuth();
      const histDocRef = doc(db, 'historico_importacoes', hist.id || `hist-${Date.now()}`);
      await setDoc(histDocRef, cleanForFirestore(hist));
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Histórico Importações', 'historico_importacoes', OperationType.WRITE);
      console.warn('[CloudSync] Error saving historico to cloud:', detail.mensagemUsuario);
    }
  }

  public destroy(): void {
    this._unsubscribers.forEach((u) => u());
    this._unsubscribers = [];
  }
}

export const cloudSyncService = new CloudSyncService();
