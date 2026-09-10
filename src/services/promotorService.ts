/**
 * Promotor Service & Repository (Controle de Vencimentos - Fase 1)
 * 
 * Gerencia a estrutura administrativa de Promotores, Vínculos (QR/Código de 6 dígitos),
 * Permissões validadas no backend/serviço, Auditoria e Preparação para sincronização
 * futura idempotente com o App Promotor.
 */

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  Unsubscribe
} from 'firebase/firestore';
import {
  DispositivoVinculado,
  FILIAIS_DISPONIVEIS,
  OperacaoPromotorSync,
  PERMISSOES_PADRAO_PROMOTOR,
  PermissoesPromotor,
  Promotor,
  RegistroAuditoriaPromotor,
  SETORES_DISPONIVEIS,
  StatusPromotor,
  StatusVinculo,
  TipoAcaoAuditoria,
  VinculoPromotor
} from '../types';
import { cleanForFirestore } from './cloudSyncService';
import { dbGetAll, dbPut, dbPutAll, STORES } from './db';
import { db } from './firebase';
import { productRepository } from './productRepository';

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

  return {
    ...raw,
    nome: raw.nome || '',
    agenciaNome: (raw.agenciaNome || 'Agência não informada').trim(),
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
    agenciaNome: (raw.agenciaNome || 'Agência não informada').trim(),
    setores,
    setorId: setores[0],
    setorNome: setores.join(' • '),
  };
}

class PromotorService {
  private _promotores: Promotor[] = [];
  private _vinculos: VinculoPromotor[] = [];
  private _auditorias: RegistroAuditoriaPromotor[] = [];
  private _operacoes: OperacaoPromotorSync[] = [];
  private _listeners = new Set<PromotoresListener>();
  private _isInitialized = false;
  private _firestoreUnsubs: Unsubscribe[] = [];

  constructor() {
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

    try {
      // 1. Carregar do IndexedDB primeiro para resposta instantânea
      const [localPromotores, localVinculos, localAuditorias, localOperacoes] = await Promise.all([
        dbGetAll<Promotor>(STORES.PROMOTORES),
        dbGetAll<VinculoPromotor>(STORES.VINCULOS_PROMOTORES),
        dbGetAll<RegistroAuditoriaPromotor>(STORES.AUDITORIA_PROMOTORES),
        dbGetAll<OperacaoPromotorSync>(STORES.OPERACOES_PROMOTORES),
      ]);

      if (localPromotores.length > 0) this._promotores = localPromotores.map(normalizePromotor);
      if (localVinculos.length > 0) this._vinculos = localVinculos.map(normalizeVinculo);
      if (localAuditorias.length > 0) this._auditorias = localAuditorias;
      if (localOperacoes.length > 0) this._operacoes = localOperacoes;

      this.verificarExpiracaoVinculos();
      this.notify();

      // 2. Conectar com Firestore em tempo real
      this.initFirestoreSync();

      this._isInitialized = true;
    } catch (err) {
      console.warn('Erro ao inicializar PromotorService via IndexedDB:', err);
    }
  }

  private initFirestoreSync() {
    if (!db) return;

    try {
      // Promotores listener
      const unsubPromotores = onSnapshot(
        collection(db, 'promotores'),
        (snapshot) => {
          if (!snapshot.empty) {
            const remote: Promotor[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data() as Promotor;
              if (data && data.promotorId) {
                remote.push(normalizePromotor(data));
              }
            });
            if (remote.length > 0) {
              this._promotores = remote;
              dbPutAll(STORES.PROMOTORES, remote, true).catch(() => {});
              this.notify();
            }
          }
        },
        (err) => console.warn('Aviso Firestore promotores onSnapshot:', err.message)
      );
      this._firestoreUnsubs.push(unsubPromotores);

      // Vínculos listener
      const unsubVinculos = onSnapshot(
        collection(db, 'vinculos_promotores'),
        (snapshot) => {
          if (!snapshot.empty) {
            const remote: VinculoPromotor[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data() as VinculoPromotor;
              if (data && data.vinculoId) {
                remote.push(normalizeVinculo(data));
              }
            });
            if (remote.length > 0) {
              this._vinculos = remote;
              dbPutAll(STORES.VINCULOS_PROMOTORES, remote, true).catch(() => {});
              this.notify();
            }
          }
        },
        (err) => console.warn('Aviso Firestore vinculos onSnapshot:', err.message)
      );
      this._firestoreUnsubs.push(unsubVinculos);

      // Auditorias listener
      const unsubAuditoria = onSnapshot(
        collection(db, 'auditoria_promotores'),
        (snapshot) => {
          if (!snapshot.empty) {
            const remote: RegistroAuditoriaPromotor[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data() as RegistroAuditoriaPromotor;
              if (data && data.auditoriaId) {
                remote.push(data);
              }
            });
            if (remote.length > 0) {
              // Ordenar por dataHora decrescente
              remote.sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
              this._auditorias = remote;
              dbPutAll(STORES.AUDITORIA_PROMOTORES, remote, true).catch(() => {});
              this.notify();
            }
          }
        },
        (err) => console.warn('Aviso Firestore auditoria onSnapshot:', err.message)
      );
      this._firestoreUnsubs.push(unsubAuditoria);

      // Operações sync listener
      const unsubOperacoes = onSnapshot(
        collection(db, 'operacoes_promotores'),
        (snapshot) => {
          if (!snapshot.empty) {
            const remote: OperacaoPromotorSync[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data() as OperacaoPromotorSync;
              if (data && data.operationId) {
                remote.push(data);
              }
            });
            if (remote.length > 0) {
              this._operacoes = remote;
              dbPutAll(STORES.OPERACOES_PROMOTORES, remote, true).catch(() => {});
              this.notify();
            }
          }
        },
        (err) => console.warn('Aviso Firestore operacoes onSnapshot:', err.message)
      );
      this._firestoreUnsubs.push(unsubOperacoes);
    } catch (err) {
      console.warn('Erro ao configurar Firestore listeners de promotores:', err);
    }
  }

  // =========================================================================
  // CONSULTAS E INDICADORES
  // =========================================================================

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
    if (promotor.status === 'BLOQUEADO' || promotor.status === 'DESVINCULADO') {
      return false;
    }
    if (!promotor.ultimoAcesso) {
      return false;
    }
    const diffMs = Date.now() - new Date(promotor.ultimoAcesso).getTime();
    return diffMs <= 15 * 60 * 1000; // 15 minutos
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
    agenciaNome: string;
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

    const agenciaLimpa = (dados.agenciaNome || '').trim();
    if (!agenciaLimpa) {
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
      agenciaNome: agenciaLimpa,
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
      criadoPor: 'SISTEMA_PRINCIPAL',
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    // Salva localmente
    this._promotores = [novoPromotor, ...this._promotores];
    await dbPut(STORES.PROMOTORES, novoPromotor);

    // Salva no Firestore
    this.syncDocToFirestore('promotores', promotorId, novoPromotor);

    // Registra Auditoria
    await this.registrarAuditoria({
      promotorId,
      promotorNome: novoPromotor.nome,
      agenciaNome: novoPromotor.agenciaNome,
      filialId: novoPromotor.filialId,
      setores: novoPromotor.setores,
      setorId: novoPromotor.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: 'NENHUM',
      valorNovo: `Promotor cadastrado (${agenciaLimpa} - Setores: ${setorNomeExibicao}) status: PENDENTE_VINCULO`,
      dataHora: agora,
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
    return novoPromotor;
  }

  public async atualizarPromotor(
    promotorId: string,
    dados: Partial<{
      nome: string;
      agenciaNome: string;
      matricula: string;
      setores: string[];
    }>
  ): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    const novoNome = dados.nome !== undefined ? dados.nome.trim() : promotor.nome;
    if (!novoNome) throw new Error('O nome do promotor é obrigatório.');

    const novaAgencia = dados.agenciaNome !== undefined ? dados.agenciaNome.trim() : promotor.agenciaNome;
    if (!novaAgencia) throw new Error('A Agência / Empresa é obrigatória.');

    let novosSetores = promotor.setores;
    if (dados.setores !== undefined) {
      novosSetores = dados.setores.filter((s) => s === 'FRIOS' || s === 'LOJA');
      if (novosSetores.length === 0) {
        throw new Error('Selecione pelo menos um setor de atuação.');
      }
    }

    const atualizado: Promotor = {
      ...promotor,
      nome: novoNome,
      agenciaNome: novaAgencia,
      matricula: dados.matricula !== undefined ? (dados.matricula.trim() || undefined) : promotor.matricula,
      setores: novosSetores,
      setorId: novosSetores[0],
      setorNome: novosSetores.join(' • '),
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    this.syncDocToFirestore('promotores', promotorId, atualizado);

    await this.registrarAuditoria({
      promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorNovo: `Dados atualizados (${novaAgencia} - Setores: ${atualizado.setorNome})`,
      dataHora: new Date().toISOString(),
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
    return atualizado;
  }

  public async atualizarPermissoes(
    promotorId: string,
    novasPermissoes: PermissoesPromotor
  ): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) {
      throw new Error('Promotor não encontrado.');
    }

    const atualizado: Promotor = {
      ...promotor,
      permissoes: { ...novasPermissoes },
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    this.syncDocToFirestore('promotores', promotorId, atualizado);

    await this.registrarAuditoria({
      promotorId,
      promotorNome: atualizado.nome,
      agenciaNome: atualizado.agenciaNome,
      filialId: atualizado.filialId,
      setores: atualizado.setores,
      setorId: atualizado.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorNovo: 'Permissões atualizadas pelo Administrador',
      dataHora: new Date().toISOString(),
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
    return atualizado;
  }

  public async bloquearPromotor(promotorId: string, motivo?: string): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    // Cancelar qualquer vínculo ativo
    await this.cancelarVinculoAtivoDePromotor(promotorId);

    const atualizado: Promotor = {
      ...promotor,
      status: 'BLOQUEADO',
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    this.syncDocToFirestore('promotores', promotorId, atualizado);

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
      dataHora: new Date().toISOString(),
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
    return atualizado;
  }

  public async desbloquearPromotor(promotorId: string): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    const novoStatus: StatusPromotor = promotor.dispositivoVinculado ? 'ATIVO' : 'PENDENTE_VINCULO';

    const atualizado: Promotor = {
      ...promotor,
      status: novoStatus,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    this.syncDocToFirestore('promotores', promotorId, atualizado);

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
      dataHora: new Date().toISOString(),
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
    return atualizado;
  }

  public async desvincularDispositivo(promotorId: string): Promise<Promotor> {
    const promotor = this.getPromotorById(promotorId);
    if (!promotor) throw new Error('Promotor não encontrado.');

    // Cancelar qualquer vínculo pendente
    await this.cancelarVinculoAtivoDePromotor(promotorId);

    const dispositivoNome = promotor.dispositivoVinculado?.dispositivoNome || 'Dispositivo';

    const atualizado: Promotor = {
      ...promotor,
      status: 'PENDENTE_VINCULO',
      dispositivoVinculado: null,
      dataVinculo: null,
      atualizadoPor: 'SISTEMA_PRINCIPAL',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    this.syncDocToFirestore('promotores', promotorId, atualizado);

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
      dataHora: new Date().toISOString(),
      statusSincronizacao: 'SINCRONIZADO',
    });

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

    // Cancelar vínculos anteriores ainda pendentes
    await this.cancelarVinculoAtivoDePromotor(promotorId);

    // Gerar código aleatório de 6 dígitos numéricos (100000 a 999999)
    const codigo6 = Math.floor(100000 + Math.random() * 900000).toString();

    // Gerar token de vínculo seguro (linkTokenId, não expõe credenciais de banco ou senhas)
    const tokenVinculo = `link_${Date.now()}_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;

    const agora = new Date();
    const expiracao = new Date(agora.getTime() + 30 * 60 * 1000); // 30 minutos de validade

    const vinculoId = `vinc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

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
      dataCriacao: agora.toISOString(),
      dataExpiracao: expiracao.toISOString(),
      status: 'AGUARDANDO',
      dispositivoId: null,
      dispositivoNome: null,
      dataUtilizacao: null,
    };

    this._vinculos = [novoVinculo, ...this._vinculos];
    await dbPut(STORES.VINCULOS_PROMOTORES, novoVinculo);
    this.syncDocToFirestore('vinculos_promotores', vinculoId, novoVinculo);

    await this.registrarAuditoria({
      promotorId: promotor.promotorId,
      promotorNome: promotor.nome,
      agenciaNome: promotor.agenciaNome,
      filialId: promotor.filialId,
      setores: promotor.setores,
      setorId: promotor.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorNovo: `Novo vínculo gerado (Código: ${codigo6}, validade 30 min)`,
      dataHora: agora.toISOString(),
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
    return novoVinculo;
  }

  public async cancelarVinculo(vinculoId: string): Promise<void> {
    const vinculo = this._vinculos.find((v) => v.vinculoId === vinculoId);
    if (!vinculo) return;

    const atualizado: VinculoPromotor = {
      ...vinculo,
      status: 'CANCELADO',
    };

    this._vinculos = this._vinculos.map((v) => (v.vinculoId === vinculoId ? atualizado : v));
    await dbPut(STORES.VINCULOS_PROMOTORES, atualizado);
    this.syncDocToFirestore('vinculos_promotores', vinculoId, atualizado);

    await this.registrarAuditoria({
      promotorId: vinculo.promotorId,
      promotorNome: vinculo.promotorNome,
      filialId: vinculo.filialId,
      setorId: vinculo.setorId,
      tipoAcao: 'SINCRONIZOU_ALTERACAO',
      valorAnterior: vinculo.status,
      valorNovo: 'Vínculo CANCELADO pelo Administrador',
      dataHora: new Date().toISOString(),
      statusSincronizacao: 'SINCRONIZADO',
    });

    this.notify();
  }

  private async cancelarVinculoAtivoDePromotor(promotorId: string): Promise<void> {
    const pendentes = this._vinculos.filter(
      (v) => v.promotorId === promotorId && v.status === 'AGUARDANDO'
    );
    for (const v of pendentes) {
      v.status = 'CANCELADO';
      await dbPut(STORES.VINCULOS_PROMOTORES, v);
      this.syncDocToFirestore('vinculos_promotores', v.vinculoId, v);
    }
  }

  public verificarExpiracaoVinculos(): void {
    const agora = Date.now();
    let mudou = false;

    for (const v of this._vinculos) {
      if (v.status === 'AGUARDANDO') {
        const expTime = new Date(v.dataExpiracao).getTime();
        if (agora > expTime) {
          v.status = 'EXPIRADO';
          mudou = true;
          dbPut(STORES.VINCULOS_PROMOTORES, v).catch(() => {});
          this.syncDocToFirestore('vinculos_promotores', v.vinculoId, v);
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
    await dbPut(STORES.VINCULOS_PROMOTORES, vinculo);
    this.syncDocToFirestore('vinculos_promotores', vinculo.vinculoId, vinculo);

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
      atualizadoPor: 'SISTEMA_VINCULO',
    };

    this._promotores = this._promotores.map((p) => (p.promotorId === promotor.promotorId ? atualizado : p));
    await dbPut(STORES.PROMOTORES, atualizado);
    this.syncDocToFirestore('promotores', atualizado.promotorId, atualizado);

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
      await dbPut(STORES.PROMOTORES, promotor);
      this.syncDocToFirestore('promotores', promotor.promotorId, promotor);

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
  // HELPER INTERNO FIRESTORE
  // =========================================================================

  private syncDocToFirestore<T>(collectionName: string, docId: string, data: T) {
    if (!db) return;
    try {
      const docRef = doc(db, collectionName, docId);
      setDoc(docRef, cleanForFirestore(data), { merge: true }).catch((err) => {
        console.warn(`Aviso ao persistir em Firestore (${collectionName}/${docId}):`, err.message);
      });
    } catch (err) {
      // Falha silenciosa se offline
    }
  }
}

export const promotorService = new PromotorService();
