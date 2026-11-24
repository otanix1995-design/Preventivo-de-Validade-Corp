/**
 * Testes Offline de Regressão — Correção do Erro de Sincronização Firebase (Arquitetura Híbrida V1.0)
 *
 * IMPORTANTE: Execução 100% OFFLINE (zero gravações/leituras no Firestore real).
 *
 * Valida:
 * 1. Bloqueio permanente do método legado `centralFirestoreService.sincronizarBaseComNuvem` (batches de 300).
 * 2. Bloqueio permanente de `cloudSyncService.pushCatalogoToCloud`, `pullCatalogoFromCloud`,
 *    `pushSaeou060ToCloud` e `pullSaeou060FromCloud`.
 * 3. `productRepository.syncWithCloud()` nunca dispara envio em lote da BASE RUB nem SAEOU060,
 *    acionando exclusivamente os serviços ativos (Vencimentos/Vínculos EAN, SPCOI007 e Comercial).
 * 4. `baseSyncStatusService.sincronizarTodasBases()` mantém BASE RUB e SAEOU060 exclusivamente
 *    locais no IndexedDB (via .zip) e verifica apenas SPCOI007 remotamente.
 * 5. `buildVencimentoCentralPayload()` e `sanitizeLoteForFirestore()` removem chaves proibidas
 *    pelas regras do Firestore (`version`, `criadoPorTipo`, `criadoPorId`, `atualizadoPorTipo`, `atualizadoPorId`)
 *    e respeitam `ALLOWED_LOTE_KEYS_CREATE` / `ALLOWED_LOTE_KEYS_UPDATE`.
 * 6. `formatarErroSyncPorServico()` identifica serviço, coleção, operação e código exato
 *    para `permission-denied` e `resource-exhausted`, sem mascarar a coleção afetada.
 * 7. `cloudSyncService.pushVinculosToCloudDetailed()` bloqueia escrita sem autenticação `GERENCIA_ADMIN`
 *    retornando diagnóstico explícito das coleções `vinculos_chunks / metadados/geral`.
 */

import { centralFirestoreService } from '../centralFirestoreService';
import { cloudSyncService } from '../cloudSyncService';
import { productRepository } from '../productRepository';
import { baseSyncStatusService } from '../baseSyncStatusService';
import { spcoiSyncService } from '../spcoiSyncService';
import { comercialSyncService } from '../comercialSyncService';
import { rubSyncService } from '../rubSyncService';
import { saeouSyncService } from '../saeouSyncService';
import {
  ALLOWED_LOTE_KEYS_CREATE,
  ALLOWED_LOTE_KEYS_UPDATE,
  buildVencimentoCentralPayload,
  sanitizeLoteForFirestore,
} from '../deviceId';
import {
  formatarErroSyncPorServico,
  OperationType,
  resetQuotaExceeded,
  isFirestoreQuotaExceeded,
} from '../firebase';
import { LoteVencimento, ProdutoSMG } from '../../types';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${msg}`);
  }
}

async function runCorrecaoSyncHibridaTests(): Promise<void> {
  console.log('\n==========================================================================');
  console.log('TESTES OFFLINE — CORREÇÃO ERRO DE SINCRONIZAÇÃO FIREBASE (HÍBRIDA V1.0)');
  console.log('==========================================================================\n');

  resetQuotaExceeded();

  // -------------------------------------------------------------------------
  // 1. BLOQUEIO PERMANENTE DO MECANISMO LEGADO DE BATCHES DE 300 (BASE RUB)
  // -------------------------------------------------------------------------
  console.log('[1/7] Validando bloqueio permanente de centralFirestoreService.sincronizarBaseComNuvem...');
  {
    const produtoFake: ProdutoSMG = {
      id: 'p1',
      codigo_interno: '76916',
      digito: '185',
      codigo_original: '76916-185',
      codigo_exibicao: '76916-185',
      descricao: 'RF.PAO ALHO MEZZANI TRAD.',
      embalagem: 'UN 1',
      setor_fisico: 'FRIOS',
      setor_balanco: 'FRIOS',
      estoque_emb1: 10,
      estoque_emb9: 2,
      estoque_total: 12,
      vendas_qtde_30d: 5,
      dias_sem_venda: 2,
      idade: 15,
      eans: [],
      atualizado_em: '2026-11-19T12:00:00Z',
    };

    const res = await centralFirestoreService.sincronizarBaseComNuvem({
      produtos: [produtoFake],
      vinculos: [],
      vencimentos: [],
      promotores: [],
      vinculosPromotores: [],
      filialPadrao: '172',
    });

    assert(res.sucesso === false, 'sincronizarBaseComNuvem não pode retornar sucesso=true.');
    assert(
      res.bloqueadoArquiteturaHibrida === true,
      'sincronizarBaseComNuvem deve sinalizar bloqueio pela Arquitetura Híbrida V1.0.'
    );
    assert(res.stats.produtos === 0, 'Nenhum produto da BASE RUB pode ser contabilizado para envio.');
  }
  console.log('  ✓ Bloqueio permanente de centralFirestoreService.sincronizarBaseComNuvem confirmado.');

  // -------------------------------------------------------------------------
  // 2. BLOQUEIO PERMANENTE PUSH/PULL DE BASE RUB E SAEOU060 NO CLOUDSYNCSERVICE
  // -------------------------------------------------------------------------
  console.log('[2/7] Validando bloqueio de push/pull legado no cloudSyncService...');
  {
    const pushedRub = await cloudSyncService.pushCatalogoToCloud([], {
      filial_numero: '172',
      filial_nome: 'CASCAVEL',
      status_base: 'BASE_RUB',
      total_produtos: 0,
      total_vencimentos: 0,
      total_eans: 0,
      total_saeou060: 0,
    });
    const pulledRub = await cloudSyncService.pullCatalogoFromCloud();
    const pushedSaeou = await cloudSyncService.pushSaeou060ToCloud([]);
    const pulledSaeou = await cloudSyncService.pullSaeou060FromCloud();

    assert(pushedRub === false, 'pushCatalogoToCloud deve retornar false.');
    assert(pulledRub === false, 'pullCatalogoFromCloud deve retornar false.');
    assert(pushedSaeou === false, 'pushSaeou060ToCloud deve retornar false.');
    assert(pulledSaeou === false, 'pullSaeou060FromCloud deve retornar false.');
  }
  console.log('  ✓ Bloqueio permanente de BASE RUB e SAEOU060 no cloudSyncService confirmado.');

  // -------------------------------------------------------------------------
  // 3. PRODUCT REPOSITORY SYNCWITHCLOUD EXCLUSIVAMENTE HÍBRIDO
  // -------------------------------------------------------------------------
  console.log('[3/7] Validando productRepository.syncWithCloud sem BASE RUB nem SAEOU060...');
  {
    let centralCalled = false;
    let syncFullArgs: { prods: number; saeou: number } | null = null;
    let spcoiChecked = false;
    let comercialSynced = false;

    const origCentral = centralFirestoreService.sincronizarBaseComNuvem;
    const origSyncFull = cloudSyncService.syncFull;
    const origSpcoi = spcoiSyncService.verificarSincronizacaoComRemoto;
    const origComercial = comercialSyncService.sincronizarAgora;

    centralFirestoreService.sincronizarBaseComNuvem = async () => {
      centralCalled = true;
      return {
        sucesso: false,
        mensagem: 'nao deveria ser chamado',
        stats: { produtos: 0, vinculosEan: 0, vencimentos: 0, promotores: 0, vinculosPromotor: 0 },
      };
    };
    cloudSyncService.syncFull = async (prods, _meta, _vinc, saeou) => {
      syncFullArgs = { prods: prods.length, saeou: saeou.length };
      return { success: true, message: 'ok' };
    };
    spcoiSyncService.verificarSincronizacaoComRemoto = async () => {
      spcoiChecked = true;
      return { verificado: true, baixouNovaVersao: false };
    };
    comercialSyncService.sincronizarAgora = async () => {
      comercialSynced = true;
      return { sucesso: true, enviados: 0, recebidos: 0, pendentes: 0, mensagem: 'ok' };
    };

    try {
      const syncRes = await productRepository.syncWithCloud();
      assert(syncRes.success === true, `syncWithCloud deveria concluir com sucesso: ${syncRes.message}`);
      assert(!centralCalled, 'syncWithCloud jamais pode chamar centralFirestoreService.sincronizarBaseComNuvem.');
      assert(syncFullArgs !== null && syncFullArgs.prods === 0 && syncFullArgs.saeou === 0, 'syncFull deve receber arrays vazios para BASE RUB e SAEOU060.');
      assert(spcoiChecked, 'syncWithCloud deve verificar SPCOI007 compactado.');
      assert(comercialSynced, 'syncWithCloud deve acionar comercialSyncService.');
    } finally {
      centralFirestoreService.sincronizarBaseComNuvem = origCentral;
      cloudSyncService.syncFull = origSyncFull;
      spcoiSyncService.verificarSincronizacaoComRemoto = origSpcoi;
      comercialSyncService.sincronizarAgora = origComercial;
    }
  }
  console.log('  ✓ productRepository.syncWithCloud alinhado à Arquitetura Híbrida V1.0.');

  // -------------------------------------------------------------------------
  // 4. BASESYNCSTATUSSERVICE PRESERVANDO BASE RUB E SAEOU060 NO .ZIP
  // -------------------------------------------------------------------------
  console.log('[4/7] Validando baseSyncStatusService.sincronizarTodasBases no modo Híbrido...');
  {
    let rubRemoteChecks = 0;
    let saeouRemoteChecks = 0;
    let spcoiRemoteChecks = 0;

    const origRub = rubSyncService.verificarSincronizacaoComRemoto;
    const origSaeou = saeouSyncService.verificarSincronizacaoComRemoto;
    const origSpcoi = spcoiSyncService.verificarSincronizacaoComRemoto;

    (rubSyncService as any).verificarSincronizacaoComRemoto = async () => {
      rubRemoteChecks++;
    };
    (saeouSyncService as any).verificarSincronizacaoComRemoto = async () => {
      saeouRemoteChecks++;
    };
    spcoiSyncService.verificarSincronizacaoComRemoto = async () => {
      spcoiRemoteChecks++;
      return { verificado: true, baixouNovaVersao: false };
    };

    try {
      const res = await baseSyncStatusService.sincronizarTodasBases('172');
      assert(rubRemoteChecks === 0, 'BASE RUB não deve ser verificada no Firestore em modo Híbrido (.zip).');
      assert(saeouRemoteChecks === 0, 'SAEOU060 não deve ser verificada no Firestore em modo Híbrido (.zip).');
      assert(spcoiRemoteChecks === 1, 'SPCOI007 deve ser verificada no Firestore.');
      assert(res.rub.mensagem.includes('.zip') && res.saeou.mensagem.includes('.zip'), 'Mensagens devem confirmar isolamento .zip.');
    } finally {
      rubSyncService.verificarSincronizacaoComRemoto = origRub;
      saeouSyncService.verificarSincronizacaoComRemoto = origSaeou;
      spcoiSyncService.verificarSincronizacaoComRemoto = origSpcoi;
    }
  }
  console.log('  ✓ baseSyncStatusService preserva BASE RUB e SAEOU060 exclusivamente locais via .zip.');

  // -------------------------------------------------------------------------
  // 5. SANITIZAÇÃO ESTRITA DE LOTE CONTRA FIRESTORE RULES (SEM VERSION / *PORTIPO)
  // -------------------------------------------------------------------------
  console.log('[5/7] Validando buildVencimentoCentralPayload e sanitizeLoteForFirestore...');
  {
    const loteComCamposExtras: LoteVencimento & Record<string, any> = {
      id: '172_76916_185_2026-12-30',
      vencimentoId: '172_76916_185_2026-12-30',
      filialId: '172',
      codigo_interno: '76916',
      digito: '185',
      codigo_exibicao: '76916-185',
      descricao_produto: 'PAO ALHO MEZZANI',
      embalagem: 'UN 1',
      data_validade: '2026-12-30',
      quantidade_total_unidades: 10,
      enviar_ao_comprador: false,
      origem: 'MANUAL',
      criado_em: '2026-11-01T10:00:00Z',
      atualizado_em: '2026-11-19T12:00:00Z',
      version: 99,
      criadoPorTipo: 'PRINCIPAL',
      criadoPorId: 'UID_EXTRA',
      atualizadoPorTipo: 'PROMOTOR',
      atualizadoPorId: 'PROM_1',
    };

    const payloadCreate = buildVencimentoCentralPayload(loteComCamposExtras, 'op_test_1');
    const proibidas = ['version', 'criadoPorTipo', 'criadoPorId', 'atualizadoPorTipo', 'atualizadoPorId'];
    for (const k of proibidas) {
      assert(!(k in payloadCreate), `Campo proibido "${k}" vazou para payloadCreate.`);
    }
    for (const k of Object.keys(payloadCreate)) {
      assert(ALLOWED_LOTE_KEYS_CREATE.has(k), `Chave "${k}" em create não pertence a isAllowedLoteKeys.`);
    }

    const payloadUpdate = sanitizeLoteForFirestore(payloadCreate, {
      isUpdate: true,
      remoteData: {
        filialId: '172',
        id: payloadCreate.id,
        vencimentoId: payloadCreate.vencimentoId,
        codigoInterno: '76916',
        criadoEm: '2026-11-01T10:00:00Z',
      },
    });
    for (const k of Object.keys(payloadUpdate)) {
      assert(ALLOWED_LOTE_KEYS_UPDATE.has(k), `Chave "${k}" em update não pertence a isValidLoteUpdate.affectedKeys().`);
    }
    assert(!('criadoEm' in payloadUpdate) && !('codigoInterno' in payloadUpdate), 'Campos imutáveis devem ser removidos quando remoteData existir.');
  }
  console.log('  ✓ Payloads de vencimentos 100% conformes com isAllowedLoteKeys e isValidLoteUpdate.');

  // -------------------------------------------------------------------------
  // 6. FORMATAÇÃO EXPLÍCITA DE ERRO POR SERVIÇO E COLEÇÃO
  // -------------------------------------------------------------------------
  console.log('[6/7] Validando formatarErroSyncPorServico (permission-denied & resource-exhausted)...');
  {
    const errPerm = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    const detPerm = formatarErroSyncPorServico(errPerm, 'Vínculos EAN', 'vinculos_chunks', OperationType.WRITE);
    assert(detPerm.codigoErro === 'permission-denied', 'Deve preservar código permission-denied.');
    assert(detPerm.servico === 'Vínculos EAN', 'Deve preservar o nome do serviço.');
    assert(detPerm.colecao === 'vinculos_chunks', 'Deve preservar a coleção exata.');
    assert(
      detPerm.mensagemUsuario.includes('Vínculos EAN') && detPerm.mensagemUsuario.includes('vinculos_chunks'),
      'Mensagem ao usuário deve citar serviço e coleção.'
    );
    assert(!isFirestoreQuotaExceeded(), 'Erro de permissão NÃO pode acionar bloqueio de cota.');

    const errQuota = Object.assign(new Error('Quota exceeded on writes'), { code: 'resource-exhausted' });
    const detQuota = formatarErroSyncPorServico(errQuota, 'SPCOI007', 'filiais/172/spcoi_versoes', OperationType.WRITE);
    assert(detQuota.isCotaExcedida === true && detQuota.codigoErro === 'resource-exhausted', 'Deve identificar cota excedida.');
    assert(isFirestoreQuotaExceeded(), 'Erro de cota deve acionar trava Spark.');
    resetQuotaExceeded();
  }
  console.log('  ✓ Formatação diagnóstica por serviço e coleção verificada.');

  // -------------------------------------------------------------------------
  // 7. VÍNCULOS EAN PROTEGE ESCRITA QUANDO NÃO HÁ AUTENTICAÇÃO GERENCIA_ADMIN
  // -------------------------------------------------------------------------
  console.log('[7/7] Validando pushVinculosToCloudDetailed sem GERENCIA_ADMIN...');
  {
    const pushRes = await cloudSyncService.pushVinculosToCloudDetailed([
      {
        id: 'v_test_1',
        codigo_interno: '76916',
        digito: '185',
        ean: '7896216100909',
        descricao: 'PRODUTO TESTE',
        status_vinculo: 'VINCULADO',
        criado_em: '19/11/2026',
      },
    ]);
    assert(pushRes.sucesso === false, 'pushVinculosToCloudDetailed sem GERENCIA_ADMIN deve recusar escrita localmente.');
    assert(
      pushRes.erroDetalhe?.exigeGerenciaAdmin === true &&
        pushRes.erroDetalhe.colecao.includes('vinculos_chunks'),
      'Deve informar exatamente coleção vinculos_chunks / metadados/geral e exigência GERENCIA_ADMIN.'
    );
  }
  console.log('  ✓ Guarda de escrita em Vínculos EAN confirmada.');

  console.log('\n==========================================================================');
  console.log('✅ TODOS OS 7 TESTES DE CORREÇÃO HÍBRIDA V1.0 PASSARAM 100% OFFLINE!');
  console.log('==========================================================================\n');
  process.exit(0);
}

runCorrecaoSyncHibridaTests().catch((err) => {
  console.error('❌ ERRO NOS TESTES HÍBRIDOS:', err);
  process.exit(1);
});
