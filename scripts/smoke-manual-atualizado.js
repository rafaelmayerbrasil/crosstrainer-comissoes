'use strict';
// Roda: node scripts/smoke-manual-atualizado.js
//
// O manual desatualizou em silêncio. Entre 13/08 e 26/08 entraram em produção a
// Grade de Horários, a troca de professor da aula, a prévia da escala, o
// publicar em lote, o inverter, a cota por pessoa, o desligar pessoa — e o
// manual não falava de NADA disso. Ninguém percebeu porque manual não quebra:
// ele só fica velho, e quem lê aprende o sistema errado.
//
// Este smoke ancora os assuntos que precisam existir no manual. Não julga a
// redação — só garante que o assunto não sumiu quando alguém mexer no arquivo.
//
// Ao entregar recurso novo que muda a rotina de alguém, ACRESCENTE aqui.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(raiz, 'manual-admin.html'), 'utf8');
const prof = fs.readFileSync(path.join(raiz, 'manual-professores.html'), 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);
const tem = (txt, termo) => txt.toLowerCase().includes(termo.toLowerCase());

function exige(txt, ondeNome, assuntos) {
  const faltando = Object.entries(assuntos).filter(([, termo]) => !tem(txt, termo));
  assert.strictEqual(faltando.length, 0,
    ondeNome + ' não fala de: ' + faltando.map(([k, v]) => `${k} ("${v}")`).join(' · '));
}

// ─── Manual do administrador ───
{
  exige(admin, 'manual-admin', {
    'grade renomeada': 'Grade de Horários',
    'gerar agenda na hora': 'Gerar agenda agora',
    'troca de dia da semana avisa': 'dia da semana',
  });
  ok('admin: Grade de Horários, gerar agora e o cuidado com o dia da semana');
}
{
  exige(admin, 'manual-admin', {
    'prévia antes de publicar': 'montar sem publicar',
    'publicar o lote': 'Publicar na agenda e avisar',
    'refazer': 'Refazer',
    'reconsolidar': 'Reconsolidar',
    'despublicar': 'Despublicar',
    'inverter': 'Inverter',
  });
  ok('admin: prévia, publicar em lote, refazer, reconsolidar, despublicar, inverter');
}
{
  exige(admin, 'manual-admin', {
    'rodízio antes do mérito': 'rodízio primeiro',
    '12 meses móveis': '12 meses',
    'nada de dois sábados seguidos': 'dois sábados seguidos',
    'descanso ao redor do feriado': 'feriado dá descanso',
    'feriado conta só feriado': 'só de feriados',
    'cota por pessoa': 'quantos dias quer',
  });
  ok('admin: as regras do rodízio e a cota por pessoa');
}
{
  // O erro que o Rodrigo cometeu: usou o botão achando que editava a escala
  exige(admin, 'manual-admin', {
    'o botão de dias fora existe': 'dias fora',
    'e avisa que não muda a escala': 'NÃO muda a escala',
    'e diz qual é o caminho certo': 'Refazer',
  });
  ok('admin: o botão "+ dias fora" está explicado, com o aviso do que ele NÃO faz');
}
{
  exige(admin, 'manual-admin', {
    'sábado feriado em dobro': 'paga em dobro',
    'não recebe por aula': 'não recebe por aula',
    'desligar pessoa': 'Desligar',
    'religar pessoa': 'Religar',
  });
  ok('admin: pagamento da escala, "não recebe por aula" e desligar/religar');
}

// ─── Manual do professor ───
{
  exige(prof, 'manual-professores', {
    'cota': 'quantos dias você quer',
    'nada aparece antes de publicar': 'não vê nada',
    'aviso quando publicar': 'recebe um aviso',
    'como o sistema escolhe': 'rodízio',
    'dois sábados seguidos': 'dois sábados seguidos',
  });
  ok('professor: cota, silêncio antes de publicar, aviso e a regra do rodízio');
}

// ─── Integridade: âncoras que a Ajuda do app usa ───
{
  // O item ❓ do menu abre o manual numa âncora. Âncora que some vira link morto.
  const ancorasAdmin = [...admin.matchAll(/<h2[^>]*id="([^"]+)"/g)].map(m => m[1]);
  const ancorasProf = [...prof.matchAll(/<h2[^>]*id="([^"]+)"/g)].map(m => m[1]);
  ['pessoas', 'agenda', 'escala', 'fechamento', 'pagamentos'].forEach(a =>
    assert.ok(ancorasAdmin.includes(a), 'âncora "' + a + '" sumiu do manual-admin'));
  ['agenda', 'escala', 'substituicao', 'ferias'].forEach(a =>
    assert.ok(ancorasProf.includes(a), 'âncora "' + a + '" sumiu do manual-professores'));
  ok('as âncoras que a Ajuda do app abre continuam existindo');
}
{
  // Link interno apontando pra âncora que não existe = clique morto
  [['manual-admin', admin], ['manual-professores', prof]].forEach(([nome, txt]) => {
    const ids = [...txt.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    const links = [...txt.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
    const mortos = links.filter(h => !ids.includes(h));
    assert.strictEqual(mortos.length, 0, nome + ' tem link interno morto: ' + mortos.join(', '));
  });
  ok('nenhum link interno morto nos dois manuais');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
