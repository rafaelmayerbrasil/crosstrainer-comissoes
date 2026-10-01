# Minhas horas do mês — desenho (proposta D)

> **Estado:** desenho para o Rafael validar. **Nada construído.** Sessão 81, 01/10/2026.
> Página com o desenho das telas: https://claude.ai/artifact/KtiWYo8QF5Ue6xph4axQNk (proposta D).

## De onde veio

- Professor, no grupo (30/09): *"Poderia ter um fechamento do mês, total, tipo fecha tal dia, aí a galera coloca lá as horas que fez, sem ter que ir de hora em hora, pq fica meio que perdido, às vezes embaralha, muita coisa escrita na tela."*
- Rodrigo encaminhou a lista de setembro do **Theo Rosa**, mandada por WhatsApp: entrada e saída por dia. Somada: **167h15**. No sistema: **139h30** pagas. Ele recebe por hora.
- Causa principal da diferença: a **grade dele está desatualizada** (noite de segunda e quarta não existe na grade; terça e quinta ele entra 16:30, a grade diz 18:00). Lançar exceção aula por aula não é viável para quem a rotina mudou.

## Decisões do Rafael (01/10/2026)

1. **Todos os professores conferem**, não só quem recebe por hora. No futuro as horas serão cruzadas com a **catraca** que está sendo instalada.
2. **Quem não conferir até o prazo: a folha da pessoa espera.**
3. **A aprovação da gestão é opcional:** um alerta dizendo que não foi validado, e um OK geral.

## Como funciona

### O professor
- Tela **Minhas horas**, por mês. Abre **já preenchida com a agenda**, um dia por linha, em **entrada e saída por turno** (as aulas seguidas viram um turno só) — não aula por aula.
- Ele mexe **só no dia que foi diferente**: muda entrada/saída, acrescenta um turno, ou marca "não trabalhei".
- Dia trabalhado **fora da agenda no lugar de alguém** pede "no lugar de quem?" e vira **troca de professor** pelo fluxo que já existe — senão os dois receberiam pela mesma aula.
- Botão **"Está tudo igual à agenda"** para quem não tem diferença (um toque) e **"Enviar"** para quem tem.
- Pode conferir **ao longo do mês** (toda semana), não só no fim. Prazo final **configurável pela gestão** (dia do mês seguinte); o sistema avisa quando estiver chegando.
- Quando o mesmo desvio se repete (ex.: 5 terças entrando 16:30), a tela sugere **pedir a atualização da grade** — é o que evita a diferença no mês seguinte.

### A gestão
- No fechamento, um bloco novo **"Horas informadas"**: só quem tem diferença, com o total por pessoa e as diferenças agrupadas por tipo.
- **OK geral** (valida todo mundo de uma vez) ou pessoa a pessoa; pode **devolver com pergunta**.
- Lista de **quem ainda não conferiu**.

### A folha
- O que o professor informa **não entra na folha sozinho**: entra quando a gestão dá o OK (geral ou individual). É a mesma trava que já existe hoje nas ocorrências — sem ela, bastaria a pessoa digitar horas a mais para receber.
- A diferença validada entra como **ajuste de horas do dia** (a mais ou a menos), com o mesmo peso do dia (feriado em dobro).

## O que muda no sistema (para quem for construir)

- **Coleção nova** `hour_declarations/{teacherId}_{YYYY-MM}`: `status` (`rascunho` → `enviada` → `validada` | `devolvida`), e `dias[YYYY-MM-DD] = { turnos:[{inicio,fim}], naoTrabalhei, obs }` **só dos dias diferentes da agenda**; `semDiferenca: true` quando a pessoa confirmou que está igual. Guardar entrada/saída (e não só minutos) é o que permite cruzar com a catraca depois.
- **Rules:** o professor escreve só a própria declaração, só enquanto o mês não fechou e o status não é `validada`; validar é da gestão; depois de fechado ninguém altera.
- **`closing-payroll.js`** (+ gêmeo em `functions/`): `montarFolha` passa a somar os **ajustes validados** por pessoa; a linha da pessoa mostra "agenda × informado × validado".
- **Fechamento:** itens novos no checklist do bloco 1 (ver perguntas abaixo).
- **Aviso** (`NotifyService`): prazo chegando, declaração devolvida, declaração validada.
- **Fora do escopo agora:** catraca; ponto eletrônico; mudar a geração da agenda.

## Respostas do Rafael (01/10/2026, tarde)

- **Aprovação:** confirmado — a gestão não precisa olhar linha por linha, mas **algum OK é necessário** (o OK geral basta) para a diferença entrar na folha.
- **Quem não conferiu:** fica com o caminho recomendado (trava o fechamento e a gestão destrava pessoa a pessoa), **com um atalho**: ao lado de cada nome que falta conferir, um botão **"Ver as horas"** que abre o mês daquela pessoa como a agenda registrou (dia a dia, com as trocas e os avisos), para quem está fechando decidir com a informação na frente antes de usar o **"Fechar com as horas da agenda"**. *"Acho que deveria ter esse atalho para facilitar quem está fechando."*
- **Avisos por aula** ("não aconteceu", atraso, saída, tempo além): desde 01/10 já têm tela própria da gestão (**Avisos dos professores**), sino, alerta na home e trava no fechamento — construído à parte desta proposta (`class-avisos.js`, `professores-avisos.js`). A tela de horas do mês deve **conviver** com eles: um dia já corrigido por aviso aceito aparece como tal, sem pedir de novo.

## Perguntas em aberto (precisam do Rafael antes de construir)

1. **"A folha da pessoa espera" — espera como?** O fechamento hoje é **um só por mês** e irreversível. Duas leituras:
   - **(a) recomendada:** quem não conferiu **trava o fechamento do mês**, mas a gestão tem o botão **"Fechar valendo a agenda"** para aquela pessoa (fica registrado) — mesmo padrão do "Confirmar mesmo assim" das trocas. Ninguém segura a folha de todos sem a gestão poder destravar.
   - **(b)** fecha o mês **sem aquela pessoa**, e ela recebe num fechamento complementar depois. Muda a estrutura do fechamento (hoje um documento por mês) e os recibos; é bem mais trabalho.
2. **"Aprovação opcional" — entendi certo?** A gestão não precisa olhar linha por linha: o fechamento mostra o alerta "N pessoas com horas informadas ainda não validadas" e o botão **OK geral**. Mas **algum OK é necessário** para a diferença entrar na folha — sem OK nenhum, o que a pessoa digitou não vira pagamento.

## Setembro do Theo (independente desta tela)

Dá para lançar por script, com backup, depois de a gestão confirmar a lista e quatro dias:
- na lista e fora do sistema: **07/09** (feriado, 08:00–12:00) e **19/09** (sábado, 08:00–12:50);
- no sistema e fora da lista: sábados **05/09** e **26/09**.

E corrigir a grade dele, senão outubro repete.

---

## Como foi construído (01/10/2026, branch `horas-do-mes`)

Estado: **no staging, homologado como gestão; falta homologar como professor e o OK para produção.**

O que saiu igual ao desenho: o professor confere o mês em turnos e envia; a gestão valida com OK geral ou pessoa a pessoa; quem não conferiu trava o fechamento a partir de outubro/2026, com "Ver as horas" e "Fechar valendo a agenda".

O que foi decidido na construção:

- **Validar ajusta as próprias aulas.** Não existe ajuste de horas em separado: a aula não dada vira `nao_realizada`, a diferença de horário vira atraso, saída antecipada ou tempo além, e o turno que não existia vira uma aula avulsa (`generatedBy: 'horas-do-mes'`). A folha continua lendo as aulas.
- **O plano é em valores absolutos** e a aula avulsa tem identificador fixo: validar de novo depois de uma falha não soma em dobro.
- **Dia "no lugar de um colega" não vira hora por aqui.** É troca de professor; a tela mostra à gestão quais são, para registrar em Substituições.
- **"Está tudo igual à agenda"** conta como conferência completa e não pede OK da gestão.
- **A gestão pode lançar as horas por alguém** ("Lançar as horas"), para a lista que chega por fora.
- **Os avisos de aula** que o professor já tinha mandado nos dias declarados ficam respondidos junto com a validação.
- **O envio só abre depois da última aula do mês**; antes disso o professor corrige e fica em rascunho.
- **Em feriado a folha paga em dobro**, inclusive o turno novo; a tela "o que muda" avisa nesses dias.

Arquivos: `hour-declaration.js` (contas, gêmeo em `functions/`), `professores-horas.js` (serviço e as duas telas), regra `hour_declarations`, Function `onHourDeclarationSent`. Testes: `smoke-horas-do-mes`, `smoke-horas-do-mes-tela`, `smoke-horas-do-mes-ligacoes`, `validar-regras-horas-do-mes` (contra o staging).
