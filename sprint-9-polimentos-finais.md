# Sprint 9 — Polimentos Finais
**Objetivo:** Endereçar todos os itens cosméticos, branding, tech debt funcional e robustez identificados durante as sprints anteriores. Sprint **final antes da homologação completa e deploy em produção**.
**Pré-condições:** ✅ Sprints 1, 1.5, 2, 3a, 3b, 4a, 4b, 5a, 6a, 6b, 6c, 8 validadas em staging.
**Duração estimada:** 5-6 dias úteis.

> 🎯 **Escopo travado em 07/06/2026:** 4 categorias (UX/Visual + Branding + Tech debt + Robustez CDN). Recibo R4 via html2canvas (paridade 100%). sw.js mantido (regra inviolável #1).

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- **Recibo R4 da Sprint 8** com paridade visual 100% ao `receipt.html` da Sprint 4b (via html2canvas)
- **R3 mostra "Sem cadastro salarial"** em vez de "R$ 0,00" quando teacher_salaries não existe
- **Mensagens vazias** padronizadas (em vez de tabelas em branco quando filtros não retornam dados)
- **Branding corrigido** — `CrossTrainer` → `CrossTainer` em todos os textos visíveis ao usuário (regra inviolável #8)
- **Migration retroativa de audit_log** — entries antigas com `module: 'professores'` viram `module: 'agenda'` (consistência semântica)
- **Migration opcional de classes legadas UTC midnight** — corrige `scheduledDate` em classes pré bug D fix
- **CreditService com transação atômica** — elimina race condition rara
- **CDN local fallback** — bibliotecas da Sprint 8 hospedadas em `/vendor` com fallback automático
- **Smoke test geral** com 8 critérios

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

#### Categoria A — UX / Visual

| Item | Detalhes |
|------|----------|
| Recibo R4 paridade visual | html2canvas captura `receipt.html` renderizado → PDF. 1 página por professor. Reusa estilo completo do Sprint 4b |
| R3 "Sem cadastro salarial" | Quando teacher não tem hourlyRate nem internProportionalHourlyRate, exibir "—" + tooltip "Cadastro salarial incompleto" em vez de "R$ 0,00" |
| Mensagens vazias padronizadas | Tabelas sem dados mostram card explicativo (ícone + texto + sugestão de ação) em vez de tabela vazia |
| Loading states | Spinner consistente em todos os relatórios e geração de PDF em lote |

#### Categoria B — Branding / Conformidade

| Item | Detalhes |
|------|----------|
| `CrossTrainer` → `CrossTainer` | Substituir em todos os arquivos visíveis ao usuário: `index.html` (módulo Comissões), `manifest.json`, mensagens da UI, copyright. **Autorizado pelo usuário em 07/06/2026** |
| Logo / favicon | Verificar se logo e favicon estão consistentes com o nome correto |
| Textos institucionais | Footer, "Sobre", e-mail de suporte (se houver) — todos verificados |
| **NÃO MEXER**: IDs técnicos do Firebase | `crosstrainer-comissoes` e `crosstrainer-comissoes-staging` **permanecem** como estão (são estáveis e mudá-los seria caro/arriscado) |
| **NÃO MEXER**: `sw.js` | Mantido (regra inviolável #1). Workaround atual em dev continua válido |

#### Categoria C — Tech debt funcional

| Item | Detalhes |
|------|----------|
| Migration audit_log legacy | Script `scripts/migrate-audit-module.js` — Admin SDK, lê audit_log com `module=='professores'`, batch update para `module='agenda'`. Idempotente |
| Migration classes UTC midnight | Script `scripts/migrate-classes-utc.js` — Admin SDK, identifica classes com `scheduledDate.toDate().getUTCHours() === 0` (UTC midnight) e adiciona 3h. **Aplicável só em staging** (em produção classes sempre BR pós-fix) |
| CreditService transação atômica | Refatorar `abateCredito()` em `professores-shared.js` pra usar `firestore.runTransaction()` em vez de read-then-write. Elimina race condition rara |
| Critérios 5/6 Sprint 4a | Tentar validar via fixture com estagiário sintético + aulas no mês. Se não conseguir reproduzir, anotar como aceito |

#### Categoria D — Robustez

| Item | Detalhes |
|------|----------|
| CDN local fallback (Sprint 8) | Baixar e hospedar em `/vendor/`: xlsx.full.min.js, jspdf.umd.min.js, jspdf.plugin.autotable.min.js, jszip.min.js |
| Lógica de fallback | `ensureReportLibsLoaded` tenta local primeiro · se falhar tenta CDN · se falhar avisa "Recursos indisponíveis" |
| html2canvas via CDN + fallback | Mesma lógica para a nova biblioteca do recibo R4 |
| Tamanho dos arquivos | ~600KB local. Aceitável. Documentar em README |

### ❌ NÃO ENTRA (vai pra outra sprint ou backlog)

| Item | Destino |
|------|---------|
| Sprint 7 — Notificações por email (Brevo) | Sprint 7 (se desejado) |
| Modificar `sw.js` | Regra inviolável #1. Mantido |
| IDs técnicos do Firebase | Não mexer (regra inviolável #8) |
| Refactor estrutural de outros módulos | Backlog |
| Wireframe `AgendaWireframes_design.html` | Não modificar (regra inviolável #8) |
| Dashboard ou gráficos interativos | Backlog (Sprint futura) |

---

## 3. Arquivos a criar/modificar

```
crosstrainer-comissoes/
├── index.html                       ← MOD — CrossTrainer → CrossTainer em textos visíveis
├── manifest.json                    ← MOD — nome do app
├── professores.html                 ← MOD — alguns textos visíveis (verificar)
├── professores-relatorios.js        ← MOD — recibo R4 via html2canvas + R3 "sem cadastro" + CDN fallback
├── professores-shared.js            ← MOD — CreditService transaction + mensagens
├── professores-ferias.js            ← MOD — mensagens de empty state
├── professores-fechamento.js        ← MOD — mensagens de empty state
├── professores.js                   ← (verificar textos)
├── receipt.html                     ← (sem mudanças — referência canônica)
├── vendor/                          ← NOVO — diretório
│   ├── xlsx.full.min.js
│   ├── jspdf.umd.min.js
│   ├── jspdf.plugin.autotable.min.js
│   ├── jszip.min.js
│   └── html2canvas.min.js
├── README.md                        ← MOD — documenta `/vendor` + Sprint 9
└── scripts/
    ├── migrate-audit-module.js      ← NOVO — audit log legacy
    ├── migrate-classes-utc.js       ← NOVO — classes UTC midnight (só staging)
    └── smoke-9.js                   ← NOVO — valida polimentos
```

---

## 4. Sequência de implementação

### Etapa 1 — Branding `CrossTrainer` → `CrossTainer` (~0,5 dia)

#### Estratégia: grep + revisão manual
```bash
# Lista todos os arquivos com "CrossTrainer" (errado) — exceto IDs técnicos
grep -r "CrossTrainer" --include="*.html" --include="*.json" --include="*.md" --include="*.js" \
  --exclude-dir=node_modules --exclude="sw.js" --exclude="firebase-config.js"
```

- [ ] Revisar cada match com cuidado — NÃO substituir IDs técnicos do Firebase
- [ ] Alterar em batch apenas onde for texto visível ao usuário
- [ ] **NÃO mexer em:** `sw.js`, `firebase-config.js`, `AgendaWireframes_design.html`, IDs `crosstrainer-comissoes*`
- [ ] Testar visualmente: index.html (Comissões) + professores.html (Professores)
- [ ] Validar PWA (manifest.json) — instalar como app e ver o nome correto

### Etapa 2 — R3 + Mensagens vazias (~0,5 dia)

#### R3 "Sem cadastro salarial"
- [ ] Em `professores-shared.js` `getHorasPorProfessorReport`, quando `hourlyRate === 0` E professor existe, adicionar flag `noSalaryData: true` no row
- [ ] Em `professores-relatorios.js`, na hora de renderizar a tabela, se `row.noSalaryData` → exibir "—" em vez de "R$ 0,00" e adicionar ícone ℹ️ com tooltip "Cadastro salarial incompleto"
- [ ] No Excel/PDF, exibir "Sem cadastro" no campo Valor Total

#### Mensagens vazias padronizadas
- [ ] Criar helper genérico em `professores-shared.js`:
```js
function emptyStateHtml(icon, title, suggestion) { ... }
```
- [ ] Aplicar em:
  - Gerenciar Férias quando filtro retorna 0 pedidos
  - Saldos de Férias quando filtro retorna 0 (não acontece em prod, mas vale)
  - Cada relatório quando filtro retorna 0 linhas
  - Pagamentos quando não há recibos

### Etapa 3 — Recibo R4 via html2canvas (~1,5 dia)

#### Adicionar html2canvas via CDN + local fallback
- [ ] Baixar `html2canvas.min.js` (~100KB) e colocar em `/vendor/`
- [ ] Adicionar em `ensureReportLibsLoaded` (já existe pra outras libs)

#### Refatorar `renderReciboInPdf`
- [ ] Criar função `renderReciboFromHtml(prof, closing)`:
  1. Cria iframe oculto (`display: none`)
  2. Carrega `receipt.html?id=X` ou injeta HTML do template manualmente
  3. Aguarda render completo
  4. `html2canvas(iframe.contentDocument.body)` → canvas
  5. `canvas.toDataURL('image/png')` → image data
  6. jsPDF `doc.addImage(...)` adiciona como página
- [ ] Reusa estilos do `receipt.html` 100% (sem reescrever CSS)
- [ ] Loop pra todos os profs do fechamento, com progresso
- [ ] Cleanup do iframe após cada recibo

#### Considerações
- Performance: html2canvas + addImage é mais lento que jsPDF puro (~1-2s por prof)
- Tamanho do PDF: imagem pesa mais que texto (~500KB-1MB por página vs ~50KB texto). Aceitável pra fluxo bulk
- Acentos perfeitos garantidos (HTML/CSS, não fonte do jsPDF)

### Etapa 4 — Tech debt migrations (~1,5 dia)

#### `scripts/migrate-audit-module.js`
- [ ] Lê todos `audit_log` com `module == 'professores'`
- [ ] Batch update para `module = 'agenda'` (Sprint 2/3a/3b correta semântica)
- [ ] Idempotente: se não há entries pra migrar, retorna 0 mudanças
- [ ] Logging: "Migradas X entries de Y total"

#### `scripts/migrate-classes-utc.js`
- [ ] Lê `classes` com `scheduledDate.toDate().getUTCHours() === 0` (UTC midnight, pre bug D fix)
- [ ] Atualiza `scheduledDate` adicionando 3h (vira BR midnight UTC = 03:00 UTC)
- [ ] **Aplicar APENAS em staging** (produção sempre teve geração BR pós-fix)
- [ ] Flag `--apply` exigida pra escrever (default = dry-run)

#### CreditService transação atômica
- [ ] Refatorar `abateCredito(creditId, valorAbater)` em `professores-shared.js`
- [ ] Antes: `read credit → calcular → write` (race condition)
- [ ] Depois: `firestore.runTransaction(txn => { read → calcular → write })` (atomic)
- [ ] Tests: rodar abate 2x em paralelo, verificar que segundo bate em erro `failed-precondition`

#### Critérios 5/6 Sprint 4a
- [ ] Tentar fixture: estagiário com `internMonthlyLimitHours=20` + 25h de aulas no mês → testa lógica de excedente
- [ ] Se reproduzir → validar e marcar 4a 10/10
- [ ] Se não conseguir reproduzir → anotar como aceito (sem prazo de validação)

### Etapa 5 — CDN local fallback (~0,5 dia)

#### Baixar libs
```bash
mkdir -p vendor
curl -o vendor/xlsx.full.min.js https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
curl -o vendor/jspdf.umd.min.js https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
curl -o vendor/jspdf.plugin.autotable.min.js https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.0/dist/jspdf.plugin.autotable.min.js
curl -o vendor/jszip.min.js https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
curl -o vendor/html2canvas.min.js https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
```

#### Refatorar `ensureReportLibsLoaded`
- [ ] Função `loadScriptWithFallback(localPath, cdnUrl)`:
  1. Tenta `loadScript(localPath)`
  2. Se falhar (404, network error), tenta `loadScript(cdnUrl)`
  3. Se falhar de novo, lança erro
- [ ] Atualizar a função pra usar `/vendor/xxx.js` primeiro
- [ ] Validar sanity check final igual antes

### Etapa 6 — Smoke + Deploy + Validação (~0,5 dia)

#### `scripts/smoke-9.js`
- [ ] C1: nenhum match de `CrossTrainer` em arquivos visíveis (grep automatizado)
- [ ] C2: audit_log com module='professores' → 0 entries (migration aplicada)
- [ ] C3: classes com scheduledDate UTC midnight → 0 docs (em staging)
- [ ] C4: vendor/ tem 5 arquivos esperados
- [ ] C5: ReportService.getHorasPorProfessorReport com prof sem salary → rows com `noSalaryData: true`
- [ ] C6: CreditService.abateCredito 2x em paralelo → 1 sucesso, 1 erro `failed-precondition`
- [ ] C7: Empty state em queries vazias → retorna estrutura `{ rows: [], ... }` sem erro
- [ ] C8: html2canvas + jsPDF gera recibo com acentos perfeitos (confirma via screenshot)

#### Deploy
```bash
firebase deploy --only hosting --project staging
```

#### Migrations (rodar manualmente)
```bash
node scripts/migrate-audit-module.js --project staging --apply
node scripts/migrate-classes-utc.js --project staging --apply   # só staging
```

#### Validação visual
- Recibo R4: gerar lote, abrir PDF, comparar com receipt.html individual lado-a-lado
- R3: filtrar por Pedro Lima → ver "Sem cadastro" em vez de R$ 0,00
- Empty states: filtrar com critério impossível, ver card padrão
- Branding: navegar pelo sistema procurando "CrossTrainer" — não deve aparecer

---

## 5. Decisões importantes

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Escopo | **4 categorias** (UX + Branding + Tech debt + Robustez CDN). Confirmado 07/06 |
| D2 | Recibo R4 paridade | **html2canvas espelhando receipt.html.** Paridade 100%. Confirmado 07/06 |
| D3 | sw.js | **Manter** (regra inviolável #1). Confirmado 07/06 |
| D4 | IDs técnicos Firebase | **NÃO mexer** — `crosstrainer-comissoes*` permanecem (regra #8) |
| D5 | Migrations idempotentes | Todas as migrations devem ser idempotentes (rodar 2x = mesmo resultado) |
| D6 | Migration classes UTC | Aplicar **apenas em staging** (produção nunca teve esse bug) |
| D7 | Fallback CDN | Local primeiro · CDN como fallback · erro visual se ambos falharem |
| D8 | R3 sem cadastro | "—" + tooltip "Cadastro salarial incompleto" em vez de "R$ 0,00" |
| D9 | Mensagens vazias | Helper compartilhado `emptyStateHtml(icon, title, suggestion)` |
| D10 | Deploy em produção | Não nesta sprint. Aguarda homologação completa pós-Sprint 9 |
| D11 | Critérios 5/6 Sprint 4a | Tentar reproduzir via fixture; se não conseguir, marcar como aceito |
| D12 | Tamanho do PDF de recibo (R4 via html2canvas) | Aceito (~500KB-1MB por página é OK pra fluxo bulk) |

---

## 6. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Nenhuma ocorrência de "CrossTrainer" em arquivos visíveis | `grep -r "CrossTrainer"` em arquivos não-técnicos → 0 matches |
| 2 | Recibo R4 com paridade visual de receipt.html | Lado-a-lado: recibo individual (Sprint 4b) vs recibo em lote (Sprint 8 com fix) — visualmente idênticos |
| 3 | R3 mostra "—" quando falta cadastro salarial | Filtrar Pedro Lima → ver "—" + ícone ℹ️ em vez de "R$ 0,00" |
| 4 | Mensagens vazias padronizadas | Filtrar com critério impossível em todos os relatórios + gerenciar férias → card consistente |
| 5 | Migration audit_log aplicada | `audit_log where module='professores'` → 0 docs em staging após migration |
| 6 | Migration classes UTC aplicada (staging) | `classes where scheduledDate hour=00 UTC` → 0 docs em staging após migration |
| 7 | CreditService atômico | Rodar `abateCredito` 2x em paralelo → 1 sucesso, 1 erro `failed-precondition` |
| 8 | Vendor/ presente com 5 libs | `ls vendor/` → 5 arquivos `.js` |
| 9 | Fallback CDN funcional | DevTools Network: bloquear `/vendor/` → confirmar fallback pro CDN |
| 10 | Acentos perfeitos no recibo R4 | "João Conceição", "Maria São Pedro", "Antônio José Silvério" — sem quebras |
| 11 | Recibo R4 funciona pra 50+ profs sem travar | Stress test: fechamento sintético com 50 profs → PDF lote gera em <60s |
| 12 | Critérios 5/6 Sprint 4a | Estagiário com excedente reproduz e calcula corretamente OU marcado como aceito |

---

## 7. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Substituir `CrossTrainer` em IDs técnicos por engano | 🔴 Alta sem cuidado | Estratégia: grep + revisão manual. NUNCA usar `sed -i` global. Diff antes de commitar |
| Migration audit_log impacta entries em uso ativo | 🟢 Baixa | Idempotente. Updates não destroem dados. Backup via export antes |
| Migration classes UTC corrompe data em prod | 🔴 Alta se aplicado em prod | Flag `--project staging` obrigatória. Script aborta se project=production |
| html2canvas falha em alguns browsers | 🟡 Média | Suporta Chrome/Edge/Firefox/Safari modernos. Testar em cada |
| Recibo R4 com 50 profs trava o browser | 🟡 Média | Yield pro UI thread a cada 5 (já implementado na Sprint 8) + progress bar |
| Tamanho do PDF lote excede limite de upload de e-mail | 🟡 Média | Aceito. Cliente pode usar ZIP (já é opção) |
| CDN fallback nunca testado em prod | 🟢 Baixa | Smoke test C9 valida |
| CreditService transaction trava em alta concorrência | 🟢 Baixa | Firestore transactions têm retry automático. Tested |
| Quebra do módulo Comissões ao mexer em index.html | 🔴 Alta sem cuidado | Revisão manual + testar prod-like depois do deploy |

---

## 8. Após a sprint

Sprint 9 termina quando os 12 critérios passarem. Próximo passo:
- 🟢 **Sprint 7** (opcional) — Notificações por email (Brevo + Trigger Email)
- 🟢 **Homologação completa do módulo** — cliente valida tudo end-to-end
- 🟢 **Deploy em produção** — APENAS após homologação OK + autorização explícita (regra inviolável #7)

---

## 📋 Snippets-chave (pra desenvolvimento autônomo)

### Snippet 1 — `loadScriptWithFallback`

```js
async function loadScriptWithFallback(localPath, cdnUrl, sentinelGlobal) {
  // sentinelGlobal: nome da variável global pra checar se já carregou (ex: 'XLSX')
  if (sentinelGlobal && window[sentinelGlobal]) return true;
  
  function load(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  
  try {
    await load(localPath);
    if (sentinelGlobal && window[sentinelGlobal]) return true;
    throw new Error('Local carregou mas sentinel ausente');
  } catch (localErr) {
    console.warn('[Sprint 9] Local falhou, tentando CDN:', localPath, localErr.message);
    try {
      await load(cdnUrl);
      return true;
    } catch (cdnErr) {
      console.error('[Sprint 9] CDN também falhou:', cdnUrl, cdnErr.message);
      return false;
    }
  }
}
```

### Snippet 2 — `renderReciboFromHtml` (R4 via html2canvas)

```js
async function renderReciboFromHtml(prof, closing) {
  // Cria iframe oculto
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:800px;height:1200px;border:none;';
  document.body.appendChild(iframe);
  
  // Renderiza HTML inline (espelhando receipt.html mas pré-populado)
  const html = buildReceiptHtml(prof, closing);   // helper que monta HTML idêntico ao receipt.html
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  
  // Aguarda render completo
  await new Promise(r => setTimeout(r, 100));
  
  // Captura
  const canvas = await window.html2canvas(iframe.contentDocument.body, {
    scale: 2,           // alta resolução
    useCORS: true,
    logging: false,
  });
  
  // Cleanup
  document.body.removeChild(iframe);
  
  return canvas.toDataURL('image/png');
}

async function exportRecibosLoteHtml(closingId, format, onProgress) {
  const dataRes = await ReportService.getRecibosLoteData(closingId);
  if (!dataRes.success) { toast(dataRes.error, 'error'); return; }
  const { profs, closing } = dataRes.data;
  
  if (format === 'pdf-unico') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    
    for (let i = 0; i < profs.length; i++) {
      if (i > 0) doc.addPage();
      const imgData = await renderReciboFromHtml(profs[i], closing);
      doc.addImage(imgData, 'PNG', 0, 0, 210, 297);   // A4
      onProgress && onProgress((i + 1) / profs.length, `Recibo ${i + 1}/${profs.length}`);
      if (i % 3 === 0) await sleep(0);   // yield ao UI thread
    }
    
    doc.save(`recibos-${closingId}.pdf`);
  } else if (format === 'zip') {
    // similar mas zipando cada PDF individual
    // ...
  }
}
```

### Snippet 3 — Migration audit_log

```js
// scripts/migrate-audit-module.js
'use strict';
const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1];
const apply = args.includes('--apply');

if (!projectArg) { console.error('Uso: --project staging|production [--apply]'); process.exit(1); }
const projectId = projectArg === 'production' ? 'crosstrainer-comissoes' : 'crosstrainer-comissoes-staging';

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projectArg}.json`))),
  projectId,
});
const db = admin.firestore();

(async () => {
  const snap = await db.collection('audit_log').where('module', '==', 'professores').get();
  console.log(`Encontradas ${snap.size} entries com module='professores'`);
  
  if (snap.size === 0) { console.log('Nada a migrar.'); await admin.app().delete(); return; }
  if (!apply) { console.log('DRY-RUN — passe --apply pra executar.'); await admin.app().delete(); return; }
  
  // Batches de 500
  const BATCH_LIMIT = 500;
  let migrated = 0;
  for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = snap.docs.slice(i, i + BATCH_LIMIT);
    for (const doc of chunk) {
      batch.update(doc.ref, { module: 'agenda' });
    }
    await batch.commit();
    migrated += chunk.length;
    console.log(`  ${migrated}/${snap.size} migrated`);
  }
  
  console.log(`✅ Migration completa: ${migrated} entries atualizadas`);
  await admin.app().delete();
})();
```

### Snippet 4 — CreditService transaction

```js
// professores-shared.js
async abateCredito(creditId, valorAbater) {
  if (!creditId || valorAbater == null || valorAbater <= 0) {
    return { success: false, error: 'Argumentos inválidos' };
  }
  
  try {
    const result = await db.runTransaction(async (txn) => {
      const ref = db.collection('creditos_professores').doc(creditId);
      const doc = await txn.get(ref);
      if (!doc.exists) throw new Error('Crédito não encontrado');
      
      const before = doc.data();
      if (before.status !== 'ativo') {
        throw new Error('Crédito não está ativo');
      }
      
      const novoSaldo = (before.saldoRestante || 0) - valorAbater;
      if (novoSaldo < -0.01) {
        throw new Error('Valor de abate excede saldo do crédito');
      }
      
      const after = {
        saldoRestante: Math.max(0, novoSaldo),
        status: novoSaldo <= 0.01 ? 'consumido' : 'ativo',
        updatedAt: serverTs(),
      };
      
      txn.update(ref, after);
      return { before, after };
    });
    
    // Audit log fora da transaction (não-crítico)
    await AuditService.log({
      type: 'credit_abate',
      module: 'agenda',
      details: `Abate de R$ ${valorAbater.toFixed(2)} em crédito ${creditId}`,
      before: result.before,
      after: result.after,
    });
    
    return { success: true, data: result.after };
  } catch (err) {
    console.error('[CreditService.abateCredito]', err);
    return { success: false, error: err.message };
  }
}
```

### Snippet 5 — Empty state helper

```js
// professores-shared.js
function emptyStateHtml(icon, title, suggestion) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      ${suggestion ? `<div class="empty-suggestion">${escapeHtml(suggestion)}</div>` : ''}
    </div>
  `;
}

// CSS em professores.html
/*
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text2);
}
.empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
.empty-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; color: var(--text); }
.empty-suggestion { font-size: 13px; color: var(--text2); max-width: 400px; margin: 0 auto; }
*/

// Uso:
container.innerHTML = emptyStateHtml(
  '🏖️',
  'Nenhuma solicitação de férias',
  'Quando professores solicitarem férias, elas aparecerão aqui pra você aprovar ou recusar.'
);
```

---

## 🔁 Observações finais

1. **Sprint final.** Após esta, vamos pra homologação completa do módulo e deploy em produção (regra inviolável #7).
2. **CrossTainer rename é delicado.** Revisar match-a-match. NÃO usar sed global.
3. **Migrations são idempotentes.** Rodar `--apply` 2x = mesmo resultado.
4. **html2canvas é a única biblioteca nova** desta sprint. Adicionar via CDN + local fallback.
5. **sw.js permanece intacto** (regra inviolável #1). Workaround de dev mantido.
6. **Reuso ao máximo:** `receipt.html` reutilizado integralmente no R4 (não duplicar template). `getEffectiveSalaryAt` reusado no R3 lookup.
7. **Quando travar:** chamar com erro/diff, revisão pontual.
