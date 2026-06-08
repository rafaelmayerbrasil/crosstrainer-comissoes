# Sprint 9 — Instruções pra Equipe de Desenvolvimento

**Para:** Equipe de desenvolvimento
**De:** Rafael (cliente)
**Data:** 07/06/2026
**Sprint:** 9 — Polimentos Finais (última antes da homologação)

---

## 📌 Instrução geral

**Playbook canônico:** [`sprint-9-polimentos-finais.md`](../../../sprint-9-polimentos-finais.md) (~900 linhas, 5 snippets de código).

**Esta é a sprint final** antes da homologação completa do módulo e deploy em produção. Sigam o playbook integralmente.

---

## 1. Resumo do escopo

4 categorias de polimentos:

| Categoria | Itens principais |
|-----------|------------------|
| **A — UX/Visual** | Recibo R4 com paridade visual de receipt.html · R3 "Sem cadastro salarial" em vez de R$ 0,00 · mensagens vazias padronizadas |
| **B — Branding** | `CrossTrainer` → `CrossTainer` em arquivos de produção (index.html, manifest.json) |
| **C — Tech debt** | Migration audit_log legacy · migration classes UTC midnight (só staging) · CreditService atômico · validar critérios 5/6 da Sprint 4a |
| **D — Robustez** | CDN local fallback (`/vendor` com 5 libs) |

---

## 2. Decisões fechadas com o cliente (não reavaliem)

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Escopo | 4 categorias completas — confirmado 07/06 |
| D2 | Recibo R4 | **html2canvas espelhando receipt.html** (paridade 100%) — confirmado 07/06 |
| D3 | sw.js | **NÃO MEXER** (regra inviolável #1) — confirmado 07/06 |
| D4 | IDs técnicos Firebase | NÃO mexer (`crosstrainer-comissoes*` permanecem) |
| D5 | Migrations | Idempotentes (rodar 2x = mesmo resultado) |
| D6 | Migration classes UTC | Apenas em staging (produção nunca teve esse bug) |
| D7 | Fallback CDN | Local primeiro · CDN como fallback · erro visual se ambos falharem |

---

## 3. Sequência de implementação

6 etapas (~5-6 dias úteis no total):

1. **Etapa 1** (~0,5 dia) — Branding CrossTrainer→CrossTainer (grep + revisão manual)
2. **Etapa 2** (~0,5 dia) — R3 "Sem cadastro" + mensagens vazias padronizadas
3. **Etapa 3** (~1,5 dia) — Recibo R4 via html2canvas (espelha receipt.html)
4. **Etapa 4** (~1,5 dia) — Tech debt migrations (audit_log + classes UTC + CreditService transaction + critérios 5/6 da 4a)
5. **Etapa 5** (~0,5 dia) — CDN local fallback (`/vendor`)
6. **Etapa 6** (~0,5 dia) — smoke-9 + deploy + validação

---

## 4. 12 critérios de aceite

Listados no §6 do playbook. Vou validar via inspeção de código + fixture + UI manual.

---

## 5. Atenção em pontos delicados

### A. Branding (rename CrossTrainer)

**MUITO CUIDADO:**
- **NUNCA** usar `sed -i` global. **Sempre** revisar match-a-match
- **NÃO mexer em:**
  - `sw.js` (regra inviolável #1)
  - `firebase-config.js` (IDs de projeto)
  - IDs Firebase: `crosstrainer-comissoes`, `crosstrainer-comissoes-staging`
  - `AgendaWireframes_design.html` (regra inviolável #8)
- Diff antes de commitar
- Testar PWA install pra ver o nome correto

### B. Recibo R4 via html2canvas

- Adicionar `html2canvas.min.js` em `/vendor/` (download oficial)
- Reusar **integralmente** o template do `receipt.html` (Sprint 4b) — sem duplicar CSS/HTML
- Iframe oculto + render + `html2canvas()` + `doc.addImage(...)`
- Cleanup do iframe após cada recibo
- Yield ao UI thread a cada 3 profs (`await sleep(0)`)
- Progress bar visível

### C. Migrations

**Idempotência obrigatória.** Toda migration deve poder rodar 2x sem efeito colateral.

**Flag `--apply`:** sem ela, modo dry-run (lista o que faria sem fazer). Com ela, executa.

**Migration de classes UTC:** **só em staging.** Script aborta se `--project=production`.

### D. CreditService transação atômica

- Refatorar `abateCredito` pra usar `firestore.runTransaction()`
- Audit log fica **fora** da transaction (não-crítico, pode falhar sem reverter o abate)
- Tests: rodar 2 abates em paralelo → 1 sucesso, 1 erro `failed-precondition`

### E. Fallback CDN

- Lógica: local primeiro · CDN como fallback · erro se ambos falharem
- Sanity check com sentinel global (ex: `window.XLSX`) — script pode carregar mas não registrar
- Testar com DevTools Network bloqueando `/vendor/` → confirmar fallback funciona

---

## 6. Pré-deploy checklist

Antes de pedir validação minha:

- [ ] `grep -r "CrossTrainer" --include="*.html" --include="*.js" --include="*.json"` (excluindo `sw.js`, `firebase-config.js`) → 0 matches
- [ ] Recibo R4 lote vs Recibo Sprint 4b individual lado-a-lado → visualmente idênticos
- [ ] Pedro Lima no R3 → "—" + tooltip em vez de R$ 0,00
- [ ] Filtros impossíveis em todos os relatórios → card padrão (não tabela vazia)
- [ ] `node scripts/migrate-audit-module.js --project staging` em modo dry-run roda sem erro
- [ ] `node scripts/migrate-classes-utc.js --project staging` em modo dry-run roda sem erro
- [ ] Diretório `vendor/` tem 5 arquivos `.js`
- [ ] Fallback CDN testado (DevTools Network)
- [ ] CreditService 2x em paralelo → comportamento atômico
- [ ] PWA install: nome correto "CrossTainer" (não "CrossTrainer")
- [ ] Console limpo após navegar pelo sistema completo (admin → professor → admin)

---

## 7. Após esta sprint

**Esta é a última sprint do módulo Professores.**

Próximos passos pós-Sprint 9:
1. **Homologação completa** — cliente valida tudo end-to-end em staging
2. **Decisão "go live"** — autorização explícita do cliente (regra inviolável #7)
3. **Deploy em produção** — apenas após aprovação

**Estimativa total:** 5-6 dias úteis pra dev + 1-2 dias minha pra validar.

---

**Boa sprint.** Foco na **Etapa 1** (branding) — qualquer erro lá pode quebrar o módulo Comissões em produção. Revisem com lupa.

*— Rafael*
