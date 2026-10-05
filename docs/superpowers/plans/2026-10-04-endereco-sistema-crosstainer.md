# Endereço novo `sistema.crosstainer.com.br` — plano de implementação

> **Para quem executa:** seguir tarefa a tarefa, com teste antes do código. Execução na própria sessão (o Rafael pediu para seguir sem ele em 04/10); produção só com o OK dele.

**Objetivo:** o sistema passa a ser servido em `sistema.crosstainer.com.br` pela hospedagem do Firebase, e o endereço antigo avisa e depois redireciona.

**Arquitetura:** a decisão "que ambiente é este host e o que fazer com quem chega pelo endereço antigo" vira uma função pura dentro de `firebase-config.js` (carregado pelas 6 páginas), controlada por uma constante de fase. A publicação do site sai de uma cópia limpa do commit (`git archive`), nunca da pasta de trabalho.

**Especificação:** `docs/superpowers/specs/2026-10-04-endereco-sistema-crosstainer-design.md`

**Arquivos:**
- Modificar: `firebase-config.js` (único arquivo de produção)
- Criar: `scripts/smoke-endereco-novo.js`, `scripts/publicar-site.js`, `scripts/smoke-publicar-site.js`
- **Não tocar:** `index.html`, `commission.js`, `sw.js`, `manifest.json`, `firebase.json`

**Sem bump de `?v=`:** na primeira publicação (fase `nenhuma`) a mudança só tem efeito no endereço novo, onde ninguém tem cache. Nas fases seguintes, o cache do GitHub Pages (10 min) vence sozinho; faixa 10 minutos atrasada não faz diferença.

---

## Tarefa 1 — a decisão do endereço (`firebase-config.js`)

**Contrato** (exposto em `window.CT_ENDERECO`):

- `fase`: `'nenhuma'` | `'aviso'` | `'redirecionar'` — constante `FASE_MUDANCA` no arquivo. **Começa em `'nenhuma'`** (o endereço novo ainda não responde).
- `novo`: `'sistema.crosstainer.com.br'`
- `decidir(loc, fase)` → `{ env, destino, acao }`
  - `env`: `'production'` só para `rafaelmayerbrasil.github.io` e `sistema.crosstainer.com.br`; qualquer outro host (inclusive `crosstrainer-comissoes.web.app`, `localhost`, vazio) → `'staging'`.
  - `destino`: só quando o host é o antigo — `https://sistema.crosstainer.com.br` + caminho sem o prefixo `/crosstrainer-comissoes` + `search` + `hash`. Nos outros hosts, `null`.
  - `acao`: `null` sem destino ou na fase `nenhuma`; `'aviso'` na fase `aviso`; `'redirecionar'` na fase `redirecionar`.
- `mostrarAviso(destino)`: faixa fixa no topo, estilos próprios (sem variáveis de tema), com o endereço, "entre com o mesmo e-mail e senha", botão para o `destino` e × que fecha até o fim da sessão (`sessionStorage`, com try/catch). Some na impressão (o `receipt.html` é impresso). Se o `body` ainda não existe, espera `DOMContentLoaded`.

**Fluxo ao carregar:** `decidir(window.location, FASE_MUDANCA)` → se `acao === 'redirecionar'`, `location.replace(destino)` e **não** inicializa o Firebase; senão inicializa como hoje e, se `acao === 'aviso'`, chama `mostrarAviso`.

- [ ] **1.1 Teste que falha:** `scripts/smoke-endereco-novo.js` roda `firebase-config.js` como `<script>` num sandbox `vm` (stub de `firebase`, `document` e `location`), sem `require`. Casos:
  1. host novo → `FIREBASE_ENV === 'production'` e o projeto inicializado é `crosstrainer-comissoes`
  2. host antigo → produção
  3. `crosstrainer-comissoes.web.app`, o staging, `localhost`, `127.0.0.1` e host vazio → staging
  4. `decidir` no host antigo: `/crosstrainer-comissoes/professores.html?x=1#agenda` → `https://sistema.crosstainer.com.br/professores.html?x=1#agenda`; `/crosstrainer-comissoes/` e `/crosstrainer-comissoes` → `…/`
  5. `decidir` nas três fases devolve `null` / `'aviso'` / `'redirecionar'`; fora do host antigo, sempre `null`
  6. a fase gravada no arquivo é uma das três, e o carregamento de ponta a ponta no host antigo faz exatamente o que a fase manda (nada / faixa no `body` / `location.replace` sem inicializar o Firebase)
  7. `mostrarAviso` monta a faixa com o link para o destino, o texto com `sistema.crosstainer.com.br`, sem a grafia `CrossTrainer`, e o × a remove e grava em `sessionStorage`
  8. com a faixa já fechada na sessão, não mostra de novo
- [ ] **1.2** Rodar `node scripts/smoke-endereco-novo.js` → falha (`CT_ENDERECO` não existe).
- [ ] **1.3** Implementar em `firebase-config.js`.
- [ ] **1.4** Rodar → passa. Rodar também `smoke-modulos-no-browser.js`.
- [ ] **1.5** Commit.

## Tarefa 2 — publicar o site de uma cópia limpa (`scripts/publicar-site.js`)

**Uso:** `node scripts/publicar-site.js [--project staging|production] [--apply]`. Sem `--apply`, só mostra o que faria. Padrão: staging.

**Funções puras exportadas** (o `main` só roda com `require.main === module`):
- `podePublicar({ projeto, branch, sujo, igualOrigin })` → `{ ok, motivo }`. Produção exige `branch === 'main'`, árvore sem alteração em arquivo rastreado e `HEAD === origin/main`. Staging aceita qualquer branch; com alteração não gravada, recusa (o que sai é o commit, não o disco).
- `conferirPasta(arquivos)` → `{ ok, problemas[] }`. Exige `index.html`, `professores.html`, `firebase-config.js`, `firebase.json`; recusa qualquer caminho em `backups/`, `scratchpad/`, `relatorios pacto/`, `serviceAccount*.json`, `*credencial*`, `.env*`.

**Passos do `main`:** ler branch/estado (`git fetch origin main` só em produção) → `podePublicar` → `git archive HEAD` para uma pasta temporária → `conferirPasta` → `firebase deploy --only hosting --project <projeto>` com `cwd` na pasta → baixar `firebase-config.js`, `index.html` e `professores.html` do site publicado (com `?t=` para furar cache) e comparar com o commit, ignorando fim de linha → apagar a pasta.

- [ ] **2.1 Teste que falha:** `scripts/smoke-publicar-site.js` — produção fora do `main` recusa; produção com `main` atrás/à frente do `origin` recusa; produção suja recusa; produção limpa aceita; staging em branch aceita; staging sujo recusa; `conferirPasta` aceita a lista real de `git ls-files` e recusa uma lista com `backups/x.json`, com `serviceAccount-prod.json` e sem `index.html`.
- [ ] **2.2** Rodar → falha. **2.3** Implementar. **2.4** Rodar → passa.
- [ ] **2.5** `node scripts/publicar-site.js` (sem `--apply`) mostra commit, branch e número de arquivos.
- [ ] **2.6** Commit.

## Tarefa 3 — staging

- [ ] **3.1** Suíte inteira: `for f in scripts/smoke-*.js; do node "$f" >/dev/null 2>&1 || echo "FALHOU $f"; done` → só `smoke-9` (antigo).
- [ ] **3.2** `node scripts/publicar-site.js --project staging --apply`.
- [ ] **3.3** No navegador, em `crosstrainer-comissoes-staging.web.app`: `index.html`, `professores.html`, `renovacoes.html`, `termometro.html` carregam; `window.FIREBASE_ENV === 'staging'`; sem faixa; sem erro novo no console.
- [ ] **3.4** Ainda no staging, chamar `CT_ENDERECO.mostrarAviso('https://sistema.crosstainer.com.br/')` pelo console para ver a faixa de verdade em computador e em 375 px (não cobre o login nem a barra de baixo; o × fecha).
- [ ] **3.5** Registrar no `CONTEXTO_SESSAO.md`.

## Tarefa 4 — produção (**só com o OK do Rafael**)

- [ ] **4.1** Merge da branch no `main`, `git push origin main` (GitHub Pages: nada muda na fase `nenhuma`).
- [ ] **4.2** `node scripts/publicar-site.js --project production --apply` — a hospedagem do Firebase sai da versão de 30/07.
- [ ] **4.3** Rodrigo cola no Wix: CNAME `sistema` → `crosstrainer-comissoes.web.app`.
- [ ] **4.4** Conferir: `ownershipState`/`hostState`/certificado na API `customDomains`; `https://sistema.crosstainer.com.br` abre com cadeado; console diz PRODUÇÃO; o Rafael entra e abre Comissões, Professores e Renovações.
- [ ] **4.5** Fase `aviso`: trocar a constante, suíte, staging, OK, `main` + hospedagem. Texto para o grupo.
- [ ] **4.6** ~2 semanas depois, fase `redirecionar`, mesmo rito.
- [ ] **4.7** Depois: repositório privado e fim do GitHub Pages (decisão do Rafael); autenticar o domínio no SendGrid.

Desde 4.2, **publicar o site = `git push origin main` + `publicar-site.js --project production --apply`**, até o GitHub Pages ser desligado.
