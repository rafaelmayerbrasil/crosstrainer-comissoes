# Correção Split + BIANUAL + Recálculo — Plano de Implementação

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: usar `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar task-a-task. Passos usam checkbox (`- [ ]`).

**Goal:** Corrigir, de forma robusta, 3 bugs de cálculo (split P2 não dividido, BIANUAL legado virando ANUAL, recálculo corrompendo meta/P3 da unidade) e 2 melhorias de UI (parceiro do split, nome do cliente no histórico) no módulo de Comissões em produção, e remediar os dados de Maio/2026 antes do pagamento.

**Architecture:** Os 3 bugs têm raiz comum no motor de cálculo (`commission.js`) e no recálculo (`index.html`). As correções de engine (`commission.js`) são testadas com Node (engine é `require`-able). As de `index.html` (recálculo + UI) são validadas em staging. Deploy segue o fluxo do hotfix de 15/06: `commission.js`/`index.html` → `origin/main` (GitHub Pages); nada de regras/functions.

**Tech Stack:** JS vanilla, Firebase (Firestore), Node pra testes do engine, GitHub Pages (produção = `origin/main`).

> ⚠️ **Produção = `origin/main`** (não o `main` local, que está 26 commits à frente com o módulo). Toda mudança de produção é baseada em `origin/main`. Ver memória `hotfix-users-create-rule.md`.

> ⚠️ **Pré-requisito:** o cliente NÃO vai pagar Maio até a remediação (Fase 5) estar feita.

---

## Decisões de design (confirmar com o usuário antes de executar)

- **D1 — P2 vs manualP2:** quando há `manualP2` (override manual do admin), ele tem precedência e NÃO é escalado pelo split (o admin digitou o valor final). O escalonamento por `splitAtivacao` vale só pro bônus automático.
- **D2 — Re-derivar periodicidade:** `applyCommissionsToItem` passa a re-derivar `periodicidade` do texto do item (mesma regra word-boundary do `classifyRow`), substituindo o valor gravado. Resolve BIANUAL legado num recálculo, sem remendo manual.
- **D3 — Escopo do recálculo:** o recálculo passa a carregar TODOS os itens `processed` do período direto do Firestore (sem filtro por `uploadId`), já que itens removidos são deletados no upload (não ficam órfãos). Remove a subcontagem que derruba a meta.
- **D4 — Remediação:** após o fix, recalcular **APENAS Maio/2026** (CP e PP) e conferir. **Meses já pagos NÃO são tocados** (decisão do cliente em 15/06 — não recalcular passado). Task 10 (auditoria de passado) fica fora do escopo.
- **D5 — Deploy:** `commission.js` + `index.html` → `origin/main`. Mesmo processo do hotfix (branch de `origin/main`, validar, push).

---

## Estrutura de arquivos

- `commission.js` — engine. Modificar `applyCommissionsToItem` (B1 escala P2 por split; B2 re-deriva periodicidade). Extrair helper de detecção de periodicidade pra reuso (`classifyRow` + `applyCommissionsToItem`).
- `index.html` — `recalculatePeriod` (B3: carregar conjunto completo); `saveSplitRecord`/render de registros (U1: exibir `splitWith`); render do histórico (U2: exibir `cliente`).
- `test/commission-split-bianual.test.js` — novo. Testes Node do engine (B1, B2).
- `scripts/remediar-maio-2026.js` — novo. Script de remediação/auditoria (Fase 5), via Admin SDK staging / REST prod.

---

## Fase 1 — Engine: extrair detecção de periodicidade (refactor base p/ B2)

### Task 1: Helper `detectPeriodicidade` reutilizável

**Files:**
- Modify: `commission.js` (`classifyRow` ~linha 160-170; adicionar método no objeto `CommissionEngine`)
- Test: `test/commission-split-bianual.test.js`

- [ ] **Step 1: Escrever teste que falha**

```js
const CE = require('../commission.js');
const assert = require('assert');

// BIANUAL não pode ser detectado como ANUAL (word boundary)
assert.strictEqual(CE.detectPeriodicidade('ACESSO LIVRE | BIANUAL | FLEX'), 'BIANUAL');
assert.strictEqual(CE.detectPeriodicidade('ECONÔMICO | ANUAL | CP'), 'ANUAL');
assert.strictEqual(CE.detectPeriodicidade('PLANO MENSAL'), 'MENSAL');
assert.strictEqual(CE.detectPeriodicidade('ÁGUA CRYSTAL 500ML'), null);
console.log('Task1 OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test/commission-split-bianual.test.js`
Expected: FAIL — `CE.detectPeriodicidade is not a function`

- [ ] **Step 3: Implementar o helper no `CommissionEngine`**

```js
// Detecta a periodicidade do plano a partir do texto do item (word boundary).
// Reusado por classifyRow (upload) e applyCommissionsToItem (recálculo).
detectPeriodicidade(itemStr, config) {
  const item = String(itemStr || '').toUpperCase();
  const termos = (config?.planosAtivacao) || this.defaultConfig.planosAtivacao;
  let found = null;
  termos.forEach(termo => {
    if (new RegExp(`\\b${termo}\\b`).test(item)) found = termo;
  });
  return found;
}
```

- [ ] **Step 4: Usar o helper no `classifyRow`** (substituir o `termosAtivacao.forEach` inline)

```js
// Antes (classifyRow):
//   const termosAtivacao = (this.currentConfig?.planosAtivacao || this.defaultConfig.planosAtivacao);
//   termosAtivacao.forEach(termo => { const re = new RegExp(`\\b${termo}\\b`); if (re.test(item)) r.periodicidade = termo; });
// Depois:
r.periodicidade = this.detectPeriodicidade(item, this.currentConfig);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node test/commission-split-bianual.test.js`
Expected: `Task1 OK`

- [ ] **Step 6: Commit**

```bash
git add commission.js test/commission-split-bianual.test.js
git commit -m "refactor(engine): extrai detectPeriodicidade (word-boundary) reusavel"
```

---

## Fase 2 — B2: re-derivar periodicidade no recálculo (BIANUAL legado)

### Task 2: `applyCommissionsToItem` re-deriva periodicidade

**Files:**
- Modify: `commission.js` (`applyCommissionsToItem` ~linha 259-318)
- Test: `test/commission-split-bianual.test.js`

- [ ] **Step 1: Teste que falha** (item com periodicidade gravada ERRADA, texto diz BIANUAL)

```js
// B2: registro legado gravado como ANUAL, mas o item é BIANUAL → re-deriva e paga 80
const legado = {
  item: 'ACESSO LIVRE | BIANUAL | FLEX | ILIMITADO (13/05/2026 - 13/05/2028)',
  periodicidade: 'ANUAL', abrangencia: 'FLEX', category: 'renovacao',
  isContract: true, valorCaixa: 299, vendedor: 'TESTE'
};
CE.applyCommissionsToItem(legado, {});
assert.strictEqual(legado.periodicidade, 'BIANUAL', 'deve re-derivar BIANUAL');
assert.strictEqual(legado.p2bonus, 80, 'P2 BIANUAL = 80');
console.log('Task2 OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test/commission-split-bianual.test.js`
Expected: FAIL — `periodicidade` continua 'ANUAL', p2bonus 45

- [ ] **Step 3: Implementar** — no início de `applyCommissionsToItem`, após `const cfg = ...`, re-derivar periodicidade e isContract a partir do texto:

```js
// B2 (15/06/2026): re-deriva periodicidade do TEXTO do item, não confia no campo gravado.
// Corrige registros legados gravados como ANUAL antes do fix de 18/05 (BIANUAL→ANUAL).
const derived = this.detectPeriodicidade(item.item, cfg);
if (derived) { item.periodicidade = derived; item.isContract = true; }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test/commission-split-bianual.test.js`
Expected: `Task2 OK`

- [ ] **Step 5: Teste de não-regressão** (ANUAL continua ANUAL; item sem plano não vira contrato)

```js
const anual = { item: 'ECONÔMICO | ANUAL | CP (01/06/2026 - 01/06/2027)', periodicidade: 'ANUAL', abrangencia: 'LOCAL', category: 'novo', isContract: true, valorCaixa: 199 };
CE.applyCommissionsToItem(anual, {});
assert.strictEqual(anual.p2bonus, 30, 'ANUAL LOCAL = 30');
const agua = { item: 'ÁGUA CRYSTAL 500ML', category: 'outro', valorCaixa: 4 };
CE.applyCommissionsToItem(agua, {});
assert.strictEqual(agua.p2bonus, 0, 'item não-plano não tem P2');
console.log('Task2-regress OK');
```

Run: `node test/commission-split-bianual.test.js` → Expected: ambos OK

- [ ] **Step 6: Commit**

```bash
git add commission.js test/commission-split-bianual.test.js
git commit -m "fix(engine): re-deriva periodicidade no recalculo (corrige BIANUAL legado)"
```

---

## Fase 3 — B1: dividir o P2 pelo split

### Task 3: `applyCommissionsToItem` escala P2 por `splitAtivacao`

**Files:**
- Modify: `commission.js` (`applyCommissionsToItem`, bloco P2 ~linha 288-304)
- Test: `test/commission-split-bianual.test.js`

- [ ] **Step 1: Teste que falha** (perna de split 30% de BIANUAL → P2 = 24, não 80)

```js
// B1: split 30% de BIANUAL → P2 = 80 * 0.30 = 24
const perna = {
  item: 'ACESSO LIVRE | BIANUAL | FLEX (Split: 30 %)',
  periodicidade: 'BIANUAL', abrangencia: 'FLEX', category: 'novo',
  isContract: true, valorCaixa: 89.70, splitAtivacao: 0.3
};
CE.applyCommissionsToItem(perna, {});
assert.ok(Math.abs(perna.p2bonus - 24) < 0.001, `P2 esperado 24, veio ${perna.p2bonus}`);
// P1 também respeita (5% do caixa já dividido)
assert.ok(Math.abs(perna.p1valor - 4.485) < 0.001, `P1 esperado 4.485, veio ${perna.p1valor}`);
console.log('Task3 OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test/commission-split-bianual.test.js`
Expected: FAIL — `p2bonus` veio 80

- [ ] **Step 3: Implementar** — no bloco `else if (item.isContract)` do P2, multiplicar pelo split. **Respeita D1** (manualP2 não é escalado):

```js
// Antes:
//   } else if (item.isContract) {
//     item.p2bonus = this.getP2Bonus(item.periodicidade, item.abrangencia, cfg);
//   }
// Depois:
} else if (item.isContract) {
  // B1 (15/06/2026): escala o bônus pelo ratio do split (splitAtivacao).
  // Sem isso, cada perna recebia o bônus cheio → pagava em dobro.
  item.p2bonus = this.getP2Bonus(item.periodicidade, item.abrangencia, cfg) * (item.splitAtivacao || 1);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test/commission-split-bianual.test.js` → Expected: `Task3 OK`

- [ ] **Step 5: Teste — venda inteira (sem split) não muda** (`splitAtivacao` ausente → fator 1)

```js
const inteiro = { item:'ANUAL | FLEX', periodicidade:'ANUAL', abrangencia:'FLEX', category:'novo', isContract:true, valorCaixa:410 };
CE.applyCommissionsToItem(inteiro, {});
assert.strictEqual(inteiro.p2bonus, 45, 'sem split, P2 cheio = 45');
console.log('Task3-regress OK');
```

Run → Expected: OK

- [ ] **Step 6: Teste de soma do split 70/30** (as duas pernas somam o bônus cheio, não o dobro)

```js
const mk = r => ({ item:'BIANUAL | FLEX', periodicidade:'BIANUAL', abrangencia:'FLEX', category:'novo', isContract:true, valorCaixa: 100*r, splitAtivacao: r });
const a = mk(0.7), b = mk(0.3);
CE.applyCommissionsToItem(a, {}); CE.applyCommissionsToItem(b, {});
assert.ok(Math.abs((a.p2bonus + b.p2bonus) - 80) < 0.001, `soma P2 deve ser 80, veio ${a.p2bonus+b.p2bonus}`);
console.log('Task3-soma OK');
```

Run → Expected: OK

- [ ] **Step 7: Commit**

```bash
git add commission.js test/commission-split-bianual.test.js
git commit -m "fix(engine): escala P2 pelo splitAtivacao (corrige bonus pago em dobro no split)"
```

---

## Fase 4 — B3: recálculo usa conjunto completo + U1/U2 de UI

### Task 4: Confirmar a raiz do B3 nos dados de produção

**Files:**
- Create: `scripts/diagnostico-split-uploadid.js` (leitura REST prod, só diagnóstico)

- [ ] **Step 1: Script** que lista, em `cp_2026-05` e `pp_2026-05`, os itens com `originalSplitId` (pernas de split) e compara o `uploadId` deles com o `uploadId` do período. Saída: quantas pernas têm `uploadId` ≠ do período (essas somem do recálculo via cache).

```js
// Reusar o padrão de token do hotfix (configstore + Rules/Firestore REST).
// Para cada período: GET periodos/{id} (uploadId do período) + lista itens;
// contar itens com fields.originalSplitId cujo fields.uploadId.stringValue !== uploadId do período.
// Imprimir: período, total pernas, pernas com uploadId defasado.
```

- [ ] **Step 2: Rodar** `node scripts/diagnostico-split-uploadid.js` e registrar o resultado.

Expected: confirma ≥1 perna com `uploadId` defasado (raiz do B3). Se 0, revisar hipótese antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add scripts/diagnostico-split-uploadid.js
git commit -m "chore: script de diagnostico da raiz do B3 (uploadId defasado em pernas de split)"
```

### Task 5: `recalculatePeriod` carrega o conjunto completo (B3)

**Files:**
- Modify: `index.html` (`recalculatePeriod` ~linha 5521-5531)

- [ ] **Step 1: Implementar** — ignorar o cache filtrado e carregar TODOS os itens do período do Firestore (D3):

```js
// Antes (5521-5531): usava globalPeriodsCache (populado por query where uploadId == current)
//   → pernas de split com uploadId defasado ficavam de fora → subcontagem.
// Depois: carrega TUDO do Firestore (itens removidos já são deletados no upload).
let items = [];
const itemsSnap = await db.collection('periodos').doc(periodId).collection('itens').get();
itemsSnap.forEach(doc => items.push({ _docId: doc.id, ...doc.data() }));
globalPeriodsCache[periodId] = items;
```

- [ ] **Step 2: Verificação em staging** (split 70/30 não muda a meta da unidade)

Roteiro (preview/manual no staging, período de fixture):
1. Anotar ativações da unidade + faixa de meta + P3 de um vendedor não envolvido.
2. Fazer um split 70/30 de uma venda.
3. Conferir: ativações da unidade **inalteradas**, faixa de meta **inalterada**, P3 do vendedor não envolvido **inalterado** (só muda P1/P2 das duas pernas).

Expected: meta e P3 de terceiros estáveis.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "fix(recalculo): carrega conjunto completo do periodo (corrige meta/P3 corrompidos no split)"
```

### Task 6: U1 — exibir o parceiro do split na UI

**Files:**
- Modify: `index.html` (render do "Detalhamento por venda" e/ou tabela de Registros — onde mostra o item com "(Split: X %)")

- [ ] **Step 1: Implementar** — onde o item de split é renderizado, anexar o parceiro a partir do campo `splitWith` (já gravado pelo `saveSplitRecord`, [index.html:5252/5267]). Ex.: badge "↔ com {splitWith}" ao lado do "(Split: X %)".

```js
// No template da linha do registro, quando d.splitWith:
${d.splitWith ? `<span class="split-tag" title="Dividido com">↔ ${d.splitWith}</span>` : ''}
```

- [ ] **Step 2: Verificação staging** — registro dividido mostra "↔ {parceiro}". Expected: visível nas duas pernas.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(ui): exibe o parceiro do split (campo splitWith) no registro"
```

### Task 7: U2 — nome do cliente no histórico

**Files:**
- Modify: `index.html` (render dos cards de histórico — "Item movido/recebido de outro período" e deltas)

- [ ] **Step 1: Implementar** — na renderização dos `itemDeltas`/snapshot, exibir `cliente` (já presente nos deltas, [index.html:4781]). Para eventos "movido/recebido", incluir o cliente do item movido no snapshot e no card.

```js
// Na lista de lançamentos afetados / cards, adicionar coluna/campo CLIENTE:
<td>${delta.cliente || '—'}</td>
```

- [ ] **Step 2: Verificação staging** — cards de histórico mostram o cliente. Expected: nome aparece.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(ui): mostra o nome do cliente no historico de comissoes"
```

---

## Fase 5 — Remediação dos dados de Maio/2026 + deploy

### Task 8: Deploy do engine + frontend em produção

- [ ] **Step 1:** Branch de hotfix a partir de `origin/main` (produção), aplicar os commits de `commission.js` + `index.html`. Validar sintaxe (`node` vm check no index.html) + rodar `node test/commission-split-bianual.test.js` (todos OK).
- [ ] **Step 2:** Homologar em staging (deploy hosting staging) — repetir a verificação da Task 5 (meta estável no split) + conferir um BIANUAL legado virando 80 após recálculo.
- [ ] **Step 3:** Com OK do usuário: `git push` da branch → `origin/main` (GitHub Pages). Confirmar produção servindo o novo `commission.js`/`index.html`.

### Task 9: Recalcular Maio/2026 (CP e PP) e conferir

- [ ] **Step 1:** Após o deploy, recalcular `cp_2026-05` e `pp_2026-05` (acionar `recalculatePeriod` pela UI admin — uma edição trivial ou botão de recálculo — OU script `scripts/remediar-maio-2026.js` que re-aplica `applyCommissionsToItem` em todos os itens via Admin SDK).
- [ ] **Step 2:** Conferir os splits: cada perna com P2 = bônus × ratio; soma das pernas = bônus cheio (não o dobro). Conferir BIANUAL (Macarena etc.) = 80 sem depender de `manualP2`. Conferir meta da unidade voltou pra faixa correta (gold) e P3 coerente.
- [ ] **Step 3:** Gerar o comparativo "antes/depois" por vendedor pra você validar antes de pagar.

### Task 10: ~~Auditoria de períodos passados~~ — FORA DE ESCOPO (decisão D4)

Cliente decidiu em 15/06 não tocar em meses já pagos. Só Maio é remediado (Task 9).
Mantido aqui só como registro: se um dia quiserem dimensionar o excesso histórico, o
`scripts/diagnostico-split-uploadid.js` (Task 4) + um varredor de `splitAtivacao`/`periodicidade`
nos períodos antigos resolvem — mas **não recalcular** sem decisão explícita.

---

## Self-review (cobertura)

- B1 (split P2) → Task 3 ✅ | B2 (BIANUAL legado) → Task 2 ✅ | B3 (meta/P3 no recálculo) → Tasks 4-5 ✅ | U1 (parceiro do split) → Task 6 ✅ | U2 (cliente no histórico) → Task 7 ✅
- Remediação Maio (pré-pagamento) → Task 9 ✅ | Deploy produção → Task 8 ✅ | Auditoria passado → Task 10 ✅
- Interação P2×manualP2 (D1) tratada no Task 3 (manualP2 tem precedência, não escala).
