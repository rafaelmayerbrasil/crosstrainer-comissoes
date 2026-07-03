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
| 3 | Bugs & fluxos quebrados (serviços JS + smokes) | ⬜ | — |
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

_(pendente)_

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

## Decisões humanas (entrega final)

_(preencher ao consolidar)_
