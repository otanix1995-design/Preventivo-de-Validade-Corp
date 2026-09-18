import * as XLSX from 'xlsx';
import { LoteVencimento, ProdutoSMG } from '../types';
import { cleanEanCode, isProdutoPesavel, parseEmbalagem } from './codeParser';
import {
  extractBrandFromDescription,
  removeBrandFromDescription,
  buildTagsellDescription,
} from './brandIdentifierService';

/**
 * MODELO OFICIAL TAGSELL - EXATAMENTE 19 COLUNAS
 * Validado na prática no sistema Tagsell.
 *
 * REGRAS CRÍTICAS:
 * 1. NÃO alterar os cabeçalhos.
 * 2. NÃO alterar a ordem das colunas.
 * 3. NÃO remover colunas vazias.
 * 4. NÃO renomear colunas.
 * 5. NÃO adicionar colunas.
 * 6. NÃO remover acentos.
 * 7. NÃO alterar espaços.
 * 8. NÃO abreviar ou traduzir.
 * 9. NÃO transformar em camelCase.
 * 10. EXATAMENTE 19 colunas.
 */
export const TAGSELL_COLUNAS_OFICIAIS = [
  'DINÂMICA COMERCIAL',
  'FORMATO',
  'LAYOUT COORDENADA',
  'CAMPANHA',
  'MÉDIA VAREJO',
  'CÓDIGO DO PRODUTO',
  'UNIDADE DE VENDA',
  'DESCRIÇÃO SECUNDÁRIA 2',
  'DESCRIÇÃO PRINCIPAL',
  'DESCRIÇÃO SECUNDÁRIA',
  'VÁLIDO ATÉ',
  'VÁLIDO DE',
  'CÓDIGO DE BARRAS',
  'MARCA',
  'PREÇO PROMOCIONAL',
  'TRIBUTAÇÃO VAREJO',
  'PREÇO',
  'QRCODE',
  'PREÇO VAREJO',
] as const;

export type TagsellColuna = typeof TAGSELL_COLUNAS_OFICIAIS[number];

export interface ItemCartazValidacao {
  lote: LoteVencimento;
  produto?: ProdutoSMG;
  codigoRaiz: string;
  descricao: string;
  descricaoTagsell?: string;
  gramagem: string;
  validadeFormatada: string;
  ean: string;
  marca: string;
  precoNormal: number | null; // DE (Coluna PREÇO)
  precoRebaixe: number | null; // POR (Coluna PREÇO VAREJO)
  descontoPercentual: number | null;
  valido: boolean;
  erros: string[];
}

/**
 * Validador rigoroso do schema Tagsell.
 * Verifica se existem EXATAMENTE 19 colunas na ordem e ortografia oficiais.
 */
export function validarSchemaTagsell(cabecalhos: readonly string[] | string[]): {
  valido: boolean;
  erros: string[];
} {
  const erros: string[] = [];

  if (cabecalhos.length !== 19) {
    erros.push(
      `Incompatibilidade de Schema: A planilha possui ${cabecalhos.length} colunas, mas o modelo oficial exige EXATAMENTE 19 colunas.`
    );
  }

  TAGSELL_COLUNAS_OFICIAIS.forEach((esperado, idx) => {
    const atual = cabecalhos[idx];
    if (atual !== esperado) {
      erros.push(
        `Posição ${idx + 1}: esperado "${esperado}", mas encontrado "${atual || '[Célula Ausente]'}"`
      );
    }
  });

  return {
    valido: erros.length === 0,
    erros,
  };
}

/**
 * Extrai somente a raiz do código interno do produto.
 * Exemplo:
 * - "76916-185" -> "76916"
 * - "00076916" -> "76916"
 * - "76916" -> "76916"
 */
export function extrairCodigoRaizTagsell(codigo: string | number | undefined | null): string {
  if (codigo === null || codigo === undefined) return '';
  const str = String(codigo).trim();
  if (!str) return '';

  const preHyphen = str.includes('-') ? str.split('-')[0].trim() : str;
  const semZeros = preHyphen.replace(/^0+/, '');
  return semZeros || preHyphen;
}

/**
 * Formata a data de vencimento para o formato obrigatório do Tagsell na coluna UNIDADE DE VENDA:
 * "VENCIMENTO: DD/MM/AAAA"
 */
export function formatarValidadeTagsell(data: string | undefined | null): string {
  if (!data) return '';
  const str = String(data).trim();

  let dia = '';
  let mes = '';
  let ano = '';

  if (str.includes('-')) {
    const parts = str.split('T')[0].split('-');
    if (parts.length === 3) {
      ano = parts[0];
      mes = parts[1].padStart(2, '0');
      dia = parts[2].padStart(2, '0');
    }
  } else if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      dia = parts[0].padStart(2, '0');
      mes = parts[1].padStart(2, '0');
      ano = parts[2];
    }
  }

  if (dia && mes && ano) {
    return `VENCIMENTO: ${dia}/${mes}/${ano}`;
  }

  return `VENCIMENTO: ${str}`;
}

/**
 * Extrai embalagem/gramagem padronizada para DESCRIÇÃO SECUNDÁRIA 2.
 * Padrões aceitos: (KG), (90G), (200G), (400G), etc.
 * Se não disponível de forma confiável: retorna string vazia (célula vazia).
 */
export function extrairGramagemTagsell(produto?: ProdutoSMG, lote?: LoteVencimento): string {
  const embStr = produto?.embalagem || lote?.embalagem || '';

  // 1. Produto Pesável / KG
  if (isProdutoPesavel(embStr) || produto?.unidade_medida === 'KG') {
    return '(KG)';
  }

  // 2. Gramagem já normalizada do produto (ex: "400G")
  if (produto?.gramagemTexto) {
    const limpo = produto.gramagemTexto.trim().toUpperCase().replace(/[()]/g, '');
    if (limpo) return `(${limpo})`;
  }

  // 3. Embalagem convertida do parser (ex: "CXA 1 X 6 X 1KG" -> "1KG", "FD 1 X 24 X 500G" -> "500G")
  const parsed = parseEmbalagem(embStr);
  if (parsed.peso_ou_vol) {
    const limpo = parsed.peso_ou_vol.trim().toUpperCase().replace(/[()]/g, '');
    if (limpo) return `(${limpo})`;
  }

  // 4. Buscar na descrição do produto padrão de gramagem explícito (ex: 400G, 90G, 200G, 1KG)
  const desc = produto?.descricao || lote?.descricao_produto || '';
  const matchDesc = desc.match(/\b(\d+(?:[.,]\d+)?\s*(?:KG|G|GR|ML|L))\b/i);
  if (matchDesc) {
    const rawVal = matchDesc[1].toUpperCase().replace(/\s+/g, '');
    return `(${rawVal})`;
  }

  return '';
}

/**
 * Extrai código EAN vinculado confiável.
 * Se não existir, retorna string vazia (célula vazia). Não inventa EAN.
 */
export function extrairEanTagsell(produto?: ProdutoSMG): string {
  if (!produto?.eans || produto.eans.length === 0) {
    return '';
  }
  const primeiroEan = produto.eans[0];
  const limpo = cleanEanCode(primeiroEan);
  return limpo || '';
}

/**
 * Extrai a marca do produto a partir da Descrição Mercadoria da SMGOI013
 * utilizando o serviço central de identificação controlada (dicionário de marcas).
 * Se não identificada com confiabilidade, retorna string vazia (célula vazia).
 * NUNCA inventa marca.
 */
export function extrairMarcaTagsell(produto?: ProdutoSMG, lote?: LoteVencimento): string {
  const desc = produto?.descricao || lote?.descricao_produto || '';
  const marcaIdentificada = extractBrandFromDescription(desc);
  if (marcaIdentificada) {
    return marcaIdentificada;
  }

  // Fallback seguro: se houver marca explícita no cadastro
  const rawMarca = (produto as any)?.marca;
  if (typeof rawMarca === 'string' && rawMarca.trim()) {
    return rawMarca.trim().toUpperCase();
  }

  return '';
}

/**
 * Valida os dados de um lote e produto para exportação no Tagsell.
 */
export function validarItemParaCartaz(
  lote: LoteVencimento,
  produto?: ProdutoSMG
): ItemCartazValidacao {
  const erros: string[] = [];

  const codigoRaiz = extrairCodigoRaizTagsell(lote.codigo_interno || lote.codigo_exibicao);
  if (!codigoRaiz) {
    erros.push('Código do produto não informado.');
  }

  const validadeFormatada = formatarValidadeTagsell(lote.data_validade);
  if (!lote.data_validade) {
    erros.push('Data de validade não informada.');
  }

  // Preço Normal (DE)
  const precoNormalVal =
    lote.precoNormal !== undefined && lote.precoNormal !== null && Number(lote.precoNormal) > 0
      ? Number(lote.precoNormal)
      : lote.preco_normal !== undefined && lote.preco_normal !== null && Number(lote.preco_normal) > 0
      ? Number(lote.preco_normal)
      : null;

  if (precoNormalVal === null) {
    erros.push('Preço Normal (DE) não informado.');
  }

  // Preço de Rebaixe (POR)
  const precoRebaixeVal =
    lote.precoTrabalhado !== undefined && lote.precoTrabalhado !== null && Number(lote.precoTrabalhado) > 0
      ? Number(lote.precoTrabalhado)
      : lote.preco_trabalhado !== undefined && lote.preco_trabalhado !== null && Number(lote.preco_trabalhado) > 0
      ? Number(lote.preco_trabalhado)
      : null;

  if (precoRebaixeVal === null) {
    erros.push('Preço de Rebaixe (POR) não informado.');
  }

  // Validação DE / POR
  let descontoPercentual: number | null = null;
  if (precoNormalVal !== null && precoRebaixeVal !== null) {
    if (precoRebaixeVal >= precoNormalVal) {
      erros.push(
        `Preço de Rebaixe (R$ ${precoRebaixeVal.toFixed(2).replace('.', ',')}) deve ser menor que o Preço Normal (R$ ${precoNormalVal.toFixed(2).replace('.', ',')}).`
      );
    } else {
      descontoPercentual = Math.round(((precoNormalVal - precoRebaixeVal) / precoNormalVal) * 100);
    }
  }

  const descricao = (lote.descricao_produto || produto?.descricao || '').trim().toUpperCase();
  const gramagem = extrairGramagemTagsell(produto, lote);
  const ean = extrairEanTagsell(produto);
  const marca = extrairMarcaTagsell(produto, lote);
  const descricaoTagsell = buildTagsellDescription(descricao, marca);

  return {
    lote,
    produto,
    codigoRaiz,
    descricao,
    descricaoTagsell,
    gramagem,
    validadeFormatada,
    ean,
    marca,
    precoNormal: precoNormalVal,
    precoRebaixe: precoRebaixeVal,
    descontoPercentual,
    valido: erros.length === 0,
    erros,
  };
}

/**
 * Constrói a linha com EXATAMENTE 19 elementos correspondentes às 19 colunas do Tagsell.
 *
 * MAPEAMENTO OFICIAL:
 * 1. DINÂMICA COMERCIAL = "DE POR"
 * 2. FORMATO = "A6 - Paisagem"
 * 3. LAYOUT COORDENADA = "sas46.A9"
 * 4. CAMPANHA = "OFERTA"
 * 5. MÉDIA VAREJO = "" (célula vazia)
 * 6. CÓDIGO DO PRODUTO = Raiz do código interno
 * 7. UNIDADE DE VENDA = "VENCIMENTO: DD/MM/AAAA"
 * 8. DESCRIÇÃO SECUNDÁRIA 2 = Embalagem/gramagem ex: "(400G)" ou "(KG)"
 * 9. DESCRIÇÃO PRINCIPAL = Descrição do produto
 * 10. DESCRIÇÃO SECUNDÁRIA = "" (célula vazia)
 * 11. VÁLIDO ATÉ = "" (célula vazia)
 * 12. VÁLIDO DE = "" (célula vazia)
 * 13. CÓDIGO DE BARRAS = EAN se disponível, senão "" (célula vazia)
 * 14. MARCA = Marca se disponível, senão "" (célula vazia)
 * 15. PREÇO PROMOCIONAL = "" (célula vazia)
 * 16. TRIBUTAÇÃO VAREJO = "" (célula vazia)
 * 17. PREÇO = Preço Normal (DE) em número
 * 18. QRCODE = "" (célula vazia)
 * 19. PREÇO VAREJO = Preço de Rebaixe (POR) em número
 */
export function gerarLinhaTagsell(item: ItemCartazValidacao): (string | number)[] {
  // Coluna 9: DESCRIÇÃO PRINCIPAL (descrição tratada para o Tagsell sem RF. e sem duplicar a marca)
  const descricaoParaTagsell = item.descricaoTagsell || buildTagsellDescription(item.descricao, item.marca);

  const linha: (string | number)[] = [
    'DE POR', // 1. DINÂMICA COMERCIAL
    'A6 - Paisagem', // 2. FORMATO
    'sas46.A9', // 3. LAYOUT COORDENADA
    'OFERTA', // 4. CAMPANHA
    '', // 5. MÉDIA VAREJO (célula vazia)
    item.codigoRaiz, // 6. CÓDIGO DO PRODUTO (raiz)
    item.validadeFormatada, // 7. UNIDADE DE VENDA (VENCIMENTO: DD/MM/AAAA)
    item.gramagem, // 8. DESCRIÇÃO SECUNDÁRIA 2 ((400G), (KG), etc)
    descricaoParaTagsell, // 9. DESCRIÇÃO PRINCIPAL (sem duplicar a marca)
    '', // 10. DESCRIÇÃO SECUNDÁRIA (célula vazia)
    '', // 11. VÁLIDO ATÉ (célula vazia)
    '', // 12. VÁLIDO DE (célula vazia)
    item.ean, // 13. CÓDIGO DE BARRAS
    item.marca, // 14. MARCA
    '', // 15. PREÇO PROMOCIONAL (célula vazia)
    '', // 16. TRIBUTAÇÃO VAREJO (célula vazia)
    item.precoNormal !== null ? Number(item.precoNormal.toFixed(2)) : '', // 17. PREÇO (DE - número)
    '', // 18. QRCODE (célula vazia)
    item.precoRebaixe !== null ? Number(item.precoRebaixe.toFixed(2)) : '', // 19. PREÇO VAREJO (POR - número)
  ];

  if (linha.length !== 19) {
    throw new Error(`Falha crítica: linha gerada possui ${linha.length} colunas em vez de 19.`);
  }

  return linha;
}

/**
 * Gera e realiza o download do arquivo .XLSX estritamente compatível com o Tagsell.
 * Valida o schema antes de gerar e garante que apenas os itens selecionados são exportados.
 */
export function exportarCartazesTagsellXLSX(
  itensValidados: ItemCartazValidacao[]
): {
  sucesso: boolean;
  nomeArquivo: string;
  totalProdutos: number;
  totalLinhas: number;
  erros?: string[];
} {
  if (!itensValidados || itensValidados.length === 0) {
    return {
      sucesso: false,
      nomeArquivo: '',
      totalProdutos: 0,
      totalLinhas: 0,
      erros: ['Nenhum produto selecionado para exportação.'],
    };
  }

  // 1. Validar se algum item possui pendências críticas
  const itensInvalidos = itensValidados.filter((it) => !it.valido);
  if (itensInvalidos.length > 0) {
    const listaErros = itensInvalidos.map(
      (it) => `${it.descricao || it.codigoRaiz}: ${it.erros.join(', ')}`
    );
    return {
      sucesso: false,
      nomeArquivo: '',
      totalProdutos: itensValidados.length,
      totalLinhas: 0,
      erros: listaErros,
    };
  }

  // 2. Executar Validação Rigorosa do Schema Oficial (19 colunas)
  const validacaoSchema = validarSchemaTagsell(TAGSELL_COLUNAS_OFICIAIS);
  if (!validacaoSchema.valido) {
    return {
      sucesso: false,
      nomeArquivo: '',
      totalProdutos: itensValidados.length,
      totalLinhas: 0,
      erros: validacaoSchema.erros,
    };
  }

  // 3. Montar Linhas do Excel
  // Linha 1 = Cabeçalhos Oficiais
  const cabecalhos = [...TAGSELL_COLUNAS_OFICIAIS];
  const dados = itensValidados.map((item) => gerarLinhaTagsell(item));
  const todasLinhas = [cabecalhos, ...dados];

  // 4. Verificação de integridade pós-montagem
  todasLinhas.forEach((linha, rowIdx) => {
    if (linha.length !== 19) {
      throw new Error(
        `Erro de integridade na linha ${rowIdx + 1}: esperadas 19 colunas, encontradas ${linha.length}.`
      );
    }
  });

  // 5. Criar Worksheet e Workbook com SheetJS
  const ws = XLSX.utils.aoa_to_sheet(todasLinhas);

  // Configurar larguras recomendadas de coluna para visualização limpa no Excel
  ws['!cols'] = [
    { wch: 22 }, // 1. DINÂMICA COMERCIAL
    { wch: 16 }, // 2. FORMATO
    { wch: 20 }, // 3. LAYOUT COORDENADA
    { wch: 14 }, // 4. CAMPANHA
    { wch: 16 }, // 5. MÉDIA VAREJO
    { wch: 20 }, // 6. CÓDIGO DO PRODUTO
    { wch: 26 }, // 7. UNIDADE DE VENDA
    { wch: 24 }, // 8. DESCRIÇÃO SECUNDÁRIA 2
    { wch: 36 }, // 9. DESCRIÇÃO PRINCIPAL
    { wch: 24 }, // 10. DESCRIÇÃO SECUNDÁRIA
    { wch: 14 }, // 11. VÁLIDO ATÉ
    { wch: 14 }, // 12. VÁLIDO DE
    { wch: 18 }, // 13. CÓDIGO DE BARRAS
    { wch: 16 }, // 14. MARCA
    { wch: 22 }, // 15. PREÇO PROMOCIONAL
    { wch: 20 }, // 16. TRIBUTAÇÃO VAREJO
    { wch: 12 }, // 17. PREÇO
    { wch: 12 }, // 18. QRCODE
    { wch: 15 }, // 19. PREÇO VAREJO
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tagsell');

  // 6. Gerar nome do arquivo com data e horário
  const agora = new Date();
  const dia = String(agora.getDate()).padStart(2, '0');
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const ano = agora.getFullYear();
  const hora = String(agora.getHours()).padStart(2, '0');
  const min = String(agora.getMinutes()).padStart(2, '0');
  const nomeArquivo = `CARTAZES_VENCIMENTOS_${dia}-${mes}-${ano}_${hora}${min}.xlsx`;

  // 7. Escrever e descarregar arquivo no navegador
  XLSX.writeFile(wb, nomeArquivo);

  return {
    sucesso: true,
    nomeArquivo,
    totalProdutos: itensValidados.length,
    totalLinhas: todasLinhas.length,
  };
}

export {
  extractBrandFromDescription,
  removeBrandFromDescription,
  buildTagsellDescription,
} from './brandIdentifierService';

