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
