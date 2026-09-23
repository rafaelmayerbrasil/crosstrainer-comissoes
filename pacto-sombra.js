// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Modo sombra da API da Pacto: a tela
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-13-pacto-api-modo-sombra-design.md
//
// Só administrador. Lê `pacto_sombra_dias`, recebe o export arrastado e desenha
// a comparação feita por `pacto-sombra-comparacao.js`. A COMPARAÇÃO nunca grava
// nada. O único caminho que escreve é o botão "Buscar agora", que chama a Cloud
// Function `buscarPactoSombraManual` — e ela só grava as coleções da sombra.
//
// As funções que só fazem conta (sem DOM) ficam expostas em
// `window.PactoSombraTela` para o smoke rodá-las num sandbox.

(function () {
  'use strict';

  const SITUACAO_ROTULO = {
    buscado: 'buscado',
    vazio_conferir: 'vazio — conferir',
    parcial: 'parcial',
    falhou: 'falhou',
    credencial_recusada: 'credencial recusada',
    limite: 'parou no limite',
    nao_buscado: 'não buscado',
  };
  const VERMELHAS = ['falhou', 'credencial_recusada', 'limite'];

  const brl = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sinal = v => (v > 0 ? '+' : v < 0 ? '−' : '') + brl(Math.abs(v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function somarDias(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // ─── Funções puras (testadas em scripts/smoke-pacto-sombra-tela.js) ───

  /** Todos os dias do mês até ontem, com a situação gravada ou "não buscado". */
  function resumirDias(docs, mes, hoje) {
    const porDia = new Map((docs || []).map(d => [d.dia, d]));
    const ontem = somarDias(hoje, -1);
    const dias = [];
    for (let d = mes + '-01'; d.slice(0, 7) === mes && d <= ontem; d = somarDias(d, 1)) {
      const doc = porDia.get(d);
      dias.push({
        dia: d,
        situacao: doc ? doc.situacao : 'nao_buscado',
        motivo: doc ? (doc.motivo || '') : '',
        recebido: doc && doc.totais ? doc.totais.recebido : null,
        avisos: doc && doc.avisos ? doc.avisos.length : 0,
        ultimaFalha: doc && doc.ultimaFalha ? doc.ultimaFalha : null,
      });
    }
    return dias;
  }

  /** Linhas de todos os dias, na ordem dos dias */
  function linhasDosDias(docs) {
    return (docs || []).slice().sort((a, b) => a.dia.localeCompare(b.dia))
      .flatMap(d => (d.linhas ? JSON.parse(d.linhas) : []));
  }

  function foraDosDias(docs) {
    return (docs || []).flatMap(d => d.foraDeProposito || []);
  }

  function avisosDosDias(docs) {
    return (docs || []).flatMap(d => (d.avisos || []).map(a => Object.assign({ dia: d.dia }, a)));
  }

  /** O que precisa de atenção na grade, em frases */
  function alertasDosDias(dias, hoje) {
    const alertas = [];
    const vermelhos = dias.filter(d => VERMELHAS.includes(d.situacao));
    // a credencial recusada pode estar só na última busca de um dia bom (preservado)
    if (dias.some(d => d.situacao === 'credencial_recusada' || (d.ultimaFalha && d.ultimaFalha.situacao === 'credencial_recusada'))) {
      alertas.push({ tipo: 'erro', texto: 'A Pacto recusou a credencial. Nenhuma busca vai funcionar até ela ser trocada no cofre do Firebase.' });
    }
    // Mesma janela de `diasDaRotina` (functions/pacto-sombra.js): a madrugada relê
    // o mês inteiro, e o anterior até o dia 10.
    let inicioRotina = hoje.slice(0, 8) + '01';
    if (Number(hoje.slice(8)) <= 10) inicioRotina = somarDias(inicioRotina, -1).slice(0, 8) + '01';
    const antigos = vermelhos.filter(d => d.dia < inicioRotina);
    const recentes = vermelhos.filter(d => d.dia >= inicioRotina);
    if (antigos.length) {
      alertas.push({ tipo: 'erro', texto: `${antigos.length} dia(s) com falha que a madrugada não relê mais. Use "Buscar este mês agora": ${antigos.map(d => d.dia.slice(8)).join(', ')}.` });
    }
    if (recentes.length) {
      alertas.push({ tipo: 'aviso', texto: `${recentes.length} dia(s) com falha — a madrugada tenta de novo sozinha: ${recentes.map(d => d.dia.slice(8)).join(', ')}.` });
    }
    const vazios = dias.filter(d => d.situacao === 'vazio_conferir');
    if (vazios.length) {
      alertas.push({ tipo: 'aviso', texto: `${vazios.length} dia(s) em que a Pacto respondeu sem nenhum pagamento. O cartão recorrente cobra todo dia, então isso é suspeito: ${vazios.map(d => d.dia.slice(8)).join(', ')}.` });
    }
    const velhos = dias.filter(d => d.ultimaFalha && !VERMELHAS.includes(d.situacao));
    if (velhos.length) {
      alertas.push({ tipo: 'aviso', texto: `${velhos.length} dia(s) não atualizado(s) na última busca — a Pacto falhou; valem os números da busca anterior: ${velhos.map(d => d.dia.slice(8)).join(', ')}.` });
    }
    const nao = dias.filter(d => d.situacao === 'nao_buscado');
    if (nao.length) alertas.push({ tipo: 'aviso', texto: `${nao.length} dia(s) ainda não buscados.` });
    return alertas;
  }

  window.PactoSombraTela = { resumirDias, linhasDosDias, foraDosDias, avisosDosDias, alertasDosDias, somarDias };

  // ─── A página ───
  if (typeof document === 'undefined' || !document.getElementById || !document.getElementById('app')) return;

  const $ = id => document.getElementById(id);
  const estado = { docs: [], unidade: 'CP', mes: '', linhasArquivo: null, nomeArquivo: '' };

  function hojeSP() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  }

  function mostrar(qual) {
    ['telaLogin', 'telaRestrita', 'app'].forEach(id => { $(id).hidden = id !== qual; });
  }

  async function ehAdmin(uid) {
    const snap = await firebase.firestore().collection('users').doc(uid).get();
    if (!snap.exists) return false;
    const u = snap.data();
    const perfis = u.profiles || (u.role ? [u.role] : []);
    return perfis.includes('admin');
  }

  async function carregarMes() {
    estado.unidade = $('unidade').value;
    estado.mes = $('mes').value;
    $('dias').innerHTML = '<span class="muted">Carregando…</span>';
    const snap = await firebase.firestore().collection('pacto_sombra_dias')
      .where('unidade', '==', estado.unidade).get();
    estado.docs = snap.docs.map(d => d.data()).filter(d => String(d.dia || '').slice(0, 7) === estado.mes);
    desenharDias();
    desenharResumo();
    if (estado.linhasArquivo) desenharComparacao();
  }

  function desenharDias() {
    const hoje = hojeSP();
    const dias = resumirDias(estado.docs, estado.mes, hoje);
    $('avisosDias').innerHTML = alertasDosDias(dias, hoje)
      .map(a => `<div class="${a.tipo === 'erro' ? 'erro' : 'aviso'}" style="margin-bottom:8px">${esc(a.texto)}</div>`).join('');
    $('dias').innerHTML = dias.length ? dias.map(d => `
      <div class="dia ${esc(d.situacao)}" title="${esc(d.motivo || '')}">
        <b>${esc(d.dia.slice(8))}/${esc(d.dia.slice(5, 7))}</b>
        ${esc(SITUACAO_ROTULO[d.situacao] || d.situacao)}
        ${d.recebido != null ? `<div class="muted">${esc(brl(d.recebido))}</div>` : ''}
      </div>`).join('') : '<span class="muted">Nenhum dia deste mês pode ser buscado ainda (o dia de hoje nunca é buscado).</span>';
  }

  function comparar(linhasArquivo) {
    return window.PactoSombraComparacao.comparar({
      linhasApi: linhasDosDias(estado.docs),
      linhasArquivo: linhasArquivo || [],
      mes: estado.mes, unidade: estado.unidade,
      foraApi: foraDosDias(estado.docs),
      Adapter: window.PactoAdapter || PactoAdapter,
      Engine: window.CommissionEngine || CommissionEngine,
      ApiLinhas: window.PactoApiLinhas,
    });
  }

  function blocoLado(titulo, lado, extra) {
    const a = lado.ativacoes;
    return `<div class="card">
      <div class="muted">${esc(titulo)}</div>
      <div class="num">${esc(brl(lado.recebido))}</div>
      <div class="kv">
        <span>Ativações</span><span><b>${esc(a.total)}</b></span>
        <span>· novo</span><span>${esc(a.novo)}</span>
        <span>· renovação</span><span>${esc(a.renovacao)}</span>
        <span>· retorno</span><span>${esc(a.retorno)}</span>
        <span>· voucher</span><span>${esc(a.voucher)}</span>
        <span>Linhas</span><span>${esc(lado.linhas)}</span>
        <span>Migrados (fora da conta)</span><span>${esc(lado.migrados)}</span>
      </div>${extra || ''}</div>`;
  }

  function desenharResumo() {
    if (!estado.docs.length) { $('resumoApi').innerHTML = '<span class="muted">Nenhum dia buscado neste mês.</span>'; return; }
    const r = comparar([]);
    const fora = foraDosDias(estado.docs);
    const avisos = avisosDosDias(estado.docs);
    const est = estado.docs.reduce((s, d) => {
      const t = d.totais || {};
      s.qtd += (t.estornos ? t.estornos.qtd : 0) + (t.estornosContrato ? t.estornosContrato.qtd : 0);
      s.valor += (t.estornos ? t.estornos.valor : 0) + (t.estornosContrato ? t.estornosContrato.valor : 0);
      return s;
    }, { qtd: 0, valor: 0 });
    const extra = `
      <div class="kv" style="margin-top:10px">
        <span>Fora de propósito</span><span>${esc(fora.length)} · ${esc(brl(fora.reduce((s, f) => s + (f.valor || 0), 0)))}</span>
        <span>Estornos (não entram)</span><span>${esc(est.qtd)} · ${esc(brl(est.valor))}</span>
        <span>Avisos</span><span>${esc(avisos.length)}</span>
      </div>`;
    const cp = estado.unidade === 'CP'
      ? '<p class="aviso" style="margin-top:10px">No Campeche a Pacto não entrega a consultora da venda (pedido aberto no suporte). As ativações contam; a divisão por vendedora não.</p>'
      : '';
    const listaFora = fora.length ? `<details style="margin-top:10px"><summary class="muted">Ver o que ficou de fora</summary>
      <div class="tabela"><table><tr><th>Motivo</th><th>Recibo</th><th>Contrato</th><th class="v">Valor</th></tr>
      ${fora.map(f => `<tr><td>${esc(f.motivo)}</td><td>${esc(f.recibo)}</td><td>${esc(f.contrato)}</td><td class="v">${esc(brl(f.valor))}</td></tr>`).join('')}
      </table></div></details>` : '';
    const listaAvisos = avisos.length ? `<details style="margin-top:6px"><summary class="muted">Ver avisos</summary>
      <div class="tabela"><table><tr><th>Dia</th><th>Aviso</th><th>Contrato</th></tr>
      ${avisos.map(a => `<tr><td>${esc(a.dia)}</td><td>${esc(a.motivo)}</td><td>${esc(a.contrato)}</td></tr>`).join('')}
      </table></div></details>` : '';
    $('resumoApi').innerHTML = `<div class="lado">${blocoLado('API da Pacto, mês até ontem', r.api, extra)}</div>${cp}${listaFora}${listaAvisos}`;
  }

  function desenharComparacao() {
    const r = comparar(estado.linhasArquivo);
    const causas = Object.entries(r.porCausa)
      .map(([c, x]) => `<span>${esc(c)} (${esc(x.qtd)})</span><span class="${x.valor > 0 ? 'pos' : x.valor < 0 ? 'neg' : ''}">${esc(sinal(x.valor))}</span>`).join('');
    const vend = r.compararVendedora ? (() => {
      const nomes = [...new Set([...Object.keys(r.api.porVendedora), ...Object.keys(r.arquivo.porVendedora)])].sort();
      return `<details style="margin-top:10px"><summary class="muted">Ativações por vendedora</summary><div class="tabela"><table>
        <tr><th>Vendedora</th><th class="v">API</th><th class="v">Arquivo</th></tr>
        ${nomes.map(n => `<tr><td>${esc(n)}</td><td class="v">${esc(r.api.porVendedora[n] || 0)}</td><td class="v">${esc(r.arquivo.porVendedora[n] || 0)}</td></tr>`).join('')}
        </table></div></details>`;
    })() : '<p class="aviso" style="margin-top:10px">Campeche: a vendedora não é comparada — a Pacto não entrega a consultora nessa unidade.</p>';

    $('comparacao').innerHTML = `
      <p class="muted">Arquivo: ${esc(estado.nomeArquivo)} · ${esc(r.grupos)} cliente+dia · <b>${esc(r.batem)}</b> batem · ${esc(r.divergencias.length)} divergem</p>
      <div class="lado" style="margin-top:10px">
        ${blocoLado('API da Pacto', r.api)}
        ${blocoLado('Arquivo exportado', r.arquivo)}
        <div class="card"><div class="muted">Diferença (API − arquivo)</div>
          <div class="num ${r.diferenca > 0 ? 'pos' : r.diferenca < 0 ? 'neg' : ''}">${esc(sinal(r.diferenca))}</div>
          <div class="kv">${causas || '<span class="muted">nenhuma divergência</span><span></span>'}</div></div>
      </div>
      ${vend}
      ${r.divergencias.length ? `<div class="tabela" style="margin-top:12px"><table>
        <tr><th>Dia</th><th>Cliente</th><th class="v">API</th><th class="v">Arquivo</th><th class="v">Diferença</th><th>Causa</th><th>Contratos</th></tr>
        ${r.divergencias.map(d => `<tr><td>${esc(d.dia)}</td><td>${esc(d.cliente)}</td><td class="v">${esc(brl(d.api))}</td>
          <td class="v">${esc(brl(d.arquivo))}</td><td class="v ${d.diferenca > 0 ? 'pos' : 'neg'}">${esc(sinal(d.diferenca))}</td>
          <td>${esc(d.causa)}</td><td>${esc(d.contratos.join(', '))}</td></tr>`).join('')}
      </table></div>` : ''}`;
  }

  function lerExport(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
        const PA = window.PactoAdapter || PactoAdapter;
        if (!PA.ehExportPacto(json)) throw new Error('Este arquivo não é um export da Pacto.');
        if (PA.detectarRelatorio(json) !== 'recebido') {
          throw new Error('Este é o relatório de faturamento por período (o contrato inteiro). Use o faturamento-recebido.');
        }
        estado.linhasArquivo = json;
        estado.nomeArquivo = file.name;
        desenharComparacao();
      } catch (err) {
        estado.linhasArquivo = null;
        $('comparacao').innerHTML = `<div class="erro">${esc(err.message)}</div>`;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function buscarAgora() {
    const mes = $('mes').value;
    const hoje = hojeSP();
    const fim = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
    if (mes + '-01' >= hoje) { $('buscaStatus').textContent = 'Este mês ainda não tem dia fechado para buscar.'; return; }
    $('buscarAgora').disabled = true;
    $('buscaStatus').textContent = 'Buscando na Pacto… com pausa entre as consultas. Na primeira vez um mês pode levar até meia hora; depois, segundos. Pode deixar a página aberta.';
    try {
      const fn = firebase.functions().httpsCallable('buscarPactoSombraManual', { timeout: 3600000 });
      const r = await fn({ de: mes + '-01', ate: fim });   // o servidor corta em ontem
      const d = r.data || {};
      const cont = {};
      (d.resultados || []).forEach(x => { cont[x.situacao] = (cont[x.situacao] || 0) + 1; });
      $('buscaStatus').textContent = `${d.dias} dia(s) × unidades: ` +
        Object.entries(cont).map(([s, q]) => `${SITUACAO_ROTULO[s] || s} ${q}`).join(' · ') +
        (d.parouPor ? ` — PAROU: ${SITUACAO_ROTULO[d.parouPor] || d.parouPor}` : '');
      await carregarMes();
    } catch (err) {
      // Navegador ou rede desistem de esperar antes da função terminar — mas ela
      // continua no servidor e grava os dias. Dizer isso, não só "erro".
      const demorou = /deadline|timeout|timed out|network|failed to fetch|internal/i.test(String(err.code || '') + ' ' + err.message);
      $('buscaStatus').textContent = demorou
        ? 'A página parou de esperar, mas a busca provavelmente continua no servidor. Clique em "Carregar" daqui a alguns minutos para ver os dias que entraram.'
        : 'Erro: ' + err.message;
    } finally {
      $('buscarAgora').disabled = false;
    }
  }

  function iniciar() {
    const env = window.FIREBASE_ENV || 'staging';
    $('ambiente').textContent = env === 'production' ? 'PRODUÇÃO' : 'STAGING';
    $('ambiente').className = 'badge ' + env;
    const hoje = hojeSP();
    $('mes').value = somarDias(hoje, -1).slice(0, 7);

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
    $('carregar').onclick = carregarMes;
    $('buscarAgora').onclick = buscarAgora;
    const drop = $('drop');
    $('arquivo').onchange = e => { if (e.target.files[0]) lerExport(e.target.files[0]); };
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('sobre'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) lerExport(f); });

    firebase.auth().onAuthStateChanged(async user => {
      $('sair').hidden = !user;
      $('usuario').textContent = user ? user.email : '';
      if (!user) { mostrar('telaLogin'); return; }
      try {
        if (!(await ehAdmin(user.uid))) { mostrar('telaRestrita'); return; }
      } catch (err) { mostrar('telaRestrita'); return; }
      mostrar('app');
      carregarMes();
    });
  }

  window.PactoSombraTela.carregarMes = carregarMes;
  window.PactoSombraTela.lerExport = lerExport;
  window.PactoSombraTela.estado = estado;
  iniciar();
})();
