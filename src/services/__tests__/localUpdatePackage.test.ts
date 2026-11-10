/**
 * Suite Automatizada Offline — Sistema de Atualização Local por Arquivo Único (.ZIP)
 * Filial 172 — Cascavel
 *
 * IMPORTANTE: Execução 100% OFFLINE em Node (`npx tsx src/services/__tests__/localUpdatePackage.test.ts`),
 * utilizando binários `.zip` reais (`fflate`), SHA-256 FIPS 180-4 real e adaptadores em memória.
 * Zero leituras ou escritas no Firestore real e zero criação de arquivos temporários em disco.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  FornecedorSPCOI007,
  Industria,
  ProdutoSMG,
  Promotor,
  RegistroPlanilhaIsv,
  RegistroSaeou060,
  VinculoPromotor,
  VinculoPromotorIndustria,
} from '../../types';
import { authRoleService } from '../authRoleService';
import { EstadoAuthServidor } from '../firebaseAuthService';
import {
  classificarDiasSemVenda,
  calcularTotaisClassificacao,
  extrairFornecedorProduto,
  formatarEstoqueColunaUnica,
  obterTop30Mercadorias,
} from '../isvClassificacaoService';
import { isvService } from '../isvService';
import { isModoAtualizacaoLocalAtivo, resetModoAtualizacaoLocalCache, sha256HexBytes, sha256HexText } from '../localPackageMode';
import { LocalPackageDependencies, LocalUpdatePackageService } from '../localUpdatePackageService';
import { nuvemSyncEngine } from '../nuvemSyncEngine';
import { productRepository } from '../productRepository';
import { syncQueueService } from '../syncQueueService';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${msg}`);
  }
}

interface FakeDeviceMemoryState {
  auth: EstadoAuthServidor;
  produtos: ProdutoSMG[];
  registrosOp: RegistroPlanilhaIsv[];
  fornecedores: FornecedorSPCOI007[];
  industrias: Industria[];
  saeou060: RegistroSaeou060[];
  promotores: Promotor[];
  vinculosPI: VinculoPromotorIndustria[];
  vinculosDispositivo: VinculoPromotor[];
  vencimentosCount: number;
  vinculosEanCount: number;
  metaStore: Map<string, any>;
  stagingStore: Map<string, any>;
}

function makeRegistroRub(cod: string, nome: string, dias: number, estoque: number, estoqueTexto?: string): {
  prod: ProdutoSMG;
  reg: RegistroPlanilhaIsv;
} {
  const reg: RegistroPlanilhaIsv = {
    id: cod,
    codigo_original: `00${cod}`,
    codigo_interno: cod,
    digito: '1',
    codigo_exibicao: `${cod}-1`,
    chave_normalizada: `${cod}-1`,
    filial: '172',
    nome,
    complemento: 'UN',
    valor_disponivel: estoque > 0 ? 150.5 : 0,
    valor_disponivel_status: 'VALIDO',
    estoque,
    estoque_original_texto: estoqueTexto || String(estoque).replace('.', ','),
    estoque_formatado_extenso: estoqueTexto || String(estoque),
    valor_indisponivel: 0,
    bloqueio: '',
    transito_entrada: 0,
    estoque_indisponivel: 0,
    dias_sem_venda: dias,
    ultima_venda_data: '01/10/2026',
    ultima_venda_hora: '10:00',
    ultima_venda_formatada: '01/10/2026 às 10:00',
    ultima_compra_data: '15/09/2026',
    ultima_compra_hora: '08:00',
    ultima_compra_formatada: '15/09/2026 às 08:00',
    classe_produto: 'FRIOS E LATICINIOS',
    classe_produto_raiz: 'FRIOS',
    idade: dias + 10,
    pedidos_pendentes: '0',
    venda_30_dias: 0,
    setor_save: 'FRIOS',
    validade_1: '20/11/2026',
    validade_2: '',
    cadeia: 'NORMAL',
    setor: 'FRIOS',
    setor_herdado: 'FRIOS',
    fornecedor_planilha: 'COMPRADOR TESTE GENERICO',
    gerenciado: 'SIM',
    ativo: 'SIM',
    residuo: 'NAO',
    peso_variavel: estoqueTexto ? 'SIM' : 'NAO',
    alteracao_preco_data: '',
    alteracao_preco_hora: '',
    alteracao_preco_formatada: '',
    verificador: 'OK',
    autonomia: '15',
    autonomia_pedido: '10',
  };

  const prod: ProdutoSMG = {
    id: cod,
    codigo_original: `00${cod}`,
    codigo_interno: cod,
    digito: '1',
    codigo_exibicao: `${cod}-1`,
    descricao: nome,
    setor_operacional: nome.startsWith('RF.') ? 'FRIOS' : 'LOJA',
    embalagem: 'CX 12',
    fator_embalagem: 12,
    unidade_medida: estoqueTexto ? 'KG' : 'UN',
    estoque_emb1: estoque,
    estoque_emb9: 0,
    estoque_total: estoque,
    estoque_original_erp: estoqueTexto || String(estoque).replace('.', ','),
    estoque_disponivel_texto: estoqueTexto || String(estoque).replace('.', ','),
    vendas_qtde_30d: 0,
    dias_sem_venda: dias,
    idade: dias + 10,
    valor_estoque_planilha: 150.5,
    eans: ['7890000000' + cod],
    dados_operacionais: reg,
    atualizado_em: '2026-11-01T10:00:00.000Z',
  };

  return { prod, reg };
}

function createFakeDevice(seedAdmin = false): {
  state: FakeDeviceMemoryState;
  service: LocalUpdatePackageService;
} {
  const state: FakeDeviceMemoryState = {
    auth: seedAdmin
      ? {
          isAutenticado: true,
          isAnonimo: false,
          isVerificadoServidor: true,
          uid: 'admin-uid-172',
          email: 'gerencia172@empresa.com',
          perfil: {
            uid: 'admin-uid-172',
            email: 'gerencia172@empresa.com',
            nome: 'Gerente Filial 172',
            matricula: '172001',
            filialId: '172',
            papel: 'GERENCIA_ADMIN',
            ativo: true,
            criadoEm: '2026-01-01T00:00:00.000Z',
          },
          mensagem: 'Autorizado',
          carregando: false,
        }
      : {
          isAutenticado: false,
          isAnonimo: true,
          isVerificadoServidor: false,
          uid: null,
          email: null,
          perfil: null,
          mensagem: 'Desconectado',
          carregando: false,
        },
    produtos: [],
    registrosOp: [],
    fornecedores: [],
    industrias: [],
    saeou060: [],
    promotores: [],
    vinculosPI: [],
    vinculosDispositivo: [],
    vencimentosCount: 0,
    vinculosEanCount: 0,
    metaStore: new Map(),
    stagingStore: new Map(),
  };

  const deps: LocalPackageDependencies = {
    getAuthEstado: () => state.auth,
    getProdutos: () => state.produtos,
    getRegistrosOperacionais: () => state.registrosOp,
    getFornecedores: () => state.fornecedores,
    getIndustrias: () => state.industrias,
    getSaeou060: () => state.saeou060,
    getPromotores: () => state.promotores,
    getVinculosPromotorIndustria: () => state.vinculosPI,
    getVinculosDispositivoPromotor: () => state.vinculosDispositivo,
    getHistoricoIsv: () => [],
    getHistoricoSpcoi: () => [],
    getVencimentosCount: () => state.vencimentosCount,
    getVinculosEanCount: () => state.vinculosEanCount,
    aplicarCatalogoESaeou: async ({ produtos, saeou060 }) => {
      state.produtos = produtos;
      state.saeou060 = saeou060;
      return {
        vencimentosPreservados: state.vencimentosCount,
        vinculosEanPreservados: state.vinculosEanCount,
      };
    },
    aplicarIsv: async ({
      registrosOperacionais,
      fornecedores,
      industrias,
      vinculosPromotorIndustria,
      preservarAlteracoesComerciaisLocais,
    }) => {
      state.registrosOp = registrosOperacionais;
      state.fornecedores = fornecedores;
      state.industrias = industrias;
      if (!preservarAlteracoesComerciaisLocais) {
        state.vinculosPI = vinculosPromotorIndustria;
      }
    },
    aplicarPromotores: async ({
      promotores,
      vinculosDispositivoPromotor,
      preservarAlteracoesComerciaisLocais,
    }) => {
      if (!preservarAlteracoesComerciaisLocais) {
        state.promotores = promotores;
        if (vinculosDispositivoPromotor) {
          state.vinculosDispositivo = vinculosDispositivoPromotor;
        }
      }
    },
    getMeta: async <T>(key: string, fallback: T): Promise<T> => {
      return state.metaStore.has(key) ? (state.metaStore.get(key) as T) : fallback;
    },
    setMeta: async <T>(key: string, value: T) => {
      state.metaStore.set(key, JSON.parse(JSON.stringify(value)));
    },
    putStaging: async (key: string, data: any) => {
      state.stagingStore.set(key, data);
    },
    clearStaging: async () => {
      state.stagingStore.clear();
    },
    estimateStorage: async () => ({
      quota: 500 * 1024 * 1024,
      usage: 5 * 1024 * 1024,
    }),
    autoSubscribeEvents: false,
  };

  return { state, service: new LocalUpdatePackageService(deps) };
}

function populateFullSeed(state: FakeDeviceMemoryState, totalRubItems = 2150): void {
  const prods: ProdutoSMG[] = [];
  const regs: RegistroPlanilhaIsv[] = [];

  // Item 1..4 cobrindo todas as faixas + estoque zero + fracionado KG (3 casas decimais)
  const rCritico = makeRegistroRub('101', 'RF.PRESUNTO SEARA 1KG', 28, 158.795, '158,795');
  const rAlerta = makeRegistroRub('102', 'RF.QUEIJO MUSSARELA 500G', 18, 12, '12');
  const rAtencao = makeRegistroRub('103', 'CR.LEITE CONDENSADO 395G', 13, 24, '24');
  const rNormal = makeRegistroRub('104', 'CR.BISCOITO RECHEADO 130G', 7, 10, '10');
  const rRecente = makeRegistroRub('105', 'CR.ARROZ TIPO 1 5KG', 3, 40, '40');
  const rSemEst = makeRegistroRub('106', 'RF.MORTADELA 200G', 45, 0, '0');

  [rCritico, rAlerta, rAtencao, rNormal, rRecente, rSemEst].forEach((x) => {
    prods.push(x.prod);
    regs.push(x.reg);
  });

  // Gerar > 2.000 itens para validar divisão automática em múltiplos arquivos NDJSON no ZIP
  for (let i = 7; i <= totalRubItems; i++) {
    const { prod, reg } = makeRegistroRub(String(1000 + i), `ITEM OPERACIONAL ${i}`, 6, 5);
    prods.push(prod);
    regs.push(reg);
  }

  state.produtos = prods;
  state.registrosOp = regs;

  const indSeara: Industria = {
    cnpj: '02914460000105',
    cnpj_formatado: '02.914.460/0001-05',
    razao_social: 'SEARA ALIMENTOS LTDA',
    nome_exibicao: 'SEARA',
    ativo: true,
    total_produtos_loja: 4,
    promotores_responsaveis: ['MARIA SILVA'],
    criado_em: '2026-11-01T00:00:00.000Z',
    atualizado_em: '2026-11-01T00:00:00.000Z',
  };
  state.industrias = [indSeara];

  state.fornecedores = [
    {
      id: `${indSeara.cnpj}_101`,
      cnpj: indSeara.cnpj,
      cnpj_formatado: indSeara.cnpj_formatado,
      razao_social: indSeara.razao_social,
      codigo_interno: '101',
      digito: '1',
      codigo_exibicao: '101-1',
      descricao_spcoi: 'RF.PRESUNTO SEARA 1KG',
      embalagem: 'KG',
      criado_em: '01/11/2026',
    },
    {
      id: `${indSeara.cnpj}_102`,
      cnpj: indSeara.cnpj,
      cnpj_formatado: indSeara.cnpj_formatado,
      razao_social: indSeara.razao_social,
      codigo_interno: '102',
      digito: '1',
      codigo_exibicao: '102-1',
      descricao_spcoi: 'RF.QUEIJO MUSSARELA 500G',
      embalagem: 'UN',
      criado_em: '01/11/2026',
    },
  ];

  state.saeou060 = [
    {
      id: 'saeou-101-2026-11-20',
      codigo_interno: '101',
      digito: '1',
      codigo_exibicao: '101-1',
      codigo_original: '101-1',
      descricao: 'RF.PRESUNTO SEARA 1KG',
      data_vencimento: '2026-11-20',
      data_vencimento_exibicao: '20/11/2026',
      quantidade: 5,
      origem: 'SAEOU060',
      arquivo_origem: 'SAEOU060.xlsx',
      data_importacao: '01/11/2026',
      hora_importacao: '08:00',
      status_saeou: 'NOVO',
    },
  ];

  state.promotores = [
    {
      promotorId: 'prom_maria_172',
      nome: 'MARIA SILVA',
      agenciaNome: 'AGÊNCIA   LÍDER   CASCAVEL',
      filialId: '172',
      filialNome: 'Cascavel',
      setores: ['FRIOS', 'LOJA'],
      setorId: 'FRIOS',
      setorNome: 'FRIOS • LOJA',
      status: 'ATIVO',
      permissoes: {
        consultarProduto: true,
        escanearEAN: true,
        cadastrarVencimento: true,
        atualizarQuantidade: true,
        visualizarPendencias: true,
        enviarAoComprador: true,
        visualizarHistorico: true,
      },
      dispositivoVinculado: null,
      dataCadastro: '2026-11-01T00:00:00.000Z',
      criadoPor: 'gerencia@empresa.com',
      atualizadoPor: 'gerencia@empresa.com',
    },
  ];

  state.vinculosPI = [
    {
      id: 'prom_maria_172_02914460000105_172',
      promotorId: 'prom_maria_172',
      promotorNome: 'MARIA SILVA',
      agenciaNome: 'AGÊNCIA   LÍDER   CASCAVEL',
      cnpj: indSeara.cnpj,
      filialId: '172',
      criado_em: '2026-11-01T00:00:00.000Z',
    },
  ];
}

async function runTests() {
  console.log('🧪 Executando testes do Sistema de Atualização Local por Arquivo Único (.ZIP)...');
  resetModoAtualizacaoLocalCache();

  // -------------------------------------------------------------------------
  // 1. Modo local ativo e SHA-256 determinístico
  // -------------------------------------------------------------------------
  assert(isModoAtualizacaoLocalAtivo() === true, 'Modo de atualização local deve iniciar ativo na Filial 172.');
  const hashA = await sha256HexText('FILIAL_172_SHA256_TEST');
  const hashB = await sha256HexBytes(strToU8('FILIAL_172_SHA256_TEST'));
  assert(hashA.length === 64 && hashA === hashB, 'SHA-256 de texto e bytes deve ser idêntico e possuir 64 chars hex.');

  // -------------------------------------------------------------------------
  // 2. Bloqueio de segurança para geração do pacote (Auth + troca local bloqueada)
  // -------------------------------------------------------------------------
  const gerencia = createFakeDevice(false);
  populateFullSeed(gerencia.state, 2150);

  // Troca visual local no authRoleService NÃO pode conceder permissão!
  authRoleService.alternarPapel('GERENCIA_ADMIN');
  const resSemAuth = await gerencia.service.gerarPacoteAtualizacaoIsv();
  assert(resSemAuth.sucesso === false, 'Usuário não autenticado no Firebase deve ser recusado mesmo após authRoleService.alternarPapel.');

  // Sessão anônima também recusada
  gerencia.state.auth.isAutenticado = true;
  gerencia.state.auth.isAnonimo = true;
  const resAnon = await gerencia.service.gerarPacoteAtualizacaoIsv();
  assert(resAnon.sucesso === false, 'Usuário anônimo deve ser recusado.');

  // Usuário autenticado como OPERADOR_LOJA recusado
  gerencia.state.auth.isAnonimo = false;
  gerencia.state.auth.isVerificadoServidor = true;
  gerencia.state.auth.perfil = {
    uid: 'op-1',
    email: 'op@empresa.com',
    nome: 'Operador',
    matricula: '172099',
    filialId: '172',
    papel: 'OPERADOR_LOJA',
    ativo: true,
    criadoEm: '2026-01-01T00:00:00.000Z',
  };
  const resOperador = await gerencia.service.gerarPacoteAtualizacaoIsv();
  assert(resOperador.sucesso === false, 'OPERADOR_LOJA não pode gerar pacote.');

  // -------------------------------------------------------------------------
  // 3. Bloqueio quando qualquer uma das 3 bases obrigatórias estiver vazia
  // -------------------------------------------------------------------------
  const gerenciaIncompleta = createFakeDevice(true);
  populateFullSeed(gerenciaIncompleta.state, 10);
  gerenciaIncompleta.state.saeou060 = [];
  const resSemSaeou = await gerenciaIncompleta.service.gerarPacoteAtualizacaoIsv();
  assert(resSemSaeou.sucesso === false, 'Deve bloquear exportação quando SAEOU060 estiver vazia.');

  gerenciaIncompleta.state.saeou060 = [
    {
      id: 's1',
      codigo_interno: '101',
      digito: '1',
      codigo_exibicao: '101-1',
      codigo_original: '101-1',
      descricao: 'TESTE',
      data_vencimento: '2026-12-01',
      data_vencimento_exibicao: '01/12/2026',
      quantidade: 1,
      origem: 'SAEOU060',
      arquivo_origem: 'SAEOU060.xlsx',
      data_importacao: '01/11/2026',
      hora_importacao: '08:00',
      status_saeou: 'NOVO',
    },
  ];
  gerenciaIncompleta.state.fornecedores = [];
  const resSemSpcoi = await gerenciaIncompleta.service.gerarPacoteAtualizacaoIsv();
  assert(resSemSpcoi.sucesso === false, 'Deve bloquear exportação quando SPCOI007 estiver vazia.');

  // -------------------------------------------------------------------------
  // 4. Geração completa do arquivo único `.zip` por GERENCIA_ADMIN verificado
  // -------------------------------------------------------------------------
  const gerenciaOk = createFakeDevice(true);
  populateFullSeed(gerenciaOk.state, 2150);

  let ultimoPctExport = 0;
  const exportRes = await gerenciaOk.service.gerarPacoteAtualizacaoIsv((pct) => {
    assert(pct >= ultimoPctExport, 'Progresso da geração deve ser monotônico.');
    ultimoPctExport = pct;
  });

  assert(exportRes.sucesso === true && Boolean(exportRes.bytes), 'Exportação por GERENCIA_ADMIN verificado deve ter sucesso.');
  assert(ultimoPctExport === 100, 'Progresso final da exportação deve atingir 100%.');
  assert(
    /^ISV_FILIAL_172_ATUALIZACAO_\d{4}-\d{2}-\d{2}\.zip$/.test(exportRes.fileName || ''),
    `Nome oficial inválido: ${exportRes.fileName}`
  );
  assert(
    (exportRes.manifesto?.partesBaseRubProdutos || 0) >= 2,
    'BASE RUB com 2150 itens deve gerar >= 2 partes NDJSON para segurança de memória.'
  );
  assert(
    exportRes.manifesto?.assinaturaCriptograficaPresente === false &&
      exportRes.manifesto?.autenticidadeStatusPadrao === 'INTEGRIDADE_VERIFICADA_SEM_ASSINATURA_PKI',
    'Manifesto deve declarar honestamente ausência de PKI.'
  );

  const zipFiles = unzipSync(exportRes.bytes!);
  assert(Boolean(zipFiles['manifest.json']), 'ZIP deve conter manifest.json');
  assert(Boolean(zipFiles['bases/base_rub_produtos_002.ndjson']), 'ZIP deve conter parte 002 NDJSON.');
  const agenciasJson = JSON.parse(strFromU8(zipFiles['comercial/agencias.json']));
  assert(agenciasJson.length === 1 && agenciasJson[0].nome === 'AGÊNCIA LÍDER CASCAVEL', 'Agência deve ser normalizada com espaços colapsados.');

  // -------------------------------------------------------------------------
  // 5. Dispositivo destino (SEM LOGIN) inspeciona e instala + preserva vencimentos/EANs
  // -------------------------------------------------------------------------
  const destino = createFakeDevice(false); // Não logado!
  destino.state.vencimentosCount = 17;
  destino.state.vinculosEanCount = 42;

  const insp = await destino.service.inspecionarPacoteAtualizacaoIsv(exportRes.bytes!);
  assert(insp.validoParaInstalacao === true, `Inspeção no destino falhou: ${insp.errosBloqueantes.join('; ')}`);
  assert(
    insp.autenticidadeStatus === 'INTEGRIDADE_VERIFICADA_SEM_ASSINATURA_PKI',
    'Inspeção deve informar INTEGRIDADE_VERIFICADA_SEM_ASSINATURA_PKI.'
  );
  assert(insp.integridadeSha256Ok === true, 'SHA-256 deve ser validado.');
  assert(
    insp.resumoComparacao?.comparacaoVersao === 'PRIMEIRA_INSTALACAO',
    'Primeira instalação deve ser identificada.'
  );

  // Tentar instalar sem confirmar substituição -> bloqueado
  const instSemConfirmar = await destino.service.instalarPacoteAtualizacaoIsv(insp, {
    confirmarSubstituicaoBases: false,
  });
  assert(instSemConfirmar.sucesso === false, 'Não pode instalar sem confirmação explícita.');

  const instOk = await destino.service.instalarPacoteAtualizacaoIsv(insp, {
    confirmarSubstituicaoBases: true,
  });
  assert(instOk.sucesso === true, `Instalação no dispositivo destino falhou: ${instOk.mensagem}`);
  assert(destino.state.produtos.length === 2150, 'Destino deve conter todos os 2150 produtos.');
  assert(destino.state.registrosOp.length === 2150, 'Destino deve conter todos os 2150 registros operacionais.');
  assert(destino.state.saeou060.length === 1, 'Destino deve conter SAEOU060 instalada.');
  assert(destino.state.promotores.length === 1 && destino.state.promotores[0].setorNome === 'FRIOS • LOJA', 'Promotores e setores devem ser instalados.');
  assert(
    instOk.preservacaoGarantida?.vencimentosPreservados === 17 &&
      instOk.preservacaoGarantida?.vinculosEanPreservados === 42 &&
      instOk.preservacaoGarantida?.filaSyncPreservada === true,
    'Vencimentos, vínculos EAN e filas de sincronização devem permanecer 100% preservados.'
  );
  assert(destino.state.stagingStore.size === 0, 'Área de staging deve ser limpa após instalação.');

  // -------------------------------------------------------------------------
  // 6. Rejeição de pacotes corrompidos, adulterados, filial errada e formato inválido
  // -------------------------------------------------------------------------
  const corruptedZipFiles = { ...zipFiles };
  corruptedZipFiles['bases/saeou060.json'] = strToU8('[]'); // Adulterado após criação do manifest!
  const corruptedZip = zipSync(corruptedZipFiles);
  const inspCorrompido = await destino.service.inspecionarPacoteAtualizacaoIsv(corruptedZip);
  assert(
    inspCorrompido.validoParaInstalacao === false &&
      inspCorrompido.autenticidadeStatus === 'REJEITADO_CORROMPIDO',
    'Pacote adulterado deve ser rejeitado como REJEITADO_CORROMPIDO.'
  );

  const wrongFilialFiles = { ...zipFiles };
  const wrongMan = JSON.parse(strFromU8(wrongFilialFiles['manifest.json']));
  wrongMan.filialId = '999';
  wrongFilialFiles['manifest.json'] = strToU8(JSON.stringify(wrongMan));
  const inspFilialErrada = await destino.service.inspecionarPacoteAtualizacaoIsv(zipSync(wrongFilialFiles));
  assert(
    inspFilialErrada.validoParaInstalacao === false &&
      inspFilialErrada.autenticidadeStatus === 'REJEITADO_FILIAL_INCOMPATIVEL',
    'Pacote de outra filial deve ser rejeitado como REJEITADO_FILIAL_INCOMPATIVEL.'
  );

  const inspLixo = await destino.service.inspecionarPacoteAtualizacaoIsv(strToU8('NAO_E_UM_ZIP_VALIDO'));
  assert(
    inspLixo.validoParaInstalacao === false &&
      inspLixo.autenticidadeStatus === 'REJEITADO_FORMATO_INVALIDO',
    'Arquivo não ZIP deve retornar REJEITADO_FORMATO_INVALIDO.'
  );

  // -------------------------------------------------------------------------
  // 7. Detecção de downgrade e conflitos comerciais locais
  // -------------------------------------------------------------------------
  const olderFiles = { ...zipFiles };
  const olderMan = JSON.parse(strFromU8(olderFiles['manifest.json']));
  olderMan.versaoId = 'ISV172_ANTIGA_20250101';
  olderMan.geradoEmIso = '2025-01-01T10:00:00.000Z';
  olderMan.geradoEmTs = Date.parse('2025-01-01T10:00:00.000Z');
  olderFiles['manifest.json'] = strToU8(JSON.stringify(olderMan));
  const olderZip = zipSync(olderFiles);

  // Simular edição comercial local no dispositivo após última atualização
  await destino.service.registrarAlteracaoExterna({
    tipo: 'PROMOTOR',
    motivo: 'Promotor local cadastrado após pacote',
    comercial: true,
    timestampIso: new Date().toISOString(),
  });
  destino.state.promotores.push({
    ...destino.state.promotores[0],
    promotorId: 'prom_local_extra',
    nome: 'CARLOS LOCAL',
  });

  const inspDowngradeConflito = await destino.service.inspecionarPacoteAtualizacaoIsv(olderZip);
  assert(
    inspDowngradeConflito.resumoComparacao?.comparacaoVersao === 'VERSAO_ANTERIOR_DOWNGRADE' &&
      inspDowngradeConflito.resumoComparacao?.exigeConfirmacaoDowngrade === true,
    'Deve detectar downgrade e exigir confirmação dupla.'
  );
  assert(
    (inspDowngradeConflito.resumoComparacao?.conflitosComerciais.length || 0) > 0,
    'Deve detectar conflito comercial local após edição.'
  );

  // Recusar instalação de downgrade sem confirmarDowngrade
  const resRecusaDown = await destino.service.instalarPacoteAtualizacaoIsv(inspDowngradeConflito, {
    confirmarSubstituicaoBases: true,
    confirmarDowngrade: false,
    resolucaoConflitoComercial: 'MANTER_ALTERACOES_LOCAIS',
  });
  assert(resRecusaDown.sucesso === false, 'Downgrade sem confirmarDowngrade deve ser bloqueado.');

  // Aceitar downgrade mantendo alterações comerciais locais
  const resManterLocais = await destino.service.instalarPacoteAtualizacaoIsv(inspDowngradeConflito, {
    confirmarSubstituicaoBases: true,
    confirmarDowngrade: true,
    resolucaoConflitoComercial: 'MANTER_ALTERACOES_LOCAIS',
  });
  assert(resManterLocais.sucesso === true, 'Instalação mantendo edições comerciais locais deve concluir.');
  assert(
    destino.state.promotores.some((p) => p.promotorId === 'prom_local_extra'),
    'Promotor cadastrado localmente deve ser preservado quando escolher MANTER_ALTERACOES_LOCAIS.'
  );

  // -------------------------------------------------------------------------
  // 8. Simulação de falha no meio da troca + Rollback completo
  // -------------------------------------------------------------------------
  const destinoRollback = createFakeDevice(false);
  populateFullSeed(destinoRollback.state, 15); // Versão anterior ativa com 15 produtos
  destinoRollback.state.vencimentosCount = 9;
  const inspParaRollback = await destinoRollback.service.inspecionarPacoteAtualizacaoIsv(exportRes.bytes!);

  const resFalhaRollback = await destinoRollback.service.instalarPacoteAtualizacaoIsv(
    inspParaRollback,
    {
      confirmarSubstituicaoBases: true,
      onBeforeCommitTestHook: async (etapa) => {
        if (etapa === 'TROCA_ISV_SPCOI') {
          throw new Error('FALHA_SIMULADA_GRAVACAO_IDB');
        }
      },
    }
  );

  assert(
    resFalhaRollback.sucesso === false && resFalhaRollback.rollbackExecutado === true,
    'Falha mid-swap deve executar rollback completo.'
  );
  assert(
    destinoRollback.state.produtos.length === 15 &&
      destinoRollback.state.registrosOp.length === 15 &&
      destinoRollback.state.vencimentosCount === 9,
    'Após rollback, versão anterior (15 produtos) e vencimentos (9) devem estar intactos.'
  );

  // -------------------------------------------------------------------------
  // 9. Preservação real em ProductRepository + IsvService + Filas offline + Regras ISV/PDF
  // -------------------------------------------------------------------------
  await productRepository.addVencimento({
    codigo_interno: '101',
    digito: '1',
    codigo_exibicao: '101-1',
    descricao_produto: 'RF.PRESUNTO SEARA 1KG',
    embalagem: 'KG',
    fator_embalagem: 1,
    data_validade: '2026-12-20',
    quantidade_total_unidades: 4,
    lote_identificador: 'LOTE-A',
  } as any);

  await productRepository.saveVinculos([
    {
      id: '7890000000101_101',
      ean: '7890000000101',
      codigo_interno: '101',
      digito: '1',
      descricao: 'RF.PRESUNTO SEARA 1KG',
      status_vinculo: 'AGUARDANDO_BASE',
    } as any,
  ]);
  syncQueueService.addTombstone('v-deleted-tomb-1');
  nuvemSyncEngine.adicionarTombstone('v-deleted-v3-1', 'Teste preservação', 'Admin');

  const payload = insp.payload!;
  const presRepo = await productRepository.aplicarCatalogoESaeouDePacote({
    produtos: payload.produtos.slice(0, 6),
    saeou060: payload.saeou060,
    versaoPacoteId: payload.manifesto.versaoId,
    dataGeracaoIso: payload.manifesto.geradoEmIso,
  });
  await isvService.aplicarDadosPacote({
    registrosOperacionais: payload.registrosOperacionais.slice(0, 6),
    fornecedores: payload.fornecedores,
    industrias: payload.industrias,
    vinculosPromotorIndustria: payload.vinculosPromotorIndustria,
  });

  assert(
    presRepo.vencimentosPreservados >= 1 &&
      productRepository.getVencimentosByCodigoInterno('101').length === 1,
    'ProductRepository deve preservar vencimentos existentes.'
  );
  assert(
    presRepo.vinculosEanPreservados >= 1 &&
      productRepository.getProductByBarcode('7890000000101')?.codigo_interno === '101',
    'ProductRepository deve preservar vínculos EAN e reassociá-los ao catálogo do pacote.'
  );
  assert(
    syncQueueService.isTombstoned('v-deleted-tomb-1') &&
      nuvemSyncEngine.isTombstoned('v-deleted-v3-1'),
    'Tombstones e filas de sincronização Spark devem permanecer preservados.'
  );

  // Validar regras oficiais do ISV pós-instalação (Fornecedor SPCOI007, Gráficos, TOP 30 e Estoque único)
  const itensIsv = isvService.getItensIsv();
  const itemPresunto = itensIsv.find((i) => i.codigo_interno === '101')!;
  assert(
    extrairFornecedorProduto(itemPresunto) === 'SEARA ALIMENTOS LTDA',
    'FORNECEDOR no ISV deve ser estritamente a RAZÃO SOCIAL DA INDÚSTRIA na SPCOI007.'
  );
  assert(
    formatarEstoqueColunaUnica(itemPresunto) === '158,795',
    'ESTOQUE deve preservar casas decimais originais em coluna única.'
  );

  const resumoClassif = calcularTotaisClassificacao(itensIsv);
  assert(
    resumoClassif.totalElegiveis === 4 &&
      resumoClassif.critico.totalProdutos === 1 &&
      resumoClassif.alerta.totalProdutos === 1 &&
      resumoClassif.atencao.totalProdutos === 1 &&
      resumoClassif.giroNormal.totalProdutos === 1 &&
      resumoClassif.totalSemEstoque === 1 &&
      resumoClassif.totalNaoElegiveisMenor5Dias === 1,
    'Classificação do gráfico (5-10 Verde, 11-15 Amarelo, 16-20 Laranja, 21+ Vermelho) deve ignorar estoque<=0 e dias<5.'
  );
  assert(classificarDiasSemVenda(28, 158.795)?.corNome === 'Vermelho', '28 dias deve ser Vermelho.');

  const top30 = obterTop30Mercadorias(itensIsv);
  assert(
    top30.length === 4 &&
      top30[0].codigoInterno === '101' &&
      top30[0].fornecedor === 'SEARA ALIMENTOS LTDA' &&
      top30[0].estoqueFormatado === '158,795',
    'TOP 30 deve ordenar decrescente e exibir razão social + estoque fracionado em coluna única.'
  );

  console.log('✅ Todos os cenários do Sistema de Atualização Local por Arquivo Único (.ZIP) passaram com 100% de aprovação!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Falha nos testes do pacote local:', err);
  process.exit(1);
});
