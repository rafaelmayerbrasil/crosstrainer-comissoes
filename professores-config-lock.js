/**
 * Trava de leitura das telas de configuração (13/08/2026).
 *
 * Por que existe: Config. Pontos e PLR · Config definem regras que valem pro
 * placar, pro PLR e, no fim, pro bolso das pessoas. São telas que se ajustam
 * uma vez e quase não se mexe — mas ficavam abertas pra edição direta, então
 * bastava um clique curioso pra alterar valor sem perceber (Rafael, 13/08).
 *
 * A tela passa a abrir MOSTRANDO os valores, sem editar. Pra mudar, a pessoa
 * clica em "Editar configuração" de propósito. Não é controle de acesso — quem
 * chega aqui já é admin —, é proteção contra mudança acidental.
 *
 * Como usar numa tela:
 *   1. no começo do render:  const editando = configLockInit('engaj-config', renderMinhaPagina);
 *   2. no HTML, logo abaixo do título:  ${configLockBanner('engaj-config')}
 *   3. marque os botões que ALTERAM com data-cfg-edit  (somem no modo leitura)
 *   4. no fim do render:  configLockApply('engaj-config');
 *
 * Os campos (input/select/textarea) são travados pelo passo 4 — não precisa
 * marcar um por um, senão toda configuração nova nasceria desprotegida por
 * esquecimento.
 */

'use strict';

// pageId → { editing, rerender }
const CONFIG_LOCK_STATE = {};

/** Registra a tela e devolve se ela está em modo edição. Padrão: leitura. */
function configLockInit(pageId, rerenderFn) {
  const s = CONFIG_LOCK_STATE[pageId] || (CONFIG_LOCK_STATE[pageId] = { editing: false });
  if (rerenderFn) s.rerender = rerenderFn;
  return s.editing;
}

function configLockEditing(pageId) {
  return !!(CONFIG_LOCK_STATE[pageId] && CONFIG_LOCK_STATE[pageId].editing);
}

/** Liga/desliga a edição e redesenha a tela. */
function configLockSet(pageId, editing) {
  const s = CONFIG_LOCK_STATE[pageId];
  if (!s) return;
  s.editing = !!editing;
  if (typeof s.rerender === 'function') s.rerender();
}

/**
 * Faixa acima do conteúdo. Em leitura explica por que está travado; em edição
 * avisa que agora vale, e deixa sair sem salvar.
 */
function configLockBanner(pageId) {
  if (configLockEditing(pageId)) {
    return `
      <div class="cfg-lock cfg-lock-on">
        <span class="cfg-lock-ico">✏️</span>
        <div class="cfg-lock-txt">
          <strong>Editando a configuração.</strong>
          As mudanças só valem depois de clicar em <strong>Salvar</strong>.
        </div>
        <button type="button" class="btn-secondary btn-sm" onclick="configLockSet('${pageId}', false)">Sair sem salvar</button>
      </div>`;
  }
  return `
    <div class="cfg-lock">
      <span class="cfg-lock-ico">🔒</span>
      <div class="cfg-lock-txt">
        <strong>Somente leitura.</strong>
        Estes valores mudam o placar e o PLR de todo mundo — por isso não dá pra alterar sem querer.
      </div>
      <button type="button" class="btn-primary btn-sm" onclick="configLockSet('${pageId}', true)">✏️ Editar configuração</button>
    </div>`;
}

/**
 * Aplica a trava no que já foi renderizado. Chamar no FIM do render.
 * Trava todo campo de formulário e esconde os botões marcados com data-cfg-edit.
 */
function configLockApply(pageId) {
  const container = document.getElementById('page-' + pageId);
  if (!container) return;
  const editando = configLockEditing(pageId);

  container.querySelectorAll('input, select, textarea').forEach(el => {
    el.disabled = !editando;
  });
  container.querySelectorAll('[data-cfg-edit]').forEach(el => {
    el.style.display = editando ? '' : 'none';
  });
}

// Node (smoke test) — no browser as funções já são globais.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG_LOCK_STATE, configLockInit, configLockEditing, configLockSet, configLockBanner, configLockApply };
}
