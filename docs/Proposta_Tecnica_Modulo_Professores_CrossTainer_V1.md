
# Especificação Técnica Detalhada: Módulo Professores – CrossTainer V1

Esta especificação técnica detalhada foi elaborada com base no documento funcional aprovado e na análise minuciosa do código-fonte (Vanilla JavaScript + HTML + CSS + Firebase Compat SDK) do sistema "CrossTainer Comissões" em sua versão atual.

A premissa absoluta deste documento é a **reutilização da arquitetura existente, sem quebra do funcionamento em produção**, garantindo a segregação de módulos (Comissões vs. Professores) e o suporte a múltiplos perfis por usuário.

---

## 1. Arquitetura do Sistema

**[EVIDÊNCIA]** O sistema atual é uma SPA (Single Page Application) construída puramente em HTML, CSS e Vanilla JavaScript. O controle de estado de tela é feito via manipulação de classes CSS (`.active`, `display: block/none`). O backend é 100% Serverless utilizando **Firebase (Auth e Firestore)** via CDN (versão 10.12.0). Utiliza bibliotecas externas carregadas via CDN apenas para gráficos (Chart.js) e planilhas (SheetJS).

**[PROPOSTA]** A arquitetura será mantida integralmente. O novo módulo existirá dentro da mesma SPA, adicionando novas `div.page` ocultadas/exibidas pelo mecanismo de roteamento atual (`navigateTo`).
*   **Backend / Banco de Dados:** Continua utilizando Firebase Firestore.
*   **Autenticação:** Mantida no Firebase Auth.
*   **Envio de E-mail (Notificações):** Como o Vanilla JS no client-side não pode enviar e-mails diretamente com segurança, será necessária a criação de **Firebase Cloud Functions** (Node.js) atreladas a triggers do Firestore (ex: ao criar um documento na coleção `notificacoes`, a trigger dispara o e-mail via SendGrid/Sendinblue/SMTP).

---

## 2. Modelo de Dados Detalhado

**[EVIDÊNCIA]** O sistema atual utiliza coleções raiz como `users`, `units`, `periodos`. Não possui banco relacional; as junções são feitas no Client-Side (JS).

**[PROPOSTA]** O modelo será estendido aproveitando a estrutura NoSQL do Firestore.

### 2.1. Coleção `users` (Atualizada)
Para suportar **múltiplos perfis** e **segregação de módulos**.
```json
{
  "name": "João Silva",
  "email": "joao@email.com",
  "roles":["professor", "vendedor"], // [PROPOSTA] Transição de 'role' (string) para 'roles' (array)
  "allowedUnits": ["unit1", "unit2"],
  "status": "ativo",
  "dadosBancarios": { "chavePix": "...", "cpf": "..." },
  // Dados específicos do RH (apenas admin/gestão podem ler/gravar)
  "rh": {
    "tipoContrato": "CLT" | "Estagiario" | "PJ",
    "valorHora": 50.00,
    "bolsaFixa": 800.00, // Para estagiários
    "limiteHorasMensal": 120, // Para cálculo de excedente estagiário
    "modalidadesAptas":["CrossTraining", "LPO"]
  }
}
```

### 2.2. Coleção `agenda_aulas`
Armazena a grade de aulas. Em vez de recursão infinita, padroniza-se gerar a grade num horizonte rolante ou armazenar o "padrão" e instanciar as aulas mês a mês.
```json
{
  "unitId": "unit1",
  "dataHoraInicio": "2026-04-25T08:00:00-03:00", // ISO String
  "dataHoraFim": "2026-04-25T09:00:00-03:00",
  "modalidade": "CrossTraining",
  "professorTitularId": "uid_joao",
  "professorRealizadoId": "uid_joao", // Pode mudar se houver substituição
  "status": "prevista" | "realizada" | "cancelada" | "nao_realizada" | "substituida",
  "pesoEspecial": 1 // 1 (normal/sábado), 2 (feriado), 3 (domingo/evento)
}
```

### 2.3. Coleção `substituicoes`
Rastreia o ciclo de vida das trocas.
```json
{
  "aulaId": "doc_id_da_aula",
  "unitId": "unit1",
  "solicitanteId": "uid_joao",
  "substitutoSugeridoId": "uid_maria", // Null se for "cobertura em aberto"
  "status": "pendente" | "aceita" | "recusada" | "cancelada" | "aprovada_gestao",
  "dataSolicitacao": "timestamp",
  "dataResposta": "timestamp"
}
```

### 2.4. Coleção `ferias_recessos`
```json
{
  "professorId": "uid_joao",
  "dataInicio": "2026-05-01",
  "dataFim": "2026-05-30",
  "tipo": "ferias" | "recesso",
  "status": "aprovado" | "pendente"
}
```

### 2.5. Coleção `fechamentos_professores` (Análogo à coleção `periodos`)
Congelamento da competência financeira.
```json
{
  "unitId": "unit1",
  "ano": 2026,
  "mes": 4,
  "status": "fechado",
  "dataFechamento": "timestamp",
  "fechadoPor": "uid_admin",
  "demonstrativos": {
    "uid_joao": {
      "aulasPrevistas": 40,
      "aulasRealizadas": 38,
      "substituicoesFeitas": 2,
      "valorAulasNormais": 1900.00,
      "valorAulasEspeciais": 200.00, // feriados (peso 2)
      "valorExcedenteEstagiario": 0,
      "totalBruto": 2100.00
    }
  }
}
```

---

## 3. Especificação de API / Funções / Serviços

**[EVIDÊNCIA]** Não existe backend próprio, apenas chamadas diretas via `firebase.firestore()`. As regras de negócio de comissão rodam no `CommissionEngine` no cliente.

**[PROPOSTA]**
Para o Módulo Professores, as consultas continuarão via Firebase Client SDK. Criaremos um objeto `ProfessorEngine` no front-end para isolar lógicas de cálculo e calendário.

**Novos Serviços (Firebase Cloud Functions necessárias):**
1.  `sendEmailNotification(to, subject, template, data)`: Disparada por Triggers do Firestore ao criar docs na coleção `notificacoes`. Necessário para cumprir o requisito funcional de envio de e-mails.

**Funções do `ProfessorEngine` (Front-end):**
*   `getGradeSemanal(unitId, dataReferencia)`: Busca aulas no range de 7 dias.
*   `checkDisponibilidadeProfessor(professorId, dataHoraInicio, dataHoraFim)`: Verifica choque de horários na coleção `agenda_aulas` e `ferias_recessos`.
*   `calcularFolhaProfessor(professorId, mes, ano)`: Calcula valor-hora, dobra de feriados, excedentes de estagiários (ver item 9).

---

## 4. Componentes Frontend

**[EVIDÊNCIA]** A UI é montada criando `div.page` no HTML e manipulando o display via JavaScript. Modais compartilham a classe `.modal`.

**[PROPOSTA]**
Novos componentes (Pages) mapeados:

*   `page-prof-agenda-geral`: Visão de calendário da unidade (Grid CSS). Acesso: Gestão, Supervisão, Professores.
*   `page-prof-minha-agenda`: Visão focada nas aulas do usuário logado e painel de "Coberturas em Aberto". Acesso: Professores, Estagiários.
*   `page-prof-gestao-equipe`: Cadastro de professores, RH, definição de modalidades aptas. Acesso: Gestão, Supervisão (leitura).
*   `page-prof-ferias-escalas`: Painel para agendamento de sábados, feriados, domingo e gestão de férias.
*   `page-prof-fechamento`: Tela semelhante ao *Dashboard de Comissões*, mas calculando holerites. Botão "Travar Competência". Acesso: Gestão exclusiva.

**Modais (Reaproveitamento de `.modal`):**
*   `modal-substituicao`: Formulário para pedir troca direta ou jogar para "cobertura em aberto".
*   `modal-aceite-troca`: Modal de confirmação (Aceitar/Recusar) para o professor substituto.

---

## 5. Hooks / Serviços / Camadas de Acesso a Dados

**[EVIDÊNCIA]** O acesso a dados ocorre solto dentro das funções da interface (ex: `loadPeriod()`). O cache é feito em variáveis globais (ex: `globalPeriodsCache`).

**[PROPOSTA]**
Padronizar as chamadas do Módulo Professores em funções dedicadas no topo do script ou em um arquivo `professores.js`:
*   `fetchAgendaAulas(unitId, startDate, endDate)`
*   `createSubstituicao(data)`
*   `confirmarFechamentoMensalProfessores(unitId, ano, mes)`

**[A DEFINIR]** O código atual injeta dependências no arquivo principal. Devemos definir se o código do novo módulo será um arquivo separado (ex: `professores.js`) anexado no final do `<body>` para evitar inchar o arquivo principal HTML. É altamente recomendado.

---

## 6. State Management

**[EVIDÊNCIA]** Uso massivo de variáveis no escopo da `window` (ex: `window.currentPeriodData`).

**[PROPOSTA]**
Para não quebrar a padronagem:
```javascript
let globalAgendaCache = {}; // armazena dados da agenda da semana corrente
let currentViewDate = new Date();
let userProfessorProfile = null; // cache dos dados de RH do usuário logado
```

---

## 7. Roteamento e Navegação

**[EVIDÊNCIA]** Navegação controlada pela função `navigateTo(page)` e menus renderizados dinamicamente via `buildSidebar()`.

**[PROPOSTA]**
Modificar `buildSidebar()` para agrupar módulos dependendo do array `userProfile.roles`.
```javascript
function buildSidebar() {
  const roles = userProfile.roles || [userProfile.role];
  const isGestao = roles.includes('admin');
  const isVendedor = roles.includes('vendedor');
  const isProfessor = roles.includes('professor') || roles.includes('professor_estagiario');
  const isSupervisao = roles.includes('supervisao');

  let html = '';

  // Segregação: Módulo Comissões
  if (isGestao || isVendedor) {
      html += '<div class="sb-section">Módulo Comissões</div>';
      if (isGestao) html += sbItem('dashboard', '📊', 'Gestão Vendas');
      if (isVendedor) html += sbItem('meu-painel', '💰', 'Minhas Comissões');
  }

  // Segregação: Módulo Professores
  if (isGestao || isProfessor || isSupervisao) {
      html += '<div class="sb-section">Módulo Professores</div>';
      html += sbItem('prof-agenda-geral', '🗓️', 'Agenda Unidade');
      
      if (isProfessor) {
          html += sbItem('prof-minha-agenda', '👤', 'Minha Agenda & Trocas');
      }
      
      if (isGestao || isSupervisao) {
          html += sbItem('prof-gestao-equipe', '👥', 'Gestão de Equipe');
          html += sbItem('prof-ferias-escalas', '⛱️', 'Férias & Escalas');
      }
      
      if (isGestao) {
          html += sbItem('prof-fechamento', '🔒', 'Fechamento Mensal');
      }
  }
  // ... resto do código
}
```

---

## 8. Autenticação e Autorização

**[EVIDÊNCIA]** Usa `firebase.auth().onAuthStateChanged`.
**[PROPOSTA]**
O controle de múltiplo perfil é vital.
A transição de string (`role: 'admin'`) para array (`roles:['admin', 'professor']`) será tratada com fallback para evitar quebra do sistema legado:
```javascript
// Migration & Fallback na checagem de perfil
const userRoles = Array.isArray(userProfile.roles) ? userProfile.roles :[userProfile.role];
```
Se um usuário for `vendedor` e `professor` ao mesmo tempo, ele verá a "Módulo Comissões" como vendedor e o "Módulo Professores" como professor. Eles não se misturam em telas.

---

## 9. Validações e Schemas

**[PROPOSTA] Regras Funcionais Formalizadas em JS:**

**A. Cálculo de Pagamento Estagiário:**
```javascript
function calcularHoleriteEstagiario(minutosRealizados, limiteMensalHoras, bolsaFixa) {
    const limiteMinutos = limiteMensalHoras * 60;
    let valorExcedente = 0;
    
    if (minutosRealizados > limiteMinutos) {
        const minutosExcedentes = minutosRealizados - limiteMinutos;
        const valorHoraProporcional = bolsaFixa / limiteMensalHoras;
        valorExcedente = (minutosExcedentes / 60) * valorHoraProporcional;
    }
    
    return bolsaFixa + valorExcedente;
}
```

**B. Validação de Aceite de Troca:**
O aceite só pode ser feito se:
1. `new Date() < aula.dataHoraInicio`
2. O substituto não tem aula agendada (choque de horário).
3. O substituto tem no seu perfil de RH a `modalidade` da aula dentro de `modalidadesAptas`.

---

## 10. Tratamento de Erros

**[EVIDÊNCIA]** Função utilitária `toast(msg, type)` e painéis de `.error-msg`.
**[PROPOSTA]**
A mecânica permanece inalterada. Casos de choque de agenda ou tentativa de aceite fora do prazo dispararão um `toast('Troca não permitida: horário ultrapassado ou conflito de agenda.', 'error')`.

---

## 11. Performance

**[EVIDÊNCIA]** As atualizações em lote (`db.batch()`) são amplamente utilizadas na engine atual.
**[PROPOSTA]**
Na "Virada de Mês" do módulo professores (criação da grade mensal recorrente baseada num template), usaremos `db.batch()` limitando a 400 escritas por lote para popular os documentos em `agenda_aulas` mantendo alta performance.

---

## 12. Segurança

**[EVIDÊNCIA]** A segurança depende da configuração do banco. Atualmente as regras de Firestore não foram enviadas, mas inferimos que o client-side restringe telas.
**[PROPOSTA]**
**Regras do Firestore (Security Rules) obrigatórias:**
Como o front-end é vulnerável, devemos evitar que um `vendedor` execute consultas no nó de `fechamentos_professores`.
```javascript
// Exemplo conceitual para Firestore Rules
match /fechamentos_professores/{document} {
  // Apenas quem possui 'admin' no array de roles pode ler e escrever
  allow read, write: if 'admin' in get(/databases/$(database)/documents/users/$(request.auth.uid)).data.roles;
}
match /agenda_aulas/{document} {
  // Professores, Gestão e Supervisão podem ler.
  allow read: if hasProfessorModuleAccess(request.auth.uid);
  allow write: if 'admin' in getUserRoles(request.auth.uid) || 'supervisao' in getUserRoles(request.auth.uid);
}
```

---

## 13. Testes

**Não aplicável para a stack atual identificada.**
O código submetido é estruturado via arquivos HTML monolitizados, sem infraestrutura de testes automatizados (Jest, Mocha, Cypress) configurada no package.json (que também está ausente). Testes deverão ser manuais baseados nos *Critérios de Aceite* do documento funcional.

---

## 14. Deploy e Infraestrutura

**[EVIDÊNCIA]** Hospedagem padrão Firebase / web hosting com Service Worker ativo (PWA) e cacheamento.
**[PROPOSTA]**
Sem alterações. O update do SW (`sw.js`) contido no arquivo cuidará da invalidação de cache e exigirá que as máquinas recarreguem o HTML ao identificar nova versão (`APP_VERSION` precisará ser incrementado de `'3.0'` para `'4.0'`).

---

## 15. Exemplos de Código Completos

### Exemplo 1: Adaptação do `navigateTo` com Segregação Rígida

```javascript
// Adaptação da função existente para blindar acessos indevidos
function navigateTo(page) {
    const isMobile = window.innerWidth <= 768;
    const roles = userProfile?.roles || [userProfile?.role]; // Fallback
    
    const isGestao = roles.includes('admin') || roles.includes('gestao');
    const isVendedor = roles.includes('vendedor');
    const isProf = roles.includes('professor') || roles.includes('professor_estagiario');
    const isSuperv = roles.includes('supervisao');

    // Matriz de Controle de Acesso
    const ACL = {
        'dashboard': isGestao,
        'meu-painel': isVendedor,
        'prof-agenda-geral': isGestao || isSuperv || isProf,
        'prof-minha-agenda': isProf,
        'prof-fechamento': isGestao,
        //...
    };

    if (ACL[page] === false && !userProfile._previewMode) {
        console.warn(`[ACL] Acesso negado a "${page}".`);
        // Redirecionamento de segurança
        page = isGestao ? 'dashboard' : (isVendedor ? 'meu-painel' : 'prof-agenda-geral');
    }

    // Código original mantido
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    
    // Refresh states se necessário...
    if(page === 'prof-agenda-geral') loadAgendaGeral();
}
```

### Exemplo 2: Auditoria Extendida para Professores

```javascript
// Reutilização da função logAudit existente
async function confirmarFechamentoProfessores(periodoId, totals) {
    if(!confirm('O fechamento não pode ser desfeito. Confirmar?')) return;
    
    try {
        await db.collection('fechamentos_professores').doc(periodoId).update({
            status: 'fechado',
            dataFechamento: firebase.firestore.FieldValue.serverTimestamp(),
            fechadoPor: currentUser.uid
        });
        
        toast('Competência fechada com sucesso!', 'success');
        
        // Chamada direta à função herdada
        logAudit('prof_fechamento', `Fechamento de professores concluído: ${periodoId}. Total Pago: R$ ${totals}`);
        
    } catch(e) {
        toast('Erro no fechamento: ' + e.message, 'error');
    }
}
```

---

## 16. Metodologia de Implementação / Roadmap Técnico

### Matriz de Rastreabilidade

| Requisito Funcional | Evidência Código Atual | Proposta Técnica | Status / Notas |
| :--- | :--- | :--- | :--- |
| Múltiplos Perfis | `role` string em auth | Migrar `role` para `roles` array (Retrocompatibilidade garantida). | Implementar na Auth. |
| Agenda Geral | Não existe | Nova `page-prof-agenda-geral` com Vanilla CSS Grid. Firebase real-time onSnapshot. | Ler coleções `agenda_aulas`. |
| Lógica Estagiário (Excedente) | Módulo comissões JS | `calcularHoleriteEstagiario` injetado na Engine de Professores. | Matemático JS puro. |
| Substituições (Aceite) | Modais `div.modal` | Reutilizar UX de modais. Checar `< Date.now()` antes do write. | Validação no client + Rule. |
| Fechamento Congelado | `deletePeriod` (comissões) | Em Professores, status `fechado` bloqueia updates UI/DB. Sem delete/reopen. | Diferente de Comissões. |
| Notificações Email | **[A DEFINIR]** Ausente | Criar Firebase Cloud Function via SMTP. | Depende de config GCP externa. |

### Backlog Técnico (Fases de Entrega)

*   **Fase 1: Infraestrutura Básica e Modelagem**
    *   Script de migração para transformar `role` em `roles`.
    *   Criação das coleções `agenda_aulas`, `substituicoes` no Firestore.
    *   Deploy de Firestore Rules segregando coleções.
*   **Fase 2: Estrutura UI e Gestão de Pessoas**
    *   Atualizar `buildSidebar` e `navigateTo` com regras ACL.
    *   Criar UI de gestão de RH (cadastro do professor, valor-hora, modalidades aptas).
*   **Fase 3: Operação de Agenda e Trocas**
    *   Criar visualização do calendário (CSS Grid base).
    *   Implementar fluxo de `Substituição Direta` e `Cobertura em Aberto` com modais.
    *   Regras de trava temporal (não aceitar troca no passado).
*   **Fase 4: Financeiro e Fechamento**
    *   Engine de cálculo (dobra feriado, regras de estagiário, pesos especiais).
    *   Tela restrita para Gestão trancar o mês e gerar relatórios financeiros/recibos (usando a base visual do recibo atual que foi impresso).
*   **Fase 5: Férias, Alertas e E-mails**
    *   Desenvolvimento do Firebase Cloud Function Node.js (se aprovado o custo infra) para e-mail.
    *   Lógica de bloqueio de agenda nos blocos de recesso aprovados.