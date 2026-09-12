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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
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
  ensureAuth,
  isFirestoreQuotaExceeded,
  isQuotaError,
  logFirestoreRead,
  markQuotaExceeded,
} from './firebase';
import {
  normalizeVencimentoRecord,
  buildVencimentoCentralPayload,
  getDeviceId,
  cleanForFirestore as cleanCentralForFirestore,
} from './deviceId';

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

  // External repository callback hooks (injected to avoid circular import issues)
  private _onRemoteCatalogoReceived?: (produtos: ProdutoSMG[], meta: MetadadosBase) => Promise<void>;
  private _onRemoteVinculosReceived?: (vinculos: VinculoEan[]) => Promise<void>;
  private _onRemoteSaeou060Received?: (registros: RegistroSaeou060[]) => Promise<void>;
  private _onRemoteVencimentosReceived?: (vencimentos: LoteVencimento[]) => void;
  private _onRemoteHistoricoReceived?: (historico: ResumoImportacao[]) => void;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.updateStatus({ isOnline: true, state: 'connected' });
        this.pullLatestIfOutdated();
      });
      window.addEventListener('offline', () => {
        this.updateStatus({ isOnline: false, state: 'offline', message: 'Sem conexão com a internet' });
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
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
      this.updateStatus({
        state: 'error',
        message: 'Cota temporariamente indisponível. Operação 100% local ativa.',
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
          console.warn('[CloudSync] Metadata listener aviso:', err?.message);
          if (isQuotaError(err)) {
            markQuotaExceeded();
            this.updateStatus({
              state: 'error',
              message: 'Cota temporariamente indisponível. O aplicativo continuará operando localmente e tentará sincronizar posteriormente.',
            });
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
          console.warn('[CloudSync] Vencimentos listener error:', err?.message);
          if (isQuotaError(err)) {
            markQuotaExceeded();
            this.updateStatus({
              state: 'error',
              message: 'Cota temporariamente indisponível. O aplicativo continuará operando localmente e tentará sincronizar posteriormente.',
            });
          }
        }
      );
      this._unsubscribers.push(unsubVenc);

      // Requisito 9: REMOVER listener contínuo em historico_importacoes para poupar cotas

      this._isInitialized = true;
      this.updateStatus({
        state: 'connected',
        message: 'Conectado à Nuvem',
        lastSyncTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (err: any) {
      console.warn('[CloudSync] Initialization warning:', err);
      if (isQuotaError(err)) {
        markQuotaExceeded();
      }
      this._isInitialized = false;
      this.updateStatus({
        state: 'error',
        message: isQuotaError(err)
          ? 'Cota temporariamente indisponível. O aplicativo continuará operando localmente e tentará sincronizar posteriormente.'
          : 'Erro ao conectar com a Nuvem',
      });
    }
  }

  /**
   * Checks if remote Firestore has data that local device doesn't have yet.
   */
  public async pullLatestIfOutdated(): Promise<void> {
    try {
      await ensureAuth().catch(() => null);
      const metaDocRef = doc(db, 'metadados', 'geral');
      const metaSnap = await getDoc(metaDocRef);
      if (!metaSnap.exists()) return;

      const data = metaSnap.data();
      if ((data.catalogo_version || 0) > this._localCatalogoVersion && data.total_produtos > 0) {
        await this.pullCatalogoFromCloud(data.catalogo_version);
      }
      if ((data.vinculos_version || 0) > this._localVinculosVersion && data.total_eans > 0) {
        await this.pullVinculosFromCloud(data.vinculos_version);
      }
      if ((data.saeou060_version || 0) > this._localSaeou060Version && data.total_saeou060 > 0) {
        await this.pullSaeou060FromCloud(data.saeou060_version);
      }
    } catch (err) {
      console.warn('[CloudSync] Pull check failed:', err);
    }
  }

  /**
   * Comprehensive two-way sync for manual button press:
   * - Connects to cloud
   * - Pulls if cloud is newer or local is empty
   * - Pushes local if cloud is empty or local has newer data
   * - Syncs expiration lots
   */
  public async syncFull(
    localProdutos: ProdutoSMG[],
    localMeta: MetadadosBase,
    localVinculos: VinculoEan[],
    localSaeou: RegistroSaeou060[],
    localVencimentos: LoteVencimento[]
  ): Promise<{ success: boolean; message: string }> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.updateStatus({ state: 'offline', message: 'Dispositivo sem internet' });
      return { success: false, message: 'Dispositivo sem conexão à internet.' };
    }

    // Requisito 17 e 23: Se a cota estiver excedida, não tentar enviar/baixar a base
    if (isFirestoreQuotaExceeded()) {
      const msg = 'Cota temporariamente indisponível. O aplicativo continuará operando localmente e tentará sincronizar posteriormente.';
      this.updateStatus({ state: 'error', message: msg });
      return { success: false, message: msg };
    }

    this.updateStatus({ state: 'syncing', message: 'Sincronizando com a Nuvem...' });

    try {
      await ensureAuth().catch(() => null);

      if (!this._isInitialized) {
        await this.init();
      }

      const metaDocRef = doc(db, 'metadados', 'geral');
      const metaSnap = await getDoc(metaDocRef);
      logFirestoreRead('verificarMetadados', 'metadados/geral', metaSnap.exists() ? 1 : 0);
      const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      if (!metaSnap.exists()) {
        // Cloud has no documents yet
        if (localProdutos.length > 0) {
          await this.pushCatalogoToCloud(localProdutos, localMeta);
          if (localVinculos.length > 0) await this.pushVinculosToCloud(localVinculos);
          if (localSaeou.length > 0) await this.pushSaeou060ToCloud(localSaeou);
          if (localVencimentos.length > 0) await this.pushAllLotesToCloud(localVencimentos);

          this.updateStatus({
            state: 'connected',
            lastSyncTime: nowStr,
            message: `Base local enviada para a nuvem (${localProdutos.length} produtos)`,
          });
          return {
            success: true,
            message: `Nuvem conectada! ${localProdutos.length} produtos enviados para compartilhamento.`,
          };
        } else {
          // Initialize empty metadata document in cloud
          await setDoc(metaDocRef, {
            filial_numero: localMeta.filial_numero || '172',
            filial_nome: localMeta.filial_nome || 'CASCAVEL',
            status_base: 'VAZIA',
            total_produtos: 0,
            catalogo_version: 0,
            updatedAt: new Date().toISOString(),
          }, { merge: true });

          this.updateStatus({
            state: 'connected',
            lastSyncTime: nowStr,
            message: 'Conectado à Nuvem (pronto para importação)',
          });
          return { success: true, message: 'Conectado à nuvem com sucesso! Pronto para sincronizar.' };
        }
      }

      // Cloud metadata exists
      const data = metaSnap.data();
      const remoteCatVersion = data.catalogo_version || 0;
      const remoteTotal = data.total_produtos || 0;

      let msg = 'Conectado à nuvem. Dados já estão em dia.';

      // Determine catalog sync direction:
      const localCatVersion = localMeta.catalogo_version || this._localCatalogoVersion || 0;

      if (remoteTotal > 0 && (remoteCatVersion > localCatVersion || localProdutos.length === 0)) {
        // Cloud has a newer catalog or local is empty: PULL from cloud
        await this.pullCatalogoFromCloud(remoteCatVersion);
        msg = `Catálogo atualizado da nuvem (${remoteTotal} produtos).`;
      } else if (localProdutos.length > 0 && (remoteTotal === 0 || localCatVersion > remoteCatVersion)) {
        // Local has products and is newer than cloud (or cloud is empty): PUSH to cloud
        await this.pushCatalogoToCloud(localProdutos, localMeta);
        msg = `Catálogo local (${localProdutos.length} produtos) enviado para a nuvem.`;
      } else if (localProdutos.length > 0 && remoteTotal > 0) {
        // Versions match or both present: ensure catalog in cloud is synchronized
        if (remoteCatVersion >= localCatVersion) {
          await this.pullCatalogoFromCloud(remoteCatVersion);
          msg = `Catálogo atualizado da nuvem (${remoteTotal} produtos).`;
        } else {
          await this.pushCatalogoToCloud(localProdutos, localMeta);
          msg = `Catálogo local (${localProdutos.length} produtos) sincronizado com a nuvem.`;
        }
      }

      // Sync vínculos
      const remoteVincVersion = data.vinculos_version || 0;
      const localVincVersion = localMeta.vinculos_version || this._localVinculosVersion || 0;
      if (remoteVincVersion > localVincVersion || (localVinculos.length === 0 && (data.total_eans || 0) > 0)) {
        await this.pullVinculosFromCloud(remoteVincVersion);
      } else if (localVinculos.length > 0 && ((data.total_eans || 0) === 0 || localVincVersion > remoteVincVersion)) {
        await this.pushVinculosToCloud(localVinculos);
      }

      // Sync SAEOU060
      const remoteSaeouVersion = data.saeou060_version || 0;
      const localSaeouVersion = localMeta.saeou060_version || this._localSaeou060Version || 0;
      if (remoteSaeouVersion > localSaeouVersion || (localSaeou.length === 0 && (data.total_saeou060 || 0) > 0)) {
        await this.pullSaeou060FromCloud(remoteSaeouVersion);
      } else if (localSaeou.length > 0 && ((data.total_saeou060 || 0) === 0 || localSaeouVersion > remoteSaeouVersion)) {
        await this.pushSaeou060ToCloud(localSaeou);
      }

      // Sync vencimentos: bidirectional merge
      try {
        const qLotes = query(
          collection(db, 'vencimentos'),
          where('filialId', '==', '172'),
          limit(250)
        );
        const remoteLotesSnap = await getDocs(qLotes);
        logFirestoreRead('syncFullVencimentos', 'vencimentos', remoteLotesSnap.size);
        const remoteLotes: LoteVencimento[] = [];
        remoteLotesSnap.forEach((d) => {
          const raw = d.data();
          if (raw) {
            try {
              const norm = normalizeVencimentoRecord({
                ...raw,
                id: raw.vencimentoId || d.id,
                vencimentoId: raw.vencimentoId || d.id,
              });
              if (!norm.filialId || norm.filialId === '172') {
                remoteLotes.push(norm);
              }
            } catch (errNorm) {
              console.warn('[CloudSync] Erro ao normalizar registro remoto no syncFull:', errNorm);
            }
          }
        });

        if (remoteLotes.length > 0 && this._onRemoteVencimentosReceived) {
          this._onRemoteVencimentosReceived(remoteLotes);
        }
      } catch (e) {
        console.warn('Could not read remote lotes:', e);
      }

      if (localVencimentos.length > 0) {
        await this.sincronizarVencimentosExistentes(localVencimentos);
      }

      this.updateStatus({
        state: 'connected',
        lastSyncTime: nowStr,
        message: 'Nuvem Conectada e Sincronizada',
      });

      return { success: true, message: msg };
    } catch (err: any) {
      console.error('[CloudSync] Error in syncFull:', err);
      this.updateStatus({
        state: 'error',
        message: err?.message || 'Erro ao sincronizar',
      });
      return { success: false, message: `Erro ao conectar com a nuvem: ${err?.message || 'Falha de comunicação'}` };
    }
  }

  // ==========================================
  // PULL METHODS (RECEIVING FROM CLOUD)
  // ==========================================

  public async pullCatalogoFromCloud(version?: number): Promise<boolean> {
    if (this._isSyncing) return false;
    this._isSyncing = true;
    this.updateStatus({ state: 'syncing', message: 'Baixando catálogo SMGOI013 da nuvem...' });

    try {
      await ensureAuth();
      const metaSnap = await getDoc(doc(db, 'metadados', 'geral'));
      if (!metaSnap.exists()) {
        this.updateStatus({ state: 'connected' });
        this._isSyncing = false;
        return false;
      }

      const meta = metaSnap.data() as MetadadosBase & { catalogo_version?: number; total_chunks?: number };
      const totalChunks = meta.total_chunks || 1;

      const chunksCol = collection(db, 'catalogo_chunks');
      const chunksSnap = await getDocs(chunksCol);

      const chunkDocs: { index: number; items: ProdutoSMG[] }[] = [];
      chunksSnap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.items && Array.isArray(d.items)) {
          chunkDocs.push({ index: d.index ?? 0, items: d.items });
        }
      });

      // Sort by chunk index
      chunkDocs.sort((a, b) => a.index - b.index);

      const allProducts: ProdutoSMG[] = [];
      chunkDocs.forEach((c) => allProducts.push(...c.items));

      if (allProducts.length > 0 && this._onRemoteCatalogoReceived) {
        await this._onRemoteCatalogoReceived(allProducts, {
          filial_numero: meta.filial_numero || '172',
          filial_nome: meta.filial_nome || 'CASCAVEL',
          status_base: 'SMGOI013',
          total_produtos: allProducts.length,
          total_vencimentos: meta.total_vencimentos || 0,
          total_eans: meta.total_eans || 0,
          total_saeou060: meta.total_saeou060 || 0,
          ultima_atualizacao_smgoi013: meta.ultima_atualizacao_smgoi013,
        });

        this._localCatalogoVersion = version || meta.catalogo_version || Date.now();
      }

      this.updateStatus({
        state: 'connected',
        lastSyncTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        message: `Catálogo sincronizado (${allProducts.length} produtos)`,
      });
      this._isSyncing = false;
      return true;
    } catch (err: any) {
      console.error('[CloudSync] Error pulling catalog from cloud:', err);
      this.updateStatus({ state: 'error', message: 'Erro ao baixar catálogo' });
      this._isSyncing = false;
      return false;
    }
  }

  public async pullVinculosFromCloud(version?: number): Promise<boolean> {
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
      return true;
    } catch (err) {
      console.warn('[CloudSync] Error pulling vinculos:', err);
      return false;
    }
  }

  public async pullSaeou060FromCloud(version?: number): Promise<boolean> {
    try {
      await ensureAuth();
      const chunksSnap = await getDocs(collection(db, 'saeou060_chunks'));
      const chunkDocs: { index: number; items: RegistroSaeou060[] }[] = [];
      chunksSnap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.items && Array.isArray(d.items)) {
          chunkDocs.push({ index: d.index ?? 0, items: d.items });
        }
      });
      chunkDocs.sort((a, b) => a.index - b.index);

      const allSaeou: RegistroSaeou060[] = [];
      chunkDocs.forEach((c) => allSaeou.push(...c.items));

      if (allSaeou.length > 0 && this._onRemoteSaeou060Received) {
        await this._onRemoteSaeou060Received(allSaeou);
        this._localSaeou060Version = version || Date.now();
      }
      return true;
    } catch (err) {
      console.warn('[CloudSync] Error pulling SAEOU060:', err);
      return false;
    }
  }

  // ==========================================
  // PUSH METHODS (TRANSMITTING TO CLOUD)
  // ==========================================

  /**
   * Pushes the entire SMGOI013 catalog to Firestore in clean chunks of 300 items.
   * Chunks are sanitized and null-safe to guarantee Firestore compatibility.
   */
  public async pushCatalogoToCloud(
    produtos: ProdutoSMG[],
    meta: MetadadosBase,
    onProgress?: (pct: number, msg: string) => void
  ): Promise<boolean> {
    this.updateStatus({ state: 'syncing', message: 'Enviando catálogo para a nuvem...' });

    try {
      await ensureAuth();
      const CHUNK_SIZE = 300;
      const totalChunks = Math.max(1, Math.ceil(produtos.length / CHUNK_SIZE));
      const newVersion = Date.now();

      onProgress?.(10, `Preparando envio em ${totalChunks} lotes para a nuvem...`);

      // Write each chunk to Firestore
      for (let i = 0; i < totalChunks; i++) {
        const chunkItems = produtos.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkDocRef = doc(db, 'catalogo_chunks', `chunk_${String(i).padStart(3, '0')}`);

        // Strip heavy run-time precomputed strings to save bandwidth and sanitize
        const cleanItems = chunkItems.map((p) =>
          cleanForFirestore({
            codigo_interno: p.codigo_interno || '',
            digito: p.digito || '',
            descricao: p.descricao || '',
            embalagem: p.embalagem || '',
            estoque_emb1: p.estoque_emb1 ?? 0,
            estoque_emb9: p.estoque_emb9 ?? 0,
            estoque_total: p.estoque_total ?? 0,
            vendas_qtde_30d: p.vendas_qtde_30d ?? 0,
            vendas_preco: p.vendas_preco ?? null,
            data_ultima_entrada: p.data_ultima_entrada ?? null,
            qtde_ultima_entrada: p.qtde_ultima_entrada ?? null,
            dias_sem_venda: p.dias_sem_venda ?? null,
            idade: p.idade ?? null,
            qtde_ideal: p.qtde_ideal ?? null,
            comprador_filial: p.comprador_filial ?? null,
            comprador_matriz: p.comprador_matriz ?? null,
            setor_fisico: p.setor_fisico ?? null,
            setor_balanco: p.setor_balanco ?? null,
            pedidos_pendentes: p.pedidos_pendentes ?? null,
            codigo_exibicao: p.codigo_exibicao || `${p.codigo_interno}${p.digito ? '-' + p.digito : ''}`,
            eans: p.eans || [],
            is_demo: false,
          })
        );

        await setDoc(chunkDocRef, cleanForFirestore({
          index: i,
          total: totalChunks,
          count: cleanItems.length,
          items: cleanItems,
          updatedAt: new Date().toISOString(),
        }));

        const pct = Math.round(10 + ((i + 1) / totalChunks) * 80);
        onProgress?.(pct, `Sincronizando lote ${i + 1} de ${totalChunks} na nuvem...`);
      }

      // Update metadata version document to signal all other connected devices
      const metaDocRef = doc(db, 'metadados', 'geral');
      await setDoc(metaDocRef, cleanForFirestore({
        filial_numero: meta.filial_numero || '172',
        filial_nome: meta.filial_nome || 'CASCAVEL',
        status_base: 'SMGOI013',
        total_produtos: produtos.length,
        total_chunks: totalChunks,
        catalogo_version: newVersion,
        ultima_atualizacao_smgoi013: meta.ultima_atualizacao_smgoi013 || new Date().toLocaleString('pt-BR'),
        updatedAt: new Date().toISOString(),
      }), { merge: true });

      this._localCatalogoVersion = newVersion;

      this.updateStatus({
        state: 'connected',
        lastSyncTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        message: `Catálogo sincronizado na nuvem (${produtos.length} produtos)`,
      });
      onProgress?.(100, 'Catálogo 100% sincronizado com a nuvem!');
      return true;
    } catch (err: any) {
      console.error('[CloudSync] Error pushing catalog to cloud:', err);
      this.updateStatus({ state: 'error', message: 'Erro ao enviar catálogo para nuvem' });
      return false;
    }
  }

  public async pushVinculosToCloud(vinculos: VinculoEan[]): Promise<boolean> {
    try {
      await ensureAuth();
      const CHUNK_SIZE = 500;
      const totalChunks = Math.max(1, Math.ceil(vinculos.length / CHUNK_SIZE));
      const newVersion = Date.now();

      for (let i = 0; i < totalChunks; i++) {
        const chunkItems = vinculos.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkDocRef = doc(db, 'vinculos_chunks', `chunk_${String(i).padStart(3, '0')}`);
        await setDoc(chunkDocRef, cleanForFirestore({
          index: i,
          total: totalChunks,
          items: chunkItems,
          updatedAt: new Date().toISOString(),
        }));
      }

      await setDoc(doc(db, 'metadados', 'geral'), cleanForFirestore({
        total_eans: vinculos.length,
        vinculos_version: newVersion,
        updatedAt: new Date().toISOString(),
      }), { merge: true });

      this._localVinculosVersion = newVersion;
      return true;
    } catch (err) {
      console.warn('[CloudSync] Error pushing vinculos:', err);
      return false;
    }
  }

  public async pushSaeou060ToCloud(registros: RegistroSaeou060[]): Promise<boolean> {
    try {
      await ensureAuth();
      const CHUNK_SIZE = 400;
      const totalChunks = Math.max(1, Math.ceil(registros.length / CHUNK_SIZE));
      const newVersion = Date.now();

      for (let i = 0; i < totalChunks; i++) {
        const chunkItems = registros.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkDocRef = doc(db, 'saeou060_chunks', `chunk_${String(i).padStart(3, '0')}`);
        await setDoc(chunkDocRef, cleanForFirestore({
          index: i,
          total: totalChunks,
          items: chunkItems,
          updatedAt: new Date().toISOString(),
        }));
      }

      await setDoc(doc(db, 'metadados', 'geral'), cleanForFirestore({
        total_saeou060: registros.length,
        saeou060_version: newVersion,
        updatedAt: new Date().toISOString(),
      }), { merge: true });

      this._localSaeou060Version = newVersion;
      return true;
    } catch (err) {
      console.warn('[CloudSync] Error pushing SAEOU060:', err);
      return false;
    }
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
      // Requisito 8: Consultar estritamente filialId = 172 com limite de segurança
      const q = query(
        collection(db, 'vencimentos'),
        where('filialId', '==', '172'),
        limit(250)
      );
      const snap = await getDocs(q);
      logFirestoreRead('pullVencimentos', 'vencimentos', snap.size);

      const lotes: LoteVencimento[] = [];
      snap.forEach((docSnap) => {
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
          } catch (e) {
            console.warn('[CloudSync] Erro ao normalizar lote recebido da nuvem:', e);
          }
        }
      });
      if (this._onRemoteVencimentosReceived && lotes.length > 0) {
        this._onRemoteVencimentosReceived(lotes);
      }
      return lotes;
    } catch (err: any) {
      console.warn('[CloudSync] Erro ao buscar vencimentos da nuvem:', err?.message);
      if (isQuotaError(err)) {
        markQuotaExceeded();
        this.updateStatus({
          state: 'error',
          message: 'Cota temporariamente indisponível. O aplicativo continuará operando localmente e tentará sincronizar posteriormente.',
        });
      }
      return [];
    }
  }

  public async pushLoteToCloud(lote: LoteVencimento): Promise<void> {
    if (isFirestoreQuotaExceeded()) return;
    try {
      await ensureAuth().catch(() => null);
      const payload = buildVencimentoCentralPayload(lote);
      const loteDocRef = doc(db, 'vencimentos', payload.vencimentoId || lote.id);
      await setDoc(loteDocRef, payload, { merge: true });
    } catch (err: any) {
      console.warn('[CloudSync] Error saving lote to cloud:', err?.message);
      if (isQuotaError(err)) {
        markQuotaExceeded();
      }
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
          const payload = buildVencimentoCentralPayload(lote);
          const docRef = doc(db, 'vencimentos', payload.vencimentoId || lote.id);
          batch.set(docRef, payload, { merge: true });
        });
        await batch.commit();
      }
    } catch (err: any) {
      console.warn('[CloudSync] Error batch saving lotes to cloud:', err?.message);
      if (isQuotaError(err)) {
        markQuotaExceeded();
      }
    }
  }

  public async deleteLoteFromCloud(loteId: string): Promise<void> {
    if (isFirestoreQuotaExceeded()) return;
    try {
      await ensureAuth().catch(() => null);
      const loteDocRef = doc(db, 'vencimentos', loteId);
      const agora = new Date().toISOString();
      await setDoc(
        loteDocRef,
        {
          vencimentoId: loteId,
          id: loteId,
          isDeleted: true,
          deletedAt: agora,
          updatedAt: agora,
          deviceId: getDeviceId(),
        },
        { merge: true }
      );
    } catch (err: any) {
      console.warn('[CloudSync] Error deleting lote from cloud:', err?.message);
      if (isQuotaError(err)) {
        markQuotaExceeded();
      }
    }
  }

  /**
   * Sincronização segura de vencimentos existentes locais com a nuvem (Requisito 20)
   * Requisito 11 e 12: Gravação direta em lote sem pré-leitura getDocs da coleção inteira.
   */
  public async sincronizarVencimentosExistentes(
    locais: LoteVencimento[]
  ): Promise<{ enviados: number; ignorados: number }> {
    if (!db) return { enviados: 0, ignorados: 0 };
    if (isFirestoreQuotaExceeded()) {
      return { enviados: 0, ignorados: 0 };
    }
    try {
      await ensureAuth().catch(() => null);
      let enviados = 0;
      let ignorados = 0;
      const batch = writeBatch(db);
      let countInBatch = 0;

      for (const lote of locais) {
        if (lote.isDeleted) {
          ignorados++;
          continue;
        }

        const payload = buildVencimentoCentralPayload(lote);
        const docRef = doc(db, 'vencimentos', payload.vencimentoId || lote.id);
        batch.set(docRef, payload, { merge: true });
        enviados++;
        countInBatch++;

        if (countInBatch >= 300) {
          await batch.commit();
          countInBatch = 0;
        }
      }

      if (countInBatch > 0) {
        await batch.commit();
      }

      return { enviados, ignorados };
    } catch (err: any) {
      console.warn('[CloudSync] Erro na sincronização de vencimentos existentes:', err?.message);
      if (isQuotaError(err)) {
        markQuotaExceeded();
      }
      return { enviados: 0, ignorados: 0 };
    }
  }

  public async pushHistoricoToCloud(hist: ResumoImportacao): Promise<void> {
    try {
      await ensureAuth();
      const histDocRef = doc(db, 'historico_importacoes', hist.id || `hist-${Date.now()}`);
      await setDoc(histDocRef, cleanForFirestore(hist));
    } catch (err) {
      console.warn('[CloudSync] Error saving historico to cloud:', err);
    }
  }

  public destroy(): void {
    this._unsubscribers.forEach((u) => u());
    this._unsubscribers = [];
  }
}

export const cloudSyncService = new CloudSyncService();
