# Especificação Técnica Detalhada
## Módulo de Professores, Agenda, Substituições, Escalas, Fechamento e Pagamentos
**Cliente:** Rodrigo — CrossTainer  
**Versão:** V1 — Draft para validação técnica  
**Data:** 23/04/2026  
**Base funcional:** Proposta_Funcional_Consolidada_Modulo_Professores_CrossTainer_V3.md  
**Base de código:** crosstrainer-comissoes/index.html (10.829 linhas) + commission.js + sw.js  

---

## DIAGNÓSTICO TÉCNICO DO SISTEMA ATUAL

### Stack evidenciada no código

| Camada | Tecnologia | Evidência |
|--------|-----------|-----------|
| Frontend | HTML5 + Vanilla JavaScript ES6+ | `index.html` (10.829 linhas), sem framework |
| Backend/BaaS | Firebase compat SDK v10.12.0 | `firebase-app-compat.js`, `firebase-auth-compat.js`, `firebase-firestore-compat.js` |
| Banco de dados | Cloud Firestore (NoSQL) | `firebase.firestore()` |
| Autenticação | Firebase Authentication (email/password) | `auth.signInWithEmailAndPassword` |
| Gráficos | Chart.js v4.4.0 | script CDN no `<head>` |
| Excel | XLSX.js v0.18.5 | script CDN no `<head>` |
| Tipografia | Bebas Neue + DM Sans + JetBrains Mono | Google Fonts CDN |
| PWA | Service Worker + Web App Manifest | `sw.js`, `manifest.json` |
| Deploy | Hospedagem estática (sem Firebase CLI identificado) | Ausência de `firebase.json`, `.firebaserc`, `firestore.rules` |
| Tema | Dark/Light mode via CSS Custom Properties | classe `html.light`, `localStorage('ct_theme')` |

### Coleções Firestore identificadas

| Coleção | Estrutura de campos observada | Uso atual |
|---------|------------------------------|-----------|
| `users/{uid}` | `name, email, role, allowedUnits[], unitId, status, createdAt` | Perfis de usuário |
| `units/{unitId}` | `name, config: CommissionEngine.defaultConfig` | Unidades e config de comissão |
| `periodos/{periodId}` | Dados de período mensal | Fechamento de comissões |
| `periodos/{id}/itens/{itemId}` | Registros de venda individuais | Lançamentos |
| `comissoes_diferidas` | Comissões com voucher diferido | Créditos futuros |
| `audit_log` | `type, details, userId, userName, unitId, timestamp` | Log de auditoria |

### Estrutura atual do documento `users/{uid}`

```json
{
  "name": "string",
  "email": "string",
  "role": "admin | vendedor",
  "allowedUnits": ["cp", "..."],
  "unitId": "cp",
  "status": "ativo",
  "createdAt": "Timestamp"
}
```

**Limitação crítica:** `role` é campo único (string simples). Não suporta múltiplos perfis por usuário. Não existe `moduleAccess{}`. O sistema de perfis do módulo de professores exige evolução estrutural neste documento.

### Perfis atualmente implementados

| Perfil | Slug | Páginas permitidas |
|--------|------|--------------------|
| Administrador | `admin` | dashboard, comparativo, upload, users, units, audit, settings, pagamentos |
| Vendedor(a) | `vendedor` | meu-painel, comparativo |

**Não existem** os perfis `admin_gestao`, `supervisao`, `professor`, `professor_estagiario`.

### Navegação atual (`buildSidebar()`)

```
Admin sidebar: Gestão | Admin | Ferramentas
  → dashboard, comparativo, upload
  → users, units, audit, settings, pagamentos

Vendedor sidebar: Meu Espaço
  → meu-painel
```

Guard de rota via array literal: `ADMIN_PAGES`, `VENDOR_PAGES`. Precisa ser refatorado para suportar `moduleAccess{}` dinâmico.

### Auditoria atual

- **Coleção:** `audit_log`
- **Campos:** `type, details (string), userId, userName, unitId, timestamp`
- **Ausências:** sem `before/after`, sem `role`, sem `module`, sem `entityType/entityId`
- **Limitação:** `details` é string livre — não é consultável granularmente

### Notificações existentes

**Nenhuma.** O sistema atual não possui notificações internas nem envio de email.

### Padrões reutilizáveis identificados

| Padrão | Localização | Reutilizável |
|--------|------------|-------------|
| CSS Custom Properties (design tokens) | `:root { --bg, --surface, --orange... }` | ✅ total |
| Sidebar + página `.page / .page.active` | `buildSidebar()`, `.sb-item` | ✅ com extensão |
| Toast notifications | `toast(msg, type)` | ✅ total |
| Componente `.upload-zone` | CSS + HTML | ✅ total |
| Componente `.table-wrap` + `thead/tbody` | CSS + HTML | ✅ total |
| Componente `.stat-card` / `.kpi-hero` | CSS + HTML | ✅ total |
| `.btn`, `.btn-ghost`, `.btn-sm`, `.btn-danger` | CSS | ✅ total |
| `.input-group`, `.login-box` | CSS + HTML | ✅ total |
| Mobile toggle + bottom nav | CSS + JS | ✅ com adaptação |
| `logAudit(type, details)` | função JS | ✅ com extensão |
| `fmt(n)` — formatação monetária | função JS | ✅ total |
| `firebase.firestore()` + `firebase.auth()` | inicialização | ✅ compartilhável |

### Limitações técnicas reais

1. `index.html` tem 10.829 linhas — extensão direta cria risco alto de regressão
2. `role` é string única — exige migração para suportar `profiles[]`
3. Sem Firebase Security Rules configuradas no repositório — acesso ao Firestore potencialmente aberto
4. Sem Firebase CLI (`firebase.json`) — deploy manual, sem ambiente de staging controlado
5. Sem separação de módulos JS — todo o código está inline no HTML
6. Auditoria sem before/after — insuficiente para o novo módulo
7. Sem Cloud Functions — lógica de negócio complexa (fechamento, cálculo, email) não tem onde rodar
8. Sem Firebase Storage — necessário para recibos PDF

---

## MAPEAMENTO DE ADERÊNCIA AO FUNCIONAL

### O que já existe e pode ser reaproveitado

| Item | Evidência no código |
|------|-------------------|
| Firebase Auth (email/password) | `auth.signInWithEmailAndPassword` |
| Gerenciamento de usuários (`users` collection) | `db.collection('users')` |
| Gestão de unidades (`units` collection) | `db.collection('units')` |
| Auditoria básica (`audit_log`) | `logAudit()` |
| Design system completo (CSS variables, componentes) | `:root`, `.btn`, `.table-wrap`, etc. |
| PWA (offline-first para telas estáticas) | `sw.js` |
| Recibos (módulo de comissões) | `pagamentos` page — padrão reutilizável |
| Exportação Excel (XLSX.js) | `exportExcel()` |
| Seleção de unidade | `currentUnitId`, `renderQuickUnitSelector()` |

### O que precisa ser estendido

| Item | O que falta |
|------|-------------|
| `users/{uid}` | Campos `profiles[]`, `moduleAccess{}`, `professorId` |
| `buildSidebar()` | Suporte a `moduleAccess{}` dinâmico |
| `navigateTo()` | Guard por `moduleAccess{}` ao invés de role string |
| `audit_log` | Campos `module`, `entityType`, `entityId`, `before`, `after`, `role` |
| `logAudit()` | Suporte aos novos campos |

### O que precisa ser criado

| Item | Motivo |
|------|--------|
| `professores.html` | Novo módulo separado (estratégia de isolamento) |
| `firebase-config.js` | Config Firebase compartilhada entre páginas |
| Coleções Firestore (12 novas) | Modelo de dados do módulo de professores |
| Cloud Functions | Fechamento atômico, cálculo de pagamento, email, PDF |
| Firebase Security Rules | Segregação de módulos, dados salariais restritos |
| Firebase Storage | Armazenamento de recibos PDF |
| Firebase Extension "Trigger Email" | Notificações por email |

### O que exige refatoração

| Item | Impacto | Risco |
|------|---------|-------|
| Campo `role` → `profiles[]` | Migração de documentos `users` | Médio — backward compatible |
| `buildSidebar()` | Extensão da lógica de navegação | Baixo — adição, não substituição |
| `navigateTo()` guards | Extensão do array de páginas por módulo | Baixo |
| `logAudit()` | Adicionar campos opcionais | Baixo — backward compatible |

### O que exige migração de modelo

| Item | Ação |
|------|------|
| Todos os docs `users` existentes | Adicionar `profiles: [role_atual]`, `moduleAccess: { comissoes: true }` |
| Criar docs `teacher_salaries` | Para professores com dados salariais |
| Criar docs `modalities` | Seed inicial das modalidades CrossTainer |
| Criar docs `special_scale_types` | Seed dos 4 tipos com pesos |

---

## 1. ARQUITETURA DO SISTEMA

### 1.1 Visão geral

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTE (Browser / PWA)               │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │  index.html      │    │  professores.html         │   │
│  │  (Comissões)     │    │  (Professores — NOVO)     │   │
│  │  [inalterado]    │    │  [arquivo separado]       │   │
│  └────────┬─────────┘    └────────────┬─────────────┘   │
│           │                           │                  │
│           └──────────┬────────────────┘                  │
│                      │                                   │
│              firebase-config.js                          │
│              (auth, db compartilhados)                   │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────┐
│                  FIREBASE (GCP)                          │
│                                                          │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Firebase   │  │  Firestore   │  │  Cloud Functions  │ │
│  │ Auth       │  │  (NoSQL DB)  │  │  (Node.js)        │ │
│  │            │  │              │  │                   │ │
│  │ email/pass │  │ 6 coleções   │  │ - closeMonth()    │ │
│  │ JWT tokens │  │ existentes + │  │ - calcPayment()   │ │
│  │            │  │ 12 novas     │  │ - sendEmail()     │ │
│  └────────────┘  └──────────────┘  │ - generatePDF()   │ │
│                                    │ - vacationAlerts()│ │
│  ┌────────────┐  ┌──────────────┐  └──────────────────┘ │
│  │ Firebase   │  │  Firestore   │                        │
│  │ Storage    │  │  Security    │                        │
│  │ (PDFs)     │  │  Rules       │                        │
│  └────────────┘  └──────────────┘                        │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Firebase Extension: Trigger Email (SendGrid/SMTP)  │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 1.2 Estratégia de reaproveitamento

**Decisão: criar `professores.html` como arquivo separado.**

Justificativa técnica:
- `index.html` já tem 10.829 linhas de código inline — adicionar o módulo de professores no mesmo arquivo aumentaria para ~20.000 linhas, tornando manutenção inviável
- Risco de regressão no módulo de comissões é alto
- Firebase Auth mantém sessão entre páginas do mesmo domínio automaticamente — não há perda de contexto
- Permite desenvolvimento, deploy e teste independentes por módulo
- `firebase-config.js` compartilha a inicialização do Firebase (auth + db) entre as páginas

**O que NÃO será alterado em `index.html`:**
- Toda a lógica de comissões (P1-P4)
- Toda a UI de comissões
- Upload e processamento de Excel
- Pagamentos de vendedores
- Estrutura das coleções `periodos`, `comissoes_diferidas`

**O que SERÁ adicionado a `index.html` (cirurgicamente):**
- Suporte a `moduleAccess{}` em `buildSidebar()` — adicionar link para módulo de professores se autorizado
- Suporte a `profiles[]` na exibição de role no sidebar
- `logAudit()` com campo `module` opcional

### 1.3 Arquivos a criar

```
crosstrainer-comissoes/
├── index.html              (existente — alterações mínimas)
├── commission.js           (existente — sem alteração)
├── sw.js                   (existente — atualizar STATIC_ASSETS)
├── manifest.json           (existente — sem alteração)
├── firebase-config.js      (NOVO — config compartilhada)
├── professores.html        (NOVO — módulo de professores)
├── professores.js          (NOVO — lógica do módulo)
├── professores-agenda.js   (NOVO — componente de agenda)
├── professores-subs.js     (NOVO — substituições e coberturas)
├── professores-fechamento.js (NOVO — fechamento e pagamento)
└── functions/              (NOVO — Cloud Functions)
    ├── index.js
    ├── closeMonth.js
    ├── calculatePayment.js
    ├── generateReceipt.js
    ├── notifications.js
    └── vacationAlerts.js
```

---

## 2. MODELO DE DADOS DETALHADO

### 2.1 Evolução de `users/{uid}` (backward compatible)

```js
// CAMPOS EXISTENTES (mantidos intactos)
{
  name: string,
  email: string,
  role: 'admin' | 'vendedor',           // MANTIDO para backward compat
  allowedUnits: string[],
  unitId: string,
  status: 'ativo' | 'inativo',
  createdAt: Timestamp,

  // CAMPOS NOVOS (adicionados progressivamente)
  profiles: string[],                    // ['admin', 'admin_gestao'] | ['vendedor'] | ['professor']
  moduleAccess: {
    comissoes: boolean,
    professores: boolean,
  },
  professorId: string | null,            // ref a teachers/{id}, se aplicável
  updatedAt: Timestamp,
}
```

**Regra de migração:** ao carregar `userProfile` em `onAuthStateChanged`, se `profiles` não existir, inferir de `role`:
- `role === 'admin'` → `profiles: ['admin']`, `moduleAccess: { comissoes: true, professores: true }`
- `role === 'vendedor'` → `profiles: ['vendedor']`, `moduleAccess: { comissoes: true, professores: false }`

### 2.2 Nova coleção: `teachers/{teacherId}`

```js
{
  // Identidade
  userId: string,                        // ref a users/{uid}
  name: string,
  email: string,
  phone: string,
  cpf: string,                           // armazenado mascarado: '***.456.789-**' ✅ P05

  // Vínculo profissional
  type: 'efetivo' | 'estagiario' | 'eventual',
  unitIds: string[],                     // unidades onde atua
  primaryUnitId: string,
  modalityIds: string[],                 // modalidades habilitadas

  // Contrato
  hireDate: Timestamp,
  contractEndDate: Timestamp | null,     // para estagiários
  internshipStartDate: Timestamp | null, // para controle dos 12 meses

  // Status
  isActive: boolean,
  notes: string,

  // Auditoria
  createdAt: Timestamp,
  createdBy: string,                     // userId
  updatedAt: Timestamp,
  updatedBy: string,
}
```

> ⚠️ **Dados salariais NÃO estão neste documento.** Estão em coleção separada `teacher_salaries/{teacherId}` para permitir isolamento via Security Rules (Firestore não suporta regras por campo).

### 2.3 Nova coleção: `teacher_salaries/{teacherId}` ⛔ RESTRITA AO ADMIN

```js
{
  teacherId: string,
  remunerationType: 'hora_aula' | 'bolsa' | 'misto',

  // Professor efetivo
  hourlyRate: number,                    // valor R$/hora

  // Estagiário
  internMonthlyStipend: number,          // bolsa fixa mensal (R$)
  internMonthlyLimitHours: number,       // limite mensal em horas
  internMonthlyLimitMinutes: number,     // derivado: limitHours × 60
  internProportionalHourlyRate: number,  // valor R$/hora para excedente

  // Histórico de alterações
  salaryHistory: [
    {
      changedAt: Timestamp,
      changedBy: string,                 // userId
      changedByName: string,
      field: string,
      previousValue: number,
      newValue: number,
    }
  ],

  updatedAt: Timestamp,
  updatedBy: string,
}
```

### 2.4 Nova coleção: `modalities/{modalityId}`

```js
{
  name: string,                          // ex: 'CrossFit', 'Corrida', 'Yoga'
  description: string,
  isActive: boolean,
  createdAt: Timestamp,
  createdBy: string,
}
```

**Seed inicial:** nenhum — lista gerenciada pelo admin via interface. Admin cadastra as modalidades reais ao subir o sistema. ✅ Decisão P01 — 23/04/2026

**Decisão de UI 07/05/2026:** modalidades têm **tela própria** dedicada (CRUD), reaproveitando o padrão visual da tela de `units` em `index.html`. A aba "Modalidades" dentro do Cadastro de Professores serve apenas para **selecionar** quais modalidades o professor é apto a ministrar (multi-select de `modalityIds[]`).

### 2.5 Nova coleção: `schedule_templates/{templateId}`

```js
{
  unitId: string,
  name: string,                          // ex: 'Grade Padrão CP — Abr/2026'
  isActive: boolean,
  validFrom: Timestamp,
  validTo: Timestamp | null,
  createdBy: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

### 2.6 Nova coleção: `schedule_slots/{slotId}`

```js
{
  templateId: string,
  unitId: string,
  weekday: number,                       // 0=Dom, 1=Seg, ..., 6=Sáb
  startTime: string,                     // 'HH:MM'
  endTime: string,                       // 'HH:MM'
  durationMinutes: number,               // calculado
  modalityId: string,
  teacherId: string,
  isActive: boolean,
  notes: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  updatedBy: string,
}
```

### 2.7 Nova coleção: `classes/{classId}`

Instâncias de aula geradas a partir dos slots (ou criadas avulsas).

```js
{
  slotId: string | null,                 // null = aula avulsa
  templateId: string | null,
  unitId: string,

  // Professor
  teacherId: string,                     // professor ATUAL (pode ser substituto)
  originalTeacherId: string,             // professor original do slot

  // Horário
  modalityId: string,
  scheduledDate: Timestamp,             // data exata da aula
  startTime: string,                    // 'HH:MM'
  endTime: string,                      // 'HH:MM'
  durationMinutes: number,

  // Status
  status: 'prevista' | 'realizada' | 'cancelada' | 'nao_realizada' | 'substituida',
  isHoliday: boolean,
  holidayName: string | null,
  holidayType: 'municipal' | 'estadual' | 'nacional' | null,

  // Cancelamento
  cancellationReason: string | null,    // motivo padronizado
  cancellationNote: string | null,      // observação livre

  // Ajuste manual
  adjustedBy: string | null,           // userId
  adjustedAt: Timestamp | null,
  adjustmentNote: string | null,

  // Fechamento
  monthClosingId: string | null,        // congelado ao fechar mês

  // Auditoria
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

**Regra de geração:** ao ativar um `schedule_template`, o sistema gera instâncias de `classes` para os próximos N meses (configurável). Novas instâncias geradas semanalmente por Cloud Function agendada.

### 2.8 Nova coleção: `substitutions/{substitutionId}`

```js
{
  classId: string,
  type: 'direta' | 'cobertura_aberta',

  // Partes envolvidas
  requestingTeacherId: string,
  requestingUserId: string,
  substituteTeacherId: string | null,   // null em cobertura_aberta até atribuição
  substituteUserId: string | null,

  // Unidades
  requestingUnitId: string,
  substituteUnitId: string | null,

  // Status — substituição direta
  status: 'solicitada' | 'pendente_aceite' | 'aceita' | 'recusada' | 'cancelada',

  // Status — cobertura em aberto
  openStatus: 'aberta' | 'em_negociacao' | 'atribuida' | 'aceita' | 'nao_coberta' | 'cancelada',

  // Motivo
  reason: string,                       // motivo padronizado
  note: string | null,                  // observação livre

  // Datas
  requestedAt: Timestamp,
  responseDeadline: Timestamp,          // = data/hora início da aula
  respondedAt: Timestamp | null,
  respondedBy: string | null,
  acceptedAt: Timestamp | null,

  // Cancelamento
  cancelledBy: string | null,
  cancelledAt: Timestamp | null,
  cancelledByRole: string | null,

  // Override da gestão
  forcedByAdmin: boolean,
  adminNote: string | null,
  forcedBy: string | null,

  // Auditoria
  createdBy: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

### 2.9 Nova coleção: `coverage_applications/{applicationId}`

```js
{
  substitutionId: string,               // ref a cobertura_aberta
  applicantTeacherId: string,
  applicantUserId: string,
  applicantUnitId: string,
  appliedAt: Timestamp,
  status: 'pendente' | 'aceita' | 'recusada',
  decidedBy: string | null,
  decidedAt: Timestamp | null,
  note: string | null,
}
```

### 2.10 Nova coleção: `monthly_closings/{closingId}`

```js
{
  unitId: string,
  month: number,                        // 1–12
  year: number,
  competencia: string,                  // '2026-04' (chave de busca)
  status: 'aberto' | 'em_apuracao' | 'pendente_validacao' | 'validado' | 'fechado',

  closedBy: string | null,
  closedAt: Timestamp | null,
  closingNote: string | null,

  // Estatísticas do fechamento (calculadas)
  totalTeachers: number,
  totalClasses: number,
  totalMinutes: number,
  totalAmount: number,

  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

> ⛔ `status: 'fechado'` é IRREVERSÍVEL. Security Rules e Cloud Function garantem que nenhuma escrita posterior seja permitida após este status.

### 2.11 Nova coleção: `payment_records/{recordId}`

```js
{
  teacherId: string,
  monthClosingId: string,
  competencia: string,                  // '2026-04'
  month: number,
  year: number,
  unitId: string,

  // Contagem de aulas (pelo status no fechamento)
  totalScheduledClasses: number,
  realizedClasses: number,
  cancelledClasses: number,
  notRealizedClasses: number,
  substitutedAsOriginal: number,        // aulas que o titular perdeu por troca
  substitutedAsSubstitute: number,      // aulas cobertas como substituto
  holidayClasses: number,

  // Minutos
  regularMinutes: number,
  holidayMinutes: number,
  substituteMinutes: number,
  totalPaidMinutes: number,

  // Cálculo — professor efetivo
  regularAmount: number,                // regularMinutes/60 × hourlyRate
  holidayAmount: number,                // holidayMinutes/60 × hourlyRate × 2
  substituteAmount: number,             // substituteMinutes/60 × hourlyRate

  // Cálculo — estagiário
  internStipendAmount: number,          // bolsa fixa
  internSurplusMinutes: number,         // max(0, totalPaidMinutes - limitMinutes)
  internSurplusAmount: number,          // surplusMinutes/60 × proportionalRate

  // Total
  subtotal: number,
  manualAdjustment: number,             // ajuste manual da gestão
  manualAdjustmentNote: string | null,
  totalAmount: number,                  // subtotal + manualAdjustment

  // Controle
  calculatedAt: Timestamp,
  calculatedBy: string,
  reviewedBy: string | null,
  reviewedAt: Timestamp | null,
  isFinalized: boolean,                 // true após fechamento
}
```

### 2.12 Nova coleção: `receipts/{receiptId}`

```js
{
  paymentRecordId: string,
  teacherId: string,
  teacherName: string,
  teacherCpf: string,
  competencia: string,
  month: number,
  year: number,

  receiptNumber: string,                // ex: '2026-0042' (formato: YYYY-NNNN)
  status: 'emitido' | 'aguardando_pagamento' | 'pago' | 'cancelado' | 'complemento',

  // Valores
  totalPaidMinutes: number,
  hourlyRate: number | null,
  internStipend: number | null,
  internSurplusAmount: number | null,
  totalAmount: number,

  // Datas
  issuedAt: Timestamp,
  issuedBy: string,
  paidAt: Timestamp | null,
  paidBy: string | null,
  paymentDate: string | null,           // data do pagamento (string para exibição)

  // Cancelamento
  cancelledBy: string | null,
  cancelledAt: Timestamp | null,
  cancelNote: string | null,

  // PDF
  pdfUrl: string | null,                // Firebase Storage URL

  observations: string | null,
}
```

### 2.13 Nova coleção: `special_scale_types/{typeId}` (seed)

```js
// Documentos pré-criados (seed):
{ id: 'sabado',           name: 'Sábado',           weight: 1, description: 'Sábados comuns' }
{ id: 'feriado',          name: 'Feriado',           weight: 2, description: 'Feriados municipais, estaduais e nacionais' }
{ id: 'domingo_especial', name: 'Domingo Especial',  weight: 3, description: 'Domingos com operação especial' }
{ id: 'evento_especial',  name: 'Evento Especial',   weight: 3, description: 'Eventos com operação especial' }
```

### 2.14 Nova coleção: `special_scales/{scaleId}`

```js
{
  unitId: string,
  date: Timestamp,
  typeId: string,                       // ref a special_scale_types
  typeName: string,                     // desnormalizado para consulta
  weight: number,                       // 1|2|3 — desnormalizado
  description: string,
  windowMonths: number,                 // padrão 3, configurável pelo admin por escala ✅ P07
  planningOpenAt: Timestamp,
  planningClosedAt: Timestamp | null,
  isOfficial: boolean,                  // true = integrou à agenda oficial
  createdBy: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

### 2.15 Subcoleção: `special_scales/{scaleId}/scale_responses/{teacherId}`

```js
{
  teacherId: string,
  teacherName: string,
  preference: 'disponivel' | 'prefere_trabalhar' | 'prefere_nao' | 'indisponivel',
  respondedAt: Timestamp,
  isAssigned: boolean,
  assignedAt: Timestamp | null,
  assignedBy: string | null,
  cumulativeWeight: number,             // peso acumulado do professor no ciclo (3 meses)
}
```

### 2.16 Nova coleção: `vacation_requests/{requestId}`

```js
{
  teacherId: string,
  teacherName: string,
  type: 'ferias_clt' | 'recesso_estagiario',
  startDate: Timestamp,
  endDate: Timestamp,
  durationDays: number,

  status: 'solicitado' | 'aprovado' | 'rejeitado' | 'cancelado',

  requestedBy: string,
  requestedAt: Timestamp,
  reviewedBy: string | null,
  reviewedAt: Timestamp | null,
  reviewNote: string | null,

  // Alertas automáticos
  alert60Sent: boolean,
  alert45Sent: boolean,
  alert30Sent: boolean,

  // Conflitos detectados ao aprovar
  hasConflicts: boolean,
  conflictDetails: string | null,       // JSON serializado das aulas/escalas conflitantes

  notes: string | null,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

### 2.17 Nova coleção: `notifications/{notificationId}`

```js
{
  recipientUserId: string,
  recipientEmail: string,
  type: string,                         // ver enum abaixo
  title: string,
  body: string,
  isRead: boolean,
  readAt: Timestamp | null,

  // Entidade relacionada
  relatedEntityType: string | null,     // 'substitution' | 'class' | 'vacation' | 'closing'
  relatedEntityId: string | null,

  // Email
  emailSent: boolean,
  emailSentAt: Timestamp | null,
  emailError: string | null,

  createdAt: Timestamp,
}
```

**Tipos de notificação:**
```
substituicao_solicitada | troca_aceita | troca_recusada | troca_cancelada
cobertura_aberta | cobertura_atribuida | cobertura_nao_coberta
agenda_alterada | aula_sem_cobertura
divergencia_fechamento | fechamento_disponivel
recibo_emitido
alerta_ferias_60 | alerta_ferias_45 | alerta_ferias_30
alerta_recesso_vencimento | conflito_ferias_escala
```

### 2.18 Extensão de `audit_log` (backward compatible)

Campos adicionados opcionalmente (existentes continuam funcionando):

```js
{
  // EXISTENTES (mantidos)
  type: string,
  details: string,
  userId: string,
  userName: string,
  unitId: string,
  timestamp: Timestamp,

  // NOVOS (opcionais — null em registros antigos)
  module: 'comissoes' | 'professores' | null,
  role: string | null,                  // perfil do usuário no momento da ação
  entityType: string | null,            // 'teacher' | 'class' | 'substitution' | ...
  entityId: string | null,
  before: object | null,               // estado anterior (serializado)
  after: object | null,                // estado posterior (serializado)
}
```

### 2.19 Relacionamentos entre coleções

```
users ──────────────────→ teachers (1:0..1, via userId)
teachers ───────────────→ teacher_salaries (1:1, teacherId)
teachers ───────────────→ modalities (N:M, via modalityIds[])
teachers ───────────────→ units (N:M, via unitIds[])
schedule_templates ─────→ units (N:1)
schedule_slots ─────────→ schedule_templates (N:1)
schedule_slots ─────────→ teachers (N:1)
schedule_slots ─────────→ modalities (N:1)
classes ────────────────→ schedule_slots (N:1, opcional)
classes ────────────────→ teachers (N:1, teacher atual)
classes ────────────────→ monthly_closings (N:1, após fechar)
substitutions ──────────→ classes (N:1)
substitutions ──────────→ teachers ×2 (titular + substituto)
coverage_applications ──→ substitutions (N:1)
monthly_closings ───────→ units (N:1)
payment_records ────────→ teachers (N:1)
payment_records ────────→ monthly_closings (N:1)
receipts ───────────────→ payment_records (N:1)
special_scales ─────────→ units (N:1)
special_scales ─────────→ special_scale_types (N:1)
scale_responses ────────→ special_scales (N:1, subcollection)
scale_responses ────────→ teachers (N:1)
vacation_requests ──────→ teachers (N:1)
notifications ──────────→ users (N:1)
audit_log ──────────────→ qualquer entidade (N:1, via entityType+entityId)
```

---

## 3. ESPECIFICAÇÃO DE API / FUNÇÕES / SERVIÇOS

### 3.1 Estratégia geral

O sistema usa **Firestore SDK direto** (sem REST API customizada) para operações CRUD simples. Operações complexas que exigem atomicidade, cálculo ou efeitos colaterais são delegadas a **Cloud Functions** (Node.js 18+).

### 3.2 Operações Firestore diretas (por coleção)

#### `teachers`
| Operação | Chamante | Regra |
|----------|---------|-------|
| `collection('teachers').add(data)` | admin | criar professor |
| `doc(id).update(data)` | admin | editar professor |
| `doc(id).update({ isActive: false })` | admin | inativar |
| `collection('teachers').get()` | admin, supervisao | listar |
| `doc(id).get()` | todos (módulo prof.) | visualizar |

#### `teacher_salaries`
| Operação | Chamante | Regra |
|----------|---------|-------|
| `doc(teacherId).set(data)` | admin | criar/editar dados salariais |
| `doc(teacherId).get()` | admin | visualizar (bloqueado por Security Rules para demais) |

#### `classes`
| Operação | Chamante | Regra |
|----------|---------|-------|
| `collection('classes').where('unitId','==', u).where('scheduledDate','>=', ini).where('scheduledDate','<=', fim).get()` | admin, supervisao | grade da unidade |
| `collection('classes').where('teacherId','==', tid).get()` | professor | minha agenda |
| `doc(id).update({ status: 'cancelada', ... })` | admin, supervisao | ajuste manual |
| `doc(id).update({ status: 'cancelada', ... })` | professor | cancelamento próprio (limitado) |

#### `substitutions`
| Operação | Chamante | Regra |
|----------|---------|-------|
| `add(data)` | professor | solicitar troca |
| `doc(id).update({ status: 'aceita' })` | professor substituto | aceitar |
| `doc(id).update({ status: 'recusada' })` | professor substituto | recusar |
| `doc(id).update({ status: 'cancelada' })` | professor titular | cancelar (se aceita, requer concordância) |
| `doc(id).update({ forcedByAdmin: true, ... })` | admin, supervisao | forçar troca |

#### `notifications`
| Operação | Chamante | Regra |
|----------|---------|-------|
| `where('recipientUserId','==', uid).orderBy('createdAt','desc').limit(50)` | usuário logado | listar próprias |
| `doc(id).update({ isRead: true })` | usuário logado | marcar como lida |

### 3.3 Cloud Functions obrigatórias

#### `closeMonth(data: { closingId, unitId, month, year, closedBy })`

Operação atômica (Firestore Batch Write):
1. Verificar status atual ≠ 'fechado'
2. Consolidar todas as `classes` do período (status final de cada uma)
3. Para cada professor: calcular `payment_records`
4. Atualizar status do `monthly_closings` → 'fechado'
5. Marcar `monthClosingId` em todas as `classes` do período
6. Registrar `audit_log`
7. Criar notificações para admin/supervisão

**Esta função é idempotente apenas para leitura — a escrita final é transacional e irreversível.**

#### `calculatePayment(data: { teacherId, closingId })`

Regras de cálculo (ver Seção 9.3 para formalização):
1. Buscar `teacher_salaries/{teacherId}`
2. Buscar todas as `classes` onde `teacherId == id` E `monthClosingId == closingId`
3. Aplicar fórmula por tipo (efetivo/estagiário)
4. Upsert `payment_records/{id}`

#### `processSubstitutionAcceptance(data: { substitutionId })`

Operação atômica:
1. Buscar `substitutions/{id}`
2. Buscar `classes/{classId}`
3. Verificar aceite ainda dentro do prazo (`responseDeadline > now`)
4. Verificar aptidão do substituto à modalidade (`teacher_modalities`)
5. Batch write:
   - `classes/{id}.teacherId` = substituto
   - `classes/{id}.status` = 'substituida'
   - `substitutions/{id}.status` = 'aceita'
6. Criar notificações para as partes
7. Registrar `audit_log`

#### `generateReceipt(data: { paymentRecordId, issuedBy })`

1. Buscar `payment_records/{id}` + `teacher_salaries`
2. Gerar número sequencial de recibo (query por unitId + year)
3. Gerar HTML do recibo
4. Converter HTML → PDF via Puppeteer (ou html-pdf)
5. Salvar em Firebase Storage: `receipts/{year}/{month}/{teacherId}.pdf`
6. Criar documento `receipts/{id}`
7. Registrar `audit_log`

#### `sendNotification(data: { notificationId })` (trigger automático)

Acionado por Firestore trigger `onWrite` em `notifications/{id}`:
1. Buscar notificação
2. Se `emailSent == false`: enviar via Firebase Extension "Trigger Email"
3. Atualizar `emailSent`, `emailSentAt`

#### `checkVacationAlerts()` (Cloud Scheduler — diário)

1. Buscar todas as `vacation_requests` com `status: 'aprovado'`
2. Para cada uma, calcular dias até `startDate`
3. Se <= 60 e `alert60Sent == false`: criar notificação + marcar flag
4. Se <= 45 e `alert45Sent == false`: criar notificação + marcar flag
5. Se <= 30 e `alert30Sent == false`: criar notificação + marcar flag

#### `generateScheduleInstances()` (Cloud Scheduler — semanal)

1. Para cada `schedule_template` ativo
2. Buscar `schedule_slots` do template
3. Gerar instâncias de `classes` para as próximas 4 semanas (evitando duplicatas)
4. Verificar férias e recesso aprovados → não gerar para professores em período aprovado

#### `validateBatchSchedule(data: { unitId, period, weekdays, startTime, endTime, modalityId, teacherId })` ✨ adicionado via wireframe — 07/05/2026

Valida criação em lote antes do commit:
1. Verifica conflitos com `classes` existentes no período
2. Verifica férias/recesso aprovados do professor no período
3. Verifica aptidão do professor à modalidade
4. Retorna `{ totalToCreate, conflicts: [...], canProceed: bool }`

Após confirmação do admin, frontend chama Batch Write Firestore para criar as N aulas (chunkar em lotes de 500).

#### `autoAllocateSpecialScale(data: { scaleId })` [A DEFINIR — algoritmo]

Algoritmo de alocação equilibrada:
1. Buscar professores elegíveis (ativos, habilitados à modalidade, sem férias no período)
2. Ordenar por `cumulativeWeight` (menor peso acumulado no ciclo = prioridade)
3. Excluir quem marcou `preferência: 'indisponivel'`
4. Priorizar quem marcou `prefere_trabalhar`
5. Atribuir respeitando vagas disponíveis

### 3.4 Firebase Security Rules (resumo executivo)

Regras completas em Seção 12. Princípios:

| Coleção | Admin | Supervisão | Professor | Estagiário | Vendedor |
|---------|-------|-----------|-----------|------------|---------|
| `teacher_salaries` | R/W | ❌ | ❌ | ❌ | ❌ |
| `teachers` | R/W | R | R (próprio) | R (próprio) | ❌ |
| `classes` | R/W | R/W | R + update próprio | R + update próprio | ❌ |
| `substitutions` | R/W | R/W | R/W (envolvidos) | R/W (envolvidos) | ❌ |
| `monthly_closings` | R/W | R | R | R | ❌ |
| `payment_records` | R/W | ❌ | R (próprio) | R (próprio) | ❌ |
| `receipts` | R/W | ❌ | R (próprio) | R (próprio) | ❌ |
| `periodos`, `comissoes_diferidas` | R/W | ❌ | ❌ | ❌ | R/W |

---

## 4. COMPONENTES FRONTEND

### 4.1 Estratégia

**`professores.html`** é construído reaproveitando 100% do design system existente:
- Mesmos CSS Custom Properties (`:root { --bg, --surface, --orange... }`)
- Mesmos componentes visuais (`.btn`, `.table-wrap`, `.stat-card`, sidebar, toast)
- Mesma estrutura de layout (`.app → .sidebar + .main → .page`)
- `firebase-config.js` compartilhado

> 📐 **Referência visual canônica:** `AgendaWireframes_design.html` (recebido do cliente em 07/05/2026, gerado via Claude Design). Cobre 9 telas + variações. Implementar pixel-perfect contra esse arquivo. Cobertura: 79% dos RFs · 3 RFs sem wireframe (Relatórios, Auditoria, Gestão de Usuários) usam padrões UX já estabelecidos no `index.html`.

### 4.2 Estrutura de páginas do módulo de professores

```
professores.html
├── [login-page]           reutilizado idêntico ao de index.html
└── [app-shell]
    ├── [sidebar]          buildSidebarProfessores()
    └── [main]
        ├── page: dashboard-prof     Dashboard do módulo
        ├── page: professores        Cadastro de professores
        ├── page: modalidades        Cadastro de modalidades (CRUD) ✨ tela própria — decisão 07/05/2026
        ├── page: agenda             Agenda semanal (admin/supervisão)
        ├── page: minha-agenda       Minha agenda (professor)
        ├── page: agenda-geral       Agenda geral (leitura — professor)
        ├── page: substituicoes      Substituições e coberturas
        ├── page: escalas-especiais  Escalas especiais
        ├── page: ferias-recesso     Férias e recesso
        ├── page: fechamento         Fechamento mensal (admin)
        ├── page: pagamentos-prof    Pagamentos e recibos (admin)
        ├── page: relatorios-prof    Relatórios (admin/supervisão)
        └── page: auditoria-prof     Auditoria (admin)
```

### 4.3 Componentes novos por funcionalidade

#### `BatchClassCreator` — lançamento em lote de aulas ✨ adicionado via wireframe — 07/05/2026
Cria múltiplas instâncias de `classes` (ou `schedule_slots` recorrentes) de uma vez. Atende cliente que quer evitar cadastro aula-por-aula.

**Variação A — Formulário guiado:**
- Inputs: período (data início/fim), dias da semana (multi-select), horário início/fim, modalidade, professor, unidade
- Preview com contagem total de aulas a criar
- Detecção automática de conflitos (aula já existente, professor em férias, modalidade incompatível)
- Botão "Criar N aulas" gera todas em batch

**Variação B — Grade visual:**
- Grade semanal vazia
- Admin marca células (clique e arrasta) para definir o padrão recorrente
- Aplica o padrão ao período selecionado

**Mapeamento técnico:**
- Grava como `schedule_template` + N `schedule_slots` (se for recorrente) ou diretamente N `classes` (se for período fixo)
- Operação atômica via Firestore Batch Write (limite de 500 operações por batch — chunkar se necessário)
- Validação de conflito server-side via Cloud Function `validateBatchSchedule` antes do commit

**Sprint:** 2 (Agenda)

#### `WeeklyScheduleGrid` — grade semanal por unidade
- Grade CSS Grid: dias da semana × horários
- Células clicáveis (admin/supervisão) ou somente leitura (professor)
- Indicador de "livre" quando slot vazio
- Filtros: unidade, semana, modalidade
- Destaque de feriados (badge visual)
- Aulas com substituição pendente: badge `⚠ Troca Pendente`

#### `GeneralScheduleViewer` — agenda geral (professor — leitura)
- Idêntico ao `WeeklyScheduleGrid` mas sem interação de edição
- Exibe: nome do professor + modalidade + unidade
- Filtro de unidade multi-seleção
- Indicador "🟢 Livre" automático

#### `SubstitutionRequestModal` — solicitação de troca
- Seleção do colega (apenas aptos à modalidade)
- Tipo: direta ou cobertura em aberto
- Motivo padronizado + observação livre
- Preview da aula a ser trocada

#### `CoverageBoardPanel` — painel de coberturas em aberto
- Lista de aulas sem cobertura confirmada
- Badge de urgência (horas até a aula)
- Botão "Me oferecer" para professores elegíveis
- Filtro por unidade (admin/supervisão vê todas)

#### `AcceptancePanel` — solicitações recebidas
- Lista de trocas aguardando resposta do professor
- Timer visual até `responseDeadline`
- Botões Aceitar / Recusar com confirmação

#### `MonthlyClosingPanel` — fechamento mensal (admin)
- Seleção de unidade + competência
- Preview automático de horas consolidadas
- Lista de divergências com badge
- Ajustes manuais com campo de justificativa
- Botão "Fechar mês" com confirmação modal dupla (irreversível)

#### `PaymentCalculatorView` — cálculo de pagamento (admin)
- Tabela por professor: aulas × horas × valor
- Exibição separada: regular, feriado (dobrado), excedente estagiário
- Total por professor e total geral
- Botão "Gerar Recibos"

#### `ReceiptViewer` — visualização de recibo (professor)
- Layout printable com dados completos
- Botão imprimir / baixar PDF
- Status do pagamento (aguardando / pago)

#### `SpecialScaleManager` — escalas especiais (admin/supervisão)
- Calendário rolling 3 meses
- Painel de preferências dos professores
- Painel de equilíbrio: peso acumulado por professor no ciclo
- Botão "Alocar automaticamente" + "Fechar planejamento"

#### `VacationRequestForm` — solicitação de férias/recesso
- Seleção de período
- Cálculo automático de dias
- Alerta de conflito com agenda/escalas
- Timeline de aprovação

#### `NotificationCenter` — central de notificações
- Badge no ícone do sino (contagem de não lidas)
- Dropdown com lista das últimas 20 notificações
- Link para entidade relacionada
- "Marcar todas como lidas"

#### `AuditLogViewer` — auditoria (admin)
- Tabela paginada com before/after expansível
- Filtros: módulo, tipo de ação, usuário, período, entidade
- Exportação Excel

### 4.4 Componentes reutilizados de index.html (sem alteração)

- `.upload-zone` (para importação de feriados, se aplicável)
- `.stat-card`, `.kpi-hero`
- `.table-wrap` + tabelas
- `.btn`, `.btn-ghost`, `.btn-sm`, `.btn-danger`, `.btn-outline`
- `.input-group`, `.login-box`
- `toast(msg, type)` — função JS
- `fmt(n)` — formatação monetária
- Sidebar + mobile toggle + bottom nav
- Modais genéricos (`.modal-overlay`, `.modal-box`)

### 4.5 Responsividade por perfil

| Perfil | Desktop | Mobile |
|--------|---------|--------|
| Admin / Gestão | todas as páginas | apenas dashboard-prof (igual ao módulo de comissões) |
| Supervisão | todas as páginas | agenda + substituições |
| Professor / Estagiário | leitura + solicitações | **acesso completo** (RF22) |

> **RF22:** professor deve conseguir operar completamente no celular. WeeklyScheduleGrid e formulários de substituição/aceite devem ser mobile-first.

---

## 5. HOOKS / SERVIÇOS / CAMADAS DE ACESSO A DADOS

### 5.1 Módulos de serviço propostos

Cada módulo é um arquivo `.js` com funções exportadas. Segue o padrão do `commission.js` existente (objeto literal com métodos), sem framework.

#### `firebase-config.js` — compartilhado entre index.html e professores.html

```js
const firebaseConfig = {
  apiKey: "AIzaSyCILbVvHuOgEaFsK-OrXCN7_NmJeMB5GKI",
  authDomain: "crosstrainer-comissoes.firebaseapp.com",
  projectId: "crosstrainer-comissoes",
  storageBucket: "crosstrainer-comissoes.firebasestorage.app",
  messagingSenderId: "909536955760",
  appId: "1:909536955760:web:36a4d166aa747f5f9653b5"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();
```

#### `TeacherService`

```js
const TeacherService = {
  async create(data, salaryData, adminUserId) { ... },
  async update(teacherId, data, adminUserId) { ... },
  async deactivate(teacherId, adminUserId) { ... },
  async getById(teacherId) { ... },
  async listAll(filters) { ... },          // { unitId, type, isActive, modalityId }
  async getSalary(teacherId) { ... },      // admin only — via Security Rules
  async updateSalary(teacherId, data, adminUserId) { ... },
  async isEligibleForModality(teacherId, modalityId) { ... },
};
```

#### `ScheduleService`

```js
const ScheduleService = {
  async getWeeklySlots(unitId, weekStart) { ... },
  async getGeneralSchedule(weekStart, unitIds) { ... },
  async getClassesByTeacher(teacherId, startDate, endDate) { ... },
  async getClassesByUnit(unitId, startDate, endDate) { ... },
  async updateClassStatus(classId, status, note, userId) { ... },
  async createSlot(slotData, userId) { ... },
  async updateSlot(slotId, data, userId) { ... },
  async getFreeSlots(unitId, weekStart) { ... },
};
```

#### `SubstitutionService`

```js
const SubstitutionService = {
  async requestDirect(classId, substituteTeacherId, reason, note, userId) { ... },
  async requestOpenCoverage(classId, reason, note, userId) { ... },
  async accept(substitutionId, userId) { ... },   // chama CF processSubstitutionAcceptance
  async refuse(substitutionId, reason, userId) { ... },
  async cancel(substitutionId, userId, force) { ... },
  async applyForCoverage(substitutionId, teacherId, userId) { ... },
  async getEligibleSubstitutes(classId) { ... },
  async getPendingByTeacher(teacherId) { ... },
  async getOpenCoverages(unitId) { ... },
};
```

#### `ClosingService`

```js
const ClosingService = {
  async getOrCreate(unitId, month, year) { ... },
  async previewSummary(unitId, month, year) { ... },
  async close(closingId, userId) { ... },          // chama CF closeMonth — IRREVERSÍVEL
  async getPaymentRecord(teacherId, closingId) { ... },
  async applyManualAdjustment(recordId, amount, note, userId) { ... },
};
```

#### `ReceiptService`

```js
const ReceiptService = {
  async generate(paymentRecordId, userId) { ... }, // chama CF generateReceipt
  async getByTeacher(teacherId, year) { ... },
  async markAsPaid(receiptId, paymentDate, userId) { ... },
  async cancel(receiptId, note, userId) { ... },
  // P06 ✅: cancelamento gera crédito automático
  // Fluxo: cancel() → receipt.status = 'cancelado' → cria novo receipt.status = 'complemento'
  // com totalAmount = valor original (positivo, a favor do professor)
  // Admin aplica como manualAdjustment no próximo fechamento
};
```

#### `SpecialScaleService`

```js
const SpecialScaleService = {
  async getTypes() { ... },
  async create(data, userId) { ... },
  async listByWindow(unitId, windowMonths) { ... },
  async registerPreference(scaleId, teacherId, preference) { ... },
  async getEquilibriumPanel(unitId, cycleMonths) { ... },
  async autoAllocate(scaleId, userId) { ... },     // chama CF
  async closePlanning(scaleId, userId) { ... },
};
```

#### `VacationService`

```js
const VacationService = {
  async request(teacherId, type, startDate, endDate, notes, userId) { ... },
  async approve(requestId, note, userId) { ... },
  async reject(requestId, note, userId) { ... },
  async checkConflicts(teacherId, startDate, endDate) { ... },
  async getInternRecessEligibility(teacherId) { ... },
};
```

#### `NotificationService`

```js
const NotificationService = {
  async listForUser(userId, limit) { ... },
  async markRead(notificationId) { ... },
  async getUnreadCount(userId) { ... },
};
```

#### `AuditService`

```js
const AuditService = {
  async log(type, details, entityType, entityId, before, after, userId, role) {
    return db.collection('audit_log').add({
      type, details,
      module: 'professores',
      entityType: entityType || null,
      entityId: entityId || null,
      before: before || null,
      after: after || null,
      userId,
      userName: AppState.userProfile?.name || userId,
      role: role || (AppState.userProfile?.profiles || []).join(','),
      unitId: AppState.currentUnitId,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
  async list(filters) { ... },
  async exportExcel(filters) { ... },
};
```

### 5.2 Padrão de retorno uniforme

```js
// Todas as funções de serviço retornam:
{ success: true,  data: result }
{ success: false, error: 'mensagem', code: 'firebase-code' }
```

---

## 6. STATE MANAGEMENT

### 6.1 Padrão existente (index.html)

Variáveis globais no escopo do script inline: `currentUser`, `userProfile`, `currentPage`, `currentUnitId`, `unitConfig`. Sem biblioteca de estado.

### 6.2 Proposta para professores.html

Mesmo padrão, organizado em objeto `AppState`:

```js
const AppState = {
  currentUser:      null,
  userProfile:      null,
  currentPage:      'dashboard-prof',
  currentUnitId:    null,
  currentWeekStart: null,
  teachersCache:    [],
  modalitiesCache:  [],
  unitsCache:       [],
  selectedClass:    null,
  activeClosing:    null,
  unreadCount:      0,
};
```

Re-renders disparados por funções nomeadas (`renderAgenda()`, `renderSubstitutions()`). Cache limpo ao trocar de unidade ou no `auth.onAuthStateChanged`.

---

## 7. ROTEAMENTO E NAVEGAÇÃO

### 7.1 Guard de rotas por perfil

```js
const PROF_PAGES = {
  admin:                ['dashboard-prof','professores','modalidades','agenda','substituicoes',
                         'escalas-especiais','ferias-recesso','fechamento',
                         'pagamentos-prof','relatorios-prof','auditoria-prof'],
  admin_gestao:         ['dashboard-prof','professores','modalidades','agenda','substituicoes',
                         'escalas-especiais','ferias-recesso','fechamento',
                         'pagamentos-prof','relatorios-prof','auditoria-prof'],
  supervisao:           ['dashboard-prof','agenda','substituicoes',
                         'escalas-especiais','ferias-recesso','relatorios-prof','auditoria-prof'],
  professor:            ['minha-agenda','agenda-geral','substituicoes','ferias-recesso'],
  professor_estagiario: ['minha-agenda','agenda-geral','substituicoes','ferias-recesso'],
};

function getAllowedPages() {
  const profiles = AppState.userProfile.profiles || [AppState.userProfile.role];
  return [...new Set(profiles.flatMap(p => PROF_PAGES[p] || []))];
}

function navigateProfTo(page) {
  const allowed = getAllowedPages();
  if (!allowed.includes(page)) page = allowed[0];
  AppState.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
}
```

### 7.2 Extensão em index.html (cirúrgica)

Em `buildSidebar()`, adicionar ao bloco admin:

```js
if (userProfile.moduleAccess?.professores) {
  html += `<div class="sb-section">Módulos</div>`;
  html += `<div class="sb-item" onclick="window.location='professores.html'">
             <span class="icon">🏋️</span>Professores / Agenda
           </div>`;
}
```

### 7.3 Sidebar por perfil no módulo de professores

```
Admin / Admin_Gestão → todas as páginas
Supervisão          → sem Professores (cadastro), sem Fechamento, sem Pagamentos
Professor           → Minha Agenda | Agenda Geral | Substituições | Férias
Estagiário          → igual ao Professor
```

---

## 8. AUTENTICAÇÃO E AUTORIZAÇÃO

### 8.1 Fluxo de autenticação (professores.html)

```js
auth.onAuthStateChanged(async user => {
  if (!user) { showLogin(); return; }

  const doc = await db.collection('users').doc(user.uid).get();
  if (!doc.exists) { auth.signOut(); return; }

  userProfile = doc.data();

  // Migração inline backward-compatible
  if (!userProfile.profiles) {
    userProfile.profiles = [userProfile.role];
    userProfile.moduleAccess = {
      comissoes: ['admin','vendedor'].includes(userProfile.role),
      professores: userProfile.role === 'admin',
    };
    db.collection('users').doc(user.uid)
      .update({ profiles: userProfile.profiles, moduleAccess: userProfile.moduleAccess })
      .catch(() => {});
  }

  if (!userProfile.moduleAccess?.professores) {
    showAccessDenied(); return;
  }

  AppState.currentUser  = user;
  AppState.userProfile  = userProfile;
  showApp();
});
```

### 8.2 Funções de verificação de perfil

```js
function hasProfile(p)    { return (userProfile.profiles || [userProfile.role]).includes(p); }
function isAdminGestao()  { return hasProfile('admin') || hasProfile('admin_gestao'); }
function isSupervisao()   { return hasProfile('supervisao'); }
function isProfessor()    { return hasProfile('professor') || hasProfile('professor_estagiario'); }
function canSeeSalary()   { return hasProfile('admin') || hasProfile('admin_gestao'); }
function canCloseMonth()  { return hasProfile('admin') || hasProfile('admin_gestao'); }
```

### 8.3 Matriz de acesso por perfil e funcionalidade

| Funcionalidade | Admin | Admin_Gestão | Supervisão | Professor | Estagiário | Vendedor |
|---------------|:-----:|:------------:|:----------:|:---------:|:----------:|:--------:|
| Cadastrar/editar professor | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ver dados salariais | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Criar/editar agenda | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ver agenda geral | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Solicitar substituição | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Aceitar/recusar substituição | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Fechar mês | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ver pagamentos | ✅ | ✅ | ❌ | próprio | próprio | ❌ |
| Emitir recibos | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gerenciar escalas especiais | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Aprovar férias/recesso | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ver relatórios | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ver auditoria | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Módulo Comissões | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |

### 8.4 Proteção dupla — dados salariais (RF26/RN19)

1. **Frontend:** `canSeeSalary() == false` → aba não renderizada (sem dados no DOM)
2. **Firestore Security Rule:** `teacher_salaries` → `allow read, write: if isAdmin()` — bloqueia acesso direto

### 8.5 Criação de usuários com novos perfis

Fluxo na página de Usuários (index.html — extensão cirúrgica):
- Dropdown de `profiles[]` vira multi-select (checkboxes)
- `moduleAccess` calculado automaticamente com base nos perfis selecionados
- Se `professor` ou `professor_estagiario`: exibir campo de vínculo com `teachers/{id}`

---

## 9. VALIDAÇÕES E SCHEMAS

### 9.1 Cadastro de professor

| Campo | Regra |
|-------|-------|
| `name` | Obrigatório, ≥ 3 chars |
| `cpf` | Obrigatório, válido, único |
| `email` | Obrigatório, formato válido, único |
| `type` | Enum: `efetivo / estagiario / eventual` |
| `unitIds` | Mínimo 1 |
| `modalityIds` | Mínimo 1 |
| `hourlyRate` | Obrigatório e > 0 se `type == efetivo` |
| `internMonthlyStipend` | Obrigatório e > 0 se `type == estagiario` |
| `internMonthlyLimitHours` | Obrigatório e > 0 se `type == estagiario` |
| `contractEndDate` | Obrigatório se `type == estagiario` |

### 9.2 Substituição

| Regra | Comportamento |
|-------|--------------|
| Substituto habilitado para modalidade | Erro — bloqueia |
| Aceite após início da aula | Bloqueado automaticamente |
| Solicitação duplicada para mesma aula | Erro — bloqueia |
| Mês já fechado no período da aula | Erro — bloqueia |
| Cancelamento de troca aceita sem concordância | Erro (exceto força admin) |

### 9.3 Fechamento

| Regra | Comportamento |
|-------|--------------|
| `status == 'fechado'` → nenhuma alteração | Security Rule + CF |
| Substituições pendentes no período | Alerta (não bloqueia) |
| Coberturas abertas sem resolução | Alerta (não bloqueia) |
| Tentativa de reabertura | Erro — bloqueado |

### 9.4 Fórmulas de cálculo — formalização

> **Regra geral de aulas computadas:** somente aulas com `status == 'realizada'` entram no cálculo. `status == 'cancelada'` conta **sempre 0 minutos**, independente do motivo de cancelamento. ✅ Decisão P10 — 02/05/2026

#### Professor Efetivo e Eventual ✅ Decisão P09 — 02/05/2026

`type: 'efetivo'` e `type: 'eventual'` usam a mesma fórmula. O eventual é tratado como efetivo sem grade fixa — pago por hora com feriado dobrado.

```
totalPaidMinutes  = Σ durationMinutes { classes | teacherId == prof, status == 'realizada', monthClosingId == id }
holidayMinutes    = Σ durationMinutes { mesmas | isHoliday == true }
regularMinutes    = totalPaidMinutes - holidayMinutes

regularAmount     = (regularMinutes  / 60) × hourlyRate
holidayAmount     = (holidayMinutes  / 60) × hourlyRate × 2
totalAmount       = regularAmount + holidayAmount + manualAdjustment
```

#### Professor Estagiário ✅ P02 resolvido — 06/05/2026

Feriado **dobra** para estagiário também. O dobro incide sobre a taxa proporcional de hora excedente (não sobre a bolsa fixa, que é invariável).

```
limitMinutes             = internMonthlyLimitHours × 60

// Minutos excedentes — separados por tipo de dia
surplusRegularMinutes    = max(0, regularExcessMinutes)
surplusHolidayMinutes    = max(0, holidayExcessMinutes)

internStipendAmount      = internMonthlyStipend                                     (sempre pago, feriado não afeta)
internSurplusRegular     = (surplusRegularMinutes / 60) × internProportionalHourlyRate
internSurplusHoliday     = (surplusHolidayMinutes / 60) × internProportionalHourlyRate × 2
totalAmount              = internStipendAmount + internSurplusRegular + internSurplusHoliday + manualAdjustment
```

> Exemplo: limite=20h, bolsa=R$1.000, taxa excedente=R$30/h, mês com 21h regulares + 1h feriado acima do limite  
> → surplusRegular=1h → R$30 | surplusHoliday=1h → R$60 | total = R$1.000 + R$30 + R$60 = **R$1.090**

### 9.5 Motivos padronizados

```js
const REASONS = [
  'compromisso_pessoal', 'saude', 'ajuste_escala', 'cobertura_operacional',
  'clima', 'evento', 'feriado', 'falta', 'erro_cadastro', 'outros'
];
```

### 9.6 Férias e recesso

| Regra | Comportamento |
|-------|--------------|
| `startDate >= endDate` | Erro |
| Conflito com férias já aprovadas | Erro |
| `recesso_estagiario` para efetivo | Erro |
| Antecedência < 45 dias | Alerta (não bloqueia) |
| Conflito com escalas/aulas | Alerta + exige redistribuição manual |

---

## 10. TRATAMENTO DE ERROS

### 10.1 Mapeamento Firebase → português

```js
const FIREBASE_ERRORS = {
  'permission-denied':           'Você não tem permissão para esta ação.',
  'not-found':                   'Registro não encontrado.',
  'already-exists':              'Este registro já existe.',
  'unavailable':                 'Serviço indisponível. Verifique sua conexão.',
  'unauthenticated':             'Sessão expirada. Faça login novamente.',
  'functions/failed-precondition': 'Operação não permitida no estado atual.',
  'functions/internal':          'Erro interno. Tente novamente.',
};
```

### 10.2 Hierarquia de feedback

| Tipo | Componente | Duração |
|------|-----------|---------|
| Sucesso | `toast(msg, 'success')` | 3s |
| Aviso | `toast(msg, 'info')` | 4s |
| Erro recuperável | `toast(msg, 'error')` | 6s |
| Erro bloqueante | Modal (não fecha sozinho) | Manual |

### 10.3 Concorrência — dois professores aceitando a mesma cobertura

Solução: Firestore Transaction na CF `processSubstitutionAcceptance`:

```js
await db.runTransaction(async (t) => {
  const sub = await t.get(subRef);
  if (sub.data().status !== 'pendente_aceite')
    throw new Error('substitution-already-resolved');
  t.update(subRef,   { status: 'aceita', substituteTeacherId: tid });
  t.update(classRef, { teacherId: tid, status: 'substituida' });
});
// Um vence; o outro recebe erro tratado na UI
```

### 10.4 Fechamento concorrente

CF `closeMonth` verifica `status != 'fechado'` dentro de transação antes de commitar. Qualquer escrita em `classes` com `monthClosingId != null` é bloqueada por Security Rule.

---

## 11. PERFORMANCE

### 11.1 Índices Firestore necessários

| Coleção | Campos do índice |
|---------|-----------------|
| `classes` | `unitId ASC, scheduledDate ASC` |
| `classes` | `teacherId ASC, scheduledDate ASC` |
| `classes` | `monthClosingId ASC, teacherId ASC` |
| `classes` | `unitId ASC, scheduledDate ASC, status ASC` |
| `substitutions` | `requestingTeacherId ASC, requestedAt DESC` |
| `substitutions` | `substituteTeacherId ASC, status ASC` |
| `substitutions` | `classId ASC, status ASC` |
| `monthly_closings` | `unitId ASC, year DESC, month DESC` |
| `payment_records` | `teacherId ASC, competencia DESC` |
| `notifications` | `recipientUserId ASC, createdAt DESC` |
| `vacation_requests` | `teacherId ASC, status ASC` |
| `audit_log` | `module ASC, timestamp DESC` |

### 11.2 Cache e paginação

- Agenda: janela de 7 dias, carregamento on-demand por semana
- Audit log: `limit(100)` + cursor (`startAfter`)
- Notificações: `limit(50)`, refresh a cada 2 min via `setInterval`
- Dados estáticos (modalities, units, special_scale_types): cache por sessão

### 11.3 Geração de instâncias de aula (Cloud Scheduler)

- Executa toda domingo às 23h
- Gera instâncias para as próximas 4 semanas
- Verifica existência por `slotId + scheduledDate` antes de criar (idempotente)
- Não cria instâncias para professores em período de férias aprovado

---

## 12. SEGURANÇA

### 12.1 Firestore Security Rules — módulo de professores

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuth()   { return request.auth != null; }
    function uData()    { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; }
    function hasP(p)    { let u = uData(); return (u.profiles != null && p in u.profiles) || u.role == p; }
    function isAdmin()  { return hasP('admin') || hasP('admin_gestao'); }
    function isSuperv() { return hasP('supervisao'); }
    function isProf()   { return hasP('professor') || hasP('professor_estagiario'); }
    function hasProfM() { return isAdmin() || isSuperv() || isProf(); }
    function hasComM()  {
      let u = uData();
      return u.role == 'admin' || u.role == 'vendedor' ||
             (u.moduleAccess != null && u.moduleAccess.comissoes == true);
    }

    // Coleções existentes
    match /users/{uid} {
      allow read:  if isAuth() && (request.auth.uid == uid || isAdmin());
      allow write: if isAuth() && isAdmin();
    }
    match /units/{id}  { allow read: if isAuth(); allow write: if isAuth() && isAdmin(); }
    match /periodos/{id} {
      allow read, write: if isAuth() && hasComM();
      match /itens/{i}   { allow read, write: if isAuth() && hasComM(); }
    }
    match /comissoes_diferidas/{id} { allow read, write: if isAuth() && hasComM(); }
    match /audit_log/{id} {
      allow read:          if isAuth() && isAdmin();
      allow create:        if isAuth();
      allow update,delete: if false;
    }

    // Coleções novas — módulo de professores
    match /teacher_salaries/{id} { allow read, write: if isAuth() && isAdmin(); }  // ADMIN ONLY
    match /teachers/{id}         { allow read: if isAuth() && hasProfM(); allow create,update: if isAuth() && isAdmin(); allow delete: if false; }
    match /modalities/{id}       { allow read: if isAuth() && hasProfM(); allow write: if isAuth() && isAdmin(); }
    match /schedule_templates/{id} { allow read: if isAuth() && hasProfM(); allow write: if isAuth() && (isAdmin() || isSuperv()); }
    match /schedule_slots/{id}     { allow read: if isAuth() && hasProfM(); allow write: if isAuth() && (isAdmin() || isSuperv()); }
    match /classes/{id} {
      allow read:   if isAuth() && hasProfM();
      allow create: if isAuth() && (isAdmin() || isSuperv());
      allow update: if isAuth() && (isAdmin() || isSuperv() ||
        (isProf() && resource.data.originalTeacherId == request.auth.uid &&
         resource.data.monthClosingId == null));
      allow delete: if false;
    }
    match /substitutions/{id} {
      allow read:   if isAuth() && hasProfM();
      allow create: if isAuth() && hasProfM();
      allow update: if isAuth() && (isAdmin() || isSuperv() ||
        resource.data.requestingUserId == request.auth.uid ||
        resource.data.substituteUserId == request.auth.uid);
      allow delete: if false;
    }
    match /coverage_applications/{id} {
      allow read:   if isAuth() && hasProfM();
      allow create: if isAuth() && hasProfM();
      allow update: if isAuth() && (isAdmin() || isSuperv());
    }
    match /monthly_closings/{id} {
      allow read:   if isAuth() && hasProfM();
      allow create: if isAuth() && isAdmin();
      allow update: if isAuth() && isAdmin() && resource.data.status != 'fechado';
      allow delete: if false;
    }
    match /payment_records/{id} {
      allow read:  if isAuth() && (isAdmin() || resource.data.teacherId == uData().professorId);
      allow write: if isAuth() && isAdmin();
    }
    match /receipts/{id} {
      allow read:  if isAuth() && (isAdmin() || resource.data.teacherId == uData().professorId);
      allow write: if isAuth() && isAdmin();
    }
    match /special_scales/{id} {
      allow read:  if isAuth() && hasProfM();
      allow write: if isAuth() && (isAdmin() || isSuperv());
      match /scale_responses/{tid} {
        allow read:          if isAuth() && hasProfM();
        allow create,update: if isAuth() && (isAdmin() || isSuperv() || request.auth.uid == uData().professorId);
      }
    }
    match /vacation_requests/{id} {
      allow read:   if isAuth() && (isAdmin() || isSuperv() || resource.data.teacherId == uData().professorId);
      allow create: if isAuth() && hasProfM();
      allow update: if isAuth() && (isAdmin() || isSuperv());
      allow delete: if false;
    }
    match /notifications/{id} {
      allow read,update: if isAuth() && resource.data.recipientUserId == request.auth.uid;
      allow create:      if isAuth();
      allow delete:      if false;
    }
    match /special_scale_types/{id} { allow read: if isAuth() && hasProfM(); allow write: if isAuth() && isAdmin(); }
  }
}
```

### 12.2 Firebase Storage Rules — recibos PDF

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /receipts/{year}/{month}/{file} {
      allow read: if request.auth != null &&
        (request.auth.token.admin == true ||
         file.startsWith(request.auth.uid));
      allow write: if false; // apenas Cloud Functions escrevem
    }
  }
}
```

---

## 13. TESTES

### 13.1 Testes unitários — cálculos de pagamento

```js
describe('Efetivo', () => {
  test('1h normal R$50/h = R$50');
  test('1h feriado R$50/h = R$100');
  test('30min normal + 30min feriado = R$25 + R$50 = R$75');
  test('aula substituída não conta para titular');
});

describe('Estagiário', () => {
  test('dentro do limite: retorna bolsa cheia sem excedente');
  test('10min acima do limite: calcula excedente proporcional');
  test('2h acima do limite a R$30/h = R$60 excedente');
});
```

### 13.2 Testes de Security Rules (Firebase Emulator)

```js
test('teacher_salaries: admin lê — OK');
test('teacher_salaries: supervisao lê — permission-denied');
test('monthly_closings: update com status=fechado — permission-denied');
test('classes: professor altera aula de outro professor — permission-denied');
test('periodos: professor tenta ler — permission-denied');
```

### 13.3 Testes de integração — fluxos críticos

| Fluxo | Verificação |
|-------|------------|
| Substituição direta | classes.teacherId atualizado após aceite |
| Fechamento | status = 'fechado', alteração posterior bloqueada |
| Férias aprovadas | agenda bloqueada no período |
| Cálculo efetivo | totalAmount = regular + (feriado × 2) |
| Cálculo estagiário | bolsa + excedente correto |

### 13.4 Testes manuais obrigatórios por fase

- Login com cada perfil → verificar menu e páginas visíveis
- Mobile 375px: fluxo completo de substituição (professor)
- Tentativa de rota não autorizada → redirecionamento correto
- Fechar mês → confirmar impossibilidade de reabertura

---

## 14. DEPLOY E INFRAESTRUTURA

### 14.1 Estado atual

- Hospedagem estática (sem Firebase CLI no repositório)
- Projeto Firebase: `crosstrainer-comissoes` (plano Spark atual — migrar para Blaze)
- **Staging:** projeto separado `crosstrainer-comissoes-staging` ✅ P04 — 06/05/2026
  - `.firebaserc` com dois targets: `staging` e `production`
  - Todo desenvolvimento e teste executado no staging primeiro
  - Deploy em produção somente após validação no staging

### 14.2 Infraestrutura proposta

| Serviço | Uso | Observação |
|---------|-----|-----------|
| Firebase Hosting | Frontend estático | Migrar para plano **Blaze** |
| Cloud Firestore | Banco de dados | Blaze (pay-as-you-go) |
| Firebase Authentication | Auth | Mesmo projeto |
| Cloud Functions Node.js 18 | Lógica de negócio | **Exige plano Blaze** |
| Firebase Storage | PDFs de recibos | 5GB gratuitos no Blaze |
| Firebase Extension Trigger Email | Notificações email | **Brevo SMTP gratuito (300/dia).** Email genérico verificado. ✅ P03 — 06/05/2026 |
| Cloud Scheduler | CFs agendadas | 3 jobs gratuitos |

> ⚠️ **Migrar para plano Blaze é pré-condição obrigatória para Cloud Functions.**  
> Estimativa de custo incremental para o volume esperado: < R$ 30/mês.

### 14.3 Arquivos de configuração a criar

```
firebase.json
.firebaserc
firestore.rules
firestore.indexes.json
storage.rules
functions/package.json
functions/index.js
```

### 14.4 Atualização do Service Worker

```js
const STATIC_ASSETS = [
  './', './index.html', './commission.js', './manifest.json',
  './firebase-config.js',       // NOVO
  './professores.html',         // NOVO
  './professores.js',           // NOVO
  './professores-agenda.js',    // NOVO
  './professores-subs.js',      // NOVO
  './professores-fechamento.js',// NOVO
];
```

---

## 15. EXEMPLOS DE CÓDIGO COMPLETOS

### 15.1 Migração inline de userProfile (professores.html)

```js
auth.onAuthStateChanged(async user => {
  if (!user) { showLogin(); return; }
  const doc = await db.collection('users').doc(user.uid).get();
  if (!doc.exists) { auth.signOut(); return; }

  userProfile = doc.data();

  if (!userProfile.profiles) {
    userProfile.profiles    = [userProfile.role];
    userProfile.moduleAccess = {
      comissoes: ['admin','vendedor'].includes(userProfile.role),
      professores: userProfile.role === 'admin',
    };
    db.collection('users').doc(user.uid)
      .update({ profiles: userProfile.profiles, moduleAccess: userProfile.moduleAccess })
      .catch(() => {});
  }

  if (!userProfile.moduleAccess?.professores) { showAccessDenied(); return; }
  AppState.currentUser = user;
  AppState.userProfile = userProfile;
  showApp();
});
```

### 15.2 Cloud Function: closeMonth (atômico e irreversível)

```js
exports.closeMonth = onCall(async (request) => {
  const { closingId, closedBy } = request.data;
  const db  = admin.firestore();

  // Verificar perfil
  const userDoc  = await db.collection('users').doc(request.auth.uid).get();
  const profiles = userDoc.data()?.profiles || [userDoc.data()?.role];
  if (!profiles.includes('admin') && !profiles.includes('admin_gestao'))
    throw new HttpsError('permission-denied', 'Apenas administradores podem fechar o mês.');

  // Verificar estado
  const closingRef  = db.collection('monthly_closings').doc(closingId);
  const closingSnap = await closingRef.get();
  if (!closingSnap.exists) throw new HttpsError('not-found', 'Fechamento não encontrado.');
  if (closingSnap.data().status === 'fechado')
    throw new HttpsError('failed-precondition', 'Este mês já foi fechado.');

  const { unitId, month, year } = closingSnap.data();
  const start = new Date(year, month - 1, 1);
  const end   = new Date(year, month, 1);

  // Buscar classes do período
  const classesSnap = await db.collection('classes')
    .where('unitId', '==', unitId)
    .where('scheduledDate', '>=', admin.firestore.Timestamp.fromDate(start))
    .where('scheduledDate', '<',  admin.firestore.Timestamp.fromDate(end))
    .get();

  // Batch atômico
  const batch = db.batch();
  classesSnap.forEach(doc => batch.update(doc.ref, { monthClosingId: closingId }));
  batch.update(closingRef, {
    status: 'fechado', closedBy,
    closedAt: admin.firestore.FieldValue.serverTimestamp(),
    totalClasses: classesSnap.size,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('audit_log').doc(), {
    type: 'fechamento_mensal', module: 'professores',
    entityType: 'monthly_closing', entityId: closingId,
    details: `Mês ${month}/${year} fechado — ${classesSnap.size} aulas`,
    userId: request.auth.uid, userName: userDoc.data().name,
    unitId, timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { success: true, totalClasses: classesSnap.size };
});
```

### 15.3 Cálculo de pagamento — estagiário

```js
function calcInternPayment(totalPaidMinutes, salary) {
  const limitMinutes       = salary.internMonthlyLimitHours * 60;
  const surplusMinutes     = Math.max(0, totalPaidMinutes - limitMinutes);
  const internStipend      = salary.internMonthlyStipend;
  const surplusAmount      = (surplusMinutes / 60) * salary.internProportionalHourlyRate;
  return {
    internStipendAmount:  internStipend,
    internSurplusMinutes: surplusMinutes,
    internSurplusAmount:  surplusAmount,
    totalAmount:          internStipend + surplusAmount,
  };
}
// Exemplo: limite=20h, bolsa=R$1.000, taxa=R$30/h, realizado=22h (1320min)
// surplusMinutes=120, surplusAmount=R$60, total=R$1.060
```

### 15.4 Indicador "Livre" na agenda geral

```js
function renderScheduleCell(date, startTime, unitId, classesCache) {
  const relevant = classesCache.filter(c =>
    c.unitId === unitId &&
    c.scheduledDate.toDate().toDateString() === date.toDateString() &&
    c.startTime === startTime &&
    c.status !== 'cancelada'
  );
  if (!relevant.length)
    return `<div class="cell free"><span>🟢 Livre</span></div>`;
  return relevant.map(c =>
    `<div class="cell occupied">
       <div class="cell-teacher">${c.teacherName}</div>
       <div class="cell-modality">${c.modalityName}</div>
       <div class="cell-unit">${c.unitName}</div>
     </div>`
  ).join('');
}
```

### 15.5 Solicitação de substituição direta (frontend)

```js
async function requestDirectSubstitution(classId, substituteTeacherId, reason, note) {
  const eligible = await SubstitutionService.isEligibleForModality(
    substituteTeacherId, AppState.selectedClass.modalityId
  );
  if (!eligible) { toast('Professor não habilitado para esta modalidade.', 'error'); return; }

  const classStart = AppState.selectedClass.scheduledDate.toDate();
  if (new Date() >= classStart) { toast('Aula já iniciou. Solicite ajuste à gestão.', 'error'); return; }

  const result = await SubstitutionService.requestDirect(
    classId, substituteTeacherId, reason, note, AppState.currentUser.uid
  );
  if (!result.success) { toast('Erro: ' + result.error, 'error'); return; }

  toast('Solicitação enviada! Aguardando aceite do colega.', 'success');
  closeModal();
  renderAgenda();
}
```

---

## 16. METODOLOGIA DE IMPLEMENTAÇÃO / ROADMAP TÉCNICO

### 16.1 Pré-condições obrigatórias

- [ ] Migrar projeto Firebase para plano **Blaze**
- [ ] Instalar Firebase CLI, criar `firebase.json`, `.firebaserc`
- [ ] Criar e testar `firestore.rules` no Emulator
- [ ] Criar `firestore.indexes.json`
- [x] Provedor de email: **Brevo gratuito** ✅ P03 resolvido
  - Criar conta em brevo.com
  - Criar email genérico dedicado (ex: `notificacoes.crosstrainer@gmail.com`)
  - Verificar o remetente no painel Brevo (Settings → Senders)
  - Obter credenciais SMTP (host: `smtp-relay.brevo.com`, porta: `587`)
  - Configurar Firebase Extension "Trigger Email" com essas credenciais
- [ ] Confirmar lista de modalidades CrossTainer **[A DEFINIR — P01]**
- [ ] Confirmar regra de feriado para estagiário **[A DEFINIR — P02]**
- [ ] Definir ambiente de staging **[A DEFINIR — P04]**

### 16.2 Fases e critérios de aceite

| Fase | Escopo | Estimativa | Critério de aceite |
|------|--------|-----------|-------------------|
| 0 — Fundação | firebase-config.js, Security Rules, índices, migração de users, seed | 1 semana | Admin vê link "Professores" em index.html; Security Rules passam no Emulator |
| 1 — Cadastro de professores | professores.html base, CRUD teachers, aba salarial, vínculo unidade/modalidade | 1,5 semanas | Admin cria professor; Supervisão não vê aba salarial; Auditoria registra before/after |
| 2 — Agenda semanal | schedule_templates, schedule_slots, classes, WeeklyScheduleGrid, GeneralScheduleViewer, geração de instâncias | 2 semanas | Admin cria grade; Professor vê agenda geral de todas as unidades; "Livre" aparece em slots vazios |
| 3 — Substituições | SubstitutionRequestModal, CoverageBoardPanel, AcceptancePanel, CF processSubstitutionAcceptance, notificações | 2 semanas | Fluxo completo: solicita → aceita → classes.teacherId atualizado; prazo bloqueado |
| 4 — Fechamento e Pagamento | MonthlyClosingPanel, CF closeMonth + calculatePayment, recibos | 2 semanas | Pagamento calculado corretamente efetivo e estagiário; recibo gerado; reabertura bloqueada |
| 5 — Escalas Especiais | SpecialScaleManager, preferências, equilíbrio, CF autoAllocate | 1,5 semanas | Gestão cria escala; professor registra preferência; alocação automática equilibrada |
| 6 — Férias e Recesso | VacationRequestForm, aprovação, bloqueio agenda, CF checkVacationAlerts (cron) | 1,5 semanas | Férias aprovadas bloqueiam agenda; alerta 30 dias enviado por email |
| 7 — Notificações e Email | NotificationCenter, Firestore trigger, Extension Trigger Email, templates | 1 semana | Professor recebe notificação interna + email ao ser solicitado como substituto |
| 8 — Relatórios e Auditoria | AuditLogViewer before/after, relatórios, exportação Excel/PDF | 1 semana | Relatório de horas bate com cálculo do fechamento; auditoria mostra before/after |
| 9 — Hardening | Revisão Security Rules, performance, índices, documentação | 0,5 semana | Zero regressões no módulo de comissões; testes de Security Rules 100% |

**Total estimado: ~14 semanas**

---

## MATRIZES OBRIGATÓRIAS

### M1. Rastreabilidade Requisito → Evidência → Técnica → Pendência

| RF | Descrição resumida | Evidência no código | Proposta técnica | Pendência |
|----|-------------------|-------------------|-----------------|-----------|
| RF01 | Cadastrar professor | ❌ | `teachers` + `teacher_salaries` + TeacherService | P01 (modalidades) |
| RF02 | Agenda recorrente e avulsa | ❌ | `schedule_templates` + `schedule_slots` + `classes` | — |
| RF03 | Edição de escala admin/gestão | ❌ | CRUD `schedule_slots` + `classes` | — |
| RF04 | Ver própria agenda (professor) | ❌ | `classes` where `teacherId==uid` | — |
| RF05 | Ver agenda geral (professor) | ❌ | `GeneralScheduleViewer` (leitura) | — |
| RF06 | Ver todas as unidades | ❌ | Query sem filtro de unidade | — |
| RF07 | Nome + modalidade + unidade | ❌ | Campos desnormalizados em `classes` | — |
| RF08 | Indicador "Livre" automático | ❌ | `getFreeSlots()` + badge visual | — |
| RF09 | Substituição direta | ❌ | `substitutions` type=direta + CF | — |
| RF10 | Cobertura em aberto | ❌ | `substitutions` type=cobertura + `coverage_applications` | — |
| RF11 | Aceite/recusa substituto | ❌ | CF `processSubstitutionAcceptance` (transacional) | — |
| RF12 | Transferência de horas após aceite | ❌ | `classes.teacherId` atualizado na CF | — |
| RF13 | Histórico completo da troca | ❌ | `substitutions` + `audit_log` | — |
| RF14 | Consolidar horas do mês | ❌ | CF `calculatePayment` | — |
| RF15 | Ajuste manual no fechamento | ❌ | `payment_records.manualAdjustment` | — |
| RF16 | Fechar competência sem reabertura | ❌ | CF `closeMonth` + Security Rule | — |
| RF17 | Pagamento efetivo feriado dobrado | ❌ | Fórmula § 9.4 | — |
| RF18 | Estagiário excedente proporcional | ❌ | Fórmula § 9.4 | P02 (feriado estagiário) |
| RF19 | Recibos + registro de pagamento | ✅ parcial (padrão comissões) | `receipts` + CF `generateReceipt` | P03 (provedor PDF) |
| RF20 | Relatórios | ❌ | Fase 8 | P08 (formatos) |
| RF21 | Auditoria completa | ✅ parcial (sem before/after) | Extensão `audit_log` + AuditService | — |
| RF22 | Mobile completo para professor | ✅ PWA base | Layout mobile-first no módulo professor | — |
| RF23 | Desktop/mobile para admin | ✅ parcial | Estender páginas mobile admin | — |
| RF24 | Escalas especiais | ❌ | `special_scales` + CF + SpecialScaleManager | Algoritmo equilíbrio |
| RF25 | Férias e recesso | ❌ | `vacation_requests` + CF scheduler | — |
| RF26 | Aba salarial restrita ao admin | ❌ | `teacher_salaries` separado + Security Rule | — |
| RF27 | Reutilizar estrutura de usuários | ✅ `users` existe | Extensão com `profiles[]` + `moduleAccess{}` | Migração docs existentes |
| RF28 | Menu dinâmico por moduleAccess | ❌ | `buildSidebarProfessores()` por `getAllowedPages()` | — |
| RF29 | Segregação total entre módulos | ❌ | Security Rules + `moduleAccess{}` + guards de rota | — |

### M2. Compatibilidade com o Sistema Atual

| Componente | Impacto | Ação | Risco |
|-----------|---------|------|-------|
| `index.html` (10.829 linhas) | Mínimo — 2 adições na sidebar | Link para professores.html + moduleAccess check | Baixo |
| `commission.js` | Nenhum | Sem alteração | Zero |
| `sw.js` | Baixo | Atualizar `STATIC_ASSETS[]` | Baixo |
| `users/{uid}` docs | Médio | Adicionar `profiles[]`, `moduleAccess{}` (backward compat) | Baixo |
| `audit_log` docs | Zero | Campos extras ignorados por leituras existentes | Zero |
| Coleções de comissões | Nenhum | Intocadas | Zero |
| Firebase Auth | Nenhum | Sem alteração | Zero |
| Firestore Security Rules | Alto | Criação obrigatória (não existe atualmente) | Médio — testar no Emulator antes |

### M3. Itens Fora de Escopo

| Item | Motivo |
|------|--------|
| Push notifications mobile | Explicitamente fora — funcional § 17.1 |
| Assinatura digital de recibos | Funcional § 12.2: não necessária |
| Integração ERP / folha de pagamento | Não mencionado |
| App nativo iOS/Android | PWA suficiente |
| Controle de presença de alunos | Módulo distinto |
| Feriados via API externa | Por ora, cadastro manual [A DEFINIR] |
| BI / analytics avançado | Relatórios básicos no escopo |
| Multi-tenant | Fora do escopo — cliente único |

### M4. Pendências que Exigem Decisão

| # | Pendência | Impacto | Sugestão |
|---|-----------|---------|---------|
| P01 | Lista completa de modalidades CrossTainer | Fase 1 bloqueada sem seed | Enviar antes da Fase 1 |
| P02 | ~~Feriado dobra pagamento do estagiário?~~ | ~~Fórmula incompleta~~ | ✅ **Resolvido 06/05/2026:** Sim. Dobro incide sobre horas excedentes proporcionais (não sobre bolsa fixa). Ver fórmula § 9.4. |
| P03 | ~~Provedor de email~~ | ~~Fase 7 bloqueada~~ | ✅ **Resolvido 06/05/2026:** Brevo gratuito (300/dia). Email genérico sem domínio próprio. SMTP configurado na Firebase Extension "Trigger Email". |
| P04 | ~~Ambiente de staging~~ | ~~Testes sem risco~~ | ✅ **Resolvido 06/05/2026:** Projeto `crosstrainer-comissoes-staging`. `.firebaserc` com dois targets. |
| P05 | ~~CPF: armazenar completo ou mascarado?~~ | ~~Conformidade LGPD~~ | ✅ **Resolvido 06/05/2026:** Mascarado no banco (`***.456.789-**`). Recibos exibem CPF mascarado. |
| P06 | ~~Recibo cancelado gera crédito automático?~~ | ~~Fluxo de cancelamento incompleto~~ | ✅ **Resolvido 06/05/2026:** Sim. Cancelamento gera recibo `status:'complemento'` com crédito a aplicar no próximo fechamento. |
| P07 | ~~Duração configurável da janela de escalas~~ | ~~Parâmetro `windowMonths`~~ | ✅ **Resolvido 06/05/2026:** Configurável por escala. Padrão = 3 meses. |
| P08 | ~~Relatórios exportáveis: PDF vs. Excel~~ | ~~Escopo da Fase 8~~ | ✅ **Resolvido 06/05/2026:** Relatórios → Excel (XLSX.js já existente). Recibos → PDF (Cloud Function + Puppeteer). |
| P09 | ~~Professor eventual: regra de pagamento~~ | ~~`type:'eventual'` sem fórmula definida~~ | ✅ **Resolvido 02/05/2026:** igual ao efetivo — R$/hora, feriado dobra |
| P10 | ~~Regra financeira por motivo de cancelamento~~ | ~~Impacto no cálculo do fechamento~~ | ✅ **Resolvido 02/05/2026:** professor NÃO recebe em nenhum caso de cancelamento, independente do motivo |

---

*Fim da Especificação Técnica Detalhada — Módulo de Professores CrossTainer V1*  
*Base funcional: Proposta_Funcional_Consolidada_Modulo_Professores_CrossTainer_V3.md (29 RFs, 23 RNs)*  
*Base de código: crosstrainer-comissoes/index.html (10.829 linhas), commission.js, sw.js*  
*Gerado em: 23/04/2026*
