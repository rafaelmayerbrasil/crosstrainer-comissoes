# Painel "vendido × pago" — desenho

**Data:** 07/09/2026 · **Pedido por:** Rafael · **Estado:** desenho aprovado, não implementado

## O pedido

> "Precisamos ter no painel de gestão e também para as vendedoras o número de vendas registradas e o número de pagas efetivamente, para todos poderem acompanhar e até mesmo cobrar caso não seja pago. O ideal é ficar um resumo na página inicial e ter uma visão detalhada."

Sob regime de caixa a comissão só nasce quando o dinheiro entra. A vendedora fecha a venda e não vê nada acontecer; a gestão não tem como saber quanto do que foi vendido virou dinheiro. Hoje existe a tela "A receber", que mostra o que está parado — mas não mostra **quanto** já converteu, nem separa por pessoa, nem aparece na home.

## Decisões tomadas (07/09)

| Pergunta | Resposta |
|---|---|
| "Cobrar" quem? | **A vendedora** — é acompanhamento de performance, não corrida atrás do aluno. Sem telefone do cliente, sem "já falei com ele". |
| Venda de agosto não paga aparece em setembro? | **Sim, em bloco separado** — "arrastando de meses anteriores". |
| O Rodrigo, que vende e não recebe comissão? | Fica na lista, **marcado como não comissionado**, sem coluna de conversão. |
| Quem sobe o relatório de vendas? | **Manual por enquanto.** Quando o desenho fechar, entra pela **API da Pacto**, junto com o de recebimentos. |

## De onde sai cada número

Nada é recalculado. Tudo já existe e já é testado:

| número | fonte |
|---|---|
| **Vendidas** | `periodos/{id}.vendasDoMes` — o relatório "Faturamento por Período" da Pacto, registrado por unidade e mês |
| **Pagas** | contrato presente em `codigosPagos` de **qualquer** mês da unidade — a mesma memória que impede pagar comissão duas vezes |
| **Aguardando** | o que sobra |
| **Conferir** | o cliente pagou no mês, mas em **outro** número de contrato — renovação que trocou de número |

`VendasAguardando.cruzar(vendas, pagos, clientesPagantes)` já devolve exatamente `{pagas, aguardando, conferir, porVendedora}`. O trabalho desta entrega é **apresentação**, não cálculo.

## Tela 1 — o resumo na home

### Gestão (Dashboard)

Bloco novo, acima dos indicadores operacionais:

```
VENDAS DO MÊS            Agosto · vendas até 01/09 · recebimentos até 01/09
    74            68             4
  vendidas      pagas       aguardando
                            + N de meses anteriores
```

### Vendedora (a home dela)

Os mesmos três números, contando só as vendas dela. Sem o nome ou o número das colegas — é o padrão que o sistema já segue.

Clicar em qualquer número leva para a aba "A receber".

### As duas datas do cabeçalho não são enfeite

"Vendidas" depende do relatório de vendas; "pagas" depende do de recebimentos. Se um dos dois está velho, o número está velho. Sem essa data alguém cobra uma vendedora por um retrato de nove dias atrás. Sai de `vendasAtualizadasEm` e de `uploadDate` do período.

## Tela 2 — a visão detalhada (aba "A receber")

A aba já existe nas duas visões. Ganha três coisas:

**(a) O mesmo cabeçalho de três números**, para as duas telas contarem a mesma história.

**(b) Tabela por vendedora — só na gestão.** Estado real de agosto/2026:

| Campeche | vendidas | pagas | aguardando | conferir | convertido |
|---|---:|---:|---:|---:|---:|
| Erica Faustino | 42 | 41 | 1 | 0 | 98% |
| Francini das Chagas | 28 | 24 | 2 | 2 | 86% |
| Rodrigo *(não comissionado)* | 7 | 6 | 1 | 0 | — |

| Príncipe | vendidas | pagas | aguardando | conferir | convertido |
|---|---:|---:|---:|---:|---:|
| Kali Dutra | 21 | 14 | 7 | 0 | 67% |
| Rodrigo *(não comissionado)* | 19 | 13 | 6 | 0 | — |
| Bárbara Vieira | 12 | 9 | 3 | 0 | 75% |
| Erica Faustino | 5 | 3 | 2 | 0 | 60% |
| Francini das Chagas | 3 | 3 | 0 | 0 | 100% |
| Benny Eland *(não comissionado)* | 1 | 1 | 0 | 0 | — |

**(c) Bloco "arrastando de meses anteriores"**, com a venda, o mês em que foi fechada e há quantos dias está parada.

A vendedora vê a mesma tela **com as linhas dela**, sem a tabela comparativa.

## Regras de exibição

1. **"Não sei" nunca vira "zero".** Mês sem `vendasDoMes` não mostra `0 vendidas` — mostra *"Este mês ainda não tem a lista de vendas. Suba o relatório 'Faturamento por Período' em Upload."* Um zero ao lado do nome de alguém é uma acusação falsa.
2. **O "% convertido" só aparece em mês fechado.** No mês corrente ele é sempre baixo por construção — setembro no dia 7 marca 0% nas duas unidades, e nada disso é culpa de ninguém. Durante o mês corrente a coluna desaparece e fica só a contagem.
3. **Quem não recebe comissão não tem percentual.** Rodrigo e Benny aparecem com a contagem e a marca *(não comissionado)*, porque as vendas deles contam para a meta da unidade. Cobrar conversão de quem não é remunerado por isso não faz sentido.
4. **"Conferir" não é "aguardando".** Fica em coluna própria e, no resumo de três números, entra como nota dentro de "aguardando": *"N delas podem já ter sido pagas em outro contrato"*. Somar as duas coisas faria a gestão cobrar por venda já paga.
5. **A vendedora vê só o que é dela.** Precedente do sistema; nada de nome de colega no `window`.

## A armadilha de julho — não registrar

O arquivo de vendas de agosto **também contém julho** (13 vendas no Campeche, 18 no Príncipe). **Não devem ser registradas.** Julho foi calculado com as planilhas do TecnoFit, que usam outra numeração de contrato — o `codigosPagos` de julho não tem nenhum código da Pacto. Registrar julho faria as 31 vendas aparecerem como "aguardando" para sempre, e alguém cobraria as vendedoras por vendas que **já foram pagas**.

É a mesma fronteira de [[recorrencia-nao-e-robo]]. O painel começa em **agosto**.

## Fora de escopo

Gráfico de evolução, meta de conversão, ranking de quem converte melhor, alerta automático, contato do aluno, marcação de "já cobrei". Nada disso foi pedido. Ranking de conversão em especial é métrica perigosa: a vendedora não controla quando o cartão do cliente passa.

## Testes

Smoke novo, chamando `VendasAguardando.cruzar` de verdade (não lendo texto de arquivo):

1. Mês sem `vendasDoMes` → a tela diz "sem lista de vendas", **não** mostra zero.
2. Venda de agosto que aparece em `codigosPagos` de setembro → sai do arrasto sozinha.
3. Vendedora só recebe as linhas dela; nome de colega não aparece no HTML.
4. Mês corrente → sem coluna de percentual. Mês fechado → com.
5. Vendedor não comissionável → contagem sim, percentual não.
6. O número da home e o do detalhe saem da mesma função — se divergirem, falha.

## Estado dos dados em produção (07/09/2026)

- `cp_2026-08`: 74 vendas registradas · `pp_2026-08`: 59 — registradas por
  `scripts/registrar-vendas-do-mes.js` em 07/09.
- `cp_2026-09`: 14 · `pp_2026-09`: 11 — registradas pelo Rafael, pela tela.
- Nenhum mês anterior a agosto tem lista de vendas, e não deve ter.

## Rumo

Quando o desenho fechar, o relatório de vendas e o de recebimentos passam a entrar pela **API da Pacto** em vez do upload manual. O mapa técnico da API já está levantado em [[pacto-api-integracao]]. Este painel é o primeiro consumidor que fica errado se o dado envelhecer — por isso a data de atualização aparece desde já, e não como enfeite.
