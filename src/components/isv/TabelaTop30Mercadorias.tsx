import React, { useMemo, useState } from 'react';
import { ItemIsv } from '../../types';
import {
  obterTop30Mercadorias,
  ItemTop30Mercadoria,
} from '../../services/isvClassificacaoService';
import { gerarRelatorioTop30Pdf } from '../../services/isvPdfService';
import {
  Trophy,
  FileText,
  AlertTriangle,
  Flame,
  Clock,
  CheckCircle2,
  Package,
  Layers,
  Building2,
  UserCheck,
  RefreshCw,
} from 'lucide-react';

interface TabelaTop30MercadoriasProps {
  itens: ItemIsv[];
  filialNome?: string;
  onSelecionarProduto?: (item: ItemIsv) => void;
}

export const TabelaTop30Mercadorias: React.FC<TabelaTop30MercadoriasProps> = ({
  itens,
  filialNome = 'Filial 172 — Cascavel',
  onSelecionarProduto,
}) => {
  const top30Itens = useMemo(() => obterTop30Mercadorias(itens), [itens]);

  const totais = useMemo(() => {
    let criticos = 0;
    let alertas = 0;
    let atencao = 0;
    let giroNormal = 0;
    let estoqueTotal = 0;
    let valorTotal = 0;

    const unidadesSet = new Set<string>();
    for (const it of top30Itens) {
      unidadesSet.add((it.embalagem || 'UN').trim().toUpperCase());
      estoqueTotal += it.estoque;
      if (it.valorEstoque !== null && it.valorEstoque !== undefined) {
        valorTotal += it.valorEstoque;
      }
      switch (it.classificacao.tipo) {
        case 'CRITICO':
          criticos++;
          break;
        case 'ALERTA':
          alertas++;
          break;
        case 'ATENCAO':
          atencao++;
          break;
        case 'GIRO_NORMAL':
          giroNormal++;
          break;
      }
    }

    const unidadeUnica = unidadesSet.size === 1 ? Array.from(unidadesSet)[0] : null;

    return {
      total: top30Itens.length,
      criticos,
      alertas,
      atencao,
      giroNormal,
      estoqueTotal,
      valorTotal,
      unidadeUnica,
      unidadesDistintas: unidadesSet.size,
    };
  }, [top30Itens]);

  const [incluirValoresFinanceirosPdf, setIncluirValoresFinanceirosPdf] = useState(false);
  const [isGerandoPdf, setIsGerandoPdf] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);

  const handleExportarPdf = async () => {
    if (isGerandoPdf) return;
    setIsGerandoPdf(true);
    setErroPdf(null);
    try {
      await gerarRelatorioTop30Pdf(itens, {
        filialNome,
        incluirValoresFinanceiros: incluirValoresFinanceirosPdf,
        exibirValorEstoque: incluirValoresFinanceirosPdf,
      });
    } catch (err: any) {
      setErroPdf(err?.message || 'Erro ao gerar relatório TOP 30.');
    } finally {
      setIsGerandoPdf(false);
    }
  };

  const formatarMoeda = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const formatarNumero = (val: number) => {
    return new Intl.NumberFormat('pt-BR').format(val);
  };

  return (
    <div className="space-y-4">
      {/* Banner / Card Superior com Métricas Consolidadas do Ranking */}
      <div className="bg-slate-900 rounded-xl p-4 md:p-5 text-white border border-slate-800 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-orange-600 text-white shadow-sm flex items-center justify-center">
              <Trophy className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
                  Ranking Oficial
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {filialNome}
                </span>
              </div>
              <h2 className="text-lg md:text-xl font-bold tracking-tight text-white mt-0.5">
                TOP 30 — Mercadorias com Mais Dias Sem Venda
              </h2>
              <p className="text-xs text-slate-300">
                Critérios oficiais: estoque &gt; 0, dias sem venda &ge; 5, ordenados decrescentemente
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap self-start md:self-auto">
            <label
              htmlFor="top30-chk-valores-pdf"
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 cursor-pointer select-none transition-colors"
              title="Desmarcado por padrão: oculta valores financeiros do estoque no relatório PDF"
            >
              <input
                id="top30-chk-valores-pdf"
                type="checkbox"
                checked={incluirValoresFinanceirosPdf}
                onChange={(e) => setIncluirValoresFinanceirosPdf(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-500 cursor-pointer accent-orange-500"
              />
              <span>Incluir valores financeiros do estoque</span>
            </label>

            <button
              type="button"
              disabled={isGerandoPdf}
              onClick={handleExportarPdf}
              className="px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 disabled:opacity-70 disabled:cursor-wait text-white font-bold text-xs rounded-lg flex items-center gap-2 shadow-sm transition-all hover:shadow-md cursor-pointer"
            >
              {isGerandoPdf ? (
                <>
                  <RefreshCw className="w-4 h-4 text-white animate-spin" />
                  <span>Gerando PDF...</span>
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 text-white" />
                  <span>Exportar PDF Oficial (A4 Paisagem)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {erroPdf && (
          <div className="mt-3 p-2.5 rounded-lg bg-red-950/80 border border-red-500/50 text-red-100 text-xs font-bold flex items-center justify-between gap-2">
            <span>{erroPdf}</span>
            <button
              type="button"
              onClick={() => setErroPdf(null)}
              className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {/* Resumo Consolidado dos 30 Itens */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 mt-4 pt-3 border-t border-slate-800/80 text-xs">
          <div className="bg-slate-800/60 rounded-lg p-2.5 border border-slate-700/60">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total no Ranking</span>
            <span className="text-base font-extrabold text-white">{totais.total} produtos</span>
          </div>

          <div className="bg-red-950/40 rounded-lg p-2.5 border border-red-900/50">
            <span className="text-[10px] text-red-300 uppercase font-semibold flex items-center gap-1">
              <Flame className="w-3 h-3 text-red-400" /> Críticos (&ge;21d)
            </span>
            <span className="text-base font-extrabold text-red-400">{totais.criticos}</span>
          </div>

          <div className="bg-orange-950/40 rounded-lg p-2.5 border border-orange-900/50">
            <span className="text-[10px] text-orange-300 uppercase font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-orange-400" /> Alerta (16-20d)
            </span>
            <span className="text-base font-extrabold text-orange-400">{totais.alertas}</span>
          </div>

          <div className="bg-yellow-950/40 rounded-lg p-2.5 border border-yellow-900/50">
            <span className="text-[10px] text-yellow-300 uppercase font-semibold flex items-center gap-1">
              <Clock className="w-3 h-3 text-yellow-400" /> Atenção (11-15d)
            </span>
            <span className="text-base font-extrabold text-yellow-400">{totais.atencao}</span>
          </div>

          <div className="bg-emerald-950/40 rounded-lg p-2.5 border border-emerald-900/50">
            <span className="text-[10px] text-emerald-300 uppercase font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Giro Normal (5-10d)
            </span>
            <span className="text-base font-extrabold text-emerald-400">{totais.giroNormal}</span>
          </div>

          <div className="bg-slate-800/60 rounded-lg p-2.5 border border-slate-700/60">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Volume Total Estoque</span>
            <span className="text-base font-extrabold text-amber-300">
              {totais.unidadeUnica
                ? `${formatarNumero(totais.estoqueTotal)} ${totais.unidadeUnica.toLowerCase()}`
                : `${totais.unidadesDistintas} unidades distintas`}
            </span>
          </div>
        </div>
      </div>

      {/* Tabela do TOP 30 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-amber-400 text-slate-900 border-b-2 border-slate-900 font-bold uppercase text-[11px] tracking-wider">
                <th className="py-2.5 px-3 text-center w-12 border-r border-amber-500/60">Pos.</th>
                <th className="py-2.5 px-3 text-center w-20 border-r border-amber-500/60">Código</th>
                <th className="py-2.5 px-3 min-w-[220px] border-r border-amber-500/60">Descrição</th>
                <th className="py-2.5 px-2.5 text-center w-16 border-r border-amber-500/60">Emb.</th>
                <th className="py-2.5 px-3 text-right w-24 border-r border-amber-500/60 bg-amber-500/30">
                  ESTOQUE
                </th>
                <th className="py-2.5 px-2.5 text-center w-18 border-r border-amber-500/60">
                  Idade (d)
                </th>
                <th className="py-2.5 px-3 text-center min-w-[130px] border-r border-amber-500/60">
                  Dias s/Venda
                </th>
                <th className="py-2.5 px-3 min-w-[130px] border-r border-amber-500/60">Grupo</th>
                <th className="py-2.5 px-3 min-w-[140px] border-r border-amber-500/60">Fornecedor</th>
                <th className="py-2.5 px-3 min-w-[120px] border-r border-amber-500/60">Agência</th>
                <th className="py-2.5 px-3 min-w-[120px]">Promotor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800">
              {top30Itens.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-500">
                    <Package className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-700">Nenhum produto elegível para o TOP 30</p>
                    <p className="text-xs text-slate-500 mt-1">
                      São necessários produtos com estoque &gt; 0 e pelo menos 5 dias sem venda na BASE RUB.
                    </p>
                  </td>
                </tr>
              ) : (
                top30Itens.map((item, idx) => {
                  const isTop3 = idx < 3;
                  const isCritico = item.classificacao.tipo === 'CRITICO';

                  return (
                    <tr
                      key={`${item.codigoInterno}-${idx}`}
                      onClick={() => onSelecionarProduto && onSelecionarProduto(item.item)}
                      className={`hover:bg-amber-50/60 transition-colors ${
                        onSelecionarProduto ? 'cursor-pointer' : ''
                      } ${idx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}`}
                    >
                      {/* Posição */}
                      <td className="py-2 px-3 text-center border-r border-slate-200 font-black">
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                            idx === 0
                              ? 'bg-amber-400 text-slate-950 shadow-xs ring-1 ring-amber-500'
                              : idx === 1
                              ? 'bg-slate-300 text-slate-900'
                              : idx === 2
                              ? 'bg-amber-700 text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {item.posicao}
                        </span>
                      </td>

                      {/* Código */}
                      <td className="py-2 px-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200">
                        {item.codigoInterno}
                        {item.digito && item.digito !== '-' && (
                          <span className="text-slate-400 font-normal">-{item.digito}</span>
                        )}
                      </td>

                      {/* Descrição */}
                      <td className="py-2 px-3 font-medium text-slate-900 border-r border-slate-200">
                        <div className="flex items-center gap-1.5">
                          {isCritico && (
                            <span title="Item em estado crítico">
                              <Flame className="w-3.5 h-3.5 text-red-600 shrink-0" />
                            </span>
                          )}
                          <span className="line-clamp-2" title={item.descricao}>
                            {item.descricao}
                          </span>
                        </div>
                      </td>

                      {/* Embalagem */}
                      <td className="py-2 px-2.5 text-center text-slate-600 border-r border-slate-200 font-semibold uppercase">
                        {item.embalagem}
                      </td>

                      {/* ESTOQUE (Coluna Única Obrigatória) */}
                      <td className="py-2 px-3 text-right font-bold text-slate-900 border-r border-slate-200 bg-amber-50/40">
                        {item.estoqueFormatado}
                      </td>

                      {/* Idade */}
                      <td className="py-2 px-2.5 text-center text-slate-600 border-r border-slate-200">
                        {item.idade}
                      </td>

                      {/* Dias Sem Venda com Badge Oficial */}
                      <td className="py-2 px-3 text-center border-r border-slate-200">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border shadow-2xs"
                             style={{
                               backgroundColor: item.classificacao.bgHex,
                               color: item.classificacao.textHex,
                               borderColor: item.classificacao.borderHex,
                             }}
                        >
                          <span className="font-extrabold text-xs">{item.diasSemVenda} d</span>
                          <span className="text-[10px] font-semibold opacity-90">({item.classificacao.rotulo})</span>
                        </div>
                      </td>

                      {/* Grupo */}
                      <td className="py-2 px-3 text-slate-700 border-r border-slate-200 truncate max-w-[150px]" title={item.grupo}>
                        {item.grupo}
                      </td>

                      {/* Fornecedor */}
                      <td className="py-2 px-3 text-slate-700 border-r border-slate-200 truncate max-w-[160px]" title={item.fornecedor}>
                        {item.fornecedor}
                      </td>

                      {/* Agência */}
                      <td className="py-2 px-3 text-slate-700 border-r border-slate-200 truncate max-w-[130px]" title={item.agencia}>
                        {item.agencia}
                      </td>

                      {/* Promotor */}
                      <td className="py-2 px-3 text-slate-700 truncate max-w-[130px]" title={item.promotor}>
                        {item.promotor}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé da Tabela */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">
              {top30Itens.length} produtos classificados no TOP 30
            </span>
            <span className="text-slate-400">•</span>
            <span>Coluna única de ESTOQUE em conformidade</span>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600"></span> 21+d Crítico
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-600"></span> 16-20d Alerta
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span> 11-15d Atenção
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span> 5-10d Giro normal
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
