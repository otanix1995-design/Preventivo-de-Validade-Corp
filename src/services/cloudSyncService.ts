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
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
  writeBatch
} from 'firebase/firestore';
import {
  LoteVencimento,
  MetadadosBase,
  ProdutoSMG,
  RegistroSaeou060,
  ResumoImportacao,
  VinculoEan
} from '../types';
import { db, ensureAuth } from './firebase';

export type SyncState = 'connecting' | 'connected' | 'syncing' | 'offline' | 'error';

export interface SyncStatusInfo {
  state: SyncState;
  lastSyncTime: string | null;
  message?: string;
  isOnline: boolean;
}

type SyncListener = (info: SyncStatusInfo) => void;

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
    this._isInitialized = true;

    try {
      this.updateStatus({ state: 'connecting' });
      await ensureAuth();
      this.updateStatus({ state: 'connected', message: 'Conectado à Nuvem' });

      // 1. Listen to Metadata for Catalog/Vinculos/Saeou060 updates across devices
      const metaDocRef = doc(db, 'metadados', 'geral');
      const unsubMeta = onSnapshot(metaDocRef, async (snapshot) => {
        if (!snapshot.exists()) {
          return;
        }
        const data = snapshot.data();
        const remoteCatVersion = data.catalogo_version || 0;
        const remoteVincVersion = data.vinculos_version || 0;
        const remoteSaeouVersion = data.saeou060_version || 0;

        // Check if another device published a newer SMGOI013 catalog
        if (remoteCatVersion > this._localCatalogoVersion && data.total_produtos > 0) {
          console.log(`[CloudSync] Novo catálogo SMGOI013 detectado na nuvem (versão ${remoteCatVersion}). Baixando...`);
          await this.pullCatalogoFromCloud(remoteCatVersion);
        }

        // Check if another device published newer EAN vínculos
        if (remoteVincVersion > this._localVinculosVersion && data.total_eans > 0) {
          console.log(`[CloudSync] Novos vínculos EAN detectados na nuvem. Baixando...`);
          await this.pullVinculosFromCloud(remoteVincVersion);
        }

        // Check if another device published newer SAEOU060
        if (remoteSaeouVersion > this._localSaeou060Version && data.total_saeou060 > 0) {
          console.log(`[CloudSync] Novo SAEOU060 detectado na nuvem. Baixando...`);
          await this.pullSaeou060FromCloud(remoteSaeouVersion);
        }
      }, (err) => {
        console.warn('[CloudSync] Metadata listener error:', err);
      });
      this._unsubscribers.push(unsubMeta);

      // 2. Real-Time Vencimentos (Expiration Lots) Listener
      const vencimentosColRef = collection(db, 'vencimentos');
      const unsubVenc = onSnapshot(vencimentosColRef, (snapshot) => {
        const lotes: LoteVencimento[] = [];
        snapshot.forEach((docSnap) => {
          lotes.push(docSnap.data() as LoteVencimento);
        });

        if (this._onRemoteVencimentosReceived) {
          this._onRemoteVencimentosReceived(lotes);
        }
        this.updateStatus({
          lastSyncTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        });
      }, (err) => {
        console.warn('[CloudSync] Vencimentos listener error:', err);
      });
      this._unsubscribers.push(unsubVenc);

      // 3. Listen to Import History
      const histColRef = collection(db, 'historico_importacoes');
      const unsubHist = onSnapshot(histColRef, (snapshot) => {
        const items: ResumoImportacao[] = [];
        snapshot.forEach((d) => items.push(d.data() as ResumoImportacao));
        if (this._onRemoteHistoricoReceived && items.length > 0) {
          // Sort newest first
          items.sort((a, b) => new Date(b.data_hora).getTime() - new Date(a.data_hora).getTime());
          this._onRemoteHistoricoReceived(items);
        }
      }, (err) => {
        console.warn('[CloudSync] Histórico listener error:', err);
      });
      this._unsubscribers.push(unsubHist);

      // Initial check to see if remote has data that local device is missing
      await this.pullLatestIfOutdated();
    } catch (err: any) {
      console.error('[CloudSync] Initialization failed:', err);
      this.updateStatus({ state: 'offline', message: 'Erro ao conectar com Firebase' });
    }
  }

  /**
   * Checks if remote Firestore has data that local device doesn't have yet.
   */
  public async pullLatestIfOutdated(): Promise<void> {
    try {
      await ensureAuth();
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
   * Pushes the entire SMGOI013 catalog to Firestore in clean chunks of 600 items.
   * Total write operations for 11,600 products: ~20 writes (well within quotas).
   */
  public async pushCatalogoToCloud(
    produtos: ProdutoSMG[],
    meta: MetadadosBase,
    onProgress?: (pct: number, msg: string) => void
  ): Promise<boolean> {
    this.updateStatus({ state: 'syncing', message: 'Enviando catálogo para a nuvem...' });

    try {
      await ensureAuth();
      const CHUNK_SIZE = 600;
      const totalChunks = Math.ceil(produtos.length / CHUNK_SIZE);
      const newVersion = Date.now();

      onProgress?.(10, `Preparando envio em ${totalChunks} lotes para a nuvem...`);

      // Write each chunk to Firestore
      for (let i = 0; i < totalChunks; i++) {
        const chunkItems = produtos.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkDocRef = doc(db, 'catalogo_chunks', `chunk_${String(i).padStart(3, '0')}`);

        // Strip heavy run-time precomputed strings to save bandwidth
        const cleanItems = chunkItems.map((p) => ({
          codigo_interno: p.codigo_interno,
          digito: p.digito,
          descricao: p.descricao,
          embalagem: p.embalagem,
          estoque_emb1: p.estoque_emb1,
          estoque_emb9: p.estoque_emb9,
          estoque_total: p.estoque_total,
          vendas_qtde_30d: p.vendas_qtde_30d,
          vendas_preco: p.vendas_preco,
          data_ultima_entrada: p.data_ultima_entrada,
          qtde_ultima_entrada: p.qtde_ultima_entrada,
          dias_sem_venda: p.dias_sem_venda,
          idade: p.idade,
          qtde_ideal: p.qtde_ideal,
          comprador_filial: p.comprador_filial,
          comprador_matriz: p.comprador_matriz,
          setor_fisico: p.setor_fisico,
          setor_balanco: p.setor_balanco,
          pedidos_pendentes: p.pedidos_pendentes,
          codigo_exibicao: p.codigo_exibicao,
          eans: p.eans || [],
          is_demo: false,
        }));

        await setDoc(chunkDocRef, {
          index: i,
          total: totalChunks,
          count: cleanItems.length,
          items: cleanItems,
          updatedAt: new Date().toISOString(),
        });

        const pct = Math.round(10 + ((i + 1) / totalChunks) * 80);
        onProgress?.(pct, `Sincronizando lote ${i + 1} de ${totalChunks} na nuvem...`);
      }

      // Update metadata version document to signal other connected devices
      const metaDocRef = doc(db, 'metadados', 'geral');
      await setDoc(metaDocRef, {
        filial_numero: meta.filial_numero || '172',
        filial_nome: meta.filial_nome || 'CASCAVEL',
        status_base: 'SMGOI013',
        total_produtos: produtos.length,
        total_chunks: totalChunks,
        catalogo_version: newVersion,
        ultima_atualizacao_smgoi013: meta.ultima_atualizacao_smgoi013 || new Date().toLocaleString('pt-BR'),
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      this._localCatalogoVersion = newVersion;

      this.updateStatus({
        state: 'connected',
        lastSyncTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        message: 'Catálogo sincronizado com a nuvem',
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
      const CHUNK_SIZE = 1000;
      const totalChunks = Math.max(1, Math.ceil(vinculos.length / CHUNK_SIZE));
      const newVersion = Date.now();

      for (let i = 0; i < totalChunks; i++) {
        const chunkItems = vinculos.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkDocRef = doc(db, 'vinculos_chunks', `chunk_${String(i).padStart(3, '0')}`);
        await setDoc(chunkDocRef, {
          index: i,
          total: totalChunks,
          items: chunkItems,
          updatedAt: new Date().toISOString(),
        });
      }

      await setDoc(doc(db, 'metadados', 'geral'), {
        total_eans: vinculos.length,
        vinculos_version: newVersion,
      }, { merge: true });

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
      const CHUNK_SIZE = 500;
      const totalChunks = Math.max(1, Math.ceil(registros.length / CHUNK_SIZE));
      const newVersion = Date.now();

      for (let i = 0; i < totalChunks; i++) {
        const chunkItems = registros.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkDocRef = doc(db, 'saeou060_chunks', `chunk_${String(i).padStart(3, '0')}`);
        await setDoc(chunkDocRef, {
          index: i,
          total: totalChunks,
          items: chunkItems,
          updatedAt: new Date().toISOString(),
        });
      }

      await setDoc(doc(db, 'metadados', 'geral'), {
        total_saeou060: registros.length,
        saeou060_version: newVersion,
      }, { merge: true });

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

  public async pushLoteToCloud(lote: LoteVencimento): Promise<void> {
    try {
      await ensureAuth();
      const loteDocRef = doc(db, 'vencimentos', lote.id);
      await setDoc(loteDocRef, lote);
    } catch (err) {
      console.warn('[CloudSync] Error saving lote to cloud:', err);
    }
  }

  public async pushAllLotesToCloud(lotes: LoteVencimento[]): Promise<void> {
    try {
      await ensureAuth();
      // Write in batches of up to 400
      const batchSize = 400;
      for (let i = 0; i < lotes.length; i += batchSize) {
        const batch = writeBatch(db);
        const slice = lotes.slice(i, i + batchSize);
        slice.forEach((lote) => {
          const docRef = doc(db, 'vencimentos', lote.id);
          batch.set(docRef, lote);
        });
        await batch.commit();
      }
    } catch (err) {
      console.warn('[CloudSync] Error batch saving lotes to cloud:', err);
    }
  }

  public async deleteLoteFromCloud(loteId: string): Promise<void> {
    try {
      await ensureAuth();
      const loteDocRef = doc(db, 'vencimentos', loteId);
      await deleteDoc(loteDocRef);
    } catch (err) {
      console.warn('[CloudSync] Error deleting lote from cloud:', err);
    }
  }

  public async pushHistoricoToCloud(hist: ResumoImportacao): Promise<void> {
    try {
      await ensureAuth();
      const histDocRef = doc(db, 'historico_importacoes', hist.id || `hist-${Date.now()}`);
      await setDoc(histDocRef, hist);
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
