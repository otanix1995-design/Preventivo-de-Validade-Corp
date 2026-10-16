import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  PackageX,
  User,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { isvService } from '../../services/isvService';
import { ItemIsv, SolicitacaoAjusteIsv } from '../../types';

interface ModalRegistrarAjusteIsvProps {
  isOpen: boolean;
  onClose: () => void;
  item: ItemIsv | null;
  onSuccess?: (solicitacao: SolicitacaoAjusteIsv) => void;
}

export const ModalRegistrarAjusteIsv: React.FC<ModalRegistrarAjusteIsvProps> = ({
  isOpen,
  onClose,
  item,
  onSuccess,
}) => {
  const [responsavel, setResponsavel] = useState('Prevenção de Perdas');
  const [observacao, setObservacao] = useState(
    'Produto consta em estoque no sistema SMGOI013, porém não foi localizado fisicamente na área de vendas nem no depósito.'
  );
  const [isSaving, setIsSaving] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  if (!isOpen || !item) return null;

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responsavel.trim()) return;

    setIsSaving(true);
    try {
      const nova = await isvService.addSolicitacaoAjuste({
        codigo_interno: item.codigo_interno,
        digito: item.digito,
        codigo_exibicao: item.codigo_exibicao,
        descricao: item.descricao,
        estoque_registrado: item.estoque_total,
        estoque_texto: item.estoque_formatado,
        observacao: observacao.trim(),
        responsavel: responsavel.trim(),
      });

      setFeedbackSuccess('Ocorrência de verificação física registrada com sucesso!');
      if (onSuccess) onSuccess(nova);
      setTimeout(() => {
        setFeedbackSuccess(null);
        onClose();
      }, 1200);
    } catch (err: any) {
      console.error('Erro ao registrar ajuste:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      id="modal-registrar-ajuste-isv-overlay"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto animate-scaleUp">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-700 via-amber-800 to-amber-900 text-white p-4 sm:p-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/15 rounded-xl border border-white/20">
              <PackageX className="w-6 h-6 text-amber-200 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black tracking-tight uppercase">
                  Registrar Verificação Física
                </h3>
                <span className="text-[10px] font-bold bg-amber-500/30 text-amber-100 px-2 py-0.5 rounded-full border border-amber-400/40 uppercase">
                  ISV
                </span>
              </div>
              <p className="text-xs text-amber-100 font-medium mt-0.5">
                Produto não localizado fisicamente na loja / depósito
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSalvar} className="p-5 space-y-4 text-xs text-slate-700">
          {/* Card Produto */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center gap-2 flex-wrap font-mono text-[11px]">
              <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                CÓD: {item.codigo_exibicao}
              </span>
              <span className="font-bold text-slate-700 bg-slate-200 px-2 py-0.5 rounded">
                EMB: {item.embalagem}
              </span>
              <span className="font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-200">
                {item.dias_sem_venda} DIAS SEM VENDA
              </span>
            </div>
            <h4 className="text-sm font-black text-slate-900 uppercase">
              {item.descricao}
            </h4>
            <div className="flex items-center justify-between pt-1 border-t border-slate-200 text-xs">
              <span className="text-slate-500">Estoque Registrado SMGOI013:</span>
              <span className="font-mono font-black text-slate-800">
                {item.estoque_formatado}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Valor do Estoque (Custo Médio):</span>
              <span className="font-mono font-bold text-slate-800">
                {item.valor_estoque_formatado}
              </span>
            </div>
          </div>

          {/* Alerta de Operação Não Destrutiva */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-amber-900 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Atenção:</strong> Este registro é interno para auditoria e conferência da equipe de prevenção. Ele <strong>não altera</strong> as quantidades da SMGOI013 e não realiza exclusão de produtos.
            </p>
          </div>

          {/* Responsável */}
          <div className="space-y-1">
            <label className="block text-xs font-black uppercase text-slate-700">
              Responsável pelo Registro:
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                required
                value={responsavel}
                onChange={(e) => setResponsavel(e.target.value)}
                placeholder="Ex: Prevenção de Perdas / Líder Frios"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:border-amber-600 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Observação / Motivo */}
          <div className="space-y-1">
            <label className="block text-xs font-black uppercase text-slate-700">
              Observação / Detalhes da Averiguação:
            </label>
            <textarea
              rows={3}
              required
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Descreva onde o produto foi procurado (área de vendas, câmara, gôndola, aéreo)..."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-900 focus:bg-white focus:border-amber-600 focus:outline-hidden"
            />
          </div>

          {feedbackSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 flex items-center gap-2 font-bold text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{feedbackSuccess}</span>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 transition-colors uppercase text-xs"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-black transition-colors uppercase text-xs flex items-center gap-1.5 shadow-md active:scale-95"
            >
              {isSaving ? 'Gravando...' : 'Salvar Registro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
