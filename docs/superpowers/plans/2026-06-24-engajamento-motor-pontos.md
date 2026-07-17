# Motor de Pontos (Engajamento) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o núcleo puro e testável do motor de pontos de engajamento (`points-engine.js` + `engagement-config.js`), que calcula placar por ciclo, tempo de casa por faixa, geração idempotente de pontos a partir de chamadas e penalidades.

**Architecture:** Módulos puros UMD (sem DOM, sem Firestore), no mesmo padrão de `commission.js`/`pessoas-model.js`/`professores-nav.js`, testados por smokes Node (`scripts/smoke-*.js` com `assert`). A persistência (Firestore) e as telas de chamada ficam para o Plano 2; a escala inteligente para o Plano 3. Este plano entrega a lógica que todos consomem.

**Tech Stack:** JavaScript vanilla (UMD), Node `assert` para smokes. Sem dependências externas.

**Spec:** `docs/superpowers/specs/2026-06-24-engajamento-pontos-escala-design.md` (seções 3, 4.1, 4.3, 8, 10).

---

## File Structure

- `engagement-config.js` (criar, raiz) — `DEFAULT_CONFIG` (valores-padrão da §4.1) + `mergeConfig(overrides)`. Responsabilidade única: definir e mesclar a configuração calibrável.
- `points-engine.js` (criar, raiz) — `PointsEngine`: funções puras de cálculo (tempo de casa, ciclo, placar, geração de entries, penalidade). Responsabilidade única: a matemática dos pontos.
- `scripts/smoke-engagement-config.js` (criar) — smoke do config.
- `scripts/smoke-points-engine.js` (criar) — smoke do engine (cresce a cada task).

Convenção de export (copiar de `professores-nav.js`):
```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PointsEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // ... api ...
  return { /* ...funções... */ };
});
```

---

### Task 1: `engagement-config.js` — defaults + merge

**Files:**
- Create: `engagement-config.js`
- Test: `scripts/smoke-engagement-config.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
// Roda: node scripts/smoke-engagement-config.js
const assert = require('assert');
const EC = require('../engagement-config.js');

// 1) Defaults presentes (§4.1 do spec)
const d = EC.DEFAULT_CONFIG;
assert.strictEqual(d.pts.tempoCasaPorFaixa, 10, 'tempo de casa por faixa = 10');
assert.strictEqual(d.faixaAnos, 2, 'faixa de 2 anos');
assert.strictEqual(d.pts.escolaInternaParticipar, 1);
assert.strictEqual(d.pts.escolaInternaLiderar, 2);
assert.strictEqual(d.pts.treinarComoAlunoEmOutro, 1);
assert.strictEqual(d.pts.toiComoAluno, 1);
assert.strictEqual(d.pts.reuniaoStaff, 8);
assert.strictEqual(d.pts.proatividadeSubstituicao, 3);
assert.strictEqual(d.pts.eventoInterno, 8);
assert.strictEqual(d.pts.treinamentoObrigatorioPresenca, 8);
assert.strictEqual(d.tetoMensalItensDiarios, null, 'teto desligado por padrão');
assert.strictEqual(d.penalidade.treinoFaltaJustificada, 0);
assert.strictEqual(d.penalidade.treinoFaltaSemAviso, -15);

// 2) mergeConfig sobrepõe só o que veio, mantém o resto (deep nos blocos pts/penalidade)
const m = EC.mergeConfig({ pts: { reuniaoStaff: 12 }, penalidade: { treinoFaltaSemAviso: -30 } });
assert.strictEqual(m.pts.reuniaoStaff, 12, 'override aplicado');
assert.strictEqual(m.pts.escolaInternaParticipar, 1, 'demais pts preservados');
assert.strictEqual(m.penalidade.treinoFaltaSemAviso, -30, 'override penalidade');
assert.strictEqual(m.penalidade.treinoFaltaJustificada, 0, 'demais penalidades preservadas');

// 3) mergeConfig() sem args = defaults; não muta DEFAULT_CONFIG
const base = EC.mergeConfig();
assert.strictEqual(base.pts.reuniaoStaff, 8);
EC.mergeConfig({ pts: { reuniaoStaff: 99 } });
assert.strictEqual(EC.DEFAULT_CONFIG.pts.reuniaoStaff, 8, 'DEFAULT_CONFIG imutável');

console.log('✓ smoke-engagement-config: todos os casos passaram');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-engagement-config.js`
Expected: FAIL — `Cannot find module '../engagement-config.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// engagement-config.js — configuração calibrável do motor de pontos (§4.1 do spec)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngagementConfig = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DEFAULT_CONFIG = {
    faixaAnos: 2,
    pts: {
      tempoCasaPorFaixa: 10,
      escolaInternaParticipar: 1,
      escolaInternaLiderar: 2,
      treinarComoAlunoEmOutro: 1,
      toiComoAluno: 1,
      reuniaoStaff: 8,
      proatividadeSubstituicao: 3,
      eventoInterno: 8,
      treinamentoObrigatorioPresenca: 8,
    },
    tetoMensalItensDiarios: null,
    penalidade: {
      treinoFaltaJustificada: 0,
      treinoFaltaSemAviso: -15,
    },
  };

  // Mescla rasa no topo + profunda nos blocos conhecidos (pts, penalidade). Não muta o default.
  function mergeConfig(overrides) {
    overrides = overrides || {};
    return {
      ...DEFAULT_CONFIG,
      ...overrides,
      pts: { ...DEFAULT_CONFIG.pts, ...(overrides.pts || {}) },
      penalidade: { ...DEFAULT_CONFIG.penalidade, ...(overrides.penalidade || {}) },
    };
  }

  return { DEFAULT_CONFIG, mergeConfig };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-engagement-config.js`
Expected: PASS — `✓ smoke-engagement-config: todos os casos passaram`

- [ ] **Step 5: Commit**

```bash
git add engagement-config.js scripts/smoke-engagement-config.js
git commit -m "feat(engajamento): engagement-config (defaults + mergeConfig) + smoke"
```

---

### Task 2: `points-engine.js` — tempo de casa por faixa

**Files:**
- Create: `points-engine.js`
- Test: `scripts/smoke-points-engine.js`

Regra: anos completos entre admissão e referência → faixa = `floor(anos / faixaAnos)` → pontos = `(faixa + 1) * tempoCasaPorFaixa`. Ex. (faixaAnos=2, base=10): 0–1a→10; 2–3a→20; 4–5a→30.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
// Roda: node scripts/smoke-points-engine.js
const assert = require('assert');
const PE = require('../points-engine.js');
const EC = require('../engagement-config.js');
const cfg = EC.DEFAULT_CONFIG;

// tempoDeCasaPontos(admissao, ref, cfg)
assert.strictEqual(PE.tempoDeCasaPontos('2026-01-01', '2026-06-01', cfg), 10, '<1 ano = faixa 0 = 10');
assert.strictEqual(PE.tempoDeCasaPontos('2024-06-01', '2026-06-01', cfg), 20, '2 anos = faixa 1 = 20');
assert.strictEqual(PE.tempoDeCasaPontos('2023-06-01', '2026-06-01', cfg), 20, '3 anos = faixa 1 = 20');
assert.strictEqual(PE.tempoDeCasaPontos('2022-06-01', '2026-06-01', cfg), 30, '4 anos = faixa 2 = 30');
assert.strictEqual(PE.tempoDeCasaPontos(null, '2026-06-01', cfg), 0, 'sem admissão = 0');

console.log('✓ smoke-points-engine: tempo de casa OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-points-engine.js`
Expected: FAIL — `Cannot find module '../points-engine.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// points-engine.js — núcleo puro do motor de pontos (§4.3 do spec)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PointsEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // anos completos entre duas datas ISO (YYYY-MM-DD)
  function completedYears(fromISO, toISO) {
    const a = new Date(fromISO), b = new Date(toISO);
    let years = b.getFullYear() - a.getFullYear();
    const anniv = new Date(b.getFullYear(), a.getMonth(), a.getDate());
    if (b < anniv) years -= 1;
    return Math.max(0, years);
  }

  function tempoDeCasaPontos(admissaoISO, refISO, cfg) {
    if (!admissaoISO) return 0;
    const anos = completedYears(admissaoISO, refISO);
    const faixa = Math.floor(anos / cfg.faixaAnos);
    return (faixa + 1) * cfg.pts.tempoCasaPorFaixa;
  }

  return { completedYears, tempoDeCasaPontos };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-points-engine.js`
Expected: PASS — `✓ smoke-points-engine: tempo de casa OK`

- [ ] **Step 5: Commit**

```bash
git add points-engine.js scripts/smoke-points-engine.js
git commit -m "feat(engajamento): points-engine tempoDeCasaPontos + smoke"
```

---

### Task 3: `points-engine.js` — ciclo de um lançamento (`cycleIdFor`, `entriesForCycle`)

**Files:**
- Modify: `points-engine.js`
- Test: `scripts/smoke-points-engine.js` (acrescentar)

Um ciclo = `{ id, inicio, fim }` (datas ISO inclusivas). Um lançamento pertence ao ciclo cuja janela contém seu `refDate`.

- [ ] **Step 1: Write the failing test** (acrescentar ANTES da linha final `console.log`)

```javascript
// ── Ciclos ──
const cycles = [
  { id: 'c1', inicio: '2026-01-01', fim: '2026-06-30' },
  { id: 'c2', inicio: '2026-07-01', fim: '2026-12-31' },
];
assert.strictEqual(PE.cycleIdFor('2026-03-15', cycles), 'c1', 'data no 1º ciclo');
assert.strictEqual(PE.cycleIdFor('2026-07-01', cycles), 'c2', 'borda inicial inclusiva');
assert.strictEqual(PE.cycleIdFor('2026-12-31', cycles), 'c2', 'borda final inclusiva');
assert.strictEqual(PE.cycleIdFor('2025-12-31', cycles), null, 'fora de qualquer ciclo');

const entries = [
  { personId: 'p1', tipo: 'reuniao', refDate: '2026-03-01', pontos: 8 },
  { personId: 'p1', tipo: 'evento',  refDate: '2026-08-01', pontos: 8 },
];
assert.strictEqual(PE.entriesForCycle(entries, cycles[0]).length, 1, 'só 1 entry no c1');
assert.strictEqual(PE.entriesForCycle(entries, cycles[0])[0].refDate, '2026-03-01');

console.log('✓ smoke-points-engine: ciclos OK');
```

(Atualize/realoque o `console.log` final para refletir o último bloco — pode manter um log por bloco.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-points-engine.js`
Expected: FAIL — `TypeError: PE.cycleIdFor is not a function`

- [ ] **Step 3: Write minimal implementation** (adicionar dentro do factory, antes do `return`, e exportar)

```javascript
  function cycleIdFor(refISO, cycles) {
    const found = (cycles || []).find(c => refISO >= c.inicio && refISO <= c.fim);
    return found ? found.id : null;
  }

  function entriesForCycle(entries, cycle) {
    return (entries || []).filter(e => e.refDate >= cycle.inicio && e.refDate <= cycle.fim);
  }
```

E atualize o `return`:
```javascript
  return { completedYears, tempoDeCasaPontos, cycleIdFor, entriesForCycle };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-points-engine.js`
Expected: PASS — termina com `✓ smoke-points-engine: ciclos OK`

- [ ] **Step 5: Commit**

```bash
git add points-engine.js scripts/smoke-points-engine.js
git commit -m "feat(engajamento): points-engine ciclos (cycleIdFor/entriesForCycle) + smoke"
```

---

### Task 4: `points-engine.js` — placar do ciclo (`scoreboard`)

**Files:**
- Modify: `points-engine.js`
- Test: `scripts/smoke-points-engine.js` (acrescentar)

`scoreboard(entries, cycle, tempoCasaPts)` → soma as entries do ciclo (por tipo + total) e adiciona tempo de casa. Tempo de casa NÃO é entry (vem calculado de fora).

- [ ] **Step 1: Write the failing test** (acrescentar antes do último `console.log`)

```javascript
// ── Placar ──
const sbEntries = [
  { personId: 'p1', tipo: 'escola_interna', refDate: '2026-03-01', pontos: 1 },
  { personId: 'p1', tipo: 'escola_interna', refDate: '2026-03-02', pontos: 1 },
  { personId: 'p1', tipo: 'reuniao',        refDate: '2026-03-10', pontos: 8 },
  { personId: 'p1', tipo: 'penalidade_treino', refDate: '2026-03-20', pontos: -15 },
  { personId: 'p1', tipo: 'evento',         refDate: '2026-09-01', pontos: 8 }, // fora do ciclo
];
const sb = PE.scoreboard(sbEntries, cycles[0], 20); // 20 = tempo de casa
assert.strictEqual(sb.tempoCasa, 20);
assert.strictEqual(sb.porTipo.escola_interna, 2, 'soma 2 dias de escola interna');
assert.strictEqual(sb.porTipo.reuniao, 8);
assert.strictEqual(sb.porTipo.penalidade_treino, -15);
assert.strictEqual(sb.porTipo.evento, undefined, 'evento fora do ciclo não entra');
// total = entries do ciclo (2+8-15 = -5) + tempo de casa (20) = 15
assert.strictEqual(sb.total, 15, 'total = entries do ciclo + tempo de casa');

console.log('✓ smoke-points-engine: placar OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-points-engine.js`
Expected: FAIL — `TypeError: PE.scoreboard is not a function`

- [ ] **Step 3: Write minimal implementation** (adicionar antes do `return` e exportar)

```javascript
  function scoreboard(entries, cycle, tempoCasaPts) {
    const noCiclo = entriesForCycle(entries, cycle);
    const porTipo = {};
    let somaEntries = 0;
    noCiclo.forEach(e => {
      porTipo[e.tipo] = (porTipo[e.tipo] || 0) + e.pontos;
      somaEntries += e.pontos;
    });
    const tempoCasa = tempoCasaPts || 0;
    return { porTipo, tempoCasa, total: somaEntries + tempoCasa };
  }
```

`return { completedYears, tempoDeCasaPontos, cycleIdFor, entriesForCycle, scoreboard };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-points-engine.js`
Expected: PASS — termina com `✓ smoke-points-engine: placar OK`

- [ ] **Step 5: Commit**

```bash
git add points-engine.js scripts/smoke-points-engine.js
git commit -m "feat(engajamento): points-engine scoreboard (placar por ciclo) + smoke"
```

---

### Task 5: `points-engine.js` — gerar lançamentos a partir de uma chamada (`entriesFromAttendance`)

**Files:**
- Modify: `points-engine.js`
- Test: `scripts/smoke-points-engine.js` (acrescentar)

`entriesFromAttendance(att, cfg)` converte um doc de chamada (§4.4) em lançamentos. **Idempotente:** cada entry tem `id = \`${att.id}:${personId}\`` (reprocessar substitui, não duplica). Mapeamento por `att.kind` e por `record`:
- `escola_interna`: `status='presente'` + `role='lider'` → `escola_interna_lider` (2); `role` ausente/`'participante'` → `escola_interna` (1); `status='aluno_outro'` → `treinar_como_aluno` (1).
- `reuniao`: só gera se `att.confirmedBy` setado; `status='presente'` → `reuniao` (8).
- `evento`: `status='presente'` → `evento` (8).
- `treinamento_obrigatorio`: `status='presente'` → `treinamento_presenca` (8); `status='falta_justificada'` → `penalidade_treino` (config, default 0); `status='falta_sem_aviso'` → `penalidade_treino` (config, default -15).
- `status` não mapeado → nenhum lançamento pra aquele record.

- [ ] **Step 1: Write the failing test** (acrescentar antes do último `console.log`)

```javascript
// ── Geração a partir de chamada ──
const attEscola = {
  id: 'att1', kind: 'escola_interna', date: '2026-03-05', unitId: 'unit-cp',
  records: [
    { personId: 'p1', status: 'presente', role: 'lider' },
    { personId: 'p2', status: 'presente' },
    { personId: 'p3', status: 'aluno_outro' },
  ],
};
const e1 = PE.entriesFromAttendance(attEscola, cfg);
assert.strictEqual(e1.length, 3);
assert.deepStrictEqual(e1.find(x => x.personId === 'p1'), {
  id: 'att1:p1', personId: 'p1', tipo: 'escola_interna_lider', refDate: '2026-03-05', pontos: 2, origem: 'att1',
});
assert.strictEqual(e1.find(x => x.personId === 'p2').pontos, 1);
assert.strictEqual(e1.find(x => x.personId === 'p3').tipo, 'treinar_como_aluno');

// Reunião sem confirmação da gestão → nada
const attReuSemConf = { id: 'r1', kind: 'reuniao', date: '2026-03-10', records: [{ personId: 'p1', status: 'presente' }] };
assert.strictEqual(PE.entriesFromAttendance(attReuSemConf, cfg).length, 0, 'reunião sem confirmedBy não pontua');
const attReu = { ...attReuSemConf, confirmedBy: 'admin1' };
assert.strictEqual(PE.entriesFromAttendance(attReu, cfg)[0].pontos, 8, 'reunião confirmada = 8');

// Treinamento obrigatório: presença + faltas
const attTrein = {
  id: 'tr1', kind: 'treinamento_obrigatorio', date: '2026-06-27',
  records: [
    { personId: 'p1', status: 'presente' },
    { personId: 'p2', status: 'falta_justificada' },
    { personId: 'p3', status: 'falta_sem_aviso' },
  ],
};
const e3 = PE.entriesFromAttendance(attTrein, cfg);
assert.strictEqual(e3.find(x => x.personId === 'p1').pontos, 8);
assert.strictEqual(e3.find(x => x.personId === 'p2').pontos, 0);
assert.strictEqual(e3.find(x => x.personId === 'p3').pontos, -15);
assert.strictEqual(e3.find(x => x.personId === 'p3').tipo, 'penalidade_treino');

// Idempotência: reprocessar a mesma chamada dá os mesmos ids
const again = PE.entriesFromAttendance(attEscola, cfg);
assert.deepStrictEqual(again.map(x => x.id), ['att1:p1', 'att1:p2', 'att1:p3'], 'ids estáveis');

console.log('✓ smoke-points-engine: geração por chamada OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-points-engine.js`
Expected: FAIL — `TypeError: PE.entriesFromAttendance is not a function`

- [ ] **Step 3: Write minimal implementation** (adicionar antes do `return` e exportar)

```javascript
  function entriesFromAttendance(att, cfg) {
    const out = [];
    const mk = (personId, tipo, pontos) => ({
      id: `${att.id}:${personId}`, personId, tipo, refDate: att.date, pontos, origem: att.id,
    });
    (att.records || []).forEach(rec => {
      const p = rec.personId;
      switch (att.kind) {
        case 'escola_interna':
          if (rec.status === 'presente' && rec.role === 'lider') out.push(mk(p, 'escola_interna_lider', cfg.pts.escolaInternaLiderar));
          else if (rec.status === 'presente') out.push(mk(p, 'escola_interna', cfg.pts.escolaInternaParticipar));
          else if (rec.status === 'aluno_outro') out.push(mk(p, 'treinar_como_aluno', cfg.pts.treinarComoAlunoEmOutro));
          break;
        case 'reuniao':
          if (att.confirmedBy && rec.status === 'presente') out.push(mk(p, 'reuniao', cfg.pts.reuniaoStaff));
          break;
        case 'evento':
          if (rec.status === 'presente') out.push(mk(p, 'evento', cfg.pts.eventoInterno));
          break;
        case 'treinamento_obrigatorio':
          if (rec.status === 'presente') out.push(mk(p, 'treinamento_presenca', cfg.pts.treinamentoObrigatorioPresenca));
          else if (rec.status === 'falta_justificada') out.push(mk(p, 'penalidade_treino', cfg.penalidade.treinoFaltaJustificada));
          else if (rec.status === 'falta_sem_aviso') out.push(mk(p, 'penalidade_treino', cfg.penalidade.treinoFaltaSemAviso));
          break;
      }
    });
    return out;
  }
```

`return { completedYears, tempoDeCasaPontos, cycleIdFor, entriesForCycle, scoreboard, entriesFromAttendance };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-points-engine.js`
Expected: PASS — termina com `✓ smoke-points-engine: geração por chamada OK`

- [ ] **Step 5: Commit**

```bash
git add points-engine.js scripts/smoke-points-engine.js
git commit -m "feat(engajamento): points-engine entriesFromAttendance (idempotente) + smoke"
```

---

### Task 6: `points-engine.js` — proatividade (substituição) avulsa (`entryForSubstitution`)

**Files:**
- Modify: `points-engine.js`
- Test: `scripts/smoke-points-engine.js` (acrescentar)

A proatividade não vem de chamada — vem do sistema de substituições (Sprint 3b). `entryForSubstitution(subId, personId, dateISO, cfg)` gera 1 lançamento idempotente por substituição assumida.

- [ ] **Step 1: Write the failing test** (acrescentar antes do último `console.log`)

```javascript
// ── Proatividade (substituição) ──
const sub = PE.entryForSubstitution('sub42', 'p1', '2026-03-12', cfg);
assert.deepStrictEqual(sub, {
  id: 'sub:sub42:p1', personId: 'p1', tipo: 'proatividade_substituicao',
  refDate: '2026-03-12', pontos: 3, origem: 'sub42',
});

console.log('✓ smoke-points-engine: proatividade OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-points-engine.js`
Expected: FAIL — `TypeError: PE.entryForSubstitution is not a function`

- [ ] **Step 3: Write minimal implementation** (adicionar antes do `return` e exportar)

```javascript
  function entryForSubstitution(subId, personId, dateISO, cfg) {
    return {
      id: `sub:${subId}:${personId}`, personId, tipo: 'proatividade_substituicao',
      refDate: dateISO, pontos: cfg.pts.proatividadeSubstituicao, origem: subId,
    };
  }
```

`return { completedYears, tempoDeCasaPontos, cycleIdFor, entriesForCycle, scoreboard, entriesFromAttendance, entryForSubstitution };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-points-engine.js`
Expected: PASS — termina com `✓ smoke-points-engine: proatividade OK`

- [ ] **Step 5: Commit**

```bash
git add points-engine.js scripts/smoke-points-engine.js
git commit -m "feat(engajamento): points-engine entryForSubstitution + smoke"
```

---

## Self-Review

**1. Spec coverage (este plano = núcleo puro, §4.1/4.3/8/10):**
- §4.1 config calibrável → Task 1 ✓
- §4.3 tempo de casa fora do reset → Task 2 ✓ (calculado, não é entry)
- §4.2/4.3 pertencimento a ciclo + reset (entries fora do ciclo não somam) → Tasks 3-4 ✓
- §4.3 placar por tipo + total → Task 4 ✓
- §4.4 geração idempotente por chamada; reunião só com confirmação → Task 5 ✓
- §8 penalização (justificada vs sem aviso, configurável, vira entry no placar) → Task 5 ✓
- §9 proatividade vinda de substituição → Task 6 ✓
- §10 contrato pro PLR: `scoreboard().porTipo` + `total` é o retorno que o PLR lê → Task 4 ✓
- **Fora deste plano (próximos):** persistência Firestore (`point_entries`, `attendance`, `point_cycles`, `engagement_config`), telas de chamada, virada de ciclo na UI, escala inteligente. Cada um vira plano próprio.

**2. Placeholder scan:** nenhum TBD/TODO; todo passo tem código real e comando exato. ✓

**3. Type consistency:** shape de entry `{ id, personId, tipo, refDate, pontos, origem }` é idêntico nas Tasks 5 e 6; `cfg` sempre vindo de `EngagementConfig`; nomes de tipo (`escola_interna`, `escola_interna_lider`, `treinar_como_aluno`, `reuniao`, `evento`, `treinamento_presenca`, `penalidade_treino`, `proatividade_substituicao`) consistentes entre geração (Task 5/6) e placar (Task 4). ✓

---

## Próximos planos (roadmap — fora deste documento)

- **Plano 2 — Persistência + telas de chamada** do motor de pontos (Firestore + UI; validação manual/REST no padrão do projeto).
- **Plano 3 — Escala inteligente (engine puro)**: `scale-engine.js` (piso de justiça + mérito + slots tipados + compensação), TDD por smoke.
- **Plano 4 — Escala: persistência + UI + integrações** (férias no fim de ano, proatividade via substituições).
