# Endereço novo: `sistema.crosstainer.com.br`

**Data:** 04/10/2026 · **Pedido do Rafael:** tirar o sistema do GitHub Pages e usar o domínio da academia.
**Desenho aprovado pelo Rafael em 04/10** ("sim, pode registrar"). Nome escolhido por ele: `sistema`.

## Por que

- A URL de hoje (`rafaelmayerbrasil.github.io/crosstrainer-comissoes/`) mostra a grafia errada da marca e o nome de uma pessoa.
- O GitHub Pages gratuito obriga o repositório a ser **público** (conferido em 04/10: `visibility: public`). Fora dele, o repositório pode virar privado.
- O site sai por uma porta (GitHub) e regras/funções por outra (Firebase). Passa a ser uma porta só.
- O GitHub Pages segura versão antiga por 10 minutos; a hospedagem do Firebase já está configurada para página sem cache e JS/CSS com 5 minutos (`firebase.json`).
- O mesmo acesso ao painel do domínio resolve os avisos por e-mail que caem no spam (pendência desde 24/08).

## Como está hoje (conferido em 04/10)

- **Domínio:** `crosstainer.com.br` é administrado no **Wix** (`ns14/ns15.wixdns.net`). O endereço principal e o `www` são o site da academia; o e-mail é de outro provedor. Quem tem o login é o Rodrigo.
- **Hospedagem do Firebase de produção** (`crosstrainer-comissoes.web.app`): existe, mas guarda uma publicação de **30/07/2026** e, de propósito, se comporta como **staging** (`firebase-config.js` só trata `rafaelmayerbrasil.github.io` como produção).
- **Links fixos:** nenhuma Cloud Function tem o endereço do site escrito. O "esqueci minha senha" usa a página padrão do Firebase, sem link de retorno.
- **Páginas que carregam `firebase-config.js`:** `index.html`, `professores.html`, `renovacoes.html`, `termometro.html`, `receipt.html`, `pacto-sombra.html`.

## O que já foi feito

- **04/10/2026, 23h07:** `sistema.crosstainer.com.br` registrado na hospedagem de produção do Firebase (API `customDomains`). Estado: aguardando o registro no Wix. Nada mudou para quem usa o sistema.

## O desenho

### 1. Registro no Wix (Rodrigo)

Um registro só:

| Tipo | Nome (host) | Valor |
|---|---|---|
| CNAME | `sistema` | `crosstrainer-comissoes.web.app` |

Depois dele, o Firebase confirma o domínio e emite o certificado sozinho (de minutos a algumas horas). Não mexe no site nem nos e-mails da academia.

### 2. Código (`firebase-config.js`, único arquivo de produção alterado)

`index.html`, `commission.js`, `sw.js` e `manifest.json` **não mudam**.

- **Reconhecer o endereço novo como produção:** `sistema.crosstainer.com.br` entra em `PRODUCTION_HOSTS`. `crosstrainer-comissoes.web.app` continua fora da lista (segue caindo em staging, como hoje).
- **Aviso no endereço antigo:** quando o host é `rafaelmayerbrasil.github.io`, uma faixa fixa no topo: "O sistema mudou de endereço: sistema.crosstainer.com.br", com botão que leva à mesma tela no endereço novo.
- **Redirecionamento (segunda publicação, ~2 semanas depois):** o endereço antigo passa a levar sozinho ao novo, preservando a tela (caminho sem o prefixo `/crosstrainer-comissoes`, mais `?…` e `#…`).
- A decisão (produção ou staging · mostrar faixa · redirecionar · para onde) fica numa **função pura** que recebe o host e o caminho, com teste próprio que a **chama** — não que lê o texto do arquivo.
- A fase (faixa ou redirecionamento) é uma constante no arquivo, trocada na segunda publicação.

### 3. Login

- `sistema.crosstainer.com.br` entra nos **domínios autorizados** do Auth de produção.
- A sessão é por endereço: **cada pessoa faz login uma vez** no endereço novo. E-mail e senha são os mesmos.
- Quem instalou o ícone no celular **instala de novo** a partir do endereço novo (o `sw.js` se registra sozinho no endereço novo, sem alteração).

### 4. Publicação do site

- Novo `scripts/publicar-site.js`: confere que o `main` local é igual ao `origin/main`, monta uma **cópia limpa do `main`** numa pasta temporária e publica a hospedagem a partir dela. Motivo: a hospedagem publica a pasta do disco (`public: "."`), e a pasta de trabalho tem `backups/` e `scratchpad/` com dado real.
- Staging por padrão; produção só com `--project production` explícito (regra 3 do `CLAUDE.md`).
- **Durante a transição, publicar = `git push origin main` + `publicar-site.js`** (o antigo ainda serve a faixa). Depois do redirecionamento, o GitHub Pages só precisa do `firebase-config.js` que redireciona.
- `firebase.json` não muda.

### 5. Ordem

1. ✅ Registrar o endereço no Firebase.
2. Código + teste + staging (a faixa não aparece no staging; o site funciona igual).
3. OK do Rafael → publicar no `main` **e** na hospedagem de produção. Pode ser antes ou depois do registro no Wix; **o ideal é antes**, para o endereço novo nunca mostrar a versão de 30/07 ligada ao staging.
4. Rodrigo cola o registro no Wix.
5. Conferir no endereço novo: certificado válido, ambiente PRODUÇÃO no console, e o Rafael entra e abre Comissões, Professores e Renovações.
6. Avisar o time (texto pronto) — a faixa no endereço antigo faz o resto.
7. ~2 semanas depois: segunda publicação, o antigo redireciona.
8. Depois: tornar o repositório privado e desligar o GitHub Pages (decisão do Rafael; desligar o Pages mata o redirecionamento).

### 6. E-mail fora do spam (passo irmão, mesmo acesso ao Wix)

Autenticar `crosstainer.com.br` no SendGrid (3 registros CNAME gerados por ele) e trocar o remetente na extensão. O sistema não muda. Feito em sessão própria, quando houver acesso ao Wix.

## Se der errado

- O endereço antigo continua funcionando durante toda a transição; voltar atrás é publicar o `firebase-config.js` anterior.
- Nenhum dado muda de lugar: o banco, as regras e as funções são os mesmos.
- Tirar o registro do Wix desliga o endereço novo sem afetar o resto.

## Testes

- `scripts/smoke-endereco-novo.js`: a função de decisão para cada host (novo, antigo, `web.app`, staging, `localhost`, `file://`) nas duas fases; o destino do redirecionamento preserva tela, `?` e `#`; o endereço novo e o antigo são os únicos que caem em produção.
- Suíte inteira antes de publicar.
- No staging: as 6 páginas carregam, ambiente STAGING no console, sem faixa.
- Em produção: os itens do passo 5 da ordem.

## Fora do escopo

- Modernização da plataforma (empresa/filiais, módulos, IA, WhatsApp): roteiro próprio.
- Mudar os IDs do Firebase (`crosstrainer-…`): permanecem (regra 8 do `CLAUDE.md`).
