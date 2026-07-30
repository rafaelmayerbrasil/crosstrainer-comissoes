'use strict';
// Dispara a CF callable generateClassesManual (precisa de token de ADMIN real).
// A agenda dos professores só aparece depois que as aulas são geradas a partir dos slots.
//
// Uso:
//   node scripts/gerar-aulas.js --project staging --dry-run
//   node scripts/gerar-aulas.js --project staging --weeks 4
//   ADMIN_EMAIL=... ADMIN_PASS=... node scripts/gerar-aulas.js --project production --dry-run
//
// Em staging usa por padrão a conta de demo dono.teste@. Em produção NÃO há conta
// de demo: passe ADMIN_EMAIL/ADMIN_PASS do admin real por variável de ambiente.

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const opt = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const PROJECTS = { staging: 'crosstrainer-comissoes-staging', production: 'crosstrainer-comissoes' };
const ALIAS = opt('--project');
const PROJECT = PROJECTS[ALIAS];
if (!PROJECT) { console.error('Use --project staging | --project production'); process.exit(1); }

const DRY_RUN = flag('--dry-run');
const WEEKS = Number(opt('--weeks') || 4);
const REGION = 'us-central1';

// apiKey do bloco certo do firebase-config.js (o arquivo tem prod E staging)
const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
let apiKey;
if (ALIAS === 'staging') {
  apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
} else {
  // produção: pega o bloco cujo projectId é exatamente 'crosstrainer-comissoes'
  apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,160}?projectId:\s*['"]crosstrainer-comissoes['"]/) || [])[1];
}
if (!apiKey) { console.error('não achei a apiKey de ' + ALIAS + ' em firebase-config.js'); process.exit(1); }

const EMAIL = process.env.ADMIN_EMAIL || (ALIAS === 'staging' ? 'dono.teste@crosstainer.com' : null);
const PASS  = process.env.ADMIN_PASS  || (ALIAS === 'staging' ? 'crosstainer2026' : null);
if (!EMAIL || !PASS) {
  console.error('Produção exige credencial de admin: ADMIN_EMAIL=... ADMIN_PASS=... node scripts/gerar-aulas.js --project production');
  process.exit(1);
}

(async () => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('login falhou p/ ' + EMAIL + ': ' + JSON.stringify(j.error || j).slice(0, 200));
  console.log(`✓ autenticado como ${EMAIL} em ${PROJECT}`);

  console.log(`\nChamando generateClassesManual { weeksAhead: ${WEEKS}, dryRun: ${DRY_RUN} }…`);
  const cf = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/generateClassesManual`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${j.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { weeksAhead: WEEKS, dryRun: DRY_RUN } }),
  });
  const txt = await cf.text();
  if (!cf.ok) { console.error(`✗ CF respondeu ${cf.status}:\n${txt.slice(0, 800)}`); process.exit(1); }
  const res = JSON.parse(txt);
  console.log('\nResultado:');
  console.log(JSON.stringify(res.result ?? res, null, 2));
})().catch(e => { console.error('\n✗ ERRO: ' + e.message); process.exit(1); });
