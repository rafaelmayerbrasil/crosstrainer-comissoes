# Comissões — do regime de competência para o regime de caixa

**Data:** 31/08/2026 · **revisado 01/09/2026** com a resposta do Rodrigo
**Estado:** desenho aprovado pelo Rafael e pelo Rodrigo · a construir
**Substitui:** a seção "📐 A CONSTRUIR — competência e o corte do dia 15" de
`2026-08-19-tradutor-pacto-comissoes-design.md`, que **deixa de valer**.

---

## 1. A decisão

Sai a **competência** (a comissão pertence ao mês da venda), entra o **caixa** (a comissão
pertence ao mês em que o dinheiro entrou).

> Tudo que o cliente pagou de 1º a 30 de setembro vira a comissão paga em **15 de outubro**.

Entre as duas leituras possíveis de "caixa", o Rafael escolheu a **(A)**:

| | leitura | efeito |
|---|---|---|
| **(A) ✅ escolhida** | comissão **uma vez só por contrato**, no mês em que o **primeiro** pagamento entrou | mantém o custo atual |
| (B) recusada | 5% de **tudo** que entra, toda parcela, todo mês | **mais que triplicaria** a folha e pagaria vendedora por venda que ela não fez |

O Rodrigo confirmou (A) por outro caminho, e vale registrar a formulação dele porque é melhor que
a minha: **"identificar as ações de esforço individual das vendedoras que geraram caixa para a
empresa naquele mês"**. Recorrente, anual e bianual pagam **uma vez só**.

### 🔴 Marco zero: setembro/2026

**Decisão do Rodrigo em 01/09:** agosto é pago pelas **regras antigas**; a regra nova vale **a
partir de setembro**, anunciada ao time comercial como marco zero. Consequências em §4.9.

## 2. O que muda e o que não muda

| | antes (competência) | de setembro em diante (caixa) |
|---|---|---|
| a comissão pertence a | mês da **venda** | mês do **recebimento** |
| quantas vezes paga | uma vez, no 1º pagamento | **igual** — uma vez, no 1º pagamento |
| corte do dia 15 | dia do export, informal | **deixa de existir** |
| "acumula pro mês seguinte" | re-subindo o mês | **deixa de existir** — o dinheiro cai no mês em que entrou |
| ativação / meta | por data da venda | por data do recebimento (acompanha a comissão) |
| migrados do TecnoFit | fora | **fora** (inalterado) |
| renovação automática | não paga | **não paga** (inalterado) |
| estorno dentro de 30 dias | não havia tratamento | **abate da próxima comissão** (§4.7) |

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
era o dia em que a pessoa exportava o arquivo. A hipótese de um "período de transição de 45 dias
a pagar" **não se confirmou**.

### 3.2 🚨 A armadilha que estoura na virada, não em agosto

Hoje o que separa "venda do mês" de "dinheiro velho" no tradutor é uma regra só:

> contrato começou fora do mês **E** o plano vem marcado como `IMPORTAÇÃO`

Isso funciona **enquanto todo contrato antigo for migrado do TecnoFit**. O Rodrigo confirmou em
01/09 que **os importados seguem marcados como `IMPORTAÇÃO` até o aluno renovar** — então a rede
de segurança do legado continua valendo por bastante tempo, o que é uma boa notícia.

O problema é o outro lado: o contrato vendido **agora** na Pacto vem com o plano legível, e um
anual parcelado gera **um recebimento por mês, durante 12 meses**. A parcela do mês seguinte não
é reconhecida como dinheiro velho — o plano não é `IMPORTAÇÃO`. Pagaria comissão de novo. E no
mês seguinte. E no seguinte.

É a mesma armadilha dos **R$ 155 contra R$ 12,95** do relatório gêmeo, entrando pela porta dos
fundos: distribuída no tempo, crescendo a cada mês, **sem nenhum erro na tela**. É por isso que a
regra "uma vez só por contrato" precisa deixar de ser efeito colateral e virar regra escrita.

### 3.3 O mecanismo de pagar valor pendente já existe — e re-subir mês fechado não serve

O módulo já tem **recibo complementar** (`tipo: 'complementar'`, com banner próprio e referência
ao recibo original) e **crédito** (abate no próximo pagamento — que é exatamente o que o estorno
precisa, §4.7). O que falta é só a **porta de entrada**: hoje o botão "➕ Complementar" só aparece
quando o **valor calculado do período diverge do que foi pago**.

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
  e não é recorrente re-vendido na migração (§4.6)
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

- cada `periodos/{id}` ganha `codigosPagos` — os códigos `C*` dos itens `processed` daquele
  período, gravados no upload;
- antes de traduzir um mês novo, lê-se `codigosPagos` dos **períodos anteriores da unidade**
  (24 docs pequenos, não 20 mil itens);
- **existe um comando de reconstruir** o `codigosPagos` de um período varrendo os `itens` dele —
  se algum dia divergir, a fonte é o item, nunca o resumo.

Contrato cujo código já está na lista → **não paga**, e sai listado como "parcela seguinte" no
relatório de conferência, para a gestão ver que foi decisão e não sumiço.

**Duas camadas, com pesos diferentes:**

| camada | chave | efeito |
|---|---|---|
| contrato | código `C*` | **bloqueia** — é o mesmo contrato, é fato |
| cliente | nome do cliente | **sinaliza**, não bloqueia — vai para conferência (§4.6) |

A camada por cliente nunca bloqueia sozinha porque **renovação legítima é do mesmo cliente e deve
pagar**. Bloquear por cliente criaria o pior tipo de erro: vendedora deixando de receber, em
silêncio, sem ninguém para reclamar.

### 4.3 A estreia de setembro

Setembro é o primeiro mês sob a regra nova. A memória vai existir se — e só se — **agosto for
lançado no sistema pelo tradutor da Pacto**, mesmo sendo pago pela regra antiga. Sem isso,
setembro não sabe quem já pagou em agosto e paga tudo de novo.

> **Requisito duro:** agosto tem que entrar no sistema com códigos da Pacto, ainda que o
> pagamento siga a regra antiga. É a única forma de a virada não duplicar.

### 4.4 Pagar o que ficou pendente

Duas pontas que nenhum fechamento alcança:

| | valor | por quê |
|---|---:|---|
| 30 contratos de julho que receberam em agosto | R$ 599,35 | venda em julho (fechado) · dinheiro em agosto — e agosto ficou na regra antiga, então continuam fora |
| 14 vendas de 27–31/07 que o TecnoFit não capturou | R$ 508,12 | dinheiro entrou em julho, que está fechado e pago |
| **total** | **R$ 1.107,47** | |

⚠️ **A decisão de manter agosto na regra antiga devolveu os R$ 599,35 ao vão.** Sob a regra nova
eles entrariam sozinhos no caixa de agosto; sob a antiga, a venda é de julho e fica fora de novo.

**Mecanismo: complemento avulso.** Um botão **"➕ Complemento avulso"** na tela de Pagamentos
(Admin), abrindo o modal que já existe:

- escolhe a vendedora e o período de referência;
- valor e **motivo obrigatório**;
- gera **recibo complementar** numerado, referenciando o recibo original;
- entra no `audit_log` como `pagamento_ajuste`;
- **não toca no período fechado** — nada é recalculado, nada é apagado.

Para a transição, o tradutor gera a **lista de apoio**: por vendedora, quais vendas ficaram de
fora e quanto cada uma vale, para a gestão conferir antes de digitar o total. É conferência, não
automação — o valor é sempre digitado e assinado por alguém.

### 4.5 Conferência: o que foi vendido × o que entrou

Três fontes, com papéis distintos:

| fonte | o que é | papel |
|---|---|---|
| `faturamento-recebido` | o que **entrou** | **paga** |
| Faturamento por Período | o que foi **vendido** | confere |
| lista das vendedoras | o que elas **acham** que venderam | confere |

**Relatório de conferência do mês**, três colunas: *vendido no mês* · *recebido no mês* ·
*diferença explicada* (vendeu e ainda não recebeu / recebeu de venda anterior / parcela seguinte
não comissionável).

**A vendedora precisa da própria versão disso** — pedido do Rodrigo em 01/09, e é o antídoto do
atrito que a mudança cria. Uma tela simples, para ela:

> **"Vendi, aguardando pagamento"** — contratos que ela fechou e que ainda não têm pagamento
> identificado, com data da venda, valor e quanto vale de comissão quando entrar.

Sem isso, a vendedora vê a comissão menor do que a lista dela e conclui que o sistema errou. Com
isso, ela vê onde está o dinheiro dela e quando deve cair. **É a peça que faz a mudança de regime
ser aceita, não só correta.**

### 4.6 🚨 Recorrentes re-vendidos na migração — a categoria nova

**O que o Rodrigo contou em 01/09:** os planos **RECORRENTE** tiveram que ser **re-vendidos** na
Pacto, porque a renovação automática mês a mês exige configuração no próprio sistema. É uma venda
nova, com contrato novo e plano legível — **mas a comissão daquele aluno já foi paga antes**, no
TecnoFit.

Essa categoria **escapa das duas defesas existentes**: não é `IMPORTAÇÃO` (o plano é legível) e
não tem código conhecido (o contrato é novo). Ela pagaria de novo.

**Dimensão medida** no export de meio mês de agosto:

| unidade | linhas RECORRENTE | classificadas "Renovação" |
|---|---:|---:|
| CP | 8 · R$ 4.937 | 3 |
| PP | 1 · R$ 129 | 1 |

São **unidades por mês, não dezenas**. Isso decide a solução.

**Não há sinal 100% confiável no arquivo** para separar "re-venda técnica" de "renovação
legítima": as duas têm cliente antigo, contrato novo e plano legível. A diferença é se o contrato
anterior ainda estava vigente — informação que o export não traz.

**Por isso: conferência assistida, não heurística.** O sistema lista os candidatos (recorrente +
cliente que já pagou comissão antes) e a gestão responde uma vez por contrato: *já pagou?* A
resposta entra na memória e nunca mais é perguntada. Com 4 linhas por mês, isso custa menos de um
minuto e não corre o risco de errar calado.

⚠️ **Um caso concreto já apareceu:** PEDRO HENRIQUE SCHONARTH está na lista da Erica como **novo**
e no arquivo da Pacto como **Renovação**. Divergências assim são exatamente onde essa categoria
mora — mais uma razão para a conferência existir.

### 4.7 Estornos — os 30 dias de garantia

**Política do Rodrigo:** aluno que fecha plano longo tem **30 dias** para testar; se pedir
cancelamento e reembolso, **a comissão paga sobre o primeiro pagamento é abatida da próxima
comissão da vendedora**.

O mecanismo já existe inteiro: `creditos` com `status: 'pendente'`, aplicado automaticamente no
próximo pagamento e impresso no recibo como *"(-) Crédito de períodos anteriores"*. O que falta é
a **origem**: registrar o crédito quando o estorno for identificado.

- **Detecção:** o export já traz quitação de cancelamento; a gestão confirma na conferência.
- **Valor:** a comissão efetivamente paga por aquele contrato — o sistema sabe, porque o item
  está no período com `p1valor` e `p2bonus`.
- **Registro:** crédito na vendedora, com o contrato e o motivo, referenciando o recibo de origem.
- ⚠️ **Contrato estornado precisa sair da memória** (§4.2) — se o aluno voltar depois, é venda
  nova e paga de novo.

O Rodrigo diz que é raro. Raro e caro é exatamente o que o sistema deve tratar, porque ninguém
lembra do procedimento quando acontece uma vez por semestre.

### 4.8 Meta fictícia de agosto

Agosto ficou sem meta por causa da migração, e o sistema caiu no padrão da unidade — foi por isso
que o P3 do Príncipe apareceu zerado. O Rodrigo quer **definir uma meta retroativa** e medir se as
vendedoras bateram META / SUPER META / GOLD.

Não precisa de código: a tela **"Configurar Metas do Mês"** grava `metasMensais` no período. O que
precisa é do número, e ele deve sair do histórico, não do padrão:

| unidade | jun | jul | meta jun | meta jul |
|---|---:|---:|---:|---:|
| Campeche | 58 | 40 | 55 | 50 |
| Príncipe | 35 | 49 | 32 | 45 |

**Sempre olhar `metasMensais` do período, nunca só `units/{id}.config`** — a lição de
`metas-sao-definidas-por-mes`.

### 4.9 A comparação antigo × novo, para o time comercial

O Rodrigo pediu: pagar agosto pela regra antiga **e** mostrar a diferença entre os dois modos,
para apresentar ao time.

**Isto é análise, não produto.** Sai por script, sobre o export de agosto fechado, e produz:

- total por vendedora nos dois regimes, com a diferença em reais e em ativações;
- a lista de quem ganha e quem perde na virada, **com o motivo de cada caso** (vendeu em agosto e
  o dinheiro entra em setembro; recebeu em agosto de venda de julho; parcela seguinte);
- o efeito sobre meta e P3.

Construir a competência **dentro do sistema** só para agosto seria trabalho para jogar fora — a
regra que fica é a de caixa. A comparação sai de fora e é entregue como documento.

**Gabarito:** o Rodrigo vai gerar o relatório de vendas de agosto no modo antigo e enviar. Ele é
a terceira fonte, junto com a lista da Erica e o export da Pacto.

## 5. Casos de borda

| caso | resposta |
|---|---|
| vendeu 28/09, contrato começa 01/10, dinheiro entrou em setembro | paga em **setembro** — é o mês do recebimento; a data de início não decide mais nada |
| anual parcelado 12× | paga só na 1ª parcela; as outras 11 aparecem na conferência como "parcela seguinte" |
| cliente compra 2 aulas avulsas no mesmo mês | paga as duas — a regra "uma vez só" não alcança avulso (§4.1) |
| recorrente re-vendido na migração | conferência assistida (§4.6) |
| estorno dentro de 30 dias | crédito na vendedora + contrato sai da memória (§4.7) |
| aluno estornado volta meses depois | é venda nova, paga de novo |
| contrato cancelado e quitado | não paga — filtro já existente |
| renovação automática | não paga — filtro já existente |
| contrato migrado do TecnoFit | não paga — segue marcado como `IMPORTAÇÃO` até renovar |
| mesmo contrato aparece 2× no mesmo export | o tradutor já resolve com o sufixo `-2`; conta uma vez |
| export tirado com o filtro errado | recusado — `detectarRelatorio()` já barra o relatório gêmeo |

## 6. Testes que precisam existir

A parte mais perigosa é a memória: **errar para o lado do "já pagou" faz vendedora não receber,
em silêncio**. É um falso negativo mudo, o pior tipo — ninguém reclama do que não vê.

1. anual parcelado: paga no 1º recebimento, **não paga** no 2º, 3º … 12º;
2. avulso repetido do mesmo cliente em meses diferentes: **paga as duas vezes**;
3. avulso repetido no mesmo mês: paga as duas vezes;
4. contrato com recebimento em agosto **e** em setembro: paga **zero** em setembro;
5. migrado do TecnoFit com plano legível: **não paga**;
6. recorrente re-vendido: **sinaliza para conferência, não bloqueia sozinho**;
7. renovação legítima do mesmo cliente: **paga** (o teste que impede o falso negativo);
8. estorno: gera crédito no valor pago e **tira o contrato da memória**;
9. `codigosPagos` reconstruído a partir dos itens **bate** com o gravado no upload;
10. rodar o mesmo mês duas vezes dá o mesmo resultado (idempotência).

Os casos 1, 5 e 6 são os que a implementação de hoje erra. Eles vêm primeiro. O caso 7 é o par do
6 e não pode ser esquecido: é ele que impede a solução de virar um problema pior que o original.

## 7. Riscos

| risco | mitigação |
|---|---|
| vendedora deixa de receber por falso "já pagou" | camada por cliente **sinaliza, não bloqueia** (§4.2); conferência lista tudo com o motivo |
| virada agosto→setembro duplicar | agosto lançado no sistema com códigos da Pacto (§4.3) |
| os R$ 1.107,47 pendentes serem esquecidos | complemento avulso com lista de apoio (§4.4) |
| `codigosPagos` divergir dos itens | comando de reconstrução a partir da fonte |
| vendedora achar que o sistema errou | tela "vendi, aguardando pagamento" (§4.5) |
| export tirado errado / meio mês | procedimento fixo: `faturamento-recebido`, dia 1 ao último dia |

## 8. Fora de escopo

Integração com a API da Pacto · painel do Rodrigo · cálculo contínuo no meio do mês · reforma do
`index.html` · reabertura de julho.

### Multi-tenancy — avaliado, e a recomendação é **não agora**

A proposta que chegou: acrescentar uma camada de *cliente/academia* acima de *unidade*, com o
argumento de que custa pouco agora e é caríssimo depois.

**O argumento é verdadeiro em geral e não se aplica bem aqui, por três razões medidas:**

1. **O custo hoje não é pequeno.** São **31 coleções na raiz** e a lógica de Comissões vive dentro
   de um `index.html` de 10.829 linhas **em produção e em uso diário** — que a regra 1 do
   `CLAUDE.md` manda não tocar sem necessidade. Somam-se as Security Rules inteiras, que já
   quebraram uma vez em produção por um deploy amplo.
2. **O custo depois não é caríssimo.** As 31 coleções são **planas**, com `unitId` como *campo*, e
   não como parte do caminho. Acrescentar `tenantId` depois é backfill de campo + filtro nas
   queries + rules — trabalhoso, mas nada perto da reestruturação que o argumento pressupõe. O
   cenário caro é o de paths hierárquicos, que não é o nosso.
3. **A decisão estratégica que manda nessa ainda está aberta.** Se o rumo for unificar com o CRM
   do Rodrigo em Postgres/Supabase, investir em multi-tenancy no Firebase agora é trabalho para
   jogar fora. Essa pergunta é o item A das pendências com ele, sem resposta.

**O que fazer no lugar, que custa quase nada e preserva a opção:** nunca escrever regra de negócio
que dependa do **id** da unidade. Isso já foi violado uma vez e custou dois bugs em agosto — o id
`unit-cp` no staging contra `cp` em produção contra `(CP)` no arquivo. Cada vez que o id vaza para
a lógica, o dia do tenant fica mais caro. Essa disciplina é a preparação real; a camada em si
espera a decisão de rumo.

## 9. Pendências

| # | o quê | com quem | estado |
|---|---|---|---|
| 1 | **export de agosto fechado** (01→31/08, as duas unidades) | Rafael | 01/09 |
| 2 | **relatório de vendas de agosto no modo antigo** — gabarito da comparação | Rodrigo | prometido |
| 3 | **meta fictícia de agosto** do CP e do PP (§4.8) | Rodrigo | a definir |
| 4 | os **R$ 1.107,47** pendentes: pagar por complemento em 15/09? | Rodrigo | a decidir |
| 5 | avisar gestão e vendedoras | Rafael | ✅ feito |
| 6 | destino do sistema (um só? em qual base?) — manda no multi-tenancy | Rodrigo | aberto desde 19/08 |

**Nada disso vai a produção sem homologação em staging** (regra 7 do `CLAUDE.md`).
