/**
 * Serviço de Backup Não-Destrutivo — Nuvem V3 (Fase 1 Preparatória)
 * 
 * Exporta e valida o snapshot integral das 18 tabelas do IndexedDB (ControleVencimentosDB_v2)
 * e o estado de filas offline do localStorage, sem alterar ou apagar nenhum registro ativo.
 */

import { getDB, STORES } from './db';

export interface BackupMetadata {
  app: string;
  versaoApp: string;
  filialId: string;
  dataHoraIso: string;
  timestamp: number;
  totalTabelas: number;
  totalRegistros: number;
  contagemPorTabela: Record<string, number>;
  checksumSimples: string;
}

export interface SnapshotCompletoIndexedDB {
  metadados: BackupMetadata;
  localStorageExtra: {
    syncQueue: any[];
    tombstones: Record<string, number>;
    filialId?: string;
  };
  tabelas: Record<string, any[]>;
}

export interface ValidacaoBackupResultado {
  valido: boolean;
  mensagem: string;
  detalhes: {
    totalTabelas: number;
    tabelasIdentificadas: string[];
    tabelasAusentes: string[];
    totalRegistros: number;
    checksumEsperado: string;
    checksumCalculado: string;
    lotesVencimentoEncontrados: number;
    produtosEncontrados: number;
  };
}

/**
 * Calcula um hash determinístico leve para verificação de integridade do backup.
 */
function calcularChecksumSimples(payloadStr: string): string {
  let hash = 0;
  for (let i = 0; i < payloadStr.length; i++) {
    const char = payloadStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Converte para inteiro de 32 bits
  }
  return `CHK-${Math.abs(hash).toString(16).toUpperCase()}-${payloadStr.length}`;
}

export class BackupService {
  /**
   * Extrai todos os registros de uma objectStore do IndexedDB de forma não destrutiva (somente leitura).
   */
  private async extrairStore(db: IDBDatabase, storeName: string): Promise<any[]> {
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => {
          console.warn(`[BackupService] Falha ao ler store ${storeName}:`, req.error);
          resolve([]);
        };
      } catch (err) {
        console.warn(`[BackupService] Erro ao abrir transação de leitura em ${storeName}:`, err);
        resolve([]);
      }
    });
  }

  /**
   * Gera o Snapshot Completo do IndexedDB e localStorage de forma 100% não destrutiva.
   */
  public async gerarSnapshotCompleto(filialId = '172'): Promise<SnapshotCompletoIndexedDB> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      const tabelas: Record<string, any[]> = {};
      const contagemPorTabela: Record<string, number> = {};
      Object.values(STORES).forEach((s) => {
        tabelas[s] = [];
        contagemPorTabela[s] = 0;
      });
      const raw = JSON.stringify({ tabelas, syncQueue: [], tombstones: {} });
      const checksum = calcularChecksumSimples(raw);
      return {
        metadados: {
          app: 'Controle de Vencimentos & ISV Operacional',
          versaoApp: 'Nuvem_V3',
          filialId,
          dataHoraIso: new Date().toISOString(),
          timestamp: Date.now(),
          totalTabelas: 18,
          totalRegistros: 0,
          contagemPorTabela,
          checksumSimples: checksum,
        },
        localStorageExtra: {
          syncQueue: [],
          tombstones: {},
          filialId,
        },
        tabelas,
      };
    }

    const db = await getDB();
    const tabelas: Record<string, any[]> = {};
    const contagemPorTabela: Record<string, number> = {};
    let totalRegistros = 0;

    const listaStores = Object.values(STORES);

    for (const storeName of listaStores) {
      const registros = await this.extrairStore(db, storeName);
      tabelas[storeName] = registros;
      contagemPorTabela[storeName] = registros.length;
      totalRegistros += registros.length;
    }

    // Captura estado da fila offline do localStorage
    let syncQueue: any[] = [];
    let tombstones: Record<string, number> = {};
    if (typeof window !== 'undefined') {
      try {
        const rawQueue = localStorage.getItem('vencimentos_sync_queue_v1');
        if (rawQueue) syncQueue = JSON.parse(rawQueue);
      } catch (e) {
        console.warn('[BackupService] Fila localStorage não pôde ser parseada:', e);
      }
      try {
        const rawTombstones = localStorage.getItem('vencimentos_tombstones_v1');
        if (rawTombstones) tombstones = JSON.parse(rawTombstones);
      } catch (e) {
        console.warn('[BackupService] Tombstones localStorage não puderam ser parseados:', e);
      }
    }

    // Calcula checksum
    const rawDataStr = JSON.stringify({ tabelas, syncQueue, tombstones });
    const checksum = calcularChecksumSimples(rawDataStr);

    const metadados: BackupMetadata = {
      app: 'Controle de Vencimentos & ISV Operacional',
      versaoApp: 'Nuvem_V3_Fase1_Prep',
      filialId,
      dataHoraIso: new Date().toISOString(),
      timestamp: Date.now(),
      totalTabelas: listaStores.length,
      totalRegistros,
      contagemPorTabela,
      checksumSimples: checksum,
    };

    return {
      metadados,
      localStorageExtra: {
        syncQueue,
        tombstones,
        filialId,
      },
      tabelas,
    };
  }

  /**
   * Valida a integridade de um snapshot de backup sem tocar no banco ativo (Dry-Run).
   */
  public validarIntegridade(snapshot: any): ValidacaoBackupResultado {
    const listaStoresEsperadas = Object.values(STORES);
    const tabelasIdentificadas: string[] = [];
    const tabelasAusentes: string[] = [];

    if (!snapshot || typeof snapshot !== 'object' || !snapshot.metadados || !snapshot.tabelas) {
      return {
        valido: false,
        mensagem: 'Estrutura do arquivo de backup inválida ou corrompida.',
        detalhes: {
          totalTabelas: 0,
          tabelasIdentificadas: [],
          tabelasAusentes: listaStoresEsperadas,
          totalRegistros: 0,
          checksumEsperado: 'N/A',
          checksumCalculado: 'N/A',
          lotesVencimentoEncontrados: 0,
          produtosEncontrados: 0,
        },
      };
    }

    for (const store of listaStoresEsperadas) {
      if (Array.isArray(snapshot.tabelas[store])) {
        tabelasIdentificadas.push(store);
      } else {
        tabelasAusentes.push(store);
      }
    }

    let totalRegistros = 0;
    Object.values(snapshot.tabelas).forEach((arr: any) => {
      if (Array.isArray(arr)) totalRegistros += arr.length;
    });

    const lotesVencimento = Array.isArray(snapshot.tabelas[STORES.VENCIMENTOS])
      ? snapshot.tabelas[STORES.VENCIMENTOS].length
      : 0;

    const produtos = Array.isArray(snapshot.tabelas[STORES.PRODUTOS])
      ? snapshot.tabelas[STORES.PRODUTOS].length
      : 0;

    const rawDataStr = JSON.stringify({
      tabelas: snapshot.tabelas,
      syncQueue: snapshot.localStorageExtra?.syncQueue || [],
      tombstones: snapshot.localStorageExtra?.tombstones || {},
    });
    const checksumCalculado = calcularChecksumSimples(rawDataStr);
    const checksumEsperado = snapshot.metadados.checksumSimples;

    const valido =
      tabelasAusentes.length === 0 &&
      checksumCalculado === checksumEsperado &&
      lotesVencimento >= 0 &&
      produtos >= 0;

    return {
      valido,
      mensagem: valido
        ? 'Backup íntegro e validado com sucesso. Todas as 18 tabelas conferidas.'
        : `Divergência detectada no backup: ${tabelasAusentes.length > 0 ? `Tabelas ausentes: ${tabelasAusentes.join(', ')}` : 'Checksum divergente'}.`,
      detalhes: {
        totalTabelas: tabelasIdentificadas.length,
        tabelasIdentificadas,
        tabelasAusentes,
        totalRegistros,
        checksumEsperado,
        checksumCalculado,
        lotesVencimentoEncontrados: lotesVencimento,
        produtosEncontrados: produtos,
      },
    };
  }

  /**
   * Dispara o download nativo do arquivo JSON de backup no navegador.
   */
  public async baixarBackupJson(filialId = '172'): Promise<SnapshotCompletoIndexedDB> {
    const snapshot = await this.gerarSnapshotCompleto(filialId);
    if (typeof window !== 'undefined') {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(snapshot, null, 2));
      const downloadAnchor = document.createElement('a');
      const dataFormatada = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute(
        'download',
        `backup_seguranca_filial${filialId}_nuvem_v3_${dataFormatada}.json`
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    }
    return snapshot;
  }
}

export const backupService = new BackupService();
