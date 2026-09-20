import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Filter,
  Layers,
  Package,
  RefreshCw,
  Search,
  Tag,
  User,
  X,
  XCircle
} from 'lucide-react';
import { analisePromotorService } from '../services/analisePromotorService';
import { formatarDataBR, formatarDiasRestantes } from '../services/projection';
import { productRepository } from '../services/productRepository';
import { LoteVencimento, SolicitacaoVencimentoPromotor } from '../types';
import { HistoricoMensalPromotorView } from './HistoricoMensalPromotorView';

interface AnalisePromotorViewProps {
  filialId?: string;
  onVencimentosAtualizados?: () => void;
  onNavigateToControle?: () => void;
}

export const AnalisePromotorView: React.FC<AnalisePromotorViewProps> = ({
  filialId = '172',
  onVencimentosAtualizados,
  onNavigateToControle,
}) => {
  // Navegação interna: Pendentes vs Histórico Mensal
  const [subAba, setSubAba] = useState<'PENDENTES' | 'HISTORICO_MENSAL'>('PENDENTES');

  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoVencimentoPromotor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Filtros
  const [setorFilter, setSetorFilter] = useState<'TODOS' | 'FRIOS' | 'LOJA'>('TODOS');
  const [promotorFilter, setPromotorFilter] = useState<string>('TODOS');
  const [searchTerm, setSearchTerm] = useState('');

  // Modais de Ação
  const [solicitacaoParaEditar, setSolicitacaoParaEditar] = useState<SolicitacaoVencimentoPromotor | null>(null);
  const [editCaixas, setEditCaixas] = useState<number>(0);
  const [editUnidades, setEditUnidades] = useState<number>(0);
  const [editTotalUnidades, setEditTotalUnidades] = useState<number>(0);

  const [solicitacaoParaRecusar, setSolicitacaoParaRecusar] = useState<SolicitacaoVencimentoPromotor | null>(null);
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [erroMotivo, setErroMotivo] = useState('');

  // 1. Assinar solicitações pendentes do Firestore em tempo real
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = analisePromotorService.subscribeSolicitacoesPendentes(
      filialId,
      (lista) => {
        setSolicitacoes(lista);
        setIsLoading(false);
      },
      () => {
        // Fallback se erro de rede
        analisePromotorService.getSolicitacoesPendentes(filialId).then((lista) => {
          setSolicitacoes(lista);
          setIsLoading(false);
        });
      }
    );

    return () => unsubscribe();
  }, [filialId]);

  // Lista única de promotores com solicitações
  const promotoresDisponiveis = useMemo(() => {
    const setP = new Set<string>();
    solicitacoes.forEach((s) => {
      if (s.promotorNome) setP.add(s.promotorNome);
    });
    return Array.from(setP);
  }, [solicitacoes]);

  // Filtragem da lista
  const filtradas = useMemo(() => {
    return solicitacoes.filter((s) => {
      // 1. Filtro Setor
      if (setorFilter !== 'TODOS') {
        const tipo = s.setorTipo || (s.descricao?.startsWith('RF.') ? 'FRIOS' : 'LOJA');
        if (tipo !== setorFilter) return false;
      }

      // 2. Filtro Promotor
      if (promotorFilter !== 'TODOS') {
        if (s.promotorNome !== promotorFilter) return false;
      }

      // 3. Busca textual
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const descMatch = (s.descricao || '').toLowerCase().includes(q);
        const codMatch = (s.codigoCompleto || s.codigoInterno || '').toLowerCase().includes(q);
        const eanMatch = (s.ean || '').toLowerCase().includes(q);
        const promMatch = (s.promotorNome || '').toLowerCase().includes(q);
        const agMatch = (s.agencia || '').toLowerCase().includes(q);
        if (!descMatch && !codMatch && !eanMatch && !promMatch && !agMatch) return false;
      }

      return true;
    });
  }, [solicitacoes, setorFilter, promotorFilter, searchTerm]);

  // Toast automático desaparece em 4 segundos
  useEffect(() => {
    if (feedbackMsg) {
      const timer = setTimeout(() => setFeedbackMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [feedbackMsg]);

  // APROVAR DIRETO
  const handleAprovar = async (solic: SolicitacaoVencimentoPromotor) => {
    setProcessingId(solic.id);
    try {
      const res = await analisePromotorService.aprovarSolicitacao({
        solicitacaoId: solic.id,
        aprovadoPor: 'Administrador / Loja',
      });

      setFeedbackMsg({
        tipo: 'sucesso',
        texto: res.message,
      });

      onVencimentosAtualizados?.();
    } catch (err: any) {
      setFeedbackMsg({
        tipo: 'erro',
        texto: err?.message || 'Erro ao aprovar solicitação.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  // ABRIR MODAL EDITAR E APROVAR
  const handleAbrirEditar = (solic: SolicitacaoVencimentoPromotor) => {
    setSolicitacaoParaEditar(solic);
    const fator = Number(solic.fator_embalagem || 1);
    const total = Number(solic.quantidadeInformada || 0);

    if (fator > 1) {
      const cx = Math.floor(total / fator);
      const un = total % fator;
      setEditCaixas(cx);
      setEditUnidades(un);
      setEditTotalUnidades(total);
    } else {
      setEditCaixas(0);
      setEditUnidades(total);
      setEditTotalUnidades(total);
    }
  };

  const handleUpdateEditCaixas = (val: number) => {
    const cx = Math.max(0, val);
    setEditCaixas(cx);
    const fator = Number(solicitacaoParaEditar?.fator_embalagem || 1);
    const total = cx * fator + editUnidades;
    setEditTotalUnidades(total);
  };

  const handleUpdateEditUnidades = (val: number) => {
    const un = Math.max(0, val);
    setEditUnidades(un);
    const fator = Number(solicitacaoParaEditar?.fator_embalagem || 1);
    const total = editCaixas * fator + un;
    setEditTotalUnidades(total);
  };

  const handleSalvarEdicaoEAprovar = async () => {
    if (!solicitacaoParaEditar) return;
    if (editTotalUnidades <= 0) {
      alert('A quantidade total deve ser maior que zero.');
      return;
    }

    setProcessingId(solicitacaoParaEditar.id);
    try {
      const res = await analisePromotorService.aprovarSolicitacao({
        solicitacaoId: solicitacaoParaEditar.id,
        quantidadeAprovada: editTotalUnidades,
        aprovadoPor: 'Administrador / Loja',
      });

      setFeedbackMsg({
        tipo: 'sucesso',
        texto: `Aprovado com ajuste: ${res.message}`,
      });

      setSolicitacaoParaEditar(null);
      onVencimentosAtualizados?.();
    } catch (err: any) {
      setFeedbackMsg({
        tipo: 'erro',
        texto: err?.message || 'Erro ao aprovar com edição.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  // ABRIR MODAL RECUSAR
  const handleAbrirRecusar = (solic: SolicitacaoVencimentoPromotor) => {
    setSolicitacaoParaRecusar(solic);
    setMotivoRecusa('');
    setErroMotivo('');
  };

  const handleConfirmarRecusa = async () => {
    if (!solicitacaoParaRecusar) return;
    const motivo = motivoRecusa.trim();
    if (!motivo) {
      setErroMotivo('Por favor, informe o motivo da recusa.');
      return;
    }

    setProcessingId(solicitacaoParaRecusar.id);
    try {
      await analisePromotorService.recusarSolicitacao({
        solicitacaoId: solicitacaoParaRecusar.id,
        motivoRecusa: motivo,
        recusadoPor: 'Administrador / Loja',
      });

      setFeedbackMsg({
        tipo: 'sucesso',
        texto: 'Solicitação recusada com sucesso. O promotor receberá o status no aplicativo.',
      });

      setSolicitacaoParaRecusar(null);
    } catch (err: any) {
      setFeedbackMsg({
        tipo: 'erro',
        texto: err?.message || 'Erro ao recusar solicitação.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div id="view-analise-promotor" className="space-y-4">
      {/* NAVEGAÇÃO DE SUB-ABAS: PENDENTES vs HISTÓRICO MENSAL */}
      <div className="bg-white rounded-2xl border border-gray-200 p-1.5 shadow-xs flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <button
            id="subaba-solicitacoes-pendentes"
            onClick={() => setSubAba('PENDENTES')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
              subAba === 'PENDENTES'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-transparent text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>SOLICITAÇÕES PENDENTES</span>
            {solicitacoes.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  subAba === 'PENDENTES' ? 'bg-white text-blue-700' : 'bg-blue-100 text-blue-700'
                }`}
              >
                {solicitacoes.length}
              </span>
            )}
          </button>

          <button
            id="subaba-historico-mensal"
            onClick={() => setSubAba('HISTORICO_MENSAL')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
              subAba === 'HISTORICO_MENSAL'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-transparent text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>HISTÓRICO MENSAL</span>
          </button>
        </div>
      </div>

      {subAba === 'HISTORICO_MENSAL' ? (
        <HistoricoMensalPromotorView filialId={filialId} />
      ) : (
        <>
          {/* MENSAGEM TOAST FEEDBACK */}
          {feedbackMsg && (
            <div
              className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-bold transition-all shadow-md ${
                feedbackMsg.tipo === 'sucesso'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                  : 'bg-rose-50 text-rose-900 border-rose-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {feedbackMsg.tipo === 'sucesso' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                )}
                <span>{feedbackMsg.texto}</span>
              </div>
              <button
                onClick={() => setFeedbackMsg(null)}
                className="text-gray-500 hover:text-gray-800 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* PAINEL DE FILTROS E BUSCA */}
      <div className="bg-white rounded-2xl border border-gray-200 p-3.5 sm:p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Pílulas de Setor */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <span className="text-[11px] font-black uppercase text-gray-400 mr-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" />
              Setor:
            </span>
            {(['TODOS', 'FRIOS', 'LOJA'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setSetorFilter(st)}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                  setorFilter === st
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Seletor de Promotor */}
          {promotoresDisponiveis.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-black uppercase text-gray-400 flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                Promotor:
              </span>
              <select
                value={promotorFilter}
                onChange={(e) => setPromotorFilter(e.target.value)}
                className="text-xs font-bold bg-gray-50 border border-gray-300 rounded-xl px-2.5 py-1.5 text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="TODOS">Todos os Promotores</option>
                {promotoresDisponiveis.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Campo de Busca */}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por descrição, código ou EAN..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900 placeholder:text-gray-400 font-medium"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ESTADO DE CARREGAMENTO */}
      {isLoading && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center space-y-2">
          <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
          <p className="text-xs text-gray-500 font-bold">Buscando solicitações do App Promotor...</p>
        </div>
      )}

      {/* ESTADO VAZIO */}
      {!isLoading && filtradas.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">
              Nenhuma solicitação pendente
            </h3>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              Todas as contagens enviadas pelos promotores de vendas foram analisadas e processadas para a filial {filialId}.
            </p>
          </div>
          {onNavigateToControle && (
            <button
              onClick={onNavigateToControle}
              className="px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5"
            >
              <Calendar className="w-4 h-4" />
              <span>Ver Controle de Vencimentos</span>
            </button>
          )}
        </div>
      )}

      {/* LISTA DE CARDS DAS SOLICITAÇÕES */}
      {!isLoading && filtradas.length > 0 && (
        <div className="space-y-3">
          {filtradas.map((solic) => {
            // Checar se já existe vencimento com mesma filialId + codigoInterno + digito + dataVencimento
            const check = analisePromotorService.verificarVencimentoExistente(
              solic.filialId,
              solic.codigoInterno,
              solic.digito,
              solic.dataVencimento
            );

            const isExisting = check.existe && check.loteExistente;
            const loteExistente = check.loteExistente;
            const qtdeExistente = Number(loteExistente?.quantidade_total_unidades ?? loteExistente?.quantidade ?? 0);
            const isProcessing = processingId === solic.id;

            return (
              <div
                key={solic.id}
                id={`card-solicitacao-${solic.id}`}
                className="bg-white rounded-2xl border border-gray-200 shadow-xs hover:border-blue-300 transition-all overflow-hidden"
              >
                {/* TOPO: STATUS, PROMOTOR E ENVIO */}
                <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-700 animate-pulse" />
                      Pendente de Análise
                    </span>

                    {solic.setorTipo && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                          solic.setorTipo === 'FRIOS'
                            ? 'bg-cyan-100 text-cyan-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {solic.setorTipo}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-gray-500 font-medium text-[11px]">
                    <div className="flex items-center gap-1 font-bold text-gray-700">
                      <User className="w-3.5 h-3.5 text-blue-600" />
                      <span>{solic.promotorNome}</span>
                      {solic.agencia && (
                        <span className="text-gray-400 font-normal">({solic.agencia})</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 text-gray-400">
                      <Clock className="w-3 h-3" />
                      <span>
                        {new Date(solic.enviadoEm).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* CORPO: DADOS DO PRODUTO E QUANTIDADE INFORMADA */}
                <div className="p-4 space-y-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                    <div className="space-y-1">
                      <h4 className="text-sm font-black text-gray-900 leading-snug">
                        {solic.descricao}
                      </h4>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span className="font-mono font-bold bg-gray-100 px-2 py-0.5 rounded-md text-gray-800">
                          Cód: {solic.codigoCompleto || `${solic.codigoInterno}-${solic.digito}`}
                        </span>

                        {solic.ean && (
                          <span className="font-mono text-gray-600 text-[11px] bg-gray-50 px-2 py-0.5 rounded-md border border-gray-200">
                            EAN: {solic.ean}
                          </span>
                        )}

                        {solic.embalagem && (
                          <span className="text-gray-500 text-[11px] flex items-center gap-1">
                            <Package className="w-3 h-3 text-gray-400" />
                            {solic.embalagem}
                          </span>
                        )}

                        {solic.precoNormal !== undefined && solic.precoNormal !== null && (
                          <span className="font-mono text-emerald-800 text-[11px] bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 font-bold">
                            Preço DE: R$ {Number(solic.precoNormal).toFixed(2).replace('.', ',')}
                          </span>
                        )}
                      </div>
                      {solic.setor && (
                        <p className="text-[11px] text-gray-400 font-medium">
                          Setor: {solic.setor}
                        </p>
                      )}
                    </div>

                    {/* VALIDADE */}
                    <div className="sm:text-right shrink-0 bg-blue-50/70 border border-blue-200/80 rounded-xl px-3 py-2">
                      <span className="text-[10px] font-black uppercase text-blue-600 tracking-wider block">
                        Data de Validade
                      </span>
                      <span className={`text-sm font-black font-mono ${solic.isDataValida ? 'text-blue-900' : 'text-rose-600'}`}>
                        {solic.isDataValida ? formatarDataBR(solic.dataValidade || solic.dataVencimento) : 'DATA NÃO INFORMADA'}
                      </span>
                      {(() => {
                        if (!solic.isDataValida || !solic.dataVencimento) {
                          return (
                            <span className="text-[10px] block text-rose-600 font-bold">
                              Inválida / Ausente
                            </span>
                          );
                        }
                        const diffMs = new Date(solic.dataVencimento + 'T12:00:00').getTime() - new Date().setHours(0, 0, 0, 0);
                        const dias = Math.round(diffMs / (1000 * 60 * 60 * 24));
                        if (isNaN(dias)) {
                          return (
                            <span className="text-[10px] block text-rose-600 font-bold">
                              Data Inválida
                            </span>
                          );
                        }
                        const info = formatarDiasRestantes(dias);
                        return (
                          <span className={`text-[10px] block ${info.cor}`}>
                            {info.texto}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* SINALIZAÇÃO DE ENVIO DUPLICADO (REQUISITO 9) */}
                  {solic.isDuplicada && (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2 text-xs text-amber-950">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Aviso: Envio Duplicado Detectado</p>
                        <p className="text-[11px] text-amber-900">
                          Este promotor enviou outra contagem para este mesmo produto e validade. As contagens estão listadas separadamente para análise da liderança.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* AVISO DE INCONSISTÊNCIAS COM BLOQUEIO DE APROVAÇÃO (REQUISITO 8) */}
                  {solic.inconsistencias && solic.inconsistencias.length > 0 && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-1 text-xs text-rose-950">
                      <div className="flex items-center gap-1.5 font-black uppercase tracking-wide text-rose-700">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>DADOS DA SOLICITAÇÃO INCONSISTENTES</span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-rose-800 font-medium pl-1">
                        {solic.inconsistencias.map((inc, i) => (
                          <li key={i}>{inc}</li>
                        ))}
                      </ul>
                      <p className="text-[10px] text-rose-600 font-semibold italic pt-0.5">
                        * Aprovação direta bloqueada. Corrija os dados via "Editar e Aprovar" ou recuse a solicitação.
                      </p>
                    </div>
                  )}

                  {/* QUANTIDADE INFORMADA PELO PROMOTOR */}
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider block">
                        Quantidade Informada pelo Promotor
                      </span>
                      <p className="text-sm font-black text-amber-950 mt-0.5">
                        {solic.quantidadeTexto || `${solic.quantidadeTotalUnidades ?? solic.quantidadeInformada} UN`}
                      </p>
                      {solic.fator_embalagem && solic.fator_embalagem > 1 && (
                        <span className="text-[11px] text-amber-800/80 font-medium block">
                          Fator SMGOI013: {solic.fator_embalagem} UN / {solic.embalagem || 'CX'}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-mono font-bold text-amber-900 bg-amber-100/80 px-2.5 py-1 rounded-lg border border-amber-300 block">
                        Total: {solic.quantidadeTotalUnidades ?? solic.quantidadeInformada} UN
                      </span>
                    </div>
                  </div>

                  {/* AVISO CRÍTICO DE VENCIMENTO JÁ CADASTRADO (REQUISITO 7 E 8) */}
                  {isExisting ? (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-1.5 text-xs text-orange-900">
                      <div className="flex items-center gap-1.5 font-black uppercase tracking-wide text-orange-800">
                        <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0" />
                        <span>Vencimento já cadastrado no controle</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-medium text-[11px]">
                        <div className="bg-white/80 p-2 rounded-lg border border-orange-200">
                          <span className="text-gray-500 block text-[10px] uppercase font-bold">Controle atual:</span>
                          <span className="font-mono font-black text-gray-800 text-xs">{qtdeExistente} UN</span>
                        </div>
                        <div className="bg-white/80 p-2 rounded-lg border border-orange-200">
                          <span className="text-gray-500 block text-[10px] uppercase font-bold">Promotor informou:</span>
                          <span className="font-mono font-black text-amber-900 text-xs">{solic.quantidadeTotalUnidades ?? solic.quantidadeInformada} UN</span>
                        </div>
                        <div className="bg-orange-100/80 p-2 rounded-lg border border-orange-300">
                          <span className="text-orange-800 block text-[10px] uppercase font-black">Após aprovação:</span>
                          <span className="font-mono font-black text-orange-950 text-xs">{solic.quantidadeTotalUnidades ?? solic.quantidadeInformada} UN</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-orange-700 font-medium italic">
                        * A nova quantidade representa uma nova contagem e substituirá o saldo a vencer, sem somar nem criar duplicidade.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-2.5 flex items-center gap-2 text-xs text-blue-900">
                      <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                      <span>
                        <strong>Novo vencimento:</strong> Será inserido oficialmente no Controle de Vencimentos com <strong>{solic.quantidadeTotalUnidades ?? solic.quantidadeInformada} UN</strong>.
                      </span>
                    </div>
                  )}

                  {/* BARRA DE AÇÕES: [ RECUSAR ] [ EDITAR E APROVAR ] [ APROVAR / ATUALIZAR ] */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleAbrirRecusar(solic)}
                      className="px-3 py-2 bg-white text-rose-700 hover:bg-rose-50 active:bg-rose-100 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Recusar</span>
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleAbrirEditar(solic)}
                      className="px-3.5 py-2 bg-gray-100 text-gray-800 hover:bg-gray-200 active:bg-gray-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <Edit3 className="w-4 h-4 text-gray-600" />
                      <span>Editar e Aprovar</span>
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing || Boolean(solic.inconsistencias && solic.inconsistencias.length > 0)}
                      onClick={() => handleAprovar(solic)}
                      title={
                        solic.inconsistencias && solic.inconsistencias.length > 0
                          ? 'Aprovação bloqueada por inconsistência nos dados'
                          : undefined
                      }
                      className={`px-4 py-2 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                        isExisting
                          ? 'bg-orange-600 hover:bg-orange-700 active:bg-orange-800'
                          : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
                      }`}
                    >
                      {isProcessing ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4 stroke-[3]" />
                      )}
                      <span>{isExisting ? 'Atualizar Quantidade' : 'Aprovar'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL: EDITAR E APROVAR */}
      {solicitacaoParaEditar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl border border-gray-100">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">
                  Editar Quantidade e Aprovar
                </h3>
              </div>
              <button
                onClick={() => setSolicitacaoParaEditar(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1 bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs">
              <p className="font-bold text-gray-800 leading-tight">
                {solicitacaoParaEditar.descricao}
              </p>
              <p className="text-gray-500 font-mono text-[11px]">
                Cód: {solicitacaoParaEditar.codigoCompleto || solicitacaoParaEditar.codigoInterno} • Validade: {formatarDataBR(solicitacaoParaEditar.dataVencimento)}
              </p>
              <p className="text-amber-800 font-medium text-[11px] pt-1">
                Informado pelo Promotor: <strong>{solicitacaoParaEditar.quantidadeInformada} UN</strong>
                {solicitacaoParaEditar.quantidadeTexto ? ` (${solicitacaoParaEditar.quantidadeTexto})` : ''}
              </p>
            </div>

            {/* CAMPOS DE EDIÇÃO */}
            <div className="space-y-3">
              {Number(solicitacaoParaEditar.fator_embalagem || 1) > 1 ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-black uppercase text-gray-500 block mb-1">
                      Caixas (Emb: {solicitacaoParaEditar.fator_embalagem})
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editCaixas}
                      onChange={(e) => handleUpdateEditCaixas(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-sm font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-black uppercase text-gray-500 block mb-1">
                      Unidades Avulsas
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editUnidades}
                      onChange={(e) => handleUpdateEditUnidades(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-sm font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <label className="text-[11px] font-black uppercase text-gray-500 block mb-1">
                  Quantidade Total Aprovada (Unidades)
                </label>
                <input
                  type="number"
                  min="1"
                  value={editTotalUnidades}
                  onChange={(e) => {
                    const val = Math.max(0, Number(e.target.value));
                    setEditTotalUnidades(val);
                    const fator = Number(solicitacaoParaEditar.fator_embalagem || 1);
                    if (fator > 1) {
                      setEditCaixas(Math.floor(val / fator));
                      setEditUnidades(val % fator);
                    } else {
                      setEditUnidades(val);
                    }
                  }}
                  className="w-full px-3 py-2 bg-blue-50/50 border-2 border-blue-400 rounded-xl text-base font-black text-blue-900 font-mono focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="p-2.5 bg-gray-50 rounded-xl text-[11px] text-gray-500 font-medium">
                Esta quantidade substituirá o valor informado pelo promotor e será registrada na auditoria.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setSolicitacaoParaEditar(null)}
                className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={processingId === solicitacaoParaEditar.id}
                onClick={handleSalvarEdicaoEAprovar}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-sm"
              >
                {processingId === solicitacaoParaEditar.id ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 stroke-[3]" />
                )}
                <span>Aprovar com {editTotalUnidades} UN</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RECUSAR SOLICITAÇÃO (MOTIVO OBRIGATÓRIO) */}
      {solicitacaoParaRecusar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl border border-gray-100">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-600" />
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">
                  Recusar Solicitação
                </h3>
              </div>
              <button
                onClick={() => setSolicitacaoParaRecusar(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1 bg-rose-50/60 p-3 rounded-xl border border-rose-200 text-xs text-rose-900">
              <p className="font-bold leading-tight">
                {solicitacaoParaRecusar.descricao}
              </p>
              <p className="text-rose-700 text-[11px]">
                Promotor: <strong>{solicitacaoParaRecusar.promotorNome}</strong> • Validade: {formatarDataBR(solicitacaoParaRecusar.dataVencimento)} • Qtde: {solicitacaoParaRecusar.quantidadeInformada} UN
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 block">
                Motivo da Recusa <span className="text-rose-600">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Informe o motivo da recusa (ex: mercadoria não localizada no estoque físico, data divergente do lote, produto avariado descartado...)"
                value={motivoRecusa}
                onChange={(e) => {
                  setMotivoRecusa(e.target.value);
                  if (e.target.value.trim()) setErroMotivo('');
                }}
                className={`w-full p-2.5 bg-gray-50 border rounded-xl text-xs font-medium focus:bg-white focus:ring-2 outline-none ${
                  erroMotivo
                    ? 'border-rose-300 focus:ring-rose-500'
                    : 'border-gray-300 focus:ring-blue-500'
                }`}
              />
              {erroMotivo && (
                <p className="text-[11px] text-rose-600 font-bold">{erroMotivo}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setSolicitacaoParaRecusar(null)}
                className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={processingId === solicitacaoParaRecusar.id}
                onClick={handleConfirmarRecusa}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {processingId === solicitacaoParaRecusar.id ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4 stroke-[2.5]" />
                )}
                <span>Confirmar Recusa</span>
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
