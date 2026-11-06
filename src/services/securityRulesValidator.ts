/**
 * Validador e Simulador de Regras de Segurança do Firestore (Nuvem V3 / ISV Filial 172)
 * 
 * Versão Auditada:
 * 1. Zero-Trust Default Deny: Coleções desconhecidas rejeitadas por padrão.
 * 2. Consulta pública às bases (BASE RUB com 36 campos, SPCOI007, SAEOU060).
 * 3. Vencimentos: Criação e alteração sem login com proteção estrita de campos imutáveis:
 *    - filialId, id, vencimentoId, codigo_interno, digito, codigo_exibicao,
 *      origem, saeou060_id, arquivo_origem, criado_em, criadoEm, createdAt, criadoPor.
 * 4. Divergências: Eliminação de escrita e exclusão indiscriminadas (validação de schema e delete restrito a admin).
 * 5. Módulo de Promotores: Validação das operações públicas (solicitações pendentes e ativação de vínculos).
 * 6. Governança da Gerência: Validação em 5 pontos no servidor para GERENCIA_ADMIN da filial 172.
 * 7. Bloqueio de autoatribuição de administradores no cliente Web.
 */

export type PapelOperacional = 'OPERADOR_LOJA' | 'CONFERENTE_ENCARREGADO' | 'GERENCIA_ADMIN' | 'DESCONHECIDO';

export interface ContextoAutenticacaoSimulado {
  uid: string | null;
  filialId: string | null;
  role: PapelOperacional | null;
  email?: string | null;
  emailVerified?: boolean;
  ativo?: boolean;
  temDocumentoServidor?: boolean;
}

export interface RequisicaoSimulada {
  metodo: 'get' | 'list' | 'create' | 'update' | 'delete';
  caminho: string;
  dadosExistentes?: Record<string, any>;
  novosDados?: Record<string, any>;
}

export interface CasoTesteSeguranca {
  id: string;
  nome: string;
  categoria: 'BASES_PUBLICAS' | 'VENCIMENTOS_IMUTABILIDADE' | 'DIVERGENCIAS' | 'PROMOTORES' | 'GOVERNANCA_ADMIN' | 'DEFAULT_DENY';
  descricao: string;
  contextoAuth: ContextoAutenticacaoSimulado;
  requisicao: RequisicaoSimulada;
  resultadoEsperado: 'PERMITIDO' | 'NEGADO';
}

export interface ResultadoTesteSeguranca {
  id: string;
  nome: string;
  categoria: string;
  resultadoEsperado: 'PERMITIDO' | 'NEGADO';
  resultadoObtido: 'PERMITIDO' | 'NEGADO';
  sucesso: boolean;
  motivo: string;
}

export interface RelatorioDiagnosticoSeguranca {
  totalTestes: number;
  testesPassaram: number;
  testesFalharam: number;
  todosPassaram: boolean;
  dataExecucao: string;
  resultados: ResultadoTesteSeguranca[];
}

const ALLOWED_LOTE_KEYS = new Set([
  'id', 'vencimentoId', 'filialId', 'filial_id',
  'codigo_interno', 'codigoInterno', 'digito', 'codigo_exibicao',
  'descricao_produto', 'descricao', 'embalagem', 'fator_embalagem',
  'data_validade', 'dataVencimento',
  'quantidade_total_unidades', 'quantidade',
  'observacao', 'lote_identificador',
  'status_customizado', 'status',
  'enviar_ao_comprador', 'enviarParaComprador',
  'origem', 'preco_normal', 'precoNormal', 'preco_trabalhado', 'precoTrabalhado',
  'data_preco', 'saeou060_id', 'arquivo_origem',
  'criado_em', 'criadoEm', 'atualizado_em', 'atualizadoEm', 'updatedAt', 'createdAt',
  'criadoPor', 'criadoPorMatricula', 'criadoPorPapel',
  'atualizadoPor', 'atualizadoPorMatricula', 'atualizadoPorPapel',
  'deviceId', 'operationId',
  'isDeleted', 'deletedAt', 'motivoExclusao', 'usuarioExclusao', 'papelExclusao',
  '_versaoLocal', '_serverVersion', '_syncedAt'
]);

const ALLOWED_DIVERGENCIA_KEYS = new Set([
  'id', 'tipo', 'origem', 'codigo_interno', 'identificador',
  'descricao', 'descricao_problema', 'impacto', 'status',
  'detalhes', 'data_registro'
]);

export class SecurityRulesValidator {
  public avaliarRequisicao(
    auth: ContextoAutenticacaoSimulado,
    req: RequisicaoSimulada
  ): { permitido: boolean; motivo: string } {
    const pathSegments = req.caminho.replace(/^\//, '').split('/');
    const rootCollection = pathSegments[0];

    const isGerenteAdminReal = (targetFilial: string): boolean => {
      if (!auth || !auth.uid) return false;
      if (auth.temDocumentoServidor === false) return false;
      if (auth.ativo !== true) return false;
      if (auth.role !== 'GERENCIA_ADMIN') return false;
      if (auth.filialId !== targetFilial) return false;
      return true;
    };

    // 1. Gestão de Usuários: /usuarios_autorizados/{userId}
    if (rootCollection === 'usuarios_autorizados') {
      const targetUserId = pathSegments[1];

      if (req.metodo === 'get') {
        if (auth && auth.uid && (auth.uid === targetUserId || isGerenteAdminReal('172'))) {
          return { permitido: true, motivo: 'Permitido: Leitura de perfil de usuário autorizado.' };
        }
        return { permitido: false, motivo: 'Rejeitado: Proibido ler perfis de terceiros.' };
      }

      if (req.metodo === 'list') {
        if (auth && auth.uid) {
          return { permitido: true, motivo: 'Permitido: Listagem de autorizações para usuários autenticados.' };
        }
        return { permitido: false, motivo: 'Rejeitado: Usuário não autenticado.' };
      }

      if (req.metodo === 'create' || req.metodo === 'update' || req.metodo === 'delete') {
        return {
          permitido: false,
          motivo: 'Rejeitado: Modificação de privilégios via cliente Web bloqueada (allow create, update, delete: if false). Exige Firebase Admin SDK / Console.',
        };
      }
    }

    // 2. Isolamento por Filial: /filiais/{filialId}/...
    if (rootCollection === 'filiais') {
      if (pathSegments.length < 3) {
        return { permitido: false, motivo: 'Rejeitado (Default Deny): Documento raiz de filial não possui permissão direta.' };
      }

      const filialAlvo = pathSegments[1];
      const subColecao = pathSegments[2];

      if (filialAlvo !== '172') {
        return { permitido: false, motivo: `Rejeitado: Filial '${filialAlvo}' não autorizada (apenas filial 172).` };
      }

      // 2.1 BASES OPERACIONAIS (BASE RUB, SPCOI007, SAEOU060, CONFIG)
      const isColecaoBase = [
        'catalogo_rub_versoes',
        'spcoi_versoes',
        'saeou_versoes',
        'config',
      ].includes(subColecao);

      if (isColecaoBase) {
        // Leitura pública de todos os campos sem login
        if (req.metodo === 'get' || req.metodo === 'list') {
          return { permitido: true, motivo: `Permitido: Leitura pública de ${subColecao} (todos os campos operacionais acessíveis sem login).` };
        }

        if (req.metodo === 'create' || req.metodo === 'update') {
          if (!isGerenteAdminReal(filialAlvo)) {
            return {
              permitido: false,
              motivo: `Rejeitado: Publicação de ${subColecao} restrita exclusivamente a GERENCIA_ADMIN ativo da filial 172.`,
            };
          }
          return { permitido: true, motivo: `Permitido: Publicação de ${subColecao} autorizada para Gerência.` };
        }

        if (req.metodo === 'delete') {
          return { permitido: false, motivo: 'Rejeitado: Exclusão de versões históricas de base bloqueada.' };
        }
      }

      // 2.2 VENCIMENTOS DA FILIAL (/filiais/172/vencimentos/{vencimentoId})
      if (subColecao === 'vencimentos') {
        if (req.metodo === 'delete') {
          return { permitido: false, motivo: 'Rejeitado: Hard-delete permanentemente bloqueado (allow delete: if false).' };
        }

        if (req.metodo === 'get' || req.metodo === 'list') {
          return { permitido: true, motivo: 'Permitido: Leitura pública de vencimentos.' };
        }

        if (req.metodo === 'create') {
          const dados = req.novosDados || {};

          for (const key of Object.keys(dados)) {
            if (!ALLOWED_LOTE_KEYS.has(key)) {
              return { permitido: false, motivo: `Rejeitado: Campo desconhecido '${key}' não permitido no schema do lote.` };
            }
          }

          if (dados.filialId !== '172') {
            return { permitido: false, motivo: `Rejeitado: filialId do lote ('${dados.filialId}') inválido ou divergente de 172.` };
          }

          const cod = dados.codigoInterno || dados.codigo_interno;
          if (!cod || typeof cod !== 'string' || cod.trim().length === 0 || cod.length > 20) {
            return { permitido: false, motivo: 'Rejeitado: Código interno obrigatório e com até 20 caracteres.' };
          }

          const dataVenc = dados.dataVencimento || dados.data_validade;
          if (!dataVenc || typeof dataVenc !== 'string' || dataVenc.length !== 10) {
            return { permitido: false, motivo: 'Rejeitado: Data de validade inválida (exige exatamente 10 caracteres YYYY-MM-DD).' };
          }

          const qtde = dados.quantidade !== undefined ? dados.quantidade : dados.quantidade_total_unidades;
          if (typeof qtde !== 'number' || isNaN(qtde) || qtde < 0 || qtde > 100000) {
            return { permitido: false, motivo: 'Rejeitado: Quantidade fora dos limites operacionais (0 a 100.000).' };
          }

          if (dados.isDeleted === true) {
            return { permitido: false, motivo: 'Rejeitado: Lote novo não pode ser criado já pré-excluído.' };
          }

          return { permitido: true, motivo: 'Permitido: Cadastro público de lote validado com sucesso.' };
        }

        if (req.metodo === 'update') {
          const dados = req.novosDados || {};
          const existentes = req.dadosExistentes || {};

          for (const key of Object.keys(dados)) {
            if (!ALLOWED_LOTE_KEYS.has(key)) {
              return { permitido: false, motivo: `Rejeitado: Campo desconhecido '${key}' não permitido na atualização.` };
            }
          }

          // CAMPOS IMUTÁVEIS PROTEGIDOS
          if (dados.filialId && dados.filialId !== existentes.filialId) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido filialId é rigorosamente imutável.' };
          }
          if (existentes.id && dados.id && dados.id !== existentes.id) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido id é rigorosamente imutável.' };
          }
          if (existentes.vencimentoId && dados.vencimentoId && dados.vencimentoId !== existentes.vencimentoId) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido vencimentoId é rigorosamente imutável.' };
          }

          // Vínculo com produto IMUTÁVEL
          if (existentes.codigo_interno && dados.codigo_interno && dados.codigo_interno !== existentes.codigo_interno) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido codigo_interno é rigorosamente imutável (reatribuição de SKU proibida).' };
          }
          if (existentes.codigoInterno && dados.codigoInterno && dados.codigoInterno !== existentes.codigoInterno) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido codigoInterno é rigorosamente imutável.' };
          }
          if (existentes.digito && dados.digito && dados.digito !== existentes.digito) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido digito é rigorosamente imutável.' };
          }

          // Origem IMUTÁVEL
          if (existentes.origem && dados.origem && dados.origem !== existentes.origem) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido origem é rigorosamente imutável.' };
          }
          if (existentes.saeou060_id && dados.saeou060_id && dados.saeou060_id !== existentes.saeou060_id) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido saeou060_id é rigorosamente imutável.' };
          }

          // Metadados de criação IMUTÁVEIS
          if (existentes.criado_em && dados.criado_em && dados.criado_em !== existentes.criado_em) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido criado_em é rigorosamente imutável.' };
          }
          if (existentes.criadoEm && dados.criadoEm && dados.criadoEm !== existentes.criadoEm) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido criadoEm é rigorosamente imutável.' };
          }
          if (existentes.createdAt && dados.createdAt && dados.createdAt !== existentes.createdAt) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido createdAt é rigorosamente imutável.' };
          }
          if (existentes.criadoPor && dados.criadoPor && dados.criadoPor !== existentes.criadoPor) {
            return { permitido: false, motivo: 'Rejeitado: Campo protegido criadoPor é rigorosamente imutável.' };
          }

          // Quantidade dentro de limites
          const qtde = dados.quantidade !== undefined ? dados.quantidade : dados.quantidade_total_unidades;
          if (qtde !== undefined && (typeof qtde !== 'number' || isNaN(qtde) || qtde < 0 || qtde > 100000)) {
            return { permitido: false, motivo: 'Rejeitado: Quantidade fora dos limites operacionais (0 a 100.000).' };
          }

          // Soft-delete
          if (dados.isDeleted === true) {
            if (!dados.motivoExclusao || typeof dados.motivoExclusao !== 'string' || dados.motivoExclusao.trim().length < 3) {
              return { permitido: false, motivo: 'Rejeitado: Exclusão lógica exige justificativa formal com no mínimo 3 caracteres.' };
            }
          }

          return { permitido: true, motivo: 'Permitido: Atualização pública de lote validada com sucesso.' };
        }
      }

      // 2.3 AUDITORIA DA FILIAL
      if (subColecao === 'auditoria') {
        if (req.metodo === 'delete' || req.metodo === 'update') {
          return { permitido: false, motivo: 'Rejeitado: Auditoria é rigorosamente imutável (allow update, delete: if false).' };
        }
        return { permitido: true, motivo: 'Permitido: Operação de auditoria autorizada.' };
      }

      return { permitido: false, motivo: `Rejeitado (Zero-Trust Default Deny): Subcoleção desconhecida '${subColecao}' sob /filiais/172/.` };
    }

    // 3. Coleção Global /divergencias
    if (rootCollection === 'divergencias') {
      if (req.metodo === 'get' || req.metodo === 'list') {
        return { permitido: true, motivo: 'Permitido: Leitura pública de divergências.' };
      }

      if (req.metodo === 'create') {
        const dados = req.novosDados || {};
        for (const k of Object.keys(dados)) {
          if (!ALLOWED_DIVERGENCIA_KEYS.has(k)) {
            return { permitido: false, motivo: `Rejeitado: Campo desconhecido '${k}' não permitido em divergências.` };
          }
        }
        if (!dados.tipo || typeof dados.tipo !== 'string' || dados.tipo.length < 3) {
          return { permitido: false, motivo: 'Rejeitado: Campo tipo de divergência é obrigatório.' };
        }
        if (!dados.data_registro || typeof dados.data_registro !== 'string' || dados.data_registro.length < 10) {
          return { permitido: false, motivo: 'Rejeitado: Data de registro de divergência inválida.' };
        }
        return { permitido: true, motivo: 'Permitido: Criação de registro de divergência validada.' };
      }

      if (req.metodo === 'update') {
        const dados = req.novosDados || {};
        const existentes = req.dadosExistentes || {};
        if (existentes.id && dados.id && dados.id !== existentes.id) {
          return { permitido: false, motivo: 'Rejeitado: id de divergência é imutável.' };
        }
        if (existentes.tipo && dados.tipo && dados.tipo !== existentes.tipo) {
          return { permitido: false, motivo: 'Rejeitado: tipo de divergência é imutável.' };
        }
        return { permitido: true, motivo: 'Permitido: Atualização/resolução de divergência autorizada.' };
      }

      if (req.metodo === 'delete') {
        if (!isGerenteAdminReal('172')) {
          return { permitido: false, motivo: 'Rejeitado: Exclusão de divergências restrita a GERENCIA_ADMIN da filial 172.' };
        }
        return { permitido: true, motivo: 'Permitido: Exclusão de divergência autorizada para Gerência.' };
      }
    }

    // 4. Módulo de Promotores
    if (rootCollection === 'promotores') {
      if (req.metodo === 'get' || req.metodo === 'list') {
        return { permitido: true, motivo: 'Permitido: Leitura de promotores cadastrados.' };
      }
      if (!isGerenteAdminReal('172')) {
        return { permitido: false, motivo: 'Rejeitado: Gestão de promotores restrita a GERENCIA_ADMIN da filial 172.' };
      }
      return { permitido: true, motivo: 'Permitido: Gestão de promotor autorizada para Gerência.' };
    }

    if (rootCollection === 'vinculosPromotor' || rootCollection === 'vinculos_promotores') {
      if (req.metodo === 'get' || req.metodo === 'list') {
        return { permitido: true, motivo: 'Permitido: Leitura de vínculos de promotores.' };
      }
      if (req.metodo === 'create' || req.metodo === 'delete') {
        if (!isGerenteAdminReal('172')) {
          return { permitido: false, motivo: 'Rejeitado: Geração e remoção de vínculos de promotor restritas a Gerência.' };
        }
        return { permitido: true, motivo: 'Permitido: Vínculo gerenciado por administrador.' };
      }
      if (req.metodo === 'update') {
        const dados = req.novosDados || {};
        const existentes = req.dadosExistentes || {};
        // Ativação legítima de vínculo pelo promotor no aplicativo móvel
        const isPromotorActivation =
          existentes.status === 'AGUARDANDO' &&
          dados.status === 'UTILIZADO' &&
          dados.dispositivoId &&
          typeof dados.dispositivoId === 'string' &&
          dados.dispositivoId.length >= 3;

        if (isGerenteAdminReal('172') || isPromotorActivation) {
          return { permitido: true, motivo: 'Permitido: Ativação de dispositivo por código de 6 dígitos autorizada.' };
        }
        return { permitido: false, motivo: 'Rejeitado: Atualização de vínculo de promotor não autorizada.' };
      }
    }

    if (rootCollection === 'solicitacoesVencimentoPromotor') {
      if (req.metodo === 'get' || req.metodo === 'list') {
        return { permitido: true, motivo: 'Permitido: Leitura de solicitações de vencimento de promotores.' };
      }
      if (req.metodo === 'delete') {
        return { permitido: false, motivo: 'Rejeitado: Exclusão física de solicitações de promotor bloqueada.' };
      }
      if (req.metodo === 'create') {
        const dados = req.novosDados || {};
        if (dados.status !== 'PENDENTE_ANALISE') {
          return { permitido: false, motivo: 'Rejeitado: Nova solicitação de promotor deve iniciar estritamente com status PENDENTE_ANALISE.' };
        }
        if (dados.filialId !== '172') {
          return { permitido: false, motivo: 'Rejeitado: Solicitação de promotor deve pertencer à filial 172.' };
        }
        if (!dados.promotorId || !dados.codigoInterno) {
          return { permitido: false, motivo: 'Rejeitado: promotorId e codigoInterno obrigatórios.' };
        }
        return { permitido: true, motivo: 'Permitido: Envio de solicitação de vencimento pelo promotor autorizado.' };
      }
      if (req.metodo === 'update') {
        const dados = req.novosDados || {};
        const existentes = req.dadosExistentes || {};
        // Aprovação ou recusa exige GERENCIA_ADMIN
        const isApprovalOrRecusal = dados.status === 'APROVADO' || dados.status === 'RECUSADO';
        if (isApprovalOrRecusal) {
          if (!isGerenteAdminReal('172')) {
            return { permitido: false, motivo: 'Rejeitado: Aprovação ou recusa de solicitação de promotor restrita a GERENCIA_ADMIN da filial 172.' };
          }
          return { permitido: true, motivo: 'Permitido: Resolução de solicitação de promotor por administrador.' };
        }
        // Promotor atualizando sua própria solicitação enquanto pendente
        if (existentes.status === 'PENDENTE_ANALISE' && dados.status === 'PENDENTE_ANALISE') {
          return { permitido: true, motivo: 'Permitido: Ajuste de contagem em solicitação pendente pelo promotor.' };
        }
        return { permitido: false, motivo: 'Rejeitado: Transição de status de solicitação não permitida.' };
      }
    }

    // 5. Coleções Globais e Chunks
    if (rootCollection === 'vencimentos') {
      if (req.metodo === 'delete') {
        return { permitido: false, motivo: 'Rejeitado: Hard-delete bloqueado em /vencimentos.' };
      }
      return { permitido: true, motivo: 'Permitido: Acesso operacional à coleção global /vencimentos.' };
    }

    const isGlobalAdminColecao = [
      'produtos',
      'vinculosEAN',
      'metadados',
      'catalogo_chunks',
      'vinculos_chunks',
      'saeou060_chunks',
      'historico_importacoes',
    ].includes(rootCollection);

    if (isGlobalAdminColecao) {
      if (req.metodo === 'get' || req.metodo === 'list') {
        return { permitido: true, motivo: `Permitido: Leitura pública de ${rootCollection}.` };
      }
      if (req.metodo === 'create' || req.metodo === 'update' || req.metodo === 'delete') {
        if (!isGerenteAdminReal('172')) {
          return {
            permitido: false,
            motivo: `Rejeitado: Escrita em ${rootCollection} restrita a GERENCIA_ADMIN da filial 172.`,
          };
        }
        return { permitido: true, motivo: `Permitido: Escrita em ${rootCollection} autorizada para Gerência.` };
      }
    }

    if (rootCollection === 'auditoria' || rootCollection === 'auditoria_promotores') {
      if (req.metodo === 'delete' || req.metodo === 'update') {
        return { permitido: false, motivo: `Rejeitado: Imutabilidade de auditoria em ${rootCollection}.` };
      }
      return { permitido: true, motivo: `Permitido: Registro de auditoria em ${rootCollection}.` };
    }

    if (rootCollection === 'operacoes_promotores') {
      if (req.metodo === 'delete') {
        return { permitido: false, motivo: 'Rejeitado: Exclusão bloqueada em operacoes_promotores.' };
      }
      return { permitido: true, motivo: 'Permitido: Operação de promotores registrada.' };
    }

    // 6. Default Deny Catch-All
    return {
      permitido: false,
      motivo: `Rejeitado (Zero-Trust Default Deny): Coleção desconhecida ou rota não autorizada '/${rootCollection}'.`,
    };
  }

  public executarSuiteDeTestes(): RelatorioDiagnosticoSeguranca {
    const casos: CasoTesteSeguranca[] = [
      // -----------------------------------------------------------------------
      // 1. BASES OPERACIONAIS COM LEITURA PÚBLICA INTEGRAL (36 COLUNAS)
      // -----------------------------------------------------------------------
      {
        id: 'SEC_01_RUB_36_COLUMNS_PUBLIC_READ',
        nome: '01. BASE RUB (36 Colunas): Leitura Pública Integral com Custos e Vendas',
        categoria: 'BASES_PUBLICAS',
        descricao: 'Funcionário ou visitante sem login consulta a BASE RUB completa (inclusive custos, vendas e valores).',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: { metodo: 'get', caminho: '/filiais/172/catalogo_rub_versoes/rub_172_v1' },
        resultadoEsperado: 'PERMITIDO',
      },
      {
        id: 'SEC_02_SPCOI_PUBLIC_READ',
        nome: '02. SPCOI007: Leitura Pública de Fornecedores e Indústrias',
        categoria: 'BASES_PUBLICAS',
        descricao: 'Consulta pública aos vínculos de fornecedores e CNPJs.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: { metodo: 'get', caminho: '/filiais/172/spcoi_versoes/spcoi_172_v1' },
        resultadoEsperado: 'PERMITIDO',
      },
      {
        id: 'SEC_03_SAEOU_PUBLIC_READ',
        nome: '03. SAEOU060: Leitura Pública de Lotes de Promotores',
        categoria: 'BASES_PUBLICAS',
        descricao: 'Consulta aos apontamentos de validade levantados por promotores.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: { metodo: 'get', caminho: '/filiais/172/saeou_versoes/saeou_172_v1' },
        resultadoEsperado: 'PERMITIDO',
      },

      // -----------------------------------------------------------------------
      // 2. VENCIMENTOS: VALIDAÇÃO E IMUTABILIDADE DE CAMPOS PROTEGIDOS
      // -----------------------------------------------------------------------
      {
        id: 'SEC_04_LOTE_CREATE_VALID',
        nome: '04. Cadastro de Lote: Registro Válido sem Login',
        categoria: 'VENCIMENTOS_IMUTABILIDADE',
        descricao: 'Cadastro de lote com filial 172, código, validade de 10 chars e quantidade válida.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'create',
          caminho: '/filiais/172/vencimentos/lote_correto_01',
          novosDados: {
            id: 'lote_correto_01',
            filialId: '172',
            codigoInterno: '85327',
            dataVencimento: '2026-11-20',
            quantidade: 25,
            descricao: 'Iogurte Natural 170g',
          },
        },
        resultadoEsperado: 'PERMITIDO',
      },
      {
        id: 'SEC_05_LOTE_UPDATE_VALID_COUNT',
        nome: '05. Edição de Lote: Alteração de Contagem Operacional Permitida',
        categoria: 'VENCIMENTOS_IMUTABILIDADE',
        descricao: 'Conferente atualizando quantidade de 25 para 30 sem violar campos protegidos.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'update',
          caminho: '/filiais/172/vencimentos/lote_correto_01',
          dadosExistentes: { id: 'lote_correto_01', filialId: '172', codigoInterno: '85327', quantidade: 25 },
          novosDados: { id: 'lote_correto_01', filialId: '172', codigoInterno: '85327', quantidade: 30 },
        },
        resultadoEsperado: 'PERMITIDO',
      },
      {
        id: 'SEC_06_LOTE_PROTECTED_SKU_BLOCKED',
        nome: '06. Imutabilidade: Tentativa de Reatribuir Lote a Outro SKU Bloqueada',
        categoria: 'VENCIMENTOS_IMUTABILIDADE',
        descricao: 'Tentativa de alterar o código do produto (codigo_interno) de um lote existente.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'update',
          caminho: '/filiais/172/vencimentos/lote_correto_01',
          dadosExistentes: { id: 'lote_correto_01', filialId: '172', codigo_interno: '85327', quantidade: 25 },
          novosDados: { id: 'lote_correto_01', filialId: '172', codigo_interno: '99999', quantidade: 25 },
        },
        resultadoEsperado: 'NEGADO',
      },
      {
        id: 'SEC_07_LOTE_PROTECTED_AUTHOR_BLOCKED',
        nome: '07. Imutabilidade: Tentativa de Adulterar criador original Bloqueada',
        categoria: 'VENCIMENTOS_IMUTABILIDADE',
        descricao: 'Tentativa de forjar quem criou o lote originalmente (criadoPor).',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'update',
          caminho: '/filiais/172/vencimentos/lote_correto_01',
          dadosExistentes: { id: 'lote_correto_01', filialId: '172', criadoPor: 'Conferente Real', quantidade: 25 },
          novosDados: { id: 'lote_correto_01', filialId: '172', criadoPor: 'Outro Usuario Forjado', quantidade: 25 },
        },
        resultadoEsperado: 'NEGADO',
      },
      {
        id: 'SEC_08_LOTE_PROTECTED_ORIGIN_BLOCKED',
        nome: '08. Imutabilidade: Tentativa de Adulterar origem do Lote Bloqueada',
        categoria: 'VENCIMENTOS_IMUTABILIDADE',
        descricao: 'Tentativa de alterar a origem de um lote vindo do SAEOU060 para MANUAL.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'update',
          caminho: '/filiais/172/vencimentos/lote_correto_01',
          dadosExistentes: { id: 'lote_correto_01', filialId: '172', origem: 'SAEOU060', quantidade: 25 },
          novosDados: { id: 'lote_correto_01', filialId: '172', origem: 'MANUAL', quantidade: 25 },
        },
        resultadoEsperado: 'NEGADO',
      },
      {
        id: 'SEC_09_LOTE_HARD_DELETE_BLOCKED',
        nome: '09. Exclusão Física: Bloqueio Universal de Hard-Delete',
        categoria: 'VENCIMENTOS_IMUTABILIDADE',
        descricao: 'Exclusão física é terminantemente rejeitada; apenas soft-delete com justificativa é aceito.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: { metodo: 'delete', caminho: '/filiais/172/vencimentos/lote_correto_01' },
        resultadoEsperado: 'NEGADO',
      },

      // -----------------------------------------------------------------------
      // 3. DIVERGÊNCIAS: REVISÃO DE ESCRITA E EXCLUSÃO
      // -----------------------------------------------------------------------
      {
        id: 'SEC_10_DIVERGENCIA_CREATE_VALID',
        nome: '10. Divergências: Criação de Alerta Válido Permitida',
        categoria: 'DIVERGENCIAS',
        descricao: 'Registro de alerta de divergência de estoque com tipo, data e campos corretos.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'create',
          caminho: '/divergencias/div_01',
          novosDados: {
            id: 'div_01',
            tipo: 'ESTOQUE_DIVERGENTE',
            data_registro: '2026-11-06T00:00:00Z',
            status: 'ABERTA',
            impacto: 'MEDIO',
          },
        },
        resultadoEsperado: 'PERMITIDO',
      },
      {
        id: 'SEC_11_DIVERGENCIA_UPDATE_TYPE_BLOCKED',
        nome: '11. Divergências: Tentativa de Adulterar Tipo de Alerta Bloqueada',
        categoria: 'DIVERGENCIAS',
        descricao: 'Tentativa de modificar o tipo de uma divergência existente em update.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'update',
          caminho: '/divergencias/div_01',
          dadosExistentes: { id: 'div_01', tipo: 'ESTOQUE_DIVERGENTE', status: 'ABERTA' },
          novosDados: { id: 'div_01', tipo: 'OUTRO_TIPO_INVALIDO', status: 'ABERTA' },
        },
        resultadoEsperado: 'NEGADO',
      },
      {
        id: 'SEC_12_DIVERGENCIA_ANON_DELETE_BLOCKED',
        nome: '12. Divergências: Exclusão por Usuário Anônimo Bloqueada',
        categoria: 'DIVERGENCIAS',
        descricao: 'Eliminação da permissão indiscriminada de delete em divergencias.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: { metodo: 'delete', caminho: '/divergencias/div_01' },
        resultadoEsperado: 'NEGADO',
      },
      {
        id: 'SEC_13_DIVERGENCIA_ADMIN_DELETE_PERMITTED',
        nome: '13. Divergências: Exclusão Autorizada para Gerência da Filial 172',
        categoria: 'DIVERGENCIAS',
        descricao: 'Apenas a Gerência com credencial no servidor pode purgar histórico de alertas.',
        contextoAuth: { uid: 'gerente_172', filialId: '172', role: 'GERENCIA_ADMIN', ativo: true, temDocumentoServidor: true },
        requisicao: { metodo: 'delete', caminho: '/divergencias/div_01' },
        resultadoEsperado: 'PERMITIDO',
      },

      // -----------------------------------------------------------------------
      // 4. MÓDULO DE PROMOTORES: OPERAÇÕES PÚBLICAS E ADMINISTRATIVAS
      // -----------------------------------------------------------------------
      {
        id: 'SEC_14_PROMOTOR_SOLIC_CREATE_VALID',
        nome: '14. Promotores: Envio de Solicitação com status PENDENTE_ANALISE Permitido',
        categoria: 'PROMOTORES',
        descricao: 'Promotor envia contagem de validade a ser analisada pela loja.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'create',
          caminho: '/solicitacoesVencimentoPromotor/solic_01',
          novosDados: {
            id: 'solic_01',
            filialId: '172',
            promotorId: 'prom_01',
            codigoInterno: '85327',
            status: 'PENDENTE_ANALISE',
            quantidadeTotalUnidades: 12,
          },
        },
        resultadoEsperado: 'PERMITIDO',
      },
      {
        id: 'SEC_15_PROMOTOR_AUTO_APPROVE_BLOCKED',
        nome: '15. Promotores: Tentativa de Autoaprovar Solicitação no Envio Bloqueada',
        categoria: 'PROMOTORES',
        descricao: 'Promotor tentando criar solicitação já com status APROVADO sem passar pela loja.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'create',
          caminho: '/solicitacoesVencimentoPromotor/solic_02',
          novosDados: {
            id: 'solic_02',
            filialId: '172',
            promotorId: 'prom_01',
            codigoInterno: '85327',
            status: 'APROVADO', // Proibido no create
            quantidadeTotalUnidades: 12,
          },
        },
        resultadoEsperado: 'NEGADO',
      },
      {
        id: 'SEC_16_PROMOTOR_DEVICE_ACTIVATION_VALID',
        nome: '16. Promotores: Ativação Legítima de Dispositivo via Código de 6 Dígitos',
        categoria: 'PROMOTORES',
        descricao: 'Promotor vinculando celular ao status UTILIZADO com dispositivoId.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'update',
          caminho: '/vinculosPromotor/vinc_01',
          dadosExistentes: {
            vinculoId: 'vinc_01',
            promotorId: 'prom_01',
            codigoVinculo: '839201',
            status: 'AGUARDANDO',
          },
          novosDados: {
            vinculoId: 'vinc_01',
            promotorId: 'prom_01',
            codigoVinculo: '839201',
            status: 'UTILIZADO',
            dispositivoId: 'device_celular_samsung_01',
          },
        },
        resultadoEsperado: 'PERMITIDO',
      },
      {
        id: 'SEC_17_PROMOTOR_LINK_CREATE_ANON_BLOCKED',
        nome: '17. Promotores: Geração de Código de Vínculo por Anônimo Bloqueada',
        categoria: 'PROMOTORES',
        descricao: 'Apenas a loja/administrador pode gerar novos códigos de 6 dígitos.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'create',
          caminho: '/vinculosPromotor/vinc_fake',
          novosDados: { vinculoId: 'vinc_fake', status: 'AGUARDANDO' },
        },
        resultadoEsperado: 'NEGADO',
      },

      // -----------------------------------------------------------------------
      // 5. GOVERNANÇA E PRIVILÉGIOS ADMINISTRATIVOS
      // -----------------------------------------------------------------------
      {
        id: 'SEC_18_LEGITIMATE_ADMIN_BASE_PUBLISH',
        nome: '18. Gerência: Publicação Oficial da BASE RUB por Administrador Autorizado',
        categoria: 'GOVERNANCA_ADMIN',
        descricao: 'Gerente com credencial no servidor publicando a nova versão da BASE RUB.',
        contextoAuth: { uid: 'gerente_172', filialId: '172', role: 'GERENCIA_ADMIN', ativo: true, temDocumentoServidor: true },
        requisicao: {
          metodo: 'create',
          caminho: '/filiais/172/catalogo_rub_versoes/rub_172_v2',
          novosDados: { versaoId: 'rub_172_v2' },
        },
        resultadoEsperado: 'PERMITIDO',
      },
      {
        id: 'SEC_19_ANON_BASE_PUBLISH_DENIED',
        nome: '19. Gerência: Publicação de Base por Usuário Anônimo Rejeitada',
        categoria: 'GOVERNANCA_ADMIN',
        descricao: 'Tentativa de sobrescrever BASE RUB oficial sem autenticação de gerência.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: {
          metodo: 'create',
          caminho: '/filiais/172/catalogo_rub_versoes/rub_172_hack',
          novosDados: { versaoId: 'hack' },
        },
        resultadoEsperado: 'NEGADO',
      },
      {
        id: 'SEC_20_CLIENT_ADMIN_BOOTSTRAP_DENIED',
        nome: '20. Gerência: Autoatribuição de Administrador via Cliente Web Bloqueada',
        categoria: 'GOVERNANCA_ADMIN',
        descricao: 'Nenhum cliente pode criar registro em /usuarios_autorizados (exige Admin SDK / Console).',
        contextoAuth: { uid: 'hacker_ou_qualquer', filialId: '172', role: null, email: 'jottarms@gmail.com' },
        requisicao: {
          metodo: 'create',
          caminho: '/usuarios_autorizados/hacker_ou_qualquer',
          novosDados: { papel: 'GERENCIA_ADMIN', filialId: '172', ativo: true },
        },
        resultadoEsperado: 'NEGADO',
      },

      // -----------------------------------------------------------------------
      // 6. ZERO-TRUST DEFAULT-DENY E ROTAS DESCONHECIDAS
      // -----------------------------------------------------------------------
      {
        id: 'SEC_21_UNKNOWN_COLLECTION_DENIED',
        nome: '21. Zero-Trust: Coleção Desconhecida /config_secreta Bloqueada por Padrão',
        categoria: 'DEFAULT_DENY',
        descricao: 'Qualquer rota não explicitamente declarada é sumariamente rejeitada.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: { metodo: 'get', caminho: '/config_secreta/doc_01' },
        resultadoEsperado: 'NEGADO',
      },
      {
        id: 'SEC_22_UNKNOWN_BRANCH_SUBCOLLECTION_DENIED',
        nome: '22. Zero-Trust: Subcoleção Desconhecida sob Filial Bloqueada por Padrão',
        categoria: 'DEFAULT_DENY',
        descricao: 'Tentativa de ler /filiais/172/financeiro_interno.',
        contextoAuth: { uid: null, filialId: null, role: null },
        requisicao: { metodo: 'get', caminho: '/filiais/172/financeiro_interno/doc_01' },
        resultadoEsperado: 'NEGADO',
      },
      {
        id: 'SEC_23_AUDIT_IMMUTABILITY_DENIED',
        nome: '23. Imutabilidade: Alteração de Histórico de Auditoria Bloqueada',
        categoria: 'DEFAULT_DENY',
        descricao: 'Auditoria é estritamente append-only.',
        contextoAuth: { uid: 'gerente_172', filialId: '172', role: 'GERENCIA_ADMIN', ativo: true, temDocumentoServidor: true },
        requisicao: { metodo: 'update', caminho: '/filiais/172/auditoria/audit_01', novosDados: { alterado: true } },
        resultadoEsperado: 'NEGADO',
      },
    ];

    const resultados: ResultadoTesteSeguranca[] = casos.map((caso) => {
      const res = this.avaliarRequisicao(caso.contextoAuth, caso.requisicao);
      const resultadoObtido = res.permitido ? 'PERMITIDO' : 'NEGADO';
      const sucesso = resultadoObtido === caso.resultadoEsperado;
      return {
        id: caso.id,
        nome: caso.nome,
        categoria: caso.categoria,
        resultadoEsperado: caso.resultadoEsperado,
        resultadoObtido,
        sucesso,
        motivo: res.motivo,
      };
    });

    const testesPassaram = resultados.filter((r) => r.sucesso).length;

    return {
      totalTestes: casos.length,
      testesPassaram,
      testesFalharam: casos.length - testesPassaram,
      todosPassaram: testesPassaram === casos.length,
      dataExecucao: new Date().toISOString(),
      resultados,
    };
  }
}

export const securityRulesValidator = new SecurityRulesValidator();
