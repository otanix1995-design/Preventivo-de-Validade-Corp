/**
 * Types and interfaces for Controle de Vencimentos
 */

export type StatusVencimento = 
  | 'NORMAL'
  | 'ATENCAO'
  | 'ALERTA'
  | 'CRITICO'
  | 'SAIDA_INSUFICIENTE'
  | 'ENVIAR_AO_COMPRADOR';

export interface ProdutoSMG {
  id: string; // Unique internal key, usually codigo_interno
  codigo_original: string; // e.g. "00046135-156"
  codigo_interno: string; // e.g. "46135" (leading zeros stripped)
  digito: string; // e.g. "156" or "009" (zeros preserved)
  codigo_exibicao: string; // e.g. "46135-156"
  chave_normalizada?: string; // e.g. "46135-156"
  descricao: string; // e.g. "RF.MARG.QUALY C/SAL"
  embalagem: string; // e.g. "CXA 1 X 6 X 1KG"
  fator_embalagem?: number; // e.g. 6
  unidade_medida?: string; // e.g. "CXA", "UN", "KG"
  
  // Precomputed Search & Gramagem Optimization
  descricaoNormalizada?: string;
  codigoInternoNormalizado?: string;
  codigoCompletoNormalizado?: string;
  gramagemTexto?: string | null;
  gramagemValorBase?: number | null;
  gramagemUnidadeBase?: string | null;
  gramagemChave?: string | null;
  
  // Estoque
  estoque_emb1: number;
  estoque_emb9: number;
  estoque_total: number;
  
  // Vendas
  vendas_qtde_30d: number;
  vendas_preco?: number;
  
  // Histórico e Operacional
  data_ultima_entrada?: string;
  qtde_ultima_entrada?: number;
  dias_sem_venda: number;
  idade: number;
  qtde_ideal?: number;
  
  // Compradores e Setores
  comprador_filial?: string;
  comprador_matriz?: string;
  setor_fisico?: string;
  setor_balanco?: string;
  
  // Pedidos
  pedidos_pendentes?: string | number;
  
  // Vínculos EAN
  eans: string[];
  
  // Metadados
  atualizado_em: string;
  is_demo?: boolean;
}

export interface LoteVencimento {
  id: string;
  codigo_interno: string;
  digito: string;
  codigo_exibicao: string;
  descricao_produto: string;
  embalagem: string;
  fator_embalagem?: number;
  data_validade: string; // YYYY-MM-DD
  quantidade_total_unidades: number;
  observacao?: string;
  lote_identificador?: string;
  criado_em: string;
  atualizado_em: string;
  status_customizado?: StatusVencimento;
  enviar_ao_comprador?: boolean;

  // Auditoria e Origem
  origem?: 'MANUAL' | 'SMGOI013' | 'SAEOU060';
  preco_normal?: number | null; // Preço Normal (DE)
  precoNormal?: number | null;
  preco_trabalhado?: number | null; // Preço de Rebaixe (POR)
  precoTrabalhado?: number | null;
  data_preco?: string;
  saeou060_id?: string;
  arquivo_origem?: string;

  // Rastreabilidade de Operação / Promotores
  criadoPorTipo?: 'PRINCIPAL' | 'PROMOTOR' | 'SISTEMA';
  criadoPorId?: string;
  atualizadoPorTipo?: 'PRINCIPAL' | 'PROMOTOR' | 'SISTEMA';
  atualizadoPorId?: string;

  // Sincronização Central Multi-Dispositivos (Campos Mínimos da Nuvem)
  vencimentoId?: string;
  filialId?: string;
  codigoInterno?: string;
  descricao?: string;
  dataVencimento?: string; // YYYY-MM-DD
  quantidade?: number;
  enviarParaComprador?: boolean;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  isDeleted?: boolean;
  version?: number;
  criadoPor?: string;
  atualizadoPor?: string;
  deviceId?: string;
  operationId?: string;
}

export type StatusSaeou060 =
  | 'NOVO'
  | 'JA_NO_CONTROLE'
  | 'PRECISA_DE_ACAO'
  | 'ULTIMOS_7_DIAS'
  | 'DESCONSIDERADO'
  | 'NAO_LOCALIZADO'
  | 'AGUARDANDO_BASE'
  | 'CONCLUIDO';

export interface RegistroSaeou060 {
  id: string;
  codigo_original: string; // e.g. "00046135" or "46135"
  codigo_interno: string; // e.g. "46135" (leading zeros stripped)
  digito: string; // e.g. "156" or "009" (zeros preserved)
  codigo_exibicao: string; // e.g. "46135-156"
  chave_normalizada?: string;
  descricao?: string;
  embalagem?: string;
  data_vencimento?: string; // YYYY-MM-DD
  data_vencimento_exibicao?: string; // DD/MM/YYYY
  quantidade: number;
  estoque_loja?: number;
  loja?: string;
  data_movimento?: string; // e.g. "03/09/2026" or "2026-09-03"
  data_cadastro?: string;
  periodo_vencimento?: string;
  promotor?: string;
  preco_normal?: number;
  precoNormal?: number;
  preco_trabalhado?: number;
  precoTrabalhado?: number;
  data_preco?: string;
  observacao?: string;
  status_saeou: StatusSaeou060;

  // Auditoria
  origem: 'SAEOU060';
  arquivo_origem: string;
  data_importacao: string;
  hora_importacao: string;
  data_primeira_aparicao?: string;
  adicionado_ao_controle_em?: string;
  vencimento_id_vinculado?: string;
  motivo_desconsiderado?: string;
  desconsiderado_em?: string;
  trabalhado_em?: string;
}

export interface VinculoEan {
  id: string;
  codigo_interno: string;
  digito?: string;
  ean: string;
  descricao?: string;
  status_vinculo: 'VINCULADO' | 'CODIGO_NAO_ENCONTRADO' | 'DUPLICADO' | 'INVALIDO' | 'AGUARDANDO_BASE';
  criado_em: string;
}

export interface DivergenciaRegistro {
  id: string;
  tipo:
    | 'ESTOQUE_DIVERGENTE'
    | 'EAN_NAO_ENCONTRADO'
    | 'DUPLICIDADE_EAN'
    | 'EAN_DUPLICADO'
    | 'MERCADORIA_SEM_GIRO'
    | 'CODIGO_INVALIDO'
    | 'CODIGO_NAO_ENCONTRADO'
    | 'ESTOQUE_NEGATIVO'
    | 'VENDA_NEGATIVA'
    | 'EMBALAGEM_NAO_INTERPRETADA'
    | 'DADOS_INCONSISTENTES'
    | 'SAEOU060_DIVERGENCIA'
    | 'OUTRO';
  origem?: 'SMGOI013' | 'VINCULOS_EAN' | 'VENCIMENTO' | 'SAEOU060' | 'MANUAL';
  codigo_interno?: string;
  identificador?: string;
  descricao?: string;
  descricao_problema?: string;
  impacto?: 'BAIXO' | 'MEDIO' | 'ALTO';
  status?: 'ABERTA' | 'RESOLVIDA';
  detalhes?: string;
  data_registro: string;
}

export interface ResumoImportacao {
  id?: string;
  tipo: 'SMGOI013' | 'VINCULOS_EAN' | 'SAEOU060';
  data_hora: string;
  total_lidos: number;
  total_atualizados: number;
  total_novos: number;
  total_erros: number;
  total_ignorados: number;
  nome_arquivo: string;
  total_localizados?: number;
  total_nao_localizados?: number;
  total_aguardando_base?: number;
  total_ja_no_controle?: number;
  detalhes_erros?: string[];
}

export interface MetadadosBase {
  filial_numero: string;
  filial_nome: string;
  ultima_atualizacao_smgoi013?: string;
  ultima_atualizacao_eans?: string;
  ultima_atualizacao_saeou060?: string;
  status_base: 'SMGOI013' | 'DEMO' | 'VAZIA';
  total_produtos: number;
  total_vencimentos: number;
  total_eans: number;
  total_saeou060?: number;
  catalogo_version?: number;
  vinculos_version?: number;
  saeou060_version?: number;
}

export interface ProjecaoVencimento {
  dias_restantes: number;
  media_diaria_30d: number;
  saida_projetada: number;
  sobra_projetada: number;
  status: StatusVencimento;
  motivo_alerta: string;
  alerta_dias_sem_venda: boolean;
  grau_risco: 'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO';
}

// ==========================================
// MÓDULO DE PROMOTORES - FASE 1
// ==========================================

export type StatusPromotor = 'ATIVO' | 'BLOQUEADO' | 'DESVINCULADO' | 'PENDENTE_VINCULO';

export interface PermissoesPromotor {
  consultarProduto: boolean;
  escanearEAN: boolean;
  cadastrarVencimento: boolean;
  atualizarQuantidade: boolean;
  visualizarPendencias: boolean;
  enviarAoComprador: boolean;
  visualizarHistorico: boolean;
}

export const PERMISSOES_PADRAO_PROMOTOR: PermissoesPromotor = {
  consultarProduto: true,
  escanearEAN: true,
  cadastrarVencimento: true,
  atualizarQuantidade: true,
  visualizarPendencias: true,
  enviarAoComprador: true,
  visualizarHistorico: true,
};

export interface DispositivoVinculado {
  dispositivoId: string;
  dispositivoNome: string;
  dataPrimeiroVinculo: string;
  ultimoAcesso: string;
}

export interface Promotor {
  promotorId: string;
  nome: string;
  agenciaNome: string;
  matricula?: string;
  filialId: string;
  filialNome: string;
  setores: string[]; // ["FRIOS"], ["LOJA"], ou ["FRIOS", "LOJA"]
  setorId?: string; // Mantido para compatibilidade retroativa
  setorNome?: string; // Mantido para compatibilidade retroativa
  status: StatusPromotor;
  permissoes: PermissoesPromotor;
  dispositivoVinculado?: DispositivoVinculado | null;
  dataCadastro: string; // ISO
  dataVinculo?: string | null; // ISO
  ultimoAcesso?: string | null; // ISO
  ultimaSincronizacao?: string | null; // ISO
  criadoPor: string;
  atualizadoPor: string;
}

export type StatusVinculo = 'AGUARDANDO' | 'UTILIZADO' | 'EXPIRADO' | 'CANCELADO';

export interface VinculoPromotor {
  vinculoId: string;
  promotorId: string;
  promotorNome: string;
  agenciaNome: string;
  filialId: string;
  filialNome: string;
  setores: string[]; // ["FRIOS"], ["LOJA"], ou ["FRIOS", "LOJA"]
  setorId?: string;
  setorNome?: string;
  permissoes?: PermissoesPromotor;
  codigoVinculo: string; // 6 dígitos numéricos
  tokenVinculo: string; // Token único / linkTokenId
  dataCriacao: string; // ISO
  dataExpiracao: string; // ISO (+30 minutos)
  status: StatusVinculo;
  dispositivoId?: string | null;
  dispositivoNome?: string | null;
  dataUtilizacao?: string | null;
}

export type TipoAcaoAuditoria =
  | 'CONSULTOU_PRODUTO'
  | 'CADASTROU_VENCIMENTO'
  | 'EDITOU_VENCIMENTO'
  | 'EXCLUIU_VENCIMENTO'
  | 'ATUALIZOU_QUANTIDADE'
  | 'ENVIOU_COMPRADOR'
  | 'REMOVEU_ENVIO_COMPRADOR'
  | 'SINCRONIZOU_ALTERACAO'
  | 'APROVOU_SOLICITACAO_PROMOTOR'
  | 'RECUSOU_SOLICITACAO_PROMOTOR';

export type StatusSincronizacaoAuditoria = 'SINCRONIZADO' | 'PENDENTE' | 'ERRO';

export interface RegistroAuditoriaPromotor {
  auditoriaId: string;
  promotorId: string;
  promotorNome: string;
  agenciaNome?: string;
  filialId: string;
  setores?: string[];
  setorId?: string;
  tipoAcao: TipoAcaoAuditoria;
  produtoId?: string;
  codigoInterno?: string;
  digito?: string;
  descricao?: string;
  valorAnterior?: string;
  valorNovo?: string;
  dataHora: string; // ISO
  dispositivoId?: string;
  statusSincronizacao: StatusSincronizacaoAuditoria;
  operationId?: string;
}

export type StatusOperacaoSync = 'PROCESSADO' | 'IGNORADO_DUPLICADO' | 'ERRO' | 'PENDENTE';

export interface OperacaoPromotorSync {
  operationId: string;
  promotorId: string;
  tipoAcao: TipoAcaoAuditoria;
  payload: any;
  dataHora: string;
  processado: boolean;
  processadoEm?: string;
  status: StatusOperacaoSync;
  mensagemErro?: string;
}

export type SetorPromotor = 'FRIOS' | 'LOJA';

export interface SetorItem {
  id: SetorPromotor;
  nome: string;
}

export const SETORES_DISPONIVEIS: SetorItem[] = [
  { id: 'FRIOS', nome: 'Frios' },
  { id: 'LOJA', nome: 'Loja' },
];

export function getPromotorSetores(p?: Partial<Promotor> | null): SetorPromotor[] {
  if (!p) return ['FRIOS'];
  if (Array.isArray(p.setores) && p.setores.length > 0) {
    const list = p.setores
      .map((s) => s.toUpperCase() as SetorPromotor)
      .filter((s) => s === 'FRIOS' || s === 'LOJA');
    return list.length > 0 ? list : ['FRIOS'];
  }
  if (p.setorId) {
    const sId = p.setorId.toUpperCase();
    if (sId === 'AMBOS') return ['FRIOS', 'LOJA'];
    if (sId === 'LOJA') return ['LOJA'];
    return ['FRIOS'];
  }
  return ['FRIOS'];
}

export function formatarSetoresExibicao(setores?: string[] | null): string {
  if (!setores || setores.length === 0) return 'FRIOS';
  return setores.join(' • ');
}

export interface FilialItem {
  filialId: string;
  filialNome: string;
}

export const FILIAIS_DISPONIVEIS: FilialItem[] = [
  { filialId: '172', filialNome: 'Cascavel' },
];

export type StatusSolicitacaoPromotor = 'PENDENTE_ANALISE' | 'APROVADO' | 'RECUSADO';
export type ResultadoAprovacaoSolicitacao = 'NOVO_VENCIMENTO' | 'QUANTIDADE_ATUALIZADA';

export interface SolicitacaoVencimentoPromotor {
  id: string;
  solicitacaoId?: string;
  filialId: string;
  codigoInterno: string;
  digito: string;
  codigoCompleto?: string;
  descricao: string;
  embalagem?: string;
  fator_embalagem?: number;
  unidade_medida?: string;
  ean?: string;
  eans?: string[];
  dataVencimento: string; // YYYY-MM-DD
  quantidadeInformada: number;
  quantidadeCaixas?: number;
  quantidadeUnidades?: number;
  quantidadeTexto?: string;
  setor?: string;
  setorTipo?: 'FRIOS' | 'LOJA' | string;
  promotorId: string;
  promotorNome: string;
  vinculoPromotorId?: string;
  agencia?: string;
  agenciaNome?: string;
  industriaAgencia?: string;
  enviadoEm: string;
  status: StatusSolicitacaoPromotor;
  criadoEm?: string;
  atualizadoEm?: string;

  // Campos de resolução / aprovação
  aprovadoEm?: string;
  aprovadoPor?: string;
  resultadoAprovacao?: ResultadoAprovacaoSolicitacao;
  referenciaVencimento?: string;
  quantidadeAnterior?: number;
  quantidadeAprovada?: number;

  // Campos de recusa
  recusadoEm?: string;
  recusadoPor?: string;
  motivoRecusa?: string;

  // Campos consolidados de análise
  dataAnalise?: string;
  analisadoPor?: string;
}

export interface FiltrosHistoricoPromotor {
  mesAno: string; // 'YYYY-MM', ex: '2026-09'
  promotorId: string; // 'TODOS' ou promotorId
  industriaAgencia: string; // 'TODAS' ou agência
  setor: 'TODOS' | 'FRIOS' | 'LOJA' | string;
  status: 'TODOS' | 'PENDENTE' | 'APROVADO' | 'RECUSADO';
}

export interface ResumoHistoricoPromotor {
  totalEnvios: number;
  aprovados: number;
  recusados: number;
  pendentes: number;
  novosVencimentos: number;
  atualizacoesQuantidade: number;
}

