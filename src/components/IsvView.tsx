import {
  AlertCircle,
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  Boxes,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Package,
  PackageX,
  Plus,
  RefreshCw,
  Search,
  TrendingDown,
  UserCheck,
  Users,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { formatarMoedaBR } from '../services/deviceId';
import { gerarRelatorioIsvA3Pdf } from '../services/isvPdfService';
import { isvService } from '../services/isvService';
import { promotorService } from '../services/promotorService';
import {
  FiltrosIsv,
  Industria,
  ItemIsv,
  ProdutoSMG,
  Promotor,
  SolicitacaoAjusteIsv
} from '../types';
import { ModalRegistrarAjusteIsv } from './isv/ModalRegistrarAjusteIsv';

interface IsvViewProps {
  produtos: ProdutoSMG[];
  onSelectProduto?: (produto: ProdutoSMG) => void;
  onOpenCadastrarModal?: (produto: ProdutoSMG) => void;
  onBack?: () => void;
}

export const IsvView: React.FC<IsvViewProps> = ({
  produtos,
  onSelectProduto,
  onOpenCadastrarModal,
  onBack,
}) => {
  const [subAba, setSubAba] = useState<'geral' | 'ajustes' | 'ocorrencias'>('geral');
  const [industrias, setIndustrias] = useState<Industria[]>([]);
  const [promotores, setPromotores] = useState<Promotor[]>([]);
  const [solicitacoesAjuste, setSolicitacoesAjuste] = useState<SolicitacaoAjusteIsv[]>([]);

  // Modal de registro de ajuste físico
  const [modalAjusteItem, setModalAjusteItem] = useState<ItemIsv | null>(null);
  const [isModalAjusteOpen, setIsModalAjusteOpen] = useState(false);

  // Modal de geração de PDF
  const [isModalPdfOpen, setIsModalPdfOpen] = useState(false);
  const [pdfExibirValor, setPdfExibirValor] = useState(true);
  const [pdfTipoAgrupamento, setPdfTipoAgrupamento] = useState<'GERAL' | 'INDUSTRIA' | 'PROMOTOR' | 'AGENCIA'>('GERAL');
  const [pdfEntidadeSelecionada, setPdfEntidadeSelecionada] = useState<string>('');

  // Filtros combináveis do ISV
  const [filtros, setFiltros] = useState<FiltrosIsv>({
    agencia: 'TODAS',
    industriaCnpj: 'TODAS',
    promotorId: 'TODOS',
    termoBusca: '',
    setorFisico: 'TODOS',
    setorBalanco: 'TODOS',
    diasSemVenda: null,
    modoDiasSemVenda: 'MINIMO',
    idade: null,
    modoIdade: 'MINIMO',
    filtroEstoque: 'COM_ESTOQUE', // Foco operacional em produtos com estoque físico
    filtroValor: 'TODOS',
    situacaoVinculo: 'TODOS',
    ordenacao: 'MAIOR_VALOR', // Padrão aprovado: maior valor primeiro
  });

  // Paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS_POR_PAGINA = 30;

  // Carregar dados e sincronizar listeners
  const recarregarDados = () => {
    setIndustrias(isvService.getIndustrias());
    setPromotores(promotorService.getPromotores());
    setSolicitacoesAjuste(isvService.getSolicitacoesAjuste());
  };

  useEffect(() => {
    isvService.init().then(() => recarregarDados());
    promotorService.init().then(() => recarregarDados());

    const unsubIsv = isvService.subscribe(recarregarDados);
    const unsubPromotor = promotorService.subscribe(recarregarDados);

    return () => {
      unsubIsv();
      unsubPromotor();
    };
  }, []);

  // Lista de Agências disponíveis
  const agenciasDisponiveis = useMemo(() => {
    const setAg = new Set<string>();
    promotores.forEach((p) => {
      if (p.agenciaNome && p.agenciaNome.trim()) setAg.add(p.agenciaNome.trim());
    });
    return Array.from(setAg).sort();
  }, [promotores]);

  // Lista de Setores Físicos e Balanço da base SMGOI013
  const setoresFisicos = useMemo(() => {
    const setSetor = new Set<string>();
    produtos.forEach((p) => {
      if (p.setor_fisico) setSetor.add(p.setor_fisico);
    });
    return Array.from(setSetor).sort();
  }, [produtos]);

  const setoresBalanco = useMemo(() => {
    const setBal = new Set<string>();
    produtos.forEach((p) => {
      if (p.setor_balanco) setBal.add(p.setor_balanco);
    });
    return Array.from(setBal).sort();
  }, [produtos]);

  // Itens brutos enriquecidos com relacionamentos e cálculos
  const itensIsvBrutos = useMemo(() => {
    return isvService.getItensIsv(produtos);
  }, [produtos, industrias, promotores]);

  // Itens filtrados de acordo com a aba e filtros combináveis
  const itensFiltrados = useMemo(() => {
    let base = itensIsvBrutos;

    // Se estiver na aba de Possíveis Ajustes: filtrar estritamente os elegíveis
    if (subAba === 'ajustes') {
      base = base.filter((it) => it.elegivel_ajuste);
    }

    return isvService.filtrarItensIsv(base, filtros);
  }, [itensIsvBrutos, filtros, subAba]);

  // Indicadores consolidados do painel (sempre com produtos únicos)
  const indicadores = useMemo(() => {
    return isvService.getIndicadoresIsv(itensFiltrados);
  }, [itensFiltrados]);

  // Itens da página atual
  const totalPaginas = Math.ceil(itensFiltrados.length / ITENS_POR_PAGINA) || 1;
  const itensPaginados = useMemo(() => {
    const start = (paginaAtual - 1) * ITENS_POR_PAGINA;
    return itensFiltrados.slice(start, start + ITENS_POR_PAGINA);
  }, [itensFiltrados, paginaAtual]);

  // Resetar página ao mudar filtros ou abas
  useEffect(() => {
    setPaginaAtual(1);
  }, [filtros, subAba]);

  const handleOpenAjusteModal = (item: ItemIsv) => {
    setModalAjusteItem(item);
    setIsModalAjusteOpen(true);
  };

  const handleDispararPdf = () => {
    let tituloFiltro = 'Geral da Loja';
    let nomeEntidade = '';
    let subtituloEntidade = '';

    if (pdfTipoAgrupamento === 'INDUSTRIA' && pdfEntidadeSelecionada) {
      const ind = industrias.find((i) => i.cnpj === pdfEntidadeSelecionada);
      if (ind) {
        nomeEntidade = ind.nome_exibicao || ind.razao_social;
        subtituloEntidade = `CNPJ: ${ind.cnpj_formatado || ind.cnpj} • ${ind.razao_social}`;
        tituloFiltro = `Indústria: ${nomeEntidade}`;
      }
    } else if (pdfTipoAgrupamento === 'PROMOTOR' && pdfEntidadeSelecionada) {
      const prom = promotores.find((p) => p.promotorId === pdfEntidadeSelecionada);
      if (prom) {
        nomeEntidade = prom.nome;
        subtituloEntidade = `Agência: ${prom.agenciaNome || 'Não informada'}`;
        tituloFiltro = `Promotor: ${nomeEntidade}`;
      }
    } else if (pdfTipoAgrupamento === 'AGENCIA' && pdfEntidadeSelecionada) {
      nomeEntidade = pdfEntidadeSelecionada;
      subtituloEntidade = `Agência: ${pdfEntidadeSelecionada}`;
      tituloFiltro = `Agência: ${pdfEntidadeSelecionada}`;
    }

    gerarRelatorioIsvA3Pdf(itensFiltrados, {
      tituloFiltro,
      tipoAgrupamento: pdfTipoAgrupamento,
      nomeEntidade,
      subtituloEntidade,
      exibirValorEstoque: pdfExibirValor,
      filialNome: 'FILIAL 172 - CASCAVEL',
    });

    setIsModalPdfOpen(false);
  };

  return (
    <div id="view-isv-itens-sem-venda" className="space-y-4 pb-24 max-w-6xl mx-auto animate-fadeIn">
      {/* 1. Header do Módulo com Gradiente Executivo */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-lg border border-slate-800 space-y-3 relative overflow-hidden">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Voltar ao Menu"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 flex items-center justify-center border border-blue-500/40">
              <TrendingDown className="w-5 h-5 text-blue-300 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-black uppercase tracking-tight text-white leading-tight">
                  ISV — ITENS SEM VENDA
                </h1>
                <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 uppercase tracking-wider">
                  Prevenção & Giro
                </span>
              </div>
              <p className="text-xs text-blue-200 font-medium">
                Monitoramento de mercadorias paradas, cálculo financeiro e acompanhamento de promotores
              </p>
            </div>
          </div>

          {/* Botão de Exportação A3 em PDF */}
          <button
            id="btn-abrir-modal-pdf-isv"
            type="button"
            onClick={() => setIsModalPdfOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2 shadow-md active:scale-95"
          >
            <Download className="w-4 h-4 stroke-[2.5]" />
            <span>Gerar Relatório A3 (PDF)</span>
          </button>
        </div>

        {/* Abas Sub-Navegação: Geral / Possíveis Ajustes / Ocorrências */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-800 text-xs font-black uppercase tracking-wider">
          <button
            onClick={() => setSubAba('geral')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              subAba === 'geral'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Todos os Itens ({itensIsvBrutos.length})</span>
          </button>

          <button
            onClick={() => setSubAba('ajustes')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              subAba === 'ajustes'
                ? 'bg-amber-600 text-white'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
            <span>Possíveis Ajustes ({itensIsvBrutos.filter((i) => i.elegivel_ajuste).length})</span>
          </button>

          <button
            onClick={() => setSubAba('ocorrencias')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              subAba === 'ocorrencias'
                ? 'bg-purple-600 text-white'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <PackageX className="w-3.5 h-3.5" />
            <span>Ocorrências Registradas ({solicitacoesAjuste.length})</span>
          </button>
        </div>
      </div>

      {/* 2. Cards de Indicadores do Painel ISV (Seção 9) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {/* Total de Produtos */}
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase block">Produtos</span>
          <span className="text-base sm:text-lg font-black text-slate-900 font-mono">
            {indicadores.totalProdutos}
          </span>
        </div>

        {/* Com Estoque */}
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase block">Com Estoque</span>
          <span className="text-base sm:text-lg font-black text-blue-700 font-mono">
            {indicadores.produtosComEstoque}
          </span>
        </div>

        {/* Valor Total Parado (em R$) */}
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-1 col-span-2 sm:col-span-2">
          <span className="text-[10px] font-bold text-amber-700 uppercase flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            Capital Parado (Custo Médio)
          </span>
          <span className="text-base sm:text-lg font-black text-amber-950 font-mono block truncate">
            {formatarMoedaBR(indicadores.valorTotalEstoque)}
          </span>
        </div>

        {/* Indústrias */}
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase block">Indústrias</span>
          <span className="text-base sm:text-lg font-black text-slate-900 font-mono">
            {indicadores.totalIndustrias}
          </span>
        </div>

        {/* Promotores */}
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase block">Promotores</span>
          <span className="text-base sm:text-lg font-black text-emerald-700 font-mono">
            {indicadores.totalPromotores}
          </span>
        </div>

        {/* Sem Responsável */}
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase block">S/ Promotor</span>
          <span className="text-base sm:text-lg font-black text-red-600 font-mono">
            {indicadores.produtosSemResponsavel}
          </span>
        </div>
      </div>

      {subAba !== 'ocorrencias' && (
        <>
          {/* 3. Barra de Filtros Combináveis (Seção 7) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-black uppercase text-slate-800 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-blue-700" />
                Filtros Combináveis
              </span>

              {/* Botão Limpar Filtros */}
              <button
                type="button"
                onClick={() =>
                  setFiltros({
                    agencia: 'TODAS',
                    industriaCnpj: 'TODAS',
                    promotorId: 'TODOS',
                    termoBusca: '',
                    setorFisico: 'TODOS',
                    setorBalanco: 'TODOS',
                    diasSemVenda: null,
                    modoDiasSemVenda: 'MINIMO',
                    idade: null,
                    modoIdade: 'MINIMO',
                    filtroEstoque: 'COM_ESTOQUE',
                    filtroValor: 'TODOS',
                    situacaoVinculo: 'TODOS',
                    ordenacao: 'MAIOR_VALOR',
                  })
                }
                className="text-[11px] font-bold text-blue-700 hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Restaurar Padrão
              </button>
            </div>

            {/* Linha 1: Busca Textual + Responsáveis */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              {/* Busca Texto */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Código, dígito ou descrição..."
                  value={filtros.termoBusca}
                  onChange={(e) => setFiltros((prev) => ({ ...prev, termoBusca: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-hidden"
                />
              </div>

              {/* Agência */}
              <div>
                <select
                  value={filtros.agencia}
                  onChange={(e) => setFiltros((prev) => ({ ...prev, agencia: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-hidden"
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
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-hidden"
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
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-hidden"
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

            {/* Linha 2: Dias Sem Venda Chips (3, 4, 5, 6, 7, 8, 9, 10, 15) */}
            <div className="pt-1 flex items-center gap-1.5 overflow-x-auto text-xs pb-1">
              <span className="text-[10px] font-black uppercase text-slate-400 shrink-0">
                Dias s/ Venda:
              </span>
              <button
                type="button"
                onClick={() => setFiltros((prev) => ({ ...prev, diasSemVenda: null }))}
                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                  filtros.diasSemVenda === null
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Todos
              </button>
              {[3, 4, 5, 6, 7, 8, 9, 10, 15].map((dias) => (
                <button
                  key={dias}
                  type="button"
                  onClick={() =>
                    setFiltros((prev) => ({
                      ...prev,
                      diasSemVenda: prev.diasSemVenda === dias ? null : dias,
                    }))
                  }
                  className={`px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap ${
                    filtros.diasSemVenda === dias
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {dias}d{filtros.modoDiasSemVenda === 'MINIMO' ? '+' : ''}
                </button>
              ))}

              <div className="flex items-center gap-1 pl-2 border-l border-slate-200 text-[10px]">
                <button
                  type="button"
                  onClick={() => setFiltros((prev) => ({ ...prev, modoDiasSemVenda: 'MINIMO' }))}
                  className={`px-1.5 py-0.5 rounded font-bold ${
                    filtros.modoDiasSemVenda === 'MINIMO'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-500'
                  }`}
                >
                  Mínimo
                </button>
                <button
                  type="button"
                  onClick={() => setFiltros((prev) => ({ ...prev, modoDiasSemVenda: 'EXATO' }))}
                  className={`px-1.5 py-0.5 rounded font-bold ${
                    filtros.modoDiasSemVenda === 'EXATO'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-500'
                  }`}
                >
                  Exato
                </button>
              </div>
            </div>

            {/* Linha 3: Estoque, Valor, Vinculação e Ordenação */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-100 text-xs font-bold">
              {/* Estoque */}
              <div>
                <select
                  value={filtros.filtroEstoque}
                  onChange={(e) =>
                    setFiltros((prev) => ({
                      ...prev,
                      filtroEstoque: e.target.value as any,
                    }))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden"
                >
                  <option value="COM_ESTOQUE">Estoque: Com Estoque (&gt; 0)</option>
                  <option value="TODOS">Estoque: Todos</option>
                  <option value="SEM_ESTOQUE">Estoque: Zerado (= 0)</option>
                </select>
              </div>

              {/* Faixa de Valor */}
              <div>
                <select
                  value={filtros.filtroValor}
                  onChange={(e) =>
                    setFiltros((prev) => ({
                      ...prev,
                      filtroValor: e.target.value as any,
                    }))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden"
                >
                  <option value="TODOS">Valor: Todos os Valores</option>
                  <option value="ATE_250">Valor: Até R$ 250,00</option>
                  <option value="ACIMA_250">Valor: Acima de R$ 250,00</option>
                </select>
              </div>

              {/* Situação da Vinculação */}
              <div>
                <select
                  value={filtros.situacaoVinculo}
                  onChange={(e) =>
                    setFiltros((prev) => ({
                      ...prev,
                      situacaoVinculo: e.target.value as any,
                    }))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden"
                >
                  <option value="TODOS">Vínculo: Todos</option>
                  <option value="COM_PROMOTOR">Com Promotor Atribuído</option>
                  <option value="SEM_PROMOTOR">Sem Promotor Responsável</option>
                  <option value="MULTIPLOS_CNPJS">Múltiplos CNPJs (Revisão)</option>
                </select>
              </div>

              {/* Ordenação (Padrão: Maior Valor) */}
              <div>
                <select
                  value={filtros.ordenacao}
                  onChange={(e) =>
                    setFiltros((prev) => ({
                      ...prev,
                      ordenacao: e.target.value as any,
                    }))
                  }
                  className="w-full bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5 text-xs font-black text-amber-950 focus:bg-white focus:outline-hidden"
                >
                  <option value="MAIOR_VALOR">Ordenar: Maior Valor de Estoque</option>
                  <option value="MENOR_VALOR">Ordenar: Menor Valor de Estoque</option>
                  <option value="MAIS_DIAS_SEM_VENDA">Ordenar: Mais Dias Sem Venda</option>
                  <option value="MAIOR_IDADE">Ordenar: Maior Idade</option>
                  <option value="CODIGO">Ordenar: Código do Produto</option>
                </select>
              </div>
            </div>
          </div>

          {/* 4. Tabela de Itens ISV com as 11 Colunas Oficiais */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-blue-700" />
                Exibindo <strong>{itensFiltrados.length}</strong> produtos
                {subAba === 'ajustes' && ' candidatos a verificação física'}
              </span>

              {/* Paginação compacta */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={paginaAtual <= 1}
                  onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                  className="px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-700 font-bold disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="font-mono text-[11px]">
                  Página {paginaAtual} de {totalPaginas}
                </span>
                <button
                  type="button"
                  disabled={paginaAtual >= totalPaginas}
                  onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}
                  className="px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-700 font-bold disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white uppercase text-[10px] tracking-wider font-mono">
                    <th className="py-2.5 px-3 font-black text-center">CÓDIGO</th>
                    <th className="py-2.5 px-2 font-black text-center">DIG</th>
                    <th className="py-2.5 px-3 font-black">DESCRIÇÃO</th>
                    <th className="py-2.5 px-3 font-black">EMBALAGEM</th>
                    <th className="py-2.5 px-3 font-black text-right">ESTOQUE</th>
                    <th className="py-2.5 px-2 font-black text-center">DIAS S/ VENDA</th>
                    <th className="py-2.5 px-2 font-black text-center">IDADE</th>
                    <th className="py-2.5 px-3 font-black">INDÚSTRIA</th>
                    <th className="py-2.5 px-3 font-black">PROMOTOR</th>
                    <th className="py-2.5 px-3 font-black">AGÊNCIA</th>
                    <th className="py-2.5 px-3 font-black text-right">VALOR ESTOQUE</th>
                    <th className="py-2.5 px-2 font-black text-center">AÇÕES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {itensPaginados.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-slate-400 text-xs">
                        Nenhum produto atende aos filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    itensPaginados.map((item) => {
                      return (
                        <tr
                          key={item.codigo_interno}
                          className="hover:bg-blue-50/40 transition-colors"
                        >
                          {/* 1. CÓDIGO */}
                          <td className="py-2 px-3 font-mono font-bold text-blue-700 text-center whitespace-nowrap">
                            {item.codigo_interno}
                          </td>

                          {/* 2. DIG */}
                          <td className="py-2 px-2 font-mono text-slate-500 text-center whitespace-nowrap">
                            {item.digito || '-'}
                          </td>

                          {/* 3. DESCRIÇÃO */}
                          <td className="py-2 px-3 font-black text-slate-900 uppercase">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{item.descricao}</span>
                              {item.multiplos_cnpjs && (
                                <span
                                  className="text-[9px] font-bold bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded border border-amber-300"
                                  title="Produto relacionado a mais de um CNPJ na base SPCOI007"
                                >
                                  Múltiplos CNPJs
                                </span>
                              )}
                              {item.elegivel_ajuste && (
                                <span
                                  className="text-[9px] font-bold bg-red-100 text-red-900 px-1.5 py-0.2 rounded border border-red-300"
                                  title="Candidato a averiguação física (&gt;10d sem venda, &lt;R$250, estoque&gt;0)"
                                >
                                  Verificar Físico
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 4. EMBALAGEM */}
                          <td className="py-2 px-3 text-slate-600 whitespace-nowrap font-mono text-[11px]">
                            {item.embalagem || 'UN'}
                          </td>

                          {/* 5. ESTOQUE */}
                          <td className="py-2 px-3 text-right font-mono font-black text-slate-800 whitespace-nowrap">
                            {item.estoque_formatado}
                          </td>

                          {/* 6. DIAS SEM VENDA */}
                          <td className="py-2 px-2 text-center whitespace-nowrap">
                            <span
                              className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                                item.dias_sem_venda >= 10
                                  ? 'bg-red-50 text-red-700 border border-red-200'
                                  : item.dias_sem_venda >= 5
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'text-slate-600'
                              }`}
                            >
                              {item.dias_sem_venda}
                            </span>
                          </td>

                          {/* 7. IDADE */}
                          <td className="py-2 px-2 text-center font-mono text-slate-600 whitespace-nowrap text-[11px]">
                            {item.idade}d
                          </td>

                          {/* 8. INDÚSTRIA */}
                          <td className="py-2 px-3 text-slate-800 font-medium">
                            {item.industrias_nomes.length > 0 ? (
                              item.industrias_nomes.join(' • ')
                            ) : (
                              <span className="text-slate-400 italic">Não informada</span>
                            )}
                          </td>

                          {/* 9. PROMOTOR */}
                          <td className="py-2 px-3 text-slate-800 font-medium">
                            {item.promotores_nomes.length > 0 ? (
                              <span className="text-emerald-800 font-bold">
                                {item.promotores_nomes.join(' • ')}
                              </span>
                            ) : (
                              <span className="text-amber-700 text-[11px] font-semibold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                                Sem promotor
                              </span>
                            )}
                          </td>

                          {/* 10. AGÊNCIA */}
                          <td className="py-2 px-3 text-slate-600 font-medium text-[11px]">
                            {item.agencias_nomes.length > 0 ? (
                              item.agencias_nomes.join(' • ')
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          {/* 11. VALOR DO ESTOQUE */}
                          <td className="py-2 px-3 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                            {item.valor_estoque_formatado}
                          </td>

                          {/* 12. AÇÕES */}
                          <td className="py-2 px-2 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleOpenAjusteModal(item)}
                              className="p-1 rounded text-amber-700 hover:bg-amber-100 transition-colors"
                              title="Registrar ocorrência de produto não localizado fisicamente"
                            >
                              <PackageX className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 5. Sub-Aba: Ocorrências de Ajustes Registradas */}
      {subAba === 'ocorrencias' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase text-slate-800 flex items-center gap-1.5">
              <PackageX className="w-4 h-4 text-purple-700" />
              Ocorrências Registradas para Averiguação de Estoque Físico
            </h3>
            <span className="text-[10px] font-bold bg-purple-100 text-purple-900 px-2 py-0.5 rounded-full">
              {solicitacoesAjuste.length} Registros
            </span>
          </div>

          {solicitacoesAjuste.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              Nenhuma ocorrência registrada até o momento.
            </div>
          ) : (
            <div className="space-y-2.5">
              {solicitacoesAjuste.map((sol) => (
                <div
                  key={sol.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[11px]">
                          {sol.codigo_exibicao}
                        </span>
                        <h4 className="font-black text-slate-900 uppercase">
                          {sol.descricao}
                        </h4>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Registrado por: <strong>{sol.responsavel}</strong> em{' '}
                        <span className="font-mono">{sol.data_registro}</span>
                      </p>
                    </div>

                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 uppercase">
                      {sol.status}
                    </span>
                  </div>

                  <p className="text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200 text-[11px] leading-relaxed">
                    {sol.observacao}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal de Registro de Ajuste Físico */}
      <ModalRegistrarAjusteIsv
        isOpen={isModalAjusteOpen}
        onClose={() => setIsModalAjusteOpen(false)}
        item={modalAjusteItem}
        onSuccess={() => {
          recarregarDados();
        }}
      />

      {/* Modal de Configuração do Relatório A3 PDF */}
      {isModalPdfOpen && (
        <div
          id="modal-config-pdf-isv-overlay"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModalPdfOpen(false);
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto animate-scaleUp">
            <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-slate-900 text-white p-4 sm:p-5 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-white/15 rounded-xl border border-white/20">
                  <FileText className="w-6 h-6 text-blue-200 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-black tracking-tight uppercase">
                    Exportar Relatório A3
                  </h3>
                  <p className="text-xs text-blue-200 font-medium mt-0.5">
                    ISV — Formato Oficial A3 Horizontal
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalPdfOpen(false)}
                className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-700">
              {/* Opção Obrigatória: Exibir Valor do Estoque */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pdfExibirValor}
                    onChange={(e) => setPdfExibirValor(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 mt-0.5"
                  />
                  <div>
                    <span className="font-black text-slate-900 uppercase block">
                      [✓] EXIBIR VALOR DO ESTOQUE
                    </span>
                    <p className="text-[11px] text-slate-500 font-medium leading-relaxed mt-0.5">
                      Quando marcado, inclui a coluna <strong>VALOR DO ESTOQUE (11 colunas)</strong> e o somatório em R$.
                      Ao desmarcar, a coluna é removida <strong>(10 colunas)</strong> e nenhum valor financeiro é exibido no documento.
                    </p>
                  </div>
                </label>
              </div>

              {/* Tipo de Cabeçalho / Relatório */}
              <div className="space-y-1">
                <label className="block text-xs font-black uppercase text-slate-700">
                  Cabeçalho / Agrupamento do Relatório:
                </label>
                <select
                  value={pdfTipoAgrupamento}
                  onChange={(e) => {
                    setPdfTipoAgrupamento(e.target.value as any);
                    setPdfEntidadeSelecionada('');
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden"
                >
                  <option value="GERAL">Geral (Filtros Ativos)</option>
                  <option value="INDUSTRIA">Por Indústria Específica</option>
                  <option value="PROMOTOR">Por Promotor Específico</option>
                  <option value="AGENCIA">Por Agência Específica</option>
                </select>
              </div>

              {/* Seletor da Entidade específica caso selecionado */}
              {pdfTipoAgrupamento === 'INDUSTRIA' && (
                <div className="space-y-1">
                  <label className="block text-xs font-black uppercase text-slate-700">
                    Selecione a Indústria:
                  </label>
                  <select
                    value={pdfEntidadeSelecionada}
                    onChange={(e) => setPdfEntidadeSelecionada(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden"
                  >
                    <option value="">Selecione...</option>
                    {industrias.map((ind) => (
                      <option key={ind.cnpj} value={ind.cnpj}>
                        {ind.nome_exibicao || ind.razao_social} ({ind.cnpj_formatado})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {pdfTipoAgrupamento === 'PROMOTOR' && (
                <div className="space-y-1">
                  <label className="block text-xs font-black uppercase text-slate-700">
                    Selecione o Promotor:
                  </label>
                  <select
                    value={pdfEntidadeSelecionada}
                    onChange={(e) => setPdfEntidadeSelecionada(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden"
                  >
                    <option value="">Selecione...</option>
                    {promotores.map((p) => (
                      <option key={p.promotorId} value={p.promotorId}>
                        {p.nome} ({p.agenciaNome})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {pdfTipoAgrupamento === 'AGENCIA' && (
                <div className="space-y-1">
                  <label className="block text-xs font-black uppercase text-slate-700">
                    Selecione a Agência:
                  </label>
                  <select
                    value={pdfEntidadeSelecionada}
                    onChange={(e) => setPdfEntidadeSelecionada(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden"
                  >
                    <option value="">Selecione...</option>
                    {agenciasDisponiveis.map((ag) => (
                      <option key={ag} value={ag}>
                        {ag}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Botões */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalPdfOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 uppercase text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDispararPdf}
                  className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-black uppercase text-xs flex items-center gap-1.5 shadow-md active:scale-95"
                >
                  <Download className="w-4 h-4 stroke-[2.5]" />
                  <span>Baixar PDF A3 ({itensFiltrados.length} Itens)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
