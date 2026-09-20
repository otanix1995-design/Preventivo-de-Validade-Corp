/**
 * Serviço de Análise de Solicitações do App Promotor
 * 
 * Gerencia a recepção, verificação de duplicidade, aprovação com atualização de contagem
 * ou criação de novo vencimento, recusa motivada e auditoria.
 * 
 * Coleção de leitura: solicitacoesVencimentoPromotor
 * Coleção de gravação oficial: vencimentos (através do productRepository e centralFirestoreService)
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where
} from 'firebase/firestore';
import { db } from './firebase';
import { productRepository } from './productRepository';
import { promotorService } from './promotorService';
import { buildVencimentoKey } from './deviceId';
import { normalizeDateToIso, normalizeInternalCode } from './duplicateValidator';
import { parseEmbalagem } from './codeParser';
import { findProdutoByCodeOrEan } from './storage';
import {
  LoteVencimento,
  ResultadoAprovacaoSolicitacao,
  SolicitacaoVencimentoPromotor
} from '../types';

/**
 * Normaliza documento bruto do Firestore no formato tipado canônico SolicitacaoVencimentoPromotor.
 * Resolve validade canônica YYYY-MM-DD, fator de embalagem da SMGOI013 e quantidade em unidades totais.
 */
export function parseDocToSolicitacao(id: string, data: any, fallbackFilial: string = '172'): SolicitacaoVencimentoPromotor {
  const filialId = data.filialId || fallbackFilial;
  const codigoInterno = String(data.codigoInterno || '').trim();
  const digito = String(data.digito || '0').trim();
  const codigoCompleto = data.codigoCompleto || (digito ? `${codigoInterno}-${digito}` : codigoInterno);
  const ean = data.ean || (Array.isArray(data.eans) && data.eans[0]) || '';

  // 1. Resolver dados cadastrais da mercadoria na SMGOI013 (para fator de embalagem e setor)
  const produtoSmg = findProdutoByCodeOrEan(codigoInterno || codigoCompleto || ean);

  // 2. Determinar FATOR DE EMBALAGEM real da SMGOI013
  let fatorEmbalagem = 1;
  if (data.fatorEmbalagem !== undefined && Number(data.fatorEmbalagem) > 0) {
    fatorEmbalagem = Number(data.fatorEmbalagem);
  } else if (data.fator_embalagem !== undefined && Number(data.fator_embalagem) > 0) {
    fatorEmbalagem = Number(data.fator_embalagem);
  } else if (produtoSmg?.fator_embalagem && Number(produtoSmg.fator_embalagem) > 0) {
    fatorEmbalagem = Number(produtoSmg.fator_embalagem);
  } else {
    const rawEmb = data.embalagem || produtoSmg?.embalagem;
    if (rawEmb) {
      const parsed = parseEmbalagem(rawEmb);
      if (parsed && parsed.fator && parsed.fator > 0) {
        fatorEmbalagem = parsed.fator;
      }
    }
  }

  const embalagem = data.embalagem || produtoSmg?.embalagem || (fatorEmbalagem > 1 ? `CXA 1 X ${fatorEmbalagem}` : 'UN');
  const unidadeMedida = data.unidadeMedida || data.unidade_medida || produtoSmg?.unidade_medida || (fatorEmbalagem > 1 ? 'CXA' : 'UN');

  // 3. Resolver DATA DE VALIDADE (ISO YYYY-MM-DD)
  // Verifica: dataValidade / validade / dataVencimento / data_validade / expirationDate
  const rawDate = data.dataValidade || data.validade || data.dataVencimento || data.data_validade || data.expirationDate || '';
  const dataIso = normalizeDateToIso(rawDate);
  const isDataValida = !!dataIso;
  const dataValidade = dataIso || '';
  const dataVencimento = dataValidade; // Mantém sincronizado para retrocompatibilidade

  // 4. Resolver QUANTIDADE (CANÔNICA EM UNIDADES TOTAIS)
  // Regra fundamental: NUNCA somar 4 CX + 1 UN como 5 UN.
  // Ex: 4 CX + 1 UN com fator 15 = 4 * 15 + 1 = 61 UNIDADES.
  let quantidadeTotalUnidades = 0;
  let quantidadeCaixas: number | undefined = undefined;
  let quantidadeUnidades: number | undefined = undefined;
  const quantidadeEmb1 = data.quantidadeEmb1 !== undefined ? Number(data.quantidadeEmb1) : undefined;
  const quantidadeEmb9 = data.quantidadeEmb9 !== undefined ? Number(data.quantidadeEmb9) : undefined;
  const rawQuantidade = Number(data.quantidadeInformada ?? data.quantidade ?? 0);

  if (data.quantidadeTotalUnidades !== undefined && data.quantidadeTotalUnidades !== null && !isNaN(Number(data.quantidadeTotalUnidades))) {
    // Documento já possui total em unidades canônico
    quantidadeTotalUnidades = Number(data.quantidadeTotalUnidades);
    if (fatorEmbalagem > 1) {
      quantidadeCaixas = data.quantidadeCaixas !== undefined ? Number(data.quantidadeCaixas) : Math.floor(quantidadeTotalUnidades / fatorEmbalagem);
      quantidadeUnidades = data.quantidadeUnidades !== undefined ? Number(data.quantidadeUnidades) : Math.round((quantidadeTotalUnidades % fatorEmbalagem) * 100) / 100;
    } else {
      quantidadeCaixas = 0;
      quantidadeUnidades = quantidadeTotalUnidades;
    }
  } else if (quantidadeEmb1 !== undefined || data.quantidadeCaixas !== undefined) {
    // Documento original do App Promotor com caixas e unidades separadas
    const cx = Number(data.quantidadeCaixas ?? quantidadeEmb1 ?? 0);
    const un = Number(data.quantidadeUnidades ?? data.quantidadeUnidadesRestantes ?? quantidadeEmb9 ?? 0);
    quantidadeCaixas = cx;
    quantidadeUnidades = un;
    quantidadeTotalUnidades = (cx * fatorEmbalagem) + un;
  } else {
    // Apenas quantidade simples enviada
    quantidadeTotalUnidades = rawQuantidade;
    if (fatorEmbalagem > 1) {
      quantidadeCaixas = Math.floor(rawQuantidade / fatorEmbalagem);
      quantidadeUnidades = rawQuantidade % fatorEmbalagem;
    } else {
      quantidadeCaixas = 0;
      quantidadeUnidades = rawQuantidade;
    }
  }

  // 5. Montar texto descritivo da quantidade (ex: "4 CX + 1 UN")
  let quantidadeTexto = data.quantidadeTexto;
  if (!quantidadeTexto) {
    if (fatorEmbalagem > 1) {
      const cx = quantidadeCaixas ?? 0;
      const un = quantidadeUnidades ?? 0;
      if (cx > 0 && un > 0) {
        quantidadeTexto = `${cx} CX + ${un} UN`;
      } else if (cx > 0) {
        quantidadeTexto = `${cx} CX`;
      } else {
        quantidadeTexto = `${un} UN`;
      }
    } else if (unidadeMedida === 'KG') {
      quantidadeTexto = `${quantidadeTotalUnidades.toFixed(3)} KG`;
    } else {
      quantidadeTexto = `${quantidadeTotalUnidades} UN`;
    }
  }

  // 6. Preço Normal (DE:)
  const precoNormal = Number(
    data.precoNormal ?? data.preco_normal ?? data.precoDe ?? produtoSmg?.vendas_preco ?? 0
  ) || null;

  // 7. Validação de Inconsistências (para bloqueio de aprovação conforme Requisito 8)
  const inconsistencias: string[] = [];
  if (!isDataValida) {
    inconsistencias.push('Data de validade ausente ou inválida (necessário informar no formato DD/MM/AAAA).');
  }
  if (isNaN(quantidadeTotalUnidades) || quantidadeTotalUnidades <= 0) {
    inconsistencias.push('Quantidade informada inválida ou zerada (necessário valor maior que zero).');
  }

  return {
    id: id,
    solicitacaoId: data.solicitacaoId || id,
    filialId: filialId,
    codigoInterno: codigoInterno,
    digito: digito,
    codigoCompleto: codigoCompleto,
    descricao: data.descricao || produtoSmg?.descricao || 'Produto sem descrição',
    embalagem: embalagem,
    fator_embalagem: fatorEmbalagem,
    fatorEmbalagem: fatorEmbalagem,
    unidade_medida: unidadeMedida,
    unidadeMedida: unidadeMedida,
    ean: ean,
    eans: data.eans || (ean ? [ean] : (produtoSmg?.eans || [])),

    // Data de validade
    dataValidade: dataValidade,
    dataVencimento: dataVencimento,
    validade: data.validade || rawDate,
    isDataValida: isDataValida,

    // Quantidades
    quantidadeTotalUnidades: quantidadeTotalUnidades,
    quantidadeInformada: quantidadeTotalUnidades,
    quantidadeInformadaOriginal: rawQuantidade,
    quantidadeCaixas: quantidadeCaixas,
    quantidadeUnidades: quantidadeUnidades,
    quantidadeEmb1: quantidadeEmb1,
    quantidadeEmb9: quantidadeEmb9,
    quantidadeTexto: quantidadeTexto,
    tipoEmbalagem: data.tipoEmbalagem || (fatorEmbalagem > 1 ? 'CAIXA_UNIDADE' : 'UNIDADE'),

    // Preço Normal
    precoNormal: precoNormal,

    // Inconsistências
    inconsistencias: inconsistencias.length > 0 ? inconsistencias : undefined,

    setor: data.setor || (produtoSmg as any)?.setor || '',
    setorTipo: data.setorTipo || (data.descricao?.startsWith('RF.') ? 'FRIOS' : 'LOJA'),
    promotorId: data.promotorId || 'PROMOTOR_DESCONHECIDO',
    promotorNome: data.promotorNome || 'Promotor',
    vinculoPromotorId: data.vinculoPromotorId || data.vinculoId || '',
    agencia: data.agencia || data.agenciaNome || data.industriaAgencia || '',
    agenciaNome: data.agenciaNome || data.agencia || data.industriaAgencia || '',
    industriaAgencia: data.industriaAgencia || data.agencia || data.agenciaNome || '',
    enviadoEm: data.enviadoEm || data.criadoEm || new Date().toISOString(),
    status: data.status || 'PENDENTE_ANALISE',
    criadoEm: data.criadoEm,
    atualizadoEm: data.atualizadoEm,
    aprovadoEm: data.aprovadoEm,
    aprovadoPor: data.aprovadoPor,
    resultadoAprovacao: data.resultadoAprovacao,
    referenciaVencimento: data.referenciaVencimento,
    quantidadeAnterior: data.quantidadeAnterior,
    quantidadeAprovada: data.quantidadeAprovada,
    recusadoEm: data.recusadoEm,
    recusadoPor: data.recusadoPor,
    motivoRecusa: data.motivoRecusa,
    dataAnalise: data.dataAnalise || data.aprovadoEm || data.recusadoEm,
    analisadoPor: data.analisadoPor || data.aprovadoPor || data.recusadoPor,
  };
}

/**
 * Identifica e sinaliza duplicidades entre solicitações pendentes
 * Chave de pendência: filialId + promotorId + codigoInterno + digito + dataValidade
 */
function marcarDuplicidadesPendentes(lista: SolicitacaoVencimentoPromotor[]): SolicitacaoVencimentoPromotor[] {
  const grupos = new Map<string, SolicitacaoVencimentoPromotor[]>();

  for (const item of lista) {
    if (item.status !== 'PENDENTE_ANALISE') continue;
    const chave = `${item.filialId}_${item.promotorId}_${item.codigoInterno}_${item.digito}_${item.dataValidade || 'SEM_DATA'}`;
    const grupo = grupos.get(chave) || [];
    grupo.push(item);
    grupos.set(chave, grupo);
  }

  for (const grupo of grupos.values()) {
    if (grupo.length > 1) {
      // Ordena decrescente por data/hora de envio (o mais recente primeiro)
      grupo.sort((a, b) => new Date(b.enviadoEm || 0).getTime() - new Date(a.enviadoEm || 0).getTime());
      const principal = grupo[0];
      for (let i = 1; i < grupo.length; i++) {
        grupo[i].isDuplicada = true;
        grupo[i].duplicadaDeId = principal.id;
      }
    }
  }

  return lista;
}

export class AnalisePromotorService {
  private static instance: AnalisePromotorService;
  private _processingIds = new Set<string>();

  public static getInstance(): AnalisePromotorService {
    if (!AnalisePromotorService.instance) {
      AnalisePromotorService.instance = new AnalisePromotorService();
    }
    return AnalisePromotorService.instance;
  }

  /**
   * Assina solicitações pendentes para a filial em tempo real.
   * Utiliza query filtrada por filialId e status == 'PENDENTE_ANALISE'.
   * Não realiza full scan.
   */
  public subscribeSolicitacoesPendentes(
    filialId: string,
    callback: (solicitacoes: SolicitacaoVencimentoPromotor[]) => void,
    onError?: (err: any) => void
  ): () => void {
    const filialPadrao = filialId || '172';

    try {
      const q = query(
        collection(db, 'solicitacoesVencimentoPromotor'),
        where('filialId', '==', filialPadrao),
        where('status', '==', 'PENDENTE_ANALISE'),
        limit(100)
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const lista: SolicitacaoVencimentoPromotor[] = [];
          snapshot.forEach((d) => {
            lista.push(parseDocToSolicitacao(d.id, d.data(), filialPadrao));
          });

          // Marcar duplicidades entre solicitações pendentes
          marcarDuplicidadesPendentes(lista);

          // Ordenar por data de envio decrescente
          lista.sort((a, b) => {
            const tA = new Date(a.enviadoEm || 0).getTime();
            const tB = new Date(b.enviadoEm || 0).getTime();
            return tB - tA;
          });

          callback(lista);
        },
        (error) => {
          console.warn('[AnalisePromotorService] Erro no listener em tempo real:', error);
          onError?.(error);
        }
      );

      return unsubscribe;
    } catch (err) {
      console.warn('[AnalisePromotorService] Falha ao configurar listener:', err);
      onError?.(err);
      return () => {};
    }
  }

  /**
   * Busca pontual filtrada no Firestore de solicitações pendentes (para fallback ou contadores)
   */
  public async getSolicitacoesPendentes(filialId: string = '172'): Promise<SolicitacaoVencimentoPromotor[]> {
    try {
      const q = query(
        collection(db, 'solicitacoesVencimentoPromotor'),
        where('filialId', '==', filialId),
        where('status', '==', 'PENDENTE_ANALISE'),
        limit(100)
      );
      const snap = await getDocs(q);
      const lista: SolicitacaoVencimentoPromotor[] = [];
      snap.forEach((d) => {
        lista.push(parseDocToSolicitacao(d.id, d.data(), filialId));
      });
      marcarDuplicidadesPendentes(lista);
      return lista;
    } catch (err) {
      console.warn('[AnalisePromotorService] Erro ao buscar solicitações pendentes:', err);
      return [];
    }
  }

  /**
   * REGRA PARA NOVOS ENVIOS (REQUISITO 10 E 11)
   * Salva ou atualiza uma solicitação do promotor aplicando a regra de unicidade de pendência:
   * Chave: filialId + promotorId + codigoInterno + digito + dataValidade + status: PENDENTE_ANALISE
   * 
   * Se o MESMO promotor enviar novamente o MESMO produto com a MESMA validade enquanto a
   * solicitação anterior ainda estiver PENDENTE:
   * NÃO criar outro documento.
   * Atualizar a solicitação pendente existente com a nova contagem e novo Preço DE.
   * Registrar auditoria da atualização.
   */
  public async salvarOuAtualizarSolicitacaoPromotor(params: {
    filialId: string;
    promotorId: string;
    promotorNome: string;
    agencia?: string;
    codigoInterno: string;
    digito: string;
    codigoCompleto?: string;
    descricao?: string;
    ean?: string;
    dataValidade: string; // YYYY-MM-DD ou DD/MM/AAAA
    quantidadeCaixas?: number;
    quantidadeUnidades?: number;
    quantidadeTotalUnidades?: number;
    precoNormal?: number | null;
    setor?: string;
    observacao?: string;
  }): Promise<{
    solicitacaoId: string;
    acao: 'CRIADA' | 'ATUALIZADA';
    quantidadeTotalUnidades: number;
    message: string;
  }> {
    const filialId = params.filialId || '172';
    const codigoInterno = String(params.codigoInterno).trim();
    const digito = String(params.digito || '0').trim();
    const promotorId = String(params.promotorId).trim();

    const dataIso = normalizeDateToIso(params.dataValidade);
    if (!dataIso) {
      throw new Error('Data de validade inválida. Informe uma data válida no formato DD/MM/AAAA.');
    }

    // Resolver fator de embalagem da mercadoria na SMGOI013
    const produtoSmg = findProdutoByCodeOrEan(codigoInterno || params.codigoCompleto || params.ean);
    let fatorEmbalagem = 1;
    if (produtoSmg?.fator_embalagem && Number(produtoSmg.fator_embalagem) > 0) {
      fatorEmbalagem = Number(produtoSmg.fator_embalagem);
    } else if (produtoSmg?.embalagem) {
      const parsed = parseEmbalagem(produtoSmg.embalagem);
      if (parsed?.fator && parsed.fator > 0) {
        fatorEmbalagem = parsed.fator;
      }
    }

    // Calcular quantidade canônica em unidades totais
    let quantidadeTotalUnidades = 0;
    let cx = params.quantidadeCaixas ?? 0;
    let un = params.quantidadeUnidades ?? 0;

    if (params.quantidadeTotalUnidades !== undefined && !isNaN(Number(params.quantidadeTotalUnidades))) {
      quantidadeTotalUnidades = Number(params.quantidadeTotalUnidades);
      if (fatorEmbalagem > 1) {
        cx = Math.floor(quantidadeTotalUnidades / fatorEmbalagem);
        un = Math.round((quantidadeTotalUnidades % fatorEmbalagem) * 100) / 100;
      } else {
        cx = 0;
        un = quantidadeTotalUnidades;
      }
    } else {
      quantidadeTotalUnidades = (cx * fatorEmbalagem) + un;
    }

    if (quantidadeTotalUnidades <= 0) {
      throw new Error('Quantidade informada deve ser maior que zero.');
    }

    // Montar texto descritivo
    let quantidadeTexto = '';
    if (fatorEmbalagem > 1) {
      if (cx > 0 && un > 0) {
        quantidadeTexto = `${cx} CX + ${un} UN`;
      } else if (cx > 0) {
        quantidadeTexto = `${cx} CX`;
      } else {
        quantidadeTexto = `${un} UN`;
      }
    } else {
      quantidadeTexto = `${quantidadeTotalUnidades} UN`;
    }

    const agora = new Date().toISOString();

    // 1. Verificar se já existe solicitação PENDENTE do MESMO promotor para o MESMO produto e validade
    const qPendente = query(
      collection(db, 'solicitacoesVencimentoPromotor'),
      where('filialId', '==', filialId),
      where('promotorId', '==', promotorId),
      where('codigoInterno', '==', codigoInterno),
      where('status', '==', 'PENDENTE_ANALISE'),
      limit(20)
    );

    const snap = await getDocs(qPendente);
    let docExistenteId: string | null = null;
    let docExistenteData: any = null;

    snap.forEach((d) => {
      const dData = d.data();
      const dValidade = normalizeDateToIso(dData.dataValidade || dData.validade || dData.dataVencimento);
      const dDigito = String(dData.digito || '0').trim();
      if (dValidade === dataIso && dDigito === digito) {
        docExistenteId = d.id;
        docExistenteData = dData;
      }
    });

    if (docExistenteId && docExistenteData) {
      // ATUALIZAR SOLICITAÇÃO PENDENTE EXISTENTE (SEM DUPLICAR DOCUMENTO)
      const solicRef = doc(db, 'solicitacoesVencimentoPromotor', docExistenteId);
      const qtdAnterior = docExistenteData.quantidadeTotalUnidades ?? docExistenteData.quantidadeInformada ?? docExistenteData.quantidade;

      await setDoc(
        solicRef,
        {
          quantidadeTotalUnidades: quantidadeTotalUnidades,
          quantidadeInformada: quantidadeTotalUnidades,
          quantidadeCaixas: cx,
          quantidadeUnidades: un,
          quantidadeEmb1: cx,
          quantidadeEmb9: un,
          quantidadeTexto: quantidadeTexto,
          fatorEmbalagem: fatorEmbalagem,
          fator_embalagem: fatorEmbalagem,
          dataValidade: dataIso,
          dataVencimento: dataIso,
          precoNormal: params.precoNormal ?? docExistenteData.precoNormal ?? produtoSmg?.vendas_preco ?? null,
          observacao: params.observacao || docExistenteData.observacao || '',
          atualizadoEm: agora,
        },
        { merge: true }
      );

      // Registrar auditoria
      try {
        await promotorService.registrarAuditoria({
          promotorId: promotorId,
          promotorNome: params.promotorNome,
          agenciaNome: params.agencia || '',
          filialId: filialId,
          setorId: params.setor || docExistenteData.setor || 'FRIOS',
          tipoAcao: 'ATUALIZOU_CONTAGEM_PROMOTOR',
          codigoInterno: codigoInterno,
          digito: digito,
          descricao: params.descricao || docExistenteData.descricao,
          valorAnterior: String(qtdAnterior),
          valorNovo: JSON.stringify({
            solicitacaoId: docExistenteId,
            quantidadeTotalUnidades: quantidadeTotalUnidades,
            quantidadeTexto: quantidadeTexto,
            precoNormal: params.precoNormal,
            dataValidade: dataIso,
            atualizadoEm: agora,
          }),
          dataHora: agora,
          statusSincronizacao: 'SINCRONIZADO',
        });
      } catch (auditErr) {
        console.warn('[AnalisePromotorService] Aviso ao registrar auditoria de atualização:', auditErr);
      }

      return {
        solicitacaoId: docExistenteId,
        acao: 'ATUALIZADA',
        quantidadeTotalUnidades,
        message: `Solicitação pendente existente atualizada com sucesso (${quantidadeTexto}).`,
      };
    }

    // CRIAR NOVA SOLICITAÇÃO CANÔNICA
    const novoId = `solic-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const solicRef = doc(db, 'solicitacoesVencimentoPromotor', novoId);

    const docNovo = {
      id: novoId,
      solicitacaoId: novoId,
      filialId: filialId,
      promotorId: promotorId,
      promotorNome: params.promotorNome,
      agencia: params.agencia || '',
      agenciaNome: params.agencia || '',
      codigoInterno: codigoInterno,
      digito: digito,
      codigoCompleto: params.codigoCompleto || (digito ? `${codigoInterno}-${digito}` : codigoInterno),
      descricao: params.descricao || produtoSmg?.descricao || 'Produto sem descrição',
      embalagem: produtoSmg?.embalagem || (fatorEmbalagem > 1 ? `CXA 1 X ${fatorEmbalagem}` : 'UN'),
      fatorEmbalagem: fatorEmbalagem,
      fator_embalagem: fatorEmbalagem,
      unidadeMedida: produtoSmg?.unidade_medida || (fatorEmbalagem > 1 ? 'CXA' : 'UN'),
      unidade_medida: produtoSmg?.unidade_medida || (fatorEmbalagem > 1 ? 'CXA' : 'UN'),
      ean: params.ean || (produtoSmg?.eans && produtoSmg.eans[0]) || '',
      eans: produtoSmg?.eans || (params.ean ? [params.ean] : []),
      dataValidade: dataIso,
      dataVencimento: dataIso,
      validade: dataIso,
      quantidadeTotalUnidades: quantidadeTotalUnidades,
      quantidadeInformada: quantidadeTotalUnidades,
      quantidadeInformadaOriginal: quantidadeTotalUnidades,
      quantidadeCaixas: cx,
      quantidadeUnidades: un,
      quantidadeEmb1: cx,
      quantidadeEmb9: un,
      quantidadeTexto: quantidadeTexto,
      tipoEmbalagem: fatorEmbalagem > 1 ? 'CAIXA_UNIDADE' : 'UNIDADE',
      precoNormal: params.precoNormal ?? produtoSmg?.vendas_preco ?? null,
      setor: params.setor || (produtoSmg as any)?.setor || 'LOJA',
      setorTipo: params.descricao?.startsWith('RF.') ? 'FRIOS' : 'LOJA',
      observacao: params.observacao || '',
      enviadoEm: agora,
      criadoEm: agora,
      atualizadoEm: agora,
      status: 'PENDENTE_ANALISE',
      origem: 'APP_PROMOTOR',
    };

    await setDoc(solicRef, docNovo);

    return {
      solicitacaoId: novoId,
      acao: 'CRIADA',
      quantidadeTotalUnidades,
      message: `Solicitação enviada com sucesso (${quantidadeTexto}).`,
    };
  }

  /**
   * Consulta solicitações para o Histórico Mensal de Promotores.
   * Filtra por filialId, período (mês de envio) e promotorId quando fornecido.
   * Não faz full scan.
   */
  public async getHistoricoMensal(params: {
    filialId?: string;
    mesAno: string; // 'YYYY-MM', ex: '2026-09'
    promotorId?: string; // 'TODOS' ou id
    industriaAgencia?: string; // 'TODAS' ou agência
    setor?: string; // 'TODOS', 'FRIOS', 'LOJA'
    status?: string; // 'TODOS', 'PENDENTE', 'APROVADO', 'RECUSADO'
  }): Promise<SolicitacaoVencimentoPromotor[]> {
    const filialPadrao = params.filialId || '172';
    const mesAno = params.mesAno || new Date().toISOString().slice(0, 7);

    const [anoStr, mesStr] = mesAno.split('-');
    const ano = parseInt(anoStr, 10);
    const mes = parseInt(mesStr, 10);
    const startIso = `${anoStr}-${String(mes).padStart(2, '0')}-01T00:00:00.000Z`;
    const nextAno = mes === 12 ? ano + 1 : ano;
    const nextMes = mes === 12 ? 1 : mes + 1;
    const endIso = `${nextAno}-${String(nextMes).padStart(2, '0')}-01T00:00:00.000Z`;

    try {
      // 1. Tentar consulta indexada ótima com filtro por período e promotor se selecionado
      const constraints: any[] = [
        where('filialId', '==', filialPadrao),
      ];

      if (params.promotorId && params.promotorId !== 'TODOS') {
        constraints.push(where('promotorId', '==', params.promotorId));
      }

      // Filtro de período no Firestore por data de envio
      constraints.push(where('enviadoEm', '>=', startIso));
      constraints.push(where('enviadoEm', '<', endIso));
      constraints.push(orderBy('enviadoEm', 'desc'));
      constraints.push(limit(400));

      const q = query(collection(db, 'solicitacoesVencimentoPromotor'), ...constraints);
      const snap = await getDocs(q);

      let lista: SolicitacaoVencimentoPromotor[] = [];
      snap.forEach((d) => {
        lista.push(parseDocToSolicitacao(d.id, d.data(), filialPadrao));
      });

      return this._aplicarFiltrosMemoria(lista, params);
    } catch (err: any) {
      console.warn(
        '[AnalisePromotorService] Consulta indexada de histórico gerou fallback. (Índice composto sugerido no Firestore: filialId ASC, promotorId ASC, enviadoEm DESC):',
        err?.message || err
      );

      // 2. Fallback resiliente: consulta limitada por filialId
      try {
        const fallbackQuery = query(
          collection(db, 'solicitacoesVencimentoPromotor'),
          where('filialId', '==', filialPadrao),
          limit(500)
        );
        const snapFallback = await getDocs(fallbackQuery);
        let listaFallback: SolicitacaoVencimentoPromotor[] = [];
        snapFallback.forEach((d) => {
          const s = parseDocToSolicitacao(d.id, d.data(), filialPadrao);
          const env = s.enviadoEm || '';
          if (env.startsWith(mesAno) || (env >= startIso && env < endIso)) {
            listaFallback.push(s);
          }
        });

        listaFallback.sort((a, b) => new Date(b.enviadoEm || 0).getTime() - new Date(a.enviadoEm || 0).getTime());
        return this._aplicarFiltrosMemoria(listaFallback, params);
      } catch (fallbackErr) {
        console.error('[AnalisePromotorService] Erro no fallback de histórico mensal:', fallbackErr);
        return [];
      }
    }
  }

  /**
   * Assina em tempo real o histórico do mês selecionado
   */
  public subscribeHistoricoMensal(
    params: { filialId?: string; mesAno: string; promotorId?: string },
    callback: (solicitacoes: SolicitacaoVencimentoPromotor[]) => void,
    onError?: (err: any) => void
  ): () => void {
    const filialPadrao = params.filialId || '172';
    const mesAno = params.mesAno || new Date().toISOString().slice(0, 7);

    try {
      const q = query(
        collection(db, 'solicitacoesVencimentoPromotor'),
        where('filialId', '==', filialPadrao),
        limit(300)
      );

      return onSnapshot(
        q,
        (snap) => {
          const lista: SolicitacaoVencimentoPromotor[] = [];
          snap.forEach((d) => {
            const s = parseDocToSolicitacao(d.id, d.data(), filialPadrao);
            const env = s.enviadoEm || '';
            if (env.startsWith(mesAno)) {
              if (!params.promotorId || params.promotorId === 'TODOS' || s.promotorId === params.promotorId) {
                lista.push(s);
              }
            }
          });
          lista.sort((a, b) => new Date(b.enviadoEm || 0).getTime() - new Date(a.enviadoEm || 0).getTime());
          callback(lista);
        },
        (err) => {
          console.warn('[AnalisePromotorService] Erro no listener do histórico mensal:', err);
          onError?.(err);
        }
      );
    } catch (err) {
      console.warn('[AnalisePromotorService] Falha ao assinar histórico mensal:', err);
      onError?.(err);
      return () => {};
    }
  }

  public calcularResumo(solicitacoes: SolicitacaoVencimentoPromotor[]) {
    let totalEnvios = solicitacoes.length;
    let aprovados = 0;
    let recusados = 0;
    let pendentes = 0;
    let novosVencimentos = 0;
    let atualizacoesQuantidade = 0;

    for (const s of solicitacoes) {
      if (s.status === 'APROVADO') {
        aprovados++;
        if (s.resultadoAprovacao === 'QUANTIDADE_ATUALIZADA') {
          atualizacoesQuantidade++;
        } else {
          novosVencimentos++;
        }
      } else if (s.status === 'RECUSADO') {
        recusados++;
      } else {
        pendentes++;
      }
    }

    return {
      totalEnvios,
      aprovados,
      recusados,
      pendentes,
      novosVencimentos,
      atualizacoesQuantidade,
    };
  }

  private _aplicarFiltrosMemoria(
    lista: SolicitacaoVencimentoPromotor[],
    filtros: {
      promotorId?: string;
      industriaAgencia?: string;
      setor?: string;
      status?: string;
    }
  ): SolicitacaoVencimentoPromotor[] {
    return lista.filter((s) => {
      // Filtro Promotor
      if (filtros.promotorId && filtros.promotorId !== 'TODOS') {
        if (s.promotorId !== filtros.promotorId) return false;
      }

      // Filtro Indústria/Agência
      if (filtros.industriaAgencia && filtros.industriaAgencia !== 'TODAS') {
        const ag = (s.industriaAgencia || s.agencia || s.agenciaNome || '').trim().toUpperCase();
        if (ag !== filtros.industriaAgencia.trim().toUpperCase()) return false;
      }

      // Filtro Setor
      if (filtros.setor && filtros.setor !== 'TODOS') {
        const set = (s.setor || s.setorTipo || '').trim().toUpperCase();
        if (filtros.setor === 'FRIOS') {
          if (!set.includes('FRIO') && !s.descricao?.startsWith('RF.')) return false;
        } else if (filtros.setor === 'LOJA') {
          if (set.includes('FRIO') || s.descricao?.startsWith('RF.')) return false;
        }
      }

      // Filtro Status
      if (filtros.status && filtros.status !== 'TODOS') {
        if (filtros.status === 'PENDENTE' && s.status !== 'PENDENTE_ANALISE') return false;
        if (filtros.status === 'APROVADO' && s.status !== 'APROVADO') return false;
        if (filtros.status === 'RECUSADO' && s.status !== 'RECUSADO') return false;
      }

      return true;
    });
  }

  /**
   * Verifica se já existe no Controle de Vencimentos um lote para o mesmo produto e validade.
   * Regra de unicidade: filialId + codigoInterno + digito + dataVencimento.
   */
  public verificarVencimentoExistente(
    filialId: string,
    codigoInterno: string,
    digito: string,
    dataVencimento: string
  ): { existe: boolean; loteExistente?: LoteVencimento } {
    const filialPadrao = filialId || '172';
    const codNorm = normalizeInternalCode(codigoInterno);
    const digNorm = (digito || '').trim();
    const dateIso = normalizeDateToIso(dataVencimento);

    if (!codNorm || !dateIso) {
      return { existe: false };
    }

    const targetKey = buildVencimentoKey(filialPadrao, codNorm, digNorm, dateIso);
    const vencimentosLocais = productRepository.getVencimentos();

    // 1. Procurar por correspondência exata na base em memória
    for (const l of vencimentosLocais) {
      const lFilial = l.filialId || '172';
      if (lFilial !== filialPadrao) continue;

      const lCod = normalizeInternalCode(l.codigo_interno);
      const lDig = (l.digito || '').trim();
      const lDate = normalizeDateToIso(l.data_validade);

      if (lCod === codNorm && lDig === digNorm && lDate === dateIso) {
        return { existe: true, loteExistente: l };
      }

      // Comparação por key canônica
      const lKey = buildVencimentoKey(lFilial, lCod, lDig, lDate);
      if (lKey === targetKey || l.id === targetKey || l.vencimentoId === targetKey) {
        return { existe: true, loteExistente: l };
      }
    }

    return { existe: false };
  }

  /**
   * APROVA UMA SOLICITAÇÃO
   * 
   * - Proteção contra duplo clique e concorrência:
   *   Revalida atomicamente no Firestore antes de processar.
   * - Se NÃO existir vencimento: cria novo vencimento oficial (NOVO_VENCIMENTO).
   * - Se JÁ existir vencimento: NÃO DUPLICA, NÃO SOMA. Atualiza SOMENTE o estoque a vencer (QUANTIDADE_ATUALIZADA).
   * - Preserva intactos: Preço Normal, Preço Rebaixe, EAN, descrição, status, etc.
   * - Atualiza a solicitação no Firestore como APROVADO.
   * - Registra auditoria completa.
   */
  public async aprovarSolicitacao(params: {
    solicitacaoId: string;
    quantidadeAprovada?: number;
    aprovadoPor?: string;
  }): Promise<{
    success: boolean;
    resultado: ResultadoAprovacaoSolicitacao;
    vencimentoId: string;
    message: string;
  }> {
    const { solicitacaoId, quantidadeAprovada, aprovadoPor = 'Administrador / Loja' } = params;

    // 1. Bloqueio local contra múltiplos cliques rápidos
    if (this._processingIds.has(solicitacaoId)) {
      throw new Error('Aprovação já está sendo processada para esta solicitação. Aguarde.');
    }
    this._processingIds.add(solicitacaoId);

    try {
      // 2. Concorrência: Ler o estado mais recente do Firestore para garantir idempotência
      const solicRef = doc(db, 'solicitacoesVencimentoPromotor', solicitacaoId);
      const snap = await getDoc(solicRef);

      if (!snap.exists()) {
        throw new Error('Solicitação não encontrada no Firestore.');
      }

      const solicData = snap.data();
      if (solicData.status !== 'PENDENTE_ANALISE') {
        throw new Error(`Esta solicitação já foi ${solicData.status.toLowerCase()} anteriormente.`);
      }

      const filialId = solicData.filialId || '172';
      const codigoInterno = String(solicData.codigoInterno || '').trim();
      const digito = String(solicData.digito || '0').trim();
      const rawDate = solicData.dataValidade || solicData.validade || solicData.dataVencimento || solicData.data_validade || solicData.expirationDate;
      const dataVencimento = normalizeDateToIso(rawDate);

      if (!codigoInterno) {
        throw new Error('DADOS DA SOLICITAÇÃO INCONSISTENTES: Código do produto ausente.');
      }
      if (!dataVencimento) {
        throw new Error('DADOS DA SOLICITAÇÃO INCONSISTENTES: Data de validade ausente ou inválida. Corrija antes de aprovar.');
      }

      // Buscar dados cadastrais do produto na SMGOI013 para enriquecer o lote oficial e obter fator de embalagem
      const produtoSmg = findProdutoByCodeOrEan(codigoInterno || solicData.codigoCompleto || solicData.ean);

      // Determinar fator real da SMGOI013
      let fatorEmbalagem = 1;
      if (solicData.fatorEmbalagem !== undefined && Number(solicData.fatorEmbalagem) > 0) {
        fatorEmbalagem = Number(solicData.fatorEmbalagem);
      } else if (solicData.fator_embalagem !== undefined && Number(solicData.fator_embalagem) > 0) {
        fatorEmbalagem = Number(solicData.fator_embalagem);
      } else if (produtoSmg?.fator_embalagem && Number(produtoSmg.fator_embalagem) > 0) {
        fatorEmbalagem = Number(produtoSmg.fator_embalagem);
      } else {
        const rawEmb = solicData.embalagem || produtoSmg?.embalagem;
        if (rawEmb) {
          const parsed = parseEmbalagem(rawEmb);
          if (parsed && parsed.fator && parsed.fator > 0) {
            fatorEmbalagem = parsed.fator;
          }
        }
      }

      // Quantidade padrão canônica em unidades totais
      let qtdePadrao = 0;
      if (solicData.quantidadeTotalUnidades !== undefined && !isNaN(Number(solicData.quantidadeTotalUnidades))) {
        qtdePadrao = Number(solicData.quantidadeTotalUnidades);
      } else if (solicData.quantidadeEmb1 !== undefined || solicData.quantidadeCaixas !== undefined) {
        const cx = Number(solicData.quantidadeCaixas ?? solicData.quantidadeEmb1 ?? 0);
        const un = Number(solicData.quantidadeUnidades ?? solicData.quantidadeUnidadesRestantes ?? solicData.quantidadeEmb9 ?? 0);
        qtdePadrao = (cx * fatorEmbalagem) + un;
      } else {
        qtdePadrao = Number(solicData.quantidadeInformada ?? solicData.quantidade ?? 0);
      }

      // Quantidade final definida para aprovação (se editada ou a informada original)
      const qtdeFinal = Number(
        quantidadeAprovada !== undefined ? quantidadeAprovada : qtdePadrao
      );

      if (isNaN(qtdeFinal) || qtdeFinal <= 0) {
        throw new Error('DADOS DA SOLICITAÇÃO INCONSISTENTES: A quantidade aprovada deve ser um número válido e maior que zero.');
      }

      // 3. Verificar se já existe vencimento com mesma filialId + codigoInterno + digito + dataVencimento
      const check = this.verificarVencimentoExistente(filialId, codigoInterno, digito, dataVencimento);
      const agora = new Date().toISOString();

      let resultado: ResultadoAprovacaoSolicitacao;
      let vencimentoFinalId: string;
      let qtdeAnterior = 0;

      if (check.existe && check.loteExistente) {
        // ====================================================================
        // CASO 1: VENCIMENTO JÁ EXISTE
        // NÃO CRIAR OUTRO. NÃO SOMAR. ATUALIZAR SOMENTE A QUANTIDADE.
        // ====================================================================
        resultado = 'QUANTIDADE_ATUALIZADA';
        const loteExistente = check.loteExistente;
        vencimentoFinalId = loteExistente.id;
        qtdeAnterior = Number(loteExistente.quantidade_total_unidades ?? loteExistente.quantidade ?? 0);

        // Atualizar SOMENTE a quantidade de estoque a vencer, preservando todos os outros campos
        await productRepository.updateVencimento(loteExistente.id, {
          quantidade_total_unidades: qtdeFinal,
          quantidade: qtdeFinal,
          fator_embalagem: fatorEmbalagem,
          atualizado_em: agora,
        });

      } else {
        // ====================================================================
        // CASO 2: NÃO EXISTE VENCIMENTO
        // CRIAR NOVO VENCIMENTO OFICIAL
        // ====================================================================
        resultado = 'NOVO_VENCIMENTO';

        const novoLote = {
          filialId: filialId,
          codigo_interno: codigoInterno,
          digito: digito,
          codigo_exibicao: digito ? `${codigoInterno}-${digito}` : codigoInterno,
          descricao_produto: solicData.descricao || produtoSmg?.descricao || 'PRODUTO PROMOTOR',
          embalagem: solicData.embalagem || produtoSmg?.embalagem || (fatorEmbalagem > 1 ? `CXA 1 X ${fatorEmbalagem}` : 'UN'),
          fator_embalagem: fatorEmbalagem,
          unidade_medida: solicData.unidade_medida || solicData.unidadeMedida || produtoSmg?.unidade_medida || (fatorEmbalagem > 1 ? 'CXA' : 'UN'),
          data_validade: dataVencimento,
          quantidade_total_unidades: qtdeFinal,
          quantidade: qtdeFinal,
          enviar_ao_comprador: false,
          origem: 'MANUAL' as const,
          criado_por_tipo: 'ADMIN' as const,
          criado_por_nome: `Aprovado do Promotor: ${solicData.promotorNome || 'Promotor'} (${solicData.agencia || ''})`,
          status_operacional: 'NORMAL' as const,
          preco_normal: solicData.precoNormal ?? produtoSmg?.vendas_preco ?? null,
          preco_trabalhado: null,
          eans: solicData.ean ? [solicData.ean] : (produtoSmg?.eans || []),
        };

        const loteCriado = await productRepository.addVencimento(novoLote);
        vencimentoFinalId = loteCriado.id;
      }

      // 4. Atualizar a solicitação no Firestore como APROVADO
      await setDoc(
        solicRef,
        {
          status: 'APROVADO',
          aprovadoEm: agora,
          aprovadoPor: aprovadoPor,
          dataAnalise: agora,
          analisadoPor: aprovadoPor,
          resultadoAprovacao: resultado,
          referenciaVencimento: vencimentoFinalId,
          quantidadeAnterior: qtdeAnterior,
          quantidadeAprovada: qtdeFinal,
          quantidadeTotalUnidades: qtdeFinal,
          dataValidade: dataVencimento,
          dataVencimento: dataVencimento,
          fatorEmbalagem: fatorEmbalagem,
          atualizadoEm: agora,
        },
        { merge: true }
      );

      // 5. Registrar na trilha de auditoria completa
      try {
        await promotorService.registrarAuditoria({
          promotorId: solicData.promotorId || 'PROMOTOR',
          promotorNome: solicData.promotorNome || 'Promotor',
          agenciaNome: solicData.agencia || solicData.agenciaNome || '',
          filialId: filialId,
          setorId: solicData.setor || 'FRIOS',
          tipoAcao: 'APROVOU_SOLICITACAO_PROMOTOR',
          codigoInterno: codigoInterno,
          digito: digito,
          descricao: solicData.descricao,
          valorAnterior: String(qtdeAnterior),
          valorNovo: JSON.stringify({
            solicitacaoId: solicitacaoId,
            resultado: resultado,
            quantidadeInformada: solicData.quantidadeInformada,
            quantidadeAprovada: qtdeFinal,
            dataVencimento: dataVencimento,
            aprovadoPor: aprovadoPor,
            vencimentoId: vencimentoFinalId,
          }),
          dataHora: agora,
          statusSincronizacao: 'SINCRONIZADO',
        });
      } catch (auditErr) {
        console.warn('[AnalisePromotorService] Aviso ao registrar auditoria de aprovação:', auditErr);
      }

      const msg = resultado === 'QUANTIDADE_ATUALIZADA'
        ? `Vencimento existente atualizado com sucesso (${qtdeAnterior} UN → ${qtdeFinal} UN).`
        : `Novo vencimento oficial criado com sucesso (${qtdeFinal} UN).`;

      return {
        success: true,
        resultado,
        vencimentoId: vencimentoFinalId,
        message: msg,
      };
    } finally {
      this._processingIds.delete(solicitacaoId);
    }
  }

  /**
   * RECUSA UMA SOLICITAÇÃO COM MOTIVO OBRIGATÓRIO
   * 
   * - Não altera nem cria nenhum vencimento oficial.
   * - Revalida atomicamente no Firestore para evitar dupla decisão.
   * - Atualiza a solicitação com status = RECUSADO e motivoRecusa.
   * - Registra na auditoria.
   */
  public async recusarSolicitacao(params: {
    solicitacaoId: string;
    motivoRecusa: string;
    recusadoPor?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { solicitacaoId, motivoRecusa, recusadoPor = 'Administrador / Loja' } = params;

    const motivoTrim = (motivoRecusa || '').trim();
    if (!motivoTrim) {
      throw new Error('É obrigatório informar o motivo da recusa.');
    }

    if (this._processingIds.has(solicitacaoId)) {
      throw new Error('Esta solicitação já está em processamento. Aguarde.');
    }
    this._processingIds.add(solicitacaoId);

    try {
      const solicRef = doc(db, 'solicitacoesVencimentoPromotor', solicitacaoId);
      const snap = await getDoc(solicRef);

      if (!snap.exists()) {
        throw new Error('Solicitação não encontrada no Firestore.');
      }

      const solicData = snap.data();
      if (solicData.status !== 'PENDENTE_ANALISE') {
        throw new Error(`Esta solicitação já foi ${solicData.status.toLowerCase()} anteriormente.`);
      }

      const agora = new Date().toISOString();

      // Atualizar solicitação como RECUSADO
      await setDoc(
        solicRef,
        {
          status: 'RECUSADO',
          motivoRecusa: motivoTrim,
          recusadoEm: agora,
          recusadoPor: recusadoPor,
          dataAnalise: agora,
          analisadoPor: recusadoPor,
          atualizadoEm: agora,
        },
        { merge: true }
      );

      // Registrar auditoria
      try {
        await promotorService.registrarAuditoria({
          promotorId: solicData.promotorId || 'PROMOTOR',
          promotorNome: solicData.promotorNome || 'Promotor',
          agenciaNome: solicData.agencia || solicData.agenciaNome || '',
          filialId: solicData.filialId || '172',
          setorId: solicData.setor || 'FRIOS',
          tipoAcao: 'RECUSOU_SOLICITACAO_PROMOTOR',
          codigoInterno: solicData.codigoInterno,
          digito: solicData.digito,
          descricao: solicData.descricao,
          valorAnterior: `Informado: ${solicData.quantidadeInformada} UN`,
          valorNovo: JSON.stringify({
            solicitacaoId: solicitacaoId,
            status: 'RECUSADO',
            motivoRecusa: motivoTrim,
            recusadoPor: recusadoPor,
          }),
          dataHora: agora,
          statusSincronizacao: 'SINCRONIZADO',
        });
      } catch (auditErr) {
        console.warn('[AnalisePromotorService] Aviso ao registrar auditoria de recusa:', auditErr);
      }

      return {
        success: true,
        message: 'Solicitação recusada com sucesso.',
      };
    } finally {
      this._processingIds.delete(solicitacaoId);
    }
  }
}

export const analisePromotorService = AnalisePromotorService.getInstance();
