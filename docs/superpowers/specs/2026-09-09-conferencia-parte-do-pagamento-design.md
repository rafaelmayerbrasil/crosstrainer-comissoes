# A conferência passa a partir do pagamento — desenho

**Data:** 09/09/2026 · **Pedido e corrigido por:** Rafael
**Substitui parte de:** `2026-09-07-conferencia-de-vendas-design.md`

---

## Por que mudar o que foi entregue anteontem

A tela de 07/09 pergunta **sobre a venda**: *"esta venda foi paga?"*, com três botões — *Já foi paga ·
Ainda a receber · Não vamos cobrar*. O Rafael olhou a tela em uso e apontou três coisas:

| o que ele disse | por que está certo |
|---|---|
| *"'Não vamos cobrar' não existe na prática"* | a academia não decide parar de cobrar; o que existe é o **cliente desistir** |
| *"'Ainda a receber' não faz sentido"* | é o estado em que a venda **já está**; o botão repetia o óbvio |
| *"'Já foi paga' deveria sair automaticamente"* | e sai — quando o sistema casa o contrato. O botão só faz falta quando ele **não** casa |
| *"ao apontar, teria que selecionar um pagamento dos registros"* | **elimina a marcação no vazio**: sem dinheiro real por trás, não há o que apontar |

A correção mais importante é de direção. O desenho anterior parte **da venda** e procura um pagamento
para ela — o que abre a porta para alguém marcar "paga" sem lastro nenhum. O novo parte **do
dinheiro**, que é o fato:

> O sistema casa sozinho. **Só quando fica em dúvida** — tem um pagamento na mão e não sabe de qual
> venda em aberto ele é — pergunta. E a pergunta é *"este pagamento é de qual venda?"*.

---

## A única forma de dúvida que existe

Vale fixar, porque o desenho inteiro gira em torno dela. A dúvida nasce sempre da mesma coisa:
**bateu o nome do cliente, não bateu o número do contrato.**

O caso real, da **CÁTIA TEREZINHA**:

| | |
|---|---|
| a venda | renovação, contrato **C7130**, R$ 2.388, fechada 27/08 — sem recebimento no próprio contrato |
| o pagamento | **R$ 199 em 12/08, contrato C6867** — o plano antigo dela |

São a mesma pessoa e contratos diferentes. O sistema não pode decidir sozinho: as duas (Cátia e
Amandha) de fato pagaram a renovação **em setembro, no contrato novo** — marcar "pago" sozinho teria
feito a gestão parar de acompanhar R$ 4.776.

---

## Os três estados da tela

### 1. Casou → não pergunta nada

O contrato da venda apareceu nos recebimentos. A venda sai da fila sozinha e mostra **"Pago em
03/09"**. É o que acontece com a esmagadora maioria — em agosto, 72 das 74 vendas do Campeche.
**Nada muda aqui.**

### 2. Em dúvida → pergunta, e a pergunta parte do pagamento

Aparece o pagamento e as vendas em aberto **daquela pessoa**:

```
💰 Pagamento de R$ 199,00 · 12/08/2026 · contrato C6867 · consultor FRANCINI
   Cliente: CÁTIA TEREZINHA PEREIRA TORRES

   De qual venda em aberto é este pagamento?

   ○ Renovação · contrato C7130 · R$ 2.388,00 · fechada 27/08
   ○ De nenhuma delas — é outra coisa
```

- escolher uma venda → ela sai da fila, com o pagamento apontado registrado;
- **"De nenhuma delas"** → o sistema **para de perguntar** por aquele pagamento. É o que o
  "Ainda a receber" tentava ser, agora no lugar em que a pergunta é de verdade.

⚠️ **A opinião do sistema continua ao lado da pergunta** (`VendasAguardando.opiniao`), com o porquê.
Ela opina; quem confirma é a pessoa. Isso não muda.

### 3. O cliente desistiu → some da fila

Se o cliente desiste, **nunca vai existir recebimento** — e a venda ficaria na fila para sempre. O
botão de **desistência/cancelamento** é a única marcação que não aponta dinheiro nenhum: ela diz que
aquele dinheiro não vem.

⚠️ Não é estorno. Estorno é devolver dinheiro que **entrou** e já pagou comissão — isso é
`estorno-comissao.js` e continua separado. Aqui a venda nunca foi paga, então não há comissão a
desfazer.

---

## Os botões, antes e depois

| antes (07/09) | depois |
|---|---|
| ✅ Já foi paga | **some** da venda sem pagamento — ela só aparece na tela de dúvida, apontando o pagamento |
| ⏳ Ainda a receber | **some** — é o estado padrão. Vira **"De nenhuma delas"** dentro da tela de dúvida |
| 🚫 Não vamos cobrar | vira 🚫 **Cliente desistiu / cancelou** |

Numa venda em aberto sem dúvida nenhuma, sobra **um botão só**: *Cliente desistiu / cancelou*. Todo
o resto é o sistema que resolve, com o dinheiro.

---

## O que a comissão faz: nada de novo

**A marcação nunca gera comissão.** Ela é via de explicação, não via de pagamento.

A comissão nasce sozinha do recebimento: quando o dinheiro aparece no relatório da Pacto, entra no
cálculo do mês, tenha alguém apontado alguma coisa ou não. É isso que torna o desenho seguro — não
existe caminho em que uma marcação humana faça dinheiro sair.

⚠️ **Um efeito que a tela precisa mostrar:** a comissão vai para quem está no **pagamento**, não para
quem está na **venda**. Nos dois casos reais os dois são a Francini, então bate. Mas se um dia a
venda for da Kali e o pagamento antigo estiver no nome da Francini, a tela tem que mostrar **os dois
nomes** — "venda de KALI · comissão paga a FRANCINI" — em vez de fingir que é um só.

---

## O que é gravado

Coleção `vendas_conferencia`, que já existe e já é **admin-only** provado por REST. **Zero registros
em produção hoje** — ninguém chegou a usar os botões —, então não há migração a fazer e os desfechos
antigos podem ser trocados sem dó.

**Quando a venda é explicada por um pagamento** — `{unitId}_{contrato}`:

```
desfecho: 'paga'
pagamentoApontado: { codigo, contrato, valor, data, vendedor, cliente }
observacao, por, porUid, em, emTs
```

**Quando o cliente desistiu** — mesmo documento, `desfecho: 'cancelada'`, sem `pagamentoApontado`.

**Quando o pagamento não é de venda nenhuma** — `{unitId}_pg-{codigo}`:

```
tipo: 'pagamento'
desfecho: 'sem_venda'
observacao, por, porUid, em, emTs
```

---

## As travas

**1. Um pagamento explica uma venda só.** Antes de gravar, o sistema lê as conferências da unidade e
recusa se aquele pagamento já estiver apontado em outra venda, dizendo qual é. É essa trava que
impede o mesmo dinheiro de explicar dois contratos.

> A checagem é **em memória**, lendo as conferências da unidade (são poucas dezenas), não por
> consulta com filtro composto. Índice novo do Firestore já derrubou Comissões uma vez, e aqui não
> paga o próprio custo.

**2. O dinheiro sempre ganha.** Regra que já existe e continua: se o contrato aparecer nos
recebimentos, ele é pago — mesmo que alguém tenha marcado "cliente desistiu". A tela **diz** que
havia marcação em contrário. É o que impede esta tela de mentir.

**3. Só Admin escreve.** Já está na regra do banco, não só na tela.

---

## Os dois ajustes de leitura, já aprovados

**Os títulos passam a dizer o mês.** Hoje os dois blocos descrevem a mesma situação e a diferença
(de que mês é a venda) não aparece em lugar nenhum:

| hoje | depois |
|---|---|
| 🕰️ 8 venda(s) arrastando de meses anteriores | 🕰️ **8 vendas de meses anteriores ainda sem pagamento** — *as mais atrasadas; é aqui que a cobrança começa* |
| ⏳ 4 venda(s) fechada(s) sem pagamento identificado | ⏳ **4 vendas de setembro ainda sem pagamento** — *fechadas neste mês; muitas nem venceram* |

**O bloco de cima ganha os mesmos botões.** Hoje ele diz *"São estas que merecem conversa"* e não
oferece nenhum botão — para decidir sobre a DJEINI (26 dias parada) é preciso adivinhar que se deve
voltar o período para agosto. O sistema **aceita** a decisão de lá (o arrasto já aplica as
conferências); só a tela não oferecia. Mesmo defeito das trocas de professor, em que a regra permitia
e a tela não ([[gestao-sem-botao-na-troca-pendente]]).

**Os dois blocos continuam separados**, de propósito: a venda deste mês em geral **nem venceu**, a de
meses atrás está **atrasada de verdade**. Numa lista só, a Djeini de 26 dias sumiria no meio de venda
de ontem.

---

## Testes

Escritos antes do código, no `vendas-aguardando.js` (módulo puro) e recortando do `index.html` pela
**assinatura**, nunca por texto de comentário.

| | o que prova |
|---|---|
| contrato bateu | sai da fila sozinho, sem pergunta nenhuma |
| nome bateu, contrato não | vira dúvida, com o pagamento e as vendas candidatas |
| apontar o pagamento | a venda sai da fila e guarda qual dinheiro era |
| apontar um pagamento já usado | **recusado**, dizendo em qual venda ele já está |
| "de nenhuma delas" | o sistema para de perguntar por aquele pagamento |
| cliente desistiu | some da fila, e não some se o dinheiro entrar depois |
| dinheiro depois de "desistiu" | a venda volta a contar como paga **e a tela diz** que havia marcação |
| venda e pagamento com vendedoras diferentes | a tela mostra os dois nomes |
| a comissão | não muda em nenhum dos casos acima (`commission.js` não conhece `vendasDoMes`) |
| os títulos | trazem o mês; o bloco de meses anteriores tem os botões |

Depois: homologação contra o Firestore real (staging e produção, leitura), regra provada por **REST**
— o Admin SDK ignora as regras e passaria mesmo com a regra aberta —, e clique de verdade no staging.

---

## O que este desenho NÃO faz

- **não gera comissão** por marcação humana, em caso nenhum;
- não mexe em `estorno-comissao.js` — desistência de venda não paga e estorno de comissão paga são
  coisas diferentes;
- não cria a busca livre de pagamentos: só são oferecidos os que o sistema levantou do relatório
  pelo nome do cliente. **Sem dinheiro real por trás, não há o que apontar** — foi o ponto central da
  correção do Rafael;
- não mexe no cálculo, no fechamento nem em pagamento de vendedora.
