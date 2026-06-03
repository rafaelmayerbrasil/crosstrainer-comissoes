# Proposta Funcional Consolidada
## Módulo de Professores, Agenda, Substituições, Escalas Especiais, Fechamento e Pagamentos
**Cliente:** Rodrigo — CrossTainer  
**Versão:** V2 consolidada para validação final  
**Data:** 22/04/2026

---

## 1. Objetivo do documento

Este documento consolida:

- a proposta funcional original do novo módulo de agenda dos professores;
- os ajustes respondidos e revisados pelo cliente;
- os refinamentos adicionais de regra de negócio;
- os pontos operacionais e financeiros que devem orientar o desenvolvimento.

O objetivo é servir como **base única de validação final** antes da implementação.

---

## 2. Objetivo do módulo

O novo módulo deverá permitir:

- cadastro e gestão de professores;
- controle de agenda semanal por unidade;
- visualização da agenda geral pelos professores, incluindo outras unidades;
- formalização de substituições de aula;
- aceite do professor substituto;
- acompanhamento e validação posterior pela gestão no fechamento;
- controle e consolidação de horas trabalhadas;
- cálculo de pagamento;
- tratamento específico para professor estagiário;
- emissão de recibos;
- auditoria completa;
- relatórios operacionais e financeiros;
- planejamento antecipado de escalas especiais;
- controle de férias de CLT e recesso de estagiários.

---

## 3. Premissa operacional do processo

O sistema será utilizado como **meio formal de registro, aceite, histórico, fechamento e pagamento**.

No dia a dia, o fluxo esperado é:

1. o professor consulta a agenda geral;
2. identifica quem pode cobrir a aula;
3. conversa previamente com o colega, se necessário;
4. registra a solicitação no sistema;
5. o colega aceita ou recusa;
6. a troca fica formalizada no sistema;
7. a gestão acompanha e valida financeiramente no fechamento mensal.

A validação da gestão é **posterior**, no contexto do fechamento do mês. Ela **não bloqueia** a troca operacional no momento da solicitação.

---

## 4. Perfis de acesso

### 4.1 Administrador / Gestão
Poderá:

- cadastrar, editar e inativar e visualizar todos os professores;
- criar e alterar agenda de todos os professores;
- visualizar todas as agendas, unidades e modalidades;
- acompanhar trocas, coberturas em aberto e conflitos;
- ajustar horas manualmente com justificativa;
- validar o fechamento mensal;
- emitir e registrar pagamentos/recibos;
- gerenciar escalas especiais;
- aprovar férias e recesso;
- acessar relatórios e auditoria;
- **acessar e editar a aba de dados salariais** de professores e estagiários (aba exclusiva do perfil administrador).

### 4.2 Supervisão
Poderá:

- pode criar e alterar agenda de todos os professores;
- pode visualizar todas as agendas, unidades e modalidades;
- acompanhar trocas, coberturas em aberto e conflitos;
- ajustar horas manualmente com justificativa;
- gerenciar escalas especiais;
- aprovar férias e recesso;
- acessar relatórios e auditoria.

Não poderá:
- cadastrar, editar e inativar e visualizar todos os professores;
- validar fechamento;
- visualizar valor/hora de professores;
- **acessar ou editar a aba de dados salariais** de professores e estagiários;
- emitir e registrar pagamentos/recibos;

### 4.3 Professor
Poderá:

- visualizar a própria agenda;
- visualizar a agenda geral;
- consultar outras unidades;
- ver quem está escalado por horário;
- solicitar substituição;
- aceitar ou recusar solicitações;
- acompanhar solicitações enviadas e recebidas;
- consultar prévia de horas;
- consultar recibos próprios.

Não poderá:

- editar agenda base;
- alterar agenda de terceiros;
- validar fechamento;
- alterar horas de terceiros;
- visualizar valor/hora de outros professores.

### 4.4 Professor Estagiário
Terá as mesmas permissões operacionais do professor, com regras próprias de limite de horas, recesso e cálculo de excedente.


---

## 5. Cadastro de professores

O sistema deverá permitir cadastro e manutenção dos professores.

### 5.1 Campos mínimos
- nome completo;
- e-mail;
- telefone;
- CPF;
- tipo do profissional: efetivo, estagiário, eventual/substituto;
- valor hora/aula;
- valor fixo mensal da bolsa, quando estagiário;
- limite de horas do estagiário;
- unidade(s) vinculada(s);
- modalidade(s) que pode ministrar;
- status: ativo/inativo;
- observações.

### 5.2 Regras
- somente administrador/gestão poderá criar, editar ou inativar;
- toda alteração deve gerar auditoria;
- o cadastro deve permitir configuração individual de pagamento e regras do estagiário.

### 5.3 Aba de dados salariais (restrita ao Administrador)

Dentro do cadastro do professor ou estagiário, deverá existir uma **aba ou seção dedicada exclusivamente aos dados salariais**, separada dos demais dados cadastrais.

#### Campos da aba salarial
- valor hora/aula;
- valor fixo mensal da bolsa (quando estagiário);
- limite de horas mensais (quando estagiário);
- tipo de remuneração: hora/aula, bolsa, misto;
- histórico de alterações salariais (data, valor anterior, valor novo, responsável).

#### Regras de acesso
- a aba de dados salariais **somente será exibida e editável para o perfil Administrador**;
- perfis de Supervisão, Professor e Estagiário **não devem ter acesso visual nem operacional** a essa aba;
- qualquer tentativa de acesso por perfil não autorizado deve ser bloqueada com mensagem de permissão negada;
- toda criação ou alteração de dado salarial deve gerar registro de auditoria com: usuário, data/hora, campo alterado, valor anterior e valor novo.

---

## 6. Agenda semanal recorrente

O sistema deverá possuir agenda semanal por professor e por unidade.

### 6.1 Cada item de agenda deve conter
- unidade;
- data;
- dia da semana;
- hora de início;
- hora de término;
- duração;
- modalidade;
- professor titular;
- status da aula.

### 6.2 Status da aula
- prevista;
- realizada;
- cancelada;
- não realizada;
- substituída.

### 6.3 Regra operacional do status da aula
A aula **não deve ser paga apenas porque estava prevista**.

A regra consolidada será:

- a aula nasce como **prevista** na agenda;
- para fins operacionais, ela poderá ser considerada **realizada automaticamente por padrão**;
- se houver necessidade, a gestão poderá ajustar manualmente o status final para **cancelada**, **não realizada** ou outra situação aplicável;
- todo ajuste posterior deve ficar auditado;
- o pagamento do mês deve considerar o **status final da aula** no fechamento, junto com as regras de substituição, cancelamento e ajustes manuais.

### 6.4 Regras gerais da agenda
- o administrador poderá criar agendas recorrentes;
- o administrador poderá alterar uma ocorrência isolada ou uma série;
- o sistema deverá alertar conflitos de horário;
- toda alteração deverá ser auditada.

---

## 7. Visões da agenda

### 7.1 Visão do administrador
Acesso completo a:

- agenda geral;
- filtros por unidade, professor, modalidade;
- criação e alteração da escala;
- acompanhamento de trocas e coberturas;
- validação do fechamento.

### 7.2 Visão do professor
O professor terá duas visões:

#### A. Minha agenda
- própria escala;
- aulas previstas;
- substituições realizadas;
- solicitações enviadas;
- solicitações recebidas;
- histórico pessoal.

#### B. Agenda geral
- visualização da agenda completa;
- visualização de outras unidades;
- visualização de quem está escalado em cada horário;
- exibição de **nome + modalidade + unidade**;
- acesso somente leitura.

### 7.3 Regras da agenda geral
- o professor poderá visualizar **todas as unidades**;
- o sistema deverá exibir indicativo automático de “livre” quando não houver aula registrada no horário;
- a agenda geral não deve exibir informações financeiras de outros professores;
- o indicativo visual serve como apoio operacional, não como garantia definitiva de disponibilidade.

---

## 8. Substituições e coberturas

O módulo deverá tratar **dois fluxos distintos**.

### 8.1 Substituição direta
O professor titular já indica um substituto específico.

Fluxo:
1. o titular abre a aula;
2. informa o substituto;
3. envia a solicitação;
4. o substituto aceita ou recusa;
5. se aceitar, a troca fica formalizada;
6. as horas passam para o substituto;
7. a gestão acompanha e valida financeiramente no fechamento.

### 8.2 Cobertura em aberto
O professor informa necessidade de cobertura sem substituto definido.

Nesse caso:
- a solicitação fica visível como demanda aberta;
- a responsabilidade pelo acompanhamento passa para a gestão;
- visualmente, não deve parecer troca resolvida.

### 8.3 Status da cobertura em aberto
- aberta;
- em negociação;
- atribuída;
- aceita;
- não coberta;
- cancelada.

### 8.4 Regras gerais de substituição
- o professor pode escolher qualquer colega **desde que esteja capacitado para a modalidade**;
- a substituição pode envolver professores de outras unidades;
- a solicitação deve registrar a unidade do titular e a unidade do substituto;
- o aceite do substituto é obrigatório;
- até o início da aula, o substituto deve ter aceitado;
- após esse limite, qualquer ajuste depende de ação manual da gestão;
- o titular poderá cancelar solicitação já aceita somente se o professor que aceitou também concordar;
- o administrador/gestão poderá forçar manualmente troca em casos excepcionais;
- tudo deve ficar auditado.

### 8.5 Dados mínimos da solicitação
- aula original;
- unidade do titular;
- unidade do professor que recebe a solicitação;
- professor titular;
- professor substituto;
- data/hora da solicitação;
- usuário que criou;
- motivo padronizado;
- observação livre;
- data/hora do aceite ou recusa;
- usuário que aceitou/recusou;
- status da solicitação.

### 8.6 Status da substituição direta
- solicitada;
- pendente de aceite;
- aceita;
- recusada;
- cancelada;

### 8.7 Regra de precedência
Se houver múltiplas alterações na mesma aula, deverá prevalecer a **última configuração validamente registrada no sistema antes do fechamento mensal**.

Ajustes manuais da gestão prevalecem sobre registros operacionais anteriores, desde que tenham justificativa e auditoria.

---

## 9. Controle de horas

O módulo deverá consolidar as horas com base em:

- agenda prevista;
- status final da aula;
- trocas aceitas;
- cancelamentos;
- coberturas;
- ajustes manuais;
- regras especiais de feriados e eventos.

### 9.1 Tipos de hora
- hora prevista;
- hora realizada;
- hora substituída;
- hora validada;
- hora extra;
- hora ajustada manualmente;
- hora cancelada.

### 9.2 Regras
- ao aceitar a troca, as horas passam ao substituto;
- o titular deixa de receber aquela aula;
- a gestão pode ajustar manualmente horas, com justificativa;
- toda divergência entre agenda, horas consolidadas e fechamento deve gerar alerta.

---

## 10. Fechamento mensal

### 10.1 Fluxo
1. o sistema consolida automaticamente as horas do mês;
2. o professor visualiza sua prévia;
3. a gestão revisa divergências;
4. a gestão pode ajustar manualmente, se necessário;
5. a gestão valida o fechamento;
6. o sistema calcula o pagamento;
7. o sistema gera o recibo.

### 10.2 Regras
- o professor **não precisa confirmar ciência** do fechamento para pagamento;
- o fechamento mensal **não poderá ser reaberto**;
- após o fechamento, a competência fica congelada;
- ajustes extraordinários futuros deverão ser tratados como ajuste financeiro em competência posterior, e não por reabertura do mês.

### 10.3 Status do fechamento
- aberto;
- em apuração;
- pendente de validação;
- validado;
- fechado.

---

## 11. Regras de pagamento

### 11.1 Professor efetivo
- pagamento por hora/aula simples;
- cálculo mensal = total de horas validadas × valor hora/aula;
- em feriados, o valor da hora/aula é **dobrado**.

### 11.2 Professor estagiário
#### Regras consolidadas
- o estagiário recebe bolsa fixa até o limite configurado;
- o limite poderá variar por profissional;
- o controle deve considerar limite configurável do estagiário, com apuração consolidada no fechamento;
- o excedente deve ser calculado pela **hora/aula proporcional**;
- a apuração do excedente será **proporcional por minutos**.

#### Fórmula funcional do excedente
```text
Valor excedente = (minutos excedentes ÷ 60) × valor-hora proporcional do estagiário
```

#### Observação de implementação
A regra deve ser implementada sem ambiguidades entre:
- valor fixo da bolsa;
- limite configurado por estagiário;
- base de cálculo proporcional;
- fechamento mensal consolidado.

---

## 12. Recibos e pagamentos

### 12.1 Dados mínimos do recibo
- número do recibo;
- nome do professor;
- CPF;
- período;
- total de horas validadas;
- valor hora/aula;
- valor fixo da bolsa, quando aplicável;
- total de horas extras/excedentes;
- valor bruto;
- observações;
- data de emissão;
- data de pagamento;
- responsável pelo pagamento.

### 12.2 Regras
- não será necessária assinatura física ou digital;
- o sistema deverá registrar emissão e pagamento;
- não há necessidade de anexar comprovantes nesta fase.

### 12.3 Ações previstas
- emitir recibo;
- reimprimir;
- cancelar;
- marcar como pago;
- gerar complemento/crédito, se necessário.

---

## 13. Cancelamentos e exceções

O sistema deve prever tratamento claro para:

- aula cancelada com antecedência;
- aula cancelada em cima da hora;
- aula cancelada por chuva/clima;
- aula cancelada por decisão da gestão;
- ausência sem cobertura;
- comparecimento do professor com não realização por motivo alheio a ele.

A regra financeira de cada caso deve ser explícita/configurável no desenvolvimento.

---

## 14. Feriados, domingos especiais e eventos

### 14.1 Regra financeira
- todos os feriados entram na regra especial;
- feriados municipais, estaduais e nacionais devem ser considerados;
- para pagamento, feriado tem hora/aula dobrada;
- a lógica especial vale para efetivos e estagiários.

### 14.2 Regra operacional de equilíbrio
Domingos especiais e eventos especiais devem ter peso maior na distribuição da escala especial, conforme item 15.

---

## 15. Escalas especiais antecipadas

Além da agenda recorrente normal, o sistema deverá possuir um bloco funcional específico para planejamento antecipado de:

- sábados;
- feriados;
- domingos especiais;
- eventos especiais.

### 15.1 Estrutura
- agenda especial separada da agenda recorrente;
- janela rolante padrão de 3 meses à frente, configurável pelo administrador;
- abertura automática da próxima janela conforme avanço do tempo.

### 15.2 O que professor/estagiário poderá informar
- disponível para trabalhar;
- preferência por trabalhar;
- preferência por não trabalhar;
- indisponível de forma obrigatória/real.

Preferência **não significa reserva automática**.

### 15.3 Critérios para consolidação da escala especial
- necessidade por unidade e por data;
- quantidade de vagas por data;
- capacitação para modalidade;
- equilíbrio entre elegíveis;
- histórico de distribuição no ciclo;
- respeito às indisponibilidades reais informadas no prazo.

### 15.4 Regra de distribuição equilibrada
Ninguém deve ficar sistematicamente de fora da escala especial, salvo indisponibilidade válida, férias, afastamento ou decisão administrativa.

A gestão deve visualizar quem está abaixo, dentro ou acima da média no ciclo.

### 15.5 Pesos da escala especial
- sábado comum: peso 1;
- feriado: peso 2;
- domingo especial: peso 3;
- evento especial: peso 3.

Esses pesos servem para balanceamento operacional e não substituem a regra financeira.

### 15.6 Alocação automática por ausência de resposta
Quem não preencher disponibilidade/preferência no prazo poderá ser alocado automaticamente, seguindo:
1. indisponibilidades reais registradas;
2. capacitação;
3. unidade;
4. histórico de carga no ciclo;
5. necessidade operacional da data.

### 15.7 Poderes da gestão na escala especial
- abrir e fechar janela de planejamento;
- editar manualmente a escala;
- forçar alocação em casos excepcionais;
- bloquear datas por férias, afastamento ou restrição operacional;
- acompanhar painel de equilíbrio.

### 15.8 Relação com substituições
Depois de fechada, a escala especial passa a integrar a agenda oficial. A partir daí, continuam valendo as regras normais de substituição, aceite, cancelamento, fechamento, auditoria e pagamento.

---

## 16. Férias de CLT e recesso de estagiários

O sistema deverá possuir bloco próprio para controle de férias e recesso.

### 16.1 Regras gerais
- CLT e estagiário não devem ser tratados como equivalentes;
- deve existir cadastro, solicitação, aprovação, alteração e cancelamento;
- como regra interna, o planejamento deve ocorrer preferencialmente com antecedência mínima de 45 dias;
- o sistema deve gerar alertas automáticos com 60, 45 e 30 dias de antecedência;
- alertas devem aparecer no sistema e também por e-mail.
- se já houver aulas ou escalas especiais atribuídas, o sistema deve apontar conflito e exigir redistribuição/cobertura.

### 16.2 Regras para estagiário
- o sistema deve controlar data de início do estágio;
- deve sinalizar proximidade do marco de 12 meses para programação do recesso;
- quando o estágio tiver duração igual ou superior a 12 meses, o recesso deve ser tratado como obrigatório;
- quando inferior, o sistema deve permitir cálculo proporcional do recesso, conforme parametrização administrativa;
- o recesso deve ser tratado como indisponibilidade legítima.
- o admistrador pode alterar essa regra em caso de exceção.

### 16.3 Regras para CLT
- permitir programação de férias com antecedência;
- registrar trilha de solicitação, aprovação, alteração e comunicação;
- férias aprovadas devem bloquear novas alocações no período;

### 16.4 Integração com agenda e escalas
Ao aprovar férias ou recesso:
- bloquear automaticamente a agenda do colaborador;
- retirar elegibilidade para escala especial no período;
- gerar pendência se já houver aula, evento ou escala atribuída;
- registrar tudo em auditoria.

### 16.5 Painel de gestão
O sistema deve oferecer painel com filtros por unidade, tipo de vínculo, período e status, mostrando:
- férias/recesso programados;
- férias/recesso próximos do vencimento;
- conflitos de escala no período.

---

## 17. Notificações

### 17.1 Fase inicial obrigatória
- notificação dentro do sistema.

### 17.2 Canais desejados
- sem necessidade de push no celular nesta fase;
- com necessidade de envio por e-mail.

### 17.3 Notificações mínimas - quem deve receber?
- nova solicitação de substituição; - envolvidos e perfil admin e Supervisão
- troca aceita; - envolvidos e perfil admin e Supervisão
- troca recusada; - envolvidos e perfil admin e Supervisão
- alteração relevante de agenda; - envolvidos e perfil admin e Supervisão
- aula sem cobertura confirmada; - perfil admin e Supervisão
- divergência entre agenda, horas e fechamento; - perfil admin e Supervisão
- fechamento disponível; - perfil admin e Supervisão
- recibo emitido; - perfil admin e Supervisão
- alertas de férias/recesso. - perfil admin e Supervisão

---

## 18. Alertas operacionais automáticos

O sistema deverá alertar, no mínimo:

- professor sem capacitação para a modalidade;
- professor já escalado em outra unidade no mesmo horário;
- solicitação pendente muito próxima do horário da aula;
- aula ainda sem cobertura confirmada;
- divergência entre agenda, horas e fechamento;
- conflitos gerados por férias ou recesso.

---

## 19. Motivos padronizados

Além do campo livre, o sistema deverá possuir categorias padronizadas para trocas, ajustes e cancelamentos.

Sugestões:
- compromisso pessoal;
- saúde;
- ajuste de escala;
- cobertura operacional;
- clima;
- evento;
- feriado;
- falta;
- erro de cadastro;
- outros.

---

## 20. Relatórios

### 20.1 Relatórios operacionais e financeiros mínimos
- horas por professor;
- horas por unidade;
- aulas por professor;
- substituições por período;
- substituições aceitas e recusadas;
- horas extras/excedentes;
- fechamento mensal;
- pagamentos emitidos;
- divergências entre agenda e fechamento;
- histórico de alterações.

### 20.2 Relatórios gerenciais adicionais
- ranking de quem mais solicita substituição;
- ranking de quem mais cobre aulas;
- taxa de trocas aceitas e recusadas por período;
- comparativo entre horas previstas e realizadas por professor;
- mapa de aulas descobertas ou com cobertura em aberto;
- distribuição de escalas especiais por pessoa e por unidade.

### 20.3 Filtros
- período;
- unidade;
- professor;
- modalidade;
- tipo de profissional;
- status da aula;
- status da substituição.

### 20.4 Exportação
- Excel;
- PDF.

---

## 21. Auditoria

Todas as ações relevantes deverão ser auditadas.

### 21.1 Eventos mínimos
- criação/edição/inativação de professor;
- criação/alteração de agenda;
- solicitação de troca;
- aceite;
- recusa;
- cancelamento;
- cobertura em aberto;
- ajuste manual de horas;
- validação do fechamento;
- emissão/cancelamento de recibo;
- abertura/fechamento/edição de escala especial;
- férias e recesso: solicitação, aprovação, alteração, cancelamento, bloqueios e redistribuições.

### 21.2 Campos mínimos do log
- usuário;
- perfil;
- data/hora;
- ação;
- entidade afetada;
- antes/depois;


---

## 22. Requisitos funcionais consolidados

- **RF01** — cadastrar professor com dados, tipo, unidade, modalidade e regra de pagamento;  
- **RF02** — manter agenda recorrente e agenda avulsa;  
- **RF03** — permitir edição de escala pelo administrador/gestão;  
- **RF04** — permitir visualização da própria agenda pelo professor;  
- **RF05** — permitir visualização da agenda geral pelo professor;  
- **RF06** — permitir visualização de todas as unidades;  
- **RF07** — exibir nome + modalidade + unidade na agenda geral;  
- **RF08** — exibir indicativo automático de “livre”;  
- **RF09** — permitir solicitação de substituição direta;  
- **RF10** — permitir cobertura em aberto sem substituto definido;  
- **RF11** — permitir aceite ou recusa do substituto;  
- **RF12** — transferir horas somente após aceite;  
- **RF13** — registrar histórico completo da troca/cobertura;  
- **RF14** — consolidar horas do mês;  
- **RF15** — permitir ajuste manual da gestão no fechamento;  
- **RF16** — congelar competência fechada, sem reabertura;  
- **RF17** — calcular pagamento do professor efetivo por hora, com feriado dobrado;  
- **RF18** — calcular pagamento do estagiário com limite configurável e excedente proporcional por minutos;  
- **RF19** — emitir recibos e registrar pagamento;  
- **RF20** — gerar relatórios operacionais e financeiros;  
- **RF21** — registrar auditoria completa;  
- **RF22** — permitir uso preferencialmente completo no celular para professor;  
- **RF23** — permitir operação do administrador em desktop e celular;  
- **RF24** — incluir bloco funcional de escala especial;  
- **RF25** — incluir bloco funcional de férias e recesso;
- **RF26** — exibir aba de dados salariais no cadastro do professor/estagiário com acesso exclusivo ao perfil Administrador, bloqueando visibilidade e edição para demais perfis.

---

## 23. Regras de negócio consolidadas

- **RN01** — a agenda geral do professor será somente leitura;  
- **RN02** — a agenda geral incluirá todas as unidades;  
- **RN03** — a agenda geral servirá como apoio operacional prévio;  
- **RN04** — a troca só terá validade após registro e aceite no sistema;  
- **RN05** — sem aceite, não haverá transferência de horas;  
- **RN06** — a gestão valida financeiramente no fechamento, sem bloquear a troca no dia a dia;  
- **RN07** — aula prevista não gera pagamento automático sem considerar status final;  
- **RN08** — a aula poderá ser considerada realizada automaticamente por padrão, com ajuste manual posterior se necessário;  
- **RN09** — ajustes manuais exigem justificativa e auditoria;  
- **RN10** — deve existir distinção clara entre substituição direta e cobertura em aberto;  
- **RN11** — a última configuração validamente registrada antes do fechamento prevalece;  
- **RN12** — o fechamento mensal não poderá ser reaberto;  
- **RN13** — professor efetivo recebe por hora simples, com feriado dobrado;  
- **RN14** — estagiário recebe bolsa fixa até limite configurado e excedente proporcional por minutos;  
- **RN15** — o sistema deve respeitar capacitação para modalidade;  
- **RN16** — o sistema deve gerar alertas operacionais automáticos;  
- **RN17** — o sistema deve registrar motivos padronizados e observação livre;  
- **RN18** — férias e recesso devem bloquear elegibilidade e agenda no período aprovado;
- **RN19** — dados salariais de professores e estagiários devem ser restritos ao perfil Administrador: nenhum outro perfil poderá visualizar, acessar ou editar essa aba.

---

## 24. Considerações finais para validação

Este documento consolida o escopo funcional atualmente entendido como válido para desenvolvimento.

A implementação deve seguir esta lógica consolidada, especialmente nos pontos abaixo:

- aula com status final controlado e auditável;
- troca direta e cobertura em aberto como fluxos distintos;
- fechamento congelado, sem reabertura;
- regra de estagiário com excedente proporcional por minutos;
- escala especial como módulo próprio;
- férias/recesso integrados à agenda e à elegibilidade;
- acompanhamento da gestão sem bloquear a operação do dia a dia.

Caso este documento seja validado, ele deverá ser tratado como **base funcional oficial da próxima etapa de desenvolvimento**.
