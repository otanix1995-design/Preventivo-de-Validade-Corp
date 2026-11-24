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
    descricao: 'Controle total da filial 172, publicação mestre da BASE RUB e parametrização de segurança (exige login Google verificado).',
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

export interface SessaoServidorVerificadaInput {
  autenticado: boolean;
  isVerificadoServidor: boolean;
  uid?: string | null;
  email?: string | null;
  nome?: string;
  matricula?: string;
  filialId?: string;
  papel?: PapelOperacional;
}

export class AuthRoleService {
  private _usuarioAtual: UsuarioOperacional;
  private _listeners: Array<(user: UsuarioOperacional) => void> = [];
  private _sessaoServidor: {
    verificado: boolean;
    autenticado: boolean;
    uid: string | null;
    email: string | null;
    filialId: string;
    papelServidor: PapelOperacional | null;
  } = {
    verificado: false,
    autenticado: false,
    uid: null,
    email: null,
    filialId: '172',
    papelServidor: null,
  };

  constructor() {
    this._usuarioAtual = this.carregarDoArmazenamento();
  }

  private carregarDoArmazenamento(): UsuarioOperacional {
    if (typeof window === 'undefined') return { ...USUARIO_PADRAO };
    try {
      const data = localStorage.getItem(STORAGE_KEY_AUTH);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && parsed.filialId && parsed.papel) {
          // Blindagem Etapa 1: NUNCA confiar em GERENCIA_ADMIN persistido em localStorage sem verificação do servidor
          const papelSeguro: PapelOperacional =
            parsed.papel === 'GERENCIA_ADMIN' ? 'CONFERENTE_ENCARREGADO' : parsed.papel;
          const saneado: UsuarioOperacional = {
            ...USUARIO_PADRAO,
            ...parsed,
            filialId: String(parsed.filialId || '172') === '172' ? '172' : '172',
            papel:
              papelSeguro === 'OPERADOR_LOJA' || papelSeguro === 'CONFERENTE_ENCARREGADO'
                ? papelSeguro
                : 'CONFERENTE_ENCARREGADO',
          };
          if (parsed.papel === 'GERENCIA_ADMIN') {
            localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(saneado));
          }
          return saneado;
        }
      }
    } catch (e) {
      console.warn('[AuthRoleService] Erro ao carregar credenciais locais:', e);
    }
    return { ...USUARIO_PADRAO };
  }

  private salvarNoArmazenamento(): void {
    if (typeof window === 'undefined') return;
    try {
      // Nunca persistir papel GERENCIA_ADMIN no localStorage para impedir escalonamento offline/XSS
      const paraSalvar: UsuarioOperacional = {
        ...this._usuarioAtual,
        papel:
          this._usuarioAtual.papel === 'GERENCIA_ADMIN'
            ? 'CONFERENTE_ENCARREGADO'
            : this._usuarioAtual.papel,
      };
      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(paraSalvar));
    } catch (e) {
      console.warn('[AuthRoleService] Erro ao salvar credenciais:', e);
    }
  }

  public isGerenciaAdminVerificadaNoServidor(): boolean {
    return (
      this._sessaoServidor.autenticado &&
      this._sessaoServidor.verificado &&
      this._sessaoServidor.papelServidor === 'GERENCIA_ADMIN' &&
      this._sessaoServidor.filialId === '172' &&
      this._usuarioAtual.papel === 'GERENCIA_ADMIN'
    );
  }

  public getEmailServidorVerificado(): string | null {
    return this._sessaoServidor.autenticado && this._sessaoServidor.verificado
      ? this._sessaoServidor.email
      : null;
  }

  /**
   * Chamado exclusivamente pelo FirebaseAuthService após validar o token e o perfil real no servidor.
   */
  public aplicarSessaoServidorVerificada(input: SessaoServidorVerificadaInput): void {
    const filial = input.filialId || '172';
    const gerenciaValida =
      input.autenticado === true &&
      input.isVerificadoServidor === true &&
      input.papel === 'GERENCIA_ADMIN' &&
      filial === '172';

    this._sessaoServidor = {
      autenticado: input.autenticado,
      verificado: input.isVerificadoServidor,
      uid: input.uid || null,
      email: input.email || null,
      filialId: filial,
      papelServidor: input.isVerificadoServidor && input.papel ? input.papel : null,
    };

    if (gerenciaValida) {
      this._usuarioAtual = {
        ...this._usuarioAtual,
        id: input.uid || this._usuarioAtual.id,
        nome: input.nome || this._usuarioAtual.nome,
        matricula: input.matricula || this._usuarioAtual.matricula,
        filialId: '172',
        papel: 'GERENCIA_ADMIN',
        ultimoLogin: new Date().toISOString(),
      };
    } else {
      const papelDowngraded: PapelOperacional =
        input.isVerificadoServidor &&
        (input.papel === 'OPERADOR_LOJA' || input.papel === 'CONFERENTE_ENCARREGADO')
          ? input.papel
          : this._usuarioAtual.papel === 'GERENCIA_ADMIN'
            ? 'CONFERENTE_ENCARREGADO'
            : this._usuarioAtual.papel;

      this._usuarioAtual = {
        ...this._usuarioAtual,
        id: input.uid || USUARIO_PADRAO.id,
        nome: input.nome || (this._usuarioAtual.papel === 'GERENCIA_ADMIN' ? USUARIO_PADRAO.nome : this._usuarioAtual.nome),
        matricula: input.matricula || USUARIO_PADRAO.matricula,
        filialId: '172',
        papel: papelDowngraded,
        ultimoLogin: new Date().toISOString(),
      };
    }

    this.salvarNoArmazenamento();
    this.notificar();
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
    const papelSolicitado = usuario.papel;
    if (
      papelSolicitado === 'GERENCIA_ADMIN' &&
      !(
        this._sessaoServidor.autenticado &&
        this._sessaoServidor.verificado &&
        this._sessaoServidor.papelServidor === 'GERENCIA_ADMIN' &&
        this._sessaoServidor.filialId === '172'
      )
    ) {
      console.warn(
        '[AuthRoleService] Tentativa bloqueada de definir GERENCIA_ADMIN localmente sem verificação do servidor.'
      );
      const { papel: _ignored, filialId: _ignoredFilial, ...resto } = usuario;
      this._usuarioAtual = {
        ...this._usuarioAtual,
        ...resto,
        filialId: '172',
        ultimoLogin: new Date().toISOString(),
      };
    } else {
      this._usuarioAtual = {
        ...this._usuarioAtual,
        ...usuario,
        filialId: '172',
        ultimoLogin: new Date().toISOString(),
      };
    }
    this.salvarNoArmazenamento();
    this.notificar();
  }

  public alternarPapel(novoPapel: PapelOperacional, nome?: string): { alterado: boolean; motivo?: string } {
    if (novoPapel === 'GERENCIA_ADMIN') {
      const temAdminNoServidor =
        this._sessaoServidor.autenticado &&
        this._sessaoServidor.verificado &&
        this._sessaoServidor.papelServidor === 'GERENCIA_ADMIN' &&
        this._sessaoServidor.filialId === '172';

      if (!temAdminNoServidor) {
        console.warn(
          '[AuthRoleService] Escalonamento local para GERENCIA_ADMIN bloqueado. Autentique-se com conta Google autorizada da gerência.'
        );
        return {
          alterado: false,
          motivo:
            'Acesso à Gerência/Administrador exige login Google autorizado e verificado no servidor Firebase.',
        };
      }
    }

    this._usuarioAtual.papel = novoPapel;
    if (nome) this._usuarioAtual.nome = nome;
    this._usuarioAtual.ultimoLogin = new Date().toISOString();
    this.salvarNoArmazenamento();
    this.notificar();
    return { alterado: true };
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
    if (!this.isGerenciaAdminVerificadaNoServidor()) {
      return {
        permitido: false,
        motivoRecusa:
          'Apenas a Gerência/Administrador autenticada com conta Google verificada no servidor (Filial 172) possui permissão para publicar e comutar novas versões centrais.',
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

