import fs from 'fs';
import path from 'path';
import { extractGramagem } from '../codeParser';
import {
  calcularEstoqueConsolidadoConsulta,
  filtrarProdutosConsulta,
} from '../consultaFiltroService';
import { productRepository } from '../productRepository';
import { ProdutoSMG, RegistroPlanilhaIsv } from '../../types';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${msg}`);
  }
}

function makeProd(overrides: Partial<ProdutoSMG> & { id: string; codigo_interno: string; descricao: string }): ProdutoSMG {
  const emb = overrides.embalagem || 'CXA 1 X 6 X 500G';
  const gram = extractGramagem(emb);
  return {
    codigo_original: `${overrides.codigo_interno}-100`,
    digito: '100',
    codigo_exibicao: `${overrides.codigo_interno}-100`,
    embalagem: emb,
    fator_embalagem: 6,
    setor_fisico: 'MERCEARIA',
    setor_balanco: 'MERCEARIA',
    estoque_emb1: 0,
    estoque_emb9: 0,
    estoque_total: 0,
    vendas_qtde_30d: 10,
    dias_sem_venda: 2,
    idade: 15,
    eans: [],
    atualizado_em: '2026-11-24T10:00:00Z',
    gramagemTexto: gram?.texto || null,
    gramagemValorBase: gram?.valorBase || null,
    gramagemUnidadeBase: gram?.unidadeBase || null,
    gramagemChave: gram?.chaveEquivalencia || null,
    ...overrides,
  };
}

async function runConsultaEstoqueFiltroTests(): Promise<void> {
  console.log('\n==========================================================================');
  console.log('TESTES OFFLINE — FILTRO DE ESTOQUE NA ABA CONSULTA (BASE RUB LOCAL)');
  console.log('==========================================================================\n');

  // -------------------------------------------------------------------------
  // 1. VALIDAÇÃO ESTRUTURAL DO COMPONENTE ConsultaView.tsx
  // -------------------------------------------------------------------------
  console.log('[1/5] Validando posição e padrão "Com estoque" em ConsultaView.tsx...');
  {
    const consultaPath = path.resolve(process.cwd(), 'src/components/ConsultaView.tsx');
    const source = fs.readFileSync(consultaPath, 'utf-8');

    assert(
      source.includes("useState<FiltroEstoqueConsulta>('COM_ESTOQUE')"),
      'Filtro de estoque deve iniciar com "COM_ESTOQUE" selecionado por padrão.'
    );
    const idxFiltroEstoque = source.indexOf('id="consulta-filtro-estoque"');
    const idxFiltroGramagem = source.indexOf('Filtrar por Gramagem / Apresentação:');
    assert(idxFiltroEstoque > 0 && idxFiltroGramagem > 0, 'Ambos os filtros devem existir no ConsultaView.');
    assert(
      idxFiltroEstoque < idxFiltroGramagem,
      'O filtro de estoque deve aparecer imediatamente acima do filtro de gramagem/apresentação.'
    );
    assert(source.includes("label: 'Todos'"), 'Opção Todos deve existir.');
    assert(source.includes("label: 'Com estoque'"), 'Opção Com estoque deve existir.');
    assert(source.includes("label: 'Sem estoque'"), 'Opção Sem estoque deve existir.');
  }
  console.log('  ✓ Estrutura visual, rótulos e padrão "Com estoque" verificados.');

  // -------------------------------------------------------------------------
  // 2. CÁLCULO DE ESTOQUE CONSOLIDADO (EMB1 + EMB9, UNIDADES E FATORES)
  // -------------------------------------------------------------------------
  console.log('[2/5] Validando cálculo consolidado EMB1 + EMB9 com unidades e fatores...');
  {
    // Caixa fator 6: 2 CX + 0 UN = 12 (> 0)
    const cxPos = makeProd({
      id: 'c1',
      codigo_interno: '1001',
      descricao: 'PRODUTO CAIXA POSITIVO',
      embalagem: 'CXA 1 X 6 X 500G',
      fator_embalagem: 6,
      estoque_emb1: 2,
      estoque_emb9: 0,
    });
    assert(calcularEstoqueConsolidadoConsulta(cxPos) === 12, '2 CX x 6 = 12');

    // Caixa fator 6: 0 CX + 3 UN = 3 (> 0)
    const unPos = makeProd({
      id: 'c2',
      codigo_interno: '1002',
      descricao: 'PRODUTO UNIDADE AVULSA',
      embalagem: 'CXA 1 X 6 X 500G',
      fator_embalagem: 6,
      estoque_emb1: 0,
      estoque_emb9: 3,
    });
    assert(calcularEstoqueConsolidadoConsulta(unPos) === 3, '0 CX + 3 UN = 3');

    // Caixa fator 6: -1 CX + 8 UN = (-6 + 8) = +2 (> 0)
    const embMixPos = makeProd({
      id: 'c3',
      codigo_interno: '1003',
      descricao: 'PRODUTO MISTO POSITIVO',
      embalagem: 'CXA 1 X 6 X 500G',
      fator_embalagem: 6,
      estoque_emb1: -1,
      estoque_emb9: 8,
    });
    assert(calcularEstoqueConsolidadoConsulta(embMixPos) === 2, '-1 CX x 6 + 8 UN = +2');

    // Caixa fator 6: 1 CX - 6 UN = 0 (<= 0)
    const embMixZero = makeProd({
      id: 'c4',
      codigo_interno: '1004',
      descricao: 'PRODUTO MISTO ZERO',
      embalagem: 'CXA 1 X 6 X 500G',
      fator_embalagem: 6,
      estoque_emb1: 1,
      estoque_emb9: -6,
    });
    assert(calcularEstoqueConsolidadoConsulta(embMixZero) === 0, '1 CX x 6 - 6 UN = 0');

    // Caixa fator 6: 1 CX - 8 UN = -2 (< 0)
    const embMixNeg = makeProd({
      id: 'c5',
      codigo_interno: '1005',
      descricao: 'PRODUTO MISTO NEGATIVO',
      embalagem: 'CXA 1 X 6 X 500G',
      fator_embalagem: 6,
      estoque_emb1: 1,
      estoque_emb9: -8,
    });
    assert(calcularEstoqueConsolidadoConsulta(embMixNeg) === -2, '1 CX x 6 - 8 UN = -2');

    // Pesável KG: 0 KG + 250 G = 0.25 KG (> 0)
    const kgPos = makeProd({
      id: 'k1',
      codigo_interno: '2001',
      descricao: 'CARNE PESAVEL POSITIVA',
      embalagem: 'KG 1 X 1000 X 1G',
      fator_embalagem: 1,
      estoque_emb1: 0,
      estoque_emb9: 250,
    });
    assert(calcularEstoqueConsolidadoConsulta(kgPos) === 0.25, '0 KG + 250 G = 0.25 KG');

    // Pesável KG: 1 KG - 1200 G = -0.2 KG (< 0)
    const kgNeg = makeProd({
      id: 'k2',
      codigo_interno: '2002',
      descricao: 'CARNE PESAVEL NEGATIVA',
      embalagem: 'KG 1 X 1000 X 1G',
      fator_embalagem: 1,
      estoque_emb1: 1,
      estoque_emb9: -1200,
    });
    assert(
      Math.abs(calcularEstoqueConsolidadoConsulta(kgNeg) - (-0.2)) < 0.0001,
      '1 KG - 1200 G = -0.2 KG'
    );

    // Registro operacional BASE RUB soberano
    const regRubZero = { estoque: 0 } as RegistroPlanilhaIsv;
    const regRubPos = { estoque: 158.795 } as RegistroPlanilhaIsv;
    assert(calcularEstoqueConsolidadoConsulta(cxPos, regRubZero) === 0, 'BASE RUB soberana 0 deve retornar 0.');
    assert(calcularEstoqueConsolidadoConsulta(cxPos, regRubPos) === 158.795, 'BASE RUB soberana 158.795.');
  }
  console.log('  ✓ Cálculo consolidado EMB1 + EMB9 validado para caixas, unidades, pesáveis e BASE RUB.');

  // -------------------------------------------------------------------------
  // 3. INTEGRAÇÃO COM PESQUISA, GRAMAGEM E CONTADORES DINÂMICOS
  // -------------------------------------------------------------------------
  console.log('[3/5] Validando integração pesquisa + estoque + gramagem + contadores...');
  {
    const catalogo: ProdutoSMG[] = [
      makeProd({
        id: 'p1',
        codigo_interno: '3001',
        descricao: 'CAFE TORRADO ALFA 500G',
        embalagem: 'CXA 1 X 10 X 500G',
        fator_embalagem: 10,
        estoque_emb1: 3,
        estoque_emb9: 0,
        estoque_total: 30,
      }),
      makeProd({
        id: 'p2',
        codigo_interno: '3002',
        descricao: 'CAFE TORRADO BETA 500G',
        embalagem: 'CXA 1 X 10 X 500G',
        fator_embalagem: 10,
        estoque_emb1: 0,
        estoque_emb9: 0,
        estoque_total: 0,
      }),
      makeProd({
        id: 'p3',
        codigo_interno: '3003',
        descricao: 'CAFE SOLUVEL GAMA 200G',
        embalagem: 'CXA 1 X 12 X 200G',
        fator_embalagem: 12,
        estoque_emb1: 0,
        estoque_emb9: 4,
        estoque_total: 4,
      }),
      makeProd({
        id: 'p4',
        codigo_interno: '3004',
        descricao: 'CAFE SOLUVEL DELTA 200G',
        embalagem: 'CXA 1 X 12 X 200G',
        fator_embalagem: 12,
        estoque_emb1: -1,
        estoque_emb9: 5, // (-1 * 12) + 5 = -7 (<= 0)
        estoque_total: -7,
      }),
      makeProd({
        id: 'p5',
        codigo_interno: '3005',
        descricao: 'CAFE EM GRAOS EPSILON 1KG',
        embalagem: 'CXA 1 X 6 X 1KG',
        fator_embalagem: 6,
        estoque_emb1: 1,
        estoque_emb9: -6, // (1 * 6) - 6 = 0 (<= 0)
        estoque_total: 0,
      }),
    ];

    // Alimentar índice local em memória (sem IndexedDB nem Firebase)
    (productRepository as any)._produtos = catalogo;
    (productRepository as any).rebuildIndices();

    const matched = productRepository.searchProducts('CAFE', { limit: 100 });
    assert(matched.length === 5, `Busca por "CAFE" deveria retornar 5 itens, retornou ${matched.length}`);

    const optsLocal = {
      pageSize: 10,
      getRegistroOperacionalFn: () => undefined,
      resolverEmbalagemFn: (_c: string, _d?: string, embRub?: string) => embRub || 'UN',
    };

    // Padrão: COM_ESTOQUE -> 2 produtos (p1 500G, p3 200G)
    const resCom = filtrarProdutosConsulta(matched, 'COM_ESTOQUE', null, { ...optsLocal, currentPage: 1 });
    assert(resCom.totalTodos === 5, 'totalTodos deve ser 5');
    assert(resCom.totalComEstoque === 2, 'totalComEstoque deve ser 2');
    assert(resCom.totalSemEstoque === 3, 'totalSemEstoque deve ser 3');
    assert(resCom.totalResults === 2, 'COM_ESTOQUE sem gramagem deve retornar 2');
    assert(resCom.gramagensDisponiveis.length === 2, 'Devem restar apenas 2 gramagens com estoque (200G e 500G)');
    assert(
      resCom.gramagensDisponiveis.every((g) => g.count === 1 && (g.texto === '200G' || g.texto === '500G')),
      'Contagens por gramagem devem refletir somente produtos COM_ESTOQUE.'
    );

    // SEM_ESTOQUE -> 3 produtos (p2 500G, p4 200G, p5 1KG)
    const resSem = filtrarProdutosConsulta(matched, 'SEM_ESTOQUE', null, { ...optsLocal, currentPage: 1 });
    assert(resSem.totalResults === 3, 'SEM_ESTOQUE deve retornar 3');
    assert(resSem.gramagensDisponiveis.length === 3, 'SEM_ESTOQUE possui 3 gramagens (200G, 500G, 1KG)');

    // TODOS + gramagem "500G" -> 2 produtos (p1, p2)
    const resTodos500 = filtrarProdutosConsulta(matched, 'TODOS', '500G', { ...optsLocal, currentPage: 1 });
    assert(resTodos500.totalResults === 2, 'TODOS + 500G deve retornar 2');

    // COM_ESTOQUE + gramagem "1KG" -> 0 produtos (p5 tem estoque 0)
    const resCom1Kg = filtrarProdutosConsulta(matched, 'COM_ESTOQUE', '1KG', { ...optsLocal, currentPage: 1 });
    assert(resCom1Kg.totalResults === 0, 'COM_ESTOQUE + 1KG deve retornar 0');
  }
  console.log('  ✓ Integração pesquisa + filtro de estoque + gramagem + contadores validada.');

  // -------------------------------------------------------------------------
  // 4. FILTRAGEM ANTES DA PAGINAÇÃO (MÚLTIPLAS PÁGINAS)
  // -------------------------------------------------------------------------
  console.log('[4/5] Validando filtragem antes da paginação...');
  {
    const basePaginacao: ProdutoSMG[] = [];
    // 15 itens SEM estoque intercalados com 14 itens COM estoque (29 total)
    for (let i = 1; i <= 29; i++) {
      const temEstoque = i % 2 === 0; // 14 com estoque, 15 sem estoque
      basePaginacao.push(
        makeProd({
          id: `pag-${i}`,
          codigo_interno: String(5000 + i),
          descricao: `BISCOITO TESTE ITEM ${i}`,
          embalagem: 'CXA 1 X 12 X 400G',
          fator_embalagem: 12,
          estoque_emb1: temEstoque ? 1 : 0,
          estoque_emb9: 0,
          estoque_total: temEstoque ? 12 : 0,
        })
      );
    }

    const optsPag = {
      pageSize: 10,
      getRegistroOperacionalFn: () => undefined,
      resolverEmbalagemFn: (_c: string, _d?: string, embRub?: string) => embRub || 'UN',
    };

    const pag1 = filtrarProdutosConsulta(basePaginacao, 'COM_ESTOQUE', null, { ...optsPag, currentPage: 1 });
    assert(pag1.totalResults === 14, `Esperado 14 com estoque, obteve ${pag1.totalResults}`);
    assert(pag1.totalPages === 2, `Esperado 2 páginas, obteve ${pag1.totalPages}`);
    assert(pag1.visibleProducts.length === 10, 'Página 1 deve exibir exatamente 10 produtos filtrados (filtragem antes da paginação)');
    assert(pag1.startIndex === 0 && pag1.endIndex === 10, 'Índices da página 1 devem ser 0..10');

    const pag2 = filtrarProdutosConsulta(basePaginacao, 'COM_ESTOQUE', null, { ...optsPag, currentPage: 2 });
    assert(pag2.visibleProducts.length === 4, 'Página 2 deve exibir os 4 produtos restantes');
    assert(pag2.startIndex === 10 && pag2.endIndex === 14, 'Índices da página 2 devem ser 10..14');

    // Se pedir página 3 após mudar filtro para algo com menos páginas, safePage deve ajustar para última página válida
    const pagClamp = filtrarProdutosConsulta(basePaginacao, 'COM_ESTOQUE', null, { ...optsPag, currentPage: 3 });
    assert(pagClamp.safePage === 2 && pagClamp.visibleProducts.length === 4, 'safePage deve ajustar ao total de páginas.');
  }
  console.log('  ✓ Paginação pós-filtragem validada (página 1 cheia com 10 itens, página 2 com 4 itens).');

  // -------------------------------------------------------------------------
  // 5. ISOLAMENTO DO FIREBASE (ZERO LEITURAS / ESCRITAS)
  // -------------------------------------------------------------------------
  console.log('[5/5] Validando ausência de dependências do Firebase no serviço de filtro...');
  {
    const serviceSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/consultaFiltroService.ts'),
      'utf-8'
    );
    assert(!serviceSource.includes('firebase/firestore'), 'consultaFiltroService não pode importar firebase/firestore.');
    assert(!serviceSource.includes('getDocs') && !serviceSource.includes('setDoc'), 'Zero operações Firestore.');
  }
  console.log('  ✓ Execução 100% local confirmada.');

  console.log('\n==========================================================================');
  console.log('✅ TODOS OS 5 TESTES DO FILTRO DE ESTOQUE NA CONSULTA PASSARAM 100%!');
  console.log('==========================================================================\n');
  process.exit(0);
}

runConsultaEstoqueFiltroTests().catch((err) => {
  console.error('❌ ERRO NOS TESTES:', err);
  process.exit(1);
});
