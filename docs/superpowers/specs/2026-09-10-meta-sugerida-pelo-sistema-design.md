# A meta do mês passa a ser calculada pelo sistema — desenho

**Data:** 10/09/2026 · **Pedido por:** Rafael · **Decisões de produto:** Rafael
**Contexto:** cobrança do Rodrigo sobre a meta de setembro (aberta desde a sessão 68)

---

## O problema, em duas camadas

**A que dói agora:** setembro/2026 abriu **sem `metasMensais`** nas duas unidades. Mês sem meta
definida **não é "sem meta"** — o sistema cai no `units/{id}.config`, e esse padrão é **idêntico para
as duas unidades**: `meta 50 · superMeta 57 · metaGold 65 · minNovos 18 · minRenov 25 · minVoucher 7`.

O Campeche opera nessa escala. **O Príncipe não:** a meta própria dele em agosto era **28**, e ele
fez 41. Cair no padrão dá ao Príncipe uma meta quase o dobro da dele e um mínimo de 25 renovações
contra as 15 que ele faz. Ou seja: **mês sem meta é mês com a meta errada, e sempre contra o
Príncipe.** Foi o que zerou o P3 dele em agosto.

**A de fundo:** definir a meta é trabalho manual que depende de o Rodrigo parar para pensar, e
ninguém sabe dizer se a meta escolhida está fácil ou impossível.

O Rafael pediu para avaliar as três coisas juntas: **o mês nunca ficar sem meta · o sistema propor o
número · dar como enxergar o que aquele número significa.**

---

## O que o dado disse antes de qualquer decisão

### 1. A meta sempre foi uma aposta 50/50

| | meses com meta definida | bateu | meta ÷ realizado |
|---|---:|---:|---:|
| Campeche | 7 | 4 | 108% |
| Príncipe | 7 | 4 | 100% |

A meta é posta **no nível do realizado**, não abaixo. Isso vira a mira da conta: reproduzir a régua
que já existe, não inventar outra.

### 2. 🔴 O bottom-up NÃO se sustenta — a hipótese original foi medida e reprovada

A ideia inicial era `renovações que vencem no mês + média de novos`. Backtest walk-forward (para
prever o mês M, só usa dado de meses < M):

| erro médio | média dos 6 meses | bottom-up |
|---|---:|---:|
| Campeche | **11,5** ativações | 11,9 |
| Príncipe | **8,6** ativações | **18,6** |

O motivo aparece no próprio teste: a taxa de conversão que o bottom-up calcula chega a **327%** no
Príncipe — renovações maiores que os vencimentos, o que é impossível. O sistema **não conhece a maior
parte dos contratos que vencem**: ele só vê quem pagou num mês que foi carregado, e o histórico
começa em jan/2025.

E há uma razão conceitual, que não se corrige com mais histórico: **a meta é dominada por venda
nova, não por renovação.** Campeche em agosto: 63 ativações = 33 novos + 16 renovações + resto. A
metade que mais pesa não sai da base instalada.

✅ **O que se aproveita da ideia:** o vencimento de contrato **é** legível em 100% dos casos (o nome
do plano traz `(01/08/2026 - 31/07/2027)`), tanto no histórico do TecnoFit quanto no da Pacto. Serve
para outras coisas — só não serve para prever a meta.

### 3. `superMeta` e `metaGold` são regra, não julgamento

Em 14 meses: `superMeta ÷ meta` ficou entre **1,13 e 1,20**; `metaGold ÷ meta` entre **1,27 e 1,36**.

### 4. Os mínimos derivaram ao longo do ano

A fração da média dos 6 meses que a gestão usou, em todo o período × na prática recente:

| | todo o período | agosto/2026 |
|---|---:|---:|
| `minNovos` | 0,77 | **0,59** |
| `minRenov` | 1,26 | **0,83** |

Usar o fator de todo o período **endureceria a trava** sem ninguém ter decidido isso — e `minNovos` é
trava dura (abaixo dela o P3 é zero). Por isso o fator sai da **prática recente**.

---

### 5. 🔄 A resposta do Rodrigo (10/09) — o que foi medido antes de mexer no desenho

Ele aprovou a régua (item 1) e os mínimos calculados (item 5), pediu a trava (item 4) e levantou
duas coisas que **atacavam a fundação da conta**. As duas foram medidas contra a produção:

**(a) Sazonalidade** — *"meses de alta: set, out, nov, jan, fev, mar, abr; os outros têm que ser
olhado um a um"*. Backtest walk-forward das réguas concorrentes:

| erro médio (ativações) | média 6 meses | **com fator sazonal** | mesmo mês do ano anterior | média 3 meses |
|---|---:|---:|---:|---:|
| Campeche | **13,0** | 14,3 | 24,5 | 11,8 |
| Príncipe | **8,3** | 9,2 | 21,3 | 10,9 |

O ajuste sazonal **piora nas duas unidades**, e o dado diz por quê: a sazonalidade existiu em 2025
(baixa 27,5 × alta 50,0 no CP) e **sumiu em 2026** — mai–ago (baixa) deram média 57,5 contra 53,3 de
jan–abr (alta). A academia cresceu por cima da estação.

✅ **Mas o pedido dele não morre — ele se resolve pelo item 4 dele.** *"Olhado um a um"* é
exatamente o que a validação obrigatória faz. A conta propõe; nos meses fora do padrão a gestão
corrige. Não vira fórmula.

**(b) Dados contaminados pela migração** — *"ainda ocorrem alguns pagamentos duplicados"*. Varredura
de jul/ago/set nas duas unidades:

| | contratos repetidos | dos quais **split legítimo** | duplicidade real |
|---|---:|---:|---:|
| CP jul | 6 | 4 | **2** |
| PP jul | 10 | 10 | **0** |
| CP/PP ago e set | 0 | — | **0** |

Efeito na meta: **menos de meia ativação** contra um erro típico de 8 a 13. A bagunça é real na
Pacto, mas **não move o número**. Julho fica na base.

### 6. O fator recente da gestão é 0,95 — não 1,00

Medindo `meta definida ÷ média dos 6 meses anteriores` nos últimos 3 meses com meta:

| | fatores | média |
|---|---|---:|
| Campeche | 1,08 · 0,88 · 0,90 | **0,95** |
| Príncipe | 0,90 · 1,21 · 0,75 | **0,95** |

As duas unidades convergem no mesmo número, por caminhos diferentes. **O desenho usa 1,00 na meta**
(só os mínimos usam fator recente) — aplicar 0,95 daria Campeche 55 e Príncipe 36. Fica registrado
como calibragem possível; **não foi adotada**, porque a régua declarada ao Rodrigo é a média pura e
mudar isso agora quebraria a explicação que ele acabou de receber.

---

## A conta

Roda sobre os **6 meses completos anteriores**.

### 🚨 "Completo" tem que olhar o DADO, não só o calendário

A regra de calendário sozinha (*"todo mês anterior ao corrente conta"*) está errada, e o erro é
grande. Quando outubro começar, setembro será um mês passado — mas o arquivo de setembro que está no
sistema hoje cobre **1 a 8/09**, com 19 ativações no Campeche. Entrando na média assim, a meta de
outubro cairia de **58 para 49** — e ninguém veria por quê.

Isso não é hipótese: **é o estado atual da produção.** O arquivo sobe toda vez que alguém (Rafael
ou Rodrigo) exporta da Pacto e arrasta na tela — é manual, então o mês só fica completo se alguém
subir de novo depois do último dia, e nada garante que isso aconteça.

**A regra:** um mês entra na média quando (a) é anterior ao mês corrente **e** (b) o dado dele
**alcança o último dia do mês** — o maior `data` dos itens é comparado com o fim do mês. Mês que não
alcança é **pulado**, e a janela busca um mês mais atrás para completar os 6.

O mês pulado é dito na explicação (`base.parciaisIgnorados`), porque um mês sumir da conta em
silêncio é o tipo de coisa que faz a gestão não entender de onde veio o número.

Com o dado de hoje, a base de outubro é **março→agosto** (setembro pulado por estar parcial) — os
**58** da tabela abaixo. Quando setembro for subido inteiro, a base vira abril→setembro e o número
muda; a tela recalcula só para meses que ainda não têm meta.

| campo | fórmula |
|---|---|
| `meta` | média das **ativações** dos 6 meses |
| `superMeta` | `meta × 1,15` |
| `metaGold` | `meta × 1,30` |
| `minNovos` ⚠️ | média de **novos/retorno** × fator da prática recente |
| `minRenov` | média de **renovações** × fator recente |
| `minVoucher` | média de **vouchers** × fator recente |
| `minAtivacoesIndivP3` | repete o último definido (a série só existe desde agosto) |

O **fator da prática recente** é a média de `valor ÷ média-dos-6-anteriores` nos **últimos 3 meses
que tiveram meta definida** naquela unidade. É o que impede a conta de endurecer sozinha.

Tudo arredondado para inteiro.

### O que dá para outubro

| | meta | super | gold | minNovos | minRenov | minVoucher |
|---|---:|---:|---:|---:|---:|---:|
| **Campeche** | **58** | 67 | 75 | 19 | 16 | 5 |
| *gestão pôs em ago* | *50* | *57* | *65* | *18* | *13* | *6* |
| **Príncipe** | **37** | 43 | 48 | 17 | 14 | 3 |
| *gestão pôs em ago* | *28* | *32* | *37* | *15* | *9* | *4* |

⚠️ **O Príncipe é o caso que prova o limite da conta.** Ela dá 37; a gestão escolheu 28 em agosto
porque sabia que a base migrada estava pesando. **A conta não erra — ela não sabe.** É por isso que o
número nasce rotulado e o aviso existe.

---

### 🔴 A proposta de SETEMBRO — enviada ao Rodrigo em 10/09

Setembro não sai da conta automática (o mês já está aberto e rodando com o padrão herdado de 50).
Foi montado à mão, com a mesma régua, e mandado para ele decidir:

| | Campeche | Príncipe |
|---|---:|---:|
| meta | **58** | **37** |
| superMeta · metaGold | 67 · 75 | 43 · 48 |
| minNovos | 18 | **15** ⚠️ |
| minRenov | 16 | 14 |
| minVoucher | 5 | 3 |
| minAtivacoesIndivP3 | 10 | 7 |

**Dois desvios conscientes da conta, ditos a ele:**

1. **Príncipe 37 e não 38.** A conta dá 37,7. Arredondado para baixo por causa da ressalva dele
   sobre a base migrada — é onde a preocupação dele entra sem quebrar a régua.
2. **`minNovos` do Príncipe 15 e não 16.** A conta dá 16,2, e o Príncipe fez **exatamente 16** em
   agosto — passaria raspando. `minNovos` é a **única trava dura** (`commission.js:671` faz `return`
   e o P3 vai a zero); `minRenov` e `minVoucher` só aplicam redutor (×0,70 e ×0,85). Não se põe uma
   trava dura na linha exata do último realizado.

**O que sustenta o 58 e o 37:** as duas ficam em ~92% do realizado de agosto (63 e 41) — a régua que
a gestão já pratica. E o mês em curso confirma: até 08/09 o Campeche tinha 19 ativações, e ele faz
mediana de 28% do mês até o dia 8, o que aponta ~67. ⚠️ **O mesmo cálculo no Príncipe daria 66 e foi
descartado**: a dispersão dele até o dia 8 vai de 10% (agosto) a 45% (fevereiro), então a projeção
não sustenta nada.

🟡 **Achado de brinde, avisado ao Rodrigo:** o Campeche não vendeu **nenhum** mês-degustação até
08/09, contra 14 em agosto inteiro. Com `minVoucher` 5, o P3 da unidade inteira levaria ×0,85. Não é
efeito do regime de caixa — a degustação custa R$ 89 e aparece no relatório normalmente.

---

## 🔎 A lista de renovações (pedido do Rodrigo) — medida contra o PDF dele

Ele mandou o PDF que monta à mão (`Renovações CP MAI26`) e pediu a mesma lista dentro do sistema, com
a consultora indicada manualmente. **A viabilidade foi medida, não estimada:** os 53 contratos do PDF
foram conferidos um a um contra o que o sistema sabia **antes de maio/2026**.

| seção do PDF | no PDF | o sistema acha | com o mesmo vencimento |
|---|---:|---:|---:|
| Renovações do mês | 30 | **26** | 22 |
| Antecipação (até dia 15) | 15 | **14** | 9 |
| Vouchers degustação | 8 | **8** | 7 |
| **total** | **53** | **48 (91%)** | |

**Os 5 que faltam têm uma causa única e consertável: meses que nunca foram carregados.**

| unidade | meses ausentes | consequência |
|---|---|---|
| Campeche | `2025-05` | anuais de mai/2025 → venciam em mai/2026 (já passou) |
| Príncipe | `2025-05`, **`2025-11`** | 🔴 anuais de nov/2025 vencem em **nov/2026 — daqui a 2 meses** |

**O inverso também foi medido:** o sistema listaria 62 vencimentos em maio, 30 a mais que o PDF — e
quase todos são o que o próprio Rodrigo mandou excluir: **10 planos de crédito** (`4 AULAS`,
`15 AULAS`), **5 recorrentes**, 3 degustações. Sobram ~6 anuais de alunos que já tinham saído —
**o buraco honesto: o sistema não enxerga cancelamento, só pagamento.**

**Duas coisas que a tela faria melhor que o PDF:**

- a coluna da consultora **nasce preenchida** com o `vendedor` do contrato original;
- a coluna "Renovou?" **se fecha sozinha** no upload seguinte — ⚠️ casando **por nome do cliente, não
  por número de contrato**, porque a Pacto cria contrato novo na renovação (a lógica já existe em
  `vendas-aguardando.js`). É o que dá a taxa de renovação real, que ele hoje calcula na mão (usa 60%,
  quer chegar a 70%).

**`IMPORTAÇÃO` é problema pequeno:** 5 contratos no Campeche, **os 5** com o nome do plano legível em
outro registro do mesmo cliente; **zero** no Príncipe. Dá para puxar do TecnoFit como ele pediu — o
histórico do TecnoFit está dentro do nosso próprio sistema.

⚠️ **Requisito operacional que ninguém tinha visto:** o ritual dele é dias **01, 07 e 15**, e a lista
**cresce durante o mês** (os mensais só entram quando são vendidos) — hoje a lista de out/2026 tem 19
nomes no CP e 14 no PP, contra os 30 do PDF de maio. Para as três fotos existirem, **o arquivo da
Pacto precisa ter subido naqueles dias**. ⚠️ *Corrigido em 13/09 pelo Rafael:* o upload **não** é
mensal — sobe toda vez que ele ou o Rodrigo exportam e arrastam na tela. O problema real é ser
**manual**; o objetivo é que vire **automático e diário** (via API da Pacto).

**Status:** não construir ainda. Foi perguntado ao Rodrigo o que ele prefere primeiro — a meta
automática (que destrava a folha de outubro) ou esta tela.

---

## Onde vive

Módulo puro **`metas-sugeridas.js`**, no padrão de `commission.js`, `vendas-aguardando.js` e
`closing-payroll.js`: sem Firebase, sem DOM, roda em Node e no navegador.

Recebe o histórico da unidade e devolve os sete campos **mais o porquê de cada um** — a tela nunca
recalcula nada, só lê e mostra. Isso é o que permite testar a regra sem subir tela.

```
MetasSugeridas.sugerir(historico, metasAnteriores) → {
  campos:  { meta, superMeta, metaGold, minNovos, minRenov, minVoucher, minAtivacoesIndivP3 },
  porque:  { meta: 'média de 6 meses: 69 · 47 · 69 · 58 · 40 · 63', ... },
  base:    { meses: 6, parcialIgnorado: '2026-09' },
  confiavel: true          // false quando o histórico é curto demais
}
```

## Quando grava, e o rótulo

Ao abrir um período **sem `metasMensais`**, a tela calcula e grava, com `origem: 'sistema'` e
`revisadaPor: null`.

### 🔄 REVISTO EM 10/09 — agora TRAVA

O desenho original dizia *"não trava nada"* (decisão do Rafael em 09/09). **O Rodrigo pediu o
contrário** — *"Melhor fazer essa sugestão, mas a ser validada pela gestão"* — e o Rafael acatou em
10/09: **passa a travar.**

**A trava:** enquanto `revisadaPor` for `null`, **o recibo não sai** naquele mês/unidade. É a mesma
natureza da trava de trocas em aberto no fechamento de professores: a regra sempre permitiu seguir,
o que faltava era alguém decidir.

⚠️ **O efeito prático foi dito ao Rodrigo por escrito:** se ninguém clicar, a folha não fecha. Sem
isso a trava vira surpresa em 15/10.

A visibilidade continua sendo a mesma:

1. **O rótulo** "posta pelo sistema" acompanha a meta onde ela aparecer, enquanto ninguém revisou.
2. **O aviso na home da gestão**, no mesmo lugar das outras pendências:

```
⚠️ A meta de outubro (58) foi calculada pelo sistema e ninguém
   revisou. Erro típico da conta: ~10 ativações.
   O recibo deste mês não sai até alguém confirmar.
   [ Revisar ]        [ Está bom ]
```

Qualquer um dos dois botões marca `revisadaPor`, destrava o recibo e o aviso some para sempre
naquele mês. **[Revisar]** abre a tela de metas; **[Está bom]** só carimba.

`metasMensais` sobrevive ao re-upload do arquivo (`set(..., { merge: true })`) — verificado no código
e comprovado no dado: agosto foi re-subido em 08/09 e manteve a meta.

---

## Casos de borda

| situação | o que acontece |
|---|---|
| **Setembro/2026, já aberto sem meta** | **é preenchido retroativamente** ao subir o código: Campeche 58, Príncipe 37, saindo do padrão herdado de 50. Com aviso na home, para a gestão revisar antes da folha de 15/10 |
| **Mês em curso** | fica fora da média, sempre |
| **Mês passado com dado parcial** | é **pulado** e a janela busca um mês mais atrás. O mês pulado aparece na explicação — sumir calado faria a gestão não entender o número |
| **Histórico de 3 a 5 meses** | calcula com o que tem e diz na tela: *"base curta: média de 4 meses, não 6"* |
| **Histórico com menos de 3 meses** | **não propõe nada** (`confiavel: false`) e pede que a gestão defina. Média de 1 ou 2 meses é chute com cara de conta |
| **Unidade sem nenhuma meta anterior** | não há fator recente nem `minAtivacoesIndivP3` para repetir: usa fator **1,00** nos mínimos, cai no padrão da unidade para o corte individual, e **diz na tela** que o fator não pôde ser calibrado |
| **Mês que já tem meta** | não é tocado, nunca — nem por recálculo, nem por re-upload |
| **Ativações fracionárias** | o dado real tem `47,3` ativações (venda dividida entre duas vendedoras). A média lida com decimal; só o resultado é arredondado |

---

## O que este desenho NÃO faz

- ~~**não trava nada**~~ → **revisto em 10/09: TRAVA o recibo** enquanto ninguém revisar (pedido do
  Rodrigo, acatado pelo Rafael). **O fechamento continua não sendo travado**;
- **não usa vencimento de contrato** para prever a meta — foi medido e reprovado. ⚠️ Isso vale só
  para a **meta**: o vencimento é a matéria-prima da **lista de renovações**, que é outra entrega;
- **não aplica fator sazonal** — medido em 10/09 e reprovado (piora nas duas unidades). A
  sazonalidade que o Rodrigo pediu entra pela validação da gestão, mês a mês;
- **não aplica o fator recente 0,95 na meta** (só nos mínimos), embora as duas unidades convirjam
  nele — a régua declarada ao Rodrigo é a média pura;
- não mexe no `commission.js` nem em como o P3 é calculado: só decide **quais números** entram em
  `cfg`;
- não altera meses passados que já têm meta;
- não remove o `units/{id}.config` como padrão — ele continua existindo para o caso de histórico
  insuficiente. O que muda é que ele deixa de ser o caminho normal.

---

## Testes

Escritos antes do código, no módulo puro, e com o caminho de tela recortado por **assinatura**.

| | o que prova |
|---|---|
| a média | 6 meses completos, mês corrente fora |
| **mês passado parcial** | o setembro real (1 a 8/09, 19 ativações) é **pulado**, a janela busca um mês atrás, e a meta de outubro dá **58** e não 49 — o caso que quase entrou calado |
| o mês pulado | aparece na explicação, com o motivo |
| os fatores | `superMeta` e `metaGold` saem em 1,15 e 1,30 |
| o fator recente | calibra pelos últimos 3 meses com meta, não por todo o período |
| trava dura | `minNovos` calculado não sobe acima da prática recente |
| histórico curto | 4 meses calcula e marca base curta; 2 meses devolve `confiavel: false` |
| mês já com meta | não é sobrescrito, nem no recálculo nem no re-upload |
| o rótulo | some quando `revisadaPor` é preenchido |
| o aviso | aparece só enquanto ninguém revisou, e nas duas unidades separadamente |
| **a trava** | o recibo **não sai** com `revisadaPor: null`, e **sai** assim que qualquer um dos dois botões carimba — nas duas unidades separadamente |
| **a trava não vaza** | o fechamento de professores e o resto do mês seguem funcionando; só o recibo trava |
| fracionário | `47,3` ativações não quebram a média |
| o porquê | cada campo devolve a explicação, e ela cita os números que usou |

Depois: **homologação contra o Firestore real do staging**, exercitando o caminho de escrita e
devolvendo o banco — no padrão de `homologar-conferencia-pelo-pagamento.js`. E conferência de que a
proposta calculada bate com os números deste desenho (Campeche 58, Príncipe 37).
