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
| 4 | Performance (N+1, carga, cache) | ⬜ | — |
| 5 | UX (telas no browser, temas, vazios) | ⬜ | — |
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

_(pendente)_

## Frente 5 — UX

_(pendente)_

## Decisões humanas (entrega final)

_(preencher ao consolidar)_
