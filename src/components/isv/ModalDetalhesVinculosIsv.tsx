import {
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Info,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import React from 'react';
import { ItemIsv, VinculoIndustriaItemIsv } from '../../types';

interface ModalDetalhesVinculosIsvProps {
  isOpen: boolean;
  onClose: () => void;
  item: ItemIsv | null;
}

export const ModalDetalhesVinculosIsv: React.FC<ModalDetalhesVinculosIsvProps> = ({
  isOpen,
  onClose,
  item,
}) => {
  if (!isOpen || !item) return null;

  const vinculos: VinculoIndustriaItemIsv[] = item.vinculos_detalhados || [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white p-5 border-b border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider bg-blue-600/90 text-white px-2 py-0.5 rounded font-mono">
                  {item.codigo_exibicao}
                </span>
                <span className="text-[10px] font-bold text-slate-300 uppercase bg-slate-800 px-2 py-0.5 rounded">
                  FILIAL 172
                </span>
                <span className="text-[10px] font-black text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800 uppercase">
                  {vinculos.length > 1
                    ? `${vinculos.length} Indústrias Vinculadas`
                    : '1 Indústria Vinculada'}
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-tight leading-snug pt-1">
                {item.descricao}
              </h3>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
              title="Fechar janela"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Dados operacionais do item */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 mt-3 border-t border-slate-800/80 text-xs">
            <div className="bg-slate-800/60 p-2 rounded-lg">
              <span className="text-[9px] text-slate-400 uppercase font-bold block">Embalagem</span>
              <strong className="text-white font-mono text-xs truncate block">{item.embalagem || 'UN'}</strong>
            </div>
            <div className="bg-slate-800/60 p-2 rounded-lg">
              <span className="text-[9px] text-slate-400 uppercase font-bold block">Estoque</span>
              <strong className="text-white font-mono text-xs truncate block">{item.estoque_formatado}</strong>
            </div>
            <div className="bg-slate-800/60 p-2 rounded-lg">
              <span className="text-[9px] text-slate-400 uppercase font-bold block">Dias Sem Venda</span>
              <strong className="text-amber-400 font-mono text-xs block">{item.dias_sem_venda} dias</strong>
            </div>
            <div className="bg-slate-800/60 p-2 rounded-lg">
              <span className="text-[9px] text-slate-400 uppercase font-bold block">Valor Estoque</span>
              <strong className="text-emerald-400 font-mono text-xs truncate block">{item.valor_estoque_formatado}</strong>
            </div>
          </div>
        </div>

        {/* Nota de Integridade Operacional */}
        <div className="p-3.5 bg-blue-50/70 border-b border-blue-100 flex items-start gap-2.5 text-xs text-blue-950">
          <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">
            <strong>Garantia de Integridade Contábil:</strong> Este produto possui múltiplos vínculos registrados na planilha SPCOI007. No módulo ISV, o estoque físico e o valor financeiro são contabilizados <strong>uma única vez</strong>, sem duplicações em relatórios ou rankings.
          </div>
        </div>

        {/* Corpo: Lista com rolagem dos vínculos por Indústria */}
        <div className="p-5 max-h-[55vh] overflow-y-auto space-y-3.5 bg-slate-50/50">
          <div className="flex items-center justify-between text-xs font-bold text-slate-600">
            <span className="uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-700" />
              Relação de Indústrias, CNPJs e Promotores Responsáveis:
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              {vinculos.length} {vinculos.length === 1 ? 'vínculo' : 'vínculos'}
            </span>
          </div>

          {vinculos.length === 0 ? (
            <div className="p-6 bg-white rounded-xl border border-slate-200 text-center space-y-1">
              <Building2 className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-700 uppercase">
                Nenhum vínculo detalhado encontrado
              </p>
              <p className="text-[11px] text-slate-500">
                O produto não possui CNPJ associado na base SPCOI007.
              </p>
            </div>
          ) : (
            vinculos.map((vinc, idx) => (
              <div
                key={`${vinc.cnpj || idx}_${idx}`}
                className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5 shadow-2xs hover:border-slate-300 transition-colors"
              >
                {/* Cabeçalho da Indústria */}
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-0.5 max-w-[80%]">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Indústria #{idx + 1}
                    </span>
                    <h4 className="text-sm font-black text-slate-900 uppercase leading-snug">
                      {vinc.nome_industria}
                    </h4>
                    {vinc.razao_social && vinc.razao_social !== vinc.nome_industria && (
                      <span className="text-[11px] text-slate-500 block truncate">
                        Razão Social: {vinc.razao_social}
                      </span>
                    )}
                  </div>

                  {vinc.cnpj ? (
                    <span className="text-[10px] font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 whitespace-nowrap">
                      CNPJ: {vinc.cnpj_formatado}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">
                      CNPJ não informado
                    </span>
                  )}
                </div>

                {/* Promotores e Agência vinculados especificamente a esta indústria */}
                <div className="pt-2 border-t border-slate-100">
                  <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5">
                    Responsabilidade de Atendimento:
                  </span>

                  {vinc.promotores && vinc.promotores.length > 0 ? (
                    <div className="space-y-1.5">
                      {vinc.promotores.map((p, pIdx) => (
                        <div
                          key={`${p.promotorNome}_${pIdx}`}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-50/60 border border-emerald-100 text-xs"
                        >
                          <div className="flex items-center gap-1.5">
                            <UserCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <span className="font-bold text-emerald-950 uppercase">
                              {p.promotorNome}
                            </span>
                          </div>

                          <div className="text-right">
                            {p.agenciaNome ? (
                              <span className="text-[10px] font-semibold text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                Agência: {p.agenciaNome}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">
                                Sem agência
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-2 rounded-lg bg-amber-50/70 border border-amber-200/80 text-xs flex items-center justify-between text-amber-900">
                      <span className="font-semibold text-[11px] flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Sem promotor vinculado a este CNPJ
                      </span>
                      <span className="text-[10px] text-amber-700">Sem agência</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Rodapé */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 font-medium">
            Módulo ISV — Filial 172 Cascavel
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider transition-colors shadow-xs cursor-pointer"
          >
            Fechar Detalhes
          </button>
        </div>
      </div>
    </div>
  );
};
