# Sprint 0-B — Infraestrutura Firebase
**Objetivo:** Preparar todo o substrato técnico do projeto antes de qualquer linha de código de produto.
**Duração estimada:** 1 semana
**Pré-condições:** ✅ Sprint 0-A concluído (todas as decisões M4 resolvidas)

---

## 1. O que esta sprint faz

Cria a base de infraestrutura sobre a qual os Sprints 1-9 vão rodar. Ao fim desta sprint:
- Firebase está em plano Blaze (pago, exigência das Cloud Functions)
- Existem dois projetos Firebase: produção e staging
- Firebase CLI configurado localmente, com dois targets (`staging` / `production`)
- Security Rules deployadas e testadas no Emulator
- Índices Firestore criados
- Documentos de `users/{uid}` existentes migrados (campos novos `profiles[]` e `moduleAccess{}`)
- Coleções de seed criadas (`special_scale_types`)
- Brevo configurado com Trigger Email
- **Zero regressão** no módulo de comissões existente

---

## 2. Divisão de responsabilidades

### 👤 Quem você precisa que faça (envolve credenciais)

| # | Tarefa | Onde |
|---|--------|------|
| 1 | Migrar projeto `crosstrainer-comissoes` de Spark → Blaze | Console Firebase |
| 2 | Criar projeto novo `crosstrainer-comissoes-staging` em Blaze | Console Firebase |
| 3 | Criar email genérico de notificações (ex: `notificacoes.crosstrainer@gmail.com`) | Gmail |
| 4 | Criar conta Brevo gratuita + verificar o email criado em (3) | brevo.com |
| 5 | Anotar credenciais SMTP do Brevo | Painel Brevo |
| 6 | Instalar Node.js 18+ e Firebase CLI: `npm install -g firebase-tools` | Terminal local |
| 7 | Login no Firebase CLI: `firebase login` | Terminal local |
| 8 | Executar `firebase deploy` quando os arquivos estiverem prontos (eu te aviso) | Terminal local |

### 🤖 O que eu gero (código de configuração)

| # | Arquivo | Status |
|---|---------|--------|
| 1 | `firebase.json` — config geral | ⚠️ A gerar |
| 2 | `.firebaserc` — aliases dos projetos (staging/production) | ⚠️ A gerar |
| 3 | `firestore.rules` — Security Rules completas | ⚠️ A gerar (base na §12 da spec) |
| 4 | `firestore.indexes.json` — índices compostos | ⚠️ A gerar (base na §11.1 da spec) |
| 5 | `storage.rules` — Storage Rules | ⚠️ A gerar (base na §12.2 da spec) |
| 6 | `functions/package.json` — dependências das Cloud Functions | ⚠️ A gerar |
| 7 | `functions/index.js` — entry point (vazio, populado pelos sprints) | ⚠️ A gerar |
| 8 | `firebase-config.js` — config compartilhada front (existente + novos) | ⚠️ A gerar |
| 9 | `scripts/migrate-users-to-profiles.js` — migra users existentes | ⚠️ A gerar |
| 10 | `scripts/seed-special-scale-types.js` — seed dos 4 tipos de escala | ⚠️ A gerar |

---

## 3. Sequência de execução

### Etapa 1 — Setup das contas (você executa)

```
[ ] 1.1 Console Firebase → Projetos → crosstrainer-comissoes
        Settings → Plan → Upgrade to Blaze
        (cartão de crédito obrigatório, Google adiciona R$ 220 de crédito grátis)

[ ] 1.2 Console Firebase → "Adicionar projeto"
        Nome: crosstrainer-comissoes-staging
        Configurar em Blaze também
        Anotar o Project ID gerado

[ ] 1.3 Gmail → criar conta nova
        Sugestão: notificacoes.crosstrainer@gmail.com
        Anotar credenciais (você guarda no seu password manager)

[ ] 1.4 brevo.com → criar conta gratuita
        Settings → Senders & IP → Senders → adicionar
        Email: notificacoes.crosstrainer@gmail.com
        Validar via link enviado para o gmail

[ ] 1.5 Brevo → SMTP & API → SMTP
        Anotar:
        - host: smtp-relay.brevo.com
        - port: 587
        - login: <seu-email-brevo>
        - master password: <senha-gerada-pelo-brevo>
```

### Etapa 2 — Setup local (você executa)

```bash
# Instalar Node 18+ se ainda não tem
node --version  # deve mostrar v18.x ou superior

# Instalar Firebase CLI globalmente
npm install -g firebase-tools

# Login (abre navegador)
firebase login

# Verificar projetos visíveis
firebase projects:list
# Deve listar crosstrainer-comissoes E crosstrainer-comissoes-staging
```

### Etapa 3 — Aplicar arquivos de configuração (eu gero, você aplica)

Os arquivos abaixo serão gerados pelo Claude e ficam na raiz do projeto. Você revisa e executa:

```bash
# Validar configuração local
firebase use staging  # apontar para staging primeiro
firebase emulators:start --only firestore,auth

# Em outro terminal: testar regras no emulator
# (script de teste a ser gerado)

# Quando estiver tudo OK no staging:
firebase deploy --only firestore:rules,firestore:indexes,storage:rules

# Depois replicar em produção (via target)
firebase deploy --only firestore:rules,firestore:indexes,storage:rules --project production
```

### Etapa 4 — Migração de dados (você executa após Etapa 3)

```bash
# Rodar a migração de usuários (apenas em staging primeiro)
node scripts/migrate-users-to-profiles.js --project staging

# Verificar no Console Firebase que os usuários ganharam profiles[] e moduleAccess{}

# Rodar o seed de special_scale_types
node scripts/seed-special-scale-types.js --project staging

# Quando staging estiver validado:
node scripts/migrate-users-to-profiles.js --project production
node scripts/seed-special-scale-types.js --project production
```

### Etapa 5 — Configurar Trigger Email (você executa via Console)

```
[ ] 5.1 Console Firebase (staging) → Extensions → Procurar "Trigger Email"
        Instalar: firebase/firestore-send-email
        
[ ] 5.2 Configurar com:
        - SMTP connection URI: smtps://<login>:<password>@smtp-relay.brevo.com:587
        - Email documents collection: mail
        - Default FROM address: notificacoes.crosstrainer@gmail.com
        - Default REPLY-TO address: notificacoes.crosstrainer@gmail.com
        
[ ] 5.3 Testar enviando manualmente um documento na coleção `mail`:
        {
          to: ["seu-email@teste.com"],
          message: {
            subject: "Teste",
            text: "Funciona!"
          }
        }

[ ] 5.4 Repetir em produção
```

### Etapa 6 — Validação final (eu gero o checklist, você executa)

```
[ ] 6.1 Login na app de produção (index.html) com usuário admin existente
        → Sidebar deve continuar mostrando módulo de Comissões normalmente
        → Verificar que NADA quebrou

[ ] 6.2 Verificar no Firestore que docs de users tem agora:
        - role (existente)
        - profiles[]  (novo)
        - moduleAccess{} (novo)

[ ] 6.3 Verificar coleção special_scale_types tem 4 documentos
        (sabado, feriado, domingo_especial, evento_especial)

[ ] 6.4 Tentar acessar console Firestore com regras ativas
        → Tentativas não-autenticadas devem ser bloqueadas
```

---

## 4. Arquivos a gerar (conteúdo nos arquivos do projeto)

Os arquivos de configuração já estão sendo criados pelo Claude na raiz do projeto:

```
crosstrainer-comissoes/
├── firebase.json                                    ← CRIADO
├── .firebaserc                                      ← CRIADO
├── firestore.rules                                  ← CRIADO
├── firestore.indexes.json                           ← CRIADO
├── storage.rules                                    ← CRIADO
├── firebase-config.js                               ← CRIADO
├── functions/
│   ├── package.json                                 ← CRIADO
│   └── index.js                                     ← CRIADO (esqueleto)
└── scripts/
    ├── migrate-users-to-profiles.js                 ← CRIADO
    └── seed-special-scale-types.js                  ← CRIADO
```

---

## 5. Critérios de aceite

A sprint está completa quando **todos** os itens abaixo estiverem ✅:

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Projeto produção em Blaze | Console Firebase → Settings → Plan |
| 2 | Projeto staging criado em Blaze | `firebase projects:list` mostra os dois |
| 3 | Firebase CLI funcionando | `firebase use --add` aceita ambos os projetos |
| 4 | Security Rules deployadas em staging E produção | Console Firestore → Rules tab mostra a versão nova |
| 5 | Índices criados em staging E produção | Console Firestore → Indexes tab |
| 6 | Storage Rules deployadas | Console Storage → Rules tab |
| 7 | Trigger Email instalado e testado em staging E produção | Email de teste foi recebido |
| 8 | Usuários migrados (profiles[] e moduleAccess{}) | Console Firestore → users → qualquer doc tem os campos |
| 9 | Seed de `special_scale_types` aplicado | Console Firestore → 4 docs na coleção |
| 10 | **Zero regressão no módulo de comissões** | Login com admin funciona, dashboard de comissões abre, upload de planilha funciona |

---

## 6. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Security Rules nova bloqueia o módulo de comissões | 🔴 Alta se mal escrita | Testar 100% no Emulator antes do deploy. Aplicar em staging antes de produção. |
| Migração de users falha em produção e deixa docs corrompidos | 🟡 Média | Script é idempotente (verifica antes de gravar). Backup automático: o doc original tem todos os campos preservados. |
| Custo Blaze inesperado | 🟢 Baixa | Volume estimado < R$ 30/mês para esse caso. Google dá R$ 220 de crédito grátis. |
| Trigger Email não autentica no Brevo | 🟡 Média | Verificar credenciais SMTP. Brevo às vezes pede confirmação adicional para envios autom. |
| Cliente não consegue migrar para Blaze (cartão recusado) | 🟢 Baixa | Tentar com cartão alternativo. Como último recurso, usar conta Google diferente. |

---

## 7. Após a sprint

Sprint 0-B termina quando os 10 critérios estiverem ✅. Depois disso:
- 🟢 Sprint 1 (Cadastro de Professores) está pronto para iniciar
- O projeto agora tem ambiente staging para validar tudo antes de produção
- Cloud Functions podem ser deployadas (vão sendo adicionadas a partir do Sprint 3)

---

## Anexos — referência rápida

### Plano Blaze — custo esperado
- Firestore: 50K reads + 20K writes + 1GB storage = grátis no tier diário
- Cloud Functions: 2M invocações/mês = grátis
- Storage: 5GB = grátis
- Email (Brevo gratuito): 300 emails/dia = grátis
- **Custo estimado real:** R$ 0 a R$ 30/mês

### Comandos Firebase úteis
```bash
firebase use staging                          # apontar local para staging
firebase use production                       # apontar para produção
firebase deploy --only firestore:rules        # só rules
firebase deploy --only firestore:indexes      # só índices
firebase deploy --only storage                # só storage rules
firebase deploy --only functions              # só cloud functions
firebase emulators:start                      # iniciar emulator local
firebase firestore:delete --recursive /users  # apagar coleção (USAR COM CUIDADO)
```
