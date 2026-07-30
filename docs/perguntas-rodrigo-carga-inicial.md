# Carga inicial — análise do arquivo devolvido pelo Rodrigo (29/07/2026)

Arquivo: `carga professores agenda/modelo-carga-inicial.xlsx` (devolvido 29/07 19:44)

**Situação: a carga NÃO pode ser executada ainda.** O bloqueio principal é a aba Professores
estar vazia. Os outros pontos são resolúveis, mas 3 deles precisam de decisão do Rodrigo.

---

## O que veio preenchido

| Aba | Conteúdo | Situação |
|-----|----------|----------|
| Modalidades | 8 modalidades | ✅ ok |
| **Professores** | **0 linhas (só a linha de exemplo)** | 🚨 **vazia** |
| Grade semanal | 113 aulas · 15 professores · CP e PP | ⚠️ com 2 conflitos |

As linhas de EXEMPLO não foram apagadas em nenhuma aba (Modalidades L4, Professores L4,
Grade L4) — a carga vai ignorá-las pelo marcador "← exemplo", sem problema.

---

## 🚨 BLOQUEADOR 1 — aba Professores vazia

A grade referencia **15 professores**, nenhum deles está na aba Professores:

ALAN BRITO · BRUNO CLAUDINO · BRUNO OTHERO · CARLA FANTI · EDUARDA SANTOS ·
HELENA MARIA BORGES · HELOISA MAYUMI · JOAO VITOR PEREIRA DE SOUZA ·
KARIN KOVALSKI DE SOUZA · LEONARDO SILVEIRA · LOUISE GABRIELLE ALFEU DOS ANJOS ·
THAYNARA SILVA · THEO ROSA · THIAGO VALENTIM · VAGNER TEIXEIRA DE LIMA

O Rodrigo avisou que "já cadastrou os professores". **Onde?**

- **Se cadastrou direto no sistema (hub Pessoas, em produção):** ótimo, mas preciso conferir
  antes de subir a grade — a grade casa por NOME, e qualquer diferença de grafia quebra o
  vínculo. Preciso que ele confirme: os 15 nomes acima estão cadastrados com **essa grafia
  exata**? E cada um já tem **tipo (CLT/Estagiário), data de admissão e salário** preenchidos?
- **Se não cadastrou:** a aba precisa ser preenchida. Sem tipo/admissão/salário **não existe
  fechamento mensal, pagamento, férias nem PLR** — o módulo não tem de onde tirar o valor.

> Nota: não tenho credencial de produção aqui (só de staging), então não consigo conferir
> o cadastro real por mim mesmo. Depende da confirmação dele ou de olhar a tela junto.

---

## ❓ DECISÃO 2 — cada linha é uma AULA ou um TURNO?

A planilha pedia "uma AULA por linha", mas as durações não parecem de aula individual:

| Duração | Qtd de linhas |
|---------|---------------|
| 1h00 | 29 |
| 1h10 – 2h50 | 26 |
| 3h00 – 3h30 | 17 |
| **4h00** | **19** |
| 4h30 – 6h30 | 22 |

Mediana **3h**; a maior é **6h30** (THEO ROSA, sexta, CP, 06:00–12:30).
Exemplo: JOAO VITOR, segunda, 06:00–10:00, TOI.

Duas leituras possíveis:

- **(A) É o bloco/turno em que o professor cobre aquela modalidade** — e dentro dele rodam
  várias aulas de 1h. Foi assim que ele preencheu, provavelmente.
- **(B) É literalmente uma aula** de 4h.

**Por que importa:** o total de horas para pagamento dá **o mesmo nos dois casos** (4h é 4h),
então não há risco no valor a pagar. O que muda é a granularidade: se carregar como bloco, a
agenda do professor mostra "1 aula de 4h" em vez de 4 aulas de 1h, e uma substituição passa a
ser do bloco inteiro, não de uma hora específica. Também muda a contagem de "aulas dadas" do
engajamento/pontos.

**Pergunta:** carregamos como está (blocos), ou ele quer que eu quebre os blocos em aulas de
1h? Se quebrar: qual a duração padrão de uma aula em cada modalidade?

---

## ❓ DECISÃO 3 — grafia das modalidades

Os nomes não batem entre as abas (a planilha avisava que precisavam bater exatamente).
Dá pra resolver normalizando (maiúsculas/acento/espaço), mas preciso saber **qual grafia vai
aparecer na tela**:

| Aba Modalidades (cadastro) | Aba Grade (uso) | Aulas |
|---|---|---|
| `TOI` | `TOI` | 42 ✅ igual |
| `Hiit / Marombinha` | `HIIT/ MAROMBINHA` | 62 |
| `TOI Surfe` | `TOISURFE` | 4 |
| `TOI Kids` | `TOI KIDS` | 3 |
| `TOI Sênior` | `TOI SENIOR` | 2 |

Sugestão: usar a grafia da aba Modalidades (mais cuidada — tem acento e espaçamento certos),
tratando a da grade como sinônimo. Confirmar.

Também: **Yoga**, **TOI Mobility** e **TOI Combate** estão cadastradas mas **não têm nenhuma
aula na grade**. Mantemos cadastradas (para uso futuro / escalas especiais) ou saem?

---

## ⚠️ CORREÇÃO 4 — dois conflitos que o sistema vai REJEITAR

O módulo bloqueia o mesmo professor com horário sobreposto (decisão D6). Essas duas linhas
não entram como estão:

1. **JOAO VITOR PEREIRA DE SOUZA — segunda, CP, 06:00–10:00 em DUAS modalidades**
   (linha 5 = TOI, linha 10 = HIIT/Marombinha). Ele dá as duas no mesmo horário?
   Ou a linha 10 era outro dia (a sexta dele só tem TOI)?

2. **THIAGO VALENTIM — quarta, PP, 16:30–19:45 HIIT/Marombinha duplicado**
   (linhas 110 e 112, idênticas). O padrão dele é seg/qua = HIIT e ter/qui = TOI, e a
   **sexta está vazia** — a linha 112 era pra ser SEXTA?

---

## ❓ CONFERIR 5 — pontos menores

- **Nenhuma aula de sábado ou domingo** nas duas unidades. A academia não abre no fim de
  semana, ou ficou faltando?
- **KARIN KOVALSKI DE SOUZA** só tem terça/quarta/quinta (sem segunda e sexta). Confere?
- **VAGNER TEIXEIRA DE LIMA** só segunda e quarta (16:30–21:30). Confere?
- **Unidades:** a grade usa `CP` e `PP`. Confirmar que em produção os ids são `unit-cp` e
  `unit-pp` (é o que o staging usa).

---

## Horários: resolvido, sem perda

Os 113 horários vieram como **fração de dia do Excel** (`0,25` em vez de `06:00`) — o Excel
converteu o texto em hora. A conversão é exata e todos caíram em horários redondos
(`0,25` → 06:00 · `0,41666…` → 10:00 · `0,82291…` → 19:45). Não precisa refazer a planilha
por causa disso.

---

## Próximo passo

Sem a resposta dos itens 1, 2 e 3 a carga não sobe. Assim que vierem:

1. Escrever `scripts/seed-carga-inicial.js` (lê o .xlsx, normaliza, valida, grava)
2. Rodar em **staging** primeiro, conferir a grade na tela
3. Só então produção, com OK explícito (regra 7 do CLAUDE.md)
