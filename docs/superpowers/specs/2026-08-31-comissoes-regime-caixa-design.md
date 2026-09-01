# Comissões — do regime de competência para o regime de caixa

**Data:** 31/08/2026
**Estado:** desenho aprovado pelo Rafael · a construir
**Substitui:** a seção "📐 A CONSTRUIR — competência e o corte do dia 15" de
`2026-08-19-tradutor-pacto-comissoes-design.md`, que **deixa de valer**.

---

## 1. A decisão

O Rodrigo autorizou trocar o regime das comissões. Sai a **competência** (a comissão pertence ao
mês da venda), entra o **caixa** (a comissão pertence ao mês em que o dinheiro entrou).

> Tudo que o cliente pagou de 1º a 31 de agosto vira a comissão paga em **15 de setembro**.

O Rafael escolheu, entre as duas leituras possíveis de "caixa", a **leitura (A)**:

| | leitura | efeito |
|---|---|---|
| **(A) ✅ escolhida** | comissão **uma vez só por contrato**, no mês em que o **primeiro** pagamento entrou | mantém o custo atual |
| (B) recusada | 5% de **tudo** que entra, toda parcela, todo mês | **mais que triplicaria** a folha e pagaria vendedora por venda que ela não fez |

Dimensão medida no export de agosto: o caixa aproveitado é **R$ 11.713 (CP) + R$ 5.310 (PP)**;
o caixa descartado por ser contrato antigo/migrado é **~R$ 78 mil**. A leitura (B) transformaria
esses R$ 78 mil em base de comissão.

## 2. O que muda e o que não muda

| | antes (competência) | agora (caixa) |
|---|---|---|
| a comissão pertence a | mês da **venda** | mês do **recebimento** |
| quantas vezes paga | uma vez, no 1º pagamento | **igual** — uma vez, no 1º pagamento |
| corte do dia 15 | dia do export, informal | **deixa de existir** |
| "acumula pro mês seguinte" | re-subindo o mês | **deixa de existir** — o dinheiro cai no mês em que entrou |
| ativação / meta | por data da venda | por data do recebimento (acompanha a comissão) |
| migrados do TecnoFit | fora | **fora** (inalterado) |
| renovação automática | não paga | **não paga** (inalterado) |

**A ativação não é uma escolha separada.** Sob (A) cada contrato aparece uma vez só, no mês em que
o dinheiro entrou; a ativação cai junto com a comissão por construção. Meta e pagamento passam a
contar exatamente a mesma coisa — o que na competência não era garantido.

## 3. Os três achados que sustentam o desenho

### 3.1 Não existe vão entre julho e agosto — verificado no banco de produção

| período | itens | datas encontradas |
|---|---:|---|
| `cp_2026-07` | 646 | **todas de julho · última 31/07** |
| `pp_2026-07` | 1.028 | **todas de julho · última 31/07** |
| `cp_2026-08` / `pp_2026-08` | — | **não existem** |

Julho pagou o dinheiro que entrou **até 31/07**. O "corte do dia 15" nunca foi filtro no código —
era o dia em que a pessoa exportava o arquivo. Logo:

- **agosto por caixa = 01/08 a 31/08** encaixa exatamente onde julho parou: sem buraco, sem
  pagar duas vezes;
- os **R$ 599,35** dos 30 contratos que começaram em julho e só receberam em agosto **entram
  sozinhos** no fechamento de agosto — a mudança de regime resolve essa pendência sem decisão
  extra.

A hipótese inicial de um "período de transição de 45 dias a pagar" **não se confirmou**. O que os
45 dias viraram foi outra coisa: uma **janela de leitura** (§4.3), não um período de pagamento.

### 3.2 🚨 A armadilha que estoura em setembro, não em agosto

Hoje o que separa "venda do mês" de "dinheiro velho" no tradutor é uma regra só:

> contrato começou fora do mês **E** o plano vem marcado como `IMPORTAÇÃO`

Isso funciona **enquanto todo contrato antigo for migrado do TecnoFit**. Em agosto é o caso.

Mas o contrato vendido agora na Pacto vem com o **plano legível**, e um anual parcelado gera **um
recebimento por mês, durante 12 meses**. A parcela de setembro da Julia Del Fabro (anual vendido
em 06/08) **não é reconhecida como dinheiro velho** — o plano dela não é `IMPORTAÇÃO`. Pagaria
comissão de novo. E em outubro. E em novembro.

É a mesma armadilha dos **R$ 155 contra R$ 12,95** do relatório gêmeo, entrando pela porta dos
fundos: distribuída no tempo, crescendo a cada mês, **sem nenhum erro na tela**.

**Agosto sai certo de qualquer forma. Setembro é o primeiro mês que morde.** É por isso que a
regra "uma vez só por contrato" precisa deixar de ser efeito colateral e virar regra escrita.

### 3.3 O mecanismo de pagar valor pendente já existe — e re-subir mês fechado não serve

O módulo já tem **recibo complementar** (`tipo: 'complementar'`, com banner próprio e referência
ao recibo original) e **crédito** (abate no próximo pagamento). O que falta é só a **porta de
entrada**: hoje o botão "➕ Complementar" só aparece quando o **valor calculado do período
diverge do que foi pago**.

E **re-subir um mês fechado não é caminho**: o upload apaga os itens que não vierem no arquivo
novo (`index.html` ~4873). Julho foi carregado com códigos do TecnoFit; um arquivo da Pacto traz
códigos diferentes, então o re-upload **apagaria os 646 itens** e reescreveria julho inteiro,
trazendo junto a divergência conhecida de −R$ 121,68. Para mês já pago, a via é o complemento.

## 4. O desenho

### 4.1 A regra do que paga

```
paga comissão quando:
  é o PRIMEIRO recebimento daquele contrato
  e não é contrato migrado do TecnoFit
  e não é quitação de cancelamento
  e não é renovação automática
```

O mês é sempre o do **recebimento** (`Data Lançamento`).

**⚠️ A regra "uma vez só" vale apenas para linha de CONTRATO.** O código gerado pelo tradutor é
`C<contrato>` para contrato e `A<matrícula>` para avulso — e **`A` é o número da matrícula do
cliente, não da venda**. Se a regra valesse para avulso, a segunda aula que a mesma pessoa
comprasse seria bloqueada em silêncio como "já pago". Avulso (aula, água, loja, avaliação) **paga
sempre**: cada compra é uma venda.

### 4.2 A memória de contratos comissionados

Para saber se é o primeiro recebimento, o sistema precisa lembrar quais contratos já pagaram.

**Derivada, não inventada.** A lição de `escala-contador-derivado` vale aqui inteira: número
guardado que ninguém recalcula vive errado — e aqui ele decide pagamento. Então:

- cada `periodos/{id}` ganha `codigosPagos: [C7078, C7112, …]` — os códigos `C*` dos itens
  `processed` daquele período, gravados no upload;
- antes de traduzir um mês novo, lê-se `codigosPagos` dos **períodos anteriores da unidade**
  (24 docs pequenos, não 20 mil itens);
- **existe um comando de reconstruir** o `codigosPagos` de um período varrendo os `itens` dele —
  se algum dia divergir, a fonte é o item, nunca o resumo.

Contrato cujo código já está na lista → **não paga**, e sai listado como "parcela seguinte" no
relatório de conferência, para a gestão ver que foi decisão e não sumiço.

### 4.3 A estreia: janela de leitura de 01/07 a 31/08

Na estreia a memória está vazia — nenhum código da Pacto foi lançado ainda (julho veio do
TecnoFit, com códigos que não batem). A saída é ler uma janela maior **uma única vez**:

| recebimento caiu em | o que acontece |
|---|---|
| julho | já foi pago no fechamento de julho → **ignora** |
| agosto, e é o 1º recebimento do contrato na janela | **paga em agosto** |
| agosto, mas o contrato já recebeu em julho | é parcela seguinte → **não paga** |

Isso mata a duplicidade sem depender de o plano vir marcado como `IMPORTAÇÃO`, e é o que faz os
R$ 599,35 entrarem certos. **De setembro em diante a janela volta a ser o mês**, e a memória anda
sozinha.

O filtro dos migrados continua ativo como rede de segurança do legado do TecnoFit.

### 4.4 Pagar o que ficou pendente

Duas coisas diferentes foram chamadas de "pendente" — e só uma precisa de mecanismo:

| | valor | como se resolve |
|---|---:|---|
| 30 contratos de julho que receberam em agosto | R$ 599,35 | **sozinho**, pelo caixa de agosto |
| 14 vendas de 27–31/07 que o TecnoFit não capturou | R$ 508,12 | **precisa de mecanismo** — o dinheiro entrou em julho, que está fechado e pago |

**Mecanismo: complemento avulso.** Um botão **"➕ Complemento avulso"** na tela de Pagamentos
(Admin), abrindo o modal que já existe:

- escolhe a vendedora e o período de referência;
- valor e **motivo obrigatório**;
- gera **recibo complementar** numerado, com o banner que já existe, referenciando o recibo
  original;
- entra no `audit_log` como `pagamento_ajuste`, igual ao complementar de hoje;
- **não toca no período fechado** — nada é recalculado, nada é apagado.

Para a transição, o tradutor gera a **lista de apoio**: por vendedora, quais vendas ficaram de
fora e quanto cada uma vale, para a gestão conferir antes de digitar o total. É conferência, não
automação — o valor é sempre digitado e assinado por alguém.

Serve daqui pra frente para qualquer caso de "apareceu depois que o mês fechou": estorno
reprocessado, lançamento retroativo, correção. Sob caixa esses casos ficam raros — a fonte passa
a ser uma só — mas não zeram.

### 4.5 Conferência: o que foi vendido × o que entrou

⚠️ **Isto precisa chegar à gestão e às vendedoras antes do primeiro pagamento.** A lista que a
Erica manda é por **ativação** (data da venda); o pagamento passa a ser por **caixa**. Elas
**nunca mais vão bater linha a linha** — a Beatriz Miranda e o Dieter, ativados em 31/08, podem
ter o dinheiro caindo em setembro. Isso é o desenho funcionando, não erro. Sem esse aviso, vira
discussão todo mês.

Três fontes, com papéis distintos:

| fonte | o que é | papel |
|---|---|---|
| `faturamento-recebido` | o que **entrou** | **paga** |
| Faturamento por Período | o que foi **vendido** | confere |
| lista das vendedoras | o que elas **acham** que venderam | confere |

**Relatório de conferência do mês**, três colunas: *vendido no mês* · *recebido no mês* ·
*diferença explicada* (vendeu e ainda não recebeu / recebeu de venda anterior / parcela seguinte
não comissionável). É o pedido do Rodrigo, e é o mesmo desenho quando a API entrar — muda o cano,
não a conta.

## 5. Casos de borda

| caso | resposta |
|---|---|
| vendeu 28/08, contrato começa 01/09, dinheiro entrou em agosto | paga em **agosto** — é o mês do recebimento; a data de início não decide mais nada |
| anual parcelado 12× | paga só na 1ª parcela; as outras 11 aparecem na conferência como "parcela seguinte" |
| cliente compra 2 aulas avulsas no mesmo mês | paga as duas — a regra "uma vez só" não alcança avulso (§4.1) |
| contrato cancelado e quitado | não paga — filtro já existente |
| renovação automática | não paga — filtro já existente |
| contrato migrado do TecnoFit | não paga — filtro já existente |
| mesmo contrato aparece 2× no mesmo export | o tradutor já resolve com o sufixo `-2`; conta uma vez |
| export tirado com o filtro errado | recusado — `detectarRelatorio()` já barra o relatório gêmeo |

## 6. Testes que precisam existir

A parte mais perigosa é a memória: **errar para o lado do "já pagou" faz vendedora não receber,
em silêncio**. É um falso negativo mudo, o pior tipo — ninguém reclama do que não vê.

1. anual parcelado: paga no 1º recebimento, **não paga** no 2º, 3º … 12º;
2. avulso repetido do mesmo cliente em meses diferentes: **paga as duas vezes**;
3. avulso repetido no mesmo mês: paga as duas vezes;
4. contrato de julho com 1º recebimento em agosto (os 30): **paga em agosto**;
5. contrato de julho com recebimento em julho **e** em agosto: paga **zero** em agosto;
6. migrado do TecnoFit com plano legível: **não paga** (o teste que a regra de hoje reprovaria);
7. `codigosPagos` reconstruído a partir dos itens **bate** com o gravado no upload;
8. rodar o mesmo mês duas vezes dá o mesmo resultado (idempotência) — a lição do re-upload.

Os casos 1 e 6 são os que a implementação de hoje erra. Eles vêm primeiro.

## 7. Riscos

| risco | mitigação |
|---|---|
| vendedora deixa de receber por falso "já pagou" | a conferência lista **toda** linha não paga com o motivo; nada some calado |
| `codigosPagos` divergir dos itens | comando de reconstrução a partir da fonte |
| gestão confundir a lista de ativações com o pagamento | §4.5 é aviso, não nota de rodapé |
| export tirado errado / meio mês | procedimento fixo: `faturamento-recebido`, dia 1 ao último dia |
| primeiro mês sem gabarito | conferência contra a lista da Erica antes de pagar |

## 8. Fora de escopo

Integração com a API da Pacto · painel do Rodrigo · cálculo contínuo no meio do mês · reforma do
`index.html` · reabertura de julho. Cada um ganha seu ciclo depois que este rodar.

## 9. Pendências

| # | o quê | com quem |
|---|---|---|
| 1 | **export de agosto fechado** (01→31/08, as duas unidades) — o que temos é de 13/08, meio mês | Rafael — **01/09** |
| 2 | **meta de agosto** do CP e do PP; sem ela o P3 do Príncipe sai zerado | Rodrigo |
| 3 | as **14 vendas de 27–31/07** (R$ 508,12): pagar por complemento avulso ou manter "não perseguir"? | Rodrigo |
| 4 | avisar gestão e vendedoras da §4.5 antes do pagamento de 15/09 | Rafael |

**Nada disso vai a produção sem homologação em staging** (regra 7 do `CLAUDE.md`).
