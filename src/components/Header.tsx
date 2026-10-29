import {
  Calendar,
  Camera,
  CheckCircle2,
  Cloud,
  CloudOff,
  Database,
  RefreshCw,
  Search,
  Sparkles
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { cloudSyncService, SyncStatusInfo } from '../services/cloudSyncService';
import { syncQueueService } from '../services/syncQueueService';
import { productRepository } from '../services/productRepository';
import { isFirestoreQuotaExceeded } from '../services/firebase';
import { nuvemSyncEngine } from '../services/nuvemSyncEngine';
import { MetadadosBase } from '../types';

interface HeaderProps {
  filial?: string;
  statusBase?: string;
  metadados?: MetadadosBase;
  onOpenScanner: () => void;
  onQuickSearchClick?: () => void;
  onOpenSincronizacaoCentral?: () => void;
  currentTabName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  filial = 'FILIAL 172 - CASCAVEL',
  statusBase,
  metadados,
  onOpenScanner,
  onQuickSearchClick,
  onOpenSincronizacaoCentral,
  currentTabName,
}) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>(cloudSyncService.getStatus());
  const [pendingCount, setPendingCount] = useState<number>(() => syncQueueService.getPendingCount());
  const [nuvemContadores, setNuvemContadores] = useState(() => nuvemSyncEngine.getContadores());
  const [hasErrors, setHasErrors] = useState<boolean>(() => syncQueueService.hasErrors());
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  useEffect(() => {
    const unsubCloud = cloudSyncService.subscribeStatus(setSyncStatus);
    const unsubQueue = syncQueueService.subscribe(() => {
      setPendingCount(syncQueueService.getPendingCount());
      setHasErrors(syncQueueService.hasErrors());
    });
    const unsubNuvem = nuvemSyncEngine.subscribe(() => {
      setNuvemContadores(nuvemSyncEngine.getContadores());
    });
    return () => {
      unsubCloud();
      unsubQueue();
      unsubNuvem();
    };
  }, []);

  const handleManualSync = async () => {
    if (isManualSyncing || syncStatus.state === 'syncing') return;
    if (isFirestoreQuotaExceeded()) {
      setSyncToast('Cota temporariamente indisponível. Operações continuam seguras e salvas localmente.');
      setTimeout(() => setSyncToast(null), 4500);
      return;
    }
    setIsManualSyncing(true);
    try {
      // 1. Processar pendências locais primeiro
      await syncQueueService.processQueue();
      // 2. Puxar alterações mais recentes da nuvem
      await cloudSyncService.pullVencimentosFromCloud();
      // 3. Sincronizar catálogo/geral
      const res = await productRepository.syncWithCloud();
      setSyncToast(res.message || 'Sincronização concluída com sucesso.');
      setTimeout(() => setSyncToast(null), 4500);
    } catch (e: any) {
      console.warn('Sync failed:', e);
      setSyncToast('Erro ao sincronizar com a nuvem.');
      setTimeout(() => setSyncToast(null), 4500);
    } finally {
      setIsManualSyncing(false);
    }
  };

  const totalProdutos = metadados?.total_produtos ?? 0;
  const currentStatus = totalProdutos === 0 ? 'VAZIA' : (statusBase || metadados?.status_base || 'BASE_RUB');
  const isDemo = currentStatus === 'DEMO' && totalProdutos > 0;
  const ultimaAtualizacao = metadados?.ultima_atualizacao_base_rub || metadados?.ultima_atualizacao_smgoi013;

  const isSyncing = syncStatus.state === 'syncing' || isManualSyncing;

  return (
    <header
      id="app-header"
      className="sticky top-0 z-30 bg-[#F36B0B] text-white shadow-lg border-b border-[#C94F00] select-none flex-none"
    >
      {/* Top Banner with Bold Typography */}
      <div className="px-4 py-3.5 flex items-center justify-between gap-3 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center border border-white/25 shadow-xs shrink-0">
            <Calendar className="w-5 h-5 text-white stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-xl font-black tracking-tight uppercase leading-tight">
                ISV | INTELIGÊNCIA DE ESTOQUE
              </h1>
              {isDemo && (
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-400 text-slate-950 uppercase tracking-wider shadow-xs flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  DEMO
                </span>
              )}
            </div>
            <p className="text-xs text-orange-100 font-bold uppercase tracking-wider mt-0.5">
              FILIAL 172 — CASCAVEL <span className="opacity-80 font-normal">| BASE DO RUB</span>
            </p>
          </div>
        </div>

        {/* Right side info & actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {ultimaAtualizacao && (
            <div className="hidden md:block text-right">
              <p className="text-[10px] uppercase font-bold text-orange-100 tracking-wider">
                Última Atualização
              </p>
              <p className="text-xs font-mono font-bold text-white">
                {ultimaAtualizacao}
              </p>
            </div>
          )}

          {onQuickSearchClick && (
            <button
              id="header-btn-search"
              onClick={onQuickSearchClick}
              aria-label="Buscar"
              className="p-2 rounded-xl bg-white/15 hover:bg-white/25 active:bg-white/30 text-white transition-colors"
            >
              <Search className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}

          {/* Cloud Sync Button & Status - Requisito 19 / Requisito 7 */}
          <button
            id="header-btn-cloud-sync"
            onClick={() => {
              if (onOpenSincronizacaoCentral) {
                onOpenSincronizacaoCentral();
              } else {
                handleManualSync();
              }
            }}
            disabled={isSyncing}
            title={
              isSyncing
                ? 'Sincronizando dados com a nuvem...'
                : isFirestoreQuotaExceeded()
                ? 'Cota diária da nuvem atingida. Modo local ativo com IndexedDB 100% seguro.'
                : hasErrors || nuvemContadores.erros > 0
                ? 'Erro de sincronização. Clique para tentar novamente.'
                : (pendingCount + nuvemContadores.pendentes) > 0
                ? `${pendingCount + nuvemContadores.pendentes} alteraç${(pendingCount + nuvemContadores.pendentes) > 1 ? 'ões pendentes' : 'ão pendente'} na fila local.`
                : syncStatus.state === 'connected'
                ? `Nuvem conectada e sincronizada (${syncStatus.lastSyncTime || 'recente'}).`
                : 'Sem conexão com a nuvem. Modo offline ativo.'
            }
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wide transition-all border shrink-0 cursor-pointer ${
              isSyncing
                ? 'bg-amber-500/25 text-amber-100 border-amber-300/50 animate-pulse'
                : isFirestoreQuotaExceeded()
                ? 'bg-cyan-900/40 hover:bg-cyan-900/50 text-cyan-100 border-cyan-400/40'
                : hasErrors || nuvemContadores.erros > 0
                ? 'bg-rose-500/25 hover:bg-rose-500/35 text-rose-100 border-rose-300/50'
                : (pendingCount + nuvemContadores.pendentes) > 0
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border-amber-300/40'
                : syncStatus.state === 'connected'
                ? 'bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-100 border-emerald-300/50 hover:border-emerald-200 shadow-xs'
                : syncStatus.state === 'connecting'
                ? 'bg-white/20 text-orange-100 border-white/30'
                : 'bg-slate-700/40 hover:bg-slate-700/50 text-slate-200 border-slate-500/40'
            }`}
          >
            {isSyncing ? (
              <RefreshCw className="w-4 h-4 animate-spin text-amber-300" />
            ) : isFirestoreQuotaExceeded() ? (
              <Database className="w-4 h-4 text-cyan-300" />
            ) : hasErrors || nuvemContadores.erros > 0 ? (
              <CloudOff className="w-4 h-4 text-rose-300" />
            ) : (pendingCount + nuvemContadores.pendentes) > 0 ? (
              <RefreshCw className="w-4 h-4 text-amber-300" />
            ) : syncStatus.state === 'connected' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            ) : syncStatus.state === 'connecting' ? (
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
            ) : (
              <CloudOff className="w-4 h-4 text-slate-300" />
            )}
            <span className="inline">
              {isSyncing
                ? 'Sincronizando...'
                : isFirestoreQuotaExceeded()
                ? 'Modo Local (Cota)'
                : hasErrors || nuvemContadores.erros > 0
                ? 'Erro Nuvem'
                : (pendingCount + nuvemContadores.pendentes) > 0
                ? `${pendingCount + nuvemContadores.pendentes} pendência${(pendingCount + nuvemContadores.pendentes) > 1 ? 's' : ''}`
                : syncStatus.state === 'connected'
                ? '✓ Sincronizado'
                : syncStatus.state === 'connecting'
                ? 'Conectando...'
                : 'Offline'}
            </span>
          </button>

          <button
            id="header-btn-scanner"
            onClick={onOpenScanner}
            className="flex items-center gap-1.5 bg-white text-[#C94F00] hover:bg-orange-50 active:bg-orange-100 px-3.5 py-2 rounded-xl font-black text-xs uppercase tracking-wide shadow-md shadow-orange-950/20 transition-all active:scale-95 shrink-0 cursor-pointer"
          >
            <Camera className="w-4 h-4 text-[#C94F00] stroke-[2.5]" />
            <span>Ler EAN</span>
          </button>
        </div>
      </div>

      {/* Subheader bar with operational status in Bold Typography */}
      <div className="bg-[#C94F00] px-4 py-1.5 text-[11px] text-orange-100 flex items-center justify-between border-t border-orange-400/30 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 truncate">
          <Database className="w-3.5 h-3.5 text-orange-200 shrink-0" />
          <span className="truncate">
            <strong className="text-white font-black">
              {currentStatus === 'SMGOI013' || currentStatus === 'BASE_RUB' ? 'BASE DO RUB' : `BASE: ${currentStatus}`}
            </strong>
            {ultimaAtualizacao && (
              <span className="text-orange-200 ml-1.5 font-mono text-[10px]">
                ({ultimaAtualizacao})
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {metadados?.total_produtos !== undefined && (
            <>
              <span className="text-orange-200 font-bold">
                <strong className="text-white font-black">{metadados.total_produtos}</strong> prods
              </span>
              <span className="w-1 h-1 rounded-full bg-orange-300"></span>
            </>
          )}
          <span className="text-white font-bold uppercase tracking-wider text-[10px]">
            {currentTabName || 'OPERACIONAL'}
          </span>
        </div>
      </div>

      {/* Sync Toast Feedback */}
      {syncToast && (
        <div className="bg-slate-900 text-white border-t border-b border-orange-500/30 px-4 py-2 text-xs flex items-center justify-between gap-3 shadow-md animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
            <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-semibold text-orange-100">{syncToast}</span>
          </div>
        </div>
      )}
    </header>
  );
};
