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

  // ═══ 3. Equilíbrio do ciclo com nomes e sem falso alarme ══════════
  // Rodrigo, 25/08 9h05: "em 'equilíbrio do ciclo' mostrar quem são as pessoas".
  // Em produção os 3 'abaixo do mínimo' eram Yasmin (TOI Mobility), Patrícia
  // (Yoga) e Louiz Lume (TOI Combate) — nenhum dá TOI nem Hiit, que é o que a
  // vaga de sábado exige. O alerta vermelho cobrava algo sem solução.
  //
  // E Rafael, 25/08: "o que passou eles tem como ajustar manualmente?" — não
  // tinham. Agosto inteiro os sábados foram das mesmas 4 pessoas e a dívida
  // ficaria travada esperando alguém mexer no banco.
  {
    const ui = ler('professores-escala-smart.js');
    const painel = ui.slice(ui.indexOf('function renderEquilibrioPainel'), ui.indexOf('function whyTableHtml'));

    assert.ok(/participaDoRodizio/.test(ui),
      'o painel precisa separar quem participa do rodízio de sábado');
    assert.ok(/<details/.test(painel),
      'os chips precisam abrir a lista de nomes');
    assert.ok(/window\.ajustarContadorJustica\s*=/.test(ui),
      'precisa de um jeito de corrigir o contador na mão');
    assert.ok(/ScaleService\.saveFairness\(/.test(ui),
      'a correção precisa gravar de verdade');
    passou('equilíbrio mostra nomes, separa quem não participa e permite corrigir');
  }

  // Quem não dá TOI nem Hiit fica fora da conta do rodízio — comportamental.
  {
    const ui = ler('professores-escala-smart.js');
    const fn = ui.slice(ui.indexOf('function participaDoRodizio'), ui.indexOf('function renderEquilibrioPainel'));
    // Reconstitui a função pura num escopo controlado, com o estado que a tela usa.
    const EscalaSmartState = { modToi: { id: 'mTOI' }, modHiit: { id: 'mHIIT' } };
    // eslint-disable-next-line no-new-func
    const participa = new Function('EscalaSmartState', fn + '; return participaDoRodizio;')(EscalaSmartState);

    assert.strictEqual(participa({ modalityIds: ['mTOI'] }), true, 'quem dá TOI participa');
    assert.strictEqual(participa({ modalityIds: ['mHIIT'] }), true, 'quem dá Hiit participa');
    assert.strictEqual(participa({ modalityIds: ['mYOGA'] }), false, 'Patrícia (Yoga) não participa');
    assert.strictEqual(participa({ modalityIds: [] }), false, 'sem modalidade não participa');
    passou('participaDoRodizio tira do alerta quem nunca seria escalado');
  }

  console.log(`\n${ok} verificação(ões) passando.`);
})().catch(e => { console.error('\n✗ FALHOU: ' + e.message); process.exit(1); });
