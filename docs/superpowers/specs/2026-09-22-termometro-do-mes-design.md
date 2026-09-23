# Termômetro do mês — desenho (22/09/2026)

> Pedido do Rafael em 22/09: usar já o que a API da Pacto acerta, enquanto a Pacto não responde sobre a
> consultora do Campeche. **Staging primeiro, só para a gestão.** Página separada (o `index.html` não é
> tocado sem autorização).

## O problema
O Rodrigo achava que os números atualizavam sozinhos (*"hoje é 02/09 e não apareceu nenhuma venda de
setembro"*). Não atualizam: o mês só existe depois que alguém exporta o arquivo e sobe. A API em modo
sombra já busca tudo às 4h, e no nível da **unidade** ela acerta:

| set/2026 até 21/09 | ativações API × arquivo | recebido API × arquivo |
|---|---|---|
| PP | 52 × 52, idêntico por categoria | 45.993 × 46.659 (a diferença é a vendinha de balcão) |
| CP | 64 × 63 | 51.053 × 51.020 |

Por **vendedora**, não: no CP a Pacto não entrega consultora; no PP 7 de 52 ficam sem. Por isso o
termômetro **não mostra nada por pessoa** e **não mexe em comissão**.

## O que a gestão vê
`termometro.html`, uma página por mês, as duas unidades lado a lado:
- ativações do mês até ontem, contra as faixas do prêmio da unidade (Meta · Super · Gold) e quanto falta;
- as três travas do prêmio da unidade: novos+retorno (sem o mínimo, não há prêmio), renovações (×0,70) e
  vouchers (×0,85) contra os mínimos;
- dinheiro recebido até ontem (sem a vendinha de balcão, que a API não traz);
- se a **meta do mês** foi configurada ou se está valendo o padrão da unidade
  ([[metas-sao-definidas-por-mes]]);
- até que dia há dado e quais dias falharam;
- a frase **"prévia automática — o cálculo oficial continua sendo o arquivo exportado"**.

## Como é calculado
- A conta roda **na Cloud Function**, depois de cada busca (a das 4h e o botão manual), e grava um
  documento só com totais: `pacto_termometro/{CP|PP}_{AAAA-MM}`. Nenhum nome de cliente ou de vendedora.
- Mesmo caminho do upload oficial: linhas da API do mês → `consolidarPorContrato` → `PactoAdapter.traduzir`
  **com `codigosPagos` dos meses anteriores** (regime de caixa: contrato conta uma vez só) →
  `paraPlanilha` → `cleanRawData` → `CommissionEngine.calculate` → `unitTotals`. A faixa sai do
  `calcP3` do próprio motor. **Nenhuma regra de ativação ou de meta mora no termômetro.**
- Configuração = `defaultConfig` + `units/{id}.config` + `periodos/{id}_{mês}.metasMensais`, a mesma
  soma que o `index.html` faz. O id da unidade (`unit-cp` no staging, `cp` em produção) sai de
  `PactoAdapter.siglaDaUnidade`.
- Como as Functions só levam a pasta `functions/`, `pacto-adapter.js`, `commission.js` e o módulo novo
  `pacto-termometro.js` ganham **gêmeos** lá, com teste que falha se divergirem (padrão do
  `closing-payroll.js` e do `pacto-api-linhas.js`).

## Quem lê
`pacto_termometro`: lê **admin e supervisão**; ninguém grava pelo navegador. `pacto_sombra_dias`
continua só do admin (tem nome de cliente).

**Vendedoras (22/09, pedido do Rafael: "para elas irem acompanhando, não dependendo da carga"):** leem
`pacto_termometro_equipe`, a MESMA coisa **sem o dinheiro recebido** (é o faturamento da unidade; nenhuma
tela da vendedora mostra o caixa da unidade hoje — conferido 22/09. Regra do Firestore não esconde
campo, então o dinheiro não pode estar no documento). ⚠️ **Não é segredo de verdade hoje:** a regra de
`periodos` libera leitura a quem tem o módulo de Comissões, e o período guarda `totals.unitCaixa` — a
vendedora consegue ler pelo banco. Esconder aqui é escolha de tela. As duas unidades, por decisão do Rafael. Atalho no menu lateral (Meu Espaço) e
como 5º botão da barra do celular. Liberar o dinheiro para elas = gravar o campo na cópia da equipe.

## Fora deste passo
Comissão por pessoa pela API (depende da Pacto); atalho no módulo de Professores (o Rafael não quer);
produção (depende da homologação e da credencial no cofre de produção).
