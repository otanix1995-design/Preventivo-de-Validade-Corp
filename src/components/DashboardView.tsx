import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  DollarSign,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { formatarMoedaBR } from '../services/deviceId';
import { gerarRelatorioEntidadeIsvA4Pdf, gerarRelatorioIsvA4Pdf } from '../services/isvPdfService';
import { isvService } from '../services/isvService';
import { promotorService } from '../services/promotorService';
import {
  FiltrosIsv,
  Industria,
  ItemIsv,
  LoteVencimento,
  MetadadosBase,
  ProdutoSMG,
  Promotor,
  SETORES_OPERACIONAIS_CONFIG,
  SetorOperacionalIsv,
} from '../types';

interface DashboardViewProps {
  metadados: MetadadosBase;
  produtos: ProdutoSMG[];
  vencimentos: LoteVencimento[];
  divergencias?: any[];
  onNavigate: (tab: any, filter?: string) => void;
  onOpenScanner: () => void;
  onSelectProduto: (produto: ProdutoSMG) => void;
  onCadastrarDireto: () => void;
  onCadastrarParaProduto?: (produto: ProdutoSMG) => void;
}

const DIAS_RAPIDOS = [3, 4, 5, 6, 7, 8, 9, 10, 15];

export const DashboardView: React.FC<DashboardViewProps> = ({
  metadados,
  produtos,
  vencimentos,
  onNavigate,
  onOpenScanner,
  onSelectProduto,
  onCadastrarDireto,
  onCadastrarParaProduto,
}) => {
  // Filtros ativos do Dashboard
  const [filtros, setFiltros] = useState<FiltrosIsv>({
    agencia: 'TODAS',
    industriaCnpj: 'TODAS',
    promotorId: 'TODOS',
    termoBusca: '',
    setorOperacional: 'TODOS',
    setorFisico: 'TODOS',
    setorBalanco: 'TODOS',
    diasSemVenda: null,
    modoDiasSemVenda: 'MINIMO',
    idade: null,
    modoIdade: 'MINIMO',
    filtroEstoque: 'TODOS',
    filtroValor: 'TODOS',
    situacaoVinculo: 'TODOS',
    ordenacao: 'MAIOR_VALOR',
  });

  // Modais de Drilldown
  const [modalProduto, setModalProduto] = useState<ItemIsv | null>(null);
  const [modalIndustria, setModalIndustria] = useState<{
    cnpj: string;
    nome: string;
    razaoSocial?: string;
    itens: ItemIsv[];
    valorTotal: number;
  } | null>(null);
  const [modalAgencia, setModalAgencia] = useState<{
    nome: string;
    industriasRelacionadas: string[];
    promotoresRelacionados: string[];
    itens: ItemIsv[];
    valorTotal: number;
  } | null>(null);

  // Estados de busca interna e paginação para os modais
  const [buscaModal, setBuscaModal] = useState('');
  const [paginaModal, setPaginaModal] = useState(1);
  const ITENS_POR_PAGINA_MODAL = 10;

  // Carregar todos os itens ISV através do serviço otimizado (O(1) caches)
  const itensIsvBrutos = useMemo(() => {
    return isvService.getItensIsv(produtos);
  }, [produtos]);

  // Aplicar filtros ativos aos itens
  const itensFiltrados = useMemo(() => {
    return isvService.filtrarItensIsv(itensIsvBrutos, filtros);
  }, [itensIsvBrutos, filtros]);

  // Listas para os filtros selects
  const industrias = useMemo(() => isvService.getIndustrias(), []);
  const promotores = useMemo(() => promotorService.getPromotores(), []);
  const agenciasDisponiveis = useMemo(() => {
    const set = new Set<string>();
    itensIsvBrutos.forEach((it) => {
      it.agencias_nomes.forEach((ag) => {
        if (ag && ag.trim()) set.add(ag.trim());
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [itensIsvBrutos]);

  // 1. DADOS AGREGADOS DO DASHBOARD (O(1) instantâneo para filtros padrão ou Single-Pass O(N) unificado)
  const { indicadores, top10Produtos, top10Industrias, top10Agencias } = useMemo(() => {
    return isvService.getDashboardData(itensFiltrados, filtros);
  }, [itensFiltrados, filtros]);

  // Resumo de Vencimentos (preservado para acesso rápido)
  const vencimentosResumo = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    let hojeCount = 0;
    let tresDiasCount = 0;
    let criticosCount = 0;

    vencimentos.forEach((v) => {
      const val = new Date(v.data_validade + 'T00:00:00');
      val.setHours(0, 0, 0, 0);
      const diff = Math.floor((val.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 0) hojeCount++;
      if (diff > 0 && diff <= 3) tresDiasCount++;
      if (diff <= 3 || v.enviar_ao_comprador) criticosCount++;
    });

    return {
      hojeCount,
      tresDiasCount,
      criticosCount,
      totalVencimentos: vencimentos.length,
    };
  }, [vencimentos]);

  // Abertura de Modais
  const handleOpenProdutoModal = (item: ItemIsv) => {
    setModalProduto(item);
  };

  const handleOpenIndustriaModal = (ind: typeof top10Industrias[0]) => {
    setModalIndustria({
      cnpj: ind.cnpj,
      nome: ind.nome,
      razaoSocial: ind.razaoSocial,
      itens: ind.itens,
      valorTotal: ind.valorTotal,
    });
    setBuscaModal('');
    setPaginaModal(1);
  };

  const handleOpenAgenciaModal = (ag: typeof top10Agencias[0]) => {
    setModalAgencia({
      nome: ag.nome,
      industriasRelacionadas: Array.from(ag.industriasSet),
      promotoresRelacionados: Array.from(ag.promotoresSet),
      itens: ag.itens,
      valorTotal: ag.valorTotal,
    });
    setBuscaModal('');
    setPaginaModal(1);
  };

  // Exportar Dashboard em PDF A4
  const handleExportarDashboardPdf = () => {
    gerarRelatorioIsvA4Pdf(itensFiltrados, {
      tituloFiltro: 'Painel Executivo Dashboard',
      tipoRelatorioTitulo: 'PAINEL EXECUTIVO ISV',
      exibirValorEstoque: true,
      filialNome: 'Filial 172 — Cascavel',
      fonteOficial: 'BASE DO RUB',
    });
  };

  // Itens filtrados para modal de drilldown
  const itensModalPaginados = useMemo(() => {
    const lista = modalIndustria ? modalIndustria.itens : modalAgencia ? modalAgencia.itens : [];
    const q = buscaModal.trim().toUpperCase();

    const filtrados = q
      ? lista.filter((it) =>
          it.codigo_interno.includes(q) ||
          it.codigo_exibicao.toUpperCase().includes(q) ||
          it.descricao.toUpperCase().includes(q) ||
          (it.produto.eans || []).some((e) => e.includes(q))
        )
      : lista;

    const inicio = (paginaModal - 1) * ITENS_POR_PAGINA_MODAL;
    return {
      total: filtrados.length,
      totalPaginas: Math.max(1, Math.ceil(filtrados.length / ITENS_POR_PAGINA_MODAL)),
      itens: filtrados.slice(inicio, inicio + ITENS_POR_PAGINA_MODAL),
    };
  }, [modalIndustria, modalAgencia, buscaModal, paginaModal]);

  return (
    <div id="view-dashboard" className="space-y-5 pb-24 max-w-6xl mx-auto animate-fadeIn">
      {/* 1. TOPO: IDENTIDADE CORPORATIVA E STATUS DA BASE DO RUB */}
      <div className="bg-gradient-to-r from-slate-950 via-orange-950 to-slate-950 text-white rounded-2xl p-4 sm:p-5 shadow-lg border border-orange-900/40 space-y-3 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-orange-500/20 flex items-center justify-center border border-orange-500/40 shrink-0">
              <TrendingDown className="w-6 h-6 text-orange-400 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider text-orange-200 bg-orange-500/20 px-2 py-0.5 rounded border border-orange-400/30">
                  PAINEL EXECUTIVO
                </span>
                <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/40 uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  BASE DO RUB
                </span>
              </div>
              <h1 className="text-base sm:text-xl font-black uppercase tracking-tight text-white leading-tight mt-1">
                ISV | INTELIGÊNCIA DE ESTOQUE
              </h1>
              <p className="text-xs text-orange-200 font-bold uppercase tracking-wider">
                FILIAL 172 — CASCAVEL
              </p>
            </div>
          </div>

          {/* Botões de Ação do Topo */}
          <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
            <button
              id="dashboard-btn-pdf-a4"
              type="button"
              onClick={handleExportarDashboardPdf}
              className="px-3.5 py-2 rounded-xl bg-[#F36B0B] hover:bg-[#C94F00] text-white font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
              title="Exporta o relatório consolidado em PDF A4 Horizontal"
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              <span>Relatório A4</span>
            </button>

            <button
              id="dashboard-btn-scanner"
              type="button"
              onClick={onOpenScanner}
              className="px-3.5 py-2 rounded-xl bg-white text-[#C94F00] hover:bg-orange-50 font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
            >
              <Camera className="w-4 h-4 stroke-[2.5]" />
              <span>Ler EAN</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. OS 4 INDICADORES PRINCIPAIS DO DASHBOARD (ETAPA 2) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: VALOR TOTAL EM ISV */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs relative overflow-hidden group hover:border-amber-300 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              Valor Total em ISV
            </span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
              <DollarSign className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>
          <div className="text-lg sm:text-2xl font-black text-amber-950 font-mono tracking-tight truncate" title={formatarMoedaBR(indicadores.valorTotal)}>
            {formatarMoedaBR(indicadores.valorTotal)}
          </div>
          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">
            Valor Disponível • Base do RUB
          </p>
        </div>

        {/* Card 2: QUANTIDADE DE PRODUTOS (SKUs ÚNICOS) */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs relative overflow-hidden group hover:border-orange-300 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#F36B0B]" />
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              Produtos em ISV
            </span>
            <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center text-[#F36B0B]">
              <Package className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>
          <div className="text-lg sm:text-2xl font-black text-[#C94F00] font-mono tracking-tight">
            {indicadores.totalSkus.toLocaleString('pt-BR')} <span className="text-xs font-bold text-slate-400">SKUs</span>
          </div>
          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">
            Sem duplicidade de fornecedor
          </p>
        </div>

        {/* Card 3: INDÚSTRIAS VINCULADAS */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs relative overflow-hidden group hover:border-purple-300 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-1 bg-purple-600" />
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              Indústrias Vinculadas
            </span>
            <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
              <Building2 className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>
          <div className="text-lg sm:text-2xl font-black text-purple-900 font-mono tracking-tight">
            {indicadores.totalIndustrias} <span className="text-xs font-bold text-slate-400">indústrias</span>
          </div>
          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">
            Com produtos filtrados
          </p>
        </div>

        {/* Card 4: AGÊNCIAS VINCULADAS */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs relative overflow-hidden group hover:border-emerald-300 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-600" />
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              Agências Vinculadas
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Users className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>
          <div className="text-lg sm:text-2xl font-black text-emerald-900 font-mono tracking-tight">
            {indicadores.totalAgencias} <span className="text-xs font-bold text-slate-400">agências</span>
          </div>
          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">
            Com promotores ativos
          </p>
        </div>
      </div>

      {/* 3. FILTROS DO DASHBOARD (ETAPA 2) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-black uppercase text-slate-800 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-[#F36B0B]" />
            Filtros do Painel ISV
          </span>

          <button
            type="button"
            onClick={() =>
              setFiltros({
                agencia: 'TODAS',
                industriaCnpj: 'TODAS',
                promotorId: 'TODOS',
                termoBusca: '',
                setorOperacional: 'TODOS',
                setorFisico: 'TODOS',
                setorBalanco: 'TODOS',
                diasSemVenda: null,
                modoDiasSemVenda: 'MINIMO',
                idade: null,
                modoIdade: 'MINIMO',
                filtroEstoque: 'TODOS',
                filtroValor: 'TODOS',
                situacaoVinculo: 'TODOS',
                ordenacao: 'MAIOR_VALOR',
              })
            }
            className="text-[11px] font-bold text-[#F36B0B] hover:underline flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Restaurar Filtros Padrão
          </button>
        </div>

        {/* Linha 1: Busca Unificada + Responsáveis */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          {/* Busca Texto */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Buscar código, descrição, EAN, indústria ou CNPJ..."
              value={filtros.termoBusca}
              onChange={(e) => setFiltros((prev) => ({ ...prev, termoBusca: e.target.value }))}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-[#F36B0B] focus:outline-hidden"
            />
          </div>

          {/* Agência */}
          <div>
            <select
              value={filtros.agencia}
              onChange={(e) => setFiltros((prev) => ({ ...prev, agencia: e.target.value }))}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-[#F36B0B] focus:outline-hidden"
            >
              <option value="TODAS">Agência: Todas</option>
              {agenciasDisponiveis.map((ag) => (
                <option key={ag} value={ag}>
                  Agência: {ag}
                </option>
              ))}
            </select>
          </div>

          {/* Indústria */}
          <div>
            <select
              value={filtros.industriaCnpj}
              onChange={(e) => setFiltros((prev) => ({ ...prev, industriaCnpj: e.target.value }))}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-[#F36B0B] focus:outline-hidden"
            >
              <option value="TODAS">Indústria: Todas</option>
              {industrias.map((ind) => (
                <option key={ind.cnpj} value={ind.cnpj}>
                  {ind.nome_exibicao || ind.razao_social}
                </option>
              ))}
            </select>
          </div>

          {/* Promotor */}
          <div>
            <select
              value={filtros.promotorId}
              onChange={(e) => setFiltros((prev) => ({ ...prev, promotorId: e.target.value }))}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-[#F36B0B] focus:outline-hidden"
            >
              <option value="TODOS">Promotor: Todos</option>
              {promotores.map((p) => (
                <option key={p.promotorId} value={p.promotorId}>
                  {p.nome} ({p.agenciaNome || 'S/ Agência'})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Linha 2: Setor Operacional Oficial (TODOS, FRIOS, AÇOUGUE, HORTIFRUTI, LOJA) */}
        <div className="pt-1 flex items-center gap-1.5 overflow-x-auto text-xs pb-1 border-t border-slate-100">
          <span className="text-[10px] font-black uppercase text-slate-400 shrink-0">
            Setor:
          </span>
          <button
            type="button"
            onClick={() => setFiltros((prev) => ({ ...prev, setorOperacional: 'TODOS' }))}
            className={`px-2.5 py-1 rounded-md font-black text-[11px] uppercase transition-colors shrink-0 cursor-pointer ${
              filtros.setorOperacional === 'TODOS'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            TODOS
          </button>
          <button
            type="button"
            onClick={() => setFiltros((prev) => ({ ...prev, setorOperacional: 'FRIOS' }))}
            className={`px-2.5 py-1 rounded-md font-black text-[11px] uppercase transition-colors shrink-0 cursor-pointer ${
              filtros.setorOperacional === 'FRIOS'
                ? 'bg-blue-600 text-white'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            FRIOS (RF.)
          </button>
          <button
            type="button"
            onClick={() => setFiltros((prev) => ({ ...prev, setorOperacional: 'ACOUGUE' }))}
            className={`px-2.5 py-1 rounded-md font-black text-[11px] uppercase transition-colors shrink-0 cursor-pointer ${
              filtros.setorOperacional === 'ACOUGUE'
                ? 'bg-red-600 text-white'
                : 'bg-red-50 text-red-700 hover:bg-red-100'
            }`}
          >
            AÇOUGUE (AC.)
          </button>
          <button
            type="button"
            onClick={() => setFiltros((prev) => ({ ...prev, setorOperacional: 'HORTIFRUTI' }))}
            className={`px-2.5 py-1 rounded-md font-black text-[11px] uppercase transition-colors shrink-0 cursor-pointer ${
              filtros.setorOperacional === 'HORTIFRUTI'
                ? 'bg-green-600 text-white'
                : 'bg-green-50 text-green-700 hover:bg-green-100'
            }`}
          >
            HORTIFRUTI (HF.)
          </button>
          <button
            type="button"
            onClick={() => setFiltros((prev) => ({ ...prev, setorOperacional: 'LOJA' }))}
            className={`px-2.5 py-1 rounded-md font-black text-[11px] uppercase transition-colors shrink-0 cursor-pointer ${
              filtros.setorOperacional === 'LOJA'
                ? 'bg-purple-600 text-white'
                : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
            }`}
          >
            LOJA (CR. / OUTROS)
          </button>
        </div>

        {/* Linha 3: DIAS SEM VENDA (Atalhos + Custom + Mínimo/Exato) */}
        <div className="pt-2 border-t border-slate-100 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-[10px] font-black uppercase text-slate-400 shrink-0 flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-600" />
            Dias s/ Venda:
          </span>

          <button
            type="button"
            onClick={() => setFiltros((prev) => ({ ...prev, diasSemVenda: null }))}
            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase transition-colors cursor-pointer ${
              filtros.diasSemVenda === null
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos
          </button>

          {DIAS_RAPIDOS.map((d) => (
            <button
              key={`dsv-${d}`}
              type="button"
              onClick={() => setFiltros((prev) => ({ ...prev, diasSemVenda: d }))}
              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase transition-colors cursor-pointer ${
                filtros.diasSemVenda === d
                  ? 'bg-[#F36B0B] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {d}d+
            </button>
          ))}

          <div className="flex items-center gap-1 ml-auto">
            <input
              type="number"
              min={0}
              placeholder="Outro"
              value={filtros.diasSemVenda !== null && !DIAS_RAPIDOS.includes(filtros.diasSemVenda) ? filtros.diasSemVenda : ''}
              onChange={(e) => {
                const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                setFiltros((prev) => ({ ...prev, diasSemVenda: val }));
              }}
              className="w-14 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-center"
            />
            <div className="inline-flex rounded-md shadow-2xs border border-slate-200 bg-slate-50 p-0.5 text-[9px] font-black uppercase">
              <button
                type="button"
                onClick={() => setFiltros((prev) => ({ ...prev, modoDiasSemVenda: 'MINIMO' }))}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  filtros.modoDiasSemVenda === 'MINIMO' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-400'
                }`}
              >
                Mínimo
              </button>
              <button
                type="button"
                onClick={() => setFiltros((prev) => ({ ...prev, modoDiasSemVenda: 'EXATO' }))}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  filtros.modoDiasSemVenda === 'EXATO' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-400'
                }`}
              >
                Exato
              </button>
            </div>
          </div>
        </div>

        {/* Linha 4: IDADE DA MERCADORIA (Atalhos + Custom + Mínimo/Exato) */}
        <div className="pt-2 border-t border-slate-100 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-[10px] font-black uppercase text-slate-400 shrink-0 flex items-center gap-1">
            <Calendar className="w-3 h-3 text-[#F36B0B]" />
            Idade Mercadoria:
          </span>

          <button
            type="button"
            onClick={() => setFiltros((prev) => ({ ...prev, idade: null }))}
            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase transition-colors cursor-pointer ${
              filtros.idade === null
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos
          </button>

          {DIAS_RAPIDOS.map((d) => (
            <button
              key={`idade-${d}`}
              type="button"
              onClick={() => setFiltros((prev) => ({ ...prev, idade: d }))}
              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase transition-colors cursor-pointer ${
                filtros.idade === d
                  ? 'bg-[#F36B0B] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {d}d+
            </button>
          ))}

          <div className="flex items-center gap-1 ml-auto">
            <input
              type="number"
              min={0}
              placeholder="Outro"
              value={filtros.idade !== null && !DIAS_RAPIDOS.includes(filtros.idade) ? filtros.idade : ''}
              onChange={(e) => {
                const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                setFiltros((prev) => ({ ...prev, idade: val }));
              }}
              className="w-14 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-center"
            />
            <div className="inline-flex rounded-md shadow-2xs border border-slate-200 bg-slate-50 p-0.5 text-[9px] font-black uppercase">
              <button
                type="button"
                onClick={() => setFiltros((prev) => ({ ...prev, modoIdade: 'MINIMO' }))}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  filtros.modoIdade === 'MINIMO' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-400'
                }`}
              >
                Mínimo
              </button>
              <button
                type="button"
                onClick={() => setFiltros((prev) => ({ ...prev, modoIdade: 'EXATO' }))}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  filtros.modoIdade === 'EXATO' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-400'
                }`}
              >
                Exato
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 4. OS TRÊS GRÁFICOS INTERATIVOS PRINCIPAIS (ETAPA 3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* GRÁFICO 1 — PRODUTOS COM MAIOR ISV */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-50 text-[#F36B0B] flex items-center justify-center">
                  <Package className="w-4 h-4 stroke-[2.5]" />
                </div>
                <div>
                  <h2 className="text-xs font-black uppercase text-slate-800">
                    Top 10 Produtos em ISV
                  </h2>
                  <p className="text-[10px] text-slate-400">
                    Maior Valor Disponível (Clique p/ Ficha)
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-slate-400">
                Ranking
              </span>
            </div>

            {/* Lista com Barras Interativas */}
            <div className="divide-y divide-slate-100 mt-2 space-y-1">
              {top10Produtos.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  Nenhum produto encontrado com os filtros atuais.
                </div>
              ) : (
                top10Produtos.map((item, idx) => {
                  const maxVal = top10Produtos[0]?.valor_estoque || 1;
                  const pct = Math.min(100, Math.max(8, ((item.valor_estoque || 0) / maxVal) * 100));

                  const setorConf = SETORES_OPERACIONAIS_CONFIG[item.setor_operacional || 'LOJA'];
                  const descCor = setorConf ? setorConf.corHex : '#7C3AED';

                  return (
                    <button
                      key={`prod-rank-${item.codigo_interno}-${idx}`}
                      type="button"
                      onClick={() => handleOpenProdutoModal(item)}
                      className="w-full text-left py-2 px-1.5 rounded-lg hover:bg-slate-50 transition-colors group cursor-pointer block"
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5 min-w-0 pr-2">
                          <span className="w-4 text-[10px] font-black text-slate-400 font-mono">
                            #{idx + 1}
                          </span>
                          <span
                            className="font-bold truncate text-[11px]"
                            style={{ color: descCor }}
                            title={item.descricao}
                          >
                            {item.descricao}
                          </span>
                        </div>
                        <span className="font-mono font-black text-slate-900 shrink-0 text-xs">
                          {item.valor_estoque_formatado}
                        </span>
                      </div>

                      {/* Barra de Progresso Interativa */}
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#F36B0B] rounded-full group-hover:bg-[#C94F00] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                        <span>Cód: {item.codigo_exibicao}</span>
                        <span>{item.estoque_formatado} • {item.dias_sem_venda}d s/v</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-[#F36B0B] font-bold">
            <button
              onClick={() => onNavigate('isv')}
              className="hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Ver todos os itens no módulo ISV</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* GRÁFICO 2 — INDÚSTRIAS COM MAIOR ISV */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Building2 className="w-4 h-4 stroke-[2.5]" />
                </div>
                <div>
                  <h2 className="text-xs font-black uppercase text-slate-800">
                    Top 10 Indústrias em ISV
                  </h2>
                  <p className="text-[10px] text-slate-400">
                    Capital Parado Acumulado (Clique p/ Drilldown)
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-slate-400">
                Acumulado
              </span>
            </div>

            {/* Lista com Barras Interativas */}
            <div className="divide-y divide-slate-100 mt-2 space-y-1">
              {top10Industrias.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  Nenhuma indústria encontrada com os filtros atuais.
                </div>
              ) : (
                top10Industrias.map((ind, idx) => {
                  const maxVal = top10Industrias[0]?.valorTotal || 1;
                  const pct = Math.min(100, Math.max(8, (ind.valorTotal / maxVal) * 100));

                  return (
                    <button
                      key={`ind-rank-${ind.cnpj}-${idx}`}
                      type="button"
                      onClick={() => handleOpenIndustriaModal(ind)}
                      className="w-full text-left py-2 px-1.5 rounded-lg hover:bg-purple-50/50 transition-colors group cursor-pointer block"
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5 min-w-0 pr-2">
                          <span className="w-4 text-[10px] font-black text-slate-400 font-mono">
                            #{idx + 1}
                          </span>
                          <span className="font-bold truncate text-[11px] text-slate-900 group-hover:text-purple-700" title={ind.nome}>
                            {ind.nome}
                          </span>
                        </div>
                        <span className="font-mono font-black text-purple-950 shrink-0 text-xs">
                          {formatarMoedaBR(ind.valorTotal)}
                        </span>
                      </div>

                      {/* Barra de Progresso */}
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-600 rounded-full group-hover:bg-purple-700 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                        <span>{ind.cnpj === 'SEM_CNPJ' ? 'Não informada' : ind.cnpj}</span>
                        <span className="font-bold text-purple-700">{ind.skusSet.size} SKUs em ISV</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-purple-700 font-bold">
            <span className="text-[10px] text-slate-400">Clique na barra para ver a lista de SKUs</span>
          </div>
        </div>

        {/* GRÁFICO 3 — AGÊNCIAS COM MAIOR ISV */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Users className="w-4 h-4 stroke-[2.5]" />
                </div>
                <div>
                  <h2 className="text-xs font-black uppercase text-slate-800">
                    Top 10 Agências em ISV
                  </h2>
                  <p className="text-[10px] text-slate-400">
                    Capital Parado Acumulado (Clique p/ Drilldown)
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-slate-400">
                Acumulado
              </span>
            </div>

            {/* Lista com Barras Interativas */}
            <div className="divide-y divide-slate-100 mt-2 space-y-1">
              {top10Agencias.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  Nenhuma agência encontrada com os filtros atuais.
                </div>
              ) : (
                top10Agencias.map((ag, idx) => {
                  const maxVal = top10Agencias[0]?.valorTotal || 1;
                  const pct = Math.min(100, Math.max(8, (ag.valorTotal / maxVal) * 100));

                  return (
                    <button
                      key={`ag-rank-${ag.nome}-${idx}`}
                      type="button"
                      onClick={() => handleOpenAgenciaModal(ag)}
                      className="w-full text-left py-2 px-1.5 rounded-lg hover:bg-emerald-50/50 transition-colors group cursor-pointer block"
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5 min-w-0 pr-2">
                          <span className="w-4 text-[10px] font-black text-slate-400 font-mono">
                            #{idx + 1}
                          </span>
                          <span className="font-bold truncate text-[11px] text-slate-900 group-hover:text-emerald-700" title={ag.nome}>
                            {ag.nome}
                          </span>
                        </div>
                        <span className="font-mono font-black text-emerald-950 shrink-0 text-xs">
                          {formatarMoedaBR(ag.valorTotal)}
                        </span>
                      </div>

                      {/* Barra de Progresso */}
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full group-hover:bg-emerald-700 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                        <span>{ag.promotoresSet.size} promotores</span>
                        <span className="font-bold text-emerald-700">{ag.skusSet.size} SKUs vinculados</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-emerald-700 font-bold">
            <span className="text-[10px] text-slate-400">Clique na barra para ver a lista de SKUs</span>
          </div>
        </div>
      </div>

      {/* 5. RESUMO OPERACIONAL DE VENCIMENTOS (PRESERVADO PARA ACESSO RÁPIDO) */}
      <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-md border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center border border-orange-500/40 shrink-0">
              <Calendar className="w-5 h-5 text-orange-400 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase text-white tracking-wider">
                Resumo Operacional de Vencimentos
              </h3>
              <p className="text-[11px] text-slate-400">
                Acompanhamento contínuo de lotes e prevenção de perdas na Filial 172
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="px-2.5 py-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold font-mono">
                {vencimentosResumo.criticosCount} críticos
              </div>
              <div className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold font-mono">
                {vencimentosResumo.tresDiasCount} em 3 dias
              </div>
            </div>

            <button
              onClick={() => onNavigate('vencimentos')}
              className="px-3.5 py-1.5 rounded-xl bg-[#F36B0B] hover:bg-[#C94F00] text-white font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-xs cursor-pointer ml-auto"
            >
              <span>Acessar Validades</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          MODAL 1: FICHA DETALHADA DO PRODUTO (AO CLICAR NO GRÁFICO 1)
         ========================================================================= */}
      {modalProduto && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full overflow-hidden my-auto">
            {/* Cabeçalho */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center border border-orange-500/40">
                  <Package className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-orange-300">
                    Ficha Operacional da Mercadoria
                  </span>
                  <h3 className="text-sm font-black text-white font-mono">
                    {modalProduto.codigo_exibicao}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalProduto(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo */}
            <div className="p-5 space-y-4 text-xs font-sans">
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block mb-0.5">
                  Descrição Completa
                </span>
                <p className="text-sm font-black text-slate-900">
                  {modalProduto.descricao}
                </p>
              </div>

              {/* Grid de Informações Financeiras e Operacionais */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Setor</span>
                  <span className="text-xs font-black text-slate-900">
                    {modalProduto.setor_operacional || 'LOJA'}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Embalagem</span>
                  <span className="text-xs font-black text-slate-900 font-mono">
                    {modalProduto.embalagem || 'UN'}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Estoque</span>
                  <span className="text-xs font-black text-[#C94F00] font-mono">
                    {modalProduto.estoque_formatado}
                  </span>
                </div>

                <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                  <span className="text-[10px] font-bold text-amber-700 uppercase block">Valor Disponível</span>
                  <span className="text-xs font-black text-amber-950 font-mono">
                    {modalProduto.valor_estoque_formatado}
                  </span>
                </div>
              </div>

              {/* Dias sem Venda & Idade */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Dias Sem Venda:</span>
                  <span className="text-xs font-black font-mono text-amber-700">{modalProduto.dias_sem_venda} dias</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Idade:</span>
                  <span className="text-xs font-black font-mono text-[#C94F00]">{modalProduto.idade} dias</span>
                </div>
              </div>

              {/* Responsáveis Vinculados */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <span className="text-[10px] font-black uppercase text-slate-500 block">
                  Responsáveis Vinculados (SPCOI007)
                </span>
                <div className="text-[11px] space-y-1">
                  <div className="flex items-start justify-between">
                    <span className="text-slate-500">Indústrias:</span>
                    <span className="font-bold text-slate-900 text-right">
                      {modalProduto.industrias_nomes.length > 0 ? modalProduto.industrias_nomes.join(', ') : 'Não vinculada'}
                    </span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-slate-500">Promotores:</span>
                    <span className="font-bold text-slate-900 text-right">
                      {modalProduto.promotores_nomes.length > 0 ? modalProduto.promotores_nomes.join(', ') : 'Sem promotor'}
                    </span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-slate-500">Agências:</span>
                    <span className="font-bold text-slate-900 text-right">
                      {modalProduto.agencias_nomes.length > 0 ? modalProduto.agencias_nomes.join(', ') : 'Não informada'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Ações da Ficha */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setModalProduto(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 uppercase text-xs cursor-pointer"
              >
                Fechar
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const prod = modalProduto.produto;
                    setModalProduto(null);
                    onSelectProduto(prod);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Abrir na Consulta</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const prod = modalProduto.produto;
                    setModalProduto(null);
                    if (onCadastrarParaProduto) {
                      onCadastrarParaProduto(prod);
                    } else {
                      onCadastrarDireto();
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-[#F36B0B] hover:bg-[#C94F00] text-white font-black uppercase text-xs flex items-center gap-1.5 shadow-md cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  <span>Cadastrar Vencimento</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: DRILLDOWN DA INDÚSTRIA (AO CLICAR NO GRÁFICO 2)
         ========================================================================= */}
      {modalIndustria && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden my-auto">
            {/* Cabeçalho */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-600/30 flex items-center justify-center border border-purple-500/40">
                  <Building2 className="w-5 h-5 text-purple-300" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-purple-300">
                    Drilldown da Indústria
                  </span>
                  <h3 className="text-sm font-black text-white truncate max-w-md">
                    {modalIndustria.nome}
                  </h3>
                  {modalIndustria.cnpj !== 'SEM_CNPJ' && (
                    <p className="text-[10px] text-slate-400 font-mono">
                      CNPJ: {modalIndustria.cnpj}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalIndustria(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Resumo e Barra de Ações */}
            <div className="p-4 bg-purple-50/50 border-b border-purple-100 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-[10px] font-black uppercase text-purple-700 block">
                    Valor Acumulado
                  </span>
                  <span className="text-base font-black text-purple-950 font-mono">
                    {formatarMoedaBR(modalIndustria.valorTotal)}
                  </span>
                </div>
                <div className="h-7 w-px bg-purple-200" />
                <div>
                  <span className="text-[10px] font-black uppercase text-purple-700 block">
                    SKUs Únicos
                  </span>
                  <span className="text-base font-black text-purple-950 font-mono">
                    {modalIndustria.itens.length} produtos
                  </span>
                </div>
              </div>

              {/* Botão Imprimir PDF A4 da Indústria */}
              <button
                type="button"
                onClick={() =>
                  gerarRelatorioEntidadeIsvA4Pdf(
                    'INDUSTRIA',
                    modalIndustria.nome,
                    modalIndustria.cnpj !== 'SEM_CNPJ' ? `CNPJ: ${modalIndustria.cnpj}` : 'Indústria Vinculada',
                    modalIndustria.itens
                  )
                }
                className="px-3.5 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Imprimir PDF (A4)</span>
              </button>
            </div>

            {/* Campo de Busca Interna */}
            <div className="p-3 border-b border-slate-200 bg-white">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filtrar produtos desta indústria (código, descrição, EAN)..."
                  value={buscaModal}
                  onChange={(e) => {
                    setBuscaModal(e.target.value);
                    setPaginaModal(1);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>
            </div>

            {/* Tabela de Produtos */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
                      <th className="py-2 px-2 text-center w-24">Código</th>
                      <th className="py-2 px-2">Descrição</th>
                      <th className="py-2 px-2 text-right">Estoque</th>
                      <th className="py-2 px-2 text-center">Dias s/v</th>
                      <th className="py-2 px-2 text-right">Valor Disp.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {itensModalPaginados.itens.map((it) => (
                      <tr key={`ind-p-${it.codigo_interno}`} className="hover:bg-slate-50">
                        <td className="py-2 px-2 text-center font-mono font-bold text-slate-600">
                          {it.codigo_exibicao}
                        </td>
                        <td className="py-2 px-2 font-bold text-slate-900">
                          {it.descricao}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-bold text-slate-700">
                          {it.estoque_formatado}
                        </td>
                        <td className="py-2 px-2 text-center font-mono text-amber-700 font-bold">
                          {it.dias_sem_venda}d
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-black text-slate-900">
                          {it.valor_estoque_formatado}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Paginação */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-[11px] text-slate-500">
                Página {paginaModal} de {itensModalPaginados.totalPaginas} ({itensModalPaginados.total} itens)
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={paginaModal <= 1}
                  onClick={() => setPaginaModal((p) => p - 1)}
                  className="p-1 rounded-md border border-slate-300 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={paginaModal >= itensModalPaginados.totalPaginas}
                  onClick={() => setPaginaModal((p) => p + 1)}
                  className="p-1 rounded-md border border-slate-300 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: DRILLDOWN DA AGÊNCIA (AO CLICAR NO GRÁFICO 3)
         ========================================================================= */}
      {modalAgencia && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden my-auto">
            {/* Cabeçalho */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600/30 flex items-center justify-center border border-emerald-500/40">
                  <Users className="w-5 h-5 text-emerald-300" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-emerald-300">
                    Drilldown da Agência
                  </span>
                  <h3 className="text-sm font-black text-white truncate max-w-md">
                    {modalAgencia.nome}
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    {modalAgencia.promotoresRelacionados.length} promotores vinculados
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalAgencia(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Resumo e Barra de Ações */}
            <div className="p-4 bg-emerald-50/50 border-b border-emerald-100 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-[10px] font-black uppercase text-emerald-700 block">
                    Valor Acumulado
                  </span>
                  <span className="text-base font-black text-emerald-950 font-mono">
                    {formatarMoedaBR(modalAgencia.valorTotal)}
                  </span>
                </div>
                <div className="h-7 w-px bg-emerald-200" />
                <div>
                  <span className="text-[10px] font-black uppercase text-emerald-700 block">
                    SKUs Vinculados
                  </span>
                  <span className="text-base font-black text-emerald-950 font-mono">
                    {modalAgencia.itens.length} produtos
                  </span>
                </div>
              </div>

              {/* Botão Imprimir PDF A4 da Agência */}
              <button
                type="button"
                onClick={() =>
                  gerarRelatorioEntidadeIsvA4Pdf(
                    'AGENCIA',
                    modalAgencia.nome,
                    `Agência com ${modalAgencia.promotoresRelacionados.length} promotores vinculados`,
                    modalAgencia.itens
                  )
                }
                className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Imprimir PDF (A4)</span>
              </button>
            </div>

            {/* Indústrias & Promotores da Agência */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs">
              <div className="flex items-start gap-2 text-[11px] mb-1">
                <span className="font-bold text-slate-500 shrink-0">Promotores:</span>
                <span className="text-slate-800 font-medium">
                  {modalAgencia.promotoresRelacionados.length > 0 ? modalAgencia.promotoresRelacionados.join(', ') : 'Nenhum promotor cadastrado'}
                </span>
              </div>
              <div className="flex items-start gap-2 text-[11px]">
                <span className="font-bold text-slate-500 shrink-0">Indústrias:</span>
                <span className="text-slate-800 font-medium truncate">
                  {modalAgencia.industriasRelacionadas.length > 0 ? modalAgencia.industriasRelacionadas.join(', ') : 'Nenhuma'}
                </span>
              </div>
            </div>

            {/* Campo de Busca Interna */}
            <div className="p-3 border-b border-slate-200 bg-white">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filtrar produtos desta agência (código, descrição, EAN)..."
                  value={buscaModal}
                  onChange={(e) => {
                    setBuscaModal(e.target.value);
                    setPaginaModal(1);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>
            </div>

            {/* Tabela de Produtos */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
                      <th className="py-2 px-2 text-center w-24">Código</th>
                      <th className="py-2 px-2">Descrição</th>
                      <th className="py-2 px-2 text-right">Estoque</th>
                      <th className="py-2 px-2 text-center">Dias s/v</th>
                      <th className="py-2 px-2 text-right">Valor Disp.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {itensModalPaginados.itens.map((it) => (
                      <tr key={`ag-p-${it.codigo_interno}`} className="hover:bg-slate-50">
                        <td className="py-2 px-2 text-center font-mono font-bold text-slate-600">
                          {it.codigo_exibicao}
                        </td>
                        <td className="py-2 px-2 font-bold text-slate-900">
                          {it.descricao}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-bold text-slate-700">
                          {it.estoque_formatado}
                        </td>
                        <td className="py-2 px-2 text-center font-mono text-amber-700 font-bold">
                          {it.dias_sem_venda}d
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-black text-slate-900">
                          {it.valor_estoque_formatado}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Paginação */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-[11px] text-slate-500">
                Página {paginaModal} de {itensModalPaginados.totalPaginas} ({itensModalPaginados.total} itens)
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={paginaModal <= 1}
                  onClick={() => setPaginaModal((p) => p - 1)}
                  className="p-1 rounded-md border border-slate-300 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={paginaModal >= itensModalPaginados.totalPaginas}
                  onClick={() => setPaginaModal((p) => p + 1)}
                  className="p-1 rounded-md border border-slate-300 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
