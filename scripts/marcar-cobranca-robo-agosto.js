'use strict';
// ===================================================================
// Marca, em JULHO, os 7 contratos cuja cobranca de agosto e do robo
// ===================================================================
//
//   node scripts/marcar-cobranca-robo-agosto.js --project staging            (so mostra)
//   node scripts/marcar-cobranca-robo-agosto.js --project staging --apply    (grava)
//
// POR QUE EXISTE (07/09/2026)
//
// O tradutor da Pacto excluia toda linha com `Responsavel 2 = RECORRENCIA`
// achando que era o robo renovando. Nao era: e a FORMA DE COBRANCA. Em agosto
// isso apagou 17 vendas de gente — ver `pacto-adapter.js#ehCobrancaRecorrente`.
// A regra saiu, e quem passa a barrar a recobranca e `codigosPagos`: cada
// contrato paga uma vez so, no primeiro recebimento.
//
// So que agosto e um mes de FRONTEIRA. Julho foi calculado com as planilhas
// corrigidas do TecnoFit, que usam outra numeracao de contrato — entao
// `codigosPagos` de julho nao contem nenhum codigo da Pacto, e as 7 cobrancas
// que sao mesmo do robo passariam a pagar de novo (R$ 849,31 e as duas
// unidades subindo indevidamente para Meta Gold).
//
// Este script fecha essa fronteira: acrescenta os 7 codigos da Pacto ao
// `codigosPagos` de julho, que e exatamente o que eles significam — "este
// contrato ja foi tratado antes de agosto". Cada um foi conferido linha a
// linha contra as planilhas de julho; o motivo esta ao lado.
//
// ⚠️ `gravarCodigosPagos` (index.html) REESCREVE `codigosPagos` a partir dos
//    itens do periodo. Se alguem re-subir JULHO, estes 7 somem e agosto volta
//    a pagar errado. Por isso a nota fica gravada em `codigosPagosNota` (que
//    o merge nao apaga) e este script e idempotente: rodar de novo repoe.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PROJETO = arg('--project');
const APLICAR = process.argv.includes('--apply');
if (!PROJETO || !['staging', 'production'].includes(PROJETO)) {
  console.error('Uso: node scripts/marcar-cobranca-robo-agosto.js --project staging|production [--apply]');
  process.exit(1);
}

const CONTRATOS = {
  CP: [
    ['C7082', 'PEDRO HENRIQUE SCHONARTH', 'julho ja comissionou o mesmo recorrente (R$ 309, Balcao, Renovacao)'],
    ['C7091', 'FLÁVIA LOCKS', 'julho ja veio com Origem = Renovacao automatica'],
  ],
  PP: [
    ['C4582', 'CAROLINE MULLER', 'julho ja veio com Origem = Renovacao automatica'],
    ['C4566', 'JAIR COIMBRA DOS SANTOS JÚNIOR', '2a parcela do anual vendido em 24/07 (julho pagou a 1a)'],
    ['C4558', 'ANA CAROLINA SILVA DE ANDRADE', 'mesmo contrato ja comissionado em 31/07'],
    ['C4540', 'MARTHA HELENA GONÇALVES PINHEIRO', 'mesmo contrato ja comissionado em 27/07'],
    ['C4563', 'DANIELE DA CUNHA BEMFICA', 'mesmo contrato ja comissionado em 31/07 (R$ 86,77)'],
  ],
};

const NOTA = 'Os codigos C7082/C7091 (CP) e C4582/C4566/C4558/C4540/C4563 (PP) foram acrescentados a mao em ' +
  '07/09/2026: sao cobrancas do robo em agosto cujo contrato julho ja tratou, e julho usa a numeracao do ' +
  'TecnoFit, entao nao ha como derivar. Se este periodo for re-processado, rodar de novo ' +
  'scripts/marcar-cobranca-robo-agosto.js — senao agosto paga essas 7 linhas de novo.';

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();

(async () => {
  console.log('projeto: ' + PROJETO + (APLICAR ? '   MODO: GRAVANDO' : '   MODO: so leitura (use --apply para gravar)'));

  const snap = await db.collection('periodos').get();
  const julho = [];
  snap.forEach(d => { if (/2026-07$/.test(d.id)) julho.push({ id: d.id, ...d.data() }); });

  if (!julho.length) { console.log('\nNenhum periodo de 2026-07 neste projeto — nada a fazer.'); process.exit(0); }

  const backupDir = path.join(__dirname, '..', 'backups');
  if (APLICAR && !fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  for (const p of julho) {
    const sigla = /(^|[^a-z])pp[_-]/i.test(p.id) || String(p.unitId || '').toLowerCase().includes('pp') ? 'PP' : 'CP';
    const alvo = CONTRATOS[sigla];
    const atual = Array.isArray(p.codigosPagos) ? p.codigosPagos : [];
    const faltando = alvo.filter(([c]) => !atual.includes(c));

    console.log('\n--- ' + p.id + '  (unitId=' + p.unitId + ' -> ' + sigla + ') ---');
    console.log('    codigosPagos hoje: ' + atual.length + ' contratos');
    if (!faltando.length) { console.log('    os ' + alvo.length + ' ja estao la — nada a fazer'); continue; }
    faltando.forEach(([c, nome, motivo]) => console.log('    + ' + c + '  ' + nome + '  — ' + motivo));

    if (!APLICAR) continue;

    const arq = path.join(backupDir, 'codigosPagos-' + p.id + '-' + new Date().toISOString().slice(0, 10) + '.json');
    fs.writeFileSync(arq, JSON.stringify({ periodo: p.id, unitId: p.unitId, codigosPagos: atual }, null, 2));
    console.log('    backup: ' + path.relative(path.join(__dirname, '..'), arq));

    const novo = [...new Set([...atual, ...faltando.map(([c]) => c)])].sort();
    await db.collection('periodos').doc(p.id).set({ codigosPagos: novo, codigosPagosNota: NOTA }, { merge: true });
    await db.collection('audit_log').add({
      module: 'comissoes', action: 'settings_change',
      description: 'codigosPagos de ' + p.id + ': +' + faltando.map(([c]) => c).join(', ') +
        ' (cobranca do robo em agosto — ver scripts/marcar-cobranca-robo-agosto.js)',
      userEmail: 'script:marcar-cobranca-robo-agosto', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('    gravado: ' + atual.length + ' -> ' + novo.length + ' contratos');
  }

  console.log('\nDepois disto, re-subir o arquivo de agosto pela tela de Upload, uma vez em cada unidade.');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
