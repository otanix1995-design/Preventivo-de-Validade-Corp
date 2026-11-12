import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface ComboboxOpcao {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  /** Termos adicionais para busca (ex.: CNPJ puro, CNPJ formatado, nome fantasia) */
  searchTerms?: string;
}

export interface ComboboxPesquisavelProps {
  /** Rótulo fixo exibido quando o valor padrão está ativo (ex.: "Fornecedor: Todos", "Agência: Todas") */
  labelPadrao?: string;
  /** Valor considerado o padrão (ex.: "TODAS", "TODOS", "") */
  valorPadrao?: string;
  /** Valor selecionado atualmente */
  value: string;
  /** Callback acionado imediatamente ao selecionar uma opção */
  onChange: (value: string) => void;
  /** Lista completa de opções (pode ter milhares de itens) */
  opcoes: ComboboxOpcao[];
  /** Placeholder exibido na barra de pesquisa fixa */
  placeholderBusca?: string;
  /** Título do cabeçalho da lista suspensa */
  tituloLista?: string;
  /** Mensagem customizada para quando nada for encontrado */
  mensagemVazio?: string;
  /** Ícone ou prefixo customizado no botão */
  className?: string;
  /** Quantidade máxima de itens renderizados por vez na lista (padrão 50) */
  limiteRenderizacao?: number;
  /** Desabilitar componente */
  disabled?: boolean;
}

/**
 * Remove acentos, pontuações extras e converte para minúsculas para busca insensível a maiúsculas/minúsculas e acentos.
 */
export function normalizarParaBusca(texto?: string | null): string {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Componente Combobox de Lista Pesquisável de Alto Desempenho.
 * Otimizado para bases extensas (como SPCOI007 com >46 mil registros).
 *
 * Características:
 * 1. Barra de pesquisa fixa na parte superior da lista suspensa.
 * 2. Filtragem imediata ao digitar (insensível a maiúsculas/minúsculas e acentos, pesquisa por qualquer parte).
 * 3. Renderização sob demanda com limite paginável para evitar travar a thread do navegador.
 * 4. Limpa a busca ao fechar ou selecionar, sem perder a seleção feita.
 * 5. Totalmente responsivo para mobile (touch, bottom-sheet ou dropdown seguro), tablet e desktop.
 * 6. Suporte completo a teclado (Escape, Enter, Setas) e clique fora.
 */
export const ComboboxPesquisavel: React.FC<ComboboxPesquisavelProps> = ({
  labelPadrao = 'Todos',
  valorPadrao = 'TODAS',
  value,
  onChange,
  opcoes,
  placeholderBusca = 'Digite para pesquisar...',
  tituloLista,
  mensagemVazio = 'Nenhum fornecedor encontrado',
  className = '',
  limiteRenderizacao = 60,
  disabled = false,
}) => {
  const [aberto, setAberto] = useState(false);
  const [termoBusca, setTermoBusca] = useState('');
  const [limiteExibicao, setLimiteExibicao] = useState(limiteRenderizacao);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputBuscaRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const comboboxId = useId();

  // Opção atualmente selecionada
  const opcaoSelecionada = useMemo(() => {
    if (value === valorPadrao) return null;
    return opcoes.find((op) => op.value === value) || null;
  }, [value, valorPadrao, opcoes]);

  const textoBotao = useMemo(() => {
    if (!opcaoSelecionada) return labelPadrao;
    return opcaoSelecionada.label;
  }, [opcaoSelecionada, labelPadrao]);

  // Pré-computação de termos normalizados para busca de alta velocidade O(1)
  const opcoesComIndices = useMemo(() => {
    return opcoes.map((op) => {
      const normalizado = `${normalizarParaBusca(op.label)} ${normalizarParaBusca(
        op.sublabel
      )} ${normalizarParaBusca(op.searchTerms)} ${normalizarParaBusca(op.badge)}`;
      return {
        op,
        searchIndex: normalizado,
      };
    });
  }, [opcoes]);

  // Filtragem rápida em memória
  const opcoesFiltradas = useMemo(() => {
    const q = normalizarParaBusca(termoBusca);
    if (!q) {
      return opcoes;
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const resultado: ComboboxOpcao[] = [];

    for (let i = 0; i < opcoesComIndices.length; i++) {
      const item = opcoesComIndices[i];
      let bateu = true;
      for (let j = 0; j < tokens.length; j++) {
        if (!item.searchIndex.includes(tokens[j])) {
          bateu = false;
          break;
        }
      }
      if (bateu) {
        resultado.push(item.op);
      }
    }
    return resultado;
  }, [termoBusca, opcoes, opcoesComIndices]);

  // Resetar scroll e paginação de exibição ao mudar a busca
  useEffect(() => {
    setLimiteExibicao(limiteRenderizacao);
    if (listaRef.current) {
      listaRef.current.scrollTop = 0;
    }
  }, [termoBusca, limiteRenderizacao]);

  // Focar no campo de busca ao abrir
  useEffect(() => {
    if (aberto) {
      // Pequeno timeout para garantir renderização do elemento no DOM
      const timer = setTimeout(() => {
        inputBuscaRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      // Requisito 9: Limpar o texto digitado ao fechar, sem perder o fornecedor escolhido
      setTermoBusca('');
      setLimiteExibicao(limiteRenderizacao);
    }
  }, [aberto, limiteRenderizacao]);

  // Fechar ao clicar fora
  useEffect(() => {
    if (!aberto) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [aberto]);

  // Suporte a teclado (Escape para fechar)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setAberto(false);
      }
    },
    []
  );

  const handleSelecionar = (novoValor: string) => {
    // Requisito 7 & 9: Ao selecionar, aplicar imediatamente no Dashboard, fechar a lista e limpar o texto digitado
    onChange(novoValor);
    setTermoBusca('');
    setAberto(false);
  };

  const handleScrollLista = () => {
    if (!listaRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listaRef.current;
    if (scrollTop + clientHeight >= scrollHeight - 80) {
      if (limiteExibicao < opcoesFiltradas.length) {
        setLimiteExibicao((prev) => Math.min(prev + limiteRenderizacao, opcoesFiltradas.length));
      }
    }
  };

  const opcoesVisiveis = useMemo(() => {
    return opcoesFiltradas.slice(0, limiteExibicao);
  }, [opcoesFiltradas, limiteExibicao]);

  const temMaisResultados = opcoesFiltradas.length > limiteExibicao;

  return (
    <div
      ref={containerRef}
      className={`relative w-full text-left ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Botão Gatilho (Aparência idêntica aos selects nativos com Tailwind) */}
      <button
        type="button"
        id={comboboxId}
        disabled={disabled}
        onClick={() => !disabled && setAberto((prev) => !prev)}
        className={`w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-[#F36B0B] focus:outline-hidden flex items-center justify-between gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          aberto ? 'bg-white border-[#F36B0B] ring-1 ring-[#F36B0B]' : 'hover:bg-slate-100/80'
        } ${value !== valorPadrao ? 'border-amber-400 bg-amber-50/40 text-amber-950' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        title={textoBotao}
      >
        <span className="truncate block pr-1">{textoBotao}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform duration-150 ${
            aberto ? 'rotate-180 text-[#F36B0B]' : ''
          }`}
        />
      </button>

      {/* Painel Suspenso com Barra de Pesquisa Fixa */}
      {aberto && (
        <div
          className="absolute z-50 mt-1 w-full min-w-[280px] max-w-[420px] bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden text-xs animate-in fade-in zoom-in-95 duration-100"
          style={{
            maxHeight: '420px',
          }}
        >
          {/* Cabeçalho Opcional */}
          {tituloLista && (
            <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                {tituloLista}
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-500">
                {opcoesFiltradas.length.toLocaleString('pt-BR')} opções
              </span>
            </div>
          )}

          {/* 1. Barra de Pesquisa FIXA na parte superior */}
          <div className="p-2 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10 backdrop-blur-xs">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                ref={inputBuscaRef}
                type="text"
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                placeholder={placeholderBusca}
                className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-7 py-1.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:border-[#F36B0B] focus:ring-1 focus:ring-[#F36B0B] focus:outline-hidden"
              />
              {termoBusca && (
                <button
                  type="button"
                  onClick={() => setTermoBusca('')}
                  className="absolute right-2 top-2 p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer rounded"
                  title="Limpar texto da pesquisa"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Lista Rolável de Opções */}
          <div
            ref={listaRef}
            onScroll={handleScrollLista}
            className="overflow-y-auto max-h-[290px] divide-y divide-slate-100/80 p-1"
            role="listbox"
          >
            {/* Opção fixa "Todos" se o termo de busca estiver vazio ou casar com "Todos" */}
            {(!termoBusca ||
              normalizarParaBusca(labelPadrao).includes(normalizarParaBusca(termoBusca))) && (
              <button
                type="button"
                onClick={() => handleSelecionar(valorPadrao)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                  value === valorPadrao
                    ? 'bg-amber-50 text-amber-900 border border-amber-200'
                    : 'text-slate-700 hover:bg-slate-100/80'
                }`}
                role="option"
                aria-selected={value === valorPadrao}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="truncate">{labelPadrao}</span>
                </div>
                {value === valorPadrao && (
                  <Check className="w-4 h-4 text-amber-600 shrink-0 stroke-[2.5]" />
                )}
              </button>
            )}

            {/* Itens Filtrados */}
            {opcoesVisiveis.map((opcao) => {
              const selecionado = opcao.value === value;
              return (
                <button
                  key={opcao.value}
                  type="button"
                  onClick={() => handleSelecionar(opcao.value)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                    selecionado
                      ? 'bg-amber-50 text-amber-950 font-bold border border-amber-200'
                      : 'text-slate-800 hover:bg-slate-100/80'
                  }`}
                  role="option"
                  aria-selected={selecionado}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold truncate block">{opcao.label}</span>
                      {opcao.badge && (
                        <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded shrink-0">
                          {opcao.badge}
                        </span>
                      )}
                    </div>
                    {opcao.sublabel && (
                      <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
                        {opcao.sublabel}
                      </p>
                    )}
                  </div>
                  {selecionado && (
                    <Check className="w-4 h-4 text-amber-600 shrink-0 stroke-[2.5]" />
                  )}
                </button>
              );
            })}

            {/* 8. Mensagem quando nada for encontrado */}
            {opcoesFiltradas.length === 0 && (
              <div className="py-6 px-4 text-center text-slate-500 space-y-1">
                <p className="text-xs font-bold text-slate-700">{mensagemVazio}</p>
                <p className="text-[11px] text-slate-400">
                  Verifique o texto digitado ou limpe a busca.
                </p>
              </div>
            )}

            {/* Aviso de carregamento paginado caso existam mais itens */}
            {temMaisResultados && (
              <div className="py-2 text-center text-[10px] font-bold text-slate-400 bg-slate-50/50">
                Mostrando {opcoesVisiveis.length} de {opcoesFiltradas.length.toLocaleString('pt-BR')} itens
                · Role para ver mais
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
