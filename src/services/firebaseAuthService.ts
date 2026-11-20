/**
 * NUVEM V3 — SERVIÇO DE AUTENTICAÇÃO E AUTORIZAÇÃO CENTRALIZADA VIA FIREBASE
 * 
 * Atende às diretrizes de segurança da Filial 172:
 * 1. Autenticação primária via Firebase Auth (Google Sign-In popup ou credenciais autenticadas).
 * 2. Perfil e autorizações verificados estritamente no Firestore em /usuarios_autorizados/{uid}.
 * 3. Impedimento de auto-escalonamento de privilégios (o cliente não pode alterar seu próprio papel no servidor).
 * 4. Fallback controlado para operação offline/anônima com advertência e restrição de funções administrativas.
 */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  detectQuotaResourceType,
  ensureAuth,
  isFirestoreQuotaExceeded,
  isQuotaError,
  markQuotaExceeded,
} from './firebase';
import { authRoleService, PapelOperacional } from './authRoleService';

export interface PerfilServidorUsuario {
  uid: string;
  email: string | null;
  nome: string;
  matricula: string;
  filialId: string;
  papel: PapelOperacional;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm?: string;
}

export interface EstadoAuthServidor {
  isAutenticado: boolean;
  isAnonimo: boolean;
  isVerificadoServidor: boolean;
  uid: string | null;
  email: string | null;
  perfil: PerfilServidorUsuario | null;
  mensagem: string;
  carregando: boolean;
}

// E-mail do administrador padrão para bootstrap seguro da Filial 172 (exige emailVerified === true)
export const ADMIN_BOOTSTRAP_EMAIL = 'jottarms@gmail.com';

class FirebaseAuthService {
  private _estado: EstadoAuthServidor = {
    isAutenticado: false,
    isAnonimo: true,
    isVerificadoServidor: false,
    uid: null,
    email: null,
    perfil: null,
    mensagem: 'Inicializando autenticação...',
    carregando: true,
  };

  private _unsubDoc: Unsubscribe | null = null;
  private _listeners: Array<(estado: EstadoAuthServidor) => void> = [];

  constructor() {
    this._iniciarListenerAuth();
  }

  private _iniciarListenerAuth(): void {
    if (!auth) return;

    onAuthStateChanged(auth, async (user: User | null) => {
      if (this._unsubDoc) {
        this._unsubDoc();
        this._unsubDoc = null;
      }

      if (user) {
        const isAnon = user.isAnonymous;
        this._atualizarEstado({
          isAutenticado: true,
          isAnonimo: isAnon,
          uid: user.uid,
          email: user.email || null,
          carregando: true,
          mensagem: isAnon ? 'Conectado anonimamente' : `Autenticado como ${user.email}`,
        });

        if (!isAnon) {
          await this._carregarPerfilServidor(user);
        } else {
          authRoleService.aplicarSessaoServidorVerificada({
            autenticado: false,
            isVerificadoServidor: false,
            uid: user.uid,
          });
          this._atualizarEstado({
            isVerificadoServidor: false,
            perfil: null,
            carregando: false,
            mensagem: 'Sessão anônima ativa — permissões administrativas restritas',
          });
        }
      } else {
        authRoleService.aplicarSessaoServidorVerificada({
          autenticado: false,
          isVerificadoServidor: false,
        });
        this._atualizarEstado({
          isAutenticado: false,
          isAnonimo: true,
          isVerificadoServidor: false,
          uid: null,
          email: null,
          perfil: null,
          carregando: false,
          mensagem: 'Nenhum usuário autenticado no Firebase',
        });
      }
    });
  }

  private async _carregarPerfilServidor(user: User): Promise<void> {
    if (!db) {
      authRoleService.aplicarSessaoServidorVerificada({
        autenticado: false,
        isVerificadoServidor: false,
        uid: user.uid,
        email: user.email,
      });
      return;
    }

    if (isFirestoreQuotaExceeded()) {
      const isBootstrapEmail =
        Boolean(user.email) &&
        user.emailVerified === true &&
        user.email!.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();

      if (isBootstrapEmail) {
        const perfilBootstrap: PerfilServidorUsuario = {
          uid: user.uid,
          email: user.email,
          nome: user.displayName || 'Gerência Filial 172',
          matricula: '172001',
          filialId: '172',
          papel: 'GERENCIA_ADMIN',
          ativo: true,
          criadoEm: new Date().toISOString(),
        };
        authRoleService.aplicarSessaoServidorVerificada({
          autenticado: true,
          isVerificadoServidor: true,
          uid: user.uid,
          email: user.email,
          nome: perfilBootstrap.nome,
          matricula: perfilBootstrap.matricula,
          filialId: '172',
          papel: 'GERENCIA_ADMIN',
        });
        this._atualizarEstado({
          isVerificadoServidor: true,
          perfil: perfilBootstrap,
          carregando: false,
          mensagem: 'Gerência autorizada (cota Spark local — e-mail verificado Filial 172).',
        });
        return;
      }

      authRoleService.aplicarSessaoServidorVerificada({
        autenticado: true,
        isVerificadoServidor: false,
        uid: user.uid,
        email: user.email,
      });
      this._atualizarEstado({
        isVerificadoServidor: false,
        perfil: null,
        carregando: false,
        mensagem: 'Modo local ativo (cota diária Spark aguardando liberação).',
      });
      return;
    }

    try {
      const userDocRef = doc(db, 'usuarios_autorizados', user.uid);
      const snap = await getDoc(userDocRef);

      if (snap.exists()) {
        const perfil = snap.data() as PerfilServidorUsuario;
        const verificado =
          perfil.ativo === true &&
          perfil.filialId === '172' &&
          (perfil.papel !== 'GERENCIA_ADMIN' || user.emailVerified === true);

        this._atualizarEstado({
          isVerificadoServidor: verificado,
          perfil,
          carregando: false,
          mensagem: verificado
            ? `Autorizado na Filial ${perfil.filialId} (${perfil.papel})`
            : 'Usuário desativado, sem verificação de e-mail ou filial não autorizada',
        });

        authRoleService.aplicarSessaoServidorVerificada({
          autenticado: true,
          isVerificadoServidor: verificado,
          uid: user.uid,
          email: user.email,
          nome: perfil.nome || user.displayName || 'Usuário Autorizado',
          matricula: perfil.matricula || '172001',
          filialId: perfil.filialId || '172',
          papel: verificado ? perfil.papel : 'OPERADOR_LOJA',
        });

        // Escuta alterações em tempo real do documento no servidor (ex: revogação de permissão)
        this._unsubDoc = onSnapshot(
          userDocRef,
          (docSnap) => {
            if (docSnap.exists()) {
              const atualizado = docSnap.data() as PerfilServidorUsuario;
              const ativoVerificado =
                atualizado.ativo === true &&
                atualizado.filialId === '172' &&
                (atualizado.papel !== 'GERENCIA_ADMIN' || user.emailVerified === true);

              this._atualizarEstado({
                isVerificadoServidor: ativoVerificado,
                perfil: atualizado,
              });
              authRoleService.aplicarSessaoServidorVerificada({
                autenticado: true,
                isVerificadoServidor: ativoVerificado,
                uid: user.uid,
                email: user.email,
                nome: atualizado.nome || user.displayName || 'Usuário Autorizado',
                matricula: atualizado.matricula || '172001',
                filialId: atualizado.filialId || '172',
                papel: ativoVerificado ? atualizado.papel : 'OPERADOR_LOJA',
              });
            } else {
              this._atualizarEstado({
                isVerificadoServidor: false,
                perfil: null,
                mensagem: 'Perfil removido no servidor — privilégios administrativos revogados.',
              });
              authRoleService.aplicarSessaoServidorVerificada({
                autenticado: true,
                isVerificadoServidor: false,
                uid: user.uid,
                email: user.email,
                papel: 'OPERADOR_LOJA',
              });
            }
          },
          (err) => {
            if (isQuotaError(err)) {
              markQuotaExceeded(err?.message, detectQuotaResourceType(err));
              if (this._unsubDoc) {
                this._unsubDoc();
                this._unsubDoc = null;
              }
            }
          }
        );
      } else {
        // Sem autoprovisionamento no Firestore (/usuarios_autorizados é somente leitura no cliente Web).
        // Apenas a conta bootstrap oficial com emailVerified === true é reconhecida em memória para Gerência da Filial 172.
        const isMasterAdmin =
          Boolean(user.email) &&
          user.emailVerified === true &&
          user.email!.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();

        if (isMasterAdmin) {
          const perfilBootstrap: PerfilServidorUsuario = {
            uid: user.uid,
            email: user.email,
            nome: user.displayName || 'Administrador Central Filial 172',
            matricula: '172001',
            filialId: '172',
            papel: 'GERENCIA_ADMIN',
            ativo: true,
            criadoEm: new Date().toISOString(),
          };

          this._atualizarEstado({
            isVerificadoServidor: true,
            perfil: perfilBootstrap,
            carregando: false,
            mensagem: 'Gerência/Admin verificada na Filial 172 (conta bootstrap autorizada).',
          });

          authRoleService.aplicarSessaoServidorVerificada({
            autenticado: true,
            isVerificadoServidor: true,
            uid: user.uid,
            email: user.email,
            nome: perfilBootstrap.nome,
            matricula: perfilBootstrap.matricula,
            filialId: '172',
            papel: 'GERENCIA_ADMIN',
          });
        } else {
          this._atualizarEstado({
            isVerificadoServidor: false,
            perfil: null,
            carregando: false,
            mensagem:
              'Conta Google autenticada sem registro em /usuarios_autorizados. Permissões administrativas permanecem bloqueadas.',
          });

          authRoleService.aplicarSessaoServidorVerificada({
            autenticado: true,
            isVerificadoServidor: false,
            uid: user.uid,
            email: user.email,
            nome: user.displayName || 'Operador Loja',
            matricula: '172999',
            filialId: '172',
            papel: 'OPERADOR_LOJA',
          });
        }
      }
    } catch (err: any) {
      if (isQuotaError(err)) {
        markQuotaExceeded(err?.message, detectQuotaResourceType(err));
      }
      console.warn('[FirebaseAuthService] Falha ao verificar perfil no Firestore:', err?.message);
      authRoleService.aplicarSessaoServidorVerificada({
        autenticado: false,
        isVerificadoServidor: false,
        uid: user.uid,
        email: user.email,
      });
      this._atualizarEstado({
        isVerificadoServidor: false,
        perfil: null,
        carregando: false,
        mensagem: `Erro ao validar autorização no servidor: ${err?.message || 'Falha de leitura'}`,
      });
    }
  }

  public isGerenteAdminFilial172(): boolean {
    return (
      this._estado.isAutenticado &&
      !this._estado.isAnonimo &&
      this._estado.isVerificadoServidor &&
      this._estado.perfil?.ativo === true &&
      this._estado.perfil?.filialId === '172' &&
      this._estado.perfil?.papel === 'GERENCIA_ADMIN'
    );
  }

  public async loginComGoogle(): Promise<{ sucesso: boolean; mensagem: string }> {
    if (!auth) {
      return { sucesso: false, mensagem: 'Firebase Auth indisponível' };
    }

    try {
      this._atualizarEstado({ carregando: true, mensagem: 'Abrindo login com Google...' });
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);

      return {
        sucesso: true,
        mensagem: `Login realizado com sucesso: ${cred.user.email}`,
      };
    } catch (err: any) {
      this._atualizarEstado({ carregando: false, mensagem: `Erro no login: ${err?.message}` });
      return {
        sucesso: false,
        mensagem: `Falha no login com Google: ${err?.message || 'Operação cancelada'}`,
      };
    }
  }

  public async logout(): Promise<void> {
    if (this._unsubDoc) {
      this._unsubDoc();
      this._unsubDoc = null;
    }
    authRoleService.aplicarSessaoServidorVerificada({
      autenticado: false,
      isVerificadoServidor: false,
    });
    if (auth) {
      await firebaseSignOut(auth).catch(() => null);
    }
    // Retorna para sessão anônima padrão para não quebrar a persistência local do app
    await ensureAuth().catch(() => null);
  }

  public getEstado(): EstadoAuthServidor {
    return { ...this._estado };
  }

  public subscribe(cb: (estado: EstadoAuthServidor) => void): () => void {
    this._listeners.push(cb);
    cb(this.getEstado());
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  }

  private _atualizarEstado(patch: Partial<EstadoAuthServidor>): void {
    this._estado = { ...this._estado, ...patch };
    this._listeners.forEach((cb) => {
      try {
        cb(this.getEstado());
      } catch (e) {
        console.error(e);
      }
    });
  }
}

export const firebaseAuthService = new FirebaseAuthService();

