import {
  AlertOctagon,
  Check,
  Clock,
  Plus,
  Trash2,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { addDivergencia, deleteDivergencia } from '../services/storage';
import { DivergenciaRegistro, ProdutoSMG } from '../types';
import { LimparDadosAntigosModal } from './LimparDadosAntigosModal';

interface DivergenciasViewProps {
  divergencias: DivergenciaRegistro[];
  produtos: ProdutoSMG[];
  onSelectProdutoByCodigo: (codigoInterno: string) => void;
}

export const DivergenciasView: React.FC<DivergenciasViewProps> = ({
  divergencias,
  produtos,
  onSelectProdutoByCodigo,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [isLimparModalOpen, setIsLimparModalOpen] = useState(false);
  const [novoCodigo, setNovoCodigo] = useState('');
  const [novoTipo, setNovoTipo] = useState<DivergenciaRegistro['tipo']>('ESTOQUE_DIVERGENTE');
  const [novaDescricao, setNovaDescricao] = useState('');
  const [novoImpacto, setNovoImpacto] = useState<DivergenciaRegistro['impacto']>('MEDIO');

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaDescricao.trim()) return;

    addDivergencia({
      codigo_interno: novoCodigo.trim() || undefined,
      tipo: novoTipo,
      descricao: novaDescricao.trim(),
      impacto: novoImpacto,
      status: 'ABERTA',
    });

    setShowAddModal(false);
    setNovoCodigo('');
    setNovaDescricao('');
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Deseja excluir este registro de divergência?')) {
      deleteDivergencia(id);
    }
  };

  return (
    <div id="view-divergencias" className="space-y-4 pb-24 max-w-4xl mx-auto">
      {/* Top Header Card with Bold Typography */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 space-y-3 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-purple-600" />

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center border border-purple-200">
              <AlertOctagon className="w-5 h-5 text-purple-700 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight text-gray-900 leading-tight">
                CONTROLE DE DIVERGÊNCIAS
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                Inconsistências de estoque, cadastro e operação
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsLimparModalOpen(true)}
              className="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
              title="Limpar Histórico e Divergências Antigas"
            >
              <Trash2 className="w-4 h-4 stroke-[2.5]" />
              <span className="hidden sm:inline">Limpar Antigas</span>
            </button>

            <button
              id="btn-abrir-modal-divergencia"
              onClick={() => setShowAddModal(true)}
              className="px-3.5 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-black uppercase tracking-wider text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Registrar</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-700 bg-purple-50 p-2.5 rounded-xl border border-purple-200">
          <span>Total: <strong className="font-mono font-black text-gray-900">{divergencias.length} DIVERGÊNCIAS</strong></span>
          <span>•</span>
          <span>Abertas: <strong className="text-purple-700 font-mono font-black">{divergencias.filter((d) => d.status === 'ABERTA').length}</strong></span>
        </div>
      </div>

      {/* Divergences list */}
      <div className="space-y-2.5">
        {divergencias.length === 0 ? (
          <div className="bg-white rounded-xl p-8 border border-gray-200 text-center space-y-2">
            <Check className="w-10 h-10 text-emerald-500 mx-auto stroke-[2.5]" />
            <p className="text-xs font-black text-gray-700 uppercase tracking-wide">
              Nenhuma divergência registrada.
            </p>
          </div>
        ) : (
          divergencias.map((div) => (
            <div
              key={div.id}
              onClick={() => {
                if (div.codigo_interno) onSelectProdutoByCodigo(div.codigo_interno);
              }}
              className={`bg-white rounded-xl p-4 border border-gray-200 space-y-2.5 transition-all ${
                div.codigo_interno ? 'cursor-pointer hover:border-purple-400 hover:shadow-xs' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                      div.impacto === 'ALTO'
                        ? 'bg-red-100 text-red-800 border border-red-200'
                        : div.impacto === 'MEDIO'
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : 'bg-gray-100 text-gray-700 border border-gray-200'
                    }`}>
                      IMPACTO {div.impacto}
                    </span>

                    {div.codigo_interno && (
                      <span className="text-xs font-mono font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        CÓD: {div.codigo_interno}
                      </span>
                    )}
                  </div>

                  <h3 className="text-sm font-black text-gray-900 leading-snug pt-1">
                    {div.descricao}
                  </h3>
                </div>

                <button
                  onClick={(e) => handleDelete(div.id, e)}
                  className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                  title="Excluir Divergência"
                >
                  <Trash2 className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100 text-gray-500 font-medium">
                <span className="flex items-center gap-1 font-mono">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  {div.data_registro}
                </span>
                <span className="text-[10px] font-black uppercase tracking-wider text-purple-700">
                  {div.tipo.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal: Adicionar Divergência Manual */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-gray-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-5 border border-gray-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">
                Registrar Divergência
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-full text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Código Interno da Mercadoria (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ex: 46135"
                  value={novoCodigo}
                  onChange={(e) => setNovoCodigo(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-hidden focus:border-purple-600 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Tipo de Divergência
                </label>
                <select
                  value={novoTipo}
                  onChange={(e) => setNovoTipo(e.target.value as any)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:outline-hidden focus:border-purple-600"
                >
                  <option value="ESTOQUE_DIVERGENTE">Estoque Físico Divergente do Sistema</option>
                  <option value="EAN_NAO_ENCONTRADO">EAN Sem Cadastro</option>
                  <option value="DUPLICIDADE_EAN">EAN Duplicado</option>
                  <option value="MERCADORIA_SEM_GIRO">Mercadoria Parada / Sem Giro</option>
                  <option value="OUTRO">Outra Inconsistência</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Nível de Impacto
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['BAIXO', 'MEDIO', 'ALTO'] as const).map((imp) => (
                    <button
                      key={imp}
                      type="button"
                      onClick={() => setNovoImpacto(imp)}
                      className={`py-2 text-xs font-black uppercase tracking-wider rounded-xl border transition-all ${
                        novoImpacto === imp
                          ? 'bg-purple-700 text-white border-purple-700 shadow-xs'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {imp}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Descrição do Problema Observado *
                </label>
                <textarea
                  required
                  rows={3}
                  value={novaDescricao}
                  onChange={(e) => setNovaDescricao(e.target.value)}
                  placeholder="Ex: Sistema aponta 24 unidades mas só existem 6 na gôndola e 0 no depósito..."
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl p-3 text-xs font-medium text-gray-900 focus:outline-hidden focus:border-purple-600"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="w-1/3 py-2.5 rounded-xl border border-gray-300 text-xs font-black uppercase text-gray-700 hover:bg-gray-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-black uppercase tracking-wider shadow-md"
                >
                  Salvar Registro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Limpar Dados Antigos */}
      <LimparDadosAntigosModal
        isOpen={isLimparModalOpen}
        onClose={() => setIsLimparModalOpen(false)}
        initialPreset="TUDO"
      />
    </div>
  );
};
