# Sprint 4b — Pagamentos + Recibos
**Objetivo:** Fechar o ciclo financeiro: emissão de recibos (individual e em lote), confirmação de pagamento e sistema de crédito automático (divergências geram crédito abatido no próximo recibo).
**Pré-condições:** ✅ Sprint 4a fechada (`monthly_closings` com snapshot consolidado por professor + `classes` congeladas).
**Duração estimada:** 1,5 semana (~6-7 dias úteis).

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- Item "💳 Pagamentos" na sidebar (apenas admin · D1 da Sprint 4a)
- Tela mostra todos os `monthly_closings` agrupados por mês/unidade com status de pagamento por professor
- Fluxo de **2 etapas separadas**:
  1. **Emitir recibo** → cria `receipts/{id}` com número sequencial · status `aguardando_pagamento`
  2. **Confirmar pagamento** → cria `payment_records/{id}` · status `pago` · marca o recibo
- Página de impressão do recibo via `window.print()` (CSS print-friendly · padrão A4)
- Emissão em **lote**: botão "Emitir TODOS" gera N recibos de uma vez (transação Firestore)
- Emissão **individual**: botão por linha de professor
- Sistema de **crédito automático**:
  - Após confirmar pagamento, se admin perceber divergência (mudou base depois) → botão "💰 Registrar Crédito"
  - Diferença vira entry em `creditos_professores/{id}`
  - Recibo do próximo mês detecta créditos pendentes do professor e abate automaticamente
- Notificações in-app:
  - Professor recebe `recibo_emitido` quando admin emite
  - Professor recebe `pagamento_confirmado` quando admin confirma
- Audit log de todas as operações (`module: 'pagamentos'`)
- Validação em staging com 12 critérios

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Sidebar item "💳 Pagamentos" | Apenas `admin` (não `admin_gestao` · paridade com Sprint 4a D1) |
| Tela de pagamentos | Lista `monthly_closings` agrupados por unidade · status pago/pendente por professor |
| Filtros | Unidade · ano/mês · status (pago / pendente / parcial) |
| Modal detalhe do fechamento | Mostra cada professor com colunas: valor · recibo (nº) · status · ações |
| Emissão de recibo individual | Botão "📄 Emitir" em cada linha · cria `receipts/{id}` |
| Emissão em lote | Botão "📄 Emitir TODOS" · transação Firestore evita race · gera N recibos |
| Numeração sequencial | Contador atômico em `meta/receipt_counter` (igual módulo Comissões) |
| Página de impressão do recibo | URL específica `receipt.html?id={recId}` · CSS print A4 · `window.print()` |
| Confirmação de pagamento | Botão "💰 Confirmar pagamento" · cria `payment_records/{id}` |
| Registro de crédito | Botão "💰 Registrar Crédito" se valor divergiu pós-pagamento |
| Abate automático de créditos | Próximo recibo do professor detecta `creditos_professores` pendentes · abate · atualiza credit como "aplicado" |
| Notificação ao professor | `notifications` com type `recibo_emitido` / `pagamento_confirmado` |
| Painel do professor | Aba/seção "💰 Meus pagamentos" — vê recibos próprios + créditos pendentes |
| Audit log | `module: 'pagamentos'` para receipt_emitted, payment_confirmed, credit_registered, credit_applied |
| Security Rules | Receipt e payment_records read = admin OR own teacher · write = admin |
| Smoke test | 12 critérios, validação humana + script `admin.js` |

### ❌ NÃO ENTRA (vai pra Sprint posterior ou backlog)

| Item | Sprint |
|------|--------|
| Notificações por email do recibo | Sprint 7 (Brevo) |
| Geração de PDF server-side (Cloud Function + Storage) | Backlog — `window.print` resolve no MVP |
| Reabrir pagamento confirmado | Backlog (precisa workflow de revisão) |
| Estorno completo (cancelar recibo + revert credito) | Backlog |
| Histórico de versões do recibo se editado | Backlog (recibos não devem ser editados, só anulados) |
| Integração com sistema bancário (pagamento real) | Fora do escopo do projeto |
| Recibo em formato bancário oficial (NFS-e, etc) | Backlog (se cliente pedir) |
| Múltiplos métodos de pagamento (PIX, transferência, dinheiro) | Backlog (registrar como campo texto livre nesta sprint) |
| Comprovantes anexos (upload de comprovante de pagamento) | Backlog (Sprint Storage) |

---

## 3. Arquivos a criar/modificar

```
crosstrainer-comissoes/
├── professores.html                    ← MOD — page-pagamentos · modais · CSS
├── professores.js                      ← MOD — PROF_PAGES (admin only) · handler
├── professores-shared.js               ← MOD — ReceiptService + PaymentService + CreditService
├── professores-pagamentos.js           ← NOVO — telas de pagamentos
├── receipt.html                        ← NOVO — página standalone pra impressão do recibo
├── functions/index.js                  ← MOD — closeMonth incrementa receipt_counter (se centralizado)
├── firestore.rules                     ← MOD — receipts + payment_records + creditos_professores
└── firestore.indexes.json              ← MOD — índices para queries por unidade/mês/status
```

Decisão arquitetural:
- Recibo de impressão em arquivo dedicado (`receipt.html`) — abre em nova aba, CSS print-only, sem JS de app
- Comprovantes/notas anexadas = fora do escopo (não usa Firebase Storage)
- Numeração sequencial: contador transacional em `meta/receipt_counter.value`

---

## 4. Schemas

### `receipts/{receiptId}` — Sprint 4b cria
```js
{
  number: 42,                            // sequencial global (ou por unidade?)
  numberFormatted: '0042',
  closingId: 'unit-cp_2026-05',
  unitId: 'unit-cp',
  unitName: 'CrossTainer CP',
  year: 2026,
  month: 5,

  teacherId: 'tch-lucas',
  teacherName: 'Lucas Mendes',
  teacherCpf: '***.456.789-**',          // mascarado, snapshot do teacher
  teacherType: 'efetivo',

  // Valor original do fechamento
  closingValorTotal: 2640.00,            // do monthly_closings.teachers[].valorTotal
  closingValorHoras: 1592.50,
  closingHoras: 24.5,

  // Créditos aplicados
  creditosAplicados: [
    { creditoId: 'cred-xyz', valor: 50.00, reciboOrigemNum: 38, periodoOrigem: '2026-04' }
  ],
  totalCreditoAplicado: 50.00,

  // Valor líquido a pagar
  valorLiquido: 2590.00,

  status: 'aguardando_pagamento',         // | 'pago' | 'cancelado'
  emittedAt: Timestamp,
  emittedBy: 'uid-admin',
  emittedByName: 'Admin Teste',

  paidAt: Timestamp | null,
  paidBy: string | null,
  paymentRecordId: string | null,         // FK reverso após confirmação

  createdAt, updatedAt,
}
```

### `payment_records/{paymentId}` — Sprint 4b cria
```js
{
  receiptId: 'rec-xyz',
  receiptNumber: 42,
  closingId: 'unit-cp_2026-05',
  teacherId: 'tch-lucas',
  teacherName: 'Lucas Mendes',
  unitId: 'unit-cp',

  valor: 2590.00,                        // valor efetivamente pago
  metodo: 'transferencia',               // texto livre ('pix', 'dinheiro', etc)
  obs: '',

  paidAt: Timestamp,
  paidBy: 'uid-admin',
  paidByName: 'Admin Teste',

  createdAt, updatedAt,
}
```

### `creditos_professores/{creditoId}` — Sprint 4b cria
Equivalente ao `creditos/` do módulo Comissões.
```js
{
  teacherId: 'tch-lucas',
  teacherName: 'Lucas Mendes',
  valor: 50.00,                          // positivo se pagou a mais; negativo se faltou

  reciboOrigemId: 'rec-xyz',
  reciboOrigemNum: 38,
  periodoOrigem: '2026-04',
  motivo: 'base recalculada após pagamento',

  status: 'pendente',                    // | 'aplicado'
  appliedAt: Timestamp | null,
  appliedToReciboId: string | null,

  registeredAt: Timestamp,
  registeredBy: 'uid-admin',
  createdAt, updatedAt,
}
```

### `meta/receipt_counter` — contador atômico
```js
{
  value: 42,                              // último número emitido
  updatedAt: Timestamp,
}
```

---

## 5. Sequência de implementação

### Etapa 1 — Schema + Security Rules + Services (~0,5 dia)
- [ ] `firestore.rules`: regras para `receipts`, `payment_records`, `creditos_professores`, `meta/receipt_counter`
- [ ] `professores-shared.js`:
  - `ReceiptService.emit({closingId, teacherId})` — transação: lê contador + cria recibo + atualiza contador
  - `ReceiptService.emitBatch({closingId, teacherIds[]})` — múltiplos em uma transação
  - `ReceiptService.cancel(receiptId)` — só admin, só se status `aguardando_pagamento`
  - `ReceiptService.getById` / `listByClosing` / `listByTeacher`
  - `PaymentService.confirm(receiptId, {valor, metodo, obs})` — cria payment_record + atualiza recibo
  - `PaymentService.listByClosing` / `listByTeacher`
  - `CreditService.register({teacherId, valor, motivo, reciboOrigemId})` — cria credit pendente
  - `CreditService.applyToReceipt(receiptId)` — chamado dentro do emit, abate pendentes do professor
  - `CreditService.listPending(teacherId)`
- [ ] Helper: `formatReceiptNumber(n)` → `'0042'`

### Etapa 2 — Tela "Pagamentos" lista + filtros (~1 dia)
- [ ] `professores-pagamentos.js`: `renderPagamentosPage()`
- [ ] Filtros: unidade (chip multi-select) + ano/mês + status (chip)
- [ ] Lista por unidade × mês = card que expande mostrando cada professor
- [ ] Cada linha de professor: nome · valor · recibo nº · status · ações
- [ ] Botão global "📄 Emitir TODOS" no topo do card · só visível se ≥1 sem recibo
- [ ] Empty state

### Etapa 3 — Emissão de recibo + página de impressão (~1,5 dia)
- [ ] HTML modal de confirmação ("Confirma emissão de recibo de Lucas (R$ 2640)?")
- [ ] Lógica de transação: gera número sequencial + cria recibo + abate créditos
- [ ] `receipt.html` — página standalone com layout A4 do recibo:
  - Logo CrossTainer + nº recibo + período
  - Dados do professor (nome, CPF mascarado, tipo)
  - Tabela: horas × R$/h, VR, VT, Outros, Excedente (estagiário), créditos aplicados
  - Valor líquido em destaque + extenso
  - Espaço pra assinatura
  - CSS `@media print` configurado
- [ ] Botão "🖨️ Imprimir" no recibo chama `window.print()`
- [ ] Recibo abre em nova aba ao clicar "Emitir" — admin imprime/salva PDF/envia

### Etapa 4 — Confirmação de pagamento (~0,5 dia)
- [ ] Após emitir, recibo fica com status `aguardando_pagamento`
- [ ] Botão "💰 Confirmar pagamento" abre modal:
  - Valor pago (default = valor líquido do recibo)
  - Método (select: transferência · pix · dinheiro · outros)
  - Observações
- [ ] Submit cria `payment_records` + atualiza recibo (status pago) + notif pro professor
- [ ] Se valor diferente do esperado: aviso visual (mas permite salvar — Etapa 5 trata divergência)

### Etapa 5 — Sistema de crédito automático (~1,5 dia)
- [ ] Detecção de divergência pós-pagamento: se admin perceber que valor diverge depois (ex: ajuste manual de status mudou consolidado) — botão "💰 Registrar Crédito"
- [ ] Modal: valor (default = diferença detectada) + motivo
- [ ] Cria entry em `creditos_professores` com `status: 'pendente'`
- [ ] No próximo `ReceiptService.emit` do mesmo professor:
  - Consulta `creditos_professores where teacherId == x AND status == 'pendente'`
  - Abate na ordem (FIFO por `registeredAt`)
  - Atualiza credits → `status: 'aplicado'` + ref ao recibo novo
  - Inclui no `creditosAplicados[]` do recibo + reduz `valorLiquido`
- [ ] Recibo de impressão mostra créditos aplicados

### Etapa 6 — Painel do professor "Meus Pagamentos" (~0,5 dia)
- [ ] Nova aba ou submenu pro professor logado
- [ ] Lista seus recibos (por unidade × mês)
- [ ] Mostra créditos pendentes destacados
- [ ] Click no recibo → abre `receipt.html?id=X` (read-only)

### Etapa 7 — Notificações in-app (~0,5 dia)
- [ ] Após emit: cria `notifications` type `recibo_emitido` body com nº + valor + link `receipt.html?id=X`
- [ ] Após confirm payment: cria `notifications` type `pagamento_confirmado` body com valor + data
- [ ] Constantes em `NOTIF_TYPE_META` atualizadas

### Etapa 8 — Smoke test (~0,5 dia)
- [ ] Adicionar comandos ao `scripts/admin.js`:
  - `emit-receipt <closingId> <teacherId>` — simula emissão via callable (ou direto via SDK)
  - `confirm-payment <receiptId> <valor>` — confirma pagamento
  - `register-credit <teacherId> <valor> <motivo>` — registra crédito
  - `list-receipts <unitId> <year> <month>` — lista recibos do mês
  - `smoke-4b <closingId>` — roda os 12 critérios em sequência
- [ ] Cenários listados na seção 7

---

## 6. Decisões importantes

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Geração de PDF | **HTML imprimível via `window.print()`** — sem dep externa, padrão simples |
| D2 | Emissão individual ou em lote | **Ambos** — botão individual por linha + "Emitir TODOS" no topo |
| D3 | Sistema de crédito | **SIM** — mesma mecânica do módulo Comissões (coleção `creditos_professores`) |
| D4 | Quem pode emitir recibos | **Admin apenas** (não admin_gestao · paridade com 4a D1) |
| D5 | Numeração sequencial global ou por unidade | **Global** — mais simples, contador atômico em `meta/receipt_counter`. Backlog: separar por unidade se cliente pedir |
| D6 | Cancelar recibo emitido | **Sim, se status = aguardando_pagamento.** Após pago, não cancela mais (vira backlog) |
| D7 | Confirmar pagamento — valor obrigatório? | **Sim** — admin pode editar (default = valor líquido) mas precisa ser número > 0 |
| D8 | Método de pagamento | **Texto livre via select** (transferência, pix, dinheiro, outros). Sem integração bancária |
| D9 | Crédito negativo (pagou a menos) | **Sim** — vira débito do próximo recibo (mesma mecânica). Pode ser negativo no campo `valor` |
| D10 | Visibilidade do recibo pro professor | **Pode ver os próprios** (Security Rule já implementa). Sem dados de outros professores |
| D11 | Deploy em produção ao fim | **Não.** Aguarda homologação completa do módulo (regra inviolável #7) |
| D12 | Notificação por email | **Não nesta sprint** — só in-app. Email vira Sprint 7 (Brevo) |

---

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Sidebar mostra "💳 Pagamentos" pro admin | Login admin → ver na sidebar |
| 2 | Não aparece pra admin_gestao/supervisao/professor | Login não-admin → item não visível |
| 3 | Lista mostra closings com status agregado | Fechamento Maio CP → vê 2 professores (Lucas pendente, etc) |
| 4 | Emissão individual cria recibo numerado | Click Emitir Lucas → recibo nº 0001 criado com status `aguardando_pagamento` |
| 5 | Emissão em lote cria N recibos numerados sequencialmente | "Emitir TODOS" → recibos 0002 a 000N |
| 6 | Página de impressão abre com layout correto | Click no recibo → abre `receipt.html` em nova aba · imprime via Ctrl+P |
| 7 | Confirmação de pagamento muda status | Click "Confirmar pagamento" → status `pago` · `payment_records` criado |
| 8 | Registro de crédito após pagamento | Após pago, click "💰 Registrar Crédito" → `creditos_professores` criado pendente |
| 9 | Crédito é abatido no próximo recibo | Emite novo recibo do mesmo prof → vê linha "Crédito de R$ X aplicado" |
| 10 | Notificação chega pro professor | Após emit/confirm → `notifications` criado para o user vinculado ao teacher |
| 11 | Audit log com module='pagamentos' | Cada operação grava em `audit_log` com módulo correto |
| 12 | Zero regressão | Login `index.html` (Comissões) + outras telas continuam funcionando |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Race condition na numeração sequencial | 🟡 Média | Transação Firestore lê + incrementa atomicamente |
| Crédito ser abatido 2× | 🟡 Média | Transação no emit: marca `status: 'aplicado'` antes de criar o recibo |
| `window.print()` com layout quebrado em browsers diferentes | 🟢 Baixa | Testar em Chrome + Edge antes de validar. CSS print bem estruturado |
| Recibo numerado errado se 2 admins emitem ao mesmo tempo | 🟢 Baixa | Mitigado pela transação. Em paralelo, contador único garante unicidade |
| Professor sem `userId` vinculado não recebe notificação | 🟡 Média | Aceito — admin avisa fora do sistema. Backlog: alerta visual no painel admin se prof sem userId |
| Cliente pedir formato fiscal NFS-e | 🟡 Média | Documentar como backlog explicitamente. MVP é recibo simples |
| Crédito de mês fechado entrar em mês ainda em aberto | 🟢 Baixa | Detecta no emit do PRÓXIMO recibo — não cruza meses fechados |

---

## 9. Após a sprint

Sprint 4b termina quando os 12 critérios passarem. Próximo passo:

- 🟢 **Sprint 5** — Escalas Especiais (sábado/feriado/eventos com pesos) + detecção automática de feriado (afeta valor do pagamento via feriado ×2)
- 🟢 **Sprint 6** — Férias e Recesso
- 🟢 **Sprint 7** — Notificações por email (Brevo) — finalmente notificar professor por email do recibo emitido
- 🟢 **Sprint 8** — Relatórios + Exportações
- Ainda sem deploy em produção

---

## 10. O que esperar ao executar

1. Você diz "vamos pra Sprint 4b"
2. Eu releio este playbook + memória
3. Implemento etapa por etapa, com checkpoints visuais a cada bloco testável
4. Smoke test final via `scripts/admin.js smoke-4b` + cenários UI
5. Critérios passam → memória atualizada
6. Decidimos Sprint 5

---

## 📋 Snippets-chave (pra desenvolvimento autônomo)

### Snippet 1 — Receipt counter atômico (`ReceiptService.emit`)

Numeração sequencial via transação:

```js
async emit({ closingId, teacherId, opts = {} }) {
  const firestore = db;  // alias
  const counterRef = firestore.collection('meta').doc('receipt_counter');

  try {
    const result = await firestore.runTransaction(async (txn) => {
      // 1. Lê closing pra pegar snapshot do professor
      const closingDoc = await txn.get(firestore.collection('monthly_closings').doc(closingId));
      if (!closingDoc.exists) throw new Error('Closing não encontrado');
      const closing = closingDoc.data();
      const teacherEntry = (closing.teachers || []).find(t => t.teacherId === teacherId);
      if (!teacherEntry) throw new Error('Professor não está neste closing');

      // 2. Lê + incrementa contador
      const counterDoc = await txn.get(counterRef);
      const nextNumber = (counterDoc.exists ? counterDoc.data().value : 0) + 1;

      // 3. Busca créditos pendentes do professor
      const credSnap = await firestore.collection('creditos_professores')
        .where('teacherId', '==', teacherId)
        .where('status', '==', 'pendente')
        .get();
      const creditos = credSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const totalCredito = creditos.reduce((s, c) => s + (c.valor || 0), 0);

      const valorLiquido = teacherEntry.valorTotal - totalCredito;

      // 4. Cria o receipt
      const receiptRef = firestore.collection('receipts').doc();
      const receiptData = {
        number: nextNumber,
        numberFormatted: String(nextNumber).padStart(4, '0'),
        closingId,
        unitId: closing.unitId,
        unitName: closing.unitName || '',
        year: closing.year,
        month: closing.month,
        teacherId,
        teacherName: teacherEntry.teacherName,
        teacherCpf: teacherEntry.teacherCpf || '',
        teacherType: teacherEntry.teacherType,
        closingValorTotal: teacherEntry.valorTotal,
        closingValorHoras: teacherEntry.valorHoras,
        closingHoras: teacherEntry.totalHoras,
        creditosAplicados: creditos.map(c => ({
          creditoId: c.id, valor: c.valor,
          reciboOrigemNum: c.reciboOrigemNum, periodoOrigem: c.periodoOrigem
        })),
        totalCreditoAplicado: totalCredito,
        valorLiquido,
        status: 'aguardando_pagamento',
        emittedAt: serverTs(), emittedBy: currentUserId(), emittedByName: currentUserName(),
        paidAt: null, paidBy: null, paymentRecordId: null,
        createdAt: serverTs(), updatedAt: serverTs(),
      };
      txn.set(receiptRef, receiptData);

      // 5. Marca créditos como aplicados
      creditos.forEach(c => {
        txn.update(firestore.collection('creditos_professores').doc(c.id), {
          status: 'aplicado',
          appliedAt: serverTs(),
          appliedToReciboId: receiptRef.id,
          updatedAt: serverTs(),
        });
      });

      // 6. Atualiza contador
      txn.set(counterRef, { value: nextNumber, updatedAt: serverTs() }, { merge: true });

      return { id: receiptRef.id, ...receiptData };
    });

    await AuditService.log({
      type: 'receipt_emitted',
      details: `Recibo ${result.numberFormatted} emitido (${result.teacherName} · ${result.year}-${result.month})`,
      entityType: 'receipt', entityId: result.id,
      before: null, after: result,
      module: 'pagamentos',
    });

    // Notif pro professor (busca userId via professorId)
    const us = await db.collection('users').where('professorId', '==', teacherId).limit(1).get();
    if (!us.empty) {
      await NotificationService.create({
        recipientUserId: us.docs[0].id,
        type: 'recibo_emitido',
        body: `Recibo ${result.numberFormatted} emitido · R$ ${result.valorLiquido.toFixed(2)}`,
        link: { type: 'receipt', id: result.id },
      });
    }
    return { success: true, data: result };
  } catch (err) {
    console.error('[ReceiptService.emit]', err);
    return { success: false, error: err.message };
  }
}
```

### Snippet 2 — `emitBatch` (lote por unidade × mês)

```js
async emitBatch({ closingId, teacherIds }) {
  const results = [];
  const errors = [];
  for (const teacherId of teacherIds) {
    const r = await this.emit({ closingId, teacherId });
    if (r.success) results.push(r.data);
    else errors.push({ teacherId, error: r.error });
  }
  return { success: errors.length === 0, results, errors };
}
```

Nota: usa loop simples (não Promise.all) pra garantir ordem sequencial dos números. Sacrifica velocidade por garantia.

### Snippet 3 — Template `receipt.html` (página standalone de impressão)

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Recibo</title>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
<script src="firebase-config.js"></script>
<style>
  @page { size: A4; margin: 1.5cm; }
  body { font-family: 'DM Sans', Arial, sans-serif; color: #111; background: #fff; }
  .receipt { max-width: 720px; margin: 0 auto; padding: 30px; }
  .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px; }
  .header h1 { margin: 0; font-size: 26px; letter-spacing: 1px; }
  .header .number { font-size: 14px; color: #666; margin-top: 4px; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; font-size: 13px; }
  .info-block { padding: 8px; background: #f4f4f4; border-radius: 4px; }
  .info-label { font-size: 10px; text-transform: uppercase; color: #666; }
  .info-value { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  table th, table td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
  table th { background: #f0f0f0; font-weight: 700; text-transform: uppercase; font-size: 10px; }
  .text-right { text-align: right; }
  .creditos { background: #fff8e6; padding: 8px; border-left: 3px solid #f5a623; margin-bottom: 16px; font-size: 12px; }
  .total { font-size: 20px; font-weight: 700; text-align: right; padding: 12px; background: #000; color: #fff; border-radius: 4px; }
  .extenso { font-size: 11px; font-style: italic; color: #555; margin-top: 4px; text-align: right; }
  .sig { margin-top: 60px; display: flex; justify-content: space-between; font-size: 12px; }
  .sig-line { width: 280px; border-top: 1px solid #000; padding-top: 4px; text-align: center; }
  .actions { text-align: center; margin: 20px 0; }
  .actions button { padding: 10px 20px; font-size: 14px; cursor: pointer; }
  @media print { .actions { display: none; } body { background: #fff; } }
</style>
</head>
<body>
<div class="receipt" id="receiptContent"><div style="text-align:center;padding:40px;">Carregando…</div></div>
<div class="actions"><button onclick="window.print()">🖨️ Imprimir</button></div>
<script>
(async () => {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { document.getElementById('receiptContent').innerHTML = '<p>ID não informado.</p>'; return; }
  await new Promise(r => firebase.auth().onAuthStateChanged(u => { if (u) r(); else { location.href = '/professores.html'; }}));
  const db = firebase.firestore();
  const doc = await db.collection('receipts').doc(id).get();
  if (!doc.exists) { document.getElementById('receiptContent').innerHTML = '<p>Recibo não encontrado.</p>'; return; }
  const r = doc.data();
  document.getElementById('receiptContent').innerHTML = renderReceipt(r);
})();

function renderReceipt(r) {
  const creditos = (r.creditosAplicados || []).map(c =>
    `Recibo #${String(c.reciboOrigemNum).padStart(4,'0')} (${c.periodoOrigem}): R$ ${c.valor.toFixed(2)}`
  ).join(' · ');
  return `
    <div class="header">
      <h1>RECIBO DE PAGAMENTO</h1>
      <div class="number">Nº ${r.numberFormatted} · ${r.year}-${String(r.month).padStart(2,'0')}</div>
    </div>
    <div class="info">
      <div class="info-block"><div class="info-label">Professor</div><div class="info-value">${r.teacherName}</div></div>
      <div class="info-block"><div class="info-label">Tipo</div><div class="info-value">${r.teacherType}</div></div>
      <div class="info-block"><div class="info-label">CPF</div><div class="info-value">${r.teacherCpf}</div></div>
      <div class="info-block"><div class="info-label">Unidade</div><div class="info-value">${r.unitName}</div></div>
    </div>
    <table>
      <thead><tr><th>Descrição</th><th class="text-right">Valor</th></tr></thead>
      <tbody>
        <tr><td>Horas trabalhadas (${r.closingHoras.toFixed(2)}h)</td><td class="text-right">R$ ${r.closingValorHoras.toFixed(2)}</td></tr>
        <tr><td><strong>Total bruto do fechamento</strong></td><td class="text-right"><strong>R$ ${r.closingValorTotal.toFixed(2)}</strong></td></tr>
        ${r.totalCreditoAplicado > 0 ? `<tr style="color:#2e7d32;"><td>(-) Crédito de períodos anteriores<br><span style="font-size:9px;">${creditos}</span></td><td class="text-right">-R$ ${r.totalCreditoAplicado.toFixed(2)}</td></tr>` : ''}
      </tbody>
    </table>
    ${r.totalCreditoAplicado < 0 ? `<div class="creditos">⚠ Débito de períodos anteriores: R$ ${Math.abs(r.totalCreditoAplicado).toFixed(2)}</div>` : ''}
    <div class="total">VALOR LÍQUIDO: R$ ${r.valorLiquido.toFixed(2)}</div>
    <div class="sig">
      <div class="sig-line">${r.teacherName}<br><small>Assinatura</small></div>
      <div class="sig-line">Administração<br><small>${r.emittedByName}</small></div>
    </div>
    <div style="text-align:center;font-size:10px;color:#999;margin-top:30px;">Emitido em ${new Date(r.emittedAt.toDate()).toLocaleString('pt-BR')}</div>
  `;
}
</script>
</body>
</html>
```

### Snippet 4 — Security Rules atualizadas

```js
// firestore.rules — adicionar dentro de match /databases/{database}/documents

match /receipts/{id} {
  allow read: if isAuth() && (isAdmin() || resource.data.teacherId == uData().professorId);
  allow create: if isAuth() && isStrictAdmin();   // criar via Service garante numeração
  allow update: if isAuth() && isStrictAdmin();
  allow delete: if false;  // nunca apaga, só cancela via status
}

match /payment_records/{id} {
  allow read: if isAuth() && (isAdmin() || resource.data.teacherId == uData().professorId);
  allow write: if isAuth() && isStrictAdmin();
}

match /creditos_professores/{id} {
  allow read: if isAuth() && (isAdmin() || resource.data.teacherId == uData().professorId);
  allow write: if isAuth() && isStrictAdmin();
}

match /meta/receipt_counter {
  allow read: if isAuth() && isAdmin();
  allow write: if isAuth() && isStrictAdmin();
}
```

Adicionar helper `isStrictAdmin()` em rules se ainda não existir:
```js
function isStrictAdmin() { return hasP('admin'); }
```

### Snippet 5 — Índices Firestore necessários

Adicionar em `firestore.indexes.json`:

```json
{
  "collectionGroup": "receipts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "closingId", "order": "ASCENDING" },
    { "fieldPath": "number",    "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "receipts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "teacherId",   "order": "ASCENDING" },
    { "fieldPath": "emittedAt",   "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "creditos_professores",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "teacherId", "order": "ASCENDING" },
    { "fieldPath": "status",    "order": "ASCENDING" }
  ]
}
```

### Snippet 6 — Comando admin.js smoke-4b

```js
// Adicionar em scripts/admin.js
async function cmdSmoke4b(closingId) {
  if (!closingId) { console.error('Uso: smoke-4b <closingId>'); process.exit(1); }
  console.log('\n══════ SMOKE TEST Sprint 4b ══════\n');

  // Critério 4: emitir recibo individual
  const closing = await db.collection('monthly_closings').doc(closingId).get();
  if (!closing.exists) { console.error('Closing não encontrado'); return; }
  const teachers = closing.data().teachers || [];
  console.log(`Closing tem ${teachers.length} professores.`);

  // Lista receipts existentes
  const recs = await db.collection('receipts').where('closingId', '==', closingId).get();
  console.log(`Recibos já emitidos: ${recs.size}`);
  recs.docs.forEach(d => {
    const r = d.data();
    console.log(`  - #${r.numberFormatted} ${r.teacherName} R$ ${r.valorLiquido.toFixed(2)} [${r.status}]`);
  });

  // Lista créditos pendentes
  const credsPendentes = await db.collection('creditos_professores').where('status', '==', 'pendente').get();
  console.log(`\nCréditos pendentes (geral): ${credsPendentes.size}`);

  // Lista payment_records
  const pays = await db.collection('payment_records').where('closingId', '==', closingId).get();
  console.log(`Pagamentos confirmados deste closing: ${pays.size}`);
}
```

---

## 🚨 Dicas finais pra desenvolvimento autônomo

1. **Sempre transação pra numeração** — `db.runTransaction(...)` no `emit`. Sem isso, race condition em emitBatch geraria nº duplicado.

2. **CSS do receipt.html — testa em Chrome E Edge antes** — `window.print()` renderiza diferente entre browsers. O @media print CSS deve esconder elementos `.actions`.

3. **Service worker pode atrapalhar `receipt.html` novo** — ao subir o arquivo, fazer Application → Service Workers → Unregister + Clear site data.

4. **Não esqueça o NOTIF_TYPE_META em professores-shared.js** — adicionar `recibo_emitido` e `pagamento_confirmado` no objeto pra notifs aparecerem com ícone e título corretos no dropdown do sino.

5. **Audit log com `module: 'pagamentos'`** — bug B da Sprint 3b já foi corrigido, agora ele respeita o parâmetro. Use direto.

6. **Quando travar, chama** — me manda o erro/diff, eu reviso o trecho específico. Não precisa explicar contexto inteiro porque memória atualiza.

