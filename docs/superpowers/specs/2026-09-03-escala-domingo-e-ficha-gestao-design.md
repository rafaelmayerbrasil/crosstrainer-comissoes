# Escala: domingo fora, e a gestão que dá aula entra

> Desenho aprovado pelo Rafael em 03/09/2026. Origem: dois pedidos do Rafael
> Rojais no grupo, 09h43 e 09h44 do mesmo dia.

## O pedido, como veio

> "O Will e nem eu ainda podemos entrar na escala dos professores"
> "Outra coisa, ele esta abrindo escala de feriados aos domingos, pode tirar os
> domingos da escala"

E a régua, na resposta do Rafael: **domingo a academia não abre — e com isso não
existe feriado em domingo.** Não é "avisar", é não existir.

## O que foi conferido na base de PRODUÇÃO antes de desenhar

| pessoa | perfil em `/users` | `professorId` | ficha em `teachers` |
|---|---|---|---|
| Rafael Rojais | `admin` + `professor` | vazio | não existe |
| Will Souza | `supervisao` + `professor` | vazio | não existe |

E a escala do domingo, existindo mesmo:

```
2026-11-15  domingo  feriado  rascunho  pub=false  "Proclamação da República"
```

Feriados que caem em domingo, pela BrasilAPI: 05/04/2026 (Páscoa),
15/11/2026 (Proclamação), 28/03/2027 (Páscoa).

## Três bloqueios, não um

O "não consigo entrar na escala" tem **três** causas empilhadas. Corrigir uma só
não destrava ninguém.

1. **Sem ficha em `teachers`, não existe candidato.** A Escala Inteligente monta
   a lista a partir de `TeacherService.list()`
   (`professores-escala-smart.js:117`). Perfil `professor` em `/users` não põe
   ninguém no sorteio.
2. **Não há como criar essa ficha pela tela.** A ficha só nasce pelo assistente
   "Nova pessoa", que cria ficha **e login juntos** — e os dois já têm login. Na
   ficha deles a aba "Professor" nem aparece: ela existe só para quem já tem
   ficha (`professores-pessoas.js:172`). A pendência registrada em 25/08 ("criar
   a ficha pela tela Pessoas") era, portanto, **impossível de cumprir**.
3. **A tela da escala nunca mostraria a visão de professor pra eles.**
   `renderEscalaSmartPage()` (`professores-escala-smart.js:97`) manda todo mundo
   de admin ou supervisão para a visão de gestão. Os botões
   *Prefiro / Pode ser / Não posso* e a cota de dias não têm como aparecer.

## Peça A — dar ficha de professor a quem já tem login

Na ficha da pessoa (Hub Pessoas), quando ela tem **login e nenhuma ficha de
professor**, a aba **Professor** passa a existir com um botão **"Criar ficha de
professor"**.

- Abre o `teacherModal` que já existe — mesmos campos, inclusive a marca
  **"dá aula mas não recebe por aula"** (`naoRemunerado`).
- Ao salvar, o vínculo é gravado **dos dois lados**: `users.professorId` e
  `teachers.userId`. Os dois são necessários e servem a propósitos diferentes —
  `/users` só é legível pelo dono ou por admin, então é `teachers.userId` que
  permite um professor descobrir o colega (é disso que a substituição depende).
- Só admin.

## Peça B — a gestão que dá aula se candidata

Na Escala Inteligente, quem é gestão **e tem ficha de professor** ganha uma aba
a mais: **🙋 Minhas datas**, que renderiza a mesma visão do professor (cota de
dias, *Prefiro / Pode ser / Não posso*, "você está escalado" e a equipe do dia).

- Gestão **sem** ficha (Rodrigo, Benny) não vê nada de novo.
- A visão de gestão continua exatamente como está — a aba é um acréscimo.
- Reusa `renderProfSabadosFeriados`; não é tela nova.

## Peça C — domingo não entra na escala

Uma regra, no lugar por onde toda escala passa.

1. **`ScaleService.createScale` recusa data de domingo** e `updateScale` recusa
   mudar uma escala para domingo. Guarda no serviço = vale para todo caminho da
   tela, inclusive os que ainda não existem.
2. **Aba Feriados para de sugerir** feriado em domingo, com uma nota curta
   dizendo por quê — senão a gestão procura o 15/11, não acha e não entende.
3. **Fim de ano fecha os domingos sozinho.** Hoje `closedDays` cobre só 24, 25,
   31/12 e 01/01 (`professores-escala-smart.js:1882`): os domingos do período
   viram vaga normal. Este é o segundo vazamento da mesma regra, achado ao
   conferir o primeiro.
4. **"Domingo especial" sai do seletor** de criação — é o único caminho que
   restaria para domingo. O código que lê docs desse tipo continua no lugar
   (não existe nenhum em produção; tirar o suporte quebraria contagem de justiça
   à toa).
5. **Dado:** apagar o rascunho de 15/11/2026 em produção, com backup antes.

## O que este trabalho NÃO resolve

- As duas fichas ainda precisam ser **criadas pela gestão, pela tela**: a do
  Rafael com a marca "não recebe por aula", a do Will normal. O tipo e o valor
  da hora-aula do Will são dados que não estão comigo.
- Se o Will deve aparecer no fechamento como professor, isso depende do cadastro
  salarial dele — decisão da gestão, não deste desenho.

## Testes

Seguindo a lição de `smoke-modulos-no-browser.js` e de [[previa-nunca-rodou]]:
teste que lê o texto do arquivo não prova nada. As regras novas são funções
puras ou passam pelo serviço, e os smokes **chamam** essas funções.

- `scripts/smoke-domingo-fora-da-escala.js` — comportamental, contra o firestore
  falso: criar em domingo falha, editar para domingo falha, sábado e segunda
  continuam passando, fim de ano pula domingo, a lista de feriados perde o
  domingo.
- `scripts/smoke-gestao-na-escala.js` — puro: quem vê a aba "Minhas datas" e
  quem não vê; quais abas a ficha da pessoa mostra em cada estado.
