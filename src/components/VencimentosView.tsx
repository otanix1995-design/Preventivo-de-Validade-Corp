import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Check,
  CheckSquare,
  Clock,
  DollarSign,
  FileSpreadsheet,
  FileText,
  Layers,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Tag,
  Trash2,
  TrendingDown
} from 'lucide-react';
import React, { useMemo, useState, useEffect } from 'react';
import { parseEmbalagem } from '../services/codeParser';
import { exportarCsvVencimentos, gerarPdfVencimentos } from '../services/pdfReport';
import { calcularProjecaoVencimento, formatarDataBR, formatarDiasRestantes } from '../services/projection';
import { deleteVencimento } from '../services/storage';
import { productRepository } from '../services/productRepository';
import { syncQueueService } from '../services/syncQueueService';
import { cloudSyncService } from '../services/cloudSyncService';
import { LoteVencimento, ProdutoSMG } from '../types';
import { LimparDadosAntigosModal } from './LimparDadosAntigosModal';
import { GerarCartazesModal } from './GerarCartazesModal';
import { StatusBadge } from './StatusBadge';
import { Saeou060View } from './Saeou060View';

interface VencimentosViewProps {
  vencimentos: LoteVencimento[];
  produtos: ProdutoSMG[];
  initialFilter?: string;
  initialSubTab?: 'controle' | 'saeou060';
  onSelectProduto: (produto: ProdutoSMG) => void;
  onOpenCadastrarModal: (produto?: ProdutoSMG, lote?: LoteVencimento) => void;
}

export const VencimentosView: React.FC<VencimentosViewProps> = ({
  vencimentos,
  produtos,
  initialFilter = 'TODOS',
  initialSubTab = 'controle',
  onSelectProduto,
  onOpenCadastrarModal,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'controle' | 'saeou060'>(initialSubTab);
  const [activeFilter, setActiveFilter] = useState<string>(initialFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLimparModalOpen, setIsLimparModalOpen] = useState(false);
  const [selectedLoteIds, setSelectedLoteIds] = useState<Set<string>>(new Set());
  const [isGerarCartazesModalOpen, setIsGerarCartazesModalOpen] = useState(false);
  const [saeouCount, setSaeouCount] = useState(() => productRepository.getSaeou060Registros().length);
  const [pendingSyncCount, setPendingSyncCount] = useState(() => syncQueueService.getPendingCount());
  const hoje = new Date();

  useEffect(() => {
    if (initialSubTab) {
      setActiveSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  // Processar fila local pendente de vencimentos ao acessar aba Controle
  useEffect(() => {
    if (activeSubTab === 'controle') {
      syncQueueService.processQueue().catch(() => {});
    }
  }, [activeSubTab]);

  useEffect(() => {
    const unsub = productRepository.subscribe(() => {
      setSaeouCount(productRepository.getSaeou060Registros().length);
    });
    const unsubQueue = syncQueueService.subscribe(() => {
      setPendingSyncCount(syncQueueService.getPendingCount());
    });
    return () => {
      unsub();
      unsubQueue();
    };
  }, []);

  const produtosMap = useMemo(() => {
    const map = new Map<string, ProdutoSMG>();
    produtos.forEach((p) => map.set(p.codigo_interno, p));
    return map;
  }, [produtos]);

  const lotesCalculados = useMemo(() => {
    return vencimentos.map((lote) => {
      const produto = produtosMap.get(lote.codigo_interno);
      const projecao = calcularProjecaoVencimento(lote, produto, hoje);
      return { lote, produto, projecao };
    });
  }, [vencimentos, produtosMap]);

  // Filters list for Controle tab
  const filterOptions = [
    { id: 'TODOS', label: 'Todos' },
    { id: 'HOJE', label: 'Vencem Hoje' },
    { id: 'ATE_3_DIAS', label: 'Até 3 Dias' },
    { id: 'ATE_7_DIAS', label: 'Até 7 Dias' },
    { id: 'ATE_15_DIAS', label: 'Até 15 Dias' },
    { id: 'ATE_30_DIAS', label: 'Até 30 Dias' },
    { id: 'CRITICO', label: 'Crítico' },
    { id: 'ALERTA', label: 'Alerta' },
    { id: 'NORMAL', label: 'Normal' },
    { id: 'SAIDA_INSUFICIENTE', label: 'Saída Insuficiente' },
    { id: 'ENVIAR_AO_COMPRADOR', label: 'Enviar Comprador' },
  ];

  const filtrados = useMemo(() => {
    return lotesCalculados.filter(({ lote, produto, projecao }) => {
      // 1. Search Query filter
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toUpperCase();
        const descMatch = (lote.descricao_produto || produto?.descricao || '').toUpperCase().includes(q);
        const codMatch = lote.codigo_interno.includes(q) || (lote.codigo_exibicao || '').includes(q);
        const eanMatch = produto?.eans?.some((e) => e.includes(q)) ?? false;
        if (!descMatch && !codMatch && !eanMatch) return false;
      }

      // 2. Status/Date filter
      switch (activeFilter) {
        case 'HOJE':
          return projecao.dias_restantes === 0;
        case 'ATE_3_DIAS':
          return projecao.dias_restantes <= 3;
        case 'ATE_7_DIAS':
          return projecao.dias_restantes <= 7;
        case 'ATE_15_DIAS':
          return projecao.dias_restantes <= 15;
        case 'ATE_30_DIAS':
          return projecao.dias_restantes <= 30;
        case 'CRITICO':
          return projecao.status === 'CRITICO';
        case 'ALERTA':
          return projecao.status === 'ALERTA';
        case 'NORMAL':
          return projecao.status === 'NORMAL';
        case 'SAIDA_INSUFICIENTE':
          return projecao.status === 'SAIDA_INSUFICIENTE';
        case 'ENVIAR_AO_COMPRADOR':
          return projecao.status === 'ENVIAR_AO_COMPRADOR' || lote.enviar_ao_comprador;
        case 'TODOS':
        default:
          return true;
      }
    }).sort((a, b) => a.projecao.dias_restantes - b.projecao.dias_restantes);
  }, [lotesCalculados, activeFilter, searchTerm]);

  const handleDeleteLote = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Deseja realmente remover este lote de vencimento?')) {
      await deleteVencimento(id);
    }
  };

  const handleToggleEnviarComprador = async (lote: LoteVencimento, e: React.MouseEvent) => {
    e.stopPropagation();
    const novoStatus = !lote.enviar_ao_comprador;
    await productRepository.updateVencimento(lote.id, {
      enviar_ao_comprador: novoStatus,
      status_customizado: novoStatus ? 'ENVIAR_AO_COMPRADOR' : undefined,
    });
  };

  // Gerenciamento de seleção para o Gerador de Cartazes
  const handleToggleSelectLote = (loteId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedLoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(loteId)) {
        next.delete(loteId);
      } else {
        next.add(loteId);
      }
      return next;
    });
  };

  const todosFiltradosSelecionados = useMemo(() => {
    if (filtrados.length === 0) return false;
    return filtrados.every((item) => selectedLoteIds.has(item.lote.id));
  }, [filtrados, selectedLoteIds]);

  const handleToggleSelectAllFiltrados = () => {
    if (todosFiltradosSelecionados) {
      setSelectedLoteIds((prev) => {
        const next = new Set(prev);
        filtrados.forEach((item) => next.delete(item.lote.id));
        return next;
      });
    } else {
      setSelectedLoteIds((prev) => {
        const next = new Set(prev);
        filtrados.forEach((item) => next.add(item.lote.id));
        return next;
      });
    }
  };

  const handleClearSelection = () => {
    setSelectedLoteIds(new Set());
  };

  const handleRemoveFromSelection = (loteId: string) => {
    setSelectedLoteIds((prev) => {
      const next = new Set(prev);
      next.delete(loteId);
      return next;
    });
  };

  const selectedLotes = useMemo(() => {
    return vencimentos.filter((l) => selectedLoteIds.has(l.id));
  }, [vencimentos, selectedLoteIds]);

  return (
    <div id="view-vencimentos" className="space-y-4 pb-24 max-w-4xl mx-auto">
      {/* CABEÇALHO AZUL PRINCIPAL: VALIDADES & TRABALHO DIÁRIO */}
      <div className="bg-blue-600 text-white rounded-2xl p-4 sm:p-5 shadow-md space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-700/80 rounded-xl border border-blue-400">
              <Calendar className="w-6 h-6 text-white stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black tracking-tight leading-tight">
                VALIDADES
              </h1>
              <p className="text-xs text-blue-100 font-medium mt-0.5">
                Trabalho diário {activeSubTab === 'saeou060' ? '• Próximos 15 dias' : '• Controle de Vencimentos'}
              </p>
            </div>
          </div>

          <button
            onClick={() => onOpenCadastrarModal()}
            className="px-3.5 py-2 bg-white text-blue-800 hover:bg-blue-50 active:bg-blue-100 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Novo Lote</span>
          </button>
        </div>

        {/* SELETOR DE ALTERNÂNCIA [ CONTROLE ] [ SAEOU060 ] */}
        <div className="grid grid-cols-2 bg-blue-700/70 p-1 rounded-xl border border-blue-400/40">
          <button
            id="tab-btn-controle"
            onClick={() => setActiveSubTab('controle')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
              activeSubTab === 'controle'
                ? 'bg-white text-blue-900 shadow-sm'
                : 'text-blue-100 hover:text-white hover:bg-blue-600/50'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>CONTROLE</span>
            {vencimentos.length > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeSubTab === 'controle'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-blue-800/80 text-blue-200'
                }`}
              >
                {vencimentos.length}
              </span>
            )}
          </button>

          <button
            id="tab-btn-saeou060"
            onClick={() => setActiveSubTab('saeou060')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
              activeSubTab === 'saeou060'
                ? 'bg-white text-blue-900 shadow-sm'
                : 'text-blue-100 hover:text-white hover:bg-blue-600/50'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>SAEOU060</span>
            {saeouCount > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeSubTab === 'saeou060'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-blue-800/80 text-blue-200'
                }`}
              >
                {saeouCount}
              </span>
            )}
          </button>
        </div>

        {pendingSyncCount > 0 && (
          <div className="flex items-center justify-between text-xs bg-blue-500/30 border border-blue-300/40 rounded-lg px-3 py-1.5 text-blue-100">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>Dados salvos localmente • Sincronização em segundo plano ({pendingSyncCount} pendente{pendingSyncCount > 1 ? 's' : ''})</span>
            </div>
            <button
              onClick={() => syncQueueService.processQueue()}
              className="text-[11px] underline hover:text-white"
            >
              Sincronizar agora
            </button>
          </div>
        )}
      </div>

      {/* RENDERIZAÇÃO DA SUB-ABA ATIVA */}
      {activeSubTab === 'saeou060' ? (
        <Saeou060View
          onSelectProduto={onSelectProduto}
          onNavigateToControle={() => setActiveSubTab('controle')}
        />
      ) : (
        /* VISÃO: CONTROLE DE VENCIMENTOS */
        <div className="space-y-4">
          {/* Header card with filters and counters */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-xs border border-gray-200 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-xs font-black uppercase tracking-wider text-gray-800 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-700 stroke-[2.5]" />
                  Lista de Lotes em Acompanhamento
                </h2>
                <p className="text-xs text-gray-500 font-mono mt-0.5">
                  {filtrados.length} {filtrados.length === 1 ? 'LOTE LISTADO' : 'LOTES LISTADOS'}
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Botão Principal: GERAR CARTAZES */}
                {selectedLoteIds.size > 0 ? (
                  <button
                    id="btn-gerar-cartazes-destaque"
                    onClick={() => setIsGerarCartazesModalOpen(true)}
                    className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer ring-2 ring-amber-400/50"
                    title="Conferir e gerar planilha oficial Tagsell (19 colunas)"
                  >
                    <Tag className="w-4 h-4 stroke-[2.5]" />
                    <span>GERAR CARTAZES ({selectedLoteIds.size})</span>
                  </button>
                ) : (
                  <button
                    id="btn-abrir-cartazes"
                    onClick={() => {
                      if (filtrados.length > 0) {
                        handleToggleSelectAllFiltrados();
                      }
                    }}
                    className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                    title="Selecionar itens da lista para gerar cartazes Tagsell"
                  >
                    <Tag className="w-4 h-4 text-amber-700 stroke-[2.5]" />
                    <span className="hidden sm:inline">Gerador Cartazes</span>
                    <span className="sm:hidden">Cartazes</span>
                  </button>
                )}

                {/* Botão de Seleção Rápida */}
                <button
                  id="btn-selecionar-todos-cartazes"
                  onClick={handleToggleSelectAllFiltrados}
                  className={`px-3 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer ${
                    todosFiltradosSelecionados
                      ? 'bg-amber-100 text-amber-900 border-amber-300 font-black'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                  title={todosFiltradosSelecionados ? 'Desmarcar todos os itens visíveis' : 'Selecionar todos os itens visíveis'}
                >
                  <CheckSquare className={`w-4 h-4 ${todosFiltradosSelecionados ? 'text-amber-700' : 'text-slate-500'}`} />
                  <span className="hidden sm:inline">{todosFiltradosSelecionados ? 'Desmarcar Todos' : 'Selecionar'}</span>
                  <span className="sm:hidden">{todosFiltradosSelecionados ? 'Desmarcar' : 'Sel.'}</span>
                </button>

                <button
                  onClick={() => setIsLimparModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-2xs"
                  title="Limpar Dados e Lotes Antigos"
                >
                  <Trash2 className="w-4 h-4 stroke-[2.5]" />
                  <span className="hidden sm:inline">Limpar Antigos</span>
                </button>
                <button
                  onClick={() => gerarPdfVencimentos(activeFilter)}
                  className="px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-2xs"
                  title="Exportar PDF"
                >
                  <FileText className="w-4 h-4 stroke-[2.5]" />
                  <span className="hidden sm:inline">Relatório PDF</span>
                </button>
                <button
                  onClick={exportarCsvVencimentos}
                  className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-2xs"
                  title="Exportar CSV (Excel)"
                >
                  <FileSpreadsheet className="w-4 h-4 stroke-[2.5]" />
                  <span className="hidden sm:inline">Excel / CSV</span>
                </button>
              </div>
            </div>

            {/* Quick Search */}
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3 stroke-[2.5]" />
              <input
                id="input-filtro-vencimentos"
                type="text"
                placeholder="Filtrar por código, descrição ou EAN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-blue-600 focus:bg-white rounded-xl pl-10 pr-3 py-2.5 text-xs font-bold text-gray-900 focus:outline-hidden transition-all shadow-2xs"
              />
            </div>

            {/* BANNER DE SELEÇÃO ATIVA PARA CARTAZES */}
            {selectedLoteIds.size > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between gap-2 text-xs text-amber-900 animate-fadeIn flex-wrap">
                <div className="flex items-center gap-2 font-bold">
                  <span className="w-5 h-5 rounded-full bg-amber-600 text-white font-mono text-[10px] flex items-center justify-center font-black">
                    {selectedLoteIds.size}
                  </span>
                  <span>
                    {selectedLoteIds.size === 1
                      ? '1 produto selecionado'
                      : `${selectedLoteIds.size} produtos selecionados`}{' '}
                    para cartaz Tagsell
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-[11px] text-amber-800 hover:text-amber-950 underline font-semibold cursor-pointer"
                  >
                    Desmarcar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsGerarCartazesModalOpen(true)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-wider rounded-lg shadow-xs flex items-center gap-1 cursor-pointer active:scale-95"
                  >
                    <Tag className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Conferir e Gerar XLSX</span>
                  </button>
                </div>
              </div>
            )}

            {/* Filter Chips Horizontal Slider */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 scrollbar-none no-scrollbar">
              {filterOptions.map((f) => {
                const isSelected = activeFilter === f.id;
                return (
                  <button
                    key={f.id}
                    id={`filter-btn-${f.id.toLowerCase()}`}
                    onClick={() => setActiveFilter(f.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all select-none ${
                      isSelected
                        ? 'bg-blue-700 text-white shadow-xs'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lotes List */}
          <div className="space-y-3">
            {filtrados.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 border border-gray-200 text-center space-y-3">
                <AlertCircle className="w-10 h-10 text-gray-400 mx-auto stroke-[2]" />
                <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wide">
                  Nenhum lote de vencimento encontrado
                </h4>
                <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                  {activeFilter !== 'TODOS'
                    ? `Nenhum lote atende ao filtro "${filterOptions.find((o) => o.id === activeFilter)?.label}".`
                    : 'Cadastre um novo vencimento ou trabalhe os itens da aba SAEOU060 para incluir no controle.'}
                </p>
                {activeFilter !== 'TODOS' ? (
                  <button
                    onClick={() => setActiveFilter('TODOS')}
                    className="px-4 py-2 bg-blue-50 text-blue-700 font-bold uppercase tracking-wider rounded-xl text-xs hover:bg-blue-100"
                  >
                    Ver todos os lotes
                  </button>
                ) : (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                      onClick={() => onOpenCadastrarModal()}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs rounded-xl shadow-xs"
                    >
                      Cadastrar Novo Lote
                    </button>
                    <button
                      onClick={() => setActiveSubTab('saeou060')}
                      className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl border border-blue-200"
                    >
                      Ir para SAEOU060
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filtrados.map(({ lote, produto, projecao }) => {
                const diasFmt = formatarDiasRestantes(projecao.dias_restantes);
                const embData = parseEmbalagem(lote.embalagem || produto?.embalagem);
                const conversao = embData.descricao_formatada(lote.quantidade_total_unidades);
                const isSelected = selectedLoteIds.has(lote.id);

                return (
                  <div
                    key={lote.id}
                    id={`lote-item-${lote.id}`}
                    onClick={() => {
                      if (produto) onSelectProduto(produto);
                    }}
                    className={`rounded-2xl p-4 sm:p-5 border transition-all cursor-pointer space-y-3 active:scale-[0.99] ${
                      isSelected
                        ? 'bg-amber-50/40 border-amber-400 ring-2 ring-amber-500 shadow-xs'
                        : lote.enviar_ao_comprador
                        ? 'bg-orange-50/50 border-orange-300 hover:border-orange-400 shadow-xs'
                        : 'bg-white border-gray-200 hover:border-blue-500 hover:shadow-xs'
                    }`}
                  >
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center flex-wrap gap-2">
                          {/* Botão de Seleção para Cartaz Tagsell */}
                          <button
                            type="button"
                            id={`btn-selecionar-cartaz-${lote.id}`}
                            onClick={(e) => handleToggleSelectLote(lote.id, e)}
                            className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-md border transition-all cursor-pointer active:scale-95 ${
                              isSelected
                                ? 'bg-amber-600 text-white border-amber-700 shadow-xs'
                                : 'bg-slate-100 hover:bg-amber-50 text-slate-700 hover:text-amber-900 border-slate-300 hover:border-amber-400'
                            }`}
                            title={
                              isSelected
                                ? 'Desmarcar este produto dos cartazes'
                                : 'Selecionar este produto para gerar cartaz Tagsell'
                            }
                          >
                            <div
                              className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-all ${
                                isSelected ? 'bg-white text-amber-700' : 'border border-slate-400 bg-white'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <span>CARTAZ</span>
                          </button>

                          <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            {lote.codigo_exibicao || lote.codigo_interno}
                          </span>
                          <span className="text-xs font-bold text-gray-600">
                            {lote.embalagem || produto?.embalagem}
                          </span>
                          {lote.origem === 'SAEOU060' && (
                            <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold">
                              SAEOU060
                            </span>
                          )}
                          {lote.lote_identificador && (
                            <span className="text-[10px] bg-gray-100 text-gray-800 px-2 py-0.5 rounded font-mono font-bold">
                              LOTE: {lote.lote_identificador}
                            </span>
                          )}
                          {/* Botão de Atalho Rápido: Enviar ao Comprador / Status Crítico */}
                          <button
                            onClick={(e) => handleToggleEnviarComprador(lote, e)}
                            className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-md border transition-all ${
                              lote.enviar_ao_comprador
                                ? 'bg-orange-200 text-orange-950 border-orange-400 hover:bg-orange-300'
                                : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-orange-50 hover:text-orange-800 hover:border-orange-300'
                            }`}
                            title={
                              lote.enviar_ao_comprador
                                ? 'Mercadoria sinalizada ao comprador (CRÍTICO no PDF). Clique para desmarcar.'
                                : 'Clique para sinalizar ao comprador (receberá STATUS ⚠ CRÍTICO no PDF).'
                            }
                          >
                            {lote.enviar_ao_comprador ? (
                              <>
                                <AlertTriangle className="w-3 h-3 text-orange-700 stroke-[2.5]" />
                                <span>⚠ CRÍTICO (COMPRADOR)</span>
                              </>
                            ) : (
                              <>
                                <Send className="w-2.5 h-2.5 text-gray-500" />
                                <span>Enviar Comprador</span>
                              </>
                            )}
                          </button>
                        </div>
                        <h3 className="text-sm font-black text-gray-900 uppercase leading-snug mt-1.5">
                          {lote.descricao_produto || produto?.descricao}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusBadge status={projecao.status} />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (produto) {
                              onOpenCadastrarModal(produto, lote);
                            } else {
                              const foundProd = produtos.find((p) => p.codigo_interno === lote.codigo_interno);
                              if (foundProd) onOpenCadastrarModal(foundProd, lote);
                            }
                          }}
                          className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors border border-blue-200"
                          title="Editar este lote ou preço de rebaixe"
                        >
                          <Pencil className="w-3.5 h-3.5 stroke-[2.5]" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteLote(lote.id, e)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remover este lote"
                        >
                          <Trash2 className="w-4 h-4 stroke-[2]" />
                        </button>
                      </div>
                    </div>

                    {/* Projeção e Dados do Lote */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-100 text-xs">
                      <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                        <span className="text-[11px] text-gray-500 font-medium">Validade:</span>
                        <p className="font-mono font-bold text-gray-900 mt-0.5">
                          {formatarDataBR(lote.data_validade)}
                        </p>
                        <span className={`text-[10px] font-bold ${diasFmt.cor} block mt-0.5`}>
                          {diasFmt.texto}
                        </span>
                      </div>

                      <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                        <span className="text-[11px] text-gray-500 font-medium">Qtd. Vencendo:</span>
                        <p className="font-bold text-blue-700 mt-0.5">
                          {lote.quantidade_total_unidades} UN
                        </p>
                        <span className="text-[10px] text-gray-500 block mt-0.5">
                          {conversao}
                        </span>
                      </div>

                      <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                        <span className="text-[11px] text-gray-500 font-medium">Estoque Atual:</span>
                        <p className="font-bold text-gray-900 mt-0.5">
                          {produto?.estoque_total !== undefined ? `${produto.estoque_total} ${produto.unidade_medida || 'UN'}` : '-'}
                        </p>
                        <span className="text-[10px] text-gray-400 block mt-0.5">Base SMGOI013</span>
                      </div>

                      <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                        <span className="text-[11px] text-gray-500 font-medium">Giro Diário / 30d:</span>
                        <p className="font-bold text-gray-900 mt-0.5">
                          {projecao.media_diaria_30d.toFixed(1)} un/dia
                        </p>
                        <span className="text-[10px] text-gray-500 block mt-0.5">
                          Total: {produto?.vendas_qtde_30d || 0} un
                        </span>
                      </div>
                    </div>

                    {/* Preço de Rebaixe / Trabalhado, Preço Normal e Observação */}
                    {(lote.preco_trabalhado !== undefined || (lote as any).preco_normal !== undefined || (lote as any).precoNormal !== undefined || lote.observacao) && (() => {
                      const pNorm = (lote as any).preco_normal ?? (lote as any).precoNormal ?? produto?.vendas_preco;
                      const pReb = lote.preco_trabalhado ?? (lote as any).precoTrabalhado;
                      return (
                        <div className="bg-amber-50/50 rounded-xl p-2.5 border border-amber-200/80 text-xs flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {pNorm !== undefined && pNorm !== null && (
                              <span className="inline-flex items-center gap-1 font-bold text-gray-700 bg-white px-2 py-0.5 rounded border border-gray-300 font-mono">
                                DE: R$ {Number(pNorm).toFixed(2).replace('.', ',')}
                              </span>
                            )}
                            {pReb !== undefined && pReb !== null ? (
                              <span className="inline-flex items-center gap-1 font-black text-amber-950 bg-amber-100/90 px-2 py-0.5 rounded border border-amber-300 font-mono">
                                <Tag className="w-3.5 h-3.5 text-amber-700" />
                                POR: R$ {Number(pReb).toFixed(2).replace('.', ',')}
                              </span>
                            ) : null}
                            {pNorm && pReb && pNorm > pReb && (
                              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                -{Math.round(((pNorm - pReb) / pNorm) * 100)}% desc.
                              </span>
                            )}
                            {lote.data_preco && (
                              <span className="text-gray-500 text-[10px]">
                                Início: {formatarDataBR(lote.data_preco)}
                              </span>
                            )}
                          </div>
                          {lote.observacao && (
                            <span className="text-gray-600 font-medium italic">
                              Obs: {lote.observacao}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* BARRA FLUTUANTE INFERIOR QUANDO HOUVER PRODUTOS SELECIONADOS */}
      {selectedLoteIds.size > 0 && (
        <div
          id="barra-flutuante-cartazes"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white backdrop-blur-md px-4 py-2.5 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-3.5 animate-fadeIn max-w-[95vw]"
        >
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center font-mono">
              {selectedLoteIds.size}
            </span>
            <span className="text-xs font-bold text-slate-200">
              {selectedLoteIds.size === 1 ? 'produto selecionado' : 'produtos selecionados'}
            </span>
          </div>

          <div className="h-4 w-px bg-slate-700" />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearSelection}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors font-medium cursor-pointer"
            >
              Limpar
            </button>
            <button
              type="button"
              id="btn-flutuante-gerar-cartazes"
              onClick={() => setIsGerarCartazesModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
            >
              <Tag className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Gerar Cartazes</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal de Conferência e Exportação de Cartazes Tagsell */}
      <GerarCartazesModal
        isOpen={isGerarCartazesModalOpen}
        onClose={() => setIsGerarCartazesModalOpen(false)}
        selectedLotes={selectedLotes}
        produtosMap={produtosMap}
        onRemoveFromSelection={handleRemoveFromSelection}
        onEditLote={(prod, lote) => {
          setIsGerarCartazesModalOpen(false);
          onOpenCadastrarModal(prod, lote);
        }}
      />

      {/* Modal de Limpar Lotes Antigos */}
      <LimparDadosAntigosModal
        isOpen={isLimparModalOpen}
        onClose={() => setIsLimparModalOpen(false)}
        onCompleted={() => {
          setIsLimparModalOpen(false);
        }}
      />
    </div>
  );
};
