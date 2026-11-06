/**
 * NUVEM V3 — SERVIÇO UNIFICADO DE STATUS E SINCRONIZAÇÃO DAS TRÊS BASES OPERACIONAIS
 * 
 * Centraliza e unifica os estados das 3 bases da Filial 172:
 * 1. BASE RUB (Catálogo Mestre Soberano de 36 colunas)
 * 2. SPCOI007 (Fornecedores, Indústrias e CNPJs)
 * 3. SAEOU060 (Lotes de Vencimento de Promotores)
 * 
 * Estados padronizados: LOCAL | PUBLICANDO | SINCRONIZADO | ERRO
 */

import { rubSyncService, PublicacaoRubStatus, StatusSyncBase } from './rubSyncService';
import { spcoiSyncService, PublicacaoSpcoiStatus } from './spcoiSyncService';
import { saeouSyncService, PublicacaoSaeouStatus } from './saeouSyncService';
import { productRepository } from './productRepository';
import { isvService } from './isvService';
import { useState, useEffect } from 'react';

export interface BaseStatusItem {
  id: 'BASE_RUB' | 'SPCOI007' | 'SAEOU060';
  nome: string;
  descricao: string;
  status: StatusSyncBase;
  versaoId?: string;
  dataAtualizacao?: string;
  totalRegistros: number;
  mensagem: string;
  progressoPorcentagem?: number;
  emAndamento?: boolean;
}

export interface TresBasesStatus {
  rub: BaseStatusItem;
  spcoi: BaseStatusItem;
  saeou: BaseStatusItem;
  filialId: string;
  ultimaVerificacao: string;
}

type TresBasesListener = (status: TresBasesStatus) => void;

class BaseSyncStatusService {
  private _filialId: string = '172';
  private _listeners: Set<TresBasesListener> = new Set();
  private _statusState: TresBasesStatus = {
    filialId: '172',
    ultimaVerificacao: new Date().toLocaleTimeString('pt-BR'),
    rub: {
      id: 'BASE_RUB',
      nome: 'BASE RUB',
      descricao: 'Catálogo Oficial Soberano (36 colunas)',
      status: 'LOCAL',
      totalRegistros: 0,
      mensagem: 'Pronto no IndexedDB',
    },
    spcoi: {
      id: 'SPCOI007',
      nome: 'SPCOI007',
      descricao: 'Fornecedores, Indústrias e CNPJs',
      status: 'LOCAL',
      totalRegistros: 0,
      mensagem: 'Pronto no IndexedDB',
    },
    saeou: {
      id: 'SAEOU060',
      nome: 'SAEOU060',
      descricao: 'Lotes de Vencimentos de Promotores',
      status: 'LOCAL',
      totalRegistros: 0,
      mensagem: 'Pronto no IndexedDB',
    },
  };

  constructor() {
    this._conectarServicos();
  }

  private _conectarServicos(): void {
    // 1. Escutar BASE RUB
    rubSyncService.subscribeStatus((rubStatus: PublicacaoRubStatus) => {
      const versaoRemota = rubSyncService.getVersaoAtivaRemota();
      const versaoLocal = rubSyncService.getVersaoLocalId();
      const produtos = productRepository.getProdutos();

      let statusCalculado: StatusSyncBase = rubStatus.status;
      if (rubStatus.emAndamento) {
        statusCalculado = 'PUBLICANDO';
      } else if (rubStatus.etapa === 'ERRO') {
        statusCalculado = 'ERRO';
      } else if (versaoRemota && versaoLocal && versaoRemota.versaoId === versaoLocal) {
        statusCalculado = 'SINCRONIZADO';
      } else if (produtos.length > 0 && !versaoRemota) {
        statusCalculado = 'LOCAL';
      }

      this._statusState.rub = {
        id: 'BASE_RUB',
        nome: 'BASE RUB',
        descricao: 'Catálogo Oficial Soberano (36 colunas)',
        status: statusCalculado,
        versaoId: versaoLocal || versaoRemota?.versaoId,
        dataAtualizacao: versaoRemota?.dataPublicacaoIso || rubStatus.ultimaSincronizacao,
        totalRegistros: produtos.length || versaoRemota?.totalProdutos || 0,
        mensagem: rubStatus.mensagem,
        progressoPorcentagem: rubStatus.progressoPorcentagem,
        emAndamento: rubStatus.emAndamento,
      };
      this._notificar();
    });

    // 2. Escutar SPCOI007
    spcoiSyncService.subscribeStatus((spcoiStatus: PublicacaoSpcoiStatus) => {
      const versaoRemota = spcoiSyncService.getVersaoAtivaRemota();
      const versaoLocal = spcoiSyncService.getVersaoLocalId();
      const fornecedores = isvService.getFornecedores();

      let statusCalculado: StatusSyncBase = spcoiStatus.status;
      if (spcoiStatus.emAndamento) {
        statusCalculado = 'PUBLICANDO';
      } else if (spcoiStatus.etapa === 'ERRO') {
        statusCalculado = 'ERRO';
      } else if (versaoRemota && versaoLocal && versaoRemota.versaoId === versaoLocal) {
        statusCalculado = 'SINCRONIZADO';
      } else if (fornecedores.length > 0 && !versaoRemota) {
        statusCalculado = 'LOCAL';
      }

      this._statusState.spcoi = {
        id: 'SPCOI007',
        nome: 'SPCOI007',
        descricao: 'Fornecedores, Indústrias e CNPJs',
        status: statusCalculado,
        versaoId: versaoLocal || versaoRemota?.versaoId,
        dataAtualizacao: versaoRemota?.dataPublicacaoIso || spcoiStatus.ultimaSincronizacao,
        totalRegistros: fornecedores.length || versaoRemota?.totalFornecedores || 0,
        mensagem: spcoiStatus.mensagem,
        progressoPorcentagem: spcoiStatus.progressoPorcentagem,
        emAndamento: spcoiStatus.emAndamento,
      };
      this._notificar();
    });

    // 3. Escutar SAEOU060
    saeouSyncService.subscribeStatus((saeouStatus: PublicacaoSaeouStatus) => {
      const versaoRemota = saeouSyncService.getVersaoAtivaRemota();
      const versaoLocal = saeouSyncService.getVersaoLocalId();
      const saeou = productRepository.getSaeou060Registros();

      let statusCalculado: StatusSyncBase = saeouStatus.status;
      if (saeouStatus.emAndamento) {
        statusCalculado = 'PUBLICANDO';
      } else if (saeouStatus.etapa === 'ERRO') {
        statusCalculado = 'ERRO';
      } else if (versaoRemota && versaoLocal && versaoRemota.versaoId === versaoLocal) {
        statusCalculado = 'SINCRONIZADO';
      } else if (saeou.length > 0 && !versaoRemota) {
        statusCalculado = 'LOCAL';
      }

      this._statusState.saeou = {
        id: 'SAEOU060',
        nome: 'SAEOU060',
        descricao: 'Lotes de Vencimentos de Promotores',
        status: statusCalculado,
        versaoId: versaoLocal || versaoRemota?.versaoId,
        dataAtualizacao: versaoRemota?.dataPublicacaoIso || saeouStatus.ultimaSincronizacao,
        totalRegistros: saeou.length || versaoRemota?.totalRegistros || 0,
        mensagem: saeouStatus.mensagem,
        progressoPorcentagem: saeouStatus.progressoPorcentagem,
        emAndamento: saeouStatus.emAndamento,
      };
      this._notificar();
    });
  }

  public getStatus(): TresBasesStatus {
    return { ...this._statusState };
  }

  public subscribe(listener: TresBasesListener): () => void {
    this._listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this._listeners.delete(listener);
    };
  }

  private _notificar(): void {
    this._statusState.ultimaVerificacao = new Date().toLocaleTimeString('pt-BR');
    const snap = this.getStatus();
    this._listeners.forEach((l) => {
      try {
        l(snap);
      } catch (e) {
        console.error(e);
      }
    });
  }

  /**
   * Sincroniza todas as 3 bases com o Firestore remoto.
   * Não sobrescreve nada se o dispositivo já estiver atualizado.
   */
  public async sincronizarTodasBases(filialId: string = '172'): Promise<{
    rub: { sucesso: boolean; mensagem: string };
    spcoi: { sucesso: boolean; mensagem: string };
    saeou: { sucesso: boolean; mensagem: string };
  }> {
    const resRub = await rubSyncService.verificarSincronizacaoComRemoto(filialId).then(() => ({
      sucesso: true,
      mensagem: 'BASE RUB verificada com sucesso',
    })).catch((e) => ({
      sucesso: false,
      mensagem: e?.message || 'Falha na verificação da BASE RUB',
    }));

    const resSpcoi = await spcoiSyncService.verificarSincronizacaoComRemoto(filialId).then(() => ({
      sucesso: true,
      mensagem: 'SPCOI007 verificado com sucesso',
    })).catch((e) => ({
      sucesso: false,
      mensagem: e?.message || 'Falha na verificação do SPCOI007',
    }));

    const resSaeou = await saeouSyncService.verificarSincronizacaoComRemoto(filialId).then(() => ({
      sucesso: true,
      mensagem: 'SAEOU060 verificado com sucesso',
    })).catch((e) => ({
      sucesso: false,
      mensagem: e?.message || 'Falha na verificação do SAEOU060',
    }));

    return { rub: resRub, spcoi: resSpcoi, saeou: resSaeou };
  }
}

export const baseSyncStatusService = new BaseSyncStatusService();

/**
 * Hook React conveniente para renderizar o estado unificado das 3 bases
 */
export function useTresBasesSyncStatus(): TresBasesStatus {
  const [status, setStatus] = useState<TresBasesStatus>(baseSyncStatusService.getStatus());

  useEffect(() => {
    return baseSyncStatusService.subscribe(setStatus);
  }, []);

  return status;
}
