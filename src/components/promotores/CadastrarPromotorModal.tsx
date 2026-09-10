import {
  Check,
  CheckSquare,
  ShieldCheck,
  Square,
  UserPlus,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { promotorService } from '../../services/promotorService';
import {
  FILIAIS_DISPONIVEIS,
  PERMISSOES_PADRAO_PROMOTOR,
  PermissoesPromotor,
  Promotor,
  SETORES_DISPONIVEIS,
  SetorPromotor
} from '../../types';

interface CadastrarPromotorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPromotorCadastrado: (promotor: Promotor) => void;
}

export const CadastrarPromotorModal: React.FC<CadastrarPromotorModalProps> = ({
  isOpen,
  onClose,
  onPromotorCadastrado,
}) => {
  const [nome, setNome] = useState('');
  const [agenciaNome, setAgenciaNome] = useState('');
  const [matricula, setMatricula] = useState('');
  const [filialId, setFilialId] = useState('172');
  const [setores, setSetores] = useState<SetorPromotor[]>(['FRIOS']);
  const [permissoes, setPermissoes] = useState<PermissoesPromotor>({
    ...PERMISSOES_PADRAO_PROMOTOR,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleSetor = (setor: SetorPromotor) => {
    setSetores((prev) => {
      if (prev.includes(setor)) {
        return prev.filter((s) => s !== setor);
      } else {
        return [...prev, setor];
      }
    });
  };

  const togglePermissao = (key: keyof PermissoesPromotor) => {
    setPermissoes((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSelectAll = (habilitar: boolean) => {
    setPermissoes({
      consultarProduto: habilitar,
      escanearEAN: habilitar,
      cadastrarVencimento: habilitar,
      atualizarQuantidade: habilitar,
      visualizarPendencias: habilitar,
      enviarAoComprador: habilitar,
      visualizarHistorico: habilitar,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    const nomeFormatado = nome.trim();
    if (!nomeFormatado) {
      setErro('O Nome do Promotor é obrigatório.');
      return;
    }

    const agenciaFormatada = agenciaNome.trim();
    if (!agenciaFormatada) {
      setErro('A Agência / Empresa responsável pelo promotor é obrigatória.');
      return;
    }

    if (!setores || setores.length === 0) {
      setErro('Selecione pelo menos um setor de atuação.');
      return;
    }

    const filialSelecionada = FILIAIS_DISPONIVEIS.find((f) => f.filialId === filialId) || {
      filialId: '172',
      filialNome: 'Cascavel',
    };

    setIsSubmitting(true);
    try {
      const novo = await promotorService.cadastrarPromotor({
        nome: nomeFormatado,
        agenciaNome: agenciaFormatada,
        matricula: matricula.trim() || undefined,
        filialId: filialSelecionada.filialId,
        filialNome: filialSelecionada.filialNome,
        setores,
        permissoes,
      });

      // Reset form
      setNome('');
      setAgenciaNome('');
      setMatricula('');
      setSetores(['FRIOS']);
      setPermissoes({ ...PERMISSOES_PADRAO_PROMOTOR });
      onPromotorCadastrado(novo);
    } catch (err: any) {
      setErro(err.message || 'Erro ao cadastrar promotor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const permissoesDef = [
    {
      key: 'consultarProduto' as const,
      titulo: 'Consultar Produto',
      desc: 'Pesquisar descrição, código interno, estoque físico e detalhes do produto.',
    },
    {
      key: 'escanearEAN' as const,
      titulo: 'Escanear EAN / Código de Barras',
      desc: 'Leitura de códigos de barras com a câmera do aparelho no salão de vendas.',
    },
    {
      key: 'cadastrarVencimento' as const,
      titulo: 'Cadastrar Vencimento',
      desc: 'Registrar novos lotes e datas de validade para mercadorias do setor.',
    },
    {
      key: 'atualizarQuantidade' as const,
      titulo: 'Atualizar Quantidade',
      desc: 'Ajustar quantidades de unidades em lotes previamente cadastrados.',
    },
    {
      key: 'visualizarPendencias' as const,
      titulo: 'Visualizar Pendências',
      desc: 'Acompanhar a lista de itens próximos ao vencimento da filial.',
    },
    {
      key: 'enviarAoComprador' as const,
      titulo: 'Marcar Enviar ao Comprador',
      desc: 'Sinalizar produtos críticos para intervenção e negociação com o comprador.',
    },
    {
      key: 'visualizarHistorico' as const,
      titulo: 'Visualizar Histórico Próprio',
      desc: 'Consultar auditoria e histórico de ações realizadas pelo próprio promotor.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-gray-200 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                NOVO CADASTRO
              </span>
              <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight mt-0.5">
                Cadastrar Promotor
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {erro && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
            <span>⚠ {erro}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. NOME DO PROMOTOR */}
          <div>
            <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
              NOME DO PROMOTOR <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Maria Silva"
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 text-sm font-semibold text-gray-900 placeholder:text-gray-400 transition-all outline-hidden"
            />
          </div>

          {/* 2. AGÊNCIA / EMPRESA */}
          <div>
            <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
              AGÊNCIA / EMPRESA <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              value={agenciaNome}
              onChange={(e) => setAgenciaNome(e.target.value)}
              placeholder="Ex: Agência responsável pelo promotor"
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 text-sm font-semibold text-gray-900 placeholder:text-gray-400 transition-all outline-hidden"
            />
          </div>

          {/* 3. IDENTIFICAÇÃO / MATRÍCULA & STATUS INICIAL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
                IDENTIFICAÇÃO / MATRÍCULA
              </label>
              <input
                type="text"
                value={matricula}
                onChange={(e) => setMatricula(e.target.value)}
                placeholder="Ex: MAT-88421 (opcional)"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 text-sm font-semibold text-gray-900 placeholder:text-gray-400 transition-all outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
                STATUS INICIAL
              </label>
              <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-black text-amber-900 uppercase flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span>PENDENTE DE VÍNCULO</span>
              </div>
            </div>
          </div>

          {/* 4. FILIAL OPERACIONAL */}
          <div>
            <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
              FILIAL OPERACIONAL
            </label>
            <select
              value={filialId}
              onChange={(e) => setFilialId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 text-sm font-semibold text-gray-900 transition-all outline-hidden bg-white"
            >
              {FILIAIS_DISPONIVEIS.map((f) => (
                <option key={f.filialId} value={f.filialId}>
                  Filial {f.filialId} — {f.filialNome}
                </option>
              ))}
            </select>
          </div>

          {/* 5. SETOR DE ATUAÇÃO * (MÚLTIPLA SELEÇÃO: FRIOS / LOJA) */}
          <div className="bg-blue-50/40 rounded-xl p-3.5 border border-blue-100 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-black text-gray-800 uppercase tracking-wider">
                SETOR DE ATUAÇÃO <span className="text-rose-600">*</span>
              </label>
              <span className="text-[11px] font-bold text-blue-700 uppercase">
                {setores.length === 2 ? 'Atende ambos' : setores.length === 1 ? `${setores[0]} selecionado` : 'Nenhum selecionado'}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 font-medium">
              Marque os setores que o promotor pode atender (FRIOS, LOJA ou ambos).
            </p>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              {SETORES_DISPONIVEIS.map((s) => {
                const checked = setores.includes(s.id as SetorPromotor);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSetor(s.id as SetorPromotor)}
                    className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-xs font-black uppercase tracking-wider transition-all cursor-pointer select-none text-left ${
                      checked
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-white stroke-[2.5] shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-400 stroke-[2] shrink-0" />
                    )}
                    <span>{s.nome}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Permissões do Promotor */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-700 stroke-[2.5]" />
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                  Permissões no App do Promotor
                </h3>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-black uppercase">
                <button
                  type="button"
                  onClick={() => handleSelectAll(true)}
                  className="text-blue-700 hover:underline cursor-pointer"
                >
                  Todas
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={() => handleSelectAll(false)}
                  className="text-gray-500 hover:underline cursor-pointer"
                >
                  Nenhuma
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {permissoesDef.map((p) => {
                const checked = permissoes[p.key];
                return (
                  <label
                    key={p.key}
                    onClick={() => togglePermissao(p.key)}
                    className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all cursor-pointer select-none ${
                      checked
                        ? 'bg-blue-50/50 border-blue-200 shadow-2xs'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="pt-0.5 shrink-0">
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-blue-700 fill-blue-100 stroke-[2.5]" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400 stroke-[2]" />
                      )}
                    </div>
                    <div className="grow">
                      <p className={`text-xs font-black uppercase tracking-tight ${
                        checked ? 'text-blue-900' : 'text-gray-700'
                      }`}>
                        {p.titulo}
                      </p>
                      <p className="text-[11px] text-gray-500 font-medium leading-normal mt-0.5">
                        {p.desc}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-blue-700 hover:bg-blue-800 transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>{isSubmitting ? 'Salvando...' : 'Salvar Promotor'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
