/**
 * ISV — SERVIÇO OFICIAL DE RELATÓRIOS PDF
 * Filial: 172 — Cascavel
 * 
 * Padrão Visual Obrigatório Institucional:
 * - Papel A4, orientação paisagem (297mm x 210mm).
 * - Cabeçalho azul-escuro (#0F172A) com identidade "ISV — INTELIGÊNCIA DE ESTOQUE".
 * - Identificação "FILIAL 172 — CASCAVEL".
 * - Data e hora reais de emissão.
 * - Quantidade total de produtos filtrados e valor financeiro total filtrado no cabeçalho.
 * - Faixa laranja (#EA580C) identificando o relatório e resumo legível dos filtros ativos.
 * - Cabeçalho das colunas em AMARELO (#FACC15) com texto em negrito (#0F172A).
 * - Tabela branca, compacta, com linhas pretas (lineWidth: 0.15, lineColor: [0, 0, 0]).
 * - Fonte legível, alinhamento consistente e margens de 10mm.
 * - Rodapé com total real de produtos, valor filtrado e paginação real ("Página X de Y").
 * - Quebra automática de páginas com repetição dos cabeçalhos (showHead: 'everyPage').
 * - NENHUMA coluna de estoque duplicada (apenas uma única coluna "ESTOQUE", regra EMB1 + EMB9).
 * - Download seguro com fallback para evitar bloqueios de navegador / iframe.
 */

import jsPDFModule, { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Construtor universal para ambientes Browser (Vite) e Node.js (testes e build)
const JsPdfClass: typeof jsPDF =
  typeof jsPDFModule === 'function'
    ? jsPDFModule
    : (jsPDFModule as any)?.default || (jsPDFModule as any)?.jsPDF || jsPDF;
import { FiltrosIsv, ItemIsv } from '../types';
import { isvService } from './isvService';
import { promotorService } from './promotorService';
import { formatarMoedaBR } from './deviceId';
import {
  classificarDiasSemVenda,
  extrairAgenciaProduto,
  extrairFornecedorProduto,
  extrairGrupoProduto,
  extrairPromotorProduto,
  formatarEstoqueColunaUnica,
  obterTop30Mercadorias,
} from './isvClassificacaoService';

export interface FiltrosIdentificacaoPdf extends Partial<FiltrosIsv> {
  fornecedor?: string;
  fornecedorCnpj?: string;
  fornecedorNome?: string;
  industria?: string;
  industriaNome?: string;
  promotorNome?: string;
  agenciaNome?: string;
}

export interface EntidadeSelecionadaPdf {
  tipo: 'INDUSTRIA' | 'FORNECEDOR' | 'PROMOTOR' | 'AGENCIA';
  rotulo: string;
  nome: string;
}

export interface IdentificacaoRelatorioPdf {
  tipoRelatorio:
    | 'GERAL_LOJA'
    | 'POR_INDUSTRIA'
    | 'POR_FORNECEDOR'
    | 'POR_PROMOTOR'
    | 'POR_AGENCIA'
    | 'PERSONALIZADO'
    | 'TOP30';
  tituloPrincipal: string;
  destaqueEntidade?: string;
  entidades: EntidadeSelecionadaPdf[];
}

export interface IsvPdfOptions {
  tituloFiltro?: string;
  tipoAgrupamento?: 'GERAL' | 'FORNECEDOR' | 'INDUSTRIA' | 'PROMOTOR' | 'AGENCIA' | 'TOP30';
  nomeEntidade?: string;
  subtituloEntidade?: string;
  /**
   * Controla se valores financeiros do estoque (coluna VALOR ESTOQUE,
   * VALOR TOTAL no cabeçalho, subtotais e rodapés monetários) devem ser inseridos no PDF.
   * Por segurança, o padrão oficial é FALSE (desmarcado).
   */
  incluirValoresFinanceiros?: boolean;
  /** Alias retrocompatível para incluirValoresFinanceiros */
  exibirValorEstoque?: boolean;
  filialNome?: string;
  limiteQuantidade?: number | 'TODOS';
  fonteOficial?: string;
  filtrosDescricao?: string;
  tipoRelatorioTitulo?: string;
  valorTotalFiltrado?: number;
  totalItensFiltrados?: number;
  ordenacaoDescricao?: string;
  filtros?: FiltrosIdentificacaoPdf;
  industriaNome?: string;
  fornecedorNome?: string;
  promotorNome?: string;
  agenciaNome?: string;
  preservarItensRecebidos?: boolean;
  /** Callback opcional (usado em validação/testes) após montagem completa do documento jsPDF */
  onDocBuilt?: (doc: jsPDF) => void;
}

export interface ResultadoExportacaoPdf {
  sucesso: boolean;
  totalItens: number;
  totalPaginas: number;
  tamanhoBytes: number;
  nomeArquivo: string;
  mensagem?: string;
  identificacao?: IdentificacaoRelatorioPdf;
  incluiuValoresFinanceiros?: boolean;
  colunasExportadas?: string[];
}

/**
 * Regra centralizada de segurança para valores financeiros em PDFs.
 * Permanece FALSE por padrão caso não seja explicitamente habilitada pelo usuário.
 */
export function deveIncluirValoresFinanceirosPdf(options?: Partial<IsvPdfOptions>): boolean {
  if (!options) return false;
  if (options.incluirValoresFinanceiros !== undefined) {
    return options.incluirValoresFinanceiros === true;
  }
  if (options.exibirValorEstoque !== undefined) {
    return options.exibirValorEstoque === true;
  }
  return false;
}

// ============================================================================
// HELPERS: IDENTIFICAÇÃO DINÂMICA E RESOLUÇÃO DE ENTIDADES DO RELATÓRIO PDF
// ============================================================================

function normalizarCnpjSomenteDigitos(valor?: string | null): string {
  return (valor || '').replace(/\D/g, '');
}

function resolverNomeIndustriaOuFornecedor(
  valor: string,
  nomeExplicito?: string,
  itens?: ItemIsv[]
): string {
  if (nomeExplicito && nomeExplicito.trim()) {
    return nomeExplicito.trim();
  }

  const bruto = (valor || '').trim();
  if (!bruto) return '';

  const apenasDigitos = normalizarCnpjSomenteDigitos(bruto);
  if (apenasDigitos.length === 14) {
    const ind = isvService.getIndustriaByCnpj(apenasDigitos);
    if (ind?.razao_social && ind.razao_social.trim()) {
      return ind.razao_social.trim();
    }
    if (ind?.nome_exibicao && ind.nome_exibicao.trim()) {
      return ind.nome_exibicao.trim();
    }

    // Fallback nos itens filtrados já carregados (útil em testes ou inicialização parcial)
    if (itens && itens.length > 0) {
      for (const it of itens) {
        const vinc = it.vinculos_detalhados?.find(
          (v) => normalizarCnpjSomenteDigitos(v.cnpj) === apenasDigitos
        );
        if (vinc?.nome_industria && vinc.nome_industria.trim()) {
          return vinc.nome_industria.trim();
        }
        if (it.cnpjs?.some((c) => normalizarCnpjSomenteDigitos(c) === apenasDigitos)) {
          if (it.fornecedor_razao_social && it.fornecedor_razao_social.trim() && it.fornecedor_razao_social !== 'NÃO IDENTIFICADO') {
            return it.fornecedor_razao_social.trim();
          }
          if (it.industrias_nomes && it.industrias_nomes.length > 0 && it.industrias_nomes[0].trim()) {
            return it.industrias_nomes[0].trim();
          }
        }
      }
    }

    if (ind?.cnpj_formatado) {
      return ind.cnpj_formatado;
    }
  } else {
    const upper = bruto.toUpperCase();
    const ind = isvService.getIndustrias().find(
      (i) =>
        i.cnpj === bruto ||
        (i.razao_social && i.razao_social.trim().toUpperCase() === upper) ||
        (i.nome_exibicao && i.nome_exibicao.trim().toUpperCase() === upper)
    );
    if (ind?.razao_social && ind.razao_social.trim()) {
      return ind.razao_social.trim();
    }
    if (ind?.nome_exibicao && ind.nome_exibicao.trim()) {
      return ind.nome_exibicao.trim();
    }
  }

  return bruto;
}

function resolverNomePromotor(
  valor: string,
  nomeExplicito?: string
): string {
  if (nomeExplicito && nomeExplicito.trim()) {
    return nomeExplicito.trim();
  }
  const bruto = (valor || '').trim();
  if (!bruto) return '';

  const upper = bruto.toUpperCase();
  const prom = promotorService.getPromotores().find(
    (p) => p.promotorId === bruto || (p.nome && p.nome.trim().toUpperCase() === upper)
  );
  if (prom?.nome && prom.nome.trim()) {
    return prom.nome.trim();
  }
  return bruto;
}

function isValorEntidadeAtivo(val?: string | null): val is string {
  if (!val) return false;
  const clean = val.trim().toUpperCase();
  return clean.length > 0 && clean !== 'TODOS' && clean !== 'TODAS' && clean !== 'GERAL';
}

/**
 * Função centralizada e reutilizável para identificar o tipo de relatório PDF
 * e os nomes completos das entidades selecionadas com base nos filtros aplicados.
 * Garante comportamento idêntico entre Dashboard, módulo ISV, Promotores,
 * Fornecedores e Agências.
 */
export function resolverIdentificacaoRelatorioPdf(
  options?: Partial<IsvPdfOptions>,
  itens?: ItemIsv[]
): IdentificacaoRelatorioPdf {
  const filtros = options?.filtros;
  const entidades: EntidadeSelecionadaPdf[] = [];

  const isFornecedorExplicit = options?.tipoAgrupamento === 'FORNECEDOR';
  const isIndustriaExplicit = options?.tipoAgrupamento === 'INDUSTRIA';
  const isPromotorExplicit = options?.tipoAgrupamento === 'PROMOTOR';
  const isAgenciaExplicit = options?.tipoAgrupamento === 'AGENCIA';

  // 1. Fornecedor (quando explicitado por filtro de fornecedor ou agrupamento FORNECEDOR)
  const rawFornecedorFiltro =
    filtros?.fornecedorNome ||
    filtros?.fornecedor ||
    filtros?.fornecedorCnpj ||
    options?.fornecedorNome;
  const rawFornecedor = isFornecedorExplicit && isValorEntidadeAtivo(options?.nomeEntidade)
    ? options!.nomeEntidade!
    : isValorEntidadeAtivo(rawFornecedorFiltro)
    ? rawFornecedorFiltro
    : undefined;

  let fornecedorResolvidoUpper = '';
  let fornecedorDigitos = '';
  if (rawFornecedor) {
    const nomeForn = resolverNomeIndustriaOuFornecedor(
      rawFornecedor,
      options?.fornecedorNome || filtros?.fornecedorNome,
      itens
    );
    fornecedorResolvidoUpper = nomeForn.toUpperCase();
    fornecedorDigitos = normalizarCnpjSomenteDigitos(rawFornecedor);
    entidades.push({
      tipo: 'FORNECEDOR',
      rotulo: 'Fornecedor',
      nome: fornecedorResolvidoUpper,
    });
  }

  // 2. Indústria (filtros.industriaCnpj / filtros.industria ou agrupamento INDUSTRIA)
  const rawIndustriaFiltro = isValorEntidadeAtivo(filtros?.industriaCnpj)
    ? filtros!.industriaCnpj!
    : isValorEntidadeAtivo(filtros?.industria)
    ? filtros!.industria!
    : undefined;
  const rawIndustria = isIndustriaExplicit && isValorEntidadeAtivo(options?.nomeEntidade)
    ? options!.nomeEntidade!
    : rawIndustriaFiltro || (!isFornecedorExplicit && isValorEntidadeAtivo(options?.industriaNome) ? options!.industriaNome! : undefined);

  if (rawIndustria) {
    const nomeInd = resolverNomeIndustriaOuFornecedor(
      rawIndustria,
      options?.industriaNome || filtros?.industriaNome,
      itens
    );
    const nomeIndUpper = nomeInd.toUpperCase();
    const indDigitos = normalizarCnpjSomenteDigitos(rawIndustria);

    // Evita duplicar quando um relatório explícito de Fornecedor recebe também o mesmo CNPJ no estado de filtros
    const mesmoQueFornecedor =
      isFornecedorExplicit &&
      entidades.some(
        (e) =>
          e.tipo === 'FORNECEDOR' &&
          (e.nome === nomeIndUpper || (fornecedorDigitos.length === 14 && indDigitos === fornecedorDigitos))
      );

    if (!mesmoQueFornecedor) {
      entidades.push({
        tipo: 'INDUSTRIA',
        rotulo: 'Indústria',
        nome: nomeIndUpper,
      });
    }
  }

  // 3. Agência
  const rawAgenciaFiltro = isValorEntidadeAtivo(filtros?.agencia) ? filtros!.agencia! : undefined;
  const rawAgencia = isAgenciaExplicit && isValorEntidadeAtivo(options?.nomeEntidade)
    ? options!.nomeEntidade!
    : rawAgenciaFiltro || (isValorEntidadeAtivo(options?.agenciaNome) ? options!.agenciaNome! : undefined) || (isValorEntidadeAtivo(filtros?.agenciaNome) ? filtros!.agenciaNome! : undefined);

  if (rawAgencia) {
    entidades.push({
      tipo: 'AGENCIA',
      rotulo: 'Agência',
      nome: rawAgencia.trim().toUpperCase(),
    });
  }

  // 4. Promotor
  const rawPromotorFiltro = isValorEntidadeAtivo(filtros?.promotorId) ? filtros!.promotorId! : undefined;
  const rawPromotor = isPromotorExplicit && isValorEntidadeAtivo(options?.nomeEntidade)
    ? options!.nomeEntidade!
    : rawPromotorFiltro || (isValorEntidadeAtivo(options?.promotorNome) ? options!.promotorNome! : undefined) || (isValorEntidadeAtivo(filtros?.promotorNome) ? filtros!.promotorNome! : undefined);

  if (rawPromotor) {
    const nomeProm = resolverNomePromotor(
      rawPromotor,
      options?.promotorNome || filtros?.promotorNome
    );
    entidades.push({
      tipo: 'PROMOTOR',
      rotulo: 'Promotor',
      nome: nomeProm.toUpperCase(),
    });
  }

  // Regras oficiais de título principal e destaque
  if (entidades.length >= 2) {
    return {
      tipoRelatorio: 'PERSONALIZADO',
      tituloPrincipal: 'RELATÓRIO PERSONALIZADO',
      destaqueEntidade: entidades.map((e) => `${e.rotulo}: ${e.nome}`).join('  |  '),
      entidades,
    };
  }

  if (entidades.length === 1) {
    const unica = entidades[0];
    switch (unica.tipo) {
      case 'INDUSTRIA':
        return {
          tipoRelatorio: 'POR_INDUSTRIA',
          tituloPrincipal: 'RELATÓRIO POR INDÚSTRIA',
          destaqueEntidade: unica.nome,
          entidades,
        };
      case 'FORNECEDOR':
        return {
          tipoRelatorio: 'POR_FORNECEDOR',
          tituloPrincipal: 'RELATÓRIO POR FORNECEDOR',
          destaqueEntidade: unica.nome,
          entidades,
        };
      case 'PROMOTOR':
        return {
          tipoRelatorio: 'POR_PROMOTOR',
          tituloPrincipal: 'RELATÓRIO POR PROMOTOR',
          destaqueEntidade: unica.nome,
          entidades,
        };
      case 'AGENCIA':
        return {
          tipoRelatorio: 'POR_AGENCIA',
          tituloPrincipal: 'RELATÓRIO POR AGÊNCIA',
          destaqueEntidade: unica.nome,
          entidades,
        };
    }
  }

  return {
    tipoRelatorio: 'GERAL_LOJA',
    tituloPrincipal: 'GERAL DA LOJA',
    destaqueEntidade: undefined,
    entidades: [],
  };
}

// ============================================================================
// HELPER: RESUMO LEGÍVEL DOS FILTROS APLICADOS
// ============================================================================

/**
 * Constrói uma descrição legível e oficial de todos os filtros ativos aplicados.
 */
export function formatarResumoFiltrosIsv(
  filtros?: FiltrosIdentificacaoPdf,
  fallback?: string,
  itens?: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): string {
  if (!filtros) {
    return fallback || 'Todos os produtos (sem filtros restritivos) | Ordenação: Maior Valor de Estoque';
  }

  const parts: string[] = [];

  if (filtros.termoBusca && filtros.termoBusca.trim()) {
    parts.push(`Busca: "${filtros.termoBusca.trim()}"`);
  }

  if (filtros.setorOperacional && filtros.setorOperacional !== 'TODOS') {
    const mapSetor: Record<string, string> = {
      FRIOS: 'Frios (RF.)',
      ACOUGUE: 'Açougue (AC.)',
      HORTIFRUTI: 'Hortifruti (HF.)',
      LOJA: 'Loja (CR. / Mercearia)',
      CAFETERIA: 'Cafeteria',
    };
    parts.push(`Setor: ${mapSetor[filtros.setorOperacional] || filtros.setorOperacional}`);
  }

  if (filtros.setorFisico && filtros.setorFisico !== 'TODOS') {
    parts.push(`Setor Físico: ${filtros.setorFisico}`);
  }

  if (filtros.setorBalanco && filtros.setorBalanco !== 'TODOS') {
    parts.push(`Setor Balanço: ${filtros.setorBalanco}`);
  }

  if (isValorEntidadeAtivo(filtros.agencia)) {
    parts.push(`Agência: ${filtros.agencia}`);
  }

  const indVal = isValorEntidadeAtivo(filtros.industriaCnpj)
    ? filtros.industriaCnpj
    : isValorEntidadeAtivo(filtros.industria)
    ? filtros.industria
    : undefined;
  if (indVal) {
    const nomeInd = resolverNomeIndustriaOuFornecedor(
      indVal,
      filtros.industriaNome || options?.industriaNome,
      itens
    );
    parts.push(`Indústria: ${nomeInd}`);
  }

  const fornVal = filtros.fornecedorNome || filtros.fornecedor || filtros.fornecedorCnpj;
  if (isValorEntidadeAtivo(fornVal)) {
    const nomeForn = resolverNomeIndustriaOuFornecedor(
      fornVal,
      filtros.fornecedorNome || options?.fornecedorNome,
      itens
    );
    parts.push(`Fornecedor: ${nomeForn}`);
  }

  if (isValorEntidadeAtivo(filtros.promotorId)) {
    const nomeProm = resolverNomePromotor(
      filtros.promotorId,
      filtros.promotorNome || options?.promotorNome
    );
    parts.push(`Promotor: ${nomeProm}`);
  }

  if (filtros.situacaoVinculo && filtros.situacaoVinculo !== 'TODOS') {
    const mapVinc: Record<string, string> = {
      COM_PROMOTOR: 'Com Promotor',
      SEM_PROMOTOR: 'Sem Promotor',
      MULTIPLOS_CNPJS: 'Múltiplos CNPJs',
    };
    parts.push(`Vínculo: ${mapVinc[filtros.situacaoVinculo] || filtros.situacaoVinculo}`);
  }

  if (filtros.diasSemVenda !== null && filtros.diasSemVenda !== undefined) {
    parts.push(`Dias s/ Venda: ${filtros.modoDiasSemVenda === 'EXATO' ? '=' : '>='} ${filtros.diasSemVenda}d`);
  }

  if (filtros.idade !== null && filtros.idade !== undefined) {
    parts.push(`Idade: ${filtros.modoIdade === 'EXATO' ? '=' : '>='} ${filtros.idade}d`);
  }

  if (filtros.filtroEstoque && filtros.filtroEstoque !== 'TODOS') {
    parts.push(filtros.filtroEstoque === 'COM_ESTOQUE' ? 'Com Estoque' : 'Estoque Zerado');
  }

  if (filtros.filtroValor && filtros.filtroValor !== 'TODOS') {
    const ocultarMonetario = options !== undefined && !deveIncluirValoresFinanceirosPdf(options);
    if (ocultarMonetario) {
      parts.push('Faixa de filtro aplicada');
    } else if (filtros.filtroValor === 'CUSTOM') {
      const min = filtros.valorMin !== undefined ? formatarMoedaBR(filtros.valorMin) : 'R$ 0,00';
      const max = filtros.valorMax !== undefined ? formatarMoedaBR(filtros.valorMax) : 'sem teto';
      parts.push(`Valor: ${min} até ${max}`);
    } else {
      parts.push(filtros.filtroValor === 'ATE_250' ? 'Valor até R$ 250' : 'Valor acima de R$ 250');
    }
  }

  if (filtros.ordenacao) {
    const mapOrd: Record<string, string> = {
      MAIOR_VALOR: 'Maior Valor de Estoque',
      MENOR_VALOR: 'Menor Valor de Estoque',
      MAIS_DIAS_SEM_VENDA: 'Mais Dias Sem Venda',
      MAIOR_IDADE: 'Maior Idade da Mercadoria',
      CODIGO: 'Código do Produto',
    };
    parts.push(`Ordenação: ${mapOrd[filtros.ordenacao] || filtros.ordenacao}`);
  }

  if (parts.length === 0) {
    return fallback || 'Todos os produtos (sem filtros restritivos) | Ordenação: Maior Valor de Estoque';
  }

  return parts.join(' | ');
}

function resolverResumoFiltrosSeguro(
  options: Partial<IsvPdfOptions> | undefined,
  incluirValores: boolean,
  fallback?: string,
  itens?: ItemIsv[]
): string {
  const optsComSeguranca: Partial<IsvPdfOptions> = {
    ...(options || {}),
    incluirValoresFinanceiros: incluirValores,
    exibirValorEstoque: incluirValores,
  };

  if (options?.filtrosDescricao && options.filtrosDescricao.trim()) {
    const raw = options.filtrosDescricao.trim();
    if (incluirValores) return raw;
    // Remove qualquer valor monetário explícito caso um chamador legado tenha pré-formatado filtrosDescricao
    return raw
      .replace(/Valor\s+at[ée]\s+R\$\s*[\d.,]+/gi, 'Faixa de filtro aplicada')
      .replace(/Valor\s+acima\s+de\s+R\$\s*[\d.,]+/gi, 'Faixa de filtro aplicada')
      .replace(/Valor:\s*R\$\s*[\d.,]+(\s+at[ée]\s+(R\$\s*[\d.,]+|sem teto))?/gi, 'Faixa de filtro aplicada')
      .replace(/R\$\s*[\d.,]+/g, '[oculto]');
  }

  return formatarResumoFiltrosIsv(options?.filtros, fallback, itens, optsComSeguranca);
}

// ============================================================================
// HELPER: DOWNLOAD SEGURO DE PDF EM AMBIENTES WEB E IFRAME
// ============================================================================

/**
 * Dispara o download de um documento jsPDF de forma universal e segura,
 * utilizando Blob URL com fallback para doc.save.
 */
export function dispararDownloadPdf(
  doc: jsPDF,
  nomeArquivo: string
): { sucesso: boolean; tamanhoBytes: number } {
  try {
    const blob = doc.output('blob');
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = nomeArquivo;
      link.target = '_self';
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        URL.revokeObjectURL(url);
      }, 5000);
      return { sucesso: true, tamanhoBytes: blob.size };
    }

    doc.save(nomeArquivo);
    return { sucesso: true, tamanhoBytes: blob.size };
  } catch (err: any) {
    console.warn('Falha no download via URL Blob, tentando fallback doc.save():', err);
    try {
      doc.save(nomeArquivo);
      return { sucesso: true, tamanhoBytes: 0 };
    } catch (saveErr: any) {
      console.error('Falha crítica ao salvar PDF:', saveErr);
      throw new Error(`Não foi possível salvar o arquivo PDF: ${saveErr?.message || err?.message || 'Erro desconhecido'}`);
    }
  }
}

// ============================================================================
// HELPER: CABEÇALHO AZUL-ESCURO E FAIXA LARANJA INSTITUCIONAL
// ============================================================================

interface DadosCabecalhoIsv {
  doc: jsPDF;
  pageWidth: number;
  marginX: number;
  tituloFaixaLaranja: string;
  destaqueEntidade?: string;
  subtituloFaixaLaranja?: string;
  dataHoraEmissao: string;
  filialNome: string;
  totalProdutosFiltrados?: number;
  valorTotalFiltrado?: number;
  incluirValoresFinanceiros: boolean;
  resumoFiltros?: string;
}

function desenharCabecalhoInstitucionalIsv(dados: DadosCabecalhoIsv): number {
  const {
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja,
    destaqueEntidade,
    subtituloFaixaLaranja,
    dataHoraEmissao,
    filialNome,
    totalProdutosFiltrados,
    valorTotalFiltrado,
    incluirValoresFinanceiros,
    resumoFiltros,
  } = dados;

  // 1. Cabeçalho Azul-Escuro Institucional (#0F172A)
  const alturaTopoAzul = 25;
  doc.setFillColor(15, 23, 42); // slate-900 institucional
  doc.rect(0, 0, pageWidth, alturaTopoAzul, 'F');

  // Faixa de acento azul elétrico (#1D4ED8)
  doc.setFillColor(29, 78, 216);
  doc.rect(0, alturaTopoAzul, pageWidth, 1.5, 'F');

  // Linha 1 Topo Esquerda: Título Institucional
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text('ISV — INTELIGÊNCIA DE ESTOQUE', marginX, 8.5);

  // Linha 2 Topo Esquerda: Filial e Tipo de Documento
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(191, 219, 254); // blue-200
  doc.text(`${filialNome.toUpperCase()} • RELATÓRIO EXECUTIVO OFICIAL`, marginX, 14);

  // Linha 3 Topo Esquerda: Total Filtrado (e Valor Total Filtrado SOMENTE quando incluirValoresFinanceiros = true)
  const totalTexto = totalProdutosFiltrados !== undefined
    ? `${totalProdutosFiltrados.toLocaleString('pt-BR')} PRODUTOS FILTRADOS`
    : 'PRODUTOS FILTRADOS';
  const valorTexto =
    incluirValoresFinanceiros && valorTotalFiltrado !== undefined
      ? `VALOR TOTAL: ${formatarMoedaBR(valorTotalFiltrado)}`
      : '';
  const infoFiltroTopo = valorTexto ? `${totalTexto}  •  ${valorTexto}` : totalTexto;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(52, 211, 153); // emerald-400
  doc.text(infoFiltroTopo, marginX, 19.5);

  // Topo Direita: Data e Hora Reais de Emissão
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(226, 232, 240); // slate-200
  doc.text(`Emissão: ${dataHoraEmissao}`, pageWidth - marginX, 8.5, { align: 'right' });

  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text('DOCUMENTO OFICIAL ISV • A4 PAISAGEM', pageWidth - marginX, 14, { align: 'right' });

  // Regra de Estoque Consolidado
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(253, 230, 138); // amber-200
  doc.setFontSize(7.5);
  doc.text('Estoque Consolidado EMB1 + EMB9', pageWidth - marginX, 19.5, { align: 'right' });

  // 2. Faixa Laranja Institucional (#EA580C) com Identificação Dinâmica + Destaque da Entidade + Resumo dos Filtros
  const yFaixaLaranja = alturaTopoAzul + 3.5;
  const larguraUtil = pageWidth - marginX * 2;
  const larguraTexto = larguraUtil - 8;

  // Preparar linhas de Título Principal
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  const linhasTitulo = doc.splitTextToSize(tituloFaixaLaranja.toUpperCase(), larguraTexto);

  // Preparar linhas de Destaque da(s) Entidade(s) com quebra automática sem cortar nome completo
  const textoDestaqueLimpo = (destaqueEntidade || '').trim();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const linhasDestaque = textoDestaqueLimpo
    ? doc.splitTextToSize(textoDestaqueLimpo, larguraTexto)
    : [];

  // Preparar linhas opcionais de Subtítulo (ex: CNPJ) e Resumo dos Filtros
  const textoSubtitulo = (subtituloFaixaLaranja || '').trim();
  const textoFiltros = resumoFiltros ? `Filtros: ${resumoFiltros}` : '';
  const textoSecundario = [textoSubtitulo, textoFiltros].filter(Boolean).join('  •  ');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  const linhasTextoFiltro = textoSecundario
    ? doc.splitTextToSize(textoSecundario, larguraTexto)
    : [];

  // Cálculo dinâmico da altura exata da faixa laranja
  let alturaFaixaLaranja = 3.2; // Padding superior
  alturaFaixaLaranja += linhasTitulo.length * 4.2;
  if (linhasDestaque.length > 0) {
    alturaFaixaLaranja += 1.0 + linhasDestaque.length * 4.2;
  }
  if (linhasTextoFiltro.length > 0) {
    alturaFaixaLaranja += 1.0 + linhasTextoFiltro.length * 3.5;
  }
  alturaFaixaLaranja = Math.max(10, alturaFaixaLaranja + 2.2);

  doc.setFillColor(234, 88, 12); // orange-600 vibrante
  doc.rect(marginX, yFaixaLaranja, larguraUtil, alturaFaixaLaranja, 'F');

  // Borda sutil na faixa laranja
  doc.setDrawColor(194, 65, 12); // orange-700
  doc.setLineWidth(0.2);
  doc.rect(marginX, yFaixaLaranja, larguraUtil, alturaFaixaLaranja, 'S');

  let currY = yFaixaLaranja + 4.8;

  // Linha 1: Tipo Principal do Relatório em branco puro
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  for (let i = 0; i < linhasTitulo.length; i++) {
    doc.text(linhasTitulo[i], marginX + 3.5, currY);
    currY += 4.2;
  }

  // Linha 2: Destaque com Nome Completo da Entidade (ou entidades combinadas), com quebra automática
  if (linhasDestaque.length > 0) {
    currY += 0.4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(254, 240, 138); // yellow-200 para máximo contraste e destaque
    for (let i = 0; i < linhasDestaque.length; i++) {
      doc.text(linhasDestaque[i], marginX + 3.5, currY);
      currY += 4.2;
    }
  }

  // Linha 3: Subtítulo + Resumo legível dos filtros adicionais
  if (linhasTextoFiltro.length > 0) {
    currY += 0.4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(255, 247, 237); // orange-50
    for (let i = 0; i < linhasTextoFiltro.length; i++) {
      doc.text(linhasTextoFiltro[i], marginX + 3.5, currY);
      currY += 3.5;
    }
  }

  return yFaixaLaranja + alturaFaixaLaranja + 3.5;
}

/**
 * Numera todas as páginas no formato "Página X de Y" com informações do rodapé oficial.
 */
function aplicarRodapeTodasPaginas(
  doc: jsPDF,
  pageWidth: number,
  pageHeight: number,
  marginX: number,
  infoEsquerda: string,
  infoCentro?: string
): void {
  const totalPages = typeof (doc as any).getNumberOfPages === 'function'
    ? (doc as any).getNumberOfPages()
    : typeof (doc.internal as any).getNumberOfPages === 'function'
    ? (doc.internal as any).getNumberOfPages()
    : (doc.internal.pages ? doc.internal.pages.length - 1 : 1);

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Linha divisória fina do rodapé
    doc.setDrawColor(203, 213, 225); // slate-300
    doc.setLineWidth(0.2);
    doc.line(marginX, pageHeight - 9, pageWidth - marginX, pageHeight - 9);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139); // slate-500

    // Esquerda: Informações da Filial e do Sistema
    doc.text(infoEsquerda, marginX, pageHeight - 5);

    // Centro: Totais e Regra de Estoque
    if (infoCentro) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text(infoCentro, pageWidth / 2, pageHeight - 5, { align: 'center' });
    }

    // Direita: Numeração de Páginas Real
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - marginX, pageHeight - 5, { align: 'right' });
  }
}

// ============================================================================
// 1. PDF — TOP 30 MERCADORIAS (SEÇÃO 8)
// ============================================================================

/**
 * Gera o relatório oficial TOP 30 — MERCADORIAS em A4 Paisagem.
 */
export async function gerarRelatorioTop30Pdf(
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): Promise<ResultadoExportacaoPdf> {
  // Yield para a interface renderizar estado de carregamento
  await new Promise((resolve) => setTimeout(resolve, 30));

  const doc = new JsPdfClass({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 297 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 210 mm
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options?.filialNome || 'FILIAL 172 — CASCAVEL';

  const incluirValores = deveIncluirValoresFinanceirosPdf(options);

  // Obter exatamente os 30 produtos ordenados com as regras oficiais
  const top30 = obterTop30Mercadorias(itens);

  let estoqueTotal = 0;
  let valorTotal = 0;
  for (const it of top30) {
    estoqueTotal += it.estoque;
    if (incluirValores && it.valorEstoque) {
      valorTotal += it.valorEstoque;
    }
  }

  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja: 'TOP 30 — MERCADORIAS COM MAIOR TEMPO SEM VENDA',
    subtituloFaixaLaranja: 'Ranking oficial dos 30 produtos com mais dias sem venda e estoque positivo (estoque > 0).',
    dataHoraEmissao,
    filialNome,
    totalProdutosFiltrados: top30.length,
    valorTotalFiltrado: incluirValores ? valorTotal : undefined,
    incluirValoresFinanceiros: incluirValores,
    resumoFiltros: 'Critério: 30 maiores dias sem venda com estoque positivo | Regra EMB1 + EMB9 Consolidado',
  });

  const cabecalhos = incluirValores
    ? [
        'POS.',
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'FORNECEDOR',
        'AGÊNCIA',
        'PROMOTOR',
        'VALOR ESTOQUE',
      ]
    : [
        'POS.',
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'FORNECEDOR',
        'AGÊNCIA',
        'PROMOTOR',
      ];

  const linhasDados = top30.length > 0
    ? top30.map((p) => {
        const baseRow = [
          p.posicaoFormatada,
          p.codigoInterno,
          p.descricao,
          p.embalagem,
          p.estoqueFormatado,
          String(p.idade),
          String(p.diasSemVenda),
          p.grupo,
          p.fornecedor,
          p.agencia,
          p.promotor,
        ];
        if (incluirValores) {
          baseRow.push(formatarMoedaBR(p.valorEstoque));
        }
        return baseRow;
      })
    : [
        [
          {
            content: 'Nenhum produto elegível para o TOP 30.',
            colSpan: cabecalhos.length,
            styles: { halign: 'center', fontStyle: 'italic', textColor: [100, 116, 139] },
          } as any,
        ],
      ];

  // Largura útil total: 277 mm (usando 275mm para margem de segurança)
  const columnStylesConfig: Record<number, any> = incluirValores
    ? {
        0: { cellWidth: 11, halign: 'center', fontStyle: 'bold' }, // POS.
        1: { cellWidth: 16, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
        2: { cellWidth: 54, halign: 'left' }, // DESCRIÇÃO
        3: { cellWidth: 14, halign: 'center' }, // EMB.
        4: { cellWidth: 19, halign: 'right', fontStyle: 'bold' }, // ESTOQUE (ÚNICA)
        5: { cellWidth: 14, halign: 'center' }, // IDADE (d)
        6: { cellWidth: 16, halign: 'center', fontStyle: 'bold' }, // DIAS S/V
        7: { cellWidth: 24, halign: 'left' }, // GRUPO
        8: { cellWidth: 31, halign: 'left' }, // FORNECEDOR
        9: { cellWidth: 24, halign: 'left' }, // AGÊNCIA
        10: { cellWidth: 24, halign: 'left' }, // PROMOTOR
        11: { cellWidth: 28, halign: 'right', fontStyle: 'bold' }, // VALOR ESTOQUE
      }
    : {
        0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' }, // POS.
        1: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
        2: { cellWidth: 64, halign: 'left' }, // DESCRIÇÃO
        3: { cellWidth: 18, halign: 'center' }, // EMB.
        4: { cellWidth: 20, halign: 'right', fontStyle: 'bold' }, // ESTOQUE (ÚNICA)
        5: { cellWidth: 16, halign: 'center' }, // IDADE (d)
        6: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, // DIAS S/V
        7: { cellWidth: 27, halign: 'left' }, // GRUPO
        8: { cellWidth: 32, halign: 'left' }, // FORNECEDOR
        9: { cellWidth: 24, halign: 'left' }, // AGÊNCIA
        10: { cellWidth: 26, halign: 'left' }, // PROMOTOR
      };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21], // Amarelo (#FACC15)
      textColor: [15, 23, 42],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: columnStylesConfig,
    didParseCell: (data) => {
      if (data.section === 'body') {
        const itemTop = top30[data.row.index];
        if (itemTop && data.column.index === 6) {
          const classif = itemTop.classificacao;
          if (classif.tipo === 'CRITICO') {
            data.cell.styles.fillColor = [254, 226, 226];
            data.cell.styles.textColor = [185, 28, 28];
            data.cell.styles.fontStyle = 'bold';
          } else if (classif.tipo === 'ALERTA') {
            data.cell.styles.fillColor = [255, 237, 213];
            data.cell.styles.textColor = [194, 65, 12];
            data.cell.styles.fontStyle = 'bold';
          } else if (classif.tipo === 'ATENCAO') {
            data.cell.styles.fillColor = [254, 249, 195];
            data.cell.styles.textColor = [161, 98, 7];
            data.cell.styles.fontStyle = 'bold';
          } else if (classif.tipo === 'GIRO_NORMAL') {
            data.cell.styles.fillColor = [209, 250, 229];
            data.cell.styles.textColor = [4, 120, 87];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    },
  });

  const estoqueTotalStr = Number.isInteger(estoqueTotal)
    ? estoqueTotal.toLocaleString('pt-BR')
    : estoqueTotal.toLocaleString('pt-BR', { minimumFractionDigits: 3 });

  const infoCentro = incluirValores
    ? `Total de Itens: ${top30.length} classificados | Valor Total: ${formatarMoedaBR(valorTotal)} | Estoque Consolidado EMB1+EMB9: ${estoqueTotalStr}`
    : `Total de Itens: ${top30.length} classificados | Estoque Consolidado EMB1+EMB9: ${estoqueTotalStr}`;
  const infoEsquerda = `ISV • Inteligência de Estoque — ${filialNome}`;
  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  options?.onDocBuilt?.(doc);

  const timestamp = agora.toISOString().slice(0, 10);
  const nomeArquivo = `ISV_TOP30_MERCADORIAS_FILIAL172_${timestamp}.pdf`;
  const dl = dispararDownloadPdf(doc, nomeArquivo);

  return {
    sucesso: dl.sucesso,
    totalItens: top30.length,
    totalPaginas: doc.getNumberOfPages(),
    tamanhoBytes: dl.tamanhoBytes,
    nomeArquivo,
    incluiuValoresFinanceiros: incluirValores,
    colunasExportadas: cabecalhos,
  };
}

// ============================================================================
// 2. PDF — RELATÓRIO POR FORNECEDOR (SEÇÃO 5)
// ============================================================================

/**
 * Gera o relatório oficial por Fornecedor.
 */
export async function gerarRelatorioFornecedorPdf(
  fornecedorNome: string,
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): Promise<ResultadoExportacaoPdf> {
  await new Promise((resolve) => setTimeout(resolve, 30));

  const doc = new JsPdfClass({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options?.filialNome || 'FILIAL 172 — CASCAVEL';

  let razaoSocialFornecedor = (fornecedorNome || 'FORNECEDOR SELECIONADO').trim().toUpperCase();
  const apenasDigitosForn = normalizarCnpjSomenteDigitos(fornecedorNome);
  if (fornecedorNome) {
    razaoSocialFornecedor = resolverNomeIndustriaOuFornecedor(
      fornecedorNome,
      options?.tipoAgrupamento === 'INDUSTRIA' ? options?.industriaNome : options?.fornecedorNome,
      itens
    ).toUpperCase();
  }

  const itensDoFornecedor = options?.preservarItensRecebidos
    ? itens
    : itens.filter((it) => {
        if (!fornecedorNome || fornecedorNome === 'TODOS' || fornecedorNome === 'TODAS') return true;
        if (apenasDigitosForn.length === 14 && it.cnpjs?.some((c) => normalizarCnpjSomenteDigitos(c) === apenasDigitosForn)) {
          return true;
        }
        const fn = (extrairFornecedorProduto(it) || '').toUpperCase();
        const indNomes = (it.industrias_nomes || []).map((n) => n.toUpperCase());
        return fn.includes(razaoSocialFornecedor) || indNomes.some((n) => n.includes(razaoSocialFornecedor));
      });

  const itensProcessados = options?.limiteQuantidade && options.limiteQuantidade !== 'TODOS'
    ? itensDoFornecedor.slice(0, Number(options.limiteQuantidade))
    : itensDoFornecedor;

  const incluirValores = deveIncluirValoresFinanceirosPdf(options);

  let valorTotal = incluirValores ? options?.valorTotalFiltrado : undefined;
  if (incluirValores && valorTotal === undefined) {
    valorTotal = 0;
    for (const it of itensProcessados) {
      if (it.valor_estoque) valorTotal += it.valor_estoque;
    }
  }

  const tipoEntidadeAlvo = options?.tipoAgrupamento === 'INDUSTRIA' ? 'INDUSTRIA' : 'FORNECEDOR';
  const identificacao = resolverIdentificacaoRelatorioPdf(
    {
      ...options,
      tipoAgrupamento: tipoEntidadeAlvo,
      nomeEntidade: razaoSocialFornecedor,
    },
    itensProcessados
  );

  const resumoFiltros = resolverResumoFiltrosSeguro(
    options,
    incluirValores,
    `${tipoEntidadeAlvo === 'INDUSTRIA' ? 'Indústria' : 'Fornecedor'}: ${razaoSocialFornecedor}`,
    itensProcessados
  );

  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja: identificacao.tituloPrincipal,
    destaqueEntidade: identificacao.destaqueEntidade || razaoSocialFornecedor,
    subtituloFaixaLaranja: options?.subtituloEntidade,
    dataHoraEmissao,
    filialNome,
    totalProdutosFiltrados: itensProcessados.length,
    valorTotalFiltrado: incluirValores ? valorTotal : undefined,
    incluirValoresFinanceiros: incluirValores,
    resumoFiltros,
  });

  const cabecalhos = incluirValores
    ? [
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'AGÊNCIA',
        'PROMOTOR',
        'VALOR ESTOQUE',
      ]
    : [
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'AGÊNCIA',
        'PROMOTOR',
      ];

  const linhasDados = itensProcessados.length > 0
    ? itensProcessados.map((item) => {
        const base = [
          item.codigo_interno || item.produto?.codigo_interno || '-',
          item.descricao || item.produto?.descricao || '-',
          item.embalagem || item.produto?.embalagem || 'UN',
          formatarEstoqueColunaUnica(item),
          String(item.idade ?? item.produto?.idade ?? 0),
          String(item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0),
          extrairGrupoProduto(item),
          extrairAgenciaProduto(item),
          extrairPromotorProduto(item),
        ];
        if (incluirValores) {
          base.push(formatarMoedaBR(item.valor_estoque));
        }
        return base;
      })
    : [[{ content: 'Nenhum produto encontrado para este fornecedor.', colSpan: cabecalhos.length, styles: { halign: 'center', fontStyle: 'italic', textColor: [100, 116, 139] } } as any]];

  const columnStylesConfig: Record<number, any> = incluirValores
    ? {
        0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 68, halign: 'left' },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        4: { cellWidth: 18, halign: 'center' },
        5: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        6: { cellWidth: 25, halign: 'left' },
        7: { cellWidth: 26, halign: 'left' },
        8: { cellWidth: 26, halign: 'left' },
        9: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
      }
    : {
        0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 80, halign: 'left' },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
        4: { cellWidth: 18, halign: 'center' },
        5: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        6: { cellWidth: 30, halign: 'left' },
        7: { cellWidth: 31, halign: 'left' },
        8: { cellWidth: 32, halign: 'left' },
      };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21],
      textColor: [15, 23, 42],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: columnStylesConfig,
  });

  const infoCentro = incluirValores && valorTotal !== undefined
    ? `Total: ${itensProcessados.length} produtos | Valor Filtrado: ${formatarMoedaBR(valorTotal)} | Estoque Consolidado EMB1+EMB9`
    : `Total: ${itensProcessados.length} produtos | Estoque Consolidado EMB1+EMB9`;
  const infoEsquerda = `ISV • ${identificacao.tituloPrincipal}: ${identificacao.destaqueEntidade || razaoSocialFornecedor} — ${filialNome}`;
  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  options?.onDocBuilt?.(doc);

  const timestamp = agora.toISOString().slice(0, 10);
  const nomeArq = razaoSocialFornecedor.replace(/[^A-Z0-9]/g, '_').substring(0, 28);
  const prefixoArq = tipoEntidadeAlvo === 'INDUSTRIA' ? 'ISV_INDUSTRIA' : 'ISV_FORNECEDOR';
  const nomeArquivo = `${prefixoArq}_${nomeArq}_${timestamp}.pdf`;
  const dl = dispararDownloadPdf(doc, nomeArquivo);

  return {
    sucesso: dl.sucesso,
    totalItens: itensProcessados.length,
    totalPaginas: doc.getNumberOfPages(),
    tamanhoBytes: dl.tamanhoBytes,
    nomeArquivo,
    identificacao,
    incluiuValoresFinanceiros: incluirValores,
    colunasExportadas: cabecalhos,
  };
}

// ============================================================================
// 3. PDF — RELATÓRIO POR PROMOTOR (SEÇÃO 6)
// ============================================================================

/**
 * Gera o relatório oficial por Promotor.
 */
export async function gerarRelatorioPromotorPdf(
  promotorNome: string,
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): Promise<ResultadoExportacaoPdf> {
  await new Promise((resolve) => setTimeout(resolve, 30));

  const doc = new JsPdfClass({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options?.filialNome || 'FILIAL 172 — CASCAVEL';

  const nomePromLimpo = resolverNomePromotor(
    promotorNome || 'PROMOTOR SELECIONADO',
    options?.promotorNome
  ).toUpperCase();

  const itensDoPromotor = options?.preservarItensRecebidos
    ? itens
    : itens.filter((it) => {
        if (!promotorNome || promotorNome === 'TODOS') return true;
        const pNomes = (it.promotores_nomes || []).map((n) => n.toUpperCase());
        return pNomes.some((n) => n.includes(nomePromLimpo));
      });

  const itensProcessados = options?.limiteQuantidade && options.limiteQuantidade !== 'TODOS'
    ? itensDoPromotor.slice(0, Number(options.limiteQuantidade))
    : itensDoPromotor;

  const incluirValores = deveIncluirValoresFinanceirosPdf(options);

  let valorTotal = incluirValores ? options?.valorTotalFiltrado : undefined;
  if (incluirValores && valorTotal === undefined) {
    valorTotal = 0;
    for (const it of itensProcessados) {
      if (it.valor_estoque) valorTotal += it.valor_estoque;
    }
  }

  const identificacao = resolverIdentificacaoRelatorioPdf(
    {
      ...options,
      tipoAgrupamento: 'PROMOTOR',
      nomeEntidade: nomePromLimpo,
    },
    itensProcessados
  );

  const resumoFiltros = resolverResumoFiltrosSeguro(
    options,
    incluirValores,
    `Promotor: ${nomePromLimpo}`,
    itensProcessados
  );

  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja: identificacao.tituloPrincipal,
    destaqueEntidade: identificacao.destaqueEntidade || nomePromLimpo,
    subtituloFaixaLaranja: options?.subtituloEntidade,
    dataHoraEmissao,
    filialNome,
    totalProdutosFiltrados: itensProcessados.length,
    valorTotalFiltrado: incluirValores ? valorTotal : undefined,
    incluirValoresFinanceiros: incluirValores,
    resumoFiltros,
  });

  const cabecalhos = incluirValores
    ? [
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'FORNECEDOR',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'AGÊNCIA',
        'VALOR ESTOQUE',
      ]
    : [
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'FORNECEDOR',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'AGÊNCIA',
      ];

  const linhasDados = itensProcessados.length > 0
    ? itensProcessados.map((item) => {
        const base = [
          item.codigo_interno || item.produto?.codigo_interno || '-',
          item.descricao || item.produto?.descricao || '-',
          item.embalagem || item.produto?.embalagem || 'UN',
          extrairFornecedorProduto(item),
          formatarEstoqueColunaUnica(item),
          String(item.idade ?? item.produto?.idade ?? 0),
          String(item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0),
          extrairGrupoProduto(item),
          extrairAgenciaProduto(item),
        ];
        if (incluirValores) {
          base.push(formatarMoedaBR(item.valor_estoque));
        }
        return base;
      })
    : [[{ content: 'Nenhum produto encontrado para este promotor.', colSpan: cabecalhos.length, styles: { halign: 'center', fontStyle: 'italic', textColor: [100, 116, 139] } } as any]];

  const columnStylesConfig: Record<number, any> = incluirValores
    ? {
        0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 66, halign: 'left' },
        2: { cellWidth: 16, halign: 'center' },
        3: { cellWidth: 34, halign: 'left' },
        4: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        5: { cellWidth: 18, halign: 'center' },
        6: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        7: { cellWidth: 24, halign: 'left' },
        8: { cellWidth: 25, halign: 'left' },
        9: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      }
    : {
        0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 77, halign: 'left' },
        2: { cellWidth: 16, halign: 'center' },
        3: { cellWidth: 40, halign: 'left' },
        4: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
        5: { cellWidth: 18, halign: 'center' },
        6: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        7: { cellWidth: 28, halign: 'left' },
        8: { cellWidth: 30, halign: 'left' },
      };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21],
      textColor: [15, 23, 42],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: columnStylesConfig,
  });

  const infoCentro = incluirValores && valorTotal !== undefined
    ? `Total: ${itensProcessados.length} produtos | Valor Filtrado: ${formatarMoedaBR(valorTotal)} | Estoque Consolidado EMB1+EMB9`
    : `Total: ${itensProcessados.length} produtos | Estoque Consolidado EMB1+EMB9`;
  const infoEsquerda = `ISV • ${identificacao.tituloPrincipal}: ${identificacao.destaqueEntidade || nomePromLimpo} — ${filialNome}`;
  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  options?.onDocBuilt?.(doc);

  const timestamp = agora.toISOString().slice(0, 10);
  const nomeArq = nomePromLimpo.replace(/[^A-Z0-9]/g, '_').substring(0, 28);
  const nomeArquivo = `ISV_PROMOTOR_${nomeArq}_${timestamp}.pdf`;
  const dl = dispararDownloadPdf(doc, nomeArquivo);

  return {
    sucesso: dl.sucesso,
    totalItens: itensProcessados.length,
    totalPaginas: doc.getNumberOfPages(),
    tamanhoBytes: dl.tamanhoBytes,
    nomeArquivo,
    identificacao,
    incluiuValoresFinanceiros: incluirValores,
    colunasExportadas: cabecalhos,
  };
}

// ============================================================================
// 4. PDF — RELATÓRIO POR AGÊNCIA (SEÇÃO 7)
// ============================================================================

/**
 * Gera o relatório oficial por Agência.
 */
export async function gerarRelatorioAgenciaPdf(
  agenciaNome: string,
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): Promise<ResultadoExportacaoPdf> {
  await new Promise((resolve) => setTimeout(resolve, 30));

  const doc = new JsPdfClass({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options?.filialNome || 'FILIAL 172 — CASCAVEL';

  const nomeAgLimpo = (agenciaNome || 'AGÊNCIA SELECIONADA').trim().toUpperCase();

  const itensDaAgencia = options?.preservarItensRecebidos
    ? itens
    : itens.filter((it) => {
        if (!agenciaNome || agenciaNome === 'TODAS') return true;
        const agNomes = (it.agencias_nomes || []).map((n) => n.toUpperCase());
        return agNomes.some((n) => n.includes(nomeAgLimpo));
      });

  const itensProcessados = options?.limiteQuantidade && options.limiteQuantidade !== 'TODOS'
    ? itensDaAgencia.slice(0, Number(options.limiteQuantidade))
    : itensDaAgencia;

  const incluirValores = deveIncluirValoresFinanceirosPdf(options);

  let valorTotal = incluirValores ? options?.valorTotalFiltrado : undefined;
  if (incluirValores && valorTotal === undefined) {
    valorTotal = 0;
    for (const it of itensProcessados) {
      if (it.valor_estoque) valorTotal += it.valor_estoque;
    }
  }

  const identificacao = resolverIdentificacaoRelatorioPdf(
    {
      ...options,
      tipoAgrupamento: 'AGENCIA',
      nomeEntidade: nomeAgLimpo,
    },
    itensProcessados
  );

  const resumoFiltros = resolverResumoFiltrosSeguro(
    options,
    incluirValores,
    `Agência: ${nomeAgLimpo}`,
    itensProcessados
  );

  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja: identificacao.tituloPrincipal,
    destaqueEntidade: identificacao.destaqueEntidade || nomeAgLimpo,
    subtituloFaixaLaranja: options?.subtituloEntidade,
    dataHoraEmissao,
    filialNome,
    totalProdutosFiltrados: itensProcessados.length,
    valorTotalFiltrado: incluirValores ? valorTotal : undefined,
    incluirValoresFinanceiros: incluirValores,
    resumoFiltros,
  });

  const cabecalhos = incluirValores
    ? [
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'FORNECEDOR',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'PROMOTOR',
        'VALOR ESTOQUE',
      ]
    : [
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'FORNECEDOR',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'PROMOTOR',
      ];

  const linhasDados = itensProcessados.length > 0
    ? itensProcessados.map((item) => {
        const base = [
          item.codigo_interno || item.produto?.codigo_interno || '-',
          item.descricao || item.produto?.descricao || '-',
          item.embalagem || item.produto?.embalagem || 'UN',
          extrairFornecedorProduto(item),
          formatarEstoqueColunaUnica(item),
          String(item.idade ?? item.produto?.idade ?? 0),
          String(item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0),
          extrairGrupoProduto(item),
          extrairPromotorProduto(item),
        ];
        if (incluirValores) {
          base.push(formatarMoedaBR(item.valor_estoque));
        }
        return base;
      })
    : [[{ content: 'Nenhum produto encontrado para esta agência.', colSpan: cabecalhos.length, styles: { halign: 'center', fontStyle: 'italic', textColor: [100, 116, 139] } } as any]];

  const columnStylesConfig: Record<number, any> = incluirValores
    ? {
        0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 66, halign: 'left' },
        2: { cellWidth: 16, halign: 'center' },
        3: { cellWidth: 34, halign: 'left' },
        4: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        5: { cellWidth: 18, halign: 'center' },
        6: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        7: { cellWidth: 24, halign: 'left' },
        8: { cellWidth: 25, halign: 'left' },
        9: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      }
    : {
        0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 77, halign: 'left' },
        2: { cellWidth: 16, halign: 'center' },
        3: { cellWidth: 40, halign: 'left' },
        4: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
        5: { cellWidth: 18, halign: 'center' },
        6: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        7: { cellWidth: 28, halign: 'left' },
        8: { cellWidth: 30, halign: 'left' },
      };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21],
      textColor: [15, 23, 42],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: columnStylesConfig,
  });

  const infoCentro = incluirValores && valorTotal !== undefined
    ? `Total: ${itensProcessados.length} produtos | Valor Filtrado: ${formatarMoedaBR(valorTotal)} | Estoque Consolidado EMB1+EMB9`
    : `Total: ${itensProcessados.length} produtos | Estoque Consolidado EMB1+EMB9`;
  const infoEsquerda = `ISV • ${identificacao.tituloPrincipal}: ${identificacao.destaqueEntidade || nomeAgLimpo} — ${filialNome}`;
  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  options?.onDocBuilt?.(doc);

  const timestamp = agora.toISOString().slice(0, 10);
  const nomeArq = nomeAgLimpo.replace(/[^A-Z0-9]/g, '_').substring(0, 28);
  const nomeArquivo = `ISV_AGENCIA_${nomeArq}_${timestamp}.pdf`;
  const dl = dispararDownloadPdf(doc, nomeArquivo);

  return {
    sucesso: dl.sucesso,
    totalItens: itensProcessados.length,
    totalPaginas: doc.getNumberOfPages(),
    tamanhoBytes: dl.tamanhoBytes,
    nomeArquivo,
    identificacao,
    incluiuValoresFinanceiros: incluirValores,
    colunasExportadas: cabecalhos,
  };
}

// ============================================================================
// 5. PDF GERAL DA LOJA / RESULTADOS FILTRADOS (CONFORME REQUISITOS ISV)
// ============================================================================

/**
 * Gera relatório geral do ISV com exatamente o mesmo conjunto de produtos filtrados
 * exibidos no Dashboard ou módulo ISV, preservando:
 * - Todos os produtos filtrados (sem limite visual de 30 da página).
 * - Ordenação escolhida pelo usuário.
 * - Cabeçalho com total de produtos, valor total filtrado e resumo legível dos filtros ativos.
 * - Coluna única de ESTOQUE com a regra EMB1 + EMB9 consolidada.
 * - Execução assíncrona não bloqueante e download confiável.
 */
export async function gerarRelatorioIsvA4Pdf(
  itens: ItemIsv[],
  options: IsvPdfOptions
): Promise<ResultadoExportacaoPdf> {
  // Roteamento inteligente baseado no tipo de agrupamento explícito
  if (options.tipoAgrupamento === 'TOP30' || options.limiteQuantidade === 30) {
    return gerarRelatorioTop30Pdf(itens, options);
  }

  if (options.tipoAgrupamento === 'FORNECEDOR' && options.nomeEntidade) {
    return gerarRelatorioFornecedorPdf(options.nomeEntidade, itens, options);
  }

  if (options.tipoAgrupamento === 'INDUSTRIA' && options.nomeEntidade) {
    return gerarRelatorioFornecedorPdf(options.nomeEntidade, itens, options);
  }

  if (options.tipoAgrupamento === 'PROMOTOR' && options.nomeEntidade) {
    return gerarRelatorioPromotorPdf(options.nomeEntidade, itens, options);
  }

  if (options.tipoAgrupamento === 'AGENCIA' && options.nomeEntidade) {
    return gerarRelatorioAgenciaPdf(options.nomeEntidade, itens, options);
  }

  // Yield para o thread da UI renderizar o indicador "Gerando PDF..."
  await new Promise((resolve) => setTimeout(resolve, 40));

  const doc = new JsPdfClass({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 297 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 210 mm
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options.filialNome || 'FILIAL 172 — CASCAVEL';

  // Aplicar limite de exportação se explicitamente especificado, caso contrário exporta TODOS
  const itensProcessados =
    options.limiteQuantidade && options.limiteQuantidade !== 'TODOS'
      ? itens.slice(0, Number(options.limiteQuantidade))
      : itens;

  const incluirValores = deveIncluirValoresFinanceirosPdf(options);

  // Cálculo financeiro (somente quando autorizado) e estoque consolidado
  let valorTotalFiltrado = incluirValores ? options.valorTotalFiltrado : undefined;
  if (incluirValores && valorTotalFiltrado === undefined) {
    valorTotalFiltrado = 0;
    for (let i = 0; i < itensProcessados.length; i++) {
      if (itensProcessados[i].valor_estoque) {
        valorTotalFiltrado += itensProcessados[i].valor_estoque!;
      }
    }
  }

  let estoqueTotalGeral = 0;
  for (let i = 0; i < itensProcessados.length; i++) {
    estoqueTotalGeral += (itensProcessados[i].estoque_total ?? itensProcessados[i].produto?.estoque_total ?? 0);
  }

  // Identificação dinâmica centralizada com base nos filtros efetivamente aplicados
  const identificacao = resolverIdentificacaoRelatorioPdf(options, itensProcessados);

  // Resumo legível dos filtros ativos aplicados (sem dados monetários quando ocultos)
  const resumoFiltros = resolverResumoFiltrosSeguro(
    options,
    incluirValores,
    undefined,
    itensProcessados
  );

  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja: identificacao.tituloPrincipal,
    destaqueEntidade: identificacao.destaqueEntidade,
    subtituloFaixaLaranja: options.subtituloEntidade,
    dataHoraEmissao,
    filialNome,
    totalProdutosFiltrados: itensProcessados.length,
    valorTotalFiltrado: incluirValores ? valorTotalFiltrado : undefined,
    incluirValoresFinanceiros: incluirValores,
    resumoFiltros,
  });

  // 11 Colunas Oficiais quando incluirValores = true, ou 10 redistribuídas quando false
  const cabecalhos = incluirValores
    ? [
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'FORNECEDOR',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'AGÊNCIA',
        'PROMOTOR',
        'VALOR ESTOQUE',
      ]
    : [
        'CÓDIGO',
        'DESCRIÇÃO',
        'EMB.',
        'FORNECEDOR',
        'ESTOQUE',
        'IDADE (d)',
        'DIAS S/V',
        'GRUPO',
        'AGÊNCIA',
        'PROMOTOR',
      ];

  const linhasDados = itensProcessados.length > 0
    ? itensProcessados.map((item) => {
        const cod = item.codigo_interno || item.produto?.codigo_interno || '-';
        const desc = item.descricao || item.produto?.descricao || '-';
        const emb = item.embalagem || item.produto?.embalagem || 'UN';
        const forn = extrairFornecedorProduto(item);
        const est = formatarEstoqueColunaUnica(item);
        const idade = String(item.idade ?? item.produto?.idade ?? 0);
        const dias = String(item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0);
        const grupo = extrairGrupoProduto(item);
        const ag = extrairAgenciaProduto(item);
        const prom = extrairPromotorProduto(item);

        if (incluirValores) {
          const valor = formatarMoedaBR(item.valor_estoque);
          return [cod, desc, emb, forn, est, idade, dias, grupo, ag, prom, valor];
        } else {
          return [cod, desc, emb, forn, est, idade, dias, grupo, ag, prom];
        }
      })
    : [
        [
          {
            content: 'Nenhum produto atende aos filtros selecionados.',
            colSpan: cabecalhos.length,
            styles: { halign: 'center', fontStyle: 'italic', textColor: [100, 116, 139] },
          } as any,
        ],
      ];

  // Largura útil total: 277 mm (297mm - 2*10mm margens), usando 275mm para margem de segurança
  const columnStylesConfig: Record<number, any> = incluirValores
    ? {
        0: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
        1: { cellWidth: 52, halign: 'left' }, // DESCRIÇÃO
        2: { cellWidth: 15, halign: 'center' }, // EMB.
        3: { cellWidth: 34, halign: 'left' }, // FORNECEDOR
        4: { cellWidth: 20, halign: 'right', fontStyle: 'bold' }, // ESTOQUE
        5: { cellWidth: 15, halign: 'center' }, // IDADE (d)
        6: { cellWidth: 17, halign: 'center', fontStyle: 'bold' }, // DIAS S/V
        7: { cellWidth: 24, halign: 'left' }, // GRUPO
        8: { cellWidth: 25, halign: 'left' }, // AGÊNCIA
        9: { cellWidth: 25, halign: 'left' }, // PROMOTOR
        10: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }, // VALOR ESTOQUE
      }
    : {
        0: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 62, halign: 'left' },
        2: { cellWidth: 16, halign: 'center' },
        3: { cellWidth: 38, halign: 'left' },
        4: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        5: { cellWidth: 17, halign: 'center' },
        6: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        7: { cellWidth: 26, halign: 'left' },
        8: { cellWidth: 26, halign: 'left' },
        9: { cellWidth: 28, halign: 'left' },
      };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.0,
      cellPadding: 1.4,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21], // Amarelo oficial (#FACC15)
      textColor: [15, 23, 42],
      fontSize: 7.3,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: columnStylesConfig,
  });

  const estoqueFormatado = Number.isInteger(estoqueTotalGeral)
    ? estoqueTotalGeral.toLocaleString('pt-BR')
    : estoqueTotalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 3 });

  const infoCentro = incluirValores && valorTotalFiltrado !== undefined
    ? `Exibindo ${itensProcessados.length.toLocaleString('pt-BR')} produtos | Valor Filtrado: ${formatarMoedaBR(valorTotalFiltrado)} | Estoque Consolidado: ${estoqueFormatado}`
    : `Exibindo ${itensProcessados.length.toLocaleString('pt-BR')} produtos | Estoque Consolidado EMB1+EMB9: ${estoqueFormatado}`;
  const infoEsquerda = identificacao.destaqueEntidade
    ? `ISV • ${identificacao.tituloPrincipal}: ${identificacao.destaqueEntidade} — ${filialNome}`
    : `ISV • ${identificacao.tituloPrincipal} — ${filialNome}`;
  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  options.onDocBuilt?.(doc);

  const timestamp = agora.toISOString().slice(0, 10);
  const nomeArquivo = `ISV_${identificacao.tipoRelatorio}_${timestamp}.pdf`;
  const dl = dispararDownloadPdf(doc, nomeArquivo);

  return {
    sucesso: dl.sucesso,
    totalItens: itensProcessados.length,
    totalPaginas: doc.getNumberOfPages(),
    tamanhoBytes: dl.tamanhoBytes,
    nomeArquivo,
    identificacao,
    incluiuValoresFinanceiros: incluirValores,
    colunasExportadas: cabecalhos,
  };
}

// Alias retrocompatíveis
export const gerarRelatorioIsvA3Pdf = gerarRelatorioIsvA4Pdf;

export async function gerarRelatorioEntidadeIsvA4Pdf(
  tipo: 'INDUSTRIA' | 'AGENCIA' | 'FORNECEDOR' | 'PROMOTOR',
  entidadeNome: string,
  subtitulo: string,
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): Promise<ResultadoExportacaoPdf> {
  if (tipo === 'AGENCIA') {
    return gerarRelatorioAgenciaPdf(entidadeNome, itens, {
      ...options,
      tipoAgrupamento: 'AGENCIA',
      nomeEntidade: entidadeNome,
      subtituloEntidade: subtitulo,
      preservarItensRecebidos: true,
    });
  } else if (tipo === 'PROMOTOR') {
    return gerarRelatorioPromotorPdf(entidadeNome, itens, {
      ...options,
      tipoAgrupamento: 'PROMOTOR',
      nomeEntidade: entidadeNome,
      subtituloEntidade: subtitulo,
      preservarItensRecebidos: true,
    });
  } else if (tipo === 'INDUSTRIA') {
    return gerarRelatorioFornecedorPdf(entidadeNome, itens, {
      ...options,
      tipoAgrupamento: 'INDUSTRIA',
      nomeEntidade: entidadeNome,
      industriaNome: entidadeNome,
      subtituloEntidade: subtitulo,
      preservarItensRecebidos: true,
    });
  } else {
    return gerarRelatorioFornecedorPdf(entidadeNome, itens, {
      ...options,
      tipoAgrupamento: 'FORNECEDOR',
      nomeEntidade: entidadeNome,
      fornecedorNome: entidadeNome,
      subtituloEntidade: subtitulo,
      preservarItensRecebidos: true,
    });
  }
}
