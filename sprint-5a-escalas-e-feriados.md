# Sprint 5a — Escalas Especiais (CRUD + Peso) + Detecção de Feriado
**Objetivo:** Diferenciar o cálculo de horas entre dias comuns, sábado, feriado, domingo especial e evento especial. Detectar feriados nacionais automaticamente via BrasilAPI. Permitir que admin crie escalas especiais que aplicam pesos diferenciados nas aulas.
**Pré-condições:** ✅ Sprints 1, 1.5, 2, 3a, 3b, 4a, 4b validadas.
**Duração estimada:** 1 semana (~5 dias úteis).

> 💡 **Proposta de quebra:** **5a enxuta** (esta sprint — escalas + feriado + peso). **5b opcional** (fluxo de aceite/recusa do professor + alocação automática). 5a já entrega 70% do valor.

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- Coleção `special_scale_types` populada com 4 tipos via seed (já existe: `scripts/seed-special-scale-types.js`)
- Tela "🎯 Escalas Especiais" na sidebar (admin/admin_gestao/supervisao)
- CRUD de `special_scales` (admin define eventos como "sábado dia 23/05" ou "feriado dia 25/12")
- Detecção automática de feriado nacional via BrasilAPI ao gerar classes
- Cloud Function `generateClassesForUpcomingWeeks` consulta a API uma vez por execução, cacheia em `meta/holidays_cache/{year}`, marca `isHoliday=true` + `holidayName` + `holidayType='nacional'` nas classes que caem em feriado
- Schema novo: campo `specialScaleType` em `classes` (FK pra `special_scale_types`)
- `calculateTeacherHours` em `professores-shared.js` + `functions/index.js` refatorada pra usar **peso variável** (não mais `if(isHoliday) ×2` hardcoded)
- Sprint 4 (Fechamento) automaticamente passa a usar pesos diferenciados
- Cloud Function `regenerateClassesWithHolidays` (callable) — admin pode chamar pra retroagir feriados detectados a classes já criadas
- Audit log de todas as operações com `module: 'escalas'`
- Validação com 11 critérios

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Sidebar item "🎯 Escalas Especiais" | Admin · admin_gestao · supervisao (todos podem criar) |
| Seed de `special_scale_types` | Script já existe — `npm run seed:scales:staging` (4 tipos: sabado peso=1, feriado peso=2, domingo_especial peso=3, evento_especial peso=3) |
| Schema de `special_scales/{id}` | `{ scaleTypeId, date, name, unitIds[], description, isActive, createdAt/By }` |
| CRUD de escalas especiais | Tela com lista + modal criar/editar/inativar |
| Detecção automática de feriado | CF consulta `https://brasilapi.com.br/api/feriados/v1/{year}` na geração, cacheia 7 dias |
| Cache de feriados | `meta/holidays_cache/{year}` com `{ feriados: [{date, name}], cachedAt }` |
| Campo novo `classes.specialScaleType` | String id de `special_scale_types`, opcional |
| Peso variável no cálculo de horas | `calculateTeacherHours(classes, scaleTypesMap)` agora retorna `dur × weight`. `isHoliday=true` continua → peso=2 como fallback |
| Refactor `Sprint 4 closeMonth` | CF + frontend recalculam usando o peso correto. Sem migration retroativa de classes (snapshot do fechamento usa o cálculo novo daí pra frente) |
| Callable `regenerateClassesWithHolidays` | Admin chama pra preencher `isHoliday=true` em classes já geradas que coincidem com datas de feriado/escala especial |
| Audit log | `module: 'escalas'` em criações/edições/regenerações |
| Smoke test | 11 critérios via `scripts/admin.js smoke-5a` + UI manual |

### ❌ NÃO ENTRA (vai pra Sprint 5b ou posterior)

| Item | Sprint |
|------|--------|
| **Fluxo de aceite/recusa pelo professor** | Sprint 5b |
| **Alocação automática de professores aptos** | Sprint 5b |
| **Múltiplos professores no mesmo slot** (sub aberta dentro da escala) | Sprint 5b |
| Feriados municipais/estaduais via API | Backlog — admin cria manualmente como `special_scales` |
| Edição em massa de escalas | Backlog |
| Calendário visual de escalas (year view) | Backlog |
| Geração antecipada de classes pra datas além da janela de 4 semanas | Backlog (depende de revisão da CF schedulada) |

---

## 3. Arquivos a criar/modificar

```
crosstrainer-comissoes/
├── functions/index.js                ← MOD — generateClassesCore consulta feriados + cache · regenerateClassesWithHolidays (callable)
├── professores.html                   ← MOD — page-escalas + modais + CSS
├── professores.js                     ← MOD — PROF_PAGES + handler
├── professores-shared.js              ← MOD — SpecialScaleService + refactor calculateTeacherHours
├── professores-escalas.js             ← NOVO — telas de CRUD de escalas
├── firestore.rules                    ← MOD — special_scales + special_scale_types + meta/holidays_cache
└── firestore.indexes.json             ← MOD — índices pra special_scales (date + unitIds)
```

---

## 4. Schemas

### `special_scale_types/{id}` — JÁ EXISTE (seed pronto)
```js
{
  id: 'sabado' | 'feriado' | 'domingo_especial' | 'evento_especial',
  name: 'Sábado' | 'Feriado' | 'Domingo Especial' | 'Evento Especial',
  weight: 1 | 2 | 3,
  description: string,
}
```

### `special_scales/{id}` — Sprint 5a cria
```js
{
  scaleTypeId: 'feriado',                 // FK
  date: Timestamp,                        // BR midnight (UTC-3)
  name: 'Natal',                          // nome legível
  unitIds: ['unit-cp', 'unit-pp'],        // quais unidades cobrem
  description: 'Feriado nacional',

  // Geração de classes nessa escala
  appliedToClasses: ['classId1', 'classId2'],  // ids das classes que foram marcadas
  appliedAt: Timestamp | null,

  isActive: boolean,
  createdAt, createdBy, createdByName,
  updatedAt, updatedBy,
}
```

### `classes/{id}` — campo NOVO
```js
{
  // ... campos existentes ...
  specialScaleType: 'feriado' | 'sabado' | 'domingo_especial' | 'evento_especial' | null,  // 🆕
  specialScaleId: 'escala-xyz' | null,                                                       // 🆕 FK pra special_scales
  isHoliday: boolean,                                                                        // mantém — true se scaleType=feriado OU manual
}
```

### `meta/holidays_cache/{year}` — Sprint 5a cria
```js
{
  year: 2026,
  feriados: [
    { date: '2026-01-01', name: 'Confraternização Universal', type: 'national' },
    { date: '2026-04-21', name: 'Tiradentes', type: 'national' },
    // ... ~12 nacionais via BrasilAPI
  ],
  cachedAt: Timestamp,
  ttl: 604800,  // 7 dias em segundos (informativo, validação é por data)
}
```

---

## 5. Sequência de implementação

### Etapa 1 — Seed + Security Rules + Schema (~0,5 dia)
- [ ] Rodar seed: `npm run seed:scales:staging` — popula `special_scale_types` (4 docs)
- [ ] `firestore.rules`: adicionar regras para `special_scales`, `special_scale_types` (já tem? confirmar), `meta/holidays_cache`
- [ ] `firestore.indexes.json`: índice composto `special_scales (date ASC, unitIds ASC)` se necessário

### Etapa 2 — Refactor calculateTeacherHours (~0,5 dia)
- [ ] Em `professores-shared.js`:
  ```js
  // ANTES
  function calculateTeacherHours(classes) {
    let totalMinutes = 0;
    for (const c of classes) {
      const dur = c.durationMinutes || 0;
      totalMinutes += (c.isHoliday === true) ? dur * 2 : dur;
    }
    return totalMinutes / 60;
  }

  // DEPOIS
  function calculateTeacherHours(classes, scaleTypesMap = null) {
    let totalMinutes = 0;
    for (const c of classes) {
      const dur = c.durationMinutes || 0;
      let weight = 1;
      if (c.specialScaleType && scaleTypesMap && scaleTypesMap.has(c.specialScaleType)) {
        weight = scaleTypesMap.get(c.specialScaleType).weight || 1;
      } else if (c.isHoliday === true) {
        weight = 2;  // fallback retrocompat
      }
      totalMinutes += dur * weight;
    }
    return totalMinutes / 60;
  }
  ```
- [ ] Replicar mesma função em `functions/index.js` (usado pelo `closeMonth`)
- [ ] Replicar em `scripts/admin.js` (usado pelo `preview`/`smoke-4a`)
- [ ] Replicar em `professores-fechamento.js` se houver cálculo client-side próprio

### Etapa 3 — CF `generateClassesCore` com detecção de feriado (~1 dia)
- [ ] Adicionar função `getFeriadosForYear(year)` em `functions/index.js`:
  - Lê `meta/holidays_cache/{year}` no Firestore
  - Se não existe OU `cachedAt` > 7 dias atrás → busca em `https://brasilapi.com.br/api/feriados/v1/{year}`, salva no cache
  - Retorna array de `{date: 'YYYY-MM-DD', name, type}`
- [ ] Modificar `generateClassesCore`:
  - Antes do loop de candidatos: monta `Set<string> feriadosSet` com datas YYYY-MM-DD
  - Pra cada candidato, calcula `ymdBR(c.date)` e checa se está no Set
  - Se sim: `isHoliday=true`, `holidayName=feriado.name`, `holidayType='nacional'`, `specialScaleType='feriado'`
- [ ] Também checa `special_scales` ativas com `date` correspondente — sobrescreve `specialScaleType` se houver

### Etapa 4 — Tela de CRUD de escalas (~1,5 dia)
- [ ] `professores-escalas.js`: `renderEscalasPage()`
- [ ] Sidebar item + roteamento
- [ ] Lista: tabela com data, nome, tipo (peso), unidades, ações (editar/inativar)
- [ ] Modal de criação:
  - Data (input date BR)
  - Nome
  - Tipo (select dos 4 do seed)
  - Unidades (multi-select chip)
  - Descrição
- [ ] Validação: data não pode ser passada (a menos que admin force), tipo obrigatório, ao menos 1 unidade
- [ ] Submit → `SpecialScaleService.create()` → audit log

### Etapa 5 — Cloud Function `regenerateClassesWithHolidays` (~0,5 dia)
- [ ] Callable (admin only) — recebe `{unitId?, year?, month?}`
- [ ] Busca classes do escopo
- [ ] Pra cada uma, checa contra feriados nacionais + `special_scales` ativas
- [ ] Atualiza `isHoliday`, `holidayName`, `specialScaleType` em batch
- [ ] Audit log
- [ ] Útil pra: rodar uma vez após implantar a Sprint 5a pra retroagir feriados em classes já geradas (não regenera classes — só ajusta campos)

### Etapa 6 — Botão "Aplicar a classes existentes" na tela de escala (~0,5 dia)
- [ ] Quando admin cria/edita uma `special_scale`, oferecer botão "Aplicar a classes existentes daquela data"
- [ ] Backend: busca classes com `scheduledDate` igual à data BR da escala + `unitId in unitIds`
- [ ] Atualiza cada uma com `specialScaleType=scaleTypeId` + `specialScaleId=ref` + `isHoliday=true se scaleType==feriado`
- [ ] Atualiza `special_scales.appliedToClasses[]`

### Etapa 7 — Smoke test (~0,5 dia)
- [ ] Adicionar comando em `scripts/admin.js`:
  - `list-scale-types` — lista tipos cadastrados
  - `list-scales [unitId]` — lista special_scales
  - `seed-holidays <year>` — força refresh do cache
  - `apply-scale <scaleId>` — aplica escala a classes existentes
  - `smoke-5a` — roda os 11 critérios
- [ ] Cenários (seção 7)

---

## 6. Decisões importantes

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Lista de tipos | **Lista fixa via seed.** Admin não edita. 4 tipos: sabado(1), feriado(2), dom_especial(3), evento_especial(3) |
| D2 | Detecção feriado | **BrasilAPI** — apenas nacional. Estadual/municipal = `special_scales` manual |
| D3 | Peso vs feriado ×2 | **Generalização: substitui** — peso vem de `special_scale_types`. Feriado fica peso=2 (mesmo efeito). Fallback `isHoliday=true → peso 2` mantido pra retrocompat |
| D4 | Quem cria escalas | Admin · admin_gestao · supervisao (spec) |
| D5 | Cache da API | `meta/holidays_cache/{year}` · TTL 7 dias (re-fetch automático após expirar) |
| D6 | Aplicar peso retroativo a classes já fechadas? | **Não.** `monthly_closings` da Sprint 4 ficam congelados. Apenas classes em meses NÃO fechados podem ser ajustadas |
| D7 | Regenera classes ou só atualiza campos? | **Só atualiza campos** (`isHoliday`, `specialScaleType`). Classes em si não são recriadas (preservar histórico/substituições) |
| D8 | Aceite/recusa do professor pra escala | **Não nesta sprint.** Sprint 5b — admin aloca direto, professor vê notificação |
| D9 | Múltiplas escalas no mesmo dia (sábado + evento) | **Última cadastrada vence.** Backlog: prioridade explícita por peso |
| D10 | Cache da BrasilAPI invalidado quando? | TTL 7 dias OU admin pode forçar refresh via comando `seed-holidays <year>` |
| D11 | Deploy em produção ao fim | Não. Aguarda homologação completa |

---

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Sidebar "🎯 Escalas Especiais" pra admin/admin_gestao/supervisao | Login cada perfil |
| 2 | Seed de `special_scale_types` está populado (4 docs) | `node admin.js --project staging list-scale-types` retorna 4 |
| 3 | Cache de feriados é criado no banco | Rodar `seed-holidays 2026` → ver `meta/holidays_cache/2026` |
| 4 | CF `generateClasses` marca `isHoliday=true` em feriado nacional | Limpar classes de teste, criar slot que cai em 01/01/2027, rodar `generateClassesManual`, ver `isHoliday=true` e `holidayName='Confraternização Universal'` |
| 5 | CRUD de escala especial funciona | Criar escala "Aniversário CrossTainer" tipo evento_especial em data X, editar, inativar |
| 6 | `regenerateClassesWithHolidays` aplica feriados a classes existentes | Antes: 0 classes com `isHoliday`. Após chamar callable: classes em feriado nacional marcadas |
| 7 | `calculateTeacherHours` aplica peso correto | Lucas com 1 aula em feriado (peso 2) → 1h × 2 = 2h "computadas" |
| 8 | Fechamento Sprint 4 usa o peso corretamente | Closing de mês com 1 aula em feriado → valorHoras = 2 × R$/h (não 1 × R$/h) |
| 9 | Escala "evento especial" peso 3 | Aula nessa escala → 1h × 3 = 3h |
| 10 | Audit log com `module: 'escalas'` | Cada CRUD e regeneração gera entry |
| 11 | Zero regressão | Outras telas (Modalidades, Professores, Agenda, etc) continuam funcionando |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| BrasilAPI fora do ar na execução do CF | 🟡 Média | Cache 7 dias absorve. Se cache expirou + API offline → CF loga warning e segue sem marcar feriado (não bloqueia geração) |
| Datas de feriado em formato inconsistente entre API e Firestore | 🟡 Média | Normalizar tudo pra `YYYY-MM-DD` BR antes de comparar. Funções `ymdBR(date)` já existem |
| Refactor de `calculateTeacherHours` quebra Sprint 4 | 🟡 Média | Adicionar fallback `if(isHoliday) weight=2`. Smoke test 4a + 4b deve continuar passando |
| Cliente questiona pesos hardcoded | 🟢 Baixa | Documentar como decisão de spec. CRUD configurável vira Sprint 5c se virar demanda |
| Bug do BrasilAPI: feriado retornado em UTC | 🟢 Baixa | Spec da API documenta. Normalização BR garante |
| Sprint 4 retroativa: muda peso após fechamento | 🟢 Baixa | D6 — não retroativo. `monthly_closings` mantém snapshot original |

---

## 9. Após a sprint

Sprint 5a termina quando os 11 critérios passarem. Próximo passo:

- 🟢 **Sprint 5b (opcional)** — Workflow de aceite/recusa do professor + alocação automática de aptos
- 🟢 **Sprint 6** — Férias e recesso (bloqueio de agenda quando férias aprovada)
- 🟢 **Sprint 7** — Notificações por email (Brevo)
- 🟢 **Sprint 8** — Relatórios + exportações

---

## 📋 Snippets-chave (pra desenvolvimento autônomo)

### Snippet 1 — `getFeriadosForYear(year)` no functions/index.js

```js
const fetch = require('node-fetch');  // ou axios — verificar package.json do functions/
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 dias

async function getFeriadosForYear(year) {
  const firestore = db();
  const cacheRef = firestore.collection('meta').doc(`holidays_cache_${year}`);
  const cacheDoc = await cacheRef.get();

  if (cacheDoc.exists) {
    const data = cacheDoc.data();
    const ageMs = Date.now() - (data.cachedAt?.toMillis() || 0);
    if (ageMs < CACHE_TTL_MS && Array.isArray(data.feriados)) {
      return data.feriados;
    }
  }

  // Fetch da BrasilAPI
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const feriados = json.map(f => ({
      date: f.date,       // 'YYYY-MM-DD'
      name: f.name,
      type: f.type || 'national',
    }));
    await cacheRef.set({
      year, feriados,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      ttl: CACHE_TTL_MS / 1000,
    });
    logger.info(`[getFeriadosForYear] Fetched ${feriados.length} feriados pra ${year}`);
    return feriados;
  } catch (err) {
    logger.error('[getFeriadosForYear] FALHA', err);
    // Se tem cache antigo, usa mesmo expirado (degradação graciosa)
    if (cacheDoc.exists) {
      logger.warn('[getFeriadosForYear] Usando cache expirado pq API falhou');
      return cacheDoc.data().feriados || [];
    }
    return [];
  }
}
```

### Snippet 2 — Integração no `generateClassesCore` (DENTRO do loop existente)

```js
// No início do generateClassesCore, ANTES de iterar slots:
const yearsToCheck = new Set();
const today = ...;  // já existe
const endBR = ...;  // já existe
const cursorIter = new Date(todayBR);
while (cursorIter.getTime() <= endBR.getTime()) {
  yearsToCheck.add(brComponents(cursorIter).year);
  cursorIter.setTime(cursorIter.getTime() + 24 * 60 * 60 * 1000);
}
const feriadosByDate = new Map();
for (const yr of yearsToCheck) {
  const list = await getFeriadosForYear(yr);
  list.forEach(f => feriadosByDate.set(f.date, f));
}

// Também busca special_scales ativas da janela
const scalesSnap = await db().collection('special_scales')
  .where('isActive', '==', true).get();
const scalesByDate = new Map();  // 'YYYY-MM-DD_unitId' → escala
scalesSnap.docs.forEach(d => {
  const s = d.data();
  if (!s.date || !s.unitIds) return;
  const ymd = ymdFromDateBR(s.date.toDate ? s.date.toDate() : new Date(s.date));
  s.unitIds.forEach(uid => {
    scalesByDate.set(`${ymd}_${uid}`, { id: d.id, ...s });
  });
});

// DENTRO do candidate creation (onde já se monta `classId`):
const ymdStr = `${c.date.getUTCFullYear()}-${String(c.date.getUTCMonth()+1).padStart(2,'0')}-${String(c.date.getUTCDate()).padStart(2,'0')}`;  // ajustar pra BR
const feriado = feriadosByDate.get(ymdStr);
const scale = scalesByDate.get(`${ymdStr}_${slot.unitId}`);

const candidateExtras = {
  isHoliday: !!feriado,
  holidayName: feriado?.name || null,
  holidayType: feriado?.type || null,
  specialScaleType: scale ? scale.scaleTypeId : (feriado ? 'feriado' : null),
  specialScaleId: scale ? scale.id : null,
};

candidates.push({ slotId, slot, date: dateClone, classId, extras: candidateExtras });
```

### Snippet 3 — Refactor `calculateTeacherHours` (3 lugares idênticos)

```js
// professores-shared.js, functions/index.js, scripts/admin.js
function calculateTeacherHours(classes, scaleTypesMap = null) {
  let totalMinutes = 0;
  for (const c of classes) {
    const dur = c.durationMinutes || 0;
    let weight = 1;
    if (c.specialScaleType && scaleTypesMap && scaleTypesMap.has(c.specialScaleType)) {
      weight = scaleTypesMap.get(c.specialScaleType).weight || 1;
    } else if (c.isHoliday === true) {
      weight = 2;  // fallback retrocompat
    }
    totalMinutes += dur * weight;
  }
  return totalMinutes / 60;
}

// Carregar scaleTypesMap no closeMonth/preview/smoke:
const stSnap = await db.collection('special_scale_types').get();
const scaleTypesMap = new Map(stSnap.docs.map(d => [d.id, d.data()]));
// passar pra calculateTeacherHours(classes, scaleTypesMap)
```

### Snippet 4 — Security Rules

```js
match /special_scale_types/{id} {
  allow read:  if isAuth() && hasProfModule();
  allow write: if isAuth() && isStrictAdmin();  // apenas via seed em produção
}

match /special_scales/{id} {
  allow read:  if isAuth() && hasProfModule();
  allow write: if isAuth() && (isAdmin() || isSuperv());
}

match /meta/holidays_cache_{year} {
  allow read:  if isAuth() && hasProfModule();
  allow write: if false;  // só CF escreve via admin SDK
}
```

### Snippet 5 — Comando `smoke-5a` no admin.js

```js
async function cmdSmoke5a() {
  console.log('\n══════ SMOKE TEST Sprint 5a ══════\n');

  // C2: seed de tipos
  const ts = await db.collection('special_scale_types').get();
  console.log('✅ C2: Tipos de escala:', ts.size);
  ts.docs.forEach(d => console.log(`   - ${d.id}: weight=${d.data().weight}`));

  // C3: cache de feriados
  const year = new Date().getFullYear();
  const cacheDoc = await db.collection('meta').doc(`holidays_cache_${year}`).get();
  if (cacheDoc.exists) {
    console.log(`✅ C3: Cache ${year} existe — ${(cacheDoc.data().feriados || []).length} feriados`);
  } else {
    console.log(`⚠ C3: Cache ${year} não existe. Rode 'seed-holidays ${year}'`);
  }

  // C4: classes com isHoliday=true
  const holClasses = await db.collection('classes').where('isHoliday', '==', true).limit(5).get();
  console.log(`✅ C4: Classes em feriado: ${holClasses.size}`);
  holClasses.docs.forEach(d => {
    const c = d.data();
    console.log(`   ${d.id} · ${c.holidayName || '(sem nome)'} · scale=${c.specialScaleType || '—'}`);
  });

  // C5: escalas cadastradas
  const scales = await db.collection('special_scales').get();
  console.log(`✅ C5: Escalas cadastradas: ${scales.size}`);

  // C7-C9: testes de cálculo com peso (precisa de dados)
  console.log('\n⚠ C7-C9 requerem dados específicos de teste — rodar manualmente ou via fixture');
  console.log('\n══════ FIM ══════');
}
```

### Snippet 6 — Adicionar `node-fetch` se não tiver

```bash
cd functions && npm install node-fetch@2
```

(Node 22 já tem `fetch` global, mas `firebase-functions` v5 pode ter quirks. Se Node 22, usa `fetch` direto sem require.)

---

## 🚨 Dicas finais

1. **Sempre fallback retrocompat:** `if(isHoliday) weight=2` mantido pra classes antigas (sem `specialScaleType`).
2. **Cache da BrasilAPI 7 dias** é generoso — feriados nacionais não mudam. Pode estender pra 30 dias se quiser reduzir hit na API.
3. **`special_scales.unitIds` é multi-select** — uma escala pode cobrir múltiplas unidades (ex: feriado nacional cobre todas).
4. **Não esquece de testar peso 3 (`evento_especial`)** — fácil de esquecer pq raro.
5. **`closeMonth` do Sprint 4 precisa carregar `scaleTypesMap`** antes de calcular. Sem isso, peso volta pra 1 (silenciosamente errado).
6. **Quando travar:** me chama com erro/diff, eu reviso o trecho.
