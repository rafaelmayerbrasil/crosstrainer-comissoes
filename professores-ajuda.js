/**
 * Ajuda dentro do app (Fase 2 dos manuais).
 *
 * Dois níveis, de propósito:
 *  1. Item "Ajuda" no menu → abre o manual completo do perfil da pessoa.
 *  2. Ícone "?" ao lado do título da tela → balão curto respondendo "o que eu faço aqui",
 *     com link pra seção exata do manual.
 *
 * Os manuais são páginas estáticas já publicadas (manual-admin.html / manual-professores.html).
 * Aqui só mapeamos tela → âncora e escrevemos o texto curto.
 */

/* ─── Mapa tela → seção do manual ───────────────────────────────────
 * `admin` e `prof` são as âncoras dentro de cada manual. Quando um perfil
 * não tem seção equivalente, deixa null: o link cai no topo do manual.
 */
const AJUDA_MAP = {
  'home':            { admin: 'visao',        prof: 'inicio' },
  'agenda':          { admin: 'agenda',       prof: 'agenda' },
  'agenda-geral':    { admin: 'agenda',       prof: 'agenda' },
  'minha-agenda':    { admin: 'agenda',       prof: 'agenda' },
  'substituicoes':   { admin: 'agenda',       prof: 'substituicao' },
  'escala-smart':    { admin: 'escala',       prof: 'escala' },
  'escalas':         { admin: 'escala',       prof: 'escala' },
  'pessoas':         { admin: 'pessoas',      prof: null },
  'modalidades':     { admin: 'pessoas',      prof: null },
  'ferias':          { admin: 'ferias',       prof: 'ferias' },
  'saldos-gestao':   { admin: 'ferias',       prof: 'saldo' },
  'meu-saldo':       { admin: 'ferias',       prof: 'saldo' },
  'fechamento':      { admin: 'fechamento',   prof: null },
  'pagamentos':      { admin: 'pagamentos',   prof: 'pagamentos' },
  'meus-pagamentos': { admin: 'pagamentos',   prof: 'pagamentos' },
  'relatorios':      { admin: 'relatorios',   prof: null },
  'engaj-config':    { admin: 'engajamento',  prof: 'placar' },
  'engaj-chamada':   { admin: 'engajamento',  prof: 'placar' },
  'engaj-placar':    { admin: 'engajamento',  prof: 'placar' },
  'plr-config':      { admin: 'engajamento',  prof: 'placar' },
  'plr-avaliacao':   { admin: 'engajamento',  prof: 'placar' },
  'plr-resultado':   { admin: 'engajamento',  prof: 'placar' },
};

/* ─── Textos curtos do balão "?" ────────────────────────────────────
 * Regra de escrita: 2 a 4 frases, sem jargão, respondendo o que a pessoa
 * faz NESTA tela e o que acontece depois. Detalhe fica pro manual.
 */
const AJUDA_BLURBS = {
  'engaj-chamada': {
    titulo: 'Confirmar Presença',
    texto: 'Aqui você marca quem participou de uma reunião, treinamento, evento ou sessão da Escola Interna — e é isso que lança os pontos no Placar. '
         + 'O evento em si (com convite e confirmação do time) é criado na Escala Inteligente, aba Eventos; use o botão "+ Criar evento na Escala" ao lado. '
         + 'Se o evento já existir nesta data, quem respondeu "Vou" vem pré-marcado — confira quem realmente apareceu antes de salvar.',
  },
  'escala-smart': {
    titulo: 'Escala Inteligente',
    texto: 'Sábados e feriados: o sistema sugere quem trabalha por justiça e mérito, você ajusta e publica. '
         + 'A aba Eventos é onde você cria reunião de staff, treinamento interno, trilha, beach games e afins: define quem deve e quem poderia participar, o time recebe o convite e responde "Vou / Não vou", e o sistema lembra 7, 4 e 1 dia antes. '
         + 'Atenção: o evento é só o plano. Os pontos entram quando você marca a presença em Engajamento → Confirmar Presença.',
  },
  'fechamento': {
    titulo: 'Fechamento',
    texto: 'Fecha o mês de cada professor: soma as aulas dadas, aplica ocorrências e congela os valores pro pagamento. '
         + 'Depois de fechado, o mês não muda mais — confira antes de confirmar.',
  },
  'agenda': {
    titulo: 'Grade de Horários',
    texto: 'Esta é a grade fixa da semana: qual professor dá qual aula, em que dia e horário. '
         + 'As aulas do dia a dia são geradas automaticamente a partir daqui — toda segunda, para as 8 semanas seguintes. '
         + 'Com pressa? O botão "Gerar agenda agora" cria as aulas na hora. '
         + 'Mudou um horário? O sistema pergunta se você quer aplicar às aulas futuras já criadas. '
         + 'Trocou o dia da semana? As aulas futuras são movidas junto, também com confirmação. '
         + 'Em qualquer caso, aula já substituída, cancelada ou de mês fechado nunca é alterada.',
  },
  'engaj-config': {
    titulo: 'Config. Pontos',
    texto: 'Define quanto vale cada coisa no Placar: presença em reunião, treinamento, evento interno, liderar a Escola Interna, e as penalidades. '
         + 'Mudar aqui vale pros lançamentos novos — o que já foi pontuado não é recalculado.',
  },
  'pessoas': {
    titulo: 'Pessoas',
    texto: 'Cadastro único de todo mundo: dados, perfil de acesso, unidade e modalidades. '
         + 'A aba salarial só aparece pra administrador. Para tirar o acesso de alguém que saiu, use Desligar — o login é bloqueado na hora e o histórico é preservado.',
  },
};

/* ─── API ───────────────────────────────────────────────────────── */

/** Perfil de manual da pessoa logada: 'admin' (gestão) ou 'prof'. */
function ajudaPerfil() {
  const profiles = (typeof AppState === 'object' && AppState.userProfile)
    ? (AppState.userProfile.profiles || [AppState.userProfile.role])
    : [];
  return (profiles || []).some(p => p === 'admin' || p === 'supervisao') ? 'admin' : 'prof';
}

/** URL do manual do perfil, na âncora da tela quando existir. */
function ajudaUrl(pageId) {
  const perfil = ajudaPerfil();
  const arquivo = perfil === 'admin' ? 'manual-admin.html' : 'manual-professores.html';
  const entry = AJUDA_MAP[pageId || (typeof AppState === 'object' ? AppState.currentPage : '')];
  const anchor = entry ? entry[perfil] : null;
  return anchor ? `${arquivo}#${anchor}` : arquivo;
}

/** Abre o manual completo em nova aba (menu "Ajuda"). */
function abrirManual(pageId) {
  window.open(ajudaUrl(pageId), '_blank', 'noopener');
}

/**
 * HTML do botão "?" pra colar ao lado do título da tela.
 * Uso: `<h1>Título ${ajudaBtn('engaj-chamada')}</h1>`
 */
function ajudaBtn(pageId) {
  if (!AJUDA_BLURBS[pageId]) return '';
  return `<button type="button" class="ajuda-btn" onclick="toggleAjuda('${pageId}')"
            aria-label="Ajuda sobre esta tela" title="O que faço nesta tela?">?</button>`;
}

/** Abre/fecha o balão de ajuda da tela. */
function toggleAjuda(pageId) {
  const existente = document.getElementById('ajudaPopover');
  if (existente) { existente.remove(); return; }
  const blurb = AJUDA_BLURBS[pageId];
  if (!blurb) return;

  const el = document.createElement('div');
  el.id = 'ajudaPopover';
  el.className = 'ajuda-popover';
  el.innerHTML = `
    <div class="ajuda-popover-hdr">
      <strong>${blurb.titulo}</strong>
      <button type="button" class="ajuda-popover-x" onclick="toggleAjuda()" aria-label="Fechar">×</button>
    </div>
    <p>${blurb.texto}</p>
    <a href="${ajudaUrl(pageId)}" target="_blank" rel="noopener">Ver no manual completo →</a>`;
  document.body.appendChild(el);

  // Fecha ao clicar fora — sem listener global permanente.
  setTimeout(() => {
    const fora = (ev) => {
      if (!el.contains(ev.target) && !ev.target.classList.contains('ajuda-btn')) {
        el.remove();
        document.removeEventListener('click', fora);
      }
    };
    document.addEventListener('click', fora);
  }, 0);
}
