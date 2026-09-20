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
import { findProdutoByCodeOrEan } from './storage';
import {
  LoteVencimento,
  ResultadoAprovacaoSolicitacao,
  SolicitacaoVencimentoPromotor
} from '../types';

/**
 * Normaliza documento bruto do Firestore no formato tipado SolicitacaoVencimentoPromotor
 */
function parseDocToSolicitacao(id: string, data: any, fallbackFilial: string = '172'): SolicitacaoVencimentoPromotor {
  return {
    id: id,
    solicitacaoId: data.solicitacaoId || id,
    filialId: data.filialId || fallbackFilial,
    codigoInterno: String(data.codigoInterno || ''),
    digito: String(data.digito || '0'),
    codigoCompleto: data.codigoCompleto || (data.digito ? `${data.codigoInterno}-${data.digito}` : data.codigoInterno),
    descricao: data.descricao || 'Produto sem descrição',
    embalagem: data.embalagem || '',
    fator_embalagem: Number(data.fator_embalagem || 1),
    unidade_medida: data.unidade_medida || 'UN',
    ean: data.ean || (Array.isArray(data.eans) && data.eans[0]) || '',
    eans: data.eans || (data.ean ? [data.ean] : []),
    dataVencimento: data.dataVencimento || data.data_validade || '',
    quantidadeInformada: Number(data.quantidadeInformada ?? data.quantidade ?? 0),
    quantidadeCaixas: data.quantidadeCaixas,
    quantidadeUnidades: data.quantidadeUnidades,
    quantidadeTexto: data.quantidadeTexto,
    setor: data.setor || '',
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
      return lista;
    } catch (err) {
      console.warn('[AnalisePromotorService] Erro ao buscar solicitações pendentes:', err);
      return [];
    }
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
      const dataVencimento = normalizeDateToIso(solicData.dataVencimento || solicData.data_validade);

      if (!codigoInterno || !dataVencimento) {
        throw new Error('Dados da solicitação incompletos (código ou validade ausente).');
      }

      // Quantidade final definida para aprovação (se editada ou a informada original)
      const qtdeFinal = Number(
        quantidadeAprovada !== undefined ? quantidadeAprovada : (solicData.quantidadeInformada ?? solicData.quantidade ?? 0)
      );

      if (isNaN(qtdeFinal) || qtdeFinal < 0) {
        throw new Error('A quantidade aprovada deve ser um número válido e maior ou igual a zero.');
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
          atualizado_em: agora,
        });

      } else {
        // ====================================================================
        // CASO 2: NÃO EXISTE VENCIMENTO
        // CRIAR NOVO VENCIMENTO OFICIAL
        // ====================================================================
        resultado = 'NOVO_VENCIMENTO';

        // Buscar dados cadastrais do produto na SMGOI013 para enriquecer o lote oficial
        const produtoSmg = findProdutoByCodeOrEan(codigoInterno);

        const novoLote = {
          filialId: filialId,
          codigo_interno: codigoInterno,
          digito: digito,
          codigo_exibicao: digito ? `${codigoInterno}-${digito}` : codigoInterno,
          descricao_produto: solicData.descricao || produtoSmg?.descricao || 'PRODUTO PROMOTOR',
          embalagem: solicData.embalagem || produtoSmg?.embalagem || 'UN',
          fator_embalagem: Number(solicData.fator_embalagem || produtoSmg?.fator_embalagem || 1),
          unidade_medida: solicData.unidade_medida || produtoSmg?.unidade_medida || 'UN',
          data_validade: dataVencimento,
          quantidade_total_unidades: qtdeFinal,
          quantidade: qtdeFinal,
          enviar_ao_comprador: false,
          origem: 'MANUAL' as const,
          criado_por_tipo: 'ADMIN' as const,
          criado_por_nome: `Aprovado do Promotor: ${solicData.promotorNome || 'Promotor'} (${solicData.agencia || ''})`,
          status_operacional: 'NORMAL' as const,
          preco_normal: produtoSmg?.vendas_preco || null,
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
