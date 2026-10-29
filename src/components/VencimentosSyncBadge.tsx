import React, { useState, useEffect } from 'react';
import { CheckCircle2, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import { nuvemSyncEngine, EstadoSincronizacaoLote } from '../services/nuvemSyncEngine';
import { LoteVencimento } from '../types';

interface VencimentosSyncBadgeProps {
  lote: LoteVencimento;
  compact?: boolean;
}

export const VencimentosSyncBadge: React.FC<VencimentosSyncBadgeProps> = ({ lote, compact = false }) => {
  const [syncInfo, setSyncInfo] = useState(() => nuvemSyncEngine.getStatusLote(lote.id, lote));
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    const unsub = nuvemSyncEngine.subscribe(() => {
      setSyncInfo(nuvemSyncEngine.getStatusLote(lote.id, lote));
    });
    return () => unsub();
  }, [lote.id, lote]);

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRetrying || syncInfo.status === 'ENVIANDO') return;
    setIsRetrying(true);
    try {
      await nuvemSyncEngine.processarFila();
    } finally {
      setIsRetrying(false);
    }
  };

  if (compact) {
    if (syncInfo.status === 'SINCRONIZADO') {
      return (
        <span
          title="Sincronizado e confirmado na nuvem"
          className="inline-flex items-center text-emerald-600"
        >
          <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" />
        </span>
      );
    }
    if (syncInfo.status === 'ENVIANDO' || isRetrying) {
      return (
        <span
          title="Enviando para a nuvem..."
          className="inline-flex items-center text-sky-500 animate-spin"
        >
          <RefreshCw className="w-3.5 h-3.5 stroke-[2.5]" />
        </span>
      );
    }
    if (syncInfo.status === 'ERRO') {
      return (
        <button
          type="button"
          onClick={handleRetry}
          title={`Erro de sincronização: ${syncInfo.erro || 'Falha de comunicação'}. Clique para retentar.`}
          className="inline-flex items-center text-rose-500 hover:text-rose-700 cursor-pointer"
        >
          <AlertCircle className="w-3.5 h-3.5 stroke-[2.5]" />
        </button>
      );
    }
    return (
      <span
        title="Salvo no dispositivo — pendente de sincronização"
        className="inline-flex items-center text-amber-500"
      >
        <Clock className="w-3.5 h-3.5 stroke-[2.5]" />
      </span>
    );
  }

  // Full Badge
  switch (syncInfo.status) {
    case 'SINCRONIZADO':
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs"
          title="Registro sincronizado e confirmado no servidor central"
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
          <span>Sincronizado</span>
        </span>
      );

    case 'ENVIANDO':
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-sky-50 text-sky-700 border border-sky-200 shadow-2xs animate-pulse"
          title="Enviando atualização para o servidor central..."
        >
          <RefreshCw className="w-3 h-3 text-sky-600 animate-spin stroke-[2.5]" />
          <span>Enviando...</span>
        </span>
      );

    case 'ERRO':
      return (
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 shadow-2xs transition-all cursor-pointer"
          title={`Erro de sincronização: ${syncInfo.erro || 'Comunicação falhou'}. Clique para reenviar agora.`}
        >
          <AlertCircle className="w-3 h-3 text-rose-600 stroke-[2.5]" />
          <span>Erro Sync (Retentar)</span>
        </button>
      );

    case 'PENDENTE':
    default:
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-300 shadow-2xs"
          title="Salvo no dispositivo localmente com garantia de persistência. Será enviado automaticamente ao conectar."
        >
          <Clock className="w-3 h-3 text-amber-600 stroke-[2.5]" />
          <span>Salvo no disp. (Pendente)</span>
        </span>
      );
  }
};
