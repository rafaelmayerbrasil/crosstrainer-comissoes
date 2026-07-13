# Propagação opcional da edição da grade pras aulas já criadas · Design

**Data:** 2026-07-12
**Origem:** decisão da Seção 0 do `docs/checklist-deploy-producao.md` (edição de grade não propaga). Escolha do usuário: oferecer, ao salvar a edição de um slot, aplicar também às próximas aulas já criadas — de forma **opt-in** e **segura**.

## Objetivo

Hoje, editar um slot da grade mexe só no template — as aulas já geradas (~4 semanas à frente) mantêm os dados antigos (geração é só-inserção, ID `slot+data`). Este design adiciona um **opt-in ao salvar a edição de um slot**: se houver aulas futuras "intocadas" desse slot, oferece atualizá-las (professor/modalidade/horário). Robusto à opinião futura do Rodrigo: quem não quer, responde "não" e nada muda.

## Não-objetivos

- **Mudança de dia da semana (`weekday`)** — não propaga (as aulas futuras estão nas datas do dia antigo; reescrever seria recriar/apagar instâncias). Vale só pra frente.
- **Desativar/apagar slot** — não cancela as aulas futuras aqui. Fica pra outro ciclo.
- **Propagação em lote de vários slots** — é por slot, na edição de um slot.
- **Undo/desfazer.** Não há reversão automática (as aulas viram dados novos).
- **Tocar em mês fechado** (irreversível, CLAUDE.md §5) — nunca.

## Decisões travadas (brainstorm)

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Que edições propagam | **professor, modalidade, horário** (mesmo dia da semana), atualização in-place |
| 2 | Quais aulas podem ser atualizadas | **só as intocadas**: `status=='prevista'` E `monthClosingId==null` E data ≥ hoje |
| 3 | Como é acionado | **opt-in**: confirm ao salvar, só quando há aulas elegíveis |
| 4 | Onde roda | **client-side** (gestão tem `classes.update` nas rules) — sem CF, sem deploy de functions |
| 5 | Feedback | toast simples "N aulas futuras atualizadas" (sem detalhamento do que pulou) |

## Comportamento (UX)

Ao **editar um slot existente** (só gestão edita a grade) e clicar Salvar:
1. Salva o slot (template) como hoje — `ScheduleSlotService.update`.
2. SE **o dia da semana ficou igual** E **mudou pelo menos um de** {professor, modalidade, startTime, endTime} E **existem aulas elegíveis** → mostra confirm:
   > "Aplicar também às **N** próximas aulas já criadas? \[Sim, aplicar] \[Não, só daqui pra frente]"
3. "Sim" → aplica o patch nas elegíveis (batch) → toast "N aulas futuras atualizadas."
4. "Não" ou sem aulas elegíveis → comportamento atual (só template; vale pra frente).

## Arquitetura

### Helper puro (novo módulo) — `class-propagation.js` (UMD, `window.ClassPropagation` / `require`)
```
planClassUpdatesForSlot(newSlot, existingClasses, todayISO) → {
  updates: [{ classId, patch }],   // só as elegíveis
  eligibleCount: number
}
```
- `newSlot`: `{ teacherId, modalityId, startTime, endTime, durationMinutes }` (os campos que propagam).
- `existingClasses`: `[{ id, status, monthClosingId, dateISO }]` — a camada IO converte `scheduledDate` (Timestamp) → `dateISO` 'YYYY-MM-DD' antes de chamar (mantém o helper puro/testável).
- **Elegível** ⇔ `status === 'prevista'` E `!monthClosingId` E `dateISO >= todayISO`.
- `patch` = `{ teacherId, originalTeacherId: teacherId, modalityId, startTime, endTime, durationMinutes }` (nas intocadas, `originalTeacherId` acompanha o novo titular, pois nunca houve substituição).
- Puro, sem DOM/Firebase. Testado por `scripts/smoke-class-propagation.js`.

### IO fina — `professores-agenda.js` (fluxo de salvar slot, ~linha 560, ramo `SlotFormState.editingId`)
Após `ScheduleSlotService.update` OK, e só no ramo de edição:
1. Se o `weekday` mudou OU nenhum campo propagável mudou → fim (sem prompt).
2. Consulta as aulas do slot: `collection('classes').where('slotId','==', editingId).get()` (só igualdade — **sem índice novo**). Mapeia p/ `{id, status, monthClosingId, dateISO}`.
3. `const { updates, eligibleCount } = ClassPropagation.planClassUpdatesForSlot(novoSlot, aulas, hojeISO)`.
4. Se `eligibleCount === 0` → fim.
5. `confirm(...)`. Se sim: aplica via `writeBatch` — para cada `{classId, patch}`: `batch.update(classes/{classId}, { ...patch, updatedAt: serverTimestamp() })`; commit. Toast "N aulas futuras atualizadas."

`todayISO` = hoje em horário BR (reusar o helper de data BR já usado na app).

## Segurança / rules

- Gestão (admin/superv) já tem `allow update` em `/classes` (firestore.rules:108). **Nenhuma mudança de rules.**
- A proteção de **mês fechado** para gestão NÃO está nas rules (só nas CFs) → é responsabilidade **desta lógica**: o filtro `!monthClosingId` no helper garante que mês fechado nunca é tocado. (Coberto por smoke.)

## Arquivos

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `class-propagation.js` | `planClassUpdatesForSlot` (puro) | **criar** |
| `scripts/smoke-class-propagation.js` | smoke do helper | **criar** |
| `professores-agenda.js` | hook no salvar-slot: query + confirm + batch + toast | modificar |
| `professores.html` | `<script src="class-propagation.js">` | modificar |

## Testes

- **Smoke** (`smoke-class-propagation.js`): mesmo `newSlot` + lista de aulas cobrindo — 2 `prevista` futuras (atualiza), 1 em mês fechado (`monthClosingId` set → pula), 1 `substituida` (pula), 1 `cancelada` (pula), 1 `prevista` passada (pula). Assert `updates` só com as 2 certas + o `patch` correto (incl. `originalTeacherId`). Caso sem elegíveis → `eligibleCount:0`.
- **Parse** dos arquivos alterados.
- **E2E staging** (com o Marcos, que agora tem grade): editar um slot dele (trocar horário/modalidade) → responder "Sim" → conferir que as `prevista` futuras mudaram na Minha Agenda; garantir que uma aula passada e uma substituída (se houver) não mudaram.

## Riscos / observações

- Só gestão edita grade, então o `classes.update` client-side é legítimo.
- `writeBatch` limita a 500 ops — folgado (são ~4-5 aulas por slot). Se algum dia passar de 500, fatiar; fora de escopo agora.
- Sem CF nem índice novo → sobe junto com o hosting. Produção só após homologação (CLAUDE.md §7).
