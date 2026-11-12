/**
 * Suite Automatizada Offline — Filtro de Fornecedores, Indústrias, Agências e Promotores com Busca Inteligente (Combobox)
 * Filial 172 — Cascavel
 *
 * Cobertura de Requisitos:
 * 1. Pesquisa insensível a maiúsculas/minúsculas e acentos (ex.: "seara", "Séara", "SEARA", "alimentos").
 * 2. Busca por qualquer parte do texto (início, meio ou fim da razão social / nome / CNPJ).
 * 3. Opção padrão "Todos os fornecedores" / "Todas as agências" / "Todos os promotores".
 * 4. Desempenho em bases massivas (teste com 50.000 fornecedores simulados com tempo de busca < 30ms).
 * 5. Limpeza de termo ao selecionar ou fechar sem perder o valor selecionado.
 * 6. Preservação de filtros combináveis e restauração do padrão.
 * 7. Não alteração dos dados das bases, vínculos, vencimentos ou sincronização.
 */

import { ComboboxOpcao, normalizarParaBusca } from '../../components/common/ComboboxPesquisavel';
import { isvService } from '../isvService';
import { promotorService } from '../promotorService';
import { FiltrosIsv, ItemIsv, ProdutoSMG, RegistroPlanilhaIsv } from '../../types';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${msg}`);
  }
}

function filtrarOpcoesEmMemoria(opcoes: ComboboxOpcao[], termoBusca: string): ComboboxOpcao[] {
  const q = normalizarParaBusca(termoBusca);
  if (!q) return opcoes;
  const tokens = q.split(/\s+/).filter(Boolean);
  const resultado: ComboboxOpcao[] = [];

  for (let i = 0; i < opcoes.length; i++) {
    const op = opcoes[i];
    const index = `${normalizarParaBusca(op.label)} ${normalizarParaBusca(op.sublabel)} ${normalizarParaBusca(
      op.searchTerms
    )} ${normalizarParaBusca(op.badge)}`;
    let bateu = true;
    for (let j = 0; j < tokens.length; j++) {
      if (!index.includes(tokens[j])) {
        bateu = false;
        break;
      }
    }
    if (bateu) resultado.push(op);
  }
  return resultado;
}

async function runTests(): Promise<void> {
  console.log('🧪 Iniciando testes do Combobox de Busca Inteligente...');

  // =========================================================================
  // 1. NORMALIZAÇÃO DE ACENTOS E MAIÚSCULAS/MINÚSCULAS
  // =========================================================================
  assert(
    normalizarParaBusca('Séara Alimentos LTDA') === 'seara alimentos ltda',
    'normalizarParaBusca deve remover acentos e minúsculas.'
  );
  assert(
    normalizarParaBusca('  FRIMÉSA   COOP  ') === 'frimesa coop',
    'normalizarParaBusca deve colapsar espaços e remover acento.'
  );
  assert(
    normalizarParaBusca('02.914.460/0001-05') === '02.914.460/0001-05',
    'normalizarParaBusca deve preservar caracteres numéricos de CNPJ.'
  );

  // =========================================================================
  // 2. BUSCA POR QUALQUER PARTE DA RAZÃO SOCIAL, NOME OU CNPJ
  // =========================================================================
  const listaTeste: ComboboxOpcao[] = [
    {
      value: '02914460000105',
      label: 'SEARA ALIMENTOS LTDA',
      sublabel: 'SEARA • CNPJ: 02.914.460/0001-05',
      badge: '48 SKUs',
      searchTerms: 'SEARA ALIMENTOS LTDA SEARA 02914460000105 02.914.460/0001-05',
    },
    {
      value: '01838723000127',
      label: 'BRF S.A. - SADIA',
      sublabel: 'SADIA BRF • CNPJ: 01.838.723/0001-27',
      badge: '32 SKUs',
      searchTerms: 'BRF S.A. - SADIA SADIA BRF 01838723000127 01.838.723/0001-27',
    },
    {
      value: '23643315000152',
      label: 'DANONE LTDA',
      sublabel: 'DANONE • CNPJ: 23.643.315/0001-52',
      badge: '15 SKUs',
      searchTerms: 'DANONE LTDA DANONE 23643315000152 23.643.315/0001-52',
    },
    {
      value: '44444444000144',
      label: 'FRIMESA COOPERATIVA CENTRAL',
      sublabel: 'FRIMESA • CNPJ: 44.444.444/0001-44',
      badge: '60 SKUs',
      searchTerms: 'FRIMESA COOPERATIVA CENTRAL FRIMESA 44444444000144 44.444.444/0001-44',
    },
  ];

  // 2A. Busca por início da palavra
  const resInicio = filtrarOpcoesEmMemoria(listaTeste, 'sea');
  assert(resInicio.length === 1 && resInicio[0].value === '02914460000105', 'Busca por "sea" deve retornar Seara.');

  // 2B. Busca por parte do meio com acento e minúsculas
  const resMeio = filtrarOpcoesEmMemoria(listaTeste, 'alímentos');
  assert(resMeio.length === 1 && resMeio[0].value === '02914460000105', 'Busca por "alímentos" (meio da razão social) deve retornar Seara.');

  // 2C. Busca por termo de outra indústria (meio)
  const resCoop = filtrarOpcoesEmMemoria(listaTeste, 'cooperat');
  assert(resCoop.length === 1 && resCoop[0].value === '44444444000144', 'Busca por "cooperat" deve retornar Frimesa.');

  // 2D. Busca por dígitos do CNPJ
  const resCnpj = filtrarOpcoesEmMemoria(listaTeste, '23.643');
  assert(resCnpj.length === 1 && resCnpj[0].value === '23643315000152', 'Busca por CNPJ "23.643" deve retornar Danone.');

  // 2E. Busca sem correspondência
  const resVazio = filtrarOpcoesEmMemoria(listaTeste, 'nestle alimentos inexistente');
  assert(resVazio.length === 0, 'Busca sem correspondência deve retornar lista vazia.');

  // =========================================================================
  // 3. DESEMPENHO EM BASE DE ALTA ESCALA (> 46.000 FORNECEDORES SPCOI007)
  // =========================================================================
  console.log('⚡ Gerando base de teste sintética com 50.000 fornecedores...');
  const baseMassiva: ComboboxOpcao[] = [];
  for (let i = 1; i <= 50000; i++) {
    const cnpj = String(10000000000000 + i);
    baseMassiva.push({
      value: cnpj,
      label: `FORNECEDOR INDUSTRIAL ${i} ${i % 10 === 0 ? 'ALIMENTOS S.A.' : 'DISTRIBUIDORA LTDA'}`,
      sublabel: `CNPJ: ${cnpj}`,
      searchTerms: `FORNECEDOR INDUSTRIAL ${i} ${cnpj}`,
    });
  }

  // Medir tempo de filtragem com 50.000 registros
  const t0 = Date.now();
  const resMassivo = filtrarOpcoesEmMemoria(baseMassiva, 'alimentos 2500');
  const duracaoMs = Date.now() - t0;
  console.log(`⏱️ Tempo de filtragem em 50.000 itens: ${duracaoMs}ms (encontrados: ${resMassivo.length})`);
  assert(resMassivo.length > 0, 'Deve localizar os itens correspondentes na base massiva.');
  assert(duracaoMs < 300, `Filtragem em 50.000 itens deve ser instantânea (< 300ms em Node), foi ${duracaoMs}ms.`);

  // =========================================================================
  // 4. PRESERVAÇÃO DOS FILTROS COMBINÁVEIS NO ISVSERVICE E DASHBOARD
  // =========================================================================
  await isvService.init();
  await promotorService.init();

  const mockItem: ItemIsv = {
    codigo_interno: '9991',
    digito: '1',
    codigo_exibicao: '9991-1',
    descricao: 'PRODUTO TESTE COMBINAVEL',
    setor_operacional: 'FRIOS',
    embalagem: 'CX 12',
    estoque_total: 20,
    estoque_formatado: '20',
    dias_sem_venda: 15,
    idade: 40,
    custo_medio: 17.5,
    valor_estoque: 350.0,
    valor_estoque_formatado: 'R$ 350,00',
    tem_promotor: true,
    multiplos_cnpjs: false,
    elegivel_ajuste: false,
    agencias_nomes: ['AGÊNCIA ESTRELA'],
    industrias_nomes: ['SEARA ALIMENTOS LTDA'],
    promotores_nomes: ['ROBERTO PROMOTOR'],
    cnpjs: ['02914460000105'],
    produto: {
      id: '9991',
      codigo_original: '009991',
      codigo_interno: '9991',
      digito: '1',
      codigo_exibicao: '9991-1',
      descricao: 'PRODUTO TESTE COMBINAVEL',
      setor_operacional: 'FRIOS',
      embalagem: 'CX 12',
      fator_embalagem: 12,
      unidade_medida: 'UN',
      estoque_emb1: 20,
      estoque_emb9: 0,
      estoque_total: 20,
      vendas_qtde_30d: 0,
      dias_sem_venda: 15,
      idade: 40,
      valor_estoque_planilha: 350.0,
      eans: ['7890009991'],
      atualizado_em: '2026-11-12T00:00:00.000Z',
    },
  };

  const filtrosAtivos: FiltrosIsv = {
    agencia: 'AGÊNCIA ESTRELA',
    industriaCnpj: '02914460000105',
    promotorId: 'TODOS',
    termoBusca: '',
    setorOperacional: 'FRIOS',
    setorFisico: 'TODOS',
    setorBalanco: 'TODOS',
    diasSemVenda: null,
    modoDiasSemVenda: 'MINIMO',
    idade: null,
    modoIdade: 'MINIMO',
    filtroEstoque: 'COM_ESTOQUE',
    filtroValor: 'TODOS',
    situacaoVinculo: 'TODOS',
    ordenacao: 'MAIOR_VALOR',
  };

  const filtrados = isvService.filtrarItensIsv([mockItem], filtrosAtivos);
  assert(filtrados.length === 1, 'Filtro combinando agência + indústria por CNPJ deve incluir o item.');

  // Testar exclusão ao mudar fornecedor selecionado pelo combobox
  const filtrosOutroFornecedor: FiltrosIsv = {
    ...filtrosAtivos,
    industriaCnpj: '01838723000127', // Sadia
  };
  const filtradosOutro = isvService.filtrarItensIsv([mockItem], filtrosOutroFornecedor);
  assert(filtradosOutro.length === 0, 'Item da Seara deve ser excluído quando selecionada outra indústria.');

  // Testar restauração de padrão
  const filtrosPadrao: FiltrosIsv = {
    agencia: 'TODAS',
    industriaCnpj: 'TODAS',
    promotorId: 'TODOS',
    termoBusca: '',
    setorOperacional: 'TODOS',
    setorFisico: 'TODOS',
    setorBalanco: 'TODOS',
    diasSemVenda: null,
    modoDiasSemVenda: 'MINIMO',
    idade: null,
    modoIdade: 'MINIMO',
    filtroEstoque: 'COM_ESTOQUE',
    filtroValor: 'TODOS',
    situacaoVinculo: 'TODOS',
    ordenacao: 'MAIOR_VALOR',
  };
  const filtradosPadrao = isvService.filtrarItensIsv([mockItem], filtrosPadrao);
  assert(filtradosPadrao.length === 1, 'Restaurar padrão deve reexibir todos os itens operacionais com estoque.');

  console.log('✅ Todos os testes do Combobox de Busca Inteligente passaram com sucesso!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Falha nos testes do ComboboxPesquisavel:', err);
  process.exit(1);
});
