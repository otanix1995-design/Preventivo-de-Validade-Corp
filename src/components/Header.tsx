import {
  Calendar,
  Camera,
  Cloud,
  CloudOff,
  Database,
  RefreshCw,
  Search,
  Sparkles
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { cloudSyncService, SyncStatusInfo } from '../services/cloudSyncService';
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
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  useEffect(() => {
    const unsub = cloudSyncService.subscribeStatus(setSyncStatus);
    return unsub;
  }, []);

  const handleManualSync = async () => {
    if (isManualSyncing || syncStatus.state === 'syncing') return;
    setIsManualSyncing(true);
    try {
      await productRepository.syncWithCloud();
    } catch (e) {
      console.warn('Sync failed:', e);
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

          {/* Cloud Sync Button & Status */}
          <button
            id="header-btn-cloud-sync"
            onClick={handleManualSync}
            disabled={isSyncing}
            title={
              syncStatus.state === 'connected'
                ? `Nuvem Conectada. Última sincronização: ${syncStatus.lastSyncTime || 'agora'}. Clique para atualizar dados da nuvem.`
                : syncStatus.state === 'syncing'
                ? 'Sincronizando com a nuvem...'
                : syncStatus.message || 'Clique para sincronizar com a nuvem'
            }
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wide transition-all border shrink-0 ${
              syncStatus.state === 'connected'
                ? 'bg-blue-800/80 hover:bg-blue-800 text-blue-100 border-blue-400/40 hover:border-blue-300'
                : syncStatus.state === 'syncing'
                ? 'bg-amber-500/20 text-amber-200 border-amber-400/40 animate-pulse'
                : syncStatus.state === 'offline'
                ? 'bg-rose-500/20 text-rose-200 border-rose-400/40'
                : 'bg-blue-800/40 text-blue-200 border-blue-500/30'
            }`}
          >
            {isSyncing ? (
              <RefreshCw className="w-4 h-4 animate-spin text-amber-300" />
            ) : syncStatus.state === 'offline' ? (
              <CloudOff className="w-4 h-4 text-rose-300" />
            ) : (
              <Cloud className="w-4 h-4 text-emerald-300" />
            )}
            <span className="hidden sm:inline">
              {isSyncing
                ? 'Sincronizando...'
                : syncStatus.state === 'connected'
                ? 'Nuvem'
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
    </header>
  );
};
