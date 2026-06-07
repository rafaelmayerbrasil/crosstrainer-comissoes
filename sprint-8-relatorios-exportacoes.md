# Sprint 8 — Relatórios e Exportações
**Objetivo:** Entregar 4 relatórios exportáveis em Excel (.xlsx) e PDF, todos gerados no navegador (client-side, sem Cloud Function). Cobre as áreas operacional, financeira e de RH do módulo de Professores.
**Pré-condições:** ✅ Sprints 1, 1.5, 2, 3a, 3b, 4a, 4b, 5a, 6a, 6b, 6c validadas em staging.
**Duração estimada:** 7-8 dias úteis.

> 💡 **Escopo travado em 07/06/2026:** 4 relatórios (Fechamentos · Saldos · Horas · Recibos em lote) · ambos formatos (Excel + PDF) · geração 100% no browser.

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- **Sidebar Admin/Gestão ganha item "📊 Relatórios"** com 4 sub-relatórios
- **Filtros padronizados** em cada relatório: período · unidade · professor (quando aplicável) · status
- **Preview no browser** antes da exportação (tabela com paginação)
- **2 botões em cada relatório**: 📥 **Excel** · 📄 **PDF** (gerados sob demanda)
- **Relatório 1 — Fechamentos Mensais**: detalhe de 1 ou vários fechamentos com totais por professor
- **Relatório 2 — Saldos de Férias**: tabela com período aquisitivo CLT, dias tirados/restantes e status por professor
- **Relatório 3 — Horas por Professor**: histórico de aulas com modalidade, horas e valor pago num período
- **Relatório 4 — Recibos em Lote**: PDFs de recibos de todo um fechamento, em **arquivo único** (PDF concatenado) ou **ZIP de PDFs individuais**
- **Audit log** com `module: 'relatorios'` ao exportar (rastreia quem exportou o quê e quando)
- **Smoke test** com 8 critérios + fixture-8

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Sidebar item "📊 Relatórios" | Admin · admin_gestao apenas. Supervisor e professor sem acesso |
| Página `page-relatorios` | 4 cards/seções, cada uma com filtros + preview + botões de export |
| Bibliotecas client-side via CDN | SheetJS (xlsx) · jsPDF · jsPDF-autotable · JSZip |
| **R1 Fechamentos Mensais** | Filtros: unidade · ano/mês (1 ou range). Excel: 1 sheet por fechamento + sheet resumo. PDF: 1 página por fechamento |
| **R2 Saldos de Férias** | Filtros: unidade · tipo (efetivo/estagiário) · status (todos/vencidas/vencendo/ok). Tabela com período aquisitivo + dias tirados/restantes + badge status |
| **R3 Horas por Professor** | Filtros: período (range customizado) · professor (1 ou todos) · unidade. Detalhamento de aulas com data, modalidade, horas, valor |
| **R4 Recibos em Lote** | Filtros: fechamento (1 mês fechado). Saída: PDF único concatenado OU ZIP com 1 PDF por professor |
| **Branding nos PDFs** | Cabeçalho com nome "CrossTainer ELITE" + logo + data de geração + filtros aplicados |
| **Cabeçalho do Excel** | Linha 1 = título · linha 2 = filtros aplicados · linha 3 em branco · linha 4 = cabeçalhos · linha 5+ = dados |
| **Audit log** | `module: 'relatorios'`, type: `report_exported`, payload: tipo do relatório + filtros + formato |
| **Limite de segurança** | Aviso visual se preview retorna > 5.000 linhas: "Relatório grande — exportação pode demorar X segundos" |
| **Smoke test** | 8 critérios automatizáveis via `scripts/admin.js smoke-8` |
| **Fixture-8** | Gera dados sintéticos pra cada relatório, valida formato, limpa |

### ❌ NÃO ENTRA (vai pra backlog ou outra sprint)

| Item | Destino |
|------|---------|
| Envio de relatório por email | Sprint 7 (Brevo) — quando rodar |
| Agendamento recorrente (mensal automático) | Backlog — requer Cloud Function + scheduler |
| Gráficos interativos (dashboards) | Backlog — escopo separado |
| Comparativo entre períodos lado-a-lado | Backlog |
| Exportação CSV | Backlog — Excel cobre o caso de uso |
| Edição/customização de template de PDF pelo admin | Backlog — branding é fixo nesta sprint |
| Relatório consolidado anual (12 fechamentos) | Backlog — pode ser pedido pela contabilidade |
| Relatório de substituições/coberturas (Sprint 3b) | Backlog — útil mas escopo grande |
| Relatório de auditoria (audit_log) | Backlog — útil pra LGPD |
| Streaming/processamento de relatórios > 50k linhas | Backlog — exigiria Cloud Function |

---

## 3. Arquivos a criar/modificar

```
crosstrainer-comissoes/
├── professores.html                      ← MOD — page-relatorios + CSS dos cards + scripts CDN
├── professores.js                        ← MOD — sidebar item + routing
├── professores-shared.js                 ← MOD — ReportService (queries + transformações)
├── professores-relatorios.js             ← NOVO — render + handlers de export (Excel + PDF + ZIP)
├── scripts/
│   ├── admin.js                          ← MOD — smoke-8 (valida que coleções estão acessíveis)
│   └── fixture-8.js                      ← NOVO — fixture autônoma que valida estrutura de cada relatório
└── firestore.rules                       ← (sem mudanças — só leituras já permitidas)
```

**Sem alterações em:** `functions/index.js`, `firestore.indexes.json` — sprint 100% client-side. Pode reaproveitar índices existentes em `monthly_closings`, `vacation_requests`, `classes`, `teachers`.

---

## 4. Bibliotecas client-side via CDN

Adicionar em `professores.html`:

```html
<!-- Sprint 8 — Relatórios e Exportações -->
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.0/dist/jspdf.plugin.autotable.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
<script src="professores-relatorios.js" defer></script>
```

**Tamanho aproximado:** ~600KB total (todos minificados). Aceitável pra carregamento lazy quando o admin abre a página de relatórios.

**Cache:** todos os CDNs têm headers de cache longo, então segunda visita é instantânea.

> ⚠️ **Carregamento lazy obrigatório:** os 4 scripts só devem ser carregados quando admin acessar a página de Relatórios. Isso evita penalizar usuários comuns. Implementar com `<script defer>` na página principal + check de `window.XLSX` antes de usar.

---

## 5. Estrutura de dados retornada pelo `ReportService`

Cada método do Service retorna um objeto padronizado:

```js
{
  success: true,
  data: {
    title: 'Fechamento — Unidade CP — Junho/2026',
    generatedAt: Date,
    filters: { unitId: 'unit-cp', year: 2026, month: 6 },
    columns: [
      { key: 'teacherName', label: 'Professor', width: 30 },
      { key: 'classesCount', label: 'Aulas', width: 10, type: 'number' },
      { key: 'totalHoras', label: 'Horas', width: 10, type: 'number' },
      { key: 'valorHoras', label: 'Valor Horas', width: 15, type: 'currency' },
      { key: 'vacationValue', label: 'Férias', width: 15, type: 'currency' },
      { key: 'valorTotal', label: 'Total', width: 15, type: 'currency', bold: true },
    ],
    rows: [
      { teacherName: 'Lucas Mendes', classesCount: 24, totalHoras: 48, ... },
      // ...
    ],
    summary: {                                  // opcional, vai no rodapé do PDF e numa linha extra do Excel
      totalProfessors: 12,
      totalHoras: 540,
      totalValor: 32800.00,
    },
    badge: 'fechado',                           // opcional, pra status
  }
}
```

Essa estrutura unificada permite que `exportToExcel(data)` e `exportToPdf(data)` sejam funções genéricas que aceitam qualquer relatório.

---

## 6. Sequência de implementação

### Etapa 1 — Setup + Service base + página vazia (~1 dia)

- [ ] Adicionar 4 `<script>` CDN em `professores.html` (no fim do body, antes de `professores.js`)
- [ ] Sidebar item "📊 Relatórios" em `professores.js` na seção "Financeiro"
- [ ] Routing pra `page-relatorios`
- [ ] HTML da página: 4 cards (1 por relatório) + cada card com placeholder de filtros + 2 botões
- [ ] `ReportService` em `professores-shared.js` com skeleton dos 4 métodos:
  - `getFechamentosReport(filters)`
  - `getSaldosFeriasReport(filters)`
  - `getHorasPorProfessorReport(filters)`
  - `getRecibosLoteReport(filters)`
- [ ] `professores-relatorios.js` com `exportToExcel(data)` e `exportToPdf(data)` genéricos

### Etapa 2 — R1 Fechamentos Mensais (~1,5 dia)

- [ ] Filtros: select de unidade + ano + mês (com opção "range")
- [ ] Preview: tabela paginada (50 linhas por página)
- [ ] `ReportService.getFechamentosReport`:
  - Busca `monthly_closings` da unidade no período
  - Achata em linhas: 1 linha por (closing, professor)
  - Inclui `vacationValue` (Sprint 6b) quando aplicável
- [ ] Excel: 1 sheet por fechamento + sheet "Resumo" com totais agregados
- [ ] PDF: header com unidade + período · tabela com totais por professor · rodapé com totais gerais

### Etapa 3 — R2 Saldos de Férias (~1 dia)

- [ ] Filtros: unidade + tipo de professor + status (chips coloridos: todos/ok/vencendo/vencida)
- [ ] Preview: tabela com badges visuais
- [ ] `ReportService.getSaldosFeriasReport`:
  - Reusa `VacationBalanceService.getAllBalances()` da Sprint 6c
  - Aplica filtros client-side
- [ ] Excel: planilha única com cores na coluna "Status" (verde/amarelo/vermelho)
- [ ] PDF: tabela com badges visuais + rodapé com contagem por status

### Etapa 4 — R3 Horas por Professor (~1,5 dia)

- [ ] Filtros: período (date range), professor (multi-select), unidade
- [ ] Preview: tabela com 1 linha por aula realizada/substituída
- [ ] `ReportService.getHorasPorProfessorReport`:
  - Busca `classes` no range + status válido
  - Agrupa por professor (sumariza horas/valor)
  - Detalha por aula (data, modalidade, peso da escala se houver)
  - Inclui pagamentos de férias (Sprint 6b) que caíram no período
- [ ] Excel: sheet "Resumo" + sheet "Detalhado por aula"
- [ ] PDF: 1 página de resumo + páginas seguintes com detalhe (opcional via toggle "Incluir detalhamento")

### Etapa 5 — R4 Recibos em Lote (~1,5 dia)

- [ ] Filtros: select de fechamento (lista de monthly_closings da unidade)
- [ ] Preview: lista de recibos que serão gerados (prof, valor) + checkboxes pra excluir alguns
- [ ] Botões de saída:
  - 📄 **PDF único concatenado** — todos os recibos em 1 arquivo (1 página por recibo)
  - 📦 **ZIP** — 1 PDF por professor, agrupados em zip
- [ ] Reusa `receipt.html` rendering — gera HTML em iframe oculto, captura via `html2canvas` ou usa template direto em jsPDF
- [ ] Audit log: registra quantos recibos foram gerados
- [ ] Atenção: pode demorar pra fechamento grande (50+ profs) — mostrar progresso

### Etapa 6 — Comandos admin.js + Smoke + Fixture (~1 dia)

#### Comandos novos em `scripts/admin.js`
```
list-reports                            — lista tipos de relatório (estático)
smoke-8                                  — confere coleções acessíveis (monthly_closings + classes + vacation_requests + teachers)
```

#### Cenários do smoke-8
1. C1 — Coleção `monthly_closings` tem ≥ 1 fechamento (pra R1)
2. C2 — Coleção `teachers` tem ≥ 1 efetivo/estagiário (pra R2 e R3)
3. C3 — Coleção `classes` tem ≥ 1 aula realizada (pra R3)
4. C4 — Bibliotecas xlsx/jspdf carregam sem erro (testar via puppeteer — opcional)
5. C5 — `ReportService.getFechamentosReport` retorna estrutura válida
6. C6 — `ReportService.getSaldosFeriasReport` reusa Sprint 6c sem regressão
7. C7 — `ReportService.getHorasPorProfessorReport` agrupa corretamente
8. C8 — Audit log `module='relatorios'` é criado ao exportar

#### Fixture-8
- Cria 1 fechamento fake + 3 vacation_requests + 5 classes
- Roda cada `getXxxReport` localmente
- Valida que `data.rows.length > 0` e `data.columns` está consistente
- Limpa tudo

### Etapa 7 — Deploy + Validação (~0,5 dia)

- [ ] Deploy: `firebase deploy --only hosting --project staging`
- [ ] Rodar `smoke-8` em staging
- [ ] Rodar `fixture-8` em staging
- [ ] Validação visual:
  - Cliente abre cada relatório com filtros reais
  - Exporta em Excel — abre no Office, verifica formato
  - Exporta em PDF — confere branding + dados
  - Recibos em lote: testa com fechamento real, abre PDF + ZIP

---

## 7. Decisões importantes

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Escopo da sprint | **4 relatórios:** Fechamentos · Saldos · Horas · Recibos lote. Confirmado 07/06 |
| D2 | Formato | **Excel + PDF desde o início.** Confirmado 07/06 |
| D3 | Onde gerar | **Client-side** (browser). Sem Cloud Function. Confirmado 07/06 |
| D4 | Bibliotecas | **SheetJS + jsPDF + jsPDF-autotable + JSZip** via CDN (~600KB total, carregado lazy) |
| D5 | Acesso | Apenas `admin` e `admin_gestao`. Supervisor e professor sem acesso a esta página |
| D6 | Limite de tamanho | **5.000 linhas:** aviso visual mas não bloqueia. Acima de 20k: bloqueia com mensagem "Use filtros mais específicos ou solicite via TI" |
| D7 | Audit log | Toda exportação registra: tipo + filtros + formato + qtd de linhas + actor |
| D8 | Branding | Logo "CrossTainer ELITE" no header dos PDFs. Data de geração + filtros aplicados visíveis |
| D9 | Recibos em lote | 2 opções de saída: PDF único OU ZIP. Cliente escolhe na hora |
| D10 | Inclusão de férias nos relatórios financeiros | R1 e R3 incluem `vacationValue` (Sprint 6b) quando aplicável |
| D11 | Quando dados são parciais | Sistema preenche com "—" mas exporta normalmente. Nota no rodapé do PDF: "X registros sem dados completos" |
| D12 | Deploy em produção | Não. Aguarda homologação completa do módulo |
| D13 | Currency formatting | Padrão BR: R$ 1.234,56 (vírgula decimal, ponto de milhar) |
| D14 | Cabeçalho do Excel | Linha 1: título · Linha 2: filtros aplicados · Linha 3: vazia · Linha 4: cabeçalhos · Linha 5+: dados. Última linha: totais (negrito) |

---

## 8. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Sidebar "📊 Relatórios" visível pra admin/admin_gestao | Login admin · ver item · clicar e ver 4 cards |
| 2 | Bibliotecas xlsx/jspdf carregam sem erro | DevTools console limpo após acessar a página |
| 3 | R1 Fechamentos Mensais exporta Excel válido | Filtra por mês + unidade · click 📥 Excel · arquivo abre no Office com sheets corretas |
| 4 | R1 Fechamentos Mensais exporta PDF válido | Mesmo cenário · click 📄 PDF · arquivo abre com tabela + cabeçalho CrossTainer ELITE |
| 5 | R2 Saldos de Férias mostra status colorido | Excel: coluna Status com cor verde/amarelo/vermelho. PDF: badges visuais |
| 6 | R3 Horas por Professor permite range customizado | Filtro com data início + fim · resultados batem com período |
| 7 | R4 Recibos em Lote gera PDF único | Seleciona fechamento · click "PDF único" · arquivo abre com 1 página por professor |
| 8 | R4 Recibos em Lote gera ZIP | Mesmo cenário · click "ZIP" · arquivo zip baixa com PDFs individuais |
| 9 | Aviso de tamanho grande | Forçar filtros sem específicos · ver aviso "Relatório grande pode demorar" |
| 10 | Audit log registra exportação | Após cada export, ver `audit_log` com `module='relatorios'` |
| 11 | Currency em padrão BR | Valores como "R$ 1.234,56" (não 1234.56 nem $1,234.56) |
| 12 | Supervisor sem acesso à página | Login supervisor · sidebar sem item Relatórios |

---

## 9. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| CDN fora do ar quebra exportação | 🟡 Média | Avisa "Recursos de exportação indisponíveis — tente em instantes". Fallback: link de download dos JS hospedados localmente (backlog) |
| PDF de recibos em lote consome muita memória (50+ profs) | 🟡 Média | Processar em batches de 10 com progresso visual. JSZip suporta streaming. Aviso se > 100 profs |
| Encoding de caracteres acentuados no PDF | 🟡 Média | jsPDF requer registrar fonte UTF-8 (ex. Roboto). Testar com nomes como "João" e "Conceição" |
| Diferentes versões do Excel renderizam formatação diferente | 🟢 Baixa | SheetJS é bem testado. Validar em Excel 2016+ e Google Sheets |
| Currency formatting diferente no Excel (US vs BR) | 🟡 Média | Aplicar `numFmt: '"R$ "#,##0.00'` explicitamente nas células de moeda |
| Performance de R3 com range de 6+ meses | 🟡 Média | Query usa índice existente `(teacherId, scheduledDate)`. Aviso "X aulas encontradas" antes de gerar |
| Audit log gera muitos registros pequenos | 🟢 Baixa | 1 entry por exportação. Sem flood |
| Cancelamento durante geração de lote | 🟡 Média | Botão "Cancelar" durante geração. Limpa estado parcial |
| Dependência de internet pra CDN bloqueia uso offline | 🟢 Baixa | Sistema já requer internet (Firebase). Aceitável |

---

## 10. Após a sprint

Sprint 8 termina quando os 12 critérios passarem. Próximo passo:
- 🟢 **Sprint 7** — Notificações por email (Brevo) — envio dos relatórios por email
- 🟢 **Polimentos finais** — UX, bugs cosméticos, tech debt
- 🟢 **Homologação completa** — você + equipe testando tudo antes de produção
- Aguarda **homologação completa do módulo** antes do deploy em produção

---

## 📋 Snippets-chave (pra desenvolvimento autônomo)

### Snippet 1 — `ReportService.getFechamentosReport`

```js
const ReportService = {
  
  async getFechamentosReport(filters) {
    const { unitId, yearMin, monthMin, yearMax, monthMax } = filters;
    if (!unitId) return { success: false, error: 'Unidade obrigatória.' };
    
    let q = db.collection('monthly_closings').where('unitId', '==', unitId);
    const snap = await q.get();
    const closings = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => isInRange(c.year, c.month, yearMin, monthMin, yearMax, monthMax))
      .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
    
    if (closings.length === 0) {
      return { success: false, error: 'Nenhum fechamento encontrado pra esses filtros.' };
    }
    
    // Achata em linhas: 1 linha por (closing, professor)
    const rows = [];
    for (const c of closings) {
      for (const t of (c.teachers || [])) {
        rows.push({
          year: c.year, month: c.month, monthLabel: `${String(c.month).padStart(2,'0')}/${c.year}`,
          teacherName: t.teacherName, teacherType: t.teacherType,
          classesCount: t.classesCount || 0,
          totalHoras: t.totalHoras || 0,
          valorHoras: t.valorHoras || 0,
          mealAllowance: t.mealAllowance || 0,
          transportAllowance: t.transportAllowance || 0,
          otherBenefits: t.otherBenefits || 0,
          vacationValue: t.vacationValue || 0,           // Sprint 6b
          isVacationOnly: t.isVacationOnly || false,
          valorTotal: (t.valorTotal || 0) + (t.vacationValue || 0),
        });
      }
    }
    
    return {
      success: true,
      data: {
        title: closings.length === 1
          ? `Fechamento — Unidade ${unitId} — ${closings[0].month}/${closings[0].year}`
          : `Fechamentos — Unidade ${unitId} — ${rows.length} linhas (${closings.length} meses)`,
        generatedAt: new Date(),
        filters,
        columns: [
          { key: 'monthLabel',         label: 'Mês',          width: 10 },
          { key: 'teacherName',        label: 'Professor',    width: 30 },
          { key: 'teacherType',        label: 'Tipo',         width: 12 },
          { key: 'classesCount',       label: 'Aulas',        width: 8,  type: 'number' },
          { key: 'totalHoras',         label: 'Horas',        width: 8,  type: 'number' },
          { key: 'valorHoras',         label: 'Valor Horas',  width: 14, type: 'currency' },
          { key: 'mealAllowance',      label: 'VR',           width: 10, type: 'currency' },
          { key: 'transportAllowance', label: 'VT',           width: 10, type: 'currency' },
          { key: 'otherBenefits',      label: 'Outros',       width: 10, type: 'currency' },
          { key: 'vacationValue',      label: 'Férias',       width: 12, type: 'currency' },
          { key: 'valorTotal',         label: 'Total',        width: 14, type: 'currency', bold: true },
        ],
        rows,
        summary: {
          totalRows: rows.length,
          totalClassesCount: rows.reduce((s, r) => s + r.classesCount, 0),
          totalHoras: rows.reduce((s, r) => s + r.totalHoras, 0),
          totalValor: rows.reduce((s, r) => s + r.valorTotal, 0),
        },
      },
    };
  },
};

function isInRange(year, month, yearMin, monthMin, yearMax, monthMax) {
  const v = year * 12 + month;
  const vMin = yearMin * 12 + (monthMin || 1);
  const vMax = (yearMax || yearMin) * 12 + (monthMax || 12);
  return v >= vMin && v <= vMax;
}
```

### Snippet 2 — `exportToExcel` genérico

```js
async function exportToExcel(report, fileName) {
  if (!window.XLSX) { toast('Biblioteca XLSX não carregou ainda.', 'error'); return; }
  
  const ws_data = [];
  
  // Linha 1: título
  ws_data.push([report.title]);
  // Linha 2: filtros aplicados (textual)
  ws_data.push([formatFilters(report.filters)]);
  // Linha 3: data de geração
  ws_data.push([`Gerado em ${report.generatedAt.toLocaleString('pt-BR')}`]);
  // Linha 4: vazia
  ws_data.push([]);
  // Linha 5: cabeçalhos
  ws_data.push(report.columns.map(c => c.label));
  // Linhas 6+: dados
  for (const r of report.rows) {
    ws_data.push(report.columns.map(c => r[c.key]));
  }
  // Linha final: totais
  if (report.summary) {
    ws_data.push([]);
    ws_data.push(['TOTAIS', ...Object.values(report.summary)]);
  }
  
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  
  // Aplicar formatação de moeda nas colunas marcadas
  report.columns.forEach((c, idx) => {
    if (c.type === 'currency') {
      const colLetter = XLSX.utils.encode_col(idx);
      for (let r = 5; r < ws_data.length; r++) {
        const cellRef = colLetter + (r + 1);
        if (ws[cellRef]) ws[cellRef].z = '"R$ "#,##0.00';
      }
    }
  });
  
  // Larguras de coluna
  ws['!cols'] = report.columns.map(c => ({ wch: c.width || 15 }));
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  
  XLSX.writeFile(wb, fileName || `relatorio-${Date.now()}.xlsx`);
  
  await AuditService.log({
    type: 'report_exported',
    module: 'relatorios',
    details: `Excel · ${report.title} · ${report.rows.length} linhas`,
    after: { format: 'xlsx', filters: report.filters, rowCount: report.rows.length },
  });
}
```

### Snippet 3 — `exportToPdf` genérico (jsPDF + autotable)

```js
async function exportToPdf(report, fileName) {
  if (!window.jspdf) { toast('Biblioteca PDF não carregou ainda.', 'error'); return; }
  const { jsPDF } = window.jspdf;
  
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  
  // Header CrossTainer ELITE
  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text('CrossTainer ELITE', 14, 15);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text('Módulo Professores · Relatório', 14, 21);
  
  // Título do relatório
  doc.setFontSize(13); doc.setFont(undefined, 'bold');
  doc.text(report.title, 14, 32);
  
  // Filtros aplicados + data
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  doc.text(formatFilters(report.filters), 14, 38);
  doc.text(`Gerado em ${report.generatedAt.toLocaleString('pt-BR')}`, 14, 43);
  
  // Tabela
  doc.autoTable({
    startY: 50,
    head: [report.columns.map(c => c.label)],
    body: report.rows.map(r => report.columns.map(c => formatCell(r[c.key], c.type))),
    headStyles: { fillColor: [216, 124, 28], textColor: 255 },  // laranja CrossTainer
    bodyStyles: { fontSize: 8 },
    styles: { cellPadding: 1.5 },
    didDrawPage: (data) => {
      // Footer
      const pageHeight = doc.internal.pageSize.height;
      doc.setFontSize(8);
      doc.text(`Página ${data.pageNumber}`, 14, pageHeight - 5);
    },
  });
  
  // Resumo no rodapé
  if (report.summary) {
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text('Totais:', 14, finalY);
    doc.setFont(undefined, 'normal');
    Object.entries(report.summary).forEach(([k, v], i) => {
      doc.text(`${k}: ${typeof v === 'number' ? formatCell(v, 'currency') : v}`, 14, finalY + 6 + i * 5);
    });
  }
  
  doc.save(fileName || `relatorio-${Date.now()}.pdf`);
  
  await AuditService.log({
    type: 'report_exported',
    module: 'relatorios',
    details: `PDF · ${report.title} · ${report.rows.length} linhas`,
    after: { format: 'pdf', filters: report.filters, rowCount: report.rows.length },
  });
}

function formatCell(value, type) {
  if (value == null) return '—';
  if (type === 'currency') return 'R$ ' + Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'number') return Number(value).toLocaleString('pt-BR');
  return String(value);
}

function formatFilters(filters) {
  return Object.entries(filters)
    .filter(([_, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}
```

### Snippet 4 — Recibos em lote (PDF único)

```js
async function exportRecibosLote(closingId, format) {
  const closing = (await db.collection('monthly_closings').doc(closingId).get()).data();
  if (!closing) { toast('Fechamento não encontrado.', 'error'); return; }
  const profs = closing.teachers || [];
  
  if (format === 'pdf-unico') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    
    for (let i = 0; i < profs.length; i++) {
      if (i > 0) doc.addPage();
      await renderReciboInPdf(doc, profs[i], closing);
      // Progresso visual
      updateProgress((i + 1) / profs.length, `Gerando recibo ${i + 1}/${profs.length}`);
    }
    
    doc.save(`recibos-${closingId}.pdf`);
  } else if (format === 'zip') {
    const zip = new JSZip();
    for (let i = 0; i < profs.length; i++) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await renderReciboInPdf(doc, profs[i], closing);
      const blob = doc.output('blob');
      zip.file(`${sanitize(profs[i].teacherName)}-${closingId}.pdf`, blob);
      updateProgress((i + 1) / profs.length, `Empacotando recibo ${i + 1}/${profs.length}`);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `recibos-${closingId}.zip`);
  }
  
  await AuditService.log({
    type: 'report_exported',
    module: 'relatorios',
    details: `Recibos em lote · ${profs.length} recibos · formato ${format}`,
    after: { format, closingId, count: profs.length },
  });
}

function renderReciboInPdf(doc, prof, closing) {
  // Reusa lógica do receipt.html mas direto em jsPDF
  // Header, dados do prof, totais, assinatura
  doc.setFontSize(14); doc.setFont(undefined, 'bold');
  doc.text(`Recibo de Pagamento — ${prof.teacherName}`, 14, 20);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text(`Competência: ${String(closing.month).padStart(2,'0')}/${closing.year}`, 14, 28);
  doc.text(`Unidade: ${closing.unitId}`, 14, 34);
  // ... tabela com classes, horas, valor + seção Férias se aplicável + total ...
}

function sanitize(s) {
  return String(s || '').replace(/[^a-z0-9\-_]/gi, '_');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}
```

### Snippet 5 — Lazy loading das bibliotecas

```js
// Em professores.js, ao detectar navegação pra page-relatorios:
async function ensureReportLibsLoaded() {
  if (window.XLSX && window.jspdf && window.JSZip) return true;
  
  const libs = [
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.0/dist/jspdf.plugin.autotable.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  ];
  
  await Promise.all(libs.map(url => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Falha ao carregar: ' + url));
    document.head.appendChild(script);
  })));
  
  return true;
}
```

---

## 🔁 Observações finais

1. **Reuso de outras sprints:** R1 usa `monthly_closings` (Sprint 4a + 6b). R2 usa `VacationBalanceService` (Sprint 6c). R3 usa `classes` (Sprint 3a) + cálculo do fechamento. R4 reusa lógica do `receipt.html` (Sprint 4b).
2. **Sem nova coleção, sem novos índices, sem CF.** Sprint 100% client-side.
3. **CDN é dependência externa:** documentar como tech debt em CLAUDE.md (eventualmente hospedar localmente como fallback).
4. **Encoding UTF-8 no PDF:** jsPDF padrão tem fontes Helvetica/Times mas não cobre Latin Extended. Pra acentos perfeitos, registrar fonte Roboto via `doc.addFileToVFS` e `doc.addFont` (snippet adicional se necessário).
5. **Acessibilidade:** descrição alternativa nos botões (`aria-label="Exportar relatório em Excel"`).
6. **Quando travar:** chamar com erro/diff, revisão pontual.
