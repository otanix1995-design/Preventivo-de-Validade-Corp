import {
  analisarProdutoParaDiagnostico,
  executarDiagnosticoSomenteLeitura,
  ProdutoStoreBreakdown,
  sintetizarCausasDiagnostico,
} from '../localDataDiagnosticService';
import { STORES } from '../db';
import { ProdutoSMG, RegistroPlanilhaIsv } from '../../types';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FALHA DE ASSERÇÃO: ${msg}`);
}

async function runTests() {
  console.log('🧪 Testando diagnóstico somente de leitura dos dados locais...');

  // 1. Classificação de produtos com dados_operacionais embutidos vs campos planos vs catálogo resumido
  const acc: ProdutoStoreBreakdown = {
    totalProdutosIndexedDB: 0,
    comDadosOperacionaisEmbutidos: 0,
    comCampos36ColunasPlanosSemObj: 0,
    somenteCatalogoResumido: 0,
    amostraOrigens: {},
    ultimaAtualizacaoMaisRecente: null,
  };

  const regOp = {
    id: '101-1',
    codigo_original: '101-1',
    codigo_interno: '101',
    digito: '1',
    codigo_exibicao: '101-1',
    chave_normalizada: '101-1',
    filial: '172',
    nome: 'RF.PRESUNTO SEARA 1KG',
    complemento: 'KG',
    valor_disponivel: 120.5,
    estoque: 10,
    estoque_original_texto: '10,000',
    dias_sem_venda: 12,
    idade: 30,
  } as RegistroPlanilhaIsv;

  const prodComDadosOp: Partial<ProdutoSMG> = {
    codigo_interno: '101',
    descricao: 'RF.PRESUNTO SEARA 1KG',
    dados_operacionais: regOp,
    atualizado_em: '2026-11-02T10:00:00.000Z',
  };

  const prodCamposPlanos: Partial<ProdutoSMG> = {
    codigo_interno: '102',
    descricao: 'QUEIJO',
    valor_indisponivel: 0,
    classe_produto: 'FRIOS',
    atualizado_em: '2026-11-03T12:00:00.000Z',
  };

  const prodSomenteCatalogo: Partial<ProdutoSMG> = {
    codigo_interno: '103',
    descricao: 'ITEM CATALOGO',
    estoque_total: 5,
  };

  analisarProdutoParaDiagnostico(prodComDadosOp, acc);
  analisarProdutoParaDiagnostico(prodCamposPlanos, acc);
  analisarProdutoParaDiagnostico(prodSomenteCatalogo, acc);

  assert(acc.totalProdutosIndexedDB === 3, 'Deve contabilizar os 3 produtos.');
  assert(acc.comDadosOperacionaisEmbutidos === 1, 'Deve detectar 1 produto com dados_operacionais completo.');
  assert(acc.comCampos36ColunasPlanosSemObj === 1, 'Deve detectar 1 produto com campos planos das 36 colunas.');
  assert(acc.somenteCatalogoResumido === 1, 'Deve detectar 1 produto somente de catálogo resumido.');
  assert(acc.ultimaAtualizacaoMaisRecente === '2026-11-03T12:00:00.000Z', 'Deve identificar a data mais recente.');

  // 2. Síntese automática quando isv_registros_operacionais está vazio no IDB, mas produtos tem dados_operacionais
  const counts = new Map<string, number>([
    [STORES.PRODUTOS, 65326],
    [STORES.ISV_REGISTROS_OPERACIONAIS, 0],
    [STORES.SPCOI007_FORNECEDORES, 4200],
    [STORES.INDUSTRIAS, 180],
    [STORES.SAEOU060, 310],
    [STORES.PROMOTORES, 12],
    [STORES.VINCULOS_PROMOTOR_INDUSTRIA, 45],
  ]);

  const causas = sintetizarCausasDiagnostico({
    comparativo: [],
    breakdownProdutos: {
      totalProdutosIndexedDB: 65326,
      comDadosOperacionaisEmbutidos: 65326,
      comCampos36ColunasPlanosSemObj: 0,
      somenteCatalogoResumido: 0,
      amostraOrigens: {},
      ultimaAtualizacaoMaisRecente: '2026-11-03T12:00:00.000Z',
    },
    metadadosArmazenados: [
      { key: 'meta_spcoi_sync', resumo: '{"status":"LIMPA_AGUARDANDO_IMPORTACAO"}' },
    ],
    countsByStore: counts,
  });

  assert(
    causas.some((c) => c.codigo === 'DADOS_36_COL_EMBUTIDOS_EM_PRODUTOS'),
    'Deve identificar que os dados de 36 colunas estão preservados dentro de STORES.PRODUTOS.'
  );
  assert(
    causas.some((c) => c.codigo === 'SPCOI_E_VINCULOS_EM_REPOUSO_IDB'),
    'Deve identificar SPCOI007 e vínculos em repouso no IndexedDB quando isvService não iniciou.'
  );
  assert(
    causas.some((c) => c.codigo === 'PROMOTOR_SERVICE_NAO_INICIALIZADO_NO_BOOT'),
    'Deve identificar Promotores em repouso no IndexedDB quando promotorService não iniciou.'
  );

  // 3. Execução segura em ambiente sem IndexedDB (somente leitura, sem exceções)
  const rel = await executarDiagnosticoSomenteLeitura();
  assert(rel.somenteLeitura === true, 'Relatório deve marcar explicitamente somenteLeitura=true.');
  assert(Array.isArray(rel.contagensStores) && rel.contagensStores.length >= 19, 'Deve listar todas as objectStores.');

  console.log('✅ Todos os testes do Diagnóstico Somente Leitura passaram!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Falha no teste de diagnóstico:', err);
  process.exit(1);
});
