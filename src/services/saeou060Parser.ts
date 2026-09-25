/**
 * SAEOU060 Parser & Processor Module
 * 
 * Extracts data from SAEOU060 spreadsheets and crosses them exclusively
 * with the single source of truth: SMGOI013 Product Repository.
 * 
 * Adheres strictly to the architectural rule:
 * SMGOI013 -> Product Repository -> Produto (Single source of truth)
 * SAEOU060 -> Código + DIG -> Produto
 */

import * as XLSX from 'xlsx';
import { RegistroSaeou060, ResumoImportacao, StatusSaeou060 } from '../types';
import { normalizeCodigoSMGO } from './codeParser';
import { pdfToTableRows } from './pdfParser';
import { productRepository } from './productRepository';
import { addDivergencia } from './storage';

export type ProgressCallback = (percent: number, status: string) => void;

/**
 * Builds a deterministic, unique business key for a SAEOU060 entry:
 * codigoInterno + digito + dataVencimentoIso
 * Leading zeros on internal code are stripped, and digit/date are normalized.
 */
export function buildSaeouDeterministicKey(
  codigoInterno: string,
  digito?: string,
  dataVencimentoIso?: string
): string {
  const c = String(codigoInterno || '').replace(/^0+/, '').trim();
  const d = String(digito || '').trim();
  const dt = String(dataVencimentoIso || '').trim() || 'sem_data';
  return d ? `${c}_${d}_${dt}` : `${c}_${dt}`;
}

/**
 * Generates the canonical deterministic ID for SAEOU060 records.
 */
export function buildSaeouId(
  codigoInterno: string,
  digito?: string,
  dataVencimentoIso?: string
): string {
  return `saeou-${buildSaeouDeterministicKey(codigoInterno, digito, dataVencimentoIso)}`;
}

/**
 * Verifies if a SAEOU060 record has legitimate work/interaction performed by user:
 * - status_saeou === 'JA_NO_CONTROLE'
 * - vencimento_id_vinculado is present
 * - status_saeou === 'DESCONSIDERADO' or 'CONCLUIDO'
 * - trabalhado_em is present
 * - desconsiderado_em or motivo_desconsiderado is present
 * - adicionado_ao_controle_em is present
 * - preco_trabalhado / precoTrabalhado was worked (> 0)
 * - manual user observation exists
 */
export function isRegistroSaeouTrabalhado(reg: Partial<RegistroSaeou060>): boolean {
  if (!reg) return false;
  if (
    reg.status_saeou === 'JA_NO_CONTROLE' ||
    reg.status_saeou === 'DESCONSIDERADO' ||
    reg.status_saeou === 'CONCLUIDO'
  ) {
    return true;
  }
  if (reg.vencimento_id_vinculado && String(reg.vencimento_id_vinculado).trim() !== '') {
    return true;
  }
  if (reg.trabalhado_em && String(reg.trabalhado_em).trim() !== '') {
    return true;
  }
  if (reg.desconsiderado_em && String(reg.desconsiderado_em).trim() !== '') {
    return true;
  }
  if (reg.motivo_desconsiderado && String(reg.motivo_desconsiderado).trim() !== '') {
    return true;
  }
  if (reg.adicionado_ao_controle_em && String(reg.adicionado_ao_controle_em).trim() !== '') {
    return true;
  }
  if (reg.observacao && String(reg.observacao).trim() !== '') {
    const obs = String(reg.observacao).trim();
    if (obs !== 'Importado via SAEOU060' && !obs.startsWith('Importado SAEOU060 - Promotor:')) {
      return true;
    }
  }
  return false;
}

/**
 * Internal deduplication of the spreadsheet before persistence (Regra 5 & Regra 8).
 * Consolidates identical lines within the same spreadsheet without summing blindly.
 * Never consolidates different dates.
 */
export function deduplicarRegistrosSaeouPlanilha(
  registros: RegistroSaeou060[]
): RegistroSaeou060[] {
  const map = new Map<string, RegistroSaeou060[]>();

  for (const reg of registros) {
    const key = buildSaeouDeterministicKey(
      reg.codigo_interno,
      reg.digito,
      reg.data_vencimento
    );
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(reg);
  }

  const resultado: RegistroSaeou060[] = [];

  for (const [key, items] of map.entries()) {
    if (items.length === 1) {
      resultado.push({
        ...items[0],
        id: `saeou-${key}`,
      });
      continue;
    }

    // Se houver múltiplas linhas com a mesma chave dentro da MESMA planilha:
    // Identificar a linha mais completa / mais recente
    const primeiro = items[0];
    const todasMesmaQtd = items.every((i) => i.quantidade === primeiro.quantidade);

    if (todasMesmaQtd) {
      // Duplicata idêntica gerada na emissão do relatório: manter uma única
      resultado.push({
        ...primeiro,
        id: `saeou-${key}`,
      });
    } else {
      // Quantidades diferentes ou frações dentro da mesma planilha:
      // Conservar o registro com a quantidade mais representativa ou dados mais completos
      const melhorRegistro = items.reduce((prev, curr) => {
        return (curr.quantidade || 0) > (prev.quantidade || 0) ? curr : prev;
      }, items[0]);

      resultado.push({
        ...melhorRegistro,
        id: `saeou-${key}`,
      });
    }
  }

  return resultado;
}

export interface ResultadoReconciliacaoSaeou060 {
  snapshotReconciliado: RegistroSaeou060[];
  estatisticas: {
    totalNovos: number;
    totalAtualizados: number;
    totalPreservadosFora: number;
    totalRemovidosObsoletos: number;
    totalFinal: number;
  };
}

/**
 * Reconciles the existing SAEOU060 operational base with a new spreadsheet snapshot:
 * - Regra 1: A nova planilha é a fotografia operacional mais recente.
 * - Regra 2: Itens antigos não trabalhados que desapareceram são removidos do snapshot ativo.
 * - Regra 3: Itens antigos que foram trabalhados/solicitados permanecem PRESERVADOS.
 * - Regra 4: Itens preservados que reaparecem são reconciliados, NUNCA duplicados.
 * - Regra 10: Versão trabalhada tem precedência absoluta para dados do usuário.
 * - Regra 12: NÃO soma quantidades entre snapshots diferentes.
 */
export function reconciliarSaeou060Snapshot(
  registrosAtuais: RegistroSaeou060[],
  novosRegistrosPlanilha: RegistroSaeou060[]
): ResultadoReconciliacaoSaeou060 {
  // 1. Deduplicar registros da nova planilha internamente
  const novosDeduplicados = deduplicarRegistrosSaeouPlanilha(novosRegistrosPlanilha);

  // 2. Mapear os registros atuais existentes por chave determinística
  const mapExistentesPorChave = new Map<string, RegistroSaeou060[]>();
  for (const reg of registrosAtuais) {
    const key = buildSaeouDeterministicKey(
      reg.codigo_interno,
      reg.digito,
      reg.data_vencimento
    );
    if (!mapExistentesPorChave.has(key)) {
      mapExistentesPorChave.set(key, []);
    }
    mapExistentesPorChave.get(key)!.push(reg);
  }

  // Identificar a melhor versão existente para cada chave (versão trabalhada tem precedência absoluta)
  const existentesMelhorVersao = new Map<string, RegistroSaeou060>();
  for (const [key, lista] of mapExistentesPorChave.entries()) {
    const trabalhados = lista.filter(isRegistroSaeouTrabalhado);
    if (trabalhados.length > 0) {
      // Priorizar registro com vencimento vinculado ou mais detalhado
      const melhorTrabalhado = trabalhados.find((t) => t.vencimento_id_vinculado) || trabalhados[0];
      existentesMelhorVersao.set(key, melhorTrabalhado);
    } else {
      existentesMelhorVersao.set(key, lista[0]);
    }
  }

  const snapshotFinal: RegistroSaeou060[] = [];
  const chavesProcessadasNaNova = new Set<string>();

  let totalNovos = 0;
  let totalAtualizados = 0;

  // 3. Processar cada registro da nova planilha
  for (const novo of novosDeduplicados) {
    const key = buildSaeouDeterministicKey(
      novo.codigo_interno,
      novo.digito,
      novo.data_vencimento
    );
    chavesProcessadasNaNova.add(key);
    const idDeterministico = `saeou-${key}`;

    const existente = existentesMelhorVersao.get(key);

    if (existente) {
      // Reconciliar sem duplicar
      const foiTrabalhado = isRegistroSaeouTrabalhado(existente);

      const itemReconciliado: RegistroSaeou060 = {
        ...novo,
        id: idDeterministico,
        // Preservar dados operacionais do trabalho se existirem
        status_saeou: foiTrabalhado ? existente.status_saeou : novo.status_saeou,
        vencimento_id_vinculado: existente.vencimento_id_vinculado || novo.vencimento_id_vinculado,
        trabalhado_em: existente.trabalhado_em || novo.trabalhado_em,
        desconsiderado_em: existente.desconsiderado_em || novo.desconsiderado_em,
        motivo_desconsiderado: existente.motivo_desconsiderado || novo.motivo_desconsiderado,
        adicionado_ao_controle_em: existente.adicionado_ao_controle_em || novo.adicionado_ao_controle_em,
        observacao: existente.observacao || novo.observacao,
        preco_normal: existente.preco_normal ?? (existente as any).precoNormal ?? novo.preco_normal ?? (novo as any).precoNormal,
        precoNormal: existente.precoNormal ?? existente.preco_normal ?? novo.precoNormal ?? novo.preco_normal,
        preco_trabalhado: existente.preco_trabalhado ?? (existente as any).precoTrabalhado ?? novo.preco_trabalhado ?? (novo as any).precoTrabalhado,
        precoTrabalhado: existente.precoTrabalhado ?? existente.preco_trabalhado ?? novo.precoTrabalhado ?? novo.preco_trabalhado,
        data_preco: existente.data_preco || novo.data_preco,
        data_primeira_aparicao: existente.data_primeira_aparicao || existente.data_importacao || novo.data_importacao,
        // Atualizar da nova planilha (Regra 12: NÃO somar quantidade de importações diferentes)
        quantidade: novo.quantidade,
        estoque_loja: novo.estoque_loja ?? existente.estoque_loja,
        data_movimento: novo.data_movimento || existente.data_movimento,
        data_cadastro: novo.data_cadastro || existente.data_cadastro,
        arquivo_origem: novo.arquivo_origem || existente.arquivo_origem,
        data_importacao: novo.data_importacao,
        hora_importacao: novo.hora_importacao,
        periodo_vencimento: novo.periodo_vencimento || existente.periodo_vencimento,
        promotor: novo.promotor || existente.promotor,
        loja: novo.loja || existente.loja,
      };

      snapshotFinal.push(itemReconciliado);
      totalAtualizados++;
    } else {
      snapshotFinal.push({
        ...novo,
        id: idDeterministico,
        data_primeira_aparicao: novo.data_importacao,
      });
      totalNovos++;
    }
  }

  // 4. Tratar registros que existiam antes mas não vieram na nova planilha
  let totalPreservadosFora = 0;
  let totalRemovidosObsoletos = 0;

  for (const [key, existente] of existentesMelhorVersao.entries()) {
    if (chavesProcessadasNaNova.has(key)) {
      continue;
    }

    if (isRegistroSaeouTrabalhado(existente)) {
      // Regra 3 & 6: Item trabalhado fora da nova planilha permanece PRESERVADO!
      snapshotFinal.push({
        ...existente,
        id: `saeou-${key}`,
      });
      totalPreservadosFora++;
    } else {
      // Regra 2 & 5: Item não trabalhado que sumiu da planilha é descartado do snapshot ativo
      totalRemovidosObsoletos++;
    }
  }

  return {
    snapshotReconciliado: snapshotFinal,
    estatisticas: {
      totalNovos,
      totalAtualizados,
      totalPreservadosFora,
      totalRemovidosObsoletos,
      totalFinal: snapshotFinal.length,
    },
  };
}

function normalizeHeader(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function parseNumberSafe(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;

  let cleaned = str.replace(/[R$\s]/gi, '');
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function parseDateSafe(val: any): { iso: string; display: string } | null {
  if (!val) return null;

  // Handle Excel Serial Number
  if (typeof val === 'number' && val > 20000 && val < 60000) {
    const utcDays = Math.floor(val - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    const y = dateInfo.getUTCFullYear();
    const m = String(dateInfo.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateInfo.getUTCDate()).padStart(2, '0');
    return { iso: `${y}-${m}-${d}`, display: `${d}/${m}/${y}` };
  }

  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return { iso: `${y}-${m}-${d}`, display: `${d}/${m}/${y}` };
  }

  const str = String(val).trim();
  if (!str) return null;

  // Format: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const brMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (brMatch) {
    const d = String(parseInt(brMatch[1], 10)).padStart(2, '0');
    const m = String(parseInt(brMatch[2], 10)).padStart(2, '0');
    let y = parseInt(brMatch[3], 10);
    if (y < 100) y += 2000;
    return { iso: `${y}-${m}-${d}`, display: `${d}/${m}/${y}` };
  }

  // Format: YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = String(parseInt(isoMatch[2], 10)).padStart(2, '0');
    const d = String(parseInt(isoMatch[3], 10)).padStart(2, '0');
    return { iso: `${y}-${m}-${d}`, display: `${d}/${m}/${y}` };
  }

  // Format: MM/YYYY
  const monthYearMatch = str.match(/^(\d{1,2})[\/\-\.](\d{2,4})$/);
  if (monthYearMatch) {
    const m = String(parseInt(monthYearMatch[1], 10)).padStart(2, '0');
    let y = parseInt(monthYearMatch[2], 10);
    if (y < 100) y += 2000;
    return { iso: `${y}-${m}-01`, display: `01/${m}/${y}` };
  }

  return null;
}

function findHeaderRowIndex(rows: any[][], keywords: string[]): number {
  if (!rows || rows.length === 0) return 0;

  let bestIdx = 0;
  let maxScore = 0;

  for (let r = 0; r < Math.min(25, rows.length); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    let score = 0;
    for (const cell of row) {
      if (cell === null || cell === undefined) continue;
      const cellNorm = normalizeHeader(String(cell));
      if (!cellNorm) continue;

      for (const kw of keywords) {
        if (cellNorm === kw || cellNorm.includes(kw)) {
          score += 1;
          break;
        }
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestIdx = r;
    }
  }

  return bestIdx;
}

function sheetRowsToObjects(rows: any[][], headerRowIndex: number): Record<string, any>[] {
  if (headerRowIndex >= rows.length) return [];
  const rawHeaders = rows[headerRowIndex];
  if (!Array.isArray(rawHeaders)) return [];

  const headers: string[] = [];
  const headerCounts: Record<string, number> = {};

  for (let c = 0; c < rawHeaders.length; c++) {
    const rawVal = rawHeaders[c];
    let hName = (rawVal !== null && rawVal !== undefined ? String(rawVal).trim() : '') || `COLUNA_${c + 1}`;

    if (headerCounts[hName]) {
      headerCounts[hName]++;
      hName = `${hName}_${headerCounts[hName]}`;
    } else {
      headerCounts[hName] = 1;
    }
    headers.push(hName);
  }

  const result: Record<string, any>[] = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const isEmpty = row.every((c) => c === null || c === undefined || String(c).trim() === '');
    if (isEmpty) continue;

    const obj: Record<string, any> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c] !== undefined ? row[c] : '';
    }
    result.push(obj);
  }

  return result;
}

interface SAEOU060Columns {
  codigoKey: string;
  digitoKey?: string;
  descricaoKey?: string;
  embalagemKey?: string;
  dataVencimentoKey?: string;
  quantidadeKey?: string;
  estoqueLojaKey?: string;
  lojaKey?: string;
  dataMovimentoKey?: string;
  dataCadastroKey?: string;
  periodoVencimentoKey?: string;
  promotorKey?: string;
  precoTrabalhadoKey?: string;
  dataPrecoKey?: string;
}

function identifySAEOU060Headers(sampleRow: Record<string, any>, allRows?: Record<string, any>[]): SAEOU060Columns {
  const keys = Object.keys(sampleRow);

  let codigoKey = '';
  let digitoKey: string | undefined;
  let descricaoKey: string | undefined;
  let embalagemKey: string | undefined;
  let dataVencimentoKey: string | undefined;
  let quantidadeKey: string | undefined;
  let estoqueLojaKey: string | undefined;
  let lojaKey: string | undefined;
  let dataMovimentoKey: string | undefined;
  let dataCadastroKey: string | undefined;
  let periodoVencimentoKey: string | undefined;
  let promotorKey: string | undefined;
  let precoTrabalhadoKey: string | undefined;
  let dataPrecoKey: string | undefined;

  // 1. Identify Dígito
  for (const key of keys) {
    const norm = normalizeHeader(key);
    if (
      /^(DIGITO|DIG|DV|DIGITOVERIFICADOR|DIGITOCOMPLEMENTAR|DIGITOS|DIGMERC|DIGPROD|DVMERC)$/.test(norm) ||
      norm.startsWith('DIG') ||
      norm.includes('DIGITO') ||
      norm === 'DV'
    ) {
      digitoKey = key;
      break;
    }
  }

  // 2. Identify Código Column
  for (const key of keys) {
    if (key === digitoKey) continue;
    const norm = normalizeHeader(key);
    if (
      norm.includes('INTERNO') ||
      norm.includes('SMG') ||
      norm.includes('CODMERC') ||
      norm.includes('CODPROD') ||
      norm.includes('CODITEM') ||
      norm === 'CODMERCADORIA' ||
      norm === 'CODIGOMERCADORIA' ||
      norm === 'CODIGO' ||
      norm === 'COD' ||
      norm.startsWith('COD')
    ) {
      codigoKey = key;
      break;
    }
  }

  // 3. Identify Data de Vencimento
  for (const key of keys) {
    const norm = normalizeHeader(key);
    if (
      norm.includes('VENCIMENTO') ||
      norm.includes('VCTO') ||
      norm.includes('DTVENC') ||
      norm.includes('DATAVENC') ||
      norm.includes('VALIDADE') ||
      norm.includes('DTVALIDADE') ||
      norm === 'VENC'
    ) {
      dataVencimentoKey = key;
      break;
    }
  }

  // 4a. Identify Estoque Loja / Total Column (if present)
  for (const key of keys) {
    if (key === codigoKey || key === digitoKey || key === dataVencimentoKey) continue;
    const norm = normalizeHeader(key);
    if (
      norm.includes('ESTOQUEDISPONIVEL') ||
      norm.includes('ESTOQUETOTAL') ||
      norm.includes('ESTOQUEATUAL') ||
      norm.includes('ESTOQUELOJA') ||
      norm.includes('SALDODISPONIVEL') ||
      norm.includes('SALDOATUAL') ||
      norm.includes('SALDOESTOQUE') ||
      norm === 'ESTOQUEDISP'
    ) {
      estoqueLojaKey = key;
      break;
    }
  }

  // 4b. Identify Quantidade Cadastrada / Vencendo (Priority 1: Expiry specific)
  for (const key of keys) {
    if (key === codigoKey || key === digitoKey || key === dataVencimentoKey || key === estoqueLojaKey) continue;
    const norm = normalizeHeader(key);
    if (
      norm.includes('QTDECADASTRADA') ||
      norm.includes('QUANTIDADECADASTRADA') ||
      norm.includes('QTDEVENCIMENTO') ||
      norm.includes('QUANTIDADEVENCIMENTO') ||
      norm.includes('QTDEVENC') ||
      norm.includes('QTDVENC') ||
      norm.includes('QTDVCTO') ||
      norm.includes('QTDEVCTO') ||
      norm.includes('QTDEAPONTADA') ||
      norm.includes('QUANTIDADEAPONTADA') ||
      norm.includes('QTDAPONTADA') ||
      norm.includes('QTDELOTE') ||
      norm.includes('QUANTIDADELOTE') ||
      norm.includes('QTDLOTE') ||
      norm.includes('QTDEINFORMADA') ||
      norm.includes('QUANTIDADEINFORMADA') ||
      norm.includes('QTDEVAL') ||
      norm.includes('QTDEVALIDADE') ||
      norm.includes('QUANTIDADEVALIDADE') ||
      norm.includes('QTDEPREVENTIVO') ||
      norm.includes('QUANTIDADEPREVENTIVO') ||
      norm.includes('ESTOQUECADASTRADO') ||
      norm.includes('ESTOQUEVENCENDO') ||
      norm.includes('ESTOQUEVENCIMENTO')
    ) {
      quantidadeKey = key;
      break;
    }
  }

  // 4c. Identify Quantidade (Priority 2: Generic Quantity, excluding store stock terms)
  if (!quantidadeKey) {
    for (const key of keys) {
      if (key === codigoKey || key === digitoKey || key === dataVencimentoKey || key === estoqueLojaKey) continue;
      const norm = normalizeHeader(key);
      const isTotalStock =
        norm.includes('DISPONIVEL') ||
        norm.includes('TOTAL') ||
        norm.includes('ATUAL') ||
        norm.includes('LOJA') ||
        norm.includes('FILIAL') ||
        norm.includes('SISTEMA') ||
        norm.includes('FISICO') ||
        norm.includes('GERAL') ||
        norm.includes('MINIMO') ||
        norm.includes('MAXIMO');

      if (!isTotalStock) {
        if (
          norm.includes('QUANT') ||
          norm.includes('QTDE') ||
          norm.includes('QTD') ||
          norm.includes('UNIDADES') ||
          norm === 'VOLUMES' ||
          norm === 'ITENS'
        ) {
          quantidadeKey = key;
          break;
        }
      }
    }
  }

  // 4d. Identify Quantidade (Priority 3: Fallback only if no quantity column was identified)
  if (!quantidadeKey) {
    for (const key of keys) {
      if (key === codigoKey || key === digitoKey || key === dataVencimentoKey || key === estoqueLojaKey) continue;
      const norm = normalizeHeader(key);
      if (norm === 'SALDO' || norm === 'ESTOQUE') {
        quantidadeKey = key;
        break;
      }
    }
  }

  // If estoqueLojaKey was not set yet, check if there's an unused ESTOQUE or SALDO column
  if (!estoqueLojaKey) {
    for (const key of keys) {
      if (key === codigoKey || key === digitoKey || key === dataVencimentoKey || key === quantidadeKey) continue;
      const norm = normalizeHeader(key);
      if (norm.includes('ESTOQUE') || norm.includes('SALDO')) {
        estoqueLojaKey = key;
        break;
      }
    }
  }

  // 5. Identify Descrição
  for (const key of keys) {
    if (key === codigoKey || key === digitoKey || key === dataVencimentoKey || key === quantidadeKey) continue;
    const norm = normalizeHeader(key);
    if (
      norm.includes('DESCRICAO') ||
      norm.includes('DESC') ||
      norm.includes('MERCADORIA') ||
      norm.includes('PRODUTO') ||
      norm.includes('NOME') ||
      norm === 'DENOMINACAO'
    ) {
      descricaoKey = key;
      break;
    }
  }

  // 6. Identify Embalagem
  for (const key of keys) {
    if (key === codigoKey || key === digitoKey || key === descricaoKey) continue;
    const norm = normalizeHeader(key);
    if (norm.includes('EMBALAGEM') || norm.includes('EMB') || norm.includes('APRESENTACAO') || norm === 'UNIDADE') {
      embalagemKey = key;
      break;
    }
  }

  // 7. Identify Loja
  for (const key of keys) {
    const norm = normalizeHeader(key);
    if (norm.includes('LOJA') || norm.includes('FILIAL') || norm === 'UNIDADEOPERACIONAL') {
      lojaKey = key;
      break;
    }
  }

  // 8. Identify Data Movimento e Data Cadastro
  for (const key of keys) {
    if (key === dataVencimentoKey) continue;
    const norm = normalizeHeader(key);
    if (
      !dataMovimentoKey &&
      (norm.includes('MOVIMENTO') ||
        norm.includes('MOVTO') ||
        norm.includes('DTMOV') ||
        norm.includes('DATAMOV') ||
        norm.includes('MOVIMENTACAO') ||
        norm.includes('EMISSAO') ||
        norm.includes('DTEMISSAO'))
    ) {
      dataMovimentoKey = key;
    } else if (
      !dataCadastroKey &&
      (norm.includes('CADASTRO') || norm.includes('DTCAD') || norm.includes('REGISTRO'))
    ) {
      dataCadastroKey = key;
    }
  }

  // 9. Identify Período Vencimento
  for (const key of keys) {
    if (key === dataVencimentoKey) continue;
    const norm = normalizeHeader(key);
    if (norm.includes('PERIODO') || norm.includes('MESVENC')) {
      periodoVencimentoKey = key;
      break;
    }
  }

  // 10. Identify Promotor
  for (const key of keys) {
    const norm = normalizeHeader(key);
    if (norm.includes('PROMOTOR') || norm.includes('RESPONSAVEL') || norm.includes('USUARIO') || norm === 'PROMOTORA') {
      promotorKey = key;
      break;
    }
  }

  // 11. Identify Preço Trabalhado
  for (const key of keys) {
    const norm = normalizeHeader(key);
    if (
      norm.includes('PRECO') ||
      norm.includes('VALOR') ||
      norm.includes('TRABALHADO') ||
      norm.includes('PROMOCIONAL') ||
      norm === 'PCO'
    ) {
      precoTrabalhadoKey = key;
      break;
    }
  }

  // 12. Identify Data Preço
  for (const key of keys) {
    if (key === dataVencimentoKey || key === dataCadastroKey) continue;
    const norm = normalizeHeader(key);
    if (norm.includes('DATAPRECO') || norm.includes('DTPRECO') || norm.includes('DVALOR')) {
      dataPrecoKey = key;
      break;
    }
  }

  // Fallback heuristics
  if (!codigoKey && keys.length > 0) {
    codigoKey = keys[0];
  }

  return {
    codigoKey: codigoKey || keys[0],
    digitoKey,
    descricaoKey,
    embalagemKey,
    dataVencimentoKey,
    quantidadeKey,
    estoqueLojaKey,
    lojaKey,
    dataMovimentoKey,
    dataCadastroKey,
    periodoVencimentoKey,
    promotorKey,
    precoTrabalhadoKey,
    dataPrecoKey,
  };
}

/**
 * Parses and processes a SAEOU060 Excel or CSV file.
 * Normalizes Code + DIG as text, crosses with SMGOI013 products,
 * checks if items already exist in the vencimentos repository,
 * and records comprehensive audit metrics.
 */
export async function processarSAEOU060(
  file: File,
  onProgress?: ProgressCallback
): Promise<{ registros: RegistroSaeou060[]; resumo: ResumoImportacao }> {
  onProgress?.(5, 'Lendo arquivo SAEOU060...');
  await new Promise((r) => setTimeout(r, 80));

  const arrayBuffer = await file.arrayBuffer();
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  let best2DRows: any[][] = [];

  if (isPdf) {
    onProgress?.(15, 'Lendo relatório PDF de vencimentos...');
    await new Promise((r) => setTimeout(r, 60));
    best2DRows = await pdfToTableRows(arrayBuffer);
    if (best2DRows.length === 0) {
      throw new Error('Nenhum dado tabular de vencimentos foi identificado dentro do arquivo PDF.');
    }
  } else {
    onProgress?.(20, 'Localizando planilha de dados...');
    await new Promise((r) => setTimeout(r, 60));

    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Nenhuma planilha encontrada no arquivo.');
    }

    let bestSheetName = workbook.SheetNames[0];
    let maxRows = 0;

    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;
      const raw2D: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (raw2D.length > maxRows) {
        maxRows = raw2D.length;
        bestSheetName = sheetName;
        best2DRows = raw2D;
      }
    }

    if (best2DRows.length === 0) {
      throw new Error('A planilha selecionada está vazia.');
    }
  }

  onProgress?.(35, 'Identificando cabeçalhos do SAEOU060...');
  await new Promise((r) => setTimeout(r, 60));

  const saeouKeywords = [
    'CODIGO',
    'DIGITO',
    'DIG',
    'DESCRICAO',
    'VENCIMENTO',
    'VALIDADE',
    'QUANTIDADE',
    'QTDE',
    'LOJA',
    'PROMOTOR',
    'PRECO',
  ];
  const headerRowIdx = findHeaderRowIndex(best2DRows, saeouKeywords);
  const rawRows = sheetRowsToObjects(best2DRows, headerRowIdx);

  if (rawRows.length === 0) {
    throw new Error('Nenhum registro encontrado abaixo do cabeçalho.');
  }

  const sample = rawRows[0];
  const cols = identifySAEOU060Headers(sample, rawRows);

  // Access current single source of truth: Product Repository
  const produtos = productRepository.getAllProducts();
  const vencimentosAtuais = productRepository.getVencimentos();

  // Create fast lookup maps for matching
  const produtosPorCodigoInterno = new Map<string, any>();
  const produtosPorChaveCompleta = new Map<string, any>();
  const produtosPorCodigoOriginal = new Map<string, any>();
  const produtosPorCodigoExibicao = new Map<string, any>();

  produtos.forEach((p) => {
    if (p.codigo_interno) produtosPorCodigoInterno.set(p.codigo_interno, p);
    if (p.chave_normalizada) produtosPorChaveCompleta.set(p.chave_normalizada, p);
    if (p.codigo_original) produtosPorCodigoOriginal.set(p.codigo_original.trim(), p);
    if (p.codigo_exibicao) produtosPorCodigoExibicao.set(p.codigo_exibicao, p);
  });

  // Map of existing registered lots to detect if already under control
  const lotesExistentesMap = new Map<string, string>(); // Key: "codigo_interno:data_validade" -> loteId
  vencimentosAtuais.forEach((v) => {
    const key = `${v.codigo_interno}:${v.data_validade}`;
    lotesExistentesMap.set(key, v.id);
  });

  const isBaseEmpty = produtos.length === 0;
  const registrosExtraidos: RegistroSaeou060[] = [];
  const errosDetalhes: string[] = [];

  let total_lidos = 0;
  let total_localizados = 0;
  let total_nao_localizados = 0;
  let total_novos = 0;
  let total_ja_no_controle = 0;
  let total_erros = 0;
  let total_ignorados = 0;

  const now = new Date();
  const dataImportacaoStr = now.toLocaleDateString('pt-BR');
  const horaImportacaoStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dataHoraTimestamp = `${dataImportacaoStr} ${horaImportacaoStr}`;

  const totalRowsCount = rawRows.length;
  const chunkSize = Math.max(1, Math.floor(totalRowsCount / 25));

  for (let idx = 0; idx < totalRowsCount; idx++) {
    const row = rawRows[idx];
    total_lidos++;

    if (idx % chunkSize === 0 || idx === totalRowsCount - 1) {
      const progress = Math.min(92, Math.floor(35 + (idx / totalRowsCount) * 55));
      onProgress?.(progress, `Cruzando registro SAEOU060 ${idx + 1} de ${totalRowsCount}...`);
      await new Promise((r) => setTimeout(r, 0));
    }

    const rawCodigo = row[cols.codigoKey];
    const rawDigito = cols.digitoKey ? row[cols.digitoKey] : undefined;
    const rawDescricao = cols.descricaoKey ? row[cols.descricaoKey] : undefined;
    const rawEmbalagem = cols.embalagemKey ? row[cols.embalagemKey] : undefined;
    const rawDataVcto = cols.dataVencimentoKey ? row[cols.dataVencimentoKey] : undefined;
    const rawQtde = cols.quantidadeKey ? row[cols.quantidadeKey] : undefined;
    const rawLoja = cols.lojaKey ? row[cols.lojaKey] : undefined;
    const rawDataMov = cols.dataMovimentoKey ? row[cols.dataMovimentoKey] : undefined;
    const rawDataCad = cols.dataCadastroKey ? row[cols.dataCadastroKey] : undefined;
    const rawPeriodo = cols.periodoVencimentoKey ? row[cols.periodoVencimentoKey] : undefined;
    const rawPromotor = cols.promotorKey ? row[cols.promotorKey] : undefined;
    const rawPreco = cols.precoTrabalhadoKey ? row[cols.precoTrabalhadoKey] : undefined;
    const rawDataPreco = cols.dataPrecoKey ? row[cols.dataPrecoKey] : undefined;

    if (rawCodigo === null || rawCodigo === undefined || String(rawCodigo).trim() === '') {
      total_ignorados++;
      continue;
    }

    // Normalização padrão de Código e DIG (TEXTO estrito)
    const norm = normalizeCodigoSMGO(rawCodigo, rawDigito);
    const codigoInterno = norm.codigoInterno;

    if (!norm.isValid || !codigoInterno) {
      total_erros++;
      const msg = `Linha ${total_lidos}: Código inválido "${rawCodigo}"`;
      errosDetalhes.push(msg);
      addDivergencia({
        tipo: 'CODIGO_INVALIDO',
        origem: 'SAEOU060',
        identificador: `Código ${rawCodigo}`,
        descricao_problema: `Código inválido na planilha SAEOU060: "${rawCodigo}"`,
        detalhes: msg,
      });
      continue;
    }

    // Parse Expiry Date and Movement Dates
    const parsedVcto = parseDateSafe(rawDataVcto);
    const parsedDataMov = parseDateSafe(rawDataMov);
    const parsedDataCad = parseDateSafe(rawDataCad);
    const parsedDataPreco = parseDateSafe(rawDataPreco);
    const quantidade = parseNumberSafe(rawQtde);
    const precoTrabalhado = rawPreco !== undefined && rawPreco !== '' ? parseNumberSafe(rawPreco) : undefined;

    // Cross with SMGOI013 product base
    let prod: any | undefined;
    if (norm.chaveNormalizada && produtosPorChaveCompleta.has(norm.chaveNormalizada)) {
      prod = produtosPorChaveCompleta.get(norm.chaveNormalizada);
    } else if (codigoInterno && produtosPorCodigoInterno.has(codigoInterno)) {
      prod = produtosPorCodigoInterno.get(codigoInterno);
    } else if (norm.codigoExibicao && produtosPorCodigoExibicao.has(norm.codigoExibicao)) {
      prod = produtosPorCodigoExibicao.get(norm.codigoExibicao);
    } else if (rawCodigo && produtosPorCodigoOriginal.has(String(rawCodigo).trim())) {
      prod = produtosPorCodigoOriginal.get(String(rawCodigo).trim());
    }

    // Check status in control
    let status_saeou: StatusSaeou060 = 'NOVO';
    let vencimentoIdVinculado: string | undefined;

    if (isBaseEmpty) {
      status_saeou = 'AGUARDANDO_BASE';
    } else if (!prod) {
      status_saeou = 'NAO_LOCALIZADO';
      total_nao_localizados++;
      addDivergencia({
        tipo: 'CODIGO_NAO_ENCONTRADO',
        origem: 'SAEOU060',
        identificador: `Código ${norm.codigoExibicao || codigoInterno}`,
        descricao_problema: `Código ${norm.codigoExibicao || codigoInterno} presente no SAEOU060 não foi localizado na SMGOI013.`,
        detalhes: rawDescricao ? `Descrição no SAEOU060: ${String(rawDescricao).trim()}` : undefined,
      });
    } else {
      total_localizados++;

      // Check if this expiry date is already registered in control
      if (parsedVcto?.iso) {
        const lotKey = `${codigoInterno}:${parsedVcto.iso}`;
        if (lotesExistentesMap.has(lotKey)) {
          status_saeou = 'JA_NO_CONTROLE';
          total_ja_no_controle++;
          vencimentoIdVinculado = lotesExistentesMap.get(lotKey);
        } else {
          // Check if expiry date is critical (<= 7 days)
          const hojeMid = new Date();
          hojeMid.setHours(0, 0, 0, 0);
          const vctoDate = new Date(parsedVcto.iso + 'T00:00:00');
          const diffDays = Math.floor((vctoDate.getTime() - hojeMid.getTime()) / (1000 * 60 * 60 * 24));

          if (diffDays <= 7) {
            status_saeou = 'PRECISA_DE_ACAO';
          } else {
            status_saeou = 'NOVO';
          }
          total_novos++;
        }
      } else {
        status_saeou = 'NOVO';
        total_novos++;
      }
    }

    const regDigito = norm.digito || prod?.digito || '';
    const regId = buildSaeouId(codigoInterno, regDigito, parsedVcto?.iso);

    registrosExtraidos.push({
      id: regId,
      codigo_original: String(rawCodigo).trim(),
      codigo_interno: codigoInterno,
      digito: regDigito,
      codigo_exibicao: norm.codigoExibicao || `${codigoInterno}${regDigito ? '-' + regDigito : ''}`,
      chave_normalizada: norm.chaveNormalizada,
      descricao: (rawDescricao && String(rawDescricao).trim()) || prod?.descricao || '',
      embalagem: (rawEmbalagem && String(rawEmbalagem).trim()) || prod?.embalagem || '',
      data_vencimento: parsedVcto?.iso,
      data_vencimento_exibicao: parsedVcto?.display || (rawDataVcto ? String(rawDataVcto).trim() : ''),
      quantidade,
      estoque_loja: cols.estoqueLojaKey && row[cols.estoqueLojaKey] !== undefined ? parseNumberSafe(row[cols.estoqueLojaKey]) : undefined,
      loja: rawLoja ? String(rawLoja).trim() : undefined,
      data_movimento: parsedDataMov?.display || (rawDataMov ? String(rawDataMov).trim() : (parsedDataCad?.display || dataImportacaoStr)),
      data_cadastro: parsedDataCad?.display || (rawDataCad ? String(rawDataCad).trim() : undefined),
      periodo_vencimento: rawPeriodo ? String(rawPeriodo).trim() : undefined,
      promotor: rawPromotor ? String(rawPromotor).trim() : undefined,
      preco_trabalhado: precoTrabalhado && precoTrabalhado > 0 ? precoTrabalhado : undefined,
      data_preco: parsedDataPreco?.display || (rawDataPreco ? String(rawDataPreco).trim() : undefined),
      status_saeou,
      origem: 'SAEOU060',
      arquivo_origem: file.name,
      data_importacao: dataImportacaoStr,
      hora_importacao: horaImportacaoStr,
      data_primeira_aparicao: dataImportacaoStr,
      vencimento_id_vinculado: vencimentoIdVinculado,
    });
  }

  onProgress?.(95, 'Deduplicando e validando dados da planilha...');
  await new Promise((r) => setTimeout(r, 60));

  // Deduplicação interna da própria planilha antes da reconciliação (Regra 5 e Regra 8)
  const registrosDeduplicados = deduplicarRegistrosSaeouPlanilha(registrosExtraidos);

  const resumo: ResumoImportacao = {
    id: `imp-saeou-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    tipo: 'SAEOU060',
    data_hora: dataHoraTimestamp,
    total_lidos,
    total_atualizados: total_ja_no_controle,
    total_novos,
    total_erros,
    total_ignorados,
    nome_arquivo: file.name,
    total_localizados,
    total_nao_localizados,
    total_aguardando_base: isBaseEmpty ? total_lidos : 0,
    total_ja_no_controle,
    detalhes_erros: errosDetalhes.slice(0, 10),
  };

  onProgress?.(100, 'Importação SAEOU060 concluída com sucesso!');
  await new Promise((r) => setTimeout(r, 150));

  return { registros: registrosDeduplicados, resumo };
}

/**
 * Generates and downloads a sample SAEOU060 Excel file for testing.
 */
export function gerarExemploPlanilhaSAEOU060(): void {
  const hojeStr = new Date().toLocaleDateString('pt-BR');
  const sampleData = [
    {
      'CÓDIGO': '00046135',
      'DIG': '156',
      'DESCRIÇÃO': 'RF.MARG.QUALY C/SAL',
      'EMBALAGEM': 'CXA 1 X 6 X 1KG',
      'DATA VENCIMENTO': '08/09/2026',
      'QUANTIDADE': 18,
      'LOJA': '172 - CASCAVEL',
      'DATA MOVIMENTO': hojeStr,
      'DATA CADASTRO': hojeStr,
      'PERÍODO VENCIMENTO': '09/2026',
      'PROMOTOR': 'FERNANDO ALMEIDA',
      'PREÇO TRABALHADO': 10.99,
      'DATA PREÇO': '28/08/2026',
    },
    {
      'CÓDIGO': '00051208',
      'DIG': '009',
      'DESCRIÇÃO': 'LEITE UHT INTEGRAL PIRACANJUBA 1L',
      'EMBALAGEM': 'CXA 1 X 12 X 1L',
      'DATA VENCIMENTO': '03/09/2026',
      'QUANTIDADE': 24,
      'LOJA': '172 - CASCAVEL',
      'DATA MOVIMENTO': hojeStr,
      'DATA CADASTRO': hojeStr,
      'PERÍODO VENCIMENTO': '09/2026',
      'PROMOTOR': 'FERNANDO ALMEIDA',
      'PREÇO TRABALHADO': 4.49,
      'DATA PREÇO': '29/08/2026',
    },
    {
      'CÓDIGO': '00049795',
      'DIG': '166',
      'DESCRIÇÃO': 'IOGURTE GREGO TRADICIONAL NESTLE 90G',
      'EMBALAGEM': 'CXA 1 X 24 X 90G',
      'DATA VENCIMENTO': '31/08/2026',
      'QUANTIDADE': 12,
      'LOJA': '172 - CASCAVEL',
      'DATA MOVIMENTO': hojeStr,
      'DATA CADASTRO': hojeStr,
      'PERÍODO VENCIMENTO': '08/2026',
      'PROMOTOR': 'JULIANA COSTA',
      'PREÇO TRABALHADO': 2.99,
      'DATA PREÇO': '25/08/2026',
    },
    {
      'CÓDIGO': '00038190',
      'DIG': '022',
      'DESCRIÇÃO': 'REQUEIJAO CREMOSO ELEGE TRAD 200G',
      'EMBALAGEM': 'CXA 1 X 12 X 200G',
      'DATA VENCIMENTO': '06/09/2026',
      'QUANTIDADE': 24,
      'LOJA': '172 - CASCAVEL',
      'DATA MOVIMENTO': hojeStr,
      'DATA CADASTRO': hojeStr,
      'PERÍODO VENCIMENTO': '09/2026',
      'PROMOTOR': 'MARCOS VINICIUS',
      'PREÇO TRABALHADO': 6.99,
      'DATA PREÇO': '27/08/2026',
    },
    {
      'CÓDIGO': '00062410',
      'DIG': '001',
      'DESCRIÇÃO': 'QUEIJO MUSSARELA FATIADO PRESIDENT 150G',
      'EMBALAGEM': 'CXA 1 X 10 X 150G',
      'DATA VENCIMENTO': '14/09/2026',
      'QUANTIDADE': 35,
      'LOJA': '172 - CASCAVEL',
      'DATA MOVIMENTO': hojeStr,
      'DATA CADASTRO': hojeStr,
      'PERÍODO VENCIMENTO': '09/2026',
      'PROMOTOR': 'JULIANA COSTA',
      'PREÇO TRABALHADO': 7.89,
      'DATA PREÇO': '30/08/2026',
    },
    {
      'CÓDIGO': '00078105',
      'DIG': '014',
      'DESCRIÇÃO': 'MACARRAO RENATA ESPAGUETE OVO 500G',
      'EMBALAGEM': 'CXA 1 X 20 X 500G',
      'DATA VENCIMENTO': '20/09/2026',
      'QUANTIDADE': 40,
      'LOJA': '172 - CASCAVEL',
      'DATA MOVIMENTO': hojeStr,
      'DATA CADASTRO': hojeStr,
      'PERÍODO VENCIMENTO': '09/2026',
      'PROMOTOR': 'FERNANDO ALMEIDA',
      'PREÇO TRABALHADO': 3.29,
      'DATA PREÇO': '28/08/2026',
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SAEOU060');
  XLSX.writeFile(wb, 'Exemplo_Planilha_SAEOU060.xlsx');
}
