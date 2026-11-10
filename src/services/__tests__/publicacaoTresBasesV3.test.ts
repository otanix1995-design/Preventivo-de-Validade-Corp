/**
 * Testes Automatizados — Correção Definitiva do Fluxo de Publicação das Três Bases (Filial 172)
 *
 * Cobre integralmente os 7 cenários obrigatórios:
 * 1. Timeout e ausência de travamento indefinido (BASE RUB, SPCOI007 e SAEOU060 + bloqueio de fila pendente).
 * 2. Controle de concorrência de chunks (<= 2 gravações simultâneas).
 * 3. Falha de rede durante a publicação sem corrupção local ou substituição do ponteiro ativo.
 * 4. Recusa por autorização (OPERADOR_LOJA / CONFERENTE_ENCARREGADO bloqueados; GERENCIA_ADMIN permitido).
 * 5. Concorrência entre publicações (bloqueio intra-instância e conflito CAS entre terminais).
 * 6. Prevenção de falso sucesso na UI e na confirmação pós-transação do servidor.
 * 7. Integridade de chunks no servidor e ausência de sincronização legada concorrente (/catalogo_chunks / saeou060_chunks)
 *    mantendo vínculos EAN e vencimentos independentes.
 */

import {
  PublishAdapter,
  PublishIntegrityError,
  ResultadoPublicacaoBase,
  validarIntegridadeVersaoNoServidor,
} from '../firestorePublishGuard';
import { RubSyncService } from '../rubSyncService';
import { SpcoiSyncService } from '../spcoiSyncService';
import { SaeouSyncService } from '../saeouSyncService';
import { resolverEstadoPublicacaoImportacao } from '../importacaoResultadoHelper';
import { productRepository } from '../productRepository';
import { cloudSyncService } from '../cloudSyncService';
import {
  FornecedorSPCOI007,
  Industria,
  MetadadosBase,
  ProdutoSMG,
  RegistroSaeou060,
  VinculoEan,
} from '../../types';
import { UsuarioOperacional } from '../authRoleService';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${msg}`);
  }
}

interface FakeDocRef {
  path: string;
  id: string;
}

interface FakeCollectionRef {
  path: string;
}

class InMemoryFirestoreFake {
  public docs = new Map<string, any>();
  public setDocCalls: Array<{ path: string; data: any }> = [];
  public getDocFromServerCalls: string[] = [];
  public txnCalls = 0;
  public activeWrites = 0;
  public maxActiveWrites = 0;

  public onSetDoc?: (path: string, data: any) => Promise<void> | void;
  public onGetDoc?: (path: string) => any;
  public onRunTransaction?: (txnUpdate: () => Promise<any>) => Promise<any>;

  public resetCounters(): void {
    this.setDocCalls = [];
    this.getDocFromServerCalls = [];
    this.txnCalls = 0;
    this.activeWrites = 0;
    this.maxActiveWrites = 0;
  }

  public createAdapter(): PublishAdapter {
    const self = this;
    const fakeDb = {} as any;

    return {
      db: fakeDb,
      ensureAuth: async () => ({ uid: 'test-uid' }),
      isFirestoreQuotaExceeded: () => false,
      markQuotaExceeded: () => {},
      isQuotaError: (err: unknown) => {
        const msg = String((err as any)?.message || '').toLowerCase();
        return msg.includes('quota') || msg.includes('resource-exhausted');
      },
      doc: (_db, ...segments: string[]): FakeDocRef => {
        const path = segments.join('/');
        return { path, id: segments[segments.length - 1] };
      },
      collection: (_db, ...segments: string[]): FakeCollectionRef => {
        return { path: segments.join('/') };
      },
      setDoc: async (ref: FakeDocRef, data: any) => {
        self.activeWrites++;
        if (self.activeWrites > self.maxActiveWrites) {
          self.maxActiveWrites = self.activeWrites;
        }
        try {
          self.setDocCalls.push({ path: ref.path, data });
          if (self.onSetDoc) {
            await self.onSetDoc(ref.path, data);
          }
          self.docs.set(ref.path, JSON.parse(JSON.stringify(data)));
        } finally {
          self.activeWrites--;
        }
      },
      getDoc: async (ref: FakeDocRef) => {
        if (self.onGetDoc) {
          const override = self.onGetDoc(ref.path);
          if (override !== undefined) return override;
        }
        const value = self.docs.get(ref.path);
        return {
          exists: () => value !== undefined,
          data: () => (value !== undefined ? JSON.parse(JSON.stringify(value)) : undefined),
        };
      },
      getDocFromServer: async (ref: FakeDocRef) => {
        self.getDocFromServerCalls.push(ref.path);
        if (self.onGetDoc) {
          const override = self.onGetDoc(ref.path);
          if (override !== undefined) return override;
        }
        const value = self.docs.get(ref.path);
        return {
          exists: () => value !== undefined,
          data: () => (value !== undefined ? JSON.parse(JSON.stringify(value)) : undefined),
        };
      },
      getDocs: async (colRef: FakeCollectionRef) => {
        const prefix = `${colRef.path}/`;
        const matched: Array<{ id: string; data: () => any }> = [];
        self.docs.forEach((val, key) => {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
            matched.push({
              id: key.slice(prefix.length),
              data: () => JSON.parse(JSON.stringify(val)),
            });
          }
        });
        return {
          size: matched.length,
          forEach: (cb: (d: { id: string; data: () => any }) => void) => matched.forEach(cb),
        };
      },
      getCountFromServer: async (colRef: FakeCollectionRef) => {
        const prefix = `${colRef.path}/`;
        let count = 0;
        self.docs.forEach((_val, key) => {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
            count++;
          }
        });
        return {
          data: () => ({ count }),
        };
      },
      runTransaction: async (_db, fn) => {
        self.txnCalls++;
        const runCore = async () => {
          const pendingSets: Array<{ path: string; data: any }> = [];
          const txn = {
            get: async (ref: FakeDocRef) => {
              const value = self.docs.get(ref.path);
              return {
                exists: () => value !== undefined,
                data: () => (value !== undefined ? JSON.parse(JSON.stringify(value)) : undefined),
              };
            },
            set: (ref: FakeDocRef, data: any) => {
              pendingSets.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)) });
            },
          };
          const res = await fn(txn);
          pendingSets.forEach((s) => self.docs.set(s.path, s.data));
          return res;
        };
        if (self.onRunTransaction) {
          return self.onRunTransaction(runCore);
        }
        return runCore();
      },
    };
  }
}

function makeUsuario(papel: UsuarioOperacional['papel']): UsuarioOperacional {
  return {
    id: `usr_${papel}`,
    nome: `Teste ${papel}`,
    matricula: '172001',
    papel,
    filialId: '172',
    ultimoLogin: '2026-11-09T12:00:00.000Z',
  };
}

function makeProdutosPesados(count: number, approxCharsPerItem = 240_000): ProdutoSMG[] {
  const padding = 'X'.repeat(approxCharsPerItem);
  return Array.from({ length: count }, (_, i) => ({
    id: `prod_${i}`,
    codigo_original: `${10000 + i}-1`,
    codigo_interno: `${10000 + i}`,
    digito: '1',
    codigo_exibicao: `${10000 + i}-1`,
    descricao: `PRODUTO TESTE ${i} ${padding}`,
    embalagem: 'UN',
    estoque_emb1: 12.5,
    estoque_emb9: 0,
    estoque_total: 12.5,
    vendas_qtde_30d: 4,
    dias_sem_venda: 12,
    idade: 30,
    eans: [`78910000${String(i).padStart(5, '0')}`],
    atualizado_em: '2026-11-09T12:00:00.000Z',
  }));
}

function makeSpcoiPesados(count: number, approxCharsPerItem = 220_000): {
  fornecedores: FornecedorSPCOI007[];
  industrias: Industria[];
} {
  const padding = 'Y'.repeat(approxCharsPerItem);
  const fornecedores: FornecedorSPCOI007[] = Array.from({ length: count }, (_, i) => ({
    id: `spcoi_${i}`,
    cnpj: '12345678000199',
    cnpj_formatado: '12.345.678/0001-99',
    razao_social: `INDUSTRIA EXEMPLO S/A ${padding}`,
    codigo_interno: `${20000 + i}`,
    digito: '2',
    codigo_exibicao: `${20000 + i}-2`,
    descricao_produto: `ITEM SPCOI ${i}`,
    descricao_spcoi: `ITEM SPCOI ${i}`,
    criado_em: '2026-11-09T12:00:00.000Z',
  }));
  const industrias: Industria[] = [
    {
      cnpj: '12345678000199',
      cnpj_formatado: '12.345.678/0001-99',
      razao_social: 'INDUSTRIA EXEMPLO S/A',
      nome_exibicao: 'INDUSTRIA EXEMPLO S/A',
      ativo: true,
      total_produtos_loja: count,
      criado_em: '2026-11-09T12:00:00.000Z',
      atualizado_em: '2026-11-09T12:00:00.000Z',
    },
  ];
  return { fornecedores, industrias };
}

function makeSaeouPesados(count: number, approxCharsPerItem = 220_000): RegistroSaeou060[] {
  const padding = 'Z'.repeat(approxCharsPerItem);
  return Array.from({ length: count }, (_, i) => ({
    id: `saeou_${i}`,
    codigo_original: `${30000 + i}-3`,
    codigo_interno: `${30000 + i}`,
    digito: '3',
    codigo_exibicao: `${30000 + i}-3`,
    descricao: `PRODUTO SAEOU ${i} ${padding}`,
    embalagem: 'UN',
    quantidade: 8,
    estoque_loja: 8,
    data_vencimento: '2026-12-20',
    status_saeou: 'NOVO',
    origem: 'SAEOU060',
    arquivo_origem: 'SAEOU060.xlsx',
    data_importacao: '09/11/2026',
    hora_importacao: '12:00:00',
  }));
}

const dummyMeta: MetadadosBase = {
  filial_numero: '172',
  filial_nome: 'CASCAVEL',
  status_base: 'BASE_RUB',
  total_produtos: 4,
  total_vencimentos: 0,
  total_eans: 0,
  total_saeou060: 0,
};

async function runAllTests() {
  console.log('=== TESTES DE PUBLICAÇÃO SEGURA V3 DAS TRÊS BASES (FILIAL 172) ===\n');

  // -------------------------------------------------------------------------
  // CENÁRIO 1: Timeout e ausência de travamento indefinido
  // -------------------------------------------------------------------------
  console.log('[Cenário 1] Timeout controlado, sem travamento e sem acúmulo de retentativas...');
  {
    const fake = new InMemoryFirestoreFake();
    const versaoAnteriorSpcoi = {
      versaoId: 'spcoi_172_anterior',
      filialId: '172',
      dataPublicacaoIso: '2026-11-08T10:00:00.000Z',
      publicadoPor: 'Admin Anterior',
      totalFornecedores: 100,
      totalIndustrias: 5,
      totalChunks: 2,
      checksumBase: 'CHK-ANTERIOR',
    };
    fake.docs.set('filiais/172/config/versao_ativa_spcoi', versaoAnteriorSpcoi);

    let releaseHungWrite!: () => void;
    const hungWritePromise = new Promise<void>((resolve) => {
      releaseHungWrite = resolve;
    });

    fake.onSetDoc = async (path) => {
      if (path.endsWith('/chunks/chunk_1')) {
        await hungWritePromise;
      }
    };

    const spcoiSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 60,
      readTimeoutMs: 60,
      concurrencyLimit: 2,
      setMetaFn: async () => {},
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });

    const { fornecedores, industrias } = makeSpcoiPesados(4);
    const t0 = Date.now();
    const resTimeout = await spcoiSvc.publicarSpcoiCentral(fornecedores, industrias);
    const elapsedMs = Date.now() - t0;

    assert(elapsedMs < 800, `Publicação não deve travar indefinidamente (levou ${elapsedMs}ms).`);
    assert(resTimeout.sucesso === false, 'Timeout nunca pode retornar sucesso: true.');
    assert(
      resTimeout.estadoPublicacao === 'PENDENTE_CONFIRMACAO',
      `Esperado PENDENTE_CONFIRMACAO, obtido ${resTimeout.estadoPublicacao}.`
    );
    assert(resTimeout.versaoConfirmadaNoServidor === false, 'Versão em timeout não pode ser confirmada.');
    assert(resTimeout.chunkFalhou === 1, `Esperado chunkFalhou=1, obtido ${resTimeout.chunkFalhou}.`);
    assert(spcoiSvc.getStatus().status === 'PENDENTE_CONFIRMACAO', 'Status do serviço deve ser PENDENTE_CONFIRMACAO.');
    assert(spcoiSvc.getStatus().progressoPorcentagem < 100, 'Progresso em timeout não pode chegar a 100%.');
    assert(
      fake.docs.get('filiais/172/config/versao_ativa_spcoi').versaoId === 'spcoi_172_anterior',
      'Ponteiro ativo anterior do SPCOI007 deve ser preservado após timeout.'
    );
    assert(fake.txnCalls === 0, 'Transação de ativação não pode rodar após timeout de chunk.');

    // Tentar publicar novamente enquanto escrita pendente do SDK ainda não encerrou: deve bloquear ANTES de escrever chunks
    const writesBeforeRetry = fake.setDocCalls.length;
    const resBlockedRetry = await spcoiSvc.publicarSpcoiCentral(fornecedores, industrias);
    assert(resBlockedRetry.sucesso === false, 'Nova tentativa com escrita pendente deve ser bloqueada.');
    assert(
      resBlockedRetry.estadoPublicacao === 'PENDENTE_CONFIRMACAO',
      'Tentativa bloqueada por escrita pendente deve manter PENDENTE_CONFIRMACAO.'
    );
    assert(
      fake.setDocCalls.length === writesBeforeRetry,
      'Não deve disparar nenhuma nova escrita no Firestore enquanto a escrita anterior estiver presa.'
    );

    // Libera escrita anterior presa no SDK e permite que nova tentativa consulte o servidor e conclua
    releaseHungWrite();
    await new Promise((r) => setTimeout(r, 20));
    fake.onSetDoc = undefined;
    fake.getDocFromServerCalls = [];

    const resRecuperado = await spcoiSvc.publicarSpcoiCentral(fornecedores, industrias);
    assert(resRecuperado.sucesso === true, `Publicação após estabilização deveria concluir: ${resRecuperado.mensagem}`);
    assert(resRecuperado.versaoConfirmadaNoServidor === true, 'Deve confirmar ponteiro no servidor após recuperação.');
    assert(fake.getDocFromServerCalls.length >= 2, 'Deve consultar estado remoto antes e depois da comutação.');
    console.log('  ✓ Timeout controlado, proteção contra fila pendente e recuperação validadas.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 2: Controle de concorrência de chunks (máximo 2 simultâneos)
  // -------------------------------------------------------------------------
  console.log('[Cenário 2] Controle de concorrência limitada a no máximo 2 chunks simultâneos...');
  {
    const fake = new InMemoryFirestoreFake();
    fake.onSetDoc = async () => {
      await new Promise((r) => setTimeout(r, 15));
    };

    const rubSvc = new RubSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      concurrencyLimit: 5, // mesmo se configurado maior, o guard limita ao teto seguro de 2
      setMetaFn: async () => {},
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });

    const produtos = makeProdutosPesados(6); // ~6 chunks
    const res = await rubSvc.publicarBaseRubCentral(produtos, dummyMeta, '172');
    assert(res.sucesso === true, `Publicação RUB com 6 chunks deveria suceder: ${res.mensagem}`);
    assert((res.totalChunks || 0) >= 4, `Esperado >= 4 chunks, obtido ${res.totalChunks}.`);
    assert(
      fake.maxActiveWrites <= 2,
      `Concorrência máxima de gravações simultâneas deve ser <= 2 (observado: ${fake.maxActiveWrites}).`
    );

    const saeouSvc = new SaeouSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      concurrencyLimit: 2,
      setMetaFn: async () => {},
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });
    fake.resetCounters();
    const resSaeou = await saeouSvc.publicarSaeouCentral(makeSaeouPesados(6), '172');
    assert(resSaeou.sucesso === true, `Publicação SAEOU060 deveria suceder: ${resSaeou.mensagem}`);
    assert(
      fake.maxActiveWrites <= 2,
      `Concorrência máxima no SAEOU060 deve ser <= 2 (observado: ${fake.maxActiveWrites}).`
    );
    console.log(`  ✓ Concorrência máxima verificada: ${fake.maxActiveWrites} chunks simultâneos (teto = 2).`);
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 3: Falha de rede durante a publicação (três bases)
  // -------------------------------------------------------------------------
  console.log('[Cenário 3] Falha de rede no chunk_1 para BASE RUB, SPCOI007 e SAEOU060...');
  {
    const fake = new InMemoryFirestoreFake();
    fake.docs.set('filiais/172/config/versao_ativa_rub', {
      versaoId: 'rub_ativa_prev',
      dataPublicacaoIso: '2026-11-08T00:00:00Z',
      publicadoPor: 'Admin',
      totalProdutos: 10,
      totalChunks: 1,
      checksumBase: 'CHK1',
    });
    fake.docs.set('filiais/172/config/versao_ativa_saeou', {
      versaoId: 'saeou_ativa_prev',
      filialId: '172',
      dataPublicacaoIso: '2026-11-08T00:00:00Z',
      publicadoPor: 'Admin',
      totalRegistros: 10,
      totalChunks: 1,
      checksumBase: 'CHK2',
    });

    fake.onSetDoc = async (path) => {
      if (path.endsWith('/chunks/chunk_1')) {
        throw new Error('Network disconnected while writing chunk_1');
      }
    };

    const rubSvc = new RubSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });
    const resRubFail = await rubSvc.publicarBaseRubCentral(makeProdutosPesados(4), dummyMeta, '172');
    assert(resRubFail.sucesso === false, 'RUB com erro de rede deve retornar sucesso: false.');
    assert(resRubFail.estadoPublicacao === 'ERRO', `RUB esperava ERRO, obteve ${resRubFail.estadoPublicacao}.`);
    assert(fake.docs.get('filiais/172/config/versao_ativa_rub').versaoId === 'rub_ativa_prev', 'Ponteiro RUB preservado.');

    const saeouSvc = new SaeouSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });
    const resSaeouFail = await saeouSvc.publicarSaeouCentral(makeSaeouPesados(4), '172');
    assert(resSaeouFail.sucesso === false, 'SAEOU060 com erro de rede deve retornar sucesso: false.');
    assert(resSaeouFail.estadoPublicacao === 'ERRO', `SAEOU060 esperava ERRO, obteve ${resSaeouFail.estadoPublicacao}.`);
    assert(
      fake.docs.get('filiais/172/config/versao_ativa_saeou').versaoId === 'saeou_ativa_prev',
      'Ponteiro SAEOU060 preservado.'
    );
    assert(
      fake.setDocCalls.every((c) => !c.path.startsWith('saeou060_chunks/')),
      'SaeouSyncService nunca deve gravar na coleção legada saeou060_chunks.'
    );
    console.log('  ✓ Falhas de rede tratadas sem perda local, sem ativação parcial e sem escrita legada.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 4: Recusa por autorização
  // -------------------------------------------------------------------------
  console.log('[Cenário 4] Recusa por autorização (OPERADOR_LOJA / CONFERENTE_ENCARREGADO)...');
  {
    for (const papel of ['OPERADOR_LOJA', 'CONFERENTE_ENCARREGADO'] as const) {
      const fake = new InMemoryFirestoreFake();
      const rubSvc = new RubSyncService({
        autoStart: false,
        adapter: fake.createAdapter(),
        setMetaFn: async () => {},
        podePublicarFn: () => ({
          permitido: false,
          motivoRecusa: `Perfil ${papel} não possui permissão para publicar a BASE RUB.`,
        }),
        getUsuarioFn: () => makeUsuario(papel),
      });

      const resRecusa = await rubSvc.publicarBaseRubCentral(makeProdutosPesados(1, 20), dummyMeta, '172');
      assert(resRecusa.sucesso === false, `${papel} não pode publicar.`);
      assert(
        resRecusa.estadoPublicacao === 'RECUSADA_PERMISSAO',
        `Esperado RECUSADA_PERMISSAO para ${papel}, obtido ${resRecusa.estadoPublicacao}.`
      );
      assert(resRecusa.versaoConfirmadaNoServidor === false, 'Não deve confirmar versão quando recusado.');
      assert(fake.setDocCalls.length === 0, 'Recusa de permissão deve gerar ZERO escritas no Firestore.');
    }
    console.log('  ✓ Perfis não autorizados bloqueados com zero chamadas de gravação no Firestore.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 5: Concorrência entre publicações (local e entre terminais CAS)
  // -------------------------------------------------------------------------
  console.log('[Cenário 5] Concorrência entre publicações (mesmo dispositivo e outro terminal CAS)...');
  {
    const fake = new InMemoryFirestoreFake();
    let releaseFirstChunk!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirstChunk = resolve;
    });
    let blockedOnce = false;
    fake.onSetDoc = async (path) => {
      if (!blockedOnce && path.endsWith('/chunks/chunk_0')) {
        blockedOnce = true;
        await gate;
      }
    };

    const spcoiSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 1000,
      readTimeoutMs: 1000,
      setMetaFn: async () => {},
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });

    const { fornecedores, industrias } = makeSpcoiPesados(2, 50);
    const primeiraPromise = spcoiSvc.publicarSpcoiCentral(fornecedores, industrias);
    await new Promise((r) => setTimeout(r, 15));

    const segundaConcorrente = await spcoiSvc.publicarSpcoiCentral(fornecedores, industrias);
    assert(segundaConcorrente.sucesso === false, 'Segunda publicação simultânea no mesmo terminal deve ser bloqueada.');

    releaseFirstChunk();
    const resPrimeira = await primeiraPromise;
    assert(resPrimeira.sucesso === true, 'Primeira publicação deve concluir após liberação.');

    // Conflito CAS entre terminais na BASE RUB:
    const fakeCas = new InMemoryFirestoreFake();
    fakeCas.docs.set('filiais/172/config/versao_ativa_rub', {
      versaoId: 'rub_terminal_A_v1',
      dataPublicacaoIso: '2026-11-08T10:00:00Z',
      publicadoPor: 'Gerente A',
      totalProdutos: 1,
      totalChunks: 1,
      checksumBase: 'CHK-A',
    });

    // Durante a transação, simula outro terminal que já gravou 'rub_terminal_B_v2' no servidor
    fakeCas.onRunTransaction = async (txnCore) => {
      fakeCas.docs.set('filiais/172/config/versao_ativa_rub', {
        versaoId: 'rub_terminal_B_v2',
        dataPublicacaoIso: '2026-11-09T11:59:00Z',
        publicadoPor: 'Gerente B',
        totalProdutos: 2,
        totalChunks: 1,
        checksumBase: 'CHK-B',
      });
      return txnCore();
    };

    const rubCasSvc = new RubSyncService({
      autoStart: false,
      adapter: fakeCas.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });

    const resCas = await rubCasSvc.publicarBaseRubCentral(makeProdutosPesados(1, 20), dummyMeta, '172');
    assert(resCas.sucesso === false, 'Conflito CAS entre terminais deve falhar sem sobrescrever.');
    assert(
      fakeCas.docs.get('filiais/172/config/versao_ativa_rub').versaoId === 'rub_terminal_B_v2',
      'Ponteiro do Terminal B não pode ser sobrescrito em caso de conflito CAS.'
    );
    console.log('  ✓ Proteção contra concorrência local e conflito CAS entre terminais validada.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 6: Prevenção de falso sucesso (UI Helper e confirmação pós-transação)
  // -------------------------------------------------------------------------
  console.log('[Cenário 6] Prevenção de falso sucesso na UI e confirmação pós-transação...');
  {
    const casosNegativos: ResultadoPublicacaoBase[] = [
      {
        sucesso: false,
        estadoPublicacao: 'RECUSADA_PERMISSAO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Requer GERENCIA_ADMIN',
        motivoRecusa: 'Perfil operador',
      },
      {
        sucesso: false,
        estadoPublicacao: 'PENDENTE_CONFIRMACAO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Timeout chunk_3',
        chunkFalhou: 3,
      },
      {
        sucesso: false,
        estadoPublicacao: 'LOCAL_SEM_NUVEM',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Salvo apenas localmente',
      },
      {
        sucesso: false,
        estadoPublicacao: 'ERRO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Erro de integridade',
      },
      // Caso anômalo defensivo: sucesso=true mas versaoConfirmadaNoServidor=false nunca pode virar 100%
      {
        sucesso: true,
        estadoPublicacao: 'ERRO',
        versaoConfirmadaNoServidor: false,
        mensagem: 'Sem confirmação explícita do servidor',
      },
    ];

    for (const caso of casosNegativos) {
      const ui = resolverEstadoPublicacaoImportacao('BASE RUB', caso, 98, '10 produtos locais.');
      assert(ui.progressPercent < 100, `Progresso não pode ser 100% para ${caso.estadoPublicacao}.`);
      assert(ui.shouldAutoClose === false, `Modal nunca deve fechar automaticamente para ${caso.estadoPublicacao}.`);
      assert(ui.phase !== 'CONFIRMED', `Fase não pode ser CONFIRMED para ${caso.estadoPublicacao}.`);
    }

    const uiOk = resolverEstadoPublicacaoImportacao(
      'SPCOI007',
      {
        sucesso: true,
        estadoPublicacao: 'CONFIRMADA',
        versaoConfirmadaNoServidor: true,
        mensagem: 'Confirmado',
        versaoId: 'spcoi_172_ok',
      },
      98,
      '100 vínculos.'
    );
    assert(uiOk.phase === 'CONFIRMED', 'Resultado confirmado deve resultar em CONFIRMED.');
    assert(uiOk.progressPercent === 100, 'Resultado confirmado deve atingir 100%.');
    assert(uiOk.shouldAutoClose === true, 'Modal só fecha automaticamente após confirmação real.');

    // Se pós-transação retornar ponteiro diferente no servidor, nunca pode marcar sucesso
    const fakeMismatch = new InMemoryFirestoreFake();
    fakeMismatch.onGetDoc = (path) => {
      if (path === 'filiais/172/config/versao_ativa_rub' && fakeMismatch.txnCalls > 0) {
        return {
          exists: () => true,
          data: () => ({
            versaoId: 'rub_versao_divergente_no_servidor',
            checksumBase: 'OUTRO_CHK',
            totalChunks: 1,
          }),
        };
      }
      return undefined;
    };

    const rubMismatchSvc = new RubSyncService({
      autoStart: false,
      adapter: fakeMismatch.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });
    const resMismatch = await rubMismatchSvc.publicarBaseRubCentral(makeProdutosPesados(1, 20), dummyMeta, '172');
    assert(resMismatch.sucesso === false, 'Divergência na confirmação pós-transação nunca pode retornar sucesso.');
    assert(resMismatch.versaoConfirmadaNoServidor === false, 'versaoConfirmadaNoServidor deve ser false.');
    assert(rubMismatchSvc.getStatusPublicacao().progressoPorcentagem < 100, 'Progresso não deve atingir 100% em divergência.');
    console.log('  ✓ Falso sucesso bloqueado em todos os fluxos de interface e confirmação pós-transação.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 7: Integridade de chunks e ausência de sincronização legada concorrente
  // -------------------------------------------------------------------------
  console.log('[Cenário 7] Integridade de chunks no servidor e ausência de sincronização legada concorrente...');
  {
    const fake = new InMemoryFirestoreFake();
    const adapter = fake.createAdapter();

    // 7A. Chunks incompletos no servidor (2 esperados, só chunk_0 presente no servidor)
    fake.docs.set('filiais/172/catalogo_rub_versoes/v_incompleta', {
      versaoId: 'v_incompleta',
      totalChunks: 2,
      checksumBase: 'CHK-123',
      totalProdutos: 50,
    });
    fake.docs.set('filiais/172/catalogo_rub_versoes/v_incompleta/chunks/chunk_0', {
      versaoId: 'v_incompleta',
      totalChunks: 2,
      index: 0,
      items: [],
    });

    let capturedIntegrityErr: unknown = null;
    try {
      await validarIntegridadeVersaoNoServidor({
        adapter,
        filialId: '172',
        versoesCollectionName: 'catalogo_rub_versoes',
        versaoId: 'v_incompleta',
        expectedTotalChunks: 2,
        expectedChecksum: 'CHK-123',
        confirmedIndices: new Set([0, 1]),
        expectedCountField: 'totalProdutos',
        expectedCountValue: 50,
        readTimeoutMs: 300,
      });
    } catch (err) {
      capturedIntegrityErr = err;
    }
    assert(
      capturedIntegrityErr instanceof PublishIntegrityError,
      'Versão com chunk faltante no servidor deve lançar PublishIntegrityError antes de ativar.'
    );

    // 7B. Quando faltar chunk no servidor durante publicarBaseRubCentral, transação NÃO pode rodar
    const fakeDrop = new InMemoryFirestoreFake();
    fakeDrop.docs.set('filiais/172/config/versao_ativa_rub', {
      versaoId: 'rub_oficial_preservada',
      dataPublicacaoIso: '2026-11-08T00:00:00Z',
      publicadoPor: 'Admin',
      totalProdutos: 5,
      totalChunks: 1,
      checksumBase: 'CHK-OK',
    });
    const baseAdapter = fakeDrop.createAdapter();
    const adapterWithDroppedChunk: PublishAdapter = {
      ...baseAdapter,
      setDoc: async (ref, data) => {
        await baseAdapter.setDoc(ref, data);
        // Simula perda silenciosa de chunk_1 no servidor após setDoc
        if (ref.path.endsWith('/chunks/chunk_1')) {
          fakeDrop.docs.delete(ref.path);
        }
      },
    };

    const rubIntSvc = new RubSyncService({
      autoStart: false,
      adapter: adapterWithDroppedChunk,
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });
    const resCorrupt = await rubIntSvc.publicarBaseRubCentral(makeProdutosPesados(4), dummyMeta, '172');
    assert(resCorrupt.sucesso === false, 'Chunk ausente no servidor deve abortar publicação antes de ativar.');
    assert(fakeDrop.txnCalls === 0, 'Transação de troca de ponteiro nunca deve ser chamada se integridade falhar.');
    assert(
      fakeDrop.docs.get('filiais/172/config/versao_ativa_rub').versaoId === 'rub_oficial_preservada',
      'Ponteiro ativo anterior preservado quando integridade falha.'
    );

    // 7C. Ausência de sincronização legada concorrente no productRepository mantendo vínculos EAN e vencimentos
    let legacyCatalogCalls = 0;
    let legacySaeouCalls = 0;
    let vinculosPushCalls = 0;
    let vencimentosPushCalls = 0;

    const origPushCatalogo = cloudSyncService.pushCatalogoToCloud.bind(cloudSyncService);
    const origPushSaeou = cloudSyncService.pushSaeou060ToCloud.bind(cloudSyncService);
    const origPushVinculos = cloudSyncService.pushVinculosToCloud.bind(cloudSyncService);
    const origPushAllLotes = cloudSyncService.pushAllLotesToCloud.bind(cloudSyncService);

    cloudSyncService.pushCatalogoToCloud = async () => {
      legacyCatalogCalls++;
      return true;
    };
    cloudSyncService.pushSaeou060ToCloud = async () => {
      legacySaeouCalls++;
      return true;
    };
    cloudSyncService.pushVinculosToCloud = async () => {
      vinculosPushCalls++;
      return true;
    };
    cloudSyncService.pushAllLotesToCloud = async () => {
      vencimentosPushCalls++;
    };

    // Garantir navigator.onLine simulado para testar a guarda mesmo com navegador online
    const navDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let stubbedNavigator = false;
    try {
      if (!navDescriptor || navDescriptor.configurable) {
        Object.defineProperty(globalThis, 'navigator', {
          value: { onLine: true },
          configurable: true,
        });
        stubbedNavigator = true;
      }

      const prodSample = makeProdutosPesados(2, 30);
      await productRepository.saveProducts(prodSample);
      await productRepository.saveProducts(prodSample, undefined, { skipLegacyCloudSync: false });
      await productRepository.aplicarNovoSnapshotSaeou060(makeSaeouPesados(2, 30), 'SAEOU060.xlsx');

      assert(
        legacyCatalogCalls === 0,
        `saveProducts() na Filial 172 nunca deve chamar pushCatalogoToCloud() (chamou ${legacyCatalogCalls}x).`
      );
      assert(
        legacySaeouCalls === 0,
        `aplicarNovoSnapshotSaeou060() na Filial 172 nunca deve chamar pushSaeou060ToCloud() (chamou ${legacySaeouCalls}x).`
      );

      // Vínculos EAN e vencimentos devem continuar sincronizando normalmente
      const vinculoSample: VinculoEan[] = [
        {
          id: 'vinc_teste_1',
          codigo_interno: '10000',
          digito: '1',
          ean: '7891000000001',
          descricao: 'PRODUTO TESTE',
          status_vinculo: 'VINCULADO',
          criado_em: '2026-11-09T12:00:00.000Z',
        },
      ];
      await productRepository.saveVinculos(vinculoSample);
      await productRepository.saveVencimentos([]);

      assert(legacyCatalogCalls === 0, 'Operações subsequentes não devem disparar pushCatalogoToCloud().');
      assert(legacySaeouCalls === 0, 'Operações subsequentes não devem disparar pushSaeou060ToCloud().');
      assert(vinculosPushCalls === 1, `Vínculos EAN devem continuar sincronizando normalmente (chamou ${vinculosPushCalls}x).`);
      assert(vencimentosPushCalls === 1, `Vencimentos devem continuar sincronizando normalmente (chamou ${vencimentosPushCalls}x).`);
    } finally {
      cloudSyncService.pushCatalogoToCloud = origPushCatalogo;
      cloudSyncService.pushSaeou060ToCloud = origPushSaeou;
      cloudSyncService.pushVinculosToCloud = origPushVinculos;
      cloudSyncService.pushAllLotesToCloud = origPushAllLotes;
      if (stubbedNavigator) {
        if (navDescriptor) {
          Object.defineProperty(globalThis, 'navigator', navDescriptor);
        } else {
          delete (globalThis as any).navigator;
        }
      }
    }

    console.log('  ✓ Integridade de chunks validada e zero concorrência com sincronização legada.');
  }

  console.log('\n==========================================================================');
  console.log('✅ TODOS OS 7 CENÁRIOS DE PUBLICAÇÃO SEGURA V3 PASSARAM COM 100% DE SUCESSO!');
  console.log('==========================================================================\n');
  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('❌ ERRO NA SUÍTE V3:', err);
  process.exit(1);
});
