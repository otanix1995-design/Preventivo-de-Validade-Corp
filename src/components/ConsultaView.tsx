import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Barcode,
  Boxes,
  CalendarClock,
  Camera,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Filter,
  History,
  Layers,
  Link2,
  Package,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Tag,
  Trash2,
  TrendingDown,
  Truck,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { calcularPosicaoEstoque, cleanEanCode, isProdutoPesavel, parseEmbalagem } from '../services/codeParser';
import { calcularProjecaoVencimento, formatarDataBR, formatarDiasRestantes } from '../services/projection';
import { productRepository } from '../services/productRepository';
import { deleteVencimento, desvincularEan, getVencimentosByCodigoInterno, searchProdutos } from '../services/storage';
import { LoteVencimento, ProdutoSMG } from '../types';
import { HighlightText } from './HighlightText';
import { StatusBadge } from './StatusBadge';

interface ConsultaViewProps {
  produtos: ProdutoSMG[];
  initialSearchQuery?: string;
  selectedProduto: ProdutoSMG | null;
  onSelectProduto: (produto: ProdutoSMG | null) => void;
  onOpenScanner: () => void;
  onOpenCadastrarModal: (produto: ProdutoSMG, lote?: LoteVencimento) => void;
  onOpenVincularModal?: (initialEan?: string, initialProduto?: ProdutoSMG | null) => void;
}

const PAGE_SIZE = 10;

export const ConsultaView: React.FC<ConsultaViewProps> = ({
  produtos,
  initialSearchQuery = '',
  selectedProduto,
  onSelectProduto,
  onOpenScanner,
  onOpenCadastrarModal,
  onOpenVincularModal,
}) => {
  const [inputQuery, setInputQuery] = useState(initialSearchQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialSearchQuery);
  const [gramagemFilter, setGramagemFilter] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(inputQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [inputQuery]);

  // Sync initial search query when prop changes (e.g. from scanner or external navigation)
  useEffect(() => {
    setInputQuery(initialSearchQuery);
    setDebouncedQuery(initialSearchQuery);
    setCurrentPage(1);
  }, [initialSearchQuery]);

  // Reset to page 1 whenever debounced query or gramagem filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedQuery, gramagemFilter]);

  // All matching results for current query (unfiltered by gramagem, to compute available gramagens)
  const allQueryResults = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return [];
    }
    return productRepository.searchProducts(debouncedQuery);
  }, [debouncedQuery, produtos]);

  // Contextual Gramagem options extracted dynamically from matching query results
  const gramagensDisponiveis = useMemo(() => {
    if (allQueryResults.length === 0) return [];
    return productRepository.getGramagensDisponiveis(allQueryResults);
  }, [allQueryResults]);

  // Filtered results after applying Gramagem filter
  const filteredResults = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return [];
    }
    if (!gramagemFilter) {
      return allQueryResults;
    }
    return productRepository.searchProducts(debouncedQuery, { gramagem: gramagemFilter });
  }, [debouncedQuery, gramagemFilter, allQueryResults]);

  // Strict pagination slicing (10 per page)
  const totalResults = filteredResults.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalResults);
  const visibleProducts = useMemo(() => {
    return filteredResults.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredResults, startIndex]);

  const handleSearchChange = (val: string) => {
    setInputQuery(val);
  };

  const handleClearSearch = () => {
    setInputQuery('');
    setDebouncedQuery('');
    setGramagemFilter(null);
    setCurrentPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    if (resultsContainerRef.current) {
      resultsContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSelectProduct = (prod: ProdutoSMG) => {
    onSelectProduto(prod);
  };

  // If a product is selected, render the full detailed Consulta screen
  if (selectedProduto) {
    const embData = parseEmbalagem(selectedProduto.embalagem);
    const isPesavel = embData.produtoPesavel || embData.tipoControle === 'PESO';
    const posEstoque = calcularPosicaoEstoque(
      selectedProduto.estoque_emb1,
      selectedProduto.estoque_emb9,
      selectedProduto.embalagem,
      selectedProduto.fator_embalagem
    );
    const lotes = getVencimentosByCodigoInterno(selectedProduto.codigo_interno);
    const hoje = new Date();

    const mediaDiaria = (selectedProduto.vendas_qtde_30d / 30).toFixed(2);
    const conversaoEstoqueTotal = posEstoque.conversaoTexto;

    const handleDeleteLote = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirm('Deseja excluir este lote de vencimento?')) {
        await deleteVencimento(id);
        // Force refresh by triggering state update
        onSelectProduto({ ...selectedProduto });
      }
    };

    return (
      <div id="view-consulta-detalhe" className="space-y-4 pb-24 max-w-4xl mx-auto">
        {/* Navigation Bar Back button */}
        <div className="flex items-center justify-between">
          <button
            id="btn-voltar-consulta"
            onClick={() => onSelectProduto(null)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-gray-200 text-gray-800 hover:bg-gray-50 text-xs font-black uppercase tracking-wider shadow-2xs transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-blue-700 stroke-[2.5]" />
            <span>Voltar para Busca</span>
          </button>

          <button
            id="btn-scanner-shortcut-detail"
            onClick={onOpenScanner}
            className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-blue-700 hover:underline"
          >
            <Camera className="w-4 h-4 stroke-[2.5]" />
            <span>Escanear Outro</span>
          </button>
        </div>

        {/* 1. TOP CARD: PRODUTO PRINCIPAL */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-700" />

          <div className="flex items-start justify-between gap-2 pt-1">
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-mono">
                CÓDIGO: {selectedProduto.codigo_exibicao}
              </span>
              <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight leading-snug pt-1">
                {selectedProduto.descricao}
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100 text-xs">
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 font-bold uppercase block tracking-wider">Cód. Interno</span>
              <strong className="text-gray-900 font-mono font-black text-sm">{selectedProduto.codigo_interno}</strong>
            </div>
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 font-bold uppercase block tracking-wider">Dígito</span>
              <strong className="text-gray-900 font-mono font-black text-sm">{selectedProduto.digito || '-'}</strong>
            </div>
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 font-bold uppercase block tracking-wider">Embalagem</span>
              <strong className="text-blue-900 font-black text-xs truncate block">{selectedProduto.embalagem}</strong>
            </div>
          </div>
        </div>

        {/* 2. ESTOQUE CARD */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <Boxes className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Posição de Estoque
            </h3>
            <span className="text-xs font-black text-blue-800 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200 uppercase font-mono">
              Total: {posEstoque.textoTotal}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-center text-xs">
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">{posEstoque.rotuloEmb1}</span>
              <strong className="text-lg font-black font-mono text-gray-900">{posEstoque.textoEmb1}</strong>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">{posEstoque.rotuloEmb9}</span>
              <strong className="text-lg font-black font-mono text-gray-900">{posEstoque.textoEmb9}</strong>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 col-span-2 sm:col-span-1">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Conversão</span>
              <strong className="text-xs font-black text-blue-900 truncate block mt-1">{posEstoque.conversaoTexto}</strong>
            </div>
          </div>
        </div>

        {/* 3. VENDAS E GIRO (30 DIAS + DIAS SEM VENDA + IDADE) */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <History className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Venda & Giro Operacional
            </h3>
            {selectedProduto.dias_sem_venda >= 7 && (
              <span className="text-[10px] font-black text-amber-800 bg-amber-50 px-2 py-1 rounded border border-amber-200 flex items-center gap-1 uppercase">
                <AlertTriangle className="w-3 h-3 stroke-[2.5]" />
                Sem giro recente
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center text-xs">
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Venda 30 Dias</span>
              <strong className="text-lg font-black font-mono text-gray-900">{selectedProduto.vendas_qtde_30d} {isPesavel ? 'KG' : 'UN'}</strong>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Média Diária</span>
              <strong className="text-lg font-black font-mono text-gray-900">{mediaDiaria} {isPesavel ? 'KG/D' : 'UN/D'}</strong>
            </div>
            <div className={`p-3 rounded-lg border ${selectedProduto.dias_sem_venda >= 7 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'}`}>
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Dias Sem Venda</span>
              <strong className={`text-lg font-black font-mono ${selectedProduto.dias_sem_venda >= 7 ? 'text-amber-800' : 'text-gray-900'}`}>
                {selectedProduto.dias_sem_venda} D
              </strong>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Idade Mercadoria</span>
              <strong className="text-lg font-black font-mono text-gray-900">{selectedProduto.idade} D</strong>
            </div>
          </div>

          {selectedProduto.dias_sem_venda >= 7 && selectedProduto.vendas_qtde_30d > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 p-3 rounded-lg border border-amber-200 font-medium">
              ⚠️ <strong>Atenção operacional:</strong> O produto possui histórico de {selectedProduto.vendas_qtde_30d} {isPesavel ? 'kg' : 'un'} em 30 dias, porém está há <strong>{selectedProduto.dias_sem_venda} dias sem registrar vendas</strong>. A média diária pode estar superestimando o giro real.
            </p>
          )}
        </div>

        {/* 4. ÚLTIMA COMPRA / ENTRADA & PREÇO & PEDIDOS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Entrada & Compra */}
          <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm space-y-2">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <Truck className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Última Compra / Entrada
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium uppercase text-[11px]">Data Última Entrada:</span>
                <strong className="text-gray-900 font-mono font-bold">{selectedProduto.data_ultima_entrada || 'Não informada'}</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium uppercase text-[11px]">Quantidade Entrada:</span>
                <strong className="text-gray-900 font-mono font-bold">
                  {selectedProduto.qtde_ultima_entrada !== undefined ? `${selectedProduto.qtde_ultima_entrada} ${isPesavel ? 'KG' : 'UN'}` : '-'}
                </strong>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500 font-medium uppercase text-[11px]">Estoque Ideal:</span>
                <strong className="text-gray-900 font-mono font-bold">
                  {selectedProduto.qtde_ideal !== undefined ? `${selectedProduto.qtde_ideal} ${isPesavel ? 'KG' : 'UN'}` : '-'}
                </strong>
              </div>
            </div>
          </div>

          {/* Preço & Pedidos Pendentes */}
          <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm space-y-2">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Preço & Pedidos Pendentes
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium uppercase text-[11px]">Preço de Venda:</span>
                <strong className="text-gray-900 font-black font-mono text-sm">
                  {selectedProduto.vendas_preco ? `R$ ${selectedProduto.vendas_preco.toFixed(2)}` : 'Consulte PDV'}
                </strong>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium uppercase text-[11px]">Pedidos Pendentes:</span>
                <strong className="text-blue-900 font-bold">{selectedProduto.pedidos_pendentes || 'Nenhum'}</strong>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500 font-medium uppercase text-[11px]">Comprador Filial:</span>
                <strong className="text-gray-900 font-bold">{selectedProduto.comprador_filial || '-'}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* 5. CLASSE / CATEGORIA DO PRODUTO (Setor Físico e Setor Balanço) */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm space-y-2">
          <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-700 stroke-[2.5]" />
            Classe / Setor da Mercadoria
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Setor Físico</span>
              <strong className="text-gray-900 font-bold">{selectedProduto.setor_fisico || 'Não especificado'}</strong>
            </div>
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Setor Balanço</span>
              <strong className="text-gray-900 font-bold">{selectedProduto.setor_balanco || 'Não especificado'}</strong>
            </div>
          </div>
        </div>

        {/* 6. VÍNCULOS EAN */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <Barcode className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              EANs Vinculados a este Produto ({selectedProduto.eans?.length || 0})
            </h3>
            {onOpenVincularModal && (
              <button
                type="button"
                onClick={() => onOpenVincularModal(undefined, selectedProduto)}
                className="text-[11px] font-black text-blue-700 uppercase tracking-wide hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
                <span>+ Vincular Novo EAN</span>
              </button>
            )}
          </div>

          {selectedProduto.eans && selectedProduto.eans.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {selectedProduto.eans.map((ean) => (
                <div
                  key={ean}
                  className="bg-gray-100 hover:bg-gray-200/80 border border-gray-300 px-3 py-1.5 rounded-lg text-xs font-mono font-black text-gray-900 flex items-center gap-2 transition-colors"
                >
                  <Barcode className="w-3.5 h-3.5 text-blue-700 stroke-[2.5]" />
                  <span>{ean}</span>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (confirm(`Deseja desvincular o EAN ${ean} deste produto?`)) {
                        await desvincularEan(ean);
                        onSelectProduto({
                          ...selectedProduto,
                          eans: selectedProduto.eans?.filter((item) => item !== ean),
                        });
                      }
                    }}
                    className="p-0.5 text-gray-400 hover:text-rose-600 rounded transition-colors"
                    title={`Desvincular EAN ${ean}`}
                  >
                    <X className="w-3.5 h-3.5 stroke-[3]" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-2.5">
              <p className="text-xs text-gray-500 italic">
                Nenhum código de barras EAN vinculado a este produto.
              </p>
              {onOpenVincularModal && (
                <button
                  type="button"
                  onClick={() => onOpenVincularModal(undefined, selectedProduto)}
                  className="px-2.5 py-1 bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-black uppercase tracking-wider rounded-md transition-colors"
                >
                  Vincular Agora
                </button>
              )}
            </div>
          )}
        </div>

        {/* 7. LOTES DE VENCIMENTO JÁ CADASTRADOS */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Lotes de Vencimento Cadastrados ({lotes.length})
            </h3>
            <button
              onClick={() => onOpenCadastrarModal(selectedProduto)}
              className="text-xs font-black text-blue-700 uppercase tracking-wide hover:underline flex items-center gap-1"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              Adicionar Lote
            </button>
          </div>

          {lotes.length === 0 ? (
            <div className="p-5 bg-gray-50 rounded-xl border border-gray-100 text-center text-xs text-gray-500 font-medium">
              Nenhum lote de validade registrado para esta mercadoria ainda.
            </div>
          ) : (
            <div className="space-y-2.5">
              {lotes.map((lote) => {
                const projecao = calcularProjecaoVencimento(lote, selectedProduto, hoje);
                const diasFmt = formatarDiasRestantes(projecao.dias_restantes);

                return (
                  <div
                    key={lote.id}
                    className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-gray-900 font-mono">
                            Validade: {formatarDataBR(lote.data_validade)}
                          </span>
                          <span className={`text-xs font-bold uppercase ${diasFmt.cor}`}>
                            ({diasFmt.texto})
                          </span>
                        </div>
                        <span className="text-xs font-bold text-gray-700 font-mono">
                          Quantidade: {lote.quantidade_total_unidades} UN ({embData.descricao_formatada(lote.quantidade_total_unidades)})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={projecao.status} size="sm" />
                        <button
                          onClick={() => onOpenCadastrarModal(selectedProduto, lote)}
                          className="p-1 rounded text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition-colors border border-blue-200"
                          title="Editar lote ou preço de rebaixe"
                        >
                          <Pencil className="w-3.5 h-3.5 stroke-[2.5]" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteLote(lote.id, e)}
                          className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Excluir lote"
                        >
                          <Trash2 className="w-4 h-4 stroke-[2.5]" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs bg-white p-2 rounded-lg border border-gray-200">
                      <div>
                        <span className="text-gray-400 block text-[9px] uppercase font-bold tracking-wider">Média Diária</span>
                        <strong className="text-gray-900 font-mono font-black">{projecao.media_diaria_30d} UN/D</strong>
                      </div>
                      <div>
                        <span className="text-gray-400 block text-[9px] uppercase font-bold tracking-wider">Saída Proj.</span>
                        <strong className="text-gray-900 font-mono font-black">{projecao.saida_projetada} UN</strong>
                      </div>
                      <div>
                        <span className="text-gray-400 block text-[9px] uppercase font-bold tracking-wider">Sobra Estim.</span>
                        <strong className={`font-mono font-black ${projecao.sobra_projetada > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {projecao.sobra_projetada} UN
                        </strong>
                      </div>
                    </div>

                    {/* Preço de Rebaixe / Trabalhado */}
                    {lote.preco_trabalhado !== undefined && (
                      <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 font-black text-amber-950">
                          <Tag className="w-3.5 h-3.5 text-amber-700 stroke-[2.5]" />
                          <span>Rebaixe: <strong>R$ {Number(lote.preco_trabalhado).toFixed(2).replace('.', ',')}</strong></span>
                          {selectedProduto.vendas_preco && selectedProduto.vendas_preco > lote.preco_trabalhado && (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/70 px-1 py-0.5 rounded ml-1">
                              -{Math.round(((selectedProduto.vendas_preco - lote.preco_trabalhado) / selectedProduto.vendas_preco) * 100)}%
                            </span>
                          )}
                        </span>
                        {lote.data_preco && (
                          <span className="text-[10px] text-gray-500 font-mono">
                            Desde {formatarDataBR(lote.data_preco)}
                          </span>
                        )}
                      </div>
                    )}

                    {lote.observacao && (
                      <p className="text-xs text-gray-600 italic">
                        Obs: {lote.observacao}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 8. FIXED BOTTOM ACTION BAR: SAIR & CADASTRAR VENCIMENTO */}
        <div className="sticky bottom-20 z-30 flex gap-3 pt-2 bg-gradient-to-t from-gray-100 via-gray-100 to-transparent p-2 rounded-xl">
          <button
            id="btn-sair-consulta-detalhe"
            type="button"
            onClick={() => onSelectProduto(null)}
            className="w-1/3 py-3.5 px-4 rounded-xl border border-gray-300 bg-white text-gray-800 font-black text-xs uppercase tracking-wider hover:bg-gray-100 active:bg-gray-200 shadow-sm transition-colors"
          >
            Sair
          </button>
          <button
            id="btn-cadastrar-vencimento-consulta"
            type="button"
            onClick={() => onOpenCadastrarModal(selectedProduto)}
            className="flex-1 py-3.5 px-4 rounded-xl bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-black text-xs sm:text-sm uppercase tracking-wider shadow-lg shadow-blue-700/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <Plus className="w-5 h-5 stroke-[3]" />
            <span>Cadastrar Vencimento</span>
          </button>
        </div>
      </div>
    );
  }

  // Otherwise, render the Search Input and Results List
  return (
    <div id="view-consulta-busca" className="space-y-4 pb-24 max-w-4xl mx-auto" ref={resultsContainerRef}>
      {/* Search Input Box */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-black uppercase tracking-wider text-gray-800 flex items-center gap-2">
            <Search className="w-4 h-4 text-blue-700 stroke-[2.5]" />
            Consulta de Mercadoria
          </h2>
          {debouncedQuery.trim() && (
            <span className="text-xs font-mono font-bold text-gray-500">
              {totalResults} {totalResults === 1 ? 'PRODUTO' : 'PRODUTOS'}
            </span>
          )}
        </div>

        <div className="relative flex items-center">
          <div className="absolute left-3.5 text-gray-400 pointer-events-none">
            <Search className="w-5 h-5 stroke-[2.5]" />
          </div>

          <input
            id="input-busca-mercadoria"
            type="text"
            placeholder="Buscar por código, descrição ou EAN..."
            value={inputQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full bg-gray-50 border-2 border-gray-200 focus:border-blue-600 focus:bg-white rounded-xl pl-11 pr-24 py-3 text-sm font-bold text-gray-900 focus:outline-hidden transition-all shadow-2xs"
            autoFocus
          />

          <div className="absolute right-2 flex items-center gap-1.5">
            {inputQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="p-1.5 rounded-full text-gray-400 hover:text-gray-600"
                title="Limpar busca"
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}

            <button
              id="btn-trigger-scanner-in-search"
              type="button"
              onClick={onOpenScanner}
              className="bg-blue-700 hover:bg-blue-800 text-white p-2 rounded-lg shadow-2xs flex items-center justify-center transition-colors active:scale-95 cursor-pointer"
              title="Ler Código de Barras pela Câmera"
            >
              <Camera className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium pt-1">
          <span>* Digite o Código Interno (ex: 46135), EAN ou parte da descrição.</span>
        </div>
      </div>

      {/* FILTROS CONTEXTUAIS DE GRAMAGEM (quando há busca ativa) */}
      {debouncedQuery.trim() && gramagensDisponiveis.length > 0 && (
        <div className="bg-white rounded-xl p-3.5 border border-gray-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-gray-600 flex items-center gap-1.5 uppercase tracking-wider">
              <Filter className="w-3.5 h-3.5 text-blue-700" />
              Filtrar por Gramagem / Apresentação:
            </span>
            {gramagemFilter && (
              <button
                onClick={() => setGramagemFilter(null)}
                className="text-[11px] font-bold text-blue-700 hover:underline flex items-center gap-1"
              >
                <span>Limpar filtro</span>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
            <button
              type="button"
              onClick={() => setGramagemFilter(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all select-none ${
                gramagemFilter === null
                  ? 'bg-blue-700 text-white shadow-2xs'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
              }`}
            >
              Todas ({allQueryResults.length})
            </button>

            {gramagensDisponiveis.map((g) => {
              const isSelected = gramagemFilter === g.texto;
              return (
                <button
                  key={g.texto}
                  type="button"
                  onClick={() => setGramagemFilter(isSelected ? null : g.texto)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all select-none flex items-center gap-1 ${
                    isSelected
                      ? 'bg-blue-700 text-white shadow-2xs'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
                  }`}
                >
                  <span>{g.texto}</span>
                  <span className={isSelected ? 'text-blue-200 text-[10px]' : 'text-gray-500 text-[10px]'}>
                    ({g.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active filter badge indicator */}
          {gramagemFilter && (
            <div className="flex items-center gap-2 pt-1 border-t border-gray-100 text-xs">
              <span className="text-gray-500">Filtro ativo:</span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-bold">
                Gramagem: {gramagemFilter}
                <button
                  type="button"
                  onClick={() => setGramagemFilter(null)}
                  className="hover:text-blue-950 p-0.5"
                  title="Remover filtro de gramagem"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            </div>
          )}
        </div>
      )}

      {/* INITIAL STATE: Search query is empty */}
      {!debouncedQuery.trim() ? (
        <div className="bg-white rounded-2xl p-8 border border-gray-200 text-center space-y-4 shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center mx-auto border border-blue-100">
            <Search className="w-7 h-7 stroke-[2]" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="text-base font-black text-gray-900 uppercase tracking-tight">
              Pesquisar Mercadoria
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Digite o código interno, código de barras (EAN) ou parte da descrição do produto acima para pesquisar.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={onOpenScanner}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-2xs transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4 stroke-[2.5]" />
              <span>Escanear Código de Barras</span>
            </button>
          </div>
        </div>
      ) : (
        /* ACTIVE SEARCH RESULTS LIST */
        <div className="space-y-3">
          {/* Header with Result Count */}
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-wider">
              {totalResults > 0
                ? `Exibindo ${startIndex + 1}–${endIndex} de ${totalResults} ${totalResults === 1 ? 'resultado' : 'resultados'}`
                : `Resultados da Busca ("${debouncedQuery}")`}
            </h3>
            {totalPages > 1 && (
              <span className="text-xs font-bold text-gray-500">
                Pág. {currentPage} de {totalPages}
              </span>
            )}
          </div>

          {totalResults === 0 ? (
            <div className="bg-white rounded-xl p-8 border border-gray-200 text-center space-y-4 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                <Package className="w-6 h-6 stroke-[2]" />
              </div>

              <div className="space-y-1">
                <h4 className="text-sm font-black text-gray-900 uppercase tracking-wide">
                  Nenhuma mercadoria encontrada
                </h4>
                <p className="text-xs text-gray-500 max-w-md mx-auto">
                  Não encontramos nenhum produto com o termo "{debouncedQuery}". Verifique se o código ou descrição foi digitado corretamente.
                </p>
              </div>

              {onOpenVincularModal && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 max-w-md mx-auto space-y-3 text-left">
                  <div className="flex items-start gap-2.5">
                    <div className="p-1.5 rounded-lg bg-blue-600 text-white shrink-0">
                      <Link2 className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="text-xs font-black text-blue-950 uppercase tracking-tight">
                        Leu ou buscou um Código de Barras (EAN)?
                      </h5>
                      <p className="text-[11px] text-blue-800 font-medium mt-0.5">
                        Você pode associar o código <strong className="font-mono">{debouncedQuery}</strong> a um produto da base SMGOI013 agora mesmo.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    id="btn-vincular-ean-empty-search"
                    onClick={() => onOpenVincularModal(debouncedQuery)}
                    className="w-full py-2.5 px-3 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[3]" />
                    <span>Vincular Código "{debouncedQuery}" Manualmente</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleProducts.map((prod) => {
                const matchedEan = prod.eans?.find((e) =>
                  e.includes(debouncedQuery.trim())
                );
                const posEstoqueItem = calcularPosicaoEstoque(
                  prod.estoque_emb1,
                  prod.estoque_emb9,
                  prod.embalagem,
                  prod.fator_embalagem
                );
                const unit = posEstoqueItem.unidadeTotal;

                return (
                  <div
                    key={prod.id}
                    id={`prod-card-${prod.codigo_interno}`}
                    onClick={() => handleSelectProduct(prod)}
                    className="bg-white rounded-xl p-4 border border-gray-200 hover:border-blue-500 hover:shadow-xs transition-all cursor-pointer space-y-2.5 active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="text-xs font-mono font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            <HighlightText text={prod.codigo_exibicao} query={debouncedQuery} />
                          </span>
                          <span className="text-xs font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                            {prod.embalagem}
                          </span>
                          {matchedEan && (
                            <span className="text-[10px] font-mono font-bold text-gray-500 flex items-center gap-1 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">
                              <Barcode className="w-3 h-3 text-gray-400" />
                              EAN: <HighlightText text={matchedEan} query={debouncedQuery} />
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-black text-gray-900 uppercase leading-snug mt-1.5">
                          <HighlightText text={prod.descricao} query={debouncedQuery} />
                        </h4>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-black font-mono text-gray-900 block">
                          ESTOQUE: {posEstoqueItem.textoTotal}
                        </span>
                        <span className="text-[10px] text-gray-400 font-bold uppercase inline-block mt-1">
                          {posEstoqueItem.textoEmb1} | {posEstoqueItem.textoEmb9}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100 text-gray-500 font-medium">
                      <span>
                        Venda 30d: <strong className="text-gray-800 font-mono font-bold">{prod.vendas_qtde_30d} {unit}</strong>
                      </span>
                      <span>
                        S/ Venda: <strong className={`font-mono font-bold ${prod.dias_sem_venda >= 7 ? 'text-amber-700' : 'text-gray-800'}`}>
                          {prod.dias_sem_venda}D
                        </strong>
                      </span>
                      <span className="text-blue-700 font-black uppercase text-[11px] tracking-wide flex items-center gap-1">
                        Consultar →
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* CONTROLES DE PAGINAÇÃO (MÁXIMO 10 PRODUTOS POR PÁGINA) */}
          {totalPages > 1 && (
            <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-2xs flex items-center justify-between gap-2 mt-4">
              <button
                type="button"
                id="btn-pagina-anterior"
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>

              <div className="text-xs font-bold text-gray-700">
                Página <span className="font-black text-blue-700">{currentPage}</span> de <span className="font-black text-gray-900">{totalPages}</span>
              </div>

              <button
                type="button"
                id="btn-pagina-proxima"
                onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <span>Próxima</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

