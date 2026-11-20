# Especificação de Segurança do Firestore (Phase 0 — Payload-First Security TDD)

**Aplicação:** ISV — Filial 172 (Cascavel) | Arquitetura Híbrida V1.0 (Etapa 1 — Blindagem de Dados e Regras de Segurança)  
**Estratégia:** Zero-Trust Default-Deny, operação operacional de loja sem login manual para leitura de bases/vencimentos e envio de contagens, combinada com governança administrativa estrita via Firebase Auth verificado (`GERENCIA_ADMIN`, `email_verified == true`, `filialId == '172'`).

---

## 1. Matriz de Acesso por Coleção e Invariantes de Dados

1. **Zero-Trust Catch-All (`/{document=**}`)**: Nenhuma rota fora da lista declarada possui leitura ou escrita (`allow read, write: if false`).
2. **Identificadores de Documento (`isValidId`)**: Todo ID de documento em `get`, `create`, `update`, `delete` deve ser string de `1..128` caracteres correspondendo a `^[a-zA-Z0-9_\-]+$` (ou sem `/` e `..`, prevenindo Path Traversal e ID Poisoning).
3. **Autenticação da Gerência (`isGerenteAdmin('172')`)**:
   - Requer `request.auth != null` e provedor não anônimo (`request.auth.token.firebase.sign_in_provider != 'anonymous'`).
   - Requer `request.auth.token.email_verified == true` (Bloqueio de Email Spoofing).
   - Autorizado apenas via bootstrap verificado `jottarms@gmail.com` (`filialId == '172'`) OU documento `/usuarios_autorizados/{uid}` com `ativo == true && papel == 'GERENCIA_ADMIN' && filialId == '172'`.
   - Escrita do cliente Web em `/usuarios_autorizados/{userId}` é terminantemente bloqueada (`allow create, update, delete: if false`).
   - Isolamento PII em `/usuarios_autorizados/{userId}`: `allow get` apenas para o próprio UID ou Gerente Admin; `allow list` restrito exclusivamente a `isGerenteAdmin('172') && resource.data.filialId == '172'`.
4. **Proteção de Tokens e Códigos de Vínculo de Dispositivos (`/vinculosPromotor`, `/vinculos_promotores`)**:
   - Contém `codigoVinculo` (6 dígitos) e `tokenVinculo`.
   - `allow get, list: if isGerenteAdmin('172')` — consultas não autorizadas e listagens públicas são bloqueadas contra enumeração de tokens.
   - `allow create, delete: if isGerenteAdmin('172')`.
   - `allow update`: apenas `isGerenteAdmin('172')` ou transição estrita de ativação (`AGUARDANDO` -> `UTILIZADO`), mantendo imutáveis `vinculoId`, `promotorId`, `codigoVinculo`, `tokenVinculo`, `filialId` e restringindo chaves via `affectedKeys().hasOnly(['status', 'dispositivoId', 'dataUtilizacao', 'atualizadoEm'])`.
5. **Promotores, Agências e Vínculos Comerciais (`/promotores`, `/agencias`, `/vinculos_promotor_industria`, `/vinculosPromotorIndustria`, `/vinculosPromotorAgencia`, `/vinculos_comerciais`)**:
   - Leitura permitida para consulta operacional sem login (`get, list: if true` ou `isValidId`).
   - Criação, edição e exclusão (`create, update, delete`) restritas exclusivamente a `isGerenteAdmin('172')`, impedindo usuários anônimos ou não autorizados de cadastrar, alterar ou excluir promotores, agências e vínculos comerciais.
6. **Bases Operacionais (`/filiais/172/catalogo_rub_versoes`, `spcoi_versoes`, `saeou_versoes`, `config` e legados `/produtos`, `/vinculosEAN`, `/metadados`, `*_chunks`, `/historico_importacoes`)**:
   - Leitura pública integral (`get, list`) para operação sem login manual.
   - Publicação/alteração restrita exclusivamente a `isGerenteAdmin('172')` (e `filialId == '172'`).
   - Exclusão de histórico bloqueada ou restrita a `isGerenteAdmin('172')` conforme política de limpeza controlada.
7. **Vencimentos (`/filiais/172/vencimentos` e `/vencimentos`)**:
   - Acesso operacional preservado sem login manual (`get, list, create, update`), com hard-delete bloqueado (`allow delete: if false`).
   - `create`: `filialId == '172'`, `codigoInterno`/`codigo_interno` válido (`1..20`), `dataVencimento`/`data_validade` (`YYYY-MM-DD`, 10 chars), `quantidade` (`0..100000`), `isDeleted != true`, schema fechado (`isAllowedLoteKeys`).
   - `update`: `filialId`, `id`, `vencimentoId`, `codigo_interno`, `codigoInterno`, `digito`, `codigo_exibicao`, `origem`, `saeou060_id`, `arquivo_origem`, `criado_em`, `criadoEm`, `createdAt`, `criadoPor`, `criadoPorMatricula`, `criadoPorPapel` estritamente imutáveis; soft-delete exige `motivoExclusao` (`3..200` chars); campos alteráveis restritos por `affectedKeys().hasOnly(...)`.
8. **Solicitações de Promotores (`/solicitacoesVencimentoPromotor`)**:
   - `create` público somente com `status == 'PENDENTE_ANALISE'` e `filialId == '172'`.
   - `update`: `isGerenteAdmin('172')` pode aprovar/recusar ou corrigir; sem login, só é permitido editar enquanto `existing.status == 'PENDENTE_ANALISE'` e mantendo `data.status == 'PENDENTE_ANALISE'`, `filialId`, `promotorId` e `codigoInterno` imutáveis. Estados terminais (`APROVADO`, `RECUSADO`) ficam travados para não-admins.
9. **Auditoria (`/filiais/172/auditoria`, `/auditoria`, `/auditoria_promotores`)**:
   - Append-only imutável (`allow update, delete: if false`), `allow create` validado por schema e limites de tamanho (`isValidAuditoriaCreate`).
10. **Operações de Promotores (`/operacoes_promotores`)**:
    - `create` validado por schema; `update` restrito a `isGerenteAdmin('172')` ou atualização idempotente de processamento (`affectedKeys().hasOnly(['processado', 'processadoEm', 'status', 'mensagemErro'])`); `delete` bloqueado.
11. **Teste de Conexão (`/test/connection`)**:
    - `allow get: if docId == 'connection'; allow list, write: if false;` para `testConnection()`.

---

## 2. Os "Dirty Dozen" Payloads (12 Vetores de Ataque Rejeitados)

1. **DD-01 (Auto-Provisionamento Admin no Client)**: `CREATE /usuarios_autorizados/attacker_uid` com `{ papel: 'GERENCIA_ADMIN', filialId: '172', ativo: true }` usando conta Google `jottarms@gmail.com` -> **PERMISSION_DENIED**.
2. **DD-02 (PII Blanket List em `/usuarios_autorizados`)**: `LIST /usuarios_autorizados` por usuário logado comum (não-admin) ou anônimo -> **PERMISSION_DENIED**.
3. **DD-03 (Email Spoofing sem Verificação)**: `CREATE /filiais/172/spcoi_versoes/spcoi_hack` usando `email: 'jottarms@gmail.com'` com `email_verified: false` -> **PERMISSION_DENIED**.
4. **DD-04 (Vazamento de Tokens/Códigos em `/vinculosPromotor`)**: `GET /vinculosPromotor/vinc_01` ou `LIST /vinculosPromotor` por usuário anônimo ou operador não-admin -> **PERMISSION_DENIED**.
5. **DD-05 (Cadastro Não Autorizado de Promotor)**: `CREATE /promotores/prom_hack` por operador anônimo ou Google não-admin -> **PERMISSION_DENIED**.
6. **DD-06 (Edição/Exclusão Não Autorizada de Agência ou Vínculo Comercial)**: `CREATE/UPDATE/DELETE` em `/agencias/ag_01` ou `/vinculos_promotor_industria/vpi_01` por usuário não-admin -> **PERMISSION_DENIED**.
7. **DD-07 (Shadow Update / Campo Fantasma em Vencimentos)**: `UPDATE /filiais/172/vencimentos/lote_01` incluindo campo fantasma `_adminOverride: true` -> **PERMISSION_DENIED**.
8. **DD-08 (Value Poisoning / Quantidade Absurda ou Tipo Inválido em Vencimentos)**: `CREATE /vencimentos/lote_poison` com `{ quantidade: 999999999 }` ou `dataVencimento: 12345` -> **PERMISSION_DENIED**.
9. **DD-09 (ID Poisoning / Path Injection no ID do Documento)**: `CREATE /vencimentos/..__bad_id_com_barra` ou ID com >128 chars -> **PERMISSION_DENIED**.
10. **DD-10 (Reatribuição de SKU / Adulteração de Campo Imutável em Vencimentos)**: `UPDATE /vencimentos/lote_01` tentando trocar `codigo_interno` de `'85327'` para `'99999'` ou `origem` de `'SAEOU060'` para `'MANUAL'` -> **PERMISSION_DENIED**.
11. **DD-11 (State Shortcutting / Autoaprovação ou Alteração Pós-Terminal em Solicitações)**: `CREATE /solicitacoesVencimentoPromotor/sol_hack` com `status: 'APROVADO'` ou `UPDATE` alterando documento já `'APROVADO'` sem ser Gerência -> **PERMISSION_DENIED**.
12. **DD-12 (Adulteração ou Exclusão de Auditoria / Zero-Trust Rota Desconhecida)**: `UPDATE /auditoria/audit_01` ou `GET /segredos_internos/doc_1` -> **PERMISSION_DENIED**.
