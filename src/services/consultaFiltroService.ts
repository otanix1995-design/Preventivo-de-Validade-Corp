import { ProdutoSMG, RegistroPlanilhaIsv } from '../types';
import { calcularPosicaoEstoque, isProdutoPesavel, parseEmbalagem } from './codeParser';
import { isvService } from './isvService';
import { productRepository } from './productRepository';

export type FiltroEstoqueConsulta = 'TODOS' | 'COM_ESTOQUE' | 'SEM_ESTOQUE';

export interface GramagemContagem {
  texto: string;
  count: number;
}

export interface ResultadoFiltroConsulta {
  totalTodos: number;
  totalComEstoque: number;
  totalSemEstoque: number;
  resultadosPorEstoque: ProdutoSMG[];
  gramagensDisponiveis: GramagemContagem[];
  filteredResults: ProdutoSMG[];
  totalResults: number;
  totalPages: number;
  safePage: number;
  startIndex: number;
  endIndex: number;
  visibleProducts: ProdutoSMG[];
}

export interface OpcoesFiltroConsulta {
  currentPage?: number;
  pageSize?: number;
  getRegistroOperacionalFn?: (codigoInterno: string, digito?: string) => RegistroPlanilhaIsv | undefined;
  resolverEmbalagemFn?: (codigoInterno: string, digito?: string, embRub?: string) => string;
  getGramagensFn?: (produtos: ProdutoSMG[]) => GramagemContagem[];
  matchesGramagemFn?: (produto: ProdutoSMG, gramagemFilter: string) => boolean;
}

/**
 * Calcula o estoque consolidado local (BASE RUB no IndexedDB / memória)
 * somando EMB1 + EMB9 respeitando a unidade (KG/G ou CX/UN) e o fator de conversão.
 * ZERO chamadas ou escritas ao Firebase.
 */
export function calcularEstoqueConsolidadoConsulta(
  produto: ProdutoSMG,
  regOp?: RegistroPlanilhaIsv,
  embalagemResolvida?: string
): number {
  const emb1Raw = produto.estoque_emb1;
  const emb9Raw = produto.estoque_emb9;

  const temEmb1 = emb1Raw !== undefined && emb1Raw !== null && !Number.isNaN(Number(emb1Raw));
  const temEmb9 = emb9Raw !== undefined && emb9Raw !== null && !Number.isNaN(Number(emb9Raw));
  const emb9Val = temEmb9 ? Number(emb9Raw) : 0;

  // Se existe registro operacional soberano da BASE RUB sem fracionamento em EMB9, priorizar valor consolidado oficial
  if (
    regOp &&
    typeof regOp.estoque === 'number' &&
    !Number.isNaN(regOp.estoque) &&
    emb9Val === 0
  ) {
    return regOp.estoque;
  }

  if (temEmb1 || temEmb9) {
    const embExibicao = embalagemResolvida || produto.embalagem || regOp?.complemento;
    const emb1Val = temEmb1 ? Number(emb1Raw) : 0;
    const embData = parseEmbalagem(embExibicao);

    if (isProdutoPesavel(embExibicao) || embData.produtoPesavel) {
      return emb1Val + emb9Val / 1000;
    }

    const fator =
      produto.fator_embalagem && produto.fator_embalagem > 1
        ? produto.fator_embalagem
        : embData.fator > 1
        ? embData.fator
        : 1;

    const pos = calcularPosicaoEstoque(emb1Val, emb9Val, embExibicao, fator);
    return pos.estoqueTotal;
  }

  if (typeof produto.estoque_total === 'number' && !Number.isNaN(produto.estoque_total)) {
    return produto.estoque_total;
  }

  if (regOp && typeof regOp.estoque === 'number' && !Number.isNaN(regOp.estoque)) {
    return regOp.estoque;
  }

  return 0;
}

/**
 * Pipeline unificado de filtragem da aba Consulta (100% local, antes da paginação):
 * 1. Classifica todos os resultados da busca por estoque consolidado (EMB1 + EMB9).
 * 2. Calcula contadores de Todos / Com estoque / Sem estoque.
 * 3. Aplica o filtro de estoque selecionado.
 * 4. Recalcula as opções e quantidades de Gramagem/Apresentação sobre o conjunto filtrado.
 * 5. Aplica o filtro de Gramagem/Apresentação (se ativo).
 * 6. Pagina o resultado final.
 */
export function filtrarProdutosConsulta(
  allQueryResults: ProdutoSMG[],
  estoqueFilter: FiltroEstoqueConsulta,
  gramagemFilter: string | null,
  options?: OpcoesFiltroConsulta
): ResultadoFiltroConsulta {
  const pageSize = options?.pageSize && options.pageSize > 0 ? options.pageSize : 10;
  const requestedPage = options?.currentPage && options.currentPage > 0 ? options.currentPage : 1;

  const getRegOp =
    options?.getRegistroOperacionalFn ||
    ((cod: string, dig?: string) => isvService.getRegistroOperacional(cod, dig));
  const resolveEmb =
    options?.resolverEmbalagemFn ||
    ((cod: string, dig?: string, embRub?: string) =>
      isvService.resolverEmbalagemSpcoi(cod, dig, embRub).embalagem);
  const getGramagens =
    options?.getGramagensFn ||
    ((items: ProdutoSMG[]) => productRepository.getGramagensDisponiveis(items));
  const matchesGramagem =
    options?.matchesGramagemFn ||
    ((p: ProdutoSMG, gram: string) => productRepository.matchesGramagem(p, gram));

  const comEstoqueList: ProdutoSMG[] = [];
  const semEstoqueList: ProdutoSMG[] = [];

  for (let i = 0; i < allQueryResults.length; i++) {
    const prod = allQueryResults[i];
    const regOp = getRegOp(prod.codigo_interno, prod.digito) || prod.dados_operacionais;
    const embResolvida = resolveEmb(
      prod.codigo_interno,
      prod.digito,
      prod.embalagem || regOp?.complemento
    );
    const estoqueConsolidado = calcularEstoqueConsolidadoConsulta(prod, regOp, embResolvida);

    if (estoqueConsolidado > 0) {
      comEstoqueList.push(prod);
    } else {
      semEstoqueList.push(prod);
    }
  }

  const resultadosPorEstoque =
    estoqueFilter === 'TODOS'
      ? allQueryResults
      : estoqueFilter === 'COM_ESTOQUE'
      ? comEstoqueList
      : semEstoqueList;

  const gramagensDisponiveis =
    resultadosPorEstoque.length > 0 ? getGramagens(resultadosPorEstoque) : [];

  const gramagemTrim = gramagemFilter?.trim() || null;
  const filteredResults = gramagemTrim
    ? resultadosPorEstoque.filter((p) => matchesGramagem(p, gramagemTrim))
    : resultadosPorEstoque;

  const totalResults = filteredResults.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const safePage = Math.min(requestedPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalResults);
  const visibleProducts = filteredResults.slice(startIndex, startIndex + pageSize);

  return {
    totalTodos: allQueryResults.length,
    totalComEstoque: comEstoqueList.length,
    totalSemEstoque: semEstoqueList.length,
    resultadosPorEstoque,
    gramagensDisponiveis,
    filteredResults,
    totalResults,
    totalPages,
    safePage,
    startIndex,
    endIndex,
    visibleProducts,
  };
}
