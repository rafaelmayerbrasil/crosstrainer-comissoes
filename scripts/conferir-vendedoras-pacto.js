'use strict';
// ═══════════════════════════════════════════════════════════════
// Confere os nomes de vendedora do relatório da Pacto contra o que
// JÁ EXISTE no sistema — antes de subir, para não duplicar cadastro
// ═══════════════════════════════════════════════════════════════
//
//   node scripts/conferir-vendedoras-pacto.js "<export.xls>" [--producao]
//
// SOMENTE LEITURA. Não escreve nada, em nenhum ambiente.
//
// Por que existe: ao subir o arquivo, a tela cadastra sozinha toda vendedora que
// não reconhecer (`newVendors`). O casamento é por `normalizeString` — acento e
// caixa não contam, mas **qualquer outra diferença cria pessoa nova**: um nome do
// meio a mais, um sobrenome a menos, "LOPEZ" contra "DUTRA". Aí o histórico dela
// racha em duas e as metas e o P3 passam a contar cada metade separada.
//
// Compara contra duas coisas, porque são fontes diferentes de duplicidade:
//   • `/users`   — o cadastro; é o que a tela consulta pra decidir criar ou não
//   • `periodos/*/itens` — o nome gravado nas vendas antigas. O motor agrupa por
//     ESSE texto, então um nome novo separa o histórico mesmo com o cadastro ok.

const path = require('path');
const admin = require('firebase-admin');
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));

const args = process.argv.slice(2);
const arquivo = args.find(a => !a.startsWith('--'));
const producao = args.includes('--producao');
if (!arquivo) {
  console.error('uso: node scripts/conferir-vendedoras-pacto.js <export.xls> [--producao]');
  process.exit(1);
}

const conta = producao ? './serviceAccount-production.json' : './serviceAccount-staging.json';
admin.initializeApp({ credential: admin.credential.cert(require(conta)) });
const db = admin.firestore();

// A MESMA regra da tela (index.html:9430) — se divergir, a conferência não vale
const normalizar = s => !s ? '' : s.toString()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();

/** Quão parecidos são dois nomes? 0..1 — só pra sugerir o provável par */
function parecenca(a, b) {
  const pa = a.split(' ').filter(Boolean), pb = b.split(' ').filter(Boolean);
  const comuns = pa.filter(x => pb.includes(x)).length;
  return comuns / Math.max(pa.length, pb.length);
}

(async () => {
  console.log('AMBIENTE: ' + (producao ? '🔴 PRODUÇÃO' : '🟡 staging') + '  (somente leitura)');
  console.log('ARQUIVO : ' + path.basename(arquivo) + '\n');

  // ─── 1. Os nomes que o tradutor vai produzir ───
  const wb = readXlsx(arquivo);
  const sh = wb.sheet(wb.sheetNames[0]);
  const r = PA.traduzir(Object.keys(sh).map(Number).sort((a, b) => a - b).map(k => sh[k]), {});
  const doArquivo = {};
  r.vendas.forEach(v => {
    const n = v['Vendedor'];
    if (!n) return;
    if (!doArquivo[n]) doArquivo[n] = { linhas: 0, unidades: new Set() };
    doArquivo[n].linhas++;
    doArquivo[n].unidades.add(v._unidade);
  });

  // ─── 2. O que já existe no sistema ───
  const users = [];
  (await db.collection('users').get()).forEach(d => users.push({ id: d.id, ...d.data() }));

  const historico = {};   // nome gravado nas vendas antigas → em quantos períodos
  const periodos = await db.collection('periodos').get();
  for (const p of periodos.docs) {
    const itens = await p.ref.collection('itens').where('type', '==', 'processed').get();
    itens.forEach(d => {
      const n = d.data().vendedor;
      if (!n) return;
      historico[n] = historico[n] || new Set();
      historico[n].add(p.id);
    });
  }

  console.log('NO SISTEMA: ' + users.length + ' pessoas em /users · '
    + Object.keys(historico).length + ' nomes de vendedora no histórico ('
    + periodos.size + ' períodos)\n');

  // ─── 3. Comparar ───
  const mapaUsers = new Map(users.map(u => [normalizar(u.name), u]));
  const mapaHist = new Map(Object.keys(historico).map(n => [normalizar(n), n]));

  const linha = (a, b, c) => '  ' + a.padEnd(32) + b.padEnd(10) + c;
  console.log('NOME NO ARQUIVO'.padEnd(34) + 'LINHAS'.padEnd(10) + 'SITUAÇÃO');
  console.log('  ' + '─'.repeat(78));

  const novas = [];
  Object.entries(doArquivo).sort((a, b) => b[1].linhas - a[1].linhas).forEach(([nome, info]) => {
    const norm = normalizar(nome);
    const u = mapaUsers.get(norm);
    const h = mapaHist.get(norm);
    const un = [...info.unidades].filter(Boolean).join('/') || '—';

    if (u && h) return console.log(linha(nome, String(info.linhas), '✅ cadastrada e com histórico  [' + un + ']'));
    if (u && !h) return console.log(linha(nome, String(info.linhas), '✅ cadastrada · sem histórico ainda  [' + un + ']'));

    // Não casou: vai virar cadastro novo. Tem alguém parecido?
    const candidatos = [...mapaUsers.keys(), ...mapaHist.keys()]
      .map(k => ({ k, p: parecenca(norm, k) }))
      .filter(x => x.p >= 0.5 && x.p < 1)
      .sort((a, b) => b.p - a.p);
    novas.push({ nome, info, candidatos });
    const alerta = candidatos.length
      ? '⚠️ NOVA — parece "' + candidatos[0].k + '"'
      : '🆕 nova (ninguém parecido)';
    console.log(linha(nome, String(info.linhas), alerta + '  [' + un + ']'));
  });

  // ─── 4. O contrário: quem já existe e sumiu do arquivo ───
  const nomesArquivo = new Set(Object.keys(doArquivo).map(normalizar));
  const sumiram = Object.entries(historico)
    .filter(([n]) => !nomesArquivo.has(normalizar(n)))
    .map(([n, ps]) => ({ n, periodos: ps.size }))
    .sort((a, b) => b.periodos - a.periodos);

  if (sumiram.length) {
    console.log('\nNO HISTÓRICO MAS NÃO NESTE ARQUIVO (' + sumiram.length + ')');
    console.log('  (normal para quem saiu ou não vendeu no mês — mas confira se não é grafia diferente)');
    sumiram.slice(0, 20).forEach(s => console.log('  ' + s.n.padEnd(32) + s.periodos + ' período(s)'));
    if (sumiram.length > 20) console.log('  … e mais ' + (sumiram.length - 20));
  }

  // ─── 5. Veredito ───
  const arriscadas = novas.filter(x => x.candidatos.length);
  console.log('\n' + '═'.repeat(80));
  if (!novas.length) {
    console.log('✅ TODAS as vendedoras do arquivo já existem. Nenhum cadastro novo será criado.');
  } else {
    console.log(novas.length + ' nome(s) do arquivo NÃO existem no sistema e serão cadastrados ao subir.');
    if (arriscadas.length) {
      console.log('\n🚨 ' + arriscadas.length + ' com nome parecido com alguém que já existe — CONFERIR ANTES DE SUBIR:');
      arriscadas.forEach(x => {
        console.log('\n  arquivo : "' + x.nome + '"  (' + x.info.linhas + ' linhas)');
        x.candidatos.slice(0, 3).forEach(c =>
          console.log('  sistema : "' + c.k + '"  — ' + Math.round(c.p * 100) + '% dos nomes em comum'));
        console.log('  → se for a mesma pessoa: acerte o nome no cadastro OU acrescente em');
        console.log('    PactoAdapter.APELIDOS (pacto-adapter.js), como já é feito com KALI LÓPEZ.');
      });
    } else {
      console.log('Nenhum deles parece com quem já existe — provavelmente são gente nova mesmo.');
    }
  }
  console.log('═'.repeat(80));
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
