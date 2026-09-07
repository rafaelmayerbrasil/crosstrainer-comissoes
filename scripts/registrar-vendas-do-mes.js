'use strict';
// ===================================================================
// Registra o relatorio de VENDAS de um mes (o mesmo que a tela grava)
// ===================================================================
//
//   node scripts/registrar-vendas-do-mes.js --project production --arquivo "<caminho>.xls"
//   ... --apply    para gravar
//
// Faz o que `registrarVendasDoPeriodo` (index.html) faz, chamando a MESMA
// funcao pura — `VendasAguardando.extrair`. Nao ha logica duplicada aqui: a
// leitura do arquivo mora no modulo compartilhado, e este script so grava.
//
// ⚠️ O relatorio de VENDAS traz o CONTRATO INTEIRO (R$ 3.108 num anual de 12x)
//    em vez da parcela. Ele NUNCA alimenta o calculo de comissao — vai para o
//    campo `vendasDoMes`, que so a tela "A receber" le. `ehRelatorioDeVendas`
//    recusa o arquivo errado.
const admin = require('firebase-admin');
const path = require('path');
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PROJETO = arg('--project');
const ARQUIVO = arg('--arquivo');
const SO_MES = arg('--mes');            // opcional: 'AAAA-MM' para gravar só um
const APLICAR = process.argv.includes('--apply');
if (!['staging', 'production'].includes(PROJETO) || !ARQUIVO) {
  console.error('Uso: node scripts/registrar-vendas-do-mes.js --project staging|production --arquivo "<x>.xls" [--mes AAAA-MM] [--apply]');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();

(async () => {
  console.log('projeto: ' + PROJETO + (APLICAR ? '   MODO: GRAVANDO' : '   MODO: so leitura (use --apply)'));
  console.log('arquivo: ' + ARQUIVO);

  const wb = readXlsx(path.isAbsolute(ARQUIVO) ? ARQUIVO : path.join(__dirname, '..', ARQUIVO));
  const aba = wb.sheet(wb.sheetNames[0]);
  const linhas = Object.keys(aba).map(Number).sort((a, b) => a - b).map(k => aba[k]);

  if (!VA.ehRelatorioDeVendas(linhas)) {
    console.error('\nEste NAO e o relatorio de vendas da Pacto ("Faturamento por Periodo").');
    console.error('detectarRelatorio devolveu: ' + PA.detectarRelatorio(linhas));
    process.exit(1);
  }

  const grupos = VA.extrair(linhas);
  const ids = [];
  const snapU = await db.collection('units').get();
  snapU.forEach(d => ids.push(d.id));

  for (const chave of Object.keys(grupos).sort()) {
    const [sigla, mes] = chave.split('|');
    if (SO_MES && mes !== SO_MES) { console.log('\n' + chave + ': fora do --mes pedido, pulando'); continue; }
    const unitId = ids.find(id => PA.siglaDaUnidade(id, [sigla]) === sigla);
    if (!unitId) { console.log('\n' + chave + ': unidade nao encontrada em /units, pulando'); continue; }

    const periodId = unitId + '_' + mes;
    const [ano, m] = mes.split('-');
    const antes = (await db.collection('periodos').doc(periodId).get()).data() || {};
    console.log('\n--- ' + periodId + ' ---');
    console.log('    antes: ' + ((antes.vendasDoMes || []).length) + ' vendas   |   novo: ' + grupos[chave].length);
    grupos[chave].slice(0, 5).forEach(v => console.log('      ' + v.contrato + '  ' + String(v.cliente).padEnd(32).slice(0, 32) + ' ' + (v.vendedores || []).join(', ')));
    if (grupos[chave].length > 5) console.log('      … e mais ' + (grupos[chave].length - 5));
    if (!APLICAR) continue;

    await db.collection('periodos').doc(periodId).set({
      unitId, year: Number(ano), month: Number(m),
      vendasDoMes: grupos[chave],
      vendasAtualizadasEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await db.collection('audit_log').add({
      module: 'comissoes', action: 'upload',
      description: 'Relatorio de VENDAS registrado em ' + periodId + ' (nao entra no calculo): ' +
        grupos[chave].length + ' vendas, de ' + path.basename(ARQUIVO),
      userEmail: 'script:registrar-vendas-do-mes', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('    gravado');
  }
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
