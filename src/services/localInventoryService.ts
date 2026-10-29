/**
 * Serviço de Diagnóstico e Inventário de Lotes Locais e Fila Offline
 * Nuvem V3 — Fase 1 Preparatória
 * 
 * Inspeciona o IndexedDB e a fila offline local para quantificar:
 * - Vencimentos existentes exclusivamente neste dispositivo.
 * - Operações pendentes de sincronização.
 * - Registros em risco de perda ou exclusão acidental.
 * 
 * REGRA RIGOROSA: NENHUM REGISTRO É MODIFICADO OU EXCLUÍDO.
 */

import { getDB, STORES } from './db';
import { LoteVencimento } from '../types';

export interface OperacaoPendenteDetalhada {
  operationId: string;
  tipoOperacao: string;
  registroId: string;
  dataHora: string;
  tentativas: number;
  status: string;
  payloadResumo: {
    codigoInterno?: string;
    dataVencimento?: string;
    quantidade?: number;
    descricao?: string;
  };
}

export interface RelatorioInventarioLotes {
  filialId: string;
  dataHoraDiagnostico: string;
  totalVencimentosIndexedDB: number;
  lotesSomenteDispositivo: number;
  lotesConfirmadosNuvem: number;
  lotesComDivergenciaOuAlerta: number;
  totalOperacoesOfflinePendentes: number;
  detalhamentoOperacoesPendentes: OperacaoPendenteDetalhada[];
  tombstonesLocaisCount: number;
  lotesAmostraSomenteDispositivo: Array<{
    id: string;
    codigo_exibicao: string;
    descricao_produto: string;
    data_validade: string;
    quantidade_total_unidades: number;
    criado_em: string;
    motivoClassificacao: string;
  }>;
  garantiaPreservacao: {
    registrosExcluidos: number;
    registrosModificados: number;
    status: 'INTEGRO_E_PRESERVADO';
    declaracao: string;
  };
}

export class LocalInventoryService {
  /**
   * Executa a auditoria não destrutiva dos vencimentos no IndexedDB e da fila offline.
   */
  public async diagnosticarVencimentosLocais(filialId = '172'): Promise<RelatorioInventarioLotes> {
    const db = await getDB();

    // 1. Carrega todos os vencimentos de forma segura e somente leitura
    const lotesLocais: LoteVencimento[] = await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORES.VENCIMENTOS, 'readonly');
        const store = tx.objectStore(STORES.VENCIMENTOS);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as LoteVencimento[]) || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        console.warn('[LocalInventoryService] Erro ao ler STORES.VENCIMENTOS:', e);
        resolve([]);
      }
    });

    // 2. Carrega fila offline do localStorage
    let syncQueueRaw: any[] = [];
    let tombstonesMap: Record<string, number> = {};
    if (typeof window !== 'undefined') {
      try {
        const q = localStorage.getItem('vencimentos_sync_queue_v1');
        if (q) syncQueueRaw = JSON.parse(q);
      } catch (e) {
        console.warn('[LocalInventoryService] Erro lendo vencimentos_sync_queue_v1:', e);
      }
      try {
        const t = localStorage.getItem('vencimentos_tombstones_v1');
        if (t) tombstonesMap = JSON.parse(t);
      } catch (e) {
        console.warn('[LocalInventoryService] Erro lendo vencimentos_tombstones_v1:', e);
      }
    }

    const operacoesPendentes: OperacaoPendenteDetalhada[] = syncQueueRaw
      .filter((op) => op.status === 'PENDENTE' || op.status === 'SINCRONIZANDO' || op.status === 'ERRO')
      .map((op) => ({
        operationId: op.operationId || 'op-legado',
        tipoOperacao: op.tipoOperacao || 'DESCONHECIDO',
        registroId: op.registroId || 'id-desconhecido',
        dataHora: op.dataHora || new Date().toISOString(),
        tentativas: op.tentativas || 0,
        status: op.status,
        payloadResumo: {
          codigoInterno: op.payload?.codigoInterno || op.payload?.codigo_interno,
          dataVencimento: op.payload?.dataVencimento || op.payload?.data_validade,
          quantidade: op.payload?.quantidade || op.payload?.quantidade_total_unidades,
          descricao: op.payload?.descricao || op.payload?.descricao_produto,
        },
      }));

    const idsEmFilaPendente = new Set(operacoesPendentes.map((op) => op.registroId));
    const idsTombstones = new Set(Object.keys(tombstonesMap));

    let lotesSomenteDispositivo = 0;
    let lotesConfirmadosNuvem = 0;
    let lotesComDivergenciaOuAlerta = 0;
    const lotesAmostraSomenteDispositivo: RelatorioInventarioLotes['lotesAmostraSomenteDispositivo'] = [];

    lotesLocais.forEach((lote) => {
      const estaNaFilaPendente = idsEmFilaPendente.has(lote.id);
      const temTombstone = idsTombstones.has(lote.id);
      // Se não possui confirmação da nuvem (versão mínima de sincronização central) ou está pendente na fila
      const semSyncNuvem = !lote.version || !lote.updatedAt || estaNaFilaPendente;

      if (temTombstone) {
        lotesComDivergenciaOuAlerta++;
      }

      if (semSyncNuvem) {
        lotesSomenteDispositivo++;
        if (lotesAmostraSomenteDispositivo.length < 10) {
          lotesAmostraSomenteDispositivo.push({
            id: lote.id,
            codigo_exibicao: lote.codigo_exibicao || `${lote.codigo_interno}-${lote.digito}`,
            descricao_produto: lote.descricao_produto || 'Sem descrição',
            data_validade: lote.data_validade,
            quantidade_total_unidades: lote.quantidade_total_unidades,
            criado_em: lote.criado_em || 'N/A',
            motivoClassificacao: estaNaFilaPendente
              ? 'Presente na fila de sincronização pendente'
              : 'Sem carimbo de confirmação central do servidor',
          });
        }
      } else {
        lotesConfirmadosNuvem++;
      }
    });

    return {
      filialId,
      dataHoraDiagnostico: new Date().toISOString(),
      totalVencimentosIndexedDB: lotesLocais.length,
      lotesSomenteDispositivo,
      lotesConfirmadosNuvem,
      lotesComDivergenciaOuAlerta,
      totalOperacoesOfflinePendentes: operacoesPendentes.length,
      detalhamentoOperacoesPendentes: operacoesPendentes,
      tombstonesLocaisCount: Object.keys(tombstonesMap).length,
      lotesAmostraSomenteDispositivo,
      garantiaPreservacao: {
        registrosExcluidos: 0,
        registrosModificados: 0,
        status: 'INTEGRO_E_PRESERVADO',
        declaracao:
          'Auditoria puramente em modo leitura. Nenhum registro ou fila offline foi descartado, sobrescrito ou eliminado.',
      },
    };
  }
}

export const localInventoryService = new LocalInventoryService();
