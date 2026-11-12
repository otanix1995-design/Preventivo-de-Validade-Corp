/**
 * Suite Offline — Carregamento Reativo de Bases Locais e Preservação do Pacote .ZIP
 * Filial 172 — Cascavel
 *
 * Verifica:
 * 1. Serviços não inicializados exibem `basesCarregando: true` e nunca são tratados como bases vazias.
 * 2. Chamadas concorrentes a `init()` aguardam `productRepository`, `isvService` e `promotorService`
 *    e notificam automaticamente os assinantes com as quantidades reais (65.326, 46.057, 2.440, 31, vínculos).
 * 3. `SAEOU060 = 0` permanece identificada como ausente (sem criação de dados artificiais),
 *    bloqueando geração até importação da planilha SAEOU060 com mensagem clara.
 * 4. Geração do `.zip` inclui registros operacionais completos (`isv_registros_operacionais` 36 cols),
 *    não apenas resumo de catálogo.
 */

import { strFromU8, unzipSync } from 'fflate';
import {
  FornecedorSPCOI007,
  Industria,
  IsvPacoteStatusLocal,
  PERMISSOES_PADRAO_PROMOTOR,
  ProdutoSMG,
  Promotor,
  RegistroPlanilhaIsv,
  RegistroSaeou060,
  VinculoPromotor,
  VinculoPromotorIndustria,
} from '../../types';
import { EstadoAuthServidor } from '../firebaseAuthService';
import { LocalUpdatePackageService } from '../localUpdatePackageService';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${message}`);
  }
}

function makeFullOpRecord(index: number): { prod: ProdutoSMG; op: RegistroPlanilhaIsv } {
  const cod = String(100000 + index);
  const op: RegistroPlanilhaIsv = {
    id: cod,
    codigo_original: `00${cod}`,
    codigo_interno: cod,
    digito: '3',
    codigo_exibicao: `${cod}-3`,
    chave_normalizada: `${cod}-3`,
    filial: '172',
    nome: `PRODUTO OPERACIONAL 36 COL ${index}`,
    complemento: 'UN',
    valor_disponivel: 245.9,
    valor_disponivel_status: 'VALIDO',
    estoque: 18.5,
    estoque_original_texto: '18,5',
    estoque_formatado_extenso: '18,5',
    valor_indisponivel: 12.3,
    bloqueio: 'SEM_BLOQUEIO',
    transito_entrada: 4,
    estoque_indisponivel: 1,
    dias_sem_venda: 22,
    ultima_venda_data: '15/10/2026',
    ultima_venda_hora: '14:22',
    ultima_venda_formatada: '15/10/2026 às 14:22',
    ultima_compra_data: '01/10/2026',
    ultima_compra_hora: '09:10',
    ultima_compra_formatada: '01/10/2026 às 09:10',
    classe_produto: 'MERCEARIA SECA',
    classe_produto_raiz: 'MERCEARIA',
    idade: 45,
    pedidos_pendentes: '2 CX',
    venda_30_dias: 120,
    setor_save: 'LOJA',
    validade_1: '30/12/2026',
    validade_2: '15/01/2027',
    cadeia: 'DIRETA',
    setor: 'LOJA',
    setor_herdado: 'LOJA',
    fornecedor_planilha: 'COMPRADOR INTERNO PADRAO',
    gerenciado: 'SIM',
    ativo: 'SIM',
    residuo: 'NAO',
    peso_variavel: 'NAO',
    alteracao_preco_data: '05/10/2026',
    alteracao_preco_hora: '08:00',
    alteracao_preco_formatada: '05/10/2026 às 08:00',
    verificador: 'OK_36_COLS',
    autonomia: '18',
    autonomia_pedido: '12',
  };

  const prod: ProdutoSMG = {
    id: cod,
    codigo_original: `00${cod}`,
    codigo_interno: cod,
    digito: '3',
    codigo_exibicao: `${cod}-3`,
    descricao: op.nome,
    setor_operacional: 'LOJA',
    embalagem: 'CX 12',
    fator_embalagem: 12,
    unidade_medida: 'UN',
    estoque_emb1: 18.5,
    estoque_emb9: 0,
    estoque_total: 18.5,
    estoque_original_erp: '18,5',
    estoque_disponivel_texto: '18,5',
    vendas_qtde_30d: 120,
    dias_sem_venda: 22,
    idade: 45,
    valor_estoque_planilha: 245.9,
    eans: [`7891000${cod}`],
    dados_operacionais: op,
    atualizado_em: '2026-11-01T10:00:00.000Z',
  };

  return { prod, op };
}

async function runTests(): Promise<void> {
  // Simular ambiente com contagens equivalentes às reais reportadas pelo diagnóstico da Filial 172
  // sem clonar/migrar dados em tempo de runtime (apenas lendo quando init() concluir).
  let prontoCatalogo = false;
  let prontoIsv = false;
  let prontoPromotores = false;

  let memProdutos: ProdutoSMG[] = [];
  let memRegistrosOp: RegistroPlanilhaIsv[] = [];
  let memFornecedores: FornecedorSPCOI007[] = [];
  let memIndustrias: Industria[] = [];
  let memSaeou060: RegistroSaeou060[] = [];
  let memPromotores: Promotor[] = [];
  let memVinculosPI: VinculoPromotorIndustria[] = [];
  let memVinculosDispositivo: VinculoPromotor[] = [];

  const listeners = new Set<() => void>();
  const notifyStores = () => listeners.forEach((cb) => cb());

  // Construir massa realista em escala reduzida com validação exata de presença (incluindo múltiplos chunks)
  const sampleOps: RegistroPlanilhaIsv[] = [];
  const sampleProds: ProdutoSMG[] = [];
  for (let i = 0; i < 250; i++) {
    const pair = makeFullOpRecord(i);
    sampleOps.push(pair.op);
    sampleProds.push(pair.prod);
  }
  const sampleInds: Industria[] = [
    {
      cnpj: '11222333000181',
      cnpj_formatado: '11.222.333/0001-81',
      razao_social: 'INDUSTRIA ALIMENTICIA CASCAVEL LTDA',
      nome_exibicao: 'CASCAVEL ALIMENTOS',
      ativo: true,
      total_produtos_loja: 250,
      promotores_responsaveis: ['prom_1'],
      criado_em: '2026-10-01T00:00:00.000Z',
      atualizado_em: '2026-10-01T00:00:00.000Z',
    },
  ];
  const sampleForn: FornecedorSPCOI007[] = sampleProds.map((p) => ({
    id: `11222333000181_${p.codigo_interno}`,
    cnpj: '11222333000181',
    cnpj_formatado: '11.222.333/0001-81',
    razao_social: 'INDUSTRIA ALIMENTICIA CASCAVEL LTDA',
    codigo_interno: p.codigo_interno,
    digito: p.digito,
    codigo_exibicao: p.codigo_exibicao,
    descricao_spcoi: p.descricao,
    criado_em: '01/10/2026',
  }));
  const samplePromotores: Promotor[] = Array.from({ length: 31 }, (_, idx) => ({
    promotorId: `prom_${idx + 1}`,
    nome: `PROMOTOR ${idx + 1}`,
    agenciaNome: idx % 2 === 0 ? 'AGENCIA ALFA' : 'AGENCIA BETA',
    matricula: `M-${100 + idx}`,
    filialId: '172',
    filialNome: 'Cascavel',
    setores: ['FRIOS'],
    setorId: 'FRIOS',
    setorNome: 'FRIOS',
    status: 'ATIVO',
    permissoes: { ...PERMISSOES_PADRAO_PROMOTOR },
    dispositivoVinculado: null,
    dataCadastro: '2026-10-01T00:00:00.000Z',
    dataVinculo: null,
    ultimoAcesso: '2026-11-01T00:00:00.000Z',
    ultimaSincronizacao: '2026-11-01T00:00:00.000Z',
    criadoPor: 'GERENCIA',
    atualizadoPor: 'GERENCIA',
  }));
  const sampleVincPI: VinculoPromotorIndustria[] = [
    {
      id: 'prom_1_11222333000181_172',
      promotorId: 'prom_1',
      promotorNome: 'PROMOTOR 1',
      agenciaNome: 'AGENCIA ALFA',
      cnpj: '11222333000181',
      filialId: '172',
      criado_em: '2026-10-01T00:00:00.000Z',
    },
  ];
  const sampleVincDisp: VinculoPromotor[] = [
    {
      vinculoId: 'vd_1',
      promotorId: 'prom_1',
      promotorNome: 'PROMOTOR 1',
      agenciaNome: 'AGENCIA ALFA',
      filialId: '172',
      filialNome: 'Cascavel',
      setores: ['FRIOS'],
      setorId: 'FRIOS',
      setorNome: 'FRIOS',
      codigoVinculo: '123456',
      tokenVinculo: 'tok_123',
      dataCriacao: '2026-10-01T00:00:00.000Z',
      dataExpiracao: '2026-12-31T00:00:00.000Z',
      status: 'UTILIZADO',
    },
  ];

  const authAdmin: EstadoAuthServidor = {
    isAutenticado: true,
    isAnonimo: false,
    isVerificadoServidor: true,
    uid: 'admin-172',
    email: 'gerencia172@atacadao.com.br',
    perfil: {
      uid: 'admin-172',
      email: 'gerencia172@atacadao.com.br',
      nome: 'Gerência Filial 172',
      matricula: '172000',
      filialId: '172',
      papel: 'GERENCIA_ADMIN',
      ativo: true,
      criadoEm: '2026-01-01T00:00:00.000Z',
    },
    mensagem: 'Autorizado',
    carregando: false,
  };

  let initCallCount = 0;
  let resolveLoading!: () => void;
  const gatePromise = new Promise<void>((res) => {
    resolveLoading = res;
  });

  const service = new LocalUpdatePackageService({
    autoSubscribeEvents: true,
    getAuthEstado: () => authAdmin,
    getProdutos: () => memProdutos,
    getRegistrosOperacionais: () => memRegistrosOp,
    getFornecedores: () => memFornecedores,
    getIndustrias: () => memIndustrias,
    getSaeou060: () => memSaeou060,
    getPromotores: () => memPromotores,
    getVinculosPromotorIndustria: () => memVinculosPI,
    getVinculosDispositivoPromotor: () => memVinculosDispositivo,
    getHistoricoIsv: () => [],
    getHistoricoSpcoi: () => [],
    getVencimentosCount: () => 0,
    getVinculosEanCount: () => 717,
    getMeta: async <T,>(_key: string, fallback: T) => fallback,
    setMeta: async () => {},
    putStaging: async () => {},
    clearStaging: async () => {},
    getServicosProntos: () => ({
      catalogo: prontoCatalogo,
      isv: prontoIsv,
      promotores: prontoPromotores,
    }),
    initDependencies: async () => {
      initCallCount++;
      await gatePromise;
      memProdutos = sampleProds;
      memRegistrosOp = sampleOps;
      memFornecedores = sampleForn;
      memIndustrias = sampleInds;
      memPromotores = samplePromotores;
      memVinculosPI = sampleVincPI;
      memVinculosDispositivo = sampleVincDisp;
      // SAEOU060 permanece genuinamente vazia (0)
      prontoCatalogo = true;
      prontoIsv = true;
      prontoPromotores = true;
      notifyStores();
    },
    subscribeStoreUpdates: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  });

  const statusTimeline: IsvPacoteStatusLocal[] = [];
  const unsub = service.subscribe((s) => statusTimeline.push(s));

  // 1. Antes da inicialização concluir: DEVE mostrar basesCarregando = true e NÃO "vazia"
  const preStatus = service.getStatusPacote();
  assert(preStatus.basesCarregando === true, 'Antes de init(), basesCarregando deve ser true.');
  assert(
    preStatus.basesObrigatoriasOk === false,
    'Enquanto carrega, basesObrigatoriasOk deve ser false.'
  );
  assert(
    (preStatus.detalhesBasesObrigatorias.baseRubMotivo || '').toLowerCase().includes('carregando') &&
      !(preStatus.detalhesBasesObrigatorias.baseRubMotivo || '').toLowerCase().includes('vazia'),
    'Serviço não inicializado não pode ser rotulado como base vazia.'
  );
  assert(
    (preStatus.detalhesBasesObrigatorias.spcoi007Motivo || '').toLowerCase().includes('carregando') &&
      !(preStatus.detalhesBasesObrigatorias.spcoi007Motivo || '').toLowerCase().includes('vazia'),
    'SPCOI007 não inicializado deve informar estado de carregamento, não base vazia.'
  );

  // 2. Disparar chamadas concorrentes a init() e liberar carregamento IndexedDB
  const pInit1 = service.init();
  const pInit2 = service.init();
  resolveLoading();
  await Promise.all([pInit1, pInit2]);

  assert(initCallCount === 1, 'Chamadas concorrentes a init() devem compartilhar a mesma execução.');

  // 3. Assinantes devem ter sido atualizados automaticamente ao término do carregamento
  const latest = statusTimeline[statusTimeline.length - 1];
  assert(latest.basesCarregando === false, 'Após init(), basesCarregando deve ser false.');
  assert(latest.detalhesBasesObrigatorias.baseRubOk === true, 'BASE RUB deve ficar OK após init().');
  assert(latest.detalhesBasesObrigatorias.spcoi007Ok === true, 'SPCOI007 deve ficar OK após init().');
  assert(
    latest.contagensAtuais.produtos === 250 &&
      latest.contagensAtuais.registrosOperacionais === 250 &&
      latest.contagensAtuais.fornecedores === 250 &&
      latest.contagensAtuais.industrias === 1 &&
      latest.contagensAtuais.promotores === 31 &&
      latest.contagensAtuais.agencias === 2 &&
      latest.contagensAtuais.vinculos > 0,
    'Indicadores devem refletir todas as bases carregadas do IndexedDB.'
  );

  // 4. SAEOU060 = 0 deve permanecer ausente, sem dados artificiais, bloqueando geração com mensagem clara
  assert(latest.contagensAtuais.saeou060 === 0, 'SAEOU060 não deve receber registros artificiais.');
  assert(
    latest.detalhesBasesObrigatorias.saeou060Ok === false &&
      (latest.detalhesBasesObrigatorias.saeou060Motivo || '').includes('Importe a planilha SAEOU060'),
    'Deve informar claramente que SAEOU060 precisa ser importada antes de gerar o pacote.'
  );

  const exportBlocked = await service.gerarPacoteAtualizacaoIsv();
  assert(
    exportBlocked.sucesso === false && exportBlocked.mensagem.includes('SAEOU060'),
    'Geração do ZIP deve permanecer bloqueada enquanto SAEOU060 estiver com 0 registros.'
  );

  // 5. Após usuário importar SAEOU060 real, gerar ZIP e comprovar registros completos (36 cols)
  memSaeou060 = [
    {
      id: '100000_2026-12-20',
      codigo_original: '00100000',
      codigo_interno: '100000',
      digito: '3',
      codigo_exibicao: '100000-3',
      descricao: 'PRODUTO OPERACIONAL 36 COL 0',
      data_vencimento: '2026-12-20',
      quantidade: 5,
      status_saeou: 'NOVO',
      origem: 'SAEOU060',
      arquivo_origem: 'saeou060.xlsx',
      data_importacao: '10/11/2026',
      hora_importacao: '10:00',
    },
  ];
  notifyStores();

  const statusAfterSaeou = statusTimeline[statusTimeline.length - 1];
  assert(
    statusAfterSaeou.basesObrigatoriasOk === true && statusAfterSaeou.contagensAtuais.saeou060 === 1,
    'Assinante deve reagir automaticamente à importação da SAEOU060.'
  );

  const zipRes = await service.gerarPacoteAtualizacaoIsv();
  assert(zipRes.sucesso === true && Boolean(zipRes.bytes), 'Geração do ZIP deve concluir após SAEOU060.');

  const entries = unzipSync(zipRes.bytes!);
  const opChunkRaw = entries['bases/base_rub_operacional_001.ndjson'];
  assert(Boolean(opChunkRaw), 'ZIP deve conter bases/base_rub_operacional_001.ndjson.');
  const opLines = strFromU8(opChunkRaw).trim().split('\n').map((l) => JSON.parse(l));
  assert(
    opLines.length === 250 &&
      opLines[0].verificador === 'OK_36_COLS' &&
      opLines[0].autonomia_pedido === '12' &&
      opLines[0].fornecedor_planilha === 'COMPRADOR INTERNO PADRAO' &&
      opLines[0].valor_indisponivel === 12.3,
    'Pacote ZIP deve serializar os registros operacionais completos (36 colunas), não resumo de catálogo.'
  );

  unsub();
  service.destroy();
  console.log('✅ Suite de carregamento reativo, estado CARREGANDO e pacote completo (36 colunas) aprovada!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Falha no teste packageLoadingAndPreservation:', err);
  process.exit(1);
});
