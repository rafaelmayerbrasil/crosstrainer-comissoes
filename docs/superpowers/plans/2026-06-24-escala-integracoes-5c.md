# Escala — Integrações (Plano 5c) — Plano curto

> Os 3 pedaços de integração da escala. Tocam código existente do módulo (Substituições, Férias, Agenda/classes) — edições cirúrgicas, nada nos 4 arquivos protegidos.

## 5c-1 — Proatividade (substituição vira ponto) ✅ FEITO (`1f0d081`)
Hook em `SubstitutionService._respond` (professores-shared.js): ao `accepted`, credita proatividade pro substituto via `EngagementService.awardSubstitution(subId, before.substituteTeacherId, dataDaAula)`. Não-bloqueante, guardado por `typeof EngagementService`, idempotente. **Verificado no staging** (accept → entry de 3 pts).

## 5c-2 — Fim de ano (§7) — ⏸️ AGUARDA DECISÃO
Estrutural buildável: tipo de escala `fim_de_ano` com **template de duplas dia-inteiro** (2 pessoas/dia, não por modalidade TOI/Hiit) no período 21/12–02/01, com **dias fechados** (25, 31/12, 01/01) e **24/12 meio período**.
**DECISÃO PENDENTE — "quem não for escalado vira férias":** o Rodrigo disse que entra como férias e **não é descontado** das férias CLT do colaborador (é uma folga especial do período, não consome saldo). Hoje `VacationService.request` cria `vacation_requests` com `status:'pendente'` + valida antecedência mínima e CONSOME saldo (`type:'ferias'/'recesso'`). Então "vira férias" aqui é um **tipo/flag novo** (folga de fim de ano, sem desconto de saldo, sem validação de antecedência). Opções:
- (a) novo `type:'fim_de_ano'` em vacation_requests, auto-aprovado, sem consumir saldo;
- (b) só sinalizar quem ficou de fora e a gestão decide (sem criar férias automático);
- (c) criar `pendente` pra gestão aprovar em lote.
Ação forte (cria registros de férias) → **precisa do OK do usuário sobre o modelo.**

## 5c-3 — Publicar escala na agenda oficial (§15.8) — ⏸️ AGUARDA DECISÃO
A escala consolidada vira agenda oficial (gera `classes` pras vagas atribuídas, como `SpecialScaleService.applyToClasses` faz pro stub antigo).
**DECISÃO PENDENTE — inconsistência peso-de-data × pagamento** (registrada desde o spec §9): a spec 15.5 diz que o peso da data (sábado 1/feriado 2/…) é só pra **balancear distribuição**, mas o código de hoje usa esse peso pra **PAGAR** (multiplica horas no fechamento). Ao publicar a escala inteligente como classes, precisa decidir:
- manter o uso financeiro atual do peso (e o peso de balanceamento da escala vira conceito separado), OU
- unificar/rever.
Toca fechamento/pagamento → **precisa do OK do usuário.**

## Como retomar
- 5c-1 pronto. 5c-2 e 5c-3 esperam as 2 decisões acima. Depois: construir + verificar no preview/staging, commitar.
- Deploy de hosting no staging pra o Rodrigo validar tudo (engajamento + escala) segue pendente (pedir OK).
