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
  Info,
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
import { processarSMGOI013 } from '../services/excelParser';
import { gerarRelatorioIsvA3Pdf } from '../services/isvPdfService';
import { isvService } from '../services/isvService';
import { productRepository } from '../services/productRepository';
import { promotorService } from '../services/promotorService';
import {
  FiltrosIsv,
  Industria,
  ItemIsv,
  ProdutoSMG,
  Promotor,
  SolicitacaoAjusteIsv
} from '../types';
import { ModalDetalhesVinculosIsv } from './isv/ModalDetalhesVinculosIsv';
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

  // Modal de detalhes dos vínculos comerciais (Múltiplas Indústrias/CNPJs)
  const [itemDetalhesVinculos, setItemDetalhesVinculos] = useState<ItemIsv | null>(null);

  // Modal de geração de PDF
  const [isModalPdfOpen, setIsModalPdfOpen] = useState(false);
  const [pdfExibirValor, setPdfExibirValor] = useState(true);
  const [pdfTipoAgrupamento, setPdfTipoAgrupamento] = useState<'GERAL' | 'INDUSTRIA' | 'PROMOTOR' | 'AGENCIA'>('GERAL');
  const [pdfEntidadeSelecionada, setPdfEntidadeSelecionada] = useState<string>('');
  const [pdfLimiteExportacao, setPdfLimiteExportacao] = useState<number | 'TODOS'>(30);

  // Modal de Auditoria do Catálogo / Custo Médio
  const [isModalAuditoriaOpen, setIsModalAuditoriaOpen] = useState(false);
  const [codAuditoriaCustom, setCodAuditoriaCustom] = useState('');
  const [isProcessandoArquivo, setIsProcessandoArquivo] = useState(false);
  const [mensagemProgresso, setMensagemProgresso] = useState('');

  const handleImportarSmgoi013Direto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessandoArquivo(true);
    setMensagemProgresso('Iniciando processamento da SMGOI013...');

    try {
      const res = await processarSMGOI013(file, (pct, msg) => {
        setMensagemProgresso(`${pct}% - ${msg}`);
      });
      alert(
        `Importação da SMGOI013 concluída com sucesso!\n\n` +
        `Total de produtos: ${res.total_lidos}\n` +
        `Atualizados: ${res.total_atualizados}\n` +
        `Novos: ${res.total_novos}\n\n` +
        `O Custo Médio e Estoque Convertido foram recalculados e persistidos no IndexedDB.`
      );
    } catch (err: any) {
      console.error('Erro na importação direta da SMGOI013:', err);
      alert(`Falha ao importar planilha: ${err.message || 'Formato inválido ou corrompido'}`);
    } finally {
      setIsProcessandoArquivo(false);
      setMensagemProgresso('');
      e.target.value = '';
    }
  };

  const handleRestaurarBaseReferencia = async () => {
    const confirmar = window.confirm(
      'Deseja carregar a base de referência oficial com os 5 produtos de teste?\n\n' +
      '• 68059-164: R$ 26.287,99\n' +
      '• 60662-158: R$ 16.471,28\n' +
      '• 85327-177: R$ 16.168,49\n' +
      '• 8911-191: R$ 9.575,49\n' +
      '• 56176-127: R$ 8.977,79\n\n' +
      'Isso permitirá validar imediatamente a ordenação por maior valor, o Top 30 e a exportação PDF.'
    );
    if (!confirmar) return;

    setIsProcessandoArquivo(true);
    setMensagemProgresso('Restaurando base oficial de referência...');
    try {
      await productRepository.loadDemoData();
      alert('Base oficial de referência restaurada com sucesso!');
    } catch (err: any) {
      console.error('Erro ao restaurar base de referência:', err);
      alert(`Erro: ${err.message}`);
    } finally {
      setIsProcessandoArquivo(false);
      setMensagemProgresso('');
    }
  };

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

  // Resumo financeiro estrito da lista filtrada
  const valorTotalFiltrado = useMemo(() => {
    return itensFiltrados.reduce((acc, item) => {
      return acc + (item.valor_estoque !== null ? item.valor_estoque : 0);
    }, 0);
  }, [itensFiltrados]);

  const qtdComValor = useMemo(() => {
    return itensFiltrados.filter((i) => i.valor_estoque !== null).length;
  }, [itensFiltrados]);

  const qtdSemValor = useMemo(() => {
    return itensFiltrados.filter((i) => i.valor_estoque === null).length;
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

    const fonteOficial = isvService.temPlanilhaIsv()
      ? 'Planilha Operacional Oficial ISV'
      : 'Base SMGOI013';

    gerarRelatorioIsvA3Pdf(itensFiltrados, {
      tituloFiltro,
      tipoAgrupamento: pdfTipoAgrupamento,
      nomeEntidade,
      subtituloEntidade,
      exibirValorEstoque: pdfExibirValor,
      filialNome: 'FILIAL 172 - CASCAVEL',
      limiteQuantidade: pdfLimiteExportacao,
      fonteOficial,
    });

    setIsModalPdfOpen(false);
  };

  const handleQuickPrintTop30 = () => {
    const fonteOficial = isvService.temPlanilhaIsv()
      ? 'Planilha Operacional Oficial ISV'
      : 'Base SMGOI013';

    gerarRelatorioIsvA3Pdf(itensFiltrados, {
      tituloFiltro: 'Geral da Loja (Top 30 Maiores)',
      tipoAgrupamento: 'GERAL',
      exibirValorEstoque: true,
      filialNome: 'FILIAL 172 - CASCAVEL',
      limiteQuantidade: 30,
      fonteOficial,
    });
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
                {isvService.temPlanilhaIsv() ? (
                  <span className="text-[10px] font-black bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/40 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Fonte Oficial ISV (XLSX)
                  </span>
                ) : (
                  <span className="text-[10px] font-bold bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30 uppercase tracking-wider">
                    Base SMGOI013
                  </span>
                )}
              </div>
              <p className="text-xs text-blue-200 font-medium">
                Monitoramento de mercadorias paradas, cálculo financeiro e acompanhamento de promotores
              </p>
            </div>
          </div>

          {/* Botões de Ação: Imprimir Top 30 e Gerar Relatório A3 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              id="btn-quick-print-top30"
              type="button"
              onClick={handleQuickPrintTop30}
              className="px-3.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md active:scale-95 border border-amber-400"
              title="Exporta imediatamente os 30 maiores produtos por valor em PDF A3"
            >
              <FileText className="w-4 h-4 stroke-[2.5]" />
              <span>Imprimir Top 30</span>
            </button>

            <button
              id="btn-abrir-modal-pdf-isv"
              type="button"
              onClick={() => setIsModalPdfOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2 shadow-md active:scale-95"
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              <span>Opções A3 (PDF)</span>
            </button>
          </div>
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

          {/* Banner Resumo Financeiro Oficial do Conjunto Filtrado */}
          <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white rounded-xl p-4 border border-blue-900/60 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-300 bg-blue-900/60 px-2 py-0.5 rounded border border-blue-700/50">
                  Classificação Financeira SMGOI013
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {itensFiltrados.length} {itensFiltrados.length === 1 ? 'produto filtrado' : 'produtos filtrados'}
                </span>
              </div>
              <div className="text-lg sm:text-xl font-black font-mono tracking-tight text-white flex items-baseline gap-2 flex-wrap">
                <span className="text-slate-200">VALOR TOTAL DO ESTOQUE FILTRADO:</span>
                <span className="text-emerald-400 text-xl sm:text-2xl font-black">
                  {formatarMoedaBR(valorTotalFiltrado)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
              <div className="bg-white/10 px-3 py-1.5 rounded-lg border border-white/10 text-xs">
                <span className="text-slate-400 text-[10px] block uppercase font-bold">Com Custo Médio</span>
                <span className="text-white font-mono font-black">{qtdComValor}</span>
                <span className="text-slate-400 text-[10px] ml-1">itens</span>
              </div>
              {qtdSemValor > 0 && (
                <div className="bg-amber-500/15 px-3 py-1.5 rounded-lg border border-amber-500/30 text-xs text-amber-200">
                  <span className="text-amber-300 text-[10px] block uppercase font-bold">Sem Custo</span>
                  <span className="text-white font-mono font-black">{qtdSemValor}</span>
                  <span className="text-amber-300 text-[10px] ml-1">indisponíveis</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setIsModalAuditoriaOpen(true)}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center gap-1.5 transition-colors shadow-xs"
                title="Auditar integridade de custo, estoque e cálculo financeiro do catálogo"
              >
                <Search className="w-3.5 h-3.5" />
                Auditar Códigos
              </button>
            </div>
          </div>

          {/* Alerta de Carregamento / Processamento de Planilha */}
          {isProcessandoArquivo && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3 text-blue-900 animate-pulse">
              <RefreshCw className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
              <div>
                <span className="font-black text-xs uppercase tracking-wide block">Processando Catálogo SMGOI013...</span>
                <span className="text-[11px] text-blue-700">{mensagemProgresso || 'Aguarde um momento...'}</span>
              </div>
            </div>
          )}

          {/* Notificação Explicativa: Por que os produtos estão com VALOR INDISPONÍVEL? */}
          {qtdSemValor > 0 && qtdComValor === 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-amber-900 text-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-black text-amber-950 text-xs uppercase tracking-wider">
                    Por que todos os {itensFiltrados.length} produtos exibem "VALOR INDISPONÍVEL"?
                  </p>
                  <p className="text-amber-900/90 text-[11px] leading-relaxed max-w-2xl">
                    Os produtos atualmente carregados no navegador foram importados anteriormente, momento em que a coluna <strong>Custo Médio</strong> ainda não era persistida no banco local IndexedDB. Conforme a regra de proteção contra números fictícios, valores ausentes <strong>não</strong> são substituídos por estimativas.
                  </p>
                  <p className="text-amber-800 text-[11px] font-semibold">
                    Para calcular o valor financeiro real (Estoque × Custo Médio), escolha uma das opções:
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap w-full md:w-auto">
                <label className="cursor-pointer px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl uppercase tracking-wider shadow-xs flex items-center gap-1.5 active:scale-95 transition-all">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Atualizar Planilha SMGOI013</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleImportarSmgoi013Direto}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleRestaurarBaseReferencia}
                  className="px-3.5 py-2 bg-blue-700 hover:bg-blue-600 text-white font-black text-xs rounded-xl uppercase tracking-wider shadow-xs flex items-center gap-1.5 active:scale-95 transition-all"
                  title="Carregar a base de referência oficial com os 5 produtos de teste"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Carregar Base Referência</span>
                </button>
              </div>
            </div>
          )}

          {qtdComValor > 0 && qtdSemValor > 0 && (
            <div className="bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-[11px] text-slate-600 flex items-center justify-between gap-2">
              <span>
                <strong>{qtdComValor}</strong> produtos com valor financeiro calculado. <strong>{qtdSemValor}</strong> produtos sem custo cadastrado na SMGOI013 exibem <em>VALOR INDISPONÍVEL</em> e ficam posicionados ao final da classificação.
              </span>
              <label className="cursor-pointer text-blue-700 hover:underline font-bold text-[10px] uppercase shrink-0">
                Atualizar SMGOI013
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleImportarSmgoi013Direto}
                />
              </label>
            </div>
          )}

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
                    <th className="py-2.5 px-3 font-black text-right min-w-[140px]">VALOR ESTOQUE</th>
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
                          <td className="py-2.5 px-3 font-black text-slate-900 uppercase">
                            <div className="flex items-center gap-1.5 flex-nowrap">
                              <span
                                className="truncate max-w-[190px] sm:max-w-[260px] block"
                                title={item.descricao}
                              >
                                {item.descricao}
                              </span>
                              {item.multiplos_cnpjs && (
                                <button
                                  type="button"
                                  onClick={() => setItemDetalhesVinculos(item)}
                                  className="text-[9px] font-bold bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded border border-amber-300 shrink-0 hover:bg-amber-200 transition-colors cursor-pointer"
                                  title="Produto com múltiplos CNPJs na SPCOI007. Clique para ver detalhes."
                                >
                                  Múltiplos CNPJs
                                </button>
                              )}
                              {item.elegivel_ajuste && (
                                <span
                                  className="text-[9px] font-bold bg-red-100 text-red-900 px-1.5 py-0.5 rounded border border-red-300 shrink-0"
                                  title="Candidato a averiguação física (&gt;10d sem venda, &lt;R$250, estoque&gt;0)"
                                >
                                  Verificar Físico
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 4. EMBALAGEM */}
                          <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap font-mono text-[11px]">
                            {item.embalagem || 'UN'}
                          </td>

                          {/* 5. ESTOQUE */}
                          <td className="py-2.5 px-3 text-right font-mono font-black text-slate-800 whitespace-nowrap">
                            {item.estoque_formatado}
                          </td>

                          {/* 6. DIAS SEM VENDA */}
                          <td className="py-2.5 px-2 text-center whitespace-nowrap">
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
                          <td className="py-2.5 px-2 text-center font-mono text-slate-600 whitespace-nowrap text-[11px]">
                            {item.idade}d
                          </td>

                          {/* 8. INDÚSTRIA */}
                          <td className="py-2.5 px-3 text-slate-800 font-medium whitespace-nowrap">
                            {item.industrias_nomes.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => setItemDetalhesVinculos(item)}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 text-amber-900 border border-amber-300 text-[11px] font-bold hover:bg-amber-100 transition-colors shadow-2xs cursor-pointer select-none"
                                title="Clique para ver todas as indústrias e CNPJs vinculados"
                              >
                                <Building2 className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                <span>Múltiplas indústrias ({item.industrias_nomes.length})</span>
                              </button>
                            ) : item.industrias_nomes.length === 1 ? (
                              <div className="flex items-center gap-1">
                                <span
                                  className="text-slate-800 font-medium text-xs truncate max-w-[170px] sm:max-w-[210px] block"
                                  title={item.industrias_nomes[0]}
                                >
                                  {item.industrias_nomes[0]}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setItemDetalhesVinculos(item)}
                                  className="text-slate-400 hover:text-blue-700 opacity-60 hover:opacity-100 transition-opacity p-0.5 shrink-0 cursor-pointer"
                                  title="Ver detalhes da indústria e CNPJ"
                                >
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">
                                Indústria não vinculada
                              </span>
                            )}
                          </td>

                          {/* 9. PROMOTOR */}
                          <td className="py-2.5 px-3 text-slate-800 font-medium whitespace-nowrap">
                            {item.promotores_nomes.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => setItemDetalhesVinculos(item)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 text-[11px] font-bold hover:bg-emerald-100 transition-colors cursor-pointer"
                                title="Clique para ver promotores vinculados por indústria"
                              >
                                <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>Múltiplos promotores ({item.promotores_nomes.length})</span>
                              </button>
                            ) : item.promotores_nomes.length === 1 ? (
                              <span
                                className="text-emerald-900 font-bold text-xs truncate max-w-[140px] block"
                                title={item.promotores_nomes[0]}
                              >
                                {item.promotores_nomes[0]}
                              </span>
                            ) : (
                              <span className="text-amber-700 text-[11px] font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 inline-block">
                                Sem promotor
                              </span>
                            )}
                          </td>

                          {/* 10. AGÊNCIA */}
                          <td className="py-2.5 px-3 text-slate-600 font-medium text-[11px] whitespace-nowrap">
                            {item.agencias_nomes.length > 1 ? (
                              <span
                                className="text-slate-700 font-semibold text-[11px] truncate max-w-[120px] block"
                                title={item.agencias_nomes.join(' • ')}
                              >
                                Múltiplas agências ({item.agencias_nomes.length})
                              </span>
                            ) : item.agencias_nomes.length === 1 ? (
                              <span
                                className="text-slate-700 font-medium text-[11px] truncate max-w-[120px] block"
                                title={item.agencias_nomes[0]}
                              >
                                {item.agencias_nomes[0]}
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          {/* 11. VALOR DO ESTOQUE */}
                          <td className="py-2.5 px-3 text-right font-mono font-black whitespace-nowrap min-w-[140px]">
                            {item.valor_estoque !== null ? (
                              <span className="text-emerald-950 font-black text-xs">
                                {item.valor_estoque_formatado}
                              </span>
                            ) : (
                              <span
                                className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 inline-block"
                                title="Custo médio não informado na planilha SMGOI013 para este item"
                              >
                                VALOR INDISPONÍVEL
                              </span>
                            )}
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

      {/* Modal de Detalhes dos Vínculos Comerciais (Múltiplas Indústrias/CNPJs) */}
      <ModalDetalhesVinculosIsv
        isOpen={itemDetalhesVinculos !== null}
        onClose={() => setItemDetalhesVinculos(null)}
        item={itemDetalhesVinculos}
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

              {/* Opção Obrigatória: Quantidade de Produtos a Imprimir (Top 30 / 50 / 100 / Todos) */}
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3.5 space-y-2">
                <label className="block text-xs font-black uppercase text-blue-950">
                  Quantidade de Produtos a Imprimir / Exportar:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPdfLimiteExportacao(30)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      pdfLimiteExportacao === 30
                        ? 'bg-blue-700 text-white border-blue-800 shadow-xs'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span className="block font-black text-xs">⭐ 30 Maiores (Top 30)</span>
                    <span className="text-[10px] opacity-80 block mt-0.5">Recomendado para rotina</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPdfLimiteExportacao(50)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      pdfLimiteExportacao === 50
                        ? 'bg-blue-700 text-white border-blue-800 shadow-xs'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span className="block font-black text-xs">Top 50 Maiores</span>
                    <span className="text-[10px] opacity-80 block mt-0.5">50 primeiros ordenados</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPdfLimiteExportacao(100)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      pdfLimiteExportacao === 100
                        ? 'bg-blue-700 text-white border-blue-800 shadow-xs'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span className="block font-black text-xs">Top 100 Maiores</span>
                    <span className="text-[10px] opacity-80 block mt-0.5">100 primeiros ordenados</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPdfLimiteExportacao('TODOS')}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      pdfLimiteExportacao === 'TODOS'
                        ? 'bg-blue-700 text-white border-blue-800 shadow-xs'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span className="block font-black text-xs">Todos da Seleção</span>
                    <span className="text-[10px] opacity-80 block mt-0.5">
                      {itensFiltrados.length} {itensFiltrados.length === 1 ? 'produto' : 'produtos'}
                    </span>
                  </button>
                </div>
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
                  <span>
                    Baixar PDF A3 ({pdfLimiteExportacao === 'TODOS' ? itensFiltrados.length : Math.min(Number(pdfLimiteExportacao), itensFiltrados.length)} Itens)
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 7. Modal de Auditoria do Catálogo & Custo Médio */}
      {isModalAuditoriaOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Cabeçalho */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Search className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">
                    Auditoria de Classificação Financeira & Custo Médio
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    Inspeção em tempo de execução dos 5 códigos oficiais de referência e do catálogo SMGOI013
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalAuditoriaOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo com rolagem */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1 font-sans text-xs">
              {/* Campo para busca de qualquer outro código */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                    Auditar Código Adicional:
                  </label>
                  <input
                    type="text"
                    value={codAuditoriaCustom}
                    onChange={(e) => setCodAuditoriaCustom(e.target.value)}
                    placeholder="Digite o código (ex: 68059 ou 68059-164)..."
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-slate-900 focus:outline-hidden focus:border-blue-600"
                  />
                </div>
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <label className="cursor-pointer px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-lg uppercase tracking-wider flex items-center gap-1 shadow-2xs">
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Upload SMGOI013</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={handleImportarSmgoi013Direto}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleRestaurarBaseReferencia}
                    className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white font-black text-xs rounded-lg uppercase tracking-wider flex items-center gap-1 shadow-2xs"
                    title="Carregar base de teste com os 5 produtos de referência"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Carregar Demo</span>
                  </button>
                </div>
              </div>

              {/* Tabela de Auditoria dos Códigos */}
              <div className="space-y-3">
                <div className="text-xs font-black uppercase text-slate-800 flex items-center justify-between">
                  <span>Códigos Auditados Obrigatoriamente:</span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Total no catálogo: {produtos.length} produtos
                  </span>
                </div>

                {(() => {
                  const codigosReferencia = [
                    { cod: '16337', dig: '160', ref: 'R$ 890,09', label: '16337-160 (M&M TUBE - REGRESSÃO)' },
                    { cod: '68059', dig: '164', ref: 'R$ 26.287,99', label: '68059-164 (HF.ALHO)' },
                    { cod: '60662', dig: '158', ref: 'R$ 16.471,28', label: '60662-158 (CHOC.CHARGE)' },
                    { cod: '84282', dig: '160', ref: 'R$ 8.436,20', label: '84282-160 (DET.VIDA LIMAO)' },
                    { cod: '7922', dig: '130', ref: 'R$ 8.521,55', label: '7922-130 (REF.SUKITA)' },
                    { cod: '43708', dig: '134', ref: 'R$ 469,28', label: '43708-134 (SACOLA EXTRUSA)' },
                    { cod: '4863', dig: '117', ref: 'R$ 441,62', label: '4863-117 (ORGAN.UZ)' },
                    { cod: '61332', dig: '168', ref: 'R$ 372,42', label: '61332-168 (POTE SANREMO)' },
                    { cod: '85327', dig: '177', ref: 'R$ 16.168,49', label: '85327-177' },
                    { cod: '8911', dig: '191', ref: 'R$ 9.575,49', label: '8911-191' },
                    { cod: '56176', dig: '127', ref: 'R$ 8.977,79', label: '56176-127' },
                  ];

                  const customCodLimpo = codAuditoriaCustom.trim().replace('-', '').split(/[^\d]/)[0];
                  const listaAudit = [...codigosReferencia];
                  if (customCodLimpo && !codigosReferencia.some((c) => c.cod === customCodLimpo)) {
                    listaAudit.push({
                      cod: customCodLimpo,
                      dig: '',
                      ref: 'Consulta direta',
                      label: codAuditoriaCustom.trim(),
                    });
                  }

                  // Obter ranking global ordenado por maior valor
                  const rankingGlobal = isvService
                    .filtrarItensIsv(itensIsvBrutos, {
                      ...filtros,
                      filtroEstoque: 'COM_ESTOQUE',
                      filtroValor: 'TODOS',
                      situacaoVinculo: 'TODOS',
                      ordenacao: 'MAIOR_VALOR',
                    });

                  return listaAudit.map((refItem) => {
                    const prod = produtos.find(
                      (p) =>
                        p.codigo_interno === refItem.cod ||
                        p.codigo_exibicao === refItem.label ||
                        (p.codigo_interno === refItem.cod && (!refItem.dig || p.digito === refItem.dig))
                    );

                    const itemIsv = itensIsvBrutos.find(
                      (i) => i.codigo_interno === refItem.cod || i.codigo_exibicao === refItem.label
                    );

                    const posRanking = itemIsv
                      ? rankingGlobal.findIndex((r) => r.codigo_interno === itemIsv.codigo_interno) + 1
                      : 0;

                    const atendeFiltros = itemIsv
                      ? itensFiltrados.some((f) => f.codigo_interno === itemIsv.codigo_interno)
                      : false;

                    const custoMedioNum = prod?.custo_medio ?? null;
                    const valorEstoqueNum = itemIsv?.valor_estoque ?? null;

                    return (
                      <div
                        key={refItem.label}
                        className="p-3 rounded-xl border border-slate-200 bg-white hover:border-blue-300 transition-colors shadow-2xs space-y-2"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-slate-100 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-xs">
                              {refItem.label}
                            </span>
                            <span className="font-bold text-slate-800 uppercase">
                              {prod?.descricao || <span className="text-red-500 italic">Produto não localizado na base atual</span>}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            Referência anterior: <strong>{refItem.ref}</strong>
                          </div>
                        </div>

                        {prod ? (
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
                            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                              <span className="text-slate-400 block text-[9px] uppercase font-bold">Existe na Base</span>
                              <span className="text-emerald-700 font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600 inline" /> Sim
                              </span>
                            </div>

                            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                              <span className="text-slate-400 block text-[9px] uppercase font-bold">Estoque Convertido</span>
                              <span className="font-mono font-bold text-slate-800">
                                {itemIsv?.estoque_formatado || `${prod.estoque_total} UN`}
                              </span>
                            </div>

                            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                              <span className="text-slate-400 block text-[9px] uppercase font-bold">Custo Médio</span>
                              {custoMedioNum !== null && custoMedioNum > 0 ? (
                                <span className="font-mono font-bold text-slate-900">
                                  {formatarMoedaBR(custoMedioNum)}
                                </span>
                              ) : (
                                <span className="font-bold text-amber-700 text-[10px] bg-amber-50 px-1 py-0.2 rounded">
                                  VALOR INDISPONÍVEL
                                </span>
                              )}
                            </div>

                            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                              <span className="text-slate-400 block text-[9px] uppercase font-bold">Valor Estoque</span>
                              {valorEstoqueNum !== null ? (
                                <span className="font-mono font-black text-emerald-700">
                                  {formatarMoedaBR(valorEstoqueNum)}
                                </span>
                              ) : (
                                <span className="font-bold text-slate-400 text-[10px]">
                                  VALOR INDISPONÍVEL
                                </span>
                              )}
                            </div>

                            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                              <span className="text-slate-400 block text-[9px] uppercase font-bold">Dias Sem Venda</span>
                              <span className="font-mono font-bold text-slate-800">
                                {prod.dias_sem_venda || 0} dias
                              </span>
                            </div>

                            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                              <span className="text-slate-400 block text-[9px] uppercase font-bold">Posição Ranking</span>
                              <span className="font-mono font-black text-blue-700">
                                {posRanking > 0 ? `#${posRanking}` : '-'}
                              </span>
                              <span className="text-[9px] text-slate-400 ml-1">
                                {atendeFiltros ? '(filtrado)' : '(fora do filtro)'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[11px] flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>
                              Este produto não consta no arquivo <strong>SMGOI013</strong> importado atualmente no navegador. O sistema não fabrica dados fictícios para produtos ausentes.
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Rodapé */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Auditoria de integridade realizada em tempo real contra IndexedDB e memória.
              </span>
              <button
                type="button"
                onClick={() => setIsModalAuditoriaOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs"
              >
                Fechar Auditoria
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
