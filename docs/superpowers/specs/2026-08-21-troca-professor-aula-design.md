# Troca de professor da aula — corrigir quem deu a aula até o fechamento

**Data:** 21/08/2026 · **Origem:** grupo "Sistema Escala Inteligente IA" (Rodrigo, Rafael Rojais)
**Status:** desenho aprovado no grupo, aguardando revisão do Rafael antes do plano de implementação

---

## 1. O que gerou

Print da Camila abrindo a aula de 20/08, 18h, Hiit/Marombinha na PP — titular THEO ROSA, status
`realizada` — e a tela oferecendo apenas *"Para alterar o status, fale com a gestão."*
Relato dela: **"as aulas que já passaram eu não consigo fazer a troca"**.

Rodrigo: *"o usuário tem que conseguir alterar quem deu a aula até o fechamento da folha"*.
Rafael Rojais: *"quem trocou a aula pode também avisar, tendo que o 'dono' da aula confirmar
junto com a gestão"* e *"boa data até o dia 3 de todo mês para fechamento completo"*.

## 2. O que a investigação encontrou

### Não existe trava de tempo

`classModalCanRequestSub` (`professores-agenda.js:1912`) não olha a hora da aula. Bloqueia por
mês fechado, por status `cancelada`/`substituida`, e exige `cls.teacherId === myProfId`.
O retroativo já funciona e já é marcado (`wasRetroactive`). **A regra que o Rodrigo pediu já é a
regra** — o que falta é quem pode acionar.

### O buraco real

Só o **titular** tem o botão. A gestão, ao abrir a mesma aula, muda status, falta, atraso e hora
extra, mas **não tem campo para trocar o professor**. Se o titular não pede, ninguém resolve.
Foi exatamente o caso da Camila.

Isso é **mais estreito do que a spec aprovada em 07/08**
(`2026-08-07-controle-horas-e-substituicao-design.md`, seção 6), que dizia:
*"os dois lados podem registrar mesmo depois da aula ter acontecido; trava quando a folha fecha."*

### Aula trocada não pode ser trocada de novo

`status === 'substituida'` bloqueia o botão. Errou o nome na troca, não tem conserto.

### Pedido duplicado passa

Produção tem 2 pedidos idênticos para a mesma aula (`Vr6ylTkVsYJKsJ4BkPqT_20260804`,
Theo → Thaynara, 11:40 e 13:40 de 04/08, "Consulta médica" / "Consulta medica"). Nada impede.

### Brecha de segurança nas rules

`firestore.rules:176-180` deixa **o próprio solicitante** atualizar o pedido, sem olhar o campo
`status`. Como a CF `processSubstitutionAcceptance` aplica a troca ao ver `accepted`, um professor
consegue, pelo console do navegador, homologar o próprio pedido e mover a aula — e a hora — para
quem quiser entre os dois. Precisa fechar junto.

### Medida do uso real (produção, agosto/2026)

| Medida | Valor |
|---|---|
| Aulas no mês | 1.644 |
| Registros de troca no mês | **2 — e são a mesma troca** |
| Ocorrências lançadas (falta/atraso/extra) | **0** |
| Avisos de professor parados esperando a gestão | 3 (desde 12, 17 e 19/08) |
| Fechamentos existentes | **nenhum** — agosto será o primeiro |

Uma troca registrada no mês inteiro significa que **as trocas estão acontecendo fora do sistema**.
O fechamento pagaria quem estava escalado, não quem deu a aula.

## 3. O fluxo aprovado

```
registro ──► confirmação do outro professor ──► confirmação da gestão ──► a aula troca de nome
```

**Quem registra** (qualquer um dos três):

- o titular — "passei minha aula para a Camila" (é o "Pedir substituição" de hoje);
- **quem deu a aula** — "essa aula do Theo quem deu fui eu" (**novo**, e é o caso da Camila);
- a gestão — lança direto; o registro dela já conta como a confirmação da gestão.

Qualquer professor **ativo** pode declarar que deu a aula, mesmo sem a modalidade cadastrada no
perfil dele — aqui se registra um fato consumado, não se monta escala. A modalidade continua
filtrando a lista quando o titular escolhe *para quem* passar uma aula futura.

**Quem confirma:** o professor do outro lado, e depois a gestão. Enquanto não passar pelos dois,
**nada muda na aula nem na folha**.

Quando quem registra é a gestão, o passo dela já está cumprido: falta só o professor confirmar. Se
ela quiser aplicar na hora, usa o escape abaixo — e a aula fica marcada como trocada sem a
confirmação do professor.

**Escape obrigatório:** se o professor não confirmar — férias, folga, desligado, não abre o app —
**a gestão confirma sozinha**, informando o motivo, e fica registrado que a decisão foi dela sem a
resposta do professor. Sem essa saída o sistema trava justamente no cenário que originou o pedido.

**Prazo:** vale até o mês fechar. O fechamento é **até o dia 3 do mês seguinte** (Rafael Rojais).
Depois de fechado, ninguém mexe — inclusive a gestão. Isso já é assim e continua.

## 4. Estados do pedido

| Estado | Significado | Quem move |
|---|---|---|
| `pending` | esperando o outro professor | quem registrou |
| `aguardando_gestao` | os dois professores de acordo, falta homologar | o outro professor |
| `accepted` | homologada — **é aqui que a aula troca de dono** | gestão |
| `rejected` | recusada, com motivo | o outro professor ou a gestão |
| `cancelled` | desistência de quem pediu | quem registrou |

`accepted` continua sendo o estado que dispara a aplicação, então a CF que já existe
(`processSubstitutionAcceptance`) segue valendo sem reescrita — ela só passa a receber `accepted`
um degrau depois.

## 5. O que muda em cada peça

| Arquivo | Mudança |
|---|---|
| `professores-shared.js` | `SubstitutionService`: registro pelo lado de quem cobriu; `_respond` passa a mandar para `aguardando_gestao` em vez de `accepted`; `homologar()` e `recusarGestao()` novos; trava de pedido duplicado para a mesma aula |
| `professores-agenda.js` | botão **"✋ Fui eu que dei essa aula"** no modal; botão **"⇄ Trocar professor"** para a gestão; liberar aula já `substituida` para nova troca; caixa de entrada da gestão com a fila de homologação; hint explicando *por que* não há botão, em vez do genérico "fale com a gestão" |
| `professores-substituicoes.js` | rótulos dos estados novos e ação de homologar/recusar na visão da gestão |
| `professores-fechamento.js` | antes de fechar, lista as trocas pendentes do mês: **trava** se estiver esperando a gestão, **avisa** se estiver esperando um professor |
| `functions/index.js` | notificar a gestão quando o pedido cai em `aguardando_gestao` — tem que sair do servidor, porque o professor não pode varrer `/users` (foi o que quebrou o pedido de férias em agosto) |
| `firestore.rules` | `substitutions`: professor só move `pending → aguardando_gestao`; **só admin/supervisão escreve `accepted`** |

**Não toca em:** `commission.js` nem `index.html` — as comissões são frente separada, em outra
sessão.

## 6. Como fica na tela

- **Professor, na aula de um colega:** botão "✋ Fui eu que dei essa aula". Sem o botão, a tela diz
  o motivo ("esta aula é do Theo — só ele, você, ou a gestão pode registrar a troca").
- **Professor, na própria aula:** o "🔄 Pedir substituição" de hoje, sem mudança de lugar.
- **Os dois lados, na tela Substituições:** o caminho visível — *aguardando o colega confirmar* →
  *aguardando a gestão* → *confirmada*.
- **Gestão:** a fila de homologação na caixa de entrada, e a tela Substituições (que já lista tudo,
  com filtro por professor e período) ganhando o botão de homologar.

## 7. Validação

`scripts/smoke-troca-professor.js`, no padrão da casa (firestore falso, comportamental +
estrutural):

1. quem cobriu registra → fica `pending`, **a aula não muda**;
2. o titular confirma → `aguardando_gestao`, **a aula ainda não muda**;
3. a gestão homologa → `accepted`, a aula troca de dono e preserva `originalTeacherId`;
4. a gestão homologa sem a resposta do professor → aplica e grava o motivo;
5. professor tentando saltar direto para `accepted` → recusado;
6. aula em mês fechado → recusado nos três passos;
7. segundo pedido para a mesma aula com um pendente → recusado;
8. aula já trocada uma vez → aceita nova troca;
9. fechamento com troca esperando a gestão → travado; esperando professor → só avisa.

Depois: staging, homologação do Rafael, e só então produção (rules + functions + `git push origin
main`, porque quem serve os usuários é o GitHub Pages).

## 8. Fora de escopo, mas achado no caminho

Três coisas que valem dinheiro no fechamento de agosto e **não** dependem deste ajuste:

1. Três avisos de professor parados esperando a gestão (Vagner +10 min em duas aulas, Theo 30 min
   de atraso).
2. Zero falta/atraso/hora extra lançados em 1.644 aulas — todo mundo seria pago pela grade cheia.
3. As 74 aulas de 29–31/07 estão em `prevista` e não entram em fechamento nenhum: o robô de
   confirmação só age a partir de `AUTO_CONFIRM_DESDE = '2026-08-01'` e o fechamento só conta
   `realizada`/`substituida`.

## 9. Prazo

Agosto fecha em **03/09/2026**. Para as trocas de agosto entrarem certas, o ajuste precisa estar em
produção antes disso — e sobra tempo para a academia registrar o que aconteceu no mês.
