import {
  AlertCircle,
  ArrowRight,
  Barcode,
  Camera,
  Check,
  CheckCircle2,
  HelpCircle,
  Link2,
  Loader2,
  Package,
  Plus,
  Search,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { cleanEanCode, normalizeCodigoSMGO } from '../services/codeParser';
import { getProdutos, vincularEanManualmente } from '../services/storage';
import { ProdutoSMG } from '../types';

interface VincularEanModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEan?: string;
  initialProduto?: ProdutoSMG | null;
  onOpenScanner?: (currentProduto?: ProdutoSMG | null) => void;
  onSuccess?: (produto: ProdutoSMG, ean: string) => void;
}

export const VincularEanModal: React.FC<VincularEanModalProps> = ({
  isOpen,
  onClose,
  initialEan = '',
  initialProduto = null,
  onOpenScanner,
  onSuccess,
}) => {
  const [ean, setEan] = useState(initialEan);
  const [searchProductQuery, setSearchProductQuery] = useState('');
  const [selectedProduto, setSelectedProduto] = useState<ProdutoSMG | null>(initialProduto);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const todosProdutos = useMemo(() => getProdutos(), [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setEan(initialEan);
      setSelectedProduto(initialProduto);
      setSearchProductQuery(initialProduto ? initialProduto.descricao : '');
      setErrorMessage(null);
      setSuccessMessage(null);
      setIsSubmitting(false);
    }
  }, [isOpen, initialEan, initialProduto]);

  const cleanedEan = cleanEanCode(ean);

  // Search filtered products
  const matchingProdutos = useMemo(() => {
    if (!searchProductQuery || !searchProductQuery.trim()) {
      return todosProdutos.slice(0, 8);
    }

    const q = searchProductQuery.trim();
    const qNorm = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const normCode = normalizeCodigoSMGO(q);

    return todosProdutos
      .filter((p) => {
        if (normCode.codigoInterno && p.codigo_interno.includes(normCode.codigoInterno)) return true;
        if (p.codigo_exibicao && p.codigo_exibicao.includes(q)) return true;
        if (p.descricao && p.descricao.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes(qNorm)) return true;
        if (p.setor_fisico && p.setor_fisico.toUpperCase().includes(qNorm)) return true;
        return false;
      })
      .slice(0, 15);
  }, [searchProductQuery, todosProdutos]);

  // Check if this EAN is already linked to any product
  const existingProductWithEan = useMemo(() => {
    if (!cleanedEan) return null;
    return todosProdutos.find((p) => p.eans && p.eans.includes(cleanedEan));
  }, [cleanedEan, todosProdutos]);

  const handleSaveLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!cleanedEan) {
      setErrorMessage('Por favor, informe um código de barras EAN válido (somente números).');
      return;
    }

    if (!selectedProduto) {
      setErrorMessage('Por favor, selecione a mercadoria da base SMGOI013 para vincular.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await vincularEanManualmente(cleanedEan, selectedProduto.codigo_interno, selectedProduto.descricao);

      if (!res.success || !res.produto) {
        setErrorMessage(res.erro || 'Não foi possível salvar o vínculo.');
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage(`EAN ${cleanedEan} vinculado com sucesso ao produto ${res.produto.codigo_exibicao}!`);

      setTimeout(() => {
        if (onSuccess) {
          onSuccess(res.produto!, cleanedEan);
        }
        onClose();
      }, 600);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro inesperado ao salvar o vínculo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="modal-vincular-ean"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-fade-in overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-lg overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <Link2 className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider">Vincular Código EAN</h2>
              <p className="text-[11px] text-slate-300 font-medium">Associe um código de barras (via câmera ou digitação) à base SMGOI013</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSaveLink} className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Notifications */}
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="font-medium text-xs">{errorMessage}</div>
            </div>
          )}

          {successMessage && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-800 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="font-medium text-xs">{successMessage}</div>
            </div>
          )}

          {/* 1. Opções de Código de Barras (EAN / GTIN) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                <Barcode className="w-3.5 h-3.5 text-blue-700" />
                1. Código de Barras (EAN / GTIN)
              </label>
              <span className="text-[10px] text-gray-400 font-mono font-normal">Somente números</span>
            </div>

            {/* Opção A: Escanear com a Câmera */}
            {onOpenScanner && (
              <button
                type="button"
                id="btn-escanear-ean-camera"
                onClick={() => onOpenScanner(selectedProduto)}
                className="w-full bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border-2 border-dashed border-blue-400 hover:border-blue-600 text-blue-800 p-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-2xs group"
              >
                <div className="bg-blue-600 text-white p-1.5 rounded-lg group-hover:scale-110 transition-transform shadow-xs">
                  <Camera className="w-4 h-4 stroke-[2.5]" />
                </div>
                <div className="text-left">
                  <div className="font-black text-xs text-blue-900 leading-tight">Escanear com a Câmera</div>
                  <div className="text-[10px] text-blue-700 font-medium leading-tight">Apontar leitor para o código de barras da embalagem</div>
                </div>
              </button>
            )}

            {/* Separador */}
            {onOpenScanner && (
              <div className="flex items-center gap-2 py-0.5">
                <div className="flex-1 h-px bg-slate-200"></div>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">ou digite o código de barras</span>
                <div className="flex-1 h-px bg-slate-200"></div>
              </div>
            )}

            {/* Opção B: Digitação manual */}
            <div className="relative flex items-center">
              <input
                id="input-ean-manual"
                type="text"
                value={ean}
                onChange={(e) => setEan(e.target.value)}
                placeholder="Ex: 7891234567895"
                className="w-full bg-slate-50 border-2 border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl pl-3.5 pr-20 py-2.5 text-sm font-mono font-bold text-gray-900 focus:outline-hidden transition-all shadow-2xs"
                autoFocus={!initialEan}
              />
              <div className="absolute right-2 flex items-center gap-1.5">
                {cleanedEan && (
                  <span className="bg-blue-100 text-blue-800 text-[10px] font-mono font-black px-1.5 py-0.5 rounded">
                    {cleanedEan.length}D
                  </span>
                )}
                {onOpenScanner && (
                  <button
                    type="button"
                    onClick={() => onOpenScanner(selectedProduto)}
                    title="Escanear com a câmera"
                    className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-100 active:bg-blue-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4 stroke-[2.5]" />
                  </button>
                )}
              </div>
            </div>

            {existingProductWithEan && existingProductWithEan.codigo_interno !== selectedProduto?.codigo_interno && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px] text-amber-800 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Atenção: Este EAN já está atualmente vinculado a <strong>{existingProductWithEan.codigo_exibicao} - {existingProductWithEan.descricao}</strong>. Ao salvar, ele será reatribuído.
                </span>
              </div>
            )}
          </div>

          {/* 2. Seleção de Produto SMGOI013 */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-blue-700" />
                2. Selecionar Mercadoria SMGOI013
              </span>
              <span className="text-[10px] text-blue-700 font-bold">
                {todosProdutos.length.toLocaleString('pt-BR')} produtos na base
              </span>
            </label>

            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3 pointer-events-none" />
              <input
                id="input-busca-produto-vincular"
                type="text"
                value={searchProductQuery}
                onChange={(e) => setSearchProductQuery(e.target.value)}
                placeholder="Buscar por código (ex: 46135) ou descrição..."
                className="w-full bg-slate-50 border-2 border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl pl-9 pr-8 py-2.5 text-xs font-bold text-gray-900 focus:outline-hidden transition-all shadow-2xs"
              />
              {searchProductQuery && (
                <button
                  type="button"
                  onClick={() => setSearchProductQuery('')}
                  className="absolute right-2.5 top-2.5 p-1 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* List of matching products */}
            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto bg-white divide-y divide-slate-100 shadow-inner">
              {matchingProdutos.length === 0 ? (
                <div className="p-4 text-center text-gray-400 text-xs">
                  Nenhum produto encontrado com "{searchProductQuery}".
                </div>
              ) : (
                matchingProdutos.map((prod) => {
                  const isSelected = selectedProduto?.codigo_interno === prod.codigo_interno;
                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => {
                        setSelectedProduto(prod);
                        setErrorMessage(null);
                      }}
                      className={`w-full text-left p-2.5 transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/90 text-blue-900 border-l-4 border-blue-600'
                          : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-black text-xs text-blue-700 bg-blue-100/60 px-1.5 py-0.2 rounded">
                            {prod.codigo_exibicao}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500 truncate">
                            {prod.embalagem}
                          </span>
                        </div>
                        <p className="text-xs font-black uppercase text-slate-900 truncate mt-0.5">
                          {prod.descricao}
                        </p>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500 font-bold">
                          Est: {prod.estoque_total} UN
                        </span>
                        {isSelected ? (
                          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center text-slate-300">
                            <Plus className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* 3. Preview do Vínculo */}
          {selectedProduto && cleanedEan && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-black uppercase text-blue-900 tracking-wider">
                <span>Resumo da Associação</span>
                <span className="bg-blue-600 text-white text-[9px] px-1.5 py-0.2 rounded font-mono">
                  PRONTO PARA SALVAR
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                  <span className="text-[10px] text-gray-500 uppercase block font-bold">EAN / Código de Barras</span>
                  <strong className="text-blue-900 font-mono text-sm block font-black">{cleanedEan}</strong>
                </div>

                <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                  <span className="text-[10px] text-gray-500 uppercase block font-bold">Mercadoria SMGOI013</span>
                  <strong className="text-gray-900 font-mono text-xs block font-black">{selectedProduto.codigo_exibicao}</strong>
                  <span className="text-[10px] text-gray-600 truncate block font-bold uppercase">{selectedProduto.descricao}</span>
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-gray-300 hover:bg-gray-100 font-black uppercase text-xs text-gray-700 tracking-wider transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !cleanedEan || !selectedProduto}
              className="flex-1 py-2.5 px-4 rounded-xl bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-black text-xs uppercase tracking-wider shadow-md shadow-blue-700/20 flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Salvando Vínculo...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>Confirmar e Salvar Vínculo</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
