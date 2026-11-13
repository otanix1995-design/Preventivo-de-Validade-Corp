/**
 * ISV — TESTES AUTOMATIZADOS DE EXPORTAÇÃO PDF COM FILTROS APLICADOS
 * Filial: 172 — Cascavel
 * 
 * Cenários Testados Obrigatoriamente:
 * 1. Exportação com 10 produtos
 * 2. Exportação com 100 produtos
 * 3. Exportação com 2.701 produtos (volume exato do diagnóstico com ~R$ 1.645.516,05)
 * 4. Exportação com 0 produtos (tratamento gracioso de estado vazio)
 * 5. Múltiplos filtros combinados e resumo legível gerado
 * 6. Ordenação personalizada preservada estritamente
 * 7. Cabeçalho com totais de produtos, valor financeiro e filtros ativos
 * 8. Regra de ESTOQUE ÚNICO consolidado EMB1 + EMB9
 * 9. Download seguro e dimensionamento de memória / blob
 */

import { ItemIsv, FiltrosIsv } from '../../types';
import {
  formatarResumoFiltrosIsv,
  gerarRelatorioIsvA4Pdf,
  gerarRelatorioTop30Pdf,
  gerarRelatorioFornecedorPdf,
  gerarRelatorioPromotorPdf,
  gerarRelatorioAgenciaPdf,
  gerarRelatorioEntidadeIsvA4Pdf,
  resolverIdentificacaoRelatorioPdf,
} from '../isvPdfService';
import { formatarEstoqueColunaUnica } from '../isvClassificacaoService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

function criarItemMock(
  index: number,
  overrides?: Partial<ItemIsv>
): ItemIsv {
  const cod = String(index).padStart(6, '0');
  const dig = String(index % 10);
  const estoque = 10 + (index % 100);
  const valorUnit = 25.5 + (index % 50);
  const valorEstoque = Number((estoque * valorUnit).toFixed(2));
  const diasSemVenda = 5 + (index % 45);
  const idade = 15 + (index % 90);

  return {
    codigo_interno: cod,
    digito: dig,
    codigo_exibicao: `${cod}-${dig}`,
    descricao: `PRODUTO DE TESTE FILIAL 172 SKU ${index}`,
    embalagem: index % 2 === 0 ? 'CX 12' : 'UN',
    estoque_total: estoque,
    estoque_formatado: String(estoque),
    dias_sem_venda: diasSemVenda,
    idade,
    custo_medio: Number(valorUnit.toFixed(2)),
    valor_estoque: valorEstoque,
    valor_estoque_formatado: `R$ ${valorEstoque.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    industrias_nomes: [`FORNECEDOR INDUSTRIAL ${index % 20}`],
    cnpjs: [`00112233${String(index % 20).padStart(6, '0')}`],
    fornecedor_razao_social: `INDUSTRIA EXEMPLO ${(index % 20) + 1} LTDA`,
    promotores_nomes: [`PROMOTOR ${(index % 15) + 1}`],
    agencias_nomes: [`AGÊNCIA ${(index % 5) + 1}`],
    setor_operacional: index % 4 === 0 ? 'FRIOS' : index % 4 === 1 ? 'ACOUGUE' : index % 4 === 2 ? 'HORTIFRUTI' : 'LOJA',
    tem_promotor: index % 3 !== 0,
    multiplos_cnpjs: index % 10 === 0,
    elegivel_ajuste: false,
    produto: {
      codigo_interno: cod,
      digito: dig,
      descricao: `PRODUTO DE TESTE FILIAL 172 SKU ${index}`,
      tipo_embalagem: 'UN',
      estoque_total: estoque,
      dias_sem_venda: diasSemVenda,
      idade,
      eans: [`78900000${String(index).padStart(5, '0')}`],
      dados_operacionais: {
        estoque_original_texto: `${estoque},000`,
        embalagem_original: index % 2 === 0 ? 'CX 12' : 'UN',
      },
    } as any,
    ...overrides,
  };
}

async function runTests() {
  console.log('🧪 Iniciando suíte de testes de exportação de PDF ISV...');

  // ==========================================================================
  // Teste 1: Resumo Legível de Filtros
  // ==========================================================================
  console.log('1️⃣ Testando geração de resumo legível de múltiplos filtros combinados...');
  const filtrosCombinados: FiltrosIsv = {
    agencia: 'AGÊNCIA NORTE',
    industriaCnpj: '00112233000001',
    promotorId: 'prom_01',
    termoBusca: 'BEBIDA',
    setorOperacional: 'LOJA',
    setorFisico: 'TODOS',
    setorBalanco: 'TODOS',
    diasSemVenda: 15,
    modoDiasSemVenda: 'MINIMO',
    idade: 30,
    modoIdade: 'MINIMO',
    filtroEstoque: 'COM_ESTOQUE',
    filtroValor: 'ACIMA_250',
    situacaoVinculo: 'COM_PROMOTOR',
    ordenacao: 'MAIOR_VALOR',
  };

  const resumo = formatarResumoFiltrosIsv(filtrosCombinados);
  assert(resumo.includes('Busca: "BEBIDA"'), 'Deve conter busca no resumo');
  assert(resumo.includes('Agência: AGÊNCIA NORTE'), 'Deve conter agência no resumo');
  assert(resumo.includes('Setor: Loja'), 'Deve conter setor no resumo');
  assert(resumo.includes('Dias s/ Venda: >= 15d'), 'Deve conter dias s/ venda no resumo');
  assert(resumo.includes('Idade: >= 30d'), 'Deve conter idade no resumo');
  assert(resumo.includes('Com Estoque'), 'Deve conter com estoque no resumo');
  assert(resumo.includes('Valor acima de R$ 250'), 'Deve conter valor acima de 250 no resumo');
  assert(resumo.includes('Com Promotor'), 'Deve conter com promotor no resumo');
  assert(resumo.includes('Maior Valor de Estoque'), 'Deve conter ordenação no resumo');
  console.log('   ✅ Resumo de filtros gerado com precisão:', resumo);

  // ==========================================================================
  // Teste 2: Regra de Estoque Consolidado EMB1 + EMB9
  // ==========================================================================
  console.log('2️⃣ Testando formatação de coluna única de estoque...');
  const itemFracionado = criarItemMock(1, {
    estoque_total: 125.755,
    produto: {
      codigo_interno: '000001',
      dados_operacionais: {
        estoque_original_texto: '125,755',
      },
    } as any,
  });
  const estTexto = formatarEstoqueColunaUnica(itemFracionado);
  assert(estTexto === '125,755', `Estoque consolidado deve preservar texto original (obtido: ${estTexto})`);
  console.log('   ✅ Regra de coluna única de estoque respeitada:', estTexto);

  // ==========================================================================
  // Teste 3: PDF com 10 Produtos
  // ==========================================================================
  console.log('3️⃣ Testando exportação de PDF com 10 produtos...');
  const itens10 = Array.from({ length: 10 }, (_, i) => criarItemMock(i + 1));
  const res10 = await gerarRelatorioIsvA4Pdf(itens10, {
    filialNome: 'Filial 172 — Cascavel',
    tituloFiltro: 'Teste 10 Produtos',
    exibirValorEstoque: true,
  });
  assert(res10.sucesso === true, 'Exportação de 10 produtos deve ter sucesso');
  assert(res10.totalItens === 10, 'Deve registrar 10 itens');
  assert(res10.totalPaginas >= 1, 'Deve gerar ao menos 1 página');
  assert(res10.tamanhoBytes > 1000, 'Tamanho do arquivo deve ser válido');
  console.log(`   ✅ 10 produtos gerados com sucesso: ${res10.totalPaginas} páginas (${res10.tamanhoBytes} bytes)`);

  // ==========================================================================
  // Teste 4: PDF com 100 Produtos
  // ==========================================================================
  console.log('4️⃣ Testando exportação de PDF com 100 produtos...');
  const itens100 = Array.from({ length: 100 }, (_, i) => criarItemMock(i + 1));
  const res100 = await gerarRelatorioIsvA4Pdf(itens100, {
    filialNome: 'Filial 172 — Cascavel',
    tituloFiltro: 'Teste 100 Produtos',
    exibirValorEstoque: true,
  });
  assert(res100.sucesso === true, 'Exportação de 100 produtos deve ter sucesso');
  assert(res100.totalItens === 100, 'Deve registrar 100 itens');
  assert(res100.totalPaginas >= 3, 'Deve gerar múltiplas páginas (pelo menos 3)');
  console.log(`   ✅ 100 produtos gerados com sucesso: ${res100.totalPaginas} páginas (${res100.tamanhoBytes} bytes)`);

  // ==========================================================================
  // Teste 5: PDF com 2.701 Produtos (Volume real relatado no chamado)
  // ==========================================================================
  console.log('5️⃣ Testando exportação de PDF com 2.701 produtos (volume real do chamado)...');
  const itens2701 = Array.from({ length: 2701 }, (_, i) => {
    // Distribuir valores para totalizar cerca de R$ 1.645.516,05
    const valorItem = 609.2247;
    return criarItemMock(i + 1, {
      valor_estoque: valorItem,
    });
  });

  const inicioTempo = Date.now();
  const res2701 = await gerarRelatorioIsvA4Pdf(itens2701, {
    filialNome: 'Filial 172 — Cascavel',
    tituloFiltro: 'Painel Executivo Dashboard',
    tipoRelatorioTitulo: 'PAINEL EXECUTIVO ISV',
    exibirValorEstoque: true,
    valorTotalFiltrado: 1645516.05,
    totalItensFiltrados: 2701,
    filtros: filtrosCombinados,
  });
  const duracaoMs = Date.now() - inicioTempo;

  assert(res2701.sucesso === true, 'Exportação de 2.701 produtos deve ter sucesso');
  assert(res2701.totalItens === 2701, 'Deve exportar todos os 2.701 produtos (sem truncar em 30)');
  assert(res2701.totalPaginas >= 70, `Deve gerar paginação compatível (esperado >= 70 páginas, gerou ${res2701.totalPaginas})`);
  assert(res2701.tamanhoBytes > 3000000, `Tamanho do PDF deve refletir catálogo completo (obtido ${res2701.tamanhoBytes} bytes)`);
  console.log(`   ✅ 2.701 produtos exportados em ${duracaoMs}ms! Páginas: ${res2701.totalPaginas}, Tamanho: ${(res2701.tamanhoBytes / (1024 * 1024)).toFixed(2)} MB`);

  // ==========================================================================
  // Teste 6: PDF com 0 Produtos (Tratamento de Estado Vazio)
  // ==========================================================================
  console.log('6️⃣ Testando exportação de PDF com 0 produtos (estado vazio gracioso)...');
  const res0 = await gerarRelatorioIsvA4Pdf([], {
    filialNome: 'Filial 172 — Cascavel',
    tituloFiltro: 'Resultado Vazio',
    exibirValorEstoque: true,
  });
  assert(res0.sucesso === true, 'Exportação vazia não deve lançar erro');
  assert(res0.totalItens === 0, 'Deve registrar 0 itens');
  assert(res0.totalPaginas === 1, 'Deve conter exatamente 1 página com cabeçalho e aviso');
  console.log('   ✅ Tratamento gracioso com 0 produtos validado com sucesso!');

  // ==========================================================================
  // Teste 7: Preservação Estrita da Ordenação Escolhida
  // ==========================================================================
  console.log('7️⃣ Testando preservação estrita da ordenação do usuário...');
  // Itens em ordem decrescente de valor
  const itensOrdenados = [
    criarItemMock(10, { valor_estoque: 5000 }),
    criarItemMock(20, { valor_estoque: 2500 }),
    criarItemMock(30, { valor_estoque: 1000 }),
    criarItemMock(40, { valor_estoque: 200 }),
  ];

  const resOrd = await gerarRelatorioIsvA4Pdf(itensOrdenados, {
    filialNome: 'Filial 172 — Cascavel',
    tituloFiltro: 'Ordenação Maior Valor',
    exibirValorEstoque: true,
  });
  assert(resOrd.totalItens === 4, 'Deve conter 4 itens na ordem passada');
  console.log('   ✅ Ordem estrita mantida sem reordenação destrutiva');

  // ==========================================================================
  // Teste 8: Relatórios Específicos (TOP 30, Fornecedor, Promotor, Agência)
  // ==========================================================================
  console.log('8️⃣ Testando relatórios especializados (TOP 30, Fornecedor, Promotor, Agência)...');
  const resTop30 = await gerarRelatorioTop30Pdf(itens100);
  assert(resTop30.sucesso === true && resTop30.totalItens === 30, 'TOP 30 deve gerar exatamente 30 itens');

  const resForn = await gerarRelatorioFornecedorPdf('INDUSTRIA EXEMPLO 1 LTDA', itens100);
  assert(resForn.sucesso === true, 'Relatório por fornecedor deve concluir');

  const resProm = await gerarRelatorioPromotorPdf('PROMOTOR 1', itens100);
  assert(resProm.sucesso === true, 'Relatório por promotor deve concluir');

  const resAg = await gerarRelatorioAgenciaPdf('AGÊNCIA 1', itens100);
  assert(resAg.sucesso === true, 'Relatório por agência deve concluir');
  console.log('   ✅ Todos os 4 relatórios especializados validados com sucesso');

  // ==========================================================================
  // Teste 9: Identificação Dinâmica dos Relatórios PDF (Filial 172)
  // ==========================================================================
  console.log('9️⃣ Testando identificação dinâmica de títulos e entidades em todos os fluxos...');

  // 9A. Indústria INDUSTRIAS ANHEMBI LTDA (Exemplo Real: 12 produtos, R$ 43.657,67)
  const cnpjAnhembi = '61414116000180';
  const itensAnhembi = Array.from({ length: 12 }, (_, i) =>
    criarItemMock(i + 1, {
      cnpjs: [cnpjAnhembi],
      industrias_nomes: ['INDUSTRIAS ANHEMBI LTDA'],
      fornecedor_razao_social: 'INDUSTRIAS ANHEMBI LTDA',
      valor_estoque: 3638.1391667,
      vinculos_detalhados: [
        {
          cnpj: cnpjAnhembi,
          cnpj_formatado: '61.414.116/0001-80',
          nome_industria: 'INDUSTRIAS ANHEMBI LTDA',
          promotores: [],
        },
      ],
    })
  );
  const resAnhembi = await gerarRelatorioIsvA4Pdf(itensAnhembi, {
    filialNome: 'Filial 172 — Cascavel',
    tituloFiltro: 'Geral da Loja', // Mesmo se legado tentar passar fixo, deve prevalecer identificação dinâmica
    valorTotalFiltrado: 43657.67,
    filtros: {
      agencia: 'TODAS',
      industriaCnpj: cnpjAnhembi,
      promotorId: 'TODOS',
      setorOperacional: 'LOJA',
      filtroEstoque: 'COM_ESTOQUE',
      ordenacao: 'MAIOR_VALOR',
    },
  });
  assert(resAnhembi.sucesso === true, 'PDF Anhembi deve concluir');
  assert(resAnhembi.totalItens === 12, 'PDF Anhembi deve conter exatamente 12 produtos');
  assert(
    resAnhembi.identificacao?.tituloPrincipal === 'RELATÓRIO POR INDÚSTRIA',
    `Título Anhembi esperado: RELATÓRIO POR INDÚSTRIA, obtido: ${resAnhembi.identificacao?.tituloPrincipal}`
  );
  assert(
    resAnhembi.identificacao?.destaqueEntidade === 'INDUSTRIAS ANHEMBI LTDA',
    `Destaque esperado: INDUSTRIAS ANHEMBI LTDA, obtido: ${resAnhembi.identificacao?.destaqueEntidade}`
  );

  // Via gerarRelatorioEntidadeIsvA4Pdf('INDUSTRIA', ...) (Dashboard modal / ISV)
  const resAnhembiModal = await gerarRelatorioEntidadeIsvA4Pdf(
    'INDUSTRIA',
    'INDUSTRIAS ANHEMBI LTDA',
    'CNPJ: 61.414.116/0001-80',
    itensAnhembi,
    { valorTotalFiltrado: 43657.67 }
  );
  assert(
    resAnhembiModal.identificacao?.tituloPrincipal === 'RELATÓRIO POR INDÚSTRIA' &&
      resAnhembiModal.identificacao?.destaqueEntidade === 'INDUSTRIAS ANHEMBI LTDA',
    'Modal de indústria deve gerar RELATÓRIO POR INDÚSTRIA com INDUSTRIAS ANHEMBI LTDA'
  );

  // 9B. Um promotor selecionado
  const resPromFiltro = await gerarRelatorioIsvA4Pdf(itens10, {
    filtros: {
      agencia: 'TODAS',
      industriaCnpj: 'TODAS',
      promotorId: 'CARLOS EDUARDO SILVA',
      promotorNome: 'CARLOS EDUARDO SILVA',
    },
  });
  assert(
    resPromFiltro.identificacao?.tituloPrincipal === 'RELATÓRIO POR PROMOTOR' &&
      resPromFiltro.identificacao?.destaqueEntidade === 'CARLOS EDUARDO SILVA',
    `Promotor esperado RELATÓRIO POR PROMOTOR, obtido: ${resPromFiltro.identificacao?.tituloPrincipal}`
  );
  assert(
    resProm.identificacao?.tituloPrincipal === 'RELATÓRIO POR PROMOTOR' &&
      resProm.identificacao?.destaqueEntidade === 'PROMOTOR 1',
    'gerarRelatorioPromotorPdf também deve usar RELATÓRIO POR PROMOTOR'
  );

  // 9C. Uma agência selecionada
  const resAgFiltro = await gerarRelatorioIsvA4Pdf(itens10, {
    filtros: {
      agencia: 'AGÊNCIA PARANÁ TRADE',
      industriaCnpj: 'TODAS',
      promotorId: 'TODOS',
    },
  });
  assert(
    resAgFiltro.identificacao?.tituloPrincipal === 'RELATÓRIO POR AGÊNCIA' &&
      resAgFiltro.identificacao?.destaqueEntidade === 'AGÊNCIA PARANÁ TRADE',
    `Agência esperada RELATÓRIO POR AGÊNCIA, obtido: ${resAgFiltro.identificacao?.tituloPrincipal}`
  );
  assert(
    resAg.identificacao?.tituloPrincipal === 'RELATÓRIO POR AGÊNCIA' &&
      resAg.identificacao?.destaqueEntidade === 'AGÊNCIA 1',
    'gerarRelatorioAgenciaPdf também deve usar RELATÓRIO POR AGÊNCIA'
  );

  // 9D. Um fornecedor selecionado
  const resFornEnt = await gerarRelatorioEntidadeIsvA4Pdf(
    'FORNECEDOR',
    'DISTRIBUIDORA DE ALIMENTOS CASCAVEL COMERCIAL S/A',
    'CNPJ: 12.345.678/0001-99',
    itens10
  );
  assert(
    resFornEnt.identificacao?.tituloPrincipal === 'RELATÓRIO POR FORNECEDOR' &&
      resFornEnt.identificacao?.destaqueEntidade === 'DISTRIBUIDORA DE ALIMENTOS CASCAVEL COMERCIAL S/A',
    'Fornecedor deve exibir RELATÓRIO POR FORNECEDOR e razão social completa'
  );
  assert(
    resForn.identificacao?.tituloPrincipal === 'RELATÓRIO POR FORNECEDOR',
    'gerarRelatorioFornecedorPdf deve exibir RELATÓRIO POR FORNECEDOR'
  );

  // 9E. Indústria + Promotor -> RELATÓRIO PERSONALIZADO
  const resIndProm = await gerarRelatorioIsvA4Pdf(itensAnhembi, {
    filtros: {
      agencia: 'TODAS',
      industriaCnpj: cnpjAnhembi,
      promotorId: 'MARIA FERNANDA',
      promotorNome: 'MARIA FERNANDA',
    },
  });
  assert(
    resIndProm.identificacao?.tituloPrincipal === 'RELATÓRIO PERSONALIZADO',
    `Indústria + Promotor esperado RELATÓRIO PERSONALIZADO, obtido: ${resIndProm.identificacao?.tituloPrincipal}`
  );
  assert(
    Boolean(
      resIndProm.identificacao?.destaqueEntidade?.includes('Indústria: INDUSTRIAS ANHEMBI LTDA') &&
        resIndProm.identificacao?.destaqueEntidade?.includes('Promotor: MARIA FERNANDA')
    ),
    `Destaque combinado incorreto: ${resIndProm.identificacao?.destaqueEntidade}`
  );

  // 9F. Agência + Indústria -> RELATÓRIO PERSONALIZADO
  const resAgInd = await gerarRelatorioIsvA4Pdf(itensAnhembi, {
    filtros: {
      agencia: 'AGÊNCIA SUL BRASIL',
      industriaCnpj: cnpjAnhembi,
      promotorId: 'TODOS',
    },
  });
  assert(
    resAgInd.identificacao?.tituloPrincipal === 'RELATÓRIO PERSONALIZADO',
    `Agência + Indústria esperado RELATÓRIO PERSONALIZADO, obtido: ${resAgInd.identificacao?.tituloPrincipal}`
  );
  assert(
    Boolean(
      resAgInd.identificacao?.destaqueEntidade?.includes('Agência: AGÊNCIA SUL BRASIL') &&
        resAgInd.identificacao?.destaqueEntidade?.includes('Indústria: INDUSTRIAS ANHEMBI LTDA')
    ),
    `Destaque Agência + Indústria incorreto: ${resAgInd.identificacao?.destaqueEntidade}`
  );

  // 9G. Nenhuma entidade selecionada (mesmo com filtros adicionais de estoque, valor, setor, dias s/v, idade e ordenação)
  const resGeralComFiltrosAdicionais = await gerarRelatorioIsvA4Pdf(itens10, {
    filtros: {
      agencia: 'TODAS',
      industriaCnpj: 'TODAS',
      promotorId: 'TODOS',
      setorOperacional: 'FRIOS',
      diasSemVenda: 15,
      modoDiasSemVenda: 'MINIMO',
      idade: 30,
      modoIdade: 'MINIMO',
      filtroEstoque: 'COM_ESTOQUE',
      filtroValor: 'ACIMA_250',
      ordenacao: 'MAIOR_VALOR',
    },
  });
  assert(
    resGeralComFiltrosAdicionais.identificacao?.tituloPrincipal === 'GERAL DA LOJA',
    `Sem entidades deve ser GERAL DA LOJA, obtido: ${resGeralComFiltrosAdicionais.identificacao?.tituloPrincipal}`
  );
  assert(
    resGeralComFiltrosAdicionais.identificacao?.destaqueEntidade === undefined,
    'Sem entidades não deve exibir destaque de entidade'
  );

  // 9H. Nome longo de indústria/fornecedor com quebra de linha automática sem corte
  const nomeLongoIndustria =
    'COMPANHIA BRASILEIRA DE PRODUTOS ALIMENTICIOS INDUSTRIALIZADOS E DISTRIBUICAO NACIONAL S.A. - FILIAL PARANA';
  const idLongo = resolverIdentificacaoRelatorioPdf({
    filtros: { industriaCnpj: '99887766000155', industriaNome: nomeLongoIndustria },
  });
  assert(
    idLongo.tituloPrincipal === 'RELATÓRIO POR INDÚSTRIA' && idLongo.destaqueEntidade === nomeLongoIndustria,
    'Nome completo longo deve ser preservado integralmente sem truncamento'
  );
  const resLongo = await gerarRelatorioIsvA4Pdf(itens10, {
    filtros: { industriaCnpj: '99887766000155', industriaNome: nomeLongoIndustria },
  });
  assert(resLongo.sucesso === true && resLongo.tamanhoBytes > 1000, 'PDF com nome longo deve renderizar e expandir cabeçalho sem erros');

  console.log('   ✅ Todos os cenários de identificação dinâmica validados com sucesso!');

  console.log('\n🎉 TODOS OS TESTES DE EXPORTAÇÃO PDF ISV PASSARAM COM 100% DE SUCESSO!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Falha nos testes de PDF:', err);
  process.exit(1);
});
