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
  // Sessão 64 (07/09/2026): o fechamento deixou de ser por unidade e a tela
  // ganhou a conferência em seis blocos. Manual que descreve a tela antiga é
  // pior que manual nenhum — manda a gestão procurar um seletor que sumiu.
  exige(admin, 'manual-admin', {
    'o fechamento cobre as duas unidades': 'academia inteira',
    'cada pessoa aparece uma vez só': 'uma vez só',
    'o custo por unidade é rateio': 'rateio',
    'toda troca aberta trava o fechamento': 'trava o fechamento',
    'a gestão pode confirmar sem esperar o professor': 'Confirmar mesmo assim',
    'a tela é só do admin, nem supervisão entra': 'nem a supervisão',
    'ocorrência não lançada deixa as horas altas': 'ninguém lançou',
    'ninguém é avisado do saldo de horas': 'Ninguém é avisado',
  });
  ok('admin: fechamento por pessoa/mês, o rateio, a trava e o saldo que ninguém avisa');
}
{
  // Sessão 69 (09/09/2026): a comissão virou regime de CAIXA e a conferência de
  // vendas passou a partir do pagamento. Até aqui o manual dizia "nada mudou pra
  // operação de vendas" — três meses atrás da realidade, na parte que mais mexe
  // com dinheiro.
  exige(admin, 'manual-admin', {
    'a comissão é do mês em que o dinheiro entrou': 'mês em que o',
    'a folha é paga no dia 15 do mês seguinte': 'dia 15 do mês seguinte',
    'cada contrato paga uma vez só': 'uma vez só',
    'o mês começa vazio e vai enchendo': 'vai enchendo',
    'a aba A receber precisa do relatório de vendas': 'Faturamento por Período',
    'as duas listas se distinguem pelo mês': 'meses anteriores',
    'a venda paga sai da lista sozinha': 'sai da lista sozinha',
    'os três desfechos da dúvida': 'Não é este pagamento',
    'cliente desistiu é o único sem pagamento na mesa': 'Cliente desistiu',
    'um pagamento não explica duas vendas': 'não explica duas vendas',
    'o dinheiro sempre ganha da marcação': 'dinheiro sempre ganha',
    'marcação nenhuma paga comissão': 'Quem paga é o dinheiro',
  });
  ok('admin: regime de caixa, a aba "A receber" e a conferência pelo pagamento');
}
{
  // 23/09/2026: termômetro em produção; o "até" do quadro passou a ser o dia dos
  // dados (o Rafael leu a data do upload como cobertura); e a vendedora sai do
  // Consultor da Pacto, que em aluno migrado veio com o Rodrigo.
  exige(admin, 'manual-admin', {
    'o termômetro existe': 'Termômetro do mês',
    'ele se atualiza sozinho de madrugada': 'toda madrugada',
    'é prévia, a oficial é o upload': 'prévia',
    '"até" é o último dia do relatório': 'último dia que',
    'o arquivo de vendas tem que ser do mês inteiro': 'mês inteiro',
    'de onde sai a vendedora': 'Consultor',
    'aluno migrado veio com o Rodrigo': 'TecnoFit',
  });
  ok('admin: termômetro, o "até" do quadro e de quem é cada venda');
}
{
  // 30/09/2026: a API da Pacto virou a fonte oficial; a planilha, plano B.
  exige(admin, 'manual-admin', {
    'o botão existe': 'Atualizar pela Pacto',
    'os dados vão até ontem': 'até ontem',
    'dia faltando trava': 'Se faltar algum dia',
    'buscar de novo': 'Buscar de novo agora',
    'a planilha virou plano B': 'plano B',
    'só o primeiro pagamento do contrato': 'primeiro pagamento',
    'a vendedora é a consultora do aluno': 'consultora vinculada ao aluno',
  });
  ok('admin: "Atualizar pela Pacto", a trava dos dias e a planilha como plano B');
}
{
  // 30/09/2026 (fim da tarde): o padrão virou AUTOMÁTICO; o botão é gatilho pontual.
  exige(admin, 'manual-admin', {
    'a comissão se calcula sozinha': 'se calcula <strong>sozinha</strong>',
    'o aviso que aparece no painel': 'Atualizado automaticamente pela Pacto',
    'recibo emitido congela o mês': 'Mês congelado',
    'dia faltando não recalcula': 'último cálculo bom',
    'balcão não paga comissão': 'não paga comissão',
    'o botão é só para não esperar': 'esperar a madrugada',
    'dia sem a vendedora também trava': 'buscado sem a vendedora',
  });
  ok('admin: comissão automática, mês congelado com recibo, balcão fora da comissão');
}
{
  // 01/10/2026: os ajustes pedidos no grupo da gestão (Rafael Rojais, Vagner,
  // o "não podia dia 12") — troca na mão que mostra e avisa, escala em texto
  // pro WhatsApp e folga mínima configurável.
  exige(admin, 'manual-admin', {
    'a lista de troca mostra quem não pode': 'marcou Não posso',
    'quem entrou e quem saiu são avisados': 'quem entrou e quem saiu',
    'pessoa sem login é avisada por fora': 'avise por fora',
    'escala em texto pro grupo': 'Copiar a escala para o WhatsApp',
    // 06/10/2026: o botão ganhou destaque e passou a valer nas outras abas.
    'onde fica o botão': 'Vai mandar no grupo?',
    'texto do fim de ano': 'o período inteiro, por dia',
    'texto da Escola Interna': 'quem lidera',
    'convocação do evento': 'ainda não respondeu',
    'só entra o que está publicado': 'ainda não publicada',
    'folga mínima configurável': 'Sábados de folga entre uma escala e outra',
    'troca entre professores avisa a gestão': 'escalas próximas',
  });
  ok('admin: troca na mão que avisa, texto para o WhatsApp e folga mínima configurável');
}
{
  // 01/10/2026: trocar uma pessoa numa escala publicada apagava e recriava TODAS
  // as aulas do dia — e com elas o que a gestão tinha lançado nas outras.
  exige(admin, 'manual-admin', {
    'trocar uma vaga não mexe nas outras aulas do dia': 'só a aula da vaga que mudou',
  });
  ok('admin: trocar ou inverter refaz só a aula da vaga que mudou');
}
{
  // 01/10/2026: o que o professor "envia para a gestão" não chegava a ninguém —
  // 21 avisos parados em produção desde 26/08. Agora há lista, sino, alerta na
  // tela inicial e trava no fechamento.
  exige(admin, 'manual-admin', {
    'a tela onde a gestão responde': 'Avisos dos professores',
    'as respostas possíveis': 'Falta sem aviso',
    'o aviso não entra na folha sozinho': 'não entra na folha sozinho',
    'aviso sem resposta trava o fechamento': 'aviso sem resposta',
  });
  exige(prof, 'manual-professores', {
    'o professor fica sabendo da resposta': 'A gestão respondeu ao seu aviso',
  });
  ok('gestão: a tela Avisos dos professores; professor: fica sabendo da resposta');
}
{
  // 01/10/2026 (Rafael Rojais: "Teria como o sistema explicar o porquê a pessoa
  // está naquele dia?") — a explicação em frase, pra gestão e pro professor, e a
  // escala que passou a acompanhar a troca de professor confirmada.
  exige(admin, 'manual-admin', {
    'o porquê de cada vaga, em frase': 'Por que esta pessoa está neste dia',
    'a conta do mês: vagas × pessoas': 'vagas no mês',
    'a escala acompanha a troca confirmada': 'Troca entre professores',
  });
  exige(prof, 'manual-professores', {
    'o professor vê por que foi escalado': 'Por que estou neste dia',
  });
  ok('gestão e professor: o porquê de cada dia de escala, e a escala que acompanha a troca');
}
{
  // 01/10/2026: o campo pedia MINUTOS e o Theo digitou o horário ("14:05") — o
  // iPhone engolia calado. Agora a pessoa informa a hora e o sistema faz a conta.
  exige(prof, 'manual-professores', {
    'chegou atrasado ou saiu em outro horário': 'Cheguei às',
    'o sistema faz a conta dos minutos': 'faz a conta',
  });
  ok('professor: avisar atraso e saída pelo horário, não por minutos');
}
{
  exige(prof, 'manual-professores', {
    'aviso quando a gestão troca o dia': 'trocar você de dia',
    'aviso antes de registrar troca que cola escalas': 'escalas próximas',
  });
  ok('professor: aviso quando a gestão troca o dia e quando a troca cola duas escalas');
}
{
  // 01/10/2026: "Minhas horas do mês" — o professor corrige o mês numa tela só
  // e a gestão valida. Nasceu da lista de horas que o Theo mandou pelo WhatsApp.
  exige(prof, 'manual-professores', {
    'a tela de conferir o mês': 'id="minhas-horas"',
    'corrigir só o dia diferente': 'Mexa só nos dias que foram diferentes',
    'dia fora da agenda': 'Incluir este dia',
    'só vale depois de validado': 'só passa a valer depois que a gestão validar',
    'no lugar de um colega é troca': 'no lugar de um colega',
  });
  exige(admin, 'manual-admin', {
    'a tela da gestão': 'id="horas-do-mes"',
    'o OK geral': 'Validar todas',
    'devolver com motivo': 'Devolver',
    'fechar valendo a agenda': 'Fechar valendo a agenda',
    'lançar pela pessoa': 'Lançar as horas',
    'validar mexe nas aulas': 'Validar ajusta as próprias aulas',
    'trava o fechamento': 'Horas enviadas e não validadas travam o fechamento',
  });
  ok('professor confere as horas do mês; gestão valida, devolve ou fecha valendo a agenda');
}
{
  // 01/10/2026: a lista de renovações passou a conferir tudo na Pacto a cada
  // atualização (os 4 pontos que o Rodrigo levantou comparando com a Pacto).
  exige(admin, 'manual-admin', {
    'o card da lista': 'id="renovacoes"',
    'plano original pela observação': 'observação do contrato',
    'relido a cada atualização': 'Tudo é conferido de novo na Pacto a cada atualização',
    'vencimento com atestado': 'já com atestado ou trancamento',
    'consultora = vínculo': 'vínculo do aluno na Pacto',
    'sem ex-vendedora': 'já saiu da equipe',
    'quem já renovou': 'antes do mês',
    'aviso do que não foi conferido': 'aviso amarelo',
  });
  ok('lista de renovações: conferida na Pacto a cada atualização, consultora pelo vínculo, renovado antes do mês');
}
{
  // 04/10/2026: as respostas do Rodrigo — Horário Especial = Econômico, mensal em recorrência
  // renova sozinho (com conferência 1 dia depois) e quem já renovou sai da base dos 65%.
  exige(admin, 'manual-admin', {
    'horário especial': 'Horário Especial',
    'o mensal não renova sozinho (05/10/2026)': 'Mensal não renova sozinho',
    'o bloco dos que não renovaram': 'Recorrentes que não renovaram sozinhos',
    'um dia depois do vencimento': 'um dia depois do vencimento',
    'fora do número oficial': 'não entram no total a renovar',
    'base dos 65%': 'já chegou ao mês renovado sai da conta',
    'renovação automática fora da comissão': 'Renovação automática do plano recorrente não é venda',
    'o sinal é quem lançou': 'quem lançou o contrato',
    'mensalidade seguinte lançada à mão (05/10/2026)': 'mensalidade seguinte do mesmo plano recorrente também não é venda',
    'o que continua sendo venda': 'voltou depois de um intervalo',
  });
  ok('renovações: Horário Especial, o mensal fica na lista, bloco dos recorrentes que não renovaram e base dos 65%');
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
