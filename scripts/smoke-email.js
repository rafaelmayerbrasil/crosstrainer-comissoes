'use strict';
// Roda: node scripts/smoke-email.js
//
// Camada de e-mail (24/08/2026). O sistema já avisa pelo sino do app; o e-mail
// existe pra alcançar quem não abre o app todo dia. Regra do Rafael: só o que
// tem PRAZO ou DINHEIRO vai por e-mail — o resto vira ruído e a pessoa para de
// ler tudo, inclusive o que importa.
//
// O envio nasce DESLIGADO e com modo de teste, porque e-mail chega em gente de
// verdade e não tem desfazer. Enquanto o modo de teste estiver ligado, tudo vai
// pra um endereço só, sem tocar em ninguém da academia.

const assert = require('assert');
const E = require('../functions/email-config.js');

const cfgLigado = { ativo: true, modoTeste: false, emailTeste: null };

/* ── 1. Só os quatro eventos escolhidos viram e-mail ──────────────── */
['scale_confirmed', 'substitution_requested', 'vacation_approved', 'vacation_rejected', 'recibo_emitido']
  .forEach(t => assert.strictEqual(E.deveEnviar({ type: t }, cfgLigado), true, `${t} vai por e-mail`));

['coverage_available', 'event_reminder', 'substitution_accepted', 'scale_window_open', 'pagamento_confirmado']
  .forEach(t => assert.strictEqual(E.deveEnviar({ type: t }, cfgLigado), false,
    `${t} fica só no sino — e-mail demais faz a pessoa parar de ler`));
console.log('✓ só os eventos com prazo ou dinheiro viram e-mail');

/* ── 2. Desligado por padrão ──────────────────────────────────────── */
assert.strictEqual(E.deveEnviar({ type: 'scale_confirmed' }, { ativo: false }), false,
  'com o interruptor desligado não sai nada');
assert.strictEqual(E.deveEnviar({ type: 'scale_confirmed' }, {}), false,
  'config ausente = desligado (nunca liga sozinho)');
assert.strictEqual(E.deveEnviar({ type: 'scale_confirmed' }, null), false, 'sem config, não envia');
console.log('✓ nasce desligado e não liga sozinho');

/* ── 3. Modo de teste desvia tudo pra um endereço só ──────────────── */
const cfgTeste = { ativo: true, modoTeste: true, emailTeste: 'rafael@exemplo.com' };
const destino = E.destinatario('professora@gmail.com', cfgTeste);
assert.strictEqual(destino.para, 'rafael@exemplo.com', 'em teste, nada chega no professor');
assert.ok(/professora@gmail\.com/.test(destino.avisoTeste),
  'e o e-mail diz pra quem TERIA ido, senão não dá pra conferir');

const real = E.destinatario('professora@gmail.com', cfgLigado);
assert.strictEqual(real.para, 'professora@gmail.com', 'fora do teste, vai pra pessoa');
assert.strictEqual(real.avisoTeste, '', 'e sem tarja de teste');

// Modo de teste ligado mas sem endereço configurado: não envia pra ninguém
assert.strictEqual(E.destinatario('professora@gmail.com', { ativo: true, modoTeste: true }).para, null,
  'modo teste sem endereço de teste não pode vazar pro professor');
console.log('✓ modo de teste não escapa');

/* ── 4. O e-mail montado ──────────────────────────────────────────── */
const msg = E.montarEmail({
  type: 'scale_confirmed',
  title: 'Você está escalado',
  body: 'sáb 05/09 · CP 08:00–12:00 (TOI). Já está na sua agenda.',
}, { nome: 'Camila', email: 'camila@gmail.com' }, cfgLigado);

assert.ok(msg, 'monta a mensagem');
assert.ok(/escala/i.test(msg.subject), 'o assunto diz do que se trata');
assert.ok(!/notifica[çc]/i.test(msg.subject), 'e não é "Notificação do sistema", que ninguém abre');
assert.ok(msg.subject.length <= 78, 'assunto curto o bastante pra não ser cortado no celular');
assert.ok(/Camila/.test(msg.text), 'chama a pessoa pelo nome');
assert.ok(/05\/09/.test(msg.text), 'e traz o conteúdo do aviso');
assert.ok(/<html|<body|<div/i.test(msg.html), 'tem versão em HTML');
assert.ok(/Camila/.test(msg.html), 'com o mesmo conteúdo');
assert.ok(!/undefined|null/.test(msg.text), 'sem "undefined" vazando no texto');
console.log('✓ mensagem montada');

/* ── 5. Sem e-mail da pessoa, não inventa ─────────────────────────── */
assert.strictEqual(E.montarEmail({ type: 'scale_confirmed', title: 'x', body: 'y' }, { nome: 'Sem Email' }, cfgLigado), null,
  'pessoa sem e-mail não gera mensagem — melhor não enviar do que enviar pro vazio');
assert.strictEqual(E.destinatario(null, cfgLigado).para, null, 'destino nulo continua nulo');
assert.strictEqual(E.destinatario('  ', cfgLigado).para, null, 'espaço em branco não é e-mail');
console.log('✓ não inventa destinatário');

/* ── 6. O nome do remetente aparece pra quem recebe ───────────────── */
assert.ok(/CrossTainer/.test(E.REMETENTE_NOME), 'assinado como CrossTainer, com o nome certo da marca');
assert.ok(!/CrossTrainer/.test(E.REMETENTE_NOME), 'e sem o R a mais que é o erro clássico');
console.log('✓ remetente com o nome certo da marca');

/* ── 7. A Cloud Function está ligada e é fail-safe ────────────────── */
const fs = require('fs');
const path = require('path');
const cf = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

assert.ok(/document: 'notifications\/\{notifId\}'/.test(cf),
  'o e-mail sai do gatilho de notificações — um lugar só, sem mexer em cada tela');
assert.ok(/emailConfig\.deveEnviar/.test(cf), 'e quem decide é o módulo testado aqui');
assert.ok(/collection\('mail'\)/.test(cf), 'grava na coleção que a extensão do Firebase lê');

// O bloco não pode relançar: o aviso do sino vale por si, e-mail é acessório
const bloco = cf.match(/exports\.onNotificationCreated[\s\S]*?\n\}\);/);
assert.ok(bloco, 'achou o bloco da função');
assert.ok(/logger\.error/.test(bloco[0]) && !/throw /.test(bloco[0]),
  'falha de e-mail não pode derrubar a notificação — registra e segue');

// A coleção `mail` não pode ser escrita pelo navegador: quem escreve manda
// e-mail em nome da academia.
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const blocoMail = rules.match(/match \/mail\/\{[^}]*\}[\s\S]*?\n\s*\}/);
assert.ok(blocoMail, 'a coleção mail precisa de regra explícita');
assert.ok(/allow read, write: if false/.test(blocoMail[0]),
  'ninguém escreve em mail pelo cliente — só a Cloud Function, que roda com Admin SDK');
console.log('✓ Cloud Function ligada, fail-safe, e a fila de e-mail fechada pro cliente');

console.log('\n✅ smoke-email: OK');
