import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Barcode,
  Boxes,
  Building2,
  Calendar,
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Factory,
  FileSpreadsheet,
  Filter,
  History,
  Info,
  Layers,
  Link2,
  Package,
  Pencil,
  Plus,
  Scale,
  Search,
  ShieldAlert,
  ShoppingCart,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { calcularPosicaoEstoque, cleanEanCode, isProdutoPesavel, parseEmbalagem } from '../services/codeParser';
import { formatarMoedaBR } from '../services/deviceId';
import { formatarEstoqueOperacionalExtenso } from '../services/isvPlanilhaParser';
import { isvService } from '../services/isvService';
import { productRepository } from '../services/productRepository';
import { calcularProjecaoVencimento, formatarDataBR, formatarDiasRestantes } from '../services/projection';
import { formatarCnpj } from '../services/spcoi007Parser';
import { deleteVencimento, getVencimentosByCodigoInterno } from '../services/storage';
import { LoteVencimento, ProdutoSMG, RegistroPlanilhaIsv, ResponsaveisMercadoria } from '../types';
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

  // Sync initial search query when prop changes
  useEffect(() => {
    setInputQuery(initialSearchQuery);
    setDebouncedQuery(initialSearchQuery);
    setCurrentPage(1);
  }, [initialSearchQuery]);

  // Reset to page 1 whenever debounced query or gramagem filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedQuery, gramagemFilter]);

  // All matching results for current query
  const allQueryResults = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return [];
    }

    const smgResults = productRepository.searchProducts(debouncedQuery);

    // Complementar com registros da nova planilha operacional que porventura ainda não estejam na SMGOI013
    const opRegistros = isvService.getRegistrosIsvOperacional();
    if (opRegistros.length > 0) {
      const q = debouncedQuery.trim().toUpperCase();
      const qNorm = q.replace(/^0+/, '');
      const smgKeys = new Set(smgResults.map((p) => `${p.codigo_interno}-${p.digito || ''}`));

      const additionalProds: ProdutoSMG[] = [];
      for (const reg of opRegistros) {
        const key = `${reg.codigo_interno}-${reg.digito || ''}`;
        if (smgKeys.has(key)) continue;

        const matchCode =
          reg.codigo_interno === qNorm ||
          reg.codigo_exibicao.toUpperCase().includes(q) ||
          reg.codigo_original.includes(q);
        const matchNome = reg.nome.toUpperCase().includes(q);

        if (matchCode || matchNome) {
          additionalProds.push({
            id: `op_${reg.codigo_interno}_${reg.digito}`,
            codigo_original: reg.codigo_original,
            codigo_completo: reg.codigo_original,
            codigo_interno: reg.codigo_interno,
            digito: reg.digito,
            codigo_exibicao: reg.codigo_exibicao,
            chave_normalizada: reg.chave_normalizada || `${reg.codigo_interno}-${reg.digito}`,
            descricao: reg.nome + (reg.complemento ? ` ${reg.complemento}` : ''),
            embalagem: 'EMBALAGEM PENDENTE',
            estoque_emb1: 0,
            estoque_emb9: reg.estoque,
            estoque_total: reg.estoque,
            vendas_qtde_30d: reg.venda_30_dias,
            dias_sem_venda: reg.dias_sem_venda,
            idade: reg.idade,
            eans: [],
            dados_operacionais: reg,
            atualizado_em: new Date().toISOString(),
          });
        }
      }
      return [...smgResults, ...additionalProds];
    }

    return smgResults;
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

  // Pagination (10 items per page)
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

  // Helper para obter registro operacional de um produto
  const getRegistroOperacionalItem = (p: ProdutoSMG): RegistroPlanilhaIsv | undefined => {
    return isvService.getRegistroOperacional(p.codigo_interno, p.digito) || p.dados_operacionais;
  };

  // =========================================================================
  // TELA DE DETALHE COMPLETO — ESTRUTURA OFICIAL EM 12 SEÇÕES
  // =========================================================================
  if (selectedProduto) {
    const regOp = getRegistroOperacionalItem(selectedProduto);
    const responsaveis: ResponsaveisMercadoria = isvService.getResponsaveisPorCodigoInterno(
      selectedProduto.codigo_interno
    );

    const resolucaoEmbalagem = isvService.resolverEmbalagemSpcoi(
      selectedProduto.codigo_interno,
      selectedProduto.digito,
      selectedProduto.embalagem || regOp?.complemento
    );

    const embExibicao = resolucaoEmbalagem.embalagem;
    const embData = parseEmbalagem(embExibicao);
    const isPesavel =
      embData.produtoPesavel ||
      embData.tipoControle === 'PESO' ||
      (selectedProduto.unidade_medida && selectedProduto.unidade_medida.toUpperCase() === 'KG') ||
      (regOp?.peso_variavel && regOp.peso_variavel.toUpperCase() === 'SIM');

    const posEstoque = calcularPosicaoEstoque(
      selectedProduto.estoque_emb1,
      selectedProduto.estoque_emb9,
      embExibicao,
      selectedProduto.fator_embalagem || embData.fator
    );

    // Cálculo do estoque unificado formatado por extenso
    let estoqueTextoExtenso = '';
    let estoqueTextoOriginal = '';
    let estoqueTotalNumerico = selectedProduto.estoque_total || 0;

    if (regOp) {
      estoqueTextoExtenso = regOp.estoque_formatado_extenso;
      estoqueTextoOriginal = regOp.estoque_original_texto;
      estoqueTotalNumerico = regOp.estoque;
    } else {
      const parsed = formatarEstoqueOperacionalExtenso(
        selectedProduto.estoque_original_erp || posEstoque.conversaoTexto
      );
      estoqueTextoExtenso = parsed.textoExtenso;
      estoqueTextoOriginal = parsed.textoOriginal;
      estoqueTotalNumerico = selectedProduto.estoque_total || 0;
    }

    // Vendas e Giro
    const venda30d = regOp?.venda_30_dias ?? selectedProduto.vendas_qtde_30d ?? 0;
    const mediaDiaria = (venda30d / 30).toFixed(2);
    const diasSemVenda = regOp?.dias_sem_venda ?? selectedProduto.dias_sem_venda ?? 0;
    const idade = regOp?.idade ?? selectedProduto.idade ?? 0;

    // Lotes de vencimento cadastrados
    const lotes = getVencimentosByCodigoInterno(selectedProduto.codigo_interno);
    const hoje = new Date();

    const handleDeleteLote = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirm('Deseja realmente excluir este lote de vencimento?')) {
        await deleteVencimento(id);
        onSelectProduto({ ...selectedProduto });
      }
    };

    // Situação Cadastral
    const isAtivo = (regOp?.ativo || selectedProduto.ativo || 'SIM').toUpperCase() === 'SIM';
    const isGerenciado = (regOp?.gerenciado || selectedProduto.gerenciado || 'SIM').toUpperCase() === 'SIM';
    const isPesoVariavel = (regOp?.peso_variavel || selectedProduto.peso_variavel || (isPesavel ? 'SIM' : 'NÃO')).toUpperCase() === 'SIM';

    const temEmbalagemPermanente =
      selectedProduto.embalagem &&
      selectedProduto.embalagem.trim() !== '' &&
      selectedProduto.embalagem.toUpperCase() !== 'EMBALAGEM PENDENTE';

    return (
      <div id="view-consulta-detalhe" className="space-y-4 pb-28 max-w-4xl mx-auto">
        {/* Barra Superior de Navegação */}
        <div className="flex items-center justify-between">
          <button
            id="btn-voltar-consulta"
            type="button"
            onClick={() => onSelectProduto(null)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-gray-200 text-gray-800 hover:bg-gray-50 text-xs font-black uppercase tracking-wider shadow-2xs transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-blue-700 stroke-[2.5]" />
            <span>Voltar para Busca</span>
          </button>

          <button
            id="btn-scanner-shortcut-detail"
            type="button"
            onClick={onOpenScanner}
            className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-blue-700 hover:underline cursor-pointer"
          >
            <Camera className="w-4 h-4 stroke-[2.5]" />
            <span>Escanear Outro</span>
          </button>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 1: IDENTIFICAÇÃO DA MERCADORIA */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-700" />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-blue-800 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200 font-mono">
                CÓDIGO: {selectedProduto.codigo_exibicao}
              </span>
              <span className="text-[11px] font-black uppercase tracking-wider text-gray-700 bg-gray-100 px-2.5 py-1 rounded-md border border-gray-200">
                FILIAL 172 — CASCAVEL
              </span>
            </div>

            {/* Badges de Situação Cadastral */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase ${
                  isAtivo
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
              >
                ATIVO: {isAtivo ? 'SIM' : 'NÃO'}
              </span>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase ${
                  isGerenciado
                    ? 'bg-blue-50 text-blue-800 border-blue-200'
                    : 'bg-gray-100 text-gray-700 border-gray-300'
                }`}
              >
                GERENCIADO: {isGerenciado ? 'SIM' : 'NÃO'}
              </span>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase ${
                  isPesoVariavel
                    ? 'bg-purple-50 text-purple-800 border-purple-200'
                    : 'bg-gray-100 text-gray-700 border-gray-300'
                }`}
              >
                PESO VARIÁVEL: {isPesoVariavel ? 'SIM' : 'NÃO'}
              </span>
            </div>
          </div>

          <div className="pt-1">
            <h2 className="text-xl font-black text-gray-900 uppercase tracking-tight leading-snug">
              {regOp?.nome || selectedProduto.descricao}
            </h2>
            {regOp?.complemento && (
              <div className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-gray-100 border border-gray-200 text-xs font-bold text-gray-700">
                <span className="text-[10px] uppercase text-gray-500 font-bold">Complemento:</span>
                <span className="font-mono text-gray-900 uppercase">{regOp.complemento}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-100 text-xs">
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 font-bold uppercase block tracking-wider">Cód. Raiz</span>
              <strong className="text-gray-900 font-mono font-black text-sm">{selectedProduto.codigo_interno}</strong>
            </div>
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 font-bold uppercase block tracking-wider">Dígito</span>
              <strong className="text-gray-900 font-mono font-black text-sm">{selectedProduto.digito || '-'}</strong>
            </div>
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 font-bold uppercase block tracking-wider">Cód. Original</span>
              <strong className="text-gray-700 font-mono text-xs truncate block">{selectedProduto.codigo_completo || selectedProduto.codigo_exibicao}</strong>
            </div>
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 font-bold uppercase block tracking-wider">Chave Filial</span>
              <strong className="text-blue-900 font-mono text-xs truncate block">172-{selectedProduto.codigo_interno}</strong>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 2: ESTOQUE DISPONÍVEL EM DESTAQUE (UNIFICADO, SEM EMB1/EMB9) */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-blue-200 shadow-sm space-y-3 relative overflow-hidden bg-gradient-to-br from-white via-white to-blue-50/40">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-blue-900 uppercase tracking-wider flex items-center gap-2">
              <Boxes className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              ESTOQUE DISPONÍVEL
            </h3>
            <span className="text-xs font-black text-blue-900 bg-blue-100/80 px-2.5 py-1 rounded-md border border-blue-300 uppercase font-mono">
              Total: {estoqueTotalNumerico} {isPesavel ? 'KG' : 'UN'}
            </span>
          </div>

          <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200/80 text-center space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-800 block">
              Posição Operacional da Mercadoria
            </span>
            <div className="text-2xl sm:text-3xl font-black font-mono text-blue-950 tracking-tight">
              {estoqueTextoExtenso}
            </div>
            {estoqueTextoOriginal && estoqueTextoOriginal !== estoqueTextoExtenso && (
              <div className="pt-1.5 flex items-center justify-center gap-1.5 text-xs text-blue-700 font-semibold">
                <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
                <span>Original ERP: <strong className="font-mono">{estoqueTextoOriginal}</strong></span>
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-500 italic text-center">
            * Apresentação operacional unificada conforme nova planilha operacional da Filial 172.
          </p>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 3: EMBALAGEM COMERCIAL (SPCOI007) */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Embalagem Comercial Completa
            </h3>
            <span
              className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${
                resolucaoEmbalagem.fonte === 'SPCOI007'
                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                  : resolucaoEmbalagem.fonte === 'SMGOI013'
                  ? 'bg-gray-100 text-gray-700 border-gray-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              Fonte: {resolucaoEmbalagem.fonte === 'SPCOI007' ? 'SPCOI007 Oficial' : resolucaoEmbalagem.fonte === 'SMGOI013' ? 'SMGOI013' : 'Pendente'}
            </span>
          </div>

          {resolucaoEmbalagem.divergente ? (
            <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-300 space-y-2.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
                <span className="text-xs font-black text-amber-900 uppercase tracking-wider">
                  CONFLITO DE EMBALAGEM IDENTIFICADO NA SPCOI007
                </span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                Foram identificadas <strong>{resolucaoEmbalagem.embalagensDistintas.length} estruturas de embalagem distintas</strong> cadastradas entre fornecedores deste produto. O sistema não arbitrou nenhuma delas automaticamente. Favor averiguar fisicamente no estoque:
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {resolucaoEmbalagem.embalagensDistintas.map((emb, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-md bg-white border border-amber-300 font-mono text-xs font-black text-amber-950 shadow-2xs"
                  >
                    Opção {idx + 1}: {emb}
                  </span>
                ))}
              </div>
            </div>
          ) : embExibicao && embExibicao.toUpperCase() !== 'EMBALAGEM PENDENTE' ? (
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                  Estrutura da Embalagem ({resolucaoEmbalagem.fonte})
                </span>
                <span className="text-base font-black text-gray-900 font-mono uppercase">
                  {embExibicao}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                  Fator Comercial
                </span>
                <span className="text-sm font-black text-blue-700 font-mono">
                  {selectedProduto.fator_embalagem || embData.fator || 1} un/emb
                </span>
              </div>
            </div>
          ) : (
            <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
              <div>
                <span className="text-xs font-black text-amber-900 uppercase block tracking-wider">
                  EMBALAGEM PENDENTE
                </span>
                <p className="text-xs text-amber-800">
                  Mercadoria sem embalagem cadastrada nas fontes oficiais (SPCOI007 ou SMGOI013). O sistema não deduz a embalagem comercial a partir do texto do estoque.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 4: INFORMAÇÕES FINANCEIRAS (VALOR DISPONÍVEL OFICIAL ERP) */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-emerald-200 shadow-sm space-y-3 bg-gradient-to-br from-white via-white to-emerald-50/30">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-emerald-900 uppercase tracking-wider flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-700 stroke-[2.5]" />
              Informações Financeiras
            </h3>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded border border-emerald-300">
              Fonte Oficial do ERP
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Valor Disponível Oficial */}
            <div className="p-4 bg-emerald-50/80 rounded-xl border border-emerald-200 space-y-1">
              <span className="text-[10px] text-emerald-800 font-black uppercase tracking-wider block">
                VALOR DISPONÍVEL (COLUNA E)
              </span>
              <div className="text-2xl font-black font-mono text-emerald-950">
                {regOp?.valor_disponivel !== null && regOp?.valor_disponivel !== undefined
                  ? formatarMoedaBR(regOp.valor_disponivel)
                  : selectedProduto.valor_estoque_planilha !== null && selectedProduto.valor_estoque_planilha !== undefined
                  ? formatarMoedaBR(selectedProduto.valor_estoque_planilha)
                  : 'NÃO INFORMADO'}
              </div>
              <span className="text-[10px] text-emerald-700 font-medium block">
                * Valor financeiro soberano do ERP da filial.
              </span>
            </div>

            {/* Valor Indisponível e Situação de Venda */}
            <div className="space-y-2">
              <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between">
                <span className="text-xs text-gray-600 font-bold uppercase">Valor Indisponível (Col. G):</span>
                <strong className="text-xs font-mono font-black text-gray-900">
                  {regOp?.valor_indisponivel !== null && regOp?.valor_indisponivel !== undefined
                    ? formatarMoedaBR(regOp.valor_indisponivel)
                    : 'R$ 0,00'}
                </strong>
              </div>

              <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between">
                <span className="text-xs text-gray-600 font-bold uppercase">Venda 30 Dias:</span>
                <strong className="text-xs font-mono font-black text-gray-900">
                  {venda30d} {isPesavel ? 'KG' : 'UN'} ({mediaDiaria}/dia)
                </strong>
              </div>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 5: DIAS SEM VENDA E IDADE (COM ALERTA SE >= 10 DIAS) */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <History className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Dias Sem Venda & Idade da Mercadoria
            </h3>
            {diasSemVenda >= 10 && (
              <span className="text-[10px] font-black text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-300 flex items-center gap-1 uppercase">
                <AlertTriangle className="w-3 h-3 stroke-[2.5]" />
                Estoque Parado ≥ 10 Dias
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className={`p-3.5 rounded-xl border ${diasSemVenda >= 10 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Dias Sem Venda (Col. K)</span>
              <strong className={`text-2xl font-black font-mono ${diasSemVenda >= 10 ? 'text-amber-800' : 'text-gray-900'}`}>
                {diasSemVenda} D
              </strong>
            </div>

            <div className="p-3.5 rounded-xl border bg-gray-50 border-gray-200">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Idade Mercadoria (Col. R)</span>
              <strong className="text-2xl font-black font-mono text-gray-900">
                {idade} D
              </strong>
            </div>
          </div>

          {diasSemVenda >= 10 && (
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-900 space-y-0.5">
              <strong className="font-bold flex items-center gap-1">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                Alerta Operacional de Estagnação de Estoque
              </strong>
              <p className="text-[11px] text-amber-800 pl-5">
                Mercadoria sem registro de saídas no caixa há <strong>{diasSemVenda} dias</strong>. Recomendada checagem física em gôndola/depósito e ação preventiva de validade.
              </p>
            </div>
          )}
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 6: VENDA NOS ÚLTIMOS 30 DIAS */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Venda nos Últimos 30 Dias (Col. T)
            </h3>
            <span className="text-xs font-mono font-bold text-gray-500">
              Giro Operacional
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Volume 30 Dias</span>
              <strong className="text-2xl font-black font-mono text-gray-900">
                {venda30d} {isPesavel ? 'KG' : 'UN'}
              </strong>
            </div>

            <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider block">Média Diária</span>
              <strong className="text-2xl font-black font-mono text-gray-900">
                {mediaDiaria} {isPesavel ? 'KG/D' : 'UN/D'}
              </strong>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 7: ÚLTIMA VENDA E ÚLTIMA COMPRA */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Última Venda & Última Compra
            </h3>
            <span className="text-[10px] text-gray-500 font-bold uppercase">
              Horários Registrados
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                Última Venda (Col. L e M)
              </span>
              <strong className="text-sm font-black font-mono text-gray-900 block">
                {regOp?.ultima_venda_formatada ||
                  (regOp?.ultima_venda_data
                    ? `${regOp.ultima_venda_data} ${regOp.ultima_venda_hora || ''}`
                    : 'Não registrada')}
              </strong>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                Última Compra Comercial (Col. N e O)
              </span>
              <strong className="text-sm font-black font-mono text-gray-900 block">
                {regOp?.ultima_compra_formatada ||
                  (regOp?.ultima_compra_data
                    ? `${regOp.ultima_compra_data} ${regOp.ultima_compra_hora || ''}`
                    : selectedProduto.data_ultima_entrada || 'Não registrada')}
              </strong>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 8: ÚLTIMA ENTRADA FÍSICA (PREPARADA, NÃO DISPONÍVEL) */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-3 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Truck className="w-4 h-4 text-slate-600 stroke-[2.5]" />
              Última Entrada Física
            </h3>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-700 bg-slate-200/80 px-2 py-0.5 rounded border border-slate-300">
              Recebimento Físico
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Data da Última Entrada Física
              </span>
              <strong className="text-xs font-black font-mono text-slate-700 uppercase block">
                {selectedProduto.data_ultima_entrada_fisica || 'NÃO DISPONÍVEL'}
              </strong>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Quantidade da Última Entrada Física
              </span>
              <strong className="text-xs font-black font-mono text-slate-700 uppercase block">
                {selectedProduto.qtde_ultima_entrada_fisica || 'NÃO DISPONÍVEL'}
              </strong>
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 bg-slate-100 rounded-lg text-xs text-slate-700">
            <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              * <strong>Aguardando relatório aprovado de movimentação/recebimento físico.</strong> O sistema não utiliza a data da última compra comercial como entrada física para evitar distorções operacionais.
            </p>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 9: RESPONSÁVEIS PELA MERCADORIA (SPCOI007 & PROMOTORES) */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Responsáveis pela Mercadoria
            </h3>
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              SPCOI007 & Vínculos
            </span>
          </div>

          <div className="space-y-2 text-xs">
            {/* Indústria / CNPJ */}
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                Indústria / Fornecedor Vinculado
              </span>
              {responsaveis.industrias.length > 0 ? (
                <div className="space-y-1">
                  {responsaveis.industrias.map((ind) => (
                    <div key={ind.cnpj} className="flex items-center justify-between gap-2">
                      <strong className="text-gray-900 uppercase font-black">{ind.nome}</strong>
                      <span className="text-[10px] font-mono text-gray-600 bg-gray-200/70 px-1.5 py-0.5 rounded">
                        CNPJ: {ind.cnpj_formatado}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-gray-700 uppercase">
                    {regOp?.fornecedor_planilha || 'INDÚSTRIA NÃO VINCULADA'}
                  </strong>
                  <span className="text-[10px] text-gray-400 font-mono">CNPJ NÃO VINCULADO</span>
                </div>
              )}
            </div>

            {/* Promotor e Agência */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                  Promotor Responsável
                </span>
                <strong className={`text-xs uppercase block ${responsaveis.tem_promotor ? 'text-gray-900 font-black' : 'text-gray-400 font-bold'}`}>
                  {responsaveis.promotores.length > 0
                    ? responsaveis.promotores.join(', ')
                    : 'PROMOTOR NÃO VINCULADO'}
                </strong>
              </div>

              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                  Agência Responsável
                </span>
                <strong className={`text-xs uppercase block ${responsaveis.agencias.length > 0 ? 'text-gray-900 font-black' : 'text-gray-400 font-bold'}`}>
                  {responsaveis.agencias.length > 0
                    ? responsaveis.agencias.join(', ')
                    : 'AGÊNCIA NÃO VINCULADA'}
                </strong>
              </div>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 10: CLASSIFICAÇÃO E SETOR */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Classificação & Setorização
            </h3>
            <span className="text-[10px] text-gray-500 font-bold uppercase">
              Estrutura Mercadológica
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Classe (Col. P)</span>
              <strong className="text-gray-900 font-mono text-xs truncate block mt-0.5">
                {regOp?.classe_produto || selectedProduto.setor_fisico || '-'}
              </strong>
            </div>

            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Classe Raiz (Col. Q)</span>
              <strong className="text-gray-900 font-mono text-xs truncate block mt-0.5">
                {regOp?.classe_produto_raiz || '-'}
              </strong>
            </div>

            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Setor Save (Col. U)</span>
              <strong className="text-gray-900 font-mono text-xs truncate block mt-0.5">
                {regOp?.setor_save || '-'}
              </strong>
            </div>

            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Setor (Col. Y)</span>
              <strong className="text-gray-900 font-mono text-xs truncate block mt-0.5">
                {regOp?.setor || selectedProduto.setor_balanco || '-'}
              </strong>
            </div>

            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Setor Herdado (Col. Z)</span>
              <strong className="text-gray-900 font-mono text-xs truncate block mt-0.5">
                {regOp?.setor_herdado || '-'}
              </strong>
            </div>

            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Cadeia (Col. X)</span>
              <strong className="text-gray-900 font-mono text-xs truncate block mt-0.5">
                {regOp?.cadeia || '-'}
              </strong>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 11: SITUAÇÃO DA MERCADORIA (DEMAIS COLUNAS DO ERP) */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Situação da Mercadoria (Dados da Planilha)
            </h3>
            <span className="text-[10px] text-gray-500 font-bold uppercase">
              Operacional ERP
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Bloqueio (Col. H)</span>
              <strong className="text-gray-900 font-mono text-xs">{regOp?.bloqueio || 'Nenhum'}</strong>
            </div>

            <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Trânsito Entrada (Col. I)</span>
              <strong className="text-gray-900 font-mono text-xs">{regOp?.transito_entrada || '0'}</strong>
            </div>

            <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Est. Indisponível (Col. J)</span>
              <strong className="text-gray-900 font-mono text-xs">{regOp?.estoque_indisponivel || '0'}</strong>
            </div>

            <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Resíduo (Col. AD)</span>
              <strong className="text-gray-900 font-mono text-xs">{regOp?.residuo || 'NÃO'}</strong>
            </div>

            <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Alteração Preço (Col. AF/AG)</span>
              <strong className="text-gray-900 font-mono text-xs truncate block">{regOp?.alteracao_preco_formatada || '-'}</strong>
            </div>

            <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Verificador (Col. AH)</span>
              <strong className="text-gray-900 font-mono text-xs">{regOp?.verificador || '-'}</strong>
            </div>

            <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Autonomia (Col. AI)</span>
              <strong className="text-gray-900 font-mono text-xs">{regOp?.autonomia || '-'}</strong>
            </div>

            <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block">Autonomia Pedido (Col. AJ)</span>
              <strong className="text-gray-900 font-mono text-xs">{regOp?.autonomia_pedido || '-'}</strong>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* SEÇÃO 12: AÇÃO E VENCIMENTOS CADASTRADOS */}
        {/* =================================================================== */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              Lotes de Vencimento Cadastrados
            </h3>
            <span className="text-xs font-mono font-bold text-gray-500">
              {lotes.length} {lotes.length === 1 ? 'Lote' : 'Lotes'}
            </span>
          </div>

          {/* Botão de Destaque para Cadastrar Vencimento */}
          <button
            id="btn-cadastrar-vencimento-secao12"
            type="button"
            onClick={() => onOpenCadastrarModal(selectedProduto)}
            className="w-full py-3.5 px-4 rounded-xl bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-black text-sm uppercase tracking-wider shadow-md shadow-blue-700/20 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
          >
            <Plus className="w-5 h-5 stroke-[3]" />
            <span>+ CADASTRAR VENCIMENTO PARA ESTE PRODUTO</span>
          </button>

          {/* Lista de Lotes Cadastrados */}
          {lotes.length === 0 ? (
            <div className="p-6 bg-gray-50 rounded-xl border border-gray-200 text-center space-y-1">
              <Calendar className="w-8 h-8 text-gray-400 mx-auto stroke-[1.5]" />
              <h4 className="text-xs font-black uppercase text-gray-700 pt-1">
                Nenhum lote de validade cadastrado
              </h4>
              <p className="text-[11px] text-gray-500 max-w-sm mx-auto">
                Utilize o botão acima para registrar os vencimentos encontrados na loja física para esta mercadoria.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {lotes.map((lote) => {
                const projecao = calcularProjecaoVencimento(lote, selectedProduto, hoje);
                const infoDias = formatarDiasRestantes(projecao.dias_restantes);

                return (
                  <div
                    key={lote.id}
                    className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black font-mono text-gray-900">
                            {formatarDataBR(lote.data_validade)}
                          </span>
                          <StatusBadge status={projecao.status} />
                        </div>
                        <span className="text-xs font-bold text-gray-600 block">
                          Quantidade: <strong className="font-mono text-gray-900">{lote.quantidade_total_unidades} {isPesavel ? 'KG' : 'UN'}</strong>
                          {lote.lote_identificador && (
                            <span className="ml-2 text-gray-500 font-normal">
                              • Lote: {lote.lote_identificador}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenCadastrarModal(selectedProduto, lote)}
                          className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:text-blue-700 hover:border-blue-300 transition-colors cursor-pointer"
                          title="Editar lote"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteLote(lote.id, e)}
                          className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:text-rose-700 hover:border-rose-300 transition-colors cursor-pointer"
                          title="Excluir lote"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] text-gray-600 flex items-center justify-between pt-1 border-t border-gray-200/60">
                      <span className={infoDias.cor}>{infoDias.texto}</span>
                      <span>
                        Sobra Estimada:{' '}
                        <strong className={`font-mono font-bold ${projecao.sobra_projetada > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {projecao.sobra_projetada} {isPesavel ? 'KG' : 'UN'}
                        </strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Barra de Ação Fixa Inferior */}
        <div className="sticky bottom-20 z-30 flex gap-3 pt-2 bg-gradient-to-t from-gray-100 via-gray-100 to-transparent p-2 rounded-xl">
          <button
            id="btn-sair-consulta-detalhe"
            type="button"
            onClick={() => onSelectProduto(null)}
            className="w-1/3 py-3.5 px-4 rounded-xl border border-gray-300 bg-white text-gray-800 font-black text-xs uppercase tracking-wider hover:bg-gray-100 active:bg-gray-200 shadow-sm transition-colors cursor-pointer"
          >
            Sair
          </button>
          <button
            id="btn-cadastrar-vencimento-consulta"
            type="button"
            onClick={() => onOpenCadastrarModal(selectedProduto)}
            className="flex-1 py-3.5 px-4 rounded-xl bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-black text-xs sm:text-sm uppercase tracking-wider shadow-lg shadow-blue-700/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
          >
            <Plus className="w-5 h-5 stroke-[3]" />
            <span>Cadastrar Vencimento</span>
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // LISTA DE RESULTADOS DA BUSCA (SEM PRODUTO SELECIONADO)
  // =========================================================================
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
                className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 cursor-pointer"
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
          <span>* Digite o Código (ex: 85327 ou 85327-177), EAN ou parte da descrição.</span>
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
                className="text-[11px] font-bold text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
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
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all select-none cursor-pointer ${
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
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all select-none flex items-center gap-1 cursor-pointer ${
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

          {gramagemFilter && (
            <div className="flex items-center gap-2 pt-1 border-t border-gray-100 text-xs">
              <span className="text-gray-500">Filtro ativo:</span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-bold">
                Gramagem: {gramagemFilter}
                <button
                  type="button"
                  onClick={() => setGramagemFilter(null)}
                  className="hover:text-blue-950 p-0.5 cursor-pointer"
                  title="Remover filtro de gramagem"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ESTADO INICIAL: Sem busca */}
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
              Digite o código interno (com ou sem dígito), código de barras (EAN) ou parte da descrição do produto acima para consultar.
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
        /* LISTA DE RESULTADOS */
        <div className="space-y-3">
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
                const regOpItem = getRegistroOperacionalItem(prod);
                const matchedEan = prod.eans?.find((e) =>
                  e.includes(debouncedQuery.trim())
                );

                // Resolução da Embalagem via SPCOI007
                const resEmbItem = isvService.resolverEmbalagemSpcoi(
                  prod.codigo_interno,
                  prod.digito,
                  prod.embalagem || regOpItem?.complemento
                );

                // Estoque unificado por extenso
                let estoqueExtenso = '';
                if (regOpItem) {
                  estoqueExtenso = regOpItem.estoque_formatado_extenso;
                } else {
                  const posEstoqueItem = calcularPosicaoEstoque(
                    prod.estoque_emb1,
                    prod.estoque_emb9,
                    resEmbItem.embalagem,
                    prod.fator_embalagem
                  );
                  estoqueExtenso = formatarEstoqueOperacionalExtenso(
                    prod.estoque_original_erp || posEstoqueItem.conversaoTexto
                  ).textoExtenso;
                }

                // Valor Disponível Oficial
                const valorDisponivel =
                  regOpItem?.valor_disponivel !== null && regOpItem?.valor_disponivel !== undefined
                    ? regOpItem.valor_disponivel
                    : prod.valor_estoque_planilha;

                const diasSV = regOpItem?.dias_sem_venda ?? prod.dias_sem_venda ?? 0;

                return (
                  <div
                    key={prod.id}
                    id={`prod-card-${prod.codigo_interno}`}
                    onClick={() => handleSelectProduct(prod)}
                    className="bg-white rounded-xl p-4 border border-gray-200 hover:border-blue-500 hover:shadow-xs transition-all cursor-pointer space-y-2.5 active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center flex-wrap gap-1.5">
                          <span className="text-xs font-mono font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            <HighlightText text={prod.codigo_exibicao} query={debouncedQuery} />
                          </span>

                          {resEmbItem.divergente ? (
                            <span
                              className="text-[10px] font-black text-amber-900 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded"
                              title={`Embalagens conflitantes na SPCOI007: ${resEmbItem.embalagensDistintas.join(' / ')}`}
                            >
                              EMB. DIVERGENTE ({resEmbItem.embalagensDistintas.length})
                            </span>
                          ) : resEmbItem.embalagem && resEmbItem.embalagem.toUpperCase() !== 'EMBALAGEM PENDENTE' ? (
                            <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                              {resEmbItem.embalagem}
                            </span>
                          ) : (
                            <span className="text-[10px] font-black text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 uppercase">
                              EMBALAGEM PENDENTE
                            </span>
                          )}

                          {matchedEan && (
                            <span className="text-[10px] font-mono font-bold text-gray-500 flex items-center gap-1 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">
                              <Barcode className="w-3 h-3 text-gray-400" />
                              EAN: <HighlightText text={matchedEan} query={debouncedQuery} />
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-black text-gray-900 uppercase leading-snug">
                          <HighlightText
                            text={regOpItem?.nome || prod.descricao}
                            query={debouncedQuery}
                          />
                        </h4>
                      </div>

                      {/* ESTOQUE DISPONÍVEL UNIFICADO (SEM EMB1/EMB9) */}
                      <div className="text-right shrink-0">
                        <span className="text-xs font-black font-mono text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 block">
                          ESTOQUE: {estoqueExtenso}
                        </span>
                        {valorDisponivel !== null && valorDisponivel !== undefined && (
                          <span className="text-[11px] font-mono font-black text-emerald-700 block mt-1">
                            {formatarMoedaBR(valorDisponivel)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100 text-gray-500 font-medium">
                      <span>
                        Venda 30d:{' '}
                        <strong className="text-gray-800 font-mono font-bold">
                          {regOpItem?.venda_30_dias ?? prod.vendas_qtde_30d}{' '}
                          {isProdutoPesavel(prod.embalagem) ? 'KG' : 'UN'}
                        </strong>
                      </span>
                      <span>
                        S/ Venda:{' '}
                        <strong
                          className={`font-mono font-bold ${
                            diasSV >= 10
                              ? 'text-rose-700 bg-rose-50 px-1 rounded border border-rose-200'
                              : diasSV >= 7
                              ? 'text-amber-700'
                              : 'text-gray-800'
                          }`}
                        >
                          {diasSV}D
                        </strong>
                      </span>
                      <span className="text-blue-700 font-black uppercase text-[11px] tracking-wide flex items-center gap-1">
                        Consultar Detalhes →
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-2xs flex items-center justify-between gap-2 mt-4">
              <button
                type="button"
                id="btn-pagina-anterior"
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>

              <div className="text-xs font-bold text-gray-700">
                Página <span className="font-black text-blue-700">{currentPage}</span> de{' '}
                <span className="font-black text-gray-900">{totalPages}</span>
              </div>

              <button
                type="button"
                id="btn-pagina-proxima"
                onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
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
