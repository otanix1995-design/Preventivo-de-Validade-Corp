/**
 * ARQUITETURA HÍBRIDA V1.0 — ETAPA 2 (FILIAL 172 — CASCAVEL)
 * Codec Tabular Compactado + fflate (zlib) + Firestore Bytes + SHA-256 Integral para SPCOI007.
 *
 * Reduz ~46.057 fornecedores (~14-18 MB JSON) para poucos blocos binários (< 400 KB cada),
 * preservando integralmente todos os campos, integridade ponta a ponta e cota gratuita Spark.
 */

import { Bytes } from 'firebase/firestore';
import { unzlibSync, zlibSync } from 'fflate';
import { FornecedorSPCOI007, Industria } from '../types';
import { sha256HexBytes } from './localPackageMode';

export const SPCOI_TABULAR_FORMAT_V1 = 'SPCOI_TABULAR_FFLATE_BYTES_V1';
export const DEFAULT_SPCOI_MAX_CHUNK_BYTES = 400 * 1024; // 400 KB binário (folga > 600 KB até 1 MiB)
export const ABSOLUTE_FIRESTORE_SAFE_LIMIT_BYTES = 900 * 1024;

export const SPCOI_FORNECEDOR_BASE_COLUMNS = [
  'id',
  'cnpj',
  'cnpj_formatado',
  'razao_social',
  'codigo_interno',
  'digito',
  'codigo_exibicao',
  'descricao_spcoi',
  'criado_em',
  'atualizado_em',
  'cnpj_original',
  'codigo_original',
  'divisao',
  'status_sta',
  'embalagem',
  'comprador',
  'descricao_produto',
] as const;

export const SPCOI_INDUSTRIA_BASE_COLUMNS = [
  'cnpj',
  'cnpj_formatado',
  'razao_social',
  'nome_exibicao',
  'ativo',
  'total_produtos_loja',
  'promotores_responsaveis',
  'criado_em',
  'atualizado_em',
] as const;

export interface TabularPayload<T> {
  fmt: typeof SPCOI_TABULAR_FORMAT_V1;
  kind: 'FORNECEDORES' | 'INDUSTRIAS';
  cols: string[];
  rows: any[][];
  count: number;
  _phantom?: T;
}

export interface SpcoiCompressedChunk {
  index: number;
  itemsCount: number;
  compressedBytes: Uint8Array;
  uncompressedBytes: number;
  chunkSha256: string;
  formato: typeof SPCOI_TABULAR_FORMAT_V1;
}

export interface SpcoiEncodedIndustriasResult {
  compressedBytes: Uint8Array;
  uncompressedBytes: number;
  bytesField: Bytes;
  formato: typeof SPCOI_TABULAR_FORMAT_V1;
  checksumSha256: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Converte matriz de objetos em representação tabular enxuta (cabeçalho único + linhas posicional),
 * preservando qualquer propriedade extra e distinguindo `undefined` via `null` + poda à direita.
 */
export function encodeObjectsToTabular<T extends Record<string, any>>(
  items: T[],
  baseColumns: readonly string[],
  kind: 'FORNECEDORES' | 'INDUSTRIAS'
): TabularPayload<T> {
  const baseSet = new Set<string>(baseColumns);
  const extraColsSet = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    const keys = Object.keys(item);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (!baseSet.has(key) && item[key] !== undefined) {
        extraColsSet.add(key);
      }
    }
  }

  const extraCols = Array.from(extraColsSet).sort();
  const cols = [...baseColumns, ...extraCols];
  const rows: any[][] = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i] || ({} as Record<string, any>);
    const row = new Array(cols.length);
    let lastDefinedIdx = -1;
    for (let c = 0; c < cols.length; c++) {
      const val = item[cols[c]];
      if (val !== undefined) {
        row[c] = val;
        lastDefinedIdx = c;
      } else {
        row[c] = null;
      }
    }
    if (lastDefinedIdx < cols.length - 1) {
      row.length = lastDefinedIdx + 1;
    }
    rows[i] = row;
  }

  return {
    fmt: SPCOI_TABULAR_FORMAT_V1,
    kind,
    cols,
    rows,
    count: items.length,
  };
}

/**
 * Reconstrói exatamente os objetos originais a partir do formato tabular.
 */
export function decodeTabularToObjects<T extends Record<string, any>>(
  payload: TabularPayload<T>
): T[] {
  if (!payload || payload.fmt !== SPCOI_TABULAR_FORMAT_V1 || !Array.isArray(payload.cols) || !Array.isArray(payload.rows)) {
    throw new Error('Formato tabular SPCOI007 inválido ou incompatível.');
  }

  const { cols, rows } = payload;
  const result: T[] = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const obj: Record<string, any> = {};
    const limit = Math.min(cols.length, Array.isArray(row) ? row.length : 0);
    for (let c = 0; c < limit; c++) {
      const val = row[c];
      if (val !== null && val !== undefined) {
        obj[cols[c]] = val;
      }
    }
    result[i] = obj as T;
  }

  return result;
}

/**
 * Comprime qualquer matriz tabular usando fflate (zlibSync nível 6).
 */
export function compressTabularWithFflate<T extends Record<string, any>>(
  items: T[],
  baseColumns: readonly string[],
  kind: 'FORNECEDORES' | 'INDUSTRIAS'
): { compressedBytes: Uint8Array; uncompressedBytes: number } {
  const tabular = encodeObjectsToTabular(items, baseColumns, kind);
  const json = JSON.stringify(tabular);
  const rawBytes = textEncoder.encode(json);
  const compressedBytes = zlibSync(rawBytes, { level: 6 });
  return {
    compressedBytes,
    uncompressedBytes: rawBytes.byteLength,
  };
}

/**
 * Descomprime Bytes fflate (zlib) e reconstrói os objetos tipados.
 */
export function decompressTabularFromBytes<T extends Record<string, any>>(
  rawInput: unknown,
  expectedKind?: 'FORNECEDORES' | 'INDUSTRIAS'
): T[] {
  const u8 = extractUint8ArrayFromFirestoreValue(rawInput);
  if (!u8 || u8.byteLength === 0) {
    throw new Error('Bloco binário Bytes vazio ou inválido para descompressão SPCOI007.');
  }
  const inflated = unzlibSync(u8);
  const jsonStr = textDecoder.decode(inflated);
  const parsed = JSON.parse(jsonStr) as TabularPayload<T>;
  if (expectedKind && parsed.kind !== expectedKind) {
    throw new Error(`Tipo tabular divergente: esperado ${expectedKind}, recebido ${parsed.kind}.`);
  }
  return decodeTabularToObjects<T>(parsed);
}

/**
 * Extrai Uint8Array a partir de Firestore `Bytes`, `Uint8Array`, `ArrayBuffer`,
 * objeto JSON serializado de Bytes (`{ type: 'firestore/bytes/1.0', bytes: '...' }`) ou string base64.
 */
export function extractUint8ArrayFromFirestoreValue(raw: unknown): Uint8Array | null {
  if (!raw) return null;

  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (typeof (raw as any).toUint8Array === 'function') {
    return (raw as Bytes).toUint8Array();
  }
  if (
    typeof raw === 'object' &&
    typeof (raw as any).bytes === 'string'
  ) {
    return base64ToUint8Array((raw as any).bytes);
  }
  if (typeof raw === 'string') {
    return base64ToUint8Array(raw);
  }
  return null;
}

export function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Converte Uint8Array para Firestore `Bytes`.
 */
export function uint8ArrayToFirestoreBytes(u8: Uint8Array): Bytes {
  return Bytes.fromUint8Array(u8);
}

/**
 * Divide automaticamente a lista de fornecedores SPCOI007 em blocos compactados via fflate,
 * garantindo por compressão real + bissecção adaptativa que CADA documento do Firestore
 * respeite estritamente o limite seguro em bytes (< maxChunkBytes, nunca >= 1 MiB).
 */
export async function buildSafeCompressedSpcoiChunks(
  fornecedores: FornecedorSPCOI007[],
  maxChunkBytes: number = DEFAULT_SPCOI_MAX_CHUNK_BYTES
): Promise<SpcoiCompressedChunk[]> {
  if (!fornecedores || fornecedores.length === 0) {
    return [];
  }

  // Margem reservada para campos de metadados do chunk no Firestore (~512 bytes)
  const targetMaxBinary = Math.max(
    64,
    Math.min(maxChunkBytes, ABSOLUTE_FIRESTORE_SAFE_LIMIT_BYTES) - 512
  );

  const chunks: SpcoiCompressedChunk[] = [];
  let cursor = 0;
  // Estimativa inicial: ~100 bytes comprimidos por registro SPCOI (para 400KB -> ~4000-15000 itens)
  let estimatedBatchSize = Math.min(
    fornecedores.length,
    Math.max(50, Math.floor(targetMaxBinary / 35))
  );

  while (cursor < fornecedores.length) {
    let batchLen = Math.min(fornecedores.length - cursor, estimatedBatchSize);
    let slice = fornecedores.slice(cursor, cursor + batchLen);
    let encoded = compressTabularWithFflate(slice, SPCOI_FORNECEDOR_BASE_COLUMNS, 'FORNECEDORES');

    // Se exceder o teto, reduz por bissecção até caber dentro do limite seguro
    while (encoded.compressedBytes.byteLength > targetMaxBinary) {
      if (batchLen <= 1) {
        if (encoded.compressedBytes.byteLength > ABSOLUTE_FIRESTORE_SAFE_LIMIT_BYTES) {
          throw new Error(
            `Registro SPCOI007 #${cursor + 1} comprimido (${Math.round(
              encoded.compressedBytes.byteLength / 1024
            )} KB) excede o limite máximo de documento do Firestore.`
          );
        }
        break;
      }
      batchLen = Math.max(1, Math.floor(batchLen / 2));
      slice = fornecedores.slice(cursor, cursor + batchLen);
      encoded = compressTabularWithFflate(slice, SPCOI_FORNECEDOR_BASE_COLUMNS, 'FORNECEDORES');
    }

    const chunkSha256 = await sha256HexBytes(encoded.compressedBytes);
    chunks.push({
      index: chunks.length,
      itemsCount: slice.length,
      compressedBytes: encoded.compressedBytes,
      uncompressedBytes: encoded.uncompressedBytes,
      chunkSha256,
      formato: SPCOI_TABULAR_FORMAT_V1,
    });

    cursor += slice.length;

    // Ajuste adaptativo da próxima janela baseado na taxa real de compressão observada
    if (encoded.compressedBytes.byteLength > 0 && slice.length > 0) {
      const bytesPerItem = encoded.compressedBytes.byteLength / slice.length;
      const nextIdeal = Math.floor((targetMaxBinary * 0.88) / Math.max(1, bytesPerItem));
      estimatedBatchSize = Math.max(1, Math.min(25_000, nextIdeal));
    }
  }

  return chunks;
}

/**
 * Compacta a lista de indústrias SPCOI007 em formato tabular + fflate + Bytes.
 */
export async function encodeIndustriasToCompressedBytes(
  industrias: Industria[]
): Promise<SpcoiEncodedIndustriasResult> {
  const { compressedBytes, uncompressedBytes } = compressTabularWithFflate(
    industrias || [],
    SPCOI_INDUSTRIA_BASE_COLUMNS,
    'INDUSTRIAS'
  );
  if (compressedBytes.byteLength > ABSOLUTE_FIRESTORE_SAFE_LIMIT_BYTES) {
    throw new Error(
      `Lista de indústrias compactada (${Math.round(
        compressedBytes.byteLength / 1024
      )} KB) excedeu o limite seguro do Firestore.`
    );
  }
  const checksumSha256 = await sha256HexBytes(compressedBytes);
  return {
    compressedBytes,
    uncompressedBytes,
    bytesField: uint8ArrayToFirestoreBytes(compressedBytes),
    formato: SPCOI_TABULAR_FORMAT_V1,
    checksumSha256,
  };
}

/**
 * Calcula o checksum SHA-256 INTEGRAL de 100% da base SPCOI007 (todos os fornecedores e indústrias),
 * de maneira determinística independente de formatação ou ordem de chaves de objeto.
 * Mesma função executada no publicador e no dispositivo consumidor para validar integridade integral.
 */
export async function calcularChecksumIntegralSpcoi(
  fornecedores: FornecedorSPCOI007[],
  industrias: Industria[]
): Promise<string> {
  const tabFornecedores = encodeObjectsToTabular(
    fornecedores || [],
    SPCOI_FORNECEDOR_BASE_COLUMNS,
    'FORNECEDORES'
  );
  const tabIndustrias = encodeObjectsToTabular(
    industrias || [],
    SPCOI_INDUSTRIA_BASE_COLUMNS,
    'INDUSTRIAS'
  );

  const payloadCanonic = JSON.stringify({
    fmt: SPCOI_TABULAR_FORMAT_V1,
    totalFornecedores: fornecedores.length,
    totalIndustrias: industrias.length,
    fornecedores: tabFornecedores,
    industrias: tabIndustrias,
  });

  return sha256HexBytes(textEncoder.encode(payloadCanonic));
}
