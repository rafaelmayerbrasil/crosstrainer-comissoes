# Auditoria pré-lançamento — Módulo Professores (staging)

> **Data:** 2026-07-02 · **Escopo:** módulo Professores inteiro no staging (`crosstrainer-comissoes-staging`), branch `feature/shell-integrado`. Comissões/produção FORA do escopo (só leitura se precisar cruzar).
> **Regras:** corrigir só o que é seguro (branch + staging + reversível); NUNCA produção; `index.html`/`commission.js`/`sw.js`/`manifest.json` intocáveis sem autorização. Entregar no final só o que exige decisão humana.

## 🔄 COMO RETOMAR (se a sessão cair)

1. Achar a primeira frente sem ✅ na tabela abaixo → continuar dela.
2. Achados já registrados nas seções de cada frente — NÃO re-investigar o que já tem veredito.
3. Correções aplicadas estão em commits `fix(audit): …` — `git log --oneline --grep="audit"` mostra o que já foi corrigido.
4. Ao terminar uma frente: atualizar a tabela + seção da frente + commit deste arquivo.
5. Tudo pronto → preencher "Decisões humanas" e reportar ao usuário.

## Status das frentes

| # | Frente | Status | Resumo |
|---|--------|--------|--------|
| 1 | Segurança (rules, auth, perfis) | ✅ | S1 duplicata special_scales reabria delete — CORRIGIDO+deploy; S2/S3 registrados |
| 2 | Dados sensíveis (salários, PLR, recibos) | ✅ | Sem achados — camada correta (salário/PLR/recibos restritos) |
| 3 | Bugs & fluxos quebrados (serviços JS + smokes) | 🟡 | 21 achados; corrigidos A1/A2/A3/M1/M2/M8/M9; resto pendente (Frente 6) |
| 6 | Consolidação + decisões humanas | ✅ | 8 correções no staging; pendentes+decisões listados |
| 4 | Performance (N+1, carga, cache) | 🟡 | Achados P1/P2 (N+1 sequencial) registrados; correção adiada p/ pós-Frente 3 |
| 5 | UX (telas no browser, temas, vazios) | ✅ | Base saudável pós-fix CSS; só U1 (renomear Chamada) registrado |
| 6 | Consolidação + decisões humanas | ⬜ | — |

## Método

- Frentes 1-2 inline (rules + fluxos de auth eu analiso direto).
- Frente 3 com subagente varrendo os serviços (`*-service.js`, `*-engine.js`, `professores-*.js`) + bateria de smokes.
- Frente 4 inline (padrões conhecidos: loops await, cache sw).
- Frente 5 no browser real (preview server local, já configurado em `.claude/launch.json`).
- Correção segura = aplicada na hora + commit `fix(audit): …`. Risco/decisão = registrada aqui, não corrigida.

---

## Frente 1 — Segurança

**S1 [MÉDIA] — `special_scales` definido DUAS vezes nas rules; a duplicata reabre o `delete`.**
`firestore.rules:180-191` (bloco antigo, Sprint 5a, com subcoleção `scale_responses`) e `firestore.rules:229-233` (bloco novo, escala inteligente) casam o MESMO path. Em Firestore, matches duplicados fazem OR das permissões. O bloco novo declara `allow delete: if false` (intenção: trilha de escala imutável), mas o bloco antigo tem `allow write: if isAdmin()||isSuperv()` — e `write` inclui `delete`. Efeito real: admin/supervisão CONSEGUEM apagar `special_scales`, anulando o `delete:false`. Não é escalação de outsider (só perfis de gestão), mas quebra a garantia que o código tentou impor e confunde qualquer leitura futura das rules.
→ **Correção segura:** remover o bloco antigo duplicado (180-191). A subcoleção `scale_responses` não é usada por NENHUM JS (grep: só aparece em firestore.rules) → cai no default-deny sem impacto. `create/update` de `special_scales` são idênticos nos dois blocos; só o delete muda. **STATUS: corrigido (`firestore.rules` agora tem 1 só bloco, linha 221) + `firebase deploy --only firestore:rules` no staging OK.** Validação: a mudança é *monotônica* — remove um bloco que só concedia permissão via OR, então só pode reduzir acesso, nunca ampliar; o bloco restante é o mesmo já homologado na sessão da escala inteligente. O create/update de escala segue coberto pelo E2E das abas. Não rodei REST test dedicado do delete (custo alto vs. mudança só-remove-permissão).

**S2 [BAIXA] — `scale_responses` (subcoleção morta) tem condição de dono provavelmente incorreta.**
`firestore.rules:188` usa `request.auth.uid == uData().professorId` — compara o uid do Auth com o `professorId` (id do doc de teacher); no resto das rules o padrão de dono é `resource.data.X == uData().professorId`. Quase sempre falso. Irrelevante na prática (coleção nunca usada pelo frontend) e resolvido junto com S1 ao remover o bloco. Sem ação extra.

**S3 [BAIXA — aceito] — `notifications` create `if isAuth()` e `audit_log` create `if isAuth()`.**
`firestore.rules:328` e `:71`: qualquer autenticado cria notificação pra qualquer `recipientUserId` e entrada de auditoria. Permite spoof de notificação in-app / forjar trilha. Padrão comum em apps com auditoria client-side; sem valor sensível exposto. **NÃO corrigir agora** — registrar como aceito (mesmo patamar do tech-debt já existente). Endurecer exigiria CF, fora do escopo.

**Nota positiva:** `classes` (update só do dono não-fechado, delete só de aula de escala não-fechada), `substitutions`, `vacation_requests` (payment só admin, mês pago trava) estão coerentes. `monthly_closings` fechado é imutável (regra inviolável do CLAUDE.md respeitada: `update if ... status != 'fechado'`, `delete: false`).

## Frente 2 — Dados sensíveis

**Resultado: SEM ACHADOS — camada de dados sensíveis está correta.** Verificado item a item:
- `teacher_salaries` → `read, write: if isAdmin()` — só Admin, coleção isolada (regra inviolável #6 do CLAUDE.md respeitada). ✓
- PLR: `plr_cycles`/`plr_results` read só admin/superv; `plr_evaluations` read só admin/superv, create/update pelo próprio avaliador ou gestão; `plr_config` read do módulo (só pesos, não valores). Professor NÃO enxerga pool/notas/fatias. ✓
- `payment_records`, `receipts`, `creditos_professores` → professor lê só os DELE (`resource.data.teacherId == uData().professorId`); escrita só admin. ✓
- `mail/{id}` (Trigger Email) → `read, write: if false` no cliente; só CF via Admin SDK escreve. ✓

**Observação [informativa, não-bug]:** `plr_evaluations` só concede `read` a admin/superv. Se no futuro o papel de "avaliador" for estendido a um professor comum (pendência já anotada na spec do PLR), ele conseguiria *criar* a avaliação mas não *relê-la* → tela quebraria. No v1 (avaliadores = admin/superv) não acontece. Registrar pra quando o papel de avaliador for formalizado.

## Frente 3 — Bugs & fluxos quebrados

Subagente varreu 23 arquivos + 13 smokes (12 OK, `smoke-9` só exige `--project staging`). `node --check` 23/23 OK. Handlers onclick × globals: sem órfãos. Achados abaixo — os ALTA e vários MÉDIA foram **re-verificados por mim no código** (não são falso-positivo). Coluna FIX = plano de correção.

### 🔴 ALTA
- **A1 [confirmado] Reconsolidar infla o `fairness_counter`.** `scale-service.js:176` (`consolidate` chama `applyFairnessDelta` incondicionalmente) + botão "Reconsolidar" em `professores-escala-smart.js`. Reconsolidar soma diasTrabalhados de novo sem reverter o anterior → corrompe o insumo central do motor de justiça. (`consolidateByDay`/fim-de-ano é imune — fairness interno.) **FIX:** só aplicar fairness na 1ª consolidação (flag `fairnessApplied` no doc); reconsolidar não reaplica. TDD no smoke-scale-service.
- **A2 [confirmado] PLR "+ Avaliador"/"✕" não funcionam.** `professores-plr.js:97-108` faz push/splice em `PlrState.config`, mas `renderPlrConfigPage()` (`:40`) chama `plrLoadBase()` que sobrescreve `PlrState.config` com o doc do Firestore → linha some. **Impossível add/remover avaliador pela UI.** **FIX:** re-render sem recarregar do Firestore (render puro a partir de `PlrState.config` já em memória).
- **A3 [confirmado] Filtro "Semana anterior" mostra a semana ATUAL.** `professores-agenda.js:657-658`: `lastSunday = today - 1` só é domingo às segundas; `getStartOfWeek` disso devolve a segunda da semana corrente em ter–dom. **FIX:** `prevMonday = getStartOfWeek(today) − 7 dias`.

### 🟠 MÉDIA
- **M1 publishToAgenda ignora `{blocked}` → duplica aula de mês fechado.** `scale-service.js:290,330` descarta retorno de `_deleteScaleClasses`; republicar recria slot já congelado → aula duplicada → risco de pagamento dobrado. **FIX:** pular slots cujo delete veio `blocked` (aula com `monthClosingId`).
- **M2 Config. Pontos: campo vazio grava `null` e anula o default → Placar NaN.** `professores-engajamento.js:121` (`'' → null`) + `engagement-config.js:35` (spread não filtra null). Um campo em branco → `NaN` no total de TODO MUNDO (e no mérito da escala). **FIX:** filtrar null/undefined no merge (cai no default). TDD smoke-engagement-config.
- **M3 Chamada: trocar Data/Unidade mantém `marks`; salva gente fora do filtro.** `professores-engajamento.js:310-317`: só trocar o TIPO limpa marks; `saveChamada` grava todo `st.marks`. Dobra pontos ao trocar data; grava não-visíveis ao filtrar unidade; reabrir não carrega marks; rebaixar Presente→Faltou não remove ponto antigo (upsert nunca deleta). **DECISÃO HUMANA** (mudança de fluxo + toca tech-debt de upsert).
- **M4 Pós-fechamento mostra "Mês/undefined" + tabela vazia.** `professores-fechamento.js:481` usa o retorno enxuto da CF (`{success,closingId,totals}`, `functions/index.js:1014`) sem teachers/year/month. Cosmético (recarregar conserta) mas assusta. **FIX:** após fechar, recarregar o doc real do Firestore antes de renderizar.
- **M5 Modal de Férias: mistura `classList('open')` × `style.display` → para de abrir.** `professores-ferias.js:128` (close = `display:none` inline) vs `:349,704` (`add('open')`/`display:flex`). Inline vence a classe → modal trava fechado até re-render. **FIX:** padronizar num só mecanismo (usar `.open`).
- **M6 "+ Solicitar férias" no Meu Saldo é botão morto.** `professores-ferias.js:1271` chama modal cujo elemento só existe no innerHTML de `page-ferias`. **FIX:** garantir o modal na página certa (ou navegar p/ page-ferias antes).
- **M7 Pagamentos: chips Pendentes/Pagos não filtram.** `professores-pagamentos.js:84-86` — filtro nunca implementado, só pinta o chip. **FIX:** implementar filtro client-side por status do recibo.
- **M8 Pagamentos: `prompt`+`parseFloat` com vírgula BR grava valor errado.** `professores-pagamentos.js:282,303`: `'1.500,50' → parseFloat → 1.5`. Paga **R$ 1,50**. Idem crédito. **FIX:** normalizar número BR antes de parsear + validar. (Dinheiro → prioridade.)
- **M9 PLR: salvar config regenera IDs dos avaliadores → avaliações perdem peso.** `professores-plr.js:93`: `'Coordenador Técnico' → 'coordenador_t_cnico'` ≠ `coord_tecnico` do default → `avaliadoresPeso` desalinha, avaliações antigas caem p/ peso 1, nota final muda no save. **FIX:** ID estável (não regenerar do nome a cada save); corrigir junto de A2.
- **M10 XSS armazenado: nomes sem escape nas telas novas.** escala-smart (`s.name`/pessoa), engajamento (`t.name`), plr (`l.nome`, `a.nome` em `value=`), pagamentos (`u.name` etc.). Ex.: evento com nome `<img onerror=…>` roda p/ quem abrir a aba. Superfície = autenticados com escrita. **FIX:** aplicar `escapeHtml` (já existe no projeto) nos pontos de interpolação de nome. Espalhado.

### 🟡 BAIXA (edge cases — registrados, correção em lote depois)
1. `toISOString()` como "hoje" (UTC) — escala-smart:33, engajamento:174, plr:18, shared:1578 → entre 21h-0h BRT vira amanhã.
2. `points-engine.js:10-17 completedYears` — parse UTC + getters locais → virada de faixa 1 dia antes.
3. `scale-service.js:226 datesInRange` — `toISOString` em vez do padrão local de `saturdaysOfYear`.
4. `professores-escala-smart.js:277` — lê `slot.halfDay` nunca gravado → badge "½ período" morto.
5. `applyFairnessDelta` read-modify-write sem transação (mesma classe do tech-debt CreditService aceito).
6. `marcarPodeSerTodas` (escala-smart) sobrescreve "Não posso" → reelegível sem avisar.
7. `templateSlots` (scale-service:19) usa `'TOI'`/`'HIIT'` como modalityId (só smokes usam; UI usa `escalaSlotsPadrao`).
8. `plrHorasNoCiclo`/ferias:175 dependem de `unitId` sem `_` (hoje ok: unit-cp/pp).

### Verificar intenção (não afirmado como bug)
- Cobertura aberta (`CoverageService.pick`, shared:1708 + CF) NÃO credita ponto de proatividade; só a substituição direta credita. Se "assumir aula de colega = ponto" vale p/ cobertura, há lacuna. → pergunta pro Rodrigo.

### Arquivos limpos
`pessoas-model.js`, `plr-engine.js`, `professores-home.js`, `engagement-service.js` (além do tech-debt já comentado).

## Frente 4 — Performance

Padrão recorrente: **N+1 com `await` sequencial em loop** (um round-trip Firestore por professor, serializados). Com ~10-20 professores e 2 unidades o impacto é modesto, mas é ganho fácil e seguro (trocar por `Promise.all`). CORREÇÕES adiadas p/ depois da Frente 3 (mesmos arquivos que o subagente audita — evitar edição concorrente); consolidar por arquivo.

**P1 [PERF-MÉDIA] `professores-escala-smart.js`** — dois loops sequenciais de rede:
- `:92-97` `escalaLoadBase`: `for (t of teachers) await ScaleService.getFairness(t.id)` — N gets serializados a cada abertura da tela de gestão.
- `~:368-372` `consolidarEscala`: `for (t of teachers) await EngagementService.scoreboard(...)` — N scoreboards serializados a cada consolidação.
→ Correção: `await Promise.all(teachers.map(...))`.

**P2 [PERF-MÉDIA] `professores-plr.js`** — mesmo padrão + código duplicado:
- `:266-269` (`calcularPlr`) e `:304` (`fecharCicloPlr`): `for (t of teachers) await EngagementService.scoreboard(...)` serializado, em DOIS handlers com o bloco idêntico repetido.
→ Correção: extrair helper `plrEngajById(cycle)` com `Promise.all` e chamar nos dois pontos (DRY + paralelismo numa tacada).

**Nota:** `plrHorasNoCiclo` (`:246`) também itera unidades com `await ClosingService.list(u.id)` sequencial — só 2 unidades, impacto desprezível; paralelizar junto se de baixo custo, senão deixar.

**Sem achados de:** carga de imagem/bundle pesada (vanilla, sem build), cache (sw v3.1 já resolvido — JS network-first, tech-debt #2 fechado).

## Frente 5 — UX

Verificado no browser (preview local, tema CLARO — onde o usuário reclamou). **Após o fix de CSS de hoje (`c2bf028`: btn-primary/secondary/.input + modal-overlay), a camada base está saudável:** varredura das 6 telas novas (engaj-config/placar, plr-config/avaliacao/resultado, escala-smart) → **0 botões crus, 0 overflow horizontal, todas com page-hdr/título.** Chamada usa chips de estado com estilo inline (Presente/Faltou/Líder) — intencional, ok.

**U1 [UX-BAIXA] — renomear "Chamada" → "Confirmar Presença".** Pedido explícito do Rodrigo (lista 02/07) + título da tela hoje é "✅ Chamada". Troca de label no menu (`professores-nav.js`) e no `page-hdr`. Trivial; aplicar na leva de correções OU junto do balde de features do Rodrigo. **Registrado, não aplicado** (é feature-request do cliente, não defeito — deixo pra decisão de quando).

**Nota:** a "revisão de layout profunda" que o usuário pediu (hierarquia, agrupamento em cards, densidade das telas PLR/Engajamento) NÃO é escopo desta auditoria de defeitos — é trabalho de design, rastreado em [[feedback-ui-layout-telas-novas]]. Aqui só confirmo que não há mais UX QUEBRADA (botão inoperante/ilegível/cortado).

**Obs. de ferramenta:** `preview_screenshot` deu timeout repetido nesta sessão (a página responde a `eval` normalmente — problema do renderer do tool, não do app). Frente 5 feita por inspeção via `eval`/`getComputedStyle`.

## Frente 6 — Consolidação

### ✅ Corrigido, testado e deployado no staging (rules + hosting)
| Achado | Fix | Teste |
|--------|-----|-------|
| S1 rules duplicata reabria delete | bloco antigo removido | deploy compila; mudança monotônica |
| A1 reconsolidar inflava fairness | só 1ª consolidação move justiça (`fairnessApplied`) | smoke-scale-service (idempotência) |
| A2 PLR +Avaliador não funcionava | re-render em memória (`plrRenderAvalList`), sem recarregar Firestore | verificado no browser |
| A3 "Semana anterior" = semana atual | `getStartOfWeek(today) − 7` | lógica de data conferida |
| M1 publish duplicava aula de mês fechado | pula `blockedSlotIds` | smoke-scale-service (M1) |
| M2 campo vazio → NaN no placar | `pruneNil` no merge (0 preservado) | smoke-engagement-config (+2 casos) |
| M8 `parseFloat` BR pagava R$1,50 | `pagParseNumBR` nos 2 pontos + validação | 6 casos conferidos |
| M9 IDs de avaliador regenerados | id estável via `data-aval-id` | verificado no browser |
| M10 (parcial) | escape no nome do avaliador (`value=`) | — |

Commits: `f655673` (S1) · `4247373` (A2/A3/M2/M8/M9) · `fe634d9` (A1/M1). Bateria 12/12 smokes verde, `node --check` OK.

### ⬜ Pendente — próxima sessão (todos com fix já proposto na Frente 3)
- **M10 resto (XSS)** — escapar `t.name`/`s.name`/nomes em engajamento, escala-smart, pagamentos, plr-resultado. Espalhado mas mecânico (`escapeHtml` já global). **Prioridade** (XSS armazenado real).
- **M5** modal de Férias trava (mistura `.open` × `display` inline) — padronizar.
- **M4** pós-fechamento "Mês/undefined" — recarregar doc real do Firestore após fechar.
- **M6** "+ Solicitar férias" no Meu Saldo é botão morto — garantir o modal na página certa.
- **M7** chips Pendentes/Pagos não filtram — implementar filtro client-side.
- **P1/P2** N+1 sequencial (escala-smart getFairness / plr scoreboard) → `Promise.all`. Baixo impacto (poucos profs).
- **BAIXA 1-8** (timezone `toISOString`, `halfDay` morto, `marcarPodeSerTodas` sobrescreve "Não posso", etc.) — lote de tech-debt.

## Decisões humanas (entrega final)

1. **M3 — comportamento da Chamada ao trocar Data/Unidade.** Hoje trocar data/unidade mantém as marcações e `saveChamada` grava todos os `marks` (inclusive fora do filtro) → risco de dobrar pontos / gravar quem não devia. Além disso reabrir chamada salva não recarrega marks, e rebaixar Presente→Faltou não remove o ponto antigo (upsert nunca deleta). **Precisa decidir o fluxo certo** (limpar marks ao trocar data? carregar marks existentes ao reabrir? deletar ponto ao rebaixar?) — mudança de comportamento + toca tech-debt de upsert. Não é correção óbvia.
2. **Cobertura aberta credita ponto de proatividade?** Só a substituição direta credita hoje; a cobertura de vaga aberta (o caso mais proativo) não. Regra de produto — perguntar ao Rodrigo (encaixa na frente de features que ele pediu).
3. **Nível de validação das rules (S1).** Corrigi por análise (mudança só-remove-permissão) + deploy, sem REST test dedicado. Se quiser rigor extra antes da produção, rodar o REST test do delete (padrão [[feedback-padrao-validacao-staging]]).

**Regra de produção mantida:** nada foi tocado em produção; tudo no staging/branch. As correções entram em prod junto com o módulo (checklist-deploy-producao.md), nunca isoladas.
