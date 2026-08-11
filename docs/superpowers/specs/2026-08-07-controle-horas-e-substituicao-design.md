# Design — Registro automático de aulas, ocorrências, banco de horas e histórico de substituição

> Decisões fechadas com o Rodrigo (via usuário) em 07/08/2026. Este doc é a fonte da verdade
> do escopo — a conversa que o gerou está no WhatsApp e não sobrevive.

## Por que agora

Levantamento em produção (07/08/2026) achou o problema que motiva tudo:

- **383 aulas já aconteceram · 382 continuam `prevista` · 0 marcadas como `realizada`**
- **0 fechamentos de mês feitos**

O fechamento (`closeMonth`) só conta `realizada` e `substituida`. Fechar agosto hoje contaria
**1 aula na academia inteira** — todo mundo receberia zero.

Causa: só gestão/supervisão pode marcar, **uma aula por vez**, sem ação em lote. Com ~75 aulas/dia
é inviável. Não é desleixo do cliente: a ferramenta não serve pro volume real.

---

## 1. Registro automático da aula dada

**Modelo escolhido (proposta do usuário, melhor que a original):** a aula vira `realizada`
**sozinha** depois que o horário passa, marcada como registro automático. A gestão só lança o que
**fugiu do normal**. Registrar 1.500 aulas/mês pra capturar ~10 exceções é desproporcional.

| Regra | Decisão |
|---|---|
| Quando vira `realizada` | **Só depois** que o horário terminou. Nunca antes. Rotina diária. |
| A partir de quando | **01/08/2026.** Julho fica fora da folha (fica `prevista`, não conta). |
| Correção | Livre até o **fechamento do mês**, que é a trava final. |
| Professor | **Pode marcar que a aula não aconteceu** na aula dele (as rules já permitem: `originalTeacherId == uData().professorId && monthClosingId == null`). |
| Rastreabilidade | Guardar se foi automático ou ajustado por gente. O relatório precisa distinguir. |

**Risco aceito conscientemente pelo cliente:** inverte quem carrega o ônus. Hoje, silêncio = ninguém
recebe. Com automático, silêncio = todos recebem, inclusive por aula que não aconteceu.

### Fora do automático
- **Escola Interna** — não é remunerada (ver §3)
- **Dias em que a academia não abre** — ver §2

---

## 2. Feriados

Feriado **continua no automático** e **segue pagando em dobro** (decisão P02, já implementada).
A academia abre em praticamente todo feriado.

**Exceções: 25/12 e 01/01** — não abre.

**Implementação:** lista de *dias em que a academia não abre*, **editável na tela pela gestão**,
não cravada no código — se um ano fecharem no Carnaval, eles mesmos ajustam
([[feedback-datas-configuraveis]]). Nasce com 25/12 e 01/01.

Nesses dias a aula **não entra no automático** e não conta hora até alguém confirmar.

---

## 3. Escola Interna

Confirmado que a **presença já existe e já pontua** (`points-engine.js`): participar = 1 pt ·
conduzir = 2 pts · treinar como aluno em outro horário = 1 pt · TOI como aluno = 1 pt. O
"reconhecimento de quem participa" que o Rafael pediu **já está atendido**.

| Ajuste | Decisão |
|---|---|
| Unidade | **Uma por dia**, nunca as duas. **Padrão PP**, com opção de CP. Hoje as sessões nascem com vaga nas duas — por isso a CP vivia sem líder. |
| Pagamento | **NÃO remunerada.** Continua na agenda de quem conduz, mas **fora da conta de horas**. |
| Criação | Poder criar **a semana inteira de uma vez** (a escala é montada na semana anterior). |

**🚨 Risco que motivou a prioridade:** hoje a Escola Interna vira **aula normal** em `classes`, e o
fechamento soma toda aula `realizada`. Com o registro automático ela passaria a contar **sozinha** —
1h/dia por professor. Nada foi pago ainda porque nada foi marcado, mas tem que ser resolvido
**antes do primeiro fechamento**.

**Dado a corrigir:** as 5 sessões de 03–07/08 existem com slots de CP **e** PP.

---

## 4. Ocorrências (atraso, falta, saída antecipada, hora extra)

Ponte até o relógio de ponto entrar. Depois, os dados importados conferem com estes.

| Ocorrência | Efeito no pagamento |
|---|---|
| Falta (com ou sem aviso) | **Tira a aula do pagamento** |
| Atraso | **Desconta proporcional** aos minutos |
| Saída antecipada | **Desconta proporcional** (confirmado 07/08) |
| Hora extra | **Adiciona proporcional** |

**Pontos:** criar penalidade de falta em aula, **configurável pela gestão** — no mesmo lugar da que
já existe pra treinamento (`penalidade.treinoFaltaSemAviso = -15`). Valores não ficam no código.

**Consequência no cálculo:** hoje as horas somam `durationMinutes` puro. Passa a existir um
**minuto efetivo** por aula = `durationMinutes − atraso − saída antecipada + extra`, e é ele que
alimenta o fechamento (com o peso de feriado/escala aplicado por cima, como já é).

**Relatório** por professor e por mês: atrasos, faltas e horas extras — base pra conferir com o
ponto eletrônico depois.

---

## 5. Banco de horas do estagiário

**Descoberta que mudou o modelo:** o desconto proporcional **não funcionava pra estagiário**.
`valorHoras = stipend` fixo se `hours <= limitHours` — atraso ou falta não mudavam nada. E são
**9 dos 16** professores.

### Regra acordada

| Situação | O que acontece |
|---|---|
| Trabalhou **mais** que o contrato | Bolsa + horas extras proporcionais, **no mês** |
| Trabalhou **menos** | **Bolsa cheia** no mês + as horas que faltaram viram **saldo negativo** |
| Mês seguinte com extras | As extras **primeiro quitam o saldo**; só o que sobrar é pago |

- O saldo **só vai pra baixo de zero**. Sobra nunca vira crédito — é paga na hora.
- **"Descontar" = abater de horas futuras, NUNCA reduzir a bolsa** (confirmado). Reduzir bolsa de
  estágio é terreno jurídico delicado — vinculada à carga horária do termo.
- **Sem teto** para o saldo negativo.
- **Estágio encerrado com saldo negativo: encerra, sem dever nada financeiramente.**
- **Começa em agosto/2026 com saldo zero** pra todo mundo.
- **Férias e recesso não geram dívida** — abater do contrato do mês proporcionalmente.

### ⚠️ Alerta dado ao cliente (ele optou por ligar assim mesmo e revisar depois)

Contratos não batem com a grade real. No primeiro fechamento vai aparecer:

| Estagiário | Contrato | Grade entrega | Efeito |
|---|---|---|---|
| Eduarda | 105h | 126–145h | **+21 a +40h extras todo mês**, por escala |
| Camila | 107h | 116–133h | sempre acima |
| Louise | 98h | 113–130h | sempre acima |
| Heloísa | 86h | 90–103h | sempre acima |
| João Vitor | 86h | 88–101h | acima |
| Leonardo | 139h | 130–150h | na linha |
| Helena / Alan | 86h | 80–92h | na linha |
| **Thaynara** | **129h** | **102–117h** | **dívida crescente e impagável** — a grade nunca chega ao contrato |

Some-se a variação do calendário: contrato é mensal fixo, grade é semanal — mês de 4 vs 5 semanas
já cria sobra/falta sem ninguém mudar de comportamento.

**Decisão:** liga assim mesmo; o usuário leva ao Rodrigo pra revisar os contratos.

### O que expor
- Recibo e tela com a conta aberta: horas do mês · contrato · quanto quitou · quanto foi pago de
  extra · saldo restante. Sem isso ninguém confia no número.
- O **estagiário vê o próprio saldo**.
- **Relatório de saldos** pra gestão agir antes de virar bola de neve.
- Só o **fechamento** mexe no saldo. Mês reaberto → saldo volta atrás junto.

---

## 6. Histórico de substituição

**Problema:** ao aceitar, a CF `processSubstitutionAcceptance` troca `classes.teacherId` pelo
substituto. Como a agenda busca "aulas onde eu sou o professor", a aula **some da lista do
titular**. Daí o "sumiu, não sei se deu certo".

**Dá pra resolver só na exibição:** `originalTeacherId` é preservado na aula.

| Onde | O que mostrar |
|---|---|
| Agenda do titular | A aula **continua aparecendo**: "⇄ Substituída por Thaynara · aceito em 04/08" |
| Agenda do substituto | "⇄ Cobrindo Theo Rosa" |
| Tela nova "Minhas substituições" | Duas listas: *pedi* e *cobri*, com histórico (não só pendentes) |
| Gestão | Todas as substituições da academia, com filtro por professor e período |

**Retroativo:** os dois lados podem registrar **mesmo depois da aula ter acontecido**; **trava
quando a folha fecha**. Já é o comportamento atual (a CF recusa se `monthClosingId` existe, e o
pedido do Theo já foi retroativo) — só garantir que o automático não atrapalhe.

---

## Ordem de execução (aprovada)

1. **Escola Interna + dias fechados fora da conta de horas** — únicos que mexem em dinheiro e
   correm contra o primeiro fechamento
2. **Registro automático + ocorrências + banco de horas** — sem isso agosto não fecha
3. **Histórico de substituição** — é o que está incomodando os professores

## Pendências do cliente
- Rodrigo revisar os contratos de horas dos estagiários (alerta acima)
- 4 logins de professor sem cadastro vinculado (Rafael Rojais, Will Souza, Thay Silva, Loyse)
- Modalidade "TOIZAO SÁB" criada sem nenhuma aula na grade
