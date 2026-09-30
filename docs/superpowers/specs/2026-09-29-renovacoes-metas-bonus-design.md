# Renovações, metas e bônus — especificação geral (A · B · C)

**Data:** 29/09/2026 · **Pedido por:** Rodrigo (dois documentos em `docs/290926/`) · **Decisões de produto:** Rafael
**Substitui em parte:** `2026-09-10-meta-sugerida-pelo-sistema-design.md` — o que não for dito aqui continua valendo de lá.

---

## 0. O que foi decidido antes de escrever

| # | Decisão | Quem · quando |
|---|---|---|
| 1 | Uma especificação só para os dois documentos do Rodrigo, porque as três partes usam as mesmas definições | Rafael · 29/09 |
| 2 | Construção **em sequência A → B → C**; cada parte é homologada no staging antes da próxima começar | Rafael · 29/09 |
| 3 | **A parte C (quanto se paga) só começa depois de o Rodrigo responder as perguntas da seção 7** e dizer a partir de que mês vale. As perguntas vão para ele **agora**, para a resposta chegar enquanto A e B são construídas | Rafael · 29/09 |
| 4 | Mudar o `commission.js` exige autorização explícita do Rafael (regra 1 do CLAUDE.md). A e B **não tocam** nele; só C toca | regra permanente |

**As três partes:**

- **A. Lista de renovações** — a tela onde as consultoras trabalham as renovações e as degustações do mês, montada sozinha todo dia a partir da Pacto.
- **B. Meta sugerida** — o sistema propõe Meta, Super, Gold e as travas de cada faixa; a gestão confirma. Os números propostos **não mudam pagamento** até a parte C.
- **C. Nova regra do bônus** — o bônus da unidade (P3) e o de conversão de voucher (P4) passam a obedecer as travas por faixa. **Bloqueada** pelas perguntas da seção 7.

---

## 1. Vocabulário comum — uma definição só para as três partes

Cada termo abaixo é calculado **num lugar só** (o módulo da parte A) e as partes B e C leem de lá. Isso evita
o que já aconteceu duas vezes neste projeto: a mesma conta copiada em dois lugares divergindo em silêncio.

| Termo | Definição | Quem calcula |
|---|---|---|
| **Renovação base do mês** | contrato renovável que vence entre o dia 1 e o último dia do mês M (Bloco 1 da lista) | parte A |
| **Base antecipável** | contrato renovável que vence entre os dias 1 e 15 de M+1 (Bloco 2) | parte A |
| **Degustação da lista** | plano `MÊS DEGUSTAÇÃO` que vence em M ou em 1–15 de M+1 (Bloco 3) | parte A |
| **Renovável** | o que sobra depois das exclusões da seção 3.2 (recorrente, crédito, avulso, permuta, teste, agregador…) | parte A |
| **Ativação, novo/retorno, renovação, voucher** | **como hoje**, no `commission.js` (regime de caixa, contrato conta uma vez só, degustação grátis conta) | motor atual — não muda |
| **Antecipação realizada** | renovação **paga no mês M** de um contrato que estava na base antecipável de M | parte A marca, parte C conta |

⚠️ **"Renovação base" (quantas vencem) e "renovação" (quantas foram pagas) são coisas diferentes.** A primeira
sai da lista; a segunda continua saindo do motor de comissão. A trava de renovação da parte B é
`% × renovação base`; o que se confere contra ela, na parte C, é a contagem de renovações do motor.

---

## 2. De onde vêm os dados

### 2.1 A Previsão de Renovação da Pacto, pela API

Com as **credenciais por unidade** (29/09), o gateway da Pacto devolve a mesma tela "Previsão de Renovação"
que o Rodrigo usa hoje:

```
POST https://apigw.pactosolucoes.com.br/v2-indice-renovacao
corpo: { empresa: 1, dataInicial: <ms>, dataFinal: <ms>, retornarContratos: true }
resposta: content.jsonDados (texto JSON) → contratosPrevisaoMes, …RenovadosPrevisaoMes,
          …NaoRenovadosPrevisaoMes, …RenovadosDentroMes, …Tolerancia…, …Total
cada contrato: nomeCliente, situacaoCliente, matriculaCliente, codigoCliente, codigoContrato
```

Medido em 29/09 para outubro: **CP 72 · PP 42**, antes das exclusões.

A lista do mês M faz **duas consultas por unidade**: mês M inteiro e 1–15 de M+1.

### 2.2 O que a Previsão não traz, e de onde sai

| Falta | Fonte | Observação |
|---|---|---|
| nome do plano, início, vencimento | `consultarContratos?cliente={codigoCliente}` no núcleo (já usado pela busca diária) → `nomePlano`, `vigenciaDe`, `vigenciaAteAjustada` | uma consulta **por contrato novo**; o resultado vai para o caderninho `pacto_contratos`, e o mesmo contrato nunca é perguntado de novo |
| plano original de uma `IMPORTAÇÃO` | o **nosso próprio histórico do TecnoFit** (itens de `periodos` do mesmo cliente) | em 10/09, os 5 casos do CP tinham o plano legível ali. Sem achar → Bloco 4 "Verificar manualmente" |
| consultora | PP: `pacto_consultoras` (quem lançou o contrato). CP e o que faltar: **a vendedora do contrato original no nosso histórico**. Sem nenhuma → "Sem consultora", a gestão atribui | o CP não tem consultora na API (pendência aberta com a Pacto) |
| já renovou? | as listas `…RenovadosPrevisaoMes` / `…RenovadosDentroMes` da própria Previsão | o sistema marca, a consultora não precisa |

❓ **A conferir na primeira tarefa da construção (A1), antes de escrever o resto:**
1. se as degustações aparecem na Previsão de Renovação. Se não aparecerem, o Bloco 3 sai das degustações
   vendidas que estão no nosso histórico (o fim do voucher é legível no nome do item, como o P4 já faz);
2. se `matriculaCliente` é o CPF do aluno. O exemplo do documento (`31754162118`) tem 11 dígitos. **Se for
   CPF, não é gravado nem mostrado** — a lista mostra o `codigoCliente` no lugar. Nenhum CPF entra no banco,
   como em todo o resto da integração.

### 2.3 As credenciais

- Duas credenciais novas no Secret Manager: `PACTO_API_KEY_CP` e `PACTO_API_KEY_PP` — **staging primeiro**,
  produção só depois da homologação. Hoje estão só em `pacto-credencial-cp.txt` / `-pp.txt`, fora do git.
- A busca diária e o Termômetro **continuam** com a credencial antiga. Nada do que está no ar muda.
- O cliente HTTP ganha **uma rota nova e só ela**: `v2-indice-renovacao`. Nenhuma rota que grava entra no
  arquivo (a credencial "Comissões" da Pacto permite apagar cliente; estas duas foram pedidas "só consultar",
  mas o código não depende disso).

---

## 3. Parte A — Lista de renovações

### 3.1 Onde vive

| Peça | O que faz |
|---|---|
| **`renovacoes-lista.js`** (novo, puro, sem Firebase nem tela) + gêmeo em `functions/` com teste que falha se divergirem | classifica cada plano, monta os blocos, numera, junta duplicados, calcula o painel, os alertas e o resumo de exclusões, e confere se a soma bate com o total da Pacto |
| **Cloud Function `montarListaRenovacoes`** | roda todo dia às **5h** (depois da busca das 4h) e pelo botão "Atualizar agora" (só admin). Busca a Previsão, completa os contratos novos, chama o módulo e grava |
| **`renovacoes.html` + `renovacoes.js`** (novos) | a tela. Nenhuma conta mora nela — só lê o que a Function gravou e grava o que a consultora preenche |

Padrão igual ao do Termômetro: página separada, porque o `index.html` não é tocado sem autorização. O atalho
no menu lateral **exige mexer no `index.html`** — vai ser pedido ao Rafael na hora, como foi no Termômetro.

### 3.2 A classificação (na ordem do documento do Rodrigo)

1. **Plano real:** o nome do plano; se for `IMPORTAÇÃO`, o plano original do TecnoFit (mostrado
   `IMPORTAÇÃO → [plano original]`); sem plano original → Bloco 4.
2. **Excluir** (não aparece para a consultora, não conta): nome com `RECORRENTE`, `PERSONAL EXTERNO`,
   `CRÉDITO`, `AVULSO`, `PACOTE`, `DIÁRIA`, `PERMUTA`, `CORTESIA`, `COLABORADOR`, `FUNCIONÁRIO`, `TESTE`,
   `WELLHUB`, `GYMPASS`, `TOTALPASS`. Casamento **por palavra inteira**, sem acento e sem diferença de
   maiúscula — foi o que evitou apagar uma ESTEFANE de verdade no caso do `TESTE` ([[registro-de-teste-nao-e-venda]]).
   `MENSAL` sem `RECORRENTE` **não** é excluído.
3. **`MÊS DEGUSTAÇÃO`** → Bloco 3.
4. **O resto é renovação** → Bloco 1 ou 2 pelo vencimento. Plano **Econômico** ganha a etiqueta
   "Sem desconto de renovação".
5. **Limpeza:** mesmo aluno duas vezes → fica o vencimento mais próximo, com nota. Aluno que a Pacto já dá
   como renovado → fica na lista com **Renovou? = Sim (sistema)** e "Renovado em [data]".

A lista de palavras mora no módulo, num lugar só, com teste para cada uma.

### 3.3 Os blocos e o painel

Exatamente como o documento do Rodrigo, seções 4 e 7:

- **Bloco 1** Renovações do mês · **Bloco 2** Antecipação até dia 15 (numeração continua a do Bloco 1) ·
  **Bloco 3** Degustações (numeração própria) · **Bloco 4** Verificar manualmente (**só a gestão vê**) ·
  **Resumo de exclusões** por motivo (**só a gestão**, recolhido).
- **Painel no topo**, por unidade: total a renovar (= Bloco 1, o número oficial), antecipação, degustações;
  renovados / não renovados / em negociação / pendentes por bloco; taxa de renovação (renovados ÷ Bloco 1);
  conversão de degustação; total por consultora.
- **Metas do mês** no painel: lidas de `periodos/{unidade}_{mês}.metasMensais`. **Mês sem meta mostra
  "meta ainda não definida"** — nunca copia do mês anterior (pedido explícito do Rodrigo).
- **Conferência da soma** (só a gestão): Blocos 1+2+3+4 + excluídos = total da Previsão nos dois períodos.
  Se não bater, aparece em vermelho com a diferença — é o sinal de que alguma regra engoliu registro.

### 3.4 O que a consultora preenche

Colunas e validações exatamente como a seção 5 do documento: plano alvo, data do 1º contato, Renovou?
(`Pendente · Em negociação · Sim · Não`), plano fechado, motivo (a lista fixa de 10), observações; nas
degustações, o acompanhamento semanal (4 datas) e Converteu?.

- **Plano alvo e plano fechado:** lista suspensa com os planos **vendidos na unidade nos últimos 90 dias**
  (do caderninho de contratos). A Pacto não tem, pelo que foi visto, uma consulta de "planos vigentes" — se
  a A1 achar uma, ela substitui esta regra.
- **Validações na tela, pelo módulo puro** (não na tela solta): Renovou ≠ Pendente exige data do contato; Sim
  exige plano fechado; Não exige motivo; motivo "Outro" exige observação; data do contato não pode ser futura.

### 3.5 Onde fica gravado — e por que a virada de mês não perde nada

Duas coleções, separadas de propósito:

| Coleção | Chave | Quem grava | O que tem |
|---|---|---|---|
| `renovacoes_lista` | `{CP\|PP}_{AAAA-MM}` | **só a Cloud Function** | os blocos do mês com os campos do sistema, o painel, os alertas e a conferência |
| `renovacoes_acompanhamento` | `{CP\|PP}_{codigoContrato}` | **a consultora e a gestão**, pela tela | os campos da consultora e a consultora atribuída pela gestão |

O acompanhamento é **por contrato, não por mês**. Um contrato que estava no Bloco 2 de outubro e vira Bloco 1
de novembro **é o mesmo documento** — a virada leva tudo o que foi preenchido sem copiar nada. E a Function,
que reescreve a lista todo dia, **não tem como apagar** o que a consultora escreveu, porque escreve em outra
coleção. É a regra "nunca sobrescreva os campos das consultoras" garantida pela estrutura, não por cuidado.

**"Renovou?" do sistema × da consultora:** o sistema grava `renovouSistema` na lista; a consultora grava
`renovou` no acompanhamento. A tela mostra **Sim** se qualquer um dos dois disser Sim. Se ela marcou **Não** e
a Pacto diz que renovou, aparece o alerta "a Pacto registra renovação — conferir".

**Quais meses existem:** a Function mantém sempre o mês corrente e, **a partir do dia 25**, também o seguinte —
assim a lista de novembro já está pronta quando outubro acaba (o documento pede "gerada no fim do mês M").
Mês passado **não é mais reescrito**: fica como estava no último dia, como registro.

### 3.6 Quem vê e quem mexe

| | vê | grava |
|---|---|---|
| **Consultora** (perfil `vendedor`) | Blocos 1, 2 e 3 das unidades dela (`allowedUnits`), com filtro "só as minhas" | só os campos dela no acompanhamento |
| **Supervisão e admin** | tudo, inclusive Bloco 4, exclusões e conferência | também a consultora atribuída e o bloco correto dos registros do Bloco 4 |

As regras do Firestore limitam **quais campos** cada perfil pode alterar no acompanhamento (lista fechada de
campos por perfil). A lista tem nome de aluno; a consultora já vê nome de cliente nas vendas dela hoje, então
não é exposição nova. **Nenhum valor em dinheiro entra na lista.**

### 3.7 Alertas (seção 7 do documento)

🔴 vence em até 7 dias sem data do 1º contato · 🔴 venceu há mais de 7 dias e segue Pendente ou Em negociação ·
🟠 degustação sem acompanhamento registrado na semana corrente · 🟠 registro no Bloco 4 há mais de 3 dias ·
🟠 consultora marcou Não e a Pacto registra renovação. Calculados no módulo, com a data de hoje em São Paulo.

---

## 4. Parte B — Meta sugerida

O desenho de 10/09 continua valendo no que não é mudado aqui: módulo puro **`metas-sugeridas.js`**, meta
gravada com `origem: 'sistema'`, **o recibo do mês não sai enquanto a gestão não revisar**, aviso na home,
mês que já tem meta nunca é tocado, mês passado com dado parcial é pulado.

### 4.1 O que muda com o documento do Rodrigo

| Campo | Desenho de 10/09 | Agora |
|---|---|---|
| `meta` | média das ativações dos 6 meses completos | **decidido por backtest** (4.2) entre a média de 6 meses e a fórmula dele |
| `superMeta` · `metaGold` | meta × 1,15 · × 1,30 | igual — é o que o documento dele diz também |
| **renovação** | média × fator recente, **um número só** | **por faixa:** Bloco 1 da lista × **65% / 70% / 75%**, arredondado para cima |
| **novos/retorno** | média × fator recente | **por faixa:** 35% da Meta · 38% da Super · 40% da Gold, arredondado para cima — o **piso** da faixa dele. O porquê mostra a faixa inteira para a gestão subir se quiser |
| **antecipação** | não existia | **nova:** Meta 0 · Super **25%** · Gold **45%** do Bloco 2, arredondado ao inteiro mais próximo (14 → 4 e 6, como no exemplo dele) |
| **voucher** | média × fator recente | **continua assim** até o Rodrigo dizer o que é a "base de vouchers" (pergunta 3). Com a resposta, passa a ser por faixa |
| **conversão de voucher** | não existia | Meta 30% · Super 40% · Gold 50% dos vouchers do funil — **só mostrada** até a parte C |
| mínimo individual | repete o último | igual; o mínimo **por pessoa** (18/12/ramp-up) é parte C |

**Por que o piso nos novos/retorno:** é a única trava dura hoje (abaixo dela o bônus zera). O desenho de 10/09
já registrou o erro de pôr uma trava dura na linha exata do realizado.

**Base pequena:** trava nunca maior que a própria base (3 renovações vencendo → a trava da Gold é no máximo 3),
como o documento pede ("evitar travas impossíveis").

**Onde a renovação base vem da lista:** a proposta é feita no **dia 1º do mês**, com a lista daquele dia. A
lista cresce durante o mês (mensais entram quando são vendidos), mas a meta **não é recalculada** — a meta
planejada é a do começo do mês, como o documento separa na seção 13.

### 4.2 O backtest antes de adotar a fórmula dele

A fórmula do documento é *50% mês anterior · 25% média de 2–3 meses · 15% mesmo mês do ano anterior · 10%
ajuste*. Em 10/09 o "mesmo mês do ano anterior" foi a **pior** régua medida (erro de 24,5 ativações no CP e
21,3 no PP, contra 13,0 e 8,3 da média de 6 meses). Mas com peso de 15% ele pesa pouco, e a combinação pode
se sair bem.

**Primeira tarefa da parte B:** rodar as duas réguas no mesmo backtest (para prever o mês M, só dado de meses
anteriores a M) e **adotar a que errar menos nas duas unidades**. Os "10% de ajuste" são a revisão da gestão,
que já é obrigatória. O resultado vai para o Rodrigo com os números, do mesmo jeito que a resposta de 10/09.

A mesma consulta da Previsão aceita datas passadas, então dá para medir também as travas de renovação por faixa
contra os meses já fechados (quantas vezes a unidade teria batido 65%/70%/75%).

### 4.3 Onde fica gravado

Os campos novos entram em `metasMensais`, ao lado dos atuais, que **não mudam de nome**:

```
metasMensais: {
  meta, superMeta, metaGold,                      // como hoje
  minNovos, minRenov, minVoucher,                 // como hoje = trava da faixa Meta
  minNovosSuper, minNovosGold,                    // novos
  minRenovSuper, minRenovGold,
  minVoucherSuper, minVoucherGold,
  minAntecipSuper, minAntecipGold,
  metaConversao, superConversao, goldConversao,
  minAtivacoesIndivP3,
  origem: 'sistema' | 'gestao', revisadaPor, porque: { … }
}
```

**Até a parte C entrar, o motor só lê os campos de sempre.** Os novos aparecem na tela de metas, no painel da
lista e no Termômetro como "regras do jogo", mas não mudam um centavo. A tela de metas **diz isso** enquanto
for verdade — número de trava na tela que não trava nada é o tipo de coisa que gera cobrança no dia 15.

⚠️ A tela "Configurar Metas do Mês" já abriu com metas de outro mês e gravou por cima
([[janela-metas-grava-padrao]]). Os campos novos entram nela **com esse defeito resolvido antes**.

---

## 5. Parte C — Nova regra do bônus (BLOQUEADA até as respostas da seção 7)

O que está escrito aqui é a **proposta**; os números e o comportamento em cada ponto marcado com a pergunta
correspondente mudam conforme o Rodrigo responder.

### 5.1 A regra nova, como o documento descreve

```
bateu o total da faixa + todas as travas da faixa  → bônus integral
bateu o total da faixa + falhou 1 trava            → 50% do bônus
bateu o total da faixa + falhou 2 ou mais          → zera
não bateu o total                                   → sem bônus
```

Travas da faixa: novos/retorno, renovação, voucher e (Super e Gold) antecipação.

**Proposta para a pergunta 2 (a faixa de cima falha, a de baixo passa):** o sistema calcula as três faixas e
**paga a que der mais**. Exemplo: bateu o total da Gold, falhou 2 travas da Gold (zera), mas cumpriu tudo da
Super → recebe a Super inteira. Sem isso, bater a Gold pode pagar menos que parar na Super.

### 5.2 Como entra no motor sem mexer no passado

- A regra nova vira um **regime com data de início**: `regraP3: 'travas_por_faixa'` gravado na meta do mês. Mês
  sem o campo segue a regra de hoje (novos zera, renovação ×0,70, voucher ×0,85). **Recalcular ou re-subir
  agosto ou setembro nunca muda o valor deles.**
- Uma função só no `commission.js` decide o bônus; o Termômetro, o simulador "E se" da vendedora e o recibo
  continuam chamando a mesma. O gêmeo em `functions/` segue o teste de igualdade que já existe.
- Mínimo individual por pessoa (pergunta 5): `minIndivPorVendedora: { NOME: n }` na meta do mês; quem não
  estiver lá usa o `minAtivacoesIndivP3` da unidade, como hoje.
- Conversão de voucher (P4): hoje tem Meta e Super (30% e 37,5%, pool de R$ 150 e R$ 300). Passa a ter as três
  faixas do documento (30/40/50%) — **o valor do pool da Gold é pergunta 6**.

### 5.3 O que o documento pede e **já é assim** hoje

- Venda de sócio conta para a meta da unidade, não comissiona e não entra no rateio (`naoComissionaveis`).
- Mínimo individual só decide quem entra no rateio; abaixo dele a pessoa recebe a comissão normal.
- Estorno não conta (registro de estorno da gestão, sessão 62).

---

## 6. Ordem de construção

Cada linha termina com teste passando; cada parte termina com **homologação no staging pelo Rafael** antes
da seguinte. Produção só com OK explícito, e as duas portas (GitHub Pages pelo `main` **e** Firebase) são
conferidas no fim ([[producao-tem-duas-portas]]).

| | Tarefa | Depende de |
|---|---|---|
| **A1** | Conferir na API: degustação na Previsão? matrícula é CPF? existe consulta de planos vigentes? Consultar a Previsão de um mês passado para ter um gabarito | credenciais por unidade (já existem) |
| **A2** | Módulo `renovacoes-lista.js` com testes: classificação (cada palavra), blocos, numeração, duplicado, já renovado, importação, conferência da soma, alertas, validações | A1 |
| **A3** | Rota nova no cliente da API + credenciais no Secret Manager do staging + Function `montarListaRenovacoes` + regras das duas coleções | A2 |
| **A4** | Tela `renovacoes.html` (consultora e gestão) | A3 |
| **A5** | Homologação no staging: outubro real das duas unidades, conferido contra a Previsão da Pacto na tela, e o PDF de maio do Rodrigo como gabarito de classificação. Pedir ao Rafael o atalho no menu | A4 |
| **B1** | Backtest: média de 6 meses × fórmula do Rodrigo; travas por faixa contra meses fechados. Resultado ao Rodrigo | A5 (usa a base da lista) |
| **B2** | `metas-sugeridas.js` com as regras da seção 4 + testes | B1 |
| **B3** | Consertar a tela de metas ([[janela-metas-grava-padrao]]) e acrescentar os campos novos, com o aviso "ainda não muda o pagamento" | B2 |
| **B4** | Proposta automática no dia 1º, trava do recibo, aviso na home (desenho de 10/09) | B3 |
| **B5** | Homologação no staging | B4 |
| **C1** | **Só com as respostas do Rodrigo e autorização para mexer no `commission.js`.** Regime novo no motor + P4 com Gold + mínimo por pessoa, com testes que provam que agosto e setembro não mudam | respostas |
| **C2** | Termômetro, simulador e recibo mostrando a regra nova; manuais atualizados | C1 |
| **C3** | Homologação no staging com um mês inteiro recalculado nas duas regras, lado a lado, para o Rodrigo ver a diferença em reais antes de valer | C2 |

A meta de **outubro** continua sendo definida à mão pela gestão: nada disto fica pronto antes de 15/10.

---

## 7. Perguntas para o Rodrigo (enviar agora)

Em linguagem da academia, para o Rafael mandar. Cada uma diz o que acontece se ficar sem resposta.

1. **A partir de que mês vale a regra nova do bônus** (50% com uma trava falhando, zera com duas)? *Sem
   resposta: o bônus segue a regra de hoje.*
2. **Se a unidade bate o total da Gold mas falha duas travas da Gold, e cumpriu tudo da Super, ela recebe a
   Super inteira?** Nossa proposta é pagar a faixa que der mais. *Sem resposta: não dá para programar a regra.*
3. **O que é a "base de vouchers"?** Quantos vouchers foram entregues aos alunos? Quantas degustações estão
   ativas? *Sem resposta: a trava de voucher segue calculada como hoje, pela média dos meses anteriores.*
4. **O documento diz "venda zerada não conta", mas combinamos em 29/09 que a degustação grátis (R$ 0) conta
   como voucher e ativação.** Confirma que a degustação grátis continua contando? *Sem resposta: continua
   contando, como está no ar.*
5. **Mínimo individual por pessoa:** quais vendedoras são 30h e quais estão em ramp-up? A gestão vai digitar o
   mínimo de cada uma na tela de metas todo mês — tudo bem? *Sem resposta: um mínimo só por unidade, como hoje.*
6. **Bônus de conversão de voucher na Gold:** hoje o pool é R$ 150 (Meta) e R$ 300 (Super). Quanto é na Gold?
   E a Super passa de 37,5% para 40% dos vouchers, como o documento diz?
7. **"Contrato com início em até 30 dias"**: hoje a ativação conta no mês em que o dinheiro entra, sem olhar a
   data de início. Quer que contrato com início daqui a mais de 30 dias fique para o mês do início?
   *Sem resposta: continua como hoje.*
8. **Fórmula da meta:** vamos medir a sua (50/25/15/10) contra a média dos últimos 6 meses nos meses já
   fechados e usar a que errar menos. De acordo? (Em 10/09 o "mesmo mês do ano anterior" foi o que mais errou,
   porque a academia cresceu e a sazonalidade de 2025 sumiu em 2026.)

### 7.1 Respostas do Rodrigo (29/09) — e o que cada uma muda

| # | Resposta | O que muda |
|---|---|---|
| 1 | Regra nova **vale em outubro, pago em novembro**; setembro fica nas regras atuais | a parte C ganha **prazo**: em produção e homologada antes da folha de outubro. `regraP3` gravado a partir de `2026-10` |
| 2 | **Os mínimos são os mesmos para Meta, Super e Gold**; só o total de ativações sobe | ❗ desfaz as "travas por faixa" do documento dele. Um conjunto só de mínimos (o da Meta): renovação 65% da base, novos/retorno 35–40% da meta, voucher. **A trava de antecipação some** (na Meta ela é zero). A pergunta 2 deixa de existir: bateu a faixa + mínimos → 100%, 1 falha → 50%, 2+ → zera |
| 3 | Voucher é distribuído **a todos os alunos ativos, todo mês: ~250 por unidade** | ⚠️ o "35–50% da base" do documento daria **88 a 125 degustações** por mês — o Campeche ativou 14 em agosto. A porcentagem não pode ser sobre os 250. **Proposta:** a trava de voucher continua como hoje (média dos meses anteriores × fator recente), com os alunos ativos mostrados só como contexto. Levar ao Rodrigo com o número |
| 4 | Degustação grátis **continua contando** | nada muda |
| 5 | CP: **Erica full-time, Fran 30h** · PP: **Kali full-time, Isa 30h** | mínimo individual por pessoa: full-time 18, 30h 12 (hoje é 10 no CP e 7 no PP para todas). Medir com agosto/setembro quem teria ficado fora do rateio antes de valer |
| 6 | Pool da conversão de voucher na Gold: **"decida por mim"** | **Proposta:** degraus de 30% / 40% / 50% dos vouchers do funil, pool de **R$ 150 / R$ 300 / R$ 450** (o mesmo passo de R$ 150), com mínimo absoluto de 3 / 4 / 5 conversões. Decisão do Rafael |
| 7 | Contrato que começa depois de 30 dias: **a ativação é do mês do início** | 🚨 é a volta do **diferimento**, encerrado em 09/09 porque **nunca pagou ninguém** (R$ 6.318,17 e 91 ativações sumidas desde jan/2025 — [[diferimento-nunca-pagou]]). **Proposta:** só a **contagem da ativação** vai para o mês do início; a **comissão em dinheiro fica no mês em que o dinheiro entrou** (regime de caixa). E a contagem é feita pelo sistema, sem depender de alguém re-subir arquivo — foi exatamente aí que o diferimento antigo quebrou. Decisão do Rafael |
| 8 | Testar as duas fórmulas de meta e ficar com a melhor: **pode ser** | backtest da parte B segue como escrito |

**Consequência na ordem:** a parte C tem data (folha de outubro, paga em novembro) e a parte A não.
Proposta: **C primeiro**, A em seguida, B por último — a meta de outubro continua sendo definida à mão pela
gestão, já no formato de um conjunto só de mínimos.

---

## 8. Casos de borda

| situação | o que acontece |
|---|---|
| a Pacto falha ou recusa a credencial às 5h | a lista do dia anterior continua na tela, com "atualizada em [data]" e o motivo; **nunca** vira lista vazia |
| a Previsão devolve lista vazia com sucesso (já aconteceu com a credencial da Administração) | tratado como falha se o mês anterior tinha registros; a lista antiga fica |
| contrato sai da Previsão (cancelado, transferido) | some da lista do dia; o acompanhamento fica guardado e reaparece se o contrato voltar |
| consultora preencheu e o contrato mudou de mês de vencimento | o acompanhamento vai junto (é por contrato) |
| importação sem plano original | Bloco 4, fora de toda contagem, até a gestão classificar; a classificação da gestão fica gravada e vale nos dias seguintes |
| unidade com 0 renovações vencendo | trava de renovação 0; a tela diz "sem renovações vencendo neste mês" |
| mês sem meta definida | o painel diz "meta ainda não definida" e não mostra travas |

---

## 9. Testes

Escritos antes do código, nos módulos puros, e chamando as funções — não lendo o texto do arquivo
([[previa-nunca-rodou]]). Arquivos com CRLF: recorte por assinatura, nunca por `'\n    }\n'`.

| | o que prova |
|---|---|
| exclusões | cada palavra da 3.2 exclui; `MENSAL` sem `RECORRENTE` não; palavra dentro de nome de pessoa não |
| importação | classifica pelo plano original; sem plano → Bloco 4 |
| blocos e numeração | Bloco 2 continua o 1; Bloco 3 recomeça em 1; ordem por vencimento |
| duplicado | fica o vencimento mais próximo, com nota |
| já renovado | aparece como Sim (sistema) e conta como renovado |
| conferência | Blocos + excluídos = total da Pacto; diferença aparece |
| virada de mês | o que foi preenchido no Bloco 2 de outubro aparece no Bloco 1 de novembro |
| a Function não apaga | reescrever a lista não altera nenhum acompanhamento |
| regras do Firestore | consultora grava só os campos dela; não grava a lista; supervisão atribui consultora — provado por REST, não pelo Admin SDK |
| CPF | nenhum CPF gravado em nenhuma das coleções |
| travas por faixa (B) | 65/70/75%, piso dos novos, 25/45% da antecipação, trava nunca maior que a base |
| backtest (B) | walk-forward, só meses anteriores ao previsto |
| regime do bônus (C) | agosto e setembro recalculados dão **o mesmo valor de hoje**; mês com o regime novo paga 100/50/0 e escolhe a melhor faixa |

Depois de cada parte: homologação contra o Firestore real do staging, devolvendo o banco como estava, no padrão
de `homologar-conferencia-pelo-pagamento.js`.

---

## 10. O que esta especificação NÃO faz

- não muda o cálculo de comissão por venda (P1, P2) nem o regime de caixa;
- não mexe no pagamento **antes da parte C**, e a parte C não começa sem as respostas;
- não recalcula a meta no meio do mês (projeção de fechamento, seção 13 do documento): o Termômetro já mostra
  o andamento, e revisar a meta continua sendo decisão da gestão na tela de metas;
- não faz ajuste por clima nem por equipe na conta: entra pela revisão obrigatória da gestão, como decidido
  em 10/09;
- não exporta a lista em PDF — ela passa a ser a tela; se o Rodrigo sentir falta, é uma entrega pequena depois;
- não usa as credenciais por unidade para a busca diária de vendas — isso segue como está.
