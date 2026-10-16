# Implementação SPCOI007 + Indústrias + Promotores + Módulo ISV (Itens Sem Venda)

Arquitetura técnica controlada e plano de execução para vincular produtos da SMGOI013 a fornecedores/indústrias via SPCOI007, gerenciar responsabilidades de promotores por CNPJ e monitorar itens sem venda (ISV) com relatórios executivos em A3 horizontal no Aplicativo Principal.

---

## Auditoria da Arquitetura Atual & Riscos Identificados

> [!IMPORTANT]
> **Decisões Críticas de Segurança & Isolamento Operacional**
> 1. **Isolamento Total do App Promotor**: Nenhuma regra de segurança, token, convite, sessão ou permissão remota do App Promotor será alterada. A carteira por CNPJ calculada nesta fase é de consumo interno e relatórios gerenciais no Aplicativo Principal.
> 2. **Soberania Absoluta da SMGOI013**: A importação da SPCOI007 nunca insere produtos novos no catálogo operacional. Produtos na SPCOI007 ausentes na filial 172 são categorizados como `SEM_CORRESPONDENCIA_FILIAL` sem poluir o catálogo de 11.822 produtos.
> 3. **Tratamento de Múltiplos CNPJs**: Produtos fornecidos por múltiplos CNPJs (ex: distribuidor + indústria direta) preservam todos os vínculos sem atribuição arbitrária, sendo destacados com badge visual de revisão no ISV.
> 4. **Cálculo Financeiro de Estoque**: O valor financeiro é calculado estritamente por `Estoque Total Convertido × Custo Médio da SMGOI013`. Na ausência de custo médio, o valor é sinalizado como indisponível (`-`), nunca computado como R$ 0,00.

### Riscos Identificados & Mitigações
* **Risco 1: Perda de zeros à esquerda em CNPJs ou códigos**: Planilhas Excel frequentemente convertem CNPJs numéricos e códigos com zeros em números inteiros (ex: `00123...` -> `123...`).
  * *Mitigação*: Normalizador dedicado que preserva string pura com padStart de 14 dígitos para CNPJ e distinção estrita entre `codigo_interno` e `digito`.
* **Risco 2: Ambiguidade de CNPJs duplicados em sucessivas importações**:
  * *Mitigação*: Armazenamento com chave composta estável `cnpj_normalizado + codigo_interno`. Novas importações atualizam Razão Social e metadados sem duplicar vínculos.
* **Risco 3: Contagem duplicada de valores financeiros no painel ISV**: Se um produto tem 2 CNPJs ou atende 2 promotores, somar diretamente o grid duplicaria o estoque financeiro.
  * *Mitigação*: Os indicadores do painel consolidam métricas a nível de produto único (`codigo_interno`), garantindo que o valor financeiro total reflita o estoque real físico da filial.

---

## 1. Visão Geral & Conceito Central

* **O que faz**: Adiciona ao Aplicativo Principal a importação e consulta da planilha de fornecedores **SPCOI007**, um catálogo administrativo de **Indústrias** (identificadas por CNPJ normalizado), uma interface de **Vinculação Promotor ↔ Indústria** com carteira calculada dinamicamente, e o módulo **ISV — ITENS SEM VENDA** para identificar mercadorias com baixo giro/paradas, registrar ocorrências de possíveis ajustes e emitir relatórios em PDF no formato **A3 Horizontal** (com toggle para exibir ou ocultar valores financeiros).
* **Público-alvo**: Gestores de prevenção de perdas, líderes de setor (Frios/Loja), encarregados e compradores da Filial 172 (Cascavel).
* **Proposta de Valor**: Visibilidade financeira e operacional do capital parado em estoque, identificando com precisão o promotor, agência e indústria responsável por cada item crítico.

---

## 2. Experiência do Usuário & Telas

### Fluxos Principais
1. **Importação SPCOI007** (`ImportacaoView`):
   * Aba dedicada `SPCOI007` com drag-and-drop, barra de progresso animada e validação de colunas (`CNPJ`, `RAZAO_SOCIAL`, `CODIGO`, `DESCRICAO`).
   * Resumo detalhado: Total lidos, produtos encontrados na SMGOI013, produtos sem correspondência na filial, produtos com múltiplos CNPJs e indústrias catalogadas.
2. **Gestão de Indústrias & Vínculos de Promotores** (`PromotoresView`):
   * Nova aba **"Indústrias & Vínculos"**:
     * Visualização de indústrias cadastradas por CNPJ, com Razão Social, nome comercial de exibição editável, total de produtos vinculados na loja e promotores responsáveis.
     * Painel de vinculação: Seleção de promotor (com exibição da agência) -> checklist de indústrias -> vinculação atômica por chave estável (`promotorId + cnpj + filialId`).
     * Filtros rápidos para indústrias sem promotor e promotores sem indústrias vinculadas.
3. **Módulo ISV — ITENS SEM VENDA** (`IsvView`):
   * Acessível diretamente pelo menu operacional e pela navegação rápida.
   * **Cards de Indicadores**: Produtos parados, Produtos com estoque > 0, Valor total parado em R$, Indústrias envolvidas, Promotores responsáveis, Itens sem responsável e Candidatos a Ajuste.
   * **Barra de Filtros Combináveis**:
     * Responsabilidade: Agência, Indústria, Promotor, Situação da vinculação (Com promotor / Sem promotor / Múltiplos CNPJs).
     * Produto: Busca textual (código/descrição), Setor Físico, Setor Balanço.
     * Dias sem venda: Filtros rápidos (3, 4, 5, 6, 7, 8, 9, 10, 15 dias e personalizado) em modo "Mínimo de X dias" ou "Exatamente X dias".
     * Idade da mercadoria: (3, 4, 5, 6, 7, 8, 9, 15 dias e personalizado).
     * Estoque & Valor: Faixas (Todos, Até R$ 250, Acima de R$ 250, Personalizado).
     * Ordenação: Maior valor do estoque (padrão), Menor valor, Mais dias sem venda, Maior idade, Código.
   * **Sub-Aba / Visualização "Possíveis Ajustes"**:
     * Filtro automático: Dias sem venda > 10, Estoque registrado > 0, Valor < R$ 250.
     * Modal para registrar ocorrência interna: "Produto consta no sistema, mas não foi localizado fisicamente na área de vendas ou depósito" (com data, observação, responsável e status de conferência).
4. **Emissor de Relatórios ISV em PDF** (`IsvPdfModal` / `relatorioIsvPdfService`):
   * Formato fixo: **A3 Horizontal**.
   * Toggle obrigatório: `[✓] EXIBIR VALOR DO ESTOQUE`.
   * **Ordem estrita das colunas (11 colunas)**:
     1. CÓDIGO | 2. DIG | 3. DESCRIÇÃO | 4. EMBALAGEM | 5. ESTOQUE | 6. DIAS SEM VENDA | 7. IDADE | 8. INDÚSTRIA | 9. PROMOTOR | 10. AGÊNCIA | 11. VALOR DO ESTOQUE
   * Ao desmarcar o toggle: coluna 11 é eliminada, gerando tabela limpa de 10 colunas com largura redistribuída e supressão de totais em R$ no cabeçalho e rodapé.
   * Modos de relatório: Geral da seleção ativa, Por Indústria, Por Promotor e Por Agência.

---

## 3. Decisões de Arquitetura & Persistência

```
┌────────────────────────────────────────────────────────────────────────┐
│                        APLICATIVO PRINCIPAL                            │
├─────────────────────────┬──────────────────────────────────────────────┤
│ SMGOI013 (Base Mestre)  │ Catálogo Operacional da Filial 172           │
│ Estoque, Vendas, Idade  │ Custo Médio, Fator Embalagem, Setores        │
├─────────────────────────┼──────────────────────────────────────────────┤
│ SPCOI007 (Base Auxiliar)│ CNPJ (14 dígitos) + Razão Social             │
│ Fornecedores/Indústrias │ Código Interno SMG -> CNPJ Indústria         │
├─────────────────────────┼──────────────────────────────────────────────┤
│ Vínculos Promotor-CNPJ  │ promotorId + cnpjNormalizado + filialId      │
│ Carteira Dinâmica       │ Calculada on-the-fly: SMG ∩ SPCOI007 ∩ Vínc. │
├─────────────────────────┼──────────────────────────────────────────────┤
│ Módulo ISV              │ Filtros Cruzados (Giro × Estoque × Contato)  │
│ Possíveis Ajustes       │ Ocorrências de Estoque Virtual vs Físico     │
│ Relatórios PDF A3       │ 11 colunas oficiais / Toggle de Ocultar R$   │
└─────────────────────────┴──────────────────────────────────────────────┘
```

### Novas Estruturas no IndexedDB (`src/services/db.ts`)
* `STORES.SPCOI007_FORNECEDORES`: Associação `{ id: 'cnpj_codigoInterno', cnpj, razaoSocial, codigoInterno, digito, criadoEm }`.
* `STORES.INDUSTRIAS`: Cadastro `{ cnpj, razaoSocial, nomeExibicao, ativo, atualizadoEm }`.
* `STORES.VINCULOS_PROMOTOR_INDUSTRIA`: `{ id: 'promotorId_cnpj_filialId', promotorId, cnpj, filialId, criadoEm }`.
* `STORES.ISV_SOLICITACOES_AJUSTE`: Ocorrências internas de ajuste de estoque físico não localizado.
* `STORES.HISTORICO_IMPORTACOES_SPCOI007`: Auditoria das versões importadas da SPCOI007.

---

## 4. Arquivos Afetados no Projeto

### Arquivos a Serem Criados
1. `src/types/isvTypes.ts` (ou adições em `src/types.ts`): Tipagens de Indústria, Fornecedor SPCOI007, Vínculo Promotor-Indústria, Registro ISV, Filtros e Ocorrência de Ajuste.
2. `src/services/spcoi007Parser.ts`: Parser seguro da planilha SPCOI007, normalizador de CNPJ, validação de colunas e identificação de ambiguidades.
3. `src/services/isvService.ts`: Serviço central para cálculo financeiro do estoque (`Estoque Total × Custo Médio`), consolidação da carteira de produtos por CNPJ/Promotor/Agência, agregação dos indicadores e persistência local/IndexedDB.
4. `src/services/isvPdfService.ts`: Gerador de PDF em formato A3 Horizontal com jsPDF e jspdf-autotable, respeitando as 11 colunas exatas e o switch de exibição financeira.
5. `src/components/IsvView.tsx`: Tela completa do módulo ISV — ITENS SEM VENDA, com filtros responsivos, cards de indicadores, tabela detalhada e gaveta de possíveis ajustes.
6. `src/components/promotores/VincularPromotorIndustriaTab.tsx`: Componente para a aba de relacionamento Promotor ↔ CNPJs de Indústrias.
7. `src/components/isv/ModalRegistrarAjusteIsv.tsx`: Modal para registrar ocorrência de produto não localizado fisicamente.

### Arquivos Existentes a Serem Atualizados
1. `src/types.ts`: Adição dos tipos de SPCOI007, Indústrias e ISV, além do campo `custo_medio?: number` em `ProdutoSMG`.
2. `src/services/db.ts`: Incremento seguro da versão do IndexedDB e criação dos novos Object Stores.
3. `src/services/excelParser.ts`: Mapeamento seguro da coluna `CUSTO_MEDIO` na importação da SMGOI013 sem alterar os demais campos.
4. `src/components/ImportacaoView.tsx`: Adição da aba de importação da planilha `SPCOI007`.
5. `src/components/PromotoresView.tsx`: Adição da aba de vinculação Promotor ↔ Indústrias.
6. `src/components/MaisMenuView.tsx`: Inclusão do atalho direto para o módulo **ISV — ITENS SEM VENDA** e para o catálogo de **Indústrias**.
7. `src/App.tsx`: Roteamento da subView `'isv'` e integração dos dados do ISV.

---

## 5. Roteiro de Verificação & Testes Obrigatórios

* **Teste A (Soberania SMGOI013)**: Importar SPCOI007 e certificar que a contagem de produtos da loja permaneceu inalterada.
* **Teste B (Múltiplos CNPJs)**: Inserir produto com mais de um CNPJ e verificar exibição transparente de múltiplos vínculos sem arbitrar um único fornecedor.
* **Teste C (Vínculo Promotor ↔ Indústria)**: Vincular 2 indústrias ao promotor e validar que a carteira reúne os produtos de ambos os CNPJs.
* **Teste D (Persistência pós-SMGOI013)**: Reimportar a SMGOI013 e validar que os vínculos da SPCOI007 e das indústrias continuam intactos.
* **Teste E (Filtros ISV)**: Testar combinação de filtros (ex: Dias sem venda ≥ 7 + Setor Frios + Promotor X).
* **Teste F (Cálculo Financeiro)**: Validar produto com caixa (conversão para unidades × custo médio) e produto pesável (KG/G).
* **Teste G (PDF A3 com valor)**: Gerar PDF A3 horizontal e auditar as 11 colunas na ordem exata.
* **Teste H (PDF A3 sem valor)**: Gerar PDF A3 horizontal com valor desmarcado e auditar as 10 colunas sem dados em R$.
* **Teste I (Ordenação)**: Validar ordenação padrão por maior valor financeiro.
* **Teste J (Não duplicação financeira)**: Confirmar que somatórios do painel consideram produtos únicos.
* **Teste K (App Promotor intacto)**: Confirmar que nenhuma regra ou código do App Promotor foi modificado.
