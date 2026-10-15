# Modernização da plataforma CrossTainer — diagnóstico e roteiro

**04/10/2026 · rascunho para o Rafael decidir com o Rodrigo.** Nada aqui foi construído.

## O que o Rafael pediu

1. Reorganizar a base para aproveitar os cadastros entre os módulos.
2. Cadastrar **empresas com filiais**, como a Pacto faz.
3. Deixar o sistema pronto para **módulos novos** (CRM, financeiro…), até um dia **não precisar da Pacto**.
4. Poder **vender a solução** para outras academias.
5. **IA + WhatsApp oficial**: cobrar e confirmar agenda, validar o fechamento, cobrar os professores — a pessoa responde no WhatsApp e o sistema se atualiza.

## Resumo em seis frases

- **Não reescrever do zero.** O sistema está em uso, as regras de dinheiro estão isoladas e testadas (128 testes), e uma reescrita pararia os pedidos do dia a dia por meses.
- **O banco já é um só.** O que falta não é juntar comissão e agenda; é o sistema saber o que é "empresa", parar de ter a CrossTainer escrita dentro das regras e ter uma ficha única por pessoa.
- **Vender para as primeiras academias não exige refazer o banco.** Cada academia pode ter a sua própria cópia isolada do sistema, como o staging e a produção já são hoje.
- **WhatsApp e IA entram por um lugar que já existe:** os avisos que hoje viram e-mail. Boa parte do que você quer (confirmar, cobrar) se resolve com botões, antes de qualquer IA.
- **A IA entende e propõe; quem calcula dinheiro continua sendo o motor testado**, e o que mexe em pagamento ou fechamento só vale com o "sim" de uma pessoa.
- **Sair da Pacto é a maior frente de todas** (cobrança de aluno, catraca, contratos) e fica para depois que o resto estiver de pé.

---

## 1. Como o sistema está hoje

### O que já é compartilhado
- **Um banco só**, um login só, uma lista de unidades, um registro de auditoria.
- **Tela Pessoas**: já mostra professores e usuários numa lista única.
- **Avisos**: um lugar só por onde passam as notificações; cinco tipos já viram e-mail.
- **Regras de dinheiro isoladas**: comissão, folha por pessoa/mês, lista de renovações e meta sugerida são peças separadas da tela, com teste. É o patrimônio do sistema e se aproveita inteiro.

### O que está separado ou preso
| Ponto | Como está | Por que atrapalha o que você quer |
|---|---|---|
| **Empresa** | Não existe. Nenhuma das ~55 gavetas do banco diz de que empresa é o dado. | Sem isso não há "outra academia" dentro do mesmo banco. |
| **Filiais** | Existem (CP e PP), mas as siglas e os nomes das unidades aparecem escritos em cerca de 70 pontos do código, em 25 arquivos. | Uma terceira unidade, ou outra academia, exige mexer em código. |
| **Regras da casa** | Nomes de pessoas e casos da CrossTainer estão dentro das regras (quem não recebe, o consultor padrão da importação, apelidos de vendedora). | Para outra academia, viram erro. Têm que ser configuração. |
| **Pessoa** | Três registros: o login, a ficha de professor e a vendedora — esta reconhecida pelo **nome** que vem da Pacto. | Já deu problema (a mesma vendedora com dois nomes). CRM e financeiro precisam de uma ficha única. |
| **Aluno / cliente** | Não existe como cadastro nosso; vem da Pacto a cada busca. | CRM, financeiro e a saída da Pacto dependem dele. |
| **Menu** | Dois: o de Comissões (uma tela de 12 mil linhas) e o de Professores (em peças). | Módulo novo não tem onde "encaixar". |
| **Permissão** | Por perfil (admin, supervisão, professor, vendedor) e por módulo. Não há permissão por empresa nem, em geral, por filial. | Gestor de uma filial vê as outras. |
| **Acesso ao banco** | Espalhado: cerca de 370 pontos nas telas falam direto com o banco. | É o que torna cara uma eventual troca de banco. |

### Números
- 6 páginas, 57 arquivos de código de tela, ~49 mil linhas; 23 rotinas no servidor (5 agendadas); 128 testes automáticos.
- Sem "framework" e sem etapa de montagem: o que está no repositório é o que vai ao ar.

---

## 2. As decisões de base

### 2.1 Empresa e filiais: dois jeitos

**A. Uma cópia do sistema por academia** (isolada). É o que staging e produção já são: mesmo código, bancos separados, o endereço decide qual. Uma academia nova ganha o seu endereço e o seu banco.
- A favor: isolamento total entre clientes, quase nada a refazer, cada cliente paga o próprio uso.
- Contra: cada publicação vai para N cópias (dá para automatizar); não há visão somada de todos os clientes; passa a pesar lá pelos 10 a 20 clientes.

**B. Todas as academias no mesmo banco**, cada dado carimbado com a empresa.
- A favor: uma publicação só, cadastro de empresa nova num clique, visão geral.
- Contra: mexe em todas as gavetas, em todas as regras de acesso e em todos os pontos que leem o banco; um erro de regra mostra dado de uma academia para outra.

**Recomendação: A agora, B quando houver clientes que justifiquem** — e, se chegar lá, provavelmente junto com a troca de banco (2.2). O que as duas pedem é igual e é o trabalho da Fase 1: tirar a CrossTainer de dentro do código.

> "Empresa com filiais" funciona nos dois: a empresa é a cópia (A) ou o carimbo (B); as filiais são as unidades, que já existem e passam a ser cadastráveis.

### 2.2 Manter o banco atual ou trocar

- **O atual (Firestore)** é bom para agenda, avisos e telas ao vivo. É fraco para **somar e cruzar**: não soma sozinho, então o sistema baixa os dados e calcula. Funciona no tamanho de hoje.
- **Um banco de tabelas (Postgres)** é o natural para financeiro, CRM com relatórios e muitos clientes juntos.
- **Recomendação: não trocar agora. Decidir antes de começar o financeiro.** Até lá, cada módulo que for tocado passa a falar com o banco por uma porta só — é isso que barateia uma troca futura, e é útil mesmo se a troca nunca acontecer.

### 2.3 O que é um "módulo"
Cada módulo passa a ter: as suas telas, as suas gavetas no banco, as suas regras de acesso, as suas rotinas e **uma chave liga/desliga por empresa**. Comissões e Professores viram os dois primeiros módulos nesse formato; CRM e financeiro já nascem nele.

### 2.4 Tecnologia das telas
Fica como está (sem framework). Trocar agora não entrega nada do que foi pedido. Rever junto com a decisão do banco.

---

## 3. WhatsApp oficial + IA

### Como encaixa
Hoje: algo acontece → nasce um **aviso** → o aviso aparece no sino e, em cinco casos, vira e-mail. O WhatsApp entra como mais um canal do mesmo aviso, e a resposta da pessoa volta para o mesmo lugar.

### Em quatro degraus
| Degrau | O que a pessoa vê | Precisa de IA? |
|---|---|---|
| **1. Avisos por WhatsApp** | "Você foi escalado no sábado 18/10, unidade Campeche." | Não |
| **2. Resposta por botão** | [Vou] [Não vou] · [Confirmo as horas] [Corrigir] · [Dei a aula] [Troquei com…] | Não |
| **3. Texto livre** | "Vou chegar 15 min atrasado na aula das 7h" → o sistema lança o atraso e responde "anotado". | Sim |
| **4. Conferente e cobrador** | Antes de fechar o mês: "faltam as horas de 3 professores; o Theo tem 28h a menos que em agosto — confere?". Cobra quem não respondeu. | Sim |

Os degraus 1 e 2 resolvem a maior parte de "cobrar e confirmar" e não têm risco de a IA entender errado. Os degraus 3 e 4 vêm depois, em cima deles.

### Regras para a IA
- **Ela não calcula dinheiro.** Comissão, folha e horas saem do motor testado; a IA lê o resultado e explica.
- **Ela propõe, uma pessoa confirma** tudo que mexe em pagamento, fechamento ou no cadastro de outra pessoa.
- **O que é do próprio autor e de baixo risco** (confirmar presença, avisar atraso) pode valer direto, com resposta de confirmação e desfazer.
- **Tudo fica registrado**: a mensagem, o que a IA entendeu, o que foi feito e quem confirmou.
- **Na dúvida, ela pergunta** ou passa para a gestão; não adivinha.

### O que não depende de nós
- **Cadastro na Meta**: conta comercial verificada (CNPJ, site), um número e a aprovação de cada modelo de mensagem. Costuma levar de dias a algumas semanas. **Vale começar já.**
- **Número**: em geral um número dedicado ao sistema.
- **Custo**: a Meta cobra por mensagem iniciada pela empresa (centavos); respostas dentro de 24 horas costumam ser gratuitas. A IA custa centavos por conversa. Para ~20 professores e a gestão, é pouco; meço antes de ligar.

---

## 4. O roteiro

Os tamanhos são em **sessões de trabalho como as nossas** e são estimativa, não promessa.

### Fase 0 — Endereço novo (em andamento)
`sistema.crosstainer.com.br`, fora do GitHub Pages. Código pronto no staging; falta o registro no Wix e o OK para produção.

### Fase 1 — Fundação (sem trocar o banco, com o sistema no ar)
| Etapa | Entrega | Tamanho |
|---|---|---|
| **1a. Empresa e filiais como cadastro** | Ficha da empresa (nome, marca, unidades); unidades cadastráveis; as siglas e os nomes de pessoas saem do código e viram configuração | 3 a 5 |
| **1b. Ficha única de pessoa** | Uma pessoa, vários papéis (professor, consultora, gestão), vínculo por filial; a vendedora deixa de ser reconhecida pelo nome | 4 a 6 |
| **1c. Um menu só, módulos ligáveis** | Comissões e Professores no mesmo menu; chave de módulo por empresa; permissão por filial | 2 a 4 |
| **1d. Uma porta para o banco por módulo** | Feito aos poucos, a cada módulo tocado | sem projeto próprio |

Marco ao fim da Fase 1: **dá para montar a cópia de uma segunda academia** sem mexer em código (um piloto com uma academia amiga).

### Fase 2 — WhatsApp e IA
| Etapa | Entrega | Tamanho |
|---|---|---|
| **2a. Cadastro na Meta** | Conta, número e modelos aprovados | tempo de calendário, não de trabalho |
| **2b. Avisos por WhatsApp** | Os avisos que têm prazo ou dinheiro saem também pelo WhatsApp | 2 |
| **2c. Respostas por botão** | Escala, horas do mês e troca de aula respondidas no WhatsApp | 2 a 3 |
| **2d. IA entende texto livre** | Atraso, falta, troca e dúvida escritas do jeito da pessoa | 3 a 5 |
| **2e. IA conferente do fechamento** | Resumo do que falta e do que está estranho; cobrança de quem não respondeu | 2 a 3 |

### Agente dentro do sistema (decidido em 14/10/2026)
Um assistente numa caixinha do sistema (e depois no WhatsApp) que **responde qualquer pergunta sobre os dados, cruzando informações**, e **age a pedido de quem tem permissão** (montar escala, trocar professor, lançar falta).
- **Como:** IA da Anthropic (Claude) chamada por uma Function, com "ferramentas" que são as mesmas funções de serviço das telas. Nunca escreve direto no banco.
- **Permissão no código, não na conversa:** cada ferramenta confere quem pediu, com as regras das telas (professor só o dele, vendedora só a comissão dela, salário só admin). Texto vindo dos dados nunca vira instrução.
- **Agir = propor → a pessoa confirma → executa → fica no histórico** (o pedido, o que a IA entendeu, quem confirmou). Dinheiro, fechamento e pagamento seguem as regras da seção 3.
- **Custo estimado:** 20 a 40 centavos por pergunta no modelo do dia a dia; R$ 50–200/mês para a gestão e ~20 professores. Medir no piloto antes de abrir.
- **Etapas:** **A1.** piloto só leitura, só gestão (3 a 4 sessões) → **A2.** ações com confirmação (3 a 5) → **A3.** professores e vendedoras, cada um no que é seu → **A4.** o mesmo agente no WhatsApp. **A4 substitui os degraus 2d e 2e**: o WhatsApp passa a falar com o agente.
- **Precisa:** conta na Anthropic com cobrança e a chave no cofre do Firebase.

### Fase 3 — Módulos novos
- **Decidir o banco** (2.2) antes do financeiro.
- **CRM**: depende de como está o projeto do Rodrigo (pergunta 3).
- **Cadastro de aluno/cliente** nosso, alimentado pela Pacto enquanto ela existir.
- **Financeiro**: contas a pagar e a receber, começando pelo que já temos (folha e comissões).

### Fase 4 — Sair da Pacto
Contratos e matrículas, cobrança recorrente do aluno (com uma empresa de pagamentos), catraca, convênios (Gympass, TotalPass), nota fiscal. É trabalho de muitos meses e só faz sentido com as fases 1 a 3 de pé. Até lá a Pacto continua sendo o que já é para nós: **uma fonte de dados que o sistema lê**.

### Ordem que recomendo
1. **Fase 0** e **2a** (o cadastro na Meta corre sozinho no calendário).
2. **1a** — é a base de tudo e a mais barata.
3. **A1** — o agente só de leitura para a gestão (atualizado em 14/10).
4. **2b e 2c** — entregam o que a gestão sente no dia a dia (cobrar e confirmar) e não dependem de 1b.
5. **A2**, **1b**, depois **1c**.
6. **A3 e A4** (no lugar de 2d e 2e).
7. Fase 3, com a decisão do banco.

Os pedidos do dia a dia do Rodrigo continuam entrando no meio; cada etapa é pequena o bastante para isso.

---

## 5. O que não fazer agora
- Reescrever do zero.
- Trocar de banco ou de tecnologia de tela antes de precisar.
- Colocar todas as academias no mesmo banco antes de ter a segunda.
- Deixar a IA mexer em dinheiro ou em fechamento sem confirmação.
- Construir qualquer coisa funda em cima da Pacto.

---

## 6. Para decidir

> **✅ Decidido pelo Rafael em 14/10/2026:** (1) vender = **porta aberta, sem prazo** (a base nasce pensando nisso, sem piloto marcado) · (4) **base primeiro**: 1a agora, cadastro na Meta em paralelo · (2) número: **o da academia** — ⚠️ conferir antes se ele está no app WhatsApp Business e se a Meta permite usá-lo junto com a API oficial (o "uso simultâneo" do app com a API); se não permitir, o número sai do app do celular · (5) **uma cópia por academia** (2.1 A). **Em aberto:** (3) o CRM do Rodrigo; e quem faz o cadastro na Meta (CNPJ e acesso à conta comercial da academia).

1. **Vender para outras academias** é meta para os próximos 12 meses ou é deixar a porta aberta? (Com meta, o piloto da segunda academia entra logo depois da Fase 1.)
2. **WhatsApp**: há um número para dedicar ao sistema? Quem faz o cadastro na Meta (precisa do CNPJ e do acesso à conta comercial da academia)?
3. **CRM do Rodrigo**: em que pé está e em que tecnologia? Vira um módulo daqui, ou continua separado e os dois se conversam?
4. **A ordem** da seção 4 serve, ou a cobrança por WhatsApp é mais urgente que a base?
5. **Empresa e filiais**: concorda em começar com uma cópia por academia (2.1 A)?

---

## Anexo técnico (para quem for construir)

- **Auth/regras:** `firestore.rules` (599 linhas) decide por `users/{uid}.profiles[]`/`role`/`moduleAccess`; não há `empresaId`; `podeUnidade(sigla)` é o único recorte por unidade.
- **Unidades fixas:** 69 linhas em 25 arquivos de tela e de Functions citam `unit-cp`/`unit-pp`, `'cp'`/`'pp'`/`'CP'`/`'PP'` ou "Campeche"/"Príncipe" (contagem por ripgrep em 04/10, sem `scripts/` nem cópias de worktree). Ids de período `cp_2026-09`.
- **Nomes na regra:** `pacto-adapter.js`, `renovacoes-lista.js`, `metas-sugeridas.js`, `commission.js` (+ gêmeos em `functions/`).
- **Acesso ao banco:** `db.collection(` — `index.html` 142, `professores-shared.js` 123, `comissoes-mes.js` 29, demais telas ~75.
- **Functions:** 23 exportadas em `functions/index.js` (2.332 linhas), 5 `onSchedule`; módulos puros duplicados raiz ↔ `functions/` com teste de igualdade.
- **Modelo isolado (2.1 A):** `firebase-config.js` já escolhe o projeto pelo host (`decidirEndereco`); falta virar tabela host → projeto e um script de publicação para N projetos (`scripts/publicar-site.js` é o começo).
- **WhatsApp:** Cloud API da Meta → Function de webhook → `notifications` ganha `canais` e a resposta entra como evento; a IA chama as mesmas funções de serviço que as telas chamam, nunca escreve direto no banco.
- **Leitura de plataforma de 19/08/2026** (memória `visao-sistema-unico-crm-comissoes`): Postgres é o destino mais provável; `commission.js` não tem uma linha de Firebase.
