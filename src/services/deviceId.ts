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

  const preco =
    raw.precoTrabalhado !== undefined
      ? raw.precoTrabalhado
      : raw.preco_trabalhado !== undefined
      ? raw.preco_trabalhado
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
    preco_trabalhado: preco,
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
    precoTrabalhado: preco,
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
