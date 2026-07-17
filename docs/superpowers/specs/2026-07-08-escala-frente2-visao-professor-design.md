# Design — Escala Inteligente · Frente 2 (visão do professor)

> **Data:** 2026-07-08 · **Status:** design aprovado em brainstorm com o usuário
> **Origem:** feedback do Rodrigo (07/07) — itens #9 e #11 das 12 sugestões.
> **Base:** continua `2026-07-07-escala-frente1-janela-eleicao-design.md` (Frente 1 no staging).
> **Memória:** [[frente1-escala-janela-eleicao]].

## 1. Contexto

Frente 2 dos 12 ajustes do Rodrigo. Cobre a **visão do professor**:

| # | Sugestão | |
|---|----------|--|
| #11 | Replicar as 5 abas (Sábados/Feriados/Eventos/Fim de ano/Escola Interna) na visão do professor | Frente 2 |
| #9 | Fim de ano: professor se candidata a cada data individualmente | Frente 2 |

Hoje a visão do professor (`renderEscalaPrefs` em `professores-escala-smart.js`) é uma **lista plana** das escalas com `status==='janela_aberta'`, onde ele marca Prefiro/Pode ser/Não posso (uma preferência por escala). Não há abas, nem candidatura por data no fim de ano.

## 2. Decisões fechadas (usuário, 08/07)

| Tema | Decisão |
|------|---------|
| **Papel das abas do professor** | **Candidatar onde cabe + consultar o resto.** Cada aba mostra as datas da categoria; onde há janela aberta (Sábados/Feriados/Fim de ano) ele marca preferência; nas demais (Eventos/Escola Interna) é read-only ("onde estou / sou líder"). O professor NÃO edita escala. |
| **Fim de ano (#9)** | **Por data, com exclusão de turno.** O professor marca Prefiro/Pode ser/Não posso pelo **dia**; quando não é "Não posso", pode **desmarcar** um dos turnos (Manhã / Tarde-Noite) que não puder. Default = dia inteiro disponível. |
| **Aba Eventos (professor)** | **Informativa** nesta frente (só lista os próximos eventos). Ganha convite/staff na Frente 3. |
| **Timeframe** | Mantém o toggle Próximos/Passados; foco em futuros. |

## 3. Modelo de dados

### 3.1 `scale_day_preferences` (nova coleção — só fim de ano)

Preferência por **data** dentro de uma escala de fim de ano:

```
doc id: `${scaleId}__${personId}__${date}`   (date = 'YYYY-MM-DD')
{
  scaleId, personId, date,
  pref: 'prefiro' | 'pode_ser' | 'nao_posso',
  excludedShifts: string[],   // turnos que NÃO pode nesse dia: ['manha'] | ['tarde_noite'] | []
  updatedAt,
}
```

- Sábados/Feriados continuam usando `scale_preferences` (uma pref por escala) — **sem mudança**.
- Fim de ano usa `scale_day_preferences` (uma pref por escala×pessoa×data).

## 4. Visão do professor — abas

`renderEscalaPrefs` é reescrita como visão em abas (reusa `ESCALA_TABS`, `EscalaSmartState.tab`/`.timeframe`). Estado do professor separado do de gestão onde necessário. Por aba:

### 4.1 Sábados / Feriados
- Lista as escalas da categoria (datas futuras por padrão).
- Escala com `isWindowOpen` verdadeiro → botões **Prefiro / Pode ser / Não posso** (fluxo/`setPreference` atuais) + prazo visível.
- Escala **consolidada/publicada** → chip read-only: **"✓ Você está escalado"** ou **"Não escalado"** (via `isPersonAssigned`).
- Mantém o atalho "Marcar Pode ser em todas" (nas janelas abertas da aba).

### 4.2 Fim de ano (#9)
- Para cada dia do período (dias não fechados): linha com **Prefiro / Pode ser / Não posso** (dia).
- Quando a marca ≠ "Não posso": dois toggles de turno **Manhã** / **Tarde-Noite**, ligados por padrão; desligar exclui aquele turno (`excludedShifts`).
- Só editável enquanto a **janela do fim de ano** estiver aberta (`isWindowOpen`); depois, read-only mostrando onde ficou escalado.
- Persiste via `setDayPreference`.

### 4.3 Eventos
- **Read-only informativo:** lista os próximos eventos (nome, data, etiqueta Interno/Externo). Sem ação. (Frente 3 traz convite/presença.)

### 4.4 Escola Interna
- **Read-only:** lista as sessões futuras; destaca onde **o professor é o líder** escalado ("★ Você lidera em DD/MM"). Sem ação (a gestão escala).

## 5. Serviço (`scale-service.js`)

Novos:
- `setDayPreference(scaleId, personId, date, pref, excludedShifts, deps)` — grava em `scale_day_preferences`; **valida o prazo** com `isWindowOpen` (mesma trava do `setPreference`).
- `listDayPreferences(scaleId, deps)` — lista as prefs por data de uma escala.
- `dayPrefsToAvailability(dayPrefs)` — **puro**: converte `[{personId,date,pref,excludedShifts}]` num mapa consultável `disp[personId][date][shift] = pref|null` (com 'nao_posso' bloqueando o dia; exclusão bloqueando o turno).
- `isPersonAssigned(scale, personId)` — **puro**: `true` se o personId está em algum `slot.assignedPersonId` da escala.

Alterado:
- `consolidateByDay` — passa a ler `listDayPreferences` e usar `dayPrefsToAvailability` para respeitar preferência por dia×turno na distribuição (hoje usa `listPreferences`, pref única por escala). Sábado/feriado (`consolidate`) **não muda**.

## 6. Componentes e arquivos

| Arquivo | Mudança |
|---------|---------|
| `scale-service.js` | `setDayPreference`, `listDayPreferences`, `dayPrefsToAvailability`, `isPersonAssigned`; `consolidateByDay` lê prefs por dia×turno |
| `professores-escala-smart.js` | `renderEscalaPrefs` vira visão em abas; render por aba (candidatura + read-only); UI de fim de ano por data + toggles de turno |
| `firestore.rules` | regra de `scale_day_preferences` (create/update: admin/superv OU `personId == professorId` do próprio; read: módulo prof) — espelha `scale_preferences` |
| `scripts/smoke-escala-frente2.js` | novo — helpers puros + `consolidateByDay` com prefs por dia |

## 7. Testes
- **Puros** (smoke Node): `dayPrefsToAvailability` (dia inteiro, exclusão de turno, 'nao_posso'), `isPersonAssigned`.
- **Serviço** (fake-firestore): `setDayPreference` respeita prazo; `consolidateByDay` respeita disponibilidade por dia×turno (ex.: quem excluiu Tarde-Noite não é escalado à tarde).
- **E2E staging:** professor abre abas; candidata sábado/feriado; fim de ano marca dia + desmarca turno; vê "Você está escalado"/"Você lidera"; gestão consolida e a preferência é respeitada.

## 8. Fora de escopo (Frente 3)
Staff de evento (deve/poderia #6), convite (#7), lembretes 7/4/1d (#8). A aba Eventos do professor fica informativa até lá.

## 9. Riscos / atenção
- **`consolidateByDay` mudança de contrato:** hoje consome pref única; passará a consumir prefs por dia×turno. Garantir retrocompat: se não houver `scale_day_preferences`, comportamento = todos disponíveis (como hoje na ausência de preferência) — sem regressão nas escalas de fim de ano já existentes.
- **Bloqueio de prazo** segue client/serviço (não nas rules), como na Frente 1 — tech debt aceito.
- **Regras de `scale_day_preferences`:** deployar junto (senão o professor não grava no staging). Validar por REST.
