import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  Check,
  CheckCircle2,
  CheckSquare,
  ListChecks,
  Plus,
  Search,
  ShieldAlert,
  Square,
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
  Promotor,
  SETORES_DISPONIVEIS,
  SetorPromotor,
} from '../../types';

interface SubstituirPromotorModalProps {
  isOpen: boolean;
  onClose: () => void;
  promotorAntigo?: Promotor | null;
  onConcluido?: (resultado: {
    antigo: Promotor;
    substituto: Promotor;
    cnpjsTransferidos: string[];
  }) => void;
}

type ModoTransferenciaIndustria = 'TODAS' | 'MANUAL' | 'NENHUMA';

export const SubstituirPromotorModal: React.FC<SubstituirPromotorModalProps> = ({
  isOpen,
  onClose,
  promotorAntigo = null,
  onConcluido,
}) => {
  const [promotores, setPromotores] = useState<Promotor[]>([]);
  const [agencias, setAgencias] = useState<AgenciaComercial[]>([]);

  // 1. Promotor Atual (Origem) — selecionável no próprio modal
  const [promotorAtualId, setPromotorAtualId] = useState('');
  const [buscaPromotorAtual, setBuscaPromotorAtual] = useState('');

  // 2. Promotor Substituto (Existente ou Novo) + Agência do Substituto
  const [modoSubstituto, setModoSubstituto] = useState<'EXISTENTE' | 'NOVO'>('EXISTENTE');
  const [buscaSubstituto, setBuscaSubstituto] = useState('');
  const [substitutoId, setSubstitutoId] = useState('');

  // Agência selecionada ou criada para o substituto (aplicável em Existente e Novo)
  const [substitutoAgenciaId, setSubstitutoAgenciaId] = useState('');
  const [criarNovaAgencia, setCriarNovaAgencia] = useState(false);
  const [novaAgenciaNome, setNovaAgenciaNome] = useState('');

  // Campos para novo substituto inline
  const [novoNome, setNovoNome] = useState('');
  const [novoMatricula, setNovoMatricula] = useState('');
  const [novosSetores, setNovosSetores] = useState<SetorPromotor[]>(['FRIOS']);

  // 3. Transferência em Massa de Indústrias
  const [modoTransferencia, setModoTransferencia] = useState<ModoTransferenciaIndustria>('TODAS');
  const [buscaIndustriaLista, setBuscaIndustriaLista] = useState('');
  const [cnpjsSelecionados, setCnpjsSelecionados] = useState<string[]>([]);
  const [confirmarTransferencia, setConfirmarTransferencia] = useState(false);

  // 4. Situação do Promotor Anterior
  const [desvincularDaAgencia, setDesvincularDaAgencia] = useState(true);
  const [marcarComoInativo, setMarcarComoInativo] = useState(true);
  const [motivo, setMotivo] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Reset controlado ao abrir o modal — NUNCA dispara transferência ao abrir
  useEffect(() => {
    if (!isOpen) return;

    const listaPromotores = promotorService.getPromotores();
    const listaAgencias = promotorService.getAgencias();
    setPromotores(listaPromotores);
    setAgencias(listaAgencias);

    const vinculosAtuais = isvService.getVinculosPromotorIndustria();
    const inicial =
      promotorAntigo ||
      listaPromotores.find((p) =>
        vinculosAtuais.some((v) => v.promotorId === p.promotorId)
      ) ||
      listaPromotores[0] ||
      null;

    const inicialId = inicial?.promotorId || '';
    setPromotorAtualId(inicialId);
    setBuscaPromotorAtual('');

    setModoSubstituto('EXISTENTE');
    setBuscaSubstituto('');
    setSubstitutoId('');
    setSubstitutoAgenciaId(inicial?.agenciaId || listaAgencias[0]?.agenciaId || '');
    setCriarNovaAgencia(false);
    setNovaAgenciaNome('');

    setNovoNome('');
    setNovoMatricula('');
    setNovosSetores(['FRIOS']);

    setModoTransferencia('TODAS');
    setBuscaIndustriaLista('');
    setConfirmarTransferencia(false);
    const cnpjsOrigem = inicialId
      ? Array.from(
          new Set(
            vinculosAtuais
              .filter((v) => v.promotorId === inicialId)
              .map((v) => v.cnpj)
          )
        )
      : [];
    setCnpjsSelecionados(cnpjsOrigem);

    setDesvincularDaAgencia(Boolean(inicial?.agenciaNome));
    setMarcarComoInativo(true);
    setMotivo('');
    setErro(null);
  }, [isOpen, promotorAntigo]);

  const promotorAtual = useMemo(
    () => promotores.find((p) => p.promotorId === promotorAtualId) || null,
    [promotores, promotorAtualId]
  );

  // Lista completa de indústrias vinculadas ao promotor atual selecionado
  const vinculosAntigo = useMemo(() => {
    if (!promotorAtual) return [];
    const todos = isvService
      .getVinculosPromotorIndustria()
      .filter((v) => v.promotorId === promotorAtual.promotorId);
    const mapa = new Map<string, { cnpj: string; nome: string; cnpjFormatado: string }>();
    for (const v of todos) {
      if (!mapa.has(v.cnpj)) {
        const ind = isvService.getIndustriaByCnpj(v.cnpj);
        mapa.set(v.cnpj, {
          cnpj: v.cnpj,
          cnpjFormatado: ind?.cnpj_formatado || v.cnpj,
          nome: ind?.nome_exibicao || ind?.razao_social || v.cnpj,
        });
      }
    }
    return Array.from(mapa.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [promotorAtual, isOpen]);

  // Ao trocar o promotor atual dentro do modal, sincronizar seleção segura sem confirmar nada
  const handleSelectPromotorAtual = (novoId: string) => {
    setPromotorAtualId(novoId);
    setConfirmarTransferencia(false);
    setErro(null);
    if (substitutoId === novoId) {
      setSubstitutoId('');
    }
    const alvo = promotores.find((p) => p.promotorId === novoId);
    setDesvincularDaAgencia(Boolean(alvo?.agenciaNome));
    const cnpjs = Array.from(
      new Set(
        isvService
          .getVinculosPromotorIndustria()
          .filter((v) => v.promotorId === novoId)
          .map((v) => v.cnpj)
      )
    );
    setCnpjsSelecionados(cnpjs);
    if (modoSubstituto === 'NOVO' && alvo?.agenciaId) {
      setSubstitutoAgenciaId(alvo.agenciaId);
    }
  };

  // Candidatos a Promotor Atual (Origem) filtráveis
  const promotoresOrigemFiltrados = useMemo(() => {
    const q = buscaPromotorAtual.trim().toLowerCase();
    const vincs = isvService.getVinculosPromotorIndustria();
    const contagemPorProm = new Map<string, number>();
    for (const v of vincs) {
      contagemPorProm.set(v.promotorId, (contagemPorProm.get(v.promotorId) || 0) + 1);
    }

    return promotores
      .map((p) => ({
        promotor: p,
        qtdIndustrias: contagemPorProm.get(p.promotorId) || 0,
      }))
      .filter(({ promotor }) => {
        if (!q) return true;
        return (
          promotor.nome.toLowerCase().includes(q) ||
          (promotor.agenciaNome || '').toLowerCase().includes(q) ||
          (promotor.matricula || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.qtdIndustrias - a.qtdIndustrias || a.promotor.nome.localeCompare(b.promotor.nome, 'pt-BR'));
  }, [promotores, buscaPromotorAtual, isOpen]);

  const candidatosExistentes = useMemo(() => {
    const q = buscaSubstituto.trim().toLowerCase();
    return promotores.filter((p) => {
      if (promotorAtual && p.promotorId === promotorAtual.promotorId) return false;
      if (p.status === 'BLOQUEADO') return false;
      if (!q) return true;
      return (
        p.nome.toLowerCase().includes(q) ||
        (p.agenciaNome || '').toLowerCase().includes(q)
      );
    });
  }, [promotores, promotorAtual, buscaSubstituto]);

  const substitutoSelecionadoObj = useMemo(
    () => (modoSubstituto === 'EXISTENTE' ? promotores.find((p) => p.promotorId === substitutoId) || null : null),
    [modoSubstituto, promotores, substitutoId]
  );

  // Quando seleciona um substituto existente, preencher sua agência atual no seletor
  const handleSelectSubstitutoExistente = (cand: Promotor) => {
    setSubstitutoId(cand.promotorId);
    setConfirmarTransferencia(false);
    setCriarNovaAgencia(false);
    setNovaAgenciaNome('');
    const agEncontrada =
      (cand.agenciaId && agencias.find((a) => a.agenciaId === cand.agenciaId)) ||
      (cand.agenciaNome
        ? agencias.find(
            (a) => normalizarChaveAgencia(a.nome) === normalizarChaveAgencia(cand.agenciaNome)
          )
        : undefined);
    setSubstitutoAgenciaId(agEncontrada?.agenciaId || '');
  };

  const agenciaDuplicadaDetectada = useMemo(() => {
    if (!criarNovaAgencia || !novaAgenciaNome.trim()) return null;
    const chave = normalizarChaveAgencia(novaAgenciaNome);
    if (!chave) return null;
    return agencias.find((a) => normalizarChaveAgencia(a.nome) === chave) || null;
  }, [criarNovaAgencia, novaAgenciaNome, agencias]);

  // Indústrias da lista filtradas pela busca
  const vinculosAntigoFiltrados = useMemo(() => {
    const q = buscaIndustriaLista.trim().toLowerCase();
    if (!q) return vinculosAntigo;
    return vinculosAntigo.filter(
      (ind) =>
        ind.nome.toLowerCase().includes(q) ||
        ind.cnpj.includes(q) ||
        ind.cnpjFormatado.includes(q)
    );
  }, [vinculosAntigo, buscaIndustriaLista]);

  // CNPJs que efetivamente serão alvo conforme modo ('TODAS', 'MANUAL', 'NENHUMA')
  const cnpjsParaTransferir = useMemo(() => {
    if (vinculosAntigo.length === 0 || modoTransferencia === 'NENHUMA') return [];
    if (modoTransferencia === 'TODAS') {
      return vinculosAntigo.map((v) => v.cnpj);
    }
    const validos = new Set(vinculosAntigo.map((v) => v.cnpj));
    return cnpjsSelecionados.filter((c) => validos.has(c));
  }, [vinculosAntigo, modoTransferencia, cnpjsSelecionados]);

  // Prévia em tempo real com detecção de duplicidades no substituto existente
  const previaTransferencia = useMemo(() => {
    if (!promotorAtual) {
      return {
        totalOrigem: 0,
        totalSelecionadas: 0,
        novasNoDestino: 0,
        jaVinculadasNoDestino: 0,
        permanecemNaOrigem: 0,
        cnpjsJaNoDestino: [] as string[],
      };
    }
    return isvService.simularTransferenciaVinculosIndustria(
      promotorAtual.promotorId,
      modoSubstituto === 'EXISTENTE' ? substitutoId : undefined,
      cnpjsParaTransferir
    );
  }, [promotorAtual, modoSubstituto, substitutoId, cnpjsParaTransferir]);

  if (!isOpen) return null;

  const toggleCnpj = (cnpj: string) => {
    setCnpjsSelecionados((prev) =>
      prev.includes(cnpj) ? prev.filter((c) => c !== cnpj) : [...prev, cnpj]
    );
  };

  const toggleSetorNovo = (s: SetorPromotor) => {
    setNovosSetores((prev) => {
      if (prev.includes(s)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== s);
      }
      return [...prev, s];
    });
  };

  const precisaConfirmarTransferencia =
    vinculosAntigo.length > 0 && modoTransferencia !== 'NENHUMA';

  const handleConfirmarSubstituicao = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    if (!promotorAtual) {
      setErro('Selecione o promotor atual (origem) que será substituído.');
      return;
    }

    if (modoSubstituto === 'EXISTENTE' && !substitutoId) {
      setErro('Selecione um promotor substituto ou cadastre um novo.');
      return;
    }

    if (modoSubstituto === 'NOVO') {
      if (!novoNome.trim()) {
        setErro('Informe o nome do novo promotor substituto.');
        return;
      }
      if (criarNovaAgencia && !novaAgenciaNome.trim()) {
        setErro('Informe o nome da nova agência ou selecione uma existente.');
        return;
      }
      if (!criarNovaAgencia && !substitutoAgenciaId) {
        setErro('Selecione ou cadastre a agência do novo promotor substituto.');
        return;
      }
    } else if (criarNovaAgencia && !novaAgenciaNome.trim()) {
      setErro('Informe o nome da nova agência para o substituto.');
      return;
    }

    if (agenciaDuplicadaDetectada) {
      setErro(
        `A agência "${agenciaDuplicadaDetectada.nome}" já existe. Selecione-a na lista para evitar duplicidade.`
      );
      return;
    }

    if (precisaConfirmarTransferencia) {
      if (cnpjsParaTransferir.length === 0) {
        setErro(
          'Selecione ao menos uma indústria para transferir ou escolha "Não transferir indústrias".'
        );
        return;
      }
      if (!confirmarTransferencia) {
        setErro(
          'Marque a confirmação explícita de transferência antes de executar a substituição em massa.'
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      let agIdFinal = substitutoAgenciaId;
      if (criarNovaAgencia) {
        const agCriada = await promotorService.cadastrarAgencia({
          nome: novaAgenciaNome.trim(),
        });
        agIdFinal = agCriada.agenciaId;
      }

      let targetSubstitutoId = substitutoId;
      if (modoSubstituto === 'NOVO') {
        const novoProm = await promotorService.cadastrarPromotor({
          nome: novoNome.trim(),
          agenciaId: agIdFinal,
          matricula: novoMatricula.trim() || undefined,
          setores: novosSetores,
          filialId: promotorAtual.filialId || '172',
          filialNome: promotorAtual.filialNome || 'Cascavel',
        });
        targetSubstitutoId = novoProm.promotorId;
      }

      const resultado = await promotorService.substituirPromotor({
        promotorAntigoId: promotorAtual.promotorId,
        promotorSubstitutoId: targetSubstitutoId,
        novaAgenciaSubstitutoId: agIdFinal || undefined,
        desvincularAntigoDaAgencia: desvincularDaAgencia,
        inativarAntigo: marcarComoInativo,
        confirmarTransferenciaVinculosIndustrias:
          precisaConfirmarTransferencia && confirmarTransferencia === true,
        modoTransferencia: precisaConfirmarTransferencia ? modoTransferencia : 'NENHUMA',
        cnpjsSelecionados: precisaConfirmarTransferencia ? cnpjsParaTransferir : [],
        motivo: motivo.trim() || undefined,
        onTransferirVinculosDetalhado: async (origemId, destino, cnpjs) =>
          isvService.transferirVinculosIndustriaEmMassa(origemId, destino, {
            confirmarTransferencia: true,
            cnpjs,
            removerDaOrigem: true,
            filialId: promotorAtual.filialId || '172',
          }),
      });

      await isvService.sincronizarPromotorNosVinculos(resultado.antigo);
      await isvService.sincronizarPromotorNosVinculos(resultado.substituto);

      onConcluido?.({
        antigo: resultado.antigo,
        substituto: resultado.substituto,
        cnpjsTransferidos: resultado.cnpjsTransferidos,
      });
      onClose();
    } catch (err: any) {
      setErro(err?.message || 'Erro ao executar substituição e transferência.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[94vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <ArrowRightLeft className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                SUBSTITUIÇÃO &amp; TRANSFERÊNCIA EM MASSA
              </span>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight mt-0.5">
                Substituir Promotor{promotorAtual ? `: ${promotorAtual.nome}` : ''}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {promotorAtual ? (
                  <>
                    Origem atual:{' '}
                    <strong className="text-slate-700">
                      {promotorAtual.agenciaNome || 'Sem agência'}
                    </strong>{' '}
                    · {vinculosAntigo.length} indústria(s) vinculada(s)
                  </>
                ) : (
                  'Selecione o promotor de origem e configure o substituto.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {erro && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <form onSubmit={handleConfirmarSubstituicao} className="space-y-4">
          {/* 1. Seleção do Promotor Atual (Origem) */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-700" />
                <span className="text-xs font-black uppercase text-slate-800">
                  1. Promotor Atual (Origem dos Vínculos)
                </span>
              </div>
              {promotorAtual && (
                <span className="text-[11px] font-bold text-slate-600">
                  {promotorAtual.agenciaNome || 'Sem agência'} · Status: {promotorAtual.status}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <div className="sm:col-span-5 relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={buscaPromotorAtual}
                  onChange={(e) => setBuscaPromotorAtual(e.target.value)}
                  placeholder="Filtrar promotor atual..."
                  className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-semibold text-slate-900"
                />
              </div>
              <div className="sm:col-span-7">
                <select
                  aria-label="Selecionar promotor atual"
                  value={promotorAtualId}
                  onChange={(e) => handleSelectPromotorAtual(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-900"
                >
                  <option value="">Selecione o promotor atual...</option>
                  {promotoresOrigemFiltrados.map(({ promotor, qtdIndustrias }) => (
                    <option key={promotor.promotorId} value={promotor.promotorId}>
                      {promotor.nome} ({promotor.agenciaNome || 'Sem agência'}) — {qtdIndustrias} ind. [{promotor.status}]
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 2. Promotor Substituto (Existente ou Novo) + Agência do Substituto */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-black uppercase text-slate-800">
                2. Promotor Substituto e Agência
              </span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-black uppercase">
                <button
                  type="button"
                  onClick={() => {
                    setModoSubstituto('EXISTENTE');
                    setErro(null);
                  }}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    modoSubstituto === 'EXISTENTE'
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Selecionar Existente
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModoSubstituto('NOVO');
                    setErro(null);
                    if (!substitutoAgenciaId && promotorAtual?.agenciaId) {
                      setSubstitutoAgenciaId(promotorAtual.agenciaId);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-md cursor-pointer flex items-center gap-1 ${
                    modoSubstituto === 'NOVO'
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UserPlus className="w-3 h-3" />
                  <span>Cadastrar Novo</span>
                </button>
              </div>
            </div>

            {modoSubstituto === 'EXISTENTE' ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={buscaSubstituto}
                    onChange={(e) => setBuscaSubstituto(e.target.value)}
                    placeholder="Buscar promotor substituto por nome ou agência..."
                    className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs font-semibold text-slate-900"
                  />
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {candidatosExistentes.length === 0 ? (
                    <p className="text-xs text-slate-400 py-3 text-center">
                      Nenhum promotor disponível encontrado. Cadastre um novo na aba acima.
                    </p>
                  ) : (
                    candidatosExistentes.map((cand) => {
                      const selected = cand.promotorId === substitutoId;
                      return (
                        <button
                          key={cand.promotorId}
                          type="button"
                          onClick={() => handleSelectSubstitutoExistente(cand)}
                          className={`w-full text-left p-2.5 rounded-lg border text-xs flex items-center justify-between transition-colors cursor-pointer ${
                            selected
                              ? 'bg-blue-50 border-blue-600 ring-1 ring-blue-600'
                              : 'bg-white border-slate-200 hover:bg-slate-100/70'
                          }`}
                        >
                          <div>
                            <p className="font-black text-slate-900 uppercase">{cand.nome}</p>
                            <p className="text-[11px] text-slate-500">
                              Agência: <strong>{cand.agenciaNome || 'Sem agência'}</strong> · Status: {cand.status}
                            </p>
                          </div>
                          {selected && <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Agência do substituto existente (permite manter, selecionar outra ou cadastrar nova) */}
                {substitutoSelecionadoObj && (
                  <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-black uppercase text-slate-700">
                        Agência do Substituto ({substitutoSelecionadoObj.nome})
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
                        <span>{criarNovaAgencia ? 'Selecionar Existente' : 'Cadastrar Nova Agência'}</span>
                      </button>
                    </div>
                    {!criarNovaAgencia ? (
                      <select
                        value={substitutoAgenciaId}
                        onChange={(e) => setSubstitutoAgenciaId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold bg-white"
                      >
                        <option value="">
                          Manter agência atual ({substitutoSelecionadoObj.agenciaNome || 'Sem agência'})
                        </option>
                        {agencias.map((ag) => (
                          <option key={ag.agenciaId} value={ag.agenciaId}>
                            {ag.nome}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={novaAgenciaNome}
                          onChange={(e) => setNovaAgenciaNome(e.target.value)}
                          placeholder="Nome da nova agência para o substituto..."
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
                        />
                        {agenciaDuplicadaDetectada && (
                          <p className="text-[11px] text-amber-800 font-bold">
                            Agência &ldquo;{agenciaDuplicadaDetectada.nome}&rdquo; já cadastrada (mesmo nome normalizado).
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3 bg-white p-3.5 rounded-xl border border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-black uppercase text-slate-700 mb-1">
                      Nome do Novo Promotor *
                    </label>
                    <input
                      type="text"
                      value={novoNome}
                      onChange={(e) => setNovoNome(e.target.value)}
                      placeholder="Ex: João Oliveira"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
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
                      placeholder="Ex: MAT-1029"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-black uppercase text-slate-700">
                      Agência do Substituto *
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
                      <span>{criarNovaAgencia ? 'Selecionar Existente' : 'Cadastrar Nova Agência'}</span>
                    </button>
                  </div>

                  {!criarNovaAgencia ? (
                    <select
                      value={substitutoAgenciaId}
                      onChange={(e) => setSubstitutoAgenciaId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold bg-white"
                    >
                      <option value="">Selecione uma agência...</option>
                      {agencias.map((ag) => (
                        <option key={ag.agenciaId} value={ag.agenciaId}>
                          {ag.nome}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={novaAgenciaNome}
                        onChange={(e) => setNovaAgenciaNome(e.target.value)}
                        placeholder="Nome da nova agência..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
                      />
                      {agenciaDuplicadaDetectada && (
                        <p className="text-[11px] text-amber-800 font-bold">
                          Agência &ldquo;{agenciaDuplicadaDetectada.nome}&rdquo; já cadastrada (mesmo nome normalizado).
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
                          className={`px-3 py-2 rounded-lg border text-xs font-black uppercase flex items-center gap-2 cursor-pointer ${
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
              </div>
            )}
          </div>

          {/* 3. Transferência em Massa de Indústrias */}
          <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-200 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-700" />
                <span className="text-xs font-black uppercase text-amber-950">
                  3. Indústrias Vinculadas ao Promotor Anterior ({vinculosAntigo.length})
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold text-amber-800 uppercase">
                Execução atômica somente após confirmação
              </span>
            </div>

            {vinculosAntigo.length === 0 ? (
              <p className="text-xs text-slate-600">
                O promotor selecionado não possui indústrias vinculadas no momento.
              </p>
            ) : (
              <>
                {/* Opções de Transferência */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setModoTransferencia('TODAS');
                      setCnpjsSelecionados(vinculosAntigo.map((v) => v.cnpj));
                    }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                      modoTransferencia === 'TODAS'
                        ? 'bg-blue-700 text-white border-blue-700 shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-black uppercase flex items-center gap-1.5">
                      <ListChecks className="w-3.5 h-3.5 shrink-0" />
                      <span>Transferir Todas</span>
                    </div>
                    <p
                      className={`text-[10px] mt-0.5 ${
                        modoTransferencia === 'TODAS' ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      Todas as {vinculosAntigo.length} indústrias vinculadas
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModoTransferencia('MANUAL')}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                      modoTransferencia === 'MANUAL'
                        ? 'bg-blue-700 text-white border-blue-700 shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-black uppercase flex items-center gap-1.5">
                      <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                      <span>Selecionar Manualmente</span>
                    </div>
                    <p
                      className={`text-[10px] mt-0.5 ${
                        modoTransferencia === 'MANUAL' ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      Escolher quais indústrias transferir
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setModoTransferencia('NENHUMA');
                      setConfirmarTransferencia(false);
                    }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                      modoTransferencia === 'NENHUMA'
                        ? 'bg-slate-800 text-white border-slate-800 shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-black uppercase flex items-center gap-1.5">
                      <X className="w-3.5 h-3.5 shrink-0" />
                      <span>Não Transferir</span>
                    </div>
                    <p
                      className={`text-[10px] mt-0.5 ${
                        modoTransferencia === 'NENHUMA' ? 'text-slate-200' : 'text-slate-500'
                      }`}
                    >
                      Manter vínculos atuais sem mover
                    </p>
                  </button>
                </div>

                {/* Lista completa das indústrias do promotor anterior (sempre visível) */}
                <div className="bg-white rounded-xl border border-amber-200 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                      <input
                        type="text"
                        value={buscaIndustriaLista}
                        onChange={(e) => setBuscaIndustriaLista(e.target.value)}
                        placeholder="Filtrar lista de indústrias vinculadas..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1 text-[11px] font-semibold"
                      />
                    </div>
                    {modoTransferencia === 'MANUAL' && (
                      <div className="flex items-center gap-2 text-[11px] font-black">
                        <button
                          type="button"
                          onClick={() => setCnpjsSelecionados(vinculosAntigo.map((v) => v.cnpj))}
                          className="text-blue-700 hover:underline cursor-pointer"
                        >
                          Selecionar todas
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => setCnpjsSelecionados([])}
                          className="text-slate-600 hover:underline cursor-pointer"
                        >
                          Desmarcar todas
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                    {vinculosAntigoFiltrados.map((ind) => {
                      const selecionada =
                        modoTransferencia === 'TODAS'
                          ? true
                          : modoTransferencia === 'NENHUMA'
                          ? false
                          : cnpjsSelecionados.includes(ind.cnpj);
                      const jaNoSubstituto = previaTransferencia.cnpjsJaNoDestino.includes(
                        ind.cnpj
                      );

                      return (
                        <label
                          key={ind.cnpj}
                          className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border text-xs ${
                            modoTransferencia === 'MANUAL' ? 'cursor-pointer' : 'cursor-default'
                          } ${
                            selecionada
                              ? 'bg-blue-50/50 border-blue-200'
                              : 'bg-slate-50/60 border-slate-100 opacity-80'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={selecionada}
                              disabled={modoTransferencia !== 'MANUAL'}
                              onChange={() => {
                                if (modoTransferencia === 'MANUAL') toggleCnpj(ind.cnpj);
                              }}
                              className="rounded text-blue-700"
                            />
                            <span className="font-bold text-slate-800 truncate">{ind.nome}</span>
                            {jaNoSubstituto && (
                              <span className="text-[10px] font-black uppercase bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded shrink-0">
                                Já no substituto (sem duplicidade)
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-slate-500 shrink-0 tabular-nums">
                            {ind.cnpjFormatado}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Prévia clara da quantidade de vínculos que serão transferidos */}
                <div className="bg-white rounded-xl border border-slate-200 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-slate-50">
                    <span className="text-[10px] font-black uppercase text-slate-500 block">
                      Total na Origem
                    </span>
                    <span className="text-base font-black text-slate-900 font-mono tabular-nums">
                      {previaTransferencia.totalOrigem}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-blue-50">
                    <span className="text-[10px] font-black uppercase text-blue-700 block">
                      Serão Transferidos
                    </span>
                    <span className="text-base font-black text-blue-900 font-mono tabular-nums">
                      {previaTransferencia.totalSelecionadas}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-emerald-50">
                    <span className="text-[10px] font-black uppercase text-emerald-700 block">
                      Novos no Substituto
                    </span>
                    <span className="text-base font-black text-emerald-900 font-mono tabular-nums">
                      {previaTransferencia.novasNoDestino}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-amber-50">
                    <span className="text-[10px] font-black uppercase text-amber-800 block">
                      {previaTransferencia.jaVinculadasNoDestino > 0
                        ? 'Duplicidades Evitadas'
                        : 'Ficam na Origem'}
                    </span>
                    <span className="text-base font-black text-amber-950 font-mono tabular-nums">
                      {previaTransferencia.jaVinculadasNoDestino > 0
                        ? previaTransferencia.jaVinculadasNoDestino
                        : previaTransferencia.permanecemNaOrigem}
                    </span>
                  </div>
                </div>

                {/* Confirmação Explícita Obrigatória */}
                {precisaConfirmarTransferencia ? (
                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border-2 border-amber-400 text-xs font-bold text-slate-900 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={confirmarTransferencia}
                      onChange={(e) => setConfirmarTransferencia(e.target.checked)}
                      className="mt-0.5 rounded text-amber-700"
                    />
                    <span>
                      Confirmo explicitamente transferir{' '}
                      <strong className="text-blue-800 font-mono tabular-nums">
                        {previaTransferencia.totalSelecionadas}
                      </strong>{' '}
                      vínculo(s) de indústria de <strong>{promotorAtual?.nome}</strong> para o
                      promotor substituto (preservando o histórico anterior e prevenindo duplicidades).
                    </span>
                  </label>
                ) : (
                  <p className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Nenhuma indústria será transferida nesta operação.</span>
                  </p>
                )}
              </>
            )}
          </div>

          {/* 4. Situação do Promotor Anterior e Motivo */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 space-y-2.5">
            <span className="text-xs font-black uppercase text-slate-800 block">
              4. Situação do Promotor Anterior ({promotorAtual?.nome || 'Não selecionado'})
            </span>

            {promotorAtual?.agenciaNome && (
              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={desvincularDaAgencia}
                  onChange={(e) => setDesvincularDaAgencia(e.target.checked)}
                  className="mt-0.5 rounded text-blue-700"
                />
                <span>
                  Desvincular <strong>{promotorAtual.nome}</strong> da agência{' '}
                  <strong>{promotorAtual.agenciaNome}</strong> (preservando todo o histórico)
                </span>
              </label>
            )}

            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={marcarComoInativo}
                onChange={(e) => setMarcarComoInativo(e.target.checked)}
                className="mt-0.5 rounded text-blue-700"
              />
              <span>
                Inativar promotor anterior após a transferência (<strong>INATIVO</strong> — sem excluir
                definitivamente e permitindo reativação futura)
              </span>
            </label>

            <div className="pt-1">
              <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                Motivo / Observação da Transferência
              </label>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex: Troca de promotor na rota, redistribuição de carteira, férias..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-black uppercase text-slate-700 bg-slate-100 hover:bg-slate-200 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={
                isSubmitting ||
                !promotorAtual ||
                (precisaConfirmarTransferencia &&
                  (!confirmarTransferencia || previaTransferencia.totalSelecionadas === 0))
              }
              className="px-5 py-2.5 rounded-xl text-xs font-black uppercase text-white bg-amber-600 hover:bg-amber-700 flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>
                {isSubmitting
                  ? 'Executando transferência atômica...'
                  : precisaConfirmarTransferencia
                  ? `Confirmar e Transferir (${previaTransferencia.totalSelecionadas})`
                  : 'Confirmar Substituição'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
