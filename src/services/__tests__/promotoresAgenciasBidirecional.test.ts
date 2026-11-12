/**
 * Suite Offline — Evolução de Promotores, Agências Independentes,
 * Vinculação Bidirecional, Substituição Controlada e Pacote ZIP
 * Filial 172 — Cascavel
 */

import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import {
  AgenciaComercial,
  FornecedorSPCOI007,
  HistoricoMovimentacaoComercial,
  Industria,
  PERMISSOES_PADRAO_PROMOTOR,
  ProdutoSMG,
  Promotor,
  RegistroPlanilhaIsv,
  RegistroSaeou060,
  VinculoPromotor,
  VinculoPromotorIndustria,
} from '../../types';
import {
  gerarAgenciaId,
  normalizarChaveAgencia,
  normalizarNomeAgenciaExibicao,
} from '../agenciaNormalizer';
import { EstadoAuthServidor } from '../firebaseAuthService';
import { isvService } from '../isvService';
import { LocalUpdatePackageService } from '../localUpdatePackageService';
import { promotorService } from '../promotorService';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${message}`);
  }
}

async function assertThrowsAsync(fn: () => Promise<unknown>, message: string): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

function makeOpRecord(codigo: string, nome: string, valor: number): {
  prod: ProdutoSMG;
  op: RegistroPlanilhaIsv;
} {
  const op: RegistroPlanilhaIsv = {
    id: codigo,
    codigo_original: `00${codigo}`,
    codigo_interno: codigo,
    digito: '1',
    codigo_exibicao: `${codigo}-1`,
    chave_normalizada: `${codigo}-1`,
    filial: '172',
    nome,
    complemento: 'UN',
    valor_disponivel: valor,
    valor_disponivel_status: 'VALIDO',
    estoque: 10,
    estoque_original_texto: '10',
    estoque_formatado_extenso: '10',
    valor_indisponivel: 0,
    bloqueio: 'SEM_BLOQUEIO',
    transito_entrada: 0,
    estoque_indisponivel: 0,
    dias_sem_venda: 12,
    ultima_venda_data: '',
    ultima_venda_hora: '',
    ultima_venda_formatada: '',
    ultima_compra_data: '',
    ultima_compra_hora: '',
    ultima_compra_formatada: '',
    classe_produto: 'FRIOS',
    classe_produto_raiz: 'FRIOS',
    idade: 30,
    pedidos_pendentes: '0',
    venda_30_dias: 0,
    setor_save: 'FRIOS',
    validade_1: '',
    validade_2: '',
    cadeia: 'NORMAL',
    setor: 'FRIOS',
    setor_herdado: 'FRIOS',
    fornecedor_planilha: 'FORNECEDOR',
    gerenciado: 'SIM',
    ativo: 'SIM',
    residuo: 'NAO',
    peso_variavel: 'NAO',
    alteracao_preco_data: '',
    alteracao_preco_hora: '',
    alteracao_preco_formatada: '',
    verificador: 'OK_36_COLS',
    autonomia: '10',
    autonomia_pedido: '10',
  };

  const prod: ProdutoSMG = {
    id: codigo,
    codigo_original: `00${codigo}`,
    codigo_interno: codigo,
    digito: '1',
    codigo_exibicao: `${codigo}-1`,
    descricao: nome,
    setor_operacional: 'FRIOS',
    embalagem: 'CX 12',
    fator_embalagem: 12,
    unidade_medida: 'UN',
    estoque_emb1: 10,
    estoque_emb9: 0,
    estoque_total: 10,
    estoque_original_erp: '10',
    estoque_disponivel_texto: '10',
    vendas_qtde_30d: 0,
    dias_sem_venda: 12,
    idade: 30,
    valor_estoque_planilha: valor,
    eans: [`789000${codigo}`],
    dados_operacionais: op,
    atualizado_em: '2026-11-10T10:00:00.000Z',
  };

  return { prod, op };
}

async function runTests(): Promise<void> {
  // Inicializar serviços offline em memória
  await Promise.all([promotorService.init(), isvService.init()]);

  // =========================================================================
  // 1. PRESERVAÇÃO DOS 31 PROMOTORES LEGADOS + 40 VÍNCULOS + SINCRONIZAÇÃO DE AGÊNCIAS
  // =========================================================================
  const promotoresLegados: Promotor[] = Array.from({ length: 31 }, (_, i) => ({
    promotorId: `prom_leg_${i + 1}`,
    nome: `PROMOTOR LEGADO ${i + 1}`,
    agenciaNome: i < 15 ? 'Agência Alfa' : 'Agência Beta',
    matricula: `LEG-${100 + i}`,
    filialId: '172',
    filialNome: 'Cascavel',
    setores: ['FRIOS'],
    setorId: 'FRIOS',
    setorNome: 'FRIOS',
    status: i % 5 === 0 ? 'PENDENTE_VINCULO' : 'ATIVO',
    permissoes: { ...PERMISSOES_PADRAO_PROMOTOR },
    dispositivoVinculado:
      i % 5 === 0
        ? null
        : {
            dispositivoId: `dev_${i + 1}`,
            dispositivoNome: `Coletor ${i + 1}`,
            dataPrimeiroVinculo: '2026-10-01T10:00:00.000Z',
            ultimoAcesso: '2026-11-10T10:00:00.000Z',
          },
    dataCadastro: '2026-10-01T10:00:00.000Z',
    dataVinculo: i % 5 === 0 ? null : '2026-10-01T10:00:00.000Z',
    ultimoAcesso: null,
    ultimaSincronizacao: null,
    criadoPor: 'GERENCIA',
    atualizadoPor: 'GERENCIA',
  }));

  const vinculosDispLegados: VinculoPromotor[] = Array.from({ length: 40 }, (_, i) => ({
    vinculoId: `vd_leg_${i + 1}`,
    promotorId: `prom_leg_${(i % 31) + 1}`,
    promotorNome: `PROMOTOR LEGADO ${(i % 31) + 1}`,
    agenciaNome: i % 31 < 15 ? 'Agência Alfa' : 'Agência Beta',
    filialId: '172',
    filialNome: 'Cascavel',
    setores: ['FRIOS'],
    setorId: 'FRIOS',
    setorNome: 'FRIOS',
    codigoVinculo: String(100000 + i),
    tokenVinculo: `tok_leg_${i + 1}`,
    dataCriacao: '2026-10-01T10:00:00.000Z',
    dataExpiracao: '2026-12-31T23:59:59.000Z',
    status: 'UTILIZADO',
  }));

  await promotorService.substituirDadosComerciaisDePacote({
    promotores: promotoresLegados,
    vinculosDispositivoPromotor: vinculosDispLegados,
  });

  assert(
    promotorService.getPromotores().length === 31,
    'Deve preservar integralmente todos os 31 promotores existentes.'
  );
  assert(
    promotorService.getVinculos().length === 40,
    'Deve preservar integralmente os 40 vínculos de dispositivo existentes.'
  );
  assert(
    promotorService.getAgencias().length === 2,
    'Deve criar automaticamente as 2 agências canônicas a partir dos 31 promotores sem apagar dados.'
  );

  // =========================================================================
  // 2. CADASTRO INDEPENDENTE DE AGÊNCIAS & DEDUPLICAÇÃO CANÔNICA
  // =========================================================================
  assert(
    normalizarChaveAgencia('  Séara  ') === 'SEARA' &&
      normalizarNomeAgenciaExibicao('  seara   alimentos ') === 'seara alimentos',
    'Normalização de agência deve remover acentos, maiúsculas/minúsculas e espaços extras.'
  );

  const agSeara = await promotorService.cadastrarAgencia({
    nome: 'Seara',
    contato: 'Marcos',
    telefone: '(45) 99999-1111',
  });
  assert(agSeara.agenciaId === gerarAgenciaId('Seara'), 'ID canônico deve ser estável.');

  // Tentativas de duplicação com variação de caixa, acento e espaço devem ser bloqueadas
  await assertThrowsAsync(
    () => promotorService.cadastrarAgencia({ nome: 'SEARA' }),
    'Deve impedir duplicidade exata em caixa alta ("SEARA").'
  );
  await assertThrowsAsync(
    () => promotorService.cadastrarAgencia({ nome: '  seara  ' }),
    'Deve impedir duplicidade com espaços extras ("  seara  ").'
  );
  await assertThrowsAsync(
    () => promotorService.cadastrarAgencia({ nome: 'Séara' }),
    'Deve impedir duplicidade com acento ("Séara").'
  );

  // Agência independente sem promotores ainda deve existir e ter 0 ativos
  const agVazia = await promotorService.cadastrarAgencia({ nome: 'Agência Expansão Sul' });
  const resumoVazia = promotorService.getResumoPromotoresAgencia(agVazia.agenciaId);
  assert(resumoVazia.total === 0 && resumoVazia.ativos === 0, 'Agência vazia deve iniciar com 0 ativos.');

  // Edição de agência propaga para promotores vinculados
  const promAlfa = promotorService.getPromotores().find((p) => p.agenciaNome === 'Agência Alfa')!;
  const agAlfa = promotorService.buscarAgenciaPorNome('Agência Alfa')!;
  await promotorService.atualizarAgencia(agAlfa.agenciaId, { nome: 'Agência Alfa Regional' });
  assert(
    promotorService.getPromotorById(promAlfa.promotorId)?.agenciaNome === 'Agência Alfa Regional',
    'Renomear agência deve atualizar promotores vinculados automaticamente.'
  );

  // =========================================================================
  // 3. CARGA DE INDÚSTRIAS SPCOI007 + BASE RUB + VINCULAÇÃO BIDIRECIONAL E M:N
  // =========================================================================
  const { prod: prod1, op: op1 } = makeOpRecord('1001', 'QUEIJO MUSSARELA SEARA', 1500);
  const { prod: prod2, op: op2 } = makeOpRecord('1002', 'PRESUNTO COZIDO SADIA', 900);
  const { prod: prod3, op: op3 } = makeOpRecord('1003', 'IOGURTE INTEGRAL SEM PROMOTOR', 450);

  const indSeara: Industria = {
    cnpj: '02914460000150',
    cnpj_formatado: '02.914.460/0001-50',
    razao_social: 'SEARA ALIMENTOS LTDA',
    nome_exibicao: 'SEARA ALIMENTOS',
    ativo: true,
    total_produtos_loja: 1,
    promotores_responsaveis: [],
    criado_em: '2026-10-01T00:00:00.000Z',
    atualizado_em: '2026-10-01T00:00:00.000Z',
  };
  const indSadia: Industria = {
    cnpj: '01838723000127',
    cnpj_formatado: '01.838.723/0001-27',
    razao_social: 'BRF S.A. - SADIA',
    nome_exibicao: 'SADIA BRF',
    ativo: true,
    total_produtos_loja: 1,
    promotores_responsaveis: [],
    criado_em: '2026-10-01T00:00:00.000Z',
    atualizado_em: '2026-10-01T00:00:00.000Z',
  };
  const indDanone: Industria = {
    cnpj: '23643315000152',
    cnpj_formatado: '23.643.315/0001-52',
    razao_social: 'DANONE LTDA',
    nome_exibicao: 'DANONE',
    ativo: true,
    total_produtos_loja: 1,
    promotores_responsaveis: [],
    criado_em: '2026-10-01T00:00:00.000Z',
    atualizado_em: '2026-10-01T00:00:00.000Z',
  };

  const fornecedores: FornecedorSPCOI007[] = [
    {
      id: `${indSeara.cnpj}_1001`,
      cnpj: indSeara.cnpj,
      cnpj_formatado: indSeara.cnpj_formatado,
      razao_social: indSeara.razao_social,
      codigo_interno: '1001',
      digito: '1',
      codigo_exibicao: '1001-1',
      descricao_spcoi: prod1.descricao,
      criado_em: '01/10/2026',
    },
    {
      id: `${indSadia.cnpj}_1002`,
      cnpj: indSadia.cnpj,
      cnpj_formatado: indSadia.cnpj_formatado,
      razao_social: indSadia.razao_social,
      codigo_interno: '1002',
      digito: '1',
      codigo_exibicao: '1002-1',
      descricao_spcoi: prod2.descricao,
      criado_em: '01/10/2026',
    },
    {
      id: `${indDanone.cnpj}_1003`,
      cnpj: indDanone.cnpj,
      cnpj_formatado: indDanone.cnpj_formatado,
      razao_social: indDanone.razao_social,
      codigo_interno: '1003',
      digito: '1',
      codigo_exibicao: '1003-1',
      descricao_spcoi: prod3.descricao,
      criado_em: '01/10/2026',
    },
  ];

  // Gerar 40 vínculos iniciais promotor ↔ indústria garantindo que indDanone fique sem promotor
  const vinculosPIInicial: VinculoPromotorIndustria[] = Array.from({ length: 40 }, (_, idx) => {
    const p = promotoresLegados[idx % 31];
    const cnpjAlvo = idx % 2 === 0 ? indSeara.cnpj : indSadia.cnpj;
    return {
      id: `${p.promotorId}_${cnpjAlvo}_172`,
      promotorId: p.promotorId,
      promotorNome: p.nome,
      agenciaNome: p.agenciaNome,
      cnpj: cnpjAlvo,
      filialId: '172',
      criado_em: '2026-10-01T00:00:00.000Z',
    };
  });
  // Remover possíveis duplicidades de chave na semente para manter mapa limpo
  const vinculosPIClean = Array.from(
    new Map(vinculosPIInicial.map((v) => [v.id, v])).values()
  );

  await isvService.aplicarDadosPacote({
    registrosOperacionais: [op1, op2, op3],
    fornecedores,
    industrias: [indSeara, indSadia, indDanone],
    vinculosPromotorIndustria: vinculosPIClean,
  });

  // Criar novo promotor diretamente para vincular à indústria DANONE (fluxo inverso Dashboard)
  const novaPromotora = await promotorService.cadastrarPromotor({
    nome: 'Carla Mendes',
    agenciaId: agSeara.agenciaId,
    setores: ['FRIOS', 'LOJA'],
  });

  let dashboardEvents = 0;
  const unsubDash = isvService.subscribe(() => {
    dashboardEvents++;
  });

  const prods = [prod1, prod2, prod3];
  const filtrosPadrao = {
    agencia: 'TODAS',
    industriaCnpj: 'TODAS',
    promotorId: 'TODOS',
    termoBusca: '',
    setorOperacional: 'TODOS' as const,
    setorFisico: 'TODOS',
    setorBalanco: 'TODOS',
    diasSemVenda: null,
    modoDiasSemVenda: 'MINIMO' as const,
    idade: null,
    modoIdade: 'MINIMO' as const,
    filtroEstoque: 'TODOS' as const,
    filtroValor: 'TODOS' as const,
    situacaoVinculo: 'TODOS' as const,
    ordenacao: 'MAIOR_VALOR' as const,
  };

  // Antes de vincular Danone: deve aparecer como SEM_PROMOTOR
  const itensAntes = isvService.getItensIsv(prods);
  const semPromAntes = isvService.filtrarItensIsv(itensAntes, {
    ...filtrosPadrao,
    situacaoVinculo: 'SEM_PROMOTOR',
  });
  assert(
    semPromAntes.length === 1 && semPromAntes[0].codigo_interno === '1003',
    'Filtro "Sem promotor vinculado" deve identificar exatamente a indústria sem promotor.'
  );

  const dashAntes = isvService.getDashboardData(itensAntes, filtrosPadrao);
  assert(
    dashAntes.indicadores.industriasComPromotor === 2 &&
      dashAntes.indicadores.industriasSemPromotor === 1,
    'Dashboard deve contabilizar 2 indústrias com promotor e 1 sem promotor antes do vínculo.'
  );

  // Vincular Carla Mendes à Danone e também à Sadia (M:N) sem sair do Dashboard
  await isvService.vincularPromotorIndustria(novaPromotora, indDanone.cnpj, '172');
  await isvService.vincularPromotorIndustria(novaPromotora, indSadia.cnpj, '172');

  const itensDepois = isvService.getItensIsv(prods);
  const dashDepois = isvService.getDashboardData(itensDepois, filtrosPadrao);
  assert(
    dashboardEvents >= 2 &&
      dashDepois.indicadores.industriasComPromotor === 3 &&
      dashDepois.indicadores.industriasSemPromotor === 0,
    'Dashboard deve atualizar imediatamente após vincular promotor à indústria.'
  );

  // Desvincular sem excluir promotor nem indústria
  await isvService.desvincularPromotorIndustria(novaPromotora.promotorId, indSadia.cnpj, '172');
  assert(
    Boolean(promotorService.getPromotorById(novaPromotora.promotorId)) &&
      Boolean(isvService.getIndustriaByCnpj(indSadia.cnpj)),
    'Desvincular não deve excluir promotor nem indústria.'
  );
  unsubDash();

  // =========================================================================
  // 4. DESVINCULAR PROMOTOR DA AGÊNCIA + INATIVO + REATIVAÇÃO PRESERVANDO HISTÓRICO
  // =========================================================================
  const desvinc = await promotorService.desvincularPromotorDaAgencia(novaPromotora.promotorId, {
    motivo: 'Fim de contrato temporário',
    inativarPromotor: true,
  });
  assert(
    desvinc.agenciaId === null && desvinc.agenciaNome === '' && desvinc.status === 'INATIVO',
    'Promotor desvinculado com inativação deve limpar agência e assumir status INATIVO.'
  );

  const permCheckInativo = promotorService.validarPermissaoPromotor(
    novaPromotora.promotorId,
    'consultarProduto'
  );
  assert(
    !permCheckInativo.permitido,
    'Promotor INATIVO não deve ter permissão operacional enquanto inativo.'
  );

  const histProm = promotorService.getHistoricoMovimentacoes({
    promotorId: novaPromotora.promotorId,
  });
  assert(
    histProm.some((h) => h.tipo === 'PROMOTOR_DESVINCULADO_AGENCIA'),
    'Histórico de desvinculação da agência deve ser preservado.'
  );

  // Reativar promotor mantendo histórico
  const reativado = await promotorService.reativarPromotor(
    novaPromotora.promotorId,
    agSeara.agenciaId
  );
  assert(
    reativado.status !== 'INATIVO' && reativado.agenciaId === agSeara.agenciaId,
    'Promotor INATIVO deve permitir reativação futura com agência.'
  );

  // =========================================================================
  // 5. SUBSTITUIÇÃO DE PROMOTOR (TRANSFERÊNCIA SOMENTE COM CONFIRMAÇÃO EXPLÍCITA)
  // =========================================================================
  const promSubstituto = await promotorService.cadastrarPromotor({
    nome: 'Roberto Souza',
    agenciaId: agSeara.agenciaId,
    setores: ['FRIOS'],
  });

  // 5.1 Tentar transferir diretamente sem confirmação explícita deve lançar erro
  await assertThrowsAsync(
    () =>
      isvService.transferirVinculosIndustriaEntrePromotores(
        reativado.promotorId,
        promSubstituto,
        { confirmarTransferencia: false }
      ),
    'Transferência direta de vínculos de indústria deve exigir confirmarTransferencia === true.'
  );

  // 5.2 Substituir SEM confirmar transferência de indústrias NÃO transfere Danone
  const resSemTransf = await promotorService.substituirPromotor({
    promotorAntigoId: reativado.promotorId,
    promotorSubstitutoId: promSubstituto.promotorId,
    desvincularAntigoDaAgencia: true,
    inativarAntigo: true,
    confirmarTransferenciaVinculosIndustrias: false,
    motivo: 'Troca de rota sem transferência automática',
    onTransferirVinculos: async (origem, destino, cnpjs) =>
      isvService.transferirVinculosIndustriaEntrePromotores(origem, destino, {
        confirmarTransferencia: true,
        cnpjs,
      }),
  });
  assert(
    resSemTransf.cnpjsTransferidos.length === 0 &&
      isvService
        .getVinculosPromotorIndustria()
        .some((v) => v.promotorId === reativado.promotorId && v.cnpj === indDanone.cnpj) &&
      !isvService
        .getVinculosPromotorIndustria()
        .some((v) => v.promotorId === promSubstituto.promotorId && v.cnpj === indDanone.cnpj),
    'Sem confirmação explícita, nenhuma indústria deve ser transferida na substituição.'
  );

  // 5.3 Substituir COM confirmação explícita transfere os vínculos e registra histórico
  const promSubstituto2 = await promotorService.cadastrarPromotor({
    nome: 'Fernanda Lima',
    agenciaId: agSeara.agenciaId,
    setores: ['FRIOS'],
  });
  const resComTransf = await promotorService.substituirPromotor({
    promotorAntigoId: reativado.promotorId,
    promotorSubstitutoId: promSubstituto2.promotorId,
    desvincularAntigoDaAgencia: true,
    inativarAntigo: true,
    confirmarTransferenciaVinculosIndustrias: true,
    cnpjsSelecionados: [indDanone.cnpj],
    motivo: 'Assumiu rota da Seara/Danone',
    onTransferirVinculos: async (origem, destino, cnpjs) =>
      isvService.transferirVinculosIndustriaEntrePromotores(origem, destino, {
        confirmarTransferencia: true,
        cnpjs,
      }),
  });
  assert(
    resComTransf.cnpjsTransferidos.length === 1 &&
      resComTransf.cnpjsTransferidos[0] === indDanone.cnpj &&
      isvService
        .getVinculosPromotorIndustria()
        .some((v) => v.promotorId === promSubstituto2.promotorId && v.cnpj === indDanone.cnpj) &&
      !isvService
        .getVinculosPromotorIndustria()
        .some((v) => v.promotorId === reativado.promotorId && v.cnpj === indDanone.cnpj),
    'Com confirmação explícita, vínculos de indústrias devem ser transferidos ao substituto.'
  );

  // =========================================================================
  // 6. EXPORTAÇÃO / INSPEÇÃO / INSTALAÇÃO DO PACOTE ZIP E RETROCOMPATIBILIDADE
  // =========================================================================
  const authAdmin: EstadoAuthServidor = {
    isAutenticado: true,
    isAnonimo: false,
    isVerificadoServidor: true,
    uid: 'admin-172',
    email: 'gerencia172@atacadao.com.br',
    perfil: {
      uid: 'admin-172',
      email: 'gerencia172@atacadao.com.br',
      nome: 'Gerência 172',
      matricula: '172000',
      filialId: '172',
      papel: 'GERENCIA_ADMIN',
      ativo: true,
      criadoEm: '2026-01-01T00:00:00.000Z',
    },
    mensagem: 'OK',
    carregando: false,
  };

  const saeouSeed: RegistroSaeou060[] = [
    {
      id: '1001_2026-12-20',
      codigo_original: '001001',
      codigo_interno: '1001',
      digito: '1',
      codigo_exibicao: '1001-1',
      descricao: prod1.descricao,
      data_vencimento: '2026-12-20',
      quantidade: 4,
      status_saeou: 'NOVO',
      origem: 'SAEOU060',
      arquivo_origem: 'saeou060.xlsx',
      data_importacao: '10/11/2026',
      hora_importacao: '08:00',
    },
  ];

  const metaStore = new Map<string, any>();

  const origemPkg = new LocalUpdatePackageService({
    getAuthEstado: () => authAdmin,
    getProdutos: () => [prod1, prod2, prod3],
    getRegistrosOperacionais: () => [op1, op2, op3],
    getFornecedores: () => fornecedores,
    getIndustrias: () => isvService.getIndustrias(),
    getSaeou060: () => saeouSeed,
    getPromotores: () => promotorService.getPromotores(),
    getAgencias: () => promotorService.getAgencias(),
    getHistoricoMovimentacoes: () => promotorService.getHistoricoMovimentacoes(),
    getVinculosPromotorIndustria: () => isvService.getVinculosPromotorIndustria(),
    getVinculosDispositivoPromotor: () => promotorService.getVinculos(),
    getHistoricoIsv: () => [],
    getHistoricoSpcoi: () => [],
    getVencimentosCount: () => 5,
    getVinculosEanCount: () => 717,
    getMeta: async <T,>(k: string, fb: T) => (metaStore.has(k) ? (metaStore.get(k) as T) : fb),
    setMeta: async (k, v) => {
      metaStore.set(k, v);
    },
    putStaging: async () => {},
    clearStaging: async () => {},
    getServicosProntos: () => ({ catalogo: true, isv: true, promotores: true }),
    initDependencies: async () => {},
    subscribeStoreUpdates: () => () => {},
  });

  await origemPkg.init();
  const exportRes = await origemPkg.gerarPacoteAtualizacaoIsv();
  assert(
    exportRes.sucesso && Boolean(exportRes.bytes),
    'Pacote ZIP deve ser gerado com sucesso contendo agências independentes e histórico.'
  );

  // Verificar conteúdo interno do ZIP gerado
  const zipEntries = unzipSync(exportRes.bytes!);
  assert(Boolean(zipEntries['comercial/agencias.json']), 'ZIP deve incluir comercial/agencias.json.');
  assert(
    Boolean(zipEntries['comercial/historico_movimentacoes.json']),
    'ZIP deve incluir comercial/historico_movimentacoes.json.'
  );
  const agenciasNoZip = JSON.parse(strFromU8(zipEntries['comercial/agencias.json'])) as AgenciaComercial[];
  assert(
    agenciasNoZip.some((a) => a.agenciaId === agVazia.agenciaId && a.totalPromotoresAtivos === 0),
    'Agência independente sem promotores deve ser preservada no ZIP com contagem 0.'
  );
  assert(
    agenciasNoZip.some((a) => a.agenciaId === agSeara.agenciaId && a.contato === 'Marcos'),
    'Metadados da agência (contato/telefone) devem ser preservados no ZIP.'
  );

  // Instalar no dispositivo destino simulado
  let destAgencias: AgenciaComercial[] = [];
  let destPromotores: Promotor[] = [];
  let destHistorico: HistoricoMovimentacaoComercial[] = [];
  let destVencimentosIntactos = 12;
  let destEansIntactos = 717;

  const destinoPkg = new LocalUpdatePackageService({
    getAuthEstado: () => authAdmin,
    getProdutos: () => [],
    getRegistrosOperacionais: () => [],
    getFornecedores: () => [],
    getIndustrias: () => [],
    getSaeou060: () => [],
    getPromotores: () => destPromotores,
    getAgencias: () => destAgencias,
    getHistoricoMovimentacoes: () => destHistorico,
    getVinculosPromotorIndustria: () => [],
    getVinculosDispositivoPromotor: () => [],
    getHistoricoIsv: () => [],
    getHistoricoSpcoi: () => [],
    getVencimentosCount: () => destVencimentosIntactos,
    getVinculosEanCount: () => destEansIntactos,
    getMeta: async <T,>(k: string, fb: T) => (metaStore.has(`dest_${k}`) ? (metaStore.get(`dest_${k}`) as T) : fb),
    setMeta: async (k, v) => {
      metaStore.set(`dest_${k}`, v);
    },
    putStaging: async () => {},
    clearStaging: async () => {},
    getServicosProntos: () => ({ catalogo: true, isv: true, promotores: true }),
    initDependencies: async () => {},
    subscribeStoreUpdates: () => () => {},
    aplicarCatalogoESaeou: async () => ({
      vencimentosPreservados: destVencimentosIntactos,
      vinculosEanPreservados: destEansIntactos,
    }),
    aplicarIsv: async () => {},
    aplicarPromotores: async (payload) => {
      destPromotores = payload.promotores;
      destAgencias = payload.agencias || [];
      destHistorico = payload.historicoMovimentacoes || [];
    },
  });

  await destinoPkg.init();
  const inspecao = await destinoPkg.inspecionarPacoteAtualizacaoIsv(exportRes.bytes!);
  assert(
    inspecao.validoParaInstalacao &&
      inspecao.manifesto?.contagens.agencias === agenciasNoZip.length &&
      (inspecao.payload?.historicoMovimentacoes?.length || 0) > 0,
    'Inspeção do ZIP deve ler agências independentes e histórico de movimentações.'
  );

  const installRes = await destinoPkg.instalarPacoteAtualizacaoIsv(inspecao, {
    confirmarSubstituicaoBases: true,
  });
  assert(
    installRes.sucesso &&
      destAgencias.some((a) => a.agenciaId === agVazia.agenciaId) &&
      destPromotores.some((p) => p.status === 'INATIVO' && p.agenciaId === null) &&
      destHistorico.length > 0 &&
      destVencimentosIntactos === 12 &&
      destEansIntactos === 717,
    'Instalação do ZIP deve preservar agências independentes, promotor INATIVO, histórico, vencimentos e EANs.'
  );

  // Retrocompatibilidade: pacote ZIP antigo sem comercial/historico_movimentacoes.json
  const legacyEntries = { ...zipEntries };
  delete legacyEntries['comercial/historico_movimentacoes.json'];
  const legacyManifest = JSON.parse(strFromU8(legacyEntries['manifest.json']));
  legacyManifest.entradas = legacyManifest.entradas.filter(
    (e: { caminho: string }) => e.caminho !== 'comercial/historico_movimentacoes.json'
  );
  const { sha256HexText } = await import('../localPackageMode');
  const resumoLegacy = legacyManifest.entradas
    .slice()
    .sort((a: { caminho: string }, b: { caminho: string }) => a.caminho.localeCompare(b.caminho))
    .map((e: { caminho: string; sha256: string; bytes: number }) => `${e.caminho}:${e.sha256}:${e.bytes}`)
    .join('\n');
  legacyManifest.sha256DadosConsolidados = await sha256HexText(resumoLegacy);
  legacyEntries['manifest.json'] = strToU8(JSON.stringify(legacyManifest, null, 2));

  const legacyBytes = zipSync(legacyEntries, { level: 6 });
  const legacyInspect = await destinoPkg.inspecionarPacoteAtualizacaoIsv(legacyBytes);
  assert(
    legacyInspect.validoParaInstalacao &&
      Array.isArray(legacyInspect.payload?.historicoMovimentacoes) &&
      legacyInspect.payload!.historicoMovimentacoes.length === 0 &&
      (legacyInspect.payload?.agencias.length || 0) > 0,
    'Pacote ZIP legado sem historico_movimentacoes.json deve ser inspecionado sem erros.'
  );

  origemPkg.destroy();
  destinoPkg.destroy();

  console.log(
    '✅ Suite completa (Agências independentes, deduplicação, vinculação bidirecional, substituição controlada e pacote ZIP) aprovada!'
  );
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Falha na suite promotoresAgenciasBidirecional:', err);
  process.exit(1);
});
