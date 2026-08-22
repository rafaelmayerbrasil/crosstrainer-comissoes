# Troca de professor da aula — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir corrigir quem deu a aula até o fechamento do mês, com registro por qualquer um dos dois professores, confirmação do outro lado e homologação da gestão.

**Architecture:** A máquina de estados sai para um módulo puro novo (`substitution-flow.js`, UMD como `scale-engine.js` e `professores-nav.js`), testável no Node. `SubstitutionService` (em `professores-shared.js`) passa a consultar esse módulo em vez de decidir sozinho; a Cloud Function que aplica a troca não muda de gatilho — ela só passa a receber `accepted` um degrau depois. Um estado novo, `aguardando_gestao`, entra entre o aceite do professor e a aplicação.

**Tech Stack:** JS vanilla (browser + Node para os testes), Firebase Firestore, Cloud Functions v2, `scripts/_fake-firestore.js` para os smokes.

**Spec:** [`docs/superpowers/specs/2026-08-21-troca-professor-aula-design.md`](../specs/2026-08-21-troca-professor-aula-design.md)

**Prazo:** agosto fecha em 03/09/2026. Precisa estar em produção antes.

**Fora do escopo de propósito:** o dia 3 é um combinado de operação, não uma regra automatizada. O sistema não vai fechar o mês sozinho nem cobrar a data — quem fecha continua sendo a gestão, quando ela quiser. O que o sistema passa a fazer é não deixar fechar por cima de troca pendente.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `substitution-flow.js` **(novo)** | Puro, sem Firebase: estados, transições, quem pode fazer o quê, rótulos, pendências que travam o fechamento |
| `scripts/smoke-troca-professor.js` **(novo)** | Comportamental sobre o módulo puro + estrutural sobre as telas |
| `professores-shared.js:1726-2095` | `SubstitutionService` delega ao módulo; métodos novos `homologar`/`recusarGestao`/`listAguardandoGestao`/`listPendingForUser` |
| `firestore.rules:173-182` | professor não escreve `accepted`; só gestão homologa |
| `functions/index.js:646-690` | avisar a gestão quando cair em `aguardando_gestao` |
| `professores-agenda.js` | botões novos no modal da aula, hint explicativo, fila de homologação na caixa de entrada |
| `professores-substituicoes.js:51-56` | rótulos dos estados novos + botão de homologar na visão de gestão |
| `professores-fechamento.js:440-467` | trava/aviso antes de fechar o mês |
| `professores.html:2998-3028` | carregar o módulo novo e subir os `?v=` |

**Campo novo no documento `substitutions`:** `registradoPor: 'titular' | 'substituto' | 'gestao'`. Pedido antigo, sem o campo, é lido como `'titular'` — que é como todos os existentes foram criados.

**Convenção mantida de propósito:** `requestingTeacherId` continua sendo **o dono da aula** e `substituteTeacherId` **quem cobre**, independentemente de quem registrou. A CF, o histórico e o `originalTeacherId` dependem disso.

---

### Task 1: Módulo puro da máquina de estados

**Files:**
- Create: `substitution-flow.js`
- Test: `scripts/smoke-troca-professor.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/smoke-troca-professor.js`:

```js
'use strict';
// Roda: node scripts/smoke-troca-professor.js
//
// "as aulas que já passaram eu não consigo fazer a troca" (Camila, 21/08/2026).
// Ela não era a titular da aula, e só o titular tinha o botão. A gestão também
// não tinha. Agora qualquer um dos dois lados registra, o outro confirma, e a
// gestão homologa — e só a homologação move a aula.

const assert = require('assert');
const SF = require('../substitution-flow.js');

(async () => {
  /* ── 1. Quem pode registrar ──────────────────────────────────────── */
  const aula = { teacherId: 'theo', status: 'realizada', monthClosingId: null };

  assert.strictEqual(SF.podeRegistrar(aula, { teacherId: 'theo' }).ok, true,
    'o titular registra que passou a aula');
  assert.strictEqual(SF.podeRegistrar(aula, { teacherId: 'camila' }).ok, true,
    'quem deu a aula registra que foi ela — o caso da Camila');
  assert.strictEqual(SF.podeRegistrar(aula, { teacherId: null, isGestao: true }).ok, true,
    'a gestão registra sem ser professora');
  assert.strictEqual(SF.podeRegistrar(aula, { teacherId: null }).ok, false,
    'quem não é professor nem gestão não registra');

  const fechada = { teacherId: 'theo', status: 'realizada', monthClosingId: 'fech1' };
  const rFechada = SF.podeRegistrar(fechada, { teacherId: 'theo' });
  assert.strictEqual(rFechada.ok, false, 'mês fechado barra');
  assert.ok(/fechad/i.test(rFechada.motivo), 'e diz que é por causa do mês fechado');

  const cancelada = { teacherId: 'theo', status: 'cancelada', monthClosingId: null };
  assert.strictEqual(SF.podeRegistrar(cancelada, { teacherId: 'theo' }).ok, false,
    'aula cancelada não tem quem trocar');

  const jaTrocada = { teacherId: 'thaynara', status: 'substituida', monthClosingId: null };
  assert.strictEqual(SF.podeRegistrar(jaTrocada, { teacherId: 'thaynara' }).ok, true,
    'aula já trocada uma vez aceita nova troca — errar o nome tinha que ter conserto');
  console.log('✓ quem pode registrar');

  /* ── 2. Quem confirma depende de quem registrou ──────────────────── */
  const doTitular = { requestingTeacherId: 'theo', substituteTeacherId: 'camila', registradoPor: 'titular' };
  const doSubstituto = { requestingTeacherId: 'theo', substituteTeacherId: 'camila', registradoPor: 'substituto' };
  assert.strictEqual(SF.quemConfirma(doTitular), 'camila', 'registrou o titular → confirma quem cobriu');
  assert.strictEqual(SF.quemConfirma(doSubstituto), 'theo', 'registrou quem cobriu → confirma o titular');
  assert.strictEqual(SF.quemConfirma({ requestingTeacherId: 'theo', substituteTeacherId: 'camila' }), 'camila',
    'pedido antigo sem o campo é lido como registrado pelo titular');
  console.log('✓ quem confirma');

  /* ── 3. As transições ────────────────────────────────────────────── */
  const t = (status, acao, ator) => SF.transicao({ status, ...doTitular }, acao, ator);

  let r = t('pending', 'confirmar', { teacherId: 'camila' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'aguardando_gestao', 'confirmar NÃO aceita — manda pra gestão');

  r = t('pending', 'confirmar', { teacherId: 'theo' });
  assert.strictEqual(r.ok, false, 'quem registrou não confirma o próprio pedido');

  r = t('aguardando_gestao', 'homologar', { isGestao: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'accepted', 'a gestão homologa e aí sim vira aceita');

  r = t('aguardando_gestao', 'homologar', { teacherId: 'camila' });
  assert.strictEqual(r.ok, false, 'professor não homologa — era a brecha das rules');

  r = t('pending', 'homologar', { isGestao: true });
  assert.strictEqual(r.ok, true, 'a gestão homologa mesmo sem a resposta do professor (o caso do afastado)');
  assert.strictEqual(r.status, 'accepted');
  assert.strictEqual(r.semConfirmacaoDoProfessor, true, 'e isso fica marcado');

  r = t('accepted', 'homologar', { isGestao: true });
  assert.strictEqual(r.ok, false, 'pedido já resolvido não se mexe');

  r = t('pending', 'recusar', { teacherId: 'camila' });
  assert.strictEqual(r.status, 'rejected', 'o outro lado pode recusar');

  r = t('aguardando_gestao', 'recusar', { isGestao: true });
  assert.strictEqual(r.status, 'rejected', 'a gestão pode recusar');

  r = t('pending', 'cancelar', { teacherId: 'theo' });
  assert.strictEqual(r.status, 'cancelled', 'quem registrou desiste');

  r = t('pending', 'cancelar', { teacherId: 'camila' });
  assert.strictEqual(r.ok, false, 'o outro lado não cancela — ele recusa');
  console.log('✓ transições');

  /* ── 3b. Pedido duplicado ────────────────────────────────────────── */
  // O Theo pediu a mesma troca duas vezes em 04/08 porque achou que não tinha
  // funcionado, e o sistema aceitou as duas.
  assert.strictEqual(SF.jaTemPedidoAberto([{ status: 'pending' }]), true,
    'já existe pedido esperando resposta');
  assert.strictEqual(SF.jaTemPedidoAberto([{ status: 'aguardando_gestao' }]), true,
    'já existe pedido esperando a gestão');
  assert.strictEqual(SF.jaTemPedidoAberto([{ status: 'rejected' }, { status: 'cancelled' }]), false,
    'pedido recusado ou cancelado não impede tentar de novo');
  assert.strictEqual(SF.jaTemPedidoAberto([]), false, 'aula sem pedido nenhum');
  console.log('✓ duplicata barrada');

  /* ── 4. Pendências no fechamento ─────────────────────────────────── */
  const p = SF.pendenciasDoFechamento([
    { id: 'a', status: 'aguardando_gestao' },
    { id: 'b', status: 'pending' },
    { id: 'c', status: 'accepted' },
    { id: 'd', status: 'rejected' },
  ]);
  assert.deepStrictEqual(p.travam.map(x => x.id), ['a'], 'o que espera a gestão trava o fechamento');
  assert.deepStrictEqual(p.avisam.map(x => x.id), ['b'], 'o que espera professor só avisa');
  console.log('✓ pendências do fechamento');

  console.log('\n✅ smoke-troca-professor: módulo puro OK');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: `Cannot find module '../substitution-flow.js'`.

- [ ] **Step 3: Escrever o módulo**

Criar `substitution-flow.js`:

```js
// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Máquina de estados da troca de professor da aula
// Puro (sem DOM, sem Firebase). Browser (window.SubstitutionFlow) e Node.
//
// Fluxo (grupo da gestão, 21/08/2026):
//   registro → confirmação do outro professor → homologação da gestão → aplica
//
// A aula só muda de dono no 'accepted'. É esse estado que a CF
// processSubstitutionAcceptance escuta — por isso ele continua se chamando
// assim, mesmo tendo virado o último degrau em vez do segundo.
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SubstitutionFlow = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STATUS = {
    PENDING:           'pending',
    AGUARDANDO_GESTAO: 'aguardando_gestao',
    ACCEPTED:          'accepted',
    REJECTED:          'rejected',
    CANCELLED:         'cancelled',
  };

  // Rótulos escritos para quem lê, não para quem programou. "Aceita" dizia que
  // acabou quando ainda faltava a gestão.
  const STATUS_LABEL = {
    pending:           'Aguardando o colega confirmar',
    aguardando_gestao: 'Aguardando a gestão',
    accepted:          'Confirmada',
    rejected:          'Recusada',
    cancelled:         'Cancelada',
  };

  const STATUS_ABERTO = [STATUS.PENDING, STATUS.AGUARDANDO_GESTAO];

  /** Status de aula que não tem troca a registrar. */
  const STATUS_AULA_SEM_TROCA = ['cancelada', 'nao_realizada'];

  /**
   * Quem pode registrar uma troca nesta aula.
   * @param {object} cls - { teacherId, status, monthClosingId }
   * @param {object} ator - { teacherId, isGestao }
   * @returns {{ok: boolean, motivo: string}}
   */
  function podeRegistrar(cls, ator) {
    ator = ator || {};
    if (!cls) return { ok: false, motivo: 'Aula não encontrada.' };
    if (cls.monthClosingId) {
      return { ok: false, motivo: 'O mês desta aula já foi fechado — nem a gestão altera depois disso.' };
    }
    if (STATUS_AULA_SEM_TROCA.indexOf(cls.status) !== -1) {
      return { ok: false, motivo: 'Esta aula não aconteceu, então não há troca de professor a registrar.' };
    }
    if (ator.isGestao) return { ok: true, motivo: '' };
    if (!ator.teacherId) {
      return { ok: false, motivo: 'Sua conta não está ligada a um cadastro de professor — fale com a gestão.' };
    }
    return { ok: true, motivo: '' };
  }

  /** Quem registrou o pedido. Pedido antigo, sem o campo, veio do titular. */
  function registradoPor(sub) {
    return (sub && sub.registradoPor) || 'titular';
  }

  /** teacherId de quem precisa confirmar — é sempre o lado que NÃO registrou. */
  function quemConfirma(sub) {
    if (!sub) return null;
    return registradoPor(sub) === 'substituto' ? sub.requestingTeacherId : sub.substituteTeacherId;
  }

  /** teacherId de quem registrou (e portanto pode cancelar). */
  function quemRegistrou(sub) {
    if (!sub) return null;
    return registradoPor(sub) === 'substituto' ? sub.substituteTeacherId : sub.requestingTeacherId;
  }

  /**
   * Calcula o próximo estado.
   * @param {object} sub - { status, requestingTeacherId, substituteTeacherId, registradoPor }
   * @param {'confirmar'|'homologar'|'recusar'|'cancelar'} acao
   * @param {object} ator - { teacherId, isGestao }
   * @returns {{ok: boolean, status?: string, semConfirmacaoDoProfessor?: boolean, erro?: string}}
   */
  function transicao(sub, acao, ator) {
    ator = ator || {};
    if (!sub) return { ok: false, erro: 'Pedido não encontrado.' };
    if (STATUS_ABERTO.indexOf(sub.status) === -1) {
      return { ok: false, erro: 'Este pedido já está como "' + (STATUS_LABEL[sub.status] || sub.status) + '".' };
    }

    if (acao === 'homologar') {
      if (!ator.isGestao) return { ok: false, erro: 'Só a gestão confirma a troca.' };
      return {
        ok: true,
        status: STATUS.ACCEPTED,
        // A gestão pode homologar antes do professor responder — é a saída para
        // férias, folga, desligamento e para quem simplesmente não abre o app.
        semConfirmacaoDoProfessor: sub.status === STATUS.PENDING,
      };
    }

    if (acao === 'confirmar') {
      if (sub.status !== STATUS.PENDING) {
        return { ok: false, erro: 'Este pedido já foi confirmado e está com a gestão.' };
      }
      if (ator.teacherId !== quemConfirma(sub)) {
        return { ok: false, erro: 'Quem tem que confirmar esta troca é o outro professor.' };
      }
      return { ok: true, status: STATUS.AGUARDANDO_GESTAO };
    }

    if (acao === 'recusar') {
      const podeRecusar = ator.isGestao || ator.teacherId === quemConfirma(sub);
      if (!podeRecusar) return { ok: false, erro: 'Só o outro professor ou a gestão pode recusar.' };
      return { ok: true, status: STATUS.REJECTED };
    }

    if (acao === 'cancelar') {
      if (ator.teacherId !== quemRegistrou(sub)) {
        return { ok: false, erro: 'Só quem registrou pode cancelar. Para discordar, recuse.' };
      }
      return { ok: true, status: STATUS.CANCELLED };
    }

    return { ok: false, erro: 'Ação desconhecida: ' + acao };
  }

  /**
   * Separa as trocas abertas de um mês para a tela de fechamento.
   * Trava o que depende da gestão (é ação dela, e passar reto paga o professor
   * errado). Só avisa o que depende de um professor responder — senão a folha
   * inteira fica refém de quem não abre o app.
   */
  function pendenciasDoFechamento(subs) {
    const lista = subs || [];
    return {
      travam: lista.filter(s => s.status === STATUS.AGUARDANDO_GESTAO),
      avisam: lista.filter(s => s.status === STATUS.PENDING),
    };
  }

  /** Já existe pedido em aberto para esta aula? Barra a duplicata. */
  function jaTemPedidoAberto(subsDaAula) {
    return (subsDaAula || []).some(s => STATUS_ABERTO.indexOf(s.status) !== -1);
  }

  /** Texto do porquê o botão de troca não aparece. */
  function motivoSemBotao(cls, ator) {
    const r = podeRegistrar(cls, ator);
    return r.ok ? '' : r.motivo;
  }

  return {
    STATUS, STATUS_LABEL, STATUS_ABERTO,
    podeRegistrar, registradoPor, quemConfirma, quemRegistrou,
    transicao, pendenciasDoFechamento, motivoSemBotao, jaTemPedidoAberto,
  };
});
```

- [ ] **Step 4: Rodar e ver passar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: as 5 linhas com `✓` e `✅ smoke-troca-professor: módulo puro OK`.

- [ ] **Step 5: Commit**

```bash
git add substitution-flow.js scripts/smoke-troca-professor.js
git commit -m "feat(agenda): maquina de estados da troca de professor da aula"
```

---

### Task 2: SubstitutionService usa o módulo

**Files:**
- Modify: `professores-shared.js:1726-1731` (rótulos), `:1853-1921` (`create`), `:1923-1990` (`accept`/`_respond`), `:2027-2095` (listagens)
- Test: `scripts/smoke-troca-professor.js` (bloco estrutural novo)

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-troca-professor.js`, antes do `console.log` final:

```js
  /* ── 5. A cola do navegador está ligada no módulo ────────────────── */
  const fs = require('fs');
  const path = require('path');
  const raiz = path.join(__dirname, '..');
  const shared = fs.readFileSync(path.join(raiz, 'professores-shared.js'), 'utf8');

  assert.ok(/SubstitutionFlow/.test(shared),
    'professores-shared.js precisa consultar o módulo em vez de decidir sozinho');
  assert.ok(/homologar\s*\(/.test(shared),
    'SubstitutionService precisa do método homologar');
  assert.ok(!/_respond\(subId,\s*'accepted'/.test(shared),
    'aceitar não pode mais mandar direto pra accepted — falta a gestão');
  assert.ok(/registradoPor/.test(shared),
    'o pedido precisa gravar de que lado veio');
  console.log('✓ professores-shared.js ligado no módulo');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: `AssertionError: professores-shared.js precisa consultar o módulo em vez de decidir sozinho`.

- [ ] **Step 3: Trocar os rótulos**

Em `professores-shared.js`, substituir o bloco da linha 1726:

```js
const SUBSTITUTION_STATUS_LABEL = {
  pending:   'Pendente',
  accepted:  'Aceita',
  rejected:  'Recusada',
  cancelled: 'Cancelada',
};
```

por:

```js
// Rótulos vêm do módulo puro — a tela e o serviço têm que contar a mesma história.
const SUBSTITUTION_STATUS_LABEL = SubstitutionFlow.STATUS_LABEL;
```

- [ ] **Step 4: `create` aceita o lado de quem cobriu e barra duplicata**

Em `professores-shared.js`, na função `create` (linha 1858), trocar a assinatura e o miolo até o `await ref.set(data);`:

```js
  /**
   * Registra uma troca de professor.
   * @param {object} p - { classId, substituteTeacherId, substituteUserId, reason,
   *                       registradoPor }
   *   registradoPor: 'titular' (o dono da aula passou), 'substituto' (quem deu a
   *   aula está registrando) ou 'gestao'.
   */
  async create({ classId, substituteTeacherId, substituteUserId, reason, registradoPor = 'titular' }) {
    if (!classId) return { success: false, error: 'classId obrigatório' };
    if (!substituteTeacherId) return { success: false, error: 'Escolha um substituto' };

    try {
      const classDoc = await db.collection('classes').doc(classId).get();
      if (!classDoc.exists) return { success: false, error: 'Aula não encontrada' };
      const cls = classDoc.data();

      // Uma pergunta só ao módulo, com tudo o que ele precisa pra decidir: mês
      // fechado, aula que não aconteceu, quem é o ator, pedido duplicado (o Theo
      // pediu a mesma troca duas vezes em 04/08 e o sistema aceitou as duas) e
      // troca pra quem já é o professor da aula.
      const doMesmo = await db.collection('substitutions').where('classId', '==', classId).get();
      const ator = { teacherId: getCurrentProfessorId(), isGestao: isAdminGestao() || isSupervisao() };
      const permitido = SubstitutionFlow.podeRegistrar(cls, ator, {
        subsDaAula: doMesmo.docs.map(d => d.data()),
        alvoTeacherId: substituteTeacherId,
      });
      if (!permitido.ok) return { success: false, error: permitido.motivo };

      const now = new Date();
      const aulaDate = cls.scheduledDate.toDate ? cls.scheduledDate.toDate() : new Date(cls.scheduledDate);
      const wasRetroactive = aulaDate < now;

      const ref = db.collection('substitutions').doc();
      const uid = currentUserId();
      const data = {
        classId,
        // snapshot da aula p/ mostrar data/hora/modalidade no inbox do substituto (sem novo fetch)
        classDate: cls.scheduledDate || null,
        classStartTime: cls.startTime || null,
        classEndTime: cls.endTime || null,
        classModalityId: cls.modalityId || null,
        // requesting é SEMPRE o dono da aula e substitute SEMPRE quem cobre,
        // não importa quem registrou: a CF, o histórico e o originalTeacherId
        // dependem disso.
        requestingTeacherId: cls.teacherId,
        requestingUserId: uid,
        substituteTeacherId,
        substituteUserId: substituteUserId || null,
        registradoPor,
        reason: (reason || '').toString().slice(0, 500),
        status: SubstitutionFlow.STATUS.PENDING,
        wasRetroactive,
        isOfficial: false,
        requestedAt: serverTs(),
        respondedAt: null,
        responseNote: null,
        homologadoPor: null,
        homologadoEm: null,
        semConfirmacaoDoProfessor: false,
        createdBy: uid,
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.set(data);
```

Logo abaixo, trocar o bloco da notificação (que hoje avisa sempre o substituto) por:

```js
      // Avisa o lado que precisa confirmar — que é o oposto de quem registrou.
      const confirmaTeacherId = SubstitutionFlow.quemConfirma(data);
      let confirmaUserId = confirmaTeacherId === substituteTeacherId ? (substituteUserId || null) : null;
      if (!confirmaUserId && confirmaTeacherId) {
        try {
          const us = await db.collection('users').where('professorId', '==', confirmaTeacherId).limit(1).get();
          if (!us.empty) confirmaUserId = us.docs[0].id;
        } catch (e) { /* sem login vinculado: a gestão resolve pela tela */ }
      }
      if (confirmaUserId) {
        await NotificationService.create({
          recipientUserId: confirmaUserId,
          type: 'substitution_requested',
          body: buildSubstitutionNotifBody(cls, registradoPor === 'substituto'
            ? 'Um colega registrou que deu esta aula'
            : 'Pedido de substituição'),
          link: { type: 'substitution', id: ref.id },
        });
      }
```

- [ ] **Step 5: `accept` vira `confirmar` e para em `aguardando_gestao`**

Substituir o bloco das linhas 1923-1929 e o miolo de `_respond`:

```js
  /** O outro professor confirma: NÃO aplica ainda — manda pra gestão. */
  async confirmar(subId, note = '') {
    return this._mover(subId, 'confirmar', note);
  },

  /** Compatibilidade com chamadas antigas da tela. */
  async accept(subId, note = '') {
    return this.confirmar(subId, note);
  },

  async reject(subId, note = '') {
    return this._mover(subId, 'recusar', note);
  },

  /** A gestão homologa — é aqui que a aula troca de dono (via CF). */
  async homologar(subId, note = '') {
    return this._mover(subId, 'homologar', note);
  },

  async recusarGestao(subId, note = '') {
    return this._mover(subId, 'recusar', note);
  },

  async _mover(subId, acao, note) {
    if (!subId) return { success: false, error: 'subId obrigatório' };
    try {
      const ref = db.collection('substitutions').doc(subId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Pedido não encontrado' };
      const before = beforeDoc.data();

      const ator = { teacherId: getCurrentProfessorId(), isGestao: isAdminGestao() || isSupervisao() };
      const t = SubstitutionFlow.transicao(before, acao, ator);
      if (!t.ok) return { success: false, error: t.erro };

      // A aula pode ter entrado em mês fechado depois do pedido.
      const clsDoc = await db.collection('classes').doc(before.classId).get();
      if (clsDoc.exists && clsDoc.data().monthClosingId) {
        return { success: false, error: 'O mês desta aula já foi fechado.' };
      }

      const uid = currentUserId();
      const newStatus = t.status;
      const after = {
        status: newStatus,
        respondedAt: serverTs(),
        responseNote: (note || '').toString().slice(0, 500) || null,
        isOfficial: newStatus === SubstitutionFlow.STATUS.ACCEPTED,
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      if (acao === 'homologar') {
        after.homologadoPor = uid;
        after.homologadoEm = serverTs();
        after.semConfirmacaoDoProfessor = !!t.semConfirmacaoDoProfessor;
        // Supervisor que também dá aula pode homologar troca da qual ele é parte.
        // Não bloqueia, mas fica distinguível de "o professor não respondeu".
        after.atorEhParte = !!t.atorEhParte;
      }
      await ref.update(after);

      await AuditService.log({
        type: `substitution_${newStatus}`,
        details: `Troca de professor: ${SUBSTITUTION_STATUS_LABEL[newStatus]}`
          + (t.semConfirmacaoDoProfessor ? ' (homologada sem a confirmação do professor)' : ''),
        entityType: 'substitution', entityId: subId,
        before, after: { ...before, ...after },
        module: 'agenda',
      });

      if (newStatus === SubstitutionFlow.STATUS.REJECTED) {
        const avisar = SubstitutionFlow.quemRegistrou(before) === before.substituteTeacherId
          ? before.substituteUserId : before.requestingUserId;
        if (avisar) {
          await NotificationService.create({
            recipientUserId: avisar,
            type: 'substitution_rejected',
            body: 'Sua troca de professor foi recusada.' + (note ? ' Motivo: ' + note : ''),
            link: { type: 'substitution', id: subId },
          });
        }
      }

      // Engajamento (5c): cobrir colega vale ponto de proatividade — só quando a
      // troca vale de verdade, ou seja, depois da gestão homologar.
      if (newStatus === SubstitutionFlow.STATUS.ACCEPTED && before.substituteTeacherId && typeof EngagementService === 'object') {
        try {
          let dateISO = new Date().toISOString().slice(0, 10);
          const sd = clsDoc.exists ? clsDoc.data().scheduledDate : null;
          if (sd) { const d = sd.toDate ? sd.toDate() : new Date(sd); dateISO = d.toISOString().slice(0, 10); }
          await EngagementService.awardSubstitution(subId, before.substituteTeacherId, dateISO);
        } catch (e) { console.error('[proatividade/substituicao]', e); }
      }
      return { success: true, semConfirmacaoDoProfessor: !!t.semConfirmacaoDoProfessor };
    } catch (err) {
      console.error('[SubstitutionService._mover]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
```

Apagar a função `_respond` antiga inteira (linhas 1931-1986 do arquivo original).

- [ ] **Step 6: Listagens novas**

Depois de `listAllPending` (linha ~2085), acrescentar:

```js
  /** Trocas esperando a homologação da gestão. */
  async listAguardandoGestao() {
    try {
      const snap = await db.collection('substitutions')
        .where('status', '==', SubstitutionFlow.STATUS.AGUARDANDO_GESTAO)
        .orderBy('requestedAt', 'desc')
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[SubstitutionService.listAguardandoGestao]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Pedidos esperando ESTE professor confirmar. Duas queries porque ele pode ser
   * o lado que cobre (registro do titular) ou o dono da aula (registro de quem
   * cobriu) — e o Firestore não faz OU. Busca por teacherId, não userId: quem
   * não tem login vinculado sumia da lista. [[fix-substituicao-orfa]]
   */
  async listPendingForUser(teacherId) {
    if (!teacherId) return { success: true, data: [] };
    try {
      const [comoSub, comoTitular] = await Promise.all([
        db.collection('substitutions').where('substituteTeacherId', '==', teacherId)
          .where('status', '==', SubstitutionFlow.STATUS.PENDING).get(),
        db.collection('substitutions').where('requestingTeacherId', '==', teacherId)
          .where('status', '==', SubstitutionFlow.STATUS.PENDING).get(),
      ]);
      const todos = comoSub.docs.concat(comoTitular.docs).map(d => ({ id: d.id, ...d.data() }));
      const meus = todos.filter(s => SubstitutionFlow.quemConfirma(s) === teacherId);
      return { success: true, data: sortSubstitutions(meus) };
    } catch (err) {
      console.error('[SubstitutionService.listPendingForUser]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /** Trocas abertas de um período — usado pelo fechamento. */
  async listAbertasNoPeriodo(from, to) {
    try {
      const snap = await db.collection('substitutions')
        .where('classDate', '>=', from).where('classDate', '<=', to).get();
      const abertas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(s => SubstitutionFlow.STATUS_ABERTO.indexOf(s.status) !== -1);
      return { success: true, data: abertas };
    } catch (err) {
      console.error('[SubstitutionService.listAbertasNoPeriodo]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
```

- [ ] **Step 7: Carregar o módulo na página**

Em `professores.html`, inserir na linha 2999 (antes de `class-propagation.js`):

```html
  <script src="substitution-flow.js?v=20260821"></script>
```

e trocar a linha 3001 para `professores-shared.js?v=20260821`.

- [ ] **Step 8: Rodar e ver passar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: os 6 `✓`.

- [ ] **Step 9: Commit**

```bash
git add professores-shared.js professores.html scripts/smoke-troca-professor.js
git commit -m "feat(agenda): troca de professor passa pela gestao antes de valer"
```

---

### Task 3: Fechar a brecha nas Security Rules

**Files:**
- Modify: `firestore.rules:173-182`
- Test: `scripts/smoke-troca-professor.js` (bloco estrutural)

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `scripts/smoke-troca-professor.js`:

```js
  /* ── 6. Professor não homologa a própria troca ───────────────────── */
  const rules = fs.readFileSync(path.join(raiz, 'firestore.rules'), 'utf8');
  const blocoSub = rules.slice(rules.indexOf('match /substitutions/'),
                              rules.indexOf('match /coverage_applications/'));
  assert.ok(/aguardando_gestao/.test(blocoSub),
    'a regra precisa conhecer o estado intermediário');
  assert.ok(/request\.resource\.data\.status\s*!=\s*'accepted'/.test(blocoSub),
    'professor não pode escrever accepted — senão homologa a si mesmo pelo console e move a hora paga');
  console.log('✓ rules de substitutions apertadas');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: `AssertionError: a regra precisa conhecer o estado intermediário`.

- [ ] **Step 3: Reescrever a regra**

Em `firestore.rules`, substituir o bloco das linhas 173-182:

```
    match /substitutions/{id} {
      allow read:   if isAuth() && hasProfModule();
      allow create: if isAuth() && hasProfModule();
      // A troca só vale quando a gestão homologa (status 'accepted'), porque é
      // esse status que a CF processSubstitutionAcceptance usa pra mover a aula
      // — e com ela a hora paga. Antes, qualquer um dos dois professores
      // envolvidos escrevia 'accepted' direto pelo console do navegador.
      allow update: if isAuth() && (
                      isAdmin() || isSuperv() ||
                      (
                        (resource.data.requestingUserId == request.auth.uid ||
                         resource.data.substituteUserId == request.auth.uid) &&
                        request.resource.data.status != 'accepted' &&
                        resource.data.status in ['pending', 'aguardando_gestao']
                      )
                    );
      allow delete: if false;
    }
```

- [ ] **Step 4: Rodar e ver passar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: os 7 `✓`.

- [ ] **Step 5: Validar que as regras de Comissões continuam vivas**

```bash
node scripts/validate-rules-comissoes.js
```

Esperado: sem erro. (O deploy do módulo de Professores em 17/07 já comeu o ruleset de Comissões uma vez — [[rules-comissoes-orfas]].)

- [ ] **Step 6: Commit**

```bash
git add firestore.rules scripts/smoke-troca-professor.js
git commit -m "fix(seguranca): professor nao homologa a propria troca de aula"
```

---

### Task 4: Avisar a gestão quando a troca chega nela

**Files:**
- Modify: `functions/index.js:646-690`

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-troca-professor.js`:

```js
  /* ── 7. A gestão é avisada pelo servidor ─────────────────────────── */
  const cf = fs.readFileSync(path.join(raiz, 'functions/index.js'), 'utf8');
  assert.ok(/aguardando_gestao/.test(cf),
    'a CF precisa reagir ao estado que espera a gestão');
  assert.ok(/listAdminUserIds\(\)[\s\S]{0,900}substitution_aguardando_gestao/.test(cf),
    'o aviso pra gestão tem que sair do servidor: o professor não pode varrer /users (foi o que quebrou o pedido de férias)');
  console.log('✓ CF avisa a gestão');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: `AssertionError: a CF precisa reagir ao estado que espera a gestão`.

- [ ] **Step 3: Estender a Cloud Function**

Em `functions/index.js`, substituir as linhas 650-657 (o início do handler `processSubstitutionAcceptance`):

```js
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after) return;
  if (before.status === after.status) return;

  const subId = event.params.subId;

  // Degrau novo (21/08/2026): os dois professores concordaram, falta a gestão.
  // O aviso sai daqui porque o navegador do professor não pode varrer /users —
  // foi exatamente isso que engoliu os pedidos de férias em agosto.
  if (after.status === 'aguardando_gestao') {
    try {
      const admins = await listAdminUserIds();
      for (const userId of admins) {
        await createNotification({
          recipientUserId: userId,
          type: 'substitution_aguardando_gestao',
          body: 'Uma troca de professor foi confirmada pelos dois e espera você. Confirme em Substituições.',
          link: { type: 'substitution', id: subId },
        });
      }
      logger.info('[processSubstitutionAcceptance] Gestão avisada', admins.length, subId);
    } catch (err) {
      // Não relança: o pedido está gravado e vale. Falhar aqui só perde o aviso.
      logger.error('[processSubstitutionAcceptance] FALHA ao avisar gestão', subId, err);
    }
    return;
  }

  if (after.status !== 'accepted') return;

  logger.info('[processSubstitutionAcceptance] Processing accepted sub', subId);
```

Depois, dentro do `try` que aplica a troca, trocar o `adjustmentNote` para registrar a homologação sem resposta do professor:

```js
        adjustmentNote: after.semConfirmacaoDoProfessor
          ? `Troca confirmada pela gestão sem a resposta do professor (sub:${subId})`
          : `Troca confirmada pela gestão (sub:${subId})`,
```

E trocar o bloco da notificação final (linhas ~677-686) por:

```js
    // Avisa os dois lados: quem registrou e quem confirmou.
    const avisados = [after.requestingUserId, after.substituteUserId].filter(Boolean);
    for (const userId of new Set(avisados)) {
      await createNotification({
        recipientUserId: userId,
        type: 'substitution_accepted',
        body: 'A troca de professor foi confirmada pela gestão. A aula já está no nome certo.',
        link: { type: 'class', id: after.classId },
      });
    }
```

- [ ] **Step 4: Registrar o ícone da notificação nova**

Em `professores-shared.js`, no mapa `NOTIF_TYPE_META`, acrescentar a entrada junto das outras de substituição:

```js
  substitution_aguardando_gestao: { icon: '⏳', title: 'Troca esperando você' },
```

- [ ] **Step 5: Rodar e ver passar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: os 8 `✓`.

- [ ] **Step 6: Commit**

```bash
git add functions/index.js professores-shared.js scripts/smoke-troca-professor.js
git commit -m "feat(agenda): gestao e avisada quando a troca chega nela"
```

---

### Task 5: Os botões no modal da aula

**Files:**
- Modify: `professores-agenda.js:1912-1918` (`classModalCanRequestSub`), `:1922-1950` (`injectClassModalActions`), `:1338-1350` (o hint), `:1955-2040` (modal de substituição)

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-troca-professor.js`:

```js
  /* ── 8. A tela oferece o caminho e explica quando não oferece ────── */
  const agenda = fs.readFileSync(path.join(raiz, 'professores-agenda.js'), 'utf8');
  assert.ok(/Fui eu que dei essa aula/.test(agenda),
    'quem cobriu precisa de um botão pra registrar');
  assert.ok(/Trocar professor/.test(agenda),
    'a gestão precisa trocar direto — era o buraco do print da Camila');
  assert.ok(/SubstitutionFlow\.motivoSemBotao/.test(agenda),
    'sem botão, a tela tem que dizer por quê, não só "fale com a gestão"');
  assert.ok(!/cls\.status === 'substituida'\) return false/.test(agenda),
    'aula já trocada tem que aceitar nova troca');
  console.log('✓ modal da aula');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: `AssertionError: quem cobriu precisa de um botão pra registrar`.

- [ ] **Step 3: Trocar a regra do botão**

Em `professores-agenda.js`, substituir a função das linhas 1912-1918:

```js
// Quem pode registrar troca nesta aula. A regra mora no módulo puro — a tela só
// pergunta. Antes exigia ser o titular, e por isso a Camila, que deu a aula do
// Theo, não tinha botão nenhum (21/08/2026).
function classModalCanRequestSub(cls) {
  return SubstitutionFlow.podeRegistrar(cls, {
    teacherId: getCurrentProfessorId(),
    isGestao: isAdminGestao() || isSupervisao(),
  }).ok;
}

/** É a aula do próprio professor logado? Decide qual botão mostrar. */
function classModalSouTitular(cls) {
  const myProfId = getCurrentProfessorId();
  return !!myProfId && cls.teacherId === myProfId;
}
```

- [ ] **Step 4: Trocar os botões injetados**

Substituir o corpo do `if (classModalCanRequestSub(cls)) { … }` em `injectClassModalActions` (linhas 1928-1949):

```js
  if (classModalCanRequestSub(cls)) {
    const ehGestao = isAdminGestao() || isSupervisao();
    const souTitular = classModalSouTitular(cls);
    const botoes = [];

    if (ehGestao) {
      botoes.push(['⇄ Trocar professor', () => openSubstitutionModal(cls.id, 'gestao')]);
    } else if (souTitular) {
      botoes.push(['🔄 Pedir substituição', () => openSubstitutionModal(cls.id, 'titular')]);
      botoes.push(['🆘 Pedir cobertura aberta', () => openCoverageModal(cls.id)]);
    } else {
      botoes.push(['✋ Fui eu que dei essa aula', () => openSubstitutionModal(cls.id, 'substituto')]);
    }

    const saveBtn = document.getElementById('classSaveBtn');
    botoes.forEach(([texto, acao]) => {
      const b = document.createElement('button');
      b.className = 'btn btn-outline';
      b.setAttribute('data-sprint-3b', 'true');
      b.textContent = texto;
      b.onclick = acao;
      if (saveBtn) footer.insertBefore(b, saveBtn); else footer.appendChild(b);
    });
  }
```

- [ ] **Step 5: O hint passa a explicar**

Em `professores-agenda.js`, substituir o bloco das linhas 1338-1350:

```js
  const noteHint = document.getElementById('classModalReadOnlyHint');
  if (noteHint) {
    // "Para alterar o status, fale com a gestão" era tudo o que a Camila via numa
    // aula que ela própria tinha dado. Agora, quando não há botão, a tela diz o
    // motivo real; quando há, ela não diz nada e o botão fala por si.
    const motivo = SubstitutionFlow.motivoSemBotao(cls, {
      teacherId: getCurrentProfessorId(),
      isGestao: canEdit,
    });
    if (canEdit && isLocked) {
      noteHint.textContent = 'Esta aula está em mês fechado. Nada mais pode ser alterado.';
      noteHint.style.display = '';
    } else if (motivo) {
      noteHint.textContent = motivo;
      noteHint.style.display = '';
    } else if (!canEdit && !classModalSouTitular(cls)) {
      noteHint.textContent = 'Esta aula está no nome de outro professor. Se quem deu foi você, use o botão abaixo — o titular e a gestão confirmam depois.';
      noteHint.style.display = '';
    } else if (!canEdit) {
      noteHint.textContent = 'Para alterar o status, fale com a gestão.';
      noteHint.style.display = '';
    } else {
      noteHint.style.display = 'none';
    }
  }
```

- [ ] **Step 6: O modal muda conforme o lado**

Substituir `openSubstitutionModal` (linhas 1957-1991):

```js
const SubstitutionFormState = { classId: null, lado: 'titular' };

/**
 * @param {string} classId
 * @param {'titular'|'substituto'|'gestao'} lado - quem está registrando
 */
function openSubstitutionModal(classId, lado = 'titular') {
  closeClassModal();

  const cls = findClassAnywhere(classId);
  if (!cls) { toast('Aula não encontrada.', 'error'); return; }
  SubstitutionFormState.classId = classId;
  SubstitutionFormState.lado = lado;

  const aulaDate = cls.scheduledDate.toDate ? cls.scheduledDate.toDate() : new Date(cls.scheduledDate);
  const isPast = aulaDate < new Date();
  const titular = AgendaState.teachersMap.get(cls.teacherId);
  const meuProfId = getCurrentProfessorId();

  const modal = document.getElementById('substitutionModal');
  if (!modal) return;
  const titulo = lado === 'substituto'
    ? `Fui eu que dei esta aula — ${ProfHelpers.formatDateBR(cls.scheduledDate)}`
    : lado === 'gestao'
      ? `Trocar professor — ${ProfHelpers.formatDateBR(cls.scheduledDate)}`
      : `Pedir substituição — ${ProfHelpers.formatDateBR(cls.scheduledDate)}`;
  document.getElementById('substitutionModalTitle').textContent = titulo;
  document.getElementById('substitutionModalError').textContent = '';
  document.getElementById('substitutionRetroactiveBox').style.display = isPast ? '' : 'none';

  const sel = document.getElementById('substituteSelect');
  const label = document.getElementById('substituteSelectLabel');

  if (lado === 'substituto') {
    // Quem registra JÁ é o professor da aula — não há o que escolher.
    if (label) label.textContent = 'Quem deu a aula';
    sel.innerHTML = `<option value="${escapeHtml(meuProfId)}" selected>Você (no lugar de ${escapeHtml(titular ? titular.name : '—')})</option>`;
    sel.disabled = true;
  } else {
    if (label) label.textContent = lado === 'gestao' ? 'Quem deu a aula de verdade' : 'Quem vai cobrir';
    sel.disabled = false;
    // Modalidade filtra quem PODE assumir uma aula futura. Para registrar um fato
    // já acontecido, a gestão vê todo mundo — senão a correção fica impossível
    // quando quem cobriu não tinha a modalidade no cadastro.
    const todos = Array.from(AgendaState.teachersMap.values())
      .filter(t => t.isActive !== false)
      .filter(t => t.id !== cls.teacherId);
    const eligible = lado === 'gestao'
      ? todos
      : todos.filter(t => Array.isArray(t.modalityIds) && t.modalityIds.includes(cls.modalityId));
    sel.innerHTML = eligible.length === 0
      ? '<option value="" disabled selected>Nenhum professor habilitado nesta modalidade</option>'
      : ['<option value="">— escolha —</option>'].concat(
          eligible.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} · ${escapeHtml(t.type || '')}</option>`)
        ).join('');
  }

  document.getElementById('substitutionReason').value = '';
  const btn = document.getElementById('substitutionSaveBtn');
  if (btn) btn.textContent = lado === 'gestao' ? 'Trocar e confirmar' : 'Enviar para confirmação';
  modal.classList.add('open');
}
```

- [ ] **Step 7: `saveSubstitution` manda o lado**

Em `saveSubstitution` (linha ~2010), trocar a chamada ao serviço e o toast final:

```js
  const res = await SubstitutionService.create({
    classId, substituteTeacherId, substituteUserId, reason,
    registradoPor: SubstitutionFormState.lado,
  });

  btn.disabled = false;
  btn.textContent = SubstitutionFormState.lado === 'gestao' ? 'Trocar e confirmar' : 'Enviar para confirmação';

  if (!res.success) { errEl.textContent = res.error; return; }

  // A gestão registrando já cumpriu o degrau dela: homologa na sequência.
  if (SubstitutionFormState.lado === 'gestao' && res.data && res.data.id) {
    const hom = await SubstitutionService.homologar(res.data.id, reason);
    if (!hom.success) { errEl.textContent = hom.error; return; }
    toast('Professor trocado. Os dois foram avisados.', 'success');
  } else if (!substituteUserId) {
    toast('Registrado. O outro professor ainda não tem login vinculado — a gestão confirma pela tela.', 'info', 6000);
  } else {
    toast('Registrado. Agora o outro professor confirma, e depois a gestão.', 'success', 5000);
  }
  closeSubstitutionModal();
```

- [ ] **Step 8: A caixa de entrada da gestão ganha a fila**

Em `loadInboxData` (linha ~2136), trocar as duas linhas que carregam `InboxState.subs`:

```js
  InboxState.isMgmtView = isAdminGestao() || isSupervisao();
  const subsRes = InboxState.isMgmtView
    ? await SubstitutionService.listAguardandoGestao()
    : await SubstitutionService.listPendingForUser(myProfId);
  InboxState.subs = subsRes.success ? subsRes.data : [];
```

Em `renderInboxSubItem` (linha ~2196), trocar o cabeçalho e os botões:

```js
function renderInboxSubItem(s) {
  const dono = AgendaState.teachersMap.get(s.requestingTeacherId);
  const cobriu = AgendaState.teachersMap.get(s.substituteTeacherId);
  const retro = s.wasRetroactive ? '<span class="badge-retro">retroativo</span>' : '';
  const titulo = InboxState.isMgmtView
    ? `⏳ ${escapeHtml(cobriu ? cobriu.name : '—')} deu a aula de ${escapeHtml(dono ? dono.name : '—')}`
    : `🔄 Troca de professor · aula de ${escapeHtml(dono ? dono.name : '—')}`;
  const acoes = InboxState.isMgmtView
    ? `<button class="btn btn-outline btn-sm" onclick="handleSubReject('${s.id}')">Recusar</button>
       <button class="btn btn-primary btn-sm" onclick="handleSubHomologar('${s.id}')">Confirmar troca</button>`
    : `<button class="btn btn-outline btn-sm" onclick="handleSubReject('${s.id}')">Não fui eu</button>
       <button class="btn btn-primary btn-sm" onclick="handleSubAccept('${s.id}')">Confirmar</button>`;
  return `
    <div class="inbox-item">
      <div class="inbox-item-header">
        <span class="inbox-item-title">${titulo}</span>
        ${retro}
      </div>
      <div class="inbox-item-body">${escapeHtml(s.reason || '(sem motivo informado)')}</div>
      <div class="inbox-item-meta">${formatReqWhen(s)}</div>
      <div class="inbox-item-actions">${acoes}</div>
    </div>
  `;
}
```

E trocar `handleSubAccept`, acrescentando o irmão dela:

```js
async function handleSubAccept(subId) {
  const note = prompt('Quer deixar alguma observação? (opcional)') || '';
  const res = await SubstitutionService.confirmar(subId, note);
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Confirmado. Agora falta a gestão dar o OK.', 'success', 5000);
  await loadInboxData();
  await refreshNotifBell();
}

async function handleSubHomologar(subId) {
  if (!confirm('Confirmar a troca? A aula passa para o outro professor e o pagamento acompanha.')) return;
  const res = await SubstitutionService.homologar(subId, '');
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Troca confirmada. A aula já está no nome certo.', 'success');
  await loadInboxData();
  await refreshNotifBell();
}
```

- [ ] **Step 9: O `<label>` do select precisa de id**

Em `professores.html`, no `substitutionModal`, dar id ao label do select de substituto:

```html
        <label class="form-label" id="substituteSelectLabel" for="substituteSelect">Quem vai cobrir</label>
```

- [ ] **Step 10: Rodar e ver passar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: os 9 `✓`.

- [ ] **Step 11: Commit**

```bash
git add professores-agenda.js professores.html scripts/smoke-troca-professor.js
git commit -m "feat(agenda): quem deu a aula registra, e a gestao troca direto"
```

---

### Task 6: A tela Substituições conta o caminho inteiro

**Files:**
- Modify: `professores-substituicoes.js:51-56` (rótulos), `:145-180` (card)

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-troca-professor.js`:

```js
  /* ── 9. A tela de Substituições mostra o degrau da gestão ────────── */
  const tela = fs.readFileSync(path.join(raiz, 'professores-substituicoes.js'), 'utf8');
  assert.ok(/aguardando_gestao/.test(tela),
    'o estado novo precisa aparecer na tela, senão some do histórico');
  assert.ok(/handleSubHomologar|subsHomologar/.test(tela),
    'a gestão homologa na tela onde ela já vê tudo');
  console.log('✓ tela de Substituições');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: `AssertionError: o estado novo precisa aparecer na tela, senão some do histórico`.

- [ ] **Step 3: Rótulos**

Em `professores-substituicoes.js`, substituir o bloco das linhas 51-56:

```js
const SUBS_STATUS_STYLE = {
  pending:           { label: 'Aguardando o colega confirmar', cor: 'var(--orange)' },
  aguardando_gestao: { label: 'Aguardando a gestão',           cor: 'var(--orange)' },
  accepted:          { label: 'Confirmada',                    cor: 'var(--green)' },
  rejected:          { label: 'Recusada',                      cor: 'var(--red)' },
  cancelled:         { label: 'Cancelada',                     cor: 'var(--text3)' },
};
```

- [ ] **Step 4: Botão de homologar no card da gestão**

Em `professores-substituicoes.js`, dentro da função que monta o card (linha ~151, onde usa `SUBS_STATUS_STYLE`), acrescentar depois do badge de status:

```js
      ${subsEhGestao() && sub.status === 'aguardando_gestao' ? `
      <div class="inbox-item-actions" style="margin-top:8px;">
        <button class="btn btn-outline btn-sm" onclick="subsRecusar('${sub.id}')">Recusar</button>
        <button class="btn btn-primary btn-sm" onclick="subsHomologar('${sub.id}')">Confirmar troca</button>
      </div>` : ''}
      ${sub.semConfirmacaoDoProfessor ? '<div class="info-field-hint">Confirmada pela gestão sem a resposta do professor.</div>' : ''}
```

E no fim do arquivo, antes do `console.log` de carregamento:

```js
async function subsHomologar(subId) {
  if (!confirm('Confirmar a troca? A aula passa para o outro professor e o pagamento acompanha.')) return;
  const res = await SubstitutionService.homologar(subId, '');
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Troca confirmada.', 'success');
  await renderSubstituicoesPage();
}

async function subsRecusar(subId) {
  const motivo = prompt('Motivo da recusa (opcional):') || '';
  const res = await SubstitutionService.recusarGestao(subId, motivo);
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Troca recusada.', 'info');
  await renderSubstituicoesPage();
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: os 10 `✓`.

- [ ] **Step 6: Commit**

```bash
git add professores-substituicoes.js scripts/smoke-troca-professor.js
git commit -m "feat(agenda): tela de substituicoes mostra e resolve o degrau da gestao"
```

---

### Task 7: O fechamento não passa por cima de troca pendente

**Files:**
- Modify: `professores-fechamento.js:440-467` (`showCloseConfirmModal`)

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-troca-professor.js`:

```js
  /* ── 10. O fechamento olha as trocas em aberto ───────────────────── */
  const fech = fs.readFileSync(path.join(raiz, 'professores-fechamento.js'), 'utf8');
  assert.ok(/pendenciasDoFechamento/.test(fech),
    'antes de fechar, o mês precisa olhar as trocas em aberto — depois não tem conserto');
  assert.ok(/listAbertasNoPeriodo/.test(fech),
    'e buscá-las pelo período do fechamento');
  console.log('✓ fechamento protegido');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: `AssertionError: antes de fechar, o mês precisa olhar as trocas em aberto`.

- [ ] **Step 3: Checar as pendências antes de confirmar**

Em `professores-fechamento.js`, transformar `showCloseConfirmModal` em `async` e acrescentar o bloco antes de montar o corpo do modal:

```js
async function showCloseConfirmModal() {
  const modal = document.getElementById('closeMonthConfirmModal');
  if (!modal) return;

  const monthName = MONTH_NAMES[FechamentoState.selectedMonth - 1];
  const data = FechamentoState.previewData;
  const classCount = data ? data.totals.classesRealizadas : 0;

  // Troca pendente vira pagamento errado que ninguém desfaz: fechar é
  // irreversível. O que espera a GESTÃO trava — é ação dela. O que espera um
  // professor responder só avisa, senão a folha fica refém de quem não abre o app.
  const y = FechamentoState.selectedYear;
  const m = FechamentoState.selectedMonth;
  const de = new Date(Date.UTC(y, m - 1, 1, 3, 0, 0));
  const ate = new Date(Date.UTC(y, m, 0, 26, 59, 59));
  const abertasRes = await SubstitutionService.listAbertasNoPeriodo(de, ate);
  const p = SubstitutionFlow.pendenciasDoFechamento(abertasRes.success ? abertasRes.data : []);

  // A tela de fechamento nunca carregou AgendaState — busca os nomes aqui.
  const profsRes = await TeacherService.list();
  const nomes = new Map((profsRes.success ? profsRes.data : []).map(t => [t.id, t.name]));
  const nomeProf = id => nomes.get(id) || '—';
  const linhaTroca = s => `<li>${escapeHtml(nomeProf(s.substituteTeacherId))} deu a aula de ${
    escapeHtml(nomeProf(s.requestingTeacherId))}${s.classDate && s.classDate.toDate
      ? ' em ' + s.classDate.toDate().toLocaleDateString('pt-BR') : ''}</li>`;

  const bloqueio = p.travam.length > 0 ? `
    <div class="info-callout is-error" style="margin-bottom:12px;">
      <p><strong>⛔ ${p.travam.length} troca(s) esperando você confirmar</strong></p>
      <p>Confirme ou recuse em <strong>Substituições</strong> antes de fechar — depois de fechado o mês, a aula não muda mais de nome.</p>
      <ul style="margin-top:8px;">${p.travam.map(linhaTroca).join('')}</ul>
    </div>` : '';

  const alerta = p.avisam.length > 0 ? `
    <div class="info-callout" style="margin-bottom:12px;">
      <p><strong>⚠️ ${p.avisam.length} troca(s) esperando um professor confirmar</strong></p>
      <p>Se fechar assim, essas aulas ficam no nome de quem está hoje.</p>
      <ul style="margin-top:8px;">${p.avisam.map(linhaTroca).join('')}</ul>
    </div>` : '';

  document.getElementById('closeMonthConfirmBody').innerHTML = `
    ${bloqueio}
    ${alerta}
    <div class="info-callout" style="margin-bottom:12px;">
      <p><strong>⚠️ Atenção</strong></p>
      <p>Você está prestes a <strong>fechar ${monthName}/${FechamentoState.selectedYear}</strong>.</p>
      <p style="margin-top:8px;">
        <strong>${classCount} aulas</strong> serão congeladas e não poderão mais ser alteradas.
        Esta operação é <strong>irreversível</strong> nesta versão.
      </p>
    </div>
    <p style="font-size:13px;color:var(--text2);">Confirma o fechamento deste período?</p>
  `;

  document.getElementById('closeMonthConfirmError').textContent = '';
  const btn = document.getElementById('closeMonthConfirmBtn');
  if (btn) {
    btn.disabled = p.travam.length > 0;
    btn.textContent = p.travam.length > 0 ? 'Resolva as trocas primeiro' : 'Confirmar fechamento';
  }

  modal.classList.add('open');
}
```

- [ ] **Step 4: Conferir que só existe um chamador**

```bash
grep -n "showCloseConfirmModal" professores-fechamento.js professores.html
```

Esperado: duas linhas — o `onclick` em `professores-fechamento.js:278` e a própria definição. Nada a mudar: `onclick` chama função `async` sem problema, a promessa se resolve sozinha e o modal abre quando os dados chegam. Se aparecer um terceiro chamador, ele precisa de `await`.

- [ ] **Step 5: Rodar e ver passar**

```bash
node scripts/smoke-troca-professor.js
```

Esperado: os 11 `✓`.

- [ ] **Step 6: Commit**

```bash
git add professores-fechamento.js scripts/smoke-troca-professor.js
git commit -m "feat(fechamento): troca pendente da gestao trava o fechamento do mes"
```

---

### Task 8: Suíte, cache e staging

**Files:**
- Modify: `professores.html:2998-3028` (os `?v=`)

- [ ] **Step 1: Subir os `?v=` dos arquivos tocados**

Em `professores.html`:

```
professores-shared.js?v=20260821
professores-agenda.js?v=20260821
professores-substituicoes.js?v=20260821
professores-fechamento.js?v=20260821
substitution-flow.js?v=20260821
```

Sem isso o navegador serve o arquivo velho e a mudança não aparece — a lição já custou uma sessão ([[agenda-geral-proposta-rodrigo]]).

- [ ] **Step 2: Rodar a suíte inteira**

```bash
for f in scripts/smoke-*.js; do echo "── $f"; node "$f" || echo "FALHOU: $f"; done
```

Esperado: tudo passando menos `smoke-9.js`, que exige `--project`.

- [ ] **Step 3: Deploy no staging**

```bash
firebase deploy --only firestore:rules,functions,hosting --project staging
```

Esperado: rules, as functions e o hosting publicados sem erro.

- [ ] **Step 4: Roteiro de homologação no staging**

Com as contas de demo (senha `crosstainer2026`):

1. `professor2.teste@` (Bruna) abre uma aula do Marcos já passada → aparece **"✋ Fui eu que dei essa aula"**; registra.
2. `professor.teste@` (Marcos) vê na caixa **"Troca de professor"** → **Confirmar**; a agenda dele **não muda** ainda.
3. `dono.teste@` recebe o aviso, abre **Substituições** → **Confirmar troca**; a aula passa para a Bruna e os dois são avisados.
4. `dono.teste@` abre outra aula → **"⇄ Trocar professor"**, escolhe alguém, salva → troca na hora.
5. Registrar uma troca e, sem ninguém confirmar, tentar fechar o mês → o botão fica **"Resolva as trocas primeiro"** se estiver esperando a gestão, e só avisa se estiver esperando o professor.
6. Console do navegador logado como professor: tentar `db.collection('substitutions').doc(ID).update({status:'accepted'})` → **permissão negada**.

- [ ] **Step 5: Commit**

```bash
git add professores.html
git commit -m "chore: bump ?v= dos arquivos da troca de professor"
```

---

### Task 9: Produção

- [ ] **Step 1: Confirmar a homologação com o Rafael**

Não seguir sem o OK explícito dele sobre o staging. Regra 7 do `CLAUDE.md`.

- [ ] **Step 2: Proteger as regras de Comissões**

```bash
node scripts/validate-rules-comissoes.js
```

Esperado: sem erro. O deploy de 17/07 já apagou o ruleset vivo de Comissões uma vez.

- [ ] **Step 3: Deploy**

```bash
firebase deploy --only firestore:rules,functions --project production
```

- [ ] **Step 4: Publicar para os usuários**

```bash
git push origin main
```

O site que a academia acessa é o GitHub Pages servindo o `main` — `firebase deploy --only hosting` **não** entrega ([[publicar-para-usuario-github-pages]]).

- [ ] **Step 5: Verificar em produção**

Abrir `rafaelmayerbrasil.github.io/crosstrainer-comissoes/professores.html`, conferir que o `?v=20260821` está sendo servido e que o console não tem erro.

---

## Apêndice: as 74 aulas de julho

Independente do resto — pode rodar a qualquer momento. Decisão do Rafael em 21/08/2026: em julho a academia rodava normal e o sistema é que entrou depois (carga inicial em 29/07), então as aulas de 29, 30 e 31 de julho são **aulas dadas**. Hoje estão em `prevista`, porque o robô de confirmação só age a partir de `AUTO_CONFIRM_DESDE = '2026-08-01'` e o fechamento só conta `realizada`/`substituida`.

- [ ] **Step 1: Escrever o script com ensaio obrigatório**

Criar `scripts/marcar-julho-realizada.js`:

```js
'use strict';
// Roda ENSAIO:  node scripts/marcar-julho-realizada.js --project production
// Roda DE VERDADE: node scripts/marcar-julho-realizada.js --project production --executar
//
// As aulas de 29–31/07/2026 nasceram na carga inicial e ficaram em 'prevista':
// o robô que confirma aula só age a partir de 01/08 e o fechamento só conta
// aula confirmada. A academia rodou normal em julho — o sistema é que entrou
// depois. Decisão do Rafael em 21/08/2026: marcar como dadas.
const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
const executar = args.includes('--executar');
if (!projeto) { console.error('Faltou --project <staging|production>'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const BR = 3;

(async () => {
  const de = new Date(Date.UTC(2026, 6, 1, BR, 0, 0));
  const ate = new Date(Date.UTC(2026, 7, 1, BR - 1, 59, 59));
  const snap = await db.collection('classes')
    .where('scheduledDate', '>=', de).where('scheduledDate', '<=', ate).get();

  const alvo = snap.docs.filter(d => d.data().status === 'prevista');
  const outros = snap.docs.length - alvo.length;
  console.log(`Julho/2026: ${snap.docs.length} aulas · ${alvo.length} em "prevista" · ${outros} em outro status (não serão tocadas)`);
  if (alvo.length === 0) { console.log('Nada a fazer.'); process.exit(0); }

  const porDia = {};
  alvo.forEach(d => {
    const dia = d.data().scheduledDate.toDate().toLocaleDateString('pt-BR');
    porDia[dia] = (porDia[dia] || 0) + 1;
  });
  console.log('Por dia:', JSON.stringify(porDia));

  if (!executar) {
    console.log('\n🔍 ENSAIO — nada foi gravado. Repita com --executar para valer.');
    process.exit(0);
  }

  let n = 0;
  for (let i = 0; i < alvo.length; i += 400) {
    const lote = db.batch();
    alvo.slice(i, i + 400).forEach(d => {
      lote.update(d.ref, {
        status: 'realizada',
        adjustmentNote: 'Confirmada em lote: julho anterior à entrada do sistema (decisão de 21/08/2026)',
        adjustedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      n++;
    });
    await lote.commit();
  }
  console.log(`✅ ${n} aulas de julho marcadas como realizadas.`);
  process.exit(0);
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
```

- [ ] **Step 2: Ensaiar no staging**

```bash
node scripts/marcar-julho-realizada.js --project staging
```

Esperado: o resumo por dia e o aviso de ensaio.

- [ ] **Step 3: Ensaiar em produção**

```bash
node scripts/marcar-julho-realizada.js --project production
```

Esperado: `74 em "prevista"` e o resumo por dia — nada gravado.

**Ensaio rodado em 22/08/2026.** Resultado real: as 74 aulas estão **todas em 31/07**, não
espalhadas por 29–31 como o plano supunha. Nenhuma está congelada em fechamento. Por professor:
Theo 11 · Bruno Othero 8 · Eduarda 7 · Thaynara 6 · Leonardo 6 · Heloísa 5 · Camila 5 ·
Bruno Claudino 5 · Louise 5 · João Vitor 4 · Alan 4 · Helena 4 · Thiago 4.

- [ ] **Step 4: Executar em produção depois do OK do Rafael**

```bash
node scripts/marcar-julho-realizada.js --project production --executar
```

Esperado: `✅ 74 aulas de julho marcadas como realizadas.`

- [ ] **Step 5: Commit**

```bash
git add scripts/marcar-julho-realizada.js
git commit -m "chore(dados): script pra confirmar as aulas de julho anteriores ao sistema"
```

---

## O que ficou diferente do plano

Registrado em 22/08/2026, depois da execução. O plano acima é o que foi pedido; isto é o que mudou
no caminho, quase sempre porque uma revisão achou um problema que o plano não previa.

| Onde | Plano | O que foi feito, e por quê |
|---|---|---|
| `substitution-flow.js` | 3 valores de `registradoPor` implícitos | Constante `REGISTRADO_POR` exportada, e o caso `'gestao'` **modelado**: `quemConfirma` → titular, `quemRegistrou` → `null`. Sem isso o titular podia cancelar um pedido que a gestão lançou |
| `substitution-flow.js` | comparações diretas de `teacherId` | Guardas de identidade nas 3 ramificações: `undefined === undefined` passava, e isso **apagava a marca de "a gestão confirmou sozinha"** |
| `substitution-flow.js` | — | `atorEhParte`: supervisor que também dá aula pode homologar troca em que ele é parte. Não bloqueia (a gestão é a palavra final), mas fica distinguível de "o professor não respondeu" |
| `substitution-flow.js` | duplicata checada no serviço | `podeRegistrar(cls, ator, opcoes)` com `subsDaAula` e `alvoTeacherId` opcionais — uma pergunta só, em vez de a regra viver em dois lugares |
| `professores-shared.js` | `requestingUserId: uid` | **Defeito grave do plano.** Gravava quem clicou, não o titular. Como a regra do Firestore só deixa `requestingUserId`/`substituteUserId` escreverem, o titular tomava "permissão negada" ao confirmar — no caminho principal da funcionalidade. Agora resolve pelos cadastros, via `userIdDoProfessor` lendo `/teachers` (varrer `/users` é negado pro professor — foi o que quebrou férias em agosto) |
| `professores-shared.js` | `update` direto | `_mover` inteiro dentro de `runTransaction`. Fora dela, um `cancelar` que chegasse depois de um `homologar` deixava a aula com o substituto e o pedido lendo `cancelled` — invisível pro fechamento, e a folha pagava errado |
| `professores-shared.js` | — | `cancel` passou a delegar ao módulo: antes checava só o status, **nunca quem estava cancelando** |
| `professores-shared.js` | — | `listPendingForUser` virou `listPendingForTeacher`; `listAllPending` e `listPendingForSubstitute` **apagados** (ficaram sem chamador) |
| `firestore.indexes.json` | não previsto | Dois índices que faltavam. `listAllPending`, **que já estava em produção**, falhava por falta de índice — e o erro virava "nenhum pedido pendente". Guarda nova: `scripts/smoke-indices-substituicoes.js` |
| `firestore.rules` | só barrar `accepted` | Também `hasOnly` nos campos: sem isso o professor reescrevia `substituteTeacherId` pra si, deixava o status em `pending`, e a gestão homologava uma troca que passou a creditar outra pessoa — **sem nunca escrever `accepted`**. E `create` exige nascer em `pending` |
| `functions/index.js` | avisar a gestão | Também: `listAdminUserIds` **não incluía `supervisao`** (estava parada no `admin_gestao`, dropado em junho). Quem é só supervisão homologa troca e aprova férias, e nunca era avisado — de nada. Corrigido de forma aditiva |
| `professores-agenda.js` | — | Bug pré-existente: dois blocos escreviam no mesmo `#classModalReadOnlyHint`, e o aviso do professor era **sempre** sobrescrito |
| `professores-agenda.js` | — | A caixa de entrada contava a troca do lado errado: o titular via "aula de [ele mesmo]" e um botão "Não fui eu", sem nunca ler quem estava reivindicando |
| `professores-home.js` | fora do escopo | O contador da home ficou discordando da caixa que ele abre — repontado pra `listPendingForTeacher` |
| `professores-fechamento.js` | trava se `travam` | Também **falha fechada**: se a verificação não rodar, não deixa fechar. Do outro jeito repetiria o bug da caixa da gestão — erro virando estado vazio tranquilizador, num passo irreversível |

**Validado contra o staging real:** `scripts/validate-troca-professor-rules.js`, 13/13 — incluindo a
prova de que `isOfficial` reenviado igual não conta como alteração (o argumento que até então só
tinha respaldo de documentação).
