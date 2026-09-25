'use strict';
// ═══════════════════════════════════════════════════════════════════
// Venda repetida no mesmo dia não pode colapsar numa só
// ═══════════════════════════════════════════════════════════════════
//
//   node scripts/smoke-venda-repetida.js
//
// O id de cada item é o hash de vendedor|cliente|data|item|valor. Sete Monsters
// de R$ 9,80 do mesmo professor no mesmo dia davam o MESMO id e eram gravados um
// por cima do outro — ficava um. Enquanto eram do Rodrigo (não comissiona)
// ninguém perdia; desde 25/09/2026 são da Kali: R$ 21,53 a menos em set/PP.
//
// O trecho de GRAVAÇÃO do confirmUpload é recortado do index.html e EXECUTADO
// contra um Firestore falso — ler o texto não prova nada (lição da prévia que
// nunca rodou). `INDEX_HTML=<caminho>` roda contra outra versão.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(process.env.INDEX_HTML || path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

let passos = 0;
const caso = (nome, fn) => { fn(); passos++; console.log('  ✅ ' + nome); };

const recortarFuncao = nome => {
  const ini = html.indexOf(nome);
  if (ini < 0) return '';
  let n = 0;
  for (let j = html.indexOf('{', ini); j < html.length; j++) {
    if (html[j] === '{') n++;
    else if (html[j] === '}') { n--; if (!n) return html.slice(ini, j + 1); }
  }
  return '';
};
const iBloco = html.indexOf('// ── DEDUPLICATION: load existing items');
const fBloco = html.indexOf('// ── RECALCULATE: recomputar vendorSummary');
assert.ok(iBloco > 0 && fBloco > iBloco, 'não achei o trecho de gravação do confirmUpload');
const bloco = html.slice(iBloco, fBloco);

// ─── Firestore falso: só o que o trecho usa ───
function bancoFalso(inicial) {
  const itens = new Map(Object.entries(inicial || {}).map(([k, v]) => [k, { ...v }]));
  const ref = id => ({ id });
  const itemsRef = {
    get: async () => ({ forEach: fn => [...itens.entries()].forEach(([id, d]) => fn({ id, data: () => d })) }),
    doc: id => ref(id),
  };
  const db = {
    collection: () => ({ doc: () => ({ collection: () => itemsRef }) }),
    batch: () => {
      const ops = [];
      return {
        set: (r, d) => ops.push(() => itens.set(r.id, { ...d })),
        update: (r, d) => ops.push(() => { if (!itens.has(r.id)) throw new Error('update em doc inexistente ' + r.id); Object.assign(itens.get(r.id), d); }),
        delete: r => ops.push(() => itens.delete(r.id)),
        commit: async () => ops.forEach(f => f()),
      };
    },
  };
  return { db, itens };
}

const ctx = { console: { log() {} }, Map, Set, Math, Number, String, Object, Date };
vm.createContext(ctx);
['function generateStableId(', 'function generateSoftId(', 'function idsComRepeticao(', 'function ehValorAlterado(']
  .forEach(n => { const f = recortarFuncao(n); if (f) vm.runInContext(f, ctx); });
vm.runInContext(`async function gravar(db, periodId, result, uploadId, firebase) {
${bloco}
  return { skipped, added, replaced, uploadItemDeltas };
}`, ctx);

const monster = (i) => ({ vendedor: 'KALI DUTRA', cliente: 'LEONARDO SILVEIRA - PROF', data: '10/09/2026',
  item: 'MONSTER', valorCaixa: 9.8, p1valor: 0.49, p2bonus: 0, codigo: 'A01' + (i ? '-' + (i + 1) : '') });
const plano = { vendedor: 'KALI DUTRA', cliente: 'ANA', data: '02/09/2026', item: 'PLANO ANUAL', valorCaixa: 100, p1valor: 5, p2bonus: 30, codigo: 'C1' };
const resultado = (proc) => ({ processed: proc, excluded: [], deferred: [] });
const firebase = { firestore: { Timestamp: { fromDate: d => d } } };
const soma = itens => [...itens.values()].reduce((s, d) => s + (d.p1valor || 0), 0);

(async () => {
  // 1. primeiro upload: 7 Monsters iguais + 1 plano
  const b1 = bancoFalso();
  const sete = [0, 1, 2, 3, 4, 5, 6].map(monster);
  await ctx.gravar(b1.db, 'pp_2026-09', resultado([...sete, plano]), 'up1', firebase);
  caso('primeiro upload: as 7 compras iguais viram 7 lançamentos, não 1', () => {
    assert.strictEqual(b1.itens.size, 8, 'itens gravados: ' + b1.itens.size);
    assert.strictEqual(Math.round(soma(b1.itens) * 100) / 100, 8.43, 'comissão somada (7 × 0,49 + 5)');
  });
  caso('a 1ª compra mantém o id de sempre; só as repetidas ganham _2, _3…', () => {
    const base = ctx.generateStableId(monster(0));
    assert.ok(b1.itens.has(base), 'id original sumiu');
    assert.ok(b1.itens.has(base + '_2') && b1.itens.has(base + '_7'), 'repetidas sem sufixo: ' + [...b1.itens.keys()].join(', '));
    assert.ok(b1.itens.has(ctx.generateStableId(plano)), 'item sem repetição mudou de id');
  });

  // 2. re-upload do mesmo arquivo: nada duplica, nada some
  const r2 = await ctx.gravar(b1.db, 'pp_2026-09', resultado([...sete, plano]), 'up2', firebase);
  caso('subir o mesmo arquivo de novo não duplica nem apaga', () => {
    assert.strictEqual(b1.itens.size, 8);
    assert.strictEqual(r2.added, 0);
    assert.strictEqual(r2.uploadItemDeltas.length, 0, 'histórico registrou mudança onde não houve: ' + JSON.stringify(r2.uploadItemDeltas));
    assert.ok([...b1.itens.values()].every(d => d.uploadId === 'up2'), 'todo item tem que ficar marcado com o upload novo');
  });

  // 3. mês antigo: o banco já tinha as 7 coladas numa só (id base)
  const base = ctx.generateStableId(monster(0));
  const b3 = bancoFalso({ [base]: { ...monster(0), type: 'processed', uploadId: 'velho' } });
  const r3 = await ctx.gravar(b3.db, 'pp_2026-09', resultado(sete), 'up3', firebase);
  caso('mês antigo re-subido: as 6 que faltavam entram, e o histórico diz que foram adicionadas', () => {
    assert.strictEqual(b3.itens.size, 7, 'itens: ' + b3.itens.size);
    assert.strictEqual(r3.uploadItemDeltas.filter(d => d.change === 'added').length, 6);
    assert.ok(!r3.uploadItemDeltas.some(d => d.change === 'valor_alterado_ignorado'),
      'repetição de mesmo valor não é "valor alterado"');
  });

  // 4. correção de valor de verdade continua sendo ignorada (comportamento de sempre)
  const b4 = bancoFalso({ [ctx.generateStableId(plano)]: { ...plano, type: 'processed', uploadId: 'velho' } });
  const r4 = await ctx.gravar(b4.db, 'pp_2026-09', resultado([{ ...plano, valorCaixa: 120 }]), 'up4', firebase);
  caso('mesmo lançamento com valor mudado: mantém o original e registra "valor alterado"', () => {
    assert.strictEqual(b4.itens.size, 1);
    assert.strictEqual([...b4.itens.values()][0].valorCaixa, 100);
    assert.ok(r4.uploadItemDeltas.some(d => d.change === 'valor_alterado_ignorado'));
  });

  // 5. uma das compras saiu do arquivo (estorno/cancelamento): a sobra é apagada
  const b5 = bancoFalso();
  await ctx.gravar(b5.db, 'pp_2026-09', resultado(sete.slice(0, 3)), 'a', firebase);
  const r5 = await ctx.gravar(b5.db, 'pp_2026-09', resultado(sete.slice(0, 2)), 'b', firebase);
  caso('de 3 compras para 2: a terceira sai do banco e do histórico como removida', () => {
    assert.strictEqual(b5.itens.size, 2, 'itens: ' + [...b5.itens.keys()].join(', '));
    assert.ok(!b5.itens.has(base + '_3'));
    assert.strictEqual(r5.uploadItemDeltas.filter(d => d.change === 'removed').length, 1);
  });

  // 6. valores misturados no mesmo dia (achado rodando contra a produção em 25/09):
  //    2 × R$ 9,10 e 1 × R$ 9,80 do mesmo lanche. O banco antigo tinha um de cada.
  //    Comparar só com o ÚLTIMO valor gravado tratava o 2º R$ 9,10 como "valor
  //    alterado" e jogava fora — 19 casos em set/PP.
  const wafer = (v, i) => ({ ...monster(0), item: 'CRISPY WAFER', valorCaixa: v, p1valor: v * 0.05, codigo: 'A09' + (i ? '-' + i : '') });
  const b6 = bancoFalso({
    [ctx.generateStableId(wafer(9.1))]: { ...wafer(9.1), type: 'processed' },
    [ctx.generateStableId(wafer(9.8))]: { ...wafer(9.8), type: 'processed' },
  });
  const r6 = await ctx.gravar(b6.db, 'pp_2026-09', resultado([wafer(9.1), wafer(9.1, 2), wafer(9.8, 3)]), 'up6', firebase);
  caso('mesmo lanche por valores diferentes no mesmo dia: as 3 compras ficam, nenhuma vira "valor alterado"', () => {
    assert.strictEqual(b6.itens.size, 3, 'itens: ' + b6.itens.size);
    assert.ok(!r6.uploadItemDeltas.some(d => d.change === 'valor_alterado_ignorado'), JSON.stringify(r6.uploadItemDeltas));
  });

  console.log(`\nsmoke-venda-repetida: ${passos}/${passos} ✅`);
})().catch(e => { console.error(e); process.exit(1); });
