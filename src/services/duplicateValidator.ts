import { LoteVencimento } from '../types';

/**
 * Normalizes any date representation (ISO, Brazilian, Date, timestamp)
 * into a standard ISO date string "YYYY-MM-DD".
 *
 * Examples:
 * - "14/09/2026" -> "2026-09-14"
 * - "2026-09-14" -> "2026-09-14"
 * - "14-09-2026" -> "2026-09-14"
 * - "2026-09-14T10:30:00.000Z" -> "2026-09-14"
 */
export function normalizeDateToIso(val: any): string | null {
  if (!val) return null;

  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const str = String(val).trim();
  if (!str) return null;

  // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = String(parseInt(isoMatch[2], 10)).padStart(2, '0');
    const d = String(parseInt(isoMatch[3], 10)).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 2. Brazilian format: DD/MM/YYYY or DD-MM-YYYY
  const brMatch = str.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})/);
  if (brMatch) {
    let y = brMatch[3];
    if (y.length === 2) {
      y = '20' + y;
    }
    const m = String(parseInt(brMatch[2], 10)).padStart(2, '0');
    const d = String(parseInt(brMatch[1], 10)).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Formats any date value to standard Brazilian "DD/MM/YYYY".
 */
export function formatDateBr(val: any): string {
  const iso = normalizeDateToIso(val);
  if (!iso) return String(val || '');
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Normalizes an internal product code by removing leading zeros and whitespace.
 * Example: "00066572" -> "66572"
 */
export function normalizeInternalCode(code?: string | null): string {
  if (!code) return '';
  return String(code).trim().replace(/^0+/, '');
}

/**
 * Normalizes product description for complementary comparison:
 * - ignores case (uppercase / lowercase)
 * - removes accents
 * - collapses extra whitespace
 * - applies trim
 */
export function normalizeDescription(desc?: string | null): string {
  if (!desc) return '';
  return desc
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ProductIdentifierCandidate {
  codigo_interno?: string | null;
  digito?: string | null;
  codigo_exibicao?: string | null;
  descricao_produto?: string | null;
}

/**
 * Identifies if two product references represent the EXACT SAME product.
 *
 * Rules:
 * 1. Primary: CÓDIGO INTERNO + DÍGITO
 *    - Internal code without leading zeros ("66572" == "00066572")
 *    - Digit comparison when available ("153" == "153")
 * 2. Complementary: DESCRIÇÃO
 *    - Normalized comparison without accents, lowercase, trimmed.
 */
export function isSameProduct(
  cand: ProductIdentifierCandidate,
  existing: ProductIdentifierCandidate
): boolean {
  const candCod = normalizeInternalCode(cand.codigo_interno);
  const existCod = normalizeInternalCode(existing.codigo_interno);

  // 1. Primary identification: Código Interno + Dígito
  if (candCod && existCod) {
    if (candCod !== existCod) {
      return false;
    }

    const candDig = (cand.digito || '').trim();
    const existDig = (existing.digito || '').trim();

    // If both specify a digit, they must match exactly
    if (candDig && existDig) {
      return candDig === existDig;
    }

    // If one of them has no digit, matching internal code is already high confidence
    return true;
  }

  // 2. Complementary validation: Descrição
  const candDesc = normalizeDescription(cand.descricao_produto);
  const existDesc = normalizeDescription(existing.descricao_produto);
  if (candDesc && existDesc && candDesc === existDesc) {
    return true;
  }

  return false;
}

export interface DuplicateValidationResult {
  isDuplicate: boolean;
  existingLote?: LoteVencimento;
  message?: string;
  dataValidadeFormatada?: string;
  codigoExibicao?: string;
  descricao?: string;
}

/**
 * Checks whether a lot candidate duplicates an existing registered lot:
 * MESMO PRODUTO + MESMA DATA DE VENCIMENTO.
 *
 * @param candidate Product & Date to validate
 * @param existingLots List of already saved lots
 * @param ignoreLoteId Optional ID to ignore (when updating an existing lot)
 */
export function findDuplicateVencimento(
  candidate: {
    codigo_interno?: string | null;
    digito?: string | null;
    codigo_exibicao?: string | null;
    descricao_produto?: string | null;
    data_validade?: string | Date | null;
  },
  existingLots: LoteVencimento[],
  ignoreLoteId?: string | null
): DuplicateValidationResult {
  const targetDateIso = normalizeDateToIso(candidate.data_validade);
  if (!targetDateIso) {
    return { isDuplicate: false };
  }

  for (const lote of existingLots) {
    if (ignoreLoteId && lote.id === ignoreLoteId) {
      continue;
    }

    const loteDateIso = normalizeDateToIso(lote.data_validade);
    if (!loteDateIso || loteDateIso !== targetDateIso) {
      // Different expiration date -> valid, not a duplicate!
      continue;
    }

    // Same date! Check if it's the exact same product
    if (
      isSameProduct(
        {
          codigo_interno: candidate.codigo_interno,
          digito: candidate.digito,
          descricao_produto: candidate.descricao_produto,
        },
        {
          codigo_interno: lote.codigo_interno,
          digito: lote.digito,
          descricao_produto: lote.descricao_produto,
        }
      )
    ) {
      const dataBr = formatDateBr(targetDateIso);
      const candCodNorm = normalizeInternalCode(candidate.codigo_interno);
      const candDig = (candidate.digito || lote.digito || '').trim();
      const codigoExib =
        candidate.codigo_exibicao ||
        lote.codigo_exibicao ||
        (candCodNorm ? `${candCodNorm}${candDig ? '-' + candDig : ''}` : lote.codigo_interno);
      const descricao =
        candidate.descricao_produto || lote.descricao_produto || 'PRODUTO';

      return {
        isDuplicate: true,
        existingLote: lote,
        dataValidadeFormatada: dataBr,
        codigoExibicao: codigoExib,
        descricao,
        message: `Este produto já possui um vencimento cadastrado para ${dataBr}.`,
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Builds a set of IDs for historical duplicate records already in the database,
 * so they can be visually flagged without deleting historical data.
 */
export function getHistoricalDuplicateIds(lots: LoteVencimento[]): Set<string> {
  const duplicateIds = new Set<string>();
  const map = new Map<string, string[]>();

  for (const lote of lots) {
    const cod = normalizeInternalCode(lote.codigo_interno);
    const dig = (lote.digito || '').trim();
    const isoDate = normalizeDateToIso(lote.data_validade);

    if (!cod || !isoDate) continue;

    const key = `${cod}_${dig}_${isoDate}`;
    const list = map.get(key) || [];
    list.push(lote.id);
    map.set(key, list);
  }

  for (const [, ids] of map) {
    if (ids.length > 1) {
      // All of these share the same product and date
      ids.forEach((id) => duplicateIds.add(id));
    }
  }

  return duplicateIds;
}
