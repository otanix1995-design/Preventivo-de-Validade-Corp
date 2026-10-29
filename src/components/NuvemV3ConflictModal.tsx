import React from 'react';
import { AlertTriangle, Check, Layers, RefreshCw, X } from 'lucide-react';
import { ConflitoSincronizacao, nuvemSyncEngine } from '../services/nuvemSyncEngine';

interface NuvemV3ConflictModalProps {
  conflitos: ConflitoSincronizacao[];
  onClose: () => void;
}

export const NuvemV3ConflictModal: React.FC<NuvemV3ConflictModalProps> = ({ conflitos, onClose }) => {
  if (conflitos.length === 0) return null;

  const conflitoAtual = conflitos[0];

  const handleResolver = (decisao: 'MANTER_LOCAL' | 'ACEITAR_REMOTO' | 'MESCLAR_QUANTIDADES') => {
    nuvemSyncEngine.resolverConflito(conflitoAtual.id, decisao);
    if (conflitos.length <= 1) {
      onClose();
    }
  };

  const qtdLocal = conflitoAtual.versaoLocal?.quantidade_total_unidades ?? conflitoAtual.versaoLocal?.quantidade ?? 0;
  const qtdRemota = conflitoAtual.versaoRemota?.quantidade ?? conflitoAtual.versaoRemota?.quantidade_total_unidades ?? 0;
  const dataLocal = conflitoAtual.versaoLocal?.data_validade ?? conflitoAtual.versaoLocal?.dataVencimento ?? '-';
  const dataRemota = conflitoAtual.versaoRemota?.dataVencimento ?? conflitoAtual.versaoRemota?.data_validade ?? '-';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-amber-300 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-amber-500 text-slate-950 p-4 flex items-center justify-between border-b border-amber-600">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-slate-950 text-amber-400 rounded-lg">
              <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-tight">
                Divergência Concorrente Detectada
              </h3>
              <p className="text-[11px] font-bold text-amber-950">
                Pendente {conflitos.length} de {conflitos.length} — Resolução segura obrigatória
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-950 hover:bg-amber-600/30 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="bg-amber-50 rounded-xl p-3.5 border border-amber-200 text-xs text-amber-900 leading-relaxed">
            <p className="font-bold">
              Outro terminal da filial 172 gravou alterações neste mesmo lote enquanto este dispositivo estava operando.
            </p>
            <p className="mt-1 text-slate-600">
              Para evitar perda de contagens e garantir a integridade dos dados, escolha como prosseguir:
            </p>
          </div>

          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200">
            <p className="text-[11px] font-mono font-bold text-[#C94F00]">
              CÓD: {conflitoAtual.codigoInterno}
            </p>
            <h4 className="text-xs font-black uppercase text-slate-900 mt-0.5">
              {conflitoAtual.descricao}
            </h4>
          </div>

          {/* Comparativo de Versões */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-blue-50/60 rounded-xl p-3 border border-blue-200 space-y-2">
              <span className="text-[10px] font-black uppercase text-blue-800 px-2 py-0.5 bg-blue-100 rounded">
                Versão Este Dispositivo
              </span>
              <div>
                <p className="text-[11px] text-slate-500">Quantidade:</p>
                <p className="text-base font-black text-blue-900">{qtdLocal} UN</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Validade:</p>
                <p className="font-mono font-bold text-slate-800">{dataLocal}</p>
              </div>
            </div>

            <div className="bg-purple-50/60 rounded-xl p-3 border border-purple-200 space-y-2">
              <span className="text-[10px] font-black uppercase text-purple-800 px-2 py-0.5 bg-purple-100 rounded">
                Versão Outro Terminal (Nuvem)
              </span>
              <div>
                <p className="text-[11px] text-slate-500">Quantidade:</p>
                <p className="text-base font-black text-purple-900">{qtdRemota} UN</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Validade:</p>
                <p className="font-mono font-bold text-slate-800">{dataRemota}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => handleResolver('MANTER_LOCAL')}
            className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer"
          >
            Manter Local ({qtdLocal} UN)
          </button>
          <button
            onClick={() => handleResolver('ACEITAR_REMOTO')}
            className="flex-1 py-2.5 px-3 bg-purple-600 hover:bg-purple-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer"
          >
            Aceitar Nuvem ({qtdRemota} UN)
          </button>
          <button
            onClick={() => handleResolver('MESCLAR_QUANTIDADES')}
            className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer"
            title="Soma as duas contagens registradas"
          >
            Mesclar (+{qtdLocal + qtdRemota} UN)
          </button>
        </div>
      </div>
    </div>
  );
};
