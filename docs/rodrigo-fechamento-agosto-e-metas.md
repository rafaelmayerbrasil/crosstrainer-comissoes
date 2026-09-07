# Agosto fechado, e as metas que faltam definir

**Para:** Rodrigo · **De:** Rafael · **Data:** 02/09/2026
**Fonte:** export da Pacto de 01/09 (agosto fechado, 619 linhas) + relatório de vendas + base do sistema

---

## Resumo

- ✅ **Conferido** — os **R$ 2.185,34 do Campeche** e os **R$ 804,93 do Príncipe** estão abertos aqui vendedora por vendedora, prêmio por prêmio, do jeito que dá pra refazer na mão.
- ❓ **Decisão** — reconstruí a **lista de renovações possíveis** que se perdeu na migração (46 contratos vencem em setembro no Campeche, 40 no Príncipe) e proponho as metas com a conta aberta.
- ✅ **Resolvido** — os **R$ 1.107,47 de julho não existem**. Refiz a conta: já foram pagos ou já estão dentro de agosto. Não há complemento a fazer.
- ⚠️ **Atenção** — suas **14 vendas de agosto** não te pagam comissão, mas **contam na meta da unidade**. Foram elas que levaram o Campeche de Meta para Super Meta.
- ❓ **Decisão** — os dois ajustes de estorno que você pediu estão desenhados e prontos pra fazer. Faltam **três definições de regra**.

---

## 1. De onde saem R$ 2.185,34 e R$ 804,93

São três prêmios diferentes somados, por vendedora. Nada aqui é estimativa: saiu das 619 linhas do relatório `faturamento-recebido` de agosto, o mês fechado.

### Campeche — 59 ativações

| Vendedora | Ativações | P1 (% do caixa) | P2 (bônus por contrato) | P3 (bônus de meta) | Total |
|---|---:|---:|---:|---:|---:|
| Erica Faustino | 35 | 541,54 | 600,00 | 324,95 | **1.466,49** |
| Francini das Chagas | 20 | 269,29 | 300,00 | 149,56 | **718,85** |
| **Campeche** | **55 + 4 suas** | **810,83** | **900,00** | **474,51** | **2.185,34** |

### Príncipe — 29 ativações

| Vendedora | Ativações | P1 | P2 | P3 | Total |
|---|---:|---:|---:|---:|---:|
| Bárbara Vieira | 7 | 159,19 | 240,00 | 0,00 | **399,19** |
| Kali Dutra | 7 | 170,79 | 140,00 | 0,00 | **310,79** |
| Erica Faustino | 3 | 21,98 | 35,00 | 0,00 | **56,98** |
| Francini das Chagas | 1 | 7,96 | 30,00 | 0,00 | **37,96** |
| **Príncipe** | **18 + 11 suas/Benny** | **359,92** | **445,00** | **0,00** | **804,93** |

### Como refazer cada prêmio na mão

**P1 — percentual sobre o dinheiro que entrou.** 5% em venda nova e retorno, 2,5% em renovação, R$ 10 fixos por voucher. A Erica no Campeche, linha a linha:

```
novos                    R$ 4.701,00 × 5,0%  =  235,05
retornos                 R$ 1.566,39 × 5,0%  =   78,32
renovações               R$ 2.469,00 × 2,5%  =   61,73
vouchers                 7 × R$ 10,00        =   70,00
avulso / bar / matrícula R$ 1.929,00 × 5,0%  =   96,45
                                               ────────
                                               R$ 541,54
                        (o sistema guarda os centavos sem arredondar)
```

**P2 — bônus fixo por contrato fechado.** Bianual R$ 80 · anual flex R$ 45 · anual local R$ 30 · recorrente R$ 20 · mensal R$ 15. A Erica fechou 7 anuais locais, 1 anual flex, 9 recorrentes e 11 mensais: **R$ 600,00** exatos.

**P3 — bônus de meta.** É um bolo da unidade, rateado entre as vendedoras pelo caixa de cada uma. No Campeche:

```
59 ativações ≥ 57  →  Super Meta, valor fixo          R$ 600,00
+ 0,5% sobre o caixa elegível de R$ 15.574,19         R$  77,87
                                                      ──────────
                                                      R$ 677,87
× 0,70  porque as renovações pararam em 14 e o
        mínimo configurado no mês era 25              R$ 474,51

rateio   Erica    68,5% do caixa  →  R$ 324,95
         Francini 31,5% do caixa  →  R$ 149,56
```

**No Príncipe o P3 deu zero por dois motivos somados:** 29 ativações não alcançam meta nenhuma (na falta de meta configurada o sistema usou 50) e — isto é o mais importante — **mesmo que alcançassem, ninguém receberia**: o sistema exige 10 ativações individuais para entrar no rateio, e Kali e Bárbara fizeram 7 cada.

### ⚠️ Duas coisas que mudam a leitura

**1. "Ativação" no sistema inclui voucher de degustação.** Os 59 do Campeche são 22 novos + 9 retornos + 14 renovações + **14 vouchers**. Sua fórmula de meta não conta voucher — então ou a meta sobe para absorver isso, ou a gente muda a contagem. Não recomendo mudar: todo o histórico de metas foi medido assim.

**2. Suas vendas entram na contagem da meta, mesmo sem te pagar comissão.** São 4 no Campeche e 10 no Príncipe. As 4 do Campeche são exatamente o que levou a unidade de 55 para 59 ativações — ou seja, de "Meta" para "Super Meta", uma diferença de **R$ 210** no bolso da Erica e da Francini. Se a maioria das suas 10 do Príncipe for re-venda técnica de recorrente, o número comercial real da unidade em agosto é **19, não 29**.

---

## 2. Reconstruí as renovações possíveis

Você disse que sem a informação das renovações possíveis não conseguia estimar. Dá pra recuperar: todo contrato guarda a data em que termina, e isso está no nosso histórico. Este é o quadro real de setembro:

| Unidade | Contratos vencendo em set | Composição | Conversão observada jun · jul · ago | Novos + ex-alunos em set/2025 | Vouchers média jun–ago |
|---|---:|---|---:|---:|---:|
| Campeche | **46** | 15 anuais · 16 mensais · 15 recorrentes | 56% · 40% · 44% | 22 | 10 |
| Príncipe | **40** | 30 anuais · 3 mensais · 7 recorrentes | 92% · 35% · 25% | 30 | 6 |

Duas leituras importantes:

- **Sua régua de 60% de renovação está acima do que a casa vem convertendo** (~45% no Campeche, ~30% no Príncipe). É legítimo numa meta, mas é bom saber que é esticada.
- **O Príncipe tem em setembro a maior carteira de vencimento do semestre**: 40 contratos, 30 deles anuais. É o mês certo para a campanha de antecipação do item 6.

### Agosto — a meta retroativa

Não dá pra "criar" uma meta olhando o resultado. O mais honesto é usar a escada de julho, definida antes de qualquer um saber como agosto ia terminar.

**Campeche: 50 · 57 · 65**, com mínimo de 18 novos, 13 renovações e 6 vouchers. As 59 ativações batem **Super Meta**, e o corte de 30% desaparece (as 14 renovações passam do mínimo de 13). O P3 sobe de R$ 474,51 para **R$ 677,87** e o Campeche fecha em **R$ 2.388,70**.

**Príncipe: não existe escada honesta que pague.** Com 29 ativações, tanto a escada de junho (32) quanto a de julho (45) dão zero. Para pagar qualquer coisa seriam necessárias duas mudanças ao mesmo tempo: meta de no máximo 29 **e** mínimo individual de 7 ativações no lugar de 10.

| | Opção A — minha recomendação | Opção B |
|---|---|---|
| **O quê** | Reconhecer que agosto foi o mês da migração | Manter o critério de sempre |
| **Config** | 28 · 32 · 37 · mín. novos 15 · renov 9 · vouchers 4 · **mín. individual 7** | escada de junho (32 · 37 · 42) |
| **Resultado** | **R$ 1.140,12** — Kali R$ 159,97 · Bárbara R$ 175,22 | **R$ 804,93** — bônus de meta zero |

Com a opção A, a folha de **15/09 fica em R$ 3.528,82**, contra R$ 2.990,27 como está hoje.

### Setembro — a meta que vale de verdade

Montei pela sua fórmula (60% das renovações possíveis + novos e ex-alunos do mesmo mês do ano passado com 10 a 30% de acréscimo + 3 a 7 indicações), acrescentei a linha de vouchers que o sistema conta, e conferi contra o histórico de 2026 — que no Campeche tem mediana de 54 ativações e cresceu 36% sobre 2025.

| Unidade | Meta | Super | Gold | Mín. novos | Mín. renov | Mín. vouchers |
|---|---:|---:|---:|---:|---:|---:|
| Campeche | 55 | 63 | 72 | 20 | 14 | 7 |
| Príncipe — *se suas vendas se repetem* | 34 | 39 | 44 | 15 | 10 | 5 |
| Príncipe — *se foram re-cadastro da migração* | 28 | 32 | 37 | 15 | 9 | 4 |

A escada do Campeche é a mesma de junho, que eles bateram. Pela sua fórmula o otimista dá 66; pus a meta em 55 para ser alcançável e deixei Super e Gold capturarem o mês bom. **A do Príncipe depende da sua resposta sobre as suas 10 ativações** — se elas não se repetirem em setembro, a unidade parte de uma base comercial de 19, não de 29.

> ⚠️ **Cuidado com outubro.** Em outubro vencem só **20 contratos no Campeche e 18 no Príncipe** — menos da metade de setembro. A meta de outubro tem que cair proporcionalmente, ou a campanha de antecipação de setembro vai "comer" o mês seguinte e o time começa outubro perdendo.

> **Detalhe operacional:** o campo **"mínimo de ativações individuais"** hoje só existe na configuração da unidade, que vale para todos os meses — não está na tela de metas do mês. Vou levá-lo para lá, e sugiro adotar a regra de ele ser **cerca de 20% da meta da unidade**. Hoje é 10 fixo, o que num Príncipe de meta 30 é duríssimo e num Campeche de meta 55 é frouxo.

---

## 3. Os R$ 1.107,47 não existem

Você pediu pra eu explicar melhor de onde vinham esses números, pra conferir. Fui atrás dos dois pedaços e **nenhum dos dois se sustenta**. É melhor ter aparecido agora do que depois de pagar.

**Os R$ 508,12 das 14 vendas que o TecnoFit não capturou** — já foram pagos. As planilhas corrigidas de julho, que contêm exatamente essas 14 vendas da última semana do mês, **são as que estão no sistema**: o período de julho registra o nome desse arquivo e os recibos foram emitidos sobre esses valores. Eu tinha anotado que elas nunca haviam subido; subiram.

**Os R$ 599,35 dos contratos de julho que receberam em agosto** — refiz a conta sobre o mês fechado. São 31 linhas com contrato começando em julho e dinheiro entrando em agosto, e quase todas são coisa que por regra não paga:

- **20 são IMPORTAÇÃO** — contrato antigo que entrou na Pacto pela migração. Ninguém vendeu, ninguém recebe.
- **3 são recebimento do TecnoFit** — dinheiro que o TecnoFit já tinha recolhido em julho e a Pacto só registrou em agosto.
- **3 são renovação automática** — cobrança do robô, que por regra não paga comissão.
- **Sobram R$ 139,80**, de três contratos (Lucas Dani, Manoella e Douglas) — e esses **já estão dentro de agosto**, porque agosto foi calculado pelo dinheiro que entrou.

> ### Conclusão: não há complemento a pagar.
> Com isso, o "botão de complemento avulso" que estava na fila deixa de ser necessário. Se você quiser encerrar julho sem margem nenhuma de dúvida, o único caminho é pedir à Pacto o `faturamento-recebido` de **julho fechado** — esse arquivo a gente não tem.

---

## 4. Lixo de teste sai da tela, e sai para sempre

O **TESTE ENDEREÇO TECNOFIT** (contrato 7117) e o **teste pacto** nunca entraram no cálculo da comissão — eles só apareciam na tela "A receber", justamente porque nunca pagaram nada.

Em vez de apagar os registros um a um, o sistema vai passar a ignorar qualquer cliente cujo nome tenha a palavra **TESTE**, e o resumo do upload vai dizer quantas linhas de teste foram ignoradas — some da lista, mas não some da vista. Vale também para os testes que vocês fizerem daqui pra frente.

---

## 5. Os dois ajustes de estorno

### Ajustar o valor do estorno na mão

Hoje o sistema calcula quanto aquele contrato pagou de comissão e devolve exatamente isso. Cada linha "Fulana devolve R$ X" vira um **campo editável**, já preenchido com o valor calculado e com o valor original visível ao lado. Se alguém mudar, fica registrado quem mudou, de quanto para quanto e por quê. Valor zero significa que aquela vendedora não devolve nada.

### Quando o estorno derruba a meta

É o único pedido seu que o sistema ainda não faz. Funcionamento proposto:

- Ao registrar o estorno, o sistema **refaz o bônus de meta daquele mês sem aquela venda** — tira a ativação da contagem da unidade e o valor do caixa da vendedora.
- Mostra a prévia **antes de confirmar**: *"Sem essa venda o Campeche cai de Super Meta (R$ 474,51) para Meta (R$ 264,51) — Erica devolve R$ 143,90, Francini R$ 66,10."*
- A diferença vira crédito, abatido no pagamento seguinte, separada do estorno da venda em si para aparecer explicada no recibo.
- **O mês fechado não é tocado** — nada é recalculado nem reaberto, exatamente como você definiu.

Antes de escrever isso preciso das definições 4, 5 e 6 do fim deste documento.

---

## 6. Três motivadores para o aluno antecipar a renovação

**86 contratos vencem em setembro** (46 no Campeche, 40 no Príncipe) e a casa vem convertendo cerca de 45%. Subir para 60% são **+13 ativações** — sozinho isso já muda a faixa de meta das duas unidades.

### 1. Trava de preço, mais os dias que sobraram
*Custo zero — o mais forte dos três*

> "Renovando até o dia 20, você mantém o valor da sua tabela atual por mais 12 meses — depois do vencimento entra o reajuste. E os dias que sobram do seu plano de hoje não se perdem: o novo só começa quando este acabar."

O álibi é real e não é da vendedora: existe um reajuste com data. Exige uma coisa de você — **publicar um calendário de reajuste**. Sem isso vira ameaça vazia e queima a confiança do aluno.

### 2. Semana da Renovação, com escassez e brinde
*Custo baixo — alimenta a própria meta*

> "Do dia 1 ao 20: as 15 primeiras renovações levam avaliação física, reavaliação em 90 dias e 2 convites de 7 dias para quem você quiser trazer."

Os convites são o pulo do gato: eles **viram voucher dentro do sistema**, e voucher conta como ativação e alimenta o mínimo de degustações da meta. A vendedora ganha dois álibis que não são dela: um prazo ("vai até dia 20") e um limite ("restam 4 vagas").

### 3. Antecipou, virou crédito na casa
*Custo controlado — melhor que desconto*

> "Pagou a renovação ainda dentro do mês do vencimento: R$ 100 em créditos na casa — suplemento, loja, aula avulsa, day use para um amigo."

Crédito custa o **custo** do produto, não o preço de tabela: sai por perto da metade de um desconto equivalente, e o dinheiro volta pra dentro da academia. Para plano anual, a versão forte é **a 12ª parcela grátis pagando à vista até o dia X** — 8,3% de desconto que prende 12 meses e antecipa caixa.

### ⚠️ Dois cuidados

- **Não pode virar rotina.** Se a antecipação virar permanente, você só empurrou o calendário — e outubro, com 38 vencimentos nas duas unidades contra 86 em setembro, fica magro e sem lastro para a meta.
- **A tela "A receber" é o placar da campanha.** Ela já mostra, por vendedora, exatamente quais contratos foram vendidos e ainda não caíram, e quais o cliente pagou em outro contrato. Não precisa de planilha nenhuma para acompanhar.

---

## 7. Seis decisões que dependem de você

**1. Meta de agosto do Campeche.** Confirmo a escada de julho — 50 · 57 · 65, com mínimo de 13 renovações?
→ *efeito: Campeche vai de R$ 2.185,34 para **R$ 2.388,70***

**2. Meta de agosto do Príncipe.** Opção A (28 · 32 · 37 com mínimo individual 7, paga R$ 335,19 de bônus) ou opção B (mantém o critério e o bônus fica zero)?
→ *recomendo a **A**, dita ao time como excepcional pela migração*

**3. Suas 14 ativações de agosto.** Quantas foram re-cadastro técnico de plano recorrente para a Pacto entender a renovação automática, e quantas foram venda de verdade? São 4 no Campeche e 10 no Príncipe.
→ *é o que decide a meta de setembro do Príncipe: **34 ou 28***

**4. Estorno que derruba a meta: quem devolve?** A faixa de meta é coletiva — se ela cai, o bônus de todas estava errado. Meu padrão seria **todas as que receberam bônus devolvem a sua fatia**. A alternativa é a vendedora do contrato cancelado bancar a diferença sozinha.
→ *recomendo **todas devolvem a fatia** — é o que a conta manda*

**5. E quando a faixa de meta não cai?** Aí a diferença vira centavos. Meu padrão é **não fazer nada** e escrever na tela que a meta não mudou.
→ *recomendo **não mexer***

**6. O valor ajustado à mão pode ser maior que o calculado?** Casos de exceção podem exigir devolver mais do que o sistema calculou. Meu padrão é **permitir**, com registro de quem mudou e por quê.
→ *recomendo **permitir com registro***

Respondendo 4, 5 e 6, os dois ajustes de estorno e o filtro de teste saem na mesma leva. Respondendo 1, 2 e 3, agosto fecha e as metas de setembro entram no sistema — **e quanto antes elas entrarem, mais dias de setembro o time tem para correr atrás delas**.

---

*Fontes: export `faturamento-recebido` da Pacto de 01/09/2026 (agosto fechado, 619 linhas) · relatório de vendas da Pacto de 01/09/2026 · base do sistema de comissões (períodos de jan/2025 a ago/2026) · datas de fim de contrato do histórico, para a carteira de vencimentos.*

*Todos os valores conferem com o que está gravado no sistema. A diferença de R$ 6,31 entre o cálculo por fora e o do app é conhecida e documentada: são vendas de bar idênticas no mesmo dia que o sistema junta numa só.*
