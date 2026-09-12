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
import { MetadadosBase } from '../types';

interface HeaderProps {
  filial?: string;
  statusBase?: string;
  metadados?: MetadadosBase;
  onOpenScanner: () => void;
  onQuickSearchClick?: () => void;
  currentTabName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  filial = 'FILIAL 172 - CASCAVEL',
  statusBase,
  metadados,
  onOpenScanner,
  onQuickSearchClick,
  currentTabName,
}) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>(cloudSyncService.getStatus());
  const [pendingCount, setPendingCount] = useState<number>(() => syncQueueService.getPendingCount());
  const [hasErrors, setHasErrors] = useState<boolean>(() => syncQueueService.hasErrors());
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  useEffect(() => {
    const unsubCloud = cloudSyncService.subscribeStatus(setSyncStatus);
    const unsubQueue = syncQueueService.subscribe(() => {
      setPendingCount(syncQueueService.getPendingCount());
      setHasErrors(syncQueueService.hasErrors());
    });
    return () => {
      unsubCloud();
      unsubQueue();
    };
  }, []);

  const handleManualSync = async () => {
    if (isManualSyncing || syncStatus.state === 'syncing') return;
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
  const currentStatus = totalProdutos === 0 ? 'VAZIA' : (statusBase || metadados?.status_base || 'DEMO');
  const isDemo = currentStatus === 'DEMO' && totalProdutos > 0;
  const ultimaAtualizacao = metadados?.ultima_atualizacao_smgoi013;

  const isSyncing = syncStatus.state === 'syncing' || isManualSyncing;

  return (
    <header
      id="app-header"
      className="sticky top-0 z-30 bg-blue-700 text-white shadow-lg border-b border-blue-800 select-none flex-none"
    >
      {/* Top Banner with Bold Typography */}
      <div className="px-4 py-3.5 flex items-center justify-between gap-3 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shadow-xs shrink-0">
            <Calendar className="w-5 h-5 text-white stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black tracking-tight uppercase leading-tight">
                Controle de Vencimentos
              </h1>
              {isDemo && (
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-400 text-slate-950 uppercase tracking-wider shadow-xs flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  DEMO
                </span>
              )}
            </div>
            <p className="text-xs text-blue-200 font-bold uppercase tracking-wider mt-0.5">
              {filial} <span className="opacity-75 font-normal">| SMGOI013</span>
            </p>
          </div>
        </div>

        {/* Right side info & actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {ultimaAtualizacao && (
            <div className="hidden md:block text-right">
              <p className="text-[10px] uppercase font-bold text-blue-200 tracking-wider">
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
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors"
            >
              <Search className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}

          {/* Cloud Sync Button & Status - Requisito 19 */}
          <button
            id="header-btn-cloud-sync"
            onClick={handleManualSync}
            disabled={isSyncing}
            title={
              isSyncing
                ? 'Sincronizando dados com a nuvem...'
                : hasErrors
                ? 'Erro de sincronização. Clique para tentar novamente.'
                : pendingCount > 0
                ? `${pendingCount} alteraç${pendingCount > 1 ? 'ões pendentes' : 'ão pendente'} na fila local. Clique para sincronizar.`
                : syncStatus.state === 'connected'
                ? `Nuvem conectada e sincronizada. Última checagem: ${syncStatus.lastSyncTime || 'agora'}. Clique para forçar sincronização.`
                : syncStatus.state === 'offline'
                ? 'Sem conexão com a nuvem. Modo offline ativo.'
                : syncStatus.message || 'Clique para sincronizar com a nuvem'
            }
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wide transition-all border shrink-0 cursor-pointer ${
              isSyncing
                ? 'bg-amber-500/25 text-amber-200 border-amber-400/50 animate-pulse'
                : hasErrors
                ? 'bg-rose-500/25 hover:bg-rose-500/35 text-rose-200 border-rose-400/50'
                : pendingCount > 0
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-400/40'
                : syncStatus.state === 'connected'
                ? 'bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-100 border-emerald-400/50 hover:border-emerald-300 shadow-xs'
                : syncStatus.state === 'connecting'
                ? 'bg-blue-500/25 text-blue-200 border-blue-400/50'
                : 'bg-rose-500/25 hover:bg-rose-500/35 text-rose-200 border-rose-400/50'
            }`}
          >
            {isSyncing ? (
              <RefreshCw className="w-4 h-4 animate-spin text-amber-300" />
            ) : hasErrors ? (
              <CloudOff className="w-4 h-4 text-rose-300" />
            ) : pendingCount > 0 ? (
              <RefreshCw className="w-4 h-4 text-amber-300" />
            ) : syncStatus.state === 'connected' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            ) : syncStatus.state === 'connecting' ? (
              <RefreshCw className="w-4 h-4 animate-spin text-blue-300" />
            ) : (
              <CloudOff className="w-4 h-4 text-rose-300" />
            )}
            <span className="inline">
              {isSyncing
                ? 'Sincronizando...'
                : hasErrors
                ? 'Erro Nuvem'
                : pendingCount > 0
                ? `${pendingCount} pendência${pendingCount > 1 ? 's' : ''}`
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
            className="flex items-center gap-1.5 bg-white text-blue-700 hover:bg-blue-50 active:bg-blue-100 px-3.5 py-2 rounded-xl font-black text-xs uppercase tracking-wide shadow-md shadow-blue-900/20 transition-all active:scale-95 shrink-0"
          >
            <Camera className="w-4 h-4 text-blue-700 stroke-[2.5]" />
            <span>Ler EAN</span>
          </button>
        </div>
      </div>

      {/* Subheader bar with operational status in Bold Typography */}
      <div className="bg-blue-800/90 px-4 py-1.5 text-[11px] text-blue-100 flex items-center justify-between border-t border-blue-600/40 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 truncate">
          <Database className="w-3.5 h-3.5 text-blue-300 shrink-0" />
          <span className="truncate">
            <span className="uppercase font-bold text-blue-200">Base:</span>{' '}
            <strong className="text-white font-black">{currentStatus}</strong>
            {ultimaAtualizacao && (
              <span className="text-blue-200 ml-1.5 font-mono text-[10px]">
                ({ultimaAtualizacao})
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {metadados?.total_produtos !== undefined && (
            <>
              <span className="text-blue-200 font-bold">
                <strong className="text-white font-black">{metadados.total_produtos}</strong> prods
              </span>
              <span className="w-1 h-1 rounded-full bg-blue-300"></span>
            </>
          )}
          <span className="text-white font-bold uppercase tracking-wider text-[10px]">
            {currentTabName || 'OPERACIONAL'}
          </span>
        </div>
      </div>

      {/* Sync Toast Feedback */}
      {syncToast && (
        <div className="bg-blue-950 text-white border-t border-b border-blue-500/30 px-4 py-2 text-xs flex items-center justify-between gap-3 shadow-md animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
            <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-semibold text-blue-100">{syncToast}</span>
          </div>
        </div>
      )}
    </header>
  );
};
