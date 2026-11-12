/**
 * Suite Automatizada Offline — Transferência em Massa de Indústrias entre Promotores
 * Filial 172 — Cascavel
 *
 * Cenários cobertos (Requisito 15):
 * 1. Bloqueio por ausência de confirmação explícita (`confirmarTransferencia !== true`).
 * 2. Transferência completa ("TODAS") com criação de novo substituto/agência e inativação do anterior.
 * 3. Transferência parcial ("MANUAL") mantendo não selecionadas na origem.
 * 4. Prevenção de duplicidade quando o substituto já possui vínculo na mesma indústria.
 * 5. Falha atômica (erro em vínculos e erro posterior na substituição) com rollback completo + recuperação.
 * 6. Atualização imediata de Dashboard, Ranking de Indústrias, filtros de agência e compatibilidade ZIP
 *    com preservação integral de BASE RUB, SPCOI007, SAEOU060, vencimentos, EANs e histórico.
 */

import { strFromU8, unzipSync } from 'fflate';
import {
  FornecedorSPCOI007,
  Industria,
  PERMISSOES_PADRAO_PROMOTOR,
  ProdutoSMG,
  Promotor,
  RegistroPlanilhaIsv,
  RegistroSaeou060,
  VinculoPromotor,
  VinculoPromotorIndustria,
} from '../../types';
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
    dias_sem_venda: 14,
    ultima_venda_data: '',
    ultima_venda_hora: '',
    ultima_venda_formatada: '',
    ultima_compra_data: '',
    ultima_compra_hora: '',
    ultima_compra_formatada: '',
    classe_produto: 'FRIOS',
    classe_produto_raiz: 'FRIOS',
    idade: 35,
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
    dias_sem_venda: 14,
    idade: 35,
    valor_estoque_planilha: valor,
    eans: [`789172${codigo}`],
    dados_operacionais: op,
    atualizado_em: '2026-11-12T10:00:00.000Z',
  };

  return { prod, op };
}

function makeIndustria(cnpj: string, cnpjFormatado: string, nome: string): Industria {
  return {
    cnpj,
    cnpj_formatado: cnpjFormatado,
    razao_social: `${nome} LTDA`,
    nome_exibicao: nome,
    ativo: true,
    total_produtos_loja: 1,
    promotores_responsaveis: [],
    criado_em: '2026-11-01T00:00:00.000Z',
    atualizado_em: '2026-11-01T00:00:00.000Z',
  };
}

async function runTests(): Promise<void> {
  await Promise.all([promotorService.init(), isvService.init()]);

  // =========================================================================
  // SEED INICIAL: 31 promotores legados, 40 vínculos de dispositivo, 4 indústrias SPCOI007
  // =========================================================================
  const promotoresBase: Promotor[] = Array.from({ length: 31 }, (_, i) => ({
    promotorId: `prom_tm_${i + 1}`,
    nome: `PROMOTOR BASE ${i + 1}`,
    agenciaNome: i < 16 ? 'Agência Regional Norte' : 'Agência Sul Comércio',
    matricula: `TM-${200 + i}`,
    filialId: '172',
    filialNome: 'Cascavel',
    setores: ['FRIOS'],
    setorId: 'FRIOS',
    setorNome: 'FRIOS',
    status: 'ATIVO',
    permissoes: { ...PERMISSOES_PADRAO_PROMOTOR },
    dispositivoVinculado: {
      dispositivoId: `dev_tm_${i + 1}`,
      dispositivoNome: `Coletor ${i + 1}`,
      dataPrimeiroVinculo: '2026-10-01T10:00:00.000Z',
      ultimoAcesso: '2026-11-10T10:00:00.000Z',
    },
    dataCadastro: '2026-10-01T10:00:00.000Z',
    dataVinculo: '2026-10-01T10:00:00.000Z',
    ultimoAcesso: null,
    ultimaSincronizacao: null,
    criadoPor: 'GERENCIA',
    atualizadoPor: 'GERENCIA',
  }));

  const vinculosDispBase: VinculoPromotor[] = Array.from({ length: 40 }, (_, i) => ({
    vinculoId: `vd_tm_${i + 1}`,
    promotorId: promotoresBase[i % 31].promotorId,
    promotorNome: promotoresBase[i % 31].nome,
    agenciaNome: promotoresBase[i % 31].agenciaNome,
    filialId: '172',
    filialNome: 'Cascavel',
    setores: ['FRIOS'],
    setorId: 'FRIOS',
    setorNome: 'FRIOS',
    codigoVinculo: String(300000 + i),
    tokenVinculo: `tok_tm_${i + 1}`,
    dataCriacao: '2026-10-01T10:00:00.000Z',
    dataExpiracao: '2026-12-31T23:59:59.000Z',
    status: 'UTILIZADO',
  }));

  await promotorService.substituirDadosComerciaisDePacote({
    promotores: promotoresBase,
    vinculosDispositivoPromotor: vinculosDispBase,
  });

  const ind1 = makeIndustria('11111111000111', '11.111.111/0001-11', 'SEARA ALIMENTOS');
  const ind2 = makeIndustria('22222222000122', '22.222.222/0001-22', 'SADIA BRF');
  const ind3 = makeIndustria('33333333000133', '33.333.333/0001-33', 'AURORA COOP');
  const ind4 = makeIndustria('44444444000144', '44.444.444/0001-44', 'FRIMESA CENTRAL');

  const r1 = makeOpRecord('5001', 'LINGUICA CALABRESA SEARA', 1800);
  const r2 = makeOpRecord('5002', 'NUGGETS TRADICIONAL SADIA', 1400);
  const r3 = makeOpRecord('5003', 'PRESUNTO COZIDO AURORA', 1100);
  const r4 = makeOpRecord('5004', 'QUEIJO PRATO FRIMESA', 950);

  const fornecedores: FornecedorSPCOI007[] = [
    {
      id: `${ind1.cnpj}_5001`,
      cnpj: ind1.cnpj,
      cnpj_formatado: ind1.cnpj_formatado,
      razao_social: ind1.razao_social,
      codigo_interno: '5001',
      digito: '1',
      codigo_exibicao: '5001-1',
      descricao_spcoi: r1.prod.descricao,
      criado_em: '01/11/2026',
    },
    {
      id: `${ind2.cnpj}_5002`,
      cnpj: ind2.cnpj,
      cnpj_formatado: ind2.cnpj_formatado,
      razao_social: ind2.razao_social,
      codigo_interno: '5002',
      digito: '1',
      codigo_exibicao: '5002-1',
      descricao_spcoi: r2.prod.descricao,
      criado_em: '01/11/2026',
    },
    {
      id: `${ind3.cnpj}_5003`,
      cnpj: ind3.cnpj,
      cnpj_formatado: ind3.cnpj_formatado,
      razao_social: ind3.razao_social,
      codigo_interno: '5003',
      digito: '1',
      codigo_exibicao: '5003-1',
      descricao_spcoi: r3.prod.descricao,
      criado_em: '01/11/2026',
    },
    {
      id: `${ind4.cnpj}_5004`,
      cnpj: ind4.cnpj,
      cnpj_formatado: ind4.cnpj_formatado,
      razao_social: ind4.razao_social,
      codigo_interno: '5004',
      digito: '1',
      codigo_exibicao: '5004-1',
      descricao_spcoi: r4.prod.descricao,
      criado_em: '01/11/2026',
    },
  ];

  const promOrigem = promotorService.getPromotorById('prom_tm_1')!;
  const promParcialDest = promotorService.getPromotorById('prom_tm_2')!;
  const promDupDest = promotorService.getPromotorById('prom_tm_3')!;

  const vinculosIniciais: VinculoPromotorIndustria[] = [ind1, ind2, ind3, ind4].map((ind) => ({
    id: `${promOrigem.promotorId}_${ind.cnpj}_172`,
    promotorId: promOrigem.promotorId,
    promotorNome: promOrigem.nome,
    agenciaNome: promOrigem.agenciaNome,
    cnpj: ind.cnpj,
    filialId: '172',
    criado_em: '2026-11-01T00:00:00.000Z',
  }));

  await isvService.aplicarDadosPacote({
    registrosOperacionais: [r1.op, r2.op, r3.op, r4.op],
    fornecedores,
    industrias: [ind1, ind2, ind3, ind4],
    vinculosPromotorIndustria: vinculosIniciais,
  });

  // =========================================================================
  // 1. SEGURANÇA: BLOQUEIO SEM CONFIRMAÇÃO EXPLÍCITA
  // =========================================================================
  await assertThrowsAsync(
    () =>
      isvService.transferirVinculosIndustriaEmMassa(promOrigem.promotorId, promParcialDest, {
        confirmarTransferencia: false,
      }),
    'Transferência em massa deve falhar se confirmarTransferencia !== true.'
  );
  assert(
    isvService.getIndustriasDoPromotor(promOrigem.promotorId).length === 4,
    'Sem confirmação explícita, nenhum vínculo pode sair da origem.'
  );

  // =========================================================================
  // 2. TRANSFERÊNCIA PARCIAL ("MANUAL") + PRÉVIA EXATA
  // =========================================================================
  const previaParcial = isvService.simularTransferenciaVinculosIndustria(
    promOrigem.promotorId,
    promParcialDest.promotorId,
    [ind1.cnpj, ind2.cnpj]
  );
  assert(
    previaParcial.totalOrigem === 4 &&
      previaParcial.totalSelecionadas === 2 &&
      previaParcial.novasNoDestino === 2 &&
      previaParcial.jaVinculadasNoDestino === 0 &&
      previaParcial.permanecemNaOrigem === 2,
    'Prévia parcial deve calcular exatamente 2 selecionadas, 2 novas e 2 remanescentes na origem.'
  );

  const resParcial = await promotorService.substituirPromotor({
    promotorAntigoId: promOrigem.promotorId,
    promotorSubstitutoId: promParcialDest.promotorId,
    desvincularAntigoDaAgencia: false,
    inativarAntigo: false,
    confirmarTransferenciaVinculosIndustrias: true,
    modoTransferencia: 'MANUAL',
    cnpjsSelecionados: [ind1.cnpj, ind2.cnpj],
    motivo: 'Divisão de carteira parcial entre rotas',
    onTransferirVinculosDetalhado: (origemId, destino, cnpjs) =>
      isvService.transferirVinculosIndustriaEmMassa(origemId, destino, {
        confirmarTransferencia: true,
        cnpjs,
        removerDaOrigem: true,
        filialId: '172',
      }),
  });

  assert(
    resParcial.cnpjsTransferidos.length === 2 &&
      isvService.getIndustriasDoPromotor(promParcialDest.promotorId).length === 2 &&
      isvService.getIndustriasDoPromotor(promOrigem.promotorId).length === 2,
    'Transferência parcial deve mover apenas ind1 e ind2, mantendo ind3 e ind4 na origem.'
  );

  const cnpjsOrigemRestantes = isvService
    .getIndustriasDoPromotor(promOrigem.promotorId)
    .map((i) => i.cnpj)
    .sort();
  assert(
    cnpjsOrigemRestantes[0] === ind3.cnpj && cnpjsOrigemRestantes[1] === ind4.cnpj,
    'Indústrias não selecionadas (ind3 e ind4) devem permanecer vinculadas ao promotor de origem.'
  );

  // =========================================================================
  // 3. PREVENÇÃO DE DUPLICIDADE QUANDO SUBSTITUTO JÁ POSSUI VÍNCULO NA MESMA INDÚSTRIA
  // =========================================================================
  // Pré-vincular promDupDest à ind3 (simulando vínculo preexistente no substituto)
  await isvService.vincularPromotorIndustria(promDupDest, ind3.cnpj, '172');

  const previaDup = isvService.simularTransferenciaVinculosIndustria(
    promOrigem.promotorId,
    promDupDest.promotorId,
    [ind3.cnpj, ind4.cnpj]
  );
  assert(
    previaDup.totalOrigem === 2 &&
      previaDup.totalSelecionadas === 2 &&
      previaDup.jaVinculadasNoDestino === 1 &&
      previaDup.novasNoDestino === 1 &&
      previaDup.cnpjsJaNoDestino.includes(ind3.cnpj),
    'Prévia deve acusar 1 duplicidade evitada em ind3 e 1 novo vínculo em ind4.'
  );

  // =========================================================================
  // 4. FALHA ATÔMICA E ROLLBACK + RECUPERAÇÃO
  // =========================================================================
  // 4A. Falha dentro da persistência do isvService -> rollback completo dos vínculos
  await assertThrowsAsync(
    () =>
      isvService.transferirVinculosIndustriaEmMassa(promOrigem.promotorId, promDupDest, {
        confirmarTransferencia: true,
        cnpjs: [ind3.cnpj, ind4.cnpj],
        persistirAtomicamente: async () => {
          throw new Error('FALHA_SIMULADA_BATCH_ISV');
        },
      }),
    'Erro na camada de persistência ISV deve propagar e disparar rollback.'
  );
  assert(
    isvService.getIndustriasDoPromotor(promOrigem.promotorId).length === 2 &&
      isvService.getIndustriasDoPromotor(promDupDest.promotorId).length === 1,
    'Após falha em isvService, vínculos da origem (2) e destino (1) devem ficar 100% íntegros.'
  );

  // 4B. Falha posterior no coordenador substituirPromotor (após transferir vínculos) -> rollback integral
  const histAntesFalha = promotorService.getHistoricoMovimentacoes().length;
  await assertThrowsAsync(
    () =>
      promotorService.substituirPromotor({
        promotorAntigoId: promOrigem.promotorId,
        promotorSubstitutoId: promDupDest.promotorId,
        desvincularAntigoDaAgencia: true,
        inativarAntigo: true,
        confirmarTransferenciaVinculosIndustrias: true,
        modoTransferencia: 'TODAS',
        cnpjsSelecionados: [ind3.cnpj, ind4.cnpj],
        onTransferirVinculosDetalhado: (origemId, destino, cnpjs) =>
          isvService.transferirVinculosIndustriaEmMassa(origemId, destino, {
            confirmarTransferencia: true,
            cnpjs,
          }),
        persistirSubstituicaoHook: async () => {
          throw new Error('FALHA_SIMULADA_COMMIT_SUBSTITUICAO');
        },
      }),
    'Erro na efetivação de substituirPromotor deve falhar e acionar rollback.'
  );

  assert(
    promotorService.getPromotorById(promOrigem.promotorId)?.status === 'ATIVO' &&
      isvService.getIndustriasDoPromotor(promOrigem.promotorId).length === 2 &&
      isvService.getIndustriasDoPromotor(promDupDest.promotorId).length === 1 &&
      promotorService.getHistoricoMovimentacoes().length === histAntesFalha,
    'Rollback de falha posterior deve reverter vínculos já transferidos, manter origem ATIVO e não sujar histórico.'
  );

  // 4C. Recuperação: criar nova agência + cadastrar novo substituto e executar transferência COMPLETA com sucesso
  const novaAgencia = await promotorService.cadastrarAgencia({
    nome: 'Agência Expansão Cascavel',
    contato: 'Juliana',
  });
  const novoSubstituto = await promotorService.cadastrarPromotor({
    nome: 'Marcos Vinicius',
    agenciaId: novaAgencia.agenciaId,
    setores: ['FRIOS', 'LOJA'],
  });
  // Vincular novoSubstituto a ind3 antes para testar duplicidade também no cenário completo
  await isvService.vincularPromotorIndustria(novoSubstituto, ind3.cnpj, '172');

  let dashboardReativoDisparado = 0;
  const unsubIsv = isvService.subscribe(() => {
    dashboardReativoDisparado++;
  });

  const resCompleto = await promotorService.substituirPromotor({
    promotorAntigoId: promOrigem.promotorId,
    promotorSubstitutoId: novoSubstituto.promotorId,
    novaAgenciaSubstitutoId: novaAgencia.agenciaId,
    desvincularAntigoDaAgencia: true,
    inativarAntigo: true,
    confirmarTransferenciaVinculosIndustrias: true,
    modoTransferencia: 'TODAS',
    cnpjsSelecionados: [ind3.cnpj, ind4.cnpj],
    motivo: 'Recuperação após falha e transferência completa de carteira',
    onTransferirVinculosDetalhado: (origemId, destino, cnpjs) =>
      isvService.transferirVinculosIndustriaEmMassa(origemId, destino, {
        confirmarTransferencia: true,
        cnpjs,
        removerDaOrigem: true,
      }),
  });
  unsubIsv();

  // Verificar resultado da recuperação + deduplicação + inativação
  assert(
    resCompleto.cnpjsTransferidos.length === 2 &&
      resCompleto.cnpjsJaExistentesNoDestino.includes(ind3.cnpj) &&
      resCompleto.cnpjsNovosNoDestino.includes(ind4.cnpj) &&
      isvService.getIndustriasDoPromotor(promOrigem.promotorId).length === 0 &&
      isvService.getIndustriasDoPromotor(novoSubstituto.promotorId).length === 2,
    'Transferência completa deve mover ind3 e ind4 sem duplicar ind3 no substituto.'
  );

  // Garantir que não houve duplicação no array bruto de vínculos para (novoSubstituto, ind3)
  const vincInd3Subs = isvService
    .getVinculosPromotorIndustria()
    .filter((v) => v.promotorId === novoSubstituto.promotorId && v.cnpj === ind3.cnpj);
  assert(
    vincInd3Subs.length === 1,
    'Substituto não pode ficar com vínculos duplicados na mesma indústria.'
  );

  const origemApos = promotorService.getPromotorById(promOrigem.promotorId)!;
  assert(
    origemApos.status === 'INATIVO' && origemApos.agenciaId === null && origemApos.agenciaNome === '',
    'Promotor anterior deve ficar INATIVO e desvinculado sem exclusão do histórico.'
  );

  // =========================================================================
  // 5. PRESERVAÇÃO DO HISTÓRICO COMPLETO (ORIGEM, DESTINO, DATA E INDÚSTRIAS)
  // =========================================================================
  const historicoOrigem = promotorService.getHistoricoMovimentacoes({
    promotorId: promOrigem.promotorId,
  });
  const regTransferencia = historicoOrigem.find((h) => h.tipo === 'VINCULOS_INDUSTRIAS_TRANSFERIDOS');
  const regSubstituicao = historicoOrigem.find((h) => h.tipo === 'PROMOTOR_SUBSTITUIDO');

  assert(
    Boolean(regTransferencia) &&
      Boolean(regSubstituicao) &&
      Boolean(regTransferencia!.dataHora) &&
      regTransferencia!.promotorId === promOrigem.promotorId &&
      regTransferencia!.promotorSubstitutoId === novoSubstituto.promotorId &&
      regTransferencia!.agenciaId === novaAgencia.agenciaId &&
      regTransferencia!.agenciaNome === novaAgencia.nome &&
      (regTransferencia!.industriasTransferidas?.length || 0) === 2 &&
      regTransferencia!.modoTransferencia === 'TODAS' &&
      regTransferencia!.inativacaoOrigem === true,
    'Histórico de atendimento deve preservar data, origem, destino, agência e todas as indústrias transferidas.'
  );

  // =========================================================================
  // 6. ATUALIZAÇÃO IMEDIATA DO DASHBOARD, RANKING DE INDÚSTRIAS E FILTROS
  // =========================================================================
  const prods = [r1.prod, r2.prod, r3.prod, r4.prod];
  const itensAtualizados = isvService.getItensIsv(prods);
  const filtrosBase = {
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
  const dash = isvService.getDashboardData(itensAtualizados, filtrosBase);
  const rankInd4 = dash.rankingIndustriasTodos.find((i) => i.cnpj === ind4.cnpj);
  const filtradosNovaAgencia = isvService.filtrarItensIsv(itensAtualizados, {
    ...filtrosBase,
    agencia: novaAgencia.nome,
  });

  assert(
    dashboardReativoDisparado >= 1 &&
      Boolean(rankInd4) &&
      rankInd4!.promotoresVinculados.some(
        (p) => p.promotorId === novoSubstituto.promotorId && p.agenciaNome === novaAgencia.nome
      ) &&
      filtradosNovaAgencia.some((it) => it.cnpjs.includes(ind4.cnpj)),
    'Dashboard, Ranking de Indústrias e filtro por agência devem refletir imediatamente o novo substituto.'
  );

  // =========================================================================
  // 7. COMPATIBILIDADE COM PACOTE ZIP E PRESERVAÇÃO DE TODAS AS BASES
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
      id: '5001_2026-12-20',
      codigo_original: '005001',
      codigo_interno: '5001',
      digito: '1',
      codigo_exibicao: '5001-1',
      descricao: r1.prod.descricao,
      data_vencimento: '2026-12-20',
      quantidade: 3,
      status_saeou: 'NOVO',
      origem: 'SAEOU060',
      arquivo_origem: 'saeou060.xlsx',
      data_importacao: '10/11/2026',
      hora_importacao: '08:00',
    },
  ];

  const metaStore = new Map<string, any>();
  const vencimentosPreservadosAntes = 18;
  const eansPreservadosAntes = 717;

  const pkgOrigem = new LocalUpdatePackageService({
    getAuthEstado: () => authAdmin,
    getProdutos: () => prods,
    getRegistrosOperacionais: () => [r1.op, r2.op, r3.op, r4.op],
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
    getVencimentosCount: () => vencimentosPreservadosAntes,
    getVinculosEanCount: () => eansPreservadosAntes,
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

  await pkgOrigem.init();
  const zipRes = await pkgOrigem.gerarPacoteAtualizacaoIsv();
  assert(zipRes.sucesso && Boolean(zipRes.bytes), 'Exportação do pacote ZIP após transferência deve ter sucesso.');

  const zipFiles = unzipSync(zipRes.bytes!);
  const histZip = JSON.parse(strFromU8(zipFiles['comercial/historico_movimentacoes.json']));
  assert(
    Array.isArray(histZip) &&
      histZip.some(
        (m: any) =>
          m.tipo === 'VINCULOS_INDUSTRIAS_TRANSFERIDOS' &&
          m.promotorSubstitutoId === novoSubstituto.promotorId &&
          Array.isArray(m.industriasTransferidas) &&
          m.industriasTransferidas.length === 2
      ),
    'Pacote ZIP deve exportar os detalhes completos das indústrias transferidas no histórico.'
  );

  // Instalar em dispositivo destino e verificar preservação integral
  let destVenc = vencimentosPreservadosAntes;
  let destEan = eansPreservadosAntes;
  let destProds: ProdutoSMG[] = [];
  let destVinculosPI: VinculoPromotorIndustria[] = [];
  let destPromotores: Promotor[] = [];
  let destHistorico: any[] = [];

  const pkgDestino = new LocalUpdatePackageService({
    getAuthEstado: () => ({
      isAutenticado: false,
      isAnonimo: true,
      isVerificadoServidor: false,
      uid: null,
      email: null,
      perfil: null,
      mensagem: 'Operador local',
      carregando: false,
    }),
    getProdutos: () => destProds,
    getRegistrosOperacionais: () => [],
    getFornecedores: () => [],
    getIndustrias: () => [],
    getSaeou060: () => [],
    getPromotores: () => destPromotores,
    getAgencias: () => [],
    getHistoricoMovimentacoes: () => destHistorico,
    getVinculosPromotorIndustria: () => destVinculosPI,
    getVinculosDispositivoPromotor: () => [],
    getHistoricoIsv: () => [],
    getHistoricoSpcoi: () => [],
    getVencimentosCount: () => destVenc,
    getVinculosEanCount: () => destEan,
    getMeta: async <T,>(k: string, fb: T) => (metaStore.has(`d_${k}`) ? (metaStore.get(`d_${k}`) as T) : fb),
    setMeta: async (k, v) => {
      metaStore.set(`d_${k}`, v);
    },
    putStaging: async () => {},
    clearStaging: async () => {},
    getServicosProntos: () => ({ catalogo: true, isv: true, promotores: true }),
    initDependencies: async () => {},
    subscribeStoreUpdates: () => () => {},
    aplicarCatalogoESaeou: async ({ produtos }) => {
      destProds = produtos;
      return {
        vencimentosPreservados: destVenc,
        vinculosEanPreservados: destEan,
      };
    },
    aplicarIsv: async ({ vinculosPromotorIndustria }) => {
      destVinculosPI = vinculosPromotorIndustria;
    },
    aplicarPromotores: async ({ promotores, historicoMovimentacoes }) => {
      destPromotores = promotores;
      destHistorico = historicoMovimentacoes || [];
    },
  });

  await pkgDestino.init();
  const insp = await pkgDestino.inspecionarPacoteAtualizacaoIsv(zipRes.bytes!);
  assert(insp.validoParaInstalacao === true, 'Pacote ZIP deve passar na inspeção SHA-256 no dispositivo destino.');

  const inst = await pkgDestino.instalarPacoteAtualizacaoIsv(insp, {
    confirmarSubstituicaoBases: true,
  });

  assert(
    inst.sucesso === true &&
      destProds.length === 4 &&
      destPromotores.length === 32 &&
      destPromotores.some((p) => p.promotorId === promOrigem.promotorId && p.status === 'INATIVO') &&
      destVinculosPI.filter((v) => v.promotorId === novoSubstituto.promotorId).length === 2 &&
      destHistorico.some((h) => h.tipo === 'VINCULOS_INDUSTRIAS_TRANSFERIDOS') &&
      inst.preservacaoGarantida?.vencimentosPreservados === vencimentosPreservadosAntes &&
      inst.preservacaoGarantida?.vinculosEanPreservados === eansPreservadosAntes,
    'Instalação ZIP deve preservar BASE RUB, promotores (incluindo INATIVO), histórico, vencimentos e EANs.'
  );

  pkgOrigem.destroy();
  pkgDestino.destroy();

  console.log(
    '✅ Suite completa (Transferência completa, parcial, duplicidade, falha atômica + rollback, recuperação, Dashboard reativo e pacote ZIP) aprovada!'
  );
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Falha na suite transferenciaMassaPromotores:', err);
  process.exit(1);
});
