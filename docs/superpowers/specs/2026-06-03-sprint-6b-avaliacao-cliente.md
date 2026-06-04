# Sprint 6b — Pagamento durante Férias — Avaliação do Cliente

> Documento para validação. Leia com atenção os pontos abertos e responda com a decisão de cada um.

---

## 1. Contexto

A Sprint 6b implementa o **cálculo e registro de pagamento para férias e recesso** dentro do Módulo Professores do CrossTainer. O escopo é **exclusivamente financeiro** — controle anual de saldo de dias fica para uma sprint futura.

### O que esta sprint entrega

- Cálculo automático do valor a pagar nas férias de professor efetivo (média 12 meses + ⅓ constitucional)
- Cálculo automático para estagiário (bolsa proporcional aos dias — opcional, admin decide caso a caso)
- Opção de valor manual (admin digita)
- Opção "sem pagamento" (licença não remunerada)
- Integração com fechamento mensal e recibo de pagamento
- Trilha de auditoria e notificações

### O que NÃO entra

- Controle de quantos dias o professor já tirou no ano / quantos faltam
- Validação de período aquisitivo (12 meses trabalhados)
- Pagamento de férias vencidas
- Antecipação de 13º + férias
- Estorno automático se férias cancelada após pagamento

---

## 2. Decisões já fechadas (não precisa reavaliar)

Estas decisões já foram definidas com base na legislação (CLT), regras de negócio do CrossTainer, e aprovação prévia em 03/06/2026:

| # | Decisão | Definição |
|---|---------|-----------|
| 1 | Base de cálculo para efetivo | Média dos últimos 12 meses de horas pagas (`valorHoras`) + ⅓ constitucional proporcional aos dias de férias |
| 2 | Fórmula do ⅓ | `(médiaMensal × diasFérias / 30) / 3` |
| 3 | Histórico insuficiente | Menos de 3 meses de fechamento → bloqueia modo automático e exige valor manual |
| 4 | Estagiário tem direito a ⅓? | Não. Estagiário recebe bolsa proporcional aos dias, sem adicional de ⅓ |
| 5 | Férias atravessando 2 meses | Rateio proporcional. Cada fechamento mensal paga a fração dos dias que caíram no mês |
| 6 | Onde aparece o valor | Linha "Férias" no detalhe do professor dentro do fechamento + seção dedicada no recibo A4 |
| 7 | Edição do pagamento | Permitida após aprovação desde que o valor ainda não tenha entrado em nenhum fechamento (campo `paidInClosingIds` vazio) |
| 8 | Férias cancelada após paga | Não há estorno automático. Admin trata manualmente via crédito (funcionalidade já existente) |
| 9 | Férias aprovada depois do mês fechado | Não reabre fechamento. Admin decide se paga no mês seguinte como ajuste manual |
| 10 | Notificação ao professor | Sim, notificação in-app quando admin define o pagamento |

---

## 3. Pontos que precisam da sua avaliação

Abaixo estão as decisões de design e fluxo que impactam diretamente a experiência de uso. **Leia cada uma com atenção e responda com sua decisão.**

---

### Ponto 1 — Fluxo: aprovar férias e definir pagamento juntos ou separados?

**Contexto:** quando o admin aprova um pedido de férias, é preciso também definir o valor a ser pago (ou se é sem pagamento). Isso pode acontecer no mesmo modal de aprovação ou em dois passos separados.

**Opções:**

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A — Juntos** | Modal de aprovação ganha bloco "Pagamento" com cálculo e modos. Admin resolve tudo de uma vez. | Mais rápido. 1 clique resolve. | Modal mais carregado. Se houver dúvida sobre valor, aprovação fica travada. |
| **B — Separados (recomendado)** | Admin aprova primeiro (como hoje), depois clica em "Definir pagamento" na tabela para abrir um modal focado só no financeiro. | Mais seguro. Pagamento pode ser definido com calma depois. Modal focado. | 2 cliques em vez de 1. |

> **Recomendação da equipe técnica: Opção B (separados).** Separa responsabilidades: aprovação resolve agenda; pagamento resolve financeiro. Admin não é forçado a decidir valor na hora da aprovação.

**Sua decisão: ( ) A — Juntos ( ) B — Separados**

---

### Ponto 2 — Checkbox para estagiário: default marcado ou desmarcado?

**Contexto:** para professor estagiário em modo automático, aparece um checkbox "Pagar bolsa proporcional ao recesso?". Se marcado, calcula o valor. Se desmarcado, registra como sem pagamento.

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A — Default desmarcado (recomendado)** | Admin precisa marcar ativamente para pagar | Evita pagamento acidental. Força decisão consciente. | 1 clique extra se a maioria dos estagiários recebe. |
| **B — Default marcado** | Já vem marcado, admin desmarca se não quiser pagar | Mais rápido se maioria recebe. | Risco de pagamento sem intenção se admin não perceber. |

> **Recomendação da equipe técnica: Opção A (default desmarcado).** Conservador. Força o admin a decidir ativamente. Evita "paguei sem querer".

**Sua decisão: ( ) A — Default desmarcado ( ) B — Default marcado**

---

### Ponto 3 — Após aprovar, o sistema deve alertar o admin sobre pagamento pendente?

**Contexto:** se o fluxo for em duas etapas (Ponto 1 = B), após aprovar as férias o admin pode esquecer de definir o pagamento.

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A — Sem alerta (recomendado)** | Apenas o badge "Pendente" visível na coluna "Pagamento" da tabela de gestão. | Sem interrupção. Admin já está na tela, vê o badge. | Se admin sair da tela imediatamente, pode esquecer. |
| **B — Toast com lembrete** | Após aprovar, aparece toast "Férias aprovadas! Defina o pagamento." | Reforça a ação pendente. Impossível não ver. | Ruído se admin já sabe o que fazer. |

> **Recomendação da equipe técnica: Opção A (sem alerta).** A tabela é re-renderizada logo após aprovar, o badge "Pendente" fica visível e acionável na coluna Pagamento. Toast seria redundante.

**Sua decisão: ( ) A — Sem alerta ( ) B — Toast com lembrete**

---

### Ponto 4 — Preview do cálculo automático: mostrar antes de salvar ou só depois?

**Contexto:** no modo automático, o sistema calcula o valor com base na média dos últimos 12 meses. Esse cálculo pode levar 1-2 segundos (leitura no banco).

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A — Mostrar preview antes de salvar (recomendado)** | Ao selecionar "Automático", busca os dados e mostra o preview com a conta detalhada. Admin confere antes de salvar. | Transparência total. Admin confere base, ⅓, total. | Pequena espera (1-2s) ao abrir o modal. |
| **B — Calcular silenciosamente** | Só grava o valor. Admin vê o resultado depois na listagem. | Modal mais rápido. | Se valor parecer errado, precisa editar depois. |

> **Recomendação da equipe técnica: Opção A (mostrar preview).** Transparência é importante em valores financeiros. A espera de 1-2 segundos é aceitável.

**Sua decisão: ( ) A — Mostrar preview ( ) B — Calcular silenciosamente**

---

### Ponto 5 — Observação: quando deve ser obrigatória?

**Contexto:** cada modo de pagamento tem um comportamento diferente quanto à observação/justificativa.

| Modo | Recomendação | Por quê |
|------|-------------|---------|
| **Automático** | Sem campo de observação | Cálculo é automático e auditável. Se precisar ressalva, edita depois. |
| **Manual** | Observação opcional (obrigatória só se valor = R$ 0) | Se valor > 0, admin pode deixar em branco. Se valor = 0, precisa justificar. |
| **Sem pagamento** | Justificativa obrigatória | Exigir o motivo (ex: "licença não remunerada", "estagiário sem bolsa"). |

> **Recomendação da equipe técnica:** Seguir a tabela acima. Campo obrigatório = `*` vermelho no label + validação no botão Salvar.

**Sua decisão: ( ) Concorda com a tabela acima ( ) Quer ajustar: _________**

---

### Ponto 6 — Tabela de gestão: o que mostrar na coluna "Pagamento"?

**Contexto:** a tabela de férias (visão admin) ganha uma coluna "Pagamento" que varia conforme o estado.

| Estado da férias | O que aparece | Ação |
|-----------------|---------------|------|
| Não aprovada (pendente/recusada/cancelada) | `—` | Nenhuma |
| Aprovada, sem pagamento definido | Badge `Pendente` | Link `💰 Definir` → abre modal |
| Aprovada, com pagamento, ainda não paga em fechamento | `Auto · R$ 7.200,00` | Link `✏️ Editar` → abre modal |
| Aprovada, já paga em fechamento | `✓ Pago em jul/26` | Nenhuma (não editável) |

> **Recomendação da equipe técnica:** Seguir a tabela acima. Consistente, informativo, e deixa claro o que pode ou não ser alterado.

**Sua decisão: ( ) Concorda com a tabela acima ( ) Quer ajustar: _________**

---

## 4. Resumo para resposta

Para agilizar, responda abaixo:

| Ponto | Tema | Sua decisão |
|-------|------|-------------|
| 1 | Fluxo aprovar + pagamento | ( ) A — Juntos ( ) B — Separados |
| 2 | Checkbox estagiário default | ( ) A — Desmarcado ( ) B — Marcado |
| 3 | Alerta pós-aprovação | ( ) A — Sem alerta ( ) B — Com toast |
| 4 | Preview do cálculo | ( ) A — Mostrar antes ( ) B — Silencioso |
| 5 | Obrigatoriedade de observação | ( ) Concordo ( ) Ajustar: ___ |
| 6 | Coluna "Pagamento" na tabela | ( ) Concordo ( ) Ajustar: ___ |

---

**Após sua resposta, a equipe técnica segue com a implementação.** Qualquer dúvida sobre os termos ou impacto de alguma decisão, pergunte — explicamos com mais detalhe.

---

*Documento gerado em 03/06/2026 — Sprint 6b — CrossTainer Módulo Professores*
