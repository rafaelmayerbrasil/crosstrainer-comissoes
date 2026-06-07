# Sprint 8 — Instruções pra Equipe de Desenvolvimento

**Para:** Equipe de desenvolvimento
**De:** Rafael (cliente)
**Data:** 07/06/2026
**Sprint:** 8 — Relatórios e Exportações (Excel + PDF)

---

## 📌 Instrução geral

**Playbook canônico:** [`sprint-8-relatorios-exportacoes.md`](../../../sprint-8-relatorios-exportacoes.md) (~900 linhas, 5 snippets de código orientativos).

**Sigam a versão atual. Leiam integralmente antes de começar.**

---

## 1. Resumo do escopo

4 relatórios exportáveis em Excel (.xlsx) E PDF, todos client-side (browser):

| # | Relatório | Filtros principais |
|---|-----------|---------------------|
| **R1** | Fechamentos Mensais | unidade · período (1 mês ou range) |
| **R2** | Saldos de Férias | unidade · tipo de prof · status (ok/vencendo/vencida) |
| **R3** | Horas por Professor | período · professor (1 ou todos) · unidade |
| **R4** | Recibos em Lote | fechamento (mês fechado). Saída: PDF único OU ZIP |

---

## 2. Decisões fechadas com o cliente (não reavaliem)

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Escopo | 4 relatórios — confirmado 07/06 |
| D2 | Formato | **Excel + PDF desde o início** — confirmado 07/06 |
| D3 | Geração | **Client-side (browser)** — confirmado 07/06. Sem Cloud Function |
| D4 | Bibliotecas | **SheetJS (xlsx) + jsPDF + jsPDF-autotable + JSZip** via CDN |
| D5 | Acesso | Apenas admin e admin_gestao. Supervisor e professor sem |
| D6 | Limite de tamanho | 5k linhas: aviso · 20k+: bloqueia ("use filtros mais específicos") |
| D7 | Audit log | `module: 'relatorios'`, `type: 'report_exported'` em cada export |
| D8 | Branding | Header "CrossTainer ELITE" nos PDFs + data + filtros aplicados |
| D9 | Recibos em lote | 2 opções de saída: PDF único OU ZIP. Cliente escolhe |
| D10 | Férias nos relatórios financeiros | R1 e R3 incluem `vacationValue` (Sprint 6b) quando aplicável |
| D13 | Currency BR | "R$ 1.234,56" (vírgula decimal, ponto de milhar) |

---

## 3. Características da sprint

**Mesmo pattern do 6c — sprint 100% client-side:**

- ❌ **Sem nova Cloud Function**
- ❌ **Sem nova coleção**
- ❌ **Sem novos índices Firestore** (reusa existentes)
- ❌ **Sem alteração em Security Rules** (só leitura)
- ✅ **Frontend** — `professores.html` + `professores.js` + `professores-shared.js` + **novo** `professores-relatorios.js`
- ✅ **Dependências externas via CDN** — 4 libs (~600KB total, carregadas **lazy** quando admin acessar Relatórios)

**Deploy esperado:** apenas `firebase deploy --only hosting --project staging`.

---

## 4. Sequência de implementação

7 etapas (~7-8 dias úteis no total):

1. **Etapa 1** (~1 dia) — Setup CDN + sidebar + page-relatorios base + skeleton do ReportService + funções genéricas `exportToExcel` e `exportToPdf`
2. **Etapa 2** (~1,5 dia) — R1 Fechamentos Mensais
3. **Etapa 3** (~1 dia) — R2 Saldos de Férias (reusa Sprint 6c)
4. **Etapa 4** (~1,5 dia) — R3 Horas por Professor
5. **Etapa 5** (~1,5 dia) — R4 Recibos em Lote (PDF único + ZIP)
6. **Etapa 6** (~1 dia) — Comandos admin.js + smoke-8 + fixture-8
7. **Etapa 7** (~0,5 dia) — Deploy hosting + validação

**Snippets 1-5 do playbook** têm código orientativo:
- Snippet 1: `getFechamentosReport` (estrutura padronizada que cada relatório retorna)
- Snippet 2: `exportToExcel` genérico (linha de título + filtros + cabeçalho + dados + totais)
- Snippet 3: `exportToPdf` genérico (header CrossTainer ELITE + tabela com autotable)
- Snippet 4: `exportRecibosLote` (PDF único + ZIP com JSZip)
- Snippet 5: Lazy loading das bibliotecas

---

## 5. 12 critérios de aceite

Listados no §8 do playbook. Vou validar via inspeção de código + fixture-8 + UI manual.

---

## 6. Atenção em pontos delicados

### A. Lazy loading das bibliotecas

Os 4 scripts CDN são ~600KB no total. **Não carregar em todas as páginas.** Carregar apenas quando admin abrir page-relatorios (Snippet 5).

### B. Encoding UTF-8 no PDF

jsPDF padrão usa Helvetica que não cobre Latin Extended. Nomes com acentos ("João", "Conceição") podem renderizar com placeholders. **Solução:** registrar fonte Roboto via `doc.addFileToVFS` + `doc.addFont`. Ver documentação jsPDF.

### C. Currency formatting

- **Excel:** aplicar `numFmt: '"R$ "#,##0.00'` nas células
- **PDF:** usar `Number(v).toLocaleString('pt-BR', {minimumFractionDigits: 2})` + prefixo "R$ "
- Nunca usar formato US (`1,234.56`)

### D. Recibos em lote — performance

Gerar 50+ recibos em PDF pode demorar 10-20s e travar UI. Snippet 4 mostra padrão com `updateProgress()` durante o loop. **Botão "Cancelar"** disponível durante a geração.

### E. Reuso do template receipt.html (Sprint 4b)

R4 (Recibos em Lote) deve **espelhar o mesmo layout** do recibo individual gerado pela Sprint 4b. Idealmente, extrair a lógica de renderização em função compartilhada que aceita um `target` (DOM ou jsPDF).

### F. CDN como dependência externa

Documentar como tech debt: se algum dia o CDN cair, os 4 botões de export quebram. Aceitável por enquanto. Backlog: hospedar localmente.

---

## 7. Pré-deploy checklist

Antes de pedir validação minha:

- [ ] Todos os arquivos JS rodam `node --check` sem erro
- [ ] Bibliotecas CDN carregam corretamente em browser limpo (testar incognito)
- [ ] Cada um dos 4 relatórios exporta Excel válido (abrir no Excel/Sheets)
- [ ] Cada um dos 4 relatórios exporta PDF válido (abrir no Adobe Reader/preview)
- [ ] Acentos perfeitos no PDF (testar com nome "Conceição")
- [ ] Currency em padrão BR (testar com R$ 1.234,56)
- [ ] Audit log gerado em cada export
- [ ] Login supervisor → sidebar SEM item Relatórios
- [ ] Lazy loading: ao logar como admin e ir pra Minha Agenda, console NÃO deve mostrar carregamento de xlsx/jspdf

---

## 8. Próximos passos

1. **Leiam o playbook integralmente** — especialmente §6 (etapas), §7 (decisões), §8 (critérios), Snippets 1-5
2. **Sigam as 7 etapas em ordem.** Mudanças de ordem geralmente quebram dependências (R4 depende do template do recibo da Sprint 4b)
3. **Quando entregar em staging**, eu rodo:
   - Inspeção de código (Service + exports + lazy loading + audit)
   - `smoke-8` + fixture-8
   - UI manual: gera cada relatório, abre Excel e PDF, valida formato + branding + acentos + currency
4. **Não fazer deploy em produção.** Regra mantida: módulo só vai pra prod quando TODAS as sprints estiverem ✅

**Estimativa total:** 7-8 dias úteis pra entregar + 1 dia minha pra validar.

---

**Boa sprint.** Foco nos snippets 1 e 2 (estrutura padronizada do report data) — eles deixam os 4 relatórios reaproveitarem o mesmo `exportToExcel`/`exportToPdf`. Economiza muito código.

*— Rafael*
