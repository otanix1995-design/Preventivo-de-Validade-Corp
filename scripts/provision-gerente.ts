/**
 * Script de Provisionamento Seguro de Gerência (Firebase Admin SDK)
 * 
 * USO EXCLUSIVO EM AMBIENTE SERVIDOR / CLI ADMINISTRATIVO
 * 
 * Este script deve ser executado com credenciais de Service Account (Google Cloud / Firebase Console),
 * garantindo que nenhum usuário comum no navegador consiga criar ou promover privilégios.
 * 
 * Execução:
 * npx tsx scripts/provision-gerente.ts <USER_UID>
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';

async function provisionarGerente() {
  const targetUid = process.argv[2];

  if (!targetUid) {
    console.error('❌ ERRO: Forneça o UID do usuário gerado no Firebase Auth.');
    console.log('Exemplo: npx tsx scripts/provision-gerente.ts 4h9f8dYhd8...');
    process.exit(1);
  }

  // Verifica se existe serviceAccountKey.json
  const serviceAccountPath = './serviceAccountKey.json';
  if (!fs.existsSync(serviceAccountPath)) {
    console.log('ℹ️ Para provisionamento automatizado via Admin SDK:');
    console.log('1. Baixe a chave privada de Service Account no Firebase Console:');
    console.log('   Configurações do Projeto > Contas de Serviço > Gerar nova chave privada');
    console.log('2. Salve como serviceAccountKey.json');
    console.log('3. Execute este script novamente.');
    console.log('\n--- OU CRIE DIRETAMENTE NO FIREBASE CONSOLE ---');
    console.log('Coleção: usuarios_autorizados');
    console.log(`Documento ID: ${targetUid}`);
    console.log('Campos:');
    console.log(JSON.stringify({
      uid: targetUid,
      email: 'jottarms@gmail.com',
      nome: 'Gerente Geral Filial 172',
      matricula: 'GER_172',
      papel: 'GERENCIA_ADMIN',
      filialId: '172',
      ativo: true,
      criadoEm: new Date().toISOString()
    }, null, 2));
    process.exit(0);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
    });
  }

  const adminDb = getFirestore();
  const userDocRef = adminDb.collection('usuarios_autorizados').doc(targetUid);

  const payload = {
    uid: targetUid,
    email: 'jottarms@gmail.com',
    nome: 'Gerente Geral Filial 172',
    matricula: 'GER_172',
    papel: 'GERENCIA_ADMIN',
    filialId: '172',
    ativo: true,
    atualizadoEm: new Date().toISOString(),
    provisionadoPor: 'ADMIN_SDK_CLI',
  };

  await userDocRef.set(payload, { merge: true });
  console.log(`✅ Sucesso! Usuário ${targetUid} provisionado com segurança como GERENCIA_ADMIN da Filial 172.`);
}

provisionarGerente().catch((err) => {
  console.error('Erro no provisionamento:', err);
  process.exit(1);
});
