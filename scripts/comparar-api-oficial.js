'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Validação da API como fonte OFICIAL: um mês pela API × pelo arquivo — SÓ LEITURA
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/comparar-api-oficial.js --mes 2026-09 [--unidade CP|PP] [--arquivo "<export>.xls"]
//
// Desenho: docs/superpowers/specs/2026-09-30-api-pacto-oficial-design.md §3
//
// Lado API: os dias que a busca das 4h gravou em PRODUÇÃO (`pacto_sombra_dias`),
// completados como a busca nova vai completar — consultora pelo gateway, balcão
// pelo relatório de vendas, degustação grátis pela numeração dos contratos — e
// montados pelo mesmo `UploadPelaApi.montar` do botão.
// Lado arquivo: o export oficial do mesmo corte.
// Os dois passam pela MESMA conta (tradutor + motor, com a config, as metas e os
// contratos já pagos de produção). Então toda diferença é de DADO, nunca de regra.
//
// Nada é gravado em lugar nenhum: Firestore de produção só leitura; a Pacto só
// por rotas de leitura, com as credenciais das unidades lidas do disco e nunca
// impressas. Nome de CLIENTE nunca sai na tela (contrato e primeiro nome de
// vendedora, só). O cache do gateway fica na pasta temporária do sistema.

const fs = require('fs');
const os = require('os');
const path = require('path');

const raiz = path.join(__dirname, '..');
const admin = require(path.join(raiz, 'functions', 'node_modules', 'firebase-admin'));
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CE = require(path.join(raiz, 'commission.js'));
const L = require(path.join(raiz, 'pacto-api-linhas.js'));
const U = require(path.join(raiz, 'upload-pela-api.js'));
const C = require(path.join(raiz, 'pacto-sombra-comparacao.js'));
const { criarClienteGateway } = require(path.join(raiz, 'functions', 'pacto-gateway-cliente.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const MES = arg('--mes') || '2026-09';
const UNIDADES = arg('--unidade') ? [arg('--unidade')] : ['CP', 'PP'];
const ARQUIVOS = { '2026-08': 'faturamento-recebido_01 a 310826.xls', '2026-09': 'faturamento-recebido_01 a 290926.xls' };
const ARQUIVO = arg('--arquivo') || path.join(raiz, 'relatorios pacto', ARQUIVOS[MES] || '');
// Faixas de contrato do mês (medidas em 30/09/2026) para achar a degustação grátis
const FAIXAS = { '2026-08': { PP: [4555, 4660], CP: [7025, 7150] }, '2026-09': { PP: [4655, 4760], CP: [7148, 7275] } };

const svc = require(path.join(__dirname, 'serviceAccount-production.json'));
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

const CACHE = path.join(os.tmpdir(), 'crosstrainer-api-oficial-cache.json');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const salvarCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const brl = v => (v < 0 ? '−' : '') + 'R$ ' + Math.abs(r2(v)).toFixed(2).replace('.', ',');
const primeiro = n => String(n || '(sem vendedora)').split(' ')[0];

function gateway(sigla) {
  const cred = fs.readFileSync(path.join(raiz, 'pacto-credencial-' + sigla.toLowerCase() + '.txt'), 'utf8').trim();
  return criarClienteGateway({ fetch, credencial: cred });
}
async function contratoGw(gw, sigla, n) {
  const k = sigla + '_c_' + n;
  if (!(k in cache)) {
    const r = await gw.contrato(n);
    if (r.situacao !== 'ok') { console.log(`   ! gateway ${sigla} contrato ${n}: ${r.situacao}`); return null; }
    cache[k] = r.dados;
    salvarCache();
  }
  return cache[k];
}
async function alunoGw(gw, sigla, pessoa) {
  const k = sigla + '_a_' + pessoa;
  if (!(k in cache)) {
    const r = await gw.consultorDoAluno(pessoa);
    if (r.situacao !== 'ok') { console.log(`   ! gateway ${sigla} aluno ${pessoa}: ${r.situacao}`); return null; }
    cache[k] = r.dados;
    salvarCache();
  }
  return cache[k];
}
/** O contrato como a busca nova vai deixá-lo no caderninho (contrato + vínculo do aluno) */
async function contratoCompleto(gw, sigla, n) {
  const g = await contratoGw(gw, sigla, n);
  if (!g) return null;
  const c = L.contratoDoGateway(g, sigla);
  if (c.pessoa) {
    const a = await alunoGw(gw, sigla, c.pessoa);
    if (a) { c.alunoConsultado = true; c.consultorAluno = a.consultor || null; }
  }
  return { g, c };
}
async function vendasGw(gw, sigla, dia) {
  const k = sigla + '_v_' + dia;
  if (!(k in cache)) {
    const r = await gw.vendasDoDia(dia);
    if (r.situacao !== 'ok') { console.log(`   ! gateway ${sigla} vendas ${dia}: ${r.situacao} ${r.motivo || ''}`); return null; }
    cache[k] = r.dados;
    salvarCache();
  }
  return cache[k];
}

/** O export como linhas cruas (array de arrays), cabeçalho incluso */
function lerArquivo(arquivo) {
  const wb = readXlsx(arquivo);
  const sheet = wb.sheet(wb.sheetNames[0]);
  return Object.keys(sheet).map(Number).sort((a, b) => a - b).map(k => {
    const row = sheet[k] || {};
    const max = Math.max(-1, ...Object.keys(row).map(Number));
    const a = new Array(max + 1).fill('');
    Object.entries(row).forEach(([c, v]) => { a[Number(c)] = v == null ? '' : String(v); });
    return a;
  });
}

/** A mesma conta dos dois lados */
function calcular(json, { sigla, codigosPagos, degustacoes, cfg, previousProcessed }) {
  const t = PA.traduzir(json, { codigosPagos });
  const vendas = (t.porUnidade && t.porUnidade[sigla]) || [];
  const j = PA.juntarDegustacoes(vendas, degustacoes || [], codigosPagos);
  const rows = CE.cleanRawData([PA.CABECALHO_SAIDA, ...PA.paraPlanilha(j.vendas)]);
  const r = CE.calculate(rows, cfg, {}, previousProcessed);
  return { r, t, degustacoesIncluidas: j.incluidas };
}

(async () => {
  if (!fs.existsSync(ARQUIVO)) { console.error('Falta o export do mês: ' + ARQUIVO); process.exit(1); }
  const arquivo = lerArquivo(ARQUIVO);
  const [aa, mm] = MES.split('-').map(Number);
  // O corte da API = o último dia do arquivo (o export de set/2026 vai até 29/09)
  const diasArquivo = PA.normalizarColunas(arquivo).map(l => PA.campo(l, 'lancamento')).filter(d => /^\d{2}\/\d{2}\/\d{4}/.test(d || ''));
  const ultimoArquivo = diasArquivo.map(d => d.slice(6, 10) + '-' + d.slice(3, 5) + '-' + d.slice(0, 2)).filter(d => d.slice(0, 7) === MES).sort().pop();
  const hoje = U._somar(ultimoArquivo, 1);
  console.log(`\n=== ${MES} — API × arquivo (${path.basename(ARQUIVO)}, até ${ultimoArquivo}) — produção, só leitura ===`);

  const units = (await db.collection('units').get()).docs;
  for (const sigla of UNIDADES) {
    const u = units.find(d => PA.siglaDaUnidade(d.id, [sigla]) === sigla);
    const unitId = u.id;
    const unitConfig = (u.data() && u.data().config) || {};
    const periodos = (await db.collection('periodos').where('unitId', '==', unitId).get()).docs;
    const codigosPagos = [];
    let per = null;
    periodos.forEach(p => {
      const m = (String(p.id).match(/(\d{4}-\d{2})$/) || [])[1];
      if (m && m < MES) (p.data().codigosPagos || []).forEach(c => codigosPagos.push(c));
      if (p.id === unitId + '_' + MES) per = p.data();
    });
    const mesAnt = new Date(Date.UTC(aa, mm - 2, 1)).toISOString().slice(0, 7);
    const prev = (await db.collection('periodos').doc(unitId + '_' + mesAnt).collection('itens').where('type', '==', 'processed').get()).docs.map(d => d.data());
    const cfg = CE.configDoMes({ unitConfig, metasMensais: (per && per.metasMensais) || null, mes: MES });
    const guardadas = (per && per.degustacoesGratis) || [];

    // ── lado API ──
    const gw = gateway(sigla);
    const docs = (await db.collection('pacto_sombra_dias').where('unidade', '==', sigla).get()).docs.map(d => d.data())
      .filter(d => String(d.dia || '').slice(0, 7) === MES);
    let consultoraCompletada = 0, semConsultora = 0, balcaoLinhas = 0, balcaoValor = 0;
    const cruas = [];
    for (const d of docs.sort((a, b) => a.dia.localeCompare(b.dia))) {
      const linhas = d.linhas ? JSON.parse(d.linhas) : [];
      // Como o conversor novo faz: consultora = vínculo do aluno; Responsável 1 = quem lançou
      for (const l of linhas) {
        const nc = String(l[L.COL.contrato] || '0');
        if (nc === '0') continue;
        const x = await contratoCompleto(gw, sigla, nc);
        if (!x) continue;
        const consultora = L.consultoraDoContrato(x.c);
        if (consultora !== (l[L.COL.consultor] || '')) consultoraCompletada++;
        l[L.COL.consultor] = consultora;
        if (x.c.lancou) l[L.COL.resp1] = x.c.lancou;
        if (!consultora) semConsultora++;
      }
      if (d.situacao !== 'falhou' && d.dia.slice(0, 4) === String(new Date().getFullYear())) {
        const v = await vendasGw(gw, sigla, d.dia);
        if (v) {
          const b = L.linhasDeBalcao({ vendas: v, linhas, unidade: sigla });
          b.linhas.forEach(x => { linhas.push(x); balcaoLinhas++; balcaoValor += L._valor(x[L.COL.valor]); });
        }
      }
      cruas.push(...linhas);
      d.linhas = JSON.stringify(linhas);
    }
    const degsApi = [];
    const [de, ate] = (FAIXAS[MES] || {})[sigla] || [0, -1];
    for (let n = de; n <= ate; n++) {
      const g = await contratoGw(gw, sigla, n);
      if (!g || g.valor !== 0) continue;
      const x = await contratoCompleto(gw, sigla, n);
      const linha = L.linhaDeDegustacao({ ...g, consultor: L.consultoraDoContrato(x.c) || null }, sigla);
      Object.values(PA.degustacoesGratis(L.comCabecalho([linha]))).flat()
        .forEach(d => degsApi.push({ mes: d.mes, degustacao: d }));
    }
    const m = U.montar({ docs, degustacoes: degsApi, mes: MES, hoje, ApiLinhas: L });

    const api = calcular(m.json, { sigla, codigosPagos, degustacoes: m.degustacoes, cfg, previousProcessed: prev });
    const arq = calcular(arquivo, { sigla, codigosPagos, degustacoes: guardadas, cfg, previousProcessed: prev });

    // ── relatório ──
    console.log(`\n── ${sigla} ─────────────────────────────────────────`);
    console.log(`dias da API: ${docs.length}${m.trava ? ' · ⚠️ TRAVA: ' + m.diasProblema.map(x => x.dia.slice(8) + ' ' + x.situacao).join(', ') : ''}` +
      ` · consultora completada pelo gateway em ${consultoraCompletada} linha(s), sem consultora ${semConsultora}` +
      ` · balcão +${balcaoLinhas} (${brl(balcaoValor)}) · degustação grátis ${m.degustacoes.length}` +
      ` · parcelas de outro dia fora: ${m.parcelasDepois.length}`);
    const T = x => x.r.unitTotals;
    const linhaT = (rot, f) => console.log(`  ${rot.padEnd(22)} API ${String(f(api)).padStart(10)}   arquivo ${String(f(arq)).padStart(10)}   ${f(api) === f(arq) ? '=' : 'Δ'}`);
    linhaT('ativações', x => T(x).unitAtivacoes);
    linhaT('novos+retorno', x => T(x).unitNovosRetorno);
    linhaT('renovações', x => T(x).unitRenovacoes);
    linhaT('vouchers', x => T(x).unitVouchers);
    linhaT('caixa', x => r2(T(x).unitCaixa));

    console.log('\n  por vendedora              ativ API / arq      comissão API     comissão arq      Δ         gravado em produção');
    const nomes = [...new Set([...Object.keys(api.r.vendorData), ...Object.keys(arq.r.vendorData)])].sort();
    let dTotal = 0;
    nomes.forEach(nm => {
      const a = api.r.vendorData[nm] || {}, x = arq.r.vendorData[nm] || {};
      const d = r2((a.grandTotal || 0) - (x.grandTotal || 0));
      dTotal += d;
      const gravado = per && per.vendorSummary && per.vendorSummary[nm] ? brl(per.vendorSummary[nm].grandTotal) : '—';
      console.log(`  ${primeiro(nm).padEnd(24)} ${String(r2(a.ativacoes || 0)).padStart(6)} / ${String(r2(x.ativacoes || 0)).padEnd(6)} ${brl(a.grandTotal || 0).padStart(14)} ${brl(x.grandTotal || 0).padStart(16)}  ${(d ? brl(d) : '=').padStart(10)}   ${gravado}`);
    });
    console.log(`  ${'TOTAL'.padEnd(24)} ${' '.repeat(15)} ${brl(Object.values(api.r.vendorData).reduce((s, v) => s + (v.grandTotal || 0), 0)).padStart(14)} ${brl(Object.values(arq.r.vendorData).reduce((s, v) => s + (v.grandTotal || 0), 0)).padStart(16)}  ${brl(dTotal).padStart(10)}`);

    // ── contrato a contrato: as ativações que só um lado tem ──
    const ativ = x => {
      const mapa = new Map();
      x.r.processed.filter(p => p.isActivation && !p.ativacaoAdiadaPara).forEach(p => {
        const k = String(p.codigo || '').replace(/-\d+$/, '');
        mapa.set(k, { cat: p.category, vend: primeiro(p.vendedor), valor: r2(p.valorCaixa) });
      });
      return mapa;
    };
    const aA = ativ(api), aX = ativ(arq);
    const soApi = [...aA.keys()].filter(k => !aX.has(k)), soArq = [...aX.keys()].filter(k => !aA.has(k));
    const catDif = [...aA.keys()].filter(k => aX.has(k) && (aA.get(k).cat !== aX.get(k).cat || aA.get(k).vend !== aX.get(k).vend));
    console.log(`\n  ativação só na API (${soApi.length}): ${soApi.map(k => k + ' ' + aA.get(k).cat + ' ' + aA.get(k).vend).join(' · ') || '—'}`);
    console.log(`  ativação só no arquivo (${soArq.length}): ${soArq.map(k => k + ' ' + aX.get(k).cat + ' ' + aX.get(k).vend).join(' · ') || '—'}`);
    console.log(`  mesma ativação, categoria ou vendedora diferente (${catDif.length}): ${catDif.map(k => k + ' ' + aA.get(k).cat + '/' + aA.get(k).vend + ' × ' + aX.get(k).cat + '/' + aX.get(k).vend).join(' · ') || '—'}`);

    // ── dinheiro por cliente+dia, com a causa (a mesma tela de conferência da sombra) ──
    const cmp = C.comparar({ linhasApi: cruas, linhasArquivo: arquivo, mes: MES, unidade: sigla,
      foraApi: docs.flatMap(d => d.foraDeProposito || []), config: cfg, Adapter: PA, Engine: CE, ApiLinhas: L });
    console.log(`\n  dinheiro: API ${brl(cmp.api.recebido)} × arquivo ${brl(cmp.arquivo.recebido)} = ${brl(cmp.diferenca)} · ${cmp.batem}/${cmp.grupos} grupos cliente+dia batem`);
    Object.entries(cmp.porCausa).forEach(([k, v]) => console.log(`    ${k.padEnd(42)} ${String(v.qtd).padStart(3)}  ${brl(v.valor)}`));
    const rel = path.join(os.tmpdir(), `api-oficial-${sigla}-${MES}.json`);
    fs.writeFileSync(rel, JSON.stringify({ divergencias: cmp.divergencias.map(d => ({ dia: d.dia, contratos: d.contratos, api: d.api, arquivo: d.arquivo, diferenca: d.diferenca, causa: d.causa })),
      soApi, soArq, catDif, parcelasDepois: m.parcelasDepois }, null, 1));
    console.log(`  detalhe (sem nome de cliente): ${rel}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
