/**
 * Code and Text Parsing Service for SMGOI013 and EANs
 * Strictly enforces leading-zero and text-only preservation rules.
 */

export interface NormalizedCodigoSMGO {
  codigoOriginal: string;
  codigoInterno: string;
  digito: string;
  codigoExibicao: string;
  chaveNormalizada: string;
  isValid: boolean;
  erro?: string;
}

export interface ParsedCodeResult {
  codigo_original: string;
  codigo_interno: string;
  digito: string;
  codigo_exibicao: string;
  chave_normalizada: string;
  is_valid: boolean;
  erro?: string;
}

/**
 * Central and reusable normalization function for SMGOI013 and Vínculos EAN.
 *
 * Rules:
 * 1. Read input strictly as TEXT.
 * 2. Separate by hyphen.
 * 3. Before hyphen: remove ONLY leading zeros ("00047293" -> "47293", "00004665" -> "4665").
 * 4. After hyphen: PRESERVE digits completely as string ("196", "154", "009"). Never parseInt.
 * 5. If separate rawDigito is provided, preserve its string value.
 *
 * Examples:
 * normalizeCodigoSMGO("00047293-196") -> { codigoOriginal: "00047293-196", codigoInterno: "47293", digito: "196", codigoExibicao: "47293-196", chaveNormalizada: "47293-196" }
 * normalizeCodigoSMGO("00004665-154") -> { codigoOriginal: "00004665-154", codigoInterno: "4665", digito: "154", codigoExibicao: "4665-154", chaveNormalizada: "4665-154" }
 * normalizeCodigoSMGO("47293", "196") -> { codigoOriginal: "47293", codigoInterno: "47293", digito: "196", codigoExibicao: "47293-196", chaveNormalizada: "47293-196" }
 */
export function normalizeCodigoSMGO(rawInput: any, rawDigitoInput?: any): NormalizedCodigoSMGO {
  if (rawInput === null || rawInput === undefined) {
    return {
      codigoOriginal: '',
      codigoInterno: '',
      digito: '',
      codigoExibicao: '',
      chaveNormalizada: '',
      isValid: false,
      erro: 'Código vazio ou nulo',
    };
  }

  // 1. Ler o valor como TEXTO
  let rawStr = String(rawInput).trim();

  // Se veio como float do excel ex: "47293.0", remove decimal .0
  if (/^\d+\.0+$/.test(rawStr)) {
    rawStr = rawStr.split('.')[0];
  }

  const codigoOriginal = rawStr;

  if (!rawStr) {
    return {
      codigoOriginal: '',
      codigoInterno: '',
      digito: '',
      codigoExibicao: '',
      chaveNormalizada: '',
      isValid: false,
      erro: 'Código vazio',
    };
  }

  let codigoInterno = '';
  let digito = '';

  // 2. Separar por delimitador (- ou /) se existir
  if (rawStr.includes('-')) {
    const parts = rawStr.split('-');
    const preHyphen = parts[0].trim();
    const postHyphen = parts.slice(1).join('-').trim();

    codigoInterno = preHyphen.replace(/^0+/, '') || '0';
    digito = postHyphen;
  } else if (rawStr.includes('/') && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(rawStr)) {
    const parts = rawStr.split('/');
    const preSlash = parts[0].trim();
    const postSlash = parts.slice(1).join('/').trim();

    codigoInterno = preSlash.replace(/^0+/, '') || '0';
    digito = postSlash;
  } else {
    // Sem delimitador na string principal
    const cleanDigits = rawStr.replace(/^0+/, '');
    codigoInterno = cleanDigits || '0';
  }

  // Se foi passado dígito separado (ex: coluna DÍGITO na planilha de vínculos)
  if (rawDigitoInput !== null && rawDigitoInput !== undefined) {
    let digStr = String(rawDigitoInput).trim();
    if (/^\d+\.0+$/.test(digStr)) {
      digStr = digStr.split('.')[0];
    }
    if (digStr) {
      digito = digStr;
    }
  }

  if (!codigoInterno || codigoInterno === '0') {
    return {
      codigoOriginal,
      codigoInterno: '',
      digito: '',
      codigoExibicao: '',
      chaveNormalizada: '',
      isValid: false,
      erro: 'Código interno inválido',
    };
  }

  const codigoExibicao = digito ? `${codigoInterno}-${digito}` : codigoInterno;
  const chaveNormalizada = codigoExibicao;

  return {
    codigoOriginal,
    codigoInterno,
    digito,
    codigoExibicao,
    chaveNormalizada,
    isValid: true,
  };
}

/**
 * Parses raw code from SMGOI013 according to critical specification rules.
 */
export function parseSMGCode(rawInput: any): ParsedCodeResult {
  const norm = normalizeCodigoSMGO(rawInput);
  return {
    codigo_original: norm.codigoOriginal,
    codigo_interno: norm.codigoInterno,
    digito: norm.digito,
    codigo_exibicao: norm.codigoExibicao,
    chave_normalizada: norm.chaveNormalizada,
    is_valid: norm.isValid,
    erro: norm.erro,
  };
}

/**
 * Specifically parses Código Interno and optional Dígito from VÍNCULOS EAN spreadsheet.
 */
export function parseCodigoInternoEan(
  rawCodigo: any,
  rawDigito?: any
): {
  codigo_interno: string;
  digito: string;
  codigo_exibicao: string;
  chave_normalizada: string;
  is_valid: boolean;
} {
  const norm = normalizeCodigoSMGO(rawCodigo, rawDigito);
  return {
    codigo_interno: norm.codigoInterno,
    digito: norm.digito,
    codigo_exibicao: norm.codigoExibicao,
    chave_normalizada: norm.chaveNormalizada,
    is_valid: norm.isValid,
  };
}

/**
 * Formats EAN code safely as string/text:
 * - Preserves all leading zeros.
 * - Prevents scientific notation (e.g. 7.891234567895E+12).
 * - Strips trailing .0 artifacts from Excel numbers.
 * - Strips non-digit formatting characters.
 */
export function cleanEanCode(rawEan: any): string {
  if (rawEan === null || rawEan === undefined) return '';

  let eanStr = String(rawEan).trim();

  // If scientific notation string happened (e.g. "7.89890975538E+12")
  if (/[eE][+-]?\d+/.test(eanStr)) {
    try {
      const num = Number(rawEan);
      if (!isNaN(num)) {
        // Convert to big integer notation
        eanStr = BigInt(Math.round(num)).toString();
      }
    } catch {
      // Fallback
    }
  }

  // Strip trailing decimals if read as float from excel (.0, .00, .000)
  if (/\.0+$/.test(eanStr)) {
    eanStr = eanStr.replace(/\.0+$/, '');
  }

  // Remove spaces and any non-digit formatting characters
  const digitsOnly = eanStr.replace(/\D/g, '');
  return digitsOnly || eanStr;
}

export interface EmbalagemConversion {
  tipoControle: 'PESO' | 'UNIDADE_CAIXA';
  produtoPesavel: boolean;
  unidadeVenda: string; // "KG" or "UN" or "CXA"
  fator: number; // e.g. 6 in "CXA 1 X 6 X 1KG", 1 for "KG"
  fatorGramas?: number; // 1000 for "KG 1 X 1000 X 1G"
  tipo: string; // "KG", "CXA", "FD", "PCT", "UN", etc.
  peso_ou_vol?: string; // "1KG", "500G", etc. (only for packaged products!)
  rotulo_emb1: string; // "EMB1" for pesável, "EMB1 UNIDADE" for packaged
  rotulo_emb9: string; // "EMB9" for pesável, "EMB9 CAIXA" for packaged
  unidade_emb1: string; // "KG" or "UN"
  unidade_emb9: string; // "KG" or "CX"
  unidade_total: string; // "KG" or "UN"
  descricao_formatada: (totalUnidades: number) => string;
  formatarQuantidade: (quantidade: number) => string;
}

/**
 * Checks if the primary packaging type indicates a weighable product sold by KG.
 * 
 * Rules:
 * - Checks the PREFIX / FIRST ELEMENT of the packaging string.
 * - If it starts with "KG", "QUILO", "KILO", "PESO", or "PESAVEL" -> true
 * - If it starts with "CXA", "CX", "FD", "PCT", "UN", etc. -> false (even if it has "1KG" at the end like "CXA 1 X 6 X 1KG")
 */
export function isProdutoPesavel(rawEmbalagem: string | undefined | null): boolean {
  if (!rawEmbalagem || typeof rawEmbalagem !== 'string') return false;
  const clean = rawEmbalagem.trim().toUpperCase();
  return /^(KG|QUILO|KILO|PESAVEL|PESO)\b/i.test(clean);
}

/**
 * Formats a weight in KG, formatting decimals cleanly in pt-BR locale without unnecessary zeros.
 * Examples:
 * - 662 -> "662 KG"
 * - 12.45 -> "12,45 KG"
 * - 12.450 -> "12,45 KG"
 * - 2.350 -> "2,35 KG"
 */
export function formatarPesoKg(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '0 KG';
  if (Number.isInteger(val)) {
    return `${val} KG`;
  }
  const formatted = val.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 3 });
  return `${formatted} KG`;
}

/**
 * Parses the EMBALAGEM column from SMGOI013.
 * 
 * Precedence Rule:
 * 1. The FIRST element of the packaging defines the commercial type.
 *    If starts with "KG" (e.g. "KG 1 X 1000 X 1G", "KG 1 X 1", "KG"):
 *    - tipoControle = "PESO"
 *    - unidadeVenda = "KG"
 *    - produtoPesavel = true
 *    - fator = 1 (fatorGramas = 1000)
 *    - NOT 1000 units in a box!
 *    - NOT unit presentation of "1G"!
 * 
 * 2. If starts with "CXA", "FD", "PCT", "UN", etc.:
 *    - tipoControle = "UNIDADE_CAIXA"
 *    - produtoPesavel = false
 *    - parse multiplier & unit presentation (e.g. "CXA 1 X 6 X 1KG" -> 6 units per box, presentation 1KG)
 */
export function parseEmbalagem(rawEmbalagem: string | undefined | null): EmbalagemConversion {
  if (!rawEmbalagem || typeof rawEmbalagem !== 'string') {
    return {
      tipoControle: 'UNIDADE_CAIXA',
      produtoPesavel: false,
      unidadeVenda: 'UN',
      fator: 1,
      tipo: 'UN',
      rotulo_emb1: 'EMB1',
      rotulo_emb9: 'EMB9 DEPÓSITO',
      unidade_emb1: 'CX',
      unidade_emb9: 'UN',
      unidade_total: 'UN',
      descricao_formatada: (total) => `${total} ${total === 1 ? 'unidade' : 'unidades'}`,
      formatarQuantidade: (qtd) => `${qtd} ${qtd === 1 ? 'unidade' : 'unidades'}`,
    };
  }

  const clean = rawEmbalagem.trim().toUpperCase();

  // 1. REGRA PRINCIPAL: PRODUTO PESÁVEL / KG NO INÍCIO
  if (isProdutoPesavel(clean)) {
    return {
      tipoControle: 'PESO',
      produtoPesavel: true,
      unidadeVenda: 'KG',
      fator: 1,
      fatorGramas: 1000,
      tipo: 'KG',
      peso_ou_vol: undefined, // NÃO interpretar "1G" como gramagem comercial
      rotulo_emb1: 'EMB1',
      rotulo_emb9: 'EMB9 DEPÓSITO',
      unidade_emb1: 'KG',
      unidade_emb9: 'G',
      unidade_total: 'KG',
      descricao_formatada: (total) => formatarPesoKg(total),
      formatarQuantidade: (qtd) => formatarPesoKg(qtd),
    };
  }

  // 2. PRODUTO EMBALADO (CAIXA / FARDO / PACOTE / UNIDADE)
  // Pattern 1: "CXA 1 X 6 X 1KG" or "CX 1 X 12" or "FD 1 X 24 X 500G" or "1 X 6"
  const match1X = clean.match(/(?:([A-Z]+)\s+)?1\s*X\s*(\d+)(?:\s*X\s*([0-9A-Z.,]+))?/i);
  if (match1X) {
    const tipo = match1X[1] || 'CX';
    const fator = parseInt(match1X[2], 10);
    const peso_ou_vol = match1X[3] || undefined;

    if (fator > 1) {
      const tipoNome = tipo.includes('CX') || tipo.includes('CAIXA') ? 'caixa' :
                       tipo.includes('FD') || tipo.includes('FARDO') ? 'fardo' :
                       tipo.includes('PCT') || tipo.includes('PAC') ? 'pacote' : 'embalagem';

      const tipoPlural = tipo.includes('CX') || tipo.includes('CAIXA') ? 'caixas' :
                         tipo.includes('FD') || tipo.includes('FARDO') ? 'fardos' :
                         tipo.includes('PCT') || tipo.includes('PAC') ? 'pacotes' : 'embalagens';

      return {
        tipoControle: 'UNIDADE_CAIXA',
        produtoPesavel: false,
        unidadeVenda: 'UN',
        fator,
        tipo,
        peso_ou_vol,
        rotulo_emb1: 'EMB1',
        rotulo_emb9: 'EMB9 DEPÓSITO',
        unidade_emb1: 'CX',
        unidade_emb9: 'UN',
        unidade_total: 'UN',
        descricao_formatada: (total) => {
          if (total <= 0) return '0 unidades';
          const caixas = Math.floor(total / fator);
          const restos = Math.round((total % fator) * 100) / 100;

          if (caixas > 0 && restos > 0) {
            return `${caixas} ${caixas === 1 ? tipoNome : tipoPlural} + ${restos} ${restos === 1 ? 'unidade' : 'unidades'}`;
          } else if (caixas > 0 && restos === 0) {
            return `${caixas} ${caixas === 1 ? tipoNome : tipoPlural}`;
          } else {
            return `${restos} ${restos === 1 ? 'unidade' : 'unidades'}`;
          }
        },
        formatarQuantidade: (qtd) => `${qtd} ${qtd === 1 ? 'unidade' : 'unidades'}`,
      };
    }
  }

  // Pattern 2: Direct multiplier like "6UN", "12 UN", "CX 24"
  const matchDirect = clean.match(/(\d+)\s*(?:UN|UNIDADES|UNID)/i);
  if (matchDirect) {
    const fator = parseInt(matchDirect[1], 10);
    if (fator > 1) {
      return {
        tipoControle: 'UNIDADE_CAIXA',
        produtoPesavel: false,
        unidadeVenda: 'UN',
        fator,
        tipo: 'CX',
        rotulo_emb1: 'EMB1',
        rotulo_emb9: 'EMB9 DEPÓSITO',
        unidade_emb1: 'CX',
        unidade_emb9: 'UN',
        unidade_total: 'UN',
        descricao_formatada: (total) => {
          const caixas = Math.floor(total / fator);
          const restos = total % fator;
          if (caixas > 0 && restos > 0) {
            return `${caixas} caixas + ${restos} unidades`;
          } else if (caixas > 0) {
            return `${caixas} caixas`;
          }
          return `${restos} unidades`;
        },
        formatarQuantidade: (qtd) => `${qtd} ${qtd === 1 ? 'unidade' : 'unidades'}`,
      };
    }
  }

  // Default unit
  return {
    tipoControle: 'UNIDADE_CAIXA',
    produtoPesavel: false,
    unidadeVenda: 'UN',
    fator: 1,
    tipo: 'UN',
    rotulo_emb1: 'EMB1',
    rotulo_emb9: 'EMB9 DEPÓSITO',
    unidade_emb1: 'CX',
    unidade_emb9: 'UN',
    unidade_total: 'UN',
    descricao_formatada: (total) => `${total} ${total === 1 ? 'unidade' : 'unidades'}`,
    formatarQuantidade: (qtd) => `${qtd} ${qtd === 1 ? 'unidade' : 'unidades'}`,
  };
}

export interface PosicaoEstoqueCalculada {
  isPesavel: boolean;
  rotuloEmb1: string; // "EMB1"
  valorEmb1: number;
  unidadeEmb1: string; // "KG" or "CX"
  textoEmb1: string; // "13 KG" or "79 CX"

  rotuloEmb9: string; // "EMB9 DEPÓSITO"
  valorEmb9: number;
  unidadeEmb9: string; // "G" or "UN"
  textoEmb9: string; // "699 G" or "1 UN"

  rotuloTotal: string; // "TOTAL"
  estoqueTotal: number; // 13.699 or 475
  unidadeTotal: string; // "KG" or "UN"
  textoTotal: string; // "13,699 KG" or "475 UN"

  conversaoTexto: string; // "13 KG + 699 G" or "79 caixas + 1 unidade"
}

/**
 * Calculates stock position according to business rules:
 * 
 * 1. PRODUTOS CONTROLADOS POR PESO / KG:
 *    - EMB1 = Quilos inteiros (KG)
 *    - EMB9 = Gramas complementares (G)
 *    - Formula: totalKg = EMB1 + (EMB9 / 1000)
 *    - Display: EMB1: 13 KG | EMB9 DEPÓSITO: 699 G | TOTAL: 13,699 KG | CONVERSÃO: 13 KG + 699 G
 * 
 * 2. PRODUTOS CONTROLADOS POR CAIXA / UNIDADE:
 *    - EMB1 = Quantidade de Caixas (CX)
 *    - EMB9 = Quantidade de Unidades avulsas (UN)
 *    - Formula: totalUnidades = (EMB1 * unidadesPorCaixa) + EMB9
 *    - Display: EMB1: 79 CX | EMB9 DEPÓSITO: 1 UN | TOTAL: 475 UN | CONVERSÃO: 79 caixas + 1 unidade
 */
export function calcularPosicaoEstoque(
  emb1Raw: number | string | undefined | null,
  emb9Raw: number | string | undefined | null,
  rawEmbalagem: string | undefined | null,
  fatorProprio?: number
): PosicaoEstoqueCalculada {
  const emb1 = typeof emb1Raw === 'number'
    ? (isNaN(emb1Raw) ? 0 : emb1Raw)
    : parseFloat(String(emb1Raw || 0).replace(',', '.')) || 0;
  const emb9 = typeof emb9Raw === 'number'
    ? (isNaN(emb9Raw) ? 0 : emb9Raw)
    : parseFloat(String(emb9Raw || 0).replace(',', '.')) || 0;

  const isPesavel = isProdutoPesavel(rawEmbalagem);

  if (isPesavel) {
    const estoqueTotal = Math.round((emb1 + (emb9 / 1000)) * 1000) / 1000;
    const textoTotal = formatarPesoKg(estoqueTotal);

    let conversaoTexto = `${emb1} KG + ${emb9} G`;
    if (emb1 === 0 && emb9 === 0) {
      conversaoTexto = '0 KG';
    } else if (emb1 > 0 && emb9 === 0) {
      conversaoTexto = `${emb1} KG`;
    } else if (emb1 === 0 && emb9 > 0) {
      conversaoTexto = `${emb9} G`;
    }

    return {
      isPesavel: true,
      rotuloEmb1: 'EMB1',
      valorEmb1: emb1,
      unidadeEmb1: 'KG',
      textoEmb1: `${emb1} KG`,

      rotuloEmb9: 'EMB9 DEPÓSITO',
      valorEmb9: emb9,
      unidadeEmb9: 'G',
      textoEmb9: `${emb9} G`,

      rotuloTotal: 'TOTAL',
      estoqueTotal,
      unidadeTotal: 'KG',
      textoTotal,

      conversaoTexto,
    };
  }

  const embData = parseEmbalagem(rawEmbalagem);
  const fator = fatorProprio && fatorProprio > 1 ? fatorProprio : (embData.fator > 1 ? embData.fator : 1);
  const estoqueTotal = (emb1 * fator) + emb9;
  const textoTotal = `${estoqueTotal} UN`;

  const tipoNomeSingular = embData.tipo.includes('FD') ? 'fardo' : embData.tipo.includes('PCT') ? 'pacote' : 'caixa';
  const tipoNomePlural = embData.tipo.includes('FD') ? 'fardos' : embData.tipo.includes('PCT') ? 'pacotes' : 'caixas';

  let conversaoTexto = '';
  if (emb1 > 0 && emb9 > 0) {
    const cxLabel = emb1 === 1 ? tipoNomeSingular : tipoNomePlural;
    const unLabel = emb9 === 1 ? 'unidade' : 'unidades';
    conversaoTexto = `${emb1} ${cxLabel} + ${emb9} ${unLabel}`;
  } else if (emb1 > 0 && emb9 === 0) {
    const cxLabel = emb1 === 1 ? tipoNomeSingular : tipoNomePlural;
    conversaoTexto = `${emb1} ${cxLabel}`;
  } else if (emb1 === 0 && emb9 > 0) {
    const unLabel = emb9 === 1 ? 'unidade' : 'unidades';
    conversaoTexto = `${emb9} ${unLabel}`;
  } else {
    conversaoTexto = '0 unidades';
  }

  return {
    isPesavel: false,
    rotuloEmb1: 'EMB1',
    valorEmb1: emb1,
    unidadeEmb1: 'CX',
    textoEmb1: `${emb1} CX`,

    rotuloEmb9: 'EMB9 DEPÓSITO',
    valorEmb9: emb9,
    unidadeEmb9: 'UN',
    textoEmb9: `${emb9} UN`,

    rotuloTotal: 'TOTAL',
    estoqueTotal,
    unidadeTotal: 'UN',
    textoTotal,

    conversaoTexto,
  };
}

export interface GramagemInfo {
  texto: string; // e.g. "500G", "1KG", "200ML", "1,5L", "90G", "PESÁVEL / KG"
  valorBase: number; // base quantity in grams (G) or milliliters (ML)
  unidadeBase: 'G' | 'ML' | 'OTHER';
  chaveEquivalencia: string; // e.g. "G_1000", "G_500", "ML_200", "PESO_KG"
}

/**
 * Extracts and normalizes unit presentation/gramagem from EMBALAGEM column.
 * 
 * Rules:
 * - "KG 1 X 1000 X 1G" -> { texto: "PESÁVEL / KG", valorBase: 1000000, unidadeBase: "G", chaveEquivalencia: "PESO_KG" } (Never "1G"!)
 * - "CXA 1 X 6 X 1KG" -> { texto: "1KG", valorBase: 1000, unidadeBase: "G", chaveEquivalencia: "G_1000" }
 * - "CXA 1 X 12 X 500G" -> { texto: "500G", valorBase: 500, unidadeBase: "G", chaveEquivalencia: "G_500" }
 * - "CXA 1 X 24 X 90G" -> { texto: "90G", valorBase: 90, unidadeBase: "G", chaveEquivalencia: "G_90" }
 * - "CXA 1 X 30 X 100G" -> { texto: "100G", valorBase: 100, unidadeBase: "G", chaveEquivalencia: "G_100" }
 * - "CXA 1 X 12 X 200ML" -> { texto: "200ML", valorBase: 200, unidadeBase: "ML", chaveEquivalencia: "ML_200" }
 * - "CXA 1 X 6 X 1,5L" -> { texto: "1,5L", valorBase: 1500, unidadeBase: "ML", chaveEquivalencia: "ML_1500" }
 * - "CXA 1 X 12" -> null (carton multiplier only, not unit gramagem)
 */
export function extractGramagem(rawEmbalagem: string | undefined | null): GramagemInfo | null {
  if (!rawEmbalagem || typeof rawEmbalagem !== 'string') return null;
  const clean = rawEmbalagem.trim().toUpperCase();

  // 1. SE É PRODUTO PESÁVEL / VENDIDO POR KG:
  if (isProdutoPesavel(clean)) {
    return {
      texto: 'PESÁVEL / KG',
      valorBase: 1000000,
      unidadeBase: 'G',
      chaveEquivalencia: 'PESO_KG',
    };
  }

  // 2. PRODUTOS EMBALADOS:
  // Pattern 1: 3-part packaging: "CXA 1 X 6 X 1KG", "FD 1 X 12 X 500G", "1 X 24 X 90GR", "1 X 6 X 1,5L"
  const match3Part = clean.match(/1\s*X\s*\d+\s*X\s*([0-9]+(?:[.,][0-9]+)?\s*(?:KG|KILO|QUILO|QUILOS|G|GR|GRS|GRAMA|GRAMAS|ML|L|LT|LTS|LITRO|LITROS))\b/i);
  let rawGramagem = match3Part ? match3Part[1].trim() : null;

  // Pattern 2: 2-part packaging: "UN 1 X 500G" or "1 X 1KG"
  if (!rawGramagem) {
    const match2Part = clean.match(/1\s*X\s*([0-9]+(?:[.,][0-9]+)?\s*(?:KG|KILO|QUILO|QUILOS|G|GR|GRS|GRAMA|GRAMAS|ML|L|LT|LTS|LITRO|LITROS))\b/i);
    if (match2Part) {
      rawGramagem = match2Part[1].trim();
    }
  }

  // Pattern 3: Ending or isolated weight/volume specification
  if (!rawGramagem) {
    const matchEnd = clean.match(/\b([0-9]+(?:[.,][0-9]+)?\s*(?:KG|KILO|QUILO|G|GR|GRS|ML|L|LT|LTS))\b/i);
    if (matchEnd) {
      rawGramagem = matchEnd[1].trim();
    }
  }

  if (!rawGramagem) return null;

  // Normalize string format (e.g., "1,5 L" -> "1,5L")
  const parsed = rawGramagem.replace(/\s+/g, '').toUpperCase();
  const numMatch = parsed.match(/^([0-9]+(?:[.,][0-9]+)?)([A-Z]+)$/);
  if (!numMatch) return null;

  const rawNumStr = numMatch[1];
  const numStr = rawNumStr.replace(',', '.');
  const num = parseFloat(numStr);
  if (isNaN(num) || num <= 0) return null;

  const unit = numMatch[2];
  let valorBase = num;
  let unidadeBase: 'G' | 'ML' | 'OTHER' = 'OTHER';
  let displayTexto = `${rawNumStr}${unit}`;

  if (['G', 'GR', 'GRS', 'GRAMA', 'GRAMAS'].includes(unit)) {
    unidadeBase = 'G';
    valorBase = num;
    displayTexto = `${rawNumStr}G`;
  } else if (['KG', 'KILO', 'QUILO', 'QUILOS'].includes(unit)) {
    unidadeBase = 'G';
    valorBase = Math.round(num * 1000);
    displayTexto = `${rawNumStr}KG`;
  } else if (['ML'].includes(unit)) {
    unidadeBase = 'ML';
    valorBase = num;
    displayTexto = `${rawNumStr}ML`;
  } else if (['L', 'LT', 'LTS', 'LITRO', 'LITROS'].includes(unit)) {
    unidadeBase = 'ML';
    valorBase = Math.round(num * 1000);
    displayTexto = `${rawNumStr}L`;
  }

  const chaveEquivalencia = `${unidadeBase}_${valorBase}`;

  return {
    texto: displayTexto,
    valorBase,
    unidadeBase,
    chaveEquivalencia,
  };
}

