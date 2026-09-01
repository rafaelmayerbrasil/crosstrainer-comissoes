'use strict';
// Roda: node scripts/smoke-email-acesso.js
//
// Trocar o e-mail de ACESSO pela tela (31/08/2026). Pedido do Benny: a ficha do
// Bruno Claudino mostrava um e-mail de acesso que não é dele, o aviso na tela
// explicava o estrago ("a senha só pode ser redefinida pelo e-mail de acesso")
// e não oferecia conserto nenhum — a correção só existia pelo Console do
// Firebase ou por script.
//
// As funções são CHAMADAS de verdade num sandbox `vm`, não lidas como texto —
// cicatriz da "prévia que nunca rodou" (24/08/2026).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'professores-pessoas.js'), 'utf8');

// Objeto criado DENTRO do sandbox `vm` tem prototype de OUTRO realm: mesmo com
// valores idênticos, `deepStrictEqual` cru falha comparando protótipos. O
// round-trip por JSON normaliza pro realm do host (mesmo truque de
// smoke-escala-historico-tela.js).
const plano = (o) => JSON.parse(JSON.stringify(o));

const PESSOA = {
  key: 'p1', uid: 'uid-bruno', teacherId: 't1', name: 'BRUNO CLAUDINO',
  email: 'brunosilva@hotmail.com',            // e-mail de ACESSO (users/Auth)
  emailContato: 'bruno_claudinocl@hotmail.com', // e-mail da FICHA (teachers)
  emailDivergente: true,
  hasAccess: true,
  user: { email: 'brunosilva@hotmail.com', profiles: ['professor'] },
  teacher: { id: 't1', name: 'BRUNO CLAUDINO', cpf: '***.920.209-**', phone: '(41) 99721-0040' },
};

function novoSandbox(opts) {
  opts = opts || {};
  const state = { chamadas: [], toasts: [], prompts: [], confirms: 0, renders: 0 };
  const sandbox = {
    console, setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    document: {
      getElementById: () => ({ style: {}, innerHTML: '', value: '', classList: { add() {}, remove() {} } }),
      querySelectorAll: () => [], querySelector: () => null,
      addEventListener: () => {},
    },
    toast: (msg, tipo) => state.toasts.push({ msg, tipo }),
    prompt: (msg, def) => { state.prompts.push({ msg, def }); return opts.promptReturn === undefined ? def : opts.promptReturn; },
    confirm: () => { state.confirms++; return opts.confirmReturn !== false; },
    escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    isStrictAdmin: () => opts.admin !== false,
    isSupervisao: () => false,
    canSeeSalary: () => false,
    UserModel: {
      PROFILE_ORDER: ['professor'], PROFILE_LABELS: { professor: 'Professor' },
      profilesOf: (u) => u.profiles || [],
      deriveUserModel: () => ({ moduleAccess: { comissoes: false, professores: true }, role: 'professor' }),
    },
    PessoasModel: { profilesOf: (u) => u.profiles || [] },
    ProfessoresState: { unitsMap: new Map(), modalitiesMap: new Map(), list: [] },
    firebase: {
      functions: () => ({
        httpsCallable: (nome) => async (payload) => {
          state.chamadas.push({ nome, payload });
          if (opts.cfErro) throw new Error(opts.cfErro);
          return { data: { success: true, email: payload.email } };
        },
      }),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'professores-pessoas.js' });
  vm.runInContext('this.PessoasState = PessoasState;', sandbox);
  sandbox.PessoasState.people = [PESSOA];
  sandbox.renderPessoasPage = async () => { state.renders++; };
  return { sandbox, state };
}

(async () => {
  // ── 1. o conserto aparece onde o problema aparece ──
  {
    const { sandbox } = novoSandbox();
    const html = sandbox.renderPessoaTabIdentidade(PESSOA);
    assert.ok(html.includes('O e-mail de contato desta ficha é outro'), 'o aviso de divergência continua lá');
    assert.ok(html.includes('pessoaTrocarEmailAcesso'), 'e agora traz o botão de conserto junto');
    assert.ok(html.includes('bruno_claudinocl@hotmail.com'), 'o botão propõe o e-mail da ficha');
    passou('o aviso de e-mail divergente passou a oferecer a correção');

    const acesso = sandbox.renderPessoaTabAcesso(PESSOA);
    assert.ok(acesso.includes('Alterar e-mail de acesso'), 'a aba Acesso também tem o botão');
    passou('a aba Acesso tem o botão de alterar o e-mail de login');
  }

  // ── 2. só admin ──
  {
    const { sandbox, state } = novoSandbox({ admin: false });
    const html = sandbox.renderPessoaTabIdentidade(PESSOA);
    assert.ok(!html.includes('pessoaTrocarEmailAcesso'), 'supervisão não vê o botão');
    await sandbox.pessoaTrocarEmailAcesso('p1', 'x@y.com');
    assert.strictEqual(state.chamadas.length, 0, 'e mesmo chamando na mão, nada é enviado');
    assert.ok(state.toasts.some(t => t.tipo === 'error'), 'com recado explicando');
    passou('quem não é admin não troca e-mail de acesso');
  }

  // ── 3. caminho feliz: chama a CF com o uid e o e-mail normalizado ──
  {
    const { sandbox, state } = novoSandbox({ promptReturn: '  Bruno_ClaudinoCL@Hotmail.com  ' });
    await sandbox.pessoaTrocarEmailAcesso('p1', 'bruno_claudinocl@hotmail.com');
    assert.strictEqual(state.chamadas.length, 1, 'uma chamada à Cloud Function');
    assert.strictEqual(state.chamadas[0].nome, 'changeLoginEmail', 'é a changeLoginEmail');
    assert.deepStrictEqual(plano(state.chamadas[0].payload), { uid: 'uid-bruno', email: 'bruno_claudinocl@hotmail.com' },
      'espaço e maiúsculas somem antes de virar login');
    assert.strictEqual(state.confirms, 1, 'confirma antes, porque mexe no login de outra pessoa');
    assert.strictEqual(state.renders, 1, 'a tela recarrega pra mostrar o e-mail novo');
    assert.ok(state.prompts[0].def === 'bruno_claudinocl@hotmail.com', 'o campo já vem preenchido com o e-mail da ficha');
    passou('troca válida chama a Cloud Function com o e-mail normalizado');
  }

  // ── 4. o que NÃO pode chegar no Auth ──
  {
    for (const [entrada, motivo] of [
      ['', 'cancelar/apagar não faz nada'],
      ['bruno_claudinocl', 'e-mail sem @ não vai'],
      ['brunosilva@hotmail.com', 'o e-mail atual não vira "troca"'],
    ]) {
      const { sandbox, state } = novoSandbox({ promptReturn: entrada });
      await sandbox.pessoaTrocarEmailAcesso('p1', 'bruno_claudinocl@hotmail.com');
      assert.strictEqual(state.chamadas.length, 0, motivo);
    }
    passou('vazio, e-mail inválido e o próprio e-mail atual não chegam na Cloud Function');

    const { sandbox, state } = novoSandbox({ promptReturn: 'novo@x.com', confirmReturn: false });
    await sandbox.pessoaTrocarEmailAcesso('p1', 'x@y.com');
    assert.strictEqual(state.chamadas.length, 0, 'quem cancela o confirm não troca nada');
    passou('cancelar a confirmação não troca o e-mail');
  }

  // ── 5. falha da CF vira recado, não silêncio ──
  {
    const { sandbox, state } = novoSandbox({ promptReturn: 'novo@x.com', cfErro: 'Já existe outra pessoa usando esse e-mail de acesso.' });
    await sandbox.pessoaTrocarEmailAcesso('p1', 'x@y.com');
    assert.strictEqual(state.renders, 0, 'não finge que deu certo');
    assert.ok(state.toasts.some(t => t.tipo === 'error' && /já existe outra pessoa/i.test(t.msg)),
      'o motivo real aparece na tela');
    passou('erro da Cloud Function aparece pro admin, com o motivo');
  }

  // ── 6. pessoa sem login não tem o que trocar ──
  {
    const { sandbox, state } = novoSandbox();
    sandbox.PessoasState.people = [{ ...PESSOA, uid: null, hasAccess: false, user: null }];
    await sandbox.pessoaTrocarEmailAcesso('p1', 'x@y.com');
    assert.strictEqual(state.chamadas.length, 0, 'sem uid, nada a trocar');
    assert.ok(state.toasts.some(t => /não tem login/i.test(t.msg)), 'e o recado diz o porquê');
    passou('pessoa sem login recebe recado em vez de erro');
  }

  console.log('\n' + ok + '/' + ok + ' verificações passaram.');
})().catch(e => { console.error('\nFALHOU: ' + e.message); process.exit(1); });
