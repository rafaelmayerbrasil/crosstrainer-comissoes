# Modo sombra da API da Pacto — desenho

**Data:** 13/09/2026 · **Pedido por:** Rafael · **Decisões de produto:** Rafael
**Contexto:** hoje os dados de vendas só entram quando o Rafael ou o Rodrigo exportam o
`faturamento-recebido` da Pacto e arrastam na tela. É manual. O objetivo declarado é que seja
**automático e diário**. Este desenho é o primeiro passo: buscar pela API **em paralelo** com o
arquivo, sem substituí-lo, e medir se as duas fontes contam a mesma coisa.

---

## O que a pesquisa de 13/09 estabeleceu (e sustenta o desenho)

Detalhe completo em `memory/pacto-api-integracao.md`. O essencial:

1. **A CrossTainer é uma rede de três bancos na Pacto**, cada um com chave própria:
   Administração (`6d85c17b…`), Campeche (`c7b092b1fe873e29436873a01cdfe829`), Pequeno Príncipe
   (`9d4721a873dd9fe621aeed5093b791f8`). A credencial só nasce na Administração.
2. **O gateway (`apigw`) preenche a chave sozinho a partir da credencial** e por isso só lê a
   Administração — o faturamento volta R$ 0,00 com `status: sucesso`. **O núcleo direto
   (`https://app.pactosolucoes.com.br/api/prest`) aceita a chave no caminho** e, com a mesma
   credencial, lê cada unidade. Sem credencial, recusa.
3. **A consulta que serve** é `POST /importacao/{chave}/resumoPeriodo?inicio=dd/MM/yyyy&fim=dd/MM/yyyy`
   (corpo `{}`): traz `pagamentos` (data, formas, parcelas pagas com o contrato), `vendaAvulsa`,
   `estornos`, `estornosContrato` e — **só no Príncipe** — `contratosLancados` com consultor.
4. **No Campeche `contratosLancados` volta sempre vazio** (julho, agosto, setembro, quinzena e
   um único dia). Defeito da Pacto, reportado ao suporte em 13/09. Contorno que funciona nas duas
   unidades: `POST /cliente/{chave}/consultarContratos?cliente={aluno.codigo}&registros=N` →
   `situacaoContrato`, `nomePlano`, `vigenciaDe`, `vigenciaAteAjustada`, `numeroMeses`.
   **Não traz consultor.** Nenhuma consulta testada traz o consultor do Campeche.
5. **Agosto conferido por cliente+dia contra o arquivo, e a diferença fecha no centavo:**

   | | grupos | batem | API × arquivo | explicação |
   |---|---:|---:|---:|---|
   | PP | 283 | 253 | +84,66 | +311,16 parcela renegociada (API = cobrado, arquivo = original) · −226,50 vendinhas de balcão fora de `pagamentos` |
   | CP | 281 | 265 | −96,14 | +174,36 (7085; 7129 pago com crédito em conta) · +150,00 avulsas com recibo ausentes no arquivo · −420,50 vendinhas de balcão |

6. **Limite de uso:** existe, é alto e por janela de tempo. Uma busca diária está folgada.

---

## Decisões do Rafael (13/09)

| # | Decisão |
|---|---|
| 1 | **Modo sombra**: busca diária em paralelo, **o arquivo continua oficial**, nada muda em comissão ou folha |
| 2 | **Só o Rafael vê** a tela, para validar. O Rodrigo segue no painel alimentado pelo arquivo |
| 3 | **Caminho A**: a API monta linhas no formato do export e tudo daí para frente é o tradutor e o motor que já existem, **sem alteração** |
| 4 | **A comparação acontece arrastando o arquivo na própria tela**, sem gravar nada |
| 5 | Construir, testar, corrigir e **só entregar validado** |

**Por que o caminho A:** o erro de R$ 7.580,84 do fechamento (sessão 64) nasceu de uma conta
**copiada em dois lugares**. Um tradutor novo direto da API (caminho B) reescreveria as regras de
migrado, "cada contrato paga uma vez só", registro de teste e recorrência. Contar ativação direto da
API (caminho C) criaria uma terceira definição de ativação. No caminho A, **se API e arquivo
divergirem, a diferença é de dado, nunca de regra** — que é exatamente o que o modo sombra mede.

---

## As peças

```
 madrugada (04h)                                           navegador do Rafael
┌────────────────────────────┐                     ┌──────────────────────────────────┐
│ CF buscarPactoSombra        │                     │ pacto-sombra.html                 │
│  └ pacto-sombra.js          │  pacto_sombra_dias  │  ├ lê os dias do mês              │
│     ├ pacto-api-cliente.js ─┼─► (1 doc por       ─┼─►├ arrasta o export               │
│     │   (HTTP, pausas,      │    unidade/dia)     │  └ pacto-sombra-comparacao.js     │
│     │    situação do dia)   │  pacto_contratos    │      ├ PactoAdapter.traduzir (×2) │
│     └ pacto-api-linhas.js   │   (caderninho)      │      ├ CommissionEngine (×2)      │
│         (puro, gêmeo)       │                     │      └ cliente+dia, ativações      │
└────────────────────────────┘                     └──────────────────────────────────┘
```

### 1. `pacto-api-linhas.js` — o conversor (puro)
Sem Firebase, sem rede, sem DOM, no padrão de `commission.js` e `closing-payroll.js`. Existe na
raiz (a tela usa) e em `functions/` (o servidor usa), **com teste que falha se as cópias
divergirem** — o deploy de Functions só leva `functions/`.

```
PactoApiLinhas.montar({ resumo, contratos, unidade, dia }) → {
  linhas:   [ [...22 posições no formato do export] ],
  foraDeProposito: [ { motivo, valor, recibo, contrato? } ],
  avisos:   [ { motivo, contrato?, recibo? } ],
  totais:   { recebido, pagamentos, parcelas, vendinhasSemRecibo: {qtd, valor},
              estornos: {qtd, valor}, estornosContrato: {qtd, valor} },
}
```

- `resumo` é a resposta do `resumoPeriodo` de **um dia**; `contratos` é um `Map` código → dados do
  caderninho; `unidade` é `'CP'` ou `'PP'`.
- **Nunca copia** `cpf`, `cpfResponsavel`, `dataNascimento`, `matriculaSesc`, telefone, e-mail.

### 2. `functions/pacto-api-cliente.js` — o cliente HTTP
- `resumoDoDia(chave, dia)` e `contratosDoCliente(chave, cliente)`; recebe `fetch` e a credencial
  por injeção (testável com Pacto falsa).
- **Pausa de 2 s entre chamadas.** Nunca paraleliza.
- Classifica toda resposta num resultado com `situacao`: `ok` · `credencial_recusada` (401/403) ·
  `limite` (429 ou mensagem de limite) · `falhou` (5xx, rede, corpo que não é JSON).
- **Nunca registra a credencial nem dado de cliente em log.**

### 3. `functions/pacto-sombra.js` — a busca de um dia
`buscarDia({ db, cliente, unidade, dia })`:
1. chama `resumoDoDia`;
2. para cada contrato das parcelas pagas **que não está no caderninho**, chama
   `contratosDoCliente` **uma vez por cliente** e grava todos os contratos que vierem;
3. monta as linhas com o conversor;
4. **substitui** o documento do dia (nunca soma).

`buscar({ db, cliente, unidades, dias })` percorre os dias em ordem e **para tudo** na primeira
`credencial_recusada` ou `limite`, marcando os dias restantes como não buscados.

### 4. Cloud Functions (em `functions/index.js`)
| função | quando | o que faz |
|---|---|---|
| `buscarPactoSombra` | `onSchedule` todo dia 04:00 (America/Sao_Paulo) | rebusca **os 3 dias anteriores** das duas unidades |
| `buscarPactoSombraManual` | `onCall`, **só admin** | `{ de, ate, unidades? }`, no máximo 62 dias por chamada; `ate` é cortado em **ontem** |

Credencial via `defineSecret('PACTO_API_KEY')`. As chaves das unidades não são segredo e ficam no
código (`PACTO_UNIDADES`).

### 5. Firestore
| coleção | documento | conteúdo |
|---|---|---|
| `pacto_sombra_dias` | `{CP\|PP}_{AAAA-MM-DD}` | `unidade, dia, situacao, motivo?, linhas (JSON), foraDeProposito, avisos, totais, buscadoEm, contratosConsultados` |
| `pacto_contratos` | `{CP\|PP}_{codigo}` | `codigo, unidade, situacaoContrato, nomePlano, codigoPlano, vigenciaDe, vigenciaAte, numeroMeses, consultor (null no CP), atualizadoEm` |

`linhas` é gravado como **string JSON**: Firestore não aceita array de arrays.

**Regras:** leitura **só admin**; escrita **proibida** para o cliente (só o servidor, via Admin SDK).

### 6. A tela — `pacto-sombra.html` + `pacto-sombra.js` + `pacto-sombra-comparacao.js`
Página própria, **fora do `index.html`** de Comissões. Carrega `firebase-config.js`,
`pacto-adapter.js`, `commission.js`, `pacto-api-linhas.js` e os dois arquivos da tela.
Só admin entra (quem não é vê "acesso restrito").

- **Escolhe unidade e mês.** Mostra a grade de dias com a situação de cada um.
- **Resumo da API do mês até hoje:** recebido, **ativações** (novo / renovação / retorno /
  voucher), o que ficou de fora e por quê, avisos.
- **Arrasta o export** → `PactoAdapter.traduzir` roda nas linhas da API **e** nas do arquivo, com
  o mesmo `mes`; `CommissionEngine` classifica os dois lados; a tela mostra lado a lado:
  - total recebido e ativações por categoria;
  - **divergências por cliente+dia**, com a causa quando reconhecível: *mesmo contrato em outro
    dia* · *parcela renegociada* · *vendinha de balcão* · *crédito em conta* · *só na API* ·
    *só no arquivo*;
  - no **Campeche, a vendedora não é comparada** e a tela diz o porquê.
- **Não grava nada.** Não chama nenhuma função que escreva.

`pacto-sombra-comparacao.js` é puro: `comparar({ linhasApi, linhasArquivo, mes, unidade, config })`.
A tela só desenha o que ele devolve.

---

## Como uma parcela paga vira linha

Uma linha **por parcela paga** de cada recibo do dia:

| posição do export | origem na API |
|---|---|
| `matricula` | `aluno.codigo` |
| `nome` | `aluno.nome` |
| `resp1`, `resp2` | `responsavelLancamento` (inclui `RECORRENCIA`) |
| `produto` | contrato: `nomePlano` do caderninho · avulsa: nome do produto em `vendaAvulsa` (casado pelo código da parcela) · sem dado: `descricao` da parcela |
| `contrato` | `codigoContrato` (avulsa: `0`) |
| `inicio`, `termino`, `duracao` | `vigenciaDe`, `vigenciaAte`, `numeroMeses` do caderninho |
| `plano` | `nomePlano` do caderninho |
| `situacao` | `situacaoContrato` do caderninho (Matrícula / Renovação / Rematrícula) |
| `lancamento` | **data real do pagamento** (`pagamento.data`, dd/MM/yyyy) |
| `valor` | `valor` da parcela, formato `1.234,56` |
| `forma` | formas do recibo, unidas por ` + ` |
| `empresa` | `CROSSTAINER UNID. CAMPECHE (CP)` / `CROSSTAINER UNID. PEQ PRÍNCIPE (PP)` |
| `consultor` | PP: `contratosLancados[].consultor` quando o contrato aparece como lançado na janela buscada, guardado no caderninho para os pagamentos seguintes; contrato nunca visto como lançado fica vazio **com aviso** · **CP: vazio** |

### Fica de fora de propósito (vai para `foraDeProposito`, a tela lista)
1. **Recibo pago só com `CREDITO CONTA CLIENTE`** — não é dinheiro novo.
2. **Vendinhas de balcão sem recibo** (`vendaAvulsa` sem parcela em `pagamentos`) — somadas sem
   cuidado duplicariam. Só total informativo. **Não mexem em ativação.**
3. **Estornos** — contados e somados nos totais, não viram linha (o arquivo também não os tem).

### Diferenças conhecidas, que a tela nomeia
- **Matrícula junto da primeira parcela**: no arquivo são duas linhas, na API uma. A ativação conta
  igual; a comissão por linha muda.
- **Parcela renegociada**: API = valor cobrado, arquivo = valor original. **Decisão pendente com o
  Rodrigo** sobre qual base a comissão usa — não é deste desenho.
- **Consultor no Campeche**: vazio até a Pacto responder. **Não usar `responsavelLancamento` como
  vendedora** — daria nome errado em silêncio.

---

## Quando algo dá errado

**Dia que falhou nunca aparece como dia sem venda.**

| `situacao` | quando |
|---|---|
| `buscado` | veio com ao menos um pagamento |
| `vazio_conferir` | a Pacto respondeu sem nenhum pagamento — o cartão recorrente cobra todo dia, então zero é suspeito |
| `falhou` | 5xx, rede, corpo quebrado; guarda o motivo |
| `credencial_recusada` | 401/403 — destaque na tela, a busca inteira para |
| `limite` | a Pacto avisou limite — a busca para **na hora**, não insiste |
| `parcial` | o resumo veio, mas algum contrato não pôde ser consultado; as linhas sem plano vão para `avisos` e **não contam como ativação** |

- A madrugada **rebusca os 3 dias anteriores**; rebuscar **substitui**.
- **O dia corrente nunca é buscado.**
- Uma unidade falhar não derruba a outra (exceto `credencial_recusada` e `limite`, que valem para a
  credencial inteira).
- Dia vermelho com mais de 3 dias só se refaz pelo botão; a tela lista quais são.

---

## Testes

| arquivo | prova |
|---|---|
| `scripts/smoke-pacto-api-linhas.js` | recibo simples · duas parcelas · avulsa com nome do produto · crédito em conta fora · vendinha sem recibo fora · estorno só nos totais · contrato migrado vira linha que o adapter reconhece como migrado · CP sem consultor · **nenhum CPF, nascimento ou telefone em nenhuma saída** · as cópias raiz × `functions/` dão o mesmo resultado |
| `scripts/smoke-pacto-sombra-ponta-a-ponta.js` | linhas convertidas → `PactoAdapter.traduzir` real → `CommissionEngine` real → contagem de ativações, **chamando as funções** |
| `scripts/smoke-pacto-sombra-busca.js` | com Pacto falsa e Firestore falso: `vazio_conferir`, `credencial_recusada` para tudo, `limite` para tudo, `falhou` guarda motivo, rebuscar substitui, caderninho evita consulta repetida, uma consulta por cliente |
| `scripts/smoke-pacto-sombra-comparacao.js` | as seis causas de divergência reconhecidas; CP não compara vendedora; totais e ativações dos dois lados |
| `scripts/smoke-pacto-sombra-tela.js` | carrega os arquivos da página como `<script>` num sandbox (a lição do `const` que não vira `window`) e **exercita** a comparação |

Todos com **dados inventados** — o repositório é público.

**Mutação:** quebrar uma regra por vez (CPF passa, crédito em conta entra, `vazio` vira `buscado`,
limite não para, rebusca soma) e confirmar que algum teste fica vermelho.

**Prova com agosto real, fora do git:** `scripts/conferir-sombra-agosto.js <pasta das respostas> <export>`
tem que reproduzir **PP 253/283, +84,66** e **CP 265/281, −96,14**. O script entra no repositório;
os dados, não.

**Homologação no staging:**
1. credencial no Secret Manager do staging (`firebase functions:secrets:set PACTO_API_KEY --project staging --data-file pacto-credencial.txt`) — **passo do Rafael**;
2. deploy separado de `firestore:rules` e das duas functions, **só staging**;
3. `buscarPactoSombraManual` de 01/08 até **ontem** (o dia corrente nunca é buscado, nem pelo botão);
4. `scripts/varrer-cpf-sombra.js --project staging` → **zero** CPF;
5. a tela com o export de agosto reproduz os números da prova;
6. a madrugada roda sozinha e nenhum dia fica vermelho sem motivo.

**Pronto é:** agosto reproduzido na tela, busca agendada rodando no staging, zero CPF no banco.
Depois disso, **as respostas de teste com CPF são apagadas do computador**.

---

## O que este desenho NÃO faz

- **não substitui o arquivo** nem grava em `periodos` — comissão e folha seguem pelo upload;
- **não vai para produção** — produção é outra conversa, depois da homologação;
- **não resolve o consultor do Campeche** nem o relatório de renovações das unidades (dependem do
  suporte da Pacto);
- **não decide** a base de comissão da parcela renegociada;
- **não mexe** em `index.html`, `commission.js`, `pacto-adapter.js`, `manifest.json` ou `sw.js`;
- não usa nenhuma operação da Pacto que grave.
