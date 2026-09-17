import React, { useState, useId, useMemo, useEffect, useRef } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Barcode,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Store,
  Tag,
  Trash2,
  TrendingDown,
  UploadCloud,
  User,
  X,
  XCircle
} from 'lucide-react';
import { LoteVencimento, ProdutoSMG, RegistroSaeou060, ResumoImportacao, StatusSaeou060 } from '../types';
import { productRepository } from '../services/productRepository';
import { parseEmbalagem } from '../services/codeParser';
import { gerarPdfPreventivo } from '../services/pdfReport';
import {
  gerarExemploPlanilhaSAEOU060,
  processarSAEOU060,
  ProgressCallback
} from '../services/saeou060Parser';
import { TrabalharValidadeModal } from './TrabalharValidadeModal';
import { HighlightText } from './HighlightText';


interface Saeou060ViewProps {
  onSelectProduto?: (produto: ProdutoSMG) => void;
  onNavigateToControle?: () => void;
  onNavigateToVencimentos?: () => void;
  onOpenImportModal?: () => void;
}

const PAGE_SIZE = 10;

export const Saeou060View: React.FC<Saeou060ViewProps> = ({
  onSelectProduto,
  onNavigateToControle,
  onNavigateToVencimentos,
  onOpenImportModal,
}) => {
  const fileInputId = useId();
  const [registros, setRegistros] = useState<RegistroSaeou060[]>(() =>
    productRepository.getSaeou060Registros()
  );
  const [metadados, setMetadados] = useState(() => productRepository.getMetadados());
  const [produtos, setProdutos] = useState<ProdutoSMG[]>(() => productRepository.getAllProducts());

  // Search & Filter State
  const [inputSearch, setInputSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterType, setFilterType] = useState<
    'TODOS' | 'NOVOS' | 'JA_NO_CONTROLE' | 'PRECISA_DE_ACAO' | 'ULTIMOS_7_DIAS' | 'DESCONSIDERADOS' | 'NAO_LOCALIZADOS' | 'AGUARDANDO_BASE'
  >('TODOS');
  const [promotorFilter, setPromotorFilter] = useState<string>('TODOS');

  // Sector classification filter (Setor Físico vs Setor Balanço)
  const [tipoSetor, setTipoSetor] = useState<'FISICO' | 'BALANCO'>('FISICO');
  const [setorSelecionado, setSetorSelecionado] = useState<string>('TODOS');

  // Operational vs Historical date view
  const [verHistoricoAnterior, setVerHistoricoAnterior] = useState<boolean>(false);

  const [page, setPage] = useState(1);
  const listTopRef = useRef<HTMLDivElement>(null);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(inputSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [inputSearch]);

  // Reset to page 1 on search or filter change
  useEffect(() => {
    setPage(1);
  }, [filterType, promotorFilter, debouncedSearch, tipoSetor, setorSelecionado, verHistoricoAnterior]);

  // Working Modal State
  const [activeTrabalharRegistro, setActiveTrabalharRegistro] = useState<RegistroSaeou060 | null>(null);

  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatusMsg, setImportStatusMsg] = useState('');
  const [importSummaryModal, setImportSummaryModal] = useState<ResumoImportacao | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<{ msg: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Subscribe to repository updates
  React.useEffect(() => {
    const unsub = productRepository.subscribe(() => {
      setRegistros(productRepository.getSaeou060Registros());
      setMetadados(productRepository.getMetadados());
      setProdutos(productRepository.getAllProducts());
    });
    return unsub;
  }, []);

  const showToast = (msg: string, type: 'success' | 'info' | 'error' = 'success') => {
    setFeedbackToast({ msg, type });
    setTimeout(() => {
      setFeedbackToast(null);
    }, 4000);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    setIsImporting(true);
    setImportProgress(0);
    setImportStatusMsg('Iniciando processamento...');

    try {
      const progressCb: ProgressCallback = (percent, status) => {
        setImportProgress(percent);
        setImportStatusMsg(status);
      };

      const resultado = await processarSAEOU060(file, progressCb);
      await productRepository.addSaeou060Registros(resultado.registros);
      await productRepository.addHistorico(resultado.resumo);

      setImportSummaryModal(resultado.resumo);
      showToast(`Importação do SAEOU060 concluída: ${resultado.registros.length} registros processados.`);
    } catch (err: any) {
      console.error('Erro ao processar SAEOU060:', err);
      showToast(`Erro na importação: ${err.message || 'Falha ao ler arquivo.'}`, 'error');
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleAdicionarAoControle = async (registroId: string, customData?: Partial<LoteVencimento>) => {
    try {
      const lote = await productRepository.adicionarSaeou060AoControle(registroId, customData);
      if (lote) {
        showToast(`Item ${lote.codigo_exibicao} adicionado ao Controle de Vencimentos!`);
      }
    } catch (err: any) {
      showToast(`Erro ao adicionar ao controle: ${err.message}`, 'error');
    }
  };

  const handleDesconsiderarValidade = async (registroId: string, motivo: string) => {
    try {
      await productRepository.desconsiderarSaeou060(registroId, motivo);
      showToast('Registro marcado como desconsiderado.', 'info');
    } catch (err: any) {
      showToast(`Erro ao desconsiderar: ${err.message}`, 'error');
    }
  };

  const handleRestaurarValidade = async (registroId: string) => {
    try {
      await productRepository.restaurarSaeou060(registroId);
      showToast('Registro restaurado para a fila de trabalho.', 'success');
    } catch (err: any) {
      showToast(`Erro ao restaurar: ${err.message}`, 'error');
    }
  };

  const handleSalvarTrabalho = async (
    registroId: string,
    dados: {
      data_vencimento?: string;
      data_vencimento_exibicao?: string;
      quantidade?: number;
      preco_normal?: number;
      precoNormal?: number;
      preco_trabalhado?: number;
      precoTrabalhado?: number;
      data_preco?: string;
      observacao?: string;
    }
  ) => {
    try {
      await productRepository.atualizarSaeou060Trabalho(registroId, dados);
      showToast('Dados do trabalho salvos com sucesso.');
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
    }
  };

  const handleAdicionarTodosAoControle = async () => {
    const count = await productRepository.adicionarTodosSaeou060AoControle();
    if (count > 0) {
      showToast(`${count} registros do SAEOU060 foram adicionados ao Controle de Vencimentos!`);
    } else {
      showToast('Nenhum registro pendente para adicionar ao controle.', 'info');
    }
  };

  const handleLimparSaeou060 = async () => {
    if (window.confirm('Tem certeza que deseja limpar todos os registros importados do SAEOU060? Os vencimentos já salvos no controle NÃO serão apagados.')) {
      await productRepository.clearSaeou060();
      showToast('Registros do SAEOU060 limpos com sucesso.', 'info');
    }
  };

  // Promotores únicos para filtro
  const promotoresUnicos = useMemo(() => {
    return Array.from(
      new Set(registros.map((r) => r.promotor).filter(Boolean) as string[])
    ).sort();
  }, [registros]);

  // Funções utilitárias de normalização e extração de data de movimento
  const extrairIsoDate = (val: any): string | null => {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const str = String(val).trim();
    if (!str) return null;

    // YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
    if (isoMatch) {
      const y = isoMatch[1];
      const m = String(parseInt(isoMatch[2], 10)).padStart(2, '0');
      const d = String(parseInt(isoMatch[3], 10)).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    // DD/MM/YYYY or DD-MM-YYYY
    const brMatch = str.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})/);
    if (brMatch) {
      const d = String(parseInt(brMatch[1], 10)).padStart(2, '0');
      const m = String(parseInt(brMatch[2], 10)).padStart(2, '0');
      let y = parseInt(brMatch[3], 10);
      if (y < 100) y += 2000;
      return `${y}-${m}-${d}`;
    }

    return null;
  };

  const formatarIsoParaDisplay = (iso: string): string => {
    if (!iso) return '';
    const parts = iso.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return iso;
  };

  const getRegistroDataMovimento = (reg: RegistroSaeou060): { iso: string; display: string } | null => {
    if (reg.data_movimento) {
      const iso = extrairIsoDate(reg.data_movimento);
      if (iso) return { iso, display: formatarIsoParaDisplay(iso) };
    }
    if (reg.data_cadastro) {
      const iso = extrairIsoDate(reg.data_cadastro);
      if (iso) return { iso, display: formatarIsoParaDisplay(iso) };
    }
    if (reg.data_importacao) {
      const iso = extrairIsoDate(reg.data_importacao);
      if (iso) return { iso, display: formatarIsoParaDisplay(iso) };
    }
    return null;
  };

  // 1. Data Local Atual do Aparelho/Sistema
  const hoje = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const hojeIso = useMemo(() => {
    const y = hoje.getFullYear();
    const m = String(hoje.getMonth() + 1).padStart(2, '0');
    const d = String(hoje.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [hoje]);

  const hojeDisplay = useMemo(() => {
    const parts = hojeIso.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }, [hojeIso]);

  // 2. Análise da maior data de movimentação existente na base SAEOU060
  const { ultimaMovimentacaoIso, ultimaMovimentacaoDisplay, totalRegistrosGerais } = useMemo(() => {
    let maxIso = '';
    let count = 0;

    for (let i = 0; i < registros.length; i++) {
      count++;
      const dt = getRegistroDataMovimento(registros[i]);
      if (dt && dt.iso > maxIso) {
        maxIso = dt.iso;
      }
    }

    return {
      ultimaMovimentacaoIso: maxIso,
      ultimaMovimentacaoDisplay: maxIso ? formatarIsoParaDisplay(maxIso) : 'Não identificada',
      totalRegistrosGerais: count,
    };
  }, [registros]);

  // 3. Regra de desatualização: se houver registros importados e a maior data for anterior à data local atual
  const isSaeouDesatualizada = useMemo(() => {
    if (totalRegistrosGerais === 0) return false;
    return Boolean(ultimaMovimentacaoIso && ultimaMovimentacaoIso < hojeIso);
  }, [totalRegistrosGerais, ultimaMovimentacaoIso, hojeIso]);

  // 4. Filtragem Operacional de Data (Regra Crítica: produtos do dia anterior não aparecem no dia seguinte)
  const registrosOperacionais = useMemo(() => {
    if (verHistoricoAnterior) {
      return registros;
    }
    return registros.filter((r) => {
      const dt = getRegistroDataMovimento(r);
      return dt && dt.iso === hojeIso;
    });
  }, [registros, verHistoricoAnterior, hojeIso]);

  // 5. Listas de Setores Físicos e Setores de Balanço (extraídos de forma indexada da SMGOI013)
  const listaSetoresFisicos = useMemo(() => {
    const fromRepo = productRepository.getSetoresFisicos();
    if (fromRepo && fromRepo.length > 0) return fromRepo;
    const set = new Set<string>();
    produtos.forEach((p) => {
      if (p.setor_fisico?.trim()) set.add(p.setor_fisico.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [produtos]);

  const listaSetoresBalanco = useMemo(() => {
    const fromRepo = productRepository.getSetoresBalanco();
    if (fromRepo && fromRepo.length > 0) return fromRepo;
    const set = new Set<string>();
    produtos.forEach((p) => {
      if (p.setor_balanco?.trim()) set.add(p.setor_balanco.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [produtos]);

  const opcoesSetoresAtuais = tipoSetor === 'FISICO' ? listaSetoresFisicos : listaSetoresBalanco;

  const handleSimularHoje = async () => {
    try {
      const count = await productRepository.carregarSaeou060Hoje();
      showToast(`${count} registros atualizados com a data de hoje (${hojeDisplay})!`);
      setVerHistoricoAnterior(false);
    } catch (err: any) {
      showToast(`Erro ao simular data: ${err.message}`, 'error');
    }
  };

  // Map de produtos para cruzamento rápido
  const produtosMap = useMemo(() => {
    const map = new Map<string, ProdutoSMG>();
    produtos.forEach((p) => {
      map.set(p.codigo_interno, p);
      if (p.codigo_original) map.set(p.codigo_original, p);
      if (p.codigo_exibicao) map.set(p.codigo_exibicao, p);
    });
    return map;
  }, [produtos]);

  // Lista com dados cruzados, setores indexados e dias calculados
  const registrosProcessados = useMemo(() => {
    return registrosOperacionais.map((reg) => {
      // 1. Obtenção do produto SMGOI013 por CÓDIGO INTERNO + DIG
      const prod = produtosMap.get(reg.codigo_interno) || productRepository.getProductByCode(reg.codigo_interno);

      // 2. Obtenção indexada de alta performance O(1) do Setor Físico e Setor Balanço
      const sectorInfo =
        (reg.chave_normalizada ? productRepository.getSectorInfoByCode(reg.chave_normalizada) : undefined) ||
        (reg.codigo_exibicao ? productRepository.getSectorInfoByCode(reg.codigo_exibicao) : undefined) ||
        (reg.codigo_interno ? productRepository.getSectorInfoByCode(reg.codigo_interno) : undefined);

      const setorFisico = (prod?.setor_fisico?.trim()) || sectorInfo?.setorFisico || '';
      const setorBalanco = (prod?.setor_balanco?.trim()) || sectorInfo?.setorBalanco || '';

      let diasRestantes: number | null = null;
      if (reg.data_vencimento) {
        const vcto = new Date(reg.data_vencimento + 'T00:00:00');
        diasRestantes = Math.floor((vcto.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
      }
      return {
        reg,
        prod,
        diasRestantes,
        setorFisico,
        setorBalanco,
      };
    });
  }, [registrosOperacionais, produtosMap, hoje]);

  // Indicadores do topo (dinâmicos baseados no escopo operacional)
  const stats = useMemo(() => {
    let novos = 0;
    let noControle = 0;
    let precisaAcao = 0;
    let ultimos7Dias = 0;
    let desconsiderados = 0;
    let naoLocalizados = 0;
    let aguardandoBase = 0;

    registrosProcessados.forEach(({ reg, diasRestantes }) => {
      if (reg.status_saeou === 'DESCONSIDERADO') {
        desconsiderados++;
        return;
      }
      if (reg.status_saeou === 'JA_NO_CONTROLE') {
        noControle++;
      } else if (reg.status_saeou === 'NAO_LOCALIZADO') {
        naoLocalizados++;
      } else if (reg.status_saeou === 'AGUARDANDO_BASE') {
        aguardandoBase++;
      } else {
        novos++;
      }

      if (reg.status_saeou === 'PRECISA_DE_ACAO' || (diasRestantes !== null && diasRestantes <= 7 && reg.status_saeou !== 'JA_NO_CONTROLE')) {
        precisaAcao++;
      }

      if (diasRestantes !== null && diasRestantes <= 7) {
        ultimos7Dias++;
      }
    });

    return {
      total: registrosProcessados.length,
      novos,
      noControle,
      precisaAcao,
      ultimos7Dias,
      desconsiderados,
      naoLocalizados,
      aguardandoBase,
    };
  }, [registrosProcessados]);

  // Filtragem da Lista considerando: Data Operacional, Setor Físico/Balanço, Status, Busca e Promotor
  const registrosFiltrados = useMemo(() => {
    return registrosProcessados.filter((item) => {
      const { reg, prod, diasRestantes, setorFisico, setorBalanco } = item;

      // 1. Filtro de Promotor
      if (promotorFilter !== 'TODOS' && reg.promotor !== promotorFilter) {
        return false;
      }

      // 2. Filtro de Setor (FÍSICO ou BALANÇO)
      if (setorSelecionado !== 'TODOS') {
        if (tipoSetor === 'FISICO') {
          if (setorFisico !== setorSelecionado) {
            return false;
          }
        } else {
          if (setorBalanco !== setorSelecionado) {
            return false;
          }
        }
      }

      // 3. Filtro de Status
      switch (filterType) {
        case 'NOVOS':
          if (reg.status_saeou !== 'NOVO') return false;
          break;
        case 'JA_NO_CONTROLE':
          if (reg.status_saeou !== 'JA_NO_CONTROLE') return false;
          break;
        case 'PRECISA_DE_ACAO':
          if (reg.status_saeou !== 'PRECISA_DE_ACAO' && !(diasRestantes !== null && diasRestantes <= 7 && reg.status_saeou !== 'DESCONSIDERADO')) {
            return false;
          }
          break;
        case 'ULTIMOS_7_DIAS':
          if (diasRestantes === null || diasRestantes > 7 || reg.status_saeou === 'DESCONSIDERADO') return false;
          break;
        case 'DESCONSIDERADOS':
          if (reg.status_saeou !== 'DESCONSIDERADO') return false;
          break;
        case 'NAO_LOCALIZADOS':
          if (reg.status_saeou !== 'NAO_LOCALIZADO') return false;
          break;
        case 'AGUARDANDO_BASE':
          if (reg.status_saeou !== 'AGUARDANDO_BASE') return false;
          break;
        case 'TODOS':
        default:
          break;
      }

      // 4. Busca por texto (Código interno, dígito, exibição, EAN vinculado, descrição, promotor)
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.trim().toLowerCase();
        const matchCod = reg.codigo_interno?.toLowerCase().includes(q);
        const matchDig = reg.digito?.toLowerCase().includes(q);
        const matchExib = reg.codigo_exibicao?.toLowerCase().includes(q);
        const matchDesc = (prod?.descricao || reg.descricao || '').toLowerCase().includes(q);
        const matchProm = reg.promotor?.toLowerCase().includes(q);
        const matchOrig = reg.codigo_original?.toLowerCase().includes(q);
        const matchEan = prod?.eans?.some((e) => e.toLowerCase().includes(q)) || false;

        if (!matchCod && !matchDig && !matchExib && !matchDesc && !matchProm && !matchOrig && !matchEan) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      // Ordenação prioritária:
      // 1. Precisa de Ação / Últimos 7 dias primeiro
      // 2. Dias restantes ascendente
      if (a.diasRestantes !== null && b.diasRestantes !== null) {
        return a.diasRestantes - b.diasRestantes;
      }
      return 0;
    });
  }, [registrosProcessados, filterType, promotorFilter, debouncedSearch, tipoSetor, setorSelecionado]);

  // Strict pagination slicing (10 per page)
  const totalRegistros = registrosFiltrados.length;
  const totalPages = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE));
  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalRegistros);
  const visibleRegistros = useMemo(() => {
    return registrosFiltrados.slice(startIndex, startIndex + PAGE_SIZE);
  }, [registrosFiltrados, startIndex]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    if (listTopRef.current) {
      listTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const getStatusBadge = (reg: RegistroSaeou060, diasRestantes: number | null) => {
    if (reg.status_saeou === 'JA_NO_CONTROLE') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.8 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5" />
          JÁ NO CONTROLE
        </span>
      );
    }
    if (reg.status_saeou === 'DESCONSIDERADO') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.8 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
          <XCircle className="w-3.5 h-3.5 text-slate-400" />
          DESCONSIDERADO
        </span>
      );
    }
    if (diasRestantes !== null && diasRestantes <= 7) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.8 rounded-md text-[11px] font-black bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          ÚLTIMOS 7 DIAS
        </span>
      );
    }
    if (reg.status_saeou === 'PRECISA_DE_ACAO') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.8 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          PRECISA DE AÇÃO
        </span>
      );
    }
    if (reg.status_saeou === 'NAO_LOCALIZADO') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.8 rounded-md text-[11px] font-bold bg-red-100 text-red-800 border border-red-200">
          <AlertCircle className="w-3.5 h-3.5" />
          NÃO LOCALIZADO
        </span>
      );
    }
    if (reg.status_saeou === 'AGUARDANDO_BASE') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.8 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
          <Clock className="w-3.5 h-3.5" />
          AGUARDANDO BASE
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.8 rounded-md text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
        <Plus className="w-3.5 h-3.5" />
        NOVO
      </span>
    );
  };

  return (
    <div id="view-saeou060-operacional" className="space-y-4 pb-24 max-w-4xl mx-auto">
      {/* Toast Feedback */}
      {feedbackToast && (
        <div
          className={`fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-50 p-4 rounded-xl shadow-lg border text-sm font-medium flex items-center justify-between transition-all ${
            feedbackToast.type === 'error'
              ? 'bg-red-50 text-red-800 border-red-200'
              : feedbackToast.type === 'info'
              ? 'bg-blue-50 text-blue-800 border-blue-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackToast.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            ) : feedbackToast.type === 'info' ? (
              <AlertTriangle className="w-5 h-5 text-blue-600 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            )}
            <span>{feedbackToast.msg}</span>
          </div>
          <button
            onClick={() => setFeedbackToast(null)}
            className="p-1 hover:bg-black/5 rounded-lg text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 10. AVISO DE SAEOU060 DESATUALIZADA */}
      {isSaeouDesatualizada && !verHistoricoAnterior && (
        <div id="aviso-saeou060-desatualizada" className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3 animate-fadeIn">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-amber-500 text-white rounded-xl shrink-0 shadow-2xs">
              <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-black uppercase tracking-wider text-amber-950 flex items-center gap-1.5">
                  ⚠ SAEOU060 DESATUALIZADA
                </h3>
                <span className="bg-amber-200/80 text-amber-900 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                  Data atual: {hojeDisplay}
                </span>
              </div>
              <p className="text-xs font-bold text-amber-900 mt-1">
                Última movimentação disponível: <span className="underline font-black">{ultimaMovimentacaoDisplay}</span>
              </p>
              <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                Importe a SAEOU060 de hoje para visualizar os produtos atuais. Mercadorias de dias anteriores não aparecem na rotina operacional do dia.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-amber-200/80">
            <label
              htmlFor={fileInputId}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors cursor-pointer shadow-2xs"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Importar SAEOU060 de Hoje</span>
            </label>

            <button
              type="button"
              onClick={handleSimularHoje}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-200 hover:bg-amber-300 text-amber-950 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              title="Atualiza os registros com a data de hoje para testar os filtros de setor"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Simular SAEOU060 de Hoje ({hojeDisplay})</span>
            </button>

            <button
              type="button"
              onClick={() => setVerHistoricoAnterior(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-amber-100/60 text-amber-900 text-xs font-semibold rounded-xl border border-amber-300 transition-colors cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-amber-700" />
              <span>Consultar Histórico Anterior ({totalRegistrosGerais})</span>
            </button>
          </div>
        </div>
      )}

      {/* Banner Informativo quando modo Histórico estiver ativado */}
      {verHistoricoAnterior && (
        <div className="bg-slate-100 border border-slate-300 rounded-2xl p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-600 shrink-0" />
            <span className="text-xs font-semibold text-slate-800">
              Modo de Consulta Histórica ativo ({totalRegistrosGerais} registros no total).
            </span>
          </div>
          <button
            type="button"
            onClick={() => setVerHistoricoAnterior(false)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            Retornar ao Modo Operacional do Dia ({hojeDisplay})
          </button>
        </div>
      )}

      {/* Subtítulo Operacional da Aba SAEOU060 */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">
                Área Operacional SAEOU060
              </h2>
              <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                Próximos 15 dias
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Validades apontadas pelos promotores cruzadas com o estoque e giro da SMGOI013.
            </p>
          </div>
        </div>

        {/* Ações Rápidas no topo */}
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <button
            onClick={() => gerarPdfPreventivo({ sourceType: 'SAEOU060', setor: 'SETOR FRIOS' })}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-50 hover:bg-orange-100 text-orange-800 text-xs font-bold rounded-xl border border-orange-200 transition-colors shadow-2xs"
            title="Gerar PDF Preventivo com layout oficial"
          >
            <Printer className="w-4 h-4 stroke-[2.5]" />
            <span>PDF Preventivo</span>
          </button>

          <label
            htmlFor={fileInputId}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl border border-blue-200 transition-colors cursor-pointer"
            title="Importar nova planilha SAEOU060"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Importar Planilha</span>
            <input
              id={fileInputId}
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isImporting}
            />
          </label>

          {stats.novos + stats.precisaAcao > 0 && (
            <button
              onClick={handleAdicionarTodosAoControle}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
              title="Adicionar todos os pendentes de uma vez ao controle"
            >
              <Plus className="w-4 h-4" />
              <span>Adicionar Todos ({stats.novos + stats.precisaAcao})</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 CARDS INDICADORES DO TOPO (NOVOS, JÁ NO CONTROLE, PRECISA DE AÇÃO, ÚLTIMOS 7 DIAS) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
        {/* 1. NOVOS */}
        <button
          onClick={() => setFilterType(filterType === 'NOVOS' ? 'TODOS' : 'NOVOS')}
          className={`p-3.5 rounded-2xl border text-left transition-all ${
            filterType === 'NOVOS'
              ? 'bg-blue-50/80 border-blue-500 ring-2 ring-blue-500/20 shadow-sm'
              : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Novos
            </span>
            <div className="w-2 h-2 rounded-full bg-blue-500" />
          </div>
          <p className="text-2xl font-black text-blue-700 mt-1">{stats.novos}</p>
          <span className="text-[10px] text-slate-400 font-medium block mt-0.5">
            Aguardando trabalho
          </span>
        </button>

        {/* 2. JÁ NO CONTROLE */}
        <button
          onClick={() => setFilterType(filterType === 'JA_NO_CONTROLE' ? 'TODOS' : 'JA_NO_CONTROLE')}
          className={`p-3.5 rounded-2xl border text-left transition-all ${
            filterType === 'JA_NO_CONTROLE'
              ? 'bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20 shadow-sm'
              : 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-slate-50/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              No Controle
            </span>
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <p className="text-2xl font-black text-emerald-700 mt-1">{stats.noControle}</p>
          <span className="text-[10px] text-slate-400 font-medium block mt-0.5">
            Integrados ao monitoramento
          </span>
        </button>

        {/* 3. PRECISA DE AÇÃO */}
        <button
          onClick={() => setFilterType(filterType === 'PRECISA_DE_ACAO' ? 'TODOS' : 'PRECISA_DE_ACAO')}
          className={`p-3.5 rounded-2xl border text-left transition-all ${
            filterType === 'PRECISA_DE_ACAO'
              ? 'bg-amber-50/80 border-amber-500 ring-2 ring-amber-500/20 shadow-sm'
              : 'bg-white border-slate-200 hover:border-amber-300 hover:bg-slate-50/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">
              Precisa Ação
            </span>
            <div className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
          <p className="text-2xl font-black text-amber-800 mt-1">{stats.precisaAcao}</p>
          <span className="text-[10px] text-amber-600 font-medium block mt-0.5">
            Análise prioritária
          </span>
        </button>

        {/* 4. ÚLTIMOS 7 DIAS */}
        <button
          onClick={() => setFilterType(filterType === 'ULTIMOS_7_DIAS' ? 'TODOS' : 'ULTIMOS_7_DIAS')}
          className={`p-3.5 rounded-2xl border text-left transition-all ${
            filterType === 'ULTIMOS_7_DIAS'
              ? 'bg-rose-50/80 border-rose-500 ring-2 ring-rose-500/20 shadow-sm'
              : 'bg-white border-slate-200 hover:border-rose-300 hover:bg-slate-50/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">
              Últimos 7 Dias
            </span>
            <div className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
          </div>
          <p className="text-2xl font-black text-rose-700 mt-1">{stats.ultimos7Dias}</p>
          <span className="text-[10px] text-rose-600 font-medium block mt-0.5">
            Vencimento iminente
          </span>
        </button>
      </div>

      {/* 2. NOVO FILTRO POR CLASSE / SETOR DA MERCADORIA (SELETOR ALTERNÁVEL + DROPDOWN) */}
      <div id="card-filtro-mercadorias" className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-600" />
            Filtrar Mercadorias
          </h3>
          {setorSelecionado !== 'TODOS' && (
            <button
              type="button"
              onClick={() => setSetorSelecionado('TODOS')}
              className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
            >
              Limpar Setor
            </button>
          )}
        </div>

        {/* Seletor Segmentado: [ SETOR FÍSICO ] [ SETOR BALANÇO ] */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            id="btn-filtro-setor-fisico"
            onClick={() => {
              if (tipoSetor !== 'FISICO') {
                setTipoSetor('FISICO');
                setSetorSelecionado('TODOS');
              }
            }}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none text-center cursor-pointer ${
              tipoSetor === 'FISICO'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            SETOR FÍSICO
          </button>
          <button
            type="button"
            id="btn-filtro-setor-balanco"
            onClick={() => {
              if (tipoSetor !== 'BALANCO') {
                setTipoSetor('BALANCO');
                setSetorSelecionado('TODOS');
              }
            }}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none text-center cursor-pointer ${
              tipoSetor === 'BALANCO'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            SETOR BALANÇO
          </button>
        </div>

        {/* Campo de Seleção do Setor */}
        <div className="space-y-1.5">
          <label htmlFor="select-setor-mercadoria" className="block text-[11px] font-black uppercase tracking-wider text-slate-700">
            SETOR
          </label>
          <div className="relative">
            <select
              id="select-setor-mercadoria"
              value={setorSelecionado}
              onChange={(e) => setSetorSelecionado(e.target.value)}
              className="w-full bg-slate-50 border-2 border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 focus:outline-none transition-all cursor-pointer shadow-2xs appearance-none pr-9"
            >
              <option value="TODOS">TODOS OS SETORES</option>
              {opcoesSetoresAtuais.map((setor) => (
                <option key={setor} value={setor}>
                  {setor}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
              <ChevronDown className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>
        </div>

        {/* 14. Contador de Produtos Encontrados */}
        <div className="pt-1 flex items-center justify-between text-xs font-bold text-slate-600 border-t border-slate-100">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-600"></span>
            <strong className="text-slate-900 font-black">{totalRegistros}</strong>{' '}
            {totalRegistros === 1 ? 'produto encontrado' : 'produtos encontrados'}
          </span>
          {setorSelecionado !== 'TODOS' && (
            <span className="text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200 font-semibold truncate max-w-[220px]">
              {setorSelecionado}
            </span>
          )}
        </div>
      </div>

      {/* BARRA DE BUSCA E FILTROS */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
        {/* Barra de Busca */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
          <input
            type="text"
            placeholder="Buscar por código, EAN ou descrição..."
            value={inputSearch}
            onChange={(e) => setInputSearch(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl pl-10 pr-9 py-2.5 text-xs font-semibold text-slate-900 focus:outline-none transition-all"
          />
          {inputSearch && (
            <button
              onClick={() => {
                setInputSearch('');
                setDebouncedSearch('');
              }}
              className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Chips de Filtro Horizontal */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
          {[
            { id: 'TODOS', label: `Todos (${stats.total})` },
            { id: 'NOVOS', label: `Novos (${stats.novos})` },
            { id: 'JA_NO_CONTROLE', label: `No Controle (${stats.noControle})` },
            { id: 'PRECISA_DE_ACAO', label: `Precisa Ação (${stats.precisaAcao})` },
            { id: 'ULTIMOS_7_DIAS', label: `Últimos 7 Dias (${stats.ultimos7Dias})` },
            { id: 'DESCONSIDERADOS', label: `Desconsiderados (${stats.desconsiderados})` },
            ...(stats.naoLocalizados > 0 ? [{ id: 'NAO_LOCALIZADOS', label: `Não Localizados (${stats.naoLocalizados})` }] : []),
            ...(stats.aguardandoBase > 0 ? [{ id: 'AGUARDANDO_BASE', label: `Aguardando Base (${stats.aguardandoBase})` }] : []),
          ].map((f) => {
            const isSelected = filterType === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all select-none ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Filtro secundário por Promotor */}
        {promotoresUnicos.length > 0 && (
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-slate-400" />
              Filtrar por Promotor:
            </span>
            <select
              value={promotorFilter}
              onChange={(e) => setPromotorFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="TODOS">Todos os Promotores</option>
              {promotoresUnicos.map((prom) => (
                <option key={prom} value={prom}>
                  {prom}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* LISTA DE CARDS OPERACIONAIS DO SAEOU060 */}
      <div className="space-y-3" ref={listTopRef}>
        {/* Sumário de Contagem e Paginação */}
        {totalRegistros > 0 && (
          <div className="flex items-center justify-between px-1 text-xs font-bold text-slate-500">
            <span>
              Exibindo {startIndex + 1}–{endIndex} de {totalRegistros} {totalRegistros === 1 ? 'registro' : 'registros'}
            </span>
            {totalPages > 1 && (
              <span>
                Página {page} de {totalPages}
              </span>
            )}
          </div>
        )}

        {totalRegistros === 0 ? (
          <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
              <Calendar className="w-6 h-6" />
            </div>
            {isSaeouDesatualizada && !verHistoricoAnterior ? (
              <>
                <h3 className="text-sm font-black uppercase text-amber-900">
                  ⚠ SAEOU060 Desatualizada ({ultimaMovimentacaoDisplay})
                </h3>
                <p className="text-xs text-amber-800 max-w-md mx-auto leading-relaxed">
                  Os produtos importados pertencem a uma data anterior. Para manter a rotina de hoje ({hojeDisplay}) precisa, mercadorias de dias anteriores não são mostradas na lista do dia a dia.
                </p>
                <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
                  <label
                    htmlFor={fileInputId}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <UploadCloud className="w-4 h-4" />
                    Importar SAEOU060 de Hoje
                  </label>
                  <button
                    onClick={handleSimularHoje}
                    className="px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold rounded-xl inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Simular Hoje ({hojeDisplay})
                  </button>
                  <button
                    onClick={() => setVerHistoricoAnterior(true)}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl inline-flex items-center gap-1.5"
                  >
                    <Eye className="w-4 h-4" />
                    Ver Histórico Anterior ({totalRegistrosGerais})
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-bold text-slate-800">
                  Nenhum registro do SAEOU060 encontrado
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  {filterType !== 'TODOS' || debouncedSearch.trim() || setorSelecionado !== 'TODOS'
                    ? 'Nenhum item corresponde ao filtro, setor ou busca selecionada. Tente alterar os filtros ou a busca.'
                    : 'Importe uma planilha do SAEOU060 para carregar a rotina operacional dos próximos 15 dias.'}
                </p>
                {filterType !== 'TODOS' || debouncedSearch.trim() || setorSelecionado !== 'TODOS' ? (
                  <button
                    onClick={() => {
                      setFilterType('TODOS');
                      setInputSearch('');
                      setDebouncedSearch('');
                      setPromotorFilter('TODOS');
                      setSetorSelecionado('TODOS');
                    }}
                    className="px-4 py-2 bg-blue-50 text-blue-700 text-xs font-bold rounded-xl hover:bg-blue-100"
                  >
                    Limpar Filtros, Setor e Busca
                  </button>
                ) : (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <label
                      htmlFor={fileInputId}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <UploadCloud className="w-4 h-4" />
                      Importar Planilha SAEOU060
                    </label>
                    <button
                      onClick={gerarExemploPlanilhaSAEOU060}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl inline-flex items-center gap-1.5"
                    >
                      <Download className="w-4 h-4" />
                      Baixar Modelo
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          visibleRegistros.map(({ reg, prod, diasRestantes, setorFisico, setorBalanco }) => {
            const isCritical = diasRestantes !== null && diasRestantes <= 7;
            const isNoControle = reg.status_saeou === 'JA_NO_CONTROLE';
            const isDesconsiderado = reg.status_saeou === 'DESCONSIDERADO';

            return (
              <div
                key={reg.id}
                className={`bg-white rounded-2xl p-4 sm:p-5 border transition-all space-y-3.5 shadow-2xs hover:shadow-sm ${
                  isCritical && !isNoControle && !isDesconsiderado
                    ? 'border-amber-300 ring-1 ring-amber-200'
                    : isNoControle
                    ? 'border-emerald-200/80 bg-emerald-50/10'
                    : isDesconsiderado
                    ? 'border-slate-200 opacity-70 bg-slate-50/50'
                    : 'border-slate-200 hover:border-blue-400'
                }`}
              >
                {/* Cabeçalho do Card: Código, Status e Promotor */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center flex-wrap gap-2">
                      <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-0.8 rounded-md border border-blue-200">
                        Cód: <HighlightText text={reg.codigo_exibicao || reg.codigo_interno} query={debouncedSearch} />
                      </span>
                      {getStatusBadge(reg, diasRestantes)}
                      {reg.promotor && (
                        <span className="text-[11px] text-slate-500 font-semibold flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">
                          <User className="w-3 h-3 text-slate-400" />
                          <HighlightText text={reg.promotor} query={debouncedSearch} />
                        </span>
                      )}
                      {reg.data_movimento && (
                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                          Mov: {reg.data_movimento}
                        </span>
                      )}
                    </div>
                    {/* Descrição do Produto */}
                    <h3 className="text-sm sm:text-base font-black text-slate-900 leading-snug mt-1.5">
                      <HighlightText
                        text={prod?.descricao || reg.descricao || 'PRODUTO NÃO ENCONTRADO NA SMGOI013'}
                        query={debouncedSearch}
                      />
                    </h3>
                    {/* Setor Físico e Setor Balanço vinculados via SMGOI013 */}
                    {(setorFisico || setorBalanco || prod?.setor_fisico || prod?.setor_balanco) && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        {(setorFisico || prod?.setor_fisico) && (
                          <span className="text-[10px] font-bold text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                            Físico: <span className="font-semibold text-slate-800">{setorFisico || prod?.setor_fisico}</span>
                          </span>
                        )}
                        {(setorBalanco || prod?.setor_balanco) && (
                          <span className="text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                            Balanço: <span className="font-semibold text-slate-800">{setorBalanco || prod?.setor_balanco}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Informação de Embalagem */}
                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-md block">
                      {prod?.embalagem || reg.embalagem || 'UN 1'}
                    </span>
                  </div>
                </div>

                {/* Grade de Dados Operacionais Cruzados */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs">
                  {/* Validade */}
                  <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
                    <span className="text-[11px] text-slate-500 font-medium block">Data de Validade:</span>
                    <p className="text-xs font-black text-slate-900 mt-0.5 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-blue-600" />
                      {reg.data_vencimento_exibicao || reg.data_vencimento || 'N/I'}
                    </p>
                    {diasRestantes !== null && (
                      <span
                        className={`text-[10px] font-bold block mt-0.5 ${
                          diasRestantes <= 3
                            ? 'text-rose-700'
                            : diasRestantes <= 7
                            ? 'text-amber-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {diasRestantes < 0
                          ? `Venceu há ${Math.abs(diasRestantes)}d`
                          : diasRestantes === 0
                          ? 'Vence HOJE!'
                          : `${diasRestantes} dias restantes`}
                      </span>
                    )}
                  </div>

                  {/* Quantidade */}
                  <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
                    <span className="text-[11px] text-slate-500 font-medium block">Quantidade:</span>
                    <p className="text-xs font-black text-blue-800 mt-0.5">
                      {reg.quantidade} {prod?.unidade_medida || 'UN'}
                    </p>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Apontada pelo promotor
                    </span>
                  </div>

                  {/* Estoque Atual SMGOI013 */}
                  <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
                    <span className="text-[11px] text-slate-500 font-medium block">Estoque Atual:</span>
                    <p className="text-xs font-black text-slate-900 mt-0.5">
                      {prod?.estoque_total !== undefined ? `${prod.estoque_total} ${prod.unidade_medida || 'UN'}` : '-'}
                    </p>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Base SMGOI013</span>
                  </div>

                  {/* Giro e Dias sem venda */}
                  <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
                    <span className="text-[11px] text-slate-500 font-medium block">Giro 30d / S.Venda:</span>
                    <p className="text-xs font-black text-slate-900 mt-0.5">
                      {prod?.vendas_qtde_30d !== undefined ? `${prod.vendas_qtde_30d} un` : '-'} /{' '}
                      <span className="text-amber-700">
                        {prod?.dias_sem_venda !== undefined ? `${prod.dias_sem_venda}d` : '-'}
                      </span>
                    </p>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Venda e estagnação</span>
                  </div>
                </div>

                {/* Preço trabalhado e Observação (se existirem) */}
                {(reg.preco_trabalhado !== undefined || reg.observacao || reg.motivo_desconsiderado) && (
                  <div className="bg-blue-50/40 rounded-xl p-2.5 border border-blue-100 text-xs flex flex-wrap items-center justify-between gap-2">
                    {reg.preco_trabalhado !== undefined && (
                      <span className="font-semibold text-slate-700 flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5 text-blue-600" />
                        Preço Trab: <strong className="text-blue-800">R$ {Number(reg.preco_trabalhado).toFixed(2).replace('.', ',')}</strong>
                        {reg.data_preco && <span className="text-slate-400 text-[10px]">({reg.data_preco})</span>}
                      </span>
                    )}
                    {reg.observacao && (
                      <span className="text-slate-600 italic line-clamp-1">
                        Obs: {reg.observacao}
                      </span>
                    )}
                    {reg.motivo_desconsiderado && (
                      <span className="text-slate-500 text-[11px] italic">
                        Motivo desconsideração: {reg.motivo_desconsiderado}
                      </span>
                    )}
                  </div>
                )}

                {/* BOTÕES DE AÇÃO OPERACIONAL */}
                <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {prod && onSelectProduto && (
                      <button
                        onClick={() => onSelectProduto(prod)}
                        className="px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200 inline-flex items-center gap-1.5 transition-colors"
                        title="Ver detalhes completos na Consulta"
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                        <span>Ver Cadastro</span>
                      </button>
                    )}

                    {isNoControle && onNavigateToControle && (
                      <button
                        onClick={onNavigateToControle}
                        className="px-3 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-xl border border-emerald-200 inline-flex items-center gap-1.5 transition-colors"
                        title="Abrir no Controle de Vencimentos"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Ver no Controle</span>
                      </button>
                    )}
                  </div>

                  {/* BOTÃO PRINCIPAL: TRABALHAR VALIDADE */}
                  <div className="flex items-center gap-2">
                    {!isNoControle && !isDesconsiderado && (
                      <button
                        onClick={() => handleAdicionarAoControle(reg.id)}
                        className="px-3.5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl border border-blue-200 inline-flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                        title="Adicionar direto com os dados da planilha"
                      >
                        <Plus className="w-4 h-4" />
                        <span className="hidden sm:inline">Adicionar Rápido</span>
                      </button>
                    )}

                    <button
                      onClick={() => setActiveTrabalharRegistro(reg)}
                      className={`flex-1 sm:flex-initial px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 ${
                        isCritical && !isNoControle && !isDesconsiderado
                          ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/20'
                          : isNoControle
                          ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-blue-600/20'
                      }`}
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>TRABALHAR VALIDADE</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* CONTROLES DE PAGINAÇÃO NO SAEOU060 (10 POR PÁGINA) */}
        {totalPages > 1 && (
          <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-2xs flex items-center justify-between gap-2 mt-4">
            <button
              type="button"
              id="btn-saeou-anterior"
              onClick={() => handlePageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Anterior</span>
            </button>

            <div className="text-xs font-bold text-slate-700">
              Página <span className="font-black text-blue-700">{page}</span> de <span className="font-black text-slate-900">{totalPages}</span>
            </div>

            <button
              type="button"
              id="btn-saeou-proxima"
              onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <span>Próxima</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* MODAL DE TRABALHAR VALIDADE */}
      {activeTrabalharRegistro && (
        <TrabalharValidadeModal
          registro={activeTrabalharRegistro}
          produto={
            produtosMap.get(activeTrabalharRegistro.codigo_interno) ||
            productRepository.getProductByCode(activeTrabalharRegistro.codigo_interno)
          }
          isOpen={Boolean(activeTrabalharRegistro)}
          onClose={() => setActiveTrabalharRegistro(null)}
          onAdicionarAoControle={handleAdicionarAoControle}
          onDesconsiderar={handleDesconsiderarValidade}
          onRestaurar={handleRestaurarValidade}
          onSalvarTrabalho={handleSalvarTrabalho}
          onNavigateToControle={onNavigateToControle}
        />
      )}

      {/* MODAL DE RESUMO DE IMPORTAÇÃO */}
      {importSummaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Importação SAEOU060 Concluída
                  </h3>
                  <p className="text-xs text-slate-500">
                    Resumo do processamento da planilha
                  </p>
                </div>
              </div>
              <button
                onClick={() => setImportSummaryModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Linhas Processadas:</span>
                <span className="font-bold text-slate-900">{importSummaryModal.total_lidos}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Registros Válidos:</span>
                <span className="font-bold text-blue-700">{importSummaryModal.total_atualizados + importSummaryModal.total_novos}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Novos Registros a Trabalhar:</span>
                <span className="font-bold text-emerald-700">{importSummaryModal.total_novos || 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Já no Controle:</span>
                <span className="font-bold text-slate-700">{importSummaryModal.total_ja_no_controle || 0}</span>
              </div>
              {importSummaryModal.total_nao_localizados ? (
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-red-600">Não Localizados na SMG:</span>
                  <span className="font-bold text-red-600">{importSummaryModal.total_nao_localizados}</span>
                </div>
              ) : null}
            </div>

            <button
              onClick={() => setImportSummaryModal(null)}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
            >
              Iniciar Trabalho das Validades
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
