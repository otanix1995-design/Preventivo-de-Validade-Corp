/**
 * Serviço Central de Identificação de Marcas (Gerador de Cartazes Tagsell)
 *
 * Objetivo:
 * Identificar com alta confiabilidade a MARCA comercial do produto
 * a partir do campo "Descrição Mercadoria" da SMGOI013.
 *
 * Regras:
 * 1. NUNCA usar regras de posição fixa de palavras (proibido: 2ª palavra, 3ª palavra, etc).
 * 2. Correspondência controlada por dicionário de marcas conhecidas.
 * 3. Normalização apenas para comparação (maiúsculas, sem acentos, separadores como ., -, /).
 * 4. NUNCA alterar a descrição original do produto.
 * 5. NUNCA inventar marca: se não houver correspondência confiável, retornar "".
 * 6. Evitar falsos positivos: correspondência por palavra/token isolado ou expressão composta.
 */

export interface BrandDefinition {
  /** Nome canônico oficial para exportação no Tagsell (ex: 'PERDIGÃO', 'CHULETAO', 'DANONE') */
  exportName: string;
  /** Termos de correspondência / variações para comparação */
  matchTerms: string[];
}

/**
 * Normaliza um texto exclusivamente para fins de comparação e busca de marcas:
 * - Converte para maiúsculas
 * - Remove acentos
 * - Substitui separadores (pontos, barras, hífens, vírgulas, parênteses) por espaços
 * - Colapsa espaços múltiplos e remove espaços nas pontas
 */
export function normalizeTextForBrandMatching(text?: string | null): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacríticos/acentos
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ') // substitui qualquer pontuação/separador por espaço
    .replace(/\s+/g, ' ') // colapsa múltiplos espaços
    .trim();
}

/**
 * Dicionário Controlado de Marcas Conhecidas.
 * Permite facilmente adicionar novas marcas sem alterar a lógica do Gerador de Cartazes.
 */
export const KNOWN_BRANDS: BrandDefinition[] = [
  // --- Marcas Confirmadas dos Testes Oficiais ---
  { exportName: 'DANONE', matchTerms: ['DANONE'] },
  { exportName: 'BATAVO', matchTerms: ['BATAVO'] },
  { exportName: 'SEARA', matchTerms: ['SEARA'] },
  { exportName: 'SADIA', matchTerms: ['SADIA'] },
  { exportName: 'PERDIGÃO', matchTerms: ['PERDIGAO', 'PERDIGÃO'] },
  { exportName: 'AURORA', matchTerms: ['AURORA'] },
  { exportName: 'QUALY', matchTerms: ['QUALY'] },
  { exportName: 'COAMO', matchTerms: ['COAMO'] },
  { exportName: 'MEZZANI', matchTerms: ['MEZZANI'] },
  { exportName: 'CHULETAO', matchTerms: ['CHULETAO', 'CHULETÃO'] },

  // --- Laticínios, Queijos e Resfriados ---
  { exportName: 'ITAMBÉ', matchTerms: ['ITAMBE', 'ITAMBÉ'] },
  { exportName: 'PIRACANJUBA', matchTerms: ['PIRACANJUBA'] },
  { exportName: 'NESTLÉ', matchTerms: ['NESTLE', 'NESTLÉ'] },
  { exportName: 'VIGOR', matchTerms: ['VIGOR'] },
  { exportName: 'TIROLEZ', matchTerms: ['TIROLEZ'] },
  { exportName: 'FRIMESA', matchTerms: ['FRIMESA'] },
  { exportName: 'CERATTI', matchTerms: ['CERATTI'] },
  { exportName: 'REZENDE', matchTerms: ['REZENDE', 'RESENDE'] },
  { exportName: 'MARFRIG', matchTerms: ['MARFRIG'] },
  { exportName: 'FRIBOI', matchTerms: ['FRIBOI'] },
  { exportName: 'MINERVA', matchTerms: ['MINERVA'] },
  { exportName: 'FORNO DE MINAS', matchTerms: ['FORNO DE MINAS'] },
  { exportName: 'DONA BENTA', matchTerms: ['DONA BENTA'] },
  { exportName: 'SANTA CLARA', matchTerms: ['SANTA CLARA'] },
  { exportName: 'PIRAQUÊ', matchTerms: ['PIRAQUE', 'PIRAQUÊ'] },
  { exportName: 'PRESIDENT', matchTerms: ['PRESIDENT', 'PRESIDENTE', 'PRÉSIDENT'] },
  { exportName: 'CATUPIRY', matchTerms: ['CATUPIRY'] },
  { exportName: 'POLENGHI', matchTerms: ['POLENGHI'] },

  // --- Mercearia, Matinais, Molhos e Bebidas ---
  { exportName: 'YOKI', matchTerms: ['YOKI'] },
  { exportName: 'HEINZ', matchTerms: ['HEINZ'] },
  { exportName: 'HELLMANNS', matchTerms: ['HELLMANNS', 'HELLMANN S', 'HELLMANN'] },
  { exportName: 'FUGINI', matchTerms: ['FUGINI'] },
  { exportName: 'PREDILECTA', matchTerms: ['PREDILECTA'] },
  { exportName: 'CAMIL', matchTerms: ['CAMIL'] },
  { exportName: 'TIO JOÃO', matchTerms: ['TIO JOAO', 'TIO JOÃO'] },
  { exportName: 'PILÃO', matchTerms: ['PILAO', 'PILÃO'] },
  { exportName: 'MELITTA', matchTerms: ['MELITTA'] },
  { exportName: 'TRÊS CORAÇÕES', matchTerms: ['TRES CORACOES', 'TRÊS CORAÇÕES', '3 CORACOES'] },
  { exportName: 'TANG', matchTerms: ['TANG'] },
  { exportName: 'DEL VALLE', matchTerms: ['DEL VALLE', 'DELVALLE'] },
  { exportName: 'COCA-COLA', matchTerms: ['COCA COLA', 'COCA-COLA'] },
  { exportName: 'PEPSI', matchTerms: ['PEPSI'] },
  { exportName: 'AMBEV', matchTerms: ['AMBEV'] },
  { exportName: 'BRAHMA', matchTerms: ['BRAHMA'] },
  { exportName: 'SKOL', matchTerms: ['SKOL'] },
  { exportName: 'HEINEKEN', matchTerms: ['HEINEKEN'] },
  { exportName: 'EISENBAHN', matchTerms: ['EISENBAHN'] },
  { exportName: 'CORONA', matchTerms: ['CORONA'] },

  // --- Limpeza, Higiene e Pet ---
  { exportName: 'YPÊ', matchTerms: ['YPE', 'YPÊ'] },
  { exportName: 'OMO', matchTerms: ['OMO'] },
  { exportName: 'BRILHANTE', matchTerms: ['BRILHANTE'] },
  { exportName: 'COMFORT', matchTerms: ['COMFORT'] },
  { exportName: 'DOWNY', matchTerms: ['DOWNY'] },
  { exportName: 'VEJA', matchTerms: ['VEJA'] },
  { exportName: 'MINUANO', matchTerms: ['MINUANO'] },
  { exportName: 'BOMBRIL', matchTerms: ['BOMBRIL'] },
  { exportName: 'COLGATE', matchTerms: ['COLGATE'] },
  { exportName: 'ORAL-B', matchTerms: ['ORAL B', 'ORAL-B'] },
  { exportName: 'NIVEA', matchTerms: ['NIVEA', 'NÍVEA'] },
  { exportName: 'DOVE', matchTerms: ['DOVE'] },
  { exportName: 'PAMPERS', matchTerms: ['PAMPERS'] },
  { exportName: 'HUGGIES', matchTerms: ['HUGGIES'] },
  { exportName: 'PEDIGREE', matchTerms: ['PEDIGREE'] },
  { exportName: 'WHISKAS', matchTerms: ['WHISKAS'] },
];

/**
 * Estrutura indexada em memória para busca rápida e segura.
 * Ordenada pelo comprimento do termo normalizado (descendente) para priorizar
 * expressões compostas e termos mais específicos antes de termos menores.
 */
interface CompiledBrandMatcher {
  exportName: string;
  normalizedTerm: string;
  paddedSearchKey: string;
}

function compileBrandMatchers(brandList: BrandDefinition[]): CompiledBrandMatcher[] {
  const list: CompiledBrandMatcher[] = [];
  for (const brand of brandList) {
    for (const term of brand.matchTerms) {
      const norm = normalizeTextForBrandMatching(term);
      if (norm) {
        list.push({
          exportName: brand.exportName,
          normalizedTerm: norm,
          paddedSearchKey: ` ${norm} `,
        });
      }
    }
  }

  // Ordena por comprimento decrescente do termo (ex: "FORNO DE MINAS" antes de "MINAS")
  list.sort((a, b) => b.normalizedTerm.length - a.normalizedTerm.length);
  return list;
}

let compiledMatchersCache: CompiledBrandMatcher[] = compileBrandMatchers(KNOWN_BRANDS);

/**
 * Permite registrar dinamicamente uma nova marca no dicionário controlado
 * sem alterar o código existente.
 */
export function registerKnownBrand(brand: BrandDefinition): void {
  KNOWN_BRANDS.push(brand);
  compiledMatchersCache = compileBrandMatchers(KNOWN_BRANDS);
}

/**
 * Extrai a marca comercial a partir da "Descrição Mercadoria" da SMGOI013.
 *
 * @param descricao A descrição original do produto na SMGOI013
 * @returns O nome oficial da marca identificado, ou "" se não houver correspondência confiável.
 *          NUNCA inventa marcas.
 */
export function extractBrandFromDescription(descricao?: string | null): string {
  if (!descricao || typeof descricao !== 'string') {
    return '';
  }

  // Normaliza apenas para comparação
  const normalizedDesc = normalizeTextForBrandMatching(descricao);
  if (!normalizedDesc) {
    return '';
  }

  // Envolve a descrição normalizada em espaços para garantir correspondência exata de tokens/expressões
  const paddedDesc = ` ${normalizedDesc} `;

  for (const matcher of compiledMatchersCache) {
    if (paddedDesc.includes(matcher.paddedSearchKey)) {
      return matcher.exportName;
    }
  }

  // Nenhuma marca confiável encontrada no dicionário: retorna string vazia
  return '';
}

/**
 * Alias em português para extractBrandFromDescription
 */
export const extrairMarcaDaDescricao = extractBrandFromDescription;

/**
 * Remove a marca identificada com segurança da descrição da mercadoria para exportação no Tagsell.
 *
 * Regras:
 * 1. NUNCA remove nenhuma palavra se a marca não tiver sido identificada com segurança (marca vazia -> retorna original).
 * 2. Remove apenas como palavra/token ou expressão completa (evita substituição perigosa dentro de palavras maiores).
 * 3. Preserva a estrutura original da descrição, abreviações (RF., IOG.), gramagens e sabores.
 * 4. Limpa espaços duplos remanescentes mantendo formatação coesa.
 * 5. Não altera os dados originais no banco ou cadastro.
 *
 * @param descricao Descrição original do produto na SMGOI013
 * @param marcaIdentificada Marca identificada pela V1.1 (extractBrandFromDescription)
 * @returns Descrição tratada para a Coluna 9 (DESCRIÇÃO PRINCIPAL) do Tagsell
 */
export function removeBrandFromDescription(
  descricao?: string | null,
  marcaIdentificada?: string | null
): string {
  if (!descricao || typeof descricao !== 'string') {
    return '';
  }

  const brandTrimmed = (marcaIdentificada || '').trim();
  // Regra de segurança fundamental: se a marca não foi identificada, mantém 100% da descrição original
  if (!brandTrimmed) {
    return descricao;
  }

  // Localiza a definição da marca no dicionário para obter variações (matchTerms)
  const brandDef = KNOWN_BRANDS.find(
    (b) =>
      b.exportName.toUpperCase() === brandTrimmed.toUpperCase() ||
      b.matchTerms.some((t) => t.toUpperCase() === brandTrimmed.toUpperCase())
  );

  const candidateTerms = new Set<string>();
  candidateTerms.add(brandTrimmed);

  const unaccented = brandTrimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (unaccented) candidateTerms.add(unaccented);

  if (brandDef) {
    candidateTerms.add(brandDef.exportName);
    const unaccentedExport = brandDef.exportName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (unaccentedExport) candidateTerms.add(unaccentedExport);

    for (const term of brandDef.matchTerms) {
      candidateTerms.add(term);
      const unacc = term.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (unacc) candidateTerms.add(unacc);
    }
  }

  // Ordena termos candidatos por comprimento decrescente para priorizar termos maiores (ex: compostos)
  const sortedTerms = Array.from(candidateTerms).sort((a, b) => b.length - a.length);

  let result = descricao;
  for (const term of sortedTerms) {
    // Escapa caracteres especiais de regex
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Delimitadores de palavra seguros (início/fim ou caractere que não seja letra/dígito)
    // Suporta caracteres com acentuação
    const regex = new RegExp(`(^|[^A-Za-z0-9À-ÖØ-öø-ÿ])${escaped}(?=$|[^A-Za-z0-9À-ÖØ-öø-ÿ])`, 'i');
    if (regex.test(result)) {
      // Substitui apenas o termo, preservando o delimitador anterior (ex: "." ou " ")
      result = result.replace(regex, (match, p1) => p1);
      break; // Remove somente a ocorrência da marca identificada
    }
  }

  // Limpa espaços duplos e remove espaços nas pontas
  return result.replace(/ {2,}/g, ' ').trim();
}

/**
 * Alias em português para removeBrandFromDescription
 */
export const removerMarcaDaDescricao = removeBrandFromDescription;
