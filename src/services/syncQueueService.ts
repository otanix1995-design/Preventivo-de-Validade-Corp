/**
 * Persistent Asynchronous Synchronization Queue for Vencimentos
 * Implements offline-first queuing, idempotency, tombstones for deletions,
 * and conflict-free background synchronizations to Firebase/Firestore.
 */

import {
  db,
  detectQuotaResourceType,
  ensureAuth,
  formatarErroSyncPorServico,
  isFirestoreQuotaExceeded,
  isQuotaError,
  markQuotaExceeded,
  OperationType,
} from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  buildVencimentoCentralPayload,
  cleanForFirestore,
  getDeviceId,
  sanitizeLoteForFirestore,
} from './deviceId';
import { authRoleService } from './authRoleService';
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
const STORAGE_KEY_RULE_FIX_RETRY = 'vencimentos_rule_fix_retry_v2';

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
        if (isFirestoreQuotaExceeded()) return;
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
          if (!localStorage.getItem(STORAGE_KEY_RULE_FIX_RETRY)) {
            let recovered = false;
            this._queue = this._queue.map((op) => {
              if (op?.status === 'ERRO') {
                recovered = true;
                return { ...op, status: 'PENDENTE', tentativas: 0, erroMensagem: undefined };
              }
              return op;
            });
            localStorage.setItem(STORAGE_KEY_RULE_FIX_RETRY, '1');
            if (recovered) {
              this.saveToStorage();
              this.triggerProcessBackground();
            }
          }
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
    if (isFirestoreQuotaExceeded()) return;
    setTimeout(() => {
      if (isFirestoreQuotaExceeded()) return;
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

    // Requisito 17: Se a cota estiver esgotada, não disparar requisições em loop
    if (isFirestoreQuotaExceeded()) {
      console.warn(
        '[SyncQueue] Cota do Firestore temporariamente indisponível. Operações permanecerão salvas localmente.'
      );
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
        // Re-check quota before each operation in case an earlier one hit quota
        if (isFirestoreQuotaExceeded()) {
          break;
        }

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

          if (isQuotaError(err)) {
            markQuotaExceeded(err?.message, detectQuotaResourceType(err));
            op.status = 'PENDENTE';
            op.tentativas = Math.max(0, op.tentativas - 1);
            op.erroMensagem = undefined;
            this.saveToStorage();
            this.notify();
            break;
          }

          op.status = 'ERRO';
          op.erroMensagem = err?.message || '[Vencimentos • Coleção: vencimentos] Erro de comunicação';
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

    const loteDocPath = `vencimentos/${op.registroId}`;
    const loteDocRef = doc(db, 'vencimentos', op.registroId);
    const isAdmin = authRoleService.isGerenciaAdminVerificadaNoServidor();

    try {
      switch (op.tipoOperacao) {
        case 'CREATE_VENCIMENTO': {
          const remoteSnap = await getDoc(loteDocRef);
          const rawPayload = buildVencimentoCentralPayload(op.payload, op.operationId);
          const payload = sanitizeLoteForFirestore(rawPayload, {
            isUpdate: remoteSnap.exists(),
            remoteData: remoteSnap.exists() ? remoteSnap.data() : undefined,
          });
          await setDoc(loteDocRef, payload, { merge: true });
          break;
        }

        case 'UPDATE_VENCIMENTO':
        case 'UPDATE_QUANTIDADE':
        case 'ENVIAR_COMPRADOR':
        case 'REMOVER_ENVIO_COMPRADOR': {
          const remoteSnap = await getDoc(loteDocRef);

          if (this.isTombstoned(op.registroId)) {
            if (!remoteSnap.exists() && !isAdmin) {
              return; // Exclusão local preservada sem criar tombstone em nuvem quando não-admin
            }
            const agora = new Date().toISOString();
            const tombstonePayload = sanitizeLoteForFirestore(
              {
                id: op.registroId,
                vencimentoId: op.registroId,
                filialId: op.payload?.filialId || '172',
                isDeleted: true,
                deletedAt: agora,
                motivoExclusao:
                  typeof op.payload?.motivoExclusao === 'string' && op.payload.motivoExclusao.trim().length >= 3
                    ? op.payload.motivoExclusao.trim().slice(0, 200)
                    : 'Exclusão lógica local (tombstone)',
                updatedAt: agora,
                operationId: op.operationId,
                deviceId: getDeviceId(),
              },
              {
                isUpdate: remoteSnap.exists(),
                remoteData: remoteSnap.exists() ? remoteSnap.data() : undefined,
              }
            );
            await setDoc(loteDocRef, tombstonePayload, { merge: true });
            return;
          }

          const rawPayload = buildVencimentoCentralPayload(op.payload, op.operationId);
          const payload = sanitizeLoteForFirestore(rawPayload, {
            isUpdate: remoteSnap.exists(),
            remoteData: remoteSnap.exists() ? remoteSnap.data() : undefined,
          });
          await setDoc(loteDocRef, payload, { merge: true });
          break;
        }

        case 'DELETE_VENCIMENTO': {
          const remoteSnap = await getDoc(loteDocRef);
          if (!remoteSnap.exists() && !isAdmin) {
            return; // Documento não existe remotamente; tombstone local impede restauração
          }
          const agora = new Date().toISOString();
          const motivoSeguro =
            typeof op.payload?.motivoExclusao === 'string' && op.payload.motivoExclusao.trim().length >= 3
              ? op.payload.motivoExclusao.trim().slice(0, 200)
              : 'Exclusão lógica via fila offline';
          const deletePayload = sanitizeLoteForFirestore(
            {
              vencimentoId: op.registroId,
              id: op.registroId,
              isDeleted: true,
              deletedAt: agora,
              motivoExclusao: motivoSeguro,
              updatedAt: agora,
              operationId: op.operationId,
              deviceId: getDeviceId(),
              atualizadoPor: 'SISTEMA_PRINCIPAL',
              filialId: op.payload?.filialId || '172',
            },
            {
              isUpdate: remoteSnap.exists(),
              remoteData: remoteSnap.exists() ? remoteSnap.data() : undefined,
            }
          );
          await setDoc(loteDocRef, cleanForFirestore(deletePayload), { merge: true });
          break;
        }
      }
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(
        err,
        'Vencimentos (Fila)',
        loteDocPath,
        op.tipoOperacao === 'CREATE_VENCIMENTO' ? OperationType.CREATE : OperationType.UPDATE
      );
      throw new Error(detail.mensagemUsuario);
    }
  }

  // =========================================================================
  // QUEUE STATUS & STATS
  // =========================================================================

  public getPendingCount(): number {
    return this._queue.filter((op) => op.status === 'PENDENTE' || op.status === 'SINCRONIZANDO').length;
  }

  public hasErrors(): boolean {
    return this._queue.some((op) => op.status === 'ERRO');
  }

  public getLastError(): string | undefined {
    const errOp = this._queue.find((op) => op.status === 'ERRO');
    return errOp?.erroMensagem;
  }

  public getQueue(): SyncOperation[] {
    return [...this._queue];
  }

  public async retryErroredOperations(): Promise<number> {
    let resetCount = 0;
    this._queue = this._queue.map((op) => {
      if (op.status === 'ERRO') {
        resetCount++;
        return {
          ...op,
          status: 'PENDENTE',
          tentativas: 0,
          erroMensagem: undefined,
        };
      }
      return op;
    });
    if (resetCount > 0) {
      this.saveToStorage();
      this.notify();
      await this.processQueue();
    }
    return resetCount;
  }

  public clearErroredOperations(): number {
    const before = this._queue.length;
    this._queue = this._queue.filter((op) => op.status !== 'ERRO');
    const removed = before - this._queue.length;
    if (removed > 0) {
      this.saveToStorage();
      this.notify();
    }
    return removed;
  }
}

export const syncQueueService = new SyncQueueService();
