# Conferência de vendas — registrar o desfecho, e mostrar quando o dinheiro entrou

> Desenho validado com o Rafael em 07/09/2026, no dia em que ele clicou pela primeira vez no
> painel "vendido × pago" recém-publicado. Substitui nada; acrescenta uma camada de registro por
> cima do painel de [2026-09-07-painel-vendido-x-pago-design.md](2026-09-07-painel-vendido-x-pago-design.md).

## O problema, nas palavras dele

> *"Tô na dúvida de o que fazer quando essas vendas a conferir. Acho que depois de conferido e
> validado, seria legal registrar isso pra não ficar só na cabeça de alguém. Tb penso que se um mês
> fechou e depois a venda foi paga em outro, vai ficar ali pendente, mas seria legal que depois que
> for identificado no futuro, de alguma forma ali fosse registrado que foi pago em na data."*

São duas coisas diferentes, e só uma precisa de gente.

**(a) A venda que se resolveu sozinha.** Já funciona: quando o pagamento cai no mesmo número de
contrato, a venda sai da fila automaticamente. O que falta é **mostrar quando** — hoje ela some
calada, e quem conferiu ontem não sabe se resolveu ou se sumiu por engano.

**(b) A venda "a conferir".** Aí é decisão humana, e hoje ela morre na cabeça de quem conferiu. Pior:
**o grupo é recalculado toda vez que a tela abre**, então o item volta a aparecer no dia seguinte,
e a pessoa confere de novo.

## Por que o sistema não pode decidir sozinho o caso (b)

O Rafael perguntou exatamente isso — *"quando o sistema identifica, ele mesmo pode marcar que foi
pago?"* — e a resposta saiu dos dois casos reais que existem em produção:

| | Amandha Marcela Pereira Gern Torres | Cátia Terezinha Pereira Torres |
|---|---|---|
| a venda | Renovação **ANUAL R$ 2.388** (C7070) | Renovação **ANUAL R$ 2.388** (C7130) |
| fechada em | 06/08/2026 | 27/08/2026 |
| **começa em** | **02/09/2026** | **02/09/2026** |
| o pagamento que bateu o nome | **R$ 239**, mensal, **04/08** (C5044) | **R$ 199**, recorrente, **12/08** (C6867) |
| período do pagamento | 01/08 – 01/09 | 02/08 – 01/09 |

**As duas pagaram antes de a venda existir.** Elas estavam num plano mensal, pagaram a mensalidade
de agosto, e durante agosto assinaram um anual que **só começa em setembro**. O pagamento é do plano
velho. Marcar "pago" sozinho faria a gestão parar de acompanhar **R$ 4.776** em renovações anuais.

A prova que o sistema tem na mão é fraca: *"esta pessoa pagou algum contrato neste mês"*. Não é
*"esta pessoa pagou ESTA venda"*.

### ⚠️ Correção a uma conclusão registrada no `CLAUDE.md`

O projeto registra a Cátia como *o* exemplo de "renovou no 7130 e o dinheiro entrou no 6867". **O
dado não sustenta isso.** O que entrou no 6867 foi a mensalidade dela de agosto (R$ 199), não a
renovação anual (R$ 2.388). A conclusão anterior veio de os nomes baterem — que é exatamente o erro
que o grupo "a conferir" existe para evitar.

**O caso segue genuinamente em aberto:** em setembro, essa anual cai no contrato novo ou a Pacto
continua cobrando no antigo? Ninguém pode responder hoje — o arquivo de recebimentos de setembro
ainda não foi subido.

## Decisões tomadas

| # | decisão | quem decidiu |
|---|---|---|
| 1 | **Três desfechos:** já foi paga · ainda a receber · não vamos cobrar | Rafael, 07/09 |
| 2 | Vale em **"a conferir", em "aguardando" e no arrasto** de meses anteriores | Rafael, 07/09 |
| 3 | **Só Admin** registra | Rafael, 07/09 |
| 4 | A decisão mora **fora do documento do mês** | Rafael, 07/09 |
| 5 | Mostrar a **data exata** do pagamento, não só o mês | Rafael, 07/09 |
| 6 | **O sistema opina, a pessoa confirma** | Rafael, 07/09 |
| 7 | A vendedora **vê o desfecho e a observação** nas vendas dela, sem poder mexer | Rafael, 07/09 |

## Comportamento

### Os três desfechos

| desfecho | efeito na tela |
|---|---|
| **Já foi paga** (a comissão saiu no contrato antigo) | passa a contar como **paga** — o dinheiro entrou, só que com outro número |
| **Ainda a receber** (conferi, é outra coisa) | **fica** em aguardando, marcada *"conferida em 07/09 por Rafael"* — para de parecer item esquecido |
| **Não vamos cobrar** (desistiu, cancelou) | sai dos três números e vira **nota embaixo**: *"2 vendas que não serão cobradas"* |

Cada registro guarda **quem, quando e uma observação livre**.

**No arrasto vale o mesmo.** Uma venda de agosto marcada "não vamos cobrar" sai do arrasto de
setembro — é o que impede aquela lista de só crescer até virar ruído que ninguém olha. Marcada
"ainda a receber", ela **fica** no arrasto, com a data da conferência ao lado: continua sendo
dinheiro a perseguir, só que já olhado.

**A venda marcada "não vamos cobrar" continua contando em "vendidas".** Ela foi vendida de verdade;
sai das que ainda esperam dinheiro, não da história do mês. Logo:

```
vendidas = pagas + aguardando + conferir + naoCobrar
```

### A ordem de quem manda

Isto é o coração do desenho. Sem ordem explícita a tela se contradiz.

1. **O contrato apareceu nos recebimentos** → **paga**, com a data.
   **Ganha de tudo**, inclusive de uma marcação manual em contrário.
2. **Senão, vale a marcação da gestão** (os três desfechos acima).
3. **Senão, o automático de hoje** — aguardando ou a conferir.

**O dinheiro sempre ganha.** Se alguém marcar "não vamos cobrar" e o cliente pagar depois, a venda
volta a contar como paga, e a tela **diz** que estava marcada de outro jeito. Uma marcação humana
nunca pode esconder dinheiro que entrou de verdade — é o que impede esta tela de mentir.

### A opinião do sistema

Hoje a tela diz *"confira na Pacto"*. Ela vai passar a mostrar o que achou **e por que desconfia**:

> **CÁTIA TEREZINHA PEREIRA TORRES** — anual de R$ 2.388, fechada em 27/08, começa em 02/09
> ⚠️ *O pagamento que bateu o nome foi de **R$ 199 em 12/08 — antes desta venda existir**. Provavelmente
> esta renovação ainda não foi paga.*
> `[Já foi paga]`  `[Ainda a receber]`  `[Não vamos cobrar]`

Três opiniões possíveis, e nada além disso:

| sinal | opinião |
|---|---|
| o pagamento é **anterior** à data em que a venda foi fechada | *provavelmente ainda não foi paga — o pagamento é do plano anterior* |
| o valor pago **bate** com o valor do contrato | *provavelmente é esta venda, com outro número de contrato* |
| nenhum dos dois | *não dá para dizer — vale conferir na Pacto* |

A opinião **nunca decide**. Ela só encurta o olhar de uma investigação para cinco segundos.

### "Pago em 12/09"

A venda que se resolveu sozinha para de sumir calada: aparece como paga, com a data em que o dinheiro
entrou. **Não precisa de ninguém digitando nada** — a informação já existe e hoje é jogada fora.

O painel lê o `codigosPagos` de todos os meses da unidade e **achata tudo numa lista só**, perdendo
*de qual mês* veio cada código. Basta parar de achatar. A data exata sai do lançamento
correspondente, no mês que pagou.

## Arquitetura

### Onde a decisão mora

Coleção **`vendas_conferencia`**, um documento por venda, id `{unitId}_{contrato}` (ex.: `cp_C7130`):

```
unitId, contrato, cliente, mesDaVenda, valorContrato
desfecho     'paga_outro_contrato' | 'a_receber' | 'nao_cobrar'
observacao   texto livre, opcional
por          nome de quem registrou
porUid
em           timestamp
```

**Por que fora do documento do mês.** Quando alguém re-sobe o arquivo da Pacto, o documento do mês é
reescrito — já aconteceu neste sistema, e foi por isso que precisou de um script para repor os 7
códigos do robô em julho. Se a decisão morasse lá dentro, re-subir agosto apagaria em silêncio tudo
que a gestão conferiu. Um documento por decisão também evita a perda por escrita simultânea, que já
está registrada como dívida técnica em `ScaleService.registrarHistorico`.

Cada registro também vira uma linha no **`audit_log`** que já existe.

### Onde a lógica mora

No módulo puro **`vendas-aguardando.js`**, junto do resto das regras. Regra de negócio no
`index.html` não tem teste — é a mesma razão pela qual a contagem do painel foi para lá.

| função | responsabilidade |
|---|---|
| `aplicarConferencias(cruzado, conferencias)` | aplica a ordem de precedência sobre os três grupos e devolve os grupos ajustados mais `naoCobrar` |
| `opiniao(venda, pagamentoQueBateu)` | devolve `{ suspeita, porque }` — as três opiniões da tabela acima |
| `cruzar(...)` | passa a marcar `pagoEm: { mes, data }` nas vendas pagas, e a carregar o `pagamentoQueBateu` nas de conferir |

O `index.html` fica só com: ler a coleção, desenhar os botões, gravar.

### Permissão

- **Ler:** quem já enxerga o painel — a vendedora inclusive, para ver o desfecho das vendas dela.
- **Escrever:** **só Admin**, travado na *Security Rule*. Esconder o botão não basta: link direto
  existe, e foi assim que o vazamento de salário do fechamento aconteceu.

## Testes

No módulo puro, com fixture:

- **A ordem de precedência inteira**, incluindo o caso que mais importa: marcada como *"não vamos
  cobrar"* e o dinheiro entrou depois → **tem que voltar a contar como paga**, e a tela tem que dizer
  que estava marcada de outro jeito.
- `vendidas = pagas + aguardando + conferir + naoCobrar` sempre fecha.
- As três opiniões, com os números reais da Amandha e da Cátia.
- `pagoEm` traz o mês certo quando o contrato foi pago em mês diferente do da venda.

Na tela, rodando as funções num sandbox (não lendo o texto do arquivo — lição de
[[previa-nunca-rodou]]):

- Os botões aparecem **só** para Admin.
- A vendedora vê o desfecho e a observação, e **nenhum botão**.

E a homologação **somente leitura contra o Firestore de produção**, como
`homologar-vendido-x-pago.js` já faz.

## O que NÃO muda

- **Nenhum cálculo de comissão.** A conta sai dos recebimentos (`itens`); esta é uma camada de
  registro por cima. Nenhum dos três desfechos move um centavo.
- Nenhuma Cloud Function.
- Nada no fechamento da folha de professores.
- As metas e as ativações, que também saem dos recebimentos.

## Riscos conhecidos

1. **A opinião pode induzir ao erro.** Uma opinião errada com cara de certeza é pior que nenhuma —
   por isso ela é sempre uma frase explicando o motivo, nunca um selo. E os três botões ficam
   sempre disponíveis, na mesma ordem, independentemente do que ela disse.
2. **Uma marcação errada é reversível, menos contra o dinheiro.** Registrar de novo sobrescreve, e o
   `audit_log` guarda o histórico. O que nenhuma marcação faz é esconder um pagamento real.
3. **A conferência não substitui arrumar o cadastro na Pacto.** Continua com a gestão.
