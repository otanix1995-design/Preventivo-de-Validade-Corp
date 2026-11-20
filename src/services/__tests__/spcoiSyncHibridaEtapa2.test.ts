/**
 * Testes Automatizados Offline — Arquitetura Híbrida V1.0 — Etapa 2: Sincronização SPCOI007 (Filial 172)
 *
 * IMPORTANTE: Execução 100% OFFLINE com adaptador Firestore simulado em memória.
 * NUNCA publica nem lê dados reais no Firestore de produção.
 *
 * Valida todos os 9 requisitos e todas as restrições obrigatórias da Etapa 2:
 * 1. Compactação fflate tabular + Firestore Bytes em escala real (46.057 fornecedores + 2.440 indústrias).
 * 2. Divisão automática mantendo 100% dos chunks e metadados bem abaixo de 400 KB / 1 MiB.
 * 3. Controle de versão (/filiais/172/config/versao_ativa_spcoi) e checksum SHA-256 integral + detecção de adulteração.
 * 4. Publicação exclusiva por GERENCIA_ADMIN autenticada (OPERADOR_LOJA / CONFERENTE / permission-denied recusados).
 * 5. Download automático SOMENTE quando houver versão mais recente (0 leituras de chunks quando já atualizado).
 * 6. Persistência em metadados/IndexedDB simulado e operação offline com base preservada.
 * 7. Substituição atômica + rollback automático em falha de download ou falha na gravação atômica.
 * 8. Preservação integral de configurações de indústrias, vínculos comerciais, BASE RUB, SAEOU060,
 *    promotores, agências, vínculos EAN e vencimentos.
 * 9. Proteção Spark: idempotência (0 escritas) + bloqueio imediato (0 retentativas) em resource-exhausted.
 */

import { Bytes } from 'firebase/firestore';
import {
  buildSafeCompressedSpcoiChunks,
  calcularChecksumIntegralSpcoi,
  decompressTabularFromBytes,
  encodeIndustriasToCompressedBytes,
  extractUint8ArrayFromFirestoreValue,
  SPCOI_TABULAR_FORMAT_V1,
} from '../spcoiCompactCodec';
import {
  estimateFirestorePayloadBytes,
  PublishAdapter,
} from '../firestorePublishGuard';
import { SpcoiSyncService, spcoiSyncService } from '../spcoiSyncService';
import { isvService } from '../isvService';
import { productRepository } from '../productRepository';
import { promotorService } from '../promotorService';
import { AtomicBatchOp, STORES } from '../db';
import {
  isFirestoreQuotaExceeded,
  isQuotaError,
  markQuotaExceeded,
  resetQuotaExceeded,
} from '../firebase';
import {
  FornecedorSPCOI007,
  Industria,
  MetadadosBase,
  ProdutoSMG,
  RegistroSaeou060,
  ResumoImportacaoSPCOI007,
} from '../../types';
import { UsuarioOperacional } from '../authRoleService';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO (Etapa 2): ${message}`);
  }
}

interface FakeDocRef {
  path: string;
  id: string;
}

interface FakeCollectionRef {
  path: string;
}

/**
 * Simulador em memória do Firestore com suporte fiel a `Bytes` nativos (`toJSON` / `Bytes.fromUint8Array`),
 * contagem exata de leituras e gravações e simulação de falhas.
 */
class OfflineSpcoiFirestoreFake {
  public docs = new Map<string, any>();
  public setDocCalls: Array<{ path: string; payloadBytes: number }> = [];
  public getDocFromServerCalls: string[] = [];
  public getDocsCalls: string[] = [];
  public txnCalls = 0;
  public activeWrites = 0;
  public maxActiveWrites = 0;

  public onSetDoc?: (path: string, data: any) => Promise<void> | void;

  public resetCounters(): void {
    this.setDocCalls = [];
    this.getDocFromServerCalls = [];
    this.getDocsCalls = [];
    this.txnCalls = 0;
    this.activeWrites = 0;
    this.maxActiveWrites = 0;
  }

  private _cloneDoc(value: any): any {
    if (value === undefined) return undefined;
    // Simula persistência JSON + restauração de Firestore Bytes exatamente como no SDK/rede
    return JSON.parse(JSON.stringify(value));
  }

  public createAdapter(offline = false): PublishAdapter {
    const self = this;
    return {
      db: offline ? null : ({} as any),
      ensureAuth: async () => ({ uid: 'admin-cascavel-172' }),
      isFirestoreQuotaExceeded: () => isFirestoreQuotaExceeded(),
      markQuotaExceeded: (motivo, recurso) => markQuotaExceeded(motivo, recurso),
      isQuotaError: (err) => isQuotaError(err),
      doc: (_db, ...segments: string[]): FakeDocRef => ({
        path: segments.join('/'),
        id: segments[segments.length - 1],
      }),
      collection: (_db, ...segments: string[]): FakeCollectionRef => ({
        path: segments.join('/'),
      }),
      setDoc: async (ref: FakeDocRef, data: any) => {
        self.activeWrites++;
        if (self.activeWrites > self.maxActiveWrites) {
          self.maxActiveWrites = self.activeWrites;
        }
        try {
          self.setDocCalls.push({
            path: ref.path,
            payloadBytes: estimateFirestorePayloadBytes(data),
          });
          if (self.onSetDoc) {
            await self.onSetDoc(ref.path, data);
          }
          self.docs.set(ref.path, self._cloneDoc(data));
        } finally {
          self.activeWrites--;
        }
      },
      getDoc: async (ref: FakeDocRef) => {
        const value = self.docs.get(ref.path);
        return {
          exists: () => value !== undefined,
          data: () => self._cloneDoc(value),
        };
      },
      getDocFromServer: async (ref: FakeDocRef) => {
        self.getDocFromServerCalls.push(ref.path);
        const value = self.docs.get(ref.path);
        return {
          exists: () => value !== undefined,
          data: () => self._cloneDoc(value),
        };
      },
      getDocs: async (colRef: FakeCollectionRef) => {
        self.getDocsCalls.push(colRef.path);
        const prefix = `${colRef.path}/`;
        const matched: Array<{ id: string; data: () => any }> = [];
        self.docs.forEach((val, key) => {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
            matched.push({
              id: key.slice(prefix.length),
              data: () => self._cloneDoc(val),
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
        return { data: () => ({ count }) };
      },
      runTransaction: async (_db, fn) => {
        self.txnCalls++;
        const pendingSets: Array<{ path: string; data: any }> = [];
        const txn = {
          get: async (ref: FakeDocRef) => {
            const value = self.docs.get(ref.path);
            return {
              exists: () => value !== undefined,
              data: () => self._cloneDoc(value),
            };
          },
          set: (ref: FakeDocRef, data: any) => {
            pendingSets.push({ path: ref.path, data: self._cloneDoc(data) });
          },
        };
        const res = await fn(txn);
        pendingSets.forEach((s) => self.docs.set(s.path, s.data));
        return res;
      },
    };
  }
}

function makeUsuario(papel: UsuarioOperacional['papel']): UsuarioOperacional {
  return {
    id: `usr_${papel}_172`,
    nome: `Usuario ${papel}`,
    matricula: '172001',
    papel,
    filialId: '172',
    ultimoLogin: '2026-11-19T12:00:00.000Z',
  };
}

function makeRealisticSpcoiBase(
  fornecedoresCount: number,
  industriasCount: number,
  tag = 'V1'
): {
  fornecedores: FornecedorSPCOI007[];
  industrias: Industria[];
  resumo: ResumoImportacaoSPCOI007;
} {
  const industrias: Industria[] = new Array(industriasCount);
  for (let i = 0; i < industriasCount; i++) {
    const cnpj = `${String(10_000_000 + i).padStart(8, '0')}0001${String((i % 89) + 10)}`;
    const razao = `INDUSTRIA PARCEIRA ${String(i + 1).padStart(4, '0')} LTDA ${tag}`;
    industrias[i] = {
      cnpj,
      cnpj_formatado: `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`,
      razao_social: razao,
      nome_exibicao: razao,
      ativo: true,
      total_produtos_loja: Math.max(1, Math.floor(fornecedoresCount / industriasCount)),
      promotores_responsaveis: [],
      criado_em: '2026-11-19T08:00:00.000Z',
      atualizado_em: '2026-11-19T08:00:00.000Z',
    };
  }

  const fornecedores: FornecedorSPCOI007[] = new Array(fornecedoresCount);
  for (let i = 0; i < fornecedoresCount; i++) {
    const ind = industrias[i % industriasCount];
    const cod = String(100_000 + (i % 15_000));
    const dig = String(i % 10);
    fornecedores[i] = {
      id: `${cod}_${ind.cnpj}`,
      cnpj: ind.cnpj,
      cnpj_formatado: ind.cnpj_formatado,
      razao_social: ind.razao_social,
      codigo_interno: cod,
      digito: dig,
      codigo_exibicao: `${cod}-${dig}`,
      descricao_spcoi: `MERCADORIA SPCOI ${i + 1} ${tag} CX 12X500G`,
      embalagem: `CX ${1 + (i % 24)}UN`,
      divisao: `DIV ${(i % 5) + 1}`,
      comprador: `COMPRADOR ${(i % 7) + 1}`,
      criado_em: '2026-11-19T08:00:00.000Z',
    };
  }

  const resumo: ResumoImportacaoSPCOI007 = {
    data_hora: '2026-11-19T08:00:00.000Z',
    nome_arquivo: `SPCOI007_${tag}.xlsx`,
    total_lidos: fornecedoresCount,
    total_validos: fornecedoresCount,
    total_encontrados_smg: Math.floor(fornecedoresCount * 0.7),
    total_sem_correspondencia: Math.ceil(fornecedoresCount * 0.3),
    total_multiplos_cnpjs: 120,
    total_industrias: industriasCount,
  };

  return { fornecedores, industrias, resumo };
}

async function runEtapa2Tests(): Promise<void> {
  console.log('=== TESTES ETAPA 2 — SINCRONIZAÇÃO SPCOI007 (ARQUITETURA HÍBRIDA V1.0) ===\n');
  spcoiSyncService.stopMonitoring();
  resetQuotaExceeded();

  // =========================================================================
  // TESTE 1 & 2: Escala real (46.057 fornecedores + 2.440 indústrias) com
  //              fflate tabular + Bytes + limite < 400 KB por documento
  // =========================================================================
  console.log('[1/7] Compactação fflate tabular + Firestore Bytes em escala real (46.057 fornecedores + 2.440 indústrias)...');
  const t0 = Date.now();
  const baseReal = makeRealisticSpcoiBase(46_057, 2_440, 'V1');
  const rawJsonBytes = Buffer.byteLength(JSON.stringify(baseReal.fornecedores), 'utf8');

  const chunks46k = await buildSafeCompressedSpcoiChunks(baseReal.fornecedores);
  const indEncoded = await encodeIndustriasToCompressedBytes(baseReal.industrias);
  const totalCompressedBytes =
    chunks46k.reduce((acc, c) => acc + c.compressedBytes.byteLength, 0) +
    indEncoded.compressedBytes.byteLength;

  const compressElapsedMs = Date.now() - t0;
  const ratio = rawJsonBytes / Math.max(1, totalCompressedBytes);

  assert(chunks46k.length >= 2 && chunks46k.length <= 20, `Esperado poucos chunks compactados para 46k linhas (gerou ${chunks46k.length}).`);
  for (const ch of chunks46k) {
    assert(
      ch.compressedBytes.byteLength <= 400 * 1024,
      `Chunk #${ch.index} excedeu 400 KB (${ch.compressedBytes.byteLength} bytes).`
    );
    const firestoreBytes = Bytes.fromUint8Array(ch.compressedBytes);
    const payloadEstimated = estimateFirestorePayloadBytes({
      versaoId: 'spcoi_172_test',
      index: ch.index,
      totalChunks: chunks46k.length,
      itemsCount: ch.itemsCount,
      compressedBytesCount: ch.compressedBytes.byteLength,
      uncompressedBytesCount: ch.uncompressedBytes,
      checksumChunk: ch.chunkSha256,
      formato: SPCOI_TABULAR_FORMAT_V1,
      dadosBytes: firestoreBytes,
    });
    assert(
      payloadEstimated <= 420 * 1024,
      `Payload Firestore do chunk #${ch.index} (${payloadEstimated} bytes) deve permanecer bem abaixo de 1 MiB.`
    );
  }
  assert(
    indEncoded.compressedBytes.byteLength <= 400 * 1024,
    `Indústrias comprimidas devem caber com folga (<400 KB; obteve ${indEncoded.compressedBytes.byteLength} bytes).`
  );

  // Round-trip completo dos 46.057 fornecedores + 2.440 indústrias via JSON serializado (Bytes.toJSON)
  const reconstructedFornecedores: FornecedorSPCOI007[] = [];
  for (const ch of chunks46k) {
    const serialized = JSON.parse(JSON.stringify(Bytes.fromUint8Array(ch.compressedBytes)));
    const dec = decompressTabularFromBytes<FornecedorSPCOI007>(serialized, 'FORNECEDORES');
    reconstructedFornecedores.push(...dec);
  }
  const serializedInd = JSON.parse(JSON.stringify(indEncoded.bytesField));
  const reconstructedIndustrias = decompressTabularFromBytes<Industria>(serializedInd, 'INDUSTRIAS');

  assert(
    reconstructedFornecedores.length === 46_057,
    `Esperado 46.057 fornecedores reconstruídos, obteve ${reconstructedFornecedores.length}.`
  );
  assert(
    reconstructedIndustrias.length === 2_440,
    `Esperado 2.440 indústrias reconstruídas, obteve ${reconstructedIndustrias.length}.`
  );
  assert(
    reconstructedFornecedores[0].razao_social === baseReal.fornecedores[0].razao_social &&
      reconstructedFornecedores[46_056].codigo_exibicao === baseReal.fornecedores[46_056].codigo_exibicao &&
      reconstructedFornecedores[46_056].embalagem === baseReal.fornecedores[46_056].embalagem,
    'Fidelidade de dados 100% no round-trip tabular + fflate + Bytes.'
  );
  const chkOrig = await calcularChecksumIntegralSpcoi(baseReal.fornecedores, baseReal.industrias);
  const chkReconst = await calcularChecksumIntegralSpcoi(reconstructedFornecedores, reconstructedIndustrias);
  assert(chkOrig === chkReconst, 'Checksum SHA-256 integral deve ser idêntico antes e depois da compactação.');
  console.log(
    `  ✓ 46.057 fornecedores (${(rawJsonBytes / 1024 / 1024).toFixed(2)} MB JSON -> ${(totalCompressedBytes / 1024).toFixed(1)} KB em ${chunks46k.length} chunks, fator ${ratio.toFixed(1)}x em ${compressElapsedMs}ms).`
  );

  // =========================================================================
  // TESTE 3: Publicação exclusiva por GERENCIA_ADMIN autenticada
  // =========================================================================
  console.log('[2/7] RBAC na publicação central (somente GERENCIA_ADMIN autenticada)...');
  {
    const fake = new OfflineSpcoiFirestoreFake();
    const basePequena = makeRealisticSpcoiBase(120, 12, 'RBAC');

    for (const papel of ['OPERADOR_LOJA', 'CONFERENTE_ENCARREGADO'] as const) {
      const svcBloqueado = new SpcoiSyncService({
        autoStart: false,
        adapter: fake.createAdapter(),
        setMetaFn: async () => {},
        getMetaFn: async (_k, fb) => fb,
        podePublicarFn: () => ({
          permitido: false,
          motivoRecusa: `Perfil ${papel} não autorizado a publicar SPCOI007.`,
        }),
        getUsuarioFn: () => makeUsuario(papel),
      });
      const resRecusado = await svcBloqueado.publicarSpcoiCentral(
        basePequena.fornecedores,
        basePequena.industrias,
        basePequena.resumo,
        '172'
      );
      assert(resRecusado.sucesso === false, `${papel} não pode publicar SPCOI007.`);
      assert(resRecusado.estadoPublicacao === 'RECUSADA_PERMISSAO', `Esperado RECUSADA_PERMISSAO para ${papel}.`);
      assert(fake.setDocCalls.length === 0, 'Usuário não-admin não pode gerar escritas no Firestore.');
    }

    // Erro permission-denied vindo do servidor Firestore Rules
    const fakePermDenied = new OfflineSpcoiFirestoreFake();
    fakePermDenied.onSetDoc = () => {
      throw Object.assign(new Error('Missing or insufficient permissions'), {
        code: 'permission-denied',
      });
    };
    const svcRuleDenied = new SpcoiSyncService({
      autoStart: false,
      adapter: fakePermDenied.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      getMetaFn: async (_k, fb) => fb,
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });
    const resRuleDenied = await svcRuleDenied.publicarSpcoiCentral(
      basePequena.fornecedores,
      basePequena.industrias,
      basePequena.resumo,
      '172'
    );
    assert(resRuleDenied.sucesso === false, 'Permission-denied do servidor deve recusar publicação.');
    assert(resRuleDenied.estadoPublicacao === 'RECUSADA_PERMISSAO', 'Esperado RECUSADA_PERMISSAO para erro das regras.');
    console.log('  ✓ RBAC validado: apenas GERENCIA_ADMIN verificada publica SPCOI007.');
  }

  // =========================================================================
  // TESTE 4 & 5: Publicação completa (46k), controle de versão, download
  //              condicional (0 leituras se atualizado), persistência offline e
  //              detecção de adulteração SHA-256
  // =========================================================================
  console.log('[3/7] Publicação completa 46.057 registros + download condicional no dispositivo + offline + SHA-256 tamper...');
  {
    const fake = new OfflineSpcoiFirestoreFake();
    const adminMetaStore = new Map<string, any>();
    const deviceMetaStore = new Map<string, any>();

    const adminSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 5_000,
      readTimeoutMs: 2_000,
      concurrencyLimit: 2,
      setMetaFn: async (k, v) => {
        adminMetaStore.set(k, v);
      },
      getMetaFn: async (k, fb) => (adminMetaStore.has(k) ? adminMetaStore.get(k) : fb),
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });

    const resPub46k = await adminSvc.publicarSpcoiCentral(
      baseReal.fornecedores,
      baseReal.industrias,
      baseReal.resumo,
      '172'
    );
    assert(resPub46k.sucesso === true, `Publicação 46k falhou: ${resPub46k.mensagem}`);
    assert(resPub46k.versaoConfirmadaNoServidor === true, 'Ponteiro deve ser confirmado no servidor.');
    assert(fake.maxActiveWrites <= 2, `Concorrência deve ser <= 2 (observado: ${fake.maxActiveWrites}).`);
    assert(
      fake.docs.get('filiais/172/config/versao_ativa_spcoi')?.formato === SPCOI_TABULAR_FORMAT_V1,
      'Ponteiro deve registrar o formato compactado Bytes V1.'
    );
    for (const c of fake.setDocCalls) {
      assert(c.payloadBytes <= 450 * 1024, `Documento ${c.path} ultrapassou 450 KB (${c.payloadBytes} bytes).`);
    }

    // Dispositivo consumidor (simula outro terminal baixando pela primeira vez)
    let deviceLocalState: {
      fornecedores: FornecedorSPCOI007[];
      industrias: Industria[];
    } = { fornecedores: [], industrias: [] };

    const createDeviceSvc = (offline = false) =>
      new SpcoiSyncService({
        autoStart: false,
        adapter: fake.createAdapter(offline),
        writeTimeoutMs: 2_000,
        readTimeoutMs: 2_000,
        setMetaFn: async (k, v) => {
          deviceMetaStore.set(k, v);
        },
        getMetaFn: async (k, fb) => (deviceMetaStore.has(k) ? deviceMetaStore.get(k) : fb),
        getLocalFornecedoresCountFn: () => deviceLocalState.fornecedores.length,
        salvarImportacaoSpcoiFn: async (forns, inds, _res, opcoes) => {
          deviceLocalState = { fornecedores: forns, industrias: inds };
          if (opcoes?.metaSpcoiSync) {
            deviceMetaStore.set('meta_spcoi_sync', opcoes.metaSpcoiSync);
          }
        },
      });

    const device1 = createDeviceSvc(false);
    fake.resetCounters();
    const check1 = await device1.verificarSincronizacaoComRemoto('172');
    assert(check1.verificado === true && check1.baixouNovaVersao === true, 'Dispositivo vazio deve baixar nova versão.');
    assert(deviceLocalState.fornecedores.length === 46_057, 'Dispositivo deve reconstruir todos os 46.057 fornecedores.');
    assert(deviceLocalState.industrias.length === 2_440, 'Dispositivo deve reconstruir todas as 2.440 indústrias.');
    assert(fake.getDocsCalls.length === 1, 'Deve baixar chunks uma única vez na primeira sincronização.');

    // Segunda verificação no mesmo dispositivo: ZERO leituras de chunks!
    fake.resetCounters();
    const check2 = await device1.verificarSincronizacaoComRemoto('172');
    assert(check2.verificado === true && check2.baixouNovaVersao === false, 'Mesmo versaoId não deve baixar novamente.');
    assert(fake.getDocsCalls.length === 0, 'Deve fazer 0 leituras de chunks quando versão local já é a ativa.');

    // Novo ciclo de boot no mesmo dispositivo (carrega meta_spcoi_sync persistido antes de comparar): ZERO leituras de chunks!
    const deviceRebooted = createDeviceSvc(false);
    fake.resetCounters();
    const checkReboot = await deviceRebooted.verificarSincronizacaoComRemoto('172');
    assert(checkReboot.baixouNovaVersao === false, 'Após reinício, meta_spcoi_sync persistido evita redownload.');
    assert(fake.getDocsCalls.length === 0, 'Após reinício, deve fazer 0 leituras de chunks.');

    // Operação offline: dispositivo sem conexão mantém 100% operacionalidade
    const deviceOffline = createDeviceSvc(true);
    const resOffline = await deviceOffline.baixarSpcoiAtivoParaDispositivo('172');
    assert(resOffline.sucesso === false, 'Sem rede deve informar operação offline.');
    assert(deviceLocalState.fornecedores.length === 46_057, 'Dados locais devem permanecer 100% disponíveis offline.');

    // Adulteração (tamper) de checksum no servidor: download deve falhar antes de sobrescrever dispositivo
    const ponteiroAtual = fake.docs.get('filiais/172/config/versao_ativa_spcoi');
    const fakeAdulterado = { ...ponteiroAtual, versaoId: ponteiroAtual.versaoId, checksumBase: '0'.repeat(64) };
    fake.docs.set('filiais/172/config/versao_ativa_spcoi', fakeAdulterado);

    const resTamper = await device1.baixarSpcoiAtivoParaDispositivo('172', undefined, { forcarDownload: true });
    assert(resTamper.sucesso === false, 'Checksum integral adulterado deve abortar substituição.');
    assert(
      resTamper.mensagem.toLowerCase().includes('checksum') || resTamper.mensagem.toLowerCase().includes('integridade'),
      `Esperado erro de checksum/integridade, obteve: ${resTamper.mensagem}`
    );
    assert(deviceLocalState.fornecedores.length === 46_057, 'Adulteração detectada não deve corromper base local.');
    console.log('  ✓ Publicação 46k, cache condicional (0 leituras extras), boot persistence, offline e SHA-256 validados.');
  }

  // =========================================================================
  // TESTE 6: Substituição atômica, chunk incompleto e ROLLBACK automático
  // =========================================================================
  console.log('[4/7] Substituição atômica e rollback automático em falha de chunk ou erro no IndexedDB...');
  {
    const fake = new OfflineSpcoiFirestoreFake();
    const baseV1 = makeRealisticSpcoiBase(80, 8, 'V1_ESTAVEL');
    const baseV2 = makeRealisticSpcoiBase(400, 10, 'V2_NOVA');

    const adminSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 1_000,
      readTimeoutMs: 1_000,
      setMetaFn: async () => {},
      getMetaFn: async (_k, fb) => fb,
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });

    // Publica V1 e popula isvService real com V1
    await adminSvc.publicarSpcoiCentral(baseV1.fornecedores, baseV1.industrias, baseV1.resumo, '172');
    await isvService.salvarImportacaoSpcoi(baseV1.fornecedores, baseV1.industrias, baseV1.resumo);
    assert(isvService.getFornecedores().length === 80, 'isvService inicializado com 80 fornecedores V1.');

    // Publica V2 com maxChunkBytes pequeno para forçar múltiplos chunks
    const adminSmallChunkSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 1_000,
      readTimeoutMs: 1_000,
      maxChunkBytes: 2 * 1024, // força múltiplos chunks mesmo após compressão fflate
      setMetaFn: async () => {},
      getMetaFn: async (_k, fb) => fb,
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });
    const pubV2 = await adminSmallChunkSvc.publicarSpcoiCentral(
      baseV2.fornecedores,
      baseV2.industrias,
      baseV2.resumo,
      '172'
    );
    assert(pubV2.sucesso === true && (pubV2.totalChunks || 0) >= 2, 'V2 deve gerar >= 2 chunks para o teste.');

    // 6A. Simular chunk_1 faltando no servidor -> deve rejeitar ANTES de tocar o isvService
    const chunk1Path = `filiais/172/spcoi_versoes/${pubV2.versaoId}/chunks/chunk_1`;
    const chunk1Saved = fake.docs.get(chunk1Path);
    fake.docs.delete(chunk1Path);

    const metaDevice = new Map<string, any>([['meta_spcoi_sync', { versaoId: 'spcoi_v1', checksumBase: 'chk_v1' }]]);
    const devRollbackSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      readTimeoutMs: 1_000,
      setMetaFn: async (k, v) => {
        metaDevice.set(k, v);
      },
      getMetaFn: async (k, fb) => (metaDevice.has(k) ? metaDevice.get(k) : fb),
      getLocalFornecedoresCountFn: () => isvService.getFornecedores().length,
    });

    const resMissingChunk = await devRollbackSvc.baixarSpcoiAtivoParaDispositivo('172');
    assert(resMissingChunk.sucesso === false, 'Chunk ausente deve impedir substituição.');
    assert(
      isvService.getFornecedores().length === 80 &&
        isvService.getFornecedores()[0].descricao_spcoi?.includes('V1_ESTAVEL'),
      'Base local V1 no isvService deve permanecer 100% intacta após download incompleto.'
    );

    // Restaura chunk_1
    fake.docs.set(chunk1Path, chunk1Saved);

    // 6B. Simular falha DENTRO da transação atômica do IndexedDB -> rollback integral no isvService!
    const devDbFailSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      readTimeoutMs: 1_000,
      setMetaFn: async (k, v) => {
        metaDevice.set(k, v);
      },
      getMetaFn: async (k, fb) => (metaDevice.has(k) ? metaDevice.get(k) : fb),
      salvarImportacaoSpcoiFn: (forns, inds, res, opcoes) =>
        isvService.salvarImportacaoSpcoi(forns, inds, res, {
          ...opcoes,
          persistirAtomicamente: async (_ops: AtomicBatchOp[]) => {
            throw new Error('QuotaExceededError: Falha simulada na transação IndexedDB');
          },
        }),
    });

    const resDbFail = await devDbFailSvc.baixarSpcoiAtivoParaDispositivo('172', undefined, {
      forcarDownload: true,
    });
    assert(resDbFail.sucesso === false && resDbFail.rollbackExecutado === true, 'Deve reportar rollbackExecutado=true.');
    assert(
      isvService.getFornecedores().length === 80 &&
        isvService.getFornecedores()[0].descricao_spcoi?.includes('V1_ESTAVEL'),
      'Rollback deve restaurar exatamente os 80 fornecedores V1 sem corrupção.'
    );
    assert(
      metaDevice.get('meta_spcoi_sync').versaoId === 'spcoi_v1',
      'Metadado de versão local não pode avançar para V2 após rollback.'
    );
    console.log('  ✓ Substituição atômica com rejeição de chunks incompletos e rollback automático validada.');
  }

  // =========================================================================
  // TESTE 7: PRESERVAÇÃO INTEGRAL (Indústrias, Vínculos Comerciais, BASE RUB,
  //          SAEOU060, Promotores, Agências, Vínculos EAN e Vencimentos)
  // =========================================================================
  console.log('[5/7] Preservação de configurações das indústrias, vínculos comerciais, BASE RUB, SAEOU060, EAN e vencimentos...');
  {
    // 1. Preparar BASE RUB + SAEOU060 + EAN + Vencimentos
    const prodRub: ProdutoSMG = {
      id: '100001_1',
      codigo_original: '100001-1',
      codigo_interno: '100001',
      digito: '1',
      codigo_exibicao: '100001-1',
      descricao: 'CAFE TORRADO RUB OFICIAL 500G',
      embalagem: 'PC 1',
      estoque_emb1: 24,
      estoque_emb9: 2,
      estoque_total: 26,
      vendas_qtde_30d: 10,
      dias_sem_venda: 3,
      idade: 15,
      eans: ['7891234567890'],
      atualizado_em: '2026-11-19T09:00:00.000Z',
    };
    const metaRub: MetadadosBase = {
      filial_numero: '172',
      filial_nome: 'CASCAVEL',
      status_base: 'BASE_RUB',
      total_produtos: 1,
      total_vencimentos: 1,
      total_eans: 1,
      total_saeou060: 1,
    };
    await productRepository.importarBaseRubDireto([prodRub], metaRub);

    const saeouReg: RegistroSaeou060 = {
      id: 'saeou_preservado_1',
      codigo_original: '100001-1',
      codigo_interno: '100001',
      digito: '1',
      codigo_exibicao: '100001-1',
      descricao: 'CAFE TORRADO RUB OFICIAL 500G',
      embalagem: 'PC 1',
      quantidade: 5,
      estoque_loja: 5,
      data_vencimento: '2026-12-30',
      status_saeou: 'NOVO',
      origem: 'SAEOU060',
      arquivo_origem: 'SAEOU060.xlsx',
      data_importacao: '19/11/2026',
      hora_importacao: '09:00:00',
    };
    await productRepository.saveSaeou060Registros([saeouReg]);
    // Desabilitar envio automático de vencimento à nuvem real durante o setup local do teste:
    markQuotaExceeded('Teste offline local', 'ESCRITA');
    await productRepository.saveVencimentos([
      {
        id: 'venc_preservado_1',
        codigo_interno: '100001',
        digito: '1',
        descricao: 'CAFE TORRADO RUB OFICIAL 500G',
        embalagem: 'PC 1',
        fator_embalagem: 1,
        quantidade: 5,
        quantidade_total_unidades: 5,
        data_validade: '2026-12-30',
        data_vencimento: '2026-12-30',
        preco_normal: 19.9,
        preco_trabalhado: 14.9,
        enviar_para_comprador: false,
        status: 'ATIVO',
        filial_id: '172',
        criado_em: '2026-11-19T09:00:00.000Z',
        atualizado_em: '2026-11-19T09:00:00.000Z',
      } as any,
    ]);
    resetQuotaExceeded();

    // 2. Preparar Agência + Promotor + Indústria customizada + Vínculo Comercial
    const prom = await promotorService.cadastrarPromotor({
      nome: 'CARLOS TESTE PROMOTOR',
      agenciaNome: 'AGENCIA CASCAVEL TRADE',
      setores: ['LOJA'],
    });
    const basePreserv = makeRealisticSpcoiBase(20, 2, 'PRESERV_V1');
    const cnpjCustom = basePreserv.industrias[0].cnpj;

    await isvService.salvarImportacaoSpcoi(
      basePreserv.fornecedores,
      basePreserv.industrias,
      basePreserv.resumo
    );
    await isvService.salvarIndustria({
      ...basePreserv.industrias[0],
      nome_exibicao: 'NOME CUSTOMIZADO DA GERENCIA',
      ativo: false,
      observacao_interna: 'MANTER CONFIGURACAO',
    } as any);
    await isvService.vincularPromotorIndustria(prom, cnpjCustom, '172');

    // 3. Publicar e baixar NOVA versão do SPCOI007 (V2) vinda da nuvem (com nome padrão e ativo=true)
    const baseNuvemV2 = makeRealisticSpcoiBase(35, 3, 'NUVEM_V2');
    // Mesmo CNPJ recebe razão social da planilha sem customizações da loja
    baseNuvemV2.industrias[0].nome_exibicao = baseNuvemV2.industrias[0].razao_social;
    baseNuvemV2.industrias[0].ativo = true;

    const fake = new OfflineSpcoiFirestoreFake();
    const adminSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 1_000,
      readTimeoutMs: 1_000,
      setMetaFn: async () => {},
      getMetaFn: async (_k, fb) => fb,
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });
    await adminSvc.publicarSpcoiCentral(
      baseNuvemV2.fornecedores,
      baseNuvemV2.industrias,
      baseNuvemV2.resumo,
      '172'
    );

    const atomicStoresTouched: string[] = [];
    const devSyncSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      readTimeoutMs: 1_000,
      setMetaFn: async () => {},
      getMetaFn: async (_k, fb) => fb,
      salvarImportacaoSpcoiFn: (forns, inds, res, opcoes) =>
        isvService.salvarImportacaoSpcoi(forns, inds, res, {
          ...opcoes,
          persistirAtomicamente: async (ops: AtomicBatchOp[]) => {
            ops.forEach((op) => atomicStoresTouched.push(op.storeName));
          },
        }),
    });

    const rubAntes = JSON.stringify(productRepository.getProdutos());
    const saeouAntes = JSON.stringify(productRepository.getSaeou060Registros());
    const vencAntes = JSON.stringify(productRepository.getVencimentos());
    assert(productRepository.getProdutos().length === 1, 'Setup BASE RUB válido.');
    assert(productRepository.getSaeou060Registros().length === 1, 'Setup SAEOU060 válido.');
    assert(productRepository.getVencimentos().length === 1, 'Setup Vencimentos válido.');

    const syncRes = await devSyncSvc.verificarSincronizacaoComRemoto('172');
    assert(syncRes.baixouNovaVersao === true, 'Dispositivo deve sincronizar V2.');

    // Verificar isolamento estrito dos stores gravados na transação atômica SPCOI007
    assert(
      atomicStoresTouched.every(
        (s) =>
          s === STORES.SPCOI007_FORNECEDORES ||
          s === STORES.INDUSTRIAS ||
          s === STORES.HISTORICO_IMPORTACOES_SPCOI007 ||
          s === STORES.METADADOS
      ),
      `Sincronização SPCOI007 nunca pode tocar stores externos (tocou: ${atomicStoresTouched.join(', ')}).`
    );

    // Verificar preservação das configurações da indústria e dos vínculos comerciais
    const indPosSync = isvService.getIndustriaByCnpj(cnpjCustom);
    assert(Boolean(indPosSync), 'Indústria customizada deve existir após sync.');
    assert(
      indPosSync!.nome_exibicao === 'NOME CUSTOMIZADO DA GERENCIA',
      `nome_exibicao personalizado deve ser preservado (obteve: ${indPosSync!.nome_exibicao}).`
    );
    assert(indPosSync!.ativo === false, 'Status ativo=false da indústria deve ser preservado.');
    assert(
      (indPosSync as any).observacao_interna === 'MANTER CONFIGURACAO',
      'Campos customizados da indústria devem ser preservados.'
    );
    assert(
      indPosSync!.promotores_responsaveis?.includes('CARLOS TESTE PROMOTOR') === true,
      'promotores_responsaveis sincronizado com os vínculos vivos deve ser preservado.'
    );

    const vinculosPosSync = isvService.getPromotoresDaIndustria(cnpjCustom);
    assert(
      vinculosPosSync.length === 1 && vinculosPosSync[0].promotorId === prom.promotorId,
      'Vínculo comercial Promotor × Indústria deve ser 100% preservado.'
    );

    // Verificar intocabilidade da BASE RUB, SAEOU060, Vencimentos e Promotores/Agências
    assert(
      JSON.stringify(productRepository.getProdutos()) === rubAntes,
      'BASE RUB deve permanecer 100% preservada.'
    );
    assert(
      JSON.stringify(productRepository.getSaeou060Registros()) === saeouAntes,
      'SAEOU060 deve permanecer 100% preservado.'
    );
    assert(
      JSON.stringify(productRepository.getVencimentos()) === vencAntes,
      'Vencimentos devem permanecer 100% preservados.'
    );
    assert(
      promotorService.getPromotorById(prom.promotorId)?.nome === 'CARLOS TESTE PROMOTOR',
      'Promotores e agências devem permanecer 100% preservados.'
    );
    console.log('  ✓ Indústrias customizadas, vínculos comerciais, BASE RUB, SAEOU060, vencimentos e promotores 100% preservados.');
  }

  // =========================================================================
  // TESTE 8: Proteção de cota Spark — idempotência + corte em resource-exhausted
  // =========================================================================
  console.log('[6/7] Proteção Spark: idempotência (0 escritas) e interrupção imediata em resource-exhausted...');
  {
    resetQuotaExceeded();
    const fake = new OfflineSpcoiFirestoreFake();
    const baseSmall = makeRealisticSpcoiBase(350, 8, 'SPARK');

    const adminSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 1_000,
      readTimeoutMs: 1_000,
      maxChunkBytes: 2 * 1024, // 2+ chunks garantidos
      setMetaFn: async () => {},
      getMetaFn: async (_k, fb) => fb,
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: () => makeUsuario('GERENCIA_ADMIN'),
    });

    const p1 = await adminSvc.publicarSpcoiCentral(
      baseSmall.fornecedores,
      baseSmall.industrias,
      baseSmall.resumo,
      '172'
    );
    assert(p1.sucesso === true && (p1.totalChunks || 0) >= 2, '1a publicação Spark deve gerar >= 2 chunks.');

    // Republicação idêntica: ZERO escritas e ZERO transações
    fake.resetCounters();
    const p2 = await adminSvc.publicarSpcoiCentral(
      baseSmall.fornecedores,
      baseSmall.industrias,
      baseSmall.resumo,
      '172'
    );
    assert(p2.sucesso === true && p2.semAlteracoesPulouEnvio === true, 'Republicação idêntica deve pular envio.');
    assert(fake.setDocCalls.length === 0 && fake.txnCalls === 0, 'Idempotência deve fazer 0 escritas e 0 transações.');

    // Nova base com erro resource-exhausted no chunk_1: para imediatamente sem retentativas e preserva ponteiro anterior
    const baseModified = makeRealisticSpcoiBase(360, 8, 'SPARK_MOD');
    fake.resetCounters();
    fake.onSetDoc = (path) => {
      if (path.endsWith('/chunks/chunk_1')) {
        throw Object.assign(new Error('Resource-exhausted: free tier daily write quota exceeded'), {
          code: 'resource-exhausted',
        });
      }
    };

    const pQuota = await adminSvc.publicarSpcoiCentral(
      baseModified.fornecedores,
      baseModified.industrias,
      baseModified.resumo,
      '172'
    );
    assert(pQuota.sucesso === false && pQuota.estadoPublicacao === 'AGUARDANDO_COTA', 'Deve retornar AGUARDANDO_COTA.');
    assert(fake.setDocCalls.length <= 2, 'Deve interromper no primeiro lote com 0 retentativas.');
    assert(fake.txnCalls === 0, 'Não pode comutar ponteiro em publicação incompleta.');
    assert(
      fake.docs.get('filiais/172/config/versao_ativa_spcoi')?.versaoId === p1.versaoId,
      'Ponteiro ativo anterior (P1) deve ser preservado após falha de cota.'
    );

    resetQuotaExceeded();
    console.log('  ✓ Proteção Spark (idempotência 0-escritas + corte 0-retentativas) validada.');
  }

  // =========================================================================
  // TESTE 9: Limite de memória e tempo — nenhum chunk excede o teto do Firestore
  // =========================================================================
  console.log('[7/7] Verificação final de isolamento da Arquitetura Híbrida V1.0...');
  {
    const { isModoAtualizacaoLocalAtivo } = await import('../localPackageMode');
    assert(
      isModoAtualizacaoLocalAtivo() === true,
      'BASE RUB e SAEOU060 devem permanecer em atualização manual por pacote .zip.'
    );
    console.log('  ✓ Isolamento confirmado: BASE RUB e SAEOU060 continuam exclusivos em atualização local (.zip).');
  }

  console.log('\n✅ TODOS OS 7 BLOCOS DE TESTE DA ETAPA 2 (SPCOI007 HÍBRIDA V1.0) PASSARAM!');
}

runEtapa2Tests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ ERRO NOS TESTES DA ETAPA 2:', err);
    process.exit(1);
  });
