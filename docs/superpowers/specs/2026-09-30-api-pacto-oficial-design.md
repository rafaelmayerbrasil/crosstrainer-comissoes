# API da Pacto vira a fonte oficial das comissões — desenho

> 30/09/2026 · sessão 78 · decisão do Rafael: **"vamos tornar oficial e deixar a planilha como uma opção caso a API quebre e sempre em último caso"**.
> Base: modo sombra (`docs/superpowers/specs/2026-09-13-pacto-api-modo-sombra-design.md`), que busca a Pacto todo dia às 4h desde 22/09 em produção.

## 0. Decisões do Rafael (30/09)

| # | Decisão |
|---|---|
| 1 | **Opção A agora:** botão **"Atualizar pela Pacto"** na tela de Upload. Um clique puxa o mês até ontem, mostra a mesma prévia do arquivo e grava pelo mesmo caminho. |
| 2 | **Opção B depois**, em desenho próprio: recálculo sozinho no servidor, 100% automático. Só começa com a A rodando em produção. |
| 3 | **Parcela renegociada: vale o valor COBRADO** (o que a API traz), não o original da parcela (o que o arquivo mostrava). Coerente com o regime de caixa. |
| 4 | **A planilha vira plano B**: continua na mesma tela, recolhida, com o aviso "use só se a Pacto falhar". |

Autorização de mexer no `index.html`: implícita na decisão 1 (o botão mora na tela de Upload). `commission.js` **não muda**.

## 1. O que a sondagem de 30/09 estabeleceu

Todas as consultas feitas só com leitura, usando a credencial de cada unidade (a de 29/09, no cofre como `PACTO_API_KEY_CP` / `PACTO_API_KEY_PP`).

1. **A vendedora do Campeche existe na API.** `GET apigw/contratos/{codigo}` traz `nomeConsultorReponsavel` (consultora do contrato) e `responsavelLancamento` (quem lançou). Até hoje a busca diária só usava o núcleo, onde o CP vinha sem consultora, e por isso **a sombra nunca pôs vendedora no CP**.
   - **Conferido com o oficial de setembro (produção):** 25 contratos do CP e 25 do PP. Onde a API traz consultora, **50 de 50 batem** depois da regra que já está no ar: quando a consultora é o Rodrigo, a comissão vai para quem lançou. Um contrato do PP veio sem consultora; quem lançou bate com o arquivo.
   - A resposta traz o CPF da consultora: **só `nomeConsultorReponsavel` e `responsavelLancamento` saem da função**, nada mais é gravado.
   - Limite de 1 consulta por segundo: sem pausa, parte das respostas volta vazia (visto na 1ª rodada da amostra). Pausa de 1,2 s e repetir uma vez no 429.
2. **As vendas de balcão existem na API.** `GET apigw/importacao/psec/relFaturamentoRecebido/vendas?inicio=dd/MM&fim=dd/MM` (máx. 7 dias, sem ano) lista cada venda com produto, valor, data e hora, cliente e contrato. PP agosto: 350 vendas, 20 produtos (água, Monster, camiseta, taxa de renegociação…). Era a diferença que sobrava da sombra: −R$ 226,50 no PP e −R$ 420,50 no CP em agosto.
   - Não traz vendedora. A consultora do contrato (quando há) ou vazio.
   - Degustação grátis (R$ 0) **não aparece** nesse relatório.
3. **A degustação grátis continua sem fonte direta.** Caminho a validar: os contratos são numerados em sequência por unidade, e o `GET apigw/contratos/{codigo}` responde qualquer número. A busca diária olha os números novos desde o maior conhecido e acha o contrato de degustação com valor zero. Gabarito: LUIZ HENRIQUE APPEL, contrato 4638, PP, agosto.
4. `GET apigw/importacao/psec/relFaturamentoRecebido?inicio=MM/yyyy` com a credencial da unidade devolve o **total do mês** (CP set R$ 67.563,09 · PP R$ 60.931,15). Serve de conferência do total, não de linha.

## 2. As peças

```
 04h — buscarPactoSombra (já existe)                     tela de Upload (index.html)
┌────────────────────────────────────────┐           ┌─────────────────────────────────────┐
│ núcleo resumoPeriodo  (pagamentos)      │           │ [Atualizar pela Pacto]  ← novo      │
│ + gateway contratos/{n}  (consultora) ◄─┼ novo      │   lê pacto_sombra_dias do mês       │
│ + gateway vendas  (balcão)            ◄─┼ novo      │   confere a situação dos dias       │
│ + números novos de contrato (degust.) ◄─┼ novo      │   monta as linhas (mesmo formato)   │
│ → pacto_sombra_dias  (linhas prontas)   │──────────►│   → MESMO caminho do arquivo:        │
└────────────────────────────────────────┘           │     traduzir → prévia → confirmar    │
                                                      │ ▸ Usar planilha (só se a Pacto falhar)│
                                                      └─────────────────────────────────────┘
```

### 2.1 Vendedora pelo gateway — `functions/pacto-sombra.js` + `functions/pacto-renovacao-cliente.js`

- O cliente do gateway (hoje só para a Previsão de Renovação) ganha `contrato(codigo)` → `{ consultor, lancou, valor, plano }`, com a mesma pausa e a mesma regra de limite.
- Em `buscarDia`, todo contrato do caderninho (`pacto_contratos`) **sem consultora** é completado pelo gateway, uma vez só. O que o caderninho já tem não é consultado de novo.
- `pacto-api-linhas.js`: sai a exceção "no CP não pôr consultora". A regra passa a ser a mesma nas duas unidades.
- **Carga de agosto e setembro:** o botão manual (`buscarPactoSombraManual`) relê os dois meses e completa o caderninho. São cerca de 300 contratos em ~6 min, dentro do teto de 60 min.

### 2.2 Vendas de balcão — `functions/pacto-sombra.js` + `pacto-api-linhas.js`

- `buscarDia` pede o relatório de vendas **do próprio dia** (janela de 1 dia, dentro do limite de 7).
- Entra como linha só o que **não é contrato nem já está em `pagamentos`**: produto diferente de PLANO / MATRÍCULA / QUITAÇÃO / TAXA DE RENEGOCIAÇÃO, sem par de mesmo cliente + dia + valor. Duplicar é pior que faltar: o que ficar em dúvida vai para `avisos`.
- **Virada do ano:** o relatório não aceita ano. O dia buscado é sempre do ano corrente, exceto em janeiro, quando a madrugada relê dezembro. Nesse caso o relatório não é pedido e o dia fica com aviso.
- Gabarito: agosto do arquivo. O balcão da API tem que fechar os −R$ 226,50 (PP) e −R$ 420,50 (CP).

### 2.3 Degustação grátis — `functions/pacto-sombra.js`

- Cada unidade guarda o maior número de contrato já visto (`pacto_contratos_seq/{CP|PP}`). A madrugada consulta os números seguintes pelo gateway e para em 5 números vazios em sequência.
- Contrato com valor zero e plano de degustação vira um item em `degustacoes` no doc do dia, no **mesmo formato** que `PactoAdapter.degustacoesGratis` devolve hoje. O botão entrega isso ao mesmo `PactoAdapter.juntarDegustacoes`.
- **Se não validar** contra o 4638, a degustação continua pelo relatório de vendas (planilha), e a tela diz isso. Não bloqueia o resto.

### 2.4 O botão — `index.html` (tela de Upload)

- `handleFile` é dividido: a leitura do arquivo fica nele, e o resto (a partir de "é export da Pacto?") vira `processarLinhasPacto(json, { origem })`. O arquivo e o botão passam pelo **mesmo** código, então não nasce uma segunda conta.
- **"Atualizar pela Pacto"** (só admin):
  1. escolhe o mês (padrão: o corrente; até o dia 10, oferece também o anterior);
  2. lê `pacto_sombra_dias` da unidade e do mês e roda `PactoSombraTela.resumirDias` / `alertasDosDias`;
  3. **trava** se algum dia estiver `falhou`, `credencial_recusada`, `limite` ou `nao_buscado`: mostra os dias e oferece **"Buscar de novo agora"** (a função manual). A planilha só aparece como saída depois disso;
  4. dia `vazio_conferir` não trava, mas aparece na prévia;
  5. monta `PactoApiLinhas.comCabecalho(PactoApiLinhas.consolidarPorContrato(linhas))` (contar por contrato, como a comparação já faz) e chama `processarLinhasPacto`;
  6. a prévia diz de onde veio: **"Pacto (API) · dados até 29/09 · buscado hoje às 04:04"**.
- O upload grava `origem: 'api'` e `dadosAte` no registro do upload. O histórico mostra "API" ou "planilha".
- **A planilha:** a área de arrastar fica recolhida, sob **"▸ Usar planilha (só se a Pacto falhar)"**. Continua funcionando igual.
- Regras do Firestore: `pacto_sombra_dias` já é legível pelo admin. **Nada muda nas regras.**

### 2.5 Tela de comparação e termômetro

- `pacto-sombra-comparacao.js`: `compararVendedora` passa a valer também no CP.
- O termômetro não usa vendedora e não muda.

## 3. Validação antes de valer

1. **Script só de leitura em produção** (`scripts/comparar-api-oficial.js`): refaz **agosto e setembro** pela API, com consultora, balcão e degustação, e compara com o que está gravado em produção: por vendedora (ativações, R$ de comissão) e contrato a contrato. Cada diferença sai com a causa: dia, crédito em conta, parcela renegociada (a API vence, decisão 3), só na API, só no arquivo.
2. **Critério:** nenhuma diferença sem causa conhecida. A diferença em R$ por vendedora vai para o Rafael antes de qualquer coisa.
3. **Staging:** o Rafael clica "Atualizar pela Pacto" em setembro das duas unidades e confere a prévia.
4. **Produção**, com o OK dele. Depende das credenciais por unidade no cofre da produção, que vão junto com a entrega das renovações.

## 4. Quando algo dá errado

| Situação | O que acontece |
|---|---|
| Dia com falha / não buscado | Botão trava, lista os dias, oferece "Buscar de novo agora" |
| A busca de novo também falha | A tela diz para usar a planilha e mostra onde |
| Contrato sem consultora na Pacto | Linha sem vendedora, como hoje. A prévia lista os contratos |
| Balcão em dúvida | Fica fora e vai para `avisos`. A prévia mostra |
| Degustação não achada | A tela lembra que ela vem pelo relatório de vendas |

## 5. Testes

- `smoke-pacto-api-linhas` / `smoke-pacto-sombra`: consultora no CP, balcão sem duplicar, degustação pela sequência. Tudo com dados inventados.
- `smoke-upload-pela-api` (novo): recorta `processarLinhasPacto` e o botão do `index.html` e **chama** com um banco falso. Trava com dia vermelho, monta por contrato, grava `origem: 'api'`, e a planilha continua passando pelo mesmo caminho.
- Integridade do `index.html` (uma `</html>`, tamanho) e `smoke-modulos-no-browser`.
- Suíte inteira verde antes do staging.

## 6. Fora deste desenho

- **Opção B** (recálculo automático no servidor): desenho próprio depois.
- **Tela "A receber"** (vendido e não pago): continua pelo relatório de vendas. A varredura de números novos de contrato (2.3) pode alimentá-la depois, porque todo contrato novo passa por ali.
