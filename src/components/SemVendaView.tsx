import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calendar,
  Clock,
  Package,
  Plus,
  Search,
  TrendingDown
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { parseEmbalagem } from '../services/codeParser';
import { ProdutoSMG } from '../types';

interface SemVendaViewProps {
  produtos: ProdutoSMG[];
  onSelectProduto: (produto: ProdutoSMG) => void;
  onOpenCadastrarModal: (produto: ProdutoSMG) => void;
}

export const SemVendaView: React.FC<SemVendaViewProps> = ({
  produtos,
  onSelectProduto,
  onOpenCadastrarModal,
}) => {
  const [minDiasSemVenda, setMinDiasSemVenda] = useState<number>(7);
  const [searchTerm, setSearchTerm] = useState('');

  // Filter products with stock > 0 and (vendas 30d = 0 or dias_sem_venda >= minDiasSemVenda)
  const produtosSemVenda = useMemo(() => {
    return produtos.filter((p) => {
      if (p.estoque_total <= 0) return false;
      const atendeDias = p.dias_sem_venda >= minDiasSemVenda || p.vendas_qtde_30d === 0;
      if (!atendeDias) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.trim().toUpperCase();
        return (
          p.descricao.toUpperCase().includes(q) ||
          p.codigo_interno.includes(q) ||
          (p.codigo_exibicao || '').includes(q)
        );
      }
      return true;
    }).sort((a, b) => b.dias_sem_venda - a.dias_sem_venda);
  }, [produtos, minDiasSemVenda, searchTerm]);

  return (
    <div id="view-sem-venda" className="space-y-4 pb-24 max-w-4xl mx-auto">
      {/* Header & Filter Card with Bold Typography */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 space-y-3 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-amber-500" />

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center border border-amber-200">
              <TrendingDown className="w-5 h-5 text-amber-700 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight text-gray-900 leading-tight">
                MERCADORIAS SEM VENDA / BAIXO GIRO
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                Produtos com estoque físico parado na loja ou depósito
              </p>
            </div>
          </div>

          <span className="text-xs font-black font-mono text-amber-900 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200 uppercase">
            {produtosSemVenda.length} ITENS
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3 stroke-[2.5]" />
          <input
            id="input-busca-sem-venda"
            type="text"
            placeholder="Buscar por código ou descrição..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 focus:border-blue-700 focus:bg-white rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold text-gray-900 focus:outline-hidden transition-all shadow-2xs"
          />
        </div>

        {/* Threshold chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-[11px] font-black uppercase tracking-wider text-gray-400 self-center mr-1">Filtrar por:</span>
          {[
            { label: '0 Vendas (30d)', days: 999 },
            { label: '7+ dias sem venda', days: 7 },
            { label: '15+ dias sem venda', days: 15 },
            { label: '30+ dias sem venda', days: 30 },
          ].map((opt) => (
            <button
              key={opt.days}
              onClick={() => setMinDiasSemVenda(opt.days)}
              className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all select-none ${
                minDiasSemVenda === opt.days
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Product List */}
      <div className="space-y-2.5">
        {produtosSemVenda.length === 0 ? (
          <div className="bg-white rounded-xl p-8 border border-gray-200 text-center space-y-2">
            <TrendingDown className="w-10 h-10 text-gray-400 mx-auto stroke-[2]" />
            <p className="text-xs font-black text-gray-700 uppercase tracking-wide">
              Nenhuma mercadoria com estoque parado encontrada para este critério.
            </p>
          </div>
        ) : (
          produtosSemVenda.map((prod) => {
            const embData = parseEmbalagem(prod.embalagem);
            const conversao = embData.descricao_formatada(prod.estoque_total);

            return (
              <div
                key={prod.id}
                onClick={() => onSelectProduto(prod)}
                className="bg-white rounded-xl p-4 border border-gray-200 hover:border-blue-500 hover:shadow-xs transition-all cursor-pointer space-y-3 active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        {prod.codigo_exibicao}
                      </span>
                      <span className="text-xs font-bold text-gray-600">
                        {prod.embalagem}
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-gray-900 uppercase leading-snug mt-1.5">
                      {prod.descricao}
                    </h3>
                  </div>

                  <span className="px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300 shrink-0 font-mono">
                    {prod.dias_sem_venda} D S/ VENDA
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <div>
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Estoque Total</span>
                    <strong className="text-sm font-black font-mono text-gray-900">{prod.estoque_total} un</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Venda 30d</span>
                    <strong className="text-sm font-black font-mono text-gray-900">{prod.vendas_qtde_30d} un</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Idade Estoque</span>
                    <strong className="text-sm font-black font-mono text-gray-900">{prod.idade} dias</strong>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-100">
                  <span className="text-gray-500 truncate font-medium">
                    Equiv: <strong className="text-gray-800 font-bold">{conversao}</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenCadastrarModal(prod);
                      }}
                      className="px-2.5 py-1 rounded-md bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-black text-[11px] uppercase tracking-wider flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Validar</span>
                    </button>
                    <span className="text-blue-700 font-black uppercase text-[11px] tracking-wider flex items-center gap-0.5">
                      Detalhes <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
