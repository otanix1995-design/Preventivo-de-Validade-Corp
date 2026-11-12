import {
  AlertCircle,
  ArrowRightLeft,
  Building2,
  Check,
  CheckCircle2,
  Edit2,
  History,
  Plus,
  Search,
  Unlink,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { normalizarChaveAgencia } from '../../services/agenciaNormalizer';
import { isvService } from '../../services/isvService';
import { promotorService } from '../../services/promotorService';
import {
  AgenciaComercial,
  HistoricoMovimentacaoComercial,
  Promotor,
} from '../../types';
import { SubstituirPromotorModal } from './SubstituirPromotorModal';

interface AgenciasTabProps {
  onAbrirCadastroPromotorParaAgencia: (agenciaId: string) => void;
}

export const AgenciasTab: React.FC<AgenciasTabProps> = ({
  onAbrirCadastroPromotorParaAgencia,
}) => {
  const [agencias, setAgencias] = useState<AgenciaComercial[]>([]);
  const [promotores, setPromotores] = useState<Promotor[]>([]);
  const [historico, setHistorico] = useState<HistoricoMovimentacaoComercial[]>([]);
  const [vinculosInd, setVinculosInd] = useState(isvService.getVinculosPromotorIndustria());

  const [busca, setBusca] = useState('');
  const [filtroAtividade, setFiltroAtividade] = useState<'TODAS' | 'COM_ATIVOS' | 'SEM_PROMOTORES'>('TODAS');
  const [agenciaSelecionadaId, setAgenciaSelecionadaId] = useState<string>('');
  const [feedback, setFeedback] = useState<{ tipo: 'success' | 'error'; msg: string } | null>(null);

  // Modal Criar / Editar Agência
  const [isFormAgenciaOpen, setIsFormAgenciaOpen] = useState(false);
  const [editandoAgencia, setEditandoAgencia] = useState<AgenciaComercial | null>(null);
  const [formNome, setFormNome] = useState('');
  const [formCnpj, setFormCnpj] = useState('');
  const [formContato, setFormContato] = useState('');
  const [formTelefone, setFormTelefone] = useState('');
  const [formObs, setFormObs] = useState('');
  const [formErro, setFormErro] = useState<string | null>(null);
  const [isSavingAgencia, setIsSavingAgencia] = useState(false);

  // Ações inline por promotor dentro da agência
  const [promotorTransferindoId, setPromotorTransferindoId] = useState<string | null>(null);
  const [destinoTransferenciaId, setDestinoTransferenciaId] = useState<string>('');
  const [motivoTransferencia, setMotivoTransferencia] = useState('');

  const [promotorDesvinculandoId, setPromotorDesvinculandoId] = useState<string | null>(null);
  const [inativarAoDesvincular, setInativarAoDesvincular] = useState(false);
  const [motivoDesvinculo, setMotivoDesvinculo] = useState('');

  // Vincular promotor existente à agência selecionada
  const [isVincularExistenteOpen, setIsVincularExistenteOpen] = useState(false);
  const [promotorParaVincularId, setPromotorParaVincularId] = useState('');

  // Modal de substituição
  const [promotorSubstituir, setPromotorSubstituir] = useState<Promotor | null>(null);

  const carregar = () => {
    const ags = promotorService.getAgencias();
    setAgencias(ags);
    setPromotores(promotorService.getPromotores());
    setHistorico(promotorService.getHistoricoMovimentacoes());
    setVinculosInd(isvService.getVinculosPromotorIndustria());
    setAgenciaSelecionadaId((prev) => {
      if (prev && ags.some((a) => a.agenciaId === prev)) return prev;
      return ags[0]?.agenciaId || '';
    });
  };

  useEffect(() => {
    carregar();
    const u1 = promotorService.subscribe(carregar);
    const u2 = isvService.subscribe(carregar);
    return () => {
      u1();
      u2();
    };
  }, []);

  const showFeedback = (tipo: 'success' | 'error', msg: string) => {
    setFeedback({ tipo, msg });
    setTimeout(() => setFeedback(null), 4500);
  };

  // Enriquecer agências com contagens ao vivo
  const agenciasComResumo = useMemo(() => {
    return agencias.map((ag) => {
      const proms = promotorService.getPromotoresPorAgencia(ag.agenciaId);
      const ativos = proms.filter((p) => p.status === 'ATIVO').length;
      const pendentes = proms.filter((p) => p.status === 'PENDENTE_VINCULO').length;
      const inativos = proms.filter((p) => p.status === 'INATIVO' || p.status === 'BLOQUEADO').length;
      const promIds = new Set(proms.map((p) => p.promotorId));
      const cnpjs = new Set(vinculosInd.filter((v) => promIds.has(v.promotorId)).map((v) => v.cnpj));
      return {
        agencia: ag,
        promotores: proms,
        totalPromotores: proms.length,
        ativos,
        pendentes,
        inativos,
        totalIndustrias: cnpjs.size,
      };
    });
  }, [agencias, promotores, vinculosInd]);

  const agenciasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return agenciasComResumo.filter((item) => {
      if (filtroAtividade === 'COM_ATIVOS' && item.ativos === 0) return false;
      if (filtroAtividade === 'SEM_PROMOTORES' && item.totalPromotores > 0) return false;
      if (!q) return true;
      return (
        item.agencia.nome.toLowerCase().includes(q) ||
        (item.agencia.contato || '').toLowerCase().includes(q) ||
        (item.agencia.cnpj || '').toLowerCase().includes(q) ||
        item.promotores.some((p) => p.nome.toLowerCase().includes(q))
      );
    });
  }, [agenciasComResumo, busca, filtroAtividade]);

  const agenciaSelecionadaResumo = useMemo(() => {
    return agenciasComResumo.find((item) => item.agencia.agenciaId === agenciaSelecionadaId) || null;
  }, [agenciasComResumo, agenciaSelecionadaId]);

  const promotoresSemAgencia = useMemo(() => {
    return promotores.filter((p) => !p.agenciaNome || !p.agenciaNome.trim());
  }, [promotores]);

  const duplicataNomePreview = useMemo(() => {
    if (!formNome.trim()) return null;
    const chave = normalizarChaveAgencia(formNome);
    if (!chave) return null;
    return agencias.find(
      (a) =>
        a.agenciaId !== editandoAgencia?.agenciaId &&
        normalizarChaveAgencia(a.nome) === chave
    ) || null;
  }, [formNome, agencias, editandoAgencia]);

  const abrirNovaAgencia = () => {
    setEditandoAgencia(null);
    setFormNome('');
    setFormCnpj('');
    setFormContato('');
    setFormTelefone('');
    setFormObs('');
    setFormErro(null);
    setIsFormAgenciaOpen(true);
  };

  const abrirEditarAgencia = (ag: AgenciaComercial) => {
    setEditandoAgencia(ag);
    setFormNome(ag.nome);
    setFormCnpj(ag.cnpj || '');
    setFormContato(ag.contato || '');
    setFormTelefone(ag.telefone || '');
    setFormObs(ag.observacoes || '');
    setFormErro(null);
    setIsFormAgenciaOpen(true);
  };

  const handleSalvarAgencia = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErro(null);
    if (!formNome.trim()) {
      setFormErro('Informe o nome da agência.');
      return;
    }

    setIsSavingAgencia(true);
    try {
      if (editandoAgencia) {
        const atualizada = await promotorService.atualizarAgencia(editandoAgencia.agenciaId, {
          nome: formNome,
          cnpj: formCnpj,
          contato: formContato,
          telefone: formTelefone,
          observacoes: formObs,
        });
        for (const p of promotorService.getPromotoresPorAgencia(atualizada.agenciaId)) {
          await isvService.sincronizarPromotorNosVinculos(p);
        }
        showFeedback('success', `Agência "${atualizada.nome}" atualizada com sucesso.`);
        setAgenciaSelecionadaId(atualizada.agenciaId);
      } else {
        const criada = await promotorService.cadastrarAgencia({
          nome: formNome,
          cnpj: formCnpj,
          contato: formContato,
          telefone: formTelefone,
          observacoes: formObs,
        });
        showFeedback('success', `Agência "${criada.nome}" cadastrada com sucesso.`);
        setAgenciaSelecionadaId(criada.agenciaId);
      }
      setIsFormAgenciaOpen(false);
    } catch (err: any) {
      setFormErro(err?.message || 'Erro ao salvar agência.');
    } finally {
      setIsSavingAgencia(false);
    }
  };

  const handleConfirmarTransferenciaAgencia = async (promotor: Promotor) => {
    if (!destinoTransferenciaId) return;
    try {
      const atualizado = await promotorService.vincularOuTransferirPromotorAgencia(
        promotor.promotorId,
        destinoTransferenciaId,
        motivoTransferencia
      );
      await isvService.sincronizarPromotorNosVinculos(atualizado);
      setPromotorTransferindoId(null);
      setDestinoTransferenciaId('');
      setMotivoTransferencia('');
      showFeedback('success', `${atualizado.nome} transferido para "${atualizado.agenciaNome}".`);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao transferir promotor.');
    }
  };

  const handleConfirmarDesvincularAgencia = async (promotor: Promotor) => {
    try {
      const atualizado = await promotorService.desvincularPromotorDaAgencia(promotor.promotorId, {
        motivo: motivoDesvinculo,
        inativarPromotor: inativarAoDesvincular,
      });
      await isvService.sincronizarPromotorNosVinculos(atualizado);
      setPromotorDesvinculandoId(null);
      setMotivoDesvinculo('');
      setInativarAoDesvincular(false);
      showFeedback(
        'success',
        `${atualizado.nome} desvinculado da agência${inativarAoDesvincular ? ' e marcado como INATIVO' : ''}.`
      );
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao desvincular promotor da agência.');
    }
  };

  const handleToggleInativar = async (promotor: Promotor) => {
    try {
      if (promotor.status === 'INATIVO') {
        const reativado = await promotorService.reativarPromotor(promotor.promotorId);
        await isvService.sincronizarPromotorNosVinculos(reativado);
        showFeedback('success', `Promotor ${reativado.nome} reativado (${reativado.status}).`);
      } else {
        const inativado = await promotorService.inativarPromotor(promotor.promotorId);
        await isvService.sincronizarPromotorNosVinculos(inativado);
        showFeedback('success', `Promotor ${inativado.nome} marcado como INATIVO (histórico preservado).`);
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao alterar situação do promotor.');
    }
  };

  const handleVincularPromotorExistenteNaAgencia = async () => {
    if (!agenciaSelecionadaResumo || !promotorParaVincularId) return;
    try {
      const atualizado = await promotorService.vincularOuTransferirPromotorAgencia(
        promotorParaVincularId,
        agenciaSelecionadaResumo.agencia.agenciaId,
        'Vínculo direto no módulo Agências'
      );
      await isvService.sincronizarPromotorNosVinculos(atualizado);
      setIsVincularExistenteOpen(false);
      setPromotorParaVincularId('');
      showFeedback(
        'success',
        `${atualizado.nome} vinculado à agência "${agenciaSelecionadaResumo.agencia.nome}".`
      );
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao vincular promotor.');
    }
  };

  const historicoDaAgencia = useMemo(() => {
    if (!agenciaSelecionadaResumo) return historico.slice(0, 15);
    const filtrado = promotorService.getHistoricoMovimentacoes({
      agenciaId: agenciaSelecionadaResumo.agencia.agenciaId,
    });
    return filtrado.slice(0, 15);
  }, [agenciaSelecionadaResumo, historico]);

  const totalAtivosGeral = useMemo(
    () => promotores.filter((p) => p.status === 'ATIVO').length,
    [promotores]
  );

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
            feedback.tipo === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-rose-50 border-rose-300 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.tipo === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.msg}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Cabeçalho e KPIs */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-700 stroke-[2.5]" />
            <h2 className="text-sm font-black uppercase text-slate-900 tracking-tight">
              Cadastro Independente de Agências
            </h2>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            {agencias.length} agências cadastradas ·{' '}
            <span className="font-mono tabular-nums font-bold text-slate-700">{totalAtivosGeral}</span> promotores ativos
            {promotoresSemAgencia.length > 0 && (
              <>
                {' '}·{' '}
                <span className="text-amber-700 font-bold">
                  {promotoresSemAgencia.length} sem agência
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={abrirNovaAgencia}
          className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-2xs cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Nova Agência</span>
        </button>
      </div>

      {/* Layout Mestre-Detalhe */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Lista de Agências */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar agência, contato, CNPJ ou promotor..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs font-semibold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-bold">
            {[
              { id: 'TODAS' as const, label: 'Todas' },
              { id: 'COM_ATIVOS' as const, label: 'Com Ativos' },
              { id: 'SEM_PROMOTORES' as const, label: 'Sem Promotores' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltroAtividade(f.id)}
                className={`px-2.5 py-1 rounded-md cursor-pointer ${
                  filtroAtividade === f.id
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {agenciasFiltradas.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Nenhuma agência encontrada com os filtros aplicados.
              </div>
            ) : (
              agenciasFiltradas.map((item) => {
                const selecionada = item.agencia.agenciaId === agenciaSelecionadaId;
                return (
                  <button
                    key={item.agencia.agenciaId}
                    type="button"
                    onClick={() => setAgenciaSelecionadaId(item.agencia.agenciaId)}
                    className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                      selecionada
                        ? 'bg-blue-50/70 border-blue-600 ring-1 ring-blue-600'
                        : 'bg-slate-50/70 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-900 uppercase truncate">
                          {item.agencia.nome}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                          {item.ativos} ativo(s) · {item.totalPromotores} vinculado(s) · {item.totalIndustrias} ind.
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-black font-mono tabular-nums px-2 py-0.5 rounded border shrink-0 ${
                          item.ativos > 0
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {item.ativos} ATIVO{item.ativos === 1 ? '' : 'S'}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Detalhe da Agência Selecionada */}
        <div className="lg:col-span-7 space-y-4">
          {!agenciaSelecionadaResumo ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-2">
              <Building2 className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-600">
                Selecione uma agência à esquerda ou cadastre uma nova agência.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
              {/* Header da Agência */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    AGÊNCIA COMERCIAL
                  </span>
                  <h3 className="text-base font-black text-slate-900 uppercase mt-1">
                    {agenciaSelecionadaResumo.agencia.nome}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mt-1">
                    <span className="font-mono tabular-nums">
                      Ativos: <strong className="text-emerald-700">{agenciaSelecionadaResumo.ativos}</strong>
                    </span>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      Total vinculados: <strong className="text-slate-800">{agenciaSelecionadaResumo.totalPromotores}</strong>
                    </span>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      Indústrias atendidas: <strong className="text-slate-800">{agenciaSelecionadaResumo.totalIndustrias}</strong>
                    </span>
                  </div>
                  {(agenciaSelecionadaResumo.agencia.cnpj ||
                    agenciaSelecionadaResumo.agencia.contato ||
                    agenciaSelecionadaResumo.agencia.telefone) && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {[
                        agenciaSelecionadaResumo.agencia.cnpj && `CNPJ: ${agenciaSelecionadaResumo.agencia.cnpj}`,
                        agenciaSelecionadaResumo.agencia.contato && `Contato: ${agenciaSelecionadaResumo.agencia.contato}`,
                        agenciaSelecionadaResumo.agencia.telefone && `Tel: ${agenciaSelecionadaResumo.agencia.telefone}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => abrirEditarAgencia(agenciaSelecionadaResumo.agencia)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black uppercase flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Editar</span>
                </button>
              </div>

              {/* Ações da Agência */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-black uppercase text-slate-700 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-blue-700" />
                  <span>Promotores Vinculados ({agenciaSelecionadaResumo.totalPromotores})</span>
                </h4>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsVincularExistenteOpen((v) => !v)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-black uppercase flex items-center gap-1 cursor-pointer"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Vincular Existente</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onAbrirCadastroPromotorParaAgencia(agenciaSelecionadaResumo.agencia.agenciaId)
                    }
                    className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-black uppercase flex items-center gap-1 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>+ Novo Promotor</span>
                  </button>
                </div>
              </div>

              {isVincularExistenteOpen && (
                <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <select
                    value={promotorParaVincularId}
                    onChange={(e) => setPromotorParaVincularId(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-blue-200 bg-white text-xs font-semibold"
                  >
                    <option value="">Selecione um promotor para vincular ou transferir...</option>
                    {promotores
                      .filter((p) => p.agenciaId !== agenciaSelecionadaResumo.agencia.agenciaId)
                      .map((p) => (
                        <option key={p.promotorId} value={p.promotorId}>
                          {p.nome} ({p.agenciaNome ? `Atual: ${p.agenciaNome}` : 'Sem agência'}) — {p.status}
                        </option>
                      ))}
                  </select>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleVincularPromotorExistenteNaAgencia}
                      disabled={!promotorParaVincularId}
                      className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-black uppercase disabled:opacity-40 cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsVincularExistenteOpen(false)}
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              )}

              {/* Lista de Promotores da Agência */}
              <div className="space-y-2">
                {agenciaSelecionadaResumo.promotores.length === 0 ? (
                  <div className="p-6 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
                    Nenhum promotor vinculado a esta agência no momento.
                  </div>
                ) : (
                  agenciaSelecionadaResumo.promotores.map((p) => {
                    const isTransferindo = promotorTransferindoId === p.promotorId;
                    const isDesvinculando = promotorDesvinculandoId === p.promotorId;
                    const qtdInds = vinculosInd.filter((v) => v.promotorId === p.promotorId).length;

                    return (
                      <div
                        key={p.promotorId}
                        className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-black text-slate-900 uppercase">
                                {p.nome}
                              </span>
                              <span
                                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                                  p.status === 'ATIVO'
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : p.status === 'INATIVO'
                                    ? 'bg-slate-200 text-slate-700 border-slate-300'
                                    : p.status === 'BLOQUEADO'
                                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}
                              >
                                {p.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                              Setor: {p.setorNome} · {qtdInds} indústria(s) vinculada(s)
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setPromotorTransferindoId(isTransferindo ? null : p.promotorId);
                                setPromotorDesvinculandoId(null);
                                setDestinoTransferenciaId('');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-white hover:bg-blue-50 border border-slate-200 text-[10px] font-black uppercase text-blue-700 cursor-pointer"
                            >
                              Transferir
                            </button>
                            <button
                              type="button"
                              onClick={() => setPromotorSubstituir(p)}
                              className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-[10px] font-black uppercase text-amber-800 flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                              <span>Substituir</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPromotorDesvinculandoId(isDesvinculando ? null : p.promotorId);
                                setPromotorTransferindoId(null);
                                setInativarAoDesvincular(false);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-white hover:bg-rose-50 border border-slate-200 text-[10px] font-black uppercase text-rose-700 flex items-center gap-1 cursor-pointer"
                            >
                              <Unlink className="w-3 h-3" />
                              <span>Desvincular</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleInativar(p)}
                              className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[10px] font-black uppercase text-slate-700 cursor-pointer"
                            >
                              {p.status === 'INATIVO' ? 'Reativar' : 'Inativar'}
                            </button>
                          </div>
                        </div>

                        {isTransferindo && (
                          <div className="p-2.5 rounded-lg bg-white border border-blue-200 space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <select
                                value={destinoTransferenciaId}
                                onChange={(e) => setDestinoTransferenciaId(e.target.value)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
                              >
                                <option value="">Selecione agência destino...</option>
                                {agencias
                                  .filter((a) => a.agenciaId !== agenciaSelecionadaResumo.agencia.agenciaId)
                                  .map((a) => (
                                    <option key={a.agenciaId} value={a.agenciaId}>
                                      {a.nome}
                                    </option>
                                  ))}
                              </select>
                              <input
                                type="text"
                                value={motivoTransferencia}
                                onChange={(e) => setMotivoTransferencia(e.target.value)}
                                placeholder="Motivo (opcional)..."
                                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setPromotorTransferindoId(null)}
                                className="px-2.5 py-1 rounded text-[11px] font-bold text-slate-600 cursor-pointer"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConfirmarTransferenciaAgencia(p)}
                                disabled={!destinoTransferenciaId}
                                className="px-3 py-1 rounded bg-blue-700 text-white text-[11px] font-black uppercase disabled:opacity-40 cursor-pointer"
                              >
                                Confirmar Transferência
                              </button>
                            </div>
                          </div>
                        )}

                        {isDesvinculando && (
                          <div className="p-2.5 rounded-lg bg-rose-50/70 border border-rose-200 space-y-2">
                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={inativarAoDesvincular}
                                onChange={(e) => setInativarAoDesvincular(e.target.checked)}
                                className="rounded text-rose-700"
                              />
                              <span>Marcar também o promotor como INATIVO (histórico preservado)</span>
                            </label>
                            <input
                              type="text"
                              value={motivoDesvinculo}
                              onChange={(e) => setMotivoDesvinculo(e.target.value)}
                              placeholder="Motivo do desligamento da agência (opcional)..."
                              className="w-full px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setPromotorDesvinculandoId(null)}
                                className="px-2.5 py-1 rounded text-[11px] font-bold text-slate-600 cursor-pointer"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConfirmarDesvincularAgencia(p)}
                                className="px-3 py-1 rounded bg-rose-700 text-white text-[11px] font-black uppercase cursor-pointer"
                              >
                                Confirmar Desvinculação
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Histórico de Movimentações da Agência */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <h4 className="text-xs font-black uppercase text-slate-700 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-slate-500" />
                  <span>Histórico de Alterações ({historicoDaAgencia.length})</span>
                </h4>
                {historicoDaAgencia.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    Nenhuma movimentação registrada ainda para esta agência.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {historicoDaAgencia.map((h) => (
                      <div
                        key={h.id}
                        className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-[11px] flex items-start justify-between gap-2"
                      >
                        <div>
                          <p className="font-bold text-slate-800">{h.detalhes}</p>
                          {h.motivo && (
                            <p className="text-slate-500">Motivo: {h.motivo}</p>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-slate-400 shrink-0 tabular-nums">
                          {new Date(h.dataHora).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Promotores atualmente sem agência */}
          {promotoresSemAgencia.length > 0 && (
            <div className="bg-amber-50/70 rounded-xl border border-amber-200 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-amber-950">
                  Promotores Sem Agência Vinculada ({promotoresSemAgencia.length})
                </span>
              </div>
              <div className="space-y-1.5">
                {promotoresSemAgencia.map((p) => (
                  <div
                    key={p.promotorId}
                    className="p-2.5 rounded-lg bg-white border border-amber-200 flex items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-black text-slate-900 uppercase">{p.nome}</span>
                      <span className="text-[11px] text-slate-500 ml-2">Status: {p.status}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {agenciaSelecionadaResumo && (
                        <button
                          type="button"
                          onClick={async () => {
                            const atual = await promotorService.vincularOuTransferirPromotorAgencia(
                              p.promotorId,
                              agenciaSelecionadaResumo.agencia.agenciaId,
                              'Revinculado pelo módulo Agências'
                            );
                            await isvService.sincronizarPromotorNosVinculos(atual);
                            showFeedback(
                              'success',
                              `${atual.nome} vinculado à agência "${agenciaSelecionadaResumo.agencia.nome}".`
                            );
                          }}
                          className="px-2.5 py-1 rounded bg-blue-700 text-white text-[10px] font-black uppercase cursor-pointer"
                        >
                          Vincular a {agenciaSelecionadaResumo.agencia.nome}
                        </button>
                      )}
                      {p.status === 'INATIVO' && (
                        <button
                          type="button"
                          onClick={() => handleToggleInativar(p)}
                          className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[10px] font-black uppercase cursor-pointer"
                        >
                          Reativar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Criar / Editar Agência */}
      {isFormAgenciaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black uppercase text-slate-900">
                {editandoAgencia ? 'Editar Agência' : 'Cadastrar Nova Agência'}
              </h3>
              <button
                type="button"
                onClick={() => setIsFormAgenciaOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formErro && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl">
                {formErro}
              </div>
            )}

            <form onSubmit={handleSalvarAgencia} className="space-y-3">
              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1">
                  Nome da Agência *
                </label>
                <input
                  type="text"
                  value={formNome}
                  onChange={(e) => setFormNome(e.target.value)}
                  placeholder="Ex: SEARA, AGÊNCIA LÍDER CASCAVEL..."
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                />
                {duplicataNomePreview && (
                  <p className="text-[11px] text-rose-700 font-bold mt-1">
                    Já existe a agência "{duplicataNomePreview.nome}" cadastrada (duplicidade ignorando maiúsculas, acentos ou espaços).
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-700 mb-1">
                    CNPJ (opcional)
                  </label>
                  <input
                    type="text"
                    value={formCnpj}
                    onChange={(e) => setFormCnpj(e.target.value)}
                    placeholder="00.000.000/0001-00"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-700 mb-1">
                    Telefone (opcional)
                  </label>
                  <input
                    type="text"
                    value={formTelefone}
                    onChange={(e) => setFormTelefone(e.target.value)}
                    placeholder="(45) 99999-9999"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1">
                  Responsável / Contato (opcional)
                </label>
                <input
                  type="text"
                  value={formContato}
                  onChange={(e) => setFormContato(e.target.value)}
                  placeholder="Nome do supervisor ou contato comercial"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1">
                  Observações (opcional)
                </label>
                <textarea
                  rows={2}
                  value={formObs}
                  onChange={(e) => setFormObs(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFormAgenciaOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-black uppercase cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingAgencia || Boolean(duplicataNomePreview)}
                  className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-black uppercase flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{isSavingAgencia ? 'Salvando...' : 'Salvar Agência'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Substituição */}
      <SubstituirPromotorModal
        isOpen={Boolean(promotorSubstituir)}
        onClose={() => setPromotorSubstituir(null)}
        promotorAntigo={promotorSubstituir}
        onConcluido={(res) => {
          showFeedback(
            'success',
            `Substituição registrada: ${res.antigo.nome} → ${res.substituto.nome}${
              res.cnpjsTransferidos.length > 0
                ? ` (${res.cnpjsTransferidos.length} indústria(s) transferida(s))`
                : ''
            }.`
          );
        }}
      />
    </div>
  );
};
