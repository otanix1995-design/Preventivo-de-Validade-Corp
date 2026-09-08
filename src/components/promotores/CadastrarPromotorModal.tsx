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
  SETORES_DISPONIVEIS
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
  const [matricula, setMatricula] = useState('');
  const [filialId, setFilialId] = useState('172');
  const [setorId, setSetorId] = useState('FRIOS');
  const [permissoes, setPermissoes] = useState<PermissoesPromotor>({
    ...PERMISSOES_PADRAO_PROMOTOR,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!isOpen) return null;

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
      setErro('Por favor, informe o Nome Completo do Promotor.');
      return;
    }

    const filialSelecionada = FILIAIS_DISPONIVEIS.find((f) => f.filialId === filialId) || {
      filialId: '172',
      filialNome: 'Cascavel',
    };

    const setorSelecionado = SETORES_DISPONIVEIS.find((s) => s.id === setorId) || {
      id: 'FRIOS',
      nome: 'Frios',
    };

    setIsSubmitting(true);
    try {
      const novo = await promotorService.cadastrarPromotor({
        nome: nomeFormatado,
        matricula: matricula.trim() || undefined,
        filialId: filialSelecionada.filialId,
        filialNome: filialSelecionada.filialNome,
        setorId: setorSelecionado.id,
        setorNome: setorSelecionado.nome,
        permissoes,
      });

      // Reset form
      setNome('');
      setMatricula('');
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
          {/* Dados Pessoais e de Identificação */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
                Nome do Promotor <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Carlos Mendes"
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 text-sm font-semibold text-gray-900 placeholder:text-gray-400 transition-all outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
                Identificação / Matrícula
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
                Status Inicial
              </label>
              <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-black text-amber-900 uppercase flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>PENDENTE DE VÍNCULO</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
                Filial Operacional
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

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
                Setor de Atuação
              </label>
              <select
                value={setorId}
                onChange={(e) => setSetorId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 text-sm font-semibold text-gray-900 transition-all outline-hidden bg-white"
              >
                {SETORES_DISPONIVEIS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
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
