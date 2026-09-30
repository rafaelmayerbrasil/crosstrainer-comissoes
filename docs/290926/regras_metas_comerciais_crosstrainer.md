# Regras para Projeção Mensal de Metas Comerciais — CrossTainer

Este documento organiza o racional para cálculo mensal de **Meta**, **Supermeta** e **Meta Gold** das unidades **CrossTainer CP** e **CrossTainer PP**.

O objetivo é permitir que uma inteligência artificial, via API/sistema, consiga sugerir metas mensais considerando o desempenho histórico, o volume de renovações, vouchers, novos/retornos, antecipações e contexto operacional de cada unidade.

---

## 1. Conceito principal

As metas mensais não devem ser calculadas apenas olhando o número do mês anterior.

Elas devem considerar:

1. Ativações realizadas nos últimos meses;
2. Mesmo mês do ano anterior;
3. Quantidade de renovações vencendo no mês;
4. Renovações antecipáveis do mês seguinte;
5. Vouchers/Mês Degustação ativos;
6. Capacidade real do time comercial;
7. Mudanças de equipe;
8. Sazonalidade e clima;
9. Momento da unidade: crescimento, transição ou recuperação.

A meta precisa ser **desafiadora, mas alcançável**.

- Se for alta demais, desmotiva.
- Se for baixa demais, acomoda.

---

## 2. Definição de ativação válida

Contar como **ativação válida**:

- Novo aluno;
- Ex-aluno/retorno;
- Renovação;
- Voucher/Mês Degustação ativado;
- Plano mensal, recorrente, anual ou bianual vendido com pagamento confirmado;
- Contrato com início em até 30 dias.

Não contar:

- Rescisão contratual;
- Grupo de corrida;
- Produtos dentários;
- Venda zerada;
- Estorno/cancelamento;
- Aula avulsa/pacote por sessão, salvo se for definido explicitamente que entra na meta.

Vendas feitas por Rodrigo, Rafael ou outro sócio **contam para meta da unidade**, mas **não contam para comissão nem para rateio individual**.

---

## 3. Estrutura da meta

Cada unidade deve ter três faixas:

| Faixa | Lógica |
|---|---|
| **Meta** | Objetivo principal do mês |
| **Supermeta** | Aproximadamente 15% acima da Meta |
| **Meta Gold** | Aproximadamente 30% acima da Meta |

Regra base:

```text
Supermeta = Meta × 1,15
Meta Gold = Meta × 1,30
```

Depois arredondar para um número comercialmente simples.

Exemplo:

```text
Meta 50
Supermeta 57 ou 58
Gold 65
```

O arredondamento pode ser ajustado conforme contexto:

- Mês difícil/transição: arredondar levemente para baixo;
- Mês forte/time completo: arredondar para cima.

---

## 4. Como definir a Meta base de ativações

A IA deve calcular uma sugestão inicial usando os critérios abaixo.

### 4.1 Histórico recente

Avaliar:

- Ativações do mês anterior;
- Média dos últimos 2 ou 3 meses;
- Mesmo mês do ano anterior.

Atenção: o ano anterior tem peso menor, porque:

- O sistema de metas era diferente;
- A estrutura comercial era diferente;
- Muitas vezes havia apenas uma vendedora por unidade.

Sugestão de peso:

```text
50% desempenho do mês anterior
25% média dos últimos 2 ou 3 meses
15% mesmo mês do ano anterior
10% ajuste manual/contextual
```

### 4.2 Ajuste por equipe

Reduzir ou segurar meta se houver:

- Vendedora nova em ramp-up;
- Troca recente de equipe;
- Vendedora sobrecarregada;
- Férias;
- Uma pessoa do time focada em outra tarefa, como migração de sistema.

Aumentar levemente se houver:

- Duas vendedoras bem estruturadas;
- Supervisão mais próxima;
- Equipe estável;
- Mês anterior com bom resultado sustentável.

### 4.3 Ajuste por sazonalidade/clima

Como a CrossTainer é ao ar livre, considerar:

- Frio;
- Chuva;
- Semanas de mau tempo;
- Feriados;
- Baixa circulação;
- Férias escolares.

Regra prática:

```text
Se o mês tende a ser mais frio/chuvoso ou historicamente fraco:
reduzir Meta em 5% a 10%.

Se o mês tem clima bom, sol, maior movimento ou campanha:
manter ou aumentar 5%.
```

---

## 5. Componentes da meta

Cada meta deve ser quebrada em três pilares:

1. **Novos/Retornos**;
2. **Renovações**;
3. **Vouchers/Mês Degustação**.

Esses pilares são as “travas mínimas” ou “critérios mínimos” para liberar o bônus de meta.

Importante: os pilares **não precisam somar exatamente o total da meta**. O restante pode vir de qualquer origem válida.

---

## 6. Regra para renovações

A IA deve separar:

### 6.1 Renovações base do mês

São contratos que vencem dentro do mês analisado.

Exemplo:

```text
Renovações vencendo em julho = 20
```

Remover duplicidades, especialmente quando o mesmo aluno aparece duas vezes.

Também revisar se há contratos que não devem contar, como:

- Pacote de aulas;
- Avulso;
- Venda por sessão.

### 6.2 Antecipações

São renovações que vencem no começo do mês seguinte, normalmente até dia 15.

As antecipações **não devem entrar na Meta base** como obrigação.

Elas entram como oportunidade para Supermeta e Gold.

### 6.3 Percentuais de renovação

Usar como regra:

| Faixa | % sobre renovações do mês |
|---|---:|
| **Meta** | 65% |
| **Supermeta** | 70% |
| **Gold** | 75% |

Fórmula:

```text
Renovações Meta = ceil(renovações_base × 0,65)
Renovações Super = ceil(renovações_base × 0,70)
Renovações Gold = ceil(renovações_base × 0,75)
```

Se o mês estiver muito difícil, pode suavizar a Gold para algo próximo de 72% a 74%.

Se a base de renovações for muito pequena, evitar travas impossíveis.

---

## 7. Regra para antecipações

As antecipações são usadas como qualificador de Supermeta e Gold.

Regra sugerida:

```text
Antecipações Super = aproximadamente 25% da base antecipável
Antecipações Gold = aproximadamente 45% da base antecipável
```

Exemplo:

```text
14 antecipações possíveis
Super: 3 ou 4
Gold: 6
```

A Meta normalmente não exige antecipação.

---

## 8. Regra para novos/retornos

Novos/retornos são o motor de crescimento.

A trava mínima deve ficar normalmente entre **35% e 45% da meta total**, ajustando conforme:

- Força da unidade;
- Histórico recente;
- Quantidade de renovações disponíveis;
- Capacidade do time;
- Clima;
- Campanha ativa.

Regra prática:

```text
Novos Meta = 35% a 40% da Meta total
Novos Super = 38% a 42% da Supermeta
Novos Gold = 40% a 45% da Gold
```

Exemplo para unidade forte:

```text
Meta 50 → mínimo 18 a 22 novos/retornos
Super 57 → mínimo 22 a 26
Gold 65 → mínimo 26 a 30
```

Se a unidade estiver em transição ou com vendedora nova, usar a parte mais baixa da faixa.

---

## 9. Regra para vouchers/Mês Degustação

Há duas coisas diferentes:

### 9.1 Voucher ativado

Conta como pilar da meta de ativações.

É o “Mês Degustação” vendido/ativado.

### 9.2 Voucher convertido

É quando o aluno do Mês Degustação vira plano cheio:

- Recorrente;
- Anual;
- Bianual.

A conversão de voucher deve ter bonificação própria, separada da meta principal.

### 9.3 Trava de voucher ativado

A meta de voucher ativado depende da quantidade de vouchers disponíveis no mês.

Regra padrão:

```text
Voucher Meta = 35% a 50% da base de vouchers
Voucher Super = 45% a 60%
Voucher Gold = 60% a 80%
```

Mas ajustar pelo andamento do mês.

Exemplo:

Se a lista tem 10 vouchers:

- Meta: 4 a 6;
- Super: 5 a 7;
- Gold: 6 a 8.

Se a lista tem poucos vouchers, exemplo 3 ou 4:

- Meta: 2;
- Super: 2 ou 3;
- Gold: todos os vouchers.

Nunca colocar meta de voucher maior do que a quantidade real disponível.

### 9.4 Conversão de voucher

A conversão é acompanhada em paralelo.

Regra:

```text
Conversão Meta = 30% dos vouchers ativos
Conversão Super = 40%
Conversão Gold = 50%
```

Exemplo:

```text
10 vouchers em funil
Meta conversão = 3
Super = 4
Gold = 5
```

Cada conversão gera bônus extra, além da comissão normal e do bônus do produto.

---

## 10. Regras para travas mínimas

Para a vendedora/unidade receber bônus de meta:

1. Precisa bater o total de ativações da faixa;
2. Precisa cumprir os critérios mínimos da faixa.

Regra de pagamento:

```text
Bateu total + cumpriu todas as travas = bônus integral
Bateu total + falhou 1 trava = 50% do bônus
Bateu total + falhou 2 ou mais travas = zera bônus
Não bateu total de ativações = sem bônus de meta
```

Exemplo:

```text
Meta = 50 ativações
Travas:
18 novos/retornos
13 renovações
6 vouchers

Se fez 50 ativações, mas só 11 renovações:
bateu total, falhou 1 trava → 50% do bônus.
```

---

## 11. Mínimos individuais

Não usar “meta individual” como meta principal.

Usar apenas **mínimo individual de ativações** para participar do rateio do bônus da unidade.

Esse mínimo deve considerar:

- Carga horária;
- Senioridade;
- Tempo de casa;
- Ramp-up;
- Se a pessoa está dedicada integralmente ao comercial.

Exemplo:

```text
Vendedora full-time: mínimo 18 ativações
Vendedora 30h/semana: mínimo 12 ativações
Vendedora em ramp-up: 40% a 70% do mínimo no primeiro mês
```

Se a vendedora não bate o mínimo individual:

- Recebe comissão normal;
- Não participa do bônus de meta.

---

## 12. Como tratar sócios e gestores

Se Rodrigo, Rafael ou outro sócio vender:

- A venda conta para a meta da unidade;
- A venda não gera comissão para o sócio;
- O sócio não entra no rateio do bônus;
- A venda não reduz o mínimo individual das vendedoras.

---

## 13. Ajuste no meio do mês

A IA pode recalcular projeção durante o mês, mas deve diferenciar:

### 13.1 Meta planejada

Meta definida no começo do mês.

### 13.2 Projeção de fechamento

Estimativa com base no realizado até a data.

Fórmula simples:

```text
projeção = ativações realizadas / dias corridos × dias totais do mês
```

Mas aplicar cuidado:

- Vendas não são lineares;
- Fechamento costuma acelerar no fim do mês;
- Renovações vencem em datas específicas;
- Campanhas podem mudar o ritmo.

Se até o dia 10 ou 15 a projeção estiver muito abaixo, não necessariamente deve reduzir a meta automaticamente.

Primeiro avaliar:

- Volume de renovações ainda abertas;
- Quantidade de leads quentes;
- Vouchers já ativados;
- Clima da semana;
- Capacidade da equipe.

---

## 14. Quando revisar meta para baixo

Pode revisar para baixo se houver combinação de fatores:

- Troca de vendedora;
- Vendedora nova em ramp-up;
- Mês historicamente fraco;
- Clima ruim;
- Baixa base de renovações;
- Projeção muito abaixo;
- Risco de desmotivação.

Mas a meta revisada não deve premiar acomodação.

Ela deve continuar exigindo reação.

Exemplo:

```text
Meta inicial: 55
Início do mês muito fraco + pouca renovação + vendedora nova
Meta revisada: 50
Super: 57
Gold: 65
```

---

## 15. Quando revisar meta para cima

Pode revisar para cima se:

- A unidade bateu meta cedo;
- Vouchers já ultrapassaram meta;
- Novos estão acima da projeção;
- Campanha performou muito bem;
- Equipe está completa e forte.

Exemplo:

```text
Voucher Meta inicial = 4
Até dia 9 já fez 5
Nova trava Meta pode virar 6
```

---

## 16. Output esperado da IA

A IA deve devolver para cada unidade:

### 16.1 Resumo da base

```text
Renovações base do mês:
Antecipações possíveis:
Vouchers disponíveis:
Resultado do mês anterior:
Mesmo mês ano anterior:
Situação da equipe:
```

### 16.2 Meta/Super/Gold

```text
Meta:
Supermeta:
Gold:
```

### 16.3 Travas por faixa

```text
Meta:
- Novos/retornos:
- Renovações:
- Vouchers:
- Antecipações: normalmente 0

Super:
- Novos/retornos:
- Renovações:
- Vouchers:
- Antecipações:

Gold:
- Novos/retornos:
- Renovações:
- Vouchers:
- Antecipações:
```

### 16.4 Conversão de voucher separada

```text
Conversão de voucher:
Meta:
Super:
Gold:
```

### 16.5 Mínimos individuais

```text
Vendedora A:
Vendedora B:
Observação de ramp-up:
```

---

## 17. Modelo de prompt para outra IA

```text
Você é responsável por sugerir metas comerciais mensais da CrossTainer para as unidades CP e PP.

Use as regras abaixo:

1. Calcule ativações válidas como: novos, retornos, renovações e vouchers/Mês Degustação com pagamento confirmado e início em até 30 dias.

2. Exclua: rescisão contratual, grupo de corrida, produtos dentários, vendas zeradas, estornos e pacotes avulsos/sessão, salvo orientação contrária.

3. Separe a base do mês:
- Renovações vencendo no mês;
- Antecipações até o dia 15 do mês seguinte;
- Vouchers/Mês Degustação disponíveis;
- Novos/retornos realizados nos meses anteriores.

4. Defina a Meta total de ativações considerando:
- desempenho do mês anterior;
- média dos últimos 2 ou 3 meses;
- mesmo mês do ano anterior com peso menor;
- quantidade de renovações disponíveis;
- força da equipe;
- mudanças de equipe;
- clima/sazonalidade.

5. Defina:
- Supermeta = aproximadamente Meta × 1,15;
- Gold = aproximadamente Meta × 1,30.

Ajuste o arredondamento conforme contexto:
- mês difícil/transição: arredondar para baixo;
- mês forte/time completo: arredondar para cima.

6. Calcule travas mínimas:

Renovações:
- Meta = 65% das renovações do mês;
- Super = 70%;
- Gold = 75%.

Novos/retornos:
- Meta = 35% a 40% da Meta total;
- Super = 38% a 42% da Super;
- Gold = 40% a 45% da Gold.

Vouchers ativados:
- Meta = 35% a 50% da base de vouchers;
- Super = 45% a 60%;
- Gold = 60% a 80%;
- nunca ultrapassar a quantidade real disponível.

Antecipações:
- não entram na Meta base;
- Super = cerca de 25% da base antecipável;
- Gold = cerca de 45% da base antecipável.

7. Conversão de voucher deve ser medida separadamente:
- Meta = 30% dos vouchers ativos;
- Super = 40%;
- Gold = 50%.

8. Regra de bônus:
- bateu total + todas as travas = bônus integral;
- bateu total + falhou 1 trava = 50%;
- bateu total + falhou 2 ou mais = zera;
- não bateu total = sem bônus de meta.

9. Vendas de sócios contam para a unidade, mas não geram comissão e não entram no rateio.

10. Não crie meta individual principal. Crie apenas mínimos individuais de elegibilidade para o bônus:
- full-time: aproximadamente 18 ativações;
- 30h/semana: aproximadamente 12 ativações;
- vendedora nova em ramp-up: 40% a 70% do mínimo no primeiro mês.

Entregue a resposta com:
- diagnóstico do mês anterior;
- base de renovações/vouchers;
- Meta/Super/Gold;
- travas de cada faixa;
- meta de conversão de vouchers;
- mínimos individuais;
- observações de risco.
```
