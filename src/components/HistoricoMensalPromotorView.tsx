import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Package,
  RefreshCw,
  Search,
  Tag,
  User,
  XCircle
} from 'lucide-react';
import { analisePromotorService } from '../services/analisePromotorService';
import { promotorService } from '../services/promotorService';
import { RelatorioPromotorService } from '../services/relatorioPromotorService';
import { formatarDataBR, formatarDiasRestantes } from '../services/projection';
import {
  FiltrosHistoricoPromotor,
  ResumoHistoricoPromotor,
  SolicitacaoVencimentoPromotor
} from '../types';

interface HistoricoMensalPromotorViewProps {
  filialId?: string;
}

export const HistoricoMensalPromotorView: React.FC<HistoricoMensalPromotorViewProps> = ({
  filialId = '172',
}) => {
  // Mês/Ano padrão: mês atual no formato YYYY-MM
  const currentYearMonth = useMemo(() => {
    const d = new Date();
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    return `${ano}-${mes}`;
  }, []);

  // Estado de Filtros
  const [filtros, setFiltros] = useState<FiltrosHistoricoPromotor>({
    mesAno: currentYearMonth,
    promotorId: 'TODOS',
    industriaAgencia: 'TODAS',
    setor: 'TODOS',
    status: 'TODOS',
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoVencimentoPromotor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Lista de meses para o seletor (últimos 12 meses até próximos 3 meses)
  const listaMeses = useMemo(() => {
    const meses = [];
    const nomes = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const d = new Date();
    const currentYear = d.getFullYear();
    const currentMonth = d.getMonth();

    for (let i = -11; i <= 2; i++) {
      const targetDate = new Date(currentYear, currentMonth + i, 1);
      const y = targetDate.getFullYear();
      const m = String(targetDate.getMonth() + 1).padStart(2, '0');
      const val = `${y}-${m}`;
      const label = `${nomes[targetDate.getMonth()]} de ${y}`;
      meses.push({ val, label });
    }
    return meses.reverse();
  }, []);

  // 1. Carregar histórico e assinar alterações
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const carregar = async () => {
      try {
        const dados = await analisePromotorService.getHistoricoMensal({
          filialId,
          mesAno: filtros.mesAno,
          promotorId: filtros.promotorId,
          industriaAgencia: filtros.industriaAgencia,
          setor: filtros.setor,
          status: filtros.status,
        });
        if (isMounted) {
          setSolicitacoes(dados);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('Erro ao carregar histórico mensal:', err);
        if (isMounted) setIsLoading(false);
      }
    };

    carregar();

    // Listener em tempo real para sincronização instantânea
    const unsubscribe = analisePromotorService.subscribeHistoricoMensal(
      { filialId, mesAno: filtros.mesAno, promotorId: filtros.promotorId },
      (listaAtualizada) => {
        if (!isMounted) return;
        // Aplicar filtros complementares em memória
        let filtrada = listaAtualizada;
        if (filtros.industriaAgencia !== 'TODAS') {
          filtrada = filtrada.filter((s) => {
            const ag = (s.industriaAgencia || s.agencia || s.agenciaNome || '').trim().toUpperCase();
            return ag === filtros.industriaAgencia.trim().toUpperCase();
          });
        }
        if (filtros.setor !== 'TODOS') {
          filtrada = filtrada.filter((s) => {
            const set = (s.setor || s.setorTipo || '').trim().toUpperCase();
            if (filtros.setor === 'FRIOS') return set.includes('FRIO') || s.descricao?.startsWith('RF.');
            if (filtros.setor === 'LOJA') return !set.includes('FRIO') && !s.descricao?.startsWith('RF.');
            return true;
          });
        }
        if (filtros.status !== 'TODOS') {
          filtrada = filtrada.filter((s) => {
            if (filtros.status === 'PENDENTE') return s.status === 'PENDENTE_ANALISE';
            return s.status === filtros.status;
          });
        }
        setSolicitacoes(filtrada);
        setIsLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [filialId, filtros.mesAno, filtros.promotorId, filtros.industriaAgencia, filtros.setor, filtros.status]);

  // Lista única de promotores (combina cadastro oficial + registros de envios)
  const listaPromotoresDisponiveis = useMemo(() => {
    const mapa = new Map<string, { id: string; nome: string; agencia?: string }>();
    
    // Do cadastro
    promotorService.getPromotores().forEach((p) => {
      mapa.set(p.promotorId, { id: p.promotorId, nome: p.nome, agencia: p.agenciaNome });
    });

    // Das solicitações carregadas
    solicitacoes.forEach((s) => {
      if (s.promotorId && !mapa.has(s.promotorId)) {
        mapa.set(s.promotorId, {
          id: s.promotorId,
          nome: s.promotorNome || s.promotorId,
          agencia: s.agencia || s.agenciaNome || s.industriaAgencia,
        });
      }
    });

    return Array.from(mapa.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [solicitacoes]);

  // Lista única de indústrias/agências
  const listaAgenciasDisponiveis = useMemo(() => {
    const setAg = new Set<string>();
    
    promotorService.getPromotores().forEach((p) => {
      const ag = p.agenciaNome;
      if (ag) setAg.add(ag.trim());
    });

    solicitacoes.forEach((s) => {
      const ag = s.industriaAgencia || s.agencia || s.agenciaNome;
      if (ag) setAg.add(ag.trim());
    });

    return Array.from(setAg).sort((a, b) => a.localeCompare(b));
  }, [solicitacoes]);

  // Filtragem complementar por termo de busca (produto, código, ean)
  const solicitacoesFiltradas = useMemo(() => {
    if (!searchTerm.trim()) return solicitacoes;
    const q = searchTerm.trim().toLowerCase();
    return solicitacoes.filter((s) => {
      const desc = (s.descricao || '').toLowerCase();
      const cod = (s.codigoInterno || '').toLowerCase();
      const codComp = (s.codigoCompleto || '').toLowerCase();
      const ean = (s.ean || '').toLowerCase();
      const prom = (s.promotorNome || '').toLowerCase();
      const ag = (s.agencia || s.agenciaNome || s.industriaAgencia || '').toLowerCase();
      return (
        desc.includes(q) ||
        cod.includes(q) ||
        codComp.includes(q) ||
        ean.includes(q) ||
        prom.includes(q) ||
        ag.includes(q)
      );
    });
  }, [solicitacoes, searchTerm]);

  // Cálculo do Resumo do Mês (respeita todos os filtros aplicados)
  const resumoMes: ResumoHistoricoPromotor = useMemo(() => {
    return analisePromotorService.calcularResumo(solicitacoesFiltradas);
  }, [solicitacoesFiltradas]);

  // Nome do promotor selecionado para relatórios
  const promotorNomeSelecionado = useMemo(() => {
    if (filtros.promotorId === 'TODOS') return 'TODOS OS PROMOTORES';
    const found = listaPromotoresDisponiveis.find((p) => p.id === filtros.promotorId);
    return found ? found.nome : filtros.promotorId;
  }, [filtros.promotorId, listaPromotoresDisponiveis]);

  // Exportação em PDF
  const handleExportPDF = () => {
    setIsExporting(true);
    try {
      RelatorioPromotorService.gerarPDF({
        solicitacoes: solicitacoesFiltradas,
        filtros,
        resumo: resumoMes,
        filialId,
        filialNome: 'Cascavel',
        promotorNomeExibicao: promotorNomeSelecionado,
        industriaAgenciaExibicao: filtros.industriaAgencia === 'TODAS' ? 'TODAS AS INDÚSTRIAS / AGÊNCIAS' : filtros.industriaAgencia,
      });
      setIsExportModalOpen(false);
    } catch (err) {
      console.error('Erro ao gerar relatório PDF:', err);
    } finally {
      setIsExporting(false);
    }
  };

  // Exportação em Excel
  const handleExportExcel = () => {
    setIsExporting(true);
    try {
      RelatorioPromotorService.gerarExcel({
        solicitacoes: solicitacoesFiltradas,
        filtros,
        resumo: resumoMes,
        filialId,
        filialNome: 'Cascavel',
        promotorNomeExibicao: promotorNomeSelecionado,
        industriaAgenciaExibicao: filtros.industriaAgencia === 'TODAS' ? 'TODAS AS INDÚSTRIAS / AGÊNCIAS' : filtros.industriaAgencia,
      });
      setIsExportModalOpen(false);
    } catch (err) {
      console.error('Erro ao gerar relatório Excel:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* BARRA SUPERIOR DO HISTÓRICO MENSAL */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm sm:text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-700" />
              HISTÓRICO MENSAL DOS PROMOTORES
            </h2>
            <p className="text-xs text-slate-700 font-medium mt-0.5">
              Consulta de envios por mês, promotor e agência com emissão de relatórios
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-abrir-export-modal"
              onClick={() => setIsExportModalOpen(true)}
              className="py-2 px-3.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-xs transition-colors shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>GERAR RELATÓRIO</span>
            </button>
          </div>
        </div>

        {/* SEÇÃO DE FILTROS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-3">
          {/* 1. MÊS / ANO */}
          <div>
            <label className="text-[11px] font-bold text-slate-800 uppercase block mb-1">
              MÊS / ANO
            </label>
            <div className="relative">
              <select
                id="select-historico-mes-ano"
                value={filtros.mesAno}
                onChange={(e) => setFiltros((prev) => ({ ...prev, mesAno: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 py-2 pl-2.5 pr-7 focus:ring-2 focus:ring-blue-600 focus:outline-hidden appearance-none"
              >
                {listaMeses.map((m) => (
                  <option key={m.val} value={m.val}>
                    {m.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* 2. PROMOTOR */}
          <div>
            <label className="text-[11px] font-bold text-slate-800 uppercase block mb-1">
              PROMOTOR
            </label>
            <div className="relative">
              <select
                id="select-historico-promotor"
                value={filtros.promotorId}
                onChange={(e) => setFiltros((prev) => ({ ...prev, promotorId: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 py-2 pl-2.5 pr-7 focus:ring-2 focus:ring-blue-600 focus:outline-hidden appearance-none"
              >
                <option value="TODOS">TODOS OS PROMOTORES</option>
                {listaPromotoresDisponiveis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} {p.agencia ? `(${p.agencia})` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* 3. INDÚSTRIA / AGÊNCIA */}
          <div>
            <label className="text-[11px] font-bold text-slate-800 uppercase block mb-1">
              INDÚSTRIA / AGÊNCIA
            </label>
            <div className="relative">
              <select
                id="select-historico-agencia"
                value={filtros.industriaAgencia}
                onChange={(e) => setFiltros((prev) => ({ ...prev, industriaAgencia: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 py-2 pl-2.5 pr-7 focus:ring-2 focus:ring-blue-600 focus:outline-hidden appearance-none"
              >
                <option value="TODAS">TODAS AS INDÚSTRIAS / AGÊNCIAS</option>
                {listaAgenciasDisponiveis.map((ag) => (
                  <option key={ag} value={ag}>
                    {ag}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* 4. SETOR */}
          <div>
            <label className="text-[11px] font-bold text-slate-800 uppercase block mb-1">
              SETOR
            </label>
            <div className="relative">
              <select
                id="select-historico-setor"
                value={filtros.setor}
                onChange={(e) => setFiltros((prev) => ({ ...prev, setor: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 py-2 pl-2.5 pr-7 focus:ring-2 focus:ring-blue-600 focus:outline-hidden appearance-none"
              >
                <option value="TODOS">TODOS OS SETORES</option>
                <option value="FRIOS">FRIOS (RF.)</option>
                <option value="LOJA">LOJA</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* 5. STATUS */}
          <div>
            <label className="text-[11px] font-bold text-slate-800 uppercase block mb-1">
              STATUS
            </label>
            <div className="relative">
              <select
                id="select-historico-status"
                value={filtros.status}
                onChange={(e) => setFiltros((prev) => ({ ...prev, status: e.target.value as any }))}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 py-2 pl-2.5 pr-7 focus:ring-2 focus:ring-blue-600 focus:outline-hidden appearance-none"
              >
                <option value="TODOS">TODOS OS STATUS</option>
                <option value="PENDENTE">PENDENTE</option>
                <option value="APROVADO">APROVADO</option>
                <option value="RECUSADO">RECUSADO</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* BARRA DE PESQUISA RÁPIDA */}
        <div className="pt-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="input-historico-busca-produto"
              type="text"
              placeholder="Buscar por descrição, código SMG, EAN, promotor ou indústria..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 pl-9 pr-3 py-2 focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-800 text-xs font-bold"
              >
                LIMPAR
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CARDS RESUMO DO MÊS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {/* Total de Envios */}
        <div className="bg-white rounded-xl border border-slate-200 p-2.5 sm:p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
            TOTAL DE ENVIOS
          </span>
          <span className="text-xl font-black text-slate-900 mt-0.5 block">
            {resumoMes.totalEnvios}
          </span>
          <span className="text-[10px] text-slate-600 font-medium">no período filtrado</span>
        </div>

        {/* Aprovados */}
        <div className="bg-emerald-50/80 rounded-xl border border-emerald-200 p-2.5 sm:p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            APROVADOS
          </span>
          <span className="text-xl font-black text-emerald-900 mt-0.5 block">
            {resumoMes.aprovados}
          </span>
          <span className="text-[10px] text-emerald-700 font-medium">consolidados</span>
        </div>

        {/* Recusados */}
        <div className="bg-rose-50/80 rounded-xl border border-rose-200 p-2.5 sm:p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800 block flex items-center gap-1">
            <XCircle className="w-3 h-3 text-rose-600" />
            RECUSADOS
          </span>
          <span className="text-xl font-black text-rose-900 mt-0.5 block">
            {resumoMes.recusados}
          </span>
          <span className="text-[10px] text-rose-700 font-medium">com justificativa</span>
        </div>

        {/* Pendentes */}
        <div className="bg-amber-50/80 rounded-xl border border-amber-200 p-2.5 sm:p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-600" />
            PENDENTES
          </span>
          <span className="text-xl font-black text-amber-900 mt-0.5 block">
            {resumoMes.pendentes}
          </span>
          <span className="text-[10px] text-amber-700 font-medium">aguardando análise</span>
        </div>

        {/* Novos Vencimentos */}
        <div className="bg-blue-50/80 rounded-xl border border-blue-200 p-2.5 sm:p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 block">
            NOVOS VENCIMENTOS
          </span>
          <span className="text-xl font-black text-blue-900 mt-0.5 block">
            {resumoMes.novosVencimentos}
          </span>
          <span className="text-[10px] text-blue-700 font-medium">criados no controle</span>
        </div>

        {/* Atualizações de Quantidade */}
        <div className="bg-purple-50/80 rounded-xl border border-purple-200 p-2.5 sm:p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-800 block">
            ATUALIZAÇÕES QUANTIDADE
          </span>
          <span className="text-xl font-black text-purple-900 mt-0.5 block">
            {resumoMes.atualizacoesQuantidade}
          </span>
          <span className="text-[10px] text-purple-700 font-medium">estoque recontado</span>
        </div>
      </div>

      {/* LISTA DE ENVIOS DO MÊS */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <RefreshCw className="w-7 h-7 text-blue-600 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-700 font-bold">Consultando histórico no Firestore...</p>
        </div>
      ) : solicitacoesFiltradas.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <AlertCircle className="w-9 h-9 text-slate-600 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-800">Nenhum envio registrado para estes filtros</h3>
          <p className="text-xs text-slate-700 mt-1 max-w-md mx-auto">
            Não foram encontradas solicitações do promotor para o período{' '}
            <span className="font-bold">{RelatorioPromotorService.formatarPeriodoExtenso(filtros.mesAno)}</span> com os parâmetros selecionados.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-600 font-semibold px-1">
            <span>
              Exibindo <strong className="text-slate-900">{solicitacoesFiltradas.length}</strong> registro(s) em{' '}
              <strong>{RelatorioPromotorService.formatarPeriodoExtenso(filtros.mesAno)}</strong>
            </span>
            <span>Ordenado por data de envio (mais recentes primeiro)</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {solicitacoesFiltradas.map((solic) => {
              const codigoFormatado = solic.codigoCompleto || (solic.digito ? `${solic.codigoInterno}-${solic.digito}` : solic.codigoInterno);
              const eanFormatado = solic.ean || (solic.eans && solic.eans[0]);

              // Status badge config
              const isAprovado = solic.status === 'APROVADO';
              const isRecusado = solic.status === 'RECUSADO';
              const isPendente = solic.status === 'PENDENTE_ANALISE';

              // Resultado badge config
              const isAtualizacao = solic.resultadoAprovacao === 'QUANTIDADE_ATUALIZADA';
              const isNovo = solic.resultadoAprovacao === 'NOVO_VENCIMENTO';

              return (
                <div
                  key={solic.id}
                  className={`bg-white rounded-xl border transition-all p-3 sm:p-4 shadow-xs ${
                    isAprovado
                      ? 'border-slate-200 hover:border-emerald-300'
                      : isRecusado
                      ? 'border-rose-200 bg-rose-50/20'
                      : 'border-amber-200 bg-amber-50/20'
                  }`}
                >
                  {/* Linha 1: Status, Resultado, Data do Envio e Promotor */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Badge de Status */}
                      {isAprovado && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                          <CheckCircle2 className="w-3 h-3" />
                          APROVADO
                        </span>
                      )}
                      {isRecusado && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-300">
                          <XCircle className="w-3 h-3" />
                          RECUSADO
                        </span>
                      )}
                      {isPendente && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300">
                          <Clock className="w-3 h-3" />
                          PENDENTE
                        </span>
                      )}

                      {/* Badge de Resultado da Análise */}
                      {isAtualizacao && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-purple-100 text-purple-900 border border-purple-300">
                          ATUALIZAÇÃO DE QUANTIDADE
                        </span>
                      )}
                      {isNovo && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-blue-100 text-blue-900 border border-blue-300">
                          NOVO VENCIMENTO
                        </span>
                      )}

                      {/* Setor */}
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">
                        {solic.setor || (solic.descricao?.startsWith('RF.') ? 'SETOR FRIOS' : 'LOJA')}
                      </span>
                    </div>

                    {/* Data/Hora do Envio */}
                    <div className="text-[11px] text-slate-700 font-medium flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-600" />
                      <span>Enviado em: <strong>{RelatorioPromotorService.formatarDataHoraBR(solic.enviadoEm)}</strong></span>
                    </div>
                  </div>

                  {/* Linha 2: Produto e Informações Centrais */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 py-3 items-center">
                    {/* Descrição e Códigos */}
                    <div className="md:col-span-6">
                      <h4 className="text-sm font-black text-slate-900 leading-tight">
                        {solic.descricao}
                      </h4>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-sm">
                          {codigoFormatado}
                        </span>
                        {eanFormatado && (
                          <span className="font-mono text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-sm">
                            EAN: {eanFormatado}
                          </span>
                        )}
                        {solic.embalagem && (
                          <span className="text-[11px] text-slate-600 font-medium">
                            Emb: {solic.embalagem}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Validade */}
                    <div className="md:col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                      <span className="text-[9px] font-bold uppercase text-slate-600 block">
                        VALIDADE
                      </span>
                      <span className="text-xs font-black text-slate-900 font-mono">
                        {solic.dataVencimento ? formatarDataBR(solic.dataVencimento) : '-'}
                      </span>
                      {(() => {
                        if (!solic.dataVencimento) return null;
                        const diffMs = new Date(solic.dataVencimento + 'T12:00:00').getTime() - new Date().setHours(0, 0, 0, 0);
                        const dias = Math.round(diffMs / (1000 * 60 * 60 * 24));
                        const info = formatarDiasRestantes(dias);
                        return <span className={`text-[9px] block ${info.cor}`}>{info.texto}</span>;
                      })()}
                    </div>

                    {/* Bloco de Quantidades: Informada, Anterior, Aprovada */}
                    <div className="md:col-span-4 bg-slate-50 border border-slate-200 rounded-lg p-2">
                      <div className="grid grid-cols-3 gap-1 text-center divide-x divide-slate-200">
                        {/* Qtd Informada */}
                        <div>
                          <span className="text-[9px] font-bold uppercase text-slate-600 block">
                            INFORMADA
                          </span>
                          <span className="text-xs font-black text-blue-950">
                            {solic.quantidadeInformada} {solic.unidade_medida || 'UN'}
                          </span>
                          {solic.quantidadeTexto && (
                            <span className="text-[9px] text-slate-600 block truncate">
                              {solic.quantidadeTexto}
                            </span>
                          )}
                        </div>

                        {/* Qtd Anterior (quando for atualização) */}
                        <div>
                          <span className="text-[9px] font-bold uppercase text-slate-600 block">
                            ANTERIOR
                          </span>
                          <span className="text-xs font-bold text-slate-700">
                            {solic.quantidadeAnterior !== undefined
                              ? `${solic.quantidadeAnterior} ${solic.unidade_medida || 'UN'}`
                              : '-'}
                          </span>
                        </div>

                        {/* Qtd Aprovada */}
                        <div>
                          <span className="text-[9px] font-bold uppercase text-slate-600 block">
                            APROVADA
                          </span>
                          <span className={`text-xs font-black ${isAprovado ? 'text-emerald-700' : 'text-slate-600'}`}>
                            {isAprovado
                              ? `${solic.quantidadeAprovada ?? solic.quantidadeInformada} ${solic.unidade_medida || 'UN'}`
                              : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Linha 3: Identificação do Promotor e Resolução da Análise */}
                  <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                    {/* Identificação completa do Promotor */}
                    <div className="flex flex-wrap items-center gap-2 text-slate-700">
                      <span className="inline-flex items-center gap-1 font-bold text-slate-800">
                        <User className="w-3.5 h-3.5 text-blue-600" />
                        {solic.promotorNome}
                      </span>
                      {(solic.agencia || solic.agenciaNome || solic.industriaAgencia) && (
                        <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
                          <Building2 className="w-3 h-3 text-slate-600" />
                          {solic.agencia || solic.agenciaNome || solic.industriaAgencia}
                        </span>
                      )}
                      {solic.vinculoPromotorId && (
                        <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded-sm font-mono">
                          Vínculo: {solic.vinculoPromotorId}
                        </span>
                      )}
                    </div>

                    {/* Dados da Análise (Aprovado / Recusado) */}
                    {(solic.dataAnalise || solic.aprovadoEm || solic.recusadoEm) && (
                      <div className="text-[11px] text-slate-700 font-medium">
                        Analisado por{' '}
                        <strong className="text-slate-800">
                          {solic.analisadoPor || solic.aprovadoPor || solic.recusadoPor || 'Administrador'}
                        </strong>{' '}
                        em {RelatorioPromotorService.formatarDataHoraBR(solic.dataAnalise || solic.aprovadoEm || solic.recusadoEm)}
                      </div>
                    )}
                  </div>

                  {/* Se Recusado: Motivo da Recusa em Destaque */}
                  {isRecusado && solic.motivoRecusa && (
                    <div className="mt-2.5 p-2 bg-rose-100/60 border border-rose-200 rounded-lg text-xs text-rose-900 flex items-start gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold">Motivo da Recusa:</strong> {solic.motivoRecusa}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL DE EXPORTAÇÃO DE RELATÓRIO (PDF E EXCEL) */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    GERAR RELATÓRIO MENSAL
                  </h3>
                  <p className="text-[11px] text-slate-600">
                    Exportação sob demanda de envios do promotor
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsExportModalOpen(false)}
                className="text-slate-600 hover:text-slate-800 p-1"
              >
                ✕
              </button>
            </div>

            {/* Parâmetros do Relatório */}
            <div className="py-4 space-y-2 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-slate-700">
                <div className="flex justify-between">
                  <span className="font-medium text-slate-600">Período:</span>
                  <span className="font-bold text-slate-900">
                    {RelatorioPromotorService.formatarPeriodoExtenso(filtros.mesAno)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-slate-600">Promotor:</span>
                  <span className="font-bold text-slate-900">{promotorNomeSelecionado}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-slate-600">Indústria/Agência:</span>
                  <span className="font-bold text-slate-900">
                    {filtros.industriaAgencia === 'TODAS' ? 'TODAS AS AGÊNCIAS' : filtros.industriaAgencia}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-slate-600">Setor:</span>
                  <span className="font-bold text-slate-900">{filtros.setor}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-slate-600">Status:</span>
                  <span className="font-bold text-slate-900">{filtros.status}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200">
                  <span className="font-bold text-slate-800">Total de Registros:</span>
                  <span className="font-black text-blue-700">{solicitacoesFiltradas.length} produto(s)</span>
                </div>
              </div>
            </div>

            {/* Botões de Ação para Formatos */}
            <div className="space-y-2 pt-2">
              <button
                id="btn-baixar-pdf-promotor"
                onClick={handleExportPDF}
                disabled={isExporting}
                className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <FileText className="w-4 h-4" />
                <span>BAIXAR RELATÓRIO EM PDF (A4 PAISAGEM)</span>
              </button>

              <button
                id="btn-baixar-excel-promotor"
                onClick={handleExportExcel}
                disabled={isExporting}
                className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>BAIXAR PLANILHA EM EXCEL (.XLSX)</span>
              </button>

              <button
                onClick={() => setIsExportModalOpen(false)}
                className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors mt-1"
              >
                CANCELAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
