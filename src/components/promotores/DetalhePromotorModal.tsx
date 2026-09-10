import {
  Ban,
  Building2,
  Calendar,
  Check,
  CheckCircle,
  CheckSquare,
  Edit2,
  Lock,
  QrCode,
  ShieldCheck,
  Smartphone,
  Square,
  Unlock,
  Unlink,
  User,
  X
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { promotorService } from '../../services/promotorService';
import {
  formatarSetoresExibicao,
  getPromotorSetores,
  PermissoesPromotor,
  Promotor,
  SETORES_DISPONIVEIS,
  SetorPromotor
} from '../../types';
import { ConfirmacaoModal } from './ConfirmacaoModal';

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
  const [isEditingCadastro, setIsEditingCadastro] = useState(false);
  const [nomeEdit, setNomeEdit] = useState('');
  const [agenciaEdit, setAgenciaEdit] = useState('');
  const [matriculaEdit, setMatriculaEdit] = useState('');
  const [setoresEdit, setSetoresEdit] = useState<SetorPromotor[]>([]);

  const [isEditingPermissoes, setIsEditingPermissoes] = useState(false);
  const [permissoesEdit, setPermissoesEdit] = useState<PermissoesPromotor | null>(null);
  const [isDesvincularConfirmOpen, setIsDesvincularConfirmOpen] = useState(false);
  const [isBloquearConfirmOpen, setIsBloquearConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [erroCadastro, setErroCadastro] = useState<string | null>(null);

  useEffect(() => {
    if (promotor) {
      setNomeEdit(promotor.nome);
      setAgenciaEdit(promotor.agenciaNome || '');
      setMatriculaEdit(promotor.matricula || '');
      setSetoresEdit(getPromotorSetores(promotor));
      setIsEditingCadastro(false);
      setIsEditingPermissoes(false);
      setErroCadastro(null);
    }
  }, [promotor]);

  if (!isOpen || !promotor) return null;

  const isOnline = promotorService.isPromotorOnline(promotor);
  const promotorSetores = getPromotorSetores(promotor);

  const handleStartEditCadastro = () => {
    setNomeEdit(promotor.nome);
    setAgenciaEdit(promotor.agenciaNome || '');
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
    if (!agenciaEdit.trim()) {
      setErroCadastro('Informe a agência ou empresa.');
      return;
    }
    if (setoresEdit.length === 0) {
      setErroCadastro('Selecione ao menos um setor (FRIOS ou LOJA).');
      return;
    }

    setIsSubmitting(true);
    setErroCadastro(null);
    try {
      await promotorService.atualizarPromotor(promotor.promotorId, {
        nome: nomeEdit.trim(),
        agenciaNome: agenciaEdit.trim(),
        matricula: matriculaEdit.trim() || undefined,
        setores: setoresEdit,
      });
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
    setIsEditingPermissoes(true);
  };

  const handleSalvarPermissoes = async () => {
    if (!permissoesEdit) return;
    setIsSubmitting(true);
    try {
      await promotorService.atualizarPermissoes(promotor.promotorId, permissoesEdit);
      setIsEditingPermissoes(false);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar permissões.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDesvincular = async () => {
    setIsSubmitting(true);
    try {
      await promotorService.desvincularDispositivo(promotor.promotorId);
      onRefresh();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Erro ao desvincular aparelho.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleBloqueio = async () => {
    setIsSubmitting(true);
    try {
      if (promotor.status === 'BLOQUEADO') {
        await promotorService.desbloquearPromotor(promotor.promotorId);
      } else {
        await promotorService.bloquearPromotor(promotor.promotorId);
      }
      onRefresh();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar bloqueio do promotor.');
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
                  {promotor.agenciaNome && (
                    <span className="text-xs font-bold text-blue-800 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-200">
                      {promotor.agenciaNome}
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
              onClick={onClose}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Status and Presence Indicator */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-500 uppercase">Status:</span>
              {promotor.status === 'ATIVO' && (
                <span className="text-xs font-black text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-200 uppercase">
                  ● ATIVO
                </span>
              )}
              {promotor.status === 'PENDENTE_VINCULO' && (
                <span className="text-xs font-black text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 uppercase">
                  ● PENDENTE DE VÍNCULO
                </span>
              )}
              {promotor.status === 'BLOQUEADO' && (
                <span className="text-xs font-black text-rose-800 bg-rose-100 px-2.5 py-0.5 rounded-full border border-rose-200 uppercase">
                  ● BLOQUEADO
                </span>
              )}
              {promotor.status === 'DESVINCULADO' && (
                <span className="text-xs font-black text-gray-700 bg-gray-200 px-2.5 py-0.5 rounded-full border border-gray-300 uppercase">
                  ● DESVINCULADO
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
                <button
                  type="button"
                  onClick={handleStartEditCadastro}
                  className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-black uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Editar Cadastro</span>
                </button>
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
                    disabled={isSubmitting}
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
                ⚠ {erroCadastro}
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
                  <p className="text-sm font-black text-blue-900">{promotor.agenciaNome || '—'}</p>
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

                  <div>
                    <label className="block text-[11px] font-black text-gray-700 uppercase mb-1">
                      Agência / Empresa *
                    </label>
                    <input
                      type="text"
                      value={agenciaEdit}
                      onChange={(e) => setAgenciaEdit(e.target.value)}
                      placeholder="Ex: Trade Marketing ABC"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs font-semibold"
                    />
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
                disabled={promotor.status === 'BLOQUEADO'}
                className="px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
              >
                <QrCode className="w-4 h-4 text-blue-700 stroke-[2.5]" />
                <span>Gerar Vínculo (QR / Código)</span>
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

            <div className="flex items-center gap-2">
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
                    <span>Reativar Promotor</span>
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
        isOpen={isBloquearConfirmOpen}
        onClose={() => setIsBloquearConfirmOpen(false)}
        onConfirm={handleToggleBloqueio}
        titulo={promotor.status === 'BLOQUEADO' ? 'Reativar Promotor' : 'Bloquear Promotor'}
        mensagem={
          promotor.status === 'BLOQUEADO'
            ? `Deseja reativar o acesso de ${promotor.nome}? Ele voltará a ter permissão para sincronizar operações no aplicativo.`
            : `Atenção: Ao bloquear ${promotor.nome}, todas as tentativas de consulta e apontamento serão negadas imediatamente no servidor e aplicativo.`
        }
        textoConfirmar={promotor.status === 'BLOQUEADO' ? 'Sim, Reativar' : 'Sim, Bloquear'}
        tipoPerigo={promotor.status !== 'BLOQUEADO'}
      />
    </>
  );
};
