# Lista de renovações (parte A) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tela onde as consultoras trabalham as renovações e as degustações do mês, montada sozinha todo dia às 5h a partir da Previsão de Renovação da Pacto.

**Architecture:** um módulo puro (`renovacoes-lista.js`, gêmeo em `functions/`) faz toda a classificação e a conta; uma Cloud Function busca a Previsão com as credenciais por unidade, completa os contratos pelo núcleo da Pacto e grava `renovacoes_lista/{CP|PP}_{AAAA-MM}`; a página `renovacoes.html` só lê a lista e grava o que a consultora preenche em `renovacoes_acompanhamento/{CP|PP}_{contrato}` — coleção separada, por contrato, para a virada de mês levar tudo e a Function nunca apagar nada.

**Tech Stack:** JavaScript puro (Node 22 nos testes e nas Functions, navegador na tela), Firebase compat 10.12 (Auth, Firestore, Functions), Cloud Functions v2 (`onSchedule`, `onCall`, `defineSecret`).

**Especificação:** `docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md` (seções 1, 2 e 3).

---

## Antes de começar — regras do projeto que valem para todas as tarefas

- **Nunca tocar** em `index.html`, `commission.js`, `manifest.json`, `sw.js`. A tarefa 14 pede autorização para o atalho no menu.
- **Staging sempre.** `.firebaserc` já aponta o padrão para staging; produção só com `--project production` e OK explícito do Rafael, depois da homologação.
- **Nenhum CPF, nome ou chave** vai para log, commit ou conversa. As credenciais moram em `pacto-credencial*.txt` (fora do git). Nunca imprimir o conteúdo delas.
- **Só leitura na Pacto.** As únicas rotas chamadas são `v2-indice-renovacao` (gateway) e `consultarContratos` (núcleo, já existente).
- **Testes chamam as funções** — nunca só leem o texto do arquivo ([[previa-nunca-rodou]]).
- Os arquivos do repositório usam CRLF no Windows: recorte de texto em teste nunca por `'\n    }\n'`.
- `const` no topo de um `<script>` **não** vira `window.X`: todo módulo termina com `if (typeof window !== 'undefined') window.X = X;`.
- Comentários e mensagens em português. Marca visível: **CrossTainer**.

## Mapa de arquivos

| Arquivo | Novo? | Responsabilidade |
|---|---|---|
| `scripts/sondar-previsao-renovacao.js` | novo | tarefa 1: responde as perguntas abertas da API, sem imprimir dado pessoal |
| `renovacoes-lista.js` | novo | a conta inteira: classificação, blocos, numeração, duplicados, conferência, alertas, validações, painel |
| `functions/renovacoes-lista.js` | novo | cópia idêntica (o deploy de Functions só leva `functions/`) |
| `scripts/smoke-renovacoes-lista.js` | novo | testes do módulo + igualdade das cópias |
| `functions/pacto-renovacao-cliente.js` | novo | cliente HTTP da Previsão de Renovação (gateway, credencial por unidade) |
| `scripts/smoke-pacto-renovacao-cliente.js` | novo | testes do cliente com `fetch` falso |
| `functions/renovacoes-montar.js` | novo | orquestra: Previsão → caderninho de contratos → histórico → módulo → grava |
| `scripts/smoke-renovacoes-montar.js` | novo | testes da orquestração com banco falso |
| `functions/index.js` | altera (final do arquivo) | `montarListaRenovacoes` (5h) e `montarListaRenovacoesManual` (botão, só admin) |
| `firestore.rules` | altera (depois do bloco do termômetro) | regras das duas coleções novas |
| `scripts/validar-regras-renovacoes.js` | novo | prova as regras por REST no staging |
| `renovacoes.js` | novo | a tela: funções que desenham (`window.RenovacoesTela`) + a página |
| `renovacoes.html` | novo | a página |
| `scripts/smoke-renovacoes-tela.js` | novo | roda a tela num sandbox e chama as funções que desenham |
| `scripts/homologar-renovacoes.js` | novo | roda a montagem de verdade contra o staging e resume sem nomes |
| `manual-admin.html` | altera | seção nova sobre a lista |
| `CONTEXTO_SESSAO.md` | altera | registro da sessão |

---

### Task 1: Sondar a API (A1) — responder as perguntas abertas antes de escrever o resto

**Files:**
- Create: `scripts/sondar-previsao-renovacao.js`
- Modify: `docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md` (seção nova "Achados da A1" no fim da seção 2)

- [ ] **Step 1: Escrever o script de sondagem**

```js
'use strict';
// Roda: node scripts/sondar-previsao-renovacao.js 2026-10
//
// Tarefa A1 do plano docs/superpowers/plans/2026-09-29-lista-de-renovacoes.md.
// Só LEITURA na Pacto. Responde, por unidade:
//   • quais listas a Previsão de Renovação devolve e quantos contratos em cada;
//   • se as listas de "renovados" estão contidas na lista da previsão;
//   • quantas matrículas têm cara de CPF;
//   • numa amostra de 40 contratos: tipo de plano (degustação vem na previsão?)
//     e o FORMATO da data de vencimento no núcleo.
// ⚠️ Nunca imprime nome, matrícula, CPF nem credencial — só contagens e formatos.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const mes = process.argv[2] || '2026-10';
const GW = 'https://apigw.pactosolucoes.com.br';
const NUCLEO = 'https://app.pactosolucoes.com.br/api/prest';
const CHAVES = { CP: 'c7b092b1fe873e29436873a01cdfe829', PP: '9d4721a873dd9fe621aeed5093b791f8' };
const dormir = ms => new Promise(r => setTimeout(r, ms));

function cpfValido(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

(async () => {
  const credNucleo = fs.readFileSync(path.join(RAIZ, 'pacto-credencial.txt'), 'utf8').trim();
  const [a, m] = mes.split('-').map(Number);
  const dataInicial = Date.UTC(a, m - 1, 1, 3, 0, 0);          // 00:00 em São Paulo
  const dataFinal = Date.UTC(a, m, 1, 2, 59, 59);              // 23:59:59 do último dia, em São Paulo
  for (const U of ['CP', 'PP']) {
    const token = fs.readFileSync(path.join(RAIZ, `pacto-credencial-${U.toLowerCase()}.txt`), 'utf8').trim();
    const res = await fetch(GW + '/v2-indice-renovacao', {
      method: 'POST',
      headers: { Authorization: token, empresaId: '1', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ empresa: 1, dataInicial, dataFinal, retornarContratos: true,
        desconsiderarContratosRenovaveis: false, considerarMudancaDePlano: false }),
    });
    const texto = await res.text();
    console.log(`\n=== ${U} ${mes} · HTTP ${res.status}`);
    const j = JSON.parse(texto);
    const c = j.content || j;
    const dados = typeof c.jsonDados === 'string' ? JSON.parse(c.jsonDados) : c.jsonDados;
    const listas = Object.entries(dados).filter(([, v]) => Array.isArray(v));
    listas.forEach(([k, v]) => console.log(`lista ${k}: ${v.length}`));
    const prev = dados.contratosPrevisaoMes || [];
    const codPrev = new Set(prev.map(x => String(x.codigoContrato)));
    listas.filter(([k]) => /Renovad/.test(k)).forEach(([k, v]) =>
      console.log(`  ${k}: ${v.filter(x => codPrev.has(String(x.codigoContrato))).length} de ${v.length} estão na previsão`));
    console.log('campos de um contrato:', prev[0] ? Object.keys(prev[0]).join(', ') : '(lista vazia)');
    console.log('matrícula com cara de CPF:', prev.filter(x => cpfValido(x.matriculaCliente)).length, 'de', prev.length);

    const tipos = {};
    const formatos = new Set();
    for (const x of prev.slice(0, 40)) {
      await dormir(2000);                                     // nunca em rajada
      const r = await fetch(`${NUCLEO}/cliente/${CHAVES[U]}/consultarContratos?cliente=${encodeURIComponent(x.codigoCliente)}&registros=50`, {
        method: 'POST', headers: { Authorization: credNucleo, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}',
      });
      let lista = [];
      try { lista = JSON.parse(await r.text()).return || []; } catch (e) { tipos['(resposta inválida)'] = (tipos['(resposta inválida)'] || 0) + 1; continue; }
      const ct = lista.find(y => String(y.codigo) === String(x.codigoContrato));
      if (!ct) { tipos['(contrato não achado no cliente)'] = (tipos['(contrato não achado no cliente)'] || 0) + 1; continue; }
      formatos.add(String(ct.vigenciaAteAjustada || ct.vigenciaAte || '(vazio)').replace(/\d/g, '9'));
      const p = String(ct.nomePlano || '');
      const tipo = /DEGUST/i.test(p) ? 'degustação' : /RECORRENTE/i.test(p) ? 'recorrente' : /IMPORTA/i.test(p) ? 'importação' : 'outros';
      tipos[tipo] = (tipos[tipo] || 0) + 1;
    }
    console.log('amostra de 40 por tipo de plano:', JSON.stringify(tipos));
    console.log('formato do vencimento no núcleo:', [...formatos].join(' | '));
  }
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar para outubro e para um mês passado**

Run: `node scripts/sondar-previsao-renovacao.js 2026-10` e depois `node scripts/sondar-previsao-renovacao.js 2026-05`
Expected: HTTP 200 nas duas unidades; `lista contratosPrevisaoMes: 72` (CP) e `42` (PP) em outubro, como medido em 29/09. Leva ~3 minutos por mês (pausa de 2 s por consulta).

- [ ] **Step 3: Registrar os achados na especificação**

Acrescentar no fim da seção 2 da especificação um bloco `### 2.4 Achados da A1 (data)` com, para CP e PP: os nomes exatos das listas; se as de renovados estão contidas na previsão; quantas matrículas parecem CPF; a distribuição da amostra (se aparece `degustação`); o formato do vencimento (ex.: `99/99/9999`).

**Decisões que dependem do resultado (aplicar nas tarefas seguintes):**
- Se as listas de renovados **não** se chamarem `contratosRenovadosPrevisaoMes`, trocar a constante `LISTAS_RENOVADOS` na tarefa 8 pelos nomes impressos.
- Se o formato do vencimento **não** for `99/99/9999` nem `9999-99-99`, acrescentar o formato a `iso()` na tarefa 3, com um caso de teste.
- Se a matrícula parecer CPF: nada a mudar — `montar()` (tarefa 5) já troca por `null`.
- Degustação ausente da previsão: nada a mudar — `montar()` sempre acrescenta as degustações do histórico que faltarem.

- [ ] **Step 4: Commit**

```bash
git add scripts/sondar-previsao-renovacao.js docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md
git commit -m "chore(renovacoes): sondagem da Previsão de Renovação da Pacto (A1)"
```

---

### Task 2: Módulo puro — normalização e classificação do plano

**Files:**
- Create: `renovacoes-lista.js`
- Create: `scripts/smoke-renovacoes-lista.js`

- [ ] **Step 1: Escrever o teste que falha**

`scripts/smoke-renovacoes-lista.js`:

```js
'use strict';
// Roda: node scripts/smoke-renovacoes-lista.js
//
// Lista de renovações (desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md, parte A).
// Chama as funções do módulo puro com dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const RL = require(path.join(raiz, 'renovacoes-lista.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

/* 1. exclusões: cada palavra do documento do Rodrigo, por palavra inteira */
{
  const casos = [
    ['ACESSO LIVRE | RECORRENTE | FLEX | 3X | PADRÃO', 'recorrente'],
    ['PLANO MENSAL RECORRENTE PERSONAL', 'recorrente'],
    ['PERSONAL EXTERNO RECORRENTE', 'personal_externo'],
    ['CRÉDITO DE 1 AULA', 'credito'],
    ['CRÉDITO DE 2 OU MAIS AULAS', 'credito'],
    ['PACOTE 10 AULAS', 'avulso'],
    ['AULA AVULSA', 'avulso'],
    ['DIÁRIA', 'avulso'],
    ['PERMUTA 3 MESES', 'permuta'],
    ['CORTESIA', 'permuta'],
    ['PLANO COLABORADOR', 'permuta'],
    ['FUNCIONÁRIO', 'permuta'],
    ['TESTE PACTO NÃO USAR', 'teste'],
    ['WELLHUB', 'agregador'],
    ['GYMPASS SILVER', 'agregador'],
    ['TOTALPASS', 'agregador'],
  ];
  casos.forEach(([nome, motivo]) => assert.deepStrictEqual(RL.classificarPlano(nome), { tipo: 'excluir', motivo }, nome));
  ok('exclusões: recorrente, personal externo, crédito, avulso/pacote/diária, permuta/cortesia/colaborador, teste, agregador');
}

/* 2. o que NÃO é excluído */
{
  assert.deepStrictEqual(RL.classificarPlano('ACESSO LIVRE | MENSAL | FLEX | 3X | PADRÃO'), { tipo: 'renovacao', economico: false }, 'MENSAL sem RECORRENTE fica');
  assert.deepStrictEqual(RL.classificarPlano('ANUAL 15 MESES, BLACK FRIDAY HIIT MAROMBINHA [NOV-24]'), { tipo: 'renovacao', economico: false });
  assert.deepStrictEqual(RL.classificarPlano('ANUAL, ESTEFANE TESTEMUNHA'), { tipo: 'renovacao', economico: false }, 'TESTE dentro de outra palavra não exclui');
  assert.deepStrictEqual(RL.classificarPlano('PLANO ECONÔMICO MENSAL'), { tipo: 'renovacao', economico: true });
  ok('MENSAL sem RECORRENTE, promocionais e palavra dentro de outra ficam; Econômico ganha a etiqueta');
}

/* 3. degustação, importação e plano vazio */
{
  assert.deepStrictEqual(RL.classificarPlano('MÊS DEGUSTAÇÃO LIVRE'), { tipo: 'degustacao' });
  assert.deepStrictEqual(RL.classificarPlano('IMPORTAÇÃO'), { tipo: 'importacao' });
  assert.deepStrictEqual(RL.classificarPlano('  '), { tipo: 'verificar', motivo: 'Contrato sem nome de plano na Pacto' });
  assert.deepStrictEqual(RL.classificarPlano(null), { tipo: 'verificar', motivo: 'Contrato sem nome de plano na Pacto' });
  ok('degustação, importação e plano sem nome');
}

console.log('\n✅ smoke-renovacoes-lista: ' + n);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: FAIL com `Cannot find module '...renovacoes-lista.js'`

- [ ] **Step 3: Implementar**

`renovacoes-lista.js`:

```js
// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Lista de renovações: a conta
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md (parte A)
//
// Puro: sem Firebase, sem tela. Recebe a Previsão de Renovação da Pacto, os
// contratos do caderninho e o histórico de vendas, e devolve os blocos da
// lista, as exclusões por motivo e a conferência com o total da Pacto. As
// partes B (meta) e C (bônus) leem "renovação base" e "base antecipável" DAQUI.
//
// ⚠️ Gêmeo em functions/renovacoes-lista.js — o deploy de Functions só leva
// functions/. O smoke falha se as duas cópias divergirem.

const RenovacoesLista = {

  // Ordem importa: o primeiro que casar dá o motivo (personal externo antes de recorrente).
  EXCLUSOES: [
    { motivo: 'personal_externo', rotulo: 'Personal externo', termos: ['PERSONAL EXTERNO'] },
    { motivo: 'recorrente', rotulo: 'Recorrente (renova sozinho)', termos: ['RECORRENTE'] },
    { motivo: 'credito', rotulo: 'Crédito de aulas', termos: ['CREDITO'] },
    { motivo: 'avulso', rotulo: 'Avulso, pacote ou diária', termos: ['AVULSO', 'AVULSA', 'PACOTE', 'DIARIA'] },
    { motivo: 'permuta', rotulo: 'Permuta, cortesia ou colaborador', termos: ['PERMUTA', 'CORTESIA', 'COLABORADOR', 'FUNCIONARIO'] },
    { motivo: 'teste', rotulo: 'Plano de teste', termos: ['TESTE'] },
    { motivo: 'agregador', rotulo: 'Agregador (Wellhub, Gympass, TotalPass)', termos: ['WELLHUB', 'GYMPASS', 'TOTALPASS'] },
  ],

  // Rótulos das exclusões que não vêm do nome do plano
  ROTULOS_EXTRAS: { duplicado: 'Aluno repetido na Previsão', gestao: 'Excluído pela gestão' },

  MOTIVOS_NAO_RENOVOU: [
    'Preço / questão financeira',
    'Mudou de cidade ou país',
    'Fim da estadia (morador temporário / turista)',
    'Lesão ou saúde',
    'Horário ou rotina incompatível',
    'Foi para outra academia / concorrente',
    'Insatisfação com o serviço',
    'Pausa – pretende voltar',
    'Sem resposta após 3 tentativas de contato',
    'Outro',
  ],

  STATUS: { pendente: 'Pendente', negociacao: 'Em negociação', sim: 'Sim', nao: 'Não' },

  // Mesma lista do `naoComissionaveis` do motor: não são consultoras da lista
  NAO_CONSULTORAS: ['RODRIGO', 'RAFAEL ROJAIS', 'BENNY ELAND', 'SISTEMA'],

  /** Maiúsculas, sem acento, espaços simples. */
  norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  },

  /**
   * Termo como PALAVRA inteira (aceita plural com S). `TESTE` não casa com
   * `TESTEMUNHA` — foi o que quase apagou uma ESTEFANE de verdade em set/2026.
   */
  temTermo(nomeNorm, termo) {
    const t = termo.split(' ').join('\\s+');
    return new RegExp('(^|[^A-Z0-9])' + t + 'S?([^A-Z0-9]|$)').test(nomeNorm);
  },

  rotuloExclusao(motivo) {
    const e = this.EXCLUSOES.find(x => x.motivo === motivo);
    return e ? e.rotulo : (this.ROTULOS_EXTRAS[motivo] || motivo);
  },

  /**
   * Nome do plano → { tipo: 'excluir', motivo } | { tipo: 'degustacao' } |
   * { tipo: 'importacao' } | { tipo: 'renovacao', economico } | { tipo: 'verificar', motivo }
   */
  classificarPlano(nome) {
    const n = this.norm(nome);
    if (!n) return { tipo: 'verificar', motivo: 'Contrato sem nome de plano na Pacto' };
    if (this.temTermo(n, 'IMPORTACAO')) return { tipo: 'importacao' };
    for (const e of this.EXCLUSOES) {
      if (e.termos.some(t => this.temTermo(n, t))) return { tipo: 'excluir', motivo: e.motivo };
    }
    if (this.temTermo(n, 'DEGUSTACAO')) return { tipo: 'degustacao' };
    return { tipo: 'renovacao', economico: this.temTermo(n, 'ECONOMICO') };
  },
};

if (typeof module !== 'undefined') module.exports = RenovacoesLista;
if (typeof window !== 'undefined') window.RenovacoesLista = RenovacoesLista;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: `✓  1.` a `✓  3.` e `✅ smoke-renovacoes-lista: 3`

- [ ] **Step 5: Commit**

```bash
git add renovacoes-lista.js scripts/smoke-renovacoes-lista.js
git commit -m "feat(renovacoes): classificação do plano pelas regras do Rodrigo"
```

---

### Task 3: Módulo — datas, períodos, CPF e histórico

**Files:**
- Modify: `renovacoes-lista.js` (acrescentar métodos dentro do objeto, antes do `};` final)
- Modify: `scripts/smoke-renovacoes-lista.js` (acrescentar blocos antes da linha `console.log('\n✅ ...`)

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `scripts/smoke-renovacoes-lista.js`, antes do `console.log` final:

```js
/* 4. datas e períodos */
{
  assert.strictEqual(RL.iso('20/10/2026'), '2026-10-20');
  assert.strictEqual(RL.iso('2026-10-20T00:00:00'), '2026-10-20');
  assert.strictEqual(RL.iso(Date.UTC(2026, 9, 20, 3)), '2026-10-20', 'milissegundos: dia em São Paulo');
  assert.strictEqual(RL.iso(''), '');
  assert.strictEqual(RL.iso(null), '');
  assert.deepStrictEqual(RL.periodos('2026-10'), {
    mes: { de: '2026-10-01', ate: '2026-10-31' }, antecipacao: { de: '2026-11-01', ate: '2026-11-15' } });
  assert.deepStrictEqual(RL.periodos('2026-12'), {
    mes: { de: '2026-12-01', ate: '2026-12-31' }, antecipacao: { de: '2027-01-01', ate: '2027-01-15' } }, 'virada de ano');
  assert.strictEqual(RL.periodos('2027-02').mes.ate, '2027-02-28');
  assert.deepStrictEqual(RL.mesesParaManter('2026-10-24'), ['2026-10']);
  assert.deepStrictEqual(RL.mesesParaManter('2026-10-25'), ['2026-10', '2026-11'], 'do dia 25 em diante, o mês seguinte também');
  assert.strictEqual(RL.diasEntre('2026-10-05', '2026-10-09'), 4);
  assert.strictEqual(RL.diasEntre('2026-10-05', '2026-09-20'), -15);
  ok('datas: formatos da Pacto, períodos (mês + 1 a 15 do seguinte), meses mantidos, diferença em dias');
}

/* 5. CPF nunca vira matrícula */
{
  assert.strictEqual(RL.pareceCpf('52998224725'), true);
  assert.strictEqual(RL.pareceCpf('529.982.247-25'), true);
  assert.strictEqual(RL.pareceCpf('52998224724'), false, 'dígito errado');
  assert.strictEqual(RL.pareceCpf('11111111111'), false);
  assert.strictEqual(RL.pareceCpf('5001'), false);
  assert.strictEqual(RL.pareceCpf(null), false);
  ok('CPF reconhecido pelos dígitos verificadores');
}

/* 6. histórico: plano original da IMPORTAÇÃO, consultora e planos recentes */
const HIST = [
  { cliente: 'Edu Importado', item: 'IMPORTAÇÃO [PLANO PRESUMIDO]', data: '05/08/2026', vendedor: 'RODRIGO', codigo: 'C900', isContract: true },
  { cliente: 'EDU IMPORTADO', item: 'SEMESTRAL, TREINO LIVRE (01/04/2025 - 30/09/2025)', data: '10/04/2025', vendedor: 'BARBARA', codigo: 'C500', isContract: true },
  { cliente: 'EDU IMPORTADO', item: 'ÁGUA SEM GÁS', data: '11/04/2025', vendedor: 'ERICA', codigo: 'A77', isContract: false },
  { cliente: 'LIA', item: 'ANUAL, ACESSO ILIMITADO (01/09/2026 - 31/08/2027)', data: '01/09/2026', vendedor: 'KALI', codigo: 'C700', isContract: true },
  { cliente: 'KIKA HIST', item: 'MÊS DEGUSTAÇÃO LIVRE (13/10/2026 - 12/11/2026)', data: '13/10/2026', vendedor: 'ERICA', codigo: 'C301',
    isContract: true, isDegustacao: true, planStartDate: '13/10/2026', planEndDate: '12/11/2026' },
];
{
  assert.strictEqual(RL.planoOriginal('edu importado', HIST), 'SEMESTRAL, TREINO LIVRE', 'ignora a IMPORTAÇÃO e tira as datas');
  assert.strictEqual(RL.planoOriginal('NINGUEM', HIST), null);
  assert.strictEqual(RL.consultoraDoHistorico('EDU IMPORTADO', HIST), 'BARBARA', 'RODRIGO não é consultora da lista');
  assert.strictEqual(RL.consultoraDoHistorico('NINGUEM', HIST), null);
  assert.deepStrictEqual(RL.planosRecentes(HIST, '2026-10-05'), ['ANUAL, ACESSO ILIMITADO'], 'últimos 90 dias, sem degustação nem importação');
  const d = RL.degustacoesDoHistorico(HIST, RL.periodos('2026-10'));
  assert.deepStrictEqual(d, [{ codigoContrato: '301', codigoCliente: null, matriculaCliente: null, nomeCliente: 'KIKA HIST',
    plano: 'MÊS DEGUSTAÇÃO LIVRE', inicio: '2026-10-13', vencimento: '2026-11-12', consultora: 'ERICA' }]);
  assert.deepStrictEqual(RL.degustacoesDoHistorico(HIST, RL.periodos('2026-08')), [], 'fim fora do período');
  ok('histórico: plano original da importação, consultora (sem sócio), planos dos últimos 90 dias, degustações');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: FAIL no bloco 4 com `RL.iso is not a function`

- [ ] **Step 3: Implementar**

Acrescentar dentro do objeto `RenovacoesLista`, depois de `classificarPlano`:

```js
  // ─── Datas ('AAAA-MM-DD' em todo o módulo) ───

  /** 'dd/MM/yyyy' · 'AAAA-MM-DD…' · milissegundos → 'AAAA-MM-DD' (dia em São Paulo) */
  iso(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return new Date(v - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return '';
  },

  somarDias(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },

  /** b − a, em dias */
  diasEntre(a, b) {
    return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  },

  proximoMes(mes) {
    const [a, m] = mes.split('-').map(Number);
    return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7);
  },

  /** O mês inteiro e a antecipação (1 a 15 do mês seguinte). */
  periodos(mes) {
    const prox = this.proximoMes(mes);
    return {
      mes: { de: mes + '-01', ate: this.somarDias(prox + '-01', -1) },
      antecipacao: { de: prox + '-01', ate: prox + '-15' },
    };
  },

  /** O mês corrente; do dia 25 em diante, também o seguinte ("gerada no fim do mês M"). */
  mesesParaManter(hoje) {
    const mes = hoje.slice(0, 7);
    return Number(hoje.slice(8, 10)) >= 25 ? [mes, this.proximoMes(mes)] : [mes];
  },

  /** 11 dígitos com dígitos verificadores de CPF. CPF nunca é gravado nem mostrado. */
  pareceCpf(v) {
    const d = String(v == null ? '' : v).replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const dv = n => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  },

  // ─── Histórico (itens processados de `periodos`, TecnoFit e Pacto) ───

  _semPlanoReal(item) {
    const n = this.norm(item);
    return this.temTermo(n, 'IMPORTACAO') || n.includes('[PLANO PRESUMIDO]');
  },

  /** Tira o "(01/04/2025 - 30/09/2025)" que o motor põe no nome do item. */
  limparNomePlano(item) {
    return String(item || '').replace(/\s*\(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  },

  /** Itens do mesmo cliente (por nome), do mais recente para o mais antigo. */
  _doCliente(nome, historico) {
    const alvo = this.norm(nome);
    return (historico || []).filter(h => this.norm(h.cliente) === alvo)
      .sort((a, b) => (this.iso(b.data) > this.iso(a.data) ? 1 : this.iso(b.data) < this.iso(a.data) ? -1 : 0));
  },

  ehNaoConsultora(nome, lista) {
    const n = this.norm(nome);
    if (!n || n === 'SEM VENDEDOR') return true;
    return (lista || this.NAO_CONSULTORAS).some(x => n.includes(this.norm(x)));
  },

  /** Plano do TecnoFit de um contrato que veio da migração como "IMPORTAÇÃO". */
  planoOriginal(nome, historico) {
    const h = this._doCliente(nome, historico).find(x => x.isContract && !x.isDegustacao && !this._semPlanoReal(x.item));
    return h ? this.limparNomePlano(h.item) : null;
  },

  consultoraDoHistorico(nome, historico, naoConsultoras) {
    const h = this._doCliente(nome, historico).find(x => x.isContract && !this.ehNaoConsultora(x.vendedor, naoConsultoras));
    return h ? String(h.vendedor).trim() : null;
  },

  /** Opções de "plano alvo" / "plano fechado": planos vendidos na unidade nos últimos N dias. */
  planosRecentes(historico, hoje, dias = 90) {
    const desde = this.somarDias(hoje, -dias);
    const set = new Set();
    (historico || []).forEach(h => {
      if (!h.isContract || h.isDegustacao || this._semPlanoReal(h.item)) return;
      if (this.iso(h.data) < desde) return;
      set.add(this.limparNomePlano(h.item));
    });
    return [...set].sort();
  },

  /**
   * Degustações vendidas cujo fim cai no mês ou em 1–15 do seguinte, no mesmo
   * formato dos contratos da Previsão (+ plano, datas e consultora). Servem para
   * completar o Bloco 3 quando a Previsão da Pacto não traz a degustação.
   */
  degustacoesDoHistorico(historico, periodos) {
    const out = [];
    (historico || []).forEach(h => {
      if (!h.isDegustacao) return;
      const fim = this.iso(h.planEndDate);
      if (!fim || fim < periodos.mes.de || fim > periodos.antecipacao.ate) return;
      const m = String(h.codigo || '').match(/^C(\d+)/);
      if (!m) return;
      out.push({
        codigoContrato: m[1], codigoCliente: null, matriculaCliente: null, nomeCliente: String(h.cliente || '').trim(),
        plano: this.limparNomePlano(h.item), inicio: this.iso(h.planStartDate), vencimento: fim,
        consultora: this.ehNaoConsultora(h.vendedor) ? null : String(h.vendedor).trim(),
      });
    });
    return out;
  },
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: `✅ smoke-renovacoes-lista: 6`

- [ ] **Step 5: Commit**

```bash
git add renovacoes-lista.js scripts/smoke-renovacoes-lista.js
git commit -m "feat(renovacoes): datas, períodos, CPF e leitura do histórico"
```

---

### Task 4: Módulo — `montar()`: blocos, numeração, duplicados, conferência

**Files:**
- Modify: `renovacoes-lista.js`
- Modify: `scripts/smoke-renovacoes-lista.js`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar antes do `console.log` final (usa o `HIST` do bloco 6):

```js
/* 7–11. montar(): o mês de outubro inventado */
const K = (codigoContrato, codigoCliente, nomeCliente, matriculaCliente) => ({ codigoContrato, codigoCliente, nomeCliente, matriculaCliente: matriculaCliente || String(5000 + Number(codigoCliente)) });
const C = (nomePlano, vigenciaDe, vigenciaAte, consultor) => ({ nomePlano, vigenciaDe, vigenciaAte, consultor: consultor || null });
const PREVISAO = {
  mes: {
    contratos: [
      K('101', '11', 'ANA ANUAL'),
      K('102', '12', 'BETO RECORRENTE'),
      K('103', '13', 'CAIO CREDITO'),
      K('104', '14', 'DORA DEGUSTA'),
      K('105', '15', 'EDU IMPORTADO'),
      K('106', '16', 'FABI SEMDADOS'),
      K('107', '17', 'GUGA CPF', '52998224725'),
      K('108', '11', 'ANA ANUAL'),
      K('109', '18', 'HELO ECONOMICO'),
    ],
    renovados: ['101'],
  },
  antecipacao: {
    contratos: [K('201', '21', 'IVO ANTECIPA'), K('202', '22', 'JU FORA'), K('101', '11', 'ANA ANUAL')],
    renovados: [],
  },
};
const CONTRATOS = {
  101: C('ANUAL, ACESSO ILIMITADO', '01/10/2025', '20/10/2026', 'KALI'),
  102: C('ACESSO LIVRE | RECORRENTE | FLEX | 3X | PADRÃO', '15/09/2026', '15/10/2026'),
  103: C('CRÉDITO DE 2 OU MAIS AULAS', '01/09/2026', '08/10/2026'),
  104: C('MÊS DEGUSTAÇÃO LIVRE', '10/09/2026', '10/10/2026'),
  105: C('IMPORTAÇÃO', '01/10/2025', '05/10/2026'),
  107: C('HIIT/MAROMBINHA | MENSAL | CP | 3X | PADRÃO', '01/10/2026', '31/10/2026'),
  108: C('ANUAL, ACESSO ILIMITADO', '28/10/2025', '28/10/2026'),
  109: C('PLANO ECONÔMICO MENSAL', '12/09/2026', '12/10/2026'),
  201: C('SEMESTRAL, TREINO LIVRE', '10/05/2026', '10/11/2026'),
  202: C('ANUAL', '20/11/2025', '20/11/2026'),
};
const LISTA = RL.montar({ mes: '2026-10', hoje: '2026-10-05', previsao: PREVISAO, contratos: CONTRATOS, historico: HIST,
  gestao: { 106: { consultoraAtribuida: 'FRANCINI' } }, desdeAnterior: { 202: '2026-09-30' } });
const cods = b => LISTA.blocos[b].map(l => l.codigoContrato);
{
  assert.deepStrictEqual(cods('renovacoes'), ['105', '109', '101', '107'], 'ordem de vencimento');
  assert.deepStrictEqual(LISTA.blocos.renovacoes.map(l => l.n), [1, 2, 3, 4]);
  assert.deepStrictEqual(cods('antecipacao'), ['201']);
  assert.deepStrictEqual(LISTA.blocos.antecipacao.map(l => l.n), [5], 'a antecipação continua a numeração');
  assert.deepStrictEqual(cods('degustacoes'), ['104', '301'], 'a degustação do histórico entra depois, por vencimento');
  assert.deepStrictEqual(LISTA.blocos.degustacoes.map(l => l.n), [1, 2], 'degustação tem numeração própria');
  assert.deepStrictEqual(cods('verificar'), ['106', '202']);
  assert.deepStrictEqual(LISTA.blocos.verificar.map(l => l.n), [null, null]);
  ok('blocos e numeração: renovações 1–4, antecipação 5, degustações 1–2, verificar sem número');
}
{
  assert.deepStrictEqual(LISTA.excluidos, { duplicado: 2, recorrente: 1, credito: 1 });
  assert.deepStrictEqual(LISTA.conferencia, { totalPacto: 12, naLista: 8, excluidos: 4, bate: true, diferenca: 0 });
  const ana = LISTA.blocos.renovacoes.find(l => l.codigoContrato === '101');
  assert.strictEqual(ana.vencimento, '2026-10-20', 'fica o vencimento mais próximo');
  assert.ok(ana.notas.some(t => /repetid/i.test(t)), 'com nota');
  ok('exclusões por motivo, duplicados (mesmo contrato nas duas consultas e mesmo aluno) e conferência que bate');
}
{
  const edu = LISTA.blocos.renovacoes.find(l => l.codigoContrato === '105');
  assert.strictEqual(edu.plano, 'IMPORTAÇÃO');
  assert.strictEqual(edu.planoOriginal, 'SEMESTRAL, TREINO LIVRE');
  assert.strictEqual(edu.consultora, 'BARBARA'); assert.strictEqual(edu.consultoraOrigem, 'historico');
  const ana = LISTA.blocos.renovacoes.find(l => l.codigoContrato === '101');
  assert.strictEqual(ana.consultora, 'KALI'); assert.strictEqual(ana.consultoraOrigem, 'pacto');
  assert.strictEqual(ana.renovouSistema, true);
  assert.ok(ana.notas.some(t => /Pacto já registra a renovação/.test(t)));
  const fabi = LISTA.blocos.verificar.find(l => l.codigoContrato === '106');
  assert.strictEqual(fabi.consultora, 'FRANCINI'); assert.strictEqual(fabi.consultoraOrigem, 'gestao');
  assert.strictEqual(fabi.motivoVerificar, 'A Pacto não devolveu os dados deste contrato');
  const ju = LISTA.blocos.verificar.find(l => l.codigoContrato === '202');
  assert.strictEqual(ju.motivoVerificar, 'Vencimento fora do período (20/11/2026)');
  assert.strictEqual(ju.desde, '2026-09-30', 'guarda desde quando está no verificar');
  assert.strictEqual(fabi.desde, '2026-10-05');
  ok('importação pelo plano original, consultora (gestão › Pacto › histórico), renovado pela Pacto, motivo do verificar');
}
{
  const guga = LISTA.blocos.renovacoes.find(l => l.codigoContrato === '107');
  assert.strictEqual(guga.matricula, null, 'CPF não vira matrícula');
  assert.strictEqual(guga.codigoCliente, '17');
  assert.ok(!JSON.stringify(LISTA).includes('52998224725'), 'o CPF não está em lugar nenhum da lista');
  assert.strictEqual(LISTA.blocos.renovacoes.find(l => l.codigoContrato === '109').economico, true);
  assert.strictEqual(LISTA.blocos.degustacoes.find(l => l.codigoContrato === '301').origem, 'historico');
  assert.deepStrictEqual(LISTA.planosRecentes, ['ANUAL, ACESSO ILIMITADO']);
  assert.deepStrictEqual(LISTA.consultoras, ['BARBARA', 'ERICA', 'FRANCINI', 'KALI']);
  assert.ok(!JSON.stringify(LISTA).includes('undefined') && !/"_cls"/.test(JSON.stringify(LISTA)), 'nada de undefined nem campo interno');
  ok('CPF fora, Econômico marcado, degustação do histórico marcada, planos e consultoras para as listas suspensas');
}
{
  const L2 = RL.montar({ mes: '2026-10', hoje: '2026-10-05', previsao: PREVISAO, contratos: CONTRATOS, historico: HIST,
    gestao: { 106: { blocoGestao: 'excluir' }, 202: { blocoGestao: 'renovacao' } } });
  assert.deepStrictEqual(L2.blocos.verificar.map(l => l.codigoContrato), ['202'], 'fora do período continua no verificar mesmo classificado');
  assert.strictEqual(L2.excluidos.gestao, 1);
  assert.strictEqual(L2.conferencia.bate, true);
  const vazia = RL.montar({ mes: '2026-10', hoje: '2026-10-05', previsao: { mes: { contratos: [], renovados: [] }, antecipacao: { contratos: [], renovados: [] } }, contratos: {}, historico: [] });
  assert.deepStrictEqual(vazia.conferencia, { totalPacto: 0, naLista: 0, excluidos: 0, bate: true, diferenca: 0 });
  ok('a classificação da gestão tira do verificar; lista vazia não quebra');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: FAIL no bloco 7 com `RL.montar is not a function`

- [ ] **Step 3: Implementar**

Acrescentar dentro do objeto, depois de `degustacoesDoHistorico`:

```js
  // ─── A lista ───

  /**
   * @param {object} a
   * @param {string} a.mes          'AAAA-MM'
   * @param {string} a.hoje         'AAAA-MM-DD' em São Paulo
   * @param {object} a.previsao     { mes: {contratos, renovados}, antecipacao: {contratos, renovados} }
   *                                contratos: [{codigoContrato, codigoCliente, matriculaCliente, nomeCliente}]
   * @param {object} a.contratos    número do contrato → {nomePlano, vigenciaDe, vigenciaAte, consultor}
   * @param {Array}  a.historico    itens processados de `periodos`
   * @param {object} [a.gestao]     número do contrato → {blocoGestao, consultoraAtribuida}
   * @param {object} [a.desdeAnterior] número do contrato → dia em que entrou na lista
   * @param {Array}  [a.naoConsultoras]
   */
  montar({ mes, hoje, previsao, contratos, historico, gestao, desdeAnterior, naoConsultoras }) {
    const per = this.periodos(mes);
    const cad = contratos || {};
    const ges = gestao || {};
    const desde = desdeAnterior || {};
    const excluidos = {};
    const conta = m => { excluidos[m] = (excluidos[m] || 0) + 1; };
    const pm = (previsao && previsao.mes) || {};
    const pa = (previsao && previsao.antecipacao) || {};
    const renovados = new Set([...(pm.renovados || []), ...(pa.renovados || [])].map(String));
    const brutos = [...(pm.contratos || []), ...(pa.contratos || [])];
    const totalPacto = brutos.length;
    const dataBR = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);

    // 1. mesmo contrato duas vezes (as duas consultas se sobrepõem) = uma linha
    const vistos = new Set();
    const unicos = [];
    brutos.forEach(b => {
      const k = String(b.codigoContrato);
      if (vistos.has(k)) { conta('duplicado'); return; }
      vistos.add(k);
      unicos.push(b);
    });

    // 2. a linha e a classificação
    const linhas = [];
    unicos.forEach(b => {
      const codigoContrato = String(b.codigoContrato);
      const c = cad[codigoContrato] || null;
      const g = ges[codigoContrato] || {};
      const linha = {
        codigoContrato,
        codigoCliente: b.codigoCliente == null ? null : String(b.codigoCliente),
        matricula: b.matriculaCliente == null || this.pareceCpf(b.matriculaCliente) ? null : String(b.matriculaCliente),
        nome: String(b.nomeCliente || '').trim(),
        plano: c ? String(c.nomePlano || '') : '',
        planoOriginal: null,
        economico: false,
        inicio: c ? this.iso(c.vigenciaDe) : '',
        vencimento: c ? this.iso(c.vigenciaAte) : '',
        consultora: null,
        consultoraOrigem: null,
        renovouSistema: renovados.has(codigoContrato),
        notas: [],
        desde: desde[codigoContrato] || hoje,
        origem: 'pacto',
        n: null,
      };
      let cls = c ? this.classificarPlano(linha.plano) : { tipo: 'verificar', motivo: 'A Pacto não devolveu os dados deste contrato' };
      if (cls.tipo === 'importacao') {
        const orig = this.planoOriginal(linha.nome, historico);
        if (orig) {
          linha.planoOriginal = orig;
          cls = this.classificarPlano(orig);
        }
        if (!orig || cls.tipo === 'importacao') cls = { tipo: 'verificar', motivo: 'Importação sem plano original identificado' };
      }
      if (cls.tipo === 'verificar' && g.blocoGestao) {
        cls = g.blocoGestao === 'excluir' ? { tipo: 'excluir', motivo: 'gestao' } : { tipo: g.blocoGestao };
      }
      if ((cls.tipo === 'renovacao' || cls.tipo === 'degustacao') && !linha.vencimento) {
        cls = { tipo: 'verificar', motivo: 'Contrato sem data de vencimento na Pacto' };
      }
      if (cls.tipo === 'excluir') { conta(cls.motivo); return; }
      linha.economico = !!cls.economico;
      linha._cls = cls;
      linha._consultorPacto = c ? c.consultor : null;
      linhas.push(linha);
    });

    // 3. mesmo aluno mais de uma vez: fica o vencimento mais próximo
    const porAluno = new Map();
    linhas.forEach(l => {
      const k = l.codigoCliente || this.norm(l.nome);
      if (!porAluno.has(k)) porAluno.set(k, []);
      porAluno.get(k).push(l);
    });
    const ficam = [];
    porAluno.forEach(grupo => {
      grupo.sort((a, b) => (a.vencimento || '9999') < (b.vencimento || '9999') ? -1 : (a.vencimento || '9999') > (b.vencimento || '9999') ? 1 : 0);
      if (grupo.length > 1) grupo[0].notas.push(`Aluno repetido na Previsão (${grupo.length}×): ficou o vencimento mais próximo`);
      grupo.slice(1).forEach(() => conta('duplicado'));
      ficam.push(grupo[0]);
    });

    // 4. consultora, notas e bloco
    const blocos = { renovacoes: [], antecipacao: [], degustacoes: [], verificar: [] };
    const noPeriodo = (v, de, ate) => v && v >= de && v <= ate;
    ficam.forEach(l => {
      const g = ges[l.codigoContrato] || {};
      if (g.consultoraAtribuida) { l.consultora = g.consultoraAtribuida; l.consultoraOrigem = 'gestao'; }
      else if (l._consultorPacto && !this.ehNaoConsultora(l._consultorPacto, naoConsultoras)) { l.consultora = l._consultorPacto; l.consultoraOrigem = 'pacto'; }
      else {
        const h = this.consultoraDoHistorico(l.nome, historico, naoConsultoras);
        if (h) { l.consultora = h; l.consultoraOrigem = 'historico'; }
      }
      if (l.renovouSistema) l.notas.push('A Pacto já registra a renovação');

      const cls = l._cls;
      delete l._cls; delete l._consultorPacto;
      if (cls.tipo === 'verificar') { l.motivoVerificar = cls.motivo; blocos.verificar.push(l); return; }
      if (cls.tipo === 'degustacao') {
        if (noPeriodo(l.vencimento, per.mes.de, per.antecipacao.ate)) { blocos.degustacoes.push(l); return; }
      } else if (noPeriodo(l.vencimento, per.mes.de, per.mes.ate)) { blocos.renovacoes.push(l); return; }
      else if (noPeriodo(l.vencimento, per.antecipacao.de, per.antecipacao.ate)) { blocos.antecipacao.push(l); return; }
      l.motivoVerificar = `Vencimento fora do período (${dataBR(l.vencimento)})`;
      blocos.verificar.push(l);
    });
    const naLista = ficam.length;

    // 5. degustações do histórico que a Previsão não trouxe (fora da conferência)
    const jaTem = new Set(ficam.map(l => l.codigoContrato));
    const nomes = new Set(ficam.map(l => this.norm(l.nome)));
    this.degustacoesDoHistorico(historico, per).forEach(d => {
      if (jaTem.has(d.codigoContrato) || nomes.has(this.norm(d.nomeCliente))) return;
      const g = ges[d.codigoContrato] || {};
      blocos.degustacoes.push({
        codigoContrato: d.codigoContrato, codigoCliente: null, matricula: null, nome: d.nomeCliente,
        plano: d.plano, planoOriginal: null, economico: false, inicio: d.inicio, vencimento: d.vencimento,
        consultora: g.consultoraAtribuida || d.consultora, consultoraOrigem: g.consultoraAtribuida ? 'gestao' : (d.consultora ? 'historico' : null),
        renovouSistema: false, notas: ['Degustação vendida que não veio na Previsão da Pacto'],
        desde: desde[d.codigoContrato] || hoje, origem: 'historico', n: null,
      });
    });

    // 6. ordem e numeração
    const ordem = (a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0);
    Object.values(blocos).forEach(ls => ls.sort(ordem));
    let k = 0;
    blocos.renovacoes.forEach(l => { l.n = ++k; });
    blocos.antecipacao.forEach(l => { l.n = ++k; });
    blocos.degustacoes.forEach((l, i) => { l.n = i + 1; });

    const totalExcluidos = Object.values(excluidos).reduce((s, v) => s + v, 0);
    const consultoras = [...new Set(Object.values(blocos).flat().map(l => l.consultora).filter(Boolean))].sort();
    return {
      mes,
      periodos: per,
      blocos,
      excluidos,
      conferencia: { totalPacto, naLista, excluidos: totalExcluidos, bate: naLista + totalExcluidos === totalPacto, diferenca: totalPacto - naLista - totalExcluidos },
      planosRecentes: this.planosRecentes(historico, hoje),
      consultoras,
    };
  },
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: `✅ smoke-renovacoes-lista: 11`

- [ ] **Step 5: Sabotar para provar que o teste pega**

Trocar temporariamente, em `montar`, `if (vistos.has(k)) { conta('duplicado'); return; }` por `if (vistos.has(k)) { return; }`.
Run: `node scripts/smoke-renovacoes-lista.js` → Expected: FAIL no bloco 8 (`excluidos` sem o duplicado e `bate: false`). **Desfazer a sabotagem com o Edit** (nunca `git checkout` — [[nunca-git-checkout-com-trabalho-vivo]]) e rodar de novo: `✅ … 11`.

- [ ] **Step 6: Commit**

```bash
git add renovacoes-lista.js scripts/smoke-renovacoes-lista.js
git commit -m "feat(renovacoes): monta os blocos, junta duplicados e confere com o total da Pacto"
```

---

### Task 5: Módulo — acompanhamento: situação, validações, alertas e painel

**Files:**
- Modify: `renovacoes-lista.js`
- Modify: `scripts/smoke-renovacoes-lista.js`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar antes do `console.log` final:

```js
/* 12. situação: a da consultora, ou Sim quando a Pacto já registra */
{
  assert.strictEqual(RL.statusEfetivo({ renovouSistema: false }, null), 'pendente');
  assert.strictEqual(RL.statusEfetivo({ renovouSistema: false }, { renovou: 'negociacao' }), 'negociacao');
  assert.strictEqual(RL.statusEfetivo({ renovouSistema: true }, { renovou: 'nao' }), 'sim');
  assert.strictEqual(RL.statusEfetivo({ renovouSistema: false }, { renovou: 'lixo' }), 'pendente');
  assert.strictEqual(RL.consultoraDaLinha({ consultora: 'KALI' }, { consultoraAtribuida: 'ERICA' }), 'ERICA', 'a atribuição vale na hora, antes da próxima montagem');
  assert.strictEqual(RL.consultoraDaLinha({ consultora: null }, null), null);
  ok('situação efetiva e consultora da linha');
}

/* 13. validações do documento (seção 5) */
{
  const H = '2026-10-05';
  assert.deepStrictEqual(RL.validar({ renovou: 'pendente' }, H), []);
  assert.deepStrictEqual(RL.validar({ renovou: 'negociacao' }, H), ['Informe a data do 1º contato.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'sim', dataContato: '2026-10-01' }, H), ['Informe o plano fechado.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'nao', dataContato: '2026-10-01' }, H), ['Informe o motivo.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'nao', dataContato: '2026-10-01', motivo: 'Outro' }, H), ['Motivo "Outro" exige observação.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'nao', dataContato: '2026-10-01', motivo: 'Outro', observacoes: 'viajou' }, H), []);
  assert.deepStrictEqual(RL.validar({ renovou: 'nao', dataContato: '2026-10-01', motivo: 'Inventado' }, H), ['Motivo fora da lista.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'pendente', dataContato: '2026-10-06' }, H), ['A data do 1º contato não pode ser no futuro.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'sim', dataContato: '2026-10-01', planoFechado: 'ACESSO LIVRE | RECORRENTE' }, H), [], 'renovar para recorrente conta como Sim');
  assert.deepStrictEqual(RL.validar({ semanas: ['2026-10-01', '', '2026-10-09', ''] }, H), ['A data da semana 3 não pode ser no futuro.']);
  ok('validações: contato obrigatório fora do Pendente, plano no Sim, motivo no Não, observação no Outro, nada no futuro');
}

/* 14. alertas (seção 7) */
{
  const H = '2026-10-05';
  const cod = (l, a, b) => RL.alertas(l, a, b, H).map(x => x.codigo);
  assert.deepStrictEqual(cod({ vencimento: '2026-10-09' }, null, 'renovacoes'), ['vence_sem_contato']);
  assert.deepStrictEqual(cod({ vencimento: '2026-10-09' }, { renovou: 'negociacao', dataContato: '2026-10-01' }, 'renovacoes'), []);
  assert.deepStrictEqual(cod({ vencimento: '2026-10-20' }, null, 'renovacoes'), [], 'mais de 7 dias: ainda não');
  assert.deepStrictEqual(cod({ vencimento: '2026-09-20' }, { renovou: 'pendente' }, 'renovacoes'), ['vencido']);
  assert.deepStrictEqual(cod({ vencimento: '2026-09-20' }, { renovou: 'nao', dataContato: '2026-09-18', motivo: 'Lesão ou saúde' }, 'renovacoes'), [], 'com desfecho, sem alerta');
  assert.deepStrictEqual(cod({ inicio: '2026-09-20', vencimento: '2026-10-20' }, { semanas: ['2026-09-25'] }, 'degustacoes'), ['degustacao_sem_acompanhamento']);
  assert.deepStrictEqual(cod({ inicio: '2026-09-20', vencimento: '2026-10-20' }, { semanas: ['2026-10-01'] }, 'degustacoes'), []);
  assert.deepStrictEqual(cod({ desde: '2026-09-30' }, null, 'verificar'), ['verificar_parado']);
  assert.deepStrictEqual(cod({ desde: '2026-10-03' }, null, 'verificar'), []);
  assert.deepStrictEqual(cod({ vencimento: '2026-10-20', renovouSistema: true }, { renovou: 'nao' }, 'renovacoes'), ['divergencia']);
  const v = RL.alertas({ vencimento: '2026-10-09' }, null, 'renovacoes', H)[0];
  assert.strictEqual(v.nivel, 'vermelho'); assert.strictEqual(v.texto, 'Vence em 4 dia(s) e ainda não houve contato');
  ok('alertas: vence em 7 dias sem contato, vencido há +7 dias, degustação sem acompanhamento, verificar parado, divergência');
}

/* 15. painel */
{
  const acomps = { 105: { renovou: 'sim' }, 109: { renovou: 'nao' }, 107: { renovou: 'negociacao' }, 104: { renovou: 'sim', consultoraAtribuida: 'ERICA' } };
  const p = RL.painel(LISTA, acomps, '2026-10-05');
  assert.deepStrictEqual(p.porBloco.renovacoes, { total: 4, sim: 2, nao: 1, negociacao: 1, pendente: 0 }, '101 conta como Sim pela Pacto');
  assert.deepStrictEqual(p.porBloco.antecipacao, { total: 1, sim: 0, nao: 0, negociacao: 0, pendente: 1 });
  assert.deepStrictEqual(p.porBloco.degustacoes, { total: 2, sim: 1, nao: 0, negociacao: 0, pendente: 1 });
  assert.strictEqual(p.totalARenovar, 4);
  assert.strictEqual(p.taxaRenovacao, 50);
  assert.strictEqual(p.conversaoDegustacao, 50);
  assert.deepStrictEqual(p.porConsultora.ERICA, { total: 2, renovados: 1 });
  assert.deepStrictEqual(p.porConsultora['Sem consultora'], { total: 3, renovados: 0 }, '109, 107 e 201');
  assert.deepStrictEqual(p.alertas, { vermelho: 0, laranja: 1 }, 'só o 202, parado no verificar desde 30/09');
  ok('painel: por bloco, taxa de renovação (Sim ÷ Bloco 1), conversão, por consultora, total de alertas');
}
```

Conta de conferência do bloco 15: blocos 1–3 = 105 (BARBARA, Sim), 109 (—, Não), 101 (KALI, Sim pela Pacto), 107 (—, negociação), 201 (—, pendente), 104 (ERICA atribuída, Sim), 301 (ERICA do histórico, pendente). Nenhum vence em até 7 dias sem contato: 105 vence hoje mas já é Sim; 301 ainda não começou. O único alerta é o 202 no verificar (5 dias).

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: FAIL no bloco 12 com `RL.statusEfetivo is not a function`

- [ ] **Step 3: Implementar**

Acrescentar dentro do objeto, depois de `montar`:

```js
  // ─── O que a consultora preenche ───

  /** Sim se ela disse Sim ou se a Pacto já registra; senão, o que ela marcou. */
  statusEfetivo(linha, acomp) {
    const s = acomp && acomp.renovou;
    if (s === 'sim' || (linha && linha.renovouSistema)) return 'sim';
    return this.STATUS[s] ? s : 'pendente';
  },

  consultoraDaLinha(linha, acomp) {
    return (acomp && acomp.consultoraAtribuida) || (linha && linha.consultora) || null;
  },

  /** Lista de erros (vazia = pode gravar). Mesmas regras do documento, seção 5. */
  validar(acomp, hoje) {
    const a = acomp || {};
    const erros = [];
    const s = a.renovou || 'pendente';
    if (!this.STATUS[s]) erros.push('Situação inválida.');
    if (a.dataContato && this.iso(a.dataContato) > hoje) erros.push('A data do 1º contato não pode ser no futuro.');
    if (s !== 'pendente' && !a.dataContato) erros.push('Informe a data do 1º contato.');
    if (s === 'sim' && !String(a.planoFechado || '').trim()) erros.push('Informe o plano fechado.');
    if (s === 'nao' && !a.motivo) erros.push('Informe o motivo.');
    if (s === 'nao' && a.motivo && this.MOTIVOS_NAO_RENOVOU.indexOf(a.motivo) < 0) erros.push('Motivo fora da lista.');
    if (s === 'nao' && a.motivo === 'Outro' && !String(a.observacoes || '').trim()) erros.push('Motivo "Outro" exige observação.');
    (a.semanas || []).forEach((d, i) => {
      if (d && this.iso(d) > hoje) erros.push(`A data da semana ${i + 1} não pode ser no futuro.`);
    });
    return erros;
  },

  /** [{nivel: 'vermelho'|'laranja', codigo, texto}] */
  alertas(linha, acomp, bloco, hoje) {
    const out = [];
    const a = acomp || {};
    if (bloco === 'verificar') {
      if (this.diasEntre(linha.desde || hoje, hoje) > 3) {
        out.push({ nivel: 'laranja', codigo: 'verificar_parado', texto: 'No "Verificar manualmente" há mais de 3 dias' });
      }
      return out;
    }
    const s = this.statusEfetivo(linha, a);
    const aberto = s === 'pendente' || s === 'negociacao';
    if (aberto && linha.vencimento) {
      const faltam = this.diasEntre(hoje, linha.vencimento);
      if (faltam >= 0 && faltam <= 7 && !a.dataContato) {
        out.push({ nivel: 'vermelho', codigo: 'vence_sem_contato', texto: `Vence em ${faltam} dia(s) e ainda não houve contato` });
      }
      if (faltam < -7) {
        out.push({ nivel: 'vermelho', codigo: 'vencido', texto: `Venceu há ${-faltam} dias e segue ${this.STATUS[s].toLowerCase()}` });
      }
    }
    if (bloco === 'degustacoes' && aberto && linha.inicio && linha.inicio <= hoje) {
      const nestaSemana = (a.semanas || []).some(d => {
        const x = this.iso(d);
        return x && this.diasEntre(x, hoje) >= 0 && this.diasEntre(x, hoje) <= 6;
      });
      if (!nestaSemana) out.push({ nivel: 'laranja', codigo: 'degustacao_sem_acompanhamento', texto: 'Sem acompanhamento registrado nesta semana' });
    }
    if (a.renovou === 'nao' && linha.renovouSistema) {
      out.push({ nivel: 'laranja', codigo: 'divergencia', texto: 'Marcado como "Não", mas a Pacto registra a renovação — conferir' });
    }
    return out;
  },

  /** Números do topo da lista. `acomps`: número do contrato → acompanhamento. */
  painel(lista, acomps, hoje) {
    const ac = acomps || {};
    const blocos = (lista && lista.blocos) || {};
    const DA_EQUIPE = ['renovacoes', 'antecipacao', 'degustacoes'];
    const porBloco = {};
    DA_EQUIPE.forEach(b => {
      const c = { total: 0, sim: 0, nao: 0, negociacao: 0, pendente: 0 };
      (blocos[b] || []).forEach(l => { c.total++; c[this.statusEfetivo(l, ac[l.codigoContrato])]++; });
      porBloco[b] = c;
    });
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const porConsultora = {};
    DA_EQUIPE.forEach(b => (blocos[b] || []).forEach(l => {
      const a = ac[l.codigoContrato];
      const nome = this.consultoraDaLinha(l, a) || 'Sem consultora';
      const x = porConsultora[nome] = porConsultora[nome] || { total: 0, renovados: 0 };
      x.total++;
      if (this.statusEfetivo(l, a) === 'sim') x.renovados++;
    }));
    const alertas = { vermelho: 0, laranja: 0 };
    Object.keys(blocos).forEach(b => (blocos[b] || []).forEach(l => {
      this.alertas(l, ac[l.codigoContrato], b, hoje).forEach(x => { alertas[x.nivel]++; });
    }));
    return {
      porBloco,
      totalARenovar: porBloco.renovacoes.total,
      taxaRenovacao: pct(porBloco.renovacoes.sim, porBloco.renovacoes.total),
      conversaoDegustacao: pct(porBloco.degustacoes.sim, porBloco.degustacoes.total),
      porConsultora,
      alertas,
    };
  },
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: `✅ smoke-renovacoes-lista: 15`

- [ ] **Step 5: Commit**

```bash
git add renovacoes-lista.js scripts/smoke-renovacoes-lista.js
git commit -m "feat(renovacoes): situação, validações, alertas e painel da lista"
```

---

### Task 6: Gêmeo em `functions/`

**Files:**
- Create: `functions/renovacoes-lista.js` (cópia exata)
- Modify: `scripts/smoke-renovacoes-lista.js`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar antes do `console.log` final:

```js
/* 16. a cópia de functions/ é idêntica à da raiz */
{
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', 'renovacoes-lista.js'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'renovacoes-lista.js'), 'utf8'), 'functions/renovacoes-lista.js divergiu da raiz');
  ok('functions/renovacoes-lista.js idêntico ao da raiz');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: FAIL com `ENOENT ... functions\renovacoes-lista.js`

- [ ] **Step 3: Copiar**

Run: `cp renovacoes-lista.js functions/renovacoes-lista.js`

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-renovacoes-lista.js`
Expected: `✅ smoke-renovacoes-lista: 16`

- [ ] **Step 5: Commit**

```bash
git add functions/renovacoes-lista.js scripts/smoke-renovacoes-lista.js
git commit -m "chore(renovacoes): gêmeo do módulo em functions/"
```

---

### Task 7: Cliente da Previsão de Renovação

**Files:**
- Create: `functions/pacto-renovacao-cliente.js`
- Create: `scripts/smoke-pacto-renovacao-cliente.js`

- [ ] **Step 1: Escrever o teste que falha**

`scripts/smoke-pacto-renovacao-cliente.js`:

```js
'use strict';
// Roda: node scripts/smoke-pacto-renovacao-cliente.js
// Cliente da Previsão de Renovação (gateway da Pacto, credencial por unidade) com fetch FALSO.

const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '..', 'functions', 'pacto-renovacao-cliente.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);
const CRED = 'CREDENCIAL-FALSA-123';

function fetchFalso(respostas) {
  const chamadas = [];
  const f = async (url, opt) => {
    chamadas.push({ url, opt });
    const r = respostas.shift();
    return { status: r.status, text: async () => r.texto };
  };
  f.chamadas = chamadas;
  return f;
}
const resposta = obj => ({ status: 200, texto: JSON.stringify({ content: { jsonDados: JSON.stringify(obj) } }) });

(async () => {
  /* 1. o intervalo em milissegundos é o dia inteiro em São Paulo */
  {
    assert.deepStrictEqual(R.intervaloMs('2026-10-01', '2026-10-31'),
      { dataInicial: Date.UTC(2026, 9, 1, 3, 0, 0), dataFinal: Date.UTC(2026, 10, 1, 2, 59, 59) });
    ok('intervalo: 00:00 do primeiro dia a 23:59:59 do último, em São Paulo');
  }

  /* 2. a chamada: rota, cabeçalhos e corpo */
  {
    const f = fetchFalso([resposta({ contratosPrevisaoMes: [
      { codigoContrato: 101, codigoCliente: 11, matriculaCliente: '5011', nomeCliente: 'ANA', situacaoCliente: 'AT' },
      { codigoContrato: null, nomeCliente: 'SEM CONTRATO' },
    ], contratosRenovadosPrevisaoMes: [{ codigoContrato: 101 }] })]);
    const c = R.criarClienteRenovacao({ fetch: f, credencial: CRED });
    const r = await c.previsao('2026-10-01', '2026-10-31');
    assert.strictEqual(r.situacao, 'ok');
    assert.deepStrictEqual(r.dados, { contratos: [{ codigoContrato: '101', codigoCliente: '11', matriculaCliente: '5011', nomeCliente: 'ANA' }], renovados: ['101'] });
    const { url, opt } = f.chamadas[0];
    assert.strictEqual(url, 'https://apigw.pactosolucoes.com.br/v2-indice-renovacao');
    assert.strictEqual(opt.method, 'POST');
    assert.strictEqual(opt.headers.Authorization, CRED);
    assert.strictEqual(opt.headers.empresaId, '1');
    assert.deepStrictEqual(JSON.parse(opt.body), { empresa: 1, dataInicial: Date.UTC(2026, 9, 1, 3), dataFinal: Date.UTC(2026, 10, 1, 2, 59, 59),
      retornarContratos: true, desconsiderarContratosRenovaveis: false, considerarMudancaDePlano: false });
    assert.strictEqual(c.chamadas, 1);
    ok('rota v2-indice-renovacao, credencial crua + empresaId 1, corpo com o período; só os 4 campos do contrato');
  }

  /* 3. falhas */
  {
    let c = R.criarClienteRenovacao({ fetch: fetchFalso([{ status: 401, texto: 'nao' }]), credencial: CRED });
    assert.strictEqual((await c.previsao('2026-10-01', '2026-10-31')).situacao, 'credencial_recusada');

    const f = fetchFalso([{ status: 500, texto: 'erro ' + CRED }, resposta({ contratosPrevisaoMes: [] })]);
    c = R.criarClienteRenovacao({ fetch: f, credencial: CRED });
    const r = await c.previsao('2026-10-01', '2026-10-31');
    assert.strictEqual(r.situacao, 'ok', 'falha passageira: tenta de novo uma vez');
    assert.strictEqual(c.chamadas, 2);

    c = R.criarClienteRenovacao({ fetch: fetchFalso([{ status: 500, texto: 'erro ' + CRED }, { status: 500, texto: 'erro ' + CRED }]), credencial: CRED });
    const r2 = await c.previsao('2026-10-01', '2026-10-31');
    assert.strictEqual(r2.situacao, 'falhou');
    assert.ok(!r2.motivo.includes(CRED), 'a credencial nunca vai para o motivo');

    c = R.criarClienteRenovacao({ fetch: fetchFalso([{ status: 200, texto: JSON.stringify({ erro: 'x' }) }, { status: 200, texto: JSON.stringify({ erro: 'x' }) }]), credencial: CRED });
    assert.strictEqual((await c.previsao('2026-10-01', '2026-10-31')).situacao, 'falhou', '{erro} com HTTP 200 é falha');

    c = R.criarClienteRenovacao({ fetch: fetchFalso([resposta({ outraCoisa: 1 })]), credencial: CRED });
    const r3 = await c.previsao('2026-10-01', '2026-10-31');
    assert.strictEqual(r3.situacao, 'falhou');
    assert.strictEqual(r3.motivo, 'resposta sem a lista de contratos da previsão');
    ok('401 recusa, falha passageira tenta de novo, erro no corpo e resposta sem a lista viram falha, credencial fora do motivo');
  }

  console.log('\n✅ smoke-pacto-renovacao-cliente: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-pacto-renovacao-cliente.js`
Expected: FAIL com `Cannot find module '...pacto-renovacao-cliente.js'`

- [ ] **Step 3: Implementar**

`functions/pacto-renovacao-cliente.js` (se a tarefa 1 mostrou outros nomes de lista, ajustar `LISTA_PREVISAO` / `LISTAS_RENOVADOS` e o teste):

```js
'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Cliente da Previsão de Renovação da Pacto (gateway, credencial POR UNIDADE)
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §2
//
// Só LEITURA: a única rota deste arquivo é `v2-indice-renovacao`. A credencial
// da unidade pode gravar e apagar na Pacto — nenhuma rota que grava entra aqui.
// É a mesma tela "Previsão de Renovação" que o Rodrigo usa, ANTES das exclusões
// dele (recorrente, crédito…): quem exclui é o renovacoes-lista.js.
//
// ⚠️ A credencial nunca vai para log nem para `motivo`.

const { classificar } = require('./pacto-api-cliente.js');

const GW = 'https://apigw.pactosolucoes.com.br';
const LISTA_PREVISAO = 'contratosPrevisaoMes';
const LISTAS_RENOVADOS = ['contratosRenovadosPrevisaoMes'];

/** Dias 'AAAA-MM-DD' → milissegundos do dia inteiro em São Paulo (UTC−3 o ano todo desde 2019). */
function intervaloMs(de, ate) {
  const [a1, m1, d1] = de.split('-').map(Number);
  const [a2, m2, d2] = ate.split('-').map(Number);
  return { dataInicial: Date.UTC(a1, m1 - 1, d1, 3, 0, 0), dataFinal: Date.UTC(a2, m2 - 1, d2 + 1, 2, 59, 59) };
}

/** Resposta da Pacto → {contratos, renovados} | null. Do contrato, só os campos que a lista usa. */
function lerListas(dados) {
  const c = (dados && dados.content) || dados || {};
  let j = c.jsonDados;
  if (typeof j === 'string') {
    try { j = JSON.parse(j); } catch (e) { return null; }
  }
  if (!j || typeof j !== 'object' || !Array.isArray(j[LISTA_PREVISAO])) return null;
  const renovados = [];
  LISTAS_RENOVADOS.forEach(k => (Array.isArray(j[k]) ? j[k] : []).forEach(x => {
    if (x && x.codigoContrato != null) renovados.push(String(x.codigoContrato));
  }));
  const contratos = j[LISTA_PREVISAO].filter(x => x && x.codigoContrato != null).map(x => ({
    codigoContrato: String(x.codigoContrato),
    codigoCliente: x.codigoCliente == null ? null : String(x.codigoCliente),
    matriculaCliente: x.matriculaCliente == null ? null : String(x.matriculaCliente),
    nomeCliente: String(x.nomeCliente || ''),
  }));
  return { contratos, renovados };
}

function criarClienteRenovacao({ fetch, credencial, base = GW }) {
  if (typeof fetch !== 'function') throw new Error('criarClienteRenovacao: fetch é obrigatório');
  if (!credencial) throw new Error('criarClienteRenovacao: credencial é obrigatória');
  let chamadas = 0;

  async function uma(corpo) {
    chamadas++;
    let res, texto;
    try {
      res = await fetch(base + '/v2-indice-renovacao', {
        method: 'POST',
        headers: { Authorization: credencial, empresaId: '1', 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(corpo),
      });
      texto = await res.text();
    } catch (e) {
      return { situacao: 'falhou', motivo: 'rede: ' + String(e && e.message || e).split(credencial).join('<credencial>') };
    }
    return classificar(res.status, texto, credencial);
  }

  return {
    get chamadas() { return chamadas; },

    /** Contratos que vencem entre `de` e `ate` ('AAAA-MM-DD'), e os já renovados. */
    async previsao(de, ate) {
      const corpo = { empresa: 1, ...intervaloMs(de, ate), retornarContratos: true,
        desconsiderarContratosRenovaveis: false, considerarMudancaDePlano: false };
      let r = await uma(corpo);
      if (r.situacao === 'falhou') r = await uma(corpo);       // falha passageira: uma vez só
      if (r.situacao !== 'ok') return r;
      const l = lerListas(r.dados);
      if (!l) return { situacao: 'falhou', motivo: 'resposta sem a lista de contratos da previsão' };
      return { situacao: 'ok', dados: l };
    },
  };
}

module.exports = { criarClienteRenovacao, intervaloMs, lerListas, GW, LISTA_PREVISAO, LISTAS_RENOVADOS };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-pacto-renovacao-cliente.js`
Expected: `✅ smoke-pacto-renovacao-cliente: 3`

- [ ] **Step 5: Commit**

```bash
git add functions/pacto-renovacao-cliente.js scripts/smoke-pacto-renovacao-cliente.js
git commit -m "feat(renovacoes): cliente da Previsão de Renovação da Pacto (só leitura)"
```

---

### Task 8: Orquestração — buscar, completar, montar e gravar

**Files:**
- Create: `functions/renovacoes-montar.js`
- Create: `scripts/smoke-renovacoes-montar.js`

- [ ] **Step 1: Escrever o teste que falha**

`scripts/smoke-renovacoes-montar.js`:

```js
'use strict';
// Roda: node scripts/smoke-renovacoes-montar.js
// A montagem da lista com banco FALSO e Pacto FALSA. Dados INVENTADOS.

const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, '..', 'functions', 'renovacoes-montar.js'));
const makeFakeDb = require('./_fake-firestore.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const K = (codigoContrato, codigoCliente, nomeCliente) => ({ codigoContrato, codigoCliente, matriculaCliente: '50' + codigoCliente, nomeCliente });
function gwFalso(porInicio) {
  const g = { chamadas: 0, async previsao(de) { g.chamadas++; const r = porInicio[de]; return typeof r === 'function' ? r() : r; } };
  return g;
}
const OK = (contratos, renovados) => ({ situacao: 'ok', dados: { contratos, renovados: renovados || [] } });
function nucleoFalso(porCliente) {
  const nf = { consultas: 0, async contratosDoCliente(chave, cliente) { nf.consultas++; return porCliente[cliente] || { situacao: 'ok', dados: [] }; } };
  return nf;
}
const BRUTO = (codigo, nomePlano, vigenciaDe, vigenciaAteAjustada) => ({ codigo, nomePlano, vigenciaDe, vigenciaAteAjustada, situacaoContrato: 'Renovação' });

async function bancoComHistorico() {
  const db = makeFakeDb();
  await db.collection('units').doc('unit-cp').set({ config: {} });
  await db.collection('periodos').doc('unit-cp_2025-04').set({ unitId: 'unit-cp' });
  await db.collection('periodos').doc('unit-cp_2025-04').collection('itens').doc('i1').set({ type: 'processed',
    cliente: 'EDU IMPORTADO', item: 'SEMESTRAL, TREINO LIVRE (01/04/2025 - 30/09/2025)', data: '10/04/2025', vendedor: 'BARBARA', codigo: 'C500', isContract: true });
  await db.collection('periodos').doc('unit-cp_2026-10').set({ unitId: 'unit-cp', metasMensais: { meta: 55, superMeta: 63, metaGold: 72, minNovos: 19, minRenov: 16, minVoucher: 5 } });
  await db.collection('renovacoes_acompanhamento').doc('CP_106').set({ unidade: 'CP', codigoContrato: '106', consultoraAtribuida: 'FRANCINI', renovou: 'negociacao', dataContato: '2026-10-02' });
  return db;
}

const PACTO_OUT = {
  '2026-10-01': OK([K('101', '11', 'ANA ANUAL'), K('102', '12', 'BETO RECORRENTE'), K('105', '15', 'EDU IMPORTADO'), K('106', '16', 'FABI SEMDADOS')], ['101']),
  '2026-11-01': OK([K('201', '21', 'IVO ANTECIPA')]),
};
const NUCLEO = {
  11: { situacao: 'ok', dados: [BRUTO(101, 'ANUAL, ACESSO ILIMITADO', '01/10/2025', '20/10/2026')] },
  12: { situacao: 'ok', dados: [BRUTO(102, 'ACESSO LIVRE | RECORRENTE | FLEX', '15/09/2026', '15/10/2026')] },
  15: { situacao: 'ok', dados: [BRUTO(105, 'IMPORTAÇÃO', '01/10/2025', '05/10/2026')] },
  21: { situacao: 'ok', dados: [BRUTO(201, 'SEMESTRAL, TREINO LIVRE', '10/05/2026', '10/11/2026')] },
};

(async () => {
  /* 1. monta e grava a lista do mês */
  const db = await bancoComHistorico();
  const nucleo = nucleoFalso(NUCLEO);
  const r = await M.montarUnidadeMes({ db, clienteGw: gwFalso(PACTO_OUT), clienteNucleo: nucleo, unidade: 'CP', mes: '2026-10', hoje: '2026-10-05', agora: () => 'AGORA' });
  const doc = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
  {
    assert.strictEqual(r.situacao, 'ok');
    assert.strictEqual(doc.situacao, 'ok'); assert.strictEqual(doc.unidade, 'CP'); assert.strictEqual(doc.mes, '2026-10');
    assert.deepStrictEqual(doc.blocos.renovacoes.map(l => l.codigoContrato), ['105', '101']);
    assert.deepStrictEqual(doc.blocos.antecipacao.map(l => l.codigoContrato), ['201']);
    assert.deepStrictEqual(doc.blocos.verificar.map(l => l.codigoContrato), ['106'], 'o núcleo não devolveu o 106');
    assert.deepStrictEqual(doc.excluidos, { recorrente: 1 });
    assert.strictEqual(doc.conferencia.bate, true);
    assert.strictEqual(doc.blocos.renovacoes[0].planoOriginal, 'SEMESTRAL, TREINO LIVRE', 'plano original pelo histórico do período');
    assert.strictEqual(doc.blocos.verificar[0].consultora, 'FRANCINI', 'consultora atribuída pela gestão');
    assert.deepStrictEqual(doc.metas, { meta: 55, superMeta: 63, metaGold: 72, minNovos: 19, minRenov: 16, minVoucher: 5 });
    assert.strictEqual(doc.atualizadoEm, 'AGORA');
    assert.strictEqual(nucleo.consultas, 5, 'uma consulta por cliente sem contrato no caderninho');
    ok('busca os dois períodos, completa pelo núcleo, lê histórico, gestão e metas, e grava a lista');
  }

  /* 2. o caderninho evita perguntar de novo, e a lista não mexe no acompanhamento */
  {
    const nucleo2 = nucleoFalso(NUCLEO);
    await M.montarUnidadeMes({ db, clienteGw: gwFalso(PACTO_OUT), clienteNucleo: nucleo2, unidade: 'CP', mes: '2026-10', hoje: '2026-10-06', agora: () => 'DEPOIS' });
    assert.strictEqual(nucleo2.consultas, 1, 'só o 106, que o núcleo nunca devolveu');
    assert.ok((await db.collection('pacto_contratos').doc('CP_101').get()).exists, 'grava no caderninho');
    const acomp = (await db.collection('renovacoes_acompanhamento').doc('CP_106').get()).data();
    assert.deepStrictEqual(acomp, { unidade: 'CP', codigoContrato: '106', consultoraAtribuida: 'FRANCINI', renovou: 'negociacao', dataContato: '2026-10-02' });
    const d2 = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    assert.strictEqual(d2.blocos.verificar[0].desde, '2026-10-05', 'o "desde" vem da lista anterior');
    ok('caderninho reaproveitado; o acompanhamento da consultora não é tocado; o "desde" atravessa os dias');
  }

  /* 3. falha não apaga a lista boa; vazio com sucesso também não */
  {
    await M.montarUnidadeMes({ db, clienteGw: gwFalso({ '2026-10-01': { situacao: 'falhou', motivo: 'HTTP 500' } }), clienteNucleo: nucleoFalso({}), unidade: 'CP', mes: '2026-10', hoje: '2026-10-07', agora: () => 'FALHA' });
    let d = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    assert.strictEqual(d.situacao, 'ok'); assert.strictEqual(d.blocos.renovacoes.length, 2);
    assert.deepStrictEqual(d.ultimaFalha, { situacao: 'falhou', motivo: 'HTTP 500', em: 'FALHA' });

    const r4 = await M.montarUnidadeMes({ db, clienteGw: gwFalso({ '2026-10-01': OK([]), '2026-11-01': OK([]) }), clienteNucleo: nucleoFalso({}), unidade: 'CP', mes: '2026-10', hoje: '2026-10-08', agora: () => 'VAZIO' });
    assert.strictEqual(r4.situacao, 'vazio_suspeito');
    d = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    assert.strictEqual(d.blocos.renovacoes.length, 2, 'a lista de ontem continua');
    assert.strictEqual(d.ultimaFalha.situacao, 'vazio_suspeito');

    const db2 = makeFakeDb();
    await M.montarUnidadeMes({ db: db2, clienteGw: gwFalso({ '2026-10-01': { situacao: 'credencial_recusada', motivo: 'HTTP 401' } }), clienteNucleo: nucleoFalso({}), unidade: 'PP', mes: '2026-10', hoje: '2026-10-05', agora: () => 'X' });
    const d3 = (await db2.collection('renovacoes_lista').doc('PP_2026-10').get()).data();
    assert.deepStrictEqual(d3, { unidade: 'PP', mes: '2026-10', situacao: 'credencial_recusada', motivo: 'HTTP 401', atualizadoEm: 'X' });
    ok('falha guarda ultimaFalha e mantém a lista; resposta vazia quando ontem havia é suspeita; sem lista anterior, grava a falha');
  }

  /* 4. montarTudo: meses mantidos por unidade; credencial recusada para só aquela unidade */
  {
    const db3 = await bancoComHistorico();
    const gwCP = gwFalso({ '2026-10-01': OK([]), '2026-11-01': OK([]), '2026-12-01': OK([]) });
    const gwPP = gwFalso({ '2026-10-01': { situacao: 'credencial_recusada', motivo: 'HTTP 401' } });
    const res = await M.montarTudo({ db: db3, clientesGw: { CP: gwCP, PP: gwPP }, clienteNucleo: nucleoFalso({}), hoje: '2026-10-26', agora: () => 'T' });
    assert.deepStrictEqual(res.map(x => x.id + ' ' + x.situacao), ['CP_2026-10 ok', 'CP_2026-11 ok', 'PP_2026-10 credencial_recusada']);
    assert.strictEqual(gwPP.chamadas, 1, 'não insiste com credencial recusada');
    ok('do dia 25 em diante mantém o mês seguinte; credencial recusada para só a unidade dela');
  }

  console.log('\n✅ smoke-renovacoes-montar: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-renovacoes-montar.js`
Expected: FAIL com `Cannot find module '...renovacoes-montar.js'`

- [ ] **Step 3: Implementar**

`functions/renovacoes-montar.js`:

```js
'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Lista de renovações — a montagem diária (Cloud Function)
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §3
//
// Previsão de Renovação (gateway, credencial da unidade) → contratos completos
// pelo núcleo (caderninho `pacto_contratos`, o mesmo da busca diária) →
// histórico de `periodos` → renovacoes-lista.js → `renovacoes_lista/{UN}_{mês}`.
//
// Regras que os testes guardam:
//  • grava SÓ em renovacoes_lista e no caderninho — o que a consultora preenche
//    mora em renovacoes_acompanhamento e esta Function só LÊ de lá;
//  • falha nunca apaga a lista boa (guarda `ultimaFalha`);
//  • resposta vazia com "sucesso" quando ontem havia contratos é falha;
//  • credencial recusada ou limite param a unidade na hora.

const RL = require('./renovacoes-lista.js');
const L = require('./pacto-api-linhas.js');
const PA = require('./pacto-adapter.js');
const { PACTO_UNIDADES, COL_CONTRATOS, COL_CONSULTORAS } = require('./pacto-sombra.js');

const COL_LISTA = 'renovacoes_lista';
const COL_ACOMP = 'renovacoes_acompanhamento';
const PARA_TUDO = ['credencial_recusada', 'limite'];

/** 'CP' → id da unidade neste ambiente (`cp` em produção, `unit-cp` no staging) */
async function unidadeDoBanco(db, unidade) {
  const units = (await db.collection('units').get()).docs;
  const u = units.find(d => PA.siglaDaUnidade(d.id, [unidade]) === unidade);
  return u ? u.id : null;
}

/** Itens processados de todos os períodos da unidade, só com os campos que a lista usa. */
async function carregarHistorico(db, unitId) {
  if (!unitId) return [];
  const periodos = (await db.collection('periodos').where('unitId', '==', unitId).get()).docs;
  const out = [];
  for (const p of periodos) {
    const itens = (await db.collection('periodos').doc(p.id).collection('itens').where('type', '==', 'processed').get()).docs;
    itens.forEach(d => {
      const x = d.data();
      out.push({
        cliente: x.cliente || '', item: x.item || '', data: x.data || '', vendedor: x.vendedor || '', codigo: x.codigo || '',
        isContract: !!x.isContract, isDegustacao: !!x.isDegustacao, planStartDate: x.planStartDate || '', planEndDate: x.planEndDate || '',
      });
    });
  }
  return out;
}

/** Plano e vigência de cada contrato: do caderninho, ou uma consulta por cliente ao núcleo. */
async function completarContratos({ db, clienteNucleo, unidade, brutos }) {
  const chave = PACTO_UNIDADES[unidade];
  const mapa = {};
  const faltam = new Map();
  for (const b of brutos) {
    if (mapa[b.codigoContrato]) continue;
    const s = await db.collection(COL_CONTRATOS).doc(unidade + '_' + b.codigoContrato).get();
    if (s.exists) mapa[b.codigoContrato] = s.data();
    else if (b.codigoCliente) {
      if (!faltam.has(b.codigoCliente)) faltam.set(b.codigoCliente, []);
      faltam.get(b.codigoCliente).push(b.codigoContrato);
    }
  }
  let consultas = 0;
  for (const cliente of faltam.keys()) {
    const r = await clienteNucleo.contratosDoCliente(chave, cliente);
    consultas++;
    if (PARA_TUDO.includes(r.situacao)) return { mapa, consultas, parouPor: r.situacao };
    if (r.situacao !== 'ok') continue;               // o contrato fica sem dados → Bloco 4
    for (const bruto of r.dados || []) {
      if (!bruto || bruto.codigo == null) continue;
      const codigo = String(bruto.codigo);
      let consultor = null, lancou = null;
      if (unidade !== 'CP') {                         // o CP não tem consultora na Pacto
        const g = await db.collection(COL_CONSULTORAS).doc(unidade + '_' + codigo).get();
        if (g.exists) { consultor = g.data().consultor || null; lancou = g.data().lancou || null; }
      }
      const limpo = L.limparContrato(bruto, unidade, consultor, lancou);
      await db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo).set(limpo);
      mapa[codigo] = limpo;
    }
  }
  return { mapa, consultas };
}

/** Falha NÃO apaga a lista boa: ela fica e ganha `ultimaFalha`. */
async function gravarFalha(db, id, base, situacao, motivo, quando) {
  const ref = db.collection(COL_LISTA).doc(id);
  const atual = await ref.get();
  if (atual.exists && atual.data().situacao === 'ok') {
    await ref.set({ ultimaFalha: { situacao, motivo: motivo || '', em: quando } }, { merge: true });
    return;
  }
  await ref.set({ ...base, situacao, motivo: motivo || '', atualizadoEm: quando });
}

async function montarUnidadeMes({ db, clienteGw, clienteNucleo, unidade, mes, hoje, agora }) {
  const quando = agora ? agora() : new Date().toISOString();
  const id = unidade + '_' + mes;
  const base = { unidade, mes };
  const per = RL.periodos(mes);

  const r1 = await clienteGw.previsao(per.mes.de, per.mes.ate);
  if (r1.situacao !== 'ok') { await gravarFalha(db, id, base, r1.situacao, r1.motivo, quando); return { id, situacao: r1.situacao }; }
  const r2 = await clienteGw.previsao(per.antecipacao.de, per.antecipacao.ate);
  if (r2.situacao !== 'ok') { await gravarFalha(db, id, base, r2.situacao, r2.motivo, quando); return { id, situacao: r2.situacao }; }

  const anteriorSnap = await db.collection(COL_LISTA).doc(id).get();
  const anterior = anteriorSnap.exists ? anteriorSnap.data() : null;
  const brutos = [...r1.dados.contratos, ...r2.dados.contratos];
  const ontemHavia = !!(anterior && anterior.conferencia && anterior.conferencia.totalPacto > 0);
  if (!brutos.length && ontemHavia) {
    await gravarFalha(db, id, base, 'vazio_suspeito', 'a Pacto respondeu sem nenhum contrato, e antes havia', quando);
    return { id, situacao: 'vazio_suspeito' };
  }

  const c = await completarContratos({ db, clienteNucleo, unidade, brutos });
  if (c.parouPor) { await gravarFalha(db, id, base, c.parouPor, 'ao completar os contratos no núcleo', quando); return { id, situacao: c.parouPor }; }

  const unitId = await unidadeDoBanco(db, unidade);
  const historico = await carregarHistorico(db, unitId);
  const gestao = {};
  (await db.collection(COL_ACOMP).where('unidade', '==', unidade).get()).docs.forEach(d => {
    const x = d.data();
    gestao[String(x.codigoContrato)] = { blocoGestao: x.blocoGestao || null, consultoraAtribuida: x.consultoraAtribuida || null };
  });
  const desdeAnterior = {};
  if (anterior && anterior.blocos) {
    Object.values(anterior.blocos).forEach(ls => (ls || []).forEach(l => { if (l.desde) desdeAnterior[l.codigoContrato] = l.desde; }));
  }
  let metas = null;
  if (unitId) {
    const p = await db.collection('periodos').doc(unitId + '_' + mes).get();
    const m = p.exists ? p.data().metasMensais : null;
    metas = m && Object.keys(m).length ? m : null;
  }

  const lista = RL.montar({ mes, hoje, previsao: { mes: r1.dados, antecipacao: r2.dados }, contratos: c.mapa, historico, gestao, desdeAnterior });
  // `set` sem merge: a lista do dia substitui a anterior inteira (e some a ultimaFalha)
  await db.collection(COL_LISTA).doc(id).set({
    ...base, ...lista, metas, unitId, situacao: 'ok', motivo: '', hoje, contratosConsultados: c.consultas, atualizadoEm: quando,
  });
  return { id, situacao: 'ok', consultas: c.consultas };
}

/** As duas unidades, nos meses que a lista mantém (o corrente; do dia 25, também o seguinte). */
async function montarTudo({ db, clientesGw, clienteNucleo, unidades = ['CP', 'PP'], hoje, agora }) {
  const resultados = [];
  for (const unidade of unidades) {
    for (const mes of RL.mesesParaManter(hoje)) {
      const r = await montarUnidadeMes({ db, clienteGw: clientesGw[unidade], clienteNucleo, unidade, mes, hoje, agora });
      resultados.push(r);
      if (PARA_TUDO.includes(r.situacao)) break;     // esta unidade para; a outra segue
    }
  }
  return resultados;
}

module.exports = { COL_LISTA, COL_ACOMP, montarUnidadeMes, montarTudo, carregarHistorico, completarContratos, unidadeDoBanco };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-renovacoes-montar.js`
Expected: `✅ smoke-renovacoes-montar: 4`

Se o bloco 1 falhar em `nucleo.consultas`: são 5 clientes sem caderninho (11, 12, 15, 16, 21) — o 16 não está em `NUCLEO`, devolve lista vazia e continua contando como consulta.

- [ ] **Step 5: Commit**

```bash
git add functions/renovacoes-montar.js scripts/smoke-renovacoes-montar.js
git commit -m "feat(renovacoes): montagem diária da lista, sem nunca tocar no que a consultora preencheu"
```

---

### Task 9: As Cloud Functions

**Files:**
- Modify: `functions/index.js` (acrescentar no fim do arquivo, depois de `exports.buscarPactoSombraManual`)
- Modify: `scripts/smoke-renovacoes-montar.js` (bloco de ligação)

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `scripts/smoke-renovacoes-montar.js`, antes do `console.log` final (dentro do `async`), e acrescentar `const fs = require('fs');` no topo:

```js
  /* 5. as Functions: 5h e botão só do admin, com as credenciais das unidades */
  {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    const ini = idx.indexOf('// LISTA DE RENOVAÇÕES');
    assert.ok(ini > 0, 'bloco da lista de renovações no index.js');
    const bloco = idx.slice(ini);
    assert.ok(/defineSecret\('PACTO_API_KEY_CP'\)/.test(bloco) && /defineSecret\('PACTO_API_KEY_PP'\)/.test(bloco));
    assert.ok(/exports\.montarListaRenovacoes\s*=\s*onSchedule\(\{[\s\S]*?schedule:\s*'0 5 \* \* \*'[\s\S]*?timeZone:\s*'America\/Sao_Paulo'/.test(bloco));
    assert.ok(/exports\.montarListaRenovacoesManual\s*=\s*onCall\(/.test(bloco));
    assert.ok(/callerProfiles\.includes\('admin'\)/.test(bloco.slice(bloco.indexOf('exports.montarListaRenovacoesManual'))), 'botão só do admin');
    assert.ok(/renovacoesMontar\.montarTudo\(/.test(bloco));
    ok('Functions: todo dia às 5h (São Paulo) e botão só do admin, com as credenciais das unidades no cofre');
  }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-renovacoes-montar.js`
Expected: FAIL no bloco 5 com `bloco da lista de renovações no index.js`

- [ ] **Step 3: Implementar**

Acrescentar no **fim** de `functions/index.js`:

```js

// ═══════════════════════════════════════════════════════════════════════
// LISTA DE RENOVAÇÕES (29/09/2026)
// ═══════════════════════════════════════════════════════════════════════
// Monta, todo dia às 5h (depois da busca das 4h), a lista de renovações de cada
// unidade a partir da Previsão de Renovação da Pacto. Lê com as credenciais POR
// UNIDADE (gateway) e completa os contratos pelo núcleo com a credencial antiga.
// Grava só `renovacoes_lista` e o caderninho `pacto_contratos`; o que a consultora
// preenche fica em `renovacoes_acompanhamento` e aqui é só lido.
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §3
const PACTO_API_KEY_CP = defineSecret('PACTO_API_KEY_CP');
const PACTO_API_KEY_PP = defineSecret('PACTO_API_KEY_PP');
const renovacoesMontar = require('./renovacoes-montar.js');
const pactoRenovacaoCliente = require('./pacto-renovacao-cliente.js');

async function rodarRenovacoes(unidades) {
  const clientesGw = {
    CP: pactoRenovacaoCliente.criarClienteRenovacao({ fetch, credencial: PACTO_API_KEY_CP.value() }),
    PP: pactoRenovacaoCliente.criarClienteRenovacao({ fetch, credencial: PACTO_API_KEY_PP.value() }),
  };
  const clienteNucleo = pactoCliente.criarCliente({ fetch, credencial: PACTO_API_KEY.value() });
  const resultados = await renovacoesMontar.montarTudo({
    db: db(), clientesGw, clienteNucleo, unidades, hoje: hojeSaoPaulo(),
    agora: () => admin.firestore.FieldValue.serverTimestamp(),
  });
  logger.info('lista de renovacoes', {
    resultados: resultados.map(r => r.id + ' ' + r.situacao + (r.consultas != null ? ' (' + r.consultas + ' consultas)' : '')),
  });
  return resultados;
}

exports.montarListaRenovacoes = onSchedule({
  schedule: '0 5 * * *',
  timeZone: 'America/Sao_Paulo',
  secrets: [PACTO_API_KEY, PACTO_API_KEY_CP, PACTO_API_KEY_PP],
  timeoutSeconds: 1800,   // 1ª montagem: ~150 clientes por unidade × 2 s de pausa no núcleo
  memory: '512MiB',
}, async () => {
  await rodarRenovacoes(['CP', 'PP']);
});

// Botão "Atualizar agora" — só admin.
exports.montarListaRenovacoesManual = onCall({
  secrets: [PACTO_API_KEY, PACTO_API_KEY_CP, PACTO_API_KEY_PP],
  timeoutSeconds: 1800,
  memory: '512MiB',
}, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'É preciso estar autenticado.');
  }
  const callerDoc = await db().collection('users').doc(request.auth.uid).get();
  const callerData = callerDoc.exists ? callerDoc.data() : {};
  const callerProfiles = callerData.profiles || (callerData.role ? [callerData.role] : []);
  if (!callerProfiles.includes('admin')) {
    throw new HttpsError('permission-denied', 'Apenas admin pode atualizar a lista de renovações.');
  }
  const data = request.data || {};
  const unidades = Array.isArray(data.unidades) && data.unidades.length
    ? data.unidades.filter(u => u === 'CP' || u === 'PP')
    : ['CP', 'PP'];
  const resultados = await rodarRenovacoes(unidades);
  return { resultados };
});
```

- [ ] **Step 4: Rodar e ver passar; conferir que o index carrega**

Run: `node scripts/smoke-renovacoes-montar.js`
Expected: `✅ smoke-renovacoes-montar: 5`

Run: `node --check functions/index.js && node -e "require('./functions/renovacoes-montar.js'); require('./functions/pacto-renovacao-cliente.js'); console.log('ok')"`
Expected: `ok` (sintaxe do index e os dois módulos novos carregam com os `require` deles)

- [ ] **Step 5: Commit**

```bash
git add functions/index.js scripts/smoke-renovacoes-montar.js
git commit -m "feat(renovacoes): Functions da lista — 5h e botão do admin"
```

---

### Task 10: Regras do Firestore

**Files:**
- Modify: `firestore.rules` (logo depois do bloco `match /pacto_termometro_equipe/{id} { … }`)
- Create: `scripts/validar-regras-renovacoes.js`

- [ ] **Step 1: Escrever as regras**

Inserir em `firestore.rules`, depois do fechamento de `match /pacto_termometro_equipe/{id}`:

```
    // ── Lista de renovações (29/09/2026) ──
    // A lista é montada pela Cloud Function (ninguém grava pelo navegador). A
    // consultora lê as unidades dela e grava SÓ os campos dela no acompanhamento,
    // que é por contrato (a virada de mês leva tudo). A gestão também atribui a
    // consultora e classifica o "Verificar manualmente". Nada de dinheiro aqui.
    // Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §3.6
    // `.get(campo, padrão)`: ler campo que não existe no cadastro dá ERRO na
    // regra (e nega), por isso nunca `u.allowedUnits` direto.
    function podeUnidade(sigla) {
      let u = uData();
      let s = sigla.lower();
      let lista = u.get('allowedUnits', []);
      let unica = u.get('unitId', '');
      return s in lista || ('unit-' + s) in lista || unica == s || unica == 'unit-' + s;
    }
    function camposMudados() {
      return resource == null ? request.resource.data.keys()
                              : request.resource.data.diff(resource.data).affectedKeys();
    }
    function camposDaConsultora() {
      return ['unidade', 'codigoContrato', 'planoAlvo', 'dataContato', 'renovou', 'planoFechado',
              'motivo', 'observacoes', 'semanas', 'atualizadoPor', 'atualizadoEm'];
    }
    match /renovacoes_lista/{id} {
      allow read:  if isAuth() && (isAdmin() || isSuperv() ||
                     (hasP('vendedor') && podeUnidade(resource.data.unidade)));
      allow write: if false;
    }
    match /renovacoes_acompanhamento/{docId} {
      allow read:  if isAuth() && (isAdmin() || isSuperv() ||
                     (hasP('vendedor') && podeUnidade(resource.data.unidade)));
      allow create, update: if isAuth() &&
        docId == request.resource.data.unidade + '_' + request.resource.data.codigoContrato &&
        (request.resource.data.unidade == 'CP' || request.resource.data.unidade == 'PP') && (
          ((isAdmin() || isSuperv()) &&
             camposMudados().hasOnly(camposDaConsultora().concat(['consultoraAtribuida', 'blocoGestao']))) ||
          (hasP('vendedor') && podeUnidade(request.resource.data.unidade) &&
             camposMudados().hasOnly(camposDaConsultora()))
        );
      allow delete: if false;
    }
```

- [ ] **Step 2: Escrever o validador por REST**

`scripts/validar-regras-renovacoes.js`:

```js
'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Prova, via REST autenticado, as regras da lista de renovações
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/validar-regras-renovacoes.js [--project staging]
//
// REST e não Admin SDK: o Admin SDK ignora as Security Rules. Login por TOKEN
// TEMPORÁRIO para usuários de fixture `zzfix-*`, apagados ao final.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if ((arg('--project') || 'staging') !== 'staging') { console.error('Este validador só roda no staging.'); process.exit(1); }
const PROJECT = 'crosstrainer-comissoes-staging';
const svcPath = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svcPath)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }
const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
if (!apiKey) { console.error('não achei a apiKey do staging'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(svcPath)), projectId: PROJECT });
const db = admin.firestore();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

let fails = 0, checks = 0;
function expect(desc, got, want) {
  const ok = got === want; checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
}
async function tokenDe(uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('token falhou: ' + ((j.error && j.error.message) || '?'));
  return j.idToken;
}
const status = r => (r.status === 403 ? 'NEGADO' : r.ok ? 'OK' : 'HTTP_' + r.status);
const ler = (tk, caminho) => fetch(`${BASE}/${caminho}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} }).then(status);
const campos = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { stringValue: String(v) }]));
// PATCH com updateMask = grava só esses campos (cria o doc se não existir)
const gravar = (tk, caminho, obj) => {
  const mask = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  return fetch(`${BASE}/${caminho}?${mask}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: campos(obj) }),
  }).then(status);
};
const apagar = (tk, caminho) => fetch(`${BASE}/${caminho}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tk}` } }).then(status);

async function usuarioComPerfil(perfil, semPerfil) {
  const snap = await db.collection('users').get();
  const d = snap.docs.find(x => {
    const u = x.data(); const p = u.profiles || (u.role ? [u.role] : []);
    return p.includes(perfil) && !(semPerfil || []).some(s => p.includes(s)) && u.status !== 'pendente';
  });
  return d ? d.id : null;
}

(async () => {
  console.log(`=== Regras da lista de renovações (${PROJECT}, REST autenticado) ===\n`);
  const LISTA = 'CP_zzfix-2026-10', A1 = 'CP_zzfix1', A2 = 'CP_zzfix2', A3 = 'PP_zzfix3';
  const SUP = 'zzfix-supervisao', VCP = 'zzfix-vendedora-cp', VPP = 'zzfix-vendedora-pp';
  await db.collection('renovacoes_lista').doc(LISTA).set({ _fixture: true, unidade: 'CP', mes: '2026-10' });
  try {
    await db.collection('users').doc(SUP).set({ _fixture: true, name: 'ZZ FIXTURE SUPERVISAO', profiles: ['supervisao'], status: 'ativo' });
    await db.collection('users').doc(VCP).set({ _fixture: true, name: 'ZZ FIXTURE CP', role: 'vendedor', profiles: ['vendedor'], allowedUnits: ['unit-cp'], unitId: 'unit-cp', status: 'ativo' });
    await db.collection('users').doc(VPP).set({ _fixture: true, name: 'ZZ FIXTURE PP', role: 'vendedor', profiles: ['vendedor'], allowedUnits: ['unit-pp'], unitId: 'unit-pp', status: 'ativo' });
    const uidAdmin = await usuarioComPerfil('admin');
    const uidProf = await usuarioComPerfil('professor', ['admin', 'supervisao']);
    if (!uidAdmin || !uidProf) throw new Error('faltou usuário de teste');
    const [tkAdmin, tkProf, tkSup, tkCP, tkPP] = await Promise.all([uidAdmin, uidProf, SUP, VCP, VPP].map(tokenDe));

    expect('admin lê a lista', await ler(tkAdmin, `renovacoes_lista/${LISTA}`), 'OK');
    expect('supervisão lê a lista', await ler(tkSup, `renovacoes_lista/${LISTA}`), 'OK');
    expect('vendedora do CP lê a lista do CP', await ler(tkCP, `renovacoes_lista/${LISTA}`), 'OK');
    expect('vendedora do PP NÃO lê a lista do CP', await ler(tkPP, `renovacoes_lista/${LISTA}`), 'NEGADO');
    expect('professor NÃO lê a lista', await ler(tkProf, `renovacoes_lista/${LISTA}`), 'NEGADO');
    expect('sem login NÃO lê a lista', await ler(null, `renovacoes_lista/${LISTA}`), 'NEGADO');
    expect('admin NÃO grava a lista pelo navegador', await gravar(tkAdmin, `renovacoes_lista/${LISTA}`, { unidade: 'CP', invasao: 'x' }), 'NEGADO');

    const dela = { unidade: 'CP', codigoContrato: 'zzfix1', renovou: 'negociacao', dataContato: '2026-10-01' };
    expect('vendedora do CP cria o acompanhamento', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, dela), 'OK');
    expect('vendedora do CP lê o acompanhamento', await ler(tkCP, `renovacoes_acompanhamento/${A1}`), 'OK');
    expect('vendedora do CP muda a situação', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', renovou: 'sim', planoFechado: 'ANUAL' }), 'OK');
    expect('vendedora NÃO atribui consultora', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', consultoraAtribuida: 'EU' }), 'NEGADO');
    expect('vendedora NÃO classifica o verificar', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', blocoGestao: 'excluir' }), 'NEGADO');
    expect('vendedora NÃO grava campo fora da lista', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', invasao: 'x' }), 'NEGADO');
    expect('vendedora do PP NÃO grava no CP', await gravar(tkPP, `renovacoes_acompanhamento/${A2}`, { unidade: 'CP', codigoContrato: 'zzfix2', renovou: 'sim' }), 'NEGADO');
    expect('vendedora do PP NÃO lê o acompanhamento do CP', await ler(tkPP, `renovacoes_acompanhamento/${A1}`), 'NEGADO');
    expect('id que não bate com unidade+contrato é recusado', await gravar(tkCP, `renovacoes_acompanhamento/${A2}`, { unidade: 'CP', codigoContrato: 'outro', renovou: 'sim' }), 'NEGADO');
    expect('unidade inventada é recusada', await gravar(tkAdmin, `renovacoes_acompanhamento/XX_zzfix9`, { unidade: 'XX', codigoContrato: 'zzfix9', renovou: 'sim' }), 'NEGADO');
    expect('supervisão atribui consultora', await gravar(tkSup, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', consultoraAtribuida: 'FRANCINI' }), 'OK');
    expect('admin classifica o verificar', await gravar(tkAdmin, `renovacoes_acompanhamento/${A2}`, { unidade: 'CP', codigoContrato: 'zzfix2', blocoGestao: 'renovacao' }), 'OK');
    expect('vendedora do PP grava no PP', await gravar(tkPP, `renovacoes_acompanhamento/${A3}`, { unidade: 'PP', codigoContrato: 'zzfix3', renovou: 'pendente' }), 'OK');
    expect('professor NÃO grava', await gravar(tkProf, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', renovou: 'nao' }), 'NEGADO');
    expect('ninguém apaga, nem admin', await apagar(tkAdmin, `renovacoes_acompanhamento/${A1}`), 'NEGADO');
    const depois = (await db.collection('renovacoes_acompanhamento').doc(A1).get()).data();
    expect('o que a vendedora não podia não entrou', depois.blocoGestao === undefined && depois.invasao === undefined, true);
  } finally {
    await db.collection('renovacoes_lista').doc(LISTA).delete();
    for (const a of [A1, A2, A3]) await db.collection('renovacoes_acompanhamento').doc(a).delete();
    for (const uid of [SUP, VCP, VPP]) {
      await db.collection('users').doc(uid).delete();
      await admin.auth().deleteUser(uid).catch(() => {});
    }
    console.log('\nfixture removida');
  }
  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
```

- [ ] **Step 3: Conferir que as regras das Comissões não perderam nada**

Run: `node scripts/validate-rules-comissoes.js`
Expected: todas as verificações passam (regra do projeto antes de qualquer deploy de regras — [[rules-comissoes-orfas]]).

- [ ] **Step 4: Publicar as regras SÓ no staging e validar**

Run: `firebase deploy --only firestore:rules --project staging`
Expected: `Deploy complete!`

Run: `node scripts/validar-regras-renovacoes.js --project staging`
Expected: `23/23 verificações passaram` e `fixture removida`

Run: `node scripts/validar-regras-pacto-sombra.js --project staging`
Expected: todas passam (as regras vizinhas continuam iguais).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules scripts/validar-regras-renovacoes.js
git commit -m "feat(renovacoes): regras — consultora grava só os campos dela, na unidade dela"
```

---

### Task 11: A tela — funções que desenham

**Files:**
- Create: `renovacoes.js`
- Create: `scripts/smoke-renovacoes-tela.js`

- [ ] **Step 1: Escrever o teste que falha**

`scripts/smoke-renovacoes-tela.js`:

```js
'use strict';
// Roda: node scripts/smoke-renovacoes-tela.js
//
// A tela da lista de renovações roda como <script> num sandbox (com o módulo
// puro carregado antes, como na página) e as funções que desenham são CHAMADAS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);
const lido = x => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const sandbox = { console: { log() {}, error() {}, warn() {} }, Intl, Date, JSON, Math, Number, String, RegExp, Set, Map };
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(raiz, 'renovacoes-lista.js'), 'utf8'), sandbox, { filename: 'renovacoes-lista.js' });
vm.runInContext(fs.readFileSync(path.join(raiz, 'renovacoes.js'), 'utf8'), sandbox, { filename: 'renovacoes.js' });
const T = sandbox.RenovacoesTela;
const RL = sandbox.RenovacoesLista;

const linha = o => ({ codigoContrato: '101', codigoCliente: '11', matricula: '5011', nome: 'ANA ANUAL', plano: 'ANUAL, ACESSO ILIMITADO',
  planoOriginal: null, economico: false, inicio: '2025-10-01', vencimento: '2026-10-09', consultora: 'KALI', consultoraOrigem: 'pacto',
  renovouSistema: false, notas: [], desde: '2026-10-01', origem: 'pacto', n: 1, ...o });
const LISTA = {
  unidade: 'CP', mes: '2026-10', situacao: 'ok', atualizadoEm: null,
  blocos: {
    renovacoes: [linha(), linha({ codigoContrato: '105', nome: 'EDU IMPORTADO', plano: 'IMPORTAÇÃO', planoOriginal: 'SEMESTRAL, TREINO LIVRE', consultora: 'BARBARA', vencimento: '2026-10-20', n: 2 }),
      linha({ codigoContrato: '109', nome: 'HELO ECONOMICO', economico: true, consultora: null, matricula: null, vencimento: '2026-10-25', n: 3 })],
    antecipacao: [linha({ codigoContrato: '201', nome: 'IVO ANTECIPA', vencimento: '2026-11-10', n: 4 })],
    degustacoes: [linha({ codigoContrato: '104', nome: 'DORA DEGUSTA', plano: 'MÊS DEGUSTAÇÃO LIVRE', inicio: '2026-09-20', vencimento: '2026-10-20', n: 1 })],
    verificar: [linha({ codigoContrato: '106', nome: 'FABI SEMDADOS', motivoVerificar: 'A Pacto não devolveu os dados deste contrato', n: null })],
  },
  excluidos: { recorrente: 3, duplicado: 1 },
  conferencia: { totalPacto: 10, naLista: 6, excluidos: 4, bate: true, diferenca: 0 },
  planosRecentes: ['ANUAL, ACESSO ILIMITADO', 'SEMESTRAL, TREINO LIVRE'],
  consultoras: ['BARBARA', 'KALI'],
  metas: null,
};
const H = '2026-10-05';

/* 1. a página carrega o que precisa, na ordem, com o mesmo ?v= */
{
  const html = fs.readFileSync(path.join(raiz, 'renovacoes.html'), 'utf8');
  const nossos = [...html.matchAll(/<script src="([a-z0-9-]+\.js)\?v=(\d{8})"><\/script>/g)].map(m => ({ f: m[1], v: m[2] }));
  assert.deepStrictEqual(nossos.map(x => x.f), ['firebase-config.js', 'renovacoes-lista.js', 'renovacoes.js']);
  assert.ok(nossos.every(x => x.v === nossos[0].v), 'todos com o mesmo ?v=');
  assert.ok(/firebase-functions-compat\.js/.test(html) && /firebase-firestore-compat\.js/.test(html) && /firebase-auth-compat\.js/.test(html));
  assert.ok(/<meta name="viewport"/.test(html), 'celular');
  assert.ok(/CrossTainer/.test(html) && !/CrossTrainer/.test(html), 'marca certa');
  ok('renovacoes.html: firebase-config, módulo e tela com o mesmo ?v=, SDK de functions, marca CrossTainer');
}

/* 2. quem entra e quais unidades vê */
{
  assert.ok(T && typeof T.painelHtml === 'function' && typeof T.blocoHtml === 'function' && typeof T.formHtml === 'function');
  assert.strictEqual(T.perfilDe({ profiles: ['admin'] }), 'gestao');
  assert.strictEqual(T.perfilDe({ profiles: ['supervisao'] }), 'gestao');
  assert.strictEqual(T.perfilDe({ role: 'vendedor', profiles: ['vendedor'] }), 'equipe');
  assert.strictEqual(T.perfilDe({ profiles: ['professor'] }), null);
  assert.deepStrictEqual([...T.unidadesDe({ profiles: ['admin'] }, 'gestao')], ['CP', 'PP']);
  assert.deepStrictEqual([...T.unidadesDe({ allowedUnits: ['unit-cp'] }, 'equipe')], ['CP']);
  assert.deepStrictEqual([...T.unidadesDe({ allowedUnits: ['pp'] }, 'equipe')], ['PP'], 'id de produção');
  assert.deepStrictEqual([...T.unidadesDe({ unitId: 'unit-pp' }, 'equipe')], ['PP'], 'cadastro antigo com unitId');
  ok('gestão (admin, supervisão) e equipe (vendedora); a vendedora só vê as unidades dela');
}

/* 3. blocos: o que a consultora vê em cada linha */
{
  const b = T.blocoHtml(T.BLOCOS[0], LISTA.blocos.renovacoes, {}, { hoje: H });
  const t = lido(b);
  assert.ok(/Renovações do mês \(3\)/.test(t), t.slice(0, 80));
  assert.ok(t.includes('IMPORTAÇÃO → SEMESTRAL, TREINO LIVRE'));
  assert.ok(t.includes('Sem desconto de renovação'));
  assert.ok(t.includes('Sem consultora'));
  assert.ok(t.includes('09/10/2026'), 'datas no formato brasileiro');
  assert.ok(t.includes('Vence em 4 dia(s) e ainda não houve contato'), 'o alerta aparece');
  assert.ok(t.includes('cód. 11') || t.includes('5011'), 'matrícula (ou o código do cliente)');
  const soMinhas = lido(T.blocoHtml(T.BLOCOS[0], LISTA.blocos.renovacoes, {}, { hoje: H, soMinhas: true, meuNome: 'kali' }));
  assert.ok(/\(1\)/.test(soMinhas) && soMinhas.includes('ANA ANUAL') && !soMinhas.includes('EDU IMPORTADO'), 'filtro "só as minhas"');
  const deg = lido(T.blocoHtml(T.BLOCOS[2], LISTA.blocos.degustacoes, {}, { hoje: H }));
  assert.ok(deg.includes('Converteu?') && deg.includes('Sem acompanhamento registrado nesta semana'));
  const html = T.blocoHtml(T.BLOCOS[0], [linha({ nome: '<img src=x onerror=alert(1)>' })], {}, { hoje: H });
  assert.ok(!html.includes('<img'), 'nome de aluno é escapado');
  ok('blocos: importação, Econômico, sem consultora, datas, alertas, "só as minhas", degustação, escape');
}

/* 4. painel: a gestão vê a conferência e as exclusões; a consultora não */
{
  const g = lido(T.painelHtml(LISTA, {}, 'CP', 'gestao', H));
  assert.ok(g.includes('Total a renovar no mês') && g.includes('3'));
  assert.ok(g.includes('Conferência com a Pacto') && g.includes('Recorrente (renova sozinho)') && g.includes('Aluno repetido na Previsão'));
  assert.ok(g.includes('Meta do mês ainda não definida'), 'nunca inventa meta');
  const e = lido(T.painelHtml(LISTA, {}, 'CP', 'equipe', H));
  assert.ok(e.includes('Total a renovar no mês'));
  assert.ok(!e.includes('Conferência com a Pacto') && !e.includes('Recorrente (renova sozinho)'), 'a consultora não vê a conferência nem as exclusões');
  const comMeta = lido(T.painelHtml({ ...LISTA, metas: { meta: 55, superMeta: 63, metaGold: 72, minNovos: 19, minRenov: 16, minVoucher: 5 } }, {}, 'CP', 'equipe', H));
  assert.ok(comMeta.includes('55 · 63 · 72') && comMeta.includes('16'));
  const falhou = lido(T.painelHtml({ ...LISTA, ultimaFalha: { situacao: 'falhou', motivo: 'HTTP 500' } }, {}, 'CP', 'gestao', H));
  assert.ok(falhou.includes('A última atualização falhou'));
  assert.ok(lido(T.painelHtml(null, {}, 'PP', 'equipe', H)).includes('ainda não foi montada'));
  const naoBate = lido(T.painelHtml({ ...LISTA, conferencia: { totalPacto: 11, naLista: 6, excluidos: 4, bate: false, diferenca: 1 } }, {}, 'CP', 'gestao', H));
  assert.ok(naoBate.includes('não bate') && naoBate.includes('1'));
  ok('painel: números, metas (sem inventar), falha visível; conferência e exclusões só para a gestão');
}

/* 5. o formulário: campos da consultora; gestão também atribui e classifica */
{
  const f = T.formHtml(LISTA.blocos.renovacoes[0], { renovou: 'nao', motivo: 'Lesão ou saúde' }, 'renovacoes', LISTA, 'equipe', H);
  assert.ok(f.includes('name="renovou"') && f.includes('name="dataContato"') && f.includes('name="planoAlvo"') && f.includes('name="planoFechado"')
    && f.includes('name="motivo"') && f.includes('name="observacoes"'));
  assert.ok(f.includes('max="2026-10-05"'), 'data não pode ser no futuro');
  assert.ok(RL.MOTIVOS_NAO_RENOVOU.every(m => f.includes(m)), 'os 10 motivos');
  assert.ok(/<option value="Lesão ou saúde" selected>/.test(f), 'mostra o que já foi preenchido');
  assert.ok(f.includes('SEMESTRAL, TREINO LIVRE'), 'planos recentes na lista suspensa');
  assert.ok(!f.includes('name="consultoraAtribuida"') && !f.includes('name="blocoGestao"'), 'a consultora não atribui nem classifica');
  const fd = T.formHtml(LISTA.blocos.degustacoes[0], null, 'degustacoes', LISTA, 'equipe', H);
  assert.ok((fd.match(/name="semana\d"/g) || []).length === 4 && fd.includes('Converteu?'));
  const fg = T.formHtml(LISTA.blocos.verificar[0], null, 'verificar', LISTA, 'gestao', H);
  assert.ok(fg.includes('name="consultoraAtribuida"') && fg.includes('name="blocoGestao"'));
  const fg2 = T.formHtml(LISTA.blocos.renovacoes[0], null, 'renovacoes', LISTA, 'gestao', H);
  assert.ok(fg2.includes('name="consultoraAtribuida"') && !fg2.includes('name="blocoGestao"'), 'classificar só no verificar');
  ok('formulário: campos da consultora, 10 motivos, planos recentes, 4 semanas na degustação; gestão atribui e classifica');
}

console.log('\n✅ smoke-renovacoes-tela: ' + n);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-renovacoes-tela.js`
Expected: FAIL com `ENOENT ... renovacoes.js`

- [ ] **Step 3: Implementar as funções que desenham**

`renovacoes.js` (a parte da página entra na tarefa 12, no lugar marcado):

```js
// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Lista de renovações: a página
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §3
//
// Nenhuma conta mora aqui: a lista vem pronta da Cloud Function
// (`renovacoes_lista`) e a situação, os alertas e o painel saem do módulo puro
// `renovacoes-lista.js`. A página só desenha e grava o que a consultora
// preenche em `renovacoes_acompanhamento` (por contrato).
//
// As funções que desenham ficam em `window.RenovacoesTela` para o smoke chamá-las.

(function () {
  'use strict';

  const RL = window.RenovacoesLista;
  const NOMES = { CP: 'Campeche', PP: 'Pequeno Príncipe' };
  const BLOCOS = [
    { id: 'renovacoes', titulo: 'Renovações do mês', situacao: 'Renovou?', soGestao: false },
    { id: 'antecipacao', titulo: 'Antecipação de renovação (até dia 15)', situacao: 'Renovou?', soGestao: false },
    { id: 'degustacoes', titulo: 'Vouchers — Mês Degustação', situacao: 'Converteu?', soGestao: false },
    { id: 'verificar', titulo: 'Verificar manualmente (só a gestão vê)', situacao: 'Situação', soGestao: true },
  ];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataBR = iso => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—');

  function hojeSP() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  }

  /** 'gestao' (admin, supervisão) · 'equipe' (vendedora) · null — as mesmas portas das regras. */
  function perfilDe(u) {
    if (!u) return null;
    const perfis = [].concat(u.profiles || [], u.role ? [u.role] : []);
    if (perfis.indexOf('admin') >= 0 || perfis.indexOf('supervisao') >= 0) return 'gestao';
    if (perfis.indexOf('vendedor') >= 0) return 'equipe';
    return null;
  }

  /** Unidades que a pessoa vê: a gestão, as duas; a vendedora, as do cadastro dela. */
  function unidadesDe(u, perfil) {
    if (perfil === 'gestao') return ['CP', 'PP'];
    const ids = [].concat((u && u.allowedUnits) || [], u && u.unitId ? [u.unitId] : []);
    return ['CP', 'PP'].filter(s => ids.some(x => String(x).toUpperCase().replace(/[^A-Z]/g, '').endsWith(s)));
  }

  function alertasHtml(als) {
    return als.map(a => `<div class="alerta ${a.nivel}">${a.nivel === 'vermelho' ? '🔴' : '🟠'} ${esc(a.texto)}</div>`).join('');
  }

  function linhaHtml(l, acomp, bloco, hoje) {
    const s = RL.statusEfetivo(l, acomp);
    const plano = l.planoOriginal ? `IMPORTAÇÃO → ${esc(l.planoOriginal)}` : esc(l.plano);
    const consultora = RL.consultoraDaLinha(l, acomp) || 'Sem consultora';
    const ident = l.matricula ? esc(l.matricula) : 'cód. ' + esc(l.codigoCliente || l.codigoContrato);
    return `<tr data-contrato="${esc(l.codigoContrato)}" data-bloco="${esc(bloco)}" tabindex="0">
      <td class="n">${l.n == null ? '' : esc(l.n)}</td>
      <td>${esc(consultora)}</td>
      <td><b>${esc(l.nome)}</b><div class="muted pequeno">${ident}</div></td>
      <td>${plano}${l.economico ? ' <span class="etiqueta">Sem desconto de renovação</span>' : ''}${bloco === 'verificar' ? `<div class="erro pequeno">${esc(l.motivoVerificar)}</div>` : ''}</td>
      <td>${dataBR(l.inicio)}</td>
      <td>${dataBR(l.vencimento)}</td>
      <td><span class="status ${esc(s)}">${esc(RL.STATUS[s])}</span>${l.renovouSistema ? '<div class="muted pequeno">pela Pacto</div>' : ''}</td>
      <td>${alertasHtml(RL.alertas(l, acomp, bloco, hoje))}${(l.notas || []).map(t => `<div class="muted pequeno">${esc(t)}</div>`).join('')}</td>
    </tr>`;
  }

  function blocoHtml(def, linhas, acomps, opcoes) {
    const o = opcoes || {};
    const ac = acomps || {};
    let ls = linhas || [];
    if (o.soMinhas && o.meuNome) ls = ls.filter(l => RL.norm(RL.consultoraDaLinha(l, ac[l.codigoContrato])) === RL.norm(o.meuNome));
    const corpo = ls.length
      ? `<div class="tabela"><table><thead><tr><th>Nº</th><th>Consultora</th><th>Aluno</th><th>Contrato atual</th><th>Início</th><th>Vencimento</th><th>${esc(def.situacao)}</th><th>Avisos</th></tr></thead>
         <tbody>${ls.map(l => linhaHtml(l, ac[l.codigoContrato], def.id, o.hoje)).join('')}</tbody></table></div>`
      : '<p class="muted">Nenhum contrato neste bloco.</p>';
    return `<section class="card"><h2>${esc(def.titulo)} <span class="muted">(${ls.length})</span></h2>${corpo}</section>`;
  }

  function metasHtml(m) {
    if (!m) return '<p class="muted">Meta do mês ainda não definida pela gestão.</p>';
    return `<div class="kv">
      <span>Meta · Super · Gold</span><span>${esc(m.meta)} · ${esc(m.superMeta)} · ${esc(m.metaGold)}</span>
      <span>Mínimo de novos + retorno</span><span>${esc(m.minNovos)}</span>
      <span>Mínimo de renovações</span><span>${esc(m.minRenov)}</span>
      <span>Mínimo de vouchers</span><span>${esc(m.minVoucher)}</span>
    </div>`;
  }

  function conferenciaHtml(lista) {
    const c = lista.conferencia || {};
    const excl = Object.entries(lista.excluidos || {}).sort((a, b) => b[1] - a[1])
      .map(([m, q]) => `<span>${esc(RL.rotuloExclusao(m))}</span><span>${esc(q)}</span>`).join('');
    return `<details class="card"><summary><b>Conferência com a Pacto</b> — ${c.bate
      ? '<span class="ok">bate</span>'
      : `<span class="erro-txt">não bate: ${esc(c.diferenca)} registro(s) sem destino</span>`}</summary>
      <div class="kv">
        <span>Total na Previsão da Pacto (mês + 1 a 15 do seguinte)</span><span>${esc(c.totalPacto)}</span>
        <span>Na lista (blocos 1 a 4)</span><span>${esc(c.naLista)}</span>
        <span>Excluídos</span><span>${esc(c.excluidos)}</span>
      </div>
      <h3>Excluídos por motivo</h3><div class="kv">${excl || '<span class="muted">nenhum</span><span></span>'}</div>
    </details>`;
  }

  function painelHtml(lista, acomps, unidade, perfil, hoje) {
    if (!lista) return `<section class="card"><h2>${esc(NOMES[unidade])}</h2><p class="muted">A lista deste mês ainda não foi montada.</p></section>`;
    if (lista.situacao !== 'ok') {
      return `<section class="card"><h2>${esc(NOMES[unidade])}</h2><div class="erro">Não foi possível montar a lista: ${esc(lista.motivo || lista.situacao)}</div></section>`;
    }
    const p = RL.painel(lista, acomps, hoje);
    const b = p.porBloco;
    const pct = v => (v == null ? '—' : String(v).replace('.', ',') + '%');
    const consultoras = Object.entries(p.porConsultora).sort((x, y) => y[1].total - x[1].total)
      .map(([nome, x]) => `<span>${esc(nome)}</span><span>${esc(x.renovados)} de ${esc(x.total)}</span>`).join('');
    return `<section class="card">
      <h2>${esc(NOMES[unidade])}</h2>
      ${lista.ultimaFalha ? `<div class="aviso">A última atualização falhou (${esc(lista.ultimaFalha.motivo || lista.ultimaFalha.situacao)}). Mostrando a lista anterior.</div>` : ''}
      <div class="numeros">
        <div><div class="num">${esc(p.totalARenovar)}</div><div class="muted">Total a renovar no mês</div></div>
        <div><div class="num">${esc(b.antecipacao.total)}</div><div class="muted">Antecipação</div></div>
        <div><div class="num">${esc(b.degustacoes.total)}</div><div class="muted">Degustações</div></div>
        <div><div class="num">${pct(p.taxaRenovacao)}</div><div class="muted">Taxa de renovação</div></div>
        <div><div class="num">${pct(p.conversaoDegustacao)}</div><div class="muted">Conversão de degustação</div></div>
      </div>
      <div class="kv">
        <span>Renovados · não renovados · em negociação · pendentes</span>
        <span>${esc(b.renovacoes.sim)} · ${esc(b.renovacoes.nao)} · ${esc(b.renovacoes.negociacao)} · ${esc(b.renovacoes.pendente)}</span>
        <span>Alertas</span><span>🔴 ${esc(p.alertas.vermelho)} · 🟠 ${esc(p.alertas.laranja)}</span>
      </div>
      <h3>Por consultora (renovados de total)</h3><div class="kv">${consultoras}</div>
      <h3>Metas do mês</h3>${metasHtml(lista.metas)}
    </section>${perfil === 'gestao' ? conferenciaHtml(lista) : ''}`;
  }

  function opcoes(lista, atual) {
    const vals = [''].concat(lista || []);
    if (atual && vals.indexOf(atual) < 0) vals.push(atual);
    return vals.map(v => `<option value="${esc(v)}"${v === (atual || '') ? ' selected' : ''}>${esc(v || '—')}</option>`).join('');
  }

  /** Formulário da linha. `lista` dá os planos recentes e as consultoras conhecidas. */
  function formHtml(l, acomp, bloco, lista, perfil, hoje) {
    const a = acomp || {};
    const deg = bloco === 'degustacoes';
    const status = Object.entries(RL.STATUS).map(([k, v]) => `<option value="${k}"${(a.renovou || 'pendente') === k ? ' selected' : ''}>${esc(v)}</option>`).join('');
    const semanas = deg ? `<fieldset><legend>Acompanhamento semanal (data da mensagem)</legend>${[0, 1, 2, 3].map(i =>
      `<label>Semana ${i + 1} <input type="date" name="semana${i}" max="${esc(hoje)}" value="${esc((a.semanas || [])[i] || '')}"></label>`).join('')}</fieldset>` : '';
    const gestao = perfil === 'gestao'
      ? `<label>Consultora responsável <input name="consultoraAtribuida" list="consultorasConhecidas" value="${esc(a.consultoraAtribuida || '')}" placeholder="${esc(l.consultora || 'Sem consultora')}"></label>
         <datalist id="consultorasConhecidas">${((lista && lista.consultoras) || []).map(c => `<option value="${esc(c)}">`).join('')}</datalist>
         ${bloco === 'verificar' ? `<label>Classificar como <select name="blocoGestao">${opcoes(['renovacao', 'degustacao', 'excluir'], a.blocoGestao)}</select>
           <span class="muted pequeno">renovacao · degustacao · excluir — vale a partir da próxima atualização (5h ou "Atualizar agora").</span></label>` : ''}`
      : '';
    return `<form class="editor" data-contrato="${esc(l.codigoContrato)}" data-bloco="${esc(bloco)}">
      <h3>${esc(l.nome)}</h3>
      <p class="muted">${esc(l.planoOriginal ? 'IMPORTAÇÃO → ' + l.planoOriginal : l.plano)} · vence ${dataBR(l.vencimento)}</p>
      <label>${deg ? 'Plano alvo (conversão)' : 'Plano alvo (renovação)'} <select name="planoAlvo">${opcoes(lista && lista.planosRecentes, a.planoAlvo)}</select></label>
      <label>Data do 1º contato <input type="date" name="dataContato" max="${esc(hoje)}" value="${esc(a.dataContato || '')}"></label>
      ${semanas}
      <label>${deg ? 'Converteu?' : 'Renovou?'} <select name="renovou">${status}</select></label>
      <label>Plano fechado <select name="planoFechado">${opcoes(lista && lista.planosRecentes, a.planoFechado)}</select></label>
      <label>Motivo (se não ${deg ? 'converteu' : 'renovou'}) <select name="motivo">${opcoes(RL.MOTIVOS_NAO_RENOVOU, a.motivo)}</select></label>
      <label>Observações <textarea name="observacoes" rows="3">${esc(a.observacoes || '')}</textarea></label>
      ${gestao}
      <div class="erro" data-erros hidden></div>
      <div class="acoes"><button type="submit">Salvar</button><button type="button" class="sec" data-cancelar>Cancelar</button></div>
    </form>`;
  }

  window.RenovacoesTela = { BLOCOS, NOMES, perfilDe, unidadesDe, linhaHtml, blocoHtml, painelHtml, formHtml, metasHtml, hojeSP };

  // ─── A página (tarefa 12) ───
})();
```

- [ ] **Step 4: Criar uma `renovacoes.html` mínima para o bloco 1 do teste passar**

A página completa vem na tarefa 12; aqui basta o esqueleto com os scripts:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Renovações — CrossTainer</title>
  <meta name="robots" content="noindex">
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-functions-compat.js"></script>
</head>
<body>
  <main id="app" hidden></main>
  <script src="firebase-config.js?v=20260930"></script>
  <script src="renovacoes-lista.js?v=20260930"></script>
  <script src="renovacoes.js?v=20260930"></script>
</body>
</html>
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-renovacoes-tela.js`
Expected: `✅ smoke-renovacoes-tela: 5`

- [ ] **Step 6: Commit**

```bash
git add renovacoes.js renovacoes.html scripts/smoke-renovacoes-tela.js
git commit -m "feat(renovacoes): funções que desenham a lista, o painel e o formulário"
```

---

### Task 12: A tela — a página de verdade

**Files:**
- Modify: `renovacoes.html` (substituir pelo conteúdo completo)
- Modify: `renovacoes.js` (substituir a linha `// ─── A página (tarefa 12) ───`)

- [ ] **Step 1: A página completa**

Substituir `renovacoes.html` inteiro por:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Renovações — CrossTainer</title>
  <meta name="robots" content="noindex">

  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-functions-compat.js"></script>

  <style>
    /* Tokens do termometro.html — nenhuma variável inventada */
    :root {
      --bg: #0a0a0a; --surface: #131315; --surface2: #1a1a1e; --surface3: #222226;
      --border: #2a2a30; --border2: #353538;
      --text: #eee9e0; --text2: #908a82; --text3: #5a5650;
      --orange: #E8920D; --orange-dim: rgba(232, 146, 13, 0.08);
      --green: #5cb85c; --green-bg: rgba(92, 184, 92, 0.08);
      --red: #e05a3a; --red-bg: rgba(224, 90, 58, 0.06);
      --yellow: #FDD835; --yellow-bg: rgba(253, 216, 53, 0.08);
      --radius: 8px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.45; }
    header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); background: var(--surface); }
    header h1 { font-size: 16px; font-weight: 700; }
    header .sub { color: var(--text2); font-size: 12px; }
    header .esp { flex: 1; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--border2); color: var(--text2); }
    .badge.staging { color: var(--yellow); border-color: var(--yellow); background: var(--yellow-bg); }
    .badge.production { color: var(--red); border-color: var(--red); background: var(--red-bg); }
    main { max-width: 1200px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; display: grid; gap: 10px; align-content: start; }
    .card h2 { font-size: 15px; }
    .card h3 { font-size: 13px; color: var(--text2); margin-top: 4px; }
    .muted { color: var(--text2); font-size: 12.5px; }
    .pequeno { font-size: 11.5px; }
    .aviso { background: var(--yellow-bg); border: 1px solid var(--yellow); border-radius: var(--radius); padding: 8px 10px; font-size: 12.5px; }
    .erro { background: var(--red-bg); border: 1px solid var(--red); border-radius: var(--radius); padding: 8px 10px; font-size: 12.5px; }
    .ok { color: var(--green); } .erro-txt { color: var(--red); }
    .barra-topo { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    input, select, textarea { background: var(--surface2); color: var(--text); border: 1px solid var(--border2); border-radius: 6px; padding: 7px 9px; font-size: 13px; font-family: inherit; }
    button { background: var(--orange); color: #111; border: 0; border-radius: 6px; padding: 8px 14px; font-weight: 600; cursor: pointer; font-size: 13px; }
    button.sec { background: var(--surface3); color: var(--text); border: 1px solid var(--border2); }
    button.aba[aria-pressed="true"] { outline: 2px solid var(--orange); }
    .numeros { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
    .num { font-size: 28px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
    .kv { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; font-size: 13px; }
    .kv span:nth-child(even) { text-align: right; font-variant-numeric: tabular-nums; }
    .tabela { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--text2); font-weight: 600; white-space: nowrap; }
    tbody tr { cursor: pointer; } tbody tr:hover, tbody tr:focus { background: var(--surface2); outline: none; }
    td.n { color: var(--text2); font-variant-numeric: tabular-nums; }
    .status { font-size: 11.5px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--border2); white-space: nowrap; }
    .status.sim { color: var(--green); border-color: var(--green); }
    .status.nao { color: var(--red); border-color: var(--red); }
    .status.negociacao { color: var(--yellow); border-color: var(--yellow); }
    .etiqueta { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: var(--orange-dim); color: var(--orange); white-space: nowrap; }
    .alerta { font-size: 11.5px; } .alerta.vermelho { color: var(--red); } .alerta.laranja { color: var(--orange); }
    #fundo { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; padding: 16px; z-index: 10; }
    .editor { background: var(--surface); border: 1px solid var(--border2); border-radius: var(--radius); padding: 16px; display: grid; gap: 10px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; }
    .editor fieldset { border: 1px solid var(--border); border-radius: 6px; padding: 8px; display: grid; gap: 6px; }
    .acoes { display: flex; gap: 8px; justify-content: flex-end; }
    .login { max-width: 360px; margin: 60px auto; }
    label { display: grid; gap: 4px; font-size: 12px; color: var(--text2); }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Renovações</h1>
      <div class="sub">Lista do mês da CrossTainer, montada toda madrugada pela Previsão de Renovação da Pacto.</div>
    </div>
    <div class="esp"></div>
    <a href="index.html" class="muted" style="text-decoration:none">← Comissões</a>
    <span id="ambiente" class="badge"></span>
    <span id="usuario" class="muted"></span>
    <button id="sair" class="sec" hidden>Sair</button>
  </header>

  <section id="telaLogin" class="card login" hidden>
    <h2>Entrar</h2>
    <label>E-mail <input id="loginEmail" type="email" autocomplete="username"></label>
    <label>Senha <input id="loginSenha" type="password" autocomplete="current-password"></label>
    <button id="entrar">Entrar</button>
    <div id="loginErro" class="erro" hidden></div>
  </section>

  <section id="telaRestrita" class="card login" hidden>
    <h2>Acesso restrito</h2>
    <p class="muted">Esta tela é da gestão e das consultoras de vendas.</p>
  </section>

  <main id="app" hidden>
    <div class="barra-topo">
      <span id="abas"></span>
      <button id="anterior" class="sec" aria-label="Mês anterior">◀</button>
      <input id="mes" type="month" aria-label="Mês">
      <button id="seguinte" class="sec" aria-label="Mês seguinte">▶</button>
      <label style="display:flex;gap:6px;align-items:center"><input id="soMinhas" type="checkbox"> só as minhas</label>
      <button id="atualizar" class="sec" hidden>Atualizar agora</button>
      <span id="atualizadoEm" class="muted"></span>
    </div>
    <div id="conteudo"></div>
  </main>

  <div id="fundo" hidden></div>

  <script src="firebase-config.js?v=20260930"></script>
  <script src="renovacoes-lista.js?v=20260930"></script>
  <script src="renovacoes.js?v=20260930"></script>
</body>
</html>
```

- [ ] **Step 2: O código da página**

Em `renovacoes.js`, substituir a linha `  // ─── A página (tarefa 12) ───` por:

```js
  // ─── A página ───
  if (typeof document === 'undefined' || !document.getElementById || !document.getElementById('app')) return;

  const $ = id => document.getElementById(id);
  const estado = { user: null, perfil: null, meuNome: '', unidades: [], unidade: null, lista: null, acomps: {} };

  function mostrar(qual) {
    ['telaLogin', 'telaRestrita', 'app'].forEach(id => { $(id).hidden = id !== qual; });
  }

  function quando(ts) {
    if (!ts) return '';
    const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return '';
    return 'atualizada em ' + new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      .format(d).replace(',', ' às');
  }

  function desenharAbas() {
    $('abas').innerHTML = estado.unidades.map(u =>
      `<button class="sec aba" data-unidade="${u}" aria-pressed="${u === estado.unidade}">${esc(NOMES[u])}</button>`).join(' ');
    $('abas').querySelectorAll('button').forEach(b => { b.onclick = () => { estado.unidade = b.dataset.unidade; desenharAbas(); carregar(); }; });
  }

  function desenhar() {
    const hoje = hojeSP();
    const l = estado.lista;
    const opc = { hoje, soMinhas: $('soMinhas').checked, meuNome: estado.meuNome };
    let html = painelHtml(l, estado.acomps, estado.unidade, estado.perfil, hoje);
    if (l && l.situacao === 'ok') {
      BLOCOS.filter(b => !b.soGestao || estado.perfil === 'gestao')
        .forEach(b => { html += blocoHtml(b, l.blocos[b.id], estado.acomps, opc); });
    }
    $('conteudo').innerHTML = html;
    $('atualizadoEm').textContent = l ? quando(l.atualizadoEm) : '';
    $('conteudo').querySelectorAll('tbody tr').forEach(tr => {
      const abrir = () => abrirEditor(tr.dataset.contrato, tr.dataset.bloco);
      tr.onclick = abrir;
      tr.onkeydown = e => { if (e.key === 'Enter') abrir(); };
    });
  }

  async function carregar() {
    const mes = $('mes').value;
    $('conteudo').innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const fs = firebase.firestore();
      const [snap, acs] = await Promise.all([
        fs.collection('renovacoes_lista').doc(estado.unidade + '_' + mes).get(),
        fs.collection('renovacoes_acompanhamento').where('unidade', '==', estado.unidade).get(),
      ]);
      estado.lista = snap.exists ? snap.data() : null;
      estado.acomps = {};
      acs.forEach(d => { const x = d.data(); estado.acomps[String(x.codigoContrato)] = x; });
      desenhar();
    } catch (err) {
      $('conteudo').innerHTML = `<div class="erro">Não foi possível carregar: ${esc(err.message)}</div>`;
    }
  }

  function linhaDa(codigo, bloco) {
    return ((estado.lista && estado.lista.blocos[bloco]) || []).find(l => l.codigoContrato === codigo);
  }

  function fecharEditor() { $('fundo').hidden = true; $('fundo').innerHTML = ''; }

  function abrirEditor(codigo, bloco) {
    const l = linhaDa(codigo, bloco);
    if (!l) return;
    const hoje = hojeSP();
    $('fundo').innerHTML = formHtml(l, estado.acomps[codigo], bloco, estado.lista, estado.perfil, hoje);
    $('fundo').hidden = false;
    const form = $('fundo').querySelector('form');
    form.querySelector('[data-cancelar]').onclick = fecharEditor;
    $('fundo').onclick = e => { if (e.target === $('fundo')) fecharEditor(); };
    form.onsubmit = async e => {
      e.preventDefault();
      const v = nome => { const el = form.elements[nome]; return el ? String(el.value || '').trim() : undefined; };
      const dados = {
        planoAlvo: v('planoAlvo') || '',
        dataContato: v('dataContato') || '',
        renovou: v('renovou') || 'pendente',
        planoFechado: v('planoFechado') || '',
        motivo: v('motivo') || '',
        observacoes: v('observacoes') || '',
      };
      if (bloco === 'degustacoes') dados.semanas = [0, 1, 2, 3].map(i => v('semana' + i) || '');
      if (estado.perfil === 'gestao') {
        dados.consultoraAtribuida = v('consultoraAtribuida') || '';
        if (bloco === 'verificar') dados.blocoGestao = v('blocoGestao') || '';
      }
      const erros = RL.validar(dados, hoje);
      const caixa = form.querySelector('[data-erros]');
      if (erros.length) { caixa.innerHTML = erros.map(esc).join('<br>'); caixa.hidden = false; return; }
      try {
        await firebase.firestore().collection('renovacoes_acompanhamento').doc(estado.unidade + '_' + codigo).set({
          unidade: estado.unidade, codigoContrato: codigo, ...dados,
          atualizadoPor: estado.user.email || estado.user.uid,
          atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        fecharEditor();
        carregar();
      } catch (err) {
        caixa.textContent = 'Não foi possível salvar: ' + err.message;
        caixa.hidden = false;
      }
    };
  }

  function mudarMes(delta) {
    const [a, m] = $('mes').value.split('-').map(Number);
    $('mes').value = new Date(Date.UTC(a, m - 1 + delta, 1)).toISOString().slice(0, 7);
    carregar();
  }

  function iniciar() {
    const env = window.FIREBASE_ENV || 'staging';
    $('ambiente').textContent = env === 'production' ? 'PRODUÇÃO' : 'STAGING';
    $('ambiente').className = 'badge ' + env;
    $('mes').value = hojeSP().slice(0, 7);
    $('mes').onchange = carregar;
    $('anterior').onclick = () => mudarMes(-1);
    $('seguinte').onclick = () => mudarMes(1);
    $('soMinhas').onchange = desenhar;
    $('atualizar').onclick = async () => {
      $('atualizar').disabled = true;
      $('atualizadoEm').textContent = 'Atualizando pela Pacto… (pode levar alguns minutos)';
      try {
        await firebase.functions().httpsCallable('montarListaRenovacoesManual', { timeout: 1800000 })({ unidades: [estado.unidade] });
      } catch (err) {
        alert('Não foi possível atualizar: ' + err.message);
      }
      $('atualizar').disabled = false;
      carregar();
    };
    $('entrar').onclick = async () => {
      $('loginErro').hidden = true;
      try {
        await firebase.auth().signInWithEmailAndPassword($('loginEmail').value.trim(), $('loginSenha').value);
      } catch (err) {
        $('loginErro').textContent = 'Não foi possível entrar: ' + err.message;
        $('loginErro').hidden = false;
      }
    };
    $('sair').onclick = () => firebase.auth().signOut();

    firebase.auth().onAuthStateChanged(async user => {
      $('sair').hidden = !user;
      $('usuario').textContent = user ? user.email : '';
      if (!user) { mostrar('telaLogin'); return; }
      try {
        const snap = await firebase.firestore().collection('users').doc(user.uid).get();
        const u = snap.exists ? snap.data() : null;
        estado.user = user;
        estado.perfil = perfilDe(u);
        estado.meuNome = (u && u.name) || '';
        estado.unidades = unidadesDe(u, estado.perfil);
        if (!estado.perfil || !estado.unidades.length) { mostrar('telaRestrita'); return; }
        const perfis = [].concat((u && u.profiles) || [], u && u.role ? [u.role] : []);
        $('atualizar').hidden = perfis.indexOf('admin') < 0;
      } catch (err) { mostrar('telaRestrita'); return; }
      estado.unidade = estado.unidades[0];
      mostrar('app');
      desenharAbas();
      carregar();
    });
  }

  iniciar();
```

- [ ] **Step 3: Rodar os testes da tela de novo**

Run: `node scripts/smoke-renovacoes-tela.js`
Expected: `✅ smoke-renovacoes-tela: 5` (o bloco 1 agora confere a página completa; o sandbox não tem `document`, então a parte da página não roda).

- [ ] **Step 4: Rodar a página no navegador contra o staging**

Criar/usar em `.claude/launch.json` uma configuração que sirva a pasta (se já existir uma do termômetro, reusar). Exemplo:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "site-local", "runtimeExecutable": "npx", "runtimeArgs": ["http-server", "-p", "5173", "-c-1"], "port": 5173 }
  ]
}
```

Abrir `http://localhost:5173/renovacoes.html` (qualquer host que não seja o GitHub Pages cai no **staging**). Conferir com `read_console_messages` que não há erro; entrar com a conta de demo `dono.teste@` (senha nos arquivos de seed do projeto) e ver "A lista deste mês ainda não foi montada" (a Function ainda não rodou). Nada mais a validar aqui — o conteúdo vem na tarefa 13.

- [ ] **Step 5: Commit**

```bash
git add renovacoes.html renovacoes.js
git commit -m "feat(renovacoes): a página — abas por unidade, mês, editor da consultora, botão do admin"
```

---

### Task 13: Homologação contra o staging real

**Files:**
- Create: `scripts/homologar-renovacoes.js`

- [ ] **Step 1: Escrever o script**

```js
'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Homologação da lista de renovações contra o STAGING, com a Pacto de verdade
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/homologar-renovacoes.js --project staging [--hoje 2026-10-01]
//
// Roda a MESMA montagem da Cloud Function (functions/renovacoes-montar.js) na
// máquina, com as credenciais dos arquivos `pacto-credencial*.txt`, e grava no
// Firestore do staging. Imprime SÓ contagens — nenhum nome, matrícula ou CPF.
// Confere: soma com a Pacto, CPF ausente, acompanhamentos intactos.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if ((arg('--project') || 'staging') !== 'staging') { console.error('Só no staging.'); process.exit(1); }
const RAIZ = path.join(__dirname, '..');
const RL = require(path.join(RAIZ, 'renovacoes-lista.js'));
const M = require(path.join(RAIZ, 'functions', 'renovacoes-montar.js'));
const CR = require(path.join(RAIZ, 'functions', 'pacto-renovacao-cliente.js'));
const CN = require(path.join(RAIZ, 'functions', 'pacto-api-cliente.js'));

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-staging.json'))), projectId: 'crosstrainer-comissoes-staging' });
const db = admin.firestore();
const cred = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').trim();
const hoje = arg('--hoje') || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

(async () => {
  const antes = (await db.collection('renovacoes_acompanhamento').get()).docs.map(d => d.id + JSON.stringify(d.data())).sort().join('|');
  const clientesGw = {
    CP: CR.criarClienteRenovacao({ fetch, credencial: cred('pacto-credencial-cp.txt') }),
    PP: CR.criarClienteRenovacao({ fetch, credencial: cred('pacto-credencial-pp.txt') }),
  };
  const clienteNucleo = CN.criarCliente({ fetch, credencial: cred('pacto-credencial.txt') });
  console.log(`Montando (hoje = ${hoje})… a primeira vez consulta um cliente por vez no núcleo, com 2 s de pausa.`);
  const res = await M.montarTudo({ db, clientesGw, clienteNucleo, hoje, agora: () => admin.firestore.FieldValue.serverTimestamp() });
  let falhas = 0;
  for (const r of res) {
    const d = (await db.collection('renovacoes_lista').doc(r.id).get()).data();
    console.log(`\n=== ${r.id}: ${r.situacao}${r.consultas != null ? ' · ' + r.consultas + ' consultas ao núcleo' : ''}`);
    if (r.situacao !== 'ok') { falhas++; continue; }
    const b = d.blocos;
    console.log(`Bloco 1 renovações ${b.renovacoes.length} · Bloco 2 antecipação ${b.antecipacao.length} · Bloco 3 degustações ${b.degustacoes.length} (do histórico ${b.degustacoes.filter(l => l.origem === 'historico').length}) · Bloco 4 verificar ${b.verificar.length}`);
    console.log('excluídos:', JSON.stringify(d.excluidos));
    console.log('conferência:', JSON.stringify(d.conferencia));
    const todas = Object.values(b).flat();
    console.log(`com consultora: ${todas.filter(l => l.consultora).length} de ${todas.length} · pela Pacto ${todas.filter(l => l.consultoraOrigem === 'pacto').length} · pelo histórico ${todas.filter(l => l.consultoraOrigem === 'historico').length}`);
    console.log(`importações com plano original: ${todas.filter(l => l.planoOriginal).length} · já renovados pela Pacto: ${todas.filter(l => l.renovouSistema).length}`);
    const motivos = {};
    b.verificar.forEach(l => { const k = l.motivoVerificar.replace(/\(.*\)/, '(…)'); motivos[k] = (motivos[k] || 0) + 1; });
    console.log('verificar por motivo:', JSON.stringify(motivos));
    if (!d.conferencia.bate) { falhas++; console.log('✗ a conferência NÃO bate'); }
    const cpf = JSON.stringify(d).match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g) || [];
    if (cpf.some(RL.pareceCpf)) { falhas++; console.log('✗ há CPF no documento'); } else console.log('✓ nenhum CPF no documento');
  }
  const depois = (await db.collection('renovacoes_acompanhamento').get()).docs.map(d => d.id + JSON.stringify(d.data())).sort().join('|');
  if (antes !== depois) { falhas++; console.log('\n✗ a montagem alterou acompanhamentos'); } else console.log('\n✓ acompanhamentos intactos');
  console.log(falhas ? `\n${falhas} problema(s)` : '\n✅ homologação sem problemas');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar a suíte inteira antes de subir**

Run (bash): `for f in scripts/smoke-*.js; do node "$f" > /dev/null 2>&1 || echo "FALHOU: $f"; done; echo fim`
Expected: só `fim` (nenhum `FALHOU`). Se um smoke **antigo** falhar, ver se ele já falhava antes desta branch rodando o mesmo arquivo num worktree da `main` (`git worktree add ../wt-main main`) e anotar no CONTEXTO — não "consertar" o que não é desta entrega. Nunca `git checkout`/`stash` com trabalho vivo.

- [ ] **Step 3: Rodar a homologação**

Run: `node scripts/homologar-renovacoes.js --project staging`
Expected: `CP_2026-10: ok` e `PP_2026-10: ok`; Bloco 1 na ordem de grandeza de **60–70 (CP)** e **30–40 (PP)** (72 e 42 antes das exclusões, em 29/09); `conferência: … "bate":true`; `✓ nenhum CPF no documento`; `✓ acompanhamentos intactos`; `✅ homologação sem problemas`. Leva ~5–10 min na primeira vez.

Se a conferência não bater: o `diferenca` diz quantos registros sumiram — procurar no módulo o caminho que descarta sem `conta(...)`, escrever o teste que reproduz, corrigir. **Não seguir para o deploy com a soma furada.**

- [ ] **Step 4: Conferir o Bloco 4 à mão**

Abrir a página local (tarefa 12, Step 4) como admin, no mês corrente, nas duas unidades. Para cada motivo do "Verificar manualmente", abrir 2 ou 3 casos e conferir na Pacto se a classificação faria sentido. Anotar a contagem por motivo no CONTEXTO — é o que o Rafael vai ver primeiro.

- [ ] **Step 5: Commit**

```bash
git add scripts/homologar-renovacoes.js
git commit -m "test(renovacoes): homologação contra o staging com a Pacto de verdade"
```

---

### Task 14: Publicar no staging e entregar para o Rafael homologar

**Files:**
- Modify: `manual-admin.html` (seção nova)
- Modify: `CONTEXTO_SESSAO.md`

- [ ] **Step 1: Credenciais das unidades no cofre do STAGING**

Run (PowerShell, na raiz do repositório):
`firebase functions:secrets:set PACTO_API_KEY_CP --project staging --data-file pacto-credencial-cp.txt`
`firebase functions:secrets:set PACTO_API_KEY_PP --project staging --data-file pacto-credencial-pp.txt`
Expected: `Created a new secret version …` nas duas. ⚠️ Nunca passar a chave na linha de comando nem imprimir o arquivo.

- [ ] **Step 2: Publicar as Functions novas no staging**

Run: `firebase deploy --only functions:montarListaRenovacoes,functions:montarListaRenovacoesManual --project staging`
Expected: `Deploy complete!` com as duas funções criadas.

- [ ] **Step 3: Publicar a página no hosting do staging**

Run: `firebase deploy --only hosting --project staging`
Expected: `Deploy complete!`. Abrir `https://crosstrainer-comissoes-staging.web.app/renovacoes.html` e conferir que as credenciais **não** são servidas: `https://crosstrainer-comissoes-staging.web.app/pacto-credencial-cp.txt` deve devolver a página inicial (rewrite), não a chave.

- [ ] **Step 4: Rodar o botão "Atualizar agora" pela página**

Entrar como admin no staging, clicar **Atualizar agora** no CP e no PP. Expected: a lista aparece com os mesmos números da tarefa 13. Conferir o log: `firebase functions:log --only montarListaRenovacoesManual --project staging` sem erro.

- [ ] **Step 5: Seção no manual do admin**

Acrescentar em `manual-admin.html`, na seção de Comissões (logo depois da seção do Termômetro), um bloco com id `renovacoes`, em linguagem de uso: o que é a lista; que ela se monta sozinha às 5h; os 4 blocos; o que a consultora preenche e as validações; os alertas; que a gestão atribui a consultora e classifica o "Verificar manualmente"; que a conferência com a Pacto tem que "bater"; que do dia 25 em diante já aparece a lista do mês seguinte e o que foi preenchido vai junto. Depois:

Run: `node scripts/smoke-manual-atualizado.js`
Expected: passa (o smoke caça link morto e âncora faltando).

- [ ] **Step 6: Registrar no CONTEXTO e commitar**

Atualizar `CONTEXTO_SESSAO.md`: nova seção **🔖 ONDE PARAMOS** com o que foi entregue, os números da homologação (tarefa 13), a contagem do Bloco 4 por motivo, e o que falta: (1) homologação do Rafael no staging; (2) **autorização para o atalho no menu** (mexe no `index.html`) — perguntar em uma linha; (3) produção só com OK explícito.

```bash
git add manual-admin.html CONTEXTO_SESSAO.md
git commit -m "docs(renovacoes): manual do admin e registro da entrega no staging"
```

- [ ] **Step 7: Entregar ao Rafael**

Mensagem curta, sem jargão: onde abrir (`…staging.web.app/renovacoes.html`), o que conferir (os números de outubro contra a tela da Pacto; abrir 3 alunos e preencher; ver se o "Verificar manualmente" faz sentido), e as duas perguntas em um bloco numerado no fim: **(1)** pode pôr o atalho "Renovações" no menu das Comissões (mexe no `index.html`)? **(2)** depois da homologação dele, publica em produção?

---

## Produção (só depois do OK explícito do Rafael — fora deste plano)

Na ordem, conferindo as duas portas ([[producao-tem-duas-portas]]):
1. `node scripts/validate-rules-comissoes.js` → `firebase deploy --only firestore:rules --project production` → validar.
2. `firebase functions:secrets:set PACTO_API_KEY_CP --project production --data-file pacto-credencial-cp.txt` (e PP).
3. `firebase deploy --only functions:montarListaRenovacoes,functions:montarListaRenovacoesManual --project production`.
4. Merge no `main` + `git push origin main` (é o GitHub Pages que as consultoras usam), com o `?v=` da data do deploy.
5. Rodar "Atualizar agora" em produção e conferir os mesmos números.
