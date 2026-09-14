# Modo sombra da API da Pacto — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** buscar pela API da Pacto, todo dia, os pagamentos das duas unidades em staging, guardar sem dado pessoal sensível e comparar numa tela só do admin contra o export arrastado — sem tocar em comissão.

**Architecture:** um conversor puro transforma a resposta do `resumoPeriodo` em linhas no formato do export; o tradutor (`pacto-adapter.js`) e o motor (`commission.js`) existentes fazem o resto, sem alteração. Uma Cloud Function agendada busca e grava por unidade/dia; uma página própria lê, recebe o export e compara com um módulo puro.

**Tech Stack:** JS vanilla, Firebase Functions v2 (Node 22), Firestore, Secret Manager; testes em Node puro (`assert`), no padrão `scripts/smoke-*.js`.

**Desenho:** `docs/superpowers/specs/2026-09-13-pacto-api-modo-sombra-design.md` (ler antes).

**Regras que valem para todas as tarefas:**
- **Nada de dado real no git** (o repositório é público). Fixtures são inventadas. Os nomes de cliente dos testes são obviamente fictícios.
- **Não tocar** em `index.html`, `commission.js`, `pacto-adapter.js`, `manifest.json`, `sw.js`.
- **Só leitura na Pacto.** A única rota que o código conhece é `resumoPeriodo` e `consultarContratos`.
- Deploy **só staging**; `firestore:rules` separado das functions.
- Teste tem que **chamar a função**, nunca ler o texto do arquivo.
- Arquivos novos com **LF**; `.js` do repositório têm mistura — não recortar código por `indexOf('\n')` em teste.

---

## Mapa de arquivos

| arquivo | responsabilidade |
|---|---|
| `pacto-api-linhas.js` (novo, raiz) | conversor puro `montar({resumo, contratos, unidade, dia})` + `situacaoDoDia` + `limparContrato` |
| `functions/pacto-api-linhas.js` (novo) | cópia byte a byte da raiz |
| `functions/pacto-api-cliente.js` (novo) | HTTP injetável: `resumoDoDia`, `contratosDoCliente`, classificação de resposta, pausa |
| `functions/pacto-sombra.js` (novo) | `buscarDia`, `buscar`, `diasParaBuscar` — orquestra cliente + caderninho + conversor + gravação |
| `functions/index.js` (modificar, fim do arquivo) | `buscarPactoSombra` (agendada) e `buscarPactoSombraManual` (admin) |
| `firestore.rules` (modificar) | `pacto_sombra_dias` e `pacto_contratos`: leitura admin, escrita negada |
| `pacto-sombra-comparacao.js` (novo, raiz) | puro: `comparar({linhasApi, linhasArquivo, mes, unidade, config})` |
| `pacto-sombra.html` + `pacto-sombra.js` (novos) | a tela: login admin, grade de dias, resumo, arrasto, desenho da comparação |
| `scripts/smoke-pacto-api-linhas.js` | conversor + cópia gêmea + ausência de CPF |
| `scripts/smoke-pacto-sombra-ponta-a-ponta.js` | linhas → adapter real → motor real |
| `scripts/smoke-pacto-sombra-busca.js` | Pacto falsa + Firestore falso |
| `scripts/smoke-pacto-sombra-comparacao.js` | causas de divergência |
| `scripts/smoke-pacto-sombra-tela.js` | arquivos da página como `<script>` num sandbox |
| `scripts/conferir-sombra-agosto.js` | prova local com dados reais fora do git |
| `scripts/varrer-cpf-sombra.js` | varre o Firestore procurando CPF |
| `scripts/homologar-pacto-sombra.js` | chama a function manual no staging e resume os dias |

---

## Formato de entrada (resposta real, campos usados)

```
resumo.pagamentos[]: { codigo, data:'dd/MM/yyyy HH:mm:ss'|'dd/MM/yyyy', responsavelLancamento,
                       aluno:{codigo, nome, cpf, dataNascimento,...},
                       formas:[{formaPagamento, valor}],
                       parcelasPagas:[{codigo, codigoContrato|null, descricao, valor, valorJuro, valorMulta}] }
resumo.contratosLancados[]: { codigo, inicio, fim, duracao, consultor, aluno:{...} }   // vazio no CP
resumo.vendaAvulsa[]: { codigo, produto, totalFinal, consultor, vendaAvulsaParcela:[{codigo, situacao, valor}], aluno }
resumo.estornos[]: { codigoRecibo, pgtoEstornado }
resumo.estornosContrato[]: { codigoContrato, valorPagoEstornado }
consultarContratos.return[]: { codigo, situacaoContrato, nomePlano, codigoPlano, vigenciaDe,
                               vigenciaAteAjustada, numeroMeses }
```

Posições da linha (as de `PactoAdapter.COL`, array de 22, índice 0 vazio):
`matricula 1, nome 2, cadastro 3, resp1 4, resp2 5, produto 6, contrato 7, inicio 8, termino 9, duracao 10, modalidades 11, plano 12, situacao 13, lancamento 14, valor 15, forma 16, condicao 17, empresa 18, turma 19, categoria 20, consultor 21`.

---

### Task 1: conversor puro `pacto-api-linhas.js`

**Files:** Create `pacto-api-linhas.js`, `functions/pacto-api-linhas.js` (cópia) · Test `scripts/smoke-pacto-api-linhas.js`

Interface:
```js
const PactoApiLinhas = {
  COL,                                  // mesmas posições do PactoAdapter.COL
  EMPRESA: { CP: 'CROSSTAINER UNID. CAMPECHE (CP)', PP: 'CROSSTAINER UNID. PEQ PRÍNCIPE (PP)' },
  CAMPOS_PROIBIDOS: ['cpf','cpfResponsavel','dataNascimento','matriculaSesc','telefone','telCelular','email','rg'],
  valorBR(n) → '1.234,56',
  diaBR(data) → 'dd/MM/yyyy' (corta hora),
  limparContrato(c, unidade, consultor?) → { codigo, unidade, situacaoContrato, nomePlano, codigoPlano,
                                             vigenciaDe, vigenciaAte, numeroMeses, consultor }
  consultoresLancados(resumo) → Map codigo→consultor   // de contratosLancados
  montar({ resumo, contratos /*Map codigo→limparContrato*/, unidade, dia }) → { linhas, foraDeProposito, avisos, totais }
  situacaoDoDia({ erro, resumo, avisos }) → 'buscado'|'vazio_conferir'|'falhou'|'credencial_recusada'|'limite'|'parcial'
};
```

Regras de `montar`:
1. Para cada `pagamento`: se **todas** as formas forem `CREDITO CONTA CLIENTE` (normalizado, sem acento) → `foraDeProposito {motivo:'pago com crédito da conta do cliente — não é dinheiro novo', recibo, valor}` e pula.
2. Para cada `parcelaPaga`: `contrato = codigoContrato ? String : '0'`.
   - contrato ≠ '0': `c = contratos.get(contrato)`; se ausente → linha com plano/situação vazios + aviso `{motivo:'contrato sem dados na Pacto — não conta como ativação', contrato}`.
   - contrato = '0': produto = `vendaAvulsa` cuja `vendaAvulsaParcela[].codigo === parcela.codigo` → `.produto`; senão `parcela.descricao`.
   - `consultor`: `unidade==='CP' ? '' : (c && c.consultor) || ''`; se PP, contrato ≠ '0' e vazio → aviso `'sem consultora conhecida para o contrato'`.
   - Linha: `matricula=aluno.codigo, nome=aluno.nome, resp1=resp2=responsavelLancamento, produto=(contrato≠'0' ? c.nomePlano : produtoAvulsa), contrato, inicio=c.vigenciaDe, termino=c.vigenciaAte, duracao=String(c.numeroMeses||''), plano=c.nomePlano, situacao=c.situacaoContrato, lancamento=diaBR(pagamento.data), valor=valorBR(parcela.valor), forma=formas.join(' + '), empresa=EMPRESA[unidade], consultor`. Demais posições `''`.
3. Vendinhas sem recibo: `vendaAvulsa` cujas parcelas nenhuma aparece em `parcelasPagas` de algum pagamento **e** alguma com situação `PG` → soma em `totais.vendinhasSemRecibo` e um item em `foraDeProposito {motivo:'venda de balcão sem recibo — só informativo'}`.
4. `totais.estornos`, `totais.estornosContrato`: quantidade e soma (`pgtoEstornado`, `valorPagoEstornado`).
5. `totais.recebido` = soma das formas dos pagamentos que viraram linha; `pagamentos`, `parcelas` = contagens.
6. **Nenhum campo proibido é lido para a saída.**

`situacaoDoDia`: `erro.situacao` se houver erro · `resumo.pagamentos.length===0` → `vazio_conferir` · algum aviso `contrato sem dados` → `parcial` · senão `buscado`.

- [ ] **Step 1: escrever `scripts/smoke-pacto-api-linhas.js`** com um `resumo` inventado de um dia no PP contendo: recibo A (1 parcela de contrato 9001, PIX 239), recibo B (2 parcelas do contrato 9002, cartão, 199+199), recibo C (venda avulsa parcela 555 → produto `ÁGUA SEM GÁS` 5), recibo D (crédito conta 74,36), `vendaAvulsa` extra sem recibo (parcela 777 PG, 12), `contratosLancados` com 9001 consultor `CONSULTORA TESTE UM`, `estornos` 1×50, alunos com `cpf:'123.456.789-00'` e `dataNascimento`. Contratos: 9001 (Matrícula, `HIIT | ANUAL | LOCAL`, 12 meses), 9002 (Renovação), sem 9003. Casos:
  1. 4 linhas (A1, B2, C1); D em `foraDeProposito`; vendinha 777 em `foraDeProposito` e `totais.vendinhasSemRecibo = {qtd:1, valor:12}`.
  2. linha de A tem `situacao 'Matrícula'`, `plano`, `duracao '12'`, `valor '239,00'`, `lancamento` sem hora, `empresa` PP, `consultor 'CONSULTORA TESTE UM'`.
  3. linha de C: `contrato '0'`, `produto 'ÁGUA SEM GÁS'`.
  4. mesmo resumo com `unidade:'CP'` → toda linha com `consultor ''` e **nenhum** aviso de consultora.
  5. parcela de contrato 9003 ausente do caderninho → aviso e `situacaoDoDia` = `parcial`.
  6. `JSON.stringify(saida)` não contém `123.456.789-00`, nem a data de nascimento, nem as chaves `cpf`/`dataNascimento`.
  7. `situacaoDoDia` para `{resumo:{pagamentos:[]}}` = `vazio_conferir`; `{erro:{situacao:'limite'}}` = `limite`.
  8. `totais.recebido` = 239+398+5 = 642; estornos `{qtd:1, valor:50}`.
  9. `require('../functions/pacto-api-linhas.js').montar(args)` deepEqual raiz, e os dois arquivos têm conteúdo idêntico.
- [ ] **Step 2:** `node scripts/smoke-pacto-api-linhas.js` → falha (`Cannot find module`).
- [ ] **Step 3:** implementar `pacto-api-linhas.js` (objeto + `if (typeof module!=='undefined') module.exports=…` + `if (typeof window!=='undefined') window.PactoApiLinhas=…`), copiar para `functions/`.
- [ ] **Step 4:** rodar → 9/9.
- [ ] **Step 5:** commit `feat: conversor da API da Pacto para linhas do export`.

### Task 2: ponta a ponta com o adapter e o motor reais

**Files:** Test `scripts/smoke-pacto-sombra-ponta-a-ponta.js`

- [ ] **Step 1:** montar linhas com `PactoApiLinhas.montar` (resumo inventado PP, agosto, `CONSULTORA TESTE UM`): contrato novo anual (Matrícula, início no mês), renovação recorrente (`responsavelLancamento:'RECORRENCIA'`, forma `CARTÃO RECORRENTE`), contrato migrado (`nomePlano:'IMPORTAÇÃO'`, início 2025, 12 meses), água avulsa. Rodar `PactoAdapter.traduzir([cabecalho, ...linhas], {mes:'2026-08'})`; `CommissionEngine.calculate(CE.cleanRawData([PA.CABECALHO_SAIDA, ...PA.paraPlanilha(t.porUnidade.PP)]), CE.defaultConfig, {})`. Casos:
  1. `t.migrados.length === 1`;
  2. `t.avisos` tem a cobrança recorrente;
  3. soma de `isActivation` nos processados = 2 (novo + renovação);
  4. a água não é ativação;
  5. nenhuma vendedora fantasma (`RECORRENCIA`, `ADMINISTRADOR`) no `vendorData`.
  O cabeçalho de entrada é uma linha com `nome:'Nome Cliente'`.
- [ ] **Step 2:** rodar → passa (se falhar, a correção é no **conversor**, nunca no adapter).
- [ ] **Step 3:** commit `test: linhas da API atravessam o tradutor e o motor reais`.

### Task 3: cliente HTTP `functions/pacto-api-cliente.js`

Interface:
```js
criarCliente({ fetch, credencial, pausaMs = 2000, dormir = ms => new Promise(r=>setTimeout(r,ms)), base = 'https://app.pactosolucoes.com.br/api/prest' })
  → { resumoDoDia(chave, dia /*AAAA-MM-DD*/) → {situacao:'ok', dados} | {situacao, motivo},
      contratosDoCliente(chave, cliente) → {situacao:'ok', dados:[...]} | {situacao, motivo},
      chamadas /* contador */ }
classificar(status, texto) → {situacao, motivo?, dados?}
```
- `resumoDoDia`: `POST {base}/importacao/{chave}/resumoPeriodo?inicio=dd/MM/yyyy&fim=dd/MM/yyyy`, headers `Authorization`, `Content-Type: application/json`, body `'{}'`.
- `contratosDoCliente`: `POST {base}/cliente/{chave}/consultarContratos?cliente={n}&registros=50`, devolve `dados = json.return || []`.
- `classificar`: 401/403 → `credencial_recusada`; 429 ou texto com `/limite|too many/i` → `limite`; ≥500 ou `fetch` lançou → `falhou`; 200 com corpo não-JSON → `falhou` `'resposta não é JSON'`; 400/404 → `falhou` com status.
- Pausa **antes** de toda chamada exceto a primeira.
- `motivo` nunca contém a credencial (substituir por `<credencial>` se aparecer).

**Test:** entra em `scripts/smoke-pacto-sombra-busca.js` (Task 4), seção "cliente".

- [ ] **Step 1:** escrever os casos do cliente: URL e método certos; header `Authorization` presente; 401→`credencial_recusada`; 429→`limite`; 500→`falhou`; corpo HTML→`falhou`; `fetch` que lança→`falhou`; pausa chamada N−1 vezes (dormir falso); credencial ausente de `motivo` quando o corpo a ecoa.
- [ ] **Step 2:** rodar → falha.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar → passa.
- [ ] **Step 5:** commit `feat: cliente HTTP da API da Pacto com pausas e classificação`.

### Task 4: orquestração `functions/pacto-sombra.js`

Interface:
```js
PACTO_UNIDADES = { CP: 'c7b092b1fe873e29436873a01cdfe829', PP: '9d4721a873dd9fe621aeed5093b791f8' }
diasParaBuscar({ hoje /*AAAA-MM-DD em SP*/, de?, ate?, ultimos? }) → ['AAAA-MM-DD'...]   // nunca inclui hoje; máx 62
buscarDia({ db, cliente, unidade, dia, agora }) → { situacao, consultas }
buscar({ db, cliente, unidades = ['CP','PP'], dias, agora }) → { resultados:[{unidade,dia,situacao}], parouPor? }
```
`buscarDia`:
1. `r = cliente.resumoDoDia(chave, dia)`; erro → grava `{unidade, dia, situacao:r.situacao, motivo, buscadoEm}` e devolve.
2. `lancados = PactoApiLinhas.consultoresLancados(r.dados)`.
3. códigos de contrato das parcelas pagas; lê `pacto_contratos/{U}_{codigo}` para cada; os ausentes agrupados por `aluno.codigo`; para cada cliente, `contratosDoCliente`; grava **todos** os contratos retornados com `limparContrato(c, unidade, lancados.get(codigo) || null)`; contrato já no caderninho sem consultor e com consultor em `lancados` (PP) → atualiza consultor.
4. se uma consulta de contrato der `credencial_recusada`/`limite` → grava o dia com essa situação e propaga.
5. `m = PactoApiLinhas.montar(...)`; grava **com `set` (substitui)** `pacto_sombra_dias/{U}_{dia}` = `{unidade, dia, situacao: situacaoDoDia(...), linhas: JSON.stringify(m.linhas), foraDeProposito, avisos, totais, contratosConsultados, buscadoEm}`.

`buscar` para no primeiro `credencial_recusada`/`limite` e devolve `parouPor`.

**Test:** `scripts/smoke-pacto-sombra-busca.js` usando o Firestore falso de `scripts/smoke-fake-firestore.js` (conferir a API dele antes; se não servir, um `Map` com `collection(n).doc(id).get/set`).

- [ ] **Step 1:** casos: (1) dia com pagamentos grava `buscado` e `linhas` parseável; (2) resumo vazio → `vazio_conferir`; (3) 401 no resumo → `credencial_recusada` e `buscar` para sem chamar o segundo dia; (4) 429 → `limite` idem; (5) 500 → `falhou` com motivo, e **continua** para o próximo dia; (6) rebuscar o mesmo dia com menos pagamentos → documento tem só as novas linhas (substitui); (7) segundo dia com o mesmo contrato não chama `contratosDoCliente` de novo (caderninho); (8) dois contratos do mesmo cliente → **uma** chamada; (9) `diasParaBuscar({hoje:'2026-09-13', ultimos:3})` = `['2026-09-10','2026-09-11','2026-09-12']`; `{hoje:'2026-09-13', de:'2026-09-01', ate:'2026-09-20'}` termina em `2026-09-12`; intervalo de 70 dias lança erro; (10) nenhum documento gravado contém `cpf`.
- [ ] **Step 2:** rodar → falha.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar → passa.
- [ ] **Step 5:** commit `feat: busca diária do modo sombra com caderninho de contratos`.

### Task 5: Cloud Functions e regras

**Files:** Modify `functions/index.js` (acrescentar no fim), `firestore.rules`

```js
const { defineSecret } = require('firebase-functions/params');
const PACTO_API_KEY = defineSecret('PACTO_API_KEY');
const pactoSombra = require('./pacto-sombra.js');
const pactoCliente = require('./pacto-api-cliente.js');
function hojeSP() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }

exports.buscarPactoSombra = onSchedule({ schedule: '0 4 * * *', timeZone: 'America/Sao_Paulo',
  secrets: [PACTO_API_KEY], timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const cliente = pactoCliente.criarCliente({ fetch, credencial: PACTO_API_KEY.value() });
  const dias = pactoSombra.diasParaBuscar({ hoje: hojeSP(), ultimos: 3 });
  const r = await pactoSombra.buscar({ db: admin.firestore(), cliente, dias, agora: () => admin.firestore.FieldValue.serverTimestamp() });
  logger.info('pacto sombra', { dias, parouPor: r.parouPor || null, situacoes: r.resultados.map(x => x.unidade + ' ' + x.dia + ' ' + x.situacao) });
});

exports.buscarPactoSombraManual = onCall({ secrets: [PACTO_API_KEY], timeoutSeconds: 540, memory: '512MiB' }, async (req) => {
  // mesmo padrão de checagem de admin das outras onCall do arquivo (ler antes)
  ...
  const dias = pactoSombra.diasParaBuscar({ hoje: hojeSP(), de: req.data.de, ate: req.data.ate });
  ...
  return { dias: dias.length, parouPor: r.parouPor || null, resultados: r.resultados };
});
```
Regras:
```
match /pacto_sombra_dias/{id} { allow read: if isAdmin(); allow write: if false; }
match /pacto_contratos/{id}   { allow read: if isAdmin(); allow write: if false; }
```
- [ ] **Step 1:** ler a checagem de admin de `setPersonAccess` e reproduzi-la.
- [ ] **Step 2:** acrescentar as funções e as regras.
- [ ] **Step 3:** `node -e "require('./functions/index.js')"` a partir de `functions/` carrega sem erro; `node scripts/validate-rules-comissoes.js` continua passando.
- [ ] **Step 4:** commit `feat: functions agendada e manual do modo sombra + regras`.

### Task 6: comparação pura `pacto-sombra-comparacao.js`

Interface:
```js
PactoSombraComparacao.comparar({ linhasApi, linhasArquivo, mes, unidade, config, Adapter, Engine })
 → { api: lado, arquivo: lado, divergencias: [{dia, cliente, api, arquivo, diferenca, causa, contratos}],
     grupos, batem, compararVendedora: unidade !== 'CP' }
lado = { recebido, ativacoes: {total, novo, renovacao, retorno, voucher}, porVendedora: {nome: ativ} }
```
- `recebido` soma a coluna `valor` das linhas da unidade no mês (antes do adapter — é dinheiro, não comissão).
- Ativações: `Adapter.traduzir(linhas, {mes})` → `Engine.processRows(Engine.cleanRawData([Adapter.CABECALHO_SAIDA, ...Adapter.paraPlanilha(t.porUnidade[unidade]||[])]), config).processed`, contando `isActivation` e `category`.
- Grupos: chave `nome normalizado | dia`, soma de valor. Causa, na ordem: mesmo conjunto de contratos com soma zero no mês → `mesmo contrato em outro dia`; algum lado tem forma `CREDITO CONTA CLIENTE` → `crédito em conta`; contrato presente dos dois lados com valores diferentes → `parcela renegociada ou valor diferente`; só arquivo e contrato `0` → `vendinha de balcão`; só API → `só na API`; só arquivo → `só no arquivo`.
- `Adapter`/`Engine` injetados (no Node: `require`; no navegador: globais).

- [ ] **Step 1:** `scripts/smoke-pacto-sombra-comparacao.js` com linhas inventadas cobrindo as seis causas, os totais dos dois lados, ativações iguais quando a única diferença é matrícula separada, `compararVendedora` falso no CP.
- [ ] **Step 2:** falha → **Step 3:** implementar → **Step 4:** passa.
- [ ] **Step 5:** commit `feat: comparação API × export do modo sombra`.

### Task 7: prova com agosto real (fora do git)

**Files:** Create `scripts/conferir-sombra-agosto.js`

- Uso: `node scripts/conferir-sombra-agosto.js <pasta-respostas> "<export.xls>"`. Lê os `resumoPeriodo` de agosto (arquivo com a chave e `01_08_2026_fim_31_08`), monta um `Map` de contratos a partir das respostas `consultarContratos` salvas e, para os contratos sem resposta, um contrato mínimo `{situacaoContrato:'', nomePlano:''}` (a prova é de **dinheiro por cliente+dia**, não de plano); converte com `PactoApiLinhas.montar` (usando o resumo do mês inteiro como se fosse um dia — a função não depende de o período ser um dia); compara com `PactoSombraComparacao.comparar`.
- **Tem que imprimir** PP `grupos 283 · batem 253 · diferença +84,66` e CP `281 · 265 · −96,14`. Se não bater, a divergência é um defeito do conversor ou da comparação — investigar antes de seguir.
- ⚠️ A comparação de agosto na sessão usou o valor das **formas**; o conversor usa o valor das **parcelas**. Se a soma divergir, a diferença é juro/multa e tem que ser explicada no relatório do script, não escondida.

- [ ] **Step 1:** escrever o script.
- [ ] **Step 2:** rodar com `…/scratchpad/pacto/respostas` e `relatorios pacto/faturamento-recebido_01 a 310826.xls` → números acima.
- [ ] **Step 3:** commit `test: prova do modo sombra contra agosto real (dados fora do git)`.

### Task 8: a tela

**Files:** Create `pacto-sombra.html`, `pacto-sombra.js` · Test `scripts/smoke-pacto-sombra-tela.js`

- HTML: mesmo SDK Firebase compat que `professores.html` usa (copiar as tags e versões de lá), `vendor/xlsx.full.min.js`, `firebase-config.js`, `pacto-adapter.js`, `commission.js`, `pacto-api-linhas.js`, `pacto-sombra-comparacao.js`, `pacto-sombra.js`, todos com `?v=20260913`. Tema escuro com as variáveis CSS já usadas (`--bg`, `--border`, `--text`), sem variável inventada.
- `pacto-sombra.js`:
  - `window.PactoSombraTela = { iniciar, carregarMes, lerExport, desenharComparacao, desenharDias }`;
  - login: `firebase.auth().onAuthStateChanged`; perfil em `users/{uid}` com `profiles` contendo `admin` (conferir o campo real em `firestore.rules#hasP`); não admin → "Acesso restrito";
  - `carregarMes(unidade, 'AAAA-MM')`: lê `pacto_sombra_dias` com `where('unidade','==',u)` e filtra o mês pelo id; desenha a grade de dias com a situação (dias sem documento = "não buscado");
  - resumo da API: `comparar` com `linhasArquivo: []` para obter o lado API;
  - arrasto: `FileReader` → `XLSX.read(..., {type:'array', cellDates:false})` → `sheet_to_json({header:1, defval:''})` → recusa se `!PactoAdapter.ehExportPacto(json)` ou `detectarRelatorio(json) !== 'recebido'`;
  - desenha lado a lado + tabela de divergências; no CP, aviso "vendedora não comparada".
  - **Nenhuma** chamada `set`, `add`, `update`, `delete`, `httpsCallable`.
- Smoke: executa os arquivos na ordem do HTML num `vm` com `window`, confere que `PactoApiLinhas`, `PactoSombraComparacao`, `PactoSombraTela` existem **e** chama `PactoSombraComparacao.comparar` com linhas inventadas usando os globais do sandbox; confere que `pacto-sombra.js` não contém `.set(`, `.add(`, `.update(`, `.delete(`, `httpsCallable`.

- [ ] **Step 1:** smoke → falha. **Step 2:** implementar. **Step 3:** passa.
- [ ] **Step 4:** commit `feat: tela de conferência do modo sombra`.

### Task 9: mutação

- [ ] Para cada mutação, aplicar com `sed` num **arquivo temporário copiado** (nunca `git checkout` com trabalho vivo), rodar os smokes e confirmar vermelho, restaurar: (a) `cpf` copiado para a linha; (b) crédito em conta vira linha; (c) `vazio_conferir` vira `buscado`; (d) `buscar` não para no `limite`; (e) `set` com `merge:true`; (f) consultor do CP preenchido com `responsavelLancamento`; (g) cópia de `functions/` diferente da raiz. Qualquer mutação que sobreviva vira caso de teste novo.

### Task 10: staging

- [ ] **Step 1 (Rafael):** `firebase functions:secrets:set PACTO_API_KEY --project staging --data-file pacto-credencial.txt`.
- [ ] **Step 2:** `firebase deploy --only firestore:rules --project staging`.
- [ ] **Step 3:** `firebase deploy --only functions:buscarPactoSombra,functions:buscarPactoSombraManual --project staging`.
- [ ] **Step 4:** `scripts/homologar-pacto-sombra.js --project staging --de 2026-08-01 --ate <ontem>` (chama a callable com token de admin gerado pelo Admin SDK, no padrão dos homologadores existentes) e imprime a situação de cada dia.
- [ ] **Step 5:** `scripts/varrer-cpf-sombra.js --project staging` → 0.
- [ ] **Step 6:** `firebase deploy --only hosting --project staging`; abrir `pacto-sombra.html` no staging logado como admin; carregar agosto das duas unidades; arrastar o export de agosto; conferir os números da Task 7. Screenshot.
- [ ] **Step 7:** conferir no dia seguinte que `buscarPactoSombra` rodou às 04:00 (logs) e gravou os 3 dias.

### Task 11: fechamento

- [ ] suíte completa de smokes verde;
- [ ] `CONTEXTO_SESSAO.md` (ONDE PARAMOS + log), `CLAUDE.md` (estado em uma frase), memória;
- [ ] apagar `scratchpad/pacto/respostas` (tem CPF);
- [ ] commit final no branch; **sem merge no `main` e sem produção**.
