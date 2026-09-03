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
  // "+ dias fora" acabou — a contagem virou 100% derivada das escalas.
  // Ajustar é como corrigir agora: mostra a prévia, quem baixa e quem sobe.
  exige(admin, 'manual-admin', {
    'o botão que muda quantos dias uma pessoa tem na janela': 'Ajustar',
    'baixar chama quem tem menos e subir tira de quem tem mais': 'quem tem menos',
    'data já publicada pode ser mexida e avisa todo mundo': 'já publicada',
  });
  ok('admin: o botão Ajustar, a prévia e o aviso de data já publicada');
}
{
  exige(admin, 'manual-admin', {
    'de quando a contagem começa a valer': 'marco zero',
    'onde configurar': 'Configurações da escala',
  });
  ok('admin: marco zero — o que é e onde configurar');
}
{
  exige(admin, 'manual-admin', {
    'como zerar uma data que entrou errado': 'Tirar do lote',
    'quem já foi avisado continua avisado': 'não é desavisado',
  });
  ok('admin: Tirar do lote e o aviso de quem já foi avisado');
}
{
  exige(admin, 'manual-admin', {
    'onde ver quem mexeu, por data': 'Histórico desta escala',
    'onde ver quem mexeu, no rodapé do módulo': 'Últimas alterações',
  });
  ok('admin: os dois históricos — por data e o do rodapé');
}
{
  // Ausência é o único fato que ler texto prova bem (emenda sessão 60). O
  // botão "+ dias fora" foi apagado da tela (Task 6) e a coluna "Lançado na
  // mão" também — o manual não pode continuar ensinando o que não existe mais.
  assert.ok(!/\+ dias fora/.test(admin), 'o manual não ensina mais o botão que foi apagado');
  assert.ok(!/Lançado na mão/.test(admin), 'a coluna que saiu da tela saiu do manual');
  ok('admin: nenhum rastro do botão "+ dias fora" nem da coluna "Lançado na mão"');
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
{
  // 31/08/2026: o Benny pediu a correção do e-mail de acesso do Bruno pelo
  // WhatsApp porque a tela mostrava o problema e não oferecia conserto. Agora
  // oferece — e o manual precisa dizer que o endereço errado não dá erro, só
  // nunca chega.
  exige(admin, 'manual-admin', {
    'alterar e-mail de acesso': 'Alterar e-mail de acesso',
    'trocar e-mail não mexe na senha': 'não muda a senha',
  });
  ok('admin: alterar o e-mail de acesso, e que isso não mexe na senha');
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
{
  // Pergunta do Rodrigo em 31/08/2026: "como faz pra saber a unidade e quem tá
  // escalado junto com você?". A resposta agora está na tela — e no manual.
  exige(prof, 'manual-professores', {
    'unidade do dia': 'em qual unidade',
    'quem mais está escalado': 'quem mais está escalado',
    'senha só chega no e-mail de acesso': 'nada chega',
  });
  ok('professor: onde ele trabalha, quem está junto e por que a senha pode não chegar');
}

// ─── Integridade: âncoras que a Ajuda do app usa ───
{
  // O item ❓ do menu abre o manual numa âncora. Âncora que some vira link morto.
  // 03/09/2026 — domingo fora da escala, "Minhas datas" pra gestão que dá aula,
  // e criar ficha de professor pra quem já tem login.
  exige(admin, 'manual-admin', {
    'domingo não tem escala': 'não abre no domingo',
    'evento em domingo continua valendo': 'Evento</strong> continua livre em domingo',
    'a aba da gestão que dá aula': 'Minhas datas',
    'criar ficha pra quem já tem login': 'Criar ficha de professor',
  });
  ok('admin: domingo fora da escala, "Minhas datas" e criar ficha de professor');
}
{
  exige(prof, 'manual-professores', {
    'domingo não tem escala': 'Domingo não tem escala',
  });
  ok('professor: domingo não tem escala');
}
{
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
