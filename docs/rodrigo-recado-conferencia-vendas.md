# Recado enviado ao grupo — a conferência de vendas no ar

**Para:** Rodrigo (grupo) · **De:** Rafael · **Data:** 08/09/2026
**Refere-se a:** sessão 67 — conferência de vendas, em produção (`9388454`)
**Textos anteriores:** `rodrigo-fechamento-agosto-e-metas.md` (02/09) · `rodrigo-agosto-conferencia-listas.md` (07/09)

---

## Texto enviado, na íntegra

> **Comissões — o que mudou**
>
> Agora a tela inicial mostra três números do mês: quanto foi vendido, quanto já virou dinheiro e
> quanto está aguardando. Como a comissão só nasce quando o cliente paga, o mês começa parecendo
> vazio e vai enchendo conforme as cobranças caem — agora dá pra ver isso acontecendo.
>
> Na aba "A receber", cada venda que ainda não foi paga tem três botões: Já foi paga · Ainda a
> receber · Não vamos cobrar. Fica registrado quem decidiu, quando e o porquê — não some mais na
> cabeça de quem conferiu. E a venda que é paga depois passa a mostrar "Pago em tal dia" em vez de
> simplesmente desaparecer da lista.
>
> Quando o sistema desconfia de alguma coisa, ele explica o motivo em vez de decidir sozinho. Quem
> confirma é a gestão.
>
> ⚠️ **Três coisas que precisam de vocês:**
>
> 1️⃣ **21 vendas de agosto ainda sem pagamento identificado** — 5 no Campeche e 16 no Príncipe.
> Elas estão listadas na aba "A receber". Parte deve ser só parcela que ainda não venceu, mas vale
> passar o olho: tem renovação anual de R$ 3.108 e de R$ 3.948 na lista.
> (o valor mostrado é o do contrato inteiro, não o da comissão)
>
> 2️⃣ **Duas renovações anuais de R$ 2.388 precisam de uma conferida na Pacto** — Amandha Marcela e
> Cátia Terezinha. As duas fecharam anual em agosto, começando em 02/09. O pagamento que aparece no
> nome delas em agosto é a mensalidade do plano antigo. A dúvida: em setembro a cobrança do anual
> vai cair no contrato novo, ou continua caindo no antigo? Só olhando na Pacto pra saber.
>
> 3️⃣ **O cadastro da Mariana Minghelli Becker está com lixo no nome na Pacto** ("VISÃO GERAL
> CADASTRO VE" colado no sobrenome). O sistema já contorna, mas o nome errado sai em recibo e em
> relatório tirado de lá.

---

## O que cada pedido destrava do nosso lado

| | Pedido | Por que importa aqui |
|---|---|---|
| 1️⃣ | passar o olho nas 21 | é o **primeiro uso real** dos três botões — ninguém da academia clicou ainda, e o `set` no Firestore só acontece logado |
| 2️⃣ | conferir Amandha e Cátia na Pacto | responde se a anual cai no contrato novo ou no antigo. **É o caso que justificou "o sistema opina, a pessoa confirma"** — marcar sozinho custaria R$ 4.776 de acompanhamento perdido |
| 3️⃣ | limpar o nome da Mariana na Pacto | o nome sujo quebraria o cruzamento por nome no mês em que ela pagar (R$ 2.598,57) — ver `[[rotulo-de-tela-no-nome-do-cliente]]` |

## Continua aberto do texto de 07/09 (`rodrigo-agosto-conferencia-listas.md`)

As 6 perguntas daquele documento **não foram respondidas** e não estão neste recado:

1. as 9 vendas do Príncipe no nome dele são dele ou das meninas → folha R$ 4.118,66 × R$ 4.423,49
2. fechar agosto com o número corrigido
3. as metas de agosto continuam 50·57·65 e 28·32·37
4. como registrar a divisão entre vendedoras ("70% Kali / 30% Bárbara")
5. bonificação por bater meta nas duas unidades — existe ou não
6. quem sobe o arquivo da Pacto, e com que frequência

## Pendência nossa, já prometida por escrito

A tela **"Configurar Metas do Mês"** só abre depois do primeiro upload do mês — foi onde o Rodrigo
esbarrou em setembro, e o texto de 07/09 promete a correção. Não depende de resposta dele.
