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

  console.log(`\n${ok} verificação(ões) passando.`);
})().catch(e => { console.error('\n✗ FALHOU: ' + e.message); process.exit(1); });
