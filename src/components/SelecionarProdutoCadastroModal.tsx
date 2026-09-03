import {
  ArrowRight,
  Barcode,
  Boxes,
  Camera,
  CornerDownLeft,
  Hash,
  Package,
  Search,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatarEstoquePdf } from '../services/pdfReport';
import { productRepository } from '../services/productRepository';
import { findProdutoByCodeOrEan, searchProdutos } from '../services/storage';
import { ProdutoSMG } from '../types';

interface SelecionarProdutoCadastroModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduto: (produto: ProdutoSMG) => void;
  onOpenScanner: () => void;
}

export const SelecionarProdutoCadastroModal: React.FC<SelecionarProdutoCadastroModalProps> = ({
  isOpen,
  onClose,
  onSelectProduto,
  onOpenScanner,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Search logic: checks direct exact code, and fast list search
  const { exactMatch, searchResults } = useMemo(() => {
    const q = query.trim();
    if (!q) {
      return { exactMatch: undefined, searchResults: [] };
    }

    // Direct lookup by internal code or EAN
    const exact = findProdutoByCodeOrEan(q);

    // List of results
    const list = searchProdutos(q, { limit: 12 });

    return {
      exactMatch: exact,
      searchResults: list,
    };
  }, [query]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (exactMatch) {
        onSelectProduto(exactMatch);
      } else if (searchResults.length === 1) {
        onSelectProduto(searchResults[0]);
      }
    }
  };

  return (
    <div
      id="modal-selecionar-produto-cadastro"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh] overflow-hidden border border-gray-200 animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="bg-blue-700 px-5 py-4 text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center border border-white/20">
              <Package className="w-5 h-5 text-white stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-base font-black uppercase tracking-wide">
                Cadastrar Vencimento
              </h2>
              <p className="text-xs text-blue-100 font-medium">
                Localize a mercadoria para registrar a validade
              </p>
            </div>
          </div>
          <button
            id="btn-close-selecionar-produto-modal"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* OPTION 1: ESCANEAR CÓDIGO DE BARRAS (CÂMERA) */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50/60 p-4 rounded-xl border-2 border-blue-200/80 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-700 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <Camera className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-blue-900">
                      Escanear pela Câmera
                    </span>
                    <span className="bg-blue-700 text-white text-[9px] font-black uppercase px-1.5 py-0.5 rounded-sm tracking-wider">
                      Automático
                    </span>
                  </div>
                  <p className="text-xs text-blue-800/80 font-medium mt-0.5">
                    Aponte a câmera para ler o código de barras (EAN) da embalagem
                  </p>
                </div>
              </div>

              <button
                id="btn-opcao-escanear-camera"
                type="button"
                onClick={onOpenScanner}
                className="w-full sm:w-auto px-4 py-2.5 bg-blue-700 hover:bg-blue-800 active:bg-blue-950 text-white text-xs font-black uppercase tracking-wider rounded-lg shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-98"
              >
                <Barcode className="w-4 h-4 stroke-[2.5]" />
                <span>Abrir Câmera</span>
              </button>
            </div>
          </div>

          {/* DIVIDER */}
          <div className="relative flex items-center py-1">
            <div className="grow border-t border-gray-200" />
            <span className="shrink mx-3 text-[11px] font-black uppercase text-gray-400 tracking-wider">
              Ou digite o código
            </span>
            <div className="grow border-t border-gray-200" />
          </div>

          {/* OPTION 2: DIGITAR CÓDIGO INTERNO OU EAN MANUALMENTE */}
          <div className="space-y-2.5">
            <label
              htmlFor="input-codigo-cadastro-manual"
              className="text-xs font-black uppercase tracking-wider text-gray-800 flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-blue-700" />
                Digitar Código Interno ou EAN:
              </span>
              <span className="text-[11px] font-normal text-gray-500">
                Ex: 66572 ou 46135
              </span>
            </label>

            <div className="relative flex items-center">
              <div className="absolute left-3 text-gray-400 pointer-events-none">
                <Search className="w-5 h-5 stroke-[2.5]" />
              </div>
              <input
                ref={inputRef}
                id="input-codigo-cadastro-manual"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite o código interno (5 a 6 dígitos), EAN ou nome..."
                className="w-full bg-gray-50 border-2 border-gray-300 focus:border-blue-600 focus:bg-white rounded-xl pl-10 pr-20 py-3 text-sm font-bold text-gray-900 focus:outline-hidden transition-all shadow-xs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 p-1.5 text-gray-400 hover:text-gray-600 rounded-full cursor-pointer"
                  title="Limpar"
                >
                  <X className="w-4 h-4 stroke-[2.5]" />
                </button>
              )}
            </div>

            <p className="text-[11px] text-gray-500 font-medium">
              * Digite o código da mercadoria para ver o produto e avançar para o cadastro.
            </p>
          </div>

          {/* RESULTADOS DA BUSCA MANUAL */}
          {query.trim() && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs font-bold text-gray-600 px-1">
                <span>Mercadorias Encontradas ({searchResults.length}):</span>
                {exactMatch && (
                  <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-emerald-300">
                    Correspondência Exata
                  </span>
                )}
              </div>

              {searchResults.length === 0 ? (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center mx-auto">
                    <Search className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-gray-700">
                    Nenhum produto encontrado com &quot;{query}&quot;
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Verifique o código interno digitado ou tente utilizar a leitura com a câmera.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {searchResults.map((prod) => {
                    const isExact = exactMatch?.codigo_interno === prod.codigo_interno;
                    const estoqueTexto = formatarEstoquePdf(
                      prod.estoque_emb1,
                      prod.estoque_emb9,
                      prod.embalagem,
                      prod.unidade_medida
                    );

                    return (
                      <div
                        key={prod.codigo_interno}
                        onClick={() => onSelectProduto(prod)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isExact
                            ? 'bg-blue-50/70 border-blue-400 hover:bg-blue-100 shadow-xs'
                            : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="bg-amber-300 text-gray-900 px-1.5 py-0.5 rounded-sm font-mono font-black text-xs">
                              {prod.codigo_interno}-{prod.digito || '0'}
                            </span>
                            {isExact && (
                              <span className="text-[10px] font-black text-blue-700 uppercase tracking-wider">
                                Exato
                              </span>
                            )}
                          </div>
                          <h4 className="text-xs font-black text-gray-900 truncate uppercase">
                            {prod.descricao}
                          </h4>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 mt-1">
                            {prod.embalagem && (
                              <span className="flex items-center gap-1 font-medium">
                                <Package className="w-3 h-3 text-gray-400" />
                                {prod.embalagem}
                              </span>
                            )}
                            <span className="flex items-center gap-1 font-bold text-gray-700">
                              <Boxes className="w-3 h-3 text-gray-400" />
                              Estoque: {estoqueTexto}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectProduto(prod);
                          }}
                          className="shrink-0 px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-black text-xs uppercase flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
                        >
                          <span>Cadastrar</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* DICA INICIAL SE NENHUMA BUSCA FOI FEITA */}
          {!query.trim() && (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 text-center space-y-1 text-gray-500">
              <p className="text-xs font-bold text-gray-700">
                Selecione a mercadoria antes de cadastrar o vencimento
              </p>
              <p className="text-[11px]">
                Você pode escanear o código EAN com a câmera ou digitar o código interno acima.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-5 py-3 border-t border-gray-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 active:bg-gray-200 cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
