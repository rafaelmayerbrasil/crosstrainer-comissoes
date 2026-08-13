# Grade de Horários: renome, 8 semanas, geração sob demanda e troca de dia · Design

**Data:** 2026-08-13
**Origem:** as 5 perguntas enviadas à gestão em 13/08/2026 (`memory/geracao-agenda-como-funciona.md`) voltaram respondidas pelo Rodrigo. A pergunta 1 confirmou que o fluxo faz sentido; as outras 4 viraram este pacote.

**Supersede parcialmente:** `2026-07-12-propagacao-edicao-grade-design.md`, que listava **troca de dia da semana** como não-objetivo explícito. O Rodrigo pediu justamente isso. O restante daquele design continua valendo — inclusive a definição de "aula intocada", que este design reusa sem alterar.

## Objetivo

Quatro mudanças na tela que edita a grade recorrente, entregues como um pacote único:

1. Renomear "Agenda Semanal" para **"Grade de Horários"**, incluindo o item de menu (hoje "Agenda").
2. Gerar aulas **8 semanas** à frente em vez de 4.
3. Botão **"Gerar agenda agora"** na tela, para não esperar até segunda-feira.
4. **Trocar o dia da semana** de um horário passa a mover as aulas futuras já geradas, com confirmação antes.

## Não-objetivos

- **Mexer na regra de "aula intocada".** Continua sendo `status == 'prevista'` **E** `monthClosingId == null` **E** data ≥ hoje. Não se inventa critério novo.
- **Tocar em mês fechado.** Nunca (CLAUDE.md §5).
- **Mover aula já substituída, cancelada ou fechada.** Ela fica onde está, no dia antigo. É informação histórica.
- **Desfazer.** Não há reversão automática da troca de dia.
- **Trocar o dia de vários horários de uma vez.** É um horário por edição.
- **Afrouxar a regra de exclusão de `classes`.** Ver Decisão 4 — a proteção do fechamento permanece intacta.
- **Renomear "Agenda Geral" e "Minha Agenda".** Essas mostram aulas reais e os nomes estão corretos.

## Descobertas que moldaram o design

**A troca de dia hoje é impossível pela tela.** `setSlotWeekday` retorna cedo quando há edição em curso (`professores-agenda.js:520-522`). O item 4 portanto não é "estender a propagação": é destravar a edição do dia **e** tratar as aulas. A condição atual da propagação (`professores-agenda.js:696`) é `oldSlot.weekday === novoWeekday` — ela nunca poderia ser falsa.

**Mover aula não é editar, é apagar e recriar.** O `classId` embute a data (`${slotId}_${YYYYMMDD}`, `functions/index.js`). Alterar a data por dentro do documento deixa o id inconsistente com o conteúdo, e a próxima geração — que é idempotente **por esse id** — criaria uma segunda aula na data nova. Duplicata garantida.

**O cliente não pode apagar aula da grade.** `firestore.rules` só permite `delete` quando `resource.data.specialScaleId is string` e o mês não está fechado. É proteção deliberada do fechamento. Este design **não** a afrouxa.

## Decisões travadas

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Nome novo | **"Grade de Horários"** — em 3 títulos de tela, no item de menu e na ajuda |
| 2 | Horizonte de geração | **8 semanas**, no cron e no default da callable — mesmo horizonte da janela da escala inteligente |
| 3 | Como mover as aulas | **apagar as intocadas + regerar**, reusando `generateClassesCore` |
| 4 | Onde roda a movimentação | **Cloud Function nova** (`moveSlotClasses`), admin-only. Mantém o poder destrutivo no servidor e a regra de `classes` intocada |
| 5 | Escopo da regeração | **gerador inteiro**, não por slot. É idempotente, é o caminho testado em produção, e preenche buracos de quebra |
| 6 | Momento da pergunta | **antes de gravar qualquer coisa** |
| 7 | Resposta "Cancelar" | **não grava nada**, nem o horário; o modal segue aberto. Salvar a grade e deixar as aulas no dia velho é exatamente a inconsistência que motivou o pedido |
| 8 | Dias no modo edição | **um único dia** (a criação continua aceitando vários) |

## Comportamento (UX)

### Renome (item 1)

| Onde | De | Para |
|---|---|---|
| `professores-nav.js` item de menu | `Agenda` | `Grade de Horários` |
| `professores-agenda.js` (3 títulos) | `AGENDA SEMANAL` | `GRADE DE HORÁRIOS` |
| `professores-ajuda.js` título | `Agenda` | `Grade de Horários` |

O texto da ajuda de `agenda` hoje afirma: *"Mudou a grade? A mudança vale pras aulas novas — as que já estão geradas você ajusta na Agenda Geral."* Isso **já está incorreto** desde que a propagação entrou (13/08) e ficaria mais incorreto com o item 4. Reescrever para descrever o comportamento real: a edição oferece atualizar as aulas futuras, e a troca de dia oferece movê-las.

O id interno da rota (`agenda`) **não muda** — trocar o id quebraria deep-links, o mapa da ajuda e a lista de permissões por perfil, sem ganho nenhum para o usuário.

### Geração sob demanda (item 3)

Botão **"Gerar agenda agora"** no cabeçalho da Grade de Horários, visível só para quem edita a grade (admin). Ao clicar:
- confirma (`Gerar as aulas das próximas 8 semanas agora?`), porque a operação escreve no banco;
- desabilita o botão e mostra "Gerando…" — a função pode levar dezenas de segundos;
- ao terminar, toast com o número real de aulas criadas (`created` do retorno);
- em caso de falha, toast de erro com a mensagem da função.

O SDK de functions já está carregado em `professores.html:22`, e o padrão de chamada já existe (`professores-fechamento.js:486`, `professores-pessoas.js:593`).

### Troca de dia (item 4)

1. No modal de edição, os botões de dia deixam de ficar travados. Seleção **única**: clicar em outro dia troca, não acumula.
2. Ao salvar, se o dia mudou, antes de gravar qualquer coisa o sistema conta as aulas intocadas do horário e pergunta:

   > **Você está mudando de Terça para Quarta.**
   > Existem **6** aulas futuras na terça. Elas serão movidas para a quarta.
   > Aulas já substituídas, canceladas ou de mês fechado ficam onde estão.
   > *(Confirmar / Cancelar)*

   **Se não houver nenhuma aula intocada, não há pergunta** — a troca é salva direto, porque não existe nada a mover.
3. **Confirmar** → salva o horário → chama `moveSlotClasses` → toast com o que aconteceu ("Horário movido para quarta. 6 aulas movidas.").
4. **Cancelar** → nada é gravado, nem o horário. O modal **continua aberto**, com o dia novo ainda marcado, para a pessoa escolher outro dia ou fechar sem salvar. "Abortar a edição" aqui significa não gravar nada, não fechar a tela na cara de quem está editando.

A detecção de conflito de professor (D6) já roda contra o dia escolhido no formulário (`professores-agenda.js:637`), então passa a validar o dia novo sem alteração.

## Arquitetura

### Cloud Function nova — `moveSlotClasses` (callable, admin-only)

Espelha `generateClassesManual` no formato: mesma verificação de admin lendo `users/{uid}`, mesmos `memory`/`timeoutSeconds`.

```
entrada:  { slotId: string, dryRun?: boolean }
saída:    { deleted: number, created: number, skipped: number, durationMs: number }
```

Passos:
1. Lê o slot. Não existe → `not-found`.
2. Busca `classes` com `slotId == slotId`.
3. Aplica a regra de intocada (`status == 'prevista'`, `monthClosingId == null`, data ≥ hoje BR). As demais entram em `skipped`.
4. `dryRun` → devolve as contagens sem escrever. É isso que a tela usa para montar a pergunta.
5. Apaga as intocadas em lote.
6. Chama `generateClassesCore({ weeksAhead: 8, source: 'cf-move-slot' })`, que recria no dia novo já respeitando feriado, escala especial e férias.

A CF roda com Admin SDK, então não depende da regra de `delete` — que continua exatamente como está.

### Regra de intocada — uma definição, duas cópias gêmeas

`class-propagation.js` já contém o critério, mas embutido no "planejar patches". Extrair um predicado `isUntouchedClass(c, hojeISO)` e fazer `planClassUpdatesForSlot` usá-lo, para existir **uma** definição de "intocada".

**Atenção:** a CF **não pode** importar o arquivo da raiz — o deploy das Functions leva só a pasta `functions/` (`firebase.json`, sem passo de cópia). O projeto já resolveu isso antes e tem padrão: `intern-hour-bank.js` existe na raiz **e** em `functions/`, com cabeçalho marcando "GEMEO", e `scripts/smoke-banco-horas-estagiario.js` roda uma tabela de casos nas duas cópias e falha se divergirem.

Seguir o mesmo padrão: criar `functions/class-propagation.js` como gêmeo, com o cabeçalho apontando para o irmão, e incluir no smoke a comparação de comportamento entre as duas cópias sobre uma tabela de casos (não comparação de texto — o cabeçalho difere de propósito).

### Cliente

- `professores-agenda.js`: `setSlotWeekday` passa a aceitar troca em edição (seleção única); `saveSlot` ganha o ramo de dia alterado, com a pergunta antes do save; a condição `oldSlot.weekday === novoWeekday` continua guardando a propagação in-place dos outros campos, que não muda.
- `professores-shared.js`: `ClassService.moveSlotClasses(slotId, { dryRun })` encapsulando a chamada da callable, no mesmo estilo dos outros serviços (`{ success, ... }`).

### Horizonte de 8 semanas

Dois pontos, ambos em `functions/index.js`: o `weeksAhead: 4` do cron (~linha 418) e o default `: 4` da callable (~linha 462). O comentário do cabeçalho que diz "gera as próximas 4 semanas" também precisa acompanhar, senão vira documentação mentirosa.

## Validação

Antes de qualquer coisa ir para produção, **staging primeiro** (CLAUDE.md §7).

**Automatizado** — `scripts/smoke-grade-horarios.js`, no padrão da casa (fixture própria, cleanup completo):
1. `isUntouchedClass` aceita prevista/sem fechamento/futura.
2. Rejeita: mês fechado · status diferente de prevista · data passada.
3. `moveSlotClasses` com `dryRun` não escreve nada e conta certo.
4. Troca real: as intocadas somem do dia velho e nascem no dia novo.
5. Aula substituída/cancelada/fechada **permanece** no dia velho.
6. Nenhuma aula duplicada após a troca (checar o `classId` de cada data).
7. Feriado no dia novo: não cria aula ali.
8. Professor de férias no dia novo: não cria aula ali.
9. Chamada por não-admin é recusada.
10. As duas cópias de `class-propagation.js` (raiz e `functions/`) concordam sobre a mesma tabela de casos.
11. `scripts/smoke-css-vars.js` e a suíte existente continuam verdes (renome não pode quebrar seletor).

**Manual no staging:** trocar o dia de um horário com aulas geradas e conferir na Agenda Geral; usar o botão de gerar e ver o número; confirmar que o nome novo aparece no menu, no título e na ajuda; e que a ajuda não fala mais em "ajustar na Agenda Geral".

## Riscos

| Risco | Mitigação |
|---|---|
| Apagar aula que não devia | A CF filtra pela mesma regra já usada em produção, e o `dryRun` mostra o número antes. Mês fechado nunca entra |
| Gerador rodar inteiro e criar aula inesperada em outro horário | É idempotente e só cria o que a grade manda. O efeito é preencher buracos — mas o toast deve reportar o total, para não parecer que "mexeu sozinho" |
| CF demorar e o admin achar que travou | Botão desabilitado + "Gerando…", como já se faz no fechamento |
| Renome deixar texto órfão | A varredura cobre os 3 títulos, o menu e a ajuda; a suíte roda depois |
| Deploy de CF em produção | Só depois de homologado em staging, com OK explícito (CLAUDE.md §7) |
