# Ajustes da Escala pedidos pelo grupo em 25/08 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver os 6 pontos que a gestão levantou no grupo "Sistema Escala Inteligente IA" em 25/08/2026 e que não dependem de resposta pendente.

**Architecture:** Seis frentes independentes, cada uma numa camada já existente. Nenhuma toca `commission.js` ou `index.html`. A lógica nova entra nos objetos puros (`scale-service.js`, `scale-engine.js`, `professores-shared.js`) e as telas só chamam; assim cada mudança é testável por smoke Node sem navegador, no padrão do projeto.

**Tech Stack:** JS vanilla, Firebase (Firestore + Rules), smokes em Node contra `scripts/_fake-firestore.js`.

**Branch:** `ajustes-escala-25-08` (criada de `worktree-troca-professor-aula` = `origin/main`).

---

## Contexto — o que cada tarefa resolve

Levantado no grupo em 25/08 por Rafael Rojais e Rodrigo. Tudo abaixo foi **conferido na base de produção** no mesmo dia (leitura via REST):

| Tarefa | Pedido | Diagnóstico confirmado |
|---|---|---|
| 1 | "Clicando nas substituições pendentes não acontece nada" | Home conta `status=='pending'` (= esperando o colega). Produção: 5 `pending`, **0** `aguardando_gestao`. A caixa está certa; o aviso é que cobra a gestão por fila alheia. |
| 2 | "Inverter com um click os profs do TOI e Hiit" | `reassignSlot` recusa: *"Essa pessoa já está em outra vaga desta escala"*. Provado rodando o serviço real contra o fake. |
| 3 | "Em equilíbrio do ciclo mostrar quem são as pessoas" | Só há números. E os 3 "abaixo do mínimo" são Yasmin, Patrícia e Louiz Lume — que **não dão TOI nem Hiit**, então nunca serão escalados e o alerta é permanente. |
| 4 | "Explicar melhor Reconsolidar e Despublicar" | Sem explicação. E `consolidarEscala` **não republica** a agenda, ao contrário de `trocarPessoaEscala` — escala e agenda divergiriam em silêncio. |
| 5 | "Rafael não recebe, Will recebe" | Nenhum dos dois tem ficha em `teachers`. Criar a ficha do Rafael o joga no fechamento; `type:'eventual'` **não** resolve (eventual é pago, só perde férias). |
| 6 | "Feriado que cai no sábado" | `publishToAgenda` grava `isHoliday: scale.tipo === 'feriado'` — sábado que é feriado paga peso 1. Nenhum feriado nacional de 2026 cai em sábado, então não há dinheiro errado hoje. |

| 7 | "Para o professor não trabalhar em um sábado de feriado na sequência de um sábado normal" | Não existe regra de dias seguidos. E o sábado que é feriado é montado pela **aba Feriados**, então escapa do rodízio dos sábados — pode cair em quem trabalhou no sábado anterior. |

**Alcance da tarefa 7 (Rafael, 25/08 17h04):** a regra é entre **sábados seguidos**, não entre feriado de sexta e sábado. Escola Interna e evento ficam de fora ("só pra sábado mesmo").

**Já executado antes deste plano:** as 4 aulas de 29/08 vindas da grade antiga foram apagadas em produção (autorizado pelo Rafael). Backup em `scratchpad/backup-aulas-29-08.json`.

---

## File Structure

| Arquivo | Responsabilidade | Tarefas |
|---|---|---|
| `professores-home.js` | Painel inicial por perfil; contadores de pendência | 1 |
| `scale-service.js` | Persistência e orquestração da escala (objeto puro, deps injetáveis) | 2, 6 |
| `professores-escala-smart.js` | Telas da Escala Inteligente | 2, 3, 4 |
| `professores-shared.js` | Serviços compartilhados; cálculo do fechamento | 5 |
| `professores-cadastro.js` + `professores.html` | Formulário da ficha de professor | 5 |
| `firestore.rules` | Permissão de escrita em `fairness_counter` | 3 |
| `scale-engine.js` | Motor puro da consolidação (ordem de escolha) | 7 |
| `scripts/smoke-ajustes-escala-2508.js` | **Novo.** Cobre as 7 frentes | todas |

Um smoke só, com seções, em vez de seis arquivos: as frentes são pequenas e compartilham fixture (escala de sábado com 2 vagas). Segue o padrão de `smoke-escala-confirma-publica.js` — metade comportamental (roda o serviço real contra o fake), metade estrutural (guarda a ligação na tela).

---

## Task 1: A home conta a fila da gestão, não a do professor

**Files:**
- Modify: `professores-home.js:63-89` (`_renderHomeAdmin`)
- Modify: `professores.html:3028` (bump do `?v=`)
- Test: `scripts/smoke-ajustes-escala-2508.js` (seção 1)

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/smoke-ajustes-escala-2508.js` com o cabeçalho e a seção 1:

```js
'use strict';
// Roda: node scripts/smoke-ajustes-escala-2508.js
//
// Os 6 ajustes pedidos no grupo da gestão em 25/08/2026. Cada seção guarda
// UM comportamento que estava errado, com o relato que o originou.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

let ok = 0;
const passou = (msg) => { console.log('✓ ' + msg); ok++; };

// ═══ 1. A home conta a fila da GESTÃO ═══════════════════════════════
// Rodrigo, 25/08 8h53: "Abrindo a pág inicial, clicando nas substituições
// pendentes, não acontece nada". Em produção havia 5 trocas 'pending' (=
// esperando o colega confirmar) e ZERO 'aguardando_gestao'. A caixa estava
// certa ao dizer que não havia nada; quem mentia era o aviso.
{
  const src = ler('professores-home.js');

  assert.ok(/aguardando_gestao/.test(src),
    'a home precisa contar aguardando_gestao (o que é da gestão)');

  // O bloco "Precisam de você" não pode mais ser alimentado por 'pending'.
  const blocoChips = src.slice(src.indexOf('const chips = []'), src.indexOf('const pend ='));
  assert.ok(!/'pending'/.test(blocoChips),
    "'pending' não pode gerar chip em 'Precisam de você' — é fila do professor");

  passou('home conta aguardando_gestao e tirou pending de "Precisam de você"');
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: FAIL em *"a home precisa contar aguardando_gestao"* (hoje o arquivo não tem essa string).

- [ ] **Step 3: Implementar**

Em `professores-home.js`, substituir o corpo de `_renderHomeAdmin` (linhas 63-89) por:

```js
async function _renderHomeAdmin() {
  const body = document.getElementById('home-body');
  if (!body) return;

  const ferias = await _homeSafeCount(() =>
    db.collection('vacation_requests').where('status', '==', 'pendente').get());

  // Só o que espera a GESTÃO entra em "Precisam de você". As trocas em
  // 'pending' estão esperando o colega confirmar — cobrar a gestão por elas
  // manda o dono pra uma caixa que, corretamente, diz que não há nada.
  // (Rodrigo, 25/08: "clicando nas substituições pendentes, não acontece nada")
  const subsGestao = await _homeSafeCount(() =>
    db.collection('substitutions').where('status', '==', 'aguardando_gestao').get());
  const subsColega = await _homeSafeCount(() =>
    db.collection('substitutions').where('status', '==', 'pending').get());

  const chips = [];
  if (ferias) chips.push(_homeChip(ferias, ferias === 1 ? 'pedido de férias a aprovar' : 'pedidos de férias a aprovar', "navigateTo('ferias')"));
  if (subsGestao) chips.push(_homeChip(subsGestao, subsGestao === 1 ? 'troca a homologar' : 'trocas a homologar', "openInboxModal()"));

  const pend = chips.length
    ? `<div class="home-card home-pend">
         <div class="home-pt">⚠ Precisam de você</div>
         <div class="home-chips">${chips.join('')}</div>
       </div>`
    : `<div class="home-card home-ok">✅ Tudo em dia — nenhuma pendência no momento.</div>`;

  // Informativo, sem cobrar ninguém: está andando entre os professores.
  const andando = subsColega
    ? `<div class="home-card" style="font-size:13px;color:var(--text2);">
         🔄 ${subsColega} troca${subsColega === 1 ? '' : 's'} aguardando o colega confirmar —
         <button class="home-link" onclick="navigateTo('substituicoes')">ver na tela Substituições</button>
       </div>`
    : '';

  body.innerHTML = pend + andando + _homeAtalhos([
    ['📅', 'Agenda', 'agenda'],
    ['💰', 'Fechamento', 'fechamento'],
    ['📈', 'Relatórios', 'relatorios'],
  ]);
}
```

- [ ] **Step 4: Adicionar a classe `home-link` ao CSS**

Em `professores.html`, junto das outras regras `.home-*`:

```css
.home-link { background:none; border:none; padding:0; color:var(--blue); cursor:pointer;
             font-size:13px; text-decoration:underline; font-family:inherit; }
```

- [ ] **Step 5: Rodar o teste**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: `✓ home conta aguardando_gestao e tirou pending de "Precisam de você"`

- [ ] **Step 6: Bump do `?v=` e commit**

Em `professores.html:3028`: `professores-home.js?v=20260825`

```bash
git add professores-home.js professores.html scripts/smoke-ajustes-escala-2508.js
git commit -m "fix(home): aviso de troca conta a fila da gestao, nao a do professor"
```

---

## Task 2: Inverter TOI ↔ Hiit com um clique

**Files:**
- Modify: `scale-service.js:164-203` (adicionar `swapSlots` logo depois de `reassignSlot`)
- Modify: `scale-service.js:815` (exportar `swapSlots`)
- Modify: `professores-escala-smart.js:795-870` (`renderEscalaDetail` — botão) e `:773-787` (nova `inverterVagasEscala`)
- Test: `scripts/smoke-ajustes-escala-2508.js` (seção 2)

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao smoke:

```js
// ═══ 2. Inverter TOI <-> Hiit ═══════════════════════════════════════
// Rafael, 25/08 7h22: "Podemos trocar quem da TOI e quem da Hiit na prévia?"
// Pelos dois selects não dá: o 1º passo esbarra em "Essa pessoa já está em
// outra vaga desta escala" e a escala fica como estava.
{
  const makeFakeDb = require('./_fake-firestore.js');
  const SS = require('../scale-service.js');
  const SE = require('../scale-engine.js');
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

  (async () => {
    const sab = (await SS.createScale({
      date: '2026-10-10', tipo: 'sabado', name: 'Sábado 10/10',
      slots: [
        { id: 'toi',  unitId: 'cp', requiredModalityId: 'TOI',  assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' },
        { id: 'hiit', unitId: 'cp', requiredModalityId: 'HIIT', assignedPersonId: 'bia', startTime: '08:00', endTime: '12:00' },
      ],
    }, d)).data;

    // O caminho antigo continua barrado — é a regra que protege de duplicar.
    const porFora = await SS.reassignSlot(sab.id, 'toi', 'bia', d);
    assert.strictEqual(porFora.success, false, 'trocar de um em um segue barrado (correto)');

    const r = await SS.swapSlots(sab.id, 'toi', 'hiit', d);
    assert.strictEqual(r.success, true, 'swapSlots inverte as duas de uma vez');

    const fim = (await SS.getScale(sab.id, d)).data;
    const byId = Object.fromEntries(fim.slots.map(s => [s.id, s]));
    assert.strictEqual(byId.toi.assignedPersonId, 'bia', 'TOI virou bia');
    assert.strictEqual(byId.hiit.assignedPersonId, 'ana', 'Hiit virou ana');
    assert.strictEqual(byId.toi.reason, 'manual', 'vira escolha da gestão');

    // Inverter não é escalar mais ninguém: o contador de justiça não se mexe.
    const fAna = (await SS.getFairness('ana', d)).data;
    assert.strictEqual(fAna.diasTrabalhados, 0, 'inverter não mexe no contador');

    passou('swapSlots inverte TOI <-> Hiit sem mexer no contador');
  })();
}
```

⚠️ O smoke inteiro precisa rodar dentro de um `async` só. Ao montar o arquivo, envolver todas as seções assíncronas num único `(async () => { … })()` no fim, como faz `smoke-escala-confirma-publica.js`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: `TypeError: SS.swapSlots is not a function`

- [ ] **Step 3: Implementar `swapSlots`**

Em `scale-service.js`, logo após `reassignSlot` (depois da linha 203):

```js
  /**
   * Inverte as pessoas de duas vagas da MESMA escala, numa gravação só.
   *
   * Pelos dois selects não dá: `reassignSlot` recusa pôr alguém que já está em
   * outra vaga do dia — regra certa, que impede a mesma pessoa em duas aulas ao
   * mesmo tempo, mas que torna a troca A↔B impossível passo a passo.
   * (Rafael, 25/08: "Podemos trocar quem da TOI e quem da Hiit"; Rodrigo:
   * "dar a possibilidade de inverter com um click os profs do TOI e Hiit".)
   *
   * Não mexe no contador de justiça: as duas pessoas continuam trabalhando o
   * mesmo dia, só que na outra modalidade.
   */
  async function swapSlots(scaleId, slotAId, slotBId, deps) {
    try {
      if (!slotAId || !slotBId || slotAId === slotBId) {
        return { success: false, error: 'Escolha duas vagas diferentes.' };
      }
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      const slots = scale.slots || [];
      const a = slots.find(s => s.id === slotAId);
      const b = slots.find(s => s.id === slotBId);
      if (!a || !b) return { success: false, error: 'Vaga não encontrada.' };
      if (!a.assignedPersonId && !b.assignedPersonId) {
        return { success: false, error: 'As duas vagas estão abertas — não há o que inverter.' };
      }

      const novos = slots.map(s => {
        if (s.id === slotAId) return Object.assign({}, s, { assignedPersonId: b.assignedPersonId || null, reason: b.assignedPersonId ? 'manual' : null, explain: [] });
        if (s.id === slotBId) return Object.assign({}, s, { assignedPersonId: a.assignedPersonId || null, reason: a.assignedPersonId ? 'manual' : null, explain: [] });
        return s;
      });

      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: novos, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });

      return { success: true, data: { published: !!scale.published, from: a.assignedPersonId || null, to: b.assignedPersonId || null } };
    } catch (err) { console.error('[ScaleService.swapSlots]', err); return { success: false, error: err.message }; }
  }
```

Na linha do `return { … }` final do módulo (linha 815), acrescentar `swapSlots` depois de `reassignSlot`.

- [ ] **Step 4: Rodar o teste**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: `✓ swapSlots inverte TOI <-> Hiit sem mexer no contador`

- [ ] **Step 5: Botão na tela**

Em `professores-escala-smart.js`, depois de `trocarPessoaEscala` (linha 787):

```js
/**
 * Inverte as duas vagas de uma unidade (TOI <-> Hiit) num clique só.
 * Republica a agenda quando a escala já estava publicada — senão a aula
 * continuaria no nome antigo.
 */
async function inverterVagasEscala(scaleId, slotAId, slotBId) {
  const res = await ScaleService.swapSlots(scaleId, slotAId, slotBId);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }

  let msg = 'Vagas invertidas.';
  if (res.data.published) {
    const pub = await ScaleService.publishToAgenda(scaleId);
    msg += pub.success ? ' Agenda republicada.' : ' ⚠️ Falhou republicar na agenda — republique na mão.';
  }
  toast(msg, 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}
```

Registrar no fim do arquivo, junto dos outros `window.*`:

```js
window.inverterVagasEscala = inverterVagasEscala;
```

- [ ] **Step 6: Desenhar o botão entre os cards da unidade**

Em `renderEscalaDetail`, dentro do `Object.keys(byUnit).forEach`, trocar a montagem de `unitsHtml` (a linha que hoje faz `unitsHtml += ...`) por:

```js
    // Com exatamente 2 vagas na unidade (o caso TOI + Hiit), oferece a inversão
    // direta. Com 3+ não dá pra adivinhar quais duas, então some.
    const par = byUnit[uid];
    const btnInverter = (par.length === 2 && (par[0].assignedPersonId || par[1].assignedPersonId))
      ? `<button class="btn-secondary" style="font-size:12px;padding:4px 10px;"
                 onclick="inverterVagasEscala('${scale.id}','${par[0].id}','${par[1].id}')"
                 title="Troca as duas pessoas de modalidade">⇄ Inverter</button>`
      : '';
    unitsHtml += `<div style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <span style="font-size:13px;font-weight:500;">${unitName(uid)}</span>${btnInverter}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">${cards}</div></div>`;
```

- [ ] **Step 7: Guardar a ligação na tela (teste estrutural)**

Acrescentar ao smoke, na seção 2:

```js
{
  const ui = ler('professores-escala-smart.js');
  assert.ok(/ScaleService\.swapSlots\(/.test(ui), 'a tela chama swapSlots');
  assert.ok(/window\.inverterVagasEscala\s*=/.test(ui), 'o botão está registrado no window');
  assert.ok(/inverterVagasEscala\('\$\{scale\.id\}'/.test(ui), 'o botão ⇄ Inverter está desenhado');
  passou('tela ligada ao swapSlots');
}
```

- [ ] **Step 8: Rodar e commitar**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: as duas asserções da seção 2 passando.

Bump em `professores.html`: `scale-service.js?v=20260825` e `professores-escala-smart.js?v=20260825`.

```bash
git add scale-service.js professores-escala-smart.js professores.html scripts/smoke-ajustes-escala-2508.js
git commit -m "feat(escala): inverter TOI e Hiit num clique"
```

---

## Task 3: Equilíbrio do ciclo mostra os nomes, tira quem não participa e deixa corrigir

**Files:**
- Modify: `professores-escala-smart.js:127-148` (`renderEquilibrioPainel`) e `:110-124` (`escalaLoadBase`)
- Modify: `firestore.rules` (escrita em `fairness_counter` para admin/gestão)
- Test: `scripts/smoke-ajustes-escala-2508.js` (seção 3)

**Por que "tirar quem não participa" faz parte:** em produção os 3 "abaixo do mínimo" são Yasmin (TOI Mobility), Patrícia (Yoga) e Louiz Lume (TOI Combate). As vagas de sábado exigem TOI ou Hiit, então esses três **nunca** serão escalados e o chip vermelho ficaria aceso para sempre.

- [ ] **Step 1: Escrever o teste que falha**

```js
// ═══ 3. Equilíbrio do ciclo com nomes e sem falso alarme ════════════
// Rodrigo, 25/08 9h05: "em 'equilíbrio do ciclo' mostrar quem são as pessoas".
// Em produção os 3 'abaixo do mínimo' eram Yasmin, Patrícia e Louiz Lume —
// que não dão TOI nem Hiit. O alerta cobrava algo sem solução.
{
  const ui = ler('professores-escala-smart.js');
  assert.ok(/participaDoRodizio/.test(ui),
    'o painel precisa separar quem participa do rodízio de sábado');
  assert.ok(/<details/.test(ui.slice(ui.indexOf('function renderEquilibrioPainel'), ui.indexOf('function whyTableHtml'))),
    'os chips precisam abrir a lista de nomes');
  assert.ok(/window\.ajustarContadorJustica\s*=/.test(ui),
    'precisa de um jeito de corrigir o contador na mão');
  passou('equilíbrio mostra nomes, separa quem não participa e permite corrigir');
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: FAIL em *"o painel precisa separar quem participa"*.

- [ ] **Step 3: Substituir `renderEquilibrioPainel`**

Em `professores-escala-smart.js`, trocar a função inteira (linhas 127-148) por:

```js
/**
 * Quem disputa vaga de sábado: precisa ter TOI ou Hiit.
 *
 * Sem esse filtro o painel acusava 3 pessoas "abaixo do mínimo" que nunca
 * seriam escaladas — Yasmin (TOI Mobility), Patrícia (Yoga) e Louiz Lume (TOI
 * Combate). Alerta que não tem como resolver vira ruído e some da vista.
 */
function participaDoRodizio(t) {
  const mods = t.modalityIds || [];
  const toi  = (EscalaSmartState.modToi  || {}).id;
  const hiit = (EscalaSmartState.modHiit || {}).id;
  if (!toi && !hiit) return true;   // sem modalidade mapeada, não filtra ninguém
  return mods.indexOf(toi) !== -1 || mods.indexOf(hiit) !== -1;
}

function renderEquilibrioPainel() {
  const fm = EscalaSmartState.fairnessMap || new Map();
  if (fm.size === 0) return '';

  const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const dentro = ativos.filter(participaDoRodizio);
  const fora   = ativos.filter(t => !participaDoRodizio(t));
  if (!dentro.length) return '';

  const dadosDe = (t) => fm.get(t.id) || { diasTrabalhados: 0, divida: 0 };
  const dias = dentro.map(t => dadosDe(t).diasTrabalhados || 0);
  const avg = dias.reduce((a, b) => a + b, 0) / dias.length;

  const grupos = { abaixo: [], media: [], acima: [] };
  dentro.forEach(t => {
    const f = dadosDe(t);
    const d = f.diasTrabalhados || 0;
    const g = (d < 1 || (f.divida || 0) > 0) ? 'abaixo' : (d > Math.ceil(avg) ? 'acima' : 'media');
    grupos[g].push({ t, d, divida: f.divida || 0 });
  });

  const linha = (x) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 0;font-size:12px;">
      <span>${escalaEsc(x.t.name)}</span>
      <span style="display:flex;align-items:center;gap:6px;color:var(--text2);">
        ${x.d} dia${x.d === 1 ? '' : 's'}${x.divida ? ` · deve ${x.divida}` : ''}
        <button class="btn-secondary" style="font-size:11px;padding:2px 8px;"
                onclick="ajustarContadorJustica('${x.t.id}')" title="Corrigir na mão">✏️</button>
      </span>
    </div>`;

  const bloco = (chave, bg, color, icon, rotulo) => {
    const itens = grupos[chave];
    return `<details style="flex:1;min-width:180px;">
      <summary style="list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;border-radius:8px;background:${bg};color:${color};">
        ${icon} ${itens.length} ${rotulo}
      </summary>
      <div style="padding:6px 4px 0;">${itens.length ? itens.map(linha).join('') : '<span style="font-size:12px;color:var(--text3);">ninguém</span>'}</div>
    </details>`;
  };

  const foraHtml = fora.length
    ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;">
         ${fora.length} pessoa${fora.length === 1 ? '' : 's'} fora do rodízio de sábado (não dá TOI nem Hiit):
         ${fora.map(t => escalaEsc(t.name)).join(' · ')}
       </div>`
    : '';

  return `<div style="margin-bottom:14px;">
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Equilíbrio do ciclo</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;">
      ${bloco('abaixo', '#2a1414', 'var(--red)',  '↓', 'abaixo do mínimo')}
      ${bloco('media',  '#10241a', 'var(--green)', '=', 'na média')}
      ${bloco('acima',  '#2a2410', '#caa23a',      '↑', 'acima')}
    </div>
    ${foraHtml}
  </div>`;
}
```

- [ ] **Step 4: Escape de nome — conferir se `escalaEsc` já existe**

Run: `grep -n "function escalaEsc" professores-escala-smart.js`

Se **não** existir, acrescentar logo acima de `participaDoRodizio`:

```js
function escalaEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
```

- [ ] **Step 5: Correção manual do contador**

Em `professores-escala-smart.js`, junto das outras ações (depois de `inverterVagasEscala`):

```js
/**
 * Corrige o contador de justiça de uma pessoa.
 *
 * Pedido do Rafael em 25/08: "de agora só altera pra frente, o que passou eles
 * têm como ajustar manualmente?" — não tinham. Agosto inteiro os sábados foram
 * das mesmas 4 pessoas (a escala nunca chegou a valer), e sem essa alavanca a
 * dívida ficaria travada esperando alguém mexer no banco.
 */
async function ajustarContadorJustica(personId) {
  const atual = (EscalaSmartState.fairnessMap || new Map()).get(personId) || { diasTrabalhados: 0, divida: 0 };
  const nome = escalaPersonName(personId);
  const resp = prompt(`Quantos dias de escala ${nome} já trabalhou neste ciclo?`, String(atual.diasTrabalhados || 0));
  if (resp === null) return;
  const n = Number(String(resp).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) { toast('Informe um número igual ou maior que zero.', 'error'); return; }

  const res = await ScaleService.saveFairness(personId, { diasTrabalhados: Math.round(n), divida: atual.divida || 0 });
  if (!res || res.success === false) { toast('Erro ao salvar: ' + ((res && res.error) || 'falha'), 'error'); return; }

  if (typeof AuditService === 'object') {
    await AuditService.log({
      type: 'fairness_adjusted',
      details: `Contador de escala de "${nome}" ajustado de ${atual.diasTrabalhados || 0} para ${Math.round(n)}`,
      entityType: 'fairness_counter', entityId: personId,
      before: atual, after: { diasTrabalhados: Math.round(n), divida: atual.divida || 0 },
      module: 'agenda',
    });
  }
  toast(`Contador de ${nome} ajustado para ${Math.round(n)}.`, 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}
```

Registrar: `window.ajustarContadorJustica = ajustarContadorJustica;`

- [ ] **Step 6: Conferir se `saveFairness` está exposto no serviço**

Run: `grep -n "saveFairness" scale-service.js | tail -3`
Expected: aparecer na lista de exports da linha final. Já está — nada a fazer.

- [ ] **Step 7: Rules — deixar admin/gestão escrever em `fairness_counter`**

Run: `grep -n "fairness_counter" -A 8 firestore.rules`

Se a regra hoje só permitir escrita pelo próprio serviço/admin, garantir que admin e gestão escrevem:

```
    match /fairness_counter/{personId} {
      allow read: if isSignedIn() && isCadastrado();
      allow write: if isAdminOuGestao();
    }
```

Usar exatamente os nomes de função que já existem no arquivo — conferir com `grep -n "function is" firestore.rules` antes de escrever.

- [ ] **Step 8: Rodar o teste e commitar**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: `✓ equilíbrio mostra nomes, separa quem não participa e permite corrigir`

```bash
git add professores-escala-smart.js firestore.rules scripts/smoke-ajustes-escala-2508.js
git commit -m "feat(escala): equilibrio do ciclo com nomes, sem falso alarme e com correcao manual"
```

⚠️ **Deploy das rules é separado e só depois do staging** (regra 7 do CLAUDE.md). Antes de qualquer deploy em produção rodar `node scripts/validate-rules-comissoes.js`.

---

## Task 4: Reconsolidar e Despublicar explicados — e Reconsolidar republicando

**Files:**
- Modify: `professores-escala-smart.js:1097-1122` (`consolidarEscala`) e `:1261-1268` (`despublicarEscala`)
- Test: `scripts/smoke-ajustes-escala-2508.js` (seção 4)

**O defeito junto:** `trocarPessoaEscala` republica quando a escala está publicada; `consolidarEscala` não. Reconsolidar uma escala publicada deixaria a tela com o nome novo e a agenda com o antigo, em silêncio. Conferido em produção: as 11 escalas publicadas estão consistentes hoje — dá pra fechar antes de acontecer.

- [ ] **Step 1: Escrever o teste que falha**

```js
// ═══ 4. Reconsolidar/Despublicar explicados e sem divergir ══════════
// Rodrigo, 25/08 9h10: "Explicar melhor o comportamento qdo clicar em
// Reconsolidar e Despublicar". Junto: reconsolidar uma escala publicada NÃO
// republicava — escala com o nome novo, agenda com o antigo, em silêncio.
{
  const ui = ler('professores-escala-smart.js');
  const fn = ui.slice(ui.indexOf('async function consolidarEscala'), ui.indexOf('// ─── Revisão de fechamento'));
  assert.ok(/confirm\(/.test(fn), 'Reconsolidar precisa explicar antes de refazer');
  assert.ok(/apaga os ajustes|ajustes feitos na mão/i.test(fn), 'o texto precisa avisar que perde o ajuste manual');
  assert.ok(/publishToAgenda/.test(fn), 'reconsolidar escala publicada precisa republicar a agenda');

  const desp = ui.slice(ui.indexOf('async function despublicarEscala'), ui.indexOf('/* ─── COLABORADOR'));
  assert.ok(/avisad|notificad/i.test(desp), 'Despublicar precisa avisar que quem foi notificado não é desavisado');
  passou('Reconsolidar e Despublicar explicam o que fazem; reconsolidar republica');
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: FAIL em *"Reconsolidar precisa explicar antes de refazer"*.

- [ ] **Step 3: Explicação + republicação no `consolidarEscala`**

Em `professores-escala-smart.js`, no começo de `consolidarEscala` (logo depois da linha `async function consolidarEscala(id) {`), inserir:

```js
  const jaFeita = (EscalaSmartState.scales.find(s => s.id === id) || {});
  if (jaFeita.status === 'consolidada') {
    const temManual = (jaFeita.slots || []).some(s => s.reason === 'manual');
    const aviso = 'Reconsolidar refaz a escolha do zero, pelo rodízio e pelo mérito de hoje.\n\n'
      + (temManual ? '⚠️ Os ajustes feitos na mão nesta data serão APAGADOS.\n\n' : '')
      + (jaFeita.published ? 'A agenda será republicada com os nomes novos.\n\n' : '')
      + 'O contador de justiça não é recontado — quem já pegou este dia segue com ele.\n\nContinuar?';
    if (!confirm(aviso)) return;
  }
```

E no fecho, trocar o bloco de sucesso (a linha `if (res.success) { toast('Escala consolidada!', 'success'); renderEscalaGestao(); }`) por:

```js
  if (res.success) {
    let msg = 'Escala consolidada!';
    // A tela já mostrava o nome novo; a agenda continuava com o antigo. Quem
    // trocava pelo select tinha a agenda atualizada, quem reconsolidava não.
    if (jaFeita.published) {
      const pub = await ScaleService.publishToAgenda(id);
      msg += pub.success ? ' Agenda republicada.' : ' ⚠️ Falhou republicar na agenda — republique na mão.';
    }
    toast(msg, 'success');
    await escalaLoadBase();
    renderEscalaGestao();
  }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
```

- [ ] **Step 4: Explicação no `despublicarEscala`**

Trocar a primeira linha da função:

```js
async function despublicarEscala(id) {
  if (!confirm('Despublicar remove da agenda as aulas desta escala.\n\n'
             + '⚠️ Quem já recebeu o aviso NÃO é desavisado — continua achando que trabalha. '
             + 'Se for o caso, fale com as pessoas.\n\n'
             + 'A escala em si continua montada; dá pra publicar de novo depois. '
             + 'Aula de mês já fechado não é removida.\n\nContinuar?')) return;
```

- [ ] **Step 5: Rodar e commitar**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: `✓ Reconsolidar e Despublicar explicam o que fazem; reconsolidar republica`

```bash
git add professores-escala-smart.js scripts/smoke-ajustes-escala-2508.js
git commit -m "fix(escala): reconsolidar avisa e republica a agenda; despublicar explica o efeito"
```

---

## Task 5: Ficha que dá aula mas não recebe

**Files:**
- Modify: `professores-shared.js:525-559` (`TeacherService.create`) e `:2783-2790` (agrupamento do fechamento)
- Modify: `professores.html:2468-2476` (formulário) e `professores-cadastro.js:1191-1212` (`saveTeacher`), `:1045-1057` (`setTeacherType`)
- Test: `scripts/smoke-ajustes-escala-2508.js` (seção 5)

**Decisão do Rafael (25/08):** *"o rafa não recebe pois é um dos donos da cross, mas ele dá aula tb, e a parte dele na gestão"*. Will recebe normalmente e a gestão cadastra por conta.

**Por que não usar `type:'eventual'`:** eventual continua sendo pago (só perde direito a férias, `professores-shared.js:4101`). E ficha sem `teacher_salaries` cai no ramo `noSalaryData` — aparece no fechamento com as horas e o aviso "Sem cadastro salarial", virando uma pendência mensal que convida alguém a "consertar" pagando um sócio.

- [ ] **Step 1: Escrever o teste que falha**

```js
// ═══ 5. Dá aula e não recebe ════════════════════════════════════════
// Rafael, 25/08: "o rafa não recebe pois é um dos donos da cross, mas ele dá
// aula tb". Sem marca própria, criar a ficha o joga no fechamento — e ficha
// sem salário vira linha de pendência todo mês.
{
  const shared = ler('professores-shared.js');
  assert.ok(/naoRemunerado/.test(shared), 'a ficha precisa da marca naoRemunerado');

  const criar = shared.slice(shared.indexOf('async create(teacherData)'), shared.indexOf('async update(id, updates)'));
  assert.ok(/naoRemunerado:/.test(criar), 'create grava a marca');

  const html = ler('professores.html');
  assert.ok(/teacherNaoRemunerado/.test(html), 'o formulário tem o campo');

  const cad = ler('professores-cadastro.js');
  assert.ok(/naoRemunerado:/.test(cad), 'saveTeacher manda a marca');
  passou('marca "não recebe por aula" existe na ficha, no form e no fechamento');
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: FAIL em *"a ficha precisa da marca naoRemunerado"*.

- [ ] **Step 3: Campo no serviço**

Em `professores-shared.js`, dentro do objeto `after` de `TeacherService.create` (depois de `isActive: true,`):

```js
        // Sócio que dá aula e não recebe por isso (Rafael, 25/08/2026).
        // Entra na escala e na agenda como qualquer um; o fechamento não lista.
        // Não dá pra resolver com type:'eventual' — eventual é pago.
        naoRemunerado: teacherData.naoRemunerado === true,
```

- [ ] **Step 4: Fechamento ignora quem não recebe**

Em `professores-shared.js`, no passo 7 do fechamento (o laço `for (const c of validClasses)` por volta da linha 2783), trocar por:

```js
      // 7) Agrupa classes por teacherId
      const grouped = {};
      for (const c of validClasses) {
        // Quem não recebe por aula não entra na folha. Sem isto a ficha
        // apareceria com as horas e o aviso "Sem cadastro salarial" todo mês.
        const t = teacherMap[c.teacherId];
        if (t && t.naoRemunerado === true) continue;
        if (!grouped[c.teacherId]) grouped[c.teacherId] = [];
        grouped[c.teacherId].push(c);
      }
```

- [ ] **Step 5: Campo no formulário**

Em `professores.html`, logo depois do bloco `<!-- Tipo -->` (após a linha 2476):

```html
      <!-- Sócio que dá aula sem receber (Rafael, 25/08) -->
      <div class="form-section">
        <label style="display:flex;align-items:center;gap:8px;font-weight:400;cursor:pointer;">
          <input type="checkbox" id="teacherNaoRemunerado">
          Dá aula mas <b>não recebe por aula</b>
        </label>
        <div style="font-size:12px;color:var(--text2);margin-top:4px;">
          Entra na escala e na agenda normalmente, mas não aparece no fechamento nem gera recibo.
        </div>
      </div>
```

- [ ] **Step 6: Formulário envia e carrega a marca**

Em `professores-cadastro.js`, no objeto `data` de `saveTeacher` (depois de `notes: …`):

```js
    naoRemunerado: !!($f('teacherNaoRemunerado') && $f('teacherNaoRemunerado').checked),
```

E onde o formulário é preenchido para edição — localizar com `grep -n "teacherNotes').value =" professores-cadastro.js` e acrescentar na mesma vizinhança:

```js
  if ($f('teacherNaoRemunerado')) $f('teacherNaoRemunerado').checked = (t.naoRemunerado === true);
```

No `closeTeacherModal`/reset do formulário (mesma vizinhança de `TeacherFormState.editingId = null`), garantir o desmarque:

```js
  if ($f('teacherNaoRemunerado')) $f('teacherNaoRemunerado').checked = false;
```

- [ ] **Step 7: Rodar e commitar**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: `✓ marca "não recebe por aula" existe na ficha, no form e no fechamento`

Bump: `professores-shared.js?v=20260825` e `professores-cadastro.js?v=20260825`.

```bash
git add professores-shared.js professores-cadastro.js professores.html scripts/smoke-ajustes-escala-2508.js
git commit -m "feat(pessoas): ficha que da aula sem receber (socio na escala, fora da folha)"
```

- [ ] **Step 8: Criar a ficha do Rafael Rojais — SÓ depois de homologar no staging**

Não fazer por script direto em produção. Depois do deploy, criar pela tela Pessoas:
nome `Rafael Rojais`, e-mail `rafaelrojais@hotmail.com`, tipo Efetivo, marca **"não recebe por aula"** ligada, unidades CP + PP, modalidades TOI e Hiit/Marombinha, vinculando ao usuário que já existe.
A ficha do **Will** a gestão cadastra por conta (decisão do Rafael em 25/08) — não criar.

---

## Task 6: Sábado que é feriado paga em dobro

**Files:**
- Modify: `scale-service.js:755-800` (`publishToAgenda`)
- Modify: `professores-escala-smart.js:457-470` (`renderTabSabados`) e `:219-224` (carga dos feriados)
- Test: `scripts/smoke-ajustes-escala-2508.js` (seção 6)

**Estado hoje:** `isHoliday: scale.tipo === 'feriado'`. Sábado montado pela aba Sábados que também é feriado nasce com peso 1. Nenhum feriado nacional de 2026 cai em sábado (conferido), então não há pagamento errado no ano — mas pega feriado municipal criado no "+ Data especial", e 2027 tem 20/11 e 25/12 em sábado.

- [ ] **Step 1: Escrever o teste que falha**

```js
// ═══ 6. Sábado que é feriado paga em dobro ══════════════════════════
// Rafael, 25/08 9h13: "quando um feriado cai em um sabado ele nao entra como
// feriado". Rodrigo confirmou a regra: "é pago em dobro como feriado normal".
{
  const makeFakeDb = require('./_fake-firestore.js');
  const SS = require('../scale-service.js');
  const SE = require('../scale-engine.js');
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

  const sab = (await SS.createScale({
    date: '2027-11-20', tipo: 'sabado', name: 'Sábado 20/11',
    feriadoNaData: 'Consciência Negra',
    slots: [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana',
              startTime: '08:00', endTime: '12:00' }],
  }, d)).data;

  const pub = await SS.publishToAgenda(sab.id, d);
  assert.strictEqual(pub.success, true, 'publicou');

  const aulas = await db.collection('classes').where('specialScaleId', '==', sab.id).get();
  assert.strictEqual(aulas.docs.length, 1, 'criou a aula');
  assert.strictEqual(aulas.docs[0].data().isHoliday, true,
    'sábado que é feriado tem que pagar em dobro');
  assert.strictEqual(aulas.docs[0].data().holidayName, 'Consciência Negra', 'guarda o nome do feriado');

  // Sábado comum segue peso de sábado.
  const comum = (await SS.createScale({
    date: '2027-11-27', tipo: 'sabado', name: 'Sábado 27/11',
    slots: [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana',
              startTime: '08:00', endTime: '12:00' }],
  }, d)).data;
  await SS.publishToAgenda(comum.id, d);
  const a2 = await db.collection('classes').where('specialScaleId', '==', comum.id).get();
  assert.strictEqual(a2.docs[0].data().isHoliday, false, 'sábado comum não é feriado');

  passou('sábado que é feriado nasce em dobro; sábado comum não');
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: FAIL — `isHoliday` vem `false` para o sábado 20/11/2027.

- [ ] **Step 3: `publishToAgenda` respeita o feriado da data**

Em `scale-service.js`, no `.set({...})` dentro do laço de `publishToAgenda` (linha 782), trocar a linha do `isHoliday` por:

```js
          // Feriado manda, venha a escala pela aba Sábados ou pela aba Feriados.
          // Antes só `tipo === 'feriado'` pagava em dobro — sábado que também
          // era feriado nascia com peso 1 (Rafael, 25/08; Rodrigo confirmou que
          // "é pago em dobro como feriado normal").
          isHoliday: scale.tipo === 'feriado' || !!scale.feriadoNaData,
          holidayName: scale.tipo === 'feriado' ? (scale.name || null) : (scale.feriadoNaData || null),
          holidayType: null,
```

- [ ] **Step 4: A aba Sábados carrega os feriados e marca a data**

Em `professores-escala-smart.js`, na `renderEscalaGestao`, trocar a linha que só carrega feriados na aba Feriado (linha 223) por:

```js
  // A aba Sábados também precisa dos feriados: sábado que é feriado paga em
  // dobro e a gestão tem que ver isso antes de montar.
  if (EscalaSmartState.tab === 'feriado' || EscalaSmartState.tab === 'sabado') {
    await escalaLoadFeriados(EscalaSmartState.year);
  }
```

Fazer a mesma troca na `renderEscalaPrefs` (linha 1446).

- [ ] **Step 5: Etiqueta na lista de sábados**

Em `renderTabSabados`, depois da linha do `header`, acrescentar o mapa de feriados e a etiqueta:

```js
  const feriadosDoAno = EscalaSmartState.feriadosByYear[EscalaSmartState.year] || [];
  const feriadoPorData = new Map(feriadosDoAno.map(f => [f.date, f.name]));
```

E, onde cada linha de sábado é desenhada, incluir junto do nome da data:

```js
    const ehFeriado = feriadoPorData.get(r.date);
    const selo = ehFeriado
      ? `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#2a2410;color:#caa23a;margin-left:6px;"
               title="Feriado — as aulas deste dia pagam em dobro">🎌 ${escalaEsc(ehFeriado)} · paga em dobro</span>`
      : '';
```

Anexar `${selo}` ao lado do rótulo da data na montagem da linha.

- [ ] **Step 6: Gravar o feriado ao criar a escala de sábado**

Em `professores-escala-smart.js`, na criação em lote (`openAbrirLote`, por volta da linha 1043-1047), passar o nome do feriado quando houver:

```js
        const feriadoNome = (EscalaSmartState.feriadosByYear[EscalaSmartState.year] || [])
          .find(f => f.date === date);
        const res = await ScaleService.createScale({
          date, tipo,
          name: `${tipo === 'feriado' ? 'Feriado' : 'Sábado'} ${escalaFmtBR(date)}`,
          feriadoNaData: (tipo === 'sabado' && feriadoNome) ? feriadoNome.name : null,
          slots: escalaSlotsPadrao(tipo),
        });
```

Fazer o mesmo em `criarEscalaData` (a criação de uma data só).

- [ ] **Step 7: `createScale` precisa aceitar o campo**

Run: `grep -n "async function createScale" -A 20 scale-service.js`

Se a função montar o doc campo a campo, acrescentar `feriadoNaData: dados.feriadoNaData || null,`. Se ela espalhar o objeto recebido, não é preciso mexer.

- [ ] **Step 8: Rodar e commitar**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: `✓ sábado que é feriado nasce em dobro; sábado comum não`

```bash
git add scale-service.js professores-escala-smart.js professores.html scripts/smoke-ajustes-escala-2508.js
git commit -m "fix(escala): sabado que e feriado paga em dobro"
```

---

## Task 7: A mesma pessoa não pega dois sábados seguidos

**Files:**
- Modify: `scale-engine.js:44-59` (`makeComparator`) e `:9-19` (`norm`)
- Modify: `scale-service.js` (`consolidate` — carregar os sábados vizinhos)
- Test: `scripts/smoke-ajustes-escala-2508.js` (seção 7)

**O pedido (Rafael, 25/08 17h04):** *"Para o professor não trabalhar em um sábado de feriado na sequência de um sábado normal"*.

**Por que acontece:** sábado que é feriado é montado pela **aba Feriados**, escala separada, consolidada noutro momento. O rodízio dos sábados não o enxerga, então quem trabalhou no sábado anterior pode ser escalado de novo no seguinte.

**Teto macio, não bloqueio:** Rafael já decidiu que *"se sobrar só uma pessoa habilitada, escala assim"*. Então quem trabalhou no sábado vizinho vai pro **fim da fila** — só entra se não houver mais ninguém. Mesmo padrão do `acimaDaCota`, que já existe no motor.

- [ ] **Step 1: Escrever o teste que falha**

```js
// ═══ 7. Dois sábados seguidos, não ══════════════════════════════════
// Rafael, 25/08 17h04: "Para o professor não trabalhar em um sábado de feriado
// na sequência de um sábado normal". O sábado-feriado vem da aba Feriados —
// escala à parte — e por isso escapava do rodízio dos sábados.
{
  const SE = require('../scale-engine.js');

  const slots = [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI' }];
  // Ana tem mais mérito e menos dias, então ganharia. Mas trabalhou no sábado
  // anterior; Bia não.
  const candidatos = [
    { id: 'ana', modalityIds: ['TOI'], merito: 100, diasTrabalhados: 1, trabalhouSabadoVizinho: true },
    { id: 'bia', modalityIds: ['TOI'], merito: 0,   diasTrabalhados: 2, trabalhouSabadoVizinho: false },
  ];
  const r = SE.consolidate(slots, candidatos, { minMes: 1 });
  assert.strictEqual(r.assignments[0].personId, 'bia',
    'quem trabalhou no sábado vizinho cede a vez');

  // Teto MACIO: se só a Ana existe, ela é escalada mesmo assim.
  const soAna = [{ id: 'ana', modalityIds: ['TOI'], merito: 100, diasTrabalhados: 1, trabalhouSabadoVizinho: true }];
  const r2 = SE.consolidate(slots, soAna, { minMes: 1 });
  assert.strictEqual(r2.assignments[0].personId, 'ana',
    'sobrando só uma pessoa habilitada, escala assim mesmo (decisão do Rafael)');

  passou('sábados seguidos: cede a vez, mas não deixa a vaga aberta');
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: FAIL — hoje ganha `ana`, porque o motor não conhece `trabalhouSabadoVizinho`.

- [ ] **Step 3: Motor conhece o vizinho**

Em `scale-engine.js`, dentro de `norm` (depois de `jaNoLote: c.jaNoLote || 0,`):

```js
      // Já trabalhou no sábado imediatamente anterior ou seguinte?
      // (Rafael, 25/08: "não trabalhar em um sábado de feriado na sequência de
      // um sábado normal".) Sábado que é feriado conta como sábado.
      trabalhouSabadoVizinho: c.trabalhouSabadoVizinho === true,
```

Em `makeComparator`, como **primeiro** critério — antes da cota, porque descansar entre sábados vale mais do que a quantidade pedida:

```js
    return function (a, b) {
      // Quem acabou de trabalhar no sábado vizinho cede a vez. Teto MACIO:
      // ordena pro fim da fila, não exclui — melhor repetir alguém do que
      // deixar o sábado sem professor (decisão do Rafael, 25/08).
      const va = a.trabalhouSabadoVizinho ? 1 : 0, vb = b.trabalhouSabadoVizinho ? 1 : 0;
      if (va !== vb) return va - vb;
      // Quem já bateu a própria cota cede a vez a quem ainda quer trabalhar.
      const ca = acimaDaCota(a) ? 1 : 0, cb = acimaDaCota(b) ? 1 : 0;
      if (ca !== cb) return ca - cb;
```

(o resto da função continua igual)

- [ ] **Step 4: Rodar o teste do motor**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: `✓ sábados seguidos: cede a vez, mas não deixa a vaga aberta`

- [ ] **Step 5: O serviço descobre quem são os vizinhos**

Em `scale-service.js`, acrescentar antes de `consolidate`:

```js
  /**
   * PURO: quem já está escalado no sábado imediatamente anterior ou seguinte.
   *
   * "Sábado seguinte" é a data ±7 dias — e sábado que é feriado conta, porque é
   * exatamente o caso que originou a regra: o sábado-feriado é montado pela aba
   * Feriados e escapava do rodízio dos sábados.
   * @returns {Set<string>} teacherIds
   */
  function personsOnAdjacentSaturday(scales, dateISO) {
    const out = new Set();
    if (!dateISO) return out;
    const d = new Date(dateISO + 'T12:00:00');
    if (isNaN(d) || d.getDay() !== 6) return out;   // só vale a partir de um sábado
    const desloca = (dias) => {
      const x = new Date(d); x.setDate(d.getDate() + dias);
      const p = n => String(n).padStart(2, '0');
      return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    };
    const vizinhas = new Set([desloca(-7), desloca(7)]);
    (scales || []).forEach(s => {
      if (!s || !vizinhas.has(s.date)) return;
      if (s.tipo !== 'sabado' && s.tipo !== 'feriado') return;
      (s.slots || []).forEach(sl => { if (sl.assignedPersonId) out.add(sl.assignedPersonId); });
    });
    return out;
  }
```

Exportar na linha final do módulo, junto de `personsOnVacation`.

- [ ] **Step 6: `consolidate` usa o vizinho**

Em `scale-service.js`, dentro de `consolidate`, logo depois do bloco de férias (`const teachers = (ctx.teachers || []).filter(t => !deFerias.has(t.id));`):

```js
      // Quem trabalhou no sábado vizinho vai pro fim da fila. Só vale entre
      // sábados — Escola Interna e evento ficam de fora ("só pra sábado
      // mesmo", Rafael 25/08).
      const vizinhos = personsOnAdjacentSaturday(ctx.scalesDoAno || [], scale.date);
```

E na montagem dos candidatos, passar a marca:

```js
      const candidates = buildCandidates({
        teachers, meritoById: ctx.meritoById || {}, fairnessById, prefById,
        cotaById: ctx.cotaById || {}, jaNoLoteById: ctx.jaNoLoteById || {},
        vizinhoById: vizinhos,
      });
```

Em `buildCandidates`, aceitar e repassar:

```js
    const vizinho = ctx.vizinhoById || new Set();
```

e, no objeto devolvido por `.map`, acrescentar:

```js
      trabalhouSabadoVizinho: typeof vizinho.has === 'function' ? vizinho.has(t.id) : false,
```

- [ ] **Step 7: A tela manda as escalas do ano no contexto**

Em `professores-escala-smart.js`, dentro de `escalaMontarCtx` (e também no `ctx` montado por `consolidarEscala`, linhas 1111-1115), acrescentar:

```js
    // O motor precisa enxergar os sábados vizinhos pra não repetir a pessoa.
    scalesDoAno: EscalaSmartState.scales || [],
```

- [ ] **Step 8: Teste de ponta a ponta do serviço**

Acrescentar à seção 7 do smoke:

```js
{
  const makeFakeDb = require('./_fake-firestore.js');
  const SS = require('../scale-service.js');
  const SE = require('../scale-engine.js');
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

  // 14/11/2026 é sábado; 21/11/2026 é o sábado seguinte.
  const anterior = (await SS.createScale({
    date: '2026-11-14', tipo: 'sabado', name: 'Sábado 14/11',
    slots: [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana',
              startTime: '08:00', endTime: '12:00' }],
  }, d)).data;

  const seguinte = (await SS.createScale({
    date: '2026-11-21', tipo: 'sabado', name: 'Sábado 21/11',
    slots: [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null,
              startTime: '08:00', endTime: '12:00' }],
  }, d)).data;

  const todas = [Object.assign({ id: anterior.id }, anterior), Object.assign({ id: seguinte.id }, seguinte)];
  const ctx = {
    teachers: [
      { id: 'ana', name: 'Ana', modalityIds: ['TOI'], primaryUnitId: 'cp' },
      { id: 'bia', name: 'Bia', modalityIds: ['TOI'], primaryUnitId: 'cp' },
    ],
    meritoById: { ana: 100, bia: 0 },   // Ana ganharia no mérito
    opts: { minMes: 1 },
    scalesDoAno: todas,
  };

  await SS.consolidate(seguinte.id, ctx, d);
  const fim = (await SS.getScale(seguinte.id, d)).data;
  assert.strictEqual(fim.slots[0].assignedPersonId, 'bia',
    'Ana trabalhou no sábado anterior, então o seguinte foi pra Bia');

  passou('serviço enxerga o sábado vizinho e não repete a pessoa');
}
```

- [ ] **Step 9: Rodar e commitar**

Run: `node scripts/smoke-ajustes-escala-2508.js`
Expected: as duas asserções da seção 7 passando.

Bump: `scale-engine.js?v=20260825` em `professores.html`.

```bash
git add scale-engine.js scale-service.js professores-escala-smart.js professores.html scripts/smoke-ajustes-escala-2508.js
git commit -m "feat(escala): mesma pessoa nao pega dois sabados seguidos"
```

---

## Task 8: Suíte completa e homologação no staging

- [ ] **Step 1: Rodar a suíte inteira**

Run: `for f in scripts/smoke-*.js; do echo "== $f"; node "$f" || echo "FALHOU: $f"; done`
Expected: todos passando, exceto `smoke-9.js` (exige `--project`).

- [ ] **Step 2: Deploy no staging**

```bash
firebase deploy --only hosting --project staging
firebase deploy --only firestore:rules --project staging
```

- [ ] **Step 3: Conferir na tela do staging**

- Home do dono: "Precisam de você" sem chip de troca; linha "🔄 5 trocas aguardando o colega confirmar".
- Escala → Sábados → escala consolidada: botão **⇄ Inverter** entre os cards; clicar inverte os dois nomes.
- Equilíbrio do ciclo: os 3 blocos abrem com nomes; rodapé listando quem está fora do rodízio; ✏️ salva e a tela recarrega.
- Reconsolidar numa escala publicada: aparece a explicação; depois de confirmar, o toast diz "Agenda republicada".
- Pessoas → nova ficha: caixa "não recebe por aula" presente; ficha marcada não aparece no fechamento.

- [ ] **Step 4: Atualizar `CONTEXTO_SESSAO.md` e `CLAUDE.md`**

Registrar a sessão 55: os 6 ajustes, a exclusão das 4 aulas de 29/08 em produção e a pendência da regra de dias seguidos.

- [ ] **Step 5: Produção só depois do OK do Rafael**

Regra 7 do CLAUDE.md. Publicar pro usuário é `git push origin main` (GitHub Pages), não `firebase deploy --only hosting`.
Antes de `firebase deploy --only firestore:rules --project production`, rodar `node scripts/validate-rules-comissoes.js`.

---

## Decisões travadas com a gestão em 25/08

| Assunto | Decisão | Quem |
|---|---|---|
| Sábado 29/08 | Apagar as 4 aulas da grade antiga (**feito**, com backup) | Rafael |
| Rafael Rojais | Dá aula, entra na escala, **não recebe** — é sócio | Rafael |
| Will Souza | Recebe normalmente; **a gestão cadastra**, não eu | Rafael |
| Dias seguidos | Só entre **sábados** (sábado-feriado logo após sábado normal). Escola Interna e evento fora | Rafael |
| Vaga sem gente | Escala mesmo assim, teto macio — nunca deixar vaga aberta | Rafael |
| Contador de justiça | Só vale pra frente; agosto não se reprocessa, mas a gestão passa a poder corrigir na mão | Rafael |
