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
  setDoc,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { auth, db, ensureAuth } from './firebase';
import { authRoleService, PapelOperacional, UsuarioOperacional } from './authRoleService';

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

// E-mail do administrador padrão para bootstrap seguro da Filial 172
const ADMIN_BOOTSTRAP_EMAIL = 'jottarms@gmail.com';

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
          await this._carregarOuProvisionarPerfilServidor(user);
        } else {
          this._atualizarEstado({
            isVerificadoServidor: false,
            perfil: null,
            carregando: false,
            mensagem: 'Sessão anônima ativa — permissões administrativas restritas',
          });
        }
      } else {
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

  private async _carregarOuProvisionarPerfilServidor(user: User): Promise<void> {
    if (!db) return;

    try {
      const userDocRef = doc(db, 'usuarios_autorizados', user.uid);
      const snap = await getDoc(userDocRef);

      if (snap.exists()) {
        const perfil = snap.data() as PerfilServidorUsuario;
        this._atualizarEstado({
          isVerificadoServidor: perfil.ativo === true,
          perfil,
          carregando: false,
          mensagem: perfil.ativo
            ? `Autorizado na Filial ${perfil.filialId} (${perfil.papel})`
            : 'Usuário desativado pelo administrador',
        });

        // Sincroniza com o serviço de papéis operacional local
        authRoleService.setUsuario({
          id: user.uid,
          nome: perfil.nome || user.displayName || 'Usuário Autorizado',
          matricula: perfil.matricula || '172001',
          filialId: perfil.filialId || '172',
          papel: perfil.papel,
        });

        // Escuta alterações em tempo real do documento no servidor (ex: revogação de permissão)
        this._unsubDoc = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            const atualizado = docSnap.data() as PerfilServidorUsuario;
            this._atualizarEstado({
              isVerificadoServidor: atualizado.ativo === true,
              perfil: atualizado,
            });
            authRoleService.setUsuario({ papel: atualizado.papel, filialId: atualizado.filialId });
          }
        });
      } else {
        // Se o usuário é o administrador inicial autorizado (jottarms@gmail.com), cria o registro mestre da Filial 172
        const isMasterAdmin = user.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();

        const novoPerfil: PerfilServidorUsuario = {
          uid: user.uid,
          email: user.email,
          nome: user.displayName || (isMasterAdmin ? 'Administrador Central' : 'Operador Loja'),
          matricula: isMasterAdmin ? '172001' : '172999',
          filialId: '172',
          papel: isMasterAdmin ? 'GERENCIA_ADMIN' : 'OPERADOR_LOJA',
          ativo: true,
          criadoEm: new Date().toISOString(),
        };

        await setDoc(userDocRef, novoPerfil);

        this._atualizarEstado({
          isVerificadoServidor: true,
          perfil: novoPerfil,
          carregando: false,
          mensagem: `Perfil criado e autorizado para a Filial 172 (${novoPerfil.papel})`,
        });

        authRoleService.setUsuario({
          id: user.uid,
          nome: novoPerfil.nome,
          matricula: novoPerfil.matricula,
          filialId: novoPerfil.filialId,
          papel: novoPerfil.papel,
        });
      }
    } catch (err: any) {
      console.warn('[FirebaseAuthService] Falha ao verificar perfil no Firestore:', err?.message);
      this._atualizarEstado({
        carregando: false,
        mensagem: `Erro ao validar autorização no servidor: ${err?.message || 'Falha de leitura'}`,
      });
    }
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
