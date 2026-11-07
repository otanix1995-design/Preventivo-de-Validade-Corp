import React, { useMemo } from 'react';
import { ItemIsv } from '../../types';
import {
  calcularTotaisClassificacao,
  ClassificacaoDiasSemVenda,
  DEFINICOES_CLASSIFICACAO,
} from '../../services/isvClassificacaoService';
import {
  AlertTriangle,
  Flame,
  Clock,
  CheckCircle2,
  Filter,
  BarChart3,
  Package,
  DollarSign,
  FileText,
  RotateCcw,
} from 'lucide-react';

interface GraficoMercadoriasSemVendaProps {
  itens: ItemIsv[];
  filtroClassificacaoAtivo?: ClassificacaoDiasSemVenda | null;
  onSelecionarClassificacao?: (classificacao: ClassificacaoDiasSemVenda | null) => void;
  onAbrirTop30?: () => void;
  onGerarPdfTop30?: () => void;
}

export const GraficoMercadoriasSemVenda: React.FC<GraficoMercadoriasSemVendaProps> = ({
  itens,
  filtroClassificacaoAtivo = null,
  onSelecionarClassificacao,
  onAbrirTop30,
  onGerarPdfTop30,
}) => {
  const resumo = useMemo(() => calcularTotaisClassificacao(itens), [itens]);

  const cards = [
    {
      tipo: 'CRITICO' as ClassificacaoDiasSemVenda,
      dados: resumo.critico,
      icon: Flame,
      corFundo: 'bg-red-50 hover:bg-red-100/80',
      corBorda: 'border-red-200 hover:border-red-400',
      corBordaAtiva: 'ring-2 ring-red-500 border-red-500 bg-red-100/90 shadow-md',
      corBadge: 'bg-red-600 text-white',
      corTexto: 'text-red-700',
      corTextoDestaque: 'text-red-800',
      corBarra: '#DC2626',
    },
    {
      tipo: 'ALERTA' as ClassificacaoDiasSemVenda,
      dados: resumo.alerta,
      icon: AlertTriangle,
      corFundo: 'bg-orange-50 hover:bg-orange-100/80',
      corBorda: 'border-orange-200 hover:border-orange-400',
      corBordaAtiva: 'ring-2 ring-orange-500 border-orange-500 bg-orange-100/90 shadow-md',
      corBadge: 'bg-orange-600 text-white',
      corTexto: 'text-orange-700',
      corTextoDestaque: 'text-orange-800',
      corBarra: '#EA580C',
    },
    {
      tipo: 'ATENCAO' as ClassificacaoDiasSemVenda,
      dados: resumo.atencao,
      icon: Clock,
      corFundo: 'bg-yellow-50 hover:bg-yellow-100/80',
      corBorda: 'border-yellow-200 hover:border-yellow-400',
      corBordaAtiva: 'ring-2 ring-yellow-500 border-yellow-500 bg-yellow-100/90 shadow-md',
      corBadge: 'bg-yellow-500 text-slate-900',
      corTexto: 'text-yellow-800',
      corTextoDestaque: 'text-yellow-900',
      corBarra: '#CA8A04',
    },
    {
      tipo: 'GIRO_NORMAL' as ClassificacaoDiasSemVenda,
      dados: resumo.giroNormal,
      icon: CheckCircle2,
      corFundo: 'bg-emerald-50 hover:bg-emerald-100/80',
      corBorda: 'border-emerald-200 hover:border-emerald-400',
      corBordaAtiva: 'ring-2 ring-emerald-500 border-emerald-500 bg-emerald-100/90 shadow-md',
      corBadge: 'bg-emerald-600 text-white',
      corTexto: 'text-emerald-700',
      corTextoDestaque: 'text-emerald-800',
      corBarra: '#16A34A',
    },
  ];

  const handleCardClick = (tipo: ClassificacaoDiasSemVenda) => {
    if (!onSelecionarClassificacao) return;
    if (filtroClassificacaoAtivo === tipo) {
      onSelecionarClassificacao(null);
    } else {
      onSelecionarClassificacao(tipo);
    }
  };

  const formatarMoeda = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const formatarNumero = (val: number) => {
    return new Intl.NumberFormat('pt-BR').format(val);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5 mb-6 space-y-4">
      {/* Cabeçalho do Gráfico / Indicadores */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-slate-900 text-amber-400 shadow-sm">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-wide uppercase flex items-center gap-2">
              Distribuição Oficial por Dias Sem Venda
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 lowercase">
                base rub • estoque &gt; 0
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Classificação das mercadorias com 5 ou mais dias sem giro na Filial 172 — Cascavel
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {filtroClassificacaoAtivo && (
            <button
              onClick={() => onSelecionarClassificacao && onSelecionarClassificacao(null)}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 transition-colors border border-slate-300"
              title="Limpar filtro de classificação"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Limpar Filtro ({DEFINICOES_CLASSIFICACAO[filtroClassificacaoAtivo].rotulo})
            </button>
          )}

          {onAbrirTop30 && (
            <button
              onClick={onAbrirTop30}
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-amber-300 hover:bg-amber-400 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Package className="w-3.5 h-3.5" />
              Ver TOP 30
            </button>
          )}

          {onGerarPdfTop30 && (
            <button
              onClick={onGerarPdfTop30}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <FileText className="w-3.5 h-3.5 text-orange-400" />
              PDF TOP 30
            </button>
          )}
        </div>
      </div>

      {/* Barra de Distribuição Visual Proporcional (Segmented Progress Bar) */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs text-slate-600 font-medium">
          <span>Proporção do Estoque Parado (&ge; 5 dias)</span>
          <span className="text-slate-900 font-bold">
            {formatarNumero(resumo.totalElegiveis)} produtos ({formatarNumero(resumo.totalEstoqueElegiveis)} un.)
          </span>
        </div>

        <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner border border-slate-200">
          {resumo.totalElegiveis === 0 ? (
            <div className="w-full h-full bg-slate-200 flex items-center justify-center text-[10px] text-slate-500">
              Nenhum produto com mais de 5 dias sem venda e estoque positivo
            </div>
          ) : (
            <>
              {resumo.critico.totalProdutos > 0 && (
                <div
                  style={{ width: `${resumo.critico.porcentagemDoTotal}%`, backgroundColor: '#DC2626' }}
                  className="h-full transition-all duration-300 relative group cursor-pointer"
                  onClick={() => handleCardClick('CRITICO')}
                  title={`Crítico (21+ dias): ${resumo.critico.totalProdutos} produtos (${resumo.critico.porcentagemDoTotal.toFixed(1)}%)`}
                />
              )}
              {resumo.alerta.totalProdutos > 0 && (
                <div
                  style={{ width: `${resumo.alerta.porcentagemDoTotal}%`, backgroundColor: '#EA580C' }}
                  className="h-full transition-all duration-300 relative group cursor-pointer"
                  onClick={() => handleCardClick('ALERTA')}
                  title={`Alerta (16-20 dias): ${resumo.alerta.totalProdutos} produtos (${resumo.alerta.porcentagemDoTotal.toFixed(1)}%)`}
                />
              )}
              {resumo.atencao.totalProdutos > 0 && (
                <div
                  style={{ width: `${resumo.atencao.porcentagemDoTotal}%`, backgroundColor: '#CA8A04' }}
                  className="h-full transition-all duration-300 relative group cursor-pointer"
                  onClick={() => handleCardClick('ATENCAO')}
                  title={`Atenção (11-15 dias): ${resumo.atencao.totalProdutos} produtos (${resumo.atencao.porcentagemDoTotal.toFixed(1)}%)`}
                />
              )}
              {resumo.giroNormal.totalProdutos > 0 && (
                <div
                  style={{ width: `${resumo.giroNormal.porcentagemDoTotal}%`, backgroundColor: '#16A34A' }}
                  className="h-full transition-all duration-300 relative group cursor-pointer"
                  onClick={() => handleCardClick('GIRO_NORMAL')}
                  title={`Giro normal (5-10 dias): ${resumo.giroNormal.totalProdutos} produtos (${resumo.giroNormal.porcentagemDoTotal.toFixed(1)}%)`}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Grid com os 4 Cards Oficiais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
        {cards.map((card) => {
          const isAtivo = filtroClassificacaoAtivo === card.tipo;
          const Icon = card.icon;

          return (
            <div
              key={card.tipo}
              onClick={() => handleCardClick(card.tipo)}
              className={`relative rounded-xl border p-4 transition-all duration-150 cursor-pointer ${
                isAtivo ? card.corBordaAtiva : `${card.corFundo} ${card.corBorda}`
              }`}
            >
              {/* Badge de Dias e Filtro Ativo */}
              <div className="flex items-center justify-between gap-1 mb-2">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${card.corBadge}`}
                >
                  <Icon className="w-3 h-3" />
                  {card.dados.classificacao.rotulo}
                </span>

                <span className="text-[11px] font-bold text-slate-600 bg-white/80 px-2 py-0.5 rounded border border-slate-200">
                  {card.dados.classificacao.faixaTexto}
                </span>
              </div>

              {/* Quantidade e Porcentagem */}
              <div className="mt-2 flex items-baseline justify-between">
                <div>
                  <span className={`text-2xl font-black ${card.corTextoDestaque}`}>
                    {formatarNumero(card.dados.totalProdutos)}
                  </span>
                  <span className="text-xs font-semibold text-slate-500 ml-1">produtos</span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${card.corTexto} bg-white/70 border border-current/20`}>
                  {card.dados.porcentagemDoTotal.toFixed(1)}%
                </span>
              </div>

              {/* Subtotais de Estoque e Valor Financeiro */}
              <div className="mt-3 pt-2.5 border-t border-slate-200/60 text-xs space-y-1 text-slate-600">
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1 text-[11px]">
                    <Package className="w-3 h-3 text-slate-400" />
                    Estoque:
                  </span>
                  <span className="font-semibold text-slate-800">
                    {formatarNumero(card.dados.estoqueTotal)} un.
                  </span>
                </div>

                {card.dados.valorTotalEstoque > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1 text-[11px]">
                      <DollarSign className="w-3 h-3 text-slate-400" />
                      Valor est.:
                    </span>
                    <span className="font-semibold text-slate-800">
                      {formatarMoeda(card.dados.valorTotalEstoque)}
                    </span>
                  </div>
                )}
              </div>

              {/* Dica de clique / estado */}
              <div className="mt-2.5 text-[10px] text-center font-medium text-slate-500 flex items-center justify-center gap-1">
                {isAtivo ? (
                  <span className="text-blue-700 font-bold flex items-center gap-1">
                    <Filter className="w-3 h-3" /> Filtro aplicado na lista
                  </span>
                ) : (
                  <span>Clique para filtrar na lista</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Barra Informativa Inferior com Contexto e Regras */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            Total elegível (&ge; 5 dias e est &gt; 0):{' '}
            <strong className="text-slate-700">{formatarNumero(resumo.totalElegiveis)} itens</strong>
          </span>
          <span>
            Valor total retido:{' '}
            <strong className="text-slate-700">{formatarMoeda(resumo.totalValorElegiveis)}</strong>
          </span>
          <span className="text-slate-400 hidden sm:inline">|</span>
          <span title="Produtos com menos de 5 dias sem venda estão fora desta análise">
            Fora do indicador (&lt; 5 dias):{' '}
            <strong className="text-slate-600">{formatarNumero(resumo.totalNaoElegiveisMenor5Dias)}</strong>
          </span>
          <span title="Produtos sem estoque não são considerados">
            Sem estoque (= 0):{' '}
            <strong className="text-slate-600">{formatarNumero(resumo.totalSemEstoque)}</strong>
          </span>
        </div>

        <span className="text-[10px] text-slate-400 font-mono">
          Regra Filial 172 • Única coluna ESTOQUE
        </span>
      </div>
    </div>
  );
};
