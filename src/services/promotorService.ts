/**
 * Promotor Service & Repository (Controle de Vencimentos - Fase 1)
 * 
 * Gerencia a estrutura administrativa de Promotores, Vínculos (QR/Código de 6 dígitos),
 * Permissões validadas no backend/serviço, Auditoria e Preparação para sincronização
 * futura idempotente com o App Promotor.
 */

import {
  doc,
  setDoc,
} from 'firebase/firestore';
import {
  AgenciaComercial,
  DispositivoVinculado,
  HistoricoMovimentacaoComercial,
  OperacaoPromotorSync,
  PERMISSOES_PADRAO_PROMOTOR,
  PermissoesPromotor,
  Promotor,
  RegistroAuditoriaPromotor,
  StatusPromotor,
  VinculoPromotor,
  VinculoPromotorIndustria,
} from '../types';
import {
  gerarAgenciaId,
  isAgenciaSemVinculoNome,
  normalizarChaveAgencia,
  normalizarNomeAgenciaExibicao,
} from './agenciaNormalizer';
import { cleanForFirestore } from './cloudSyncService';
import { AtomicBatchOp, dbGetAll, dbGetMeta, dbPut, dbPutAll, dbRunAtomicBatch, dbSetMeta, STORES } from './db';
import {
  db,
  detectQuotaResourceType,
  isFirestoreQuotaExceeded,
  isQuotaError,
  markQuotaExceeded,
} from './firebase';
import { productRepository } from './productRepository';
import { isModoAtualizacaoLocalAtivo, notificarAlteracaoParaPacoteLocal } from './localPackageMode';
import { authRoleService } from './authRoleService';
import { comercialSyncService } from './comercialSyncService';

const META_KEY_HISTORICO_MOVIMENTACOES = 'historico_movimentacoes_comerciais_v1';

export interface PromotoresIndicators {
  totalAtivos: number;
  totalOffline: number;
  pendenciasSincronizacao: number;
  acoesHoje: number;
}

type PromotoresListener = () => void;

function normalizePromotor(raw: any): Promotor {
  let setores: string[] = [];
  if (Array.isArray(raw.setores) && raw.setores.length > 0) {
    setores = raw.setores.filter((s: any) => s === 'FRIOS' || s === 'LOJA');
    if (setores.length === 0) setores = ['FRIOS'];
  } else if (raw.setorId) {
    const s = String(raw.setorId).toUpperCase();
    setores = (s === 'LOJA' || s === 'FRIOS') ? [s] : ['FRIOS'];
  } else if (raw.setor) {
    const s = String(raw.setor).toUpperCase();
    setores = (s === 'LOJA' || s === 'FRIOS') ? [s] : ['FRIOS'];
  } else {
    setores = ['FRIOS'];
  }

  const setorNome = setores.join(' • ');
  const temAgenciaInformada = !isAgenciaSemVinculoNome(raw.agenciaNome);
  const agenciaNomeLimpo = temAgenciaInformada ? normalizarNomeAgenciaExibicao(raw.agenciaNome) : '';
  const agenciaIdResolvido = temAgenciaInformada
    ? (raw.agenciaId || gerarAgenciaId(agenciaNomeLimpo))
    : null;

  return {
    ...raw,
    nome: raw.nome || '',
    agenciaId: agenciaIdResolvido,
    agenciaNome: raw.agenciaId === null || raw.agenciaNome === ''
      ? ''
      : (agenciaNomeLimpo || (raw.agenciaNome === undefined ? 'Agência não informada' : '')),
    setores,
    setorId: setores[0],
    setorNome,
    filialId: raw.filialId || '172',
    filialNome: raw.filialNome || 'Cascavel',
    status: raw.status || 'PENDENTE_VINCULO',
    permissoes: raw.permissoes || { ...PERMISSOES_PADRAO_PROMOTOR },
    dispositivoVinculado: raw.dispositivoVinculado || null,
    dataCadastro: raw.dataCadastro || new Date().toISOString(),
    criadoPor: raw.criadoPor || 'SISTEMA_PRINCIPAL',
    atualizadoPor: raw.atualizadoPor || 'SISTEMA_PRINCIPAL',
  };
}

function normalizeAgencia(raw: any): AgenciaComercial | null {
  if (!raw || typeof raw !== 'object') return null;
  const nomeLimpo = normalizarNomeAgenciaExibicao(raw.nome);
  const chave = normalizarChaveAgencia(nomeLimpo);
  if (!chave) return null;
  const agenciaId = raw.agenciaId && typeof raw.agenciaId === 'string'
    ? raw.agenciaId
    : gerarAgenciaId(nomeLimpo);

  return {
    ...raw,
    agenciaId,
    nome: nomeLimpo,
    nomeNormalizado: chave,
    filialId: raw.filialId || '172',
    ativo: raw.ativo !== undefined ? Boolean(raw.ativo) : true,
  };
}

function normalizeVinculo(raw: any): VinculoPromotor {
  let setores: string[] = [];
  if (Array.isArray(raw.setores) && raw.setores.length > 0) {
    setores = raw.setores.filter((s: any) => s === 'FRIOS' || s === 'LOJA');
    if (setores.length === 0) setores = ['FRIOS'];
  } else if (raw.setorId) {
    const s = String(raw.setorId).toUpperCase();
    setores = (s === 'LOJA' || s === 'FRIOS') ? [s] : ['FRIOS'];
  } else {
    setores = ['FRIOS'];
  }

  return {
    ...raw,
    agenciaNome: normalizarNomeAgenciaExibicao(raw.agenciaNome) || 'Sem agência vinculada',
    setores,
    setorId: setores[0],
    setorNome: setores.join(' • '),
  };
}

export class PromotorService {
  private _promotores: Promotor[] = [];
  private _agencias: AgenciaComercial[] = [];
  private _vinculos: VinculoPromotor[] = [];
  private _auditorias: RegistroAuditoriaPromotor[] = [];
  private _historicoMovimentacoes: HistoricoMovimentacaoComercial[] = [];
  private _operacoes: OperacaoPromotorSync[] = [];
  private _listeners = new Set<PromotoresListener>();
  private _isInitialized = false;
  private _initPromise: Promise<void> | null = null;

  constructor() {
    try {
      comercialSyncService.registerPromotorHandlers({
        ensureReady: () => this.init(),
        getPromotores: () => [...this._promotores],
        getAgencias: () => [...this._agencias],
        getVinculosDispositivo: () => [...this._vinculos],
        getHistoricoMovimentacoes: () => [...this._historicoMovimentacoes],
        applyRemoteChanges: async ({
          promotores,
          agencias,
          vinculosDispositivo,
          historicoMovimentacoes,
        }) => {
          const writes: Promise<void>[] = [];
          if (promotores) {
            this._promotores = promotores.map(normalizePromotor);
            writes.push(dbPutAll(STORES.PROMOTORES, this._promotores, true));
          }
          if (agencias) {
            this._agencias = agencias
              .map(normalizeAgencia)
              .filter((a): a is AgenciaComercial => a !== null)
              .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
            writes.push(dbPutAll(STORES.AGENCIAS, this._agencias, true));
          }
          if (vinculosDispositivo) {
            this._vinculos = vinculosDispositivo.map(normalizeVinculo);
            writes.push(dbPutAll(STORES.VINCULOS_PROMOTORES, this._vinculos, true));
          }
          if (historicoMovimentacoes) {
            this._historicoMovimentacoes = historicoMovimentacoes
              .slice()
              .sort((a, b) => (b.dataHora || '').localeCompare(a.dataHora || ''))
              .slice(0, 500);
            writes.push(dbSetMeta(META_KEY_HISTORICO_MOVIMENTACOES, this._historicoMovimentacoes));
          }
          if (writes.length > 0) {
            await Promise.all(writes);
            await this._sincronizarAgenciasDePromotoresExistentes();
            this.notify();
          }
        },
      });
    } catch {
      // safe fallback
    }

    // Expiration check timer every minute
    if (typeof window !== 'undefined') {
      setInterval(() => {
        this.verificarExpiracaoVinculos();
      }, 60000);
    }
  }

  public subscribe(listener: PromotoresListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private notify() {
    this._listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('Erro no listener de Promotores:', err);
      }
    });
  }

  /**
   * Inicializa carregando dados do IndexedDB local e conectando listeners em tempo real do Firestore
   */
  public async init(): Promise<void> {
    if (this._isInitialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        // 1. Carregar do IndexedDB primeiro para resposta instantânea
        const [
          localPromotores,
          localAgencias,
          localVinculos,
          localAuditorias,
          localOperacoes,
          localHistoricoMov,
        ] = await Promise.all([
          dbGetAll<Promotor>(STORES.PROMOTORES),
          dbGetAll<AgenciaComercial>(STORES.AGENCIAS),
          dbGetAll<VinculoPromotor>(STORES.VINCULOS_PROMOTORES),
          dbGetAll<RegistroAuditoriaPromotor>(STORES.AUDITORIA_PROMOTORES),
          dbGetAll<OperacaoPromotorSync>(STORES.OPERACOES_PROMOTORES),
          dbGetMeta<HistoricoMovimentacaoComercial[]>(META_KEY_HISTORICO_MOVIMENTACOES, []),
        ]);

        if (localPromotores.length > 0) this._promotores = localPromotores.map(normalizePromotor);
        if (localAgencias.length > 0) {
          this._agencias = localAgencias
            .map(normalizeAgencia)
            .filter((a): a is AgenciaComercial => a !== null);
        }
        if (localVinculos.length > 0) this._vinculos = localVinculos.map(normalizeVinculo);
        if (localAuditorias.length > 0) this._auditorias = localAuditorias;
        if (localOperacoes.length > 0) this._operacoes = localOperacoes;
        if (Array.isArray(localHistoricoMov)) this._historicoMovimentacoes = localHistoricoMov;

        // Garantir existência de MARIA apenas em ambiente inicial sem pacote instalado
        const metaPacote = await dbGetMeta<any>('meta_pacote_atualizacao_isv', null);
        const temMaria = this._promotores.some((p) => p.nome.toUpperCase().includes('MARIA'));
        if (!temMaria && !metaPacote?.versaoInstaladaId && this._promotores.length === 0) {
          const agora = new Date().toISOString();
          const mariaPadrao: Promotor = {
            promotorId: 'promotor_maria_seara_172',
            nome: 'MARIA SILVA',
            agenciaId: gerarAgenciaId('SEARA'),
            agenciaNome: 'SEARA',
            matricula: 'SR-17201',
            filialId: '172',
            filialNome: 'Cascavel',
            setores: ['FRIOS', 'LOJA'],
            setorId: 'FRIOS',
            setorNome: 'FRIOS • LOJA',
            status: 'ATIVO',
            permissoes: { ...PERMISSOES_PADRAO_PROMOTOR },
            dispositivoVinculado: null,
            dataCadastro: agora,
            dataVinculo: null,
            ultimoAcesso: agora,
            ultimaSincronizacao: agora,
            criadoPor: 'SISTEMA_PRINCIPAL',
            atualizadoPor: 'SISTEMA_PRINCIPAL',
          };
          this._promotores = [mariaPadrao, ...this._promotores];
          dbPut(STORES.PROMOTORES, mariaPadrao).catch(() => {});
        }

        // Migração não-destrutiva: garante que todas as agências já referenciadas pelos promotores existam no cadastro independente
        await this._sincronizarAgenciasDePromotoresExistentes();

        this.verificarExpiracaoVinculos();
        this._isInitialized = true;
        this.notify();

        // 2. Iniciar sincronização comercial centralizada via Firestore (preservando BASE RUB/SAEOU060 no ZIP)
        if (typeof window !== 'undefined') {
          void comercialSyncService.iniciar().catch(() => {});
        }
      } catch (err) {
        console.warn('Erro ao inicializar PromotorService via IndexedDB:', err);
        this._isInitialized = true;
        this.notify();
      }
    })();

    return this._initPromise;
  }

  /**
   * Bootstrap idempotente e não-destrutivo:
   * Lê as agências já referenciadas pelos promotores existentes (ex.: os 31 promotores atuais)
   * e registra as que ainda não estão em STORES.AGENCIAS, sem alterar nenhum promotor ou vínculo.
   */
  private async _sincronizarAgenciasDePromotoresExistentes(): Promise<void> {
    const porChave = new Map<string, AgenciaComercial>();
    for (const ag of this._agencias) {
      const chave = normalizarChaveAgencia(ag.nome);
      if (chave && !porChave.has(chave)) {
        porChave.set(chave, ag);
      }
    }

    const novas: AgenciaComercial[] = [];
    const agora = new Date().toISOString();

    for (const p of this._promotores) {
      if (isAgenciaSemVinculoNome(p.agenciaNome)) continue;
      const nomeExib = normalizarNomeAgenciaExibicao(p.agenciaNome);
      const chave = normalizarChaveAgencia(nomeExib);
      if (!chave || porChave.has(chave)) continue;

      const nova: AgenciaComercial = {
        agenciaId: p.agenciaId || gerarAgenciaId(nomeExib),
        nome: nomeExib,
        nomeNormalizado: chave,
        filialId: p.filialId || '172',
        ativo: true,
        criadoEm: p.dataCadastro || agora,
        atualizadoEm: p.dataCadastro || agora,
      };
      porChave.set(chave, nova);
      novas.push(nova);
    }

    this._agencias = Array.from(porChave.values()).sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR')
    );

    if (novas.length > 0) {
      for (const ag of novas) {
        await dbPut(STORES.AGENCIAS, ag).catch(() => {});
      }
    }
  }

  // =========================================================================
  // CONSULTAS E INDICADORES
  // =========================================================================

  public isInitialized(): boolean {
    return this._isInitialized;
  }

  public getPromotores(): Promotor[] {
    return [...this._promotores];
  }

  public getPromotorById(id: string): Promotor | undefined {
    return this._promotores.find((p) => p.promotorId === id);
  }

  public getVinculos(): VinculoPromotor[] {
    return [...this._vinculos];
  }

  public getVinculoAtivoByPromotor(promotorId: string): VinculoPromotor | undefined {
    this.verificarExpiracaoVinculos();
    return this._vinculos.find(
      (v) => v.promotorId === promotorId && v.status === 'AGUARDANDO'
    );
  }

  public getAuditorias(promotorId?: string): RegistroAuditoriaPromotor[] {
    if (promotorId) {
      return this._auditorias.filter((a) => a.promotorId === promotorId);
    }
    return [...this._auditorias];
  }

  /**
   * Determina se o promotor está online com base na atividade recente (15 minutos).
   * Não cria conexões pesadas, segue a regra de presença leve.
   */
  public isPromotorOnline(promotor: Promotor): boolean {
    if (
      promotor.status === 'BLOQUEADO' ||
      promotor.status === 'DESVINCULADO' ||
      promotor.status === 'INATIVO'
    ) {
      return false;
    }
    if (!promotor.ultimoAcesso) {
      return false;
    }
    const diffMs = Date.now() - new Date(promotor.ultimoAcesso).getTime();
    return diffMs <= 15 * 60 * 1000; // 15 minutos
  }

  public getAgencias(): AgenciaComercial[] {
    return [...this._agencias].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  public getAgenciaById(agenciaId: string): AgenciaComercial | undefined {
    return this._agencias.find((a) => a.agenciaId === agenciaId);
  }

  public buscarAgenciaPorNome(nome: string): AgenciaComercial | undefined {
    const chave = normalizarChaveAgencia(nome);
    if (!chave) return undefined;
    return this._agencias.find((a) => normalizarChaveAgencia(a.nome) === chave);
  }

  public getPromotoresPorAgencia(agenciaIdOuNome: string): Promotor[] {
    const porId = this.getAgenciaById(agenciaIdOuNome);
    const chaveAlvo = porId
      ? normalizarChaveAgencia(porId.nome)
      : normalizarChaveAgencia(agenciaIdOuNome);

    return this._promotores.filter((p) => {
      if (porId && p.agenciaId === porId.agenciaId) return true;
      const chaveProm = normalizarChaveAgencia(p.agenciaNome);
      return Boolean(chaveAlvo && chaveProm === chaveAlvo);
    });
  }

  public getResumoPromotoresAgencia(agenciaIdOuNome: string): {
    total: number;
    ativos: number;
    pendentes: number;
    inativos: number;
    bloqueados: number;
  } {
    const lista = this.getPromotoresPorAgencia(agenciaIdOuNome);
    return {
      total: lista.length,
      ativos: lista.filter((p) => p.status === 'ATIVO').length,
      pendentes: lista.filter((p) => p.status === 'PENDENTE_VINCULO').length,
      inativos: lista.filter((p) => p.status === 'INATIVO' || p.status === 'DESVINCULADO').length,
      bloqueados: lista.filter((p) => p.status === 'BLOQUEADO').length,
    };
  }

  public getHistoricoMovimentacoes(filtros?: {
    promotorId?: string;
    agenciaId?: string;
  }): HistoricoMovimentacaoComercial[] {
    return this._historicoMovimentacoes.filter((h) => {
      if (filtros?.promotorId) {
        const matchProm =
          h.promotorId === filtros.promotorId || h.promotorSubstitutoId === filtros.promotorId;
        if (!matchProm) return false;
      }
      if (filtros?.agenciaId) {
        const matchAg =
          h.agenciaId === filtros.agenciaId || h.agenciaAnteriorId === filtros.agenciaId;
        if (!matchAg) return false;
      }
      return true;
    });
  }

  private async registrarMovimentacaoComercial(
    dados: Omit<HistoricoMovimentacaoComercial, 'id' | 'dataHora' | 'realizadoPor'> & {
      dataHora?: string;
      realizadoPor?: string;
    },
    opcoes?: { skipCloudSync?: boolean }
  ): Promise<HistoricoMovimentacaoComercial> {
    const entry: HistoricoMovimentacaoComercial = {
      id: `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      dataHora: dados.dataHora || new Date().toISOString(),
      realizadoPor: dados.realizadoPor || 'SISTEMA_PRINCIPAL',
      ...dados,
    };
    this._historicoMovimentacoes = [entry, ...this._historicoMovimentacoes].slice(0, 500);
    await dbSetMeta(META_KEY_HISTORICO_MOVIMENTACOES, this._historicoMovimentacoes);
    if (!opcoes?.skipCloudSync) {
      await comercialSyncService.registrarMovimentacaoSync(entry);
    }
    return entry;
  }

  // =========================================================================
  // CADASTRO E GERENCIAMENTO INDEPENDENTE DE AGÊNCIAS
  // =========================================================================

  public async cadastrarAgencia(dados: {
    nome: string;
    cnpj?: string;
    telefone?: string;
    contato?: string;
    observacoes?: string;
  }): Promise<AgenciaComercial> {
    const nomeLimpo = normalizarNomeAgenciaExibicao(dados.nome);
    const chave = normalizarChaveAgencia(nomeLimpo);
    if (!chave) {
      throw new Error('Informe um nome válido para a agência.');
    }

    const existente = this._agencias.find((a) => normalizarChaveAgencia(a.nome) === chave);
    if (existente) {
      throw new Error(
        `Já existe uma agência cadastrada com o nome "${existente.nome}" (duplicidade ignorando maiúsculas, acentos ou espaços).`
      );
    }

    const agora = new Date().toISOString();
    const nova: AgenciaComercial = {
      agenciaId: gerarAgenciaId(nomeLimpo),
      nome: nomeLimpo,
      nomeNormalizado: chave,
      filialId: '172',
      ativo: true,
      cnpj: dados.cnpj?.trim() || undefined,
      telefone: dados.telefone?.trim() || undefined,
      contato: dados.contato?.trim() || undefined,
      observacoes: dados.observacoes?.trim() || undefined,
      criadoEm: agora,
      atualizadoEm: agora,
    };

    this._agencias = [...this._agencias, nova].sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR')
    );
    await dbPut(STORES.AGENCIAS, nova);
    await comercialSyncService.registrarAgenciaSync(nova);

    await this.registrarMovimentacaoComercial({
      tipo: 'AGENCIA_CRIADA',
      agenciaId: nova.agenciaId,
      agenciaNome: nova.nome,
      detalhes: `Agência "${nova.nome}" cadastrada.`,
    });

    notificarAlteracaoParaPacoteLocal('AGENCIA', `Agência cadastrada: ${nova.nome}`);
    this.notify();
    return nova;
  }

  public async obterOuCriarAgenciaPorNome(nome: string): Promise<AgenciaComercial> {
    const existente = this.buscarAgenciaPorNome(nome);
    if (existente) return existente;
    return this.cadastrarAgencia({ nome });
  }

  public async atualizarAgencia(
    agenciaId: string,
    dados: Partial<{
      nome: string;
      cnpj: string;
      telefone: string;
      contato: string;
      observacoes: string;
      ativo: boolean;
    }>
  ): Promise<AgenciaComercial> {
    const idx = this._agencias.findIndex((a) => a.agenciaId === agenciaId);
    if (idx < 0) throw new Error('Agência não encontrada.');
    const atual = this._agencias[idx];

    const nomeFinal =
      dados.nome !== undefined ? normalizarNomeAgenciaExibicao(dados.nome) : atual.nome;
    const chaveFinal = normalizarChaveAgencia(nomeFinal);
    if (!chaveFinal) {
      throw new Error('Informe um nome válido para a agência.');
    }

    const duplicada = this._agencias.find(
      (a) => a.agenciaId !== agenciaId && normalizarChaveAgencia(a.nome) === chaveFinal
    );
    if (duplicada) {
      throw new Error(
        `Já existe outra agência cadastrada com o nome "${duplicada.nome}".`
      );
    }

    const agora = new Date().toISOString();
    const atualizada: AgenciaComercial = {
      ...atual,
      nome: nomeFinal,
      nomeNormalizado: chaveFinal,
      cnpj: dados.cnpj !== undefined ? (dados.cnpj.trim() || undefined) : atual.cnpj,
      telefone: dados.telefone !== undefined ? (dados.telefone.trim() || undefined) : atual.telefone,
      contato: dados.contato !== undefined ? (dados.contato.trim() || undefined) : atual.contato,
      observacoes:
        dados.observacoes !== undefined ? (dados.observacoes.trim() || undefined) : atual.observacoes,
      ativo: dados.ativo !== undefined ? dados.ativo : atual.ativo,
      atualizadoEm: agora,
    };

    this._agencias[idx] = atualizada;
    this._agencias.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    await dbPut(STORES.AGENCIAS, atualizada);

    // Atualizar referência nos promotores vinculados caso o nome de exibição tenha mudado
    const nomeMudou = atual.nome !== atualizada.nome;
    const chaveAnterior = normalizarChaveAgencia(atual.nome);
    const promotoresAtualizados: Promotor[] = [];
    if (nomeMudou) {
      this._promotores = this._promotores.map((p) => {
        const pertence =
          p.agenciaId === agenciaId || normalizarChaveAgencia(p.agenciaNome) === chaveAnterior;
        if (!pertence) return p;
        const pAtualizado: Promotor = {
          ...p,
          agenciaId,
          agenciaNome: atualizada.nome,
          atualizadoEm: agora,
          atualizadoPor: 'SISTEMA_PRINCIPAL',
        };
        promotoresAtualizados.push(pAtualizado);
        return pAtualizado;
      });
      for (const pAt of promotoresAtualizados) {
        await dbPut(STORES.PROMOTORES, pAt);
      }
    }

    await comercialSyncService.registrarAgenciaSync(atualizada, promotoresAtualizados);

    await this.registrarMovimentacaoComercial({
      tipo: 'AGENCIA_EDITADA',
      agenciaId: atualizada.agenciaId,
      agenciaNome: atualizada.nome,
      agenciaAnteriorNome: nomeMudou ? atual.nome : undefined,
      detalhes: nomeMudou
        ? `Agência "${atual.nome}" atualizada para "${atualizada.nome}".`
        : `Dados da agência "${atualizada.nome}" atualizados.`,
    });

    notificarAlteracaoParaPacoteLocal('AGENCIA', `Agência atualizada: ${atualizada.nome}`);
    this.notify();
    return atualizada;
  }

  public getIndicators(): PromotoresIndicators {
    let totalAtivos = 0;
    let totalOffline = 0;
    let pendenciasSincronizacao = 0;

    const todayPrefix = new Date().toISOString().slice(0, 10);
    let acoesHoje = 0;

    for (const p of this._promotores) {
      if (p.status === 'ATIVO') {
        totalAtivos++;
        if (!this.isPromotorOnline(p)) {
          totalOffline++;
        }
      } else if (p.status === 'PENDENTE_VINCULO') {
        pendenciasSincronizacao++;
      }
    }

    // Contar operações pendentes de sync
    for (const op of this._operacoes) {
      if (op.status === 'PENDENTE') {
        pendenciasSincronizacao++;
      }
    }

    // Contar ações de auditoria de hoje
    for (const a of this._auditorias) {
      if (a.dataHora && a.dataHora.startsWith(todayPrefix)) {
        acoesHoje++;
      }
    }

    return {
      totalAtivos,
      totalOffline,
      pendenciasSincronizacao,
      acoesHoje,
    };
  }

  // =========================================================================
  // CADASTRO E GERENCIAMENTO DE PROMOTOR
  // =========================================================================

  public async cadastrarPromotor(dados: {
    nome: string;
    agenciaId?: string;
    agenciaNome?: string;
    matricula?: string;
    filialId?: string;
    filialNome?: string;
    setores: string[];
    permissoes?: PermissoesPromotor;
  }): Promise<Promotor> {
    const nomeLimpo = dados.nome.trim();
    if (!nomeLimpo) {
      throw new Error('O nome do promotor é obrigatório.');
    }

    let agenciaVinculada: AgenciaComercial | null = null;
    if (dados.agenciaId) {
      agenciaVinculada = this.getAgenciaById(dados.agenciaId) || null;
      if (!agenciaVinculada && dados.agenciaNome && !isAgenciaSemVinculoNome(dados.agenciaNome)) {
        agenciaVinculada = await this.obterOuCriarAgenciaPorNome(dados.agenciaNome);
      }
    } else if (dados.agenciaNome && !isAgenciaSemVinculoNome(dados.agenciaNome)) {
      agenciaVinculada = await this.obterOuCriarAgenciaPorNome(dados.agenciaNome);
    }

    if (!agenciaVinculada) {
      throw new Error('A Agência / Empresa responsável pelo promotor é obrigatória.');
    }

    const setoresValidos = (dados.setores || []).filter((s) => s === 'FRIOS' || s === 'LOJA');
    if (setoresValidos.length === 0) {
      throw new Error('Selecione pelo menos um setor de atuação.');
    }

    const agora = new Date().toISOString();
    const promotorId = `promotor_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const setorNomeExibicao = setoresValidos.join(' • ');

    const novoPromotor: Promotor = {
      promotorId,
      nome: nomeLimpo,
      agenciaId: agenciaVinculada.agenciaId,
      agenciaNome: agenciaVinculada.nome,
      matricula: dados.matricula ? dados.matricula.trim() : undefined,
      filialId: dados.filialId || '172',
      filialNome: dados.filialNome || 'Cascavel',
      setores: setoresValidos,
      setorId: setoresValidos[0],
      setorNome: setorNomeExibicao,
      status: 'PENDENTE_VINCULO',
      permissoes: dados.permissoes || { ...PERMISSOES_PADRAO_PROMOTOR },
      dispositivoVinculado: null,
      dataCadastro: agora,
      dataVinculo: null,
      ultimoAcesso: null,
      ultimaSincronizacao: null,
      atualizadoEm: agora,
      criadoPor: 'SISTEMA_PRINCIPAL',
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    // Salva localmente
    this._promotores = [novoPromotor, ...this._promotores];
    await dbPut(STORES.PROMOTORES, novoPromotor);

    // Enfileira e sincroniza no Firestore (Promotor + Vínculo Promotor x Agência)
    await comercialSyncService.registrarPromotorSync(novoPromotor, true);

    // Registra Auditoria + Histórico Comercial
    await this.registrarAuditoria({
      promotorId,
      promotorNome: novoPromotor.nome,
      agenciaNome: novoPromotor.agenciaNome,
      filialId: novoPromotor.filialId,
      setores: novoPromotor.setores,
      setorId: novoPromotor.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: 'NENHUM',
      valorNovo: `Promotor cadastrado (${agenciaVinculada.nome} - Setores: ${setorNomeExibicao}) status: PENDENTE_VINCULO`,
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    await this.registrarMovimentacaoComercial({
      tipo: 'PROMOTOR_VINCULADO_AGENCIA',
      promotorId,
      promotorNome: novoPromotor.nome,
      agenciaId: agenciaVinculada.agenciaId,
      agenciaNome: agenciaVinculada.nome,
      detalhes: `Promotor "${novoPromotor.nome}" cadastrado e vinculado à agência "${agenciaVinculada.nome}".`,
      dataHora: agora,
    });

    notificarAlteracaoParaPacoteLocal(
      'PROMOTOR',
      `Promotor cadastrado: ${novoPromotor.nome} (${agenciaVinculada.nome})`
    );
    this.notify();
    return novoPromotor;
  }

  public async atualizarPromotor(
    promotorId: string,
    dados: Partial<{
      nome: string;
      agenciaId: string | null;
      agenciaNome: string;
      matricula: string;
      setores: string[];
      desvincularAgencia: boolean;
    }>
  ): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    const novoNome = dados.nome !== undefined ? dados.nome.trim() : promotor.nome;
    if (!novoNome) throw new Error('O nome do promotor é obrigatório.');

    let novaAgenciaId: string | null | undefined = promotor.agenciaId;
    let novaAgenciaNome: string = promotor.agenciaNome;

    if (dados.desvincularAgencia || dados.agenciaId === null) {
      novaAgenciaId = null;
      novaAgenciaNome = '';
    } else if (dados.agenciaId !== undefined && dados.agenciaId) {
      const ag = this.getAgenciaById(dados.agenciaId);
      if (!ag) throw new Error('Agência selecionada não encontrada.');
      novaAgenciaId = ag.agenciaId;
      novaAgenciaNome = ag.nome;
    } else if (dados.agenciaNome !== undefined) {
      if (isAgenciaSemVinculoNome(dados.agenciaNome)) {
        throw new Error('A Agência / Empresa é obrigatória.');
      }
      const ag = await this.obterOuCriarAgenciaPorNome(dados.agenciaNome);
      novaAgenciaId = ag.agenciaId;
      novaAgenciaNome = ag.nome;
    }

    let novosSetores = promotor.setores;
    if (dados.setores !== undefined) {
      novosSetores = dados.setores.filter((s) => s === 'FRIOS' || s === 'LOJA');
      if (novosSetores.length === 0) {
        throw new Error('Selecione pelo menos um setor de atuação.');
      }
    }

    const agora = new Date().toISOString();
    const atualizado: Promotor = {
      ...promotor,
      nome: novoNome,
      agenciaId: novaAgenciaId,
      agenciaNome: novaAgenciaNome,
      matricula: dados.matricula !== undefined ? (dados.matricula.trim() || undefined) : promotor.matricula,
      setores: novosSetores,
      setorId: novosSetores[0],
      setorNome: novosSetores.join(' • '),
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, true);

    const agenciaAnteriorChave = normalizarChaveAgencia(promotor.agenciaNome);
    const agenciaNovaChave = normalizarChaveAgencia(novaAgenciaNome);
    if (agenciaAnteriorChave !== agenciaNovaChave) {
      await this.registrarMovimentacaoComercial({
        tipo: !agenciaNovaChave
          ? 'PROMOTOR_DESVINCULADO_AGENCIA'
          : !agenciaAnteriorChave
          ? 'PROMOTOR_VINCULADO_AGENCIA'
          : 'PROMOTOR_TRANSFERIDO_AGENCIA',
        promotorId: atualizado.promotorId,
        promotorNome: atualizado.nome,
        agenciaId: novaAgenciaId || undefined,
        agenciaNome: novaAgenciaNome || undefined,
        agenciaAnteriorId: promotor.agenciaId || undefined,
        agenciaAnteriorNome: promotor.agenciaNome || undefined,
        detalhes: !agenciaNovaChave
          ? `Promotor "${atualizado.nome}" desvinculado da agência "${promotor.agenciaNome}".`
          : !agenciaAnteriorChave
          ? `Promotor "${atualizado.nome}" vinculado à agência "${novaAgenciaNome}".`
          : `Promotor "${atualizado.nome}" transferido de "${promotor.agenciaNome}" para "${novaAgenciaNome}".`,
      });
    }

    await this.registrarAuditoria({
      promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorNovo: `Dados atualizados (${novaAgenciaNome || 'Sem agência'} - Setores: ${atualizado.setorNome})`,
      dataHora: new Date().toISOString(),
      statusSincronizacao: 'SINCRONIZADO',
    });

    notificarAlteracaoParaPacoteLocal(
      'PROMOTOR',
      `Promotor atualizado: ${atualizado.nome} (${novaAgenciaNome || 'Sem agência'})`
    );
    this.notify();
    return atualizado;
  }

  /**
   * Vincula ou transfere um promotor para outra agência, preservando todo o histórico.
   */
  public async vincularOuTransferirPromotorAgencia(
    promotorId: string,
    destinoAgenciaId: string,
    motivo?: string
  ): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');
    const destino = this.getAgenciaById(destinoAgenciaId);
    if (!destino) throw new Error('Agência de destino não encontrada.');

    const anteriorNome = promotor.agenciaNome;
    const anteriorId = promotor.agenciaId || undefined;
    const mesmaAgencia =
      promotor.agenciaId === destino.agenciaId ||
      normalizarChaveAgencia(anteriorNome) === normalizarChaveAgencia(destino.nome);

    if (mesmaAgencia) return promotor;

    const agora = new Date().toISOString();
    const atualizado: Promotor = {
      ...promotor,
      agenciaId: destino.agenciaId,
      agenciaNome: destino.nome,
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, true);

    const tinhaAgencia = !isAgenciaSemVinculoNome(anteriorNome);
    await this.registrarMovimentacaoComercial({
      tipo: tinhaAgencia ? 'PROMOTOR_TRANSFERIDO_AGENCIA' : 'PROMOTOR_VINCULADO_AGENCIA',
      promotorId: atualizado.promotorId,
      promotorNome: atualizado.nome,
      agenciaId: destino.agenciaId,
      agenciaNome: destino.nome,
      agenciaAnteriorId: tinhaAgencia ? anteriorId : undefined,
      agenciaAnteriorNome: tinhaAgencia ? anteriorNome : undefined,
      motivo: motivo?.trim() || undefined,
      detalhes: tinhaAgencia
        ? `Promotor "${atualizado.nome}" transferido da agência "${anteriorNome}" para "${destino.nome}".`
        : `Promotor "${atualizado.nome}" vinculado à agência "${destino.nome}".`,
    });

    await this.registrarAuditoria({
      promotorId: atualizado.promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: destino.nome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: anteriorNome || 'Sem agência',
      valorNovo: `Agência atualizada para ${destino.nome}`,
      dataHora: new Date().toISOString(),
      statusSincronizacao: 'SINCRONIZADO',
    });

    notificarAlteracaoParaPacoteLocal(
      'PROMOTOR',
      `Promotor ${atualizado.nome} vinculado à agência ${destino.nome}`
    );
    this.notify();
    return atualizado;
  }

  /**
   * Desvincula o promotor da sua agência atual sem excluir histórico ou auditoria.
   * Opcionalmente marca o promotor como INATIVO.
   */
  public async desvincularPromotorDaAgencia(
    promotorId: string,
    opcoes?: { motivo?: string; inativarPromotor?: boolean }
  ): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    const agenciaAnteriorNome = promotor.agenciaNome;
    const agenciaAnteriorId = promotor.agenciaId || gerarAgenciaId(agenciaAnteriorNome);
    const agora = new Date().toISOString();

    if (opcoes?.inativarPromotor) {
      await this.cancelarVinculoAtivoDePromotor(promotorId);
    }

    const atualizado: Promotor = {
      ...promotor,
      agenciaId: null,
      agenciaNome: '',
      status: opcoes?.inativarPromotor ? 'INATIVO' : promotor.status,
      inativadoEm: opcoes?.inativarPromotor ? agora : promotor.inativadoEm,
      motivoInativacao: opcoes?.inativarPromotor
        ? (opcoes.motivo?.trim() || 'Desligado da agência')
        : promotor.motivoInativacao,
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, true);

    await this.registrarMovimentacaoComercial({
      tipo: 'PROMOTOR_DESVINCULADO_AGENCIA',
      promotorId: atualizado.promotorId,
      promotorNome: atualizado.nome,
      agenciaAnteriorId: !isAgenciaSemVinculoNome(agenciaAnteriorNome) ? agenciaAnteriorId : undefined,
      agenciaAnteriorNome: !isAgenciaSemVinculoNome(agenciaAnteriorNome) ? agenciaAnteriorNome : undefined,
      motivo: opcoes?.motivo?.trim() || undefined,
      detalhes: `Promotor "${atualizado.nome}" desvinculado da agência "${agenciaAnteriorNome || 'N/A'}"${
        opcoes?.inativarPromotor ? ' e marcado como INATIVO' : ''
      }.`,
      dataHora: agora,
    });

    await this.registrarAuditoria({
      promotorId: atualizado.promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: agenciaAnteriorNome || 'Sem agência',
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: agenciaAnteriorNome || 'Sem agência',
      valorNovo: `Desvinculado da agência${opcoes?.inativarPromotor ? ' (Status: INATIVO)' : ''}`,
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    notificarAlteracaoParaPacoteLocal(
      'PROMOTOR',
      `Promotor desvinculado da agência: ${atualizado.nome}`
    );
    this.notify();
    return atualizado;
  }

  /**
   * Marca o promotor como INATIVO preservando todo o histórico e permitindo reativação futura.
   */
  public async inativarPromotor(promotorId: string, motivo?: string): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    await this.cancelarVinculoAtivoDePromotor(promotorId);
    const agora = new Date().toISOString();

    const atualizado: Promotor = {
      ...promotor,
      status: 'INATIVO',
      inativadoEm: agora,
      motivoInativacao: motivo?.trim() || 'Inativado administrativamente',
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, true);

    await this.registrarMovimentacaoComercial({
      tipo: 'PROMOTOR_INATIVADO',
      promotorId: atualizado.promotorId,
      promotorNome: atualizado.nome,
      agenciaId: atualizado.agenciaId || undefined,
      agenciaNome: atualizado.agenciaNome || undefined,
      motivo: atualizado.motivoInativacao,
      detalhes: `Promotor "${atualizado.nome}" marcado como INATIVO (${atualizado.motivoInativacao}).`,
      dataHora: agora,
    });

    await this.registrarAuditoria({
      promotorId: atualizado.promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: promotor.status,
      valorNovo: `INATIVO: ${atualizado.motivoInativacao}`,
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    notificarAlteracaoParaPacoteLocal('PROMOTOR', `Promotor inativado: ${atualizado.nome}`);
    this.notify();
    return atualizado;
  }

  /**
   * Reativa um promotor previamente INATIVO (ou BLOQUEADO), opcionalmente associando-o a uma agência.
   */
  public async reativarPromotor(promotorId: string, novaAgenciaId?: string): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    let agenciaId = promotor.agenciaId;
    let agenciaNome = promotor.agenciaNome;
    if (novaAgenciaId) {
      const ag = this.getAgenciaById(novaAgenciaId);
      if (!ag) throw new Error('Agência informada para reativação não encontrada.');
      agenciaId = ag.agenciaId;
      agenciaNome = ag.nome;
    }

    const agora = new Date().toISOString();
    const novoStatus: StatusPromotor = promotor.dispositivoVinculado ? 'ATIVO' : 'PENDENTE_VINCULO';

    const atualizado: Promotor = {
      ...promotor,
      status: novoStatus,
      agenciaId,
      agenciaNome,
      reativadoEm: agora,
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, true);

    await this.registrarMovimentacaoComercial({
      tipo: 'PROMOTOR_REATIVADO',
      promotorId: atualizado.promotorId,
      promotorNome: atualizado.nome,
      agenciaId: agenciaId || undefined,
      agenciaNome: agenciaNome || undefined,
      detalhes: `Promotor "${atualizado.nome}" reativado com status ${novoStatus}${
        agenciaNome ? ` na agência "${agenciaNome}"` : ''
      }.`,
      dataHora: agora,
    });

    await this.registrarAuditoria({
      promotorId: atualizado.promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: promotor.status,
      valorNovo: `REATIVADO (${novoStatus})`,
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    notificarAlteracaoParaPacoteLocal('PROMOTOR', `Promotor reativado: ${atualizado.nome}`);
    this.notify();
    return atualizado;
  }

  /**
   * Executa a substituição controlada e ATÔMICA de um promotor:
   * - Permite desvincular o promotor anterior da agência e/ou inativá-lo sem apagar histórico.
   * - Permite atualizar/atribuir a agência do substituto no mesmo fluxo atômico.
   * - Transfere vínculos de indústrias para o substituto SOMENTE quando
   *   `confirmarTransferenciaVinculosIndustrias === true`.
   * - Em caso de qualquer erro após iniciar a transferência, executa rollback completo
   *   tanto em promotorService quanto nos vínculos de indústrias transferidos.
   */
  public async substituirPromotor(params: {
    promotorAntigoId: string;
    promotorSubstitutoId: string;
    novaAgenciaSubstitutoId?: string;
    desvincularAntigoDaAgencia?: boolean;
    inativarAntigo?: boolean;
    confirmarTransferenciaVinculosIndustrias: boolean;
    modoTransferencia?: 'TODAS' | 'MANUAL' | 'NENHUMA';
    cnpjsSelecionados?: string[];
    motivo?: string;
    onTransferirVinculos?: (
      origemId: string,
      destino: Promotor,
      cnpjs?: string[]
    ) => Promise<string[]>;
    onTransferirVinculosDetalhado?: (
      origemId: string,
      destino: Promotor,
      cnpjs?: string[]
    ) => Promise<{
      cnpjsTransferidos: string[];
      cnpjsNovosNoDestino: string[];
      cnpjsJaExistentesNoDestino: string[];
      cnpjsOrigemAntes: string[];
      industriasTransferidasDetalhes: Array<{
        cnpj: string;
        cnpjFormatado?: string;
        nome: string;
      }>;
      vinculosCriados?: VinculoPromotorIndustria[];
      vinculosRemovidos?: VinculoPromotorIndustria[];
      syncJaEnfileirado?: boolean;
      rollback?: () => Promise<void>;
    }>;
    persistirSubstituicaoHook?: () => Promise<void>;
  }): Promise<{
    antigo: Promotor;
    substituto: Promotor;
    cnpjsTransferidos: string[];
    cnpjsNovosNoDestino: string[];
    cnpjsJaExistentesNoDestino: string[];
  }> {
    if (params.promotorAntigoId === params.promotorSubstitutoId) {
      throw new Error('Selecione um promotor substituto diferente do promotor atual.');
    }

    const antigo = this.getPromotorById(params.promotorAntigoId);
    if (!antigo) throw new Error('Promotor anterior não encontrado.');
    const substitutoBase = this.getPromotorById(params.promotorSubstitutoId);
    if (!substitutoBase) throw new Error('Promotor substituto não encontrado.');

    const agora = new Date().toISOString();

    let substitutoAlvo: Promotor = { ...substitutoBase };
    let substitutoAgenciaAlterada = false;
    let agenciaSubstitutoAnteriorNome = substitutoBase.agenciaNome;
    let agenciaSubstitutoAnteriorId = substitutoBase.agenciaId || undefined;

    if (params.novaAgenciaSubstitutoId) {
      const agDestino = this.getAgenciaById(params.novaAgenciaSubstitutoId);
      if (!agDestino) {
        throw new Error('Agência selecionada para o substituto não encontrada.');
      }
      if (substitutoBase.agenciaId !== agDestino.agenciaId) {
        substitutoAlvo = {
          ...substitutoBase,
          agenciaId: agDestino.agenciaId,
          agenciaNome: agDestino.nome,
          atualizadoEm: agora,
          atualizadoPor: 'SISTEMA_PRINCIPAL',
        };
        substitutoAgenciaAlterada = true;
      }
    }

    // Snapshot para garantir atomicidade e rollback completo em caso de erro
    const snapshotPromotores = this._promotores.map((p) => ({ ...p }));
    const snapshotVinculos = this._vinculos.map((v) => ({ ...v }));
    const snapshotHistorico = this._historicoMovimentacoes.map((h) => ({ ...h }));
    const snapshotAuditorias = this._auditorias.map((a) => ({ ...a }));

    const motivoLimpo = params.motivo?.trim() || 'Substituição comercial de promotor';
    const modoTransferencia: 'TODAS' | 'MANUAL' | 'NENHUMA' =
      params.confirmarTransferenciaVinculosIndustrias === true
        ? (params.modoTransferencia || 'TODAS')
        : 'NENHUMA';

    let cnpjsTransferidos: string[] = [];
    let cnpjsNovosNoDestino: string[] = [];
    let cnpjsJaExistentesNoDestino: string[] = [];
    let cnpjsOrigemAntes: string[] = [];
    let industriasTransferidasDetalhes: Array<{
      cnpj: string;
      cnpjFormatado?: string;
      nome: string;
    }> = [];
    let vinculosIndustriaCriados: VinculoPromotorIndustria[] = [];
    let vinculosIndustriaRemovidos: VinculoPromotorIndustria[] = [];
    let vinculosIndSyncJaEnfileirado = false;
    let rollbackVinculos: (() => Promise<void>) | undefined;

    try {
      if (params.confirmarTransferenciaVinculosIndustrias === true) {
        if (params.onTransferirVinculosDetalhado) {
          const det = await params.onTransferirVinculosDetalhado(
            antigo.promotorId,
            substitutoAlvo,
            params.cnpjsSelecionados
          );
          cnpjsTransferidos = det.cnpjsTransferidos || [];
          cnpjsNovosNoDestino = det.cnpjsNovosNoDestino || [];
          cnpjsJaExistentesNoDestino = det.cnpjsJaExistentesNoDestino || [];
          cnpjsOrigemAntes = det.cnpjsOrigemAntes || [];
          industriasTransferidasDetalhes = det.industriasTransferidasDetalhes || [];
          vinculosIndustriaCriados = det.vinculosCriados || [];
          vinculosIndustriaRemovidos = det.vinculosRemovidos || [];
          vinculosIndSyncJaEnfileirado = Boolean(det.syncJaEnfileirado);
          rollbackVinculos = det.rollback;
        } else if (params.onTransferirVinculos) {
          cnpjsTransferidos = await params.onTransferirVinculos(
            antigo.promotorId,
            substitutoAlvo,
            params.cnpjsSelecionados
          );
          cnpjsNovosNoDestino = [...cnpjsTransferidos];
        }
      }

      if (params.persistirSubstituicaoHook) {
        await params.persistirSubstituicaoHook();
      }

      const agenciaAnteriorId = antigo.agenciaId || undefined;
      const agenciaAnteriorNome = antigo.agenciaNome;

      const antigoAtualizado: Promotor = {
        ...antigo,
        agenciaId: params.desvincularAntigoDaAgencia ? null : antigo.agenciaId,
        agenciaNome: params.desvincularAntigoDaAgencia ? '' : antigo.agenciaNome,
        status: params.inativarAntigo ? 'INATIVO' : antigo.status,
        inativadoEm: params.inativarAntigo ? agora : antigo.inativadoEm,
        motivoInativacao: params.inativarAntigo ? motivoLimpo : antigo.motivoInativacao,
        substituidoPorPromotorId: substitutoAlvo.promotorId,
        substituidoPorPromotorNome: substitutoAlvo.nome,
        atualizadoEm: agora,
        atualizadoPor: 'SISTEMA_PRINCIPAL',
      };

      const nextVinculos = params.inativarAntigo
        ? snapshotVinculos.map((v) =>
            v.promotorId === antigo.promotorId && v.status === 'AGUARDANDO'
              ? { ...v, status: 'CANCELADO' as const, atualizadoEm: agora }
              : v
          )
        : snapshotVinculos;

      const vinculosCancelados = nextVinculos.filter(
        (v, idx) => v.status !== snapshotVinculos[idx]?.status
      );

      const nextPromotores = snapshotPromotores.map((p) => {
        if (p.promotorId === antigo.promotorId) return antigoAtualizado;
        if (substitutoAgenciaAlterada && p.promotorId === substitutoAlvo.promotorId) {
          return substitutoAlvo;
        }
        return p;
      });

      const novasMovimentacoes: HistoricoMovimentacaoComercial[] = [];

      if (substitutoAgenciaAlterada) {
        const tinhaAgAnt = !isAgenciaSemVinculoNome(agenciaSubstitutoAnteriorNome);
        novasMovimentacoes.push({
          id: `mov_${Date.now()}_ag_${Math.random().toString(36).substring(2, 6)}`,
          tipo: tinhaAgAnt ? 'PROMOTOR_TRANSFERIDO_AGENCIA' : 'PROMOTOR_VINCULADO_AGENCIA',
          dataHora: agora,
          promotorId: substitutoAlvo.promotorId,
          promotorNome: substitutoAlvo.nome,
          agenciaId: substitutoAlvo.agenciaId || undefined,
          agenciaNome: substitutoAlvo.agenciaNome || undefined,
          agenciaAnteriorId: tinhaAgAnt ? agenciaSubstitutoAnteriorId : undefined,
          agenciaAnteriorNome: tinhaAgAnt ? agenciaSubstitutoAnteriorNome : undefined,
          motivo: motivoLimpo,
          detalhes: tinhaAgAnt
            ? `Agência do substituto "${substitutoAlvo.nome}" atualizada de "${agenciaSubstitutoAnteriorNome}" para "${substitutoAlvo.agenciaNome}".`
            : `Substituto "${substitutoAlvo.nome}" vinculado à agência "${substitutoAlvo.agenciaNome}".`,
          realizadoPor: 'SISTEMA_PRINCIPAL',
        });
      }

      if (cnpjsTransferidos.length > 0) {
        const resumoInds = industriasTransferidasDetalhes
          .slice(0, 5)
          .map((i) => i.nome)
          .join(', ');
        const sufixoInds =
          industriasTransferidasDetalhes.length > 5
            ? ` (+${industriasTransferidasDetalhes.length - 5})`
            : '';

        novasMovimentacoes.push({
          id: `mov_${Date.now()}_tr_${Math.random().toString(36).substring(2, 6)}`,
          tipo: 'VINCULOS_INDUSTRIAS_TRANSFERIDOS',
          dataHora: agora,
          promotorId: antigo.promotorId,
          promotorNome: antigo.nome,
          promotorSubstitutoId: substitutoAlvo.promotorId,
          promotorSubstitutoNome: substitutoAlvo.nome,
          agenciaAnteriorId: !isAgenciaSemVinculoNome(agenciaAnteriorNome)
            ? agenciaAnteriorId
            : undefined,
          agenciaAnteriorNome: !isAgenciaSemVinculoNome(agenciaAnteriorNome)
            ? agenciaAnteriorNome
            : undefined,
          agenciaId: substitutoAlvo.agenciaId || undefined,
          agenciaNome: substitutoAlvo.agenciaNome || undefined,
          cnpjsTransferidos,
          industriasTransferidas: industriasTransferidasDetalhes,
          cnpjsOrigemAntes,
          cnpjsIgnoradosDuplicidade: cnpjsJaExistentesNoDestino,
          modoTransferencia,
          inativacaoOrigem: Boolean(params.inativarAntigo),
          motivo: motivoLimpo,
          detalhes: `Transferência em massa (${modoTransferencia}) de ${cnpjsTransferidos.length} indústria(s) de "${antigo.nome}" para "${substitutoAlvo.nome}"${
            resumoInds ? ` [${resumoInds}${sufixoInds}]` : ''
          }${
            cnpjsJaExistentesNoDestino.length > 0
              ? ` (${cnpjsJaExistentesNoDestino.length} duplicidade(s) prevenida(s))`
              : ''
          }.`,
          realizadoPor: 'SISTEMA_PRINCIPAL',
        });
      }

      novasMovimentacoes.push({
        id: `mov_${Date.now()}_sub_${Math.random().toString(36).substring(2, 6)}`,
        tipo: 'PROMOTOR_SUBSTITUIDO',
        dataHora: agora,
        promotorId: antigo.promotorId,
        promotorNome: antigo.nome,
        promotorSubstitutoId: substitutoAlvo.promotorId,
        promotorSubstitutoNome: substitutoAlvo.nome,
        agenciaAnteriorId: !isAgenciaSemVinculoNome(agenciaAnteriorNome)
          ? agenciaAnteriorId
          : undefined,
        agenciaAnteriorNome: !isAgenciaSemVinculoNome(agenciaAnteriorNome)
          ? agenciaAnteriorNome
          : undefined,
        agenciaId: substitutoAlvo.agenciaId || undefined,
        agenciaNome: substitutoAlvo.agenciaNome || undefined,
        cnpjsTransferidos,
        industriasTransferidas: industriasTransferidasDetalhes,
        cnpjsOrigemAntes,
        cnpjsIgnoradosDuplicidade: cnpjsJaExistentesNoDestino,
        modoTransferencia,
        inativacaoOrigem: Boolean(params.inativarAntigo),
        motivo: motivoLimpo,
        detalhes: `Substituição registrada: "${antigo.nome}" → "${substitutoAlvo.nome}". ${
          cnpjsTransferidos.length > 0
            ? `${cnpjsTransferidos.length} vínculo(s) de indústria transferido(s) mediante confirmação explícita.`
            : 'Nenhum vínculo de indústria transferido.'
        }`,
        realizadoPor: 'SISTEMA_PRINCIPAL',
      });

      const nextHistorico = [...novasMovimentacoes, ...snapshotHistorico].slice(0, 500);

      const novaAuditoria: RegistroAuditoriaPromotor = {
        auditoriaId: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        promotorId: antigo.promotorId,
        promotorNome: antigo.nome,
        agenciaNome: agenciaAnteriorNome || 'Sem agência',
        filialId: antigo.filialId,
        setores: antigo.setores,
        setorId: antigo.setorId,
        tipoAcao: 'SINCRONIZOU_ALTERACAO',
        valorAnterior: `Status ${antigo.status} (${agenciaAnteriorNome || 'Sem agência'})`,
        valorNovo: `Substituído por ${substitutoAlvo.nome} (${cnpjsTransferidos.length} indústrias transferidas)`,
        dataHora: agora,
        statusSincronizacao: 'SINCRONIZADO',
      };

      const nextAuditorias = [novaAuditoria, ...snapshotAuditorias];

      const batchOps: AtomicBatchOp[] = [
        { storeName: STORES.PROMOTORES, type: 'put', item: antigoAtualizado },
        ...(substitutoAgenciaAlterada
          ? [{ storeName: STORES.PROMOTORES, type: 'put' as const, item: substitutoAlvo }]
          : []),
        ...vinculosCancelados.map((v) => ({
          storeName: STORES.VINCULOS_PROMOTORES,
          type: 'put' as const,
          item: v,
        })),
        { storeName: STORES.AUDITORIA_PROMOTORES, type: 'put', item: novaAuditoria },
        {
          storeName: STORES.METADADOS,
          type: 'setMeta',
          key: META_KEY_HISTORICO_MOVIMENTACOES,
          value: nextHistorico,
        },
      ];

      await dbRunAtomicBatch(batchOps);

      // Commit atômico em memória após sucesso na persistência
      this._promotores = nextPromotores;
      this._vinculos = nextVinculos;
      this._historicoMovimentacoes = nextHistorico;
      this._auditorias = nextAuditorias;

      await comercialSyncService.registrarSubstituicaoAtomicaSync({
        promotoresAlterados: substitutoAgenciaAlterada
          ? [antigoAtualizado, substitutoAlvo]
          : [antigoAtualizado],
        vinculosDispositivoCancelados: vinculosCancelados,
        vinculosIndustriaCriados: !vinculosIndSyncJaEnfileirado ? vinculosIndustriaCriados : [],
        vinculosIndustriaRemovidos: !vinculosIndSyncJaEnfileirado ? vinculosIndustriaRemovidos : [],
        movimentacoes: novasMovimentacoes,
      });

      this.syncDocToFirestore('auditoria', novaAuditoria.auditoriaId, novaAuditoria);
      this.syncDocToFirestore('auditoria_promotores', novaAuditoria.auditoriaId, novaAuditoria);

      notificarAlteracaoParaPacoteLocal(
        'PROMOTOR',
        `Substituição: ${antigo.nome} → ${substitutoAlvo.nome}`
      );
      this.notify();

      return {
        antigo: antigoAtualizado,
        substituto: substitutoAlvo,
        cnpjsTransferidos,
        cnpjsNovosNoDestino,
        cnpjsJaExistentesNoDestino,
      };
    } catch (err) {
      // Rollback completo em caso de erro (inclusive dos vínculos transferidos)
      if (rollbackVinculos) {
        try {
          await rollbackVinculos();
        } catch (rbErr) {
          console.warn('Falha ao reverter vínculos durante rollback de substituição:', rbErr);
        }
      }
      this._promotores = snapshotPromotores;
      this._vinculos = snapshotVinculos;
      this._historicoMovimentacoes = snapshotHistorico;
      this._auditorias = snapshotAuditorias;
      this.notify();
      throw err;
    }
  }

  public async atualizarPermissoes(
    promotorId: string,
    novasPermissoes: PermissoesPromotor
  ): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) {
      throw new Error('Promotor não encontrado.');
    }

    const agora = new Date().toISOString();
    const atualizado: Promotor = {
      ...promotor,
      permissoes: { ...novasPermissoes },
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, false);

    await this.registrarAuditoria({
      promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorNovo: 'Permissões atualizadas pelo Administrador',
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    notificarAlteracaoParaPacoteLocal('PROMOTOR', `Permissões atualizadas: ${atualizado.nome}`);
    this.notify();
    return atualizado;
  }

  public async bloquearPromotor(promotorId: string, motivo?: string): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    // Cancelar qualquer vínculo ativo
    await this.cancelarVinculoAtivoDePromotor(promotorId);

    const agora = new Date().toISOString();
    const atualizado: Promotor = {
      ...promotor,
      status: 'BLOQUEADO',
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, false);

    await this.registrarAuditoria({
      promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: promotor.status,
      valorNovo: `BLOQUEADO: ${motivo || 'Acesso suspenso pelo Administrador'}`,
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    notificarAlteracaoParaPacoteLocal('PROMOTOR', `Promotor bloqueado: ${atualizado.nome}`);
    this.notify();
    return atualizado;
  }

  public async desbloquearPromotor(promotorId: string): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    const novoStatus: StatusPromotor = promotor.dispositivoVinculado ? 'ATIVO' : 'PENDENTE_VINCULO';
    const agora = new Date().toISOString();

    const atualizado: Promotor = {
      ...promotor,
      status: novoStatus,
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, false);

    await this.registrarAuditoria({
      promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: 'BLOQUEADO',
      valorNovo: novoStatus,
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    notificarAlteracaoParaPacoteLocal('PROMOTOR', `Promotor desbloqueado: ${atualizado.nome}`);
    this.notify();
    return atualizado;
  }

  public async desvincularDispositivo(promotorId: string): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    // Cancelar qualquer vínculo pendente
    await this.cancelarVinculoAtivoDePromotor(promotorId);

    const dispositivoNome = promotor.dispositivoVinculado?.dispositivoNome || 'Dispositivo';
    const agora = new Date().toISOString();

    const atualizado: Promotor = {
      ...promotor,
      status: 'PENDENTE_VINCULO',
      dispositivoVinculado: null,
      dataVinculo: null,
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, false);

    await this.registrarAuditoria({
      promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: dispositivoNome,
      valorNovo: 'Dispositivo desvinculado. Status: PENDENTE_VINCULO',
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    notificarAlteracaoParaPacoteLocal('PROMOTOR', `Dispositivo desvinculado: ${atualizado.nome}`);
    this.notify();
    return atualizado;
  }

  // =========================================================================
  // GERAÇÃO E GESTÃO DE VÍNCULOS (CÓDIGO 6 DÍGITOS E QR CODE)
  // =========================================================================

  public async gerarVinculo(promotorId: string): Promise<VinculoPromotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) {
      throw new Error('Promotor não encontrado.');
    }
    if (promotor.status === 'BLOQUEADO') {
      throw new Error('Não é possível gerar vínculo para um promotor BLOQUEADO.');
    }
    if (promotor.status === 'INATIVO') {
      throw new Error('Não é possível gerar vínculo para um promotor INATIVO. Reative-o antes de gerar novo código.');
    }

    // Cancelar vínculos anteriores ainda pendentes
    await this.cancelarVinculoAtivoDePromotor(promotorId);

    // Gerar código aleatório de 6 dígitos numéricos (100000 a 999999)
    const codigo6 = Math.floor(100000 + Math.random() * 900000).toString();

    // Gerar token de vínculo seguro (linkTokenId, não expõe credenciais de banco ou senhas)
    const tokenVinculo = `link_${Date.now()}_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;

    const agora = new Date();
    const expiracao = new Date(agora.getTime() + 30 * 60 * 1000); // 30 minutos de validade

    const vinculoId = `vinc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const agoraIso = agora.toISOString();
    const novoVinculo: VinculoPromotor = {
      vinculoId,
      promotorId: promotor.promotorId,
      promotorNome: promotor.nome,
      agenciaNome: promotor.agenciaNome,
      filialId: promotor.filialId,
      filialNome: promotor.filialNome,
      setores: promotor.setores,
      setorId: promotor.setorId,
      setorNome: promotor.setorNome,
      permissoes: promotor.permissoes,
      codigoVinculo: codigo6,
      tokenVinculo,
      dataCriacao: agoraIso,
      dataExpiracao: expiracao.toISOString(),
      status: 'AGUARDANDO',
      dispositivoId: null,
      dispositivoNome: null,
      dataUtilizacao: null,
      atualizadoEm: agoraIso,
    };

    this._vinculos = [novoVinculo, ...this._vinculos];
    await dbPut(STORES.VINCULOS_PROMOTORES, novoVinculo);
    await comercialSyncService.registrarVinculoDispositivoSync(novoVinculo);

    await this.registrarAuditoria({
      promotorId: promotor.promotorId,
      promotorNome: promotor.nome,
      agenciaNome: promotor.agenciaNome,
      filialId: promotor.filialId,
      setores: promotor.setores,
      setorId: promotor.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorNovo: `Novo vínculo gerado (Código: ${codigo6}, validade 30 min)`,
      dataHora: agoraIso,
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
    return novoVinculo;
  }

  public async cancelarVinculo(vinculoId: string): Promise<void> {
    const vinculo = this._vinculos.find((v) => v.vinculoId === vinculoId);
    if (!vinculo) return;

    const agora = new Date().toISOString();
    const atualizado: VinculoPromotor = {
      ...vinculo,
      status: 'CANCELADO',
      atualizadoEm: agora,
    };

    this._vinculos = this._vinculos.map((v) => (v.vinculoId === vinculoId ? atualizado : v));
    await dbPut(STORES.VINCULOS_PROMOTORES, atualizado);
    await comercialSyncService.registrarVinculoDispositivoSync(atualizado);

    await this.registrarAuditoria({
      promotorId: vinculo.promotorId,
      promotorNome: vinculo.promotorNome,
      filialId: vinculo.filialId,
      setorId: vinculo.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: vinculo.status,
      valorNovo: 'Vínculo CANCELADO pelo Administrador',
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
  }

  private async cancelarVinculoAtivoDePromotor(promotorId: string): Promise<void> {
    const pendentes = this._vinculos.filter(
      (v) => v.promotorId === promotorId && v.status === 'AGUARDANDO'
    );
    const agora = new Date().toISOString();
    for (const v of pendentes) {
      v.status = 'CANCELADO';
      v.atualizadoEm = agora;
      await dbPut(STORES.VINCULOS_PROMOTORES, v);
      await comercialSyncService.registrarVinculoDispositivoSync(v);
    }
  }

  public verificarExpiracaoVinculos(): void {
    const agora = Date.now();
    const agoraIso = new Date(agora).toISOString();
    let mudou = false;

    for (const v of this._vinculos) {
      if (v.status === 'AGUARDANDO') {
        const expTime = new Date(v.dataExpiracao).getTime();
        if (agora > expTime) {
          v.status = 'EXPIRADO';
          v.atualizadoEm = agoraIso;
          mudou = true;
          dbPut(STORES.VINCULOS_PROMOTORES, v).catch(() => {});
          if (typeof window !== 'undefined' && authRoleService.isGerenciaAdminVerificadaNoServidor()) {
            void comercialSyncService.registrarVinculoDispositivoSync(v).catch(() => {});
          }
        }
      }
    }

    if (mudou) {
      this.notify();
    }
  }

  /**
   * Conclui o vínculo de um dispositivo (usado para testes ou futura resposta do App Promotor)
   */
  public async simularConclusaoVinculo(
    vinculoId: string,
    dispositivo: { id: string; nome: string }
  ): Promise<Promotor> {
    const vinculo = this._vinculos.find((v) => v.vinculoId === vinculoId);
    if (!vinculo) throw new Error('Vínculo não encontrado.');
    if (vinculo.status !== 'AGUARDANDO') {
      throw new Error(`Vínculo não está aguardando (Status atual: ${vinculo.status}).`);
    }

    const agora = new Date().toISOString();

    // 1. Atualiza o vínculo
    vinculo.status = 'UTILIZADO';
    vinculo.dispositivoId = dispositivo.id;
    vinculo.dispositivoNome = dispositivo.nome;
    vinculo.dataUtilizacao = agora;
    vinculo.atualizadoEm = agora;
    await dbPut(STORES.VINCULOS_PROMOTORES, vinculo);
    await comercialSyncService.registrarVinculoDispositivoSync(vinculo);

    // 2. Atualiza o promotor
    const promotor = this.getPromotorById(vinculo.promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    const dispositivoObj: DispositivoVinculado = {
      dispositivoId: dispositivo.id,
      dispositivoNome: dispositivo.nome,
      dataPrimeiroVinculo: agora,
      ultimoAcesso: agora,
    };

    const atualizado: Promotor = {
      ...promotor,
      status: 'ATIVO',
      dispositivoVinculado: dispositivoObj,
      dataVinculo: agora,
      ultimoAcesso: agora,
      ultimaSincronizacao: agora,
      atualizadoEm: agora,
      atualizadoPor: 'SISTEMA_VINCULO',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotor.promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    await comercialSyncService.registrarPromotorSync(atualizado, false);

    await this.registrarAuditoria({
      promotorId: atualizado.promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: 'PENDENTE_VINCULO',
      valorNovo: `ATIVO (Vinculado a: ${dispositivo.nome})`,
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
    return atualizado;
  }

  // =========================================================================
  // AUDITORIA DOS PROMOTORES
  // =========================================================================

  public async registrarAuditoria(
    registro: Omit<RegistroAuditoriaPromotor, 'auditoriaId'>
  ): Promise<RegistroAuditoriaPromotor> {
    const auditoriaId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const completo: RegistroAuditoriaPromotor = {
      auditoriaId,
      ...registro,
    };

    this._auditorias = [completo, ...this._auditorias];
    await dbPut(STORES.AUDITORIA_PROMOTORES, completo);
    this.syncDocToFirestore('auditoria', auditoriaId, completo);
    this.syncDocToFirestore('auditoria_promotores', auditoriaId, completo);

    return completo;
  }

  // =========================================================================
  // PREPARAÇÃO DE SINCRONIZAÇÃO FUTURA & VALIDAÇÃO DE PERMISSÕES NO BACKEND
  // =========================================================================

  /**
   * Validação de permissões no backend.
   * Garante que o Promotor só execute o que foi expressamente permitido no painel administrativo.
   */
  public validarPermissaoPromotor(
    promotorId: string,
    permissao: keyof PermissoesPromotor
  ): { permitido: boolean; motivo?: string } {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) {
      return { permitido: false, motivo: 'Promotor não encontrado.' };
    }
    if (promotor.status === 'BLOQUEADO') {
      return { permitido: false, motivo: 'Promotor está BLOQUEADO pelo Administrador.' };
    }
    if (promotor.status === 'INATIVO') {
      return { permitido: false, motivo: 'Promotor está INATIVO pelo Administrador.' };
    }
    if (promotor.status === 'DESVINCULADO') {
      return { permitido: false, motivo: 'Promotor está DESVINCULADO.' };
    }
    if (!promotor.permissoes[permissao]) {
      return { permitido: false, motivo: `Permissão negada: "${permissao}" está desabilitada para este promotor.` };
    }
    return { permitido: true };
  }

  /**
   * Processa uma operação de sincronização do promotor com IDEMPOTÊNCIA rigorosa.
   * Se a mesma operação chegar 2 vezes com o mesmo operationId, ignora a duplicidade.
   */
  public async processarOperacaoSync(operacao: OperacaoPromotorSync): Promise<{
    sucesso: boolean;
    status: 'PROCESSADO' | 'IGNORADO_DUPLICADO' | 'ERRO';
    mensagem: string;
  }> {
    // 1. Verificar Idempotência
    const jaExiste = this._operacoes.find((op) => op.operationId === operacao.operationId);
    if (jaExiste && jaExiste.processado) {
      return {
        sucesso: true,
        status: 'IGNORADO_DUPLICADO',
        mensagem: 'Operação já foi sincronizada anteriormente (Idempotente).',
      };
    }

    const promotor = this.getPromotorById(operacao.promotorId);
    if (!promotor) {
      const opFalha: OperacaoPromotorSync = {
        ...operacao,
        processado: false,
        status: 'ERRO',
        mensagemErro: 'Promotor não localizado.',
      };
      this._operacoes.push(opFalha);
      return { sucesso: false, status: 'ERRO', mensagem: 'Promotor não localizado.' };
    }

    const agora = new Date().toISOString();

    try {
      // 2. Validar permissões para a ação solicitada
      if (operacao.tipoAcao === 'CADASTROU_VENCIMENTO') {
        const check = this.validarPermissaoPromotor(promotor.promotorId, 'cadastrarVencimento');
        if (!check.permitido) throw new Error(check.motivo);

        // Bloqueio de duplicidade na base central: CÓDIGO INTERNO + DIG + DATA DE VENCIMENTO
        const payload = operacao.payload || {};
        const dup = productRepository.checkDuplicateVencimento({
          codigo_interno: payload.codigo_interno,
          digito: payload.digito,
          data_validade: payload.data_validade,
        });

        if (dup) {
          throw new Error('Produto com mesmo Código Interno, Dígito e Validade já existe cadastrado.');
        }

        // Adicionar vencimento com rastreabilidade
        await productRepository.addVencimento({
          codigo_interno: payload.codigo_interno,
          digito: payload.digito || '',
          codigo_exibicao: payload.codigo_exibicao || payload.codigo_interno,
          descricao_produto: payload.descricao_produto || '',
          embalagem: payload.embalagem || 'UN',
          data_validade: payload.data_validade,
          quantidade_total_unidades: Number(payload.quantidade_total_unidades) || 1,
          observacao: payload.observacao,
          criadoPorTipo: 'PROMOTOR',
          criadoPorId: promotor.promotorId,
          atualizadoPorTipo: 'PROMOTOR',
          atualizadoPorId: promotor.promotorId,
        });
      } else if (operacao.tipoAcao === 'ENVIOU_COMPRADOR') {
        const check = this.validarPermissaoPromotor(promotor.promotorId, 'enviarAoComprador');
        if (!check.permitido) throw new Error(check.motivo);

        const loteId = operacao.payload?.loteId;
        if (loteId) {
          // Atualiza o registro ORIGINAL sem criar cópias
          await productRepository.updateVencimento(loteId, {
            enviar_ao_comprador: true,
            status_customizado: 'ENVIAR_AO_COMPRADOR',
            atualizadoPorTipo: 'PROMOTOR',
            atualizadoPorId: promotor.promotorId,
          });
        }
      } else if (operacao.tipoAcao === 'ATUALIZOU_QUANTIDADE') {
        const check = this.validarPermissaoPromotor(promotor.promotorId, 'atualizarQuantidade');
        if (!check.permitido) throw new Error(check.motivo);

        const loteId = operacao.payload?.loteId;
        const novaQtd = Number(operacao.payload?.quantidade_total_unidades);
        if (loteId && !isNaN(novaQtd)) {
          await productRepository.updateVencimento(loteId, {
            quantidade_total_unidades: novaQtd,
            atualizadoPorTipo: 'PROMOTOR',
            atualizadoPorId: promotor.promotorId,
          });
        }
      }

      // 3. Atualizar Presença e Sincronização do Promotor
      promotor.ultimoAcesso = agora;
      promotor.ultimaSincronizacao = agora;
      promotor.atualizadoEm = agora;
      await dbPut(STORES.PROMOTORES, promotor);
      await comercialSyncService.registrarPromotorSync(promotor, false);

      // 4. Salvar operação como processada
      const opSucesso: OperacaoPromotorSync = {
        ...operacao,
        processado: true,
        processadoEm: agora,
        status: 'PROCESSADO',
      };
      this._operacoes.push(opSucesso);
      await dbPut(STORES.OPERACOES_PROMOTORES, opSucesso);
      this.syncDocToFirestore('operacoes_promotores', operacao.operationId, opSucesso);

      // 5. Registrar auditoria
      await this.registrarAuditoria({
        promotorId: promotor.promotorId,
        promotorNome: promotor.nome,
        filialId: promotor.filialId,
        setorId: promotor.setorId,
        tipoAcao: operacao.tipoAcao,
        codigoInterno: operacao.payload?.codigo_interno,
        digito: operacao.payload?.digito,
        descricao: operacao.payload?.descricao_produto,
        valorNovo: JSON.stringify(operacao.payload),
        dataHora: agora,
        statusSincronizacao: 'SINCRONIZADO',
        operationId: operacao.operationId,
      });

      this.notify();
      return { sucesso: true, status: 'PROCESSADO', mensagem: 'Operação sincronizada com sucesso.' };
    } catch (err: any) {
      const opErro: OperacaoPromotorSync = {
        ...operacao,
        processado: false,
        status: 'ERRO',
        mensagemErro: err.message,
      };
      this._operacoes.push(opErro);
      await dbPut(STORES.OPERACOES_PROMOTORES, opErro);
      this.syncDocToFirestore('operacoes_promotores', operacao.operationId, opErro);

      return { sucesso: false, status: 'ERRO', mensagem: err.message || 'Erro ao processar sincronização.' };
    }
  }

  // =========================================================================
  // ATUALIZAÇÃO POR PACOTE LOCAL ÚNICO (FILIAL 172)
  // =========================================================================

  /**
   * Substitui ou aplica promotores e vínculos de dispositivo a partir de um Pacote Local Único (.zip),
   * mantendo auditorias e histórico local preservados e sem duplicar registros.
   */
  public async substituirDadosComerciaisDePacote(params: {
    promotores: Promotor[];
    agencias?: AgenciaComercial[];
    historicoMovimentacoes?: HistoricoMovimentacaoComercial[];
    vinculosDispositivoPromotor?: VinculoPromotor[];
    preservarAlteracoesComerciaisLocais?: boolean;
  }): Promise<void> {
    if (params.preservarAlteracoesComerciaisLocais) {
      return;
    }

    const snapshot = {
      promotores: this._promotores,
      agencias: this._agencias,
      vinculos: this._vinculos,
      historicoMovimentacoes: this._historicoMovimentacoes,
    };

    try {
      const promotoresUnicosMap = new Map<string, Promotor>();
      for (const p of params.promotores) {
        if (p && p.promotorId) {
          promotoresUnicosMap.set(p.promotorId, normalizePromotor(p));
        }
      }
      const promotoresNorm = Array.from(promotoresUnicosMap.values());

      const agenciasMap = new Map<string, AgenciaComercial>();
      if (Array.isArray(params.agencias)) {
        for (const rawAg of params.agencias) {
          const normAg = normalizeAgencia(rawAg);
          if (normAg) {
            agenciasMap.set(normAg.nomeNormalizado, normAg);
          }
        }
      }

      let vinculosNorm = this._vinculos;
      if (params.vinculosDispositivoPromotor) {
        const vincMap = new Map<string, VinculoPromotor>();
        for (const v of params.vinculosDispositivoPromotor) {
          if (v && v.vinculoId) {
            vincMap.set(v.vinculoId, normalizeVinculo(v));
          }
        }
        vinculosNorm = Array.from(vincMap.values());
      }

      this._promotores = promotoresNorm;
      this._agencias = Array.from(agenciasMap.values()).sort((a, b) =>
        a.nome.localeCompare(b.nome, 'pt-BR')
      );
      this._vinculos = vinculosNorm;

      // Garantir que agências referenciadas pelos promotores também existam (retrocompatível com pacotes antigos)
      await this._sincronizarAgenciasDePromotoresExistentes();

      if (Array.isArray(params.historicoMovimentacoes) && params.historicoMovimentacoes.length > 0) {
        const histMap = new Map<string, HistoricoMovimentacaoComercial>();
        for (const item of [...params.historicoMovimentacoes, ...this._historicoMovimentacoes]) {
          if (item && item.id && !histMap.has(item.id)) {
            histMap.set(item.id, item);
          }
        }
        this._historicoMovimentacoes = Array.from(histMap.values())
          .sort((a, b) => (b.dataHora || '').localeCompare(a.dataHora || ''))
          .slice(0, 500);
      }

      await Promise.all([
        dbPutAll(STORES.PROMOTORES, this._promotores, true),
        dbPutAll(STORES.AGENCIAS, this._agencias, true),
        dbPutAll(STORES.VINCULOS_PROMOTORES, this._vinculos, true),
        dbSetMeta(META_KEY_HISTORICO_MOVIMENTACOES, this._historicoMovimentacoes),
      ]);

      this.notify();
    } catch (err) {
      this._promotores = snapshot.promotores;
      this._agencias = snapshot.agencias;
      this._vinculos = snapshot.vinculos;
      this._historicoMovimentacoes = snapshot.historicoMovimentacoes;
      throw err;
    }
  }

  // =========================================================================
  // HELPER INTERNO FIRESTORE
  // =========================================================================

  private syncDocToFirestore<T>(collectionName: string, docId: string, data: T) {
    if (!db || isFirestoreQuotaExceeded() || isModoAtualizacaoLocalAtivo()) return;

    const colecoesRestritasGerencia = new Set([
      'promotores',
      'agencias',
      'vinculosPromotor',
      'vinculos_promotores',
      'vinculos_promotor_industria',
      'vinculosPromotorAgencia',
      'vinculos_comerciais',
    ]);

    if (
      colecoesRestritasGerencia.has(collectionName) &&
      !authRoleService.isGerenciaAdminVerificadaNoServidor()
    ) {
      console.warn(
        `[PromotorService] Gravação na nuvem bloqueada para "${collectionName}/${docId}": requer autenticação Google verificada da Gerência (Filial 172).`
      );
      return;
    }

    try {
      const docRef = doc(db, collectionName, docId);
      setDoc(docRef, cleanForFirestore(data), { merge: true }).catch((err) => {
        if (isQuotaError(err)) {
          markQuotaExceeded(err?.message, detectQuotaResourceType(err));
        }
        console.warn(`Aviso ao persistir em Firestore (${collectionName}/${docId}):`, err.message);
      });
    } catch (err) {
      // Falha silenciosa se offline
    }
  }
}

export const promotorService = new PromotorService();
