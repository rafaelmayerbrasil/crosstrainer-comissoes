# Escala Inteligente — Engine puro (Plano 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `scale-engine.js` — o núcleo puro que consolida uma escala especial (sábado/feriado/evento): para cada vaga tipada, escolhe o colaborador respeitando **habilitação**, **piso de justiça** (mínimo do mês + dívida de compensação) e, no resto, **mérito** (placar de pontos), com modulação por **preferência** e **unidade alternada**.

**Architecture:** Módulo UMD puro (sem DOM, sem Firestore), no padrão de `points-engine.js`, testado por smoke Node (`scripts/smoke-scale-engine.js`). A persistência (`special_scales`, `scale_preferences`, `fairness_counter`) e a UI ficam para o Plano 5. Este plano entrega só o algoritmo de alocação (spec §6) + o caso fim de ano (spec §7) fica no Plano 5.

**Tech Stack:** JavaScript vanilla (UMD), Node `assert`. Sem dependências.

**Spec:** `docs/superpowers/specs/2026-06-24-engajamento-pontos-escala-design.md` §6 (algoritmo de consolidação) e §4.5–4.7 (slots, preferências, fairness). Decisão-chave já fechada: **piso de justiça duro + mérito no resto** (§3, fork 2c).

---

## File Structure

- `scale-engine.js` (criar, raiz) — `ScaleEngine`: `consolidate(slots, candidates, opts)` (puro). Responsabilidade única: a matemática da alocação da escala.
- `scripts/smoke-scale-engine.js` (criar) — smoke (cresce a cada task).

Convenção UMD (copiar de `points-engine.js`): wrapper `(function(root,factory){...})(...)` exportando via `module.exports` (Node) ou `root.ScaleEngine` (browser).

### Contrato de dados

`consolidate(slots, candidates, opts)`:
- `slots`: `[{ id, unitId, requiredModalityId }]` — vagas da data (ex.: 1 TOI + 1 Hiit por unidade).
- `candidates`: `[{ id, modalityIds:[], primaryUnitId, merito, diasTrabalhados, divida, pref }]`
  - `merito` (number, placar de pontos; default 0), `diasTrabalhados` (sábados já feitos no ciclo de justiça; default 0), `divida` (compensação acumulada; default 0), `pref` ('quer'|'nao_quer'|'nao_posso'|null).
- `opts`: `{ minMes }` (mínimo do mês; default 1).
- **retorna** `{ assignments: [{ slotId, unitId, personId|null, reason }], fairnessDelta: { [personId]: { dias:+1, dividaResolvida:0|1 } } }`
  - `reason` ∈ `'justica'` (entrou pelo piso) · `'merito'` · `'sem_elegivel'`.

### Regras (spec §6)
1. **Elegível** para um slot = `modalityIds` inclui `requiredModalityId`, `pref !== 'nao_posso'`, e ainda não foi alocado em outro slot da mesma data.
2. **Piso de justiça primeiro**: quem tem `divida > 0` OU `diasTrabalhados < minMes` sobe ao topo (ordena por `divida` desc, depois `diasTrabalhados` asc).
3. **Mérito** decide o resto e os empates: `merito` desc.
4. **Preferência** modula: `quer` antes, `nao_quer` depois (dentro da faixa).
5. **Unidade alternada** desempata: quem tem `primaryUnitId !== slot.unitId` vem antes.
6. Atribui o topo; **atualiza fairness** (dias +1; se entrou com dívida, resolve 1). Slot sem elegível → `personId: null`.

---

### Task 1: `consolidate` — elegibilidade + mérito + sem alocação dupla + leftover

**Files:**
- Create: `scale-engine.js`
- Test: `scripts/smoke-scale-engine.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
// Roda: node scripts/smoke-scale-engine.js
const assert = require('assert');
const SE = require('../scale-engine.js');

const slots = [
  { id: 's_toi',  unitId: 'cp', requiredModalityId: 'TOI' },
  { id: 's_hiit', unitId: 'cp', requiredModalityId: 'HIIT' },
];
// Sem dívida e todos já bateram o mínimo (diasTrabalhados>=minMes) → decide por mérito.
const base = (over) => Object.assign({ modalityIds: [], primaryUnitId: 'cp', merito: 0, diasTrabalhados: 5, divida: 0, pref: null }, over);
const candidates = [
  base({ id: 'ana',   modalityIds: ['TOI', 'HIIT'], merito: 30 }),
  base({ id: 'bru',   modalityIds: ['HIIT'],        merito: 50 }),
  base({ id: 'cleo',  modalityIds: ['TOI'],         merito: 10 }),
];

const r = SE.consolidate(slots, candidates, { minMes: 1 });
const bySlot = Object.fromEntries(r.assignments.map(a => [a.slotId, a]));
// TOI: elegíveis ana(30) e cleo(10) → ana (maior mérito)
assert.strictEqual(bySlot.s_toi.personId, 'ana', 'TOI vai pra Ana (mérito)');
assert.strictEqual(bySlot.s_toi.reason, 'merito');
// HIIT: elegíveis bru(50) e ana(30) — mas ana já foi alocada → bru
assert.strictEqual(bySlot.s_hiit.personId, 'bru', 'HIIT vai pra Bru (Ana já alocada, sem dupla)');

// Slot sem elegível → personId null
const r2 = SE.consolidate([{ id: 'x', unitId: 'cp', requiredModalityId: 'YOGA' }], candidates, {});
assert.strictEqual(r2.assignments[0].personId, null, 'sem habilitado = vaga vazia');
assert.strictEqual(r2.assignments[0].reason, 'sem_elegivel');

// nao_posso exclui
const r3 = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [base({ id: 'ana', modalityIds: ['TOI'], merito: 99, pref: 'nao_posso' }), base({ id: 'cleo', modalityIds: ['TOI'], merito: 10 })], {});
assert.strictEqual(r3.assignments[0].personId, 'cleo', 'nao_posso exclui Ana mesmo com mérito alto');

console.log('✓ smoke-scale-engine: elegibilidade/mérito OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-scale-engine.js`
Expected: FAIL — `Cannot find module '../scale-engine.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// scale-engine.js — núcleo puro da consolidação da escala especial (spec §6)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScaleEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function norm(c) {
    return {
      id: c.id, modalityIds: c.modalityIds || [], primaryUnitId: c.primaryUnitId || null,
      merito: c.merito || 0, diasTrabalhados: c.diasTrabalhados || 0, divida: c.divida || 0,
      pref: c.pref || null,
    };
  }

  function isPiso(c, minMes) { return c.divida > 0 || c.diasTrabalhados < minMes; }

  function makeComparator(slot, minMes) {
    const prefRank = (p) => p.pref === 'quer' ? 0 : (p.pref === 'nao_quer' ? 2 : 1);
    const altRank = (p) => (p.primaryUnitId && p.primaryUnitId !== slot.unitId) ? 0 : 1;
    return function (a, b) {
      const pa = isPiso(a, minMes) ? 0 : 1, pb = isPiso(b, minMes) ? 0 : 1;
      if (pa !== pb) return pa - pb;                       // piso primeiro
      if (pa === 0) {                                      // ambos no piso
        if (b.divida !== a.divida) return b.divida - a.divida;             // mais dívida primeiro
        if (a.diasTrabalhados !== b.diasTrabalhados) return a.diasTrabalhados - b.diasTrabalhados; // menos dias
      }
      if (b.merito !== a.merito) return b.merito - a.merito;               // mais mérito
      if (prefRank(a) !== prefRank(b)) return prefRank(a) - prefRank(b);   // preferência
      if (altRank(a) !== altRank(b)) return altRank(a) - altRank(b);       // unidade alternada
      return String(a.id).localeCompare(String(b.id));                    // estável
    };
  }

  function consolidate(slots, candidates, opts) {
    opts = opts || {};
    const minMes = opts.minMes != null ? opts.minMes : 1;
    const pool = (candidates || []).map(norm);
    const assigned = new Set();
    const fairnessDelta = {};
    const assignments = (slots || []).map(slot => {
      const eligible = pool.filter(c =>
        !assigned.has(c.id) &&
        c.modalityIds.includes(slot.requiredModalityId) &&
        c.pref !== 'nao_posso'
      );
      if (eligible.length === 0) {
        return { slotId: slot.id, unitId: slot.unitId, personId: null, reason: 'sem_elegivel' };
      }
      eligible.sort(makeComparator(slot, minMes));
      const pick = eligible[0];
      assigned.add(pick.id);
      const reason = isPiso(pick, minMes) ? 'justica' : 'merito';
      fairnessDelta[pick.id] = { dias: 1, dividaResolvida: pick.divida > 0 ? 1 : 0 };
      return { slotId: slot.id, unitId: slot.unitId, personId: pick.id, reason };
    });
    return { assignments, fairnessDelta };
  }

  return { consolidate, isPiso };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-scale-engine.js`
Expected: PASS — `✓ smoke-scale-engine: elegibilidade/mérito OK`

- [ ] **Step 5: Commit**

```bash
git add scale-engine.js scripts/smoke-scale-engine.js
git commit -m "feat(escala): scale-engine consolidate (elegibilidade+mérito) + smoke"
```

---

### Task 2: piso de justiça (dívida / mínimo do mês) + fairnessDelta

**Files:**
- Modify: `scale-engine.js` (sem mudança esperada — a lógica de piso já está; esta task ADICIONA cobertura de teste e corrige se algo falhar)
- Test: `scripts/smoke-scale-engine.js` (acrescentar)

- [ ] **Step 1: Write the failing test** (acrescentar antes do último `console.log`)

```javascript
// ── Piso de justiça ──
const b2 = (over) => Object.assign({ modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 0, diasTrabalhados: 5, divida: 0, pref: null }, over);
// Ana tem mérito alto mas já trabalhou; Dora tem mérito baixo mas NÃO bateu o mínimo (dias 0) → piso ganha
const rPiso = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b2({ id: 'ana', merito: 90, diasTrabalhados: 5 }), b2({ id: 'dora', merito: 5, diasTrabalhados: 0 })], { minMes: 1 });
assert.strictEqual(rPiso.assignments[0].personId, 'dora', 'piso (mínimo do mês) vence o mérito');
assert.strictEqual(rPiso.assignments[0].reason, 'justica');
assert.deepStrictEqual(rPiso.fairnessDelta.dora, { dias: 1, dividaResolvida: 0 }, 'dias +1, sem dívida');

// Dívida prioriza e é resolvida no delta
const rDiv = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b2({ id: 'edu', merito: 5, diasTrabalhados: 0, divida: 0 }), b2({ id: 'fab', merito: 5, diasTrabalhados: 0, divida: 2 })], { minMes: 1 });
assert.strictEqual(rDiv.assignments[0].personId, 'fab', 'maior dívida escolhe primeiro');
assert.strictEqual(rDiv.fairnessDelta.fab.dividaResolvida, 1, 'dívida resolvida no delta');

console.log('✓ smoke-scale-engine: piso de justiça OK');
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `node scripts/smoke-scale-engine.js`
Expected: PASS já (a lógica de piso foi implementada na Task 1). Se FALHAR, corrija `makeComparator`/`isPiso` em `scale-engine.js` até passar. (Esta task é a rede de segurança do piso.)

- [ ] **Step 3: (se necessário) ajustar implementação**

Sem mudança esperada. Caso algum assert falhe, revise a ordem do comparador (piso → dívida desc → dias asc → mérito).

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-scale-engine.js`
Expected: PASS — termina com `✓ smoke-scale-engine: piso de justiça OK`

- [ ] **Step 5: Commit**

```bash
git add scale-engine.js scripts/smoke-scale-engine.js
git commit -m "test(escala): cobertura do piso de justiça + fairnessDelta"
```

---

### Task 3: preferência (`quer`/`nao_quer`) + unidade alternada (desempate)

**Files:**
- Modify: `scale-engine.js` (sem mudança esperada — lógica já presente; task adiciona cobertura)
- Test: `scripts/smoke-scale-engine.js` (acrescentar)

- [ ] **Step 1: Write the failing test** (acrescentar antes do último `console.log`)

```javascript
// ── Preferência e unidade alternada (desempate, mesmo mérito/piso) ──
const b3 = (over) => Object.assign({ modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 20, diasTrabalhados: 5, divida: 0, pref: null }, over);
// Mesmo mérito; gabi quer, hugo neutro → gabi
const rPref = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b3({ id: 'gabi', pref: 'quer' }), b3({ id: 'hugo', pref: null })], {});
assert.strictEqual(rPref.assignments[0].personId, 'gabi', 'quem marcou "quer" desempata pra cima');

// nao_quer vai pro fim (mesmo mérito)
const rNao = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b3({ id: 'ian', pref: 'nao_quer' }), b3({ id: 'joa', pref: null })], {});
assert.strictEqual(rNao.assignments[0].personId, 'joa', '"nao_quer" cede a vaga');

// unidade alternada desempata quando mérito e preferência empatam
const rAlt = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b3({ id: 'kim', primaryUnitId: 'cp' }), b3({ id: 'leo', primaryUnitId: 'norte' })], {});
assert.strictEqual(rAlt.assignments[0].personId, 'leo', 'quem é de outra unidade (alternada) desempata');

console.log('✓ smoke-scale-engine: preferência/unidade alternada OK');
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node scripts/smoke-scale-engine.js`
Expected: PASS já (lógica presente na Task 1). Se FALHAR, ajuste `prefRank`/`altRank` no comparador.

- [ ] **Step 3: (se necessário) ajustar implementação**

Sem mudança esperada.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-scale-engine.js`
Expected: PASS — termina com `✓ smoke-scale-engine: preferência/unidade alternada OK`

- [ ] **Step 5: Commit**

```bash
git add scale-engine.js scripts/smoke-scale-engine.js
git commit -m "test(escala): cobertura de preferência + unidade alternada"
```

---

## Self-Review

**1. Spec coverage (§6):**
- Elegibilidade (habilitação por `modalityIds` + `nao_posso`) → Task 1 ✓
- Sem alocação dupla na mesma data → Task 1 ✓
- Slot sem elegível = vaga vazia → Task 1 ✓
- Piso de justiça (mínimo do mês + dívida) antes do mérito → Task 2 ✓
- Mérito decide o resto + empates → Task 1/2 ✓
- Preferência (quer/nao_quer) modula → Task 3 ✓
- Unidade alternada desempata → Task 3 ✓
- `fairnessDelta` (dias +1; dívida resolvida) → Task 2 ✓
- **Fora deste plano (Plano 5):** fim de ano (§7, template de duplas + "não escalado vira férias"), persistência (`special_scales`/`scale_preferences`/`fairness_counter`), UI, janela de eleição/acúmulo entre janelas, integração com substituições.

**2. Placeholder scan:** sem TBD/TODO; todo passo tem código/comando real. Tasks 2 e 3 são redes de segurança (a lógica nasce completa na Task 1) — declarado explicitamente, não é placeholder.

**3. Type consistency:** shape de candidate (`{id, modalityIds, primaryUnitId, merito, diasTrabalhados, divida, pref}`) idêntico nas 3 tasks; `consolidate(slots, candidates, opts)` e o retorno `{assignments, fairnessDelta}` consistentes; `reason` ∈ {justica, merito, sem_elegivel}.

---

## Próximo (Plano 5 — escala: persistência + UI + integrações)
- Coleções `special_scales` (slots + template + janela), `scale_preferences`, `fairness_counter`; serviço `ScaleService` consumindo `ScaleEngine`.
- Telas: janela de eleição (colaborador marca quer/não/não-posso por data), consolidação pela gestão (mostra o porquê de cada escolha), painel de equilíbrio.
- **Fim de ano (§7):** template de duplas dia-inteiro + dias fechados; quem não for escalado vira **férias** (integra módulo de Férias).
- Proatividade: aceitar cobertura de substituição → `EngagementService.awardSubstitution` (engata no sistema de substituições existente).
- Regras Firestore das novas coleções + validação REST no staging.
