/**
 * Suite de Verificação de Blindagem de Dados e Regras de Segurança (Etapa 1 — Híbrida V1.0)
 * Cobre:
 * - Os 12 vetores "Dirty Dozen" (Phase 0 / Phase 5 Red Team)
 * - Os 8 Pilares e continuidade operacional sem login manual
 * - Blindagem de isolamento SPCOI007 x BASE RUB e anti-escalonamento de privilégios
 * - Sincronia estrutural entre firestore.rules e firebase-blueprint.json
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SecurityRulesValidator, ContextoAutenticacaoSimulado } from './src/services/securityRulesValidator';
import { AuthRoleService } from './src/services/authRoleService';
import { IsvService } from './src/services/isvService';

const validator = new SecurityRulesValidator();

const anonAuth: ContextoAutenticacaoSimulado = {
  uid: null,
  filialId: null,
  role: null,
  isAnonimo: true,
};

const operatorAuth: ContextoAutenticacaoSimulado = {
  uid: 'operador_uid_172',
  filialId: '172',
  role: 'OPERADOR_LOJA',
  email: 'operador@loja172.com',
  emailVerified: true,
  isAnonimo: false,
  ativo: true,
  temDocumentoServidor: true,
};

const adminAuth: ContextoAutenticacaoSimulado = {
  uid: 'admin_uid_172',
  filialId: '172',
  role: 'GERENCIA_ADMIN',
  email: 'jottarms@gmail.com',
  emailVerified: true,
  isAnonimo: false,
  ativo: true,
  temDocumentoServidor: true,
};

function testDirtyDozen() {
  // DD-01: Auto-provisionamento de admin no client Web
  const dd01 = validator.avaliarRequisicao(
    { uid: 'attacker', filialId: '172', role: null, email: 'jottarms@gmail.com', emailVerified: true },
    {
      metodo: 'create',
      caminho: '/usuarios_autorizados/attacker',
      novosDados: { uid: 'attacker', papel: 'GERENCIA_ADMIN', filialId: '172', ativo: true },
    }
  );
  assert.equal(dd01.permitido, false, `DD-01 deve ser negado: ${dd01.motivo}`);

  // DD-02: PII Blanket List em /usuarios_autorizados por não-admin
  const dd02 = validator.avaliarRequisicao(operatorAuth, {
    metodo: 'list',
    caminho: '/usuarios_autorizados',
  });
  assert.equal(dd02.permitido, false, `DD-02 deve ser negado: ${dd02.motivo}`);

  // DD-03: Email spoofing com email_verified == false
  const dd03 = validator.avaliarRequisicao(
    { uid: 'spoof_uid', filialId: '172', role: null, email: 'jottarms@gmail.com', emailVerified: false },
    {
      metodo: 'create',
      caminho: '/filiais/172/spcoi_versoes/spcoi_spoof',
      novosDados: { versaoId: 'spcoi_spoof', filialId: '172' },
    }
  );
  assert.equal(dd03.permitido, false, `DD-03 deve ser negado: ${dd03.motivo}`);

  // DD-04: Consulta / listagem de tokens e códigos de vínculo por usuário não autorizado
  const dd04Get = validator.avaliarRequisicao(operatorAuth, {
    metodo: 'get',
    caminho: '/vinculosPromotor/vinc_001',
  });
  const dd04List = validator.avaliarRequisicao(anonAuth, {
    metodo: 'list',
    caminho: '/vinculos_promotores',
  });
  assert.equal(dd04Get.permitido, false, 'DD-04 get deve ser negado');
  assert.equal(dd04List.permitido, false, 'DD-04 list deve ser negado');

  // DD-05: Cadastro não autorizado de promotor
  const dd05 = validator.avaliarRequisicao(operatorAuth, {
    metodo: 'create',
    caminho: '/promotores/prom_hack',
    novosDados: { promotorId: 'prom_hack', nome: 'Invasor', filialId: '172' },
  });
  assert.equal(dd05.permitido, false, 'DD-05 deve ser negado');

  // DD-06: Edição/exclusão não autorizada de agência e vínculo comercial
  const dd06Ag = validator.avaliarRequisicao(anonAuth, {
    metodo: 'create',
    caminho: '/agencias/ag_hack',
    novosDados: { agenciaId: 'ag_hack', nome: 'Agencia Hack', filialId: '172' },
  });
  const dd06Link = validator.avaliarRequisicao(operatorAuth, {
    metodo: 'delete',
    caminho: '/vinculos_promotor_industria/vpi_01',
  });
  assert.equal(dd06Ag.permitido, false, 'DD-06 agencia deve ser negado');
  assert.equal(dd06Link.permitido, false, 'DD-06 vinculo comercial deve ser negado');

  // DD-07: Shadow Update (campo fantasma) em vencimentos
  const dd07 = validator.avaliarRequisicao(anonAuth, {
    metodo: 'update',
    caminho: '/filiais/172/vencimentos/lote_01',
    dadosExistentes: { id: 'lote_01', filialId: '172', codigoInterno: '85327', quantidade: 10 },
    novosDados: { id: 'lote_01', filialId: '172', codigoInterno: '85327', quantidade: 12, _adminOverride: true },
  });
  assert.equal(dd07.permitido, false, 'DD-07 shadow field deve ser negado');

  // DD-08: Value Poisoning (quantidade fora de limite / tipo inválido) em vencimentos globais
  const dd08 = validator.avaliarRequisicao(anonAuth, {
    metodo: 'create',
    caminho: '/vencimentos/lote_poison',
    novosDados: {
      id: 'lote_poison',
      filialId: '172',
      codigoInterno: '85327',
      dataVencimento: '2026-12-31',
      quantidade: 999999999,
    },
  });
  assert.equal(dd08.permitido, false, 'DD-08 value poisoning deve ser negado');

  // DD-09: ID Poisoning (traversal ..)
  const dd09 = validator.avaliarRequisicao(anonAuth, {
    metodo: 'create',
    caminho: '/vencimentos/id..malicioso',
    novosDados: {
      filialId: '172',
      codigoInterno: '85327',
      dataVencimento: '2026-12-31',
      quantidade: 5,
    },
  });
  assert.equal(dd09.permitido, false, 'DD-09 ID poisoning deve ser negado');

  // DD-10: Reatribuição de SKU / adulteração de origem imutável em vencimentos
  const dd10Sku = validator.avaliarRequisicao(anonAuth, {
    metodo: 'update',
    caminho: '/vencimentos/lote_01',
    dadosExistentes: { filialId: '172', codigo_interno: '85327', origem: 'SAEOU060', quantidade: 10 },
    novosDados: { filialId: '172', codigo_interno: '99999', origem: 'SAEOU060', quantidade: 10 },
  });
  const dd10Orig = validator.avaliarRequisicao(anonAuth, {
    metodo: 'update',
    caminho: '/vencimentos/lote_01',
    dadosExistentes: { filialId: '172', codigo_interno: '85327', origem: 'SAEOU060', quantidade: 10 },
    novosDados: { filialId: '172', codigo_interno: '85327', origem: 'MANUAL', quantidade: 10 },
  });
  assert.equal(dd10Sku.permitido, false, 'DD-10 reatribuição de SKU deve ser negada');
  assert.equal(dd10Orig.permitido, false, 'DD-10 alteração de origem deve ser negada');

  // DD-11: State Shortcutting / alteração pós-terminal em solicitações de promotor
  const dd11Create = validator.avaliarRequisicao(anonAuth, {
    metodo: 'create',
    caminho: '/solicitacoesVencimentoPromotor/sol_hack',
    novosDados: {
      filialId: '172',
      promotorId: 'prom_01',
      codigoInterno: '85327',
      status: 'APROVADO',
      quantidadeTotalUnidades: 5,
    },
  });
  const dd11PostTerminal = validator.avaliarRequisicao(operatorAuth, {
    metodo: 'update',
    caminho: '/solicitacoesVencimentoPromotor/sol_01',
    dadosExistentes: { filialId: '172', promotorId: 'prom_01', codigoInterno: '85327', status: 'APROVADO' },
    novosDados: { filialId: '172', promotorId: 'prom_01', codigoInterno: '85327', status: 'PENDENTE_ANALISE' },
  });
  assert.equal(dd11Create.permitido, false, 'DD-11 autoaprovação no create deve ser negada');
  assert.equal(dd11PostTerminal.permitido, false, 'DD-11 regressão pós-terminal deve ser negada');

  // DD-12: Adulteração de auditoria + Zero-Trust coleção desconhecida
  const dd12Audit = validator.avaliarRequisicao(adminAuth, {
    metodo: 'update',
    caminho: '/auditoria/audit_01',
    novosDados: { valorNovo: 'adulterado' },
  });
  const dd12ZeroTrust = validator.avaliarRequisicao(anonAuth, {
    metodo: 'get',
    caminho: '/segredos_nao_mapeados/doc_01',
  });
  assert.equal(dd12Audit.permitido, false, 'DD-12 auditoria imutável deve ser negada');
  assert.equal(dd12ZeroTrust.permitido, false, 'DD-12 zero-trust deve negar rota desconhecida');
}

function testLegitimateFlowsAndBuiltInSuite() {
  const relatorio = validator.executarSuiteDeTestes();
  assert.equal(
    relatorio.todosPassaram,
    true,
    `Suite interna falhou: ${JSON.stringify(relatorio.resultados.filter((r) => !r.sucesso), null, 2)}`
  );

  // Admin autorizado consegue gerenciar agências, promotores, vínculos e consultar tokens
  assert.equal(
    validator.avaliarRequisicao(adminAuth, {
      metodo: 'create',
      caminho: '/agencias/ag_01',
      novosDados: { agenciaId: 'ag_01', nome: 'Agência Sul', filialId: '172', ativo: true },
    }).permitido,
    true
  );
  assert.equal(
    validator.avaliarRequisicao(adminAuth, {
      metodo: 'list',
      caminho: '/vinculosPromotor',
    }).permitido,
    true
  );
  assert.equal(
    validator.avaliarRequisicao(anonAuth, {
      metodo: 'get',
      caminho: '/test/connection',
    }).permitido,
    true
  );
}

async function testStage1CodeShieldingInvariants() {
  // 1. Anti-escalonamento de privilégios no AuthRoleService
  const roleSvc = new AuthRoleService();
  assert.notEqual(roleSvc.getPapel(), 'GERENCIA_ADMIN');

  const tentativaLocal = roleSvc.alternarPapel('GERENCIA_ADMIN');
  assert.equal(tentativaLocal.alterado, false, 'alternarPapel("GERENCIA_ADMIN") sem login no servidor deve ser bloqueado');
  assert.notEqual(roleSvc.getPapel(), 'GERENCIA_ADMIN');

  roleSvc.setUsuario({ nome: 'Forjado', papel: 'GERENCIA_ADMIN', filialId: '172' });
  assert.notEqual(roleSvc.getPapel(), 'GERENCIA_ADMIN', 'setUsuario não deve elevar para GERENCIA_ADMIN sem servidor');
  assert.equal(roleSvc.podePublicarRub().permitido, false);

  // Tentativa não verificada no servidor
  roleSvc.aplicarSessaoServidorVerificada({
    autenticado: true,
    isVerificadoServidor: false,
    uid: 'u1',
    email: 'jottarms@gmail.com',
    nome: 'Gerente',
    filialId: '172',
    papel: 'GERENCIA_ADMIN',
  });
  assert.equal(roleSvc.podePublicarRub().permitido, false, 'Sessão não verificada não pode habilitar GERENCIA_ADMIN');

  // Sessão real verificada habilita GERENCIA_ADMIN
  roleSvc.aplicarSessaoServidorVerificada({
    autenticado: true,
    isVerificadoServidor: true,
    uid: 'u1',
    email: 'jottarms@gmail.com',
    nome: 'Gerente',
    filialId: '172',
    papel: 'GERENCIA_ADMIN',
  });
  assert.equal(roleSvc.podePublicarRub().permitido, true);
  assert.equal(roleSvc.getPapel(), 'GERENCIA_ADMIN');

  // Logout revoga GERENCIA_ADMIN imediatamente
  roleSvc.aplicarSessaoServidorVerificada({
    autenticado: false,
    isVerificadoServidor: false,
  });
  assert.equal(roleSvc.podePublicarRub().permitido, false);
  assert.notEqual(roleSvc.getPapel(), 'GERENCIA_ADMIN');

  // 2. Isolamento absoluto SPCOI007 x BASE RUB (IsvService)
  const isvSvc = new IsvService();
  (isvSvc as any)._registrosIsvOperacional = [
    {
      codigo_interno: '85327',
      digito: '177',
      descricao: 'PRODUTO TESTE BASE RUB',
      filial: '172',
      estoque_emb1: 10,
      estoque_emb9: 2,
      valor_estoque: 250,
    },
  ];
  (isvSvc as any)._historicoIsv = [{ id: 'hist_rub_1', nome_arquivo: 'base_rub.xlsx' }];

  isvSvc.redefinirSpcoiAposLimpeza();
  assert.equal(
    isvSvc.getRegistrosIsvOperacional().length,
    1,
    'Limpeza da SPCOI007 jamais pode apagar registros operacionais da BASE RUB'
  );
  assert.equal(
    (isvSvc as any)._historicoIsv.length,
    1,
    'Limpeza da SPCOI007 jamais pode apagar histórico da BASE RUB'
  );
}

function testRulesAndBlueprintConsistency() {
  const rulesContent = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf8'));

  assert.ok(rulesContent.includes("rules_version = '2';"));
  assert.ok(rulesContent.includes('match /{document=**} {\n      allow read, write: if false;\n    }'));
  assert.ok(rulesContent.includes('email_verified == true'));
  assert.ok(rulesContent.includes('affectedKeys().hasOnly'));
  assert.ok(rulesContent.includes('function isValidId(id)'));
  assert.equal(rulesContent.includes('allow read: if true;'), false, 'Não deve haver allow read: if true genérico');
  assert.equal(rulesContent.includes('allow write: if true;'), false, 'Não deve haver allow write: if true genérico');
  assert.ok(rulesContent.includes('match /agencias/{agenciaId}'));
  assert.ok(rulesContent.includes('match /vinculos_promotor_industria/{vinculoId}'));
  assert.ok(rulesContent.includes('match /test/{docId}'));

  const firestorePaths = Object.keys(blueprint.firestore || {});
  assert.ok(firestorePaths.includes('/usuarios_autorizados/{userId}'));
  assert.ok(firestorePaths.includes('/agencias/{agenciaId}'));
  assert.ok(firestorePaths.includes('/vinculos_promotor_industria/{vinculoId}'));
  assert.ok(firestorePaths.includes('/vinculosPromotor/{vinculoId}'));
  assert.ok(firestorePaths.includes('/test/{docId}'));
}

async function main() {
  testDirtyDozen();
  testLegitimateFlowsAndBuiltInSuite();
  await testStage1CodeShieldingInvariants();
  testRulesAndBlueprintConsistency();
  console.log('✅ firestore.rules.test.ts: Todos os testes (Dirty Dozen + Eight Pillars + Isolamento SPCOI/RUB + Anti-Escalonamento) PASSARAM!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Falha em firestore.rules.test.ts:', err);
  process.exit(1);
});
