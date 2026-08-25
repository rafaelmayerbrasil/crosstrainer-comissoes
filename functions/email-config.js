// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Quais avisos também viram e-mail, e como o e-mail é montado
//
// Puro (sem Firestore, sem rede). Quem envia é a extensão do Firebase lendo a
// coleção `mail`; aqui só se decide SE envia e COMO fica o texto.
//
// Regra do Rafael (24/08/2026): só o que tem PRAZO ou DINHEIRO vai por e-mail.
// O resto continua no sino do app. E-mail demais treina a pessoa a ignorar —
// e aí ela perde justamente o que importava.
//
// Nasce DESLIGADO e em modo de teste. E-mail chega em gente de verdade e não
// tem desfazer: enquanto o modo de teste estiver ligado, tudo vai para um
// endereço só, com uma tarja dizendo para quem teria ido.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const REMETENTE_NOME = 'CrossTainer';

/**
 * Os quatro eventos escolhidos. Cada um tem assunto próprio — o assunto é o
 * que decide se a pessoa abre, e "Notificação do sistema" não decide nada.
 */
const TIPOS_POR_EMAIL = {
  scale_confirmed:        { assunto: 'Sua escala foi confirmada',        urgencia: 'prazo' },
  substitution_requested: { assunto: 'Uma troca de aula espera você',    urgencia: 'prazo' },
  vacation_approved:      { assunto: 'Suas férias foram aprovadas',      urgencia: 'dinheiro' },
  vacation_rejected:      { assunto: 'Seu pedido de férias foi recusado', urgencia: 'dinheiro' },
  recibo_emitido:         { assunto: 'Seu recibo do mês está disponível', urgencia: 'dinheiro' },
};

/** O aviso deste tipo deve virar e-mail, com a configuração atual? */
function deveEnviar(notif, config) {
  if (!config || config.ativo !== true) return false;   // sem config = desligado
  if (!notif || !notif.type) return false;
  return Object.prototype.hasOwnProperty.call(TIPOS_POR_EMAIL, notif.type);
}

/**
 * Para onde este e-mail vai de verdade.
 * Em modo de teste, desvia tudo para o endereço de teste — e se não houver
 * endereço de teste configurado, não envia para ninguém (jamais cai no
 * professor por engano).
 * @returns {{para: string|null, avisoTeste: string}}
 */
function destinatario(emailDaPessoa, config) {
  const limpo = (emailDaPessoa || '').trim();
  const valido = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(limpo) ? limpo : null;

  if (config && config.modoTeste === true) {
    const teste = (config.emailTeste || '').trim();
    if (!teste) return { para: null, avisoTeste: '' };
    return {
      para: teste,
      avisoTeste: `[TESTE] Este e-mail iria para: ${valido || '(pessoa sem e-mail)'}`,
    };
  }
  return { para: valido, avisoTeste: '' };
}

function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Monta assunto + texto + html. Devolve null quando não há para quem enviar —
 * melhor não enviar do que enviar para o vazio.
 * @param {object} notif   {type, title, body}
 * @param {object} pessoa  {nome, email}
 * @param {object} config  {ativo, modoTeste, emailTeste}
 */
function montarEmail(notif, pessoa, config) {
  if (!notif || !pessoa) return null;
  const meta = TIPOS_POR_EMAIL[notif.type];
  if (!meta) return null;

  const dest = destinatario(pessoa.email, config);
  if (!dest.para) return null;

  const primeiroNome = String(pessoa.nome || '').trim().split(/\s+/)[0] || 'Olá';
  const corpo = String(notif.body || notif.title || '').trim();

  const linhas = [
    `${primeiroNome},`,
    '',
    corpo,
    '',
    'Você pode conferir tudo no sistema, em Professores.',
    '',
    '— CrossTainer',
  ];
  if (dest.avisoTeste) linhas.unshift(dest.avisoTeste, '');

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:520px;">
  ${dest.avisoTeste ? `<div style="background:#fff3cd;border:1px solid #e0b400;border-radius:6px;padding:8px 10px;margin-bottom:14px;font-size:13px;">${escapar(dest.avisoTeste)}</div>` : ''}
  <p style="margin:0 0 12px;">${escapar(primeiroNome)},</p>
  <p style="margin:0 0 16px;font-size:16px;"><strong>${escapar(corpo)}</strong></p>
  <p style="margin:0 0 16px;color:#555;">Você pode conferir tudo no sistema, em Professores.</p>
  <p style="margin:0;color:#888;font-size:13px;">— ${escapar(REMETENTE_NOME)}</p>
</div>`;

  return {
    para: dest.para,
    subject: meta.assunto,
    text: linhas.join('\n'),
    html,
  };
}

module.exports = { REMETENTE_NOME, TIPOS_POR_EMAIL, deveEnviar, destinatario, montarEmail };
