/**
 * Serviço Central de Identificação de Marcas (Gerador de Cartazes Tagsell) - Versão 1.3
 *
 * Objetivo:
 * Identificar com alta confiabilidade a MARCA comercial do produto
 * a partir do campo "Descrição Mercadoria" da SMGOI013, priorizando marcas de frios
 * e tratando marcas compostas, conflitos e remoção do prefixo operacional RF.
 *
 * Regras:
 * 1. NUNCA usar regras de posição fixa de palavras (proibido: 2ª palavra, 3ª palavra, etc).
 * 2. Correspondência controlada por dicionário de marcas conhecidas.
 * 3. Normalização apenas para comparação (maiúsculas, sem acentos, separadores como ., -, /).
 * 4. NUNCA alterar a descrição original do produto no banco, cadastro ou Firebase.
 * 5. NUNCA inventar marca: se não houver correspondência confiável, retornar "".
 * 6. Evitar falsos positivos: correspondência por palavra/token isolado ou expressão composta.
 * 7. Prioridade para marcas compostas sobre marcas simples.
 * 8. Resolução explícita de conflitos (ex: CATUPIRY como recheio/característica junto com SEARA).
 */

export interface BrandDefinition {
  /** Nome canônico oficial para exportação no Tagsell (ex: 'PERDIGÃO', 'CHULETÃO', 'DANONE') */
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
 * Inclui todas as marcas de frios confirmadas, laticínios, congelados, mercearia e limpeza.
 */
export const KNOWN_BRANDS: BrandDefinition[] = [
  // --- Marcas Confirmadas de Frios / Carnes / Embutidos ---
  { exportName: 'SEARA', matchTerms: ['SEARA'] },
  { exportName: 'AURORA', matchTerms: ['AURORA'] },
  { exportName: 'SADIA', matchTerms: ['SADIA'] },
  { exportName: 'PERDIGÃO', matchTerms: ['PERDIGAO', 'PERDIGÃO'] },
  { exportName: 'BATAVO', matchTerms: ['BATAVO'] },
  { exportName: 'COPACOL', matchTerms: ['COPACOL'] },
  { exportName: 'FRIMESA', matchTerms: ['FRIMESA'] },
  { exportName: 'LAR', matchTerms: ['LAR'] },
  { exportName: 'FRIBOI', matchTerms: ['FRIBOI'] },
  { exportName: 'PAMPLONA', matchTerms: ['PAMPLONA'] },
  { exportName: 'MEZZANI', matchTerms: ['MEZZANI'] },
  { exportName: 'ROMANHA', matchTerms: ['ROMANHA'] },
  { exportName: 'SULITA', matchTerms: ['SULITA'] },
  { exportName: 'REZENDE', matchTerms: ['REZENDE', 'RESENDE'] },
  { exportName: 'MATURATTA', matchTerms: ['MATURATTA'] },
  { exportName: 'CHULETÃO', matchTerms: ['CHULETAO', 'CHULETÃO'] },
  { exportName: 'C.VALE', matchTerms: ['C.VALE', 'C VALE', 'C-VALE'] },
  { exportName: 'ALEGRA', matchTerms: ['ALEGRA'] },
  { exportName: 'NOBRE', matchTerms: ['NOBRE'] },
  { exportName: 'BULNEZ', matchTerms: ['BULNEZ'] },
  { exportName: 'CERATTI', matchTerms: ['CERATTI'] },
  { exportName: 'MARFRIG', matchTerms: ['MARFRIG'] },
  { exportName: 'MINERVA', matchTerms: ['MINERVA'] },

  // --- Laticínios, Iogurtes, Requeijões e Queijos ---
  { exportName: 'DANONE', matchTerms: ['DANONE'] },
  { exportName: 'NESTLÉ', matchTerms: ['NESTLE', 'NESTLÉ'] },
  { exportName: 'VIGOR', matchTerms: ['VIGOR'] },
  { exportName: 'CAROLINA', matchTerms: ['CAROLINA'] },
  { exportName: 'FRUTAP', matchTerms: ['FRUTAP'] },
  { exportName: 'PRESIDENT', matchTerms: ['PRESIDENT', 'PRESIDENTE', 'PRÉSIDENT'] },
  { exportName: 'IPANEMA', matchTerms: ['IPANEMA'] },
  { exportName: 'POLENGHI', matchTerms: ['POLENGHI'] },
  { exportName: 'TIROL', matchTerms: ['TIROL'] },
  { exportName: 'QUATÁ', matchTerms: ['QUATA', 'QUATÁ'] },
  { exportName: 'LITORAL', matchTerms: ['LITORAL'] },
  { exportName: 'PARMALAT', matchTerms: ['PARMALAT'] },
  { exportName: 'DANÚBIO', matchTerms: ['DANUBIO', 'DANÚBIO'] },
  { exportName: 'DEALE', matchTerms: ['DEALE'] },
  { exportName: 'FRUTILAC', matchTerms: ['FRUTILAC'] },
  { exportName: 'AVIAÇÃO', matchTerms: ['AVIACAO', 'AVIAÇÃO'] },
  { exportName: 'ITAMBÉ', matchTerms: ['ITAMBE', 'ITAMBÉ'] },
  { exportName: 'PIRACANJUBA', matchTerms: ['PIRACANJUBA'] },
  { exportName: 'TIROLEZ', matchTerms: ['TIROLEZ'] },
  { exportName: 'SANTA CLARA', matchTerms: ['SANTA CLARA'] },
  { exportName: 'ELEGÊ', matchTerms: ['ELEGE', 'ELEGÊ'] },
  { exportName: 'CHAMYTO', matchTerms: ['CHAMYTO'] },
  { exportName: 'DANONINHO', matchTerms: ['DANONINHO'] },
  { exportName: 'ACTIVIA', matchTerms: ['ACTIVIA'] },
  { exportName: 'CATUPIRY', matchTerms: ['CATUPIRY'] },

  // --- Margarinas, Gorduras e Óleos ---
  { exportName: 'QUALY', matchTerms: ['QUALY'] },
  { exportName: 'DELÍCIA', matchTerms: ['DELICIA', 'DELÍCIA'] },
  { exportName: 'DORIANA', matchTerms: ['DORIANA'] },
  { exportName: 'BECEL', matchTerms: ['BECEL'] },
  { exportName: 'CLAYBOM', matchTerms: ['CLAYBOM'] },
  { exportName: 'COAMO', matchTerms: ['COAMO'] },

  // --- Congelados, Batatas, Massas, Panificação e Sorvetes ---
  { exportName: 'McCAIN', matchTerms: ['MCCAIN', 'MC CAIN', 'McCAIN'] },
  { exportName: 'BEM BRASIL', matchTerms: ['BEM BRASIL'] },
  { exportName: 'MASSA LEVE', matchTerms: ['MASSA LEVE'] },
  { exportName: 'SANTA MASSA', matchTerms: ['SANTA MASSA'] },
  { exportName: 'GRAN MESTRI', matchTerms: ['GRAN MESTRI'] },
  { exportName: 'FAIXA AZUL', matchTerms: ['FAIXA AZUL'] },
  { exportName: 'FORNO DE MINAS', matchTerms: ['FORNO DE MINAS'] },
  { exportName: 'DONA BENTA', matchTerms: ['DONA BENTA'] },
  { exportName: 'ITAIQUARA', matchTerms: ['ITAIQUARA'] },
  { exportName: 'GURI', matchTerms: ['GURI'] },
  { exportName: 'GEBON', matchTerms: ['GEBON'] },
  { exportName: 'KIBON', matchTerms: ['KIBON'] },

  // --- Polpas, Frutas, Sucos, Bebidas e Infantil ---
  { exportName: 'BRASFRUT', matchTerms: ['BRASFRUT'] },
  { exportName: 'COSTA SUL', matchTerms: ['COSTA SUL'] },
  { exportName: 'POLPA NORTE', matchTerms: ['POLPA NORTE'] },
  { exportName: 'NATURAL ONE', matchTerms: ['NATURAL ONE'] },
  { exportName: 'BURITIS', matchTerms: ['BURITIS'] },
  { exportName: 'VITALMAR', matchTerms: ['VITALMAR'] },
  { exportName: 'LIFE', matchTerms: ['LIFE'] },
  { exportName: "PRAT'S", matchTerms: ["PRAT'S", "PRAT S", "PRATS", "PRAT’S"] },
  { exportName: 'UNIBABY', matchTerms: ['UNIBABY'] },

  // --- Mercearia, Matinais, Molhos e Bebidas ---
  { exportName: 'PIRAQUÊ', matchTerms: ['PIRAQUE', 'PIRAQUÊ'] },
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
 * Ordenada priorizando marcas compostas e depois termos mais específicos/longos.
 */
interface CompiledBrandMatcher {
  exportName: string;
  normalizedTerm: string;
  paddedSearchKey: string;
  wordCount: number;
}

function compileBrandMatchers(brandList: BrandDefinition[]): CompiledBrandMatcher[] {
  const list: CompiledBrandMatcher[] = [];
  for (const brand of brandList) {
    for (const term of brand.matchTerms) {
      const norm = normalizeTextForBrandMatching(term);
      if (norm) {
        const words = norm.split(' ').filter(Boolean).length;
        list.push({
          exportName: brand.exportName,
          normalizedTerm: norm,
          paddedSearchKey: ` ${norm} `,
          wordCount: words,
        });
      }
    }
  }

  // Regra Seção 7: primeiro procurar marcas compostas (wordCount > 1),
  // depois procurar marcas mais longas/específicas
  list.sort((a, b) => {
    if (b.wordCount !== a.wordCount) {
      return b.wordCount - a.wordCount;
    }
    return b.normalizedTerm.length - a.normalizedTerm.length;
  });

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
 * Aplica:
 * - Correspondência controlada e exata por token/expressão completa
 * - Priorização de marcas compostas
 * - Resolução explícita de conflitos (ex: CATUPIRY + SEARA -> SEARA)
 * - Em caso de conflito ambíguo não mapeado, retorna "" com segurança
 *
 * @param descricao A descrição original do produto na SMGOI013
 * @returns O nome oficial da marca identificado, ou "" se não houver correspondência confiável.
 */
export function extractBrandFromDescription(descricao?: string | null): string {
  if (!descricao || typeof descricao !== 'string') {
    return '';
  }

  const normalizedDesc = normalizeTextForBrandMatching(descricao);
  if (!normalizedDesc) {
    return '';
  }

  const paddedDesc = ` ${normalizedDesc} `;

  // Coleta todas as marcas únicas identificadas no texto
  const matchedBrands = new Set<string>();
  for (const matcher of compiledMatchersCache) {
    if (paddedDesc.includes(matcher.paddedSearchKey)) {
      matchedBrands.add(matcher.exportName);
    }
  }

  if (matchedBrands.size === 0) {
    return '';
  }

  if (matchedBrands.size === 1) {
    return Array.from(matchedBrands)[0];
  }

  // Regra Especial CATUPIRY (Seção 8 & 9):
  // Se CATUPIRY foi encontrado junto com outra marca (ex: SEARA),
  // CATUPIRY está atuando como recheio/sabor/característica do produto da outra marca.
  if (matchedBrands.has('CATUPIRY') && matchedBrands.size > 1) {
    const withoutCatupiry = Array.from(matchedBrands).filter((b) => b !== 'CATUPIRY');
    if (withoutCatupiry.length === 1) {
      return withoutCatupiry[0];
    }
  }

  // Regra Seção 10: Conflito não resolvido entre duas marcas distintas.
  // Não inventar ou chutar: retorna "" para preservar segurança.
  return '';
}

/**
 * Alias em português para extractBrandFromDescription
 */
export const extrairMarcaDaDescricao = extractBrandFromDescription;

/**
 * Remove o prefixo operacional "RF." quando estiver no início da descrição.
 * NÃO remove "RF" no meio de palavras ou no interior do texto.
 */
export function removeRfPrefix(text?: string | null): string {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/^RF\.\s*/i, '').trim();
}

/**
 * Constrói a descrição final tratada para exportação no Tagsell (Coluna 9).
 *
 * Passos (Regra V1.3):
 * 1. Clona a descrição original sem alterar o objeto ou cadastro original.
 * 2. Remove o prefixo operacional "RF." se estiver no início da descrição.
 * 3. Se houver marca selecionada com segurança, remove SOMENTE essa marca/alias.
 *    (Se a marca selecionada for vazia, não remove nenhuma palavra).
 * 4. Normaliza espaços excedentes resultantes das remoções.
 *
 * @param descricaoOriginal Descrição original da mercadoria na SMGOI013
 * @param marcaSelecionada Marca selecionada para a Coluna 14 (ou "" se não identificada)
 * @returns Descrição tratada para a Coluna 9 (DESCRIÇÃO PRINCIPAL) do Tagsell
 */
export function buildTagsellDescription(
  descricaoOriginal?: string | null,
  marcaSelecionada?: string | null
): string {
  if (!descricaoOriginal || typeof descricaoOriginal !== 'string') {
    return '';
  }

  // 1 e 2. Cópia e remoção do prefixo operacional RF. no início
  let desc = removeRfPrefix(descricaoOriginal);

  const brandTrimmed = (marcaSelecionada || '').trim();
  // Regra de segurança: se a marca não foi identificada, mantém 100% da descrição (já sem RF.)
  if (!brandTrimmed) {
    return desc;
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

  // Ordena termos candidatos por comprimento decrescente para priorizar termos maiores
  const sortedTerms = Array.from(candidateTerms).sort((a, b) => b.length - a.length);

  for (const term of sortedTerms) {
    // Escapa caracteres especiais de regex
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Delimitadores de palavra seguros (início/fim ou caractere que não seja letra/dígito)
    const regex = new RegExp(`(^|[^A-Za-z0-9À-ÖØ-öø-ÿ])${escaped}(?=$|[^A-Za-z0-9À-ÖØ-öø-ÿ])`, 'i');
    if (regex.test(desc)) {
      desc = desc.replace(regex, (match, p1) => p1);
      break; // Remove apenas a ocorrência da marca identificada
    }
  }

  // Limpa espaços duplos e remove espaços nas pontas
  return desc.replace(/ {2,}/g, ' ').trim();
}

/**
 * Mantido para compatibilidade com chamadas de versões anteriores
 */
export const removeBrandFromDescription = buildTagsellDescription;
export const removerMarcaDaDescricao = buildTagsellDescription;
