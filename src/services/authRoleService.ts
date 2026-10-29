/**
 * NUVEM V3 — SERVIÇO DE AUTENTICAÇÃO E AUTORIZAÇÃO POR FILIAL E PAPEL OPERACIONAL
 * 
 * Filial Alvo: 172 (Cascavel)
 * Papéis Disponíveis:
 *  - OPERADOR_LOJA: Consulta catálogo, cadastra vencimentos e atualiza quantidades locais.
 *                   NÃO pode excluir lotes nem publicar/comutar a BASE RUB.
 *  - CONFERENTE_ENCARREGADO: Todas as funções de operador + rebaixe de preço, envio a comprador
 *                            e exclusão lógica (soft-delete) obrigando justificativa (motivo >= 3 chars).
 *  - GERENCIA_ADMIN: Acesso irrestrito, publicação central da BASE RUB, comutação de ponteiro,
 *                    rollback e gestão de auditoria.
 */

export type PapelOperacional = 'OPERADOR_LOJA' | 'CONFERENTE_ENCARREGADO' | 'GERENCIA_ADMIN';

export interface UsuarioOperacional {
  id: string;
  nome: string;
  matricula: string;
  filialId: string;
  papel: PapelOperacional;
  tokenCustomizado?: string;
  ultimoLogin: string;
}

const STORAGE_KEY_AUTH = 'nuvem_v3_usuario_operacional_v1';

export const PAPEIS_INFO: Record<PapelOperacional, { rotulo: string; nivel: number; descricao: string }> = {
  OPERADOR_LOJA: {
    rotulo: 'Operador de Loja',
    nivel: 1,
    descricao: 'Cadastro e consulta de vencimentos e contagem de estoque físico.',
  },
  CONFERENTE_ENCARREGADO: {
    rotulo: 'Conferente / Encarregado',
    nivel: 2,
    descricao: 'Conferência de lotes, rebaixes, sinalização ao comprador e exclusão lógica fundamentada.',
  },
  GERENCIA_ADMIN: {
    rotulo: 'Gerência / Administrador',
    nivel: 3,
    descricao: 'Controle total da filial 172, publicação mestre da BASE RUB e parametrização de segurança.',
  },
};

const USUARIO_PADRAO: UsuarioOperacional = {
  id: 'usr-172-encarregado',
  nome: 'Encarregado Cascavel',
  matricula: '172001',
  filialId: '172',
  papel: 'CONFERENTE_ENCARREGADO',
  ultimoLogin: new Date().toISOString(),
};

class AuthRoleService {
  private _usuarioAtual: UsuarioOperacional;
  private _listeners: Array<(user: UsuarioOperacional) => void> = [];

  constructor() {
    this._usuarioAtual = this.carregarDoArmazenamento();
  }

  private carregarDoArmazenamento(): UsuarioOperacional {
    if (typeof window === 'undefined') return USUARIO_PADRAO;
    try {
      const data = localStorage.getItem(STORAGE_KEY_AUTH);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && parsed.filialId && parsed.papel) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[AuthRoleService] Erro ao carregar credenciais locais:', e);
    }
    return USUARIO_PADRAO;
  }

  private salvarNoArmazenamento(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(this._usuarioAtual));
    } catch (e) {
      console.warn('[AuthRoleService] Erro ao salvar credenciais:', e);
    }
  }

  public getUsuarioAtual(): UsuarioOperacional {
    return { ...this._usuarioAtual };
  }

  public getPapel(): PapelOperacional {
    return this._usuarioAtual.papel;
  }

  public getFilialId(): string {
    return this._usuarioAtual.filialId || '172';
  }

  public setUsuario(usuario: Partial<UsuarioOperacional>): void {
    this._usuarioAtual = {
      ...this._usuarioAtual,
      ...usuario,
      ultimoLogin: new Date().toISOString(),
    };
    this.salvarNoArmazenamento();
    this.notificar();
  }

  public alternarPapel(novoPapel: PapelOperacional, nome?: string): void {
    this._usuarioAtual.papel = novoPapel;
    if (nome) this._usuarioAtual.nome = nome;
    this._usuarioAtual.ultimoLogin = new Date().toISOString();
    this.salvarNoArmazenamento();
    this.notificar();
  }

  // Permissões
  public podeConsultar(): boolean {
    return true; // Todos os papéis
  }

  public podeCadastrarEditarLote(): boolean {
    return true; // Operador, Conferente, Gerência
  }

  public podeExcluirLote(motivo?: string): { permitido: boolean; motivoRecusa?: string } {
    if (this._usuarioAtual.papel === 'OPERADOR_LOJA') {
      return {
        permitido: false,
        motivoRecusa: 'Operadores de Loja não possuem permissão para exclusão de lotes. Solicite a um Conferente ou Encarregado.',
      };
    }
    if (!motivo || motivo.trim().length < 3) {
      return {
        permitido: false,
        motivoRecusa: 'É obrigatório informar uma justificativa válida com no mínimo 3 caracteres para efetuar o cancelamento do lote.',
      };
    }
    return { permitido: true };
  }

  public podePublicarRub(): { permitido: boolean; motivoRecusa?: string } {
    if (this._usuarioAtual.papel !== 'GERENCIA_ADMIN') {
      return {
        permitido: false,
        motivoRecusa: 'Apenas a Gerência/Administrador possui permissão para publicar e comutar novas versões centrais da BASE RUB.',
      };
    }
    return { permitido: true };
  }

  public podeExecutarRollback(): { permitido: boolean; motivoRecusa?: string } {
    return this.podePublicarRub();
  }

  public subscribe(listener: (user: UsuarioOperacional) => void): () => void {
    this._listeners.push(listener);
    listener({ ...this._usuarioAtual });
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  private notificar(): void {
    const copy = { ...this._usuarioAtual };
    this._listeners.forEach((l) => {
      try {
        l(copy);
      } catch (err) {
        console.error('[AuthRoleService] Erro no listener:', err);
      }
    });
  }
}

export const authRoleService = new AuthRoleService();
