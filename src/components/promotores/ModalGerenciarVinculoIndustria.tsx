import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  CheckSquare,
  Link,
  Plus,
  Search,
  Square,
  Unlink,
  UserPlus,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { normalizarChaveAgencia } from '../../services/agenciaNormalizer';
import { isvService } from '../../services/isvService';
import { promotorService } from '../../services/promotorService';
import { formatarCnpj, normalizarCnpj } from '../../services/spcoi007Parser';
import {
  AgenciaComercial,
  Promotor,
  SETORES_DISPONIVEIS,
  SetorPromotor,
} from '../../types';

interface ModalGerenciarVinculoIndustriaProps {
  isOpen: boolean;
  onClose: () => void;
  industria: {
    cnpj: string;
    nome: string;
    razaoSocial?: string;
  } | null;
  onVinculoAlterado?: () => void;
}

export const ModalGerenciarVinculoIndustria: React.FC<ModalGerenciarVinculoIndustriaProps> = ({
  isOpen,
  onClose,
  industria,
  onVinculoAlterado,
}) => {
  const [promotores, setPromotores] = useState<Promotor[]>([]);
  const [agencias, setAgencias] = useState<AgenciaComercial[]>([]);
  const [vinculos, setVinculos] = useState(isvService.getVinculosPromotorIndustria());
  const [buscaPromotor, setBuscaPromotor] = useState('');
  const [feedback, setFeedback] = useState<{ tipo: 'success' | 'error'; msg: string } | null>(null);

  // Cadastro inline de novo promotor dentro do Dashboard
  const [mostrarNovoPromotor, setMostrarNovoPromotor] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoAgenciaId, setNovoAgenciaId] = useState('');
  const [criarNovaAgencia, setCriarNovaAgencia] = useState(false);
  const [novaAgenciaNome, setNovaAgenciaNome] = useState('');
  const [novoMatricula, setNovoMatricula] = useState('');
  const [novosSetores, setNovosSetores] = useState<SetorPromotor[]>(['FRIOS']);
  const [vincularAoSalvar, setVincularAoSalvar] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edição rápida de agência de um promotor já vinculado
  const [editandoAgenciaPromotorId, setEditandoAgenciaPromotorId] = useState<string | null>(null);
  const [agenciaEditSelectId, setAgenciaEditSelectId] = useState<string>('');

  const cnpjNorm = useMemo(
    () => (industria ? normalizarCnpj(industria.cnpj) : ''),
    [industria]
  );

  const recarregar = () => {
    setPromotores(promotorService.getPromotores());
    const ags = promotorService.getAgencias();
    setAgencias(ags);
    setVinculos(isvService.getVinculosPromotorIndustria());
  };

  useEffect(() => {
    if (!isOpen) return;
    Promise.all([promotorService.init(), isvService.init()]).then(() => {
      recarregar();
      const ags = promotorService.getAgencias();
      setNovoAgenciaId(ags[0]?.agenciaId || '');
    });
    setBuscaPromotor('');
    setMostrarNovoPromotor(false);
    setNovoNome('');
    setCriarNovaAgencia(false);
    setNovaAgenciaNome('');
    setNovoMatricula('');
    setNovosSetores(['FRIOS']);
    setVincularAoSalvar(true);
    setEditandoAgenciaPromotorId(null);
    setFeedback(null);

    const u1 = promotorService.subscribe(recarregar);
    const u2 = isvService.subscribe(recarregar);
    return () => {
      u1();
      u2();
    };
  }, [isOpen, cnpjNorm]);

  const vinculosAtuais = useMemo(() => {
    if (!cnpjNorm) return [];
    const lista = vinculos.filter((v) => normalizarCnpj(v.cnpj) === cnpjNorm);
    const porPromotor = new Map<
      string,
      {
        promotorId: string;
        promotorNome: string;
        agenciaNome: string;
        agenciaId?: string | null;
        status?: string;
        promotorObj?: Promotor;
      }
    >();

    for (const v of lista) {
      const promVivo = promotores.find((p) => p.promotorId === v.promotorId);
      porPromotor.set(v.promotorId, {
        promotorId: v.promotorId,
        promotorNome: promVivo ? promVivo.nome : v.promotorNome,
        agenciaNome: promVivo ? promVivo.agenciaNome : v.agenciaNome,
        agenciaId: promVivo?.agenciaId,
        status: promVivo?.status,
        promotorObj: promVivo,
      });
    }
    return Array.from(porPromotor.values());
  }, [vinculos, promotores, cnpjNorm]);

  const idsJaVinculados = useMemo(
    () => new Set(vinculosAtuais.map((v) => v.promotorId)),
    [vinculosAtuais]
  );

  const promotoresDisponiveis = useMemo(() => {
    const q = buscaPromotor.trim().toLowerCase();
    return promotores.filter((p) => {
      if (idsJaVinculados.has(p.promotorId)) return false;
      if (!q) return true;
      return (
        p.nome.toLowerCase().includes(q) ||
        (p.agenciaNome || '').toLowerCase().includes(q) ||
        (p.matricula || '').toLowerCase().includes(q)
      );
    });
  }, [promotores, idsJaVinculados, buscaPromotor]);

  const agenciaDuplicadaDetectada = useMemo(() => {
    if (!criarNovaAgencia || !novaAgenciaNome.trim()) return null;
    const chave = normalizarChaveAgencia(novaAgenciaNome);
    if (!chave) return null;
    return agencias.find((a) => normalizarChaveAgencia(a.nome) === chave) || null;
  }, [criarNovaAgencia, novaAgenciaNome, agencias]);

  if (!isOpen || !industria) return null;

  const exibirFeedback = (tipo: 'success' | 'error', msg: string) => {
    setFeedback({ tipo, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleVincularExistente = async (promotor: Promotor) => {
    if (!cnpjNorm) return;
    setIsSubmitting(true);
    try {
      await isvService.vincularPromotorIndustria(
        promotor,
        cnpjNorm,
        promotor.filialId || '172'
      );
      exibirFeedback(
        'success',
        `${promotor.nome} vinculado à indústria "${industria.nome}" com sucesso.`
      );
      onVinculoAlterado?.();
    } catch (err: any) {
      exibirFeedback('error', err?.message || 'Erro ao vincular promotor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDesvincular = async (promotorId: string, promotorNome: string) => {
    if (!cnpjNorm) return;
    setIsSubmitting(true);
    try {
      await isvService.desvincularPromotorIndustria(promotorId, cnpjNorm, '172');
      exibirFeedback(
        'success',
        `Vínculo removido: ${promotorNome} foi desvinculado desta indústria (ambos os cadastros foram preservados).`
      );
      onVinculoAlterado?.();
    } catch (err: any) {
      exibirFeedback('error', err?.message || 'Erro ao remover vínculo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAtualizarAgenciaPromotor = async (promotorId: string) => {
    if (!agenciaEditSelectId) return;
    setIsSubmitting(true);
    try {
      const atualizado = await promotorService.vincularOuTransferirPromotorAgencia(
        promotorId,
        agenciaEditSelectId,
        `Agência atualizada no gerenciamento de vínculo da indústria ${industria.nome}`
      );
      await isvService.sincronizarPromotorNosVinculos(atualizado);
      setEditandoAgenciaPromotorId(null);
      exibirFeedback(
        'success',
        `Agência de ${atualizado.nome} atualizada para "${atualizado.agenciaNome}".`
      );
      onVinculoAlterado?.();
    } catch (err: any) {
      exibirFeedback('error', err?.message || 'Erro ao atualizar agência.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSetorNovo = (s: SetorPromotor) => {
    setNovosSetores((prev) => {
      if (prev.includes(s)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== s);
      }
      return [...prev, s];
    });
  };

  const handleCadastrarNovoPromotor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoNome.trim()) {
      exibirFeedback('error', 'Informe o nome do promotor.');
      return;
    }
    if (criarNovaAgencia && !novaAgenciaNome.trim()) {
      exibirFeedback('error', 'Informe o nome da nova agência.');
      return;
    }
    if (!criarNovaAgencia && !novoAgenciaId) {
      exibirFeedback('error', 'Selecione uma agência ou crie uma nova.');
      return;
    }
    if (agenciaDuplicadaDetectada) {
      exibirFeedback(
        'error',
        `A agência "${agenciaDuplicadaDetectada.nome}" já está cadastrada. Selecione-a na lista.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      let agIdFinal = novoAgenciaId;
      if (criarNovaAgencia) {
        const agCriada = await promotorService.cadastrarAgencia({
          nome: novaAgenciaNome.trim(),
        });
        agIdFinal = agCriada.agenciaId;
      }

      const novo = await promotorService.cadastrarPromotor({
        nome: novoNome.trim(),
        agenciaId: agIdFinal,
        matricula: novoMatricula.trim() || undefined,
        setores: novosSetores,
        filialId: '172',
        filialNome: 'Cascavel',
      });

      if (vincularAoSalvar && cnpjNorm) {
        await isvService.vincularPromotorIndustria(novo, cnpjNorm, '172');
        exibirFeedback(
          'success',
          `Promotor ${novo.nome} (${novo.agenciaNome}) cadastrado e vinculado à indústria "${industria.nome}"!`
        );
      } else {
        exibirFeedback('success', `Promotor ${novo.nome} cadastrado com sucesso.`);
      }

      setNovoNome('');
      setNovoMatricula('');
      setNovaAgenciaNome('');
      setCriarNovaAgencia(false);
      setMostrarNovoPromotor(false);
      onVinculoAlterado?.();
    } catch (err: any) {
      exibirFeedback('error', err?.message || 'Erro ao cadastrar promotor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        {/* Cabeçalho */}
        <div className="p-4 bg-slate-900 text-white flex items-start justify-between gap-3 border-b border-slate-800">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600/30 flex items-center justify-center border border-purple-500/40 shrink-0">
              <Building2 className="w-5 h-5 text-purple-300" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-purple-300">
                Gerenciar Vínculo Comercial · Filial 172
              </span>
              <h2 className="text-sm sm:text-base font-black text-white leading-tight mt-0.5">
                {industria.nome}
              </h2>
              <p className="text-[11px] text-slate-300 font-mono tabular-nums mt-0.5">
                CNPJ: {cnpjNorm ? formatarCnpj(cnpjNorm) : 'Não informado'}
                {industria.razaoSocial && industria.razaoSocial !== industria.nome
                  ? ` · ${industria.razaoSocial}`
                  : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo com scroll */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
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

          {/* 1. Promotores já vinculados */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-slate-800">
                Promotores Vinculados a Esta Indústria ({vinculosAtuais.length})
              </span>
              <span className="text-[10px] font-bold text-slate-500">
                Múltiplos promotores permitidos
              </span>
            </div>

            {vinculosAtuais.length === 0 ? (
              <div className="p-4 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-900 font-semibold">
                Esta indústria ainda está sem promotor vinculado. Selecione um promotor abaixo ou cadastre um novo.
              </div>
            ) : (
              <div className="space-y-2">
                {vinculosAtuais.map((v) => {
                  const isEditAg = editandoAgenciaPromotorId === v.promotorId;
                  return (
                    <div
                      key={v.promotorId}
                      className="p-3 rounded-lg bg-white border border-slate-200 space-y-2"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-slate-900 uppercase">
                              {v.promotorNome}
                            </span>
                            {v.status && (
                              <span
                                className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded border ${
                                  v.status === 'ATIVO'
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : v.status === 'INATIVO'
                                    ? 'bg-slate-100 text-slate-600 border-slate-300'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}
                              >
                                {v.status}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600 mt-0.5">
                            Agência:{' '}
                            <strong className="text-blue-900">
                              {v.agenciaNome || 'Sem agência vinculada'}
                            </strong>
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditandoAgenciaPromotorId(isEditAg ? null : v.promotorId);
                              setAgenciaEditSelectId(v.agenciaId || '');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase cursor-pointer"
                          >
                            Alterar Agência
                          </button>
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleDesvincular(v.promotorId, v.promotorNome)}
                            className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[10px] font-black uppercase flex items-center gap-1 cursor-pointer"
                          >
                            <Unlink className="w-3 h-3" />
                            <span>Desvincular</span>
                          </button>
                        </div>
                      </div>

                      {isEditAg && (
                        <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                          <select
                            value={agenciaEditSelectId}
                            onChange={(e) => setAgenciaEditSelectId(e.target.value)}
                            className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold bg-white"
                          >
                            <option value="">Selecione a nova agência...</option>
                            {agencias.map((ag) => (
                              <option key={ag.agenciaId} value={ag.agenciaId}>
                                {ag.nome}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!agenciaEditSelectId || isSubmitting}
                            onClick={() => handleAtualizarAgenciaPromotor(v.promotorId)}
                            className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-[11px] font-black uppercase disabled:opacity-40 cursor-pointer"
                          >
                            Salvar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Cadastrar Novo Promotor Diretamente do Dashboard */}
          <div className="bg-blue-50/50 rounded-xl border border-blue-200 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-xs font-black uppercase text-blue-950 block">
                  Cadastrar Novo Promotor Sem Sair do Dashboard
                </span>
                <span className="text-[11px] text-blue-800">
                  Cadastre o promotor, escolha ou crie a agência e vincule imediatamente a esta indústria.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMostrarNovoPromotor((v) => !v)}
                className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-black uppercase flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{mostrarNovoPromotor ? 'Fechar Formulário' : '+ Novo Promotor'}</span>
              </button>
            </div>

            {mostrarNovoPromotor && (
              <form
                onSubmit={handleCadastrarNovoPromotor}
                className="bg-white rounded-xl border border-blue-200 p-3.5 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-black uppercase text-slate-700 mb-1">
                      Nome do Promotor *
                    </label>
                    <input
                      type="text"
                      value={novoNome}
                      onChange={(e) => setNovoNome(e.target.value)}
                      placeholder="Ex: Carla Souza"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase text-slate-700 mb-1">
                      Matrícula (opcional)
                    </label>
                    <input
                      type="text"
                      value={novoMatricula}
                      onChange={(e) => setNovoMatricula(e.target.value)}
                      placeholder="Ex: MAT-304"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-black uppercase text-slate-700">
                      Agência Responsável *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setCriarNovaAgencia((prev) => !prev);
                        setNovaAgenciaNome('');
                      }}
                      className="text-[11px] font-black uppercase text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{criarNovaAgencia ? 'Usar Agência Existente' : 'Criar Nova Agência'}</span>
                    </button>
                  </div>

                  {!criarNovaAgencia ? (
                    <select
                      value={novoAgenciaId}
                      onChange={(e) => setNovoAgenciaId(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold bg-white"
                    >
                      <option value="">Selecione uma agência cadastrada...</option>
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
                        value={novaAgenciaNome}
                        onChange={(e) => setNovaAgenciaNome(e.target.value)}
                        placeholder="Nome da nova agência..."
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
                      />
                      {agenciaDuplicadaDetectada && (
                        <p className="text-[11px] text-rose-700 font-bold mt-1">
                          Agência "{agenciaDuplicadaDetectada.nome}" já existe no cadastro.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-black uppercase text-slate-700 mb-1">
                    Setores *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {SETORES_DISPONIVEIS.map((s) => {
                      const active = novosSetores.includes(s.id as SetorPromotor);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleSetorNovo(s.id as SetorPromotor)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-black uppercase flex items-center gap-2 cursor-pointer ${
                            active
                              ? 'bg-blue-700 text-white border-blue-700'
                              : 'bg-slate-50 text-slate-700 border-slate-200'
                          }`}
                        >
                          {active ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                          <span>{s.nome}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={vincularAoSalvar}
                    onChange={(e) => setVincularAoSalvar(e.target.checked)}
                    className="rounded text-blue-700"
                  />
                  <span>Vincular imediatamente à indústria {industria.nome}</span>
                </label>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setMostrarNovoPromotor(false)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold uppercase cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || Boolean(agenciaDuplicadaDetectada)}
                    className="px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-black uppercase flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? 'Salvando...' : 'Salvar e Vincular'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* 3. Pesquisar e Vincular Promotor Existente */}
          <div className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black uppercase text-slate-800">
                Pesquisar Promotores Existentes ({promotoresDisponiveis.length})
              </span>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={buscaPromotor}
                onChange={(e) => setBuscaPromotor(e.target.value)}
                placeholder="Pesquisar por nome do promotor, agência ou matrícula..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs font-semibold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-hidden"
              />
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {promotoresDisponiveis.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  Nenhum promotor disponível encontrado para vincular.
                </p>
              ) : (
                promotoresDisponiveis.map((p) => (
                  <div
                    key={p.promotorId}
                    className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-slate-900 uppercase">
                          {p.nome}
                        </span>
                        <span
                          className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded border ${
                            p.status === 'ATIVO'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : p.status === 'INATIVO'
                              ? 'bg-slate-100 text-slate-600 border-slate-300'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 truncate">
                        Agência: <strong>{p.agenciaNome || 'Sem agência'}</strong> · Setores: {p.setorNome}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isSubmitting || !cnpjNorm}
                      onClick={() => handleVincularExistente(p)}
                      className="px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-[11px] font-black uppercase flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-40"
                    >
                      <Link className="w-3 h-3" />
                      <span>Vincular</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase cursor-pointer"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};
