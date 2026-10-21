import {
  FiltrosIsv,
  FornecedorSPCOI007,
  Industria,
  ItemIsv,
  ProdutoSMG,
  Promotor,
  PromotorVinculadoItem,
  RegistroPlanilhaIsv,
  ResponsaveisMercadoria,
  ResumoImportacaoIsv,
  ResumoImportacaoSPCOI007,
  SolicitacaoAjusteIsv,
  VinculoIndustriaItemIsv,
  VinculoPromotorIndustria,
} from '../types';
import { calcularPosicaoEstoque, isProdutoPesavel, parseEmbalagem } from './codeParser';
import { dbClear, dbGetAll, dbPut, dbPutAll, STORES } from './db';
import { formatarMoedaBR } from './deviceId';
import { productRepository } from './productRepository';
import { promotorService } from './promotorService';
import { formatarCnpj, normalizarCnpj } from './spcoi007Parser';
import { getProdutos } from './storage';

type IsvChangeListener = () => void;

export interface ParametrosCalculoFinanceiro {
  estoqueEmb1?: number | null;
  estoqueEmb9?: number | null;
  embalagem?: string | null;
  fatorEmbalagem?: number | null;
  tipoUnidade?: string | null;
  custoMedio?: number | null;
  unidadeReferenciaCusto?: 'CAIXA' | 'UNIDADE' | 'KG' | 'DESCONHECIDA' | string | null;
  estoqueConvertido?: number | null;
  valorEstoquePlanilha?: number | null;
  vendasPreco?: number | null;
}

export interface ResultadoCalculoFinanceiro {
  quantidadeFinanceira: number;
  unidadeFinanceira: string;
  custoUnitarioEquivalente: number | null;
  valorTotalEstoque: number | null;
  situacaoCalculo: 'CALCULADO' | 'OFICIAL_PLANILHA' | 'INDISPONIVEL' | 'ESTOQUE_ZERO';
  motivoIndisponibilidade?: string;
  isCustoPorCaixa: boolean;
  fatorUtilizado: number;
}

/**
 * FUNÇÃO CENTRALIZADA E OFICIAL DE CÁLCULO FINANCEIRO DO ISV:
 * Reutilizada rigorosamente pela interface, ordenação global e relatórios PDF A3.
 *
 * REGRA FUNDAMENTAL (REQUISITO 3 e 8):
 * - Se Custo Médio corresponder à embalagem completa (Caixa/Fardo):
 *     CUSTO UNITÁRIO = CUSTO MÉDIO DA EMBALAGEM ÷ QUANTIDADE DE UNIDADES DA EMBALAGEM
 *     VALOR DO ESTOQUE = ESTOQUE TOTAL EM UNIDADES × CUSTO UNITÁRIO
 *     (Não arredondar o custo unitário antes da multiplicação final)
 * - Se Custo Médio já for unitário:
 *     VALOR DO ESTOQUE = ESTOQUE TOTAL EM UNIDADES × CUSTO MÉDIO UNITÁRIO
 * - Se Produto for Pesável (KG e G):
 *     VALOR DO ESTOQUE = ESTOQUE EM KG × CUSTO MÉDIO POR KG
 * - Se Valor do Estoque já veio pré-calculado pelo ERP da filial (coluna oficial da planilha):
 *     Utiliza com prioridade absoluta o valor oficial do ERP.
 */
export function calcularValorEstoqueCentralizado(params: ParametrosCalculoFinanceiro): ResultadoCalculoFinanceiro {
  const emb = params.embalagem || '';
  const isPesavel = isProdutoPesavel(emb);
  const embData = parseEmbalagem(emb);
  const fator = params.fatorEmbalagem && params.fatorEmbalagem > 1
    ? params.fatorEmbalagem
    : (embData.fator && embData.fator > 1 ? embData.fator : 1);

  // 1. PRIORIDADE ABSOLUTA: Valor do estoque pré-calculado oficialmente pelo ERP SMG da filial
  if (
    params.valorEstoquePlanilha !== undefined &&
    params.valorEstoquePlanilha !== null &&
    !isNaN(params.valorEstoquePlanilha) &&
    params.valorEstoquePlanilha > 0
  ) {
    const valOficial = Number(params.valorEstoquePlanilha.toFixed(2));
    const qtdTotal = isPesavel
      ? (params.estoqueConvertido ?? (Number(params.estoqueEmb1 || 0) + Number(params.estoqueEmb9 || 0) / 1000))
      : (params.estoqueConvertido ?? (Number(params.estoqueEmb1 || 0) * fator + Number(params.estoqueEmb9 || 0)));

    return {
      quantidadeFinanceira: qtdTotal,
      unidadeFinanceira: isPesavel ? 'KG' : 'UN',
      custoUnitarioEquivalente: qtdTotal > 0 ? valOficial / qtdTotal : (params.custoMedio ?? null),
      valorTotalEstoque: valOficial,
      situacaoCalculo: 'OFICIAL_PLANILHA',
      isCustoPorCaixa: false,
      fatorUtilizado: fator,
    };
  }

  // 2. Custo Médio obrigatório: se ausente ou <= 0, retorna INDISPONÍVEL
  if (
    params.custoMedio === undefined ||
    params.custoMedio === null ||
    isNaN(params.custoMedio) ||
    params.custoMedio <= 0
  ) {
    return {
      quantidadeFinanceira: 0,
      unidadeFinanceira: isPesavel ? 'KG' : 'UN',
      custoUnitarioEquivalente: null,
      valorTotalEstoque: null,
      situacaoCalculo: 'INDISPONIVEL',
      motivoIndisponibilidade: 'Custo Médio ausente ou zerado na SMGOI013',
      isCustoPorCaixa: false,
      fatorUtilizado: fator,
    };
  }

  const custo = Number(params.custoMedio);

  // 3. PRODUTOS PESÁVEIS (KG e G)
  if (isPesavel) {
    const qtdKg = params.estoqueConvertido !== undefined && params.estoqueConvertido !== null && !isNaN(params.estoqueConvertido)
      ? Number(params.estoqueConvertido)
      : Number(params.estoqueEmb1 || 0) + (Number(params.estoqueEmb9 || 0) / 1000);

    if (qtdKg <= 0) {
      return {
        quantidadeFinanceira: 0,
        unidadeFinanceira: 'KG',
        custoUnitarioEquivalente: custo,
        valorTotalEstoque: 0,
        situacaoCalculo: 'ESTOQUE_ZERO',
        isCustoPorCaixa: false,
        fatorUtilizado: 1,
      };
    }

    const valorTotal = Number((qtdKg * custo).toFixed(2));
    return {
      quantidadeFinanceira: qtdKg,
      unidadeFinanceira: 'KG',
      custoUnitarioEquivalente: custo,
      valorTotalEstoque: valorTotal,
      situacaoCalculo: 'CALCULADO',
      isCustoPorCaixa: false,
      fatorUtilizado: 1,
    };
  }

  // 4. PRODUTOS CONTROLADOS POR CAIXA / UNIDADE
  let estTotal = params.estoqueConvertido !== undefined && params.estoqueConvertido !== null && !isNaN(params.estoqueConvertido)
    ? Number(params.estoqueConvertido)
    : (Number(params.estoqueEmb1 || 0) * fator) + Number(params.estoqueEmb9 || 0);

  if (estTotal <= 0 && ((params.estoqueEmb1 || 0) > 0 || (params.estoqueEmb9 || 0) > 0)) {
    const pos = calcularPosicaoEstoque(
      params.estoqueEmb1,
      params.estoqueEmb9,
      params.embalagem,
      fator
    );
    estTotal = pos.estoqueTotal;
  }

  if (estTotal <= 0) {
    return {
      quantidadeFinanceira: 0,
      unidadeFinanceira: 'UN',
      custoUnitarioEquivalente: custo,
      valorTotalEstoque: 0,
      situacaoCalculo: 'ESTOQUE_ZERO',
      isCustoPorCaixa: false,
      fatorUtilizado: fator,
    };
  }

  // Determinar com precisão cirúrgica se o custo médio refere-se à CAIXA ou à UNIDADE individual
  let isCustoPorCaixa = false;

  const refCusto = (params.unidadeReferenciaCusto || '').toUpperCase();
  if (refCusto === 'CAIXA' || refCusto === 'CX' || refCusto === 'EMBALAGEM') {
    isCustoPorCaixa = fator > 1;
  } else if (refCusto === 'UNIDADE' || refCusto === 'UN') {
    isCustoPorCaixa = false;
  } else if (fator > 1) {
    if (params.vendasPreco !== undefined && params.vendasPreco !== null && params.vendasPreco > 0) {
      if (custo > params.vendasPreco * 1.5) {
        isCustoPorCaixa = true;
      } else {
        isCustoPorCaixa = false;
      }
    } else {
      const unidadeCadastral = (params.tipoUnidade || embData.tipo || '').toUpperCase();
      if (
        unidadeCadastral.includes('CX') ||
        unidadeCadastral.includes('FD') ||
        unidadeCadastral.includes('PCT')
      ) {
        isCustoPorCaixa = true;
      }
    }
  }

  if (isCustoPorCaixa && fator > 1) {
    // REGRA OFICIAL (REQUISITO 3):
    // CUSTO UNITÁRIO = CUSTO MÉDIO DA EMBALAGEM ÷ QUANTIDADE DE UNIDADES DA EMBALAGEM
    // VALOR DO ESTOQUE = ESTOQUE TOTAL EM UNIDADES × CUSTO UNITÁRIO
    // (Não arredondar o custo unitário antes da multiplicação final)
    const custoUnitario = custo / fator;
    const valorCalculado = Number((estTotal * custoUnitario).toFixed(2));

    return {
      quantidadeFinanceira: estTotal,
      unidadeFinanceira: 'UN',
      custoUnitarioEquivalente: custoUnitario,
      valorTotalEstoque: valorCalculado,
      situacaoCalculo: 'CALCULADO',
      isCustoPorCaixa: true,
      fatorUtilizado: fator,
    };
  }

  // Custo já expresso por unidade individual:
  const valorCalculado = Number((estTotal * custo).toFixed(2));
  return {
    quantidadeFinanceira: estTotal,
    unidadeFinanceira: 'UN',
    custoUnitarioEquivalente: custo,
    valorTotalEstoque: valorCalculado,
    situacaoCalculo: 'CALCULADO',
    isCustoPorCaixa: false,
    fatorUtilizado: fator,
  };
}

class IsvService {
  private _fornecedores: FornecedorSPCOI007[] = [];
  private _industrias: Industria[] = [];
  private _vinculos: VinculoPromotorIndustria[] = [];
  private _solicitacoesAjuste: SolicitacaoAjusteIsv[] = [];
  private _historicoSpcoi: ResumoImportacaoSPCOI007[] = [];
  private _registrosIsvOperacional: RegistroPlanilhaIsv[] = [];
  private _historicoIsv: ResumoImportacaoIsv[] = [];
  private _listeners = new Set<IsvChangeListener>();
  private _isInitialized = false;

  public async init(): Promise<void> {
    if (this._isInitialized) return;

    try {
      const [fornec, indus, vincs, ajus, hist, regIsv, histIsv] = await Promise.all([
        dbGetAll<FornecedorSPCOI007>(STORES.SPCOI007_FORNECEDORES),
        dbGetAll<Industria>(STORES.INDUSTRIAS),
        dbGetAll<VinculoPromotorIndustria>(STORES.VINCULOS_PROMOTOR_INDUSTRIA),
        dbGetAll<SolicitacaoAjusteIsv>(STORES.ISV_SOLICITACOES_AJUSTE),
        dbGetAll<ResumoImportacaoSPCOI007>(STORES.HISTORICO_IMPORTACOES_SPCOI007),
        dbGetAll<RegistroPlanilhaIsv>(STORES.ISV_REGISTROS_OPERACIONAIS),
        dbGetAll<ResumoImportacaoIsv>(STORES.HISTORICO_IMPORTACOES_ISV),
      ]);

      this._fornecedores = fornec || [];
      this._industrias = indus || [];
      this._vinculos = vincs || [];
      this._solicitacoesAjuste = ajus || [];
      this._historicoSpcoi = hist || [];
      this._registrosIsvOperacional = regIsv || [];
      this._historicoIsv = histIsv || [];

      // Se a base de indústrias estiver vazia, inicializar com semente de teste operacional
      if (this._industrias.length === 0 && this._fornecedores.length === 0) {
        await this._seedInitialData();
      }

      this._isInitialized = true;
    } catch (err) {
      console.warn('Erro ao carregar dados do ISV do IndexedDB:', err);
      this._isInitialized = true;
    }
  }

  public subscribe(listener: IsvChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    this._listeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('Erro em listener do ISV:', err);
      }
    });
  }

  /**
   * Inicializa dados de demonstração coerentes com a filial 172 caso o banco esteja limpo.
   */
  private async _seedInitialData(): Promise<void> {
    const prods = getProdutos();
    const iso = new Date().toISOString();
    const dataBr = new Date().toLocaleString('pt-BR');

    // 4 Indústrias reais de referência
    const indAmbev: Industria = {
      cnpj: '00000000000191',
      cnpj_formatado: '00.000.000/0001-91',
      razao_social: 'AMBEV BRASIL BEBIDAS S/A',
      nome_exibicao: 'AMBEV',
      ativo: true,
      total_produtos_loja: 0,
      promotores_responsaveis: [],
      criado_em: iso,
      atualizado_em: iso,
    };

    const indDanone: Industria = {
      cnpj: '01123456000188',
      cnpj_formatado: '01.123.456/0001-88',
      razao_social: 'DANONE LTDA',
      nome_exibicao: 'DANONE',
      ativo: true,
      total_produtos_loja: 0,
      promotores_responsaveis: [],
      criado_em: iso,
      atualizado_em: iso,
    };

    const indNestle: Industria = {
      cnpj: '02987654000122',
      cnpj_formatado: '02.987.654/0001-22',
      razao_social: 'NESTLE BRASIL ALIMENTOS S/A',
      nome_exibicao: 'NESTLÉ',
      ativo: true,
      total_produtos_loja: 0,
      promotores_responsaveis: [],
      criado_em: iso,
      atualizado_em: iso,
    };

    const indBRF: Industria = {
      cnpj: '03555444000133',
      cnpj_formatado: '03.555.444/0001-33',
      razao_social: 'BRF S.A. - SADIA / PERDIGAO',
      nome_exibicao: 'BRF (SADIA / PERDIGÃO)',
      ativo: true,
      total_produtos_loja: 0,
      promotores_responsaveis: [],
      criado_em: iso,
      atualizado_em: iso,
    };

    const industrias = [indAmbev, indDanone, indNestle, indBRF];
    const fornecedores: FornecedorSPCOI007[] = [];

    // Mapear produtos reais se existirem na SMGOI013
    if (prods.length > 0) {
      prods.slice(0, 40).forEach((p, idx) => {
        let indAlvo = indDanone;
        if (idx % 4 === 0) indAlvo = indAmbev;
        else if (idx % 4 === 1) indAlvo = indNestle;
        else if (idx % 4 === 2) indAlvo = indBRF;

        fornecedores.push({
          id: `${indAlvo.cnpj}_${p.codigo_interno}`,
          cnpj: indAlvo.cnpj,
          cnpj_formatado: indAlvo.cnpj_formatado,
          razao_social: indAlvo.razao_social,
          codigo_interno: p.codigo_interno,
          digito: p.digito,
          codigo_exibicao: p.codigo_exibicao,
          descricao_spcoi: p.descricao,
          criado_em: dataBr,
        });

        indAlvo.total_produtos_loja = (indAlvo.total_produtos_loja || 0) + 1;

        // Simular produto com múltiplos CNPJs para teste do requisito de integridade
        if (idx === 0) {
          fornecedores.push({
            id: `${indAmbev.cnpj}_${p.codigo_interno}`,
            cnpj: indAmbev.cnpj,
            cnpj_formatado: indAmbev.cnpj_formatado,
            razao_social: indAmbev.razao_social,
            codigo_interno: p.codigo_interno,
            digito: p.digito,
            codigo_exibicao: p.codigo_exibicao,
            descricao_spcoi: p.descricao,
            criado_em: dataBr,
          });
          indAmbev.total_produtos_loja = (indAmbev.total_produtos_loja || 0) + 1;
        }
      });
    }

    this._industrias = industrias;
    this._fornecedores = fornecedores;

    // Persistir no IndexedDB
    await Promise.all([
      dbPutAll(STORES.INDUSTRIAS, industrias),
      dbPutAll(STORES.SPCOI007_FORNECEDORES, fornecedores),
    ]);
  }

  // ==========================================
  // FORNECEDORES & IMPORTAÇÃO SPCOI007
  // ==========================================

  public getFornecedores(): FornecedorSPCOI007[] {
    return [...this._fornecedores];
  }

  public getHistoricoSpcoi(): ResumoImportacaoSPCOI007[] {
    return [...this._historicoSpcoi];
  }

  public async salvarImportacaoSpcoi(
    fornecedores: FornecedorSPCOI007[],
    industrias: Industria[],
    resumo: ResumoImportacaoSPCOI007
  ): Promise<void> {
    // 1. Preservar nomes comerciais de exibição já customizados pelo usuário
    const industriasExistentesMap = new Map<string, Industria>();
    this._industrias.forEach((i) => industriasExistentesMap.set(i.cnpj, i));

    const industriasAtualizadas = industrias.map((nova) => {
      const existente = industriasExistentesMap.get(nova.cnpj);
      if (existente) {
        return {
          ...nova,
          nome_exibicao: existente.nome_exibicao || nova.razao_social,
          ativo: existente.ativo !== undefined ? existente.ativo : true,
          promotores_responsaveis: existente.promotores_responsaveis || [],
        };
      }
      return nova;
    });

    // 2. Atualizar estado em memória
    this._fornecedores = fornecedores;
    this._industrias = industriasAtualizadas;
    this._historicoSpcoi = [resumo, ...this._historicoSpcoi.slice(0, 19)];

    // 3. Persistir de forma atômica no IndexedDB
    await Promise.all([
      dbPutAll(STORES.SPCOI007_FORNECEDORES, fornecedores),
      dbPutAll(STORES.INDUSTRIAS, industriasAtualizadas),
      dbPutAll(STORES.HISTORICO_IMPORTACOES_SPCOI007, this._historicoSpcoi),
    ]);

    this._notify();
  }

  // ==========================================
  // NOVA PLANILHA OPERACIONAL DO ISV (FONTE OFICIAL)
  // ==========================================

  public async salvarImportacaoPlanilhaIsv(
    registros: RegistroPlanilhaIsv[],
    resumo: ResumoImportacaoIsv
  ): Promise<void> {
    this._registrosIsvOperacional = registros;
    this._historicoIsv = [resumo, ...this._historicoIsv.slice(0, 19)];

    await Promise.all([
      dbPutAll(STORES.ISV_REGISTROS_OPERACIONAIS, registros),
      dbPutAll(STORES.HISTORICO_IMPORTACOES_ISV, this._historicoIsv),
    ]);

    this._notify();
  }

  public async limparPlanilhaIsv(): Promise<void> {
    this._registrosIsvOperacional = [];
    await dbClear(STORES.ISV_REGISTROS_OPERACIONAIS);
    this._notify();
  }

  public getRegistrosIsvOperacional(): RegistroPlanilhaIsv[] {
    return [...this._registrosIsvOperacional];
  }

  public getHistoricoIsv(): ResumoImportacaoIsv[] {
    return [...this._historicoIsv];
  }

  public getResumoIsvAtual(): ResumoImportacaoIsv | null {
    return this._historicoIsv.length > 0 ? this._historicoIsv[0] : null;
  }

  public temPlanilhaIsv(): boolean {
    return this._registrosIsvOperacional.length > 0;
  }

  /**
   * Obtém o registro operacional completo (36 colunas) correspondente a um código interno / dígito.
   */
  public getRegistroOperacional(codigoInterno: string, digito?: string): RegistroPlanilhaIsv | undefined {
    if (!codigoInterno) return undefined;
    const codClean = codigoInterno.toString().trim().replace(/^0+/, '');
    const digClean = digito !== undefined ? digito.toString().trim().replace(/^0+/, '') : undefined;

    // 1. Busca exata por código interno raiz e dígito
    if (digClean !== undefined && digClean !== '') {
      const match = this._registrosIsvOperacional.find((r) => {
        const rCod = (r.codigo_interno || '').toString().trim().replace(/^0+/, '');
        const rDig = (r.digito || '').toString().trim().replace(/^0+/, '');
        return rCod === codClean && rDig === digClean;
      });
      if (match) return match;
    }

    // 2. Busca por chave_normalizada
    const chave = digClean ? `${codClean}-${digClean}` : codClean;
    const byKey = this._registrosIsvOperacional.find((r) => {
      const rKey = (r.chave_normalizada || `${r.codigo_interno}-${r.digito}`).replace(/^0+/, '');
      return rKey === chave || (r.codigo_interno && r.codigo_interno.replace(/^0+/, '') === codClean);
    });
    if (byKey) return byKey;

    // 3. Fallback: código raiz
    return this._registrosIsvOperacional.find((r) => {
      const rCod = (r.codigo_interno || '').toString().trim().replace(/^0+/, '');
      return rCod === codClean;
    });
  }

  /**
   * Obtém os responsáveis (indústrias, CNPJs, promotores e agências) vinculados via SPCOI007.
   */
  public getResponsaveisPorCodigoInterno(codigoInterno: string): ResponsaveisMercadoria {
    if (!codigoInterno) {
      return {
        cnpjs: [],
        industrias: [],
        promotores: [],
        agencias: [],
        tem_promotor: false,
        multiplos_cnpjs: false,
      };
    }

    const codNorm = codigoInterno.toString().trim().replace(/^0+/, '');

    const fornecedores = this._fornecedores.filter((f) => {
      const fCod = (f.codigo_interno || '').toString().trim().replace(/^0+/, '');
      return fCod === codNorm;
    });

    const cnpjs = Array.from(new Set(fornecedores.map((f) => f.cnpj)));
    const industrias = cnpjs.map((cnpj) => {
      const ind = this._industrias.find((i) => i.cnpj === cnpj);
      const nome = ind ? (ind.nome_exibicao || ind.razao_social) : cnpj;
      return {
        cnpj,
        cnpj_formatado: formatarCnpj(cnpj),
        nome,
      };
    });

    const vincs = this._vinculos.filter((v) => cnpjs.includes(v.cnpj));
    const promotores = Array.from(new Set(vincs.map((v) => v.promotorNome)));
    const agencias = Array.from(new Set(vincs.map((v) => v.agenciaNome).filter(Boolean)));

    return {
      cnpjs,
      industrias,
      promotores,
      agencias,
      tem_promotor: promotores.length > 0,
      multiplos_cnpjs: cnpjs.length > 1,
    };
  }

  // ==========================================
  // GESTÃO DE INDÚSTRIAS
  // ==========================================

  public getIndustrias(): Industria[] {
    return [...this._industrias];
  }

  public getIndustriaByCnpj(cnpj: string): Industria | undefined {
    const norm = normalizarCnpj(cnpj);
    return this._industrias.find((i) => i.cnpj === norm);
  }

  public async salvarIndustria(industria: Industria): Promise<void> {
    const norm = normalizarCnpj(industria.cnpj);
    const idx = this._industrias.findIndex((i) => i.cnpj === norm);
    const item: Industria = {
      ...industria,
      cnpj: norm,
      cnpj_formatado: formatarCnpj(norm),
      atualizado_em: new Date().toISOString(),
    };

    if (idx >= 0) {
      this._industrias[idx] = item;
    } else {
      this._industrias.push(item);
    }

    await dbPut(STORES.INDUSTRIAS, item);
    this._notify();
  }

  // ==========================================
  // VINCULAÇÃO PROMOTOR ↔ INDÚSTRIA
  // ==========================================

  public getVinculosPromotorIndustria(): VinculoPromotorIndustria[] {
    return [...this._vinculos];
  }

  public getIndustriasDoPromotor(promotorId: string): Industria[] {
    const cnpjs = this._vinculos
      .filter((v) => v.promotorId === promotorId)
      .map((v) => v.cnpj);
    return this._industrias.filter((i) => cnpjs.includes(i.cnpj));
  }

  public getPromotoresDaIndustria(cnpj: string): VinculoPromotorIndustria[] {
    const norm = normalizarCnpj(cnpj);
    return this._vinculos.filter((v) => v.cnpj === norm);
  }

  /**
   * Vincula um promotor a um CNPJ de indústria usando chave estável:
   * promotorId + cnpjNormalizado + filialId
   */
  public async vincularPromotorIndustria(
    promotor: Promotor,
    cnpj: string,
    filialId = '172'
  ): Promise<void> {
    const cnpjNorm = normalizarCnpj(cnpj);
    const id = `${promotor.promotorId}_${cnpjNorm}_${filialId}`;

    const jaExiste = this._vinculos.some((v) => v.id === id);
    if (jaExiste) return;

    const novoVinculo: VinculoPromotorIndustria = {
      id,
      promotorId: promotor.promotorId,
      promotorNome: promotor.nome,
      agenciaNome: promotor.agenciaNome || 'Agência não informada',
      cnpj: cnpjNorm,
      filialId,
      criado_em: new Date().toISOString(),
    };

    this._vinculos.push(novoVinculo);

    // Atualizar lista de promotores na indústria
    const ind = this._industrias.find((i) => i.cnpj === cnpjNorm);
    if (ind) {
      const resp = new Set(ind.promotores_responsaveis || []);
      resp.add(promotor.nome);
      ind.promotores_responsaveis = Array.from(resp);
      await dbPut(STORES.INDUSTRIAS, ind);
    }

    await dbPut(STORES.VINCULOS_PROMOTOR_INDUSTRIA, novoVinculo);
    this._notify();
  }

  /**
   * Desvincula um promotor de um CNPJ de indústria.
   */
  public async desvincularPromotorIndustria(
    promotorId: string,
    cnpj: string,
    filialId = '172'
  ): Promise<void> {
    const cnpjNorm = normalizarCnpj(cnpj);
    const id = `${promotorId}_${cnpjNorm}_${filialId}`;

    this._vinculos = this._vinculos.filter((v) => v.id !== id);

    // Atualizar indústria
    const ind = this._industrias.find((i) => i.cnpj === cnpjNorm);
    if (ind && ind.promotores_responsaveis) {
      const promotoresRestantes = this._vinculos
        .filter((v) => v.cnpj === cnpjNorm)
        .map((v) => v.promotorNome);
      ind.promotores_responsaveis = promotoresRestantes;
      await dbPut(STORES.INDUSTRIAS, ind);
    }

    await dbPutAll(STORES.VINCULOS_PROMOTOR_INDUSTRIA, this._vinculos);
    this._notify();
  }

  // ==========================================
  // CONSOLIDAÇÃO DO MÓDULO ISV (ITENS SEM VENDA)
  // ==========================================

  /**
   * Formata a quantidade em estoque no padrão operacional:
   * - CX/UN: "10 CX + 4 UN" ou "14 UN"
   * - KG/G: "12 KG + 500 G" ou "500 G"
   */
  public formatarEstoqueIsv(produto: ProdutoSMG): string {
    const isPeso =
      (produto.unidade_medida && produto.unidade_medida.toUpperCase() === 'KG') ||
      isProdutoPesavel(produto.embalagem);

    const est = produto.estoque_total || 0;
    if (est <= 0) return isPeso ? '0 KG' : '0 UN';

    if (isPeso) {
      const kg =
        produto.estoque_emb1 !== undefined && produto.estoque_emb1 > 0
          ? Math.floor(produto.estoque_emb1)
          : Math.floor(est);
      const gramas =
        produto.estoque_emb9 !== undefined && produto.estoque_emb9 > 0
          ? Math.round(produto.estoque_emb9)
          : Math.round((est - Math.floor(est)) * 1000);

      const parts: string[] = [];
      if (kg > 0) parts.push(`${kg} KG`);
      if (gramas > 0) parts.push(`${gramas} G`);
      if (parts.length === 0) return '0 KG';
      return parts.join(' + ');
    }

    const embData = parseEmbalagem(produto.embalagem || '');
    const fator =
      produto.fator_embalagem && produto.fator_embalagem > 1
        ? produto.fator_embalagem
        : embData.fator && embData.fator > 1
        ? embData.fator
        : 1;

    if (fator > 1) {
      const cx =
        produto.estoque_emb1 !== undefined && produto.estoque_emb1 > 0
          ? produto.estoque_emb1
          : Math.floor(est / fator);
      const un =
        produto.estoque_emb9 !== undefined && produto.estoque_emb9 > 0
          ? produto.estoque_emb9
          : est % fator;

      const parts: string[] = [];
      if (cx > 0) parts.push(`${cx} CX`);
      if (un > 0) parts.push(`${un} UN`);
      if (parts.length === 0) return '0 UN';
      return parts.join(' + ');
    }

    return `${est} UN`;
  }

  /**
   * Calcula o valor financeiro do estoque:
   * Valor = Estoque Total Convertido × Custo Médio Unitário
   * Respeita: Se custo médio ausente/inválido, retorna null (não inventa R$ 0,00).
   */
  public calcularValorEstoque(produto: ProdutoSMG): number | null {
    const res = calcularValorEstoqueCentralizado({
      estoqueEmb1: produto.estoque_emb1,
      estoqueEmb9: produto.estoque_emb9,
      embalagem: produto.embalagem,
      fatorEmbalagem: produto.fator_embalagem,
      tipoUnidade: produto.unidade_medida,
      custoMedio: produto.custo_medio,
      estoqueConvertido: produto.estoque_total,
      valorEstoquePlanilha: produto.valor_estoque_planilha,
      vendasPreco: produto.vendas_preco,
    });
    return res.valorTotalEstoque;
  }

  public calcularPosicaoFinanceira(produto: ProdutoSMG): ResultadoCalculoFinanceiro {
    return calcularValorEstoqueCentralizado({
      estoqueEmb1: produto.estoque_emb1,
      estoqueEmb9: produto.estoque_emb9,
      embalagem: produto.embalagem,
      fatorEmbalagem: produto.fator_embalagem,
      tipoUnidade: produto.unidade_medida,
      custoMedio: produto.custo_medio,
      estoqueConvertido: produto.estoque_total,
      valorEstoquePlanilha: produto.valor_estoque_planilha,
      vendasPreco: produto.vendas_preco,
    });
  }

  /**
   * Monta a estrutura detalhada de vínculos (Indústria ↔ CNPJ ↔ Promotor ↔ Agência),
   * preservando a correspondência exata de cada vínculo sem misturar promotores entre indústrias.
   */
  private _montarVinculosDetalhados(
    cnpjs: string[],
    forns: FornecedorSPCOI007[],
    industriasMap: Map<string, Industria>,
    vinculosPorCnpj: Map<string, VinculoPromotorIndustria[]>,
    fornecedorPlanilha?: string
  ): VinculoIndustriaItemIsv[] {
    const list: VinculoIndustriaItemIsv[] = [];

    cnpjs.forEach((cnpj) => {
      const ind = industriasMap.get(cnpj);
      const fornec = forns.find((f) => f.cnpj === cnpj);
      const nome = ind?.nome_exibicao || ind?.razao_social || fornec?.razao_social || cnpj;
      const vincs = vinculosPorCnpj.get(cnpj) || [];

      const promotoresUnicos: PromotorVinculadoItem[] = [];
      const chavesPromotores = new Set<string>();
      vincs.forEach((v) => {
        const chave = `${v.promotorNome}__${v.agenciaNome || ''}`;
        if (!chavesPromotores.has(chave)) {
          chavesPromotores.add(chave);
          promotoresUnicos.push({
            promotorId: v.promotorId,
            promotorNome: v.promotorNome,
            agenciaNome: v.agenciaNome,
          });
        }
      });

      list.push({
        cnpj,
        cnpj_formatado: formatarCnpj(cnpj),
        nome_industria: nome,
        razao_social: ind?.razao_social || fornec?.razao_social,
        promotores: promotoresUnicos,
      });
    });

    if (list.length === 0 && fornecedorPlanilha && fornecedorPlanilha.trim()) {
      list.push({
        cnpj: '',
        cnpj_formatado: 'Não informado',
        nome_industria: fornecedorPlanilha.trim(),
        promotores: [],
      });
    }

    return list;
  }

  /**
   * Constrói e enriquece a lista de itens ISV com cruzamento de relacionamentos:
   * Produto (SMGOI013) ↔ Fornecedor/Indústria (SPCOI007) ↔ Promotor/Agência (Vínculos)
   */
  public getItensIsv(produtos?: ProdutoSMG[]): ItemIsv[] {
    const prods = produtos || getProdutos();

    // Mapas rápidos em memória
    // codigo_interno -> FornecedorSPCOI007[]
    const fornecedoresPorCodigo = new Map<string, FornecedorSPCOI007[]>();
    this._fornecedores.forEach((f) => {
      if (!fornecedoresPorCodigo.has(f.codigo_interno)) {
        fornecedoresPorCodigo.set(f.codigo_interno, []);
      }
      fornecedoresPorCodigo.get(f.codigo_interno)!.push(f);
    });

    // cnpj -> Industria
    const industriasMap = new Map<string, Industria>();
    this._industrias.forEach((i) => industriasMap.set(i.cnpj, i));

    // cnpj -> VinculoPromotorIndustria[]
    const vinculosPorCnpj = new Map<string, VinculoPromotorIndustria[]>();
    this._vinculos.forEach((v) => {
      if (!vinculosPorCnpj.has(v.cnpj)) {
        vinculosPorCnpj.set(v.cnpj, []);
      }
      vinculosPorCnpj.get(v.cnpj)!.push(v);
    });

    // Mapa rápido de produtos da SMGOI013
    const smgPorCodigo = new Map<string, ProdutoSMG>();
    prods.forEach((p) => {
      smgPorCodigo.set(p.codigo_interno, p);
    });

    // =========================================================================
    // CASO 1: NOVA PLANILHA OPERACIONAL DO ISV IMPORTADA (FONTE OFICIAL MÁXIMA)
    // =========================================================================
    if (this._registrosIsvOperacional.length > 0) {
      return this._registrosIsvOperacional.map((reg) => {
        const p = smgPorCodigo.get(reg.codigo_interno);

        const forns = fornecedoresPorCodigo.get(reg.codigo_interno) || [];
        const cnpjs = Array.from(new Set(forns.map((f) => f.cnpj)));

        const industriasNomes = cnpjs.map((cnpj) => {
          const ind = industriasMap.get(cnpj);
          return ind?.nome_exibicao || ind?.razao_social || cnpj;
        });

        const promotoresNomesSet = new Set<string>();
        const agenciasNomesSet = new Set<string>();

        cnpjs.forEach((cnpj) => {
          const vincs = vinculosPorCnpj.get(cnpj) || [];
          vincs.forEach((v) => {
            promotoresNomesSet.add(v.promotorNome);
            if (v.agenciaNome) agenciasNomesSet.add(v.agenciaNome);
          });
        });

        const promotoresNomes = Array.from(promotoresNomesSet);
        const agenciasNomes = Array.from(agenciasNomesSet);

        // Vínculos detalhados preservando qual promotor/agência pertence a qual CNPJ/indústria
        const vinculosDetalhados = this._montarVinculosDetalhados(
          cnpjs,
          forns,
          industriasMap,
          vinculosPorCnpj,
          reg.fornecedor_planilha
        );

        // Enriquecer produto preservando dados completos da SMGOI013
        const prodItem: ProdutoSMG = p
          ? {
              ...p,
              estoque_total: reg.estoque,
              dias_sem_venda: reg.dias_sem_venda,
              idade: reg.idade,
              valor_estoque_planilha: reg.valor_disponivel !== null ? reg.valor_disponivel : undefined,
            }
          : {
              id: reg.codigo_interno,
              codigo_original: reg.codigo_original,
              codigo_interno: reg.codigo_interno,
              digito: reg.digito,
              codigo_exibicao: reg.codigo_exibicao,
              descricao: reg.nome,
              embalagem: reg.complemento || 'UN',
              fator_embalagem: 1,
              unidade_medida: 'UN',
              estoque_emb1: reg.estoque,
              estoque_emb9: 0,
              estoque_total: reg.estoque,
              vendas_qtde_30d: 0,
              dias_sem_venda: reg.dias_sem_venda,
              idade: reg.idade,
              valor_estoque_planilha: reg.valor_disponivel !== null ? reg.valor_disponivel : undefined,
              eans: [],
              atualizado_em: new Date().toISOString(),
            };

        const estoqueFormatado = this.formatarEstoqueIsv(prodItem);

        // REGRA FINANCEIRA OFICIAL:
        // O valor do estoque no ISV provém estritamente de reg.valor_disponivel da nova planilha.
        // Não é multiplicado pelo estoque, não é dividido pelo fator e não é recalculado com custo médio.
        const valorEstoque = reg.valor_disponivel;
        const valorEstoqueFormatado =
          valorEstoque !== null ? formatarMoedaBR(valorEstoque) : 'VALOR INDISPONÍVEL';

        const multiplosCnpjs = cnpjs.length > 1;
        const temPromotor = promotoresNomes.length > 0;

        const elegivelAjuste =
          reg.dias_sem_venda > 10 &&
          reg.estoque > 0 &&
          (valorEstoque === null || valorEstoque < 250);

        return {
          produto: prodItem,
          codigo_interno: reg.codigo_interno,
          digito: reg.digito,
          codigo_exibicao: reg.codigo_exibicao,
          descricao: reg.nome,
          embalagem: prodItem.embalagem || reg.complemento || 'UN',
          estoque_total: reg.estoque,
          estoque_formatado: estoqueFormatado,
          dias_sem_venda: reg.dias_sem_venda,
          idade: reg.idade,
          custo_medio: p?.custo_medio !== undefined ? p.custo_medio : null,
          valor_estoque: valorEstoque,
          valor_estoque_formatado: valorEstoqueFormatado,
          cnpjs,
          industrias_nomes: industriasNomes,
          promotores_nomes: promotoresNomes,
          agencias_nomes: agenciasNomes,
          tem_promotor: temPromotor,
          multiplos_cnpjs: multiplosCnpjs,
          elegivel_ajuste: elegivelAjuste,
          vinculos_detalhados: vinculosDetalhados,
        };
      });
    }

    // =========================================================================
    // CASO 2: SEM NOVA PLANILHA OPERACIONAL (FALLBACK PARA BASE SMGOI013)
    // =========================================================================
    return prods.map((p) => {
      const forns = fornecedoresPorCodigo.get(p.codigo_interno) || [];
      const cnpjs = Array.from(new Set(forns.map((f) => f.cnpj)));

      const industriasNomes = cnpjs.map((cnpj) => {
        const ind = industriasMap.get(cnpj);
        return ind?.nome_exibicao || ind?.razao_social || cnpj;
      });

      const promotoresNomesSet = new Set<string>();
      const agenciasNomesSet = new Set<string>();

      cnpjs.forEach((cnpj) => {
        const vincs = vinculosPorCnpj.get(cnpj) || [];
        vincs.forEach((v) => {
          promotoresNomesSet.add(v.promotorNome);
          if (v.agenciaNome) agenciasNomesSet.add(v.agenciaNome);
        });
      });

      const promotoresNomes = Array.from(promotoresNomesSet);
      const agenciasNomes = Array.from(agenciasNomesSet);

      const vinculosDetalhados = this._montarVinculosDetalhados(
        cnpjs,
        forns,
        industriasMap,
        vinculosPorCnpj
      );

      const valorEstoque = this.calcularValorEstoque(p);
      const estoqueFormatado = this.formatarEstoqueIsv(p);
      const multiplosCnpjs = cnpjs.length > 1;
      const temPromotor = promotoresNomes.length > 0;

      // Critério de elegibilidade para possíveis ajustes:
      // - Mais de 10 dias sem venda
      // - Valor total do estoque inferior a R$ 250 (ou valor indisponível com estoque > 0)
      // - Estoque físico registrado maior que zero
      const diasSemVenda = p.dias_sem_venda || 0;
      const estoquePositivo = (p.estoque_total || 0) > 0;
      const elegivelAjuste =
        diasSemVenda > 10 &&
        estoquePositivo &&
        (valorEstoque === null || valorEstoque < 250);

      return {
        produto: p,
        codigo_interno: p.codigo_interno,
        digito: p.digito,
        codigo_exibicao: p.codigo_exibicao,
        descricao: p.descricao,
        embalagem: p.embalagem,
        estoque_total: p.estoque_total || 0,
        estoque_formatado: estoqueFormatado,
        dias_sem_venda: diasSemVenda,
        idade: p.idade || 0,
        custo_medio: p.custo_medio !== undefined ? p.custo_medio : null,
        valor_estoque: valorEstoque,
        valor_estoque_formatado:
          valorEstoque !== null ? formatarMoedaBR(valorEstoque) : 'VALOR INDISPONÍVEL',
        cnpjs,
        industrias_nomes: industriasNomes,
        promotores_nomes: promotoresNomes,
        agencias_nomes: agenciasNomes,
        tem_promotor: temPromotor,
        multiplos_cnpjs: multiplosCnpjs,
        elegivel_ajuste: elegivelAjuste,
        vinculos_detalhados: vinculosDetalhados,
      };
    });
  }

  /**
   * Aplica filtros combináveis sobre a lista de itens ISV.
   */
  public filtrarItensIsv(itens: ItemIsv[], filtros: FiltrosIsv): ItemIsv[] {
    return itens
      .filter((item) => {
        // 1. Termo de busca (Código interno, dígito, código completo, descrição, EAN)
        if (filtros.termoBusca && filtros.termoBusca.trim()) {
          const q = filtros.termoBusca.trim().toUpperCase();
          const matchCod = item.codigo_interno.includes(q);
          const matchExib = item.codigo_exibicao.toUpperCase().includes(q);
          const matchDesc = item.descricao.toUpperCase().includes(q);
          const matchEan = (item.produto.eans || []).some((e) => e.includes(q));
          if (!matchCod && !matchExib && !matchDesc && !matchEan) {
            return false;
          }
        }

        // 2. Agência
        if (filtros.agencia && filtros.agencia !== 'TODAS') {
          if (!item.agencias_nomes.includes(filtros.agencia)) return false;
        }

        // 3. Indústria (por CNPJ)
        if (filtros.industriaCnpj && filtros.industriaCnpj !== 'TODAS') {
          const normCnpj = normalizarCnpj(filtros.industriaCnpj);
          if (!item.cnpjs.includes(normCnpj)) return false;
        }

        // 4. Promotor
        if (filtros.promotorId && filtros.promotorId !== 'TODOS') {
          // Localizar nome do promotor para cruzamento
          const promotor = promotorService
            .getPromotores()
            .find((pr) => pr.promotorId === filtros.promotorId);
          if (promotor && !item.promotores_nomes.includes(promotor.nome)) {
            return false;
          }
        }

        // 5. Setor Físico
        if (filtros.setorFisico && filtros.setorFisico !== 'TODOS') {
          if (item.produto.setor_fisico !== filtros.setorFisico) return false;
        }

        // 6. Setor Balanço
        if (filtros.setorBalanco && filtros.setorBalanco !== 'TODOS') {
          if (item.produto.setor_balanco !== filtros.setorBalanco) return false;
        }

        // 7. Dias Sem Venda
        if (filtros.diasSemVenda !== null && filtros.diasSemVenda !== undefined) {
          if (filtros.modoDiasSemVenda === 'EXATO') {
            if (item.dias_sem_venda !== filtros.diasSemVenda) return false;
          } else {
            if (item.dias_sem_venda < filtros.diasSemVenda) return false;
          }
        }

        // 8. Idade da Mercadoria
        if (filtros.idade !== null && filtros.idade !== undefined) {
          if (filtros.modoIdade === 'EXATO') {
            if (item.idade !== filtros.idade) return false;
          } else {
            if (item.idade < filtros.idade) return false;
          }
        }

        // 9. Situação do Estoque
        if (filtros.filtroEstoque === 'COM_ESTOQUE' && item.estoque_total <= 0) {
          return false;
        }
        if (filtros.filtroEstoque === 'SEM_ESTOQUE' && item.estoque_total > 0) {
          return false;
        }

        // 10. Faixa de Valor Financeiro do Estoque
        if (filtros.filtroValor === 'ATE_250') {
          if (item.valor_estoque === null || item.valor_estoque > 250) return false;
        } else if (filtros.filtroValor === 'ACIMA_250') {
          if (item.valor_estoque === null || item.valor_estoque <= 250) return false;
        } else if (filtros.filtroValor === 'CUSTOM') {
          if (filtros.valorMin !== undefined && (item.valor_estoque === null || item.valor_estoque < filtros.valorMin)) {
            return false;
          }
          if (filtros.valorMax !== undefined && (item.valor_estoque === null || item.valor_estoque > filtros.valorMax)) {
            return false;
          }
        }

        // 11. Situação da Vinculação
        if (filtros.situacaoVinculo === 'COM_PROMOTOR' && !item.tem_promotor) {
          return false;
        }
        if (filtros.situacaoVinculo === 'SEM_PROMOTOR' && item.tem_promotor) {
          return false;
        }
        if (filtros.situacaoVinculo === 'MULTIPLOS_CNPJS' && !item.multiplos_cnpjs) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Ordenação padrão: MAIOR VALOR DO ESTOQUE
        // Regra obrigatória:
        // - Produtos sem valor calculável ficam no fim da classificação (nunca ocupam primeiras posições).
        // - Classificação numérica decrescente.
        // - Em caso de empate, utilizar código interno numérico e dígito como desempate estável.
        if (filtros.ordenacao === 'MAIOR_VALOR') {
          const hasA = a.valor_estoque !== null && a.valor_estoque !== undefined;
          const hasB = b.valor_estoque !== null && b.valor_estoque !== undefined;
          if (hasA && !hasB) return -1;
          if (!hasA && hasB) return 1;
          if (hasA && hasB) {
            const diff = (b.valor_estoque as number) - (a.valor_estoque as number);
            if (Math.abs(diff) > 0.0001) return diff;
          }
          // Critério de desempate:
          // 1. Mais dias sem venda
          const diffDias = (b.dias_sem_venda || 0) - (a.dias_sem_venda || 0);
          if (diffDias !== 0) return diffDias;
          // 2. Maior idade
          const diffIdade = (b.idade || 0) - (a.idade || 0);
          if (diffIdade !== 0) return diffIdade;
          // 3. Código interno numérico e depois dígito
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          if (codA !== codB) return codA - codB;
          return (a.digito || '').localeCompare(b.digito || '');
        }

        if (filtros.ordenacao === 'MENOR_VALOR') {
          const hasA = a.valor_estoque !== null && a.valor_estoque !== undefined;
          const hasB = b.valor_estoque !== null && b.valor_estoque !== undefined;
          if (hasA && !hasB) return -1;
          if (!hasA && hasB) return 1;
          if (hasA && hasB) {
            const diff = (a.valor_estoque as number) - (b.valor_estoque as number);
            if (Math.abs(diff) > 0.0001) return diff;
          }
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          if (codA !== codB) return codA - codB;
          return (a.digito || '').localeCompare(b.digito || '');
        }

        if (filtros.ordenacao === 'MAIS_DIAS_SEM_VENDA') {
          const diff = b.dias_sem_venda - a.dias_sem_venda;
          if (diff !== 0) return diff;
          const valA = a.valor_estoque ?? -1;
          const valB = b.valor_estoque ?? -1;
          if (valB !== valA) return valB - valA;
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          return codA - codB;
        }

        if (filtros.ordenacao === 'MAIOR_IDADE') {
          const diff = b.idade - a.idade;
          if (diff !== 0) return diff;
          const valA = a.valor_estoque ?? -1;
          const valB = b.valor_estoque ?? -1;
          if (valB !== valA) return valB - valA;
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          return codA - codB;
        }

        if (filtros.ordenacao === 'CODIGO') {
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          if (codA !== codB) return codA - codB;
          return (a.digito || '').localeCompare(b.digito || '');
        }

        return 0;
      });
  }

  /**
   * Consolida métricas resumidas do painel ISV garantindo que produtos com múltiplos
   * vínculos não dupliquem o valor financeiro ou a contagem geral.
   */
  public getIndicadoresIsv(itens: ItemIsv[]): {
    totalProdutos: number;
    produtosComEstoque: number;
    valorTotalEstoque: number;
    totalIndustrias: number;
    totalPromotores: number;
    produtosSemResponsavel: number;
    candidatosAjuste: number;
  } {
    const produtosUnicos = new Set<string>();
    let produtosComEstoque = 0;
    let valorTotalEstoque = 0;
    const industriasSet = new Set<string>();
    const promotoresSet = new Set<string>();
    let produtosSemResponsavel = 0;
    let candidatosAjuste = 0;

    itens.forEach((it) => {
      if (!produtosUnicos.has(it.codigo_interno)) {
        produtosUnicos.add(it.codigo_interno);

        if (it.estoque_total > 0) produtosComEstoque++;
        if (it.valor_estoque !== null) valorTotalEstoque += it.valor_estoque;
        if (!it.tem_promotor) produtosSemResponsavel++;
        if (it.elegivel_ajuste) candidatosAjuste++;
      }

      it.cnpjs.forEach((cnpj) => industriasSet.add(cnpj));
      it.promotores_nomes.forEach((pr) => promotoresSet.add(pr));
    });

    return {
      totalProdutos: produtosUnicos.size,
      produtosComEstoque,
      valorTotalEstoque: Number(valorTotalEstoque.toFixed(2)),
      totalIndustrias: industriasSet.size,
      totalPromotores: promotoresSet.size,
      produtosSemResponsavel,
      candidatosAjuste,
    };
  }

  // ==========================================
  // OCORRÊNCIAS / POSSÍVEIS AJUSTES
  // ==========================================

  public getSolicitacoesAjuste(): SolicitacaoAjusteIsv[] {
    return [...this._solicitacoesAjuste];
  }

  public async addSolicitacaoAjuste(
    dados: Omit<SolicitacaoAjusteIsv, 'id' | 'data_registro' | 'status'>
  ): Promise<SolicitacaoAjusteIsv> {
    const id = `ajuste_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const dataAtual = new Date().toLocaleString('pt-BR');

    const nova: SolicitacaoAjusteIsv = {
      ...dados,
      id,
      status: 'PENDENTE',
      data_registro: dataAtual,
      historico: [
        {
          data: dataAtual,
          acao: 'Ocorrência de divergência física registrada no ISV',
          usuario: dados.responsavel || 'Operador',
        },
      ],
    };

    this._solicitacoesAjuste = [nova, ...this._solicitacoesAjuste];
    await dbPut(STORES.ISV_SOLICITACOES_AJUSTE, nova);
    this._notify();
    return nova;
  }

  public async updateSolicitacaoAjuste(
    id: string,
    updates: Partial<SolicitacaoAjusteIsv>
  ): Promise<void> {
    const idx = this._solicitacoesAjuste.findIndex((s) => s.id === id);
    if (idx < 0) return;

    const item = {
      ...this._solicitacoesAjuste[idx],
      ...updates,
    };

    this._solicitacoesAjuste[idx] = item;
    await dbPut(STORES.ISV_SOLICITACOES_AJUSTE, item);
    this._notify();
  }
}

export const isvService = new IsvService();
