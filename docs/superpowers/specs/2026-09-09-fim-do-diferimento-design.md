# O fim do diferimento — desenho

**Data:** 09/09/2026 · **Decidido por:** Rafael
**Contexto:** regime de caixa em vigor desde setembro/2026 · marco zero das comissões: **agosto/2026**

---

## O problema

`commission.js` tem uma regra: venda de ativação cujo plano começa **mais de 30 dias** depois do
pagamento não paga comissão no mês do pagamento — ela é empurrada para o mês em que o plano começa,
como registro em `comissoes_diferidas`.

A regra nasceu quando a comissão era do mês da **venda**, e servia para não pagar por um contrato
que o cliente ainda podia desistir de usar.

**Sob regime de caixa ela contradiz a regra que está valendo:** a comissão é do mês em que o
dinheiro entrou, paga no dia 15 do mês seguinte. Quando o aluno começa a treinar não entra na conta.
E a desistência já tem outro dono — é **estorno**, que o sistema trata virando crédito no pagamento
seguinte.

### E há um buraco, não só uma incoerência

A coleção `comissoes_diferidas` tem quatro usos no sistema: **cria** no upload, **apaga** se o
período for excluído, e **duas telas que só exibem**. Nenhum lugar soma o valor no que a vendedora
recebe — o pagamento é montado só com item `type === 'processed'`, e o diferido foi excluído
justamente desse balde.

**Medido em produção (09/09/2026):** 91 comissões diferidas únicas desde janeiro/2025, **todas com
`status: 'pendente'`**. Nenhuma foi aplicada uma única vez.

| | |
|---|---:|
| comissão que saiu e nunca voltou | **R$ 6.318,17** |
| ativações que sumiram das metas | **91** |
| registros duplicados por re-upload | 141 docs para 91 itens reais |

Por vendedora, quase tudo é de gente que já saiu: Thay Silva R$ 2.495,77 · Agatha R$ 2.095,68 ·
Naielly R$ 1.513,60. Das ativas: Erica R$ 132,20 e Francini R$ 33,98.

> ⚠️ O que está provado é que **o sistema** não soma. Se alguém somava na mão olhando a aba
> "Diferidos" na hora de pagar, isso o banco não registra.

---

## As decisões do Rafael (09/09/2026)

| | |
|---|---|
| **Marco zero** | **agosto/2026** — o primeiro mês pago sob caixa (folha em 15/09) |
| **O que ficou para trás** | morreu. Não se recalcula, não se paga, não se conversa mais sobre isso |
| **Os R$ 132,20 da Erica** | morrem junto — são de vendas de **julho**, e julho está atrás do corte |
| **A aba "Diferidos"** | **sai do menu**. Os dados ficam no banco |
| **A data do corte** | **fixa no código**, não configurável |

### Por que a data é fixa, contra a regra geral do projeto

O projeto tem a regra de deixar datas nas mãos da gestão ([[feedback-datas-configuraveis]]). Esta é
de outra natureza: não é uma data de calendário da operação, é **o dia em que uma regra de negócio
mudou**. Um campo editável convidaria alguém a mover o marco e reescrever, sem querer, uma folha já
paga. Ela fica documentada aqui e visível na tela.

---

## O desenho

### 1. A regra, no motor

`commission.js` ganha `FIM_DO_DIFERIMENTO = '2026-08'`. O corte olha o **mês do pagamento**
(`dateObj`), não o mês do início do plano:

- pagamento em **2026-08 ou depois** → nunca difere; a comissão é do mês do pagamento;
- pagamento **antes** → difere como sempre diferiu.

O segundo caso não é nostalgia: preserva o resultado de meses já pagos se alguém re-subir um arquivo
antigo. São 20 meses de histórico calculados com a regra velha.

### 2. O que muda no resultado

| Agosto/2026 | hoje | depois |
|---|---:|---:|
| Campeche | 65 ativ · R$ 22.899,49 | **igual** (nenhuma diferida) |
| Príncipe — ativações | 41 | **44** |
| Príncipe — caixa | R$ 13.634,03 | **R$ 17.142,20** |
| Príncipe — comissão | R$ 1.155,78 | **R$ 1.189,76** |

Os R$ 33,98 a mais são todos da **Francini**. As 3 ativações a mais entram na régua da meta do
Príncipe, e é sobre esse número que setembro será calibrado.

De setembro em diante: nenhuma diferida nova (o arquivo de 01–08/09 já não gera nenhuma).

### 3. A consequência que é escolha, não surpresa

Com o diferimento fora, **quem renova com muita antecedência gera comissão agora**. O caso real é o
**MARCELO ALVES DE PAULA**: pagou R$ 159,17 em 17/08/2026 para um plano que começa em **21/08/2027**.
A Francini recebe R$ 33,98 em 15/09/2026 por um contrato que começa daqui a um ano. É o que a regra
de caixa diz — o dinheiro entrou.

### 4. Tela

- a aba **"Diferidos"** sai da navegação nos **dois lugares**: gestão (`tabDiferidos`, botão em
  `switchDashTab`) e vendedora (`vtabDiferidos`, botão em `switchVendorTab`);
- o texto **"Regra dos 30 dias"** sai junto;
- os cards de contagem "Diferidos" na prévia do upload e no resumo saem — de setembro em diante o
  número é sempre zero, e um zero permanente na tela é ruído que alguém um dia vai tentar explicar;
- o **menu lateral** perde os dois itens "⏳ Diferidos".

Os handlers de render (`renderDiferidosTab`, `renderVendorDiferidosTab`) ficam no arquivo, órfãos e
inertes: apagá-los é limpeza de outra tarefa, e ninguém os alcança sem o botão.

### 5. Dados

- **não se apaga histórico.** Os 88 registros com origem anterior a agosto/2026 ficam;
- **os 3 registros de `pp_2026-08` saem**, com backup em `backups/`: se ficassem, o mesmo contrato
  teria um item pago e um registro dizendo que foi adiado — dois documentos se contradizendo sobre o
  mesmo dinheiro. São JULIANA COSTA, JAQUELINE FREIBERGER e MARCELO ALVES DE PAULA;
- nenhuma comissão é recalculada em mês anterior a agosto/2026.

### 6. A boa notícia de ordem

Se agosto for **re-subido depois** desta mudança, os itens de JULIANA COSTA (C4652) e JAQUELINE
FREIBERGER (C4636) viram `processed` e entram sozinhos em `codigosPagos` — ou seja, o defeito do
arrasto corrigido em 08/09 (`ecd2b2d`) **se resolve na mesma tacada**, sem rodar o script de
correção de dado.

**Ordem recomendada:** publicar → re-subir agosto → conferir a aba "A receber".

Se agosto **não** for re-subido, o script `corrigir-codigos-pagos-diferidos.js --project production
--aplicar` continua sendo o caminho.

---

## Testes

Escritos antes de tocar no motor.

| | o que prova |
|---|---|
| pagamento em 07/2026, início 60 dias à frente | **ainda difere** — o histórico é preservado |
| pagamento em 08/2026, início 60 dias à frente | **não difere** — entra em `processed` |
| o caso real do Marcelo (17/08/2026 → 21/08/2027) | não difere, e a comissão é R$ 33,98 |
| o arquivo real de agosto | Príncipe 41 → **44** ativações e caixa R$ 17.142,20 |
| o arquivo real de setembro | zero diferidas, antes e depois |
| a tela | nenhum botão leva a `tabDiferidos` nem a `vtabDiferidos` |

O smoke roda o `commission.js` de verdade e recorta a navegação do `index.html` pela **assinatura**,
nunca por texto de comentário — âncora por JSDoc já quebrou dois scripts em 08/09/2026.

---

## O que este desenho NÃO faz

- não recalcula nem repaga nada anterior a agosto/2026;
- não apaga os 88 registros históricos;
- não cria aviso novo para venda com início distante — sob caixa isso é indiferente, e inventar
  alerta sem alguém ter pedido é recurso que ninguém mantém;
- não mexe na duplicação de `comissoes_diferidas` no re-upload: com a regra encerrada, nenhum
  registro novo nasce, e os antigos não são somados por ninguém.
