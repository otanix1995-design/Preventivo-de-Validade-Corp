/**
 * Persistent Asynchronous Synchronization Queue for Vencimentos
 * Implements offline-first queuing, idempotency, tombstones for deletions,
 * and conflict-free background synchronizations to Firebase/Firestore.
 */

import { db, ensureAuth } from './firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { cleanForFirestore } from './cloudSyncService';
import { LoteVencimento } from '../types';

export type SyncOperationType =
  | 'CREATE_VENCIMENTO'
  | 'UPDATE_VENCIMENTO'
  | 'DELETE_VENCIMENTO'
  | 'UPDATE_QUANTIDADE'
  | 'ENVIAR_COMPRADOR'
  | 'REMOVER_ENVIO_COMPRADOR';

export type SyncOpStatus = 'PENDENTE' | 'SINCRONIZANDO' | 'SINCRONIZADO' | 'ERRO';

export interface SyncOperation {
  operationId: string;
  tipoOperacao: SyncOperationType;
  registroId: string;
  payload: any;
  dataHora: string;
  status: SyncOpStatus;
  tentativas: number;
  erroMensagem?: string;
  updatedAt?: string;
}

const STORAGE_KEY_QUEUE = 'vencimentos_sync_queue_v1';
const STORAGE_KEY_TOMBSTONES = 'vencimentos_tombstones_v1';

class SyncQueueService {
  private _queue: SyncOperation[] = [];
  private _tombstones: Map<string, number> = new Map(); // registroId -> timestamp deleted
  private _isProcessing = false;
  private _listeners: Array<(queue: SyncOperation[]) => void> = [];

  constructor() {
    this.loadFromStorage();

    // Listen to network status
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[SyncQueue] Conexão restabelecida. Processando fila pendente...');
        this.processQueue().catch(() => {});
      });
    }
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const qData = localStorage.getItem(STORAGE_KEY_QUEUE);
      if (qData) {
        const parsed = JSON.parse(qData);
        if (Array.isArray(parsed)) {
          this._queue = parsed;
        }
      }
    } catch (e) {
      console.warn('[SyncQueue] Erro ao carregar fila do localStorage:', e);
    }

    try {
      const tData = localStorage.getItem(STORAGE_KEY_TOMBSTONES);
      if (tData) {
        const parsed = JSON.parse(tData);
        if (typeof parsed === 'object' && parsed !== null) {
          Object.entries(parsed).forEach(([id, ts]) => {
            this._tombstones.set(id, Number(ts) || Date.now());
          });
        }
      }
    } catch (e) {
      console.warn('[SyncQueue] Erro ao carregar tombstones do localStorage:', e);
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      // Keep only pending, syncing or recently errored operations (up to 200 items)
      const toSave = this._queue.slice(-200);
      localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(toSave));
    } catch (e) {
      console.warn('[SyncQueue] Erro ao salvar fila no localStorage:', e);
    }

    try {
      const tObj: Record<string, number> = {};
      this._tombstones.forEach((ts, id) => {
        tObj[id] = ts;
      });
      localStorage.setItem(STORAGE_KEY_TOMBSTONES, JSON.stringify(tObj));
    } catch (e) {
      console.warn('[SyncQueue] Erro ao salvar tombstones no localStorage:', e);
    }
  }

  public subscribe(listener: (queue: SyncOperation[]) => void): () => void {
    this._listeners.push(listener);
    listener([...this._queue]);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    const copy = [...this._queue];
    this._listeners.forEach((l) => {
      try {
        l(copy);
      } catch (err) {
        console.error('[SyncQueue] Erro no listener:', err);
      }
    });
  }

  // =========================================================================
  // TOMBSTONES (PREVENTS RESTORATION OF DELETED ITEMS)
  // =========================================================================

  public addTombstone(registroId: string): void {
    this._tombstones.set(registroId, Date.now());
    this.saveToStorage();
  }

  public removeTombstone(registroId: string): void {
    if (this._tombstones.has(registroId)) {
      this._tombstones.delete(registroId);
      this.saveToStorage();
    }
  }

  public isTombstoned(registroId: string): boolean {
    return this._tombstones.has(registroId);
  }

  // =========================================================================
  // PENDING OPERATION CHECK (PREVENTS OVERWRITING LOCAL EDITS WITH STALE DATA)
  // =========================================================================

  public hasPendingOperationFor(registroId: string): boolean {
    return this._queue.some(
      (op) =>
        op.registroId === registroId &&
        (op.status === 'PENDENTE' || op.status === 'SINCRONIZANDO')
    );
  }

  // =========================================================================
  // ENQUEUE OPERATION (IDEMPOTENT & NON-BLOCKING)
  // =========================================================================

  public enqueue(
    tipoOperacao: SyncOperationType,
    registroId: string,
    payload: any
  ): SyncOperation {
    const agora = new Date().toISOString();
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // If it's a deletion, remove any previous pending CREATE or UPDATE for this same item
    if (tipoOperacao === 'DELETE_VENCIMENTO') {
      this.addTombstone(registroId);
      this._queue = this._queue.filter(
        (op) => !(op.registroId === registroId && op.status === 'PENDENTE')
      );
    } else {
      // If we are creating/updating, remove tombstone if one existed
      this.removeTombstone(registroId);

      // If an existing update is pending for this item, coalesce with newest payload
      const existingIdx = this._queue.findIndex(
        (op) => op.registroId === registroId && op.status === 'PENDENTE'
      );
      if (existingIdx !== -1) {
        const existing = this._queue[existingIdx];
        if (existing.tipoOperacao === 'CREATE_VENCIMENTO') {
          // Update the create payload with newest changes
          existing.payload = { ...existing.payload, ...payload };
          existing.updatedAt = agora;
          this.saveToStorage();
          this.notify();
          this.triggerProcessBackground();
          return existing;
        } else if (existing.tipoOperacao.startsWith('UPDATE') || existing.tipoOperacao.includes('COMPRADOR')) {
          existing.payload = { ...existing.payload, ...payload };
          existing.tipoOperacao = tipoOperacao;
          existing.updatedAt = agora;
          this.saveToStorage();
          this.notify();
          this.triggerProcessBackground();
          return existing;
        }
      }
    }

    const op: SyncOperation = {
      operationId,
      tipoOperacao,
      registroId,
      payload,
      dataHora: agora,
      status: 'PENDENTE',
      tentativas: 0,
      updatedAt: agora,
    };

    this._queue.push(op);
    this.saveToStorage();
    this.notify();

    // Trigger process in background asynchronously (FIRE-AND-FORGET)
    this.triggerProcessBackground();

    return op;
  }

  private triggerProcessBackground(): void {
    setTimeout(() => {
      this.processQueue().catch((err) => {
        console.warn('[SyncQueue] Aviso em segundo plano ao processar fila:', err);
      });
    }, 50);
  }

  // =========================================================================
  // PROCESS QUEUE (SAFE, TIMEOUT-PROTECTED, NON-BLOCKING)
  // =========================================================================

  public async processQueue(): Promise<void> {
    if (this._isProcessing) return;

    // If offline or Firebase is not configured, leave operations as PENDENTE
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }
    if (!db) {
      return;
    }

    this._isProcessing = true;

    try {
      // Ensure auth with a short timeout so we don't stall
      await ensureAuth().catch(() => null);

      const pendingOps = this._queue.filter(
        (op) => op.status === 'PENDENTE' || (op.status === 'ERRO' && op.tentativas < 5)
      );

      for (const op of pendingOps) {
        op.status = 'SINCRONIZANDO';
        op.tentativas += 1;
        this.notify();

        try {
          // Execute with strict 6s timeout per operation
          await this.executeWithTimeout(this.executeOperation(op), 6000);

          op.status = 'SINCRONIZADO';
          op.erroMensagem = undefined;
        } catch (err: any) {
          console.warn(`[SyncQueue] Falha ao sincronizar operação ${op.operationId} (${op.tipoOperacao}):`, err?.message);
          op.status = 'ERRO';
          op.erroMensagem = err?.message || 'Erro de comunicação';
        }

        this.saveToStorage();
        this.notify();
      }
    } finally {
      this._isProcessing = false;
    }
  }

  private executeWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Tempo limite de sincronização excedido (6s)'));
      }, ms);

      promise
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private async executeOperation(op: SyncOperation): Promise<void> {
    if (!db) throw new Error('Firebase Firestore não disponível');

    const loteDocRef = doc(db, 'vencimentos', op.registroId);

    switch (op.tipoOperacao) {
      case 'CREATE_VENCIMENTO': {
        const payloadClean = cleanForFirestore(op.payload);
        await setDoc(loteDocRef, payloadClean, { merge: true });
        break;
      }

      case 'UPDATE_VENCIMENTO':
      case 'UPDATE_QUANTIDADE':
      case 'ENVIAR_COMPRADOR':
      case 'REMOVER_ENVIO_COMPRADOR': {
        // If it was already tombstoned in the meantime, don't recreate it
        if (this.isTombstoned(op.registroId)) {
          await deleteDoc(loteDocRef).catch(() => {});
          return;
        }
        const payloadClean = cleanForFirestore(op.payload);
        await setDoc(loteDocRef, payloadClean, { merge: true });
        break;
      }

      case 'DELETE_VENCIMENTO': {
        await deleteDoc(loteDocRef);
        break;
      }
    }
  }

  // =========================================================================
  // QUEUE STATUS & STATS
  // =========================================================================

  public getPendingCount(): number {
    return this._queue.filter((op) => op.status === 'PENDENTE' || op.status === 'SINCRONIZANDO').length;
  }

  public getQueue(): SyncOperation[] {
    return [...this._queue];
  }
}

export const syncQueueService = new SyncQueueService();
