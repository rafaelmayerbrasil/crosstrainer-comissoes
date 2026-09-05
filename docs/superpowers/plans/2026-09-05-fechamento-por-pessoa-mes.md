# Fechamento por pessoa/mês — plano (05/09/2026)

## O problema

O fechamento é **por unidade** (`monthly_closings/{unitId}_{ano-mes}`). Quem dá
aula na CP e na PP entra nos dois, e o valor **mensal** — bolsa de estágio,
VR, VT, Outros e férias — sai inteiro em cada um. Só o excedente de hora do
estagiário está protegido (o movimento do banco de horas é por pessoa+mês).

Medido na produção em 05/09/2026, agosto: folha certa R$ 24.971,20 × soma dos
dois fechamentos R$ 32.552,04 → **R$ 7.580,84 a mais**, 8 pessoas.

**Nada foi pago errado ainda: nenhum mês jamais foi fechado.** Zero migração.

## A decisão (Rafael, 05/09/2026)

Opção **(b)**: o fechamento passa a ser **por pessoa/mês**, com as unidades
somadas. Um documento por mês para a academia inteira.

## Desenho

- `monthly_closings/{ano-mes}` (ex.: `2026-08`), `unitIds: [...]`.
- `teachers[]`: **uma entrada por pessoa**, com `porUnidade[{unitId, unitName,
  classesCount, horas}]` — o custo por unidade continua visível, mas o
  pagamento é um só.
- `closeMonth({ year, month })` — sem `unitId`.
- A conta sai de um módulo **puro e único**, `closing-payroll.js` (gêmeo em
  `functions/`), usado pela Cloud Function **e** pela prévia da tela. Hoje essa
  conta existe duas vezes, copiada — foi aí que a duplicação passou.

## Passos

1. `closing-payroll.js` puro + gêmeo em `functions/` + smoke que compara os dois.
2. `professores-shared.js` e `functions/index.js` passam a delegar (nomes antigos
   viram fachada, pra não quebrar quem já chama).
3. `ClosingService`: `getClosingId(ano, mes)`, `preview(ano, mes)`, `list()`.
4. CF `closeMonth`: query do mês inteiro, sem filtro de unidade; férias idem.
5. Tela de Fechamento: unidade vira **lente de leitura**, não escopo.
6. Pagamentos, Relatórios (R1/R4) e PLR: agrupam por mês.
7. Rules: sem mudança (já é admin-only) — o id muda, o acesso não.

## Invariante que fica guardada por teste

> Cada pessoa aparece **uma vez** na folha do mês, e o valor mensal (bolsa, VR,
> VT, Outros) entra **uma vez**, não importa em quantas unidades ela deu aula.
