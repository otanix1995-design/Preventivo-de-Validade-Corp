// src/services/deviceId.ts
// Gerenciamento de Identificação do Dispositivo e Normalização de Vencimentos Multi-Dispositivos

import { LoteVencimento } from '../types';

const DEVICE_ID_KEY = 'controle_vencimentos_device_id_v1';
const FILIAL_PADRAO = '172';

/**
 * Retorna o ID único e estável do dispositivo atual, persistido no localStorage.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server_node';
  try {
    let devId = localStorage.getItem(DEVICE_ID_KEY);
    if (!devId) {
      const randomPart = Math.random().toString(36).substring(2, 10);
      devId = `dev_${Date.now().toString(36)}_${randomPart}`;
      localStorage.setItem(DEVICE_ID_KEY, devId);
    }
    return devId;
  } catch {
    return 'dev_fallback';
  }
}

/**
 * Retorna a filial padrão operacional da aplicação (Filial 172)
 */
export function getFilialPadrao(): string {
  return FILIAL_PADRAO;
}

/**
 * Gera um identificador único de operação (operationId)
 */
export function generateOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Gera a chave estável do lote para garantir unicidade central:
 * filialId_codigoInterno_digito_dataVencimento
 * Exemplo: 172_51284_188_2026-09-13
 */
export function buildVencimentoKey(
  filialId: string | undefined,
  codigoInterno: string,
  digito: string | undefined,
  dataVencimento: string
): string {
  const cFilial = String(filialId || FILIAL_PADRAO).trim();
  const cInterno = String(codigoInterno || '').trim().replace(/^0+/, '') || '0';
  const cDigito = String(digito !== undefined ? digito : '').trim() || '0';
  const cData = String(dataVencimento || '').trim().slice(0, 10);
  return `${cFilial}_${cInterno}_${cDigito}_${cData}`;
}

/**
 * Formata um valor numérico para a moeda brasileira (pt-BR)
 * Ex: 14.99 -> "R$ 14,99"
 * Se for null/undefined/NaN, retorna o fallback (padrão: "Não informado")
 */
export function formatarMoedaBR(valor?: number | null, fallback: string = 'Não informado'): string {
  if (valor === undefined || valor === null || isNaN(valor)) {
    return fallback;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);
}

/**
 * Converte entradas numéricas ou em string no padrão monetário brasileiro para float seguro de 2 casas decimais.
 * Aceita: "14,99", "14.99", "R$ 14,99", "1.234,56", 14.99
 * Retorna null caso inválido ou vazio.
 */
export function parseMoedaBR(val?: string | number | null): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    return isNaN(val) ? null : Number(val.toFixed(2));
  }
  const str = String(val).trim();
  if (!str) return null;
  const clean = str.replace(/^R\$\s*/i, '').trim();
  if (!clean) return null;
  let normalized = clean;
  if (clean.includes(',') && clean.includes('.')) {
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if (clean.includes(',')) {
    normalized = clean.replace(',', '.');
  }
  const parsed = parseFloat(normalized);
  if (isNaN(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
}

/**
 * Normaliza qualquer objeto de vencimento (seja vindo da nuvem com camelCase ou local com snake_case)
 * garantindo que TODOS os campos estejam devidamente preenchidos e compatíveis.
 */
export function normalizeVencimentoRecord(raw: any): LoteVencimento {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Vencimento inválido para normalização');
  }

  const filial = String(raw.filialId || raw.filial_id || FILIAL_PADRAO).trim();
  const codInterno = String(raw.codigoInterno || raw.codigo_interno || '').trim().replace(/^0+/, '');
  const dig = String(raw.digito !== undefined && raw.digito !== null ? raw.digito : '').trim();
  const dataVenc = String(raw.dataVencimento || raw.data_validade || '').trim().slice(0, 10);

  // Chave estável de identificação
  const keyDerived = buildVencimentoKey(filial, codInterno, dig, dataVenc);
  const stableId = String(raw.vencimentoId || raw.id || keyDerived);

  const desc = String(raw.descricao || raw.descricao_produto || '').trim();
  const embalagem = String(raw.embalagem || 'UN').trim();
  const codExibicao = String(raw.codigo_exibicao || (dig ? `${codInterno}-${dig}` : codInterno));

  const qtd = Number(
    raw.quantidade !== undefined
      ? raw.quantidade
      : raw.quantidade_total_unidades !== undefined
      ? raw.quantidade_total_unidades
      : 0
  );

  // Preço Normal (DE) - Suporta number, string brasileira ou null
  const precoNormalRaw =
    raw.precoNormal !== undefined && raw.precoNormal !== null && raw.precoNormal !== ''
      ? raw.precoNormal
      : raw.preco_normal !== undefined && raw.preco_normal !== null && raw.preco_normal !== ''
      ? raw.preco_normal
      : null;

  const precoNormal =
    precoNormalRaw !== null
      ? typeof precoNormalRaw === 'number'
        ? (isNaN(precoNormalRaw) ? null : Number(precoNormalRaw.toFixed(2)))
        : parseMoedaBR(precoNormalRaw)
      : null;

  // Preço de Rebaixe / Trabalhado (POR)
  const precoTrabalhadoRaw =
    raw.precoTrabalhado !== undefined && raw.precoTrabalhado !== null && raw.precoTrabalhado !== ''
      ? raw.precoTrabalhado
      : raw.preco_trabalhado !== undefined && raw.preco_trabalhado !== null && raw.preco_trabalhado !== ''
      ? raw.preco_trabalhado
      : null;

  const preco =
    precoTrabalhadoRaw !== null
      ? typeof precoTrabalhadoRaw === 'number'
        ? (isNaN(precoTrabalhadoRaw) ? null : Number(precoTrabalhadoRaw.toFixed(2)))
        : parseMoedaBR(precoTrabalhadoRaw)
      : null;

  const enviarComprador = Boolean(
    raw.enviarParaComprador !== undefined
      ? raw.enviarParaComprador
      : raw.enviar_ao_comprador
  );

  const status = String(raw.status || raw.status_customizado || 'PENDENTE');
  const createdAt = String(raw.createdAt || raw.criado_em || raw.criadoEm || new Date().toISOString());
  const updatedAt = String(raw.updatedAt || raw.atualizado_em || raw.atualizadoEm || createdAt);

  const isDeleted = Boolean(
    raw.isDeleted === true ||
    (raw.deletedAt !== undefined && raw.deletedAt !== null && raw.deletedAt !== '')
  );

  const deletedAt = isDeleted
    ? String(raw.deletedAt || updatedAt)
    : null;

  const version = Number(raw.version || 1);
  const criadoPor = String(raw.criadoPor || raw.criadoPorId || 'SISTEMA_PRINCIPAL');
  const atualizadoPor = String(raw.atualizadoPor || raw.atualizadoPorId || criadoPor);
  const deviceId = String(raw.deviceId || getDeviceId());
  const operationId = String(raw.operationId || generateOperationId());

  return {
    // Campos locais do aplicativo (compatibilidade total com views existentes)
    id: stableId,
    codigo_interno: codInterno,
    digito: dig,
    codigo_exibicao: codExibicao,
    descricao_produto: desc,
    embalagem: embalagem,
    fator_embalagem: raw.fator_embalagem,
    data_validade: dataVenc,
    quantidade_total_unidades: qtd,
    observacao: raw.observacao,
    lote_identificador: raw.lote_identificador,
    criado_em: createdAt,
    atualizado_em: updatedAt,
    status_customizado: status as any,
    enviar_ao_comprador: enviarComprador,
    preco_normal: precoNormal,
    precoNormal: precoNormal,
    preco_trabalhado: preco,
    precoTrabalhado: preco,
    data_preco: raw.data_preco,
    origem: raw.origem || 'MANUAL',
    saeou060_id: raw.saeou060_id,
    arquivo_origem: raw.arquivo_origem,
    criadoPorTipo: raw.criadoPorTipo || 'PRINCIPAL',
    criadoPorId: raw.criadoPorId || criadoPor,
    atualizadoPorTipo: raw.atualizadoPorTipo || 'PRINCIPAL',
    atualizadoPorId: raw.atualizadoPorId || atualizadoPor,

    // Campos centrais requeridos para sincronização multi-dispositivo
    vencimentoId: stableId,
    filialId: filial,
    codigoInterno: codInterno,
    descricao: desc,
    dataVencimento: dataVenc,
    quantidade: qtd,
    enviarParaComprador: enviarComprador,
    status: status,
    createdAt: createdAt,
    updatedAt: updatedAt,
    deletedAt: deletedAt,
    isDeleted: isDeleted,
    version: version,
    criadoPor: criadoPor,
    atualizadoPor: atualizadoPor,
    deviceId: deviceId,
    operationId: operationId,
  };
}

/**
 * Converte um LoteVencimento no payload exato esperado pela coleção central 'vencimentos' do Firestore
 */
export function buildVencimentoCentralPayload(lote: LoteVencimento, operationId?: string): Record<string, any> {
  const norm = normalizeVencimentoRecord(lote);
  const opId = operationId || norm.operationId || generateOperationId();
  const devId = norm.deviceId || getDeviceId();

  const payload: Record<string, any> = {
    vencimentoId: norm.vencimentoId,
    id: norm.vencimentoId, // compatibilidade
    filialId: norm.filialId || FILIAL_PADRAO,
    codigoInterno: norm.codigoInterno,
    codigo_interno: norm.codigo_interno,
    digito: norm.digito,
    codigo_exibicao: norm.codigo_exibicao,
    descricao: norm.descricao,
    descricao_produto: norm.descricao_produto,
    embalagem: norm.embalagem,
    fator_embalagem: norm.fator_embalagem || null,
    dataVencimento: norm.dataVencimento,
    data_validade: norm.data_validade,
    quantidade: Number(norm.quantidade || 0),
    quantidade_total_unidades: Number(norm.quantidade_total_unidades || 0),
    precoNormal: norm.precoNormal !== undefined ? norm.precoNormal : null,
    preco_normal: norm.preco_normal !== undefined ? norm.preco_normal : null,
    precoTrabalhado: norm.precoTrabalhado !== undefined ? norm.precoTrabalhado : null,
    preco_trabalhado: norm.preco_trabalhado !== undefined ? norm.preco_trabalhado : null,
    data_preco: norm.data_preco || null,
    enviarParaComprador: Boolean(norm.enviarParaComprador),
    enviar_ao_comprador: Boolean(norm.enviar_ao_comprador),
    status: norm.status || 'PENDENTE',
    status_customizado: norm.status_customizado || 'PENDENTE',
    createdAt: norm.createdAt,
    criado_em: norm.criado_em,
    updatedAt: norm.updatedAt,
    atualizado_em: norm.atualizado_em,
    deletedAt: norm.deletedAt || null,
    isDeleted: Boolean(norm.isDeleted),
    version: Number(norm.version || 1),
    criadoPor: norm.criadoPor,
    atualizadoPor: norm.atualizadoPor,
    deviceId: devId,
    operationId: opId,
    origem: norm.origem || 'MANUAL',
    observacao: norm.observacao || null,
    lote_identificador: norm.lote_identificador || null,
  };

  // Remove undefined
  return cleanForFirestore(payload);
}

/**
 * Remove valores undefined recursivamente para conformidade com o Firestore
 */
export function cleanForFirestore<T extends Record<string, any>>(obj: T): T {
  const clean: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        clean[k] = cleanForFirestore(v);
      } else {
        clean[k] = v;
      }
    }
  }
  return clean;
}
