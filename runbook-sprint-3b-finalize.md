# Runbook — Pendências da Sprint 3b
**Data:** 18/05/2026 (sessão 17 deixou pendente; executar antes de iniciar Sprint 4)
**Tempo total estimado:** ~2 min (após bug D ter sido fixado durante a sessão 17)
**Pré-requisitos:** estar logado no Firebase CLI (`firebase login`) e ter o repo em `crosstrainer-comissoes/`.

> ✅ **P2 (investigação do bug D fuso UTC↔BR) já foi executado e o fix já foi deployado na sessão 17.**
> Restou apenas P1 (deploy do índice composto) e P3 (opcional, migration do audit_log).

---

## P1 — Deploy do índice composto (~2 min)

Adicionei o índice `substitutions(substituteUserId, status, requestedAt)` no `firestore.indexes.json` na sessão 17 mas não deployei. Sem isso, a Inbox da UI quebra ao tentar listar pedidos pendentes (cenário 8 só passou via console).

### Comando

```bash
cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes"
firebase deploy --only firestore:indexes --project staging
```

### Resultado esperado

Saída terminando em:
```
+ firestore: released indexes successfully
+ Deploy complete!
```

> ⚠️ Se aparecer "index already exists", tudo certo — significa que você já criou esse índice manualmente via link do erro na sessão 17. Pode pular.

### Validar que está OK

No browser (em `localhost:5000/professores.html`, logado como admin), no console:

```js
const r = await SubstitutionService.listPendingForSubstitute(firebase.auth().currentUser.uid);
console.log(r);
```

**Esperado:** `{ success: true, data: [...] }` (sem `failed-precondition`).

---

## ~~P2~~ — ✅ JÁ RESOLVIDO NA SESSÃO 17

**Status:** investigação completa + fix deployado.

**O que foi feito:**
1. Diagnóstico via 4 queries (Q1-Q4) confirmou: 18 classes existentes, 2 deslocadas entre meses, slot weekday em UTC ≠ weekday em BR
2. Refatoração de `generateClassesCore` em `functions/index.js`:
   - Helpers novos: `brMidnightUTC()`, `brComponents()`, `ymdFromDateBR()` (offset fixo UTC-3, sem DST)
   - Iteração de dias agora em BR (não mais em UTC)
   - `scheduledDate` salvo como BR midnight (= 03:00 UTC)
3. Deploy em staging: `firebase deploy --only functions:generateClassesForUpcomingWeeks,functions:generateClassesManual --project staging` ✅

**Estado das classes:**
- 18 classes antigas: continuam com `scheduledDate` em UTC midnight (não migradas)
- Novas classes (geradas após o deploy): saem em BR midnight
- Sprint 4 vai usar boundaries BR ao filtrar por mês — pega ambos os formatos corretamente

**Não precisa rodar nada do P2 — pula direto pra P3 ou fim do runbook.**

---

## P2 (deprecated) — Diagnóstico original (mantido como referência histórica)

**O que descobrimos:** classes geradas pela CF têm `scheduledDate` em UTC midnight. Em BR (UTC-3), isso vira ~21:00 do dia anterior. Exemplo concreto:
- ClassId: `slot-X_20260522` (literal: 22 de maio)
- `scheduledDate` no banco: 22/05/2026 00:00 UTC
- Display na UI BR: "QUI, 21/05/2026" (porque é 21:00 do dia 21 em BR)

**Impacto potencial na Sprint 4 (Fechamento):**
- Se Fechamento agrupar aulas por mês usando `scheduledDate.getMonth()` local (BR), uma aula gerada como "02/05 UTC midnight" aparece como "01/05 BR" → entra no fechamento de Abril e não de Maio
- Se agrupar usando o classId composto (`_YYYYMMDD`), entra no mês UTC, que pode não bater com BR
- Risco real: aulas do dia 1º podem ir pro mês anterior, ou vice-versa

### Diagnóstico — rodar 4 queries

No console JS (em `localhost:5000/professores.html` logado como admin), cole **uma por vez**:

#### Query 1 — Comparar scheduledDate UTC vs BR pra 5 aulas

```js
const snap = await db.collection('classes').limit(5).get();
snap.docs.forEach(d => {
  const data = d.data();
  const ts = data.scheduledDate;
  if (!ts) return console.log(d.id, '(sem scheduledDate)');
  const date = ts.toDate();
  console.log({
    classId: d.id,
    iso: date.toISOString(),
    utcDay: date.getUTCDate(),
    utcMonth: date.getUTCMonth() + 1,
    brDay: date.getDate(),
    brMonth: date.getMonth() + 1,
    brWeekday: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][date.getDay()],
    classIdYmd: d.id.split('_')[1] || '(sem)',
  });
});
```

**Pergunta-chave:** o `classIdYmd` bate com `utcDay/utcMonth` (UTC) ou com `brDay/brMonth` (BR)?

#### Query 2 — Quantas aulas estão "deslocadas" entre meses por causa do fuso

```js
const snap = await db.collection('classes').get();
let aligned = 0, shifted = 0;
const examples = [];
snap.docs.forEach(d => {
  const ts = d.data().scheduledDate;
  if (!ts) return;
  const date = ts.toDate();
  const utcMonth = date.getUTCMonth();
  const brMonth = date.getMonth();
  if (utcMonth !== brMonth) {
    shifted++;
    if (examples.length < 3) examples.push({
      classId: d.id,
      iso: date.toISOString(),
      utcMonth: utcMonth + 1,
      brMonth: brMonth + 1,
    });
  } else aligned++;
});
console.log({ total: snap.size, aligned, shifted, examples });
```

**Pergunta-chave:** `shifted > 0` significa que tem aulas que pertencem a meses diferentes dependendo do fuso usado.

#### Query 3 — Slot original vs Class gerada (timezone check)

```js
const slots = await db.collection('schedule_slots').limit(3).get();
for (const slotDoc of slots.docs) {
  const slot = slotDoc.data();
  const classQuery = await db.collection('classes').where('slotId', '==', slotDoc.id).limit(2).get();
  console.log('Slot:', slotDoc.id, {
    weekday: slot.weekday,
    weekdayLabel: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][slot.weekday],
    startTime: slot.startTime,
  });
  classQuery.docs.forEach(c => {
    const d = c.data().scheduledDate.toDate();
    console.log('  → Class:', c.id, {
      utcWeekday: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getUTCDay()],
      brWeekday: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()],
    });
  });
}
```

**Pergunta-chave:** o `weekdayLabel` do slot (escolhido pelo admin em BR) bate com `utcWeekday` ou `brWeekday` das classes geradas?

#### Query 4 — Aulas do mês corrente — visão BR vs UTC

```js
const now = new Date();
const brMonth = now.getMonth() + 1;
const brYear = now.getFullYear();
const utcMonth = now.getUTCMonth() + 1;
const utcYear = now.getUTCFullYear();
console.log('Mês corrente — BR:', brMonth, '/', brYear, '— UTC:', utcMonth, '/', utcYear);

const snap = await db.collection('classes').get();
const inBR = [];
const inUTC = [];
snap.docs.forEach(d => {
  const ts = d.data().scheduledDate;
  if (!ts) return;
  const date = ts.toDate();
  if (date.getMonth() + 1 === brMonth && date.getFullYear() === brYear) inBR.push(d.id);
  if (date.getUTCMonth() + 1 === utcMonth && date.getUTCFullYear() === utcYear) inUTC.push(d.id);
});
const onlyBR = inBR.filter(id => !inUTC.includes(id));
const onlyUTC = inUTC.filter(id => !inBR.includes(id));
console.log({ totalBR: inBR.length, totalUTC: inUTC.length, onlyBR: onlyBR.length, onlyUTC: onlyUTC.length });
console.log('Apenas em BR:', onlyBR);
console.log('Apenas em UTC:', onlyUTC);
```

**Pergunta-chave:** alguma aula está em listas diferentes? Se sim, é uma aula que **vai pro fechamento de meses diferentes** dependendo da escolha de fuso.

---

### Output esperado e decisão

Manda pra mim os outputs das 4 queries. Eu vou analisar e te entrego uma decisão:

| Cenário | Decisão |
|---------|---------|
| `shifted = 0` em Q2 | Sorte — fuso não afeta esses dados. Aceitamos UTC midnight e seguimos. Documentamos como risco futuro. |
| `shifted > 0` mas `onlyBR/onlyUTC = 0` em Q4 | Aulas ficam no mesmo mês independente do fuso. Sem impacto pro Fechamento. Seguimos. |
| `shifted > 0` E `onlyBR/onlyUTC > 0` em Q4 | Bug real. Corrijo a CF antes da Sprint 4. Fix: trocar `Timestamp.fromDate(c.date)` por construção em BR (somar 3h de offset OU usar BRT explícito). |

---

## P3 — OPCIONAL: Migration do `module` no audit_log

**Diagnóstico:** entries de agenda/sub/cob criadas desde Sprint 2 estão com `module: 'professores'` em vez de `'agenda'`. Bug fixado na sessão 17. Entries novas saem corretas. Histórico fica "errado".

**Decisão recomendada na sessão 17: NÃO migrar.** Mas se quiser fazer mesmo assim, segue o script.

### Script de migration (opcional)

```js
const tiposAgenda = [
  'slot_created', 'slot_updated', 'slot_deactivated', 'slot_activated',
  'schedule_template_created',
  'class_status_changed',
  'substitution_created', 'substitution_accepted', 'substitution_rejected', 'substitution_cancelled',
  'coverage_requested', 'coverage_picked', 'coverage_cancelled',
];

// DRY-RUN — listar candidatos
const snap = await db.collection('audit_log').get();
const candidatos = snap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(e => tiposAgenda.includes(e.type) && e.module !== 'agenda');

console.log(`📊 ${candidatos.length} entries a migrar.`);
console.table(candidatos.slice(0, 5).map(c => ({ id: c.id, type: c.type, currentModule: c.module })));

window.__auditMigration = candidatos;
```

```js
// APPLY — só rodar depois de conferir o dry-run
const batch = db.batch();
window.__auditMigration.forEach(c => {
  batch.update(db.collection('audit_log').doc(c.id), { module: 'agenda' });
});
await batch.commit();
console.log(`✅ ${window.__auditMigration.length} entries migradas pra module='agenda'`);
```

> ⚠️ Cuidado se houver muitos docs (>400) — batches Firestore têm limite de 500 operações. Se for o caso, eu mando uma versão em chunks. Provável que tenhamos <100 entries no audit_log de staging, então 1 batch funciona.

---

## Ordem recomendada

1. **P1 primeiro** (~2 min) — deploy do índice, sem dependências
2. **P2 em seguida** (~15 min) — diagnóstico do fuso, me manda os outputs, eu decido
3. **P3 só se você quiser** (~5 min) — migration opcional do audit_log

Após P1 e P2 concluídos, **abrir nova sessão** comigo e dizer "executei o runbook, eis os outputs". Eu valido e seguimos pro playbook Sprint 4a.

---

## Estado salvo pra retomada

| Item | Detalhe |
|------|---------|
| Sprint 3b | ✅ Validada 10/10 |
| Commit produção comissões (sessão 16) | `6f0a15b` no `main` |
| Bugs corrigidos sessão 17 (local) | `CoverageService.pick` + `AuditService.log` |
| Pendente deploy | índice composto `substitutions(substituteUserId, status, requestedAt)` |
| Pendente investigação | fuso UTC↔BR no `scheduledDate` das classes |
