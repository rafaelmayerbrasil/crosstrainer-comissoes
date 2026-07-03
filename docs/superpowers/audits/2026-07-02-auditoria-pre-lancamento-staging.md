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
| 1 | Segurança (rules, auth, perfis) | ⬜ | — |
| 2 | Dados sensíveis (salários, PLR, recibos) | ⬜ | — |
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

_(pendente)_

## Frente 2 — Dados sensíveis

_(pendente)_

## Frente 3 — Bugs & fluxos quebrados

_(pendente)_

## Frente 4 — Performance

_(pendente)_

## Frente 5 — UX

_(pendente)_

## Decisões humanas (entrega final)

_(preencher ao consolidar)_
