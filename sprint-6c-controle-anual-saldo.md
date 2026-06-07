# Sprint 6c — Controle Anual de Saldo de Férias
**Objetivo:** Implementar visualização e controle de saldo de férias por professor, baseado no **período aquisitivo CLT** (12 meses a partir da data de admissão). Inclui validação de saldo na criação do pedido (soft warning), alerta de **férias vencidas** (mais de 2 anos sem tirar) e painel histórico anual.
**Pré-condições:** ✅ Sprints 1, 1.5, 2, 3a, 3b, 4a, 4b, 5a, 6a, 6b validadas em staging.
**Duração estimada:** 4-5 dias úteis.

> 💡 **Escopo:** "pacote completo" travado em 07/06/2026 — saldo + período aquisitivo + alerta vencidas + painel histórico. Validação por **soft warning** (alerta, não bloqueia).

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- **Painel Admin "📊 Saldos de Férias"** — lista todos professores ativos com saldo do período aquisitivo atual + indicador de status (no prazo / vencendo / vencida)
- **Painel Professor "📊 Meu Saldo de Férias"** — visão própria + histórico de todos períodos aquisitivos
- **Aviso inline no modal de solicitação** — mostra "Período aquisitivo X · já tirou Y dias · restam Z" antes do professor enviar
- **Soft warning ao exceder saldo** — sistema alerta visualmente mas **deixa criar/aprovar mesmo assim** (decisão do admin)
- **Alerta de férias vencidas** — badge vermelho no painel admin + audit log quando há professor com período concessivo expirado
- **Service `VacationBalanceService`** — computa saldo on-the-fly a partir de `teachers` + `vacation_requests` (sem nova coleção)
- **Comandos admin.js** — `vacation-balance <teacherId>`, `list-overdue-vacations`, `smoke-6c`
- **Audit log** com `module: 'ferias'` para alertas de vencimento
- **Smoke test** com 8 critérios + fixture autônoma

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Cálculo de período aquisitivo CLT por professor | Efetivo: 12 meses a partir de `hireDate`. Estagiário: 12 meses a partir de `internshipStartDate`. Eventual: sem direito (mantém comportamento 6a) |
| Saldo on-the-fly | `30 - sum(periods.days de vacation_requests aprovadas/pagas no período aquisitivo atual)` |
| Painel admin "📊 Saldos de Férias" | Tabela com prof, período aquisitivo atual, tirados/restantes, status colorido |
| Painel professor "📊 Meu Saldo" | Próprio saldo + histórico de períodos passados |
| Aviso inline no modal de solicitação | "Período aquisitivo X (DD/MM/AAAA - DD/MM/AAAA) · já tirou Y · restam Z" |
| Soft warning ao exceder | Modal mostra ⚠️ vermelho, mas botão "Solicitar mesmo assim" + obs justificativa obrigatória |
| Alerta de férias vencidas | Período concessivo = 12 meses após vencer aquisitivo. Após esse prazo → status "VENCIDA" + badge + audit |
| Histórico anual no painel professor | Lista cada período aquisitivo (passado e atual) com dias tirados e datas |
| Fallback se hireDate ausente | Usa `createdAt` do teacher como aproximação. Avisa no painel: "data estimada — confirme com admin" |
| Comandos admin | `vacation-balance <teacherId>`, `list-overdue-vacations`, `smoke-6c` |
| Audit log | `module: 'ferias'` em detecção de férias vencidas (1x por mês máximo, idempotente) |
| Smoke test | 8 critérios via script + fixture |

### ❌ NÃO ENTRA (vai pra backlog ou sprint futura)

| Item | Destino |
|------|---------|
| Pagamento DOBRADO automático de férias vencidas | Backlog — admin trata caso a caso via modo manual da Sprint 6b |
| Auto-criação de pedido de férias quando admin cadastra férias vencida | Backlog — admin gere via Sprint 6a normalmente |
| Alerta por email/WhatsApp ao admin sobre vencidas | Sprint 7 (Brevo) |
| Histórico salarial usado no cálculo de saldo | Backlog — saldo é só dias, não R$ |
| Acúmulo entre períodos (carry forward) | Não. CLT não permite — férias devem ser tiradas no próprio período concessivo |
| Configurar período aquisitivo customizado (diferente de CLT) | Backlog — exigiria UI de admin alterar regra |
| Bloqueio hard de pedido excedente | Não. Decisão: soft warning (D2) |

---

## 3. Arquivos a criar/modificar

```
crosstrainer-comissoes/
├── professores-shared.js              ← MOD — VacationBalanceService + helpers de período aquisitivo
├── professores-ferias.js              ← MOD — aviso inline + soft warning no modal + 2 painéis novos
├── professores.html                   ← MOD — pages page-meu-saldo + page-saldos-gestao + CSS
├── professores.js                     ← MOD — sidebar items + routing
└── scripts/
    └── admin.js                       ← MOD — vacation-balance + list-overdue + smoke-6c
```

**Sem alterações em:** `functions/index.js`, `firestore.rules`, `firestore.indexes.json` — tudo é client-side computado on-the-fly. Sem CF, sem nova coleção, sem novos índices.

---

## 4. Schemas

### Sem nova coleção — tudo computado

O saldo é função pura de:
- `teachers.{hireDate, internshipStartDate, type, createdAt}` (já existem)
- `vacation_requests.{teacherId, periods, totalDays, status, firstPeriodStart, lastPeriodEnd}` (já existem desde 6a/6b)

### Estrutura de dados retornada pelo `VacationBalanceService.getBalance(teacherId)`

```js
{
  teacherId: 'tch-lucas',
  teacherName: 'Lucas Mendes',
  teacherType: 'efetivo',
  
  // Período aquisitivo atual
  currentPeriod: {
    index: 3,                                  // qual número de período aquisitivo (1, 2, 3...)
    startDate: Timestamp,                      // hireDate + (index-1)*12 meses
    endDate: Timestamp,                        // hireDate + index*12 meses - 1 dia
    entitledDays: 30,                          // direito CLT
    daysTaken: 12,                             // soma de aprovadas/pagas no período
    daysRemaining: 18,
  },
  
  // Status legal
  status: 'ok' | 'warning' | 'overdue',
  // ok = ainda no período aquisitivo
  // warning = período aquisitivo terminou, mas dentro do período concessivo (12 meses extras)
  // overdue = período concessivo TAMBÉM expirou — férias VENCIDAS
  
  // Concessivo
  grantPeriod: {
    deadlineDate: Timestamp,                   // currentPeriod.endDate + 12 meses
    daysOverdue: 0,                            // se positivo, está vencida
  },
  
  // Histórico
  history: [
    {
      index: 1,
      startDate, endDate, entitledDays: 30,
      daysTaken: 30, daysRemaining: 0,
      status: 'closed',                        // closed = já passou + tirou tudo
      vacationRequestIds: ['vac-abc', 'vac-def'],
    },
    {
      index: 2,
      startDate, endDate, entitledDays: 30,
      daysTaken: 10, daysRemaining: 20,
      status: 'expired',                       // expired = não tirou tudo no prazo + período concessivo passou
      vacationRequestIds: ['vac-xyz'],
    },
    // ... currentPeriod fica fora do history (separado)
  ],
  
  // Fallback flag
  estimatedStartDate: false,                   // true se hireDate/internshipStartDate ausente
}
```

---

## 5. Sequência de implementação

### Etapa 1 — Helpers de período aquisitivo + Service (~1 dia)

#### Helpers em `professores-shared.js`
```js
// Pega data de início para cálculo de períodos aquisitivos
function getEntitlementStartDate(teacher) {
  if (teacher.type === 'efetivo' && teacher.hireDate) {
    return teacher.hireDate.toDate ? teacher.hireDate.toDate() : new Date(teacher.hireDate);
  }
  if (teacher.type === 'estagiario' && teacher.internshipStartDate) {
    return teacher.internshipStartDate.toDate ? teacher.internshipStartDate.toDate() : new Date(teacher.internshipStartDate);
  }
  // Fallback: createdAt do teacher
  if (teacher.createdAt) {
    return teacher.createdAt.toDate ? teacher.createdAt.toDate() : new Date(teacher.createdAt);
  }
  return null;
}

// Adiciona N meses a uma data (preservando fim de mês quando aplicável)
function addMonths(date, months) {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  d.setMonth(targetMonth);
  // Se o dia "estourou" pra próximo mês, volta pro último dia do mês anterior
  if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    d.setDate(0);
  }
  return d;
}

// Lista todos os períodos aquisitivos passados + atual
function getAcquisitionPeriods(teacher, asOfDate = new Date()) {
  const start = getEntitlementStartDate(teacher);
  if (!start) return { periods: [], estimatedStartDate: false };
  
  const periods = [];
  let cursor = new Date(start);
  let index = 1;
  
  while (cursor <= asOfDate) {
    const endDate = new Date(addMonths(cursor, 12));
    endDate.setDate(endDate.getDate() - 1);
    
    periods.push({ index, startDate: new Date(cursor), endDate, entitledDays: 30 });
    
    cursor = addMonths(cursor, 12);
    index++;
    if (index > 100) break;  // safety net
  }
  
  return {
    periods,
    estimatedStartDate: !(teacher.hireDate || teacher.internshipStartDate),
  };
}
```

#### `VacationBalanceService` em `professores-shared.js`
- `getBalance(teacherId)` — método principal, retorna estrutura do §4
- `getAllBalances({ unitId? })` — itera todos teachers ativos (eventual excluído), retorna array
- `listOverdueTeachers()` — filtra apenas com `status === 'overdue'`
- `checkAndLogOverdue()` — roda uma varredura idempotente: se há vencidas, grava 1 audit log do dia (deduplica por `YYYY-MM-DD`)

### Etapa 2 — UI Admin "📊 Saldos de Férias" (~1 dia)

- [ ] Sidebar item "📊 Saldos de Férias" visível pra admin/admin_gestao/supervisao
- [ ] Página `page-saldos-gestao`:
  - Toolbar: filtro por unidade + tipo de professor + status (todos / no prazo / vencendo / vencida)
  - Tabela: prof · tipo · admissão · período atual · tirados · restantes · status (badge colorido) · ações
  - Status badges:
    - 🟢 `OK` — saldo positivo + dentro do período aquisitivo
    - 🟡 `Vencendo` — período aquisitivo terminou mas concessivo ainda válido (faltam <6 meses)
    - 🔴 `VENCIDA` — concessivo expirou
  - Click na linha → modal de detalhe com histórico completo
- [ ] Modal de detalhe:
  - Cabeçalho com nome + tipo + datas-chave
  - Tabela do histórico (períodos passados) com vacation_request links
  - Card destacado do período atual
  - Botão "Ver férias deste prof" → vai pra Gerenciar Férias filtrado

### Etapa 3 — UI Professor "📊 Meu Saldo" (~0,5 dia)

- [ ] Sidebar item "📊 Meu Saldo" visível pra professor/professor_estagiario
- [ ] Página `page-meu-saldo`:
  - Card grande no topo: "Você tem X dias disponíveis até DD/MM/AAAA"
  - Botão "Solicitar férias agora" → abre modal do 6a
  - Tabela de histórico abaixo
- [ ] Eventual: tela mostra mensagem "Eventuais não têm direito formal a férias"

### Etapa 4 — Aviso inline + soft warning no modal de solicitação (~0,5 dia)

- [ ] Modal de solicitação (existente do 6a) ganha bloco informativo NO TOPO:
  ```
  ────────────────────────────────────
  📊 Seu saldo atual
  Período aquisitivo: 15/03/2025 - 14/03/2026 (atual: 3º)
  Já tirou: 12 dias | Restam: 18 dias
  ────────────────────────────────────
  ```
- [ ] Validação no submit (client-side):
  - Calcula totalDays do pedido novo + dias já tirados no período aquisitivo onde cai o primeiro período
  - Se ultrapassa 30 → mostra modal de confirmação vermelho:
    ```
    ⚠️ ATENÇÃO
    Este pedido excede o saldo do período aquisitivo em 5 dias.
    Você está pedindo 20 dias, mas só restam 15.
    
    Justificativa (obrigatória): [textarea]
    
    [ Cancelar ]  [ Solicitar mesmo assim ]
    ```
  - Justificativa vai pro campo `reason` do vacation_request + audit log
- [ ] Mesmo flow no modal de aprovação (admin vê o alerta também)

### Etapa 5 — Alerta de férias vencidas + auditoria (~0,5 dia)

- [ ] Listener em background no painel admin: ao abrir, roda `checkAndLogOverdue()` (idempotente por dia)
- [ ] Se há prof com status='overdue', grava em `audit_log`:
  ```js
  {
    type: 'vacation_overdue_detected',
    module: 'ferias',
    details: 'Professor Lucas Mendes está com férias vencidas (período aquisitivo 2: 15/03/2024-14/03/2025)',
    entityType: 'teacher', entityId: 'tch-lucas',
    timestamp: serverTs(),
    metaDayKey: '2026-06-08',  // pra dedup
  }
  ```
- [ ] Dedup: query `audit_log where type='vacation_overdue_detected' AND metaDayKey=hoje` — se já existe, pula
- [ ] Card de alerta no topo do painel "📊 Saldos de Férias" quando há N vencidas:
  ```
  🚨 ATENÇÃO: 2 professor(es) com férias vencidas
  Lucas Mendes (15 dias vencidos) · Maria Costa (3 dias vencidos)
  → Recomendação: agendar férias urgente (CLT exige pagamento dobrado após período concessivo)
  ```

### Etapa 6 — Comandos admin.js + Smoke (~0,5 dia)

#### Comandos novos
```
vacation-balance <teacherId>           — mostra saldo detalhado de um prof
list-overdue-vacations                 — lista todos com status='overdue'
list-balances [unitId] [type]          — tabela de saldos de todos ativos
smoke-6c                                — 8 critérios automatizáveis
```

#### Cenários do smoke-6c
1. C1 — Professor efetivo com `hireDate` de 15/03/2024 → atual = período 3 (15/03/2026-14/03/2027)
2. C2 — Professor com 12 dias aprovados no período atual → daysRemaining = 18
3. C3 — Professor sem férias aprovadas → daysRemaining = 30
4. C4 — Professor com 30 dias aprovados → daysRemaining = 0
5. C5 — Eventual → retorna `null` ou erro "sem direito"
6. C6 — Professor sem hireDate → fallback usa createdAt + flag `estimatedStartDate: true`
7. C7 — Professor com período aquisitivo expirado + concessivo ativo → status='warning'
8. C8 — Professor com concessivo expirado → status='overdue' + audit log gerado

### Etapa 7 — Deploy + Validação (~0,5 dia)

- [ ] Deploy:
  - `firebase deploy --only hosting --project staging`
- [ ] Rodar `node scripts/admin.js --project staging smoke-6c`
- [ ] Fixture-6c: cria efetivo com hireDate antigo + 2 vacation_requests aprovadas em períodos diferentes → valida cálculo + status

---

## 6. Decisões importantes

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Escopo da sprint | **Pacote completo:** saldo + período aquisitivo CLT + alerta vencidas + painel histórico. Travado 07/06 |
| D2 | Validação ao exceder | **Soft warning** — alerta visual + justificativa obrigatória, mas permite. Confirmado 07/06 |
| D3 | Período de contagem | **Período aquisitivo CLT por professor** — 12 meses a partir da data de admissão. Confirmado 07/06 |
| D4 | Quem tem direito? | Efetivo + estagiário. Eventual **NÃO** (mantém regra 6a) |
| D5 | Direito CLT pra estagiário | **30 dias por período aquisitivo** (Lei 11.788/2008 Art. 13). Mesma regra do efetivo neste sprint |
| D6 | Fallback se data ausente | Usa `teacher.createdAt`. Marca com flag `estimatedStartDate: true`. UI mostra aviso "data estimada — confirme com admin" |
| D7 | Vacation_requests considerados | **Apenas status='aprovada'.** Pendentes não entram no cálculo (ainda nem decidiu). Cancelas/recusadas obviamente não |
| D8 | Como categorizar férias por período aquisitivo | Pelo `firstPeriodStart`: se cai no período X, conta no X (mesmo se atravessa pra X+1). Simplifica |
| D9 | Período concessivo | **12 meses após vencer o aquisitivo** (CLT Art. 134). Após isso, status='overdue' |
| D10 | Definição de "vencendo" | `warning` = aquisitivo expirou + concessivo com <6 meses restantes |
| D11 | Carry forward entre períodos | **Não.** CLT não permite — férias devem ser tiradas no próprio concessivo. Sobra é "perdida" oficialmente, mas mantida no histórico |
| D12 | Cache do cálculo | Não. Computado on-the-fly toda vez. Saldo de ~50 professores roda em <100ms |
| D13 | Auditoria de vencidas | Audit log **1x por dia** (dedup por `metaDayKey: 'YYYY-MM-DD'`). Não floodar |
| D14 | Deploy em produção | Não. Aguarda homologação completa do módulo |

---

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Painel admin "📊 Saldos de Férias" lista todos ativos | Login admin · acessar página · ver tabela com todos professores efetivo/estagiário ativos |
| 2 | Cálculo correto de período aquisitivo | Lucas com hireDate=15/03/2024, hoje=07/06/2026 → currentPeriod.index=3 (15/03/2026-14/03/2027) |
| 3 | Saldo subtrai férias aprovadas | Prof com 1 férias aprovada de 12 dias → daysRemaining = 18 |
| 4 | Status colorido correto | Prof com aquisitivo OK → 🟢 · concessivo recente → 🟡 · vencida → 🔴 |
| 5 | Painel professor mostra próprio saldo + histórico | Login prof → ver card "X dias até DD/MM" + tabela histórico |
| 6 | Aviso inline no modal de solicitação | Abrir modal · cabeçalho mostra "Período X · tirou Y · restam Z" |
| 7 | Soft warning ao exceder | Pedir 20 dias com 15 restantes → modal vermelho · botão "Solicitar mesmo assim" + justificativa obrigatória |
| 8 | Solicitação com justificativa é criada | Após enviar com justificativa → vacation_request criado com reason contendo a justificativa |
| 9 | Alerta de vencidas no painel | Forçar prof com concessivo expirado · ver card vermelho 🚨 no topo |
| 10 | Audit log de vencidas é idempotente | Abrir painel 3x no mesmo dia → 1 entry em `audit_log` (não 3) |
| 11 | Fallback se hireDate ausente | Prof sem hireDate · saldo computa usando createdAt · UI mostra "data estimada" |
| 12 | Eventual mostra mensagem | Login eventual · painel mostra "Eventuais não têm direito formal a férias" sem tabela |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Cálculo de meses confunde anos bissextos / fins de mês | 🟡 Média | Helper `addMonths` trata overflow. Cenários testados em smoke (15/03 + 12m, 31/01 + 1m, etc.) |
| Prof com hireDate em 2010 gera 16+ períodos | 🟢 Baixa | Safety net `if (index > 100) break`. UI lista paginada |
| Vacation_requests cancelada APÓS aprovação ainda conta | 🟡 Média | Filtro: só `status === 'aprovada'`. Cancelada vai pra 'cancelada' → não conta. Teste no smoke |
| Performance do `getAllBalances` com 50 professores | 🟢 Baixa | 1 query teachers + 1 query vacation_requests (sem N+1). ~100ms estimado |
| Soft warning ignorado sistematicamente | 🟡 Média | Audit log do alerta + justificativa obrigatória força reflexão. Backlog: relatório semanal pro admin |
| Férias antigas de antes do sistema → histórico vazio | 🟡 Média | Painel mostra "Histórico anterior à 6a não disponível". Admin pode adicionar manualmente via Sprint 6a |
| Fallback `createdAt` distante da admissão real | 🟢 Baixa | Flag `estimatedStartDate: true` + aviso visual. Admin corrige editando teacher |
| Período aquisitivo "atual" muda de dia (15/03 vira 16/03) | 🟢 Baixa | Cálculo determinístico baseado em hireDate. Mudança natural na virada do ciclo |

---

## 9. Após a sprint

Sprint 6c termina quando os 12 critérios passarem. Próximo passo:
- 🟢 **Sprint 7** — Notificações por email (Brevo + Trigger Email) — alertas de vencimento via email
- 🟢 **Sprint 8** — Relatórios + Exportações (Excel) — exportar saldos + histórico
- 🟢 **Polimentos finais** — UX, bugs cosméticos, tech debt
- Aguarda **homologação completa do módulo** antes do deploy em produção

---

## 📋 Snippets-chave (pra desenvolvimento autônomo)

### Snippet 1 — Helpers de período aquisitivo

```js
// Pega data de início da contagem CLT pra um teacher
function getEntitlementStartDate(teacher) {
  if (teacher.type === 'eventual') return null;
  
  if (teacher.type === 'efetivo' && teacher.hireDate) {
    return teacher.hireDate.toDate ? teacher.hireDate.toDate() : new Date(teacher.hireDate);
  }
  if (teacher.type === 'estagiario' && teacher.internshipStartDate) {
    return teacher.internshipStartDate.toDate ? teacher.internshipStartDate.toDate() : new Date(teacher.internshipStartDate);
  }
  // Fallback: createdAt
  if (teacher.createdAt) {
    return teacher.createdAt.toDate ? teacher.createdAt.toDate() : new Date(teacher.createdAt);
  }
  return null;
}

// Adiciona N meses preservando fim de mês quando aplicável
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== originalDay) {
    d.setDate(0);  // estourou pro mês seguinte? volta pro último dia do mês alvo
  }
  return d;
}

// Lista TODOS os períodos aquisitivos do prof (passados + atual)
function listAcquisitionPeriods(teacher, asOfDate = new Date()) {
  const start = getEntitlementStartDate(teacher);
  if (!start) return [];
  
  const periods = [];
  let cursor = new Date(start);
  let index = 1;
  
  while (cursor <= asOfDate) {
    const endDate = addMonths(cursor, 12);
    endDate.setDate(endDate.getDate() - 1);
    
    periods.push({
      index,
      startDate: new Date(cursor),
      endDate: new Date(endDate),
      entitledDays: 30,
    });
    
    cursor = addMonths(cursor, 12);
    index++;
    if (index > 100) break;
  }
  
  return periods;
}

// Período aquisitivo atual = o último que contém asOfDate
function findCurrentPeriod(periods, asOfDate = new Date()) {
  for (let i = periods.length - 1; i >= 0; i--) {
    if (periods[i].startDate <= asOfDate && asOfDate <= periods[i].endDate) {
      return { ...periods[i], isCurrent: true };
    }
  }
  return null;
}
```

### Snippet 2 — `VacationBalanceService.getBalance`

```js
const VacationBalanceService = {
  
  async getBalance(teacherId) {
    const db = firebase.firestore();
    const teacherDoc = await db.collection('teachers').doc(teacherId).get();
    if (!teacherDoc.exists) return { success: false, error: 'Professor não encontrado' };
    const teacher = { id: teacherDoc.id, ...teacherDoc.data() };
    
    if (teacher.type === 'eventual') {
      return { success: false, error: 'Eventuais não têm direito formal a férias.' };
    }
    
    const periods = listAcquisitionPeriods(teacher);
    if (periods.length === 0) {
      return { success: false, error: 'Sem dados pra calcular período aquisitivo.' };
    }
    
    // Busca todas as vacation_requests aprovadas
    const vacSnap = await db.collection('vacation_requests')
      .where('teacherId', '==', teacherId)
      .where('status', '==', 'aprovada').get();
    const allVacs = vacSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Atribui cada vacation_request ao período aquisitivo onde cai firstPeriodStart
    const vacsByPeriod = {};
    for (const v of allVacs) {
      const startDate = v.firstPeriodStart?.toDate
        ? v.firstPeriodStart.toDate()
        : new Date(v.firstPeriodStart || v.periods?.[0]?.startDate?.toDate?.() || 0);
      const period = periods.find(p => p.startDate <= startDate && startDate <= p.endDate);
      if (period) {
        if (!vacsByPeriod[period.index]) vacsByPeriod[period.index] = [];
        vacsByPeriod[period.index].push(v);
      }
    }
    
    // Calcula daysTaken por período
    const periodsWithUsage = periods.map(p => {
      const vacs = vacsByPeriod[p.index] || [];
      const daysTaken = vacs.reduce((s, v) => s + (v.totalDays || 0), 0);
      return {
        ...p,
        daysTaken,
        daysRemaining: Math.max(0, p.entitledDays - daysTaken),
        vacationRequestIds: vacs.map(v => v.id),
      };
    });
    
    // Período atual
    const now = new Date();
    const currentIdx = periodsWithUsage.findIndex(p => p.startDate <= now && now <= p.endDate);
    const current = currentIdx >= 0 ? periodsWithUsage[currentIdx] : periodsWithUsage[periodsWithUsage.length - 1];
    
    // Status
    let status = 'ok';
    let grantDeadline = null;
    let daysOverdue = 0;
    
    if (current.endDate < now) {
      // Aquisitivo terminou, está em período concessivo
      grantDeadline = addMonths(current.endDate, 12);
      if (now > grantDeadline) {
        status = 'overdue';
        daysOverdue = Math.floor((now - grantDeadline) / 86400000);
      } else {
        const monthsLeft = (grantDeadline - now) / (30 * 86400000);
        status = monthsLeft < 6 ? 'warning' : 'ok';
      }
    }
    
    // Marca status nos passados (closed se tirou tudo, expired se sobrou e concessivo passou)
    const history = periodsWithUsage.slice(0, currentIdx >= 0 ? currentIdx : periodsWithUsage.length - 1)
      .map(p => {
        const concessiveEnd = addMonths(p.endDate, 12);
        return {
          ...p,
          status: p.daysRemaining === 0
            ? 'closed'
            : (now > concessiveEnd ? 'expired' : 'pending'),
        };
      });
    
    return {
      success: true,
      data: {
        teacherId, teacherName: teacher.name, teacherType: teacher.type,
        currentPeriod: current,
        status,
        grantPeriod: { deadlineDate: grantDeadline, daysOverdue },
        history,
        estimatedStartDate: !(teacher.hireDate || teacher.internshipStartDate),
      }
    };
  },
  
  async getAllBalances({ unitId } = {}) {
    const db = firebase.firestore();
    let q = db.collection('teachers').where('isActive', '==', true);
    const snap = await q.get();
    const teachers = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => t.type !== 'eventual')
      .filter(t => !unitId || t.primaryUnitId === unitId || (t.unitIds || []).includes(unitId));
    
    const results = await Promise.all(teachers.map(t => this.getBalance(t.id)));
    return {
      success: true,
      data: results.filter(r => r.success).map(r => r.data),
    };
  },
  
  async listOverdueTeachers() {
    const all = await this.getAllBalances();
    if (!all.success) return all;
    return { success: true, data: all.data.filter(b => b.status === 'overdue') };
  },
  
  async checkAndLogOverdue() {
    const overdue = await this.listOverdueTeachers();
    if (!overdue.success || overdue.data.length === 0) return { success: true, logged: 0 };
    
    const db = firebase.firestore();
    const todayKey = new Date().toISOString().slice(0, 10);
    
    let logged = 0;
    for (const o of overdue.data) {
      // Dedup
      const existing = await db.collection('audit_log')
        .where('type', '==', 'vacation_overdue_detected')
        .where('entityId', '==', o.teacherId)
        .where('metaDayKey', '==', todayKey)
        .limit(1).get();
      if (!existing.empty) continue;
      
      await AuditService.log({
        type: 'vacation_overdue_detected',
        details: `Férias vencidas: ${o.teacherName} (${o.grantPeriod.daysOverdue} dias após período concessivo)`,
        entityType: 'teacher', entityId: o.teacherId,
        before: null, after: o,
        module: 'ferias',
        metaDayKey: todayKey,
      });
      logged++;
    }
    return { success: true, logged };
  },
};
```

### Snippet 3 — Aviso inline + soft warning no modal de solicitação

```js
// Em professores-ferias.js, dentro de openSolicitarFeriasModal()
async function renderBalanceWarning(teacherId, requestedDays) {
  const balanceRes = await VacationBalanceService.getBalance(teacherId);
  if (!balanceRes.success) return '';  // eventual ou sem dados
  const b = balanceRes.data;
  
  const fmtDate = (d) => d.toLocaleDateString('pt-BR');
  let html = `
    <div class="balance-info">
      <strong>📊 Seu saldo</strong>
      <div>Período aquisitivo ${b.currentPeriod.index}: ${fmtDate(b.currentPeriod.startDate)} - ${fmtDate(b.currentPeriod.endDate)}</div>
      <div>Já tirou: <strong>${b.currentPeriod.daysTaken}</strong> dias · Restam: <strong>${b.currentPeriod.daysRemaining}</strong> dias</div>
    </div>
  `;
  
  // Warning se requestedDays > daysRemaining
  if (requestedDays > b.currentPeriod.daysRemaining) {
    const excess = requestedDays - b.currentPeriod.daysRemaining;
    html += `
      <div class="balance-warning">
        ⚠️ Este pedido excede o saldo do período em <strong>${excess} dias</strong>.
        Você está pedindo ${requestedDays}, mas só restam ${b.currentPeriod.daysRemaining}.
      </div>
      <div class="form-group">
        <label>Justificativa (obrigatória)*</label>
        <textarea id="excessJustification" rows="2" required></textarea>
      </div>
    `;
  }
  
  return html;
}

// No submit do modal
async function submitVacationRequest(teacherId, periods, reason) {
  const totalDays = periods.reduce((s, p) => s + p.days, 0);
  const balanceRes = await VacationBalanceService.getBalance(teacherId);
  
  if (balanceRes.success && totalDays > balanceRes.data.currentPeriod.daysRemaining) {
    const justification = document.getElementById('excessJustification')?.value?.trim();
    if (!justification) {
      toast('Justificativa obrigatória para excesso de saldo.', 'error');
      return;
    }
    reason = `${reason || ''}\n\n⚠️ EXCESSO DE SALDO: ${justification}`.trim();
  }
  
  return VacationService.request({ teacherId, periods, reason });
}
```

### Snippet 4 — Painel admin "📊 Saldos de Férias"

```js
// professores-ferias.js — nova função
async function renderSaldosGestaoPage() {
  const container = document.getElementById('page-saldos-gestao');
  if (!container) return;
  
  container.innerHTML = '<div class="loader">Calculando saldos...</div>';
  
  const all = await VacationBalanceService.getAllBalances();
  if (!all.success) {
    container.innerHTML = '<div class="error">' + all.error + '</div>';
    return;
  }
  
  const balances = all.data;
  const overdueCount = balances.filter(b => b.status === 'overdue').length;
  const warningCount = balances.filter(b => b.status === 'warning').length;
  
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
  
  container.innerHTML = `
    <h2>📊 Saldos de Férias</h2>
    
    ${overdueCount > 0 ? `
      <div class="alert-overdue">
        🚨 <strong>ATENÇÃO: ${overdueCount} professor(es) com férias vencidas</strong>
        <div>${balances.filter(b => b.status === 'overdue')
          .map(b => `${b.teacherName} (${b.grantPeriod.daysOverdue}d vencidos)`).join(' · ')}</div>
        <div class="alert-note">CLT exige pagamento dobrado após período concessivo. Agendar urgente.</div>
      </div>
    ` : ''}
    
    ${warningCount > 0 ? `
      <div class="alert-warning">
        ⚠️ ${warningCount} professor(es) com período aquisitivo expirado (concessivo ativo)
      </div>
    ` : ''}
    
    <table class="balances-table">
      <thead>
        <tr>
          <th>Professor</th><th>Tipo</th><th>Período Atual</th>
          <th>Tirados</th><th>Restantes</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${balances.map(b => `
          <tr class="balance-row status-${b.status}">
            <td>${escapeHtml(b.teacherName)}${b.estimatedStartDate ? ' <span class="badge-est">~est</span>' : ''}</td>
            <td>${b.teacherType}</td>
            <td>${b.currentPeriod.index}º · ${fmtDate(b.currentPeriod.startDate)} - ${fmtDate(b.currentPeriod.endDate)}</td>
            <td>${b.currentPeriod.daysTaken}</td>
            <td><strong>${b.currentPeriod.daysRemaining}</strong></td>
            <td><span class="status-badge ${b.status}">${statusLabel(b.status)}</span></td>
            <td><a onclick="openBalanceDetailModal('${b.teacherId}')">Detalhes</a></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  // Dispara checkAndLogOverdue em background (idempotente)
  VacationBalanceService.checkAndLogOverdue().catch(console.warn);
}

function statusLabel(s) {
  return s === 'ok' ? '🟢 OK' : s === 'warning' ? '🟡 Vencendo' : '🔴 VENCIDA';
}
```

### Snippet 5 — Skeleton do smoke-6c

```js
// scripts/admin.js
async function cmdSmoke6c() {
  console.log('\n══════ SMOKE TEST Sprint 6c — Controle Anual de Saldo ══════\n');
  
  const teachersSnap = await db.collection('teachers').where('isActive', '==', true).get();
  const teachers = teachersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  
  console.log(`Total professores ativos: ${teachers.length}`);
  console.log(`  Efetivos: ${teachers.filter(t => t.type === 'efetivo').length}`);
  console.log(`  Estagiários: ${teachers.filter(t => t.type === 'estagiario').length}`);
  console.log(`  Eventuais: ${teachers.filter(t => t.type === 'eventual').length}`);
  
  // Conta com hireDate / internshipStartDate
  const withHire = teachers.filter(t => t.type === 'efetivo' && t.hireDate).length;
  const withIntern = teachers.filter(t => t.type === 'estagiario' && t.internshipStartDate).length;
  console.log(`\n  Efetivos com hireDate: ${withHire}`);
  console.log(`  Estagiários com internshipStartDate: ${withIntern}`);
  
  // Vacation requests por status
  const vacAll = await db.collection('vacation_requests').get();
  const byStatus = {};
  vacAll.docs.forEach(d => {
    const s = d.data().status;
    byStatus[s] = (byStatus[s] || 0) + 1;
  });
  console.log(`\nVacation_requests: ${vacAll.size} total`);
  console.log('  Por status:', byStatus);
  
  // Audit de vencidas
  const auditOverdue = await db.collection('audit_log')
    .where('type', '==', 'vacation_overdue_detected')
    .orderBy('timestamp', 'desc').limit(5).get();
  console.log(`\nAudit overdue (últimos 5): ${auditOverdue.size}`);
  auditOverdue.docs.forEach(d => {
    const a = d.data();
    console.log(`  [${a.metaDayKey}] ${a.details}`);
  });
  
  console.log('\n══════ FIM SMOKE TEST Sprint 6c ══════');
  console.log('Para validação C1-C12 com fixture: node scripts/fixture-6c.js --project staging\n');
}
```

---

## 🔁 Observações finais

1. **Sem nova coleção, sem novos índices, sem CF nova** — sprint 100% client-side. Cálculo on-the-fly é rápido (~100ms pra 50 profs).
2. **Reuso de Sprint 6a:** `VacationService` permanece intacto. `VacationBalanceService` é Service novo, separado.
3. **Reuso de Sprint 6b:** `firstPeriodStart` / `lastPeriodEnd` (denormalização do 6b) são usados pra atribuir vacation_request ao período aquisitivo.
4. **Conformidade legal:** D5 (estagiário 30 dias) reflete Lei 11.788/2008. D9 (12 meses concessivo) reflete CLT Art. 134. Mudanças nessas decisões precisam aprovação do cliente.
5. **Timezone:** todas as datas em horário local do navegador (não BR midnight UTC) — aqui são datas calendaristas, não horários de aula.
6. **Quando travar:** chamar com erro/diff, revisão pontual.
