'use strict';
// Roda: node scripts/smoke-ajustes-escala-2508.js
//
// Os ajustes pedidos no grupo da gestão em 25/08/2026 (Rafael Rojais e
// Rodrigo). Cada seção guarda UM comportamento que estava errado, junto com o
// relato que o originou — pra quem ler daqui a seis meses saber por que a
// regra existe.
//
// Metade comportamental (roda o serviço/motor real contra o firestore falso),
// metade estrutural (guarda a ligação na tela, que é onde as correções
// anteriores se perderam).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

let ok = 0;
const passou = (msg) => { console.log('✓ ' + msg); ok++; };

(async () => {

  // ═══ 1. A home conta a fila da GESTÃO ═════════════════════════════
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

  // ═══ 2. Inverter TOI <-> Hiit ═════════════════════════════════════
  // Rafael, 25/08 7h22: "Podemos trocar quem da TOI e quem da Hiit na prévia?"
  // Pelos dois selects não dá: o 1º passo esbarra em "Essa pessoa já está em
  // outra vaga desta escala" e a escala fica exatamente como estava.
  {
    const makeFakeDb = require('./_fake-firestore.js');
    const SS = require('../scale-service.js');
    const SE = require('../scale-engine.js');
    const db = makeFakeDb();
    const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

    const sab = (await SS.createScale({
      date: '2026-10-10', tipo: 'sabado', name: 'Sábado 10/10',
      slots: [
        { id: 'toi',  unitId: 'cp', requiredModalityId: 'TOI',  assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' },
        { id: 'hiit', unitId: 'cp', requiredModalityId: 'HIIT', assignedPersonId: 'bia', startTime: '08:00', endTime: '12:00' },
      ],
    }, d)).data;

    // O caminho antigo segue barrado — é a regra que impede a mesma pessoa em
    // duas aulas ao mesmo tempo. Certa; só torna a troca A↔B impossível a passo.
    const porFora = await SS.reassignSlot(sab.id, 'toi', 'bia', d);
    assert.strictEqual(porFora.success, false, 'trocar de um em um segue barrado (correto)');

    const r = await SS.swapSlots(sab.id, 'toi', 'hiit', d);
    assert.strictEqual(r.success, true, 'swapSlots inverte as duas de uma vez');

    const fim = (await SS.getScale(sab.id, d)).data;
    const byId = {};
    fim.slots.forEach(s => { byId[s.id] = s; });
    assert.strictEqual(byId.toi.assignedPersonId, 'bia', 'TOI virou bia');
    assert.strictEqual(byId.hiit.assignedPersonId, 'ana', 'Hiit virou ana');
    assert.strictEqual(byId.toi.reason, 'manual', 'vira escolha da gestão');

    // Inverter não é escalar mais ninguém: o contador de justiça não se mexe.
    const fAna = (await SS.getFairness('ana', d)).data;
    assert.strictEqual(fAna.diasTrabalhados, 0, 'inverter não mexe no contador');

    passou('swapSlots inverte TOI <-> Hiit sem mexer no contador');
  }

  {
    const ui = ler('professores-escala-smart.js');
    assert.ok(/ScaleService\.swapSlots\(/.test(ui), 'a tela chama swapSlots');
    assert.ok(/window\.inverterVagasEscala\s*=/.test(ui), 'o botão está registrado no window');
    assert.ok(/inverterVagasEscala\('\$\{scale\.id\}'/.test(ui), 'o botão ⇄ Inverter está desenhado');
    passou('tela ligada ao swapSlots');
  }

  console.log(`\n${ok} verificação(ões) passando.`);
})().catch(e => { console.error('\n✗ FALHOU: ' + e.message); process.exit(1); });
