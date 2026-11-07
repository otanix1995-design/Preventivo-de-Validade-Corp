import {
  classificarDiasSemVenda,
  isProdutoElegivelIndicadores,
  calcularTotaisClassificacao,
  obterTop30Mercadorias,
  DEFINICOES_CLASSIFICACAO,
} from '../isvClassificacaoService';
import { ItemIsv } from '../../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

console.log('🧪 Iniciando testes de classificação oficial ISV...');

// 1. Testes de Faixas de Dias Sem Venda e Cores
assert(classificarDiasSemVenda(0, 10) === null, '0 dias deve ser nulo (< 5)');
assert(classificarDiasSemVenda(4, 10) === null, '4 dias deve ser nulo (< 5)');
assert(classificarDiasSemVenda(4.9, 10) === null, '4.9 dias deve ser nulo (< 5)');

const c5 = classificarDiasSemVenda(5, 10);
assert(c5 !== null && c5.tipo === 'GIRO_NORMAL', '5 dias deve ser Giro normal');
assert(c5?.corNome === 'Verde' && c5.corHex === '#16A34A', 'Giro normal deve ser Verde (#16A34A)');

const c10 = classificarDiasSemVenda(10, 10);
assert(c10 !== null && c10.tipo === 'GIRO_NORMAL', '10 dias deve ser Giro normal');

const c11 = classificarDiasSemVenda(11, 10);
assert(c11 !== null && c11.tipo === 'ATENCAO', '11 dias deve ser Atenção');
assert(c11?.corNome === 'Amarelo' && c11.corHex === '#CA8A04', 'Atenção deve ser Amarelo (#CA8A04)');

const c15 = classificarDiasSemVenda(15, 10);
assert(c15 !== null && c15.tipo === 'ATENCAO', '15 dias deve ser Atenção');

const c16 = classificarDiasSemVenda(16, 10);
assert(c16 !== null && c16.tipo === 'ALERTA', '16 dias deve ser Alerta');
assert(c16?.corNome === 'Laranja' && c16.corHex === '#EA580C', 'Alerta deve ser Laranja (#EA580C)');

const c20 = classificarDiasSemVenda(20, 10);
assert(c20 !== null && c20.tipo === 'ALERTA', '20 dias deve ser Alerta');

const c21 = classificarDiasSemVenda(21, 10);
assert(c21 !== null && c21.tipo === 'CRITICO', '21 dias deve ser Crítico');
assert(c21?.corNome === 'Vermelho' && c21.corHex === '#DC2626', 'Crítico deve ser Vermelho (#DC2626)');

const c999 = classificarDiasSemVenda(999, 10);
assert(c999 !== null && c999.tipo === 'CRITICO', '999 dias deve ser Crítico');

// 2. Condição Obrigatória de Estoque Positivo (estoque > 0)
assert(classificarDiasSemVenda(30, 0) === null, 'Estoque zero não deve ser elegível');
assert(classificarDiasSemVenda(30, -1) === null, 'Estoque negativo não deve ser elegível');
assert(classificarDiasSemVenda(30, null) === null, 'Estoque nulo não deve ser elegível');
assert(classificarDiasSemVenda(null, 10) === null, 'Dias nulo não deve ser elegível');
assert(isProdutoElegivelIndicadores(25, 5) === true, 'Produto elegível verificado com sucesso');
assert(isProdutoElegivelIndicadores(2, 5) === false, 'Produto < 5 dias inelegível');

// 3. Teste de Totais e Deduplicação
const mockItem = (cod: string, dias: number, est: number, val: number): ItemIsv => ({
  produto: {} as any,
  codigo_interno: cod,
  digito: '0',
  codigo_exibicao: cod,
  descricao: `PRODUTO ${cod}`,
  dias_sem_venda: dias,
  idade: 30,
  estoque_total: est,
  estoque_formatado: `${est}`,
  embalagem: 'UN',
  custo_medio: val / est,
  valor_estoque: val,
  valor_estoque_formatado: `R$ ${val.toFixed(2)}`,
  setor_operacional: 'LOJA',
  elegivel_ajuste: false,
  multiplos_cnpjs: false,
  embalagem_divergente: false,
  cnpjs: [],
  industrias_nomes: ['INDÚSTRIA TESTE'],
  promotores_nomes: ['PROMOTOR TESTE'],
  agencias_nomes: ['AGÊNCIA TESTE'],
  tem_promotor: true,
});

const listaMock: ItemIsv[] = [
  mockItem('001', 30, 10, 100), // Crítico
  mockItem('002', 18, 5, 50),   // Alerta
  mockItem('003', 12, 8, 80),   // Atenção
  mockItem('004', 7, 20, 200),  // Giro Normal
  mockItem('005', 2, 15, 150),  // < 5 dias (Inelegível)
  mockItem('006', 45, 0, 0),    // Sem estoque (Inelegível)
  mockItem('001', 30, 10, 100), // DUPLICATA de 001 - deve ser ignorada
];

const totais = calcularTotaisClassificacao(listaMock);
assert(totais.totalElegiveis === 4, `Esperado 4 elegíveis, obteve ${totais.totalElegiveis}`);
assert(totais.critico.totalProdutos === 1, 'Esperado 1 crítico');
assert(totais.alerta.totalProdutos === 1, 'Esperado 1 alerta');
assert(totais.atencao.totalProdutos === 1, 'Esperado 1 atenção');
assert(totais.giroNormal.totalProdutos === 1, 'Esperado 1 giro normal');
assert(totais.totalNaoElegiveisMenor5Dias === 1, 'Esperado 1 menor que 5 dias');
assert(totais.totalSemEstoque === 1, 'Esperado 1 sem estoque');
assert(totais.totalEstoqueElegiveis === 43, `Estoque esperado 43, obteve ${totais.totalEstoqueElegiveis}`);
assert(totais.totalValorElegiveis === 430, `Valor esperado 430, obteve ${totais.totalValorElegiveis}`);

// 4. Teste do TOP 30 (Ordenação decrescente por dias, desempate por código)
const listaTop: ItemIsv[] = [
  mockItem('COD_C', 25, 10, 100), // 25 dias
  mockItem('COD_A', 35, 10, 100), // 35 dias -> deve ser 1º
  mockItem('COD_B', 25, 10, 100), // 25 dias -> empate com COD_C, mas 'COD_B' < 'COD_C', deve vir antes
  mockItem('COD_D', 4, 10, 100),  // 4 dias -> NÃO PODE ENTRAR
  mockItem('COD_E', 50, 0, 0),    // 0 estoque -> NÃO PODE ENTRAR
];

const topRes = obterTop30Mercadorias(listaTop);
assert(topRes.length === 3, `Esperado 3 produtos no top, obteve ${topRes.length}`);
assert(topRes[0].codigoInterno === 'COD_A', '1º deve ser COD_A (35 dias)');
assert(topRes[0].posicao === 1 && topRes[0].posicaoFormatada === '1º', 'Posição formatada 1º');
assert(topRes[1].codigoInterno === 'COD_B', '2º deve ser COD_B (25 dias, desempate alfanumérico)');
// 5. Teste de Fornecedor (Exclusivamente Razão Social da Indústria / NÃO IDENTIFICADO)
import { extrairFornecedorProduto, formatarEstoqueColunaUnica } from '../isvClassificacaoService';

const itemComRazao = mockItem('101', 10, 5, 50);
itemComRazao.fornecedor_razao_social = 'NESTLE BRASIL LTDA';
assert(extrairFornecedorProduto(itemComRazao) === 'NESTLE BRASIL LTDA', 'Deve retornar razão social da indústria');

const itemSemVinculo = mockItem('102', 10, 5, 50);
itemSemVinculo.fornecedor_razao_social = undefined;
itemSemVinculo.industrias_nomes = [];
(itemSemVinculo.produto as any).comprador_filial = 'COMPRADOR JOAO'; // Tentativa de comprador
assert(extrairFornecedorProduto(itemSemVinculo) === 'NÃO IDENTIFICADO', 'Sem vínculo na SPCOI007 deve retornar NÃO IDENTIFICADO e NUNCA o comprador');

// 6. Teste de Estoque com Preservação Decimal da BASE RUB
const itemEstoqueDecimal = mockItem('201', 10, 158.795, 500);
itemEstoqueDecimal.estoque_formatado = '';
(itemEstoqueDecimal.produto as any).dados_operacionais = undefined;
assert(formatarEstoqueColunaUnica(itemEstoqueDecimal) === '158,795', 'Deve preservar exatamente 3 casas decimais (158,795)');

const itemEstoqueInteiro = mockItem('202', 10, 10, 100);
itemEstoqueInteiro.estoque_formatado = '';
assert(formatarEstoqueColunaUnica(itemEstoqueInteiro) === '10', 'Estoque inteiro deve ser 10');

const itemEstoqueOriginalTexto = mockItem('203', 10, 25.5, 250);
(itemEstoqueOriginalTexto.produto as any).dados_operacionais = { estoque_original_texto: '25,500' };
assert(formatarEstoqueColunaUnica(itemEstoqueOriginalTexto) === '25,500', 'Deve preservar texto original da BASE RUB');

console.log('✅ Todos os testes de classificação, fornecedor e estoque passaram com sucesso!');
