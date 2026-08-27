# Tradutor Pacto → Comissões — desenho

> **Status:** ✅ **CONSTRUÍDO em 25/08/2026** — `pacto-adapter.js` + `scripts/traduzir-export-pacto.js`,
> 32 + 8 + 4 casos de teste passando, suíte do projeto verde. Nada em `commission.js` nem no `index.html`.
> As duas perguntas de 19/08 foram respondidas pelo Rafael: **assumir LOCAL e marcar** · **script separado**.
> ⚠️ **Construir levantou duas questões maiores que a original** — ver "Contratos migrados" e
> "Os dois relatórios são gêmeos".
> 🔁 **Refeito em 26/08:** um `git clean -fd` apagou os arquivos (nada estava commitado). Reconstruído idêntico.
> Substitui o spec parado de 14/08 (adaptador de Excel), que foi revertido — ver "Por que voltou atrás".

## Objetivo

Fazer o módulo de Comissões voltar a ter entrada de dados. O TecnoFit acabou no fim de julho de 2026; de agosto em diante só existe o export `faturamento-recebido` da Pacto, em outro formato.

A peça traduz "linha da Pacto" → "venda que o motor já entende", **sem tocar em `commission.js` nem em `index.html`**.

## Por que voltou atrás da decisão de 15/08

Em 15/08 o adaptador de Excel foi parado por ser "trabalho pra jogar fora". Dois erros:

1. **Tamanho superestimado.** O campo `Plano` da Pacto tem *exatamente* o formato do `Itens` do TecnoFit — `HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.` Mesmo separador, mesma ordem. O tradutor é pequeno.
2. **Não é descartável.** O Excel e a API entregam **o mesmo relatório** (`relFaturamentoRecebido/vendas`). O código que traduz linha da Pacto → venda normalizada é o mesmo nos dois casos; só muda o transporte.

## Arquitetura

`pacto-adapter.js` — objeto puro no estilo do `CommissionEngine`: sem Firebase, sem `import`, sem dependência de navegador. Roda nos três lugares sem reescrita:

| Fase | Como roda | Toca produção? |
|---|---|---|
| 1 | Script Node lê o export e gera a planilha no formato de hoje | **não** |
| 2 | Plugado no `index.html`, sobe o arquivo da Pacto direto | 1 linha |
| 3 | Mesma peça alimentada pela API | nada |

Isso também é a costura que serve a visão de sistema único: manter a lógica fora da cola do `index.html` é o que torna barata uma eventual troca de plataforma. Ver `memory/visao-sistema-unico-crm-comissoes.md`.

Descoberta que sustenta isso: **`commission.js` não tem uma linha de Firebase** (as 2 ocorrências são comentário). As **158** chamadas ao Firestore estão todas na cola do `index.html`.

## Formatos

**Entrada (Pacto)** — ler **por posição, nunca por nome**: o cabeçalho tem `Responsável` duplicado.

```
_ | Matrícula | Nome Cliente | Data Cadastro | Responsável | Responsável | Produto |
Contrato | Data Início | Data Término | Duração | Modalidades | Plano | Situação Contrato |
Data Lançamento | Valor | Forma Pagamento | Condição Pagamento | Empresa | Turma | Categoria | Consultor
```

**Saída (formato que o módulo já ingere)**

```
Código | Cliente | Data | Itens | Valor Venda | Desconto Venda | Desconto Recebimento |
Valor Final | Valor Quitado/Recibo | Origem | Tipo de Venda | Vendedor
```

## Mapeamento

| Saída | Vem de | Confiança |
|---|---|---|
| `Cliente` | `Nome Cliente` | ✅ |
| `Data` | `Data Lançamento` | ⚠️ 94% caem no mês certo — melhor disponível |
| `Itens` | `Plano`/`Produto` (mesmo formato) + período de `Data Início`/`Término` | ✅ quando legível |
| `Valor Quitado/Recibo` | `Valor` | ✅ |
| `Tipo de Venda` | `Situação Contrato` → Matrícula=Novo · Rematrícula=Retorno · Renovação=Renovação | ✅ |
| `Origem` | `Responsável`#2 == `RECORRENCIA` → "Renovação automática"; senão "Balcão" | ✅ medido |
| `Vendedor` | `Consultor` (com duas exceções sem conflito — ver adiante) | ✅ |
| `Código` | `C<contrato>` ou `A<matrícula>` | ⚠️ obrigatório: `cleanRawData` descarta linha sem código |
| unidade | `Empresa` (CP/PP, 98/98 limpo) | ✅ **melhor que o TecnoFit** |

## Decisões tomadas, com a medição que as sustenta

Base: `faturamento-recebido_..._20260813_081650.xls`, **196 linhas de agosto/2026**.

### 1. Vendedora sai de `Consultor`, sem plano B genérico

Rejeitado usar `Responsável`#1 como reserva: onde ambos estão preenchidos, **concordam em 46%** (67 de 146). `Responsável` é *quem lançou*, `Consultor` é *quem vendeu* — aparece cru nos dados (`Responsável=ERICA, Consultor=FRANCINI`). Como reserva, pagaria a pessoa errada em mais da metade.

E o buraco é menor do que parecia: das **50** linhas sem `Consultor`, **40 são bar e loja** (água, paçoca, Monster, camiseta) e **7** são `IMPORTAÇÃO`. **Sobram 3 linhas de contrato.**

Duas exceções, ambas sem conflito possível: **produto de balcão** (não existe "lançou ≠ vendeu") e o caso em que **sobra uma pessoa só** entre as duas colunas de `Responsável`, descontados os rótulos de sistema.

### 2. Renovação automática = `Responsável`#2 == `RECORRENCIA`

A suposição antiga se confirmou de forma limpa: as **13** linhas `RECORRENCIA` são **subconjunto exato** das **34** pagas em `CARTÃO RECORRENTE` (0 fora). Leitura: cartão recorrente = cartão salvo; `RECORRENCIA` = o robô lançou sem gente.

**Usar a forma de pagamento como sinal cortaria 21 vendas legítimas.** Renovação automática não paga comissão — em julho eram 33 automáticas × 27 trabalhadas. Em agosto só 13 porque a recorrência da Pacto mal começou; **esse número vai crescer** e é o principal ponto de vazamento de dinheiro.

### 3. Agrupar por `Contrato` antes de somar

A taxa de matrícula vem em linha separada do plano, **repetindo o mesmo `Plano` do contrato**. Em agosto: 121 linhas com `Contrato` ≠ 0 → **111 contratos**, 9 com mais de uma linha. Sem agrupar, viram ativações duplicadas. As 75 linhas com `Contrato` = 0 são avulsos e produtos.

### 4. `RECEBIMENTO TECNOFIT` — corrigido em 26/08

**A regra original estava errada e foi consertada.** `CARTÃO DE CRÉDITO - RECEBIMENTO TECNOFIT` é **forma de pagamento**: a migração do meio de pagamento não terminou, então a cobrança de venda nova também passa pelo gateway antigo.

Descartar tudo que trazia esse rótulo derrubava, no export de 25/08, **10 contratos que começaram em agosto (R$ 2.960)** — com plano escrito por extenso e vendedora identificada. Exemplo: uma matrícula de 03/08, `ECONÔMICO | RECORRENTE | FLEX`, vendida pela Erica.

**Regra certa:** descarta só quando o gateway antigo **e** a `Data Início` fora do mês aparecem juntos — o mesmo sinal dos migrados. O que diz se é dinheiro velho é a data de início do contrato, nunca a forma de pagamento. Caso 5 do smoke guarda os dois lados.

### 5. Normalizar grafia quebrada

`HIIT/MAROMBINHA | MENSA L | ILIMITADO | PADRÃO.` (espaço no meio de "MENSAL") quebra o `detectPeriodicidade()`, que usa word boundary. Normalizar antes de entregar ao motor. `PADRÃO.-` e espaço duplo **não** atrapalham.

## ✅ Decidido (25/08) — LOCAL × FLEX dos 66 `IMPORTAÇÃO`

**Resposta do Rafael: opção (a) — assumir LOCAL e marcar a linha.** O `Itens` sai como
`PLANO IMPORTADO | ANUAL | LOCAL [PLANO PRESUMIDO]`. A marca é **inerte** para o
`classifyRow` — o caso 10 do smoke guarda isso, porque qualquer palavra ali que casasse com
AULA/TAXA/FLEX/DEGUSTAÇÃO mudaria a comissão em silêncio. As linhas saem listadas no
relatório do script, para auditar.

**Efeito muito menor do que o previsto:** depois da regra dos contratos migrados (abaixo),
sobraram **2** planos presumidos em agosto, não 47. Quase todo `IMPORTAÇÃO` é migração, não
venda do mês — o que também derruba o custo do palpite para perto de zero.

### O texto original da decisão, para referência

Das **121 linhas de contrato**, **66 vêm com `Plano`/`Produto`/`Modalidades` = "IMPORTAÇÃO"** — contratos migrados do TecnoFit que perderam o nome do plano.

A `Duração` recupera a periodicidade (12=anual · 24=bianual · 1=mensal/recorrente · **13 e 14 = anual com período de brinde**, ex.: 20/12/2025 → 30/01/2027). O que se perde é **LOCAL × FLEX**, que muda o bônus P2 em **R$ 15 por contrato**.

**Dado que afinou a decisão:** a `Duração` dos 66 é `12`×53 · `24`×5 · `13`×3 · `14`×1 · `1`×4. Ou seja, **57 dos 66 são anuais ou mais** — exatamente a faixa onde a medição do TecnoFit deu **93% LOCAL**.

## 🚨 Contratos migrados — a questão que a construção levantou

**O maior achado de 25/08.** Rodar o tradutor sobre julho deu **R$ 6.641** contra os
**R$ 3.381** realmente pagos — o dobro. A causa não era erro de tradução.

O relatório é `faturamento-recebido`, e a migração do TecnoFit entrou **aos poucos**: cada
contrato que já existia apareceu com `Data Lançamento` no dia em que foi carregado na Pacto
e `Data Início` lá atrás. Em julho são 156 linhas assim; em agosto, 49.

Contadas como venda do mês, um contrato que começou em janeiro paga **ativação e bônus de
anual** em agosto — de novo, do zero.

**Regra implementada:** linha de contrato com `Plano` = `IMPORTAÇÃO` **e** `Data Início`
fora do mês = registro da migração; fica fora da planilha e sai listada. Sozinho nenhum dos
dois sinais serve — contrato vendido em 31/07 e pago em 05/08 tem início fora do mês e é
venda de verdade (3 casos em agosto, com o plano escrito por extenso), e contrato criado na
Pacto em agosto pode vir com o campo de plano em branco.

**O que sustenta a leitura de "migração" e não "parcela":** só **3 contratos de 287** recebem
dinheiro em julho *e* agosto. Não é fluxo mensal, é evento único. E o volume decai
(156 → 49) conforme a base termina de entrar.

## ✅ 25/08 — o cruzamento com o outro relatório confirmou a regra

O Rafael tirou o **"Relatório Faturamento por Período"** (01→25/08, 715 linhas) e ele serviu
de contraprova, porque lista o que foi **vendido** no período. Se os contratos migrados fossem
vendas de agosto, estariam lá.

**Dos 62 contratos marcados como migrados, 50 não aparecem no faturamento.** Os 12 que aparecem
não são venda nenhuma: **6 são `QUITAÇÃO DE DINHEIRO - CANCELAMENTO`** (que o tradutor já exclui
como rescisão) e **6 são `MANUTENÇÃO - MODALIDADE` de R$ 0,00** — ajuste de contrato, sem dinheiro.

**Nenhum dos 62 é venda de agosto.** A regra está confirmada pelo próprio dado da Pacto, e a
pergunta pro Rodrigo deixa de ser uma decisão de R$ 2.360 e vira uma confirmação.

## 🛑 Os dois relatórios são gêmeos e o errado paga 12× a mais

**O achado mais perigoso da frente.** `Relatório Faturamento por Período` tem **exatamente as
mesmas 21 colunas, nas mesmas posições** do `faturamento-recebido`. O tradutor engolia os dois
sem reclamar. Mas o valor é outro:

| contrato | plano | recebido | faturamento | razão |
|---|---|---:|---:|---:|
| 7078 | (anual) | R$ 259,00 | R$ 3.108,00 | **12,0×** |
| 7045 | (anual) | R$ 239,00 | R$ 2.868,00 | **12,0×** |
| 7064 | (anual) | R$ 249,00 | R$ 2.988,00 | **12,0×** |
| 7038 | (recorrente) | R$ 329,00 | R$ 329,00 | 1,0× |

O `faturamento` traz o **contrato inteiro**; o `faturamento-recebido` traz a **parcela que entrou**.
Como `getValor` paga 5% sobre o valor quitado, subir o arquivo errado pagaria **R$ 155 em vez de
R$ 12,95 em cada contrato anual** — e nada na tela acusaria.

Pior: **plano recorrente dá 1,0× nos dois**, porque o contrato é de um mês só. Uma conferência
por amostragem que caísse em recorrentes não veria diferença nenhuma.

**Proteção implementada:** `PactoAdapter.detectarRelatorio()` — `Forma Pagamento` vem **100%
preenchida** no recebido e **100% vazia** no faturamento (386/386 contra 0/715). O script
**recusa** o arquivo errado com a explicação; `--forcar` ignora.

### Outras diferenças do relatório de faturamento (não usar, mas registrar)

- `Forma Pagamento` inteira vazia → `RECEBIMENTO TECNOFIT` e o desempate RECORRENTE/MENSAL
  da duração 1 não funcionam nele.
- Muito mais fragmentado: 429 linhas de contrato em 210 contratos (2 linhas por contrato,
  contra 121/111 no recebido). Aparecem `TAXA DE ANUIDADE PLANO RECORRÊNCIA` (102),
  `MANUTENÇÃO - MODALIDADE` (94), `PRORATA` — quase todas **R$ 0,00**.
- `Produto` ganha sufixo de agrupamento: `"… PADRÃO. - 12 - cod. 141"`.
- `Data Início`/`Término` vêm como `" - "` em linha sem contrato (tratado: o período só é
  montado quando há dígito nas duas datas).
- Duração **26** aparece pela primeira vez.
- `RECORRENCIA` no `Responsável`#2 sobe pra 40 linhas (era 13 no recebido de meio mês).

## ✅ Resolvido (26/08) — o `Consultor` de PP é o Rodrigo em 16 contratos

Rodando o export de 26/08 (mês quase fechado), PP fica com **17 ativações comissionáveis contra
51 do CP** — invertido em relação a julho, quando PP tinha mais (47 × 42).

A causa: **16 contratos de PP vêm com `Consultor` = `RODRIGO ROJAIS`**, que está na lista de
não-comissionáveis, então ninguém recebe por eles. Em 9 desses 16 o `Responsável`#1 é a Kali ou
a Bárbara, o que levantou a dúvida: seria o cadastro com consultor padrão errado?

**Não é. O Rafael confirmou em 26/08: o Rodrigo vende também.** Sendo sócio e não-comissionável,
está correto que essas 16 vendas não paguem comissão a ninguém — o `Responsável` ali é só quem
digitou o lançamento. Nada a mudar: o tradutor segue o `Consultor`, como decidido.

⚠️ Consequência de operação: quando o Rodrigo atende, aquela venda **não conta ativação para a
meta de ninguém**. Se PP vier sistematicamente atrás do CP no P3, é aqui que o efeito aparece.

## ⚠️ Julho não serve de gabarito

Estava planejado validar contra julho (CP R$ 1.441,60 · PP R$ 1.939,70, 42 e 47 ativações).
**Não dá.** A migração aconteceu durante julho, então o export da Pacto tem só parte do mês:
62 contratos começando em julho, contra 77 vendas só na unidade CP do TecnoFit. Com a regra
dos migrados, julho fecha em R$ 2.021 — coerente com "faltou metade do mês", não com erro.

Julho serviu para outra coisa, e mais valiosa: **foi ele que denunciou a inflação de 2×.**

## Validação feita

- **`scripts/smoke-pacto-adapter.js` — 32 casos.** Metade comportamental: pega a saída do
  tradutor e roda no `CommissionEngine` de verdade (`commission.js` já exporta pro Node),
  em vez de conferir string. Traduzir "certo" e o motor entender errado não valeria nada.
- **`scripts/smoke-pacto-ponta-a-ponta.js` — 8 casos.** A corrente inteira com as peças da
  tela: linha da Pacto → adapter → escritor de xlsx → **SheetJS de verdade**
  (`vendor/xlsx.full.min.js`, o mesmo do `index.html:4173`) → motor. Cada elo pode estar
  certo e a corrente arrebentar na junta; o prejuízo apareceria como "sumiu venda", sem erro.
- **`scripts/smoke-xlsx-write.js` — 4 casos.** Ida e volta do escritor novo.
- ⚠️ **`cleanRawData` para de ler na linha "Total"** (`commission.js:498`) e descarta em
  silêncio linha com `Código` vazio — por isso todo registro sai com código (`C7078`,
  `A9911`). O caso 3 do ponta-a-ponta guarda isso.
- ⚠️ **Sem homologação humana no navegador.** A prova de que o arquivo gerado abre é o
  SheetJS rodando no Node, não um clique na tela de Comissões.

## O que a construção descobriu além do desenho

| Achado | Efeito |
|---|---|
| **Contratos migrados** (acima) | R$ 13.203 · resolvido pelo cruzamento |
| **Dois relatórios gêmeos** (acima) | pagaria 12× a mais · bloqueado |
| `PACTO - MÉTODO DE GESTÃO` assina 221 linhas do `Responsável`#1 | é o robô da migração, não gente. Tratado como nome, deixava **6 contratos (R$ 1.495) sem vendedora** e o robô aparecia no ranking. Virou rótulo de sistema, junto de `ADMINISTRADOR` e `RECORRENCIA` |
| **A Pacto já registra venda dividida**: `Consultor` = "ERICA FAUSTINO, FRANCINI DAS CHAGAS" (9 linhas) | ganho sobre o TecnoFit, onde a divisão era declarada à mão — julho precisou de 8 divisões aplicadas na tela. A venda fica com a primeira e sai listada pra dividir na tela |
| `Produto` é o item da LINHA; `Plano` é o do CONTRATO | a linha da taxa de matrícula repete o `Plano` do contrato. Traduzir pelo `Plano` daria 2 ativações e 2 bônus no mesmo contrato — pagaria dobrado. Resolvido por papel: uma linha por contrato é o plano, o resto é taxa |
| `QUITAÇÃO DE DINHEIRO - CANCELAMENTO` (5 linhas, R$ 1.001,68) | acerto de contrato cancelado. Sai como `RESCISÃO CONTRATUAL — …`, que o motor já exclui sozinho. Sem isso virava 5 ativações anuais |
| **Bar e loja vêm sem `Consultor`** (40 linhas, R$ 1.953) | no TecnoFit tinham vendedora e pagavam 5%. Pra produto de balcão não existe "quem lançou ≠ quem vendeu" — cai no `Responsável` |
| `Data Início`/`Data Término` 100% preenchidos nas linhas de contrato | dá pra remontar o `(dd/mm/aaaa - dd/mm/aaaa)` que o TecnoFit trazia no `Itens` e que o motor usa pra **adiar venda futura** |
| **`Duração` 13 e 14** (não explicados no desenho) | anual com período de brinde |
| `Duração` 1 | MENSAL, ou RECORRENTE quando a forma é cartão recorrente (R$ 5 de diferença no P2) |
| TecnoFit era `vendas realizadas`, Pacto é `faturamento-recebido` | relatórios diferentes. Na prática o módulo já pagava por caixa recebido (`getValor` só olha `Valor Quitado/Recibo`), então a economia bate — mas é daí que nasce a questão dos migrados |

## Como rodar

```bash
node scripts/medir-export-pacto.js "relatorios pacto/faturamento-recebido_....xls" 2026-08
```

```bash
node scripts/traduzir-export-pacto.js "relatorios pacto/faturamento-recebido_....xls" 2026-08
```

Gera `PACTO-2026-08-CP.xlsx` e `PACTO-2026-08-PP.xlsx` na pasta do arquivo de entrada
(`--saida <pasta>` muda), mais um relatório com simulação de P1+P2 por vendedora, planos
presumidos, contratos migrados, descartadas e avisos. **Conferir antes de subir na tela.**

## Armadilhas operacionais

- **Usar sempre o `faturamento-recebido_*.xls`.** O outro paga 12× a mais (ver acima).
- **Dois exports do mesmo 13/08 trazem períodos diferentes** (um com agosto, outro só julho): o conteúdo depende do filtro marcado na hora. Combinar procedimento padrão com o Rodrigo.
- **O export de 13/08 é meio mês** — pra pagar agosto, pedir o mês fechado.
- Apesar da extensão `.xls`, os arquivos são **zip/xlsx**. `scripts/lib-xlsx-min.js` lê no Node — `sheet()` devolve **objeto** indexado por linha, não array.
- **`KALI LÓPEZ` (Pacto) e `KALI DUTRA` (TecnoFit) são a mesma pessoa** — normalizado no adapter.
- **As metas são por unidade e saem de `units/{id}`**, nunca supor as padrão. Por isso a simulação do script só vale para P1 e P2.
- **Nada disto estava commitado e um `git clean -fd` apagou tudo em 26/08.** Commitar cedo.

## Fora de escopo

Reforma do `index.html`, integração com a API da Pacto, painel do Rodrigo, cálculo contínuo no meio do mês. Cada um ganha seu próprio ciclo depois que este rodar.
