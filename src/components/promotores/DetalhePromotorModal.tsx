import {
  ArrowRightLeft,
  Ban,
  Building2,
  Calendar,
  Check,
  CheckSquare,
  Edit2,
  History,
  Plus,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Square,
  Unlock,
  Unlink,
  UserX,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { normalizarChaveAgencia } from '../../services/agenciaNormalizer';
import { isvService } from '../../services/isvService';
import { promotorService } from '../../services/promotorService';
import {
  AgenciaComercial,
  formatarSetoresExibicao,
  getPromotorSetores,
  HistoricoMovimentacaoComercial,
  PermissoesPromotor,
  Promotor,
  SETORES_DISPONIVEIS,
  SetorPromotor
} from '../../types';
import { ConfirmacaoModal } from './ConfirmacaoModal';
import { SubstituirPromotorModal } from './SubstituirPromotorModal';

interface DetalhePromotorModalProps {
  isOpen: boolean;
  onClose: () => void;
  promotor: Promotor | null;
  onGerarVinculo: (promotor: Promotor) => void;
  onVerAuditoria: (promotor: Promotor) => void;
  onRefresh: () => void;
}

export const DetalhePromotorModal: React.FC<DetalhePromotorModalProps> = ({
  isOpen,
  onClose,
  promotor,
  onGerarVinculo,
  onVerAuditoria,
  onRefresh,
}) => {
  const [agencias, setAgencias] = useState<AgenciaComercial[]>([]);
  const [historicoMov, setHistoricoMov] = useState<HistoricoMovimentacaoComercial[]>([]);

  const [isEditingCadastro, setIsEditingCadastro] = useState(false);
  const [nomeEdit, setNomeEdit] = useState('');
  const [agenciaEditId, setAgenciaEditId] = useState('');
  const [criarNovaAgenciaEdit, setCriarNovaAgenciaEdit] = useState(false);
  const [novaAgenciaNomeEdit, setNovaAgenciaNomeEdit] = useState('');
  const [matriculaEdit, setMatriculaEdit] = useState('');
  const [setoresEdit, setSetoresEdit] = useState<SetorPromotor[]>([]);

  const [isEditingPermissoes, setIsEditingPermissoes] = useState(false);
  const [permissoesEdit, setPermissoesEdit] = useState<PermissoesPromotor | null>(null);
  const [isDesvincularConfirmOpen, setIsDesvincularConfirmOpen] = useState(false);
  const [isBloquearConfirmOpen, setIsBloquearConfirmOpen] = useState(false);
  const [isInativarConfirmOpen, setIsInativarConfirmOpen] = useState(false);
  const [isDesvincularAgenciaOpen, setIsDesvincularAgenciaOpen] = useState(false);
  const [inativarAoDesvincularAgencia, setInativarAoDesvincularAgencia] = useState(false);
  const [motivoDesvincularAgencia, setMotivoDesvincularAgencia] = useState('');
  const [isSubstituirOpen, setIsSubstituirOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [erroCadastro, setErroCadastro] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !promotor) return;
    const atualizarListas = () => {
      const listaAg = promotorService.getAgencias();
      setAgencias(listaAg);
      setHistoricoMov(
        promotorService.getHistoricoMovimentacoes({ promotorId: promotor.promotorId })
      );
    };
    atualizarListas();
    const unsub = promotorService.subscribe(atualizarListas);

    setNomeEdit(promotor.nome);
    const agEncontrada =
      (promotor.agenciaId && promotorService.getAgenciaById(promotor.agenciaId)) ||
      (promotor.agenciaNome ? promotorService.buscarAgenciaPorNome(promotor.agenciaNome) : undefined);
    setAgenciaEditId(agEncontrada?.agenciaId || '');
    setCriarNovaAgenciaEdit(false);
    setNovaAgenciaNomeEdit('');
    setMatriculaEdit(promotor.matricula || '');
    setSetoresEdit(getPromotorSetores(promotor));
    setIsEditingCadastro(false);
    setIsEditingPermissoes(false);
    setIsDesvincularAgenciaOpen(false);
    setInativarAoDesvincularAgencia(false);
    setMotivoDesvincularAgencia('');
    setErroCadastro(null);
    setErroAcao(null);
    return () => unsub();
  }, [isOpen, promotor]);

  const agenciaDuplicadaEdit = useMemo(() => {
    if (!criarNovaAgenciaEdit || !novaAgenciaNomeEdit.trim()) return null;
    const chave = normalizarChaveAgencia(novaAgenciaNomeEdit);
    if (!chave) return null;
    return agencias.find((a) => normalizarChaveAgencia(a.nome) === chave) || null;
  }, [criarNovaAgenciaEdit, novaAgenciaNomeEdit, agencias]);

  if (!isOpen || !promotor) return null;

  const isOnline = promotorService.isPromotorOnline(promotor);
  const promotorSetores = getPromotorSetores(promotor);

  const handleStartEditCadastro = () => {
    setNomeEdit(promotor.nome);
    const agEncontrada =
      (promotor.agenciaId && promotorService.getAgenciaById(promotor.agenciaId)) ||
      (promotor.agenciaNome ? promotorService.buscarAgenciaPorNome(promotor.agenciaNome) : undefined);
    setAgenciaEditId(agEncontrada?.agenciaId || '');
    setCriarNovaAgenciaEdit(false);
    setNovaAgenciaNomeEdit('');
    setMatriculaEdit(promotor.matricula || '');
    setSetoresEdit(getPromotorSetores(promotor));
    setErroCadastro(null);
    setIsEditingCadastro(true);
  };

  const toggleSetorEdit = (setorId: SetorPromotor) => {
    setSetoresEdit((prev) => {
      if (prev.includes(setorId)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((s) => s !== setorId);
      } else {
        return [...prev, setorId];
      }
    });
  };

  const handleSalvarCadastro = async () => {
    if (!nomeEdit.trim()) {
      setErroCadastro('Informe o nome do promotor.');
      return;
    }
    if (criarNovaAgenciaEdit) {
      if (!novaAgenciaNomeEdit.trim()) {
        setErroCadastro('Informe o nome da nova agência ou selecione uma existente.');
        return;
      }
      if (agenciaDuplicadaEdit) {
        setErroCadastro(
          `A agência "${agenciaDuplicadaEdit.nome}" já está cadastrada. Selecione-a na lista.`
        );
        return;
      }
    }
    if (setoresEdit.length === 0) {
      setErroCadastro('Selecione ao menos um setor (FRIOS ou LOJA).');
      return;
    }

    setIsSubmitting(true);
    setErroCadastro(null);
    setErroAcao(null);
    try {
      let agenciaIdFinal: string | null = agenciaEditId || null;
      if (criarNovaAgenciaEdit) {
        const criada = await promotorService.cadastrarAgencia({
          nome: novaAgenciaNomeEdit.trim(),
        });
        agenciaIdFinal = criada.agenciaId;
      }

      const atualizado = await promotorService.atualizarPromotor(promotor.promotorId, {
        nome: nomeEdit.trim(),
        ...(agenciaIdFinal
          ? { agenciaId: agenciaIdFinal }
          : { desvincularAgencia: true }),
        matricula: matriculaEdit.trim() || undefined,
        setores: setoresEdit,
      });
      await isvService.sincronizarPromotorNosVinculos(atualizado);
      setIsEditingCadastro(false);
      onRefresh();
    } catch (err: any) {
      setErroCadastro(err.message || 'Erro ao atualizar dados do promotor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEditPermissoes = () => {
    setPermissoesEdit({ ...promotor.permissoes });
    setErroAcao(null);
    setIsEditingPermissoes(true);
  };

  const handleSalvarPermissoes = async () => {
    if (!permissoesEdit) return;
    setIsSubmitting(true);
    setErroAcao(null);
    try {
      await promotorService.atualizarPermissoes(promotor.promotorId, permissoesEdit);
      setIsEditingPermissoes(false);
      onRefresh();
    } catch (err: any) {
      setErroAcao(err.message || 'Erro ao salvar permissões.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDesvincular = async () => {
    setIsSubmitting(true);
    setErroAcao(null);
    try {
      await promotorService.desvincularDispositivo(promotor.promotorId);
      onRefresh();
      onClose();
    } catch (err: any) {
      setErroAcao(err.message || 'Erro ao desvincular aparelho.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleBloqueio = async () => {
    setIsSubmitting(true);
    setErroAcao(null);
    try {
      if (promotor.status === 'BLOQUEADO') {
        const reativado = await promotorService.desbloquearPromotor(promotor.promotorId);
        await isvService.sincronizarPromotorNosVinculos(reativado);
      } else {
        const bloqueado = await promotorService.bloquearPromotor(promotor.promotorId);
        await isvService.sincronizarPromotorNosVinculos(bloqueado);
      }
      onRefresh();
      onClose();
    } catch (err: any) {
      setErroAcao(err.message || 'Erro ao alterar bloqueio do promotor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleInativo = async () => {
    setIsSubmitting(true);
    setErroAcao(null);
    try {
      if (promotor.status === 'INATIVO') {
        const reativado = await promotorService.reativarPromotor(promotor.promotorId);
        await isvService.sincronizarPromotorNosVinculos(reativado);
      } else {
        const inativado = await promotorService.inativarPromotor(promotor.promotorId);
        await isvService.sincronizarPromotorNosVinculos(inativado);
      }
      setIsInativarConfirmOpen(false);
      onRefresh();
    } catch (err: any) {
      setErroAcao(err.message || 'Erro ao alterar situação do promotor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDesvincularAgencia = async () => {
    setIsSubmitting(true);
    setErroAcao(null);
    try {
      const atualizado = await promotorService.desvincularPromotorDaAgencia(promotor.promotorId, {
        inativarPromotor: inativarAoDesvincularAgencia,
        motivo: motivoDesvincularAgencia.trim() || undefined,
      });
      await isvService.sincronizarPromotorNosVinculos(atualizado);
      setIsDesvincularAgenciaOpen(false);
      setInativarAoDesvincularAgencia(false);
      setMotivoDesvincularAgencia('');
      onRefresh();
    } catch (err: any) {
      setErroAcao(err.message || 'Erro ao desvincular promotor da agência.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatarData = (iso?: string | null) => {
    if (!iso) return 'Nunca';
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    } catch {
      return iso;
    }
  };

  const permissoesDef = [
    { key: 'consultarProduto' as const, label: 'Consultar Produto' },
    { key: 'escanearEAN' as const, label: 'Escanear EAN' },
    { key: 'cadastrarVencimento' as const, label: 'Cadastrar Vencimento' },
    { key: 'atualizarQuantidade' as const, label: 'Atualizar Quantidade' },
    { key: 'visualizarPendencias' as const, label: 'Visualizar Pendências' },
    { key: 'enviarAoComprador' as const, label: 'Marcar Enviar ao Comprador' },
    { key: 'visualizarHistorico' as const, label: 'Visualizar Histórico Próprio' },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
        <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-gray-200 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-gray-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center shrink-0 font-black text-base">
                {promotor.nome.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">
                    {promotor.nome}
                  </h2>
                  {promotor.agenciaNome ? (
                    <span className="text-xs font-bold text-blue-800 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-200">
                      {promotor.agenciaNome}
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-md border border-slate-200">
                      Sem agência vinculada
                    </span>
                  )}
                  {promotor.matricula && (
                    <span className="text-[11px] font-mono font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                      Mat: {promotor.matricula}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-xs font-semibold text-gray-600">
                    Filial {promotor.filialId} ({promotor.filialNome}) • Setor: <strong>{formatarSetoresExibicao(promotorSetores)}</strong>
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {erroAcao && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center justify-between gap-2">
              <span>{erroAcao}</span>
              <button
                type="button"
                onClick={() => setErroAcao(null)}
                className="text-rose-500 hover:text-rose-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Status and Presence Indicator */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-500 uppercase">Status:</span>
              {promotor.status === 'ATIVO' && (
                <span className="text-xs font-black text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-200 uppercase">
                  ATIVO
                </span>
              )}
              {promotor.status === 'PENDENTE_VINCULO' && (
                <span className="text-xs font-black text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 uppercase">
                  PENDENTE DE VÍNCULO
                </span>
              )}
              {promotor.status === 'INATIVO' && (
                <span className="text-xs font-black text-slate-700 bg-slate-200 px-2.5 py-0.5 rounded-full border border-slate-300 uppercase">
                  INATIVO
                </span>
              )}
              {promotor.status === 'BLOQUEADO' && (
                <span className="text-xs font-black text-rose-800 bg-rose-100 px-2.5 py-0.5 rounded-full border border-rose-200 uppercase">
                  BLOQUEADO
                </span>
              )}
              {promotor.status === 'DESVINCULADO' && (
                <span className="text-xs font-black text-gray-700 bg-gray-200 px-2.5 py-0.5 rounded-full border border-gray-300 uppercase">
                  DESVINCULADO
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-500 uppercase">Conexão:</span>
              {isOnline ? (
                <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1.5 uppercase">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  ONLINE (Ativo recentemente)
                </span>
              ) : (
                <span className="text-xs font-black text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full border border-gray-200 flex items-center gap-1.5 uppercase">
                  <span className="w-2 h-2 rounded-full bg-gray-400" />
                  OFFLINE
                </span>
              )}
            </div>
          </div>

          {/* Dados do Cadastro (Nome, Agência, Matrícula, Setor, Filial) */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-700 stroke-[2.5]" />
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                  Dados Cadastrais
                </h3>
              </div>
              {!isEditingCadastro ? (
                <div className="flex items-center gap-1.5">
                  {promotor.agenciaNome && (
                    <button
                      type="button"
                      onClick={() => setIsDesvincularAgenciaOpen((v) => !v)}
                      className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-black uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Unlink className="w-3 h-3" />
                      <span>Desvincular Agência</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleStartEditCadastro}
                    className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-black uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>Editar Cadastro</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingCadastro(false);
                      setErroCadastro(null);
                    }}
                    className="text-xs text-gray-500 hover:underline uppercase font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSalvarCadastro}
                    disabled={isSubmitting || Boolean(agenciaDuplicadaEdit)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3 h-3 stroke-[3]" />
                    <span>Salvar</span>
                  </button>
                </div>
              )}
            </div>

            {erroCadastro && (
              <div className="p-2 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-lg">
                {erroCadastro}
              </div>
            )}

            {isDesvincularAgenciaOpen && !isEditingCadastro && (
              <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-200 space-y-2">
                <p className="text-xs font-bold text-rose-950">
                  Desvincular {promotor.nome} da agência &ldquo;{promotor.agenciaNome}&rdquo; preservando todo o histórico e auditoria:
                </p>
                <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inativarAoDesvincularAgencia}
                    onChange={(e) => setInativarAoDesvincularAgencia(e.target.checked)}
                    className="rounded text-rose-700"
                  />
                  <span>Marcar também o promotor como INATIVO</span>
                </label>
                <input
                  type="text"
                  value={motivoDesvincularAgencia}
                  onChange={(e) => setMotivoDesvincularAgencia(e.target.value)}
                  placeholder="Motivo da desvinculação (opcional)..."
                  className="w-full px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-xs"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsDesvincularAgenciaOpen(false)}
                    className="px-3 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleDesvincularAgencia}
                    className="px-3 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-black uppercase cursor-pointer disabled:opacity-50"
                  >
                    Confirmar Desvinculação
                  </button>
                </div>
              </div>
            )}

            {!isEditingCadastro ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-gray-50/60 rounded-lg border border-gray-100">
                  <span className="text-[11px] font-bold text-gray-500 uppercase block mb-0.5">
                    Nome do Promotor
                  </span>
                  <p className="text-sm font-black text-gray-900">{promotor.nome}</p>
                </div>

                <div className="p-2.5 bg-gray-50/60 rounded-lg border border-gray-100">
                  <span className="text-[11px] font-bold text-gray-500 uppercase block mb-0.5">
                    Agência / Empresa
                  </span>
                  <p className="text-sm font-black text-blue-900">
                    {promotor.agenciaNome || 'Sem agência vinculada'}
                  </p>
                </div>

                <div className="p-2.5 bg-gray-50/60 rounded-lg border border-gray-100">
                  <span className="text-[11px] font-bold text-gray-500 uppercase block mb-0.5">
                    Identificação / Matrícula
                  </span>
                  <p className="text-sm font-semibold text-gray-800">{promotor.matricula || 'Não informada'}</p>
                </div>

                <div className="p-2.5 bg-gray-50/60 rounded-lg border border-gray-100">
                  <span className="text-[11px] font-bold text-gray-500 uppercase block mb-1">
                    Setor(es) de Atuação
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {promotorSetores.map((s) => (
                      <span
                        key={s}
                        className={`px-2.5 py-0.5 rounded text-[11px] font-black uppercase tracking-wider border ${
                          s === 'FRIOS'
                            ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                            : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                        }`}
                      >
                        [ {s} ]
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-black text-gray-700 uppercase mb-1">
                      Nome do Promotor *
                    </label>
                    <input
                      type="text"
                      value={nomeEdit}
                      onChange={(e) => setNomeEdit(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-[11px] font-black text-gray-700 uppercase">
                        Agência / Empresa
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setCriarNovaAgenciaEdit((v) => !v);
                          setNovaAgenciaNomeEdit('');
                        }}
                        className="text-[10px] font-black uppercase text-blue-700 hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{criarNovaAgenciaEdit ? 'Existente' : 'Nova Agência'}</span>
                      </button>
                    </div>
                    {!criarNovaAgenciaEdit ? (
                      <select
                        value={agenciaEditId}
                        onChange={(e) => setAgenciaEditId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs font-semibold bg-white"
                      >
                        <option value="">Sem agência vinculada</option>
                        {agencias.map((ag) => (
                          <option key={ag.agenciaId} value={ag.agenciaId}>
                            {ag.nome}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div>
                        <input
                          type="text"
                          value={novaAgenciaNomeEdit}
                          onChange={(e) => setNovaAgenciaNomeEdit(e.target.value)}
                          placeholder="Nome da nova agência..."
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs font-semibold"
                        />
                        {agenciaDuplicadaEdit && (
                          <p className="text-[10px] text-rose-700 font-bold mt-0.5">
                            Agência &ldquo;{agenciaDuplicadaEdit.nome}&rdquo; já cadastrada.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-gray-700 uppercase mb-1">
                      Matrícula (opcional)
                    </label>
                    <input
                      type="text"
                      value={matriculaEdit}
                      onChange={(e) => setMatriculaEdit(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-gray-700 uppercase mb-1">
                      Setores de Atuação *
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {SETORES_DISPONIVEIS.map((s) => {
                        const checked = setoresEdit.includes(s.id as SetorPromotor);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleSetorEdit(s.id as SetorPromotor)}
                            className={`flex items-center gap-1.5 p-2 rounded-lg border text-xs font-black uppercase transition-all cursor-pointer ${
                              checked
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-gray-50 text-gray-700 border-gray-200'
                            }`}
                          >
                            {checked ? (
                              <CheckSquare className="w-3.5 h-3.5 stroke-[2.5]" />
                            ) : (
                              <Square className="w-3.5 h-3.5 stroke-[2]" />
                            )}
                            <span>{s.nome}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dados Operacionais e Dispositivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="bg-white p-3.5 rounded-xl border border-gray-200 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-black text-gray-500 uppercase tracking-wider">
                <Smartphone className="w-3.5 h-3.5 text-blue-700 stroke-[2.5]" />
                <span>Dispositivo Vinculado</span>
              </div>
              {promotor.dispositivoVinculado ? (
                <div>
                  <p className="text-sm font-black text-gray-900">
                    {promotor.dispositivoVinculado.dispositivoNome}
                  </p>
                  <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                    Vinculado em: {formatarData(promotor.dispositivoVinculado.dataPrimeiroVinculo)}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-amber-700 font-bold">
                  Nenhum aparelho vinculado no momento.
                </p>
              )}
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-gray-200 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-black text-gray-500 uppercase tracking-wider">
                <Calendar className="w-3.5 h-3.5 text-blue-700 stroke-[2.5]" />
                <span>Registro e Acesso</span>
              </div>
              <p className="text-xs text-gray-700 font-medium">
                Cadastrado em: <strong className="text-gray-900">{formatarData(promotor.dataCadastro)}</strong>
              </p>
              <p className="text-xs text-gray-700 font-medium">
                Último acesso: <strong className="text-gray-900">{formatarData(promotor.ultimoAcesso)}</strong>
              </p>
            </div>
          </div>

          {/* Seção de Permissões */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-700 stroke-[2.5]" />
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                  Permissões de Acesso
                </h3>
              </div>
              {!isEditingPermissoes ? (
                <button
                  type="button"
                  onClick={handleStartEditPermissoes}
                  className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-black uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Editar Permissões</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingPermissoes(false)}
                    className="text-xs text-gray-500 hover:underline uppercase font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSalvarPermissoes}
                    disabled={isSubmitting}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Check className="w-3 h-3 stroke-[3]" />
                    <span>Salvar</span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {permissoesDef.map((p) => {
                const ativo = isEditingPermissoes && permissoesEdit
                  ? permissoesEdit[p.key]
                  : promotor.permissoes[p.key];

                if (isEditingPermissoes && permissoesEdit) {
                  return (
                    <label
                      key={p.key}
                      onClick={() =>
                        setPermissoesEdit((prev) =>
                          prev ? { ...prev, [p.key]: !prev[p.key] } : null
                        )
                      }
                      className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
                        ativo
                          ? 'bg-blue-50/50 border-blue-300'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <span className="text-xs font-bold text-gray-900 uppercase">
                        {p.label}
                      </span>
                      <input
                        type="checkbox"
                        checked={ativo}
                        onChange={() => {}}
                        className="w-4 h-4 rounded text-blue-700 focus:ring-blue-500"
                      />
                    </label>
                  );
                }

                return (
                  <div
                    key={p.key}
                    className={`flex items-center justify-between p-2.5 rounded-lg border text-xs font-bold ${
                      ativo
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-gray-100/70 border-gray-200 text-gray-400'
                    }`}
                  >
                    <span>{p.label}</span>
                    <span>{ativo ? '✓ Habilitado' : '✕ Desabilitado'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Histórico de Movimentações Comerciais */}
          {historicoMov.length > 0 && (
            <div className="bg-white rounded-xl p-3.5 border border-gray-200 space-y-2">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-slate-600" />
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Histórico de Movimentações ({historicoMov.length})
                </h3>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {historicoMov.slice(0, 15).map((mov) => (
                  <div
                    key={mov.id}
                    className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold text-slate-800">{mov.detalhes}</p>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0 tabular-nums">
                        {formatarData(mov.dataHora)}
                      </span>
                    </div>
                    {(mov.promotorNome || mov.promotorSubstitutoNome) && (
                      <p className="text-[10px] text-slate-600">
                        Origem: <strong>{mov.promotorNome || 'N/A'}</strong>
                        {mov.agenciaAnteriorNome ? ` (${mov.agenciaAnteriorNome})` : ''}
                        {mov.promotorSubstitutoNome && (
                          <>
                            {' → '}Destino: <strong>{mov.promotorSubstitutoNome}</strong>
                            {mov.agenciaNome ? ` (${mov.agenciaNome})` : ''}
                          </>
                        )}
                      </p>
                    )}
                    {mov.industriasTransferidas && mov.industriasTransferidas.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {mov.industriasTransferidas.slice(0, 8).map((ind) => (
                          <span
                            key={ind.cnpj}
                            className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-semibold text-slate-700"
                          >
                            {ind.nome}
                          </span>
                        ))}
                        {mov.industriasTransferidas.length > 8 && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                            +{mov.industriasTransferidas.length - 8} mais
                          </span>
                        )}
                      </div>
                    )}
                    {mov.motivo && (
                      <p className="text-slate-500">Motivo: {mov.motivo}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-gray-100">
            <div className="flex flex-wrap items-center gap-2">
              {/* Gerar Vínculo */}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onGerarVinculo(promotor);
                }}
                disabled={promotor.status === 'BLOQUEADO' || promotor.status === 'INATIVO'}
                className="px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
              >
                <QrCode className="w-4 h-4 text-blue-700 stroke-[2.5]" />
                <span>Gerar Vínculo (QR / Código)</span>
              </button>

              {/* Substituir Promotor */}
              <button
                type="button"
                onClick={() => setIsSubstituirOpen(true)}
                className="px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ArrowRightLeft className="w-3.5 h-3.5 text-amber-700 stroke-[2.5]" />
                <span>Substituir</span>
              </button>

              {/* Desvincular Dispositivo */}
              {promotor.dispositivoVinculado && (
                <button
                  type="button"
                  onClick={() => setIsDesvincularConfirmOpen(true)}
                  className="px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Unlink className="w-3.5 h-3.5 text-amber-700 stroke-[2.5]" />
                  <span>Desvincular Aparelho</span>
                </button>
              )}

              {/* Ver Auditoria */}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onVerAuditoria(promotor);
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200 transition-colors cursor-pointer"
              >
                Ver Atividades
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Inativar / Reativar (INATIVO) */}
              {promotor.status !== 'BLOQUEADO' && (
                <button
                  type="button"
                  onClick={() => setIsInativarConfirmOpen(true)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider border flex items-center gap-1.5 transition-colors cursor-pointer ${
                    promotor.status === 'INATIVO'
                      ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                      : 'text-slate-700 bg-slate-100 hover:bg-slate-200 border-slate-300'
                  }`}
                >
                  {promotor.status === 'INATIVO' ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Reativar Cadastro</span>
                    </>
                  ) : (
                    <>
                      <UserX className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Marcar Inativo</span>
                    </>
                  )}
                </button>
              )}

              {/* Bloquear / Desbloquear */}
              <button
                type="button"
                onClick={() => setIsBloquearConfirmOpen(true)}
                className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider border flex items-center gap-1.5 transition-colors cursor-pointer ${
                  promotor.status === 'BLOQUEADO'
                    ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                    : 'text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200'
                }`}
              >
                {promotor.status === 'BLOQUEADO' ? (
                  <>
                    <Unlock className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Desbloquear Promotor</span>
                  </>
                ) : (
                  <>
                    <Ban className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Bloquear Promotor</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmacaoModal
        isOpen={isDesvincularConfirmOpen}
        onClose={() => setIsDesvincularConfirmOpen(false)}
        onConfirm={handleDesvincular}
        titulo="Desvincular Dispositivo"
        mensagem={`Deseja realmente desvincular o aparelho de ${promotor.nome}? O promotor precisará de um novo QR Code ou código para se reconectar e seu status voltará a ser PENDENTE DE VÍNCULO.`}
        textoConfirmar="Sim, Desvincular"
        tipoPerigo={false}
      />

      <ConfirmacaoModal
        isOpen={isInativarConfirmOpen}
        onClose={() => setIsInativarConfirmOpen(false)}
        onConfirm={handleToggleInativo}
        titulo={promotor.status === 'INATIVO' ? 'Reativar Promotor' : 'Marcar Promotor como Inativo'}
        mensagem={
          promotor.status === 'INATIVO'
            ? `Deseja reativar ${promotor.nome}? Todo o histórico e vínculos preservados continuam mantidos.`
            : `Ao marcar ${promotor.nome} como INATIVO, o cadastro e todo o histórico/auditoria são preservados e poderão ser reativados a qualquer momento.`
        }
        textoConfirmar={promotor.status === 'INATIVO' ? 'Sim, Reativar' : 'Sim, Marcar Inativo'}
        tipoPerigo={false}
      />

      <ConfirmacaoModal
        isOpen={isBloquearConfirmOpen}
        onClose={() => setIsBloquearConfirmOpen(false)}
        onConfirm={handleToggleBloqueio}
        titulo={promotor.status === 'BLOQUEADO' ? 'Desbloquear Promotor' : 'Bloquear Promotor'}
        mensagem={
          promotor.status === 'BLOQUEADO'
            ? `Deseja desbloquear o acesso de ${promotor.nome}? Ele voltará a ter permissão para sincronizar operações no aplicativo.`
            : `Atenção: Ao bloquear ${promotor.nome}, todas as tentativas de consulta e apontamento serão negadas imediatamente no servidor e aplicativo.`
        }
        textoConfirmar={promotor.status === 'BLOQUEADO' ? 'Sim, Desbloquear' : 'Sim, Bloquear'}
        tipoPerigo={promotor.status !== 'BLOQUEADO'}
      />

      <SubstituirPromotorModal
        isOpen={isSubstituirOpen}
        onClose={() => setIsSubstituirOpen(false)}
        promotorAntigo={promotor}
        onConcluido={() => {
          onRefresh();
        }}
      />
    </>
  );
};
