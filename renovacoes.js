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

  /** Motivo gravado pela Function → frase para a gestão. A Pacto devolve páginas HTML de erro. */
  function motivoLegivel(m) {
    const s = String(m || '');
    if (s === 'limite') return 'a Pacto recusou por excesso de consultas';
    if (s === 'credencial_recusada') return 'a Pacto recusou a credencial';
    const h = s.match(/HTTP (\d{3})/);
    if (h && h[1] === '429') return 'a Pacto recusou por excesso de consultas';
    if (h && (h[1] === '401' || h[1] === '403')) return `a Pacto recusou a credencial (erro ${h[1]})`;
    if (h && h[1][0] === '5') return `a Pacto estava fora do ar (erro ${h[1]})`;
    return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  }

  function alertasHtml(als) {
    return als.map(a => `<div class="alerta ${a.nivel}">${a.nivel === 'vermelho' ? '🔴' : '🟠'} ${esc(a.texto)}</div>`).join('');
  }

  /** Renovação que a Pacto já registra: o dia, e a marca de quem chegou ao mês já renovado. */
  function renovadoHtml(l) {
    if (!l.renovouSistema) return '';
    return `<div class="muted pequeno">pela Pacto${l.renovadoEm ? ' em ' + dataBR(l.renovadoEm) : ''}</div>`
      + (l.renovouAntesDoMes ? '<span class="etiqueta">antes do mês</span>' : '');
  }

  /** Aviso da gestão: contratos que a Pacto não devolveu nesta atualização (valem os dados da última leitura). */
  function leituraHtml(lista) {
    const lt = lista && lista.leitura;
    if (!lt || !lt.total || lt.relidos >= lt.total) return '';
    const faltam = lt.total - lt.relidos;
    return `<div class="aviso">${esc(faltam)} de ${esc(lt.total)} contrato(s) não puderam ser conferidos na Pacto nesta atualização`
      + `${lt.motivo ? ' (' + esc(motivoLegivel(lt.motivo)) + ')' : ''}. Para eles valem o plano, o vencimento e a consultora da última leitura.</div>`;
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
      <td><span class="status ${esc(s)}">${esc(RL.STATUS[s])}</span>${renovadoHtml(l)}</td>
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
    const lt = lista.leitura;
    const excl = Object.entries(lista.excluidos || {}).sort((a, b) => b[1] - a[1])
      .map(([m, q]) => `<span>${esc(RL.rotuloExclusao(m))}</span><span>${esc(q)}</span>`).join('');
    return `<details class="card"><summary><b>Conferência com a Pacto</b> — ${c.bate
      ? '<span class="ok">bate</span>'
      : `<span class="erro-txt">não bate: ${esc(c.diferenca)} registro(s) sem destino</span>`}</summary>
      <div class="kv">
        <span>Total na Previsão da Pacto (mês + 1 a 15 do seguinte)</span><span>${esc(c.totalPacto)}</span>
        <span>Na lista (blocos 1 a 4)</span><span>${esc(c.naLista)}</span>
        <span>Excluídos</span><span>${esc(c.excluidos)}</span>
        ${lt && lt.total ? `<span>Contratos conferidos na Pacto nesta atualização (plano, vencimento e consultora de hoje)</span><span>${esc(lt.relidos)} de ${esc(lt.total)}</span>` : ''}
      </div>
      <h3>Excluídos por motivo</h3><div class="kv">${excl || '<span class="muted">nenhum</span><span></span>'}</div>
    </details>`;
  }

  function painelHtml(lista, acomps, unidade, perfil, hoje) {
    if (!lista) return `<section class="card"><h2>${esc(NOMES[unidade])}</h2><p class="muted">A lista deste mês ainda não foi montada.</p></section>`;
    if (lista.situacao !== 'ok') {
      return `<section class="card"><h2>${esc(NOMES[unidade])}</h2><div class="erro">Não foi possível montar a lista: ${esc(motivoLegivel(lista.motivo) || lista.situacao)}. A próxima tentativa é às 5h.</div></section>`;
    }
    const p = RL.painel(lista, acomps, hoje);
    const b = p.porBloco;
    const pct = v => (v == null ? '—' : String(v).replace('.', ',') + '%');
    const consultoras = Object.entries(p.porConsultora).sort((x, y) => y[1].total - x[1].total)
      .map(([nome, x]) => `<span>${esc(nome)}</span><span>${esc(x.renovados)} de ${esc(x.total)}</span>`).join('');
    return `<section class="card">
      <h2>${esc(NOMES[unidade])}</h2>
      ${lista.ultimaFalha ? `<div class="aviso">A última atualização falhou: ${esc(motivoLegivel(lista.ultimaFalha.motivo) || lista.ultimaFalha.situacao)}. Mostrando a lista anterior; a próxima tentativa é às 5h.</div>` : ''}
      ${perfil === 'gestao' ? leituraHtml(lista) : ''}
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
        <span>Dos renovados: antes de o mês começar · dentro do mês</span>
        <span>${esc(p.renovadosAntes)} · ${esc(p.renovadosNoMes)}</span>
        <span>Alertas</span><span>🔴 ${esc(p.alertas.vermelho)} · 🟠 ${esc(p.alertas.laranja)}</span>
      </div>
      <h3>Por consultora (renovados de total)</h3><div class="kv">${consultoras}</div>
      <h3>Metas do mês</h3>${metasHtml(lista.metas)}
    </section>${perfil === 'gestao' ? conferenciaHtml(lista) : ''}`;
  }

  // `rotulos` (opcional): valor gravado → texto na tela (o valor não muda)
  function opcoes(lista, atual, rotulos) {
    const vals = [''].concat(lista || []);
    if (atual && vals.indexOf(atual) < 0) vals.push(atual);
    return vals.map(v => `<option value="${esc(v)}"${v === (atual || '') ? ' selected' : ''}>${esc(v ? ((rotulos && rotulos[v]) || v) : '—')}</option>`).join('');
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
         ${bloco === 'verificar' ? `<label>Classificar como <select name="blocoGestao">${opcoes(['renovacao', 'degustacao', 'excluir'], a.blocoGestao, { renovacao: 'Renovação do mês', degustacao: 'Voucher — Mês Degustação', excluir: 'Tirar da lista' })}</select>
           <span class="muted pequeno">Vale a partir da próxima atualização (5h ou "Atualizar agora").</span></label>` : ''}`
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

  window.RenovacoesTela = { BLOCOS, NOMES, motivoLegivel, perfilDe, unidadesDe, linhaHtml, blocoHtml, painelHtml, formHtml, metasHtml, leituraHtml, renovadoHtml, hojeSP };

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
})();
