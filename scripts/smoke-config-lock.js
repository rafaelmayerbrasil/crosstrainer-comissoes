'use strict';
// Smoke da trava de leitura das telas de configuração (13/08/2026).
//
// O que precisa ser verdade: a tela NASCE travada. Se algum dia alguém inverter
// o padrão, Config. Pontos e PLR · Config voltam a ficar editáveis de cara — que
// é exatamente o que o Rafael pediu pra evitar.
//
// Roda: node scripts/smoke-config-lock.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const Lock = require('../professores-config-lock.js');

// ════════════════ 1. nasce em modo leitura ════════════════
{
  const editando = Lock.configLockInit('tela-x', () => {});
  assert.strictEqual(editando, false, 'tela de configuração tem que NASCER travada');
  assert.strictEqual(Lock.configLockEditing('tela-x'), false);
  console.log('✓ nasce em somente leitura');
}

// ════════════════ 2. liga/desliga e avisa a tela pra redesenhar ════════════════
{
  let redesenhos = 0;
  Lock.configLockInit('tela-y', () => { redesenhos++; });

  Lock.configLockSet('tela-y', true);
  assert.strictEqual(Lock.configLockEditing('tela-y'), true, 'deve entrar em edição');
  assert.strictEqual(redesenhos, 1, 'entrar em edição precisa redesenhar a tela');

  Lock.configLockSet('tela-y', false);
  assert.strictEqual(Lock.configLockEditing('tela-y'), false, 'deve voltar pra leitura');
  assert.strictEqual(redesenhos, 2, 'sair da edição também redesenha');
  console.log('✓ alterna entre leitura e edição, redesenhando a cada troca');
}

// ════════════════ 3. cada tela tem trava própria ════════════════
// Destravar Config. Pontos não pode destravar o PLR junto.
{
  Lock.configLockInit('tela-a', () => {});
  Lock.configLockInit('tela-b', () => {});
  Lock.configLockSet('tela-a', true);
  assert.strictEqual(Lock.configLockEditing('tela-a'), true);
  assert.strictEqual(Lock.configLockEditing('tela-b'), false,
    'destravar uma tela não pode destravar a outra');
  console.log('✓ trava é independente por tela');
}

// ════════════════ 4. o texto da faixa muda conforme o estado ════════════════
{
  Lock.configLockInit('tela-c', () => {});
  const leitura = Lock.configLockBanner('tela-c');
  assert.ok(/Somente leitura/i.test(leitura), 'faixa de leitura precisa dizer que está travado');
  assert.ok(/Editar configura/i.test(leitura), 'faixa de leitura precisa oferecer o botão de editar');

  Lock.configLockSet('tela-c', true);
  const edicao = Lock.configLockBanner('tela-c');
  assert.ok(/Editando/i.test(edicao), 'faixa de edição precisa avisar que está editando');
  assert.ok(/Salvar/i.test(edicao), 'faixa de edição precisa lembrar que só vale ao salvar');
  console.log('✓ a faixa explica o estado em que a tela está');
}

// ════════════════ 5. as telas reais estão plugadas ════════════════
// Sem isso o componente existe mas ninguém usa — o bug volta em silêncio.
{
  // Só os handlers DESTAS telas. Varrer o arquivo inteiro daria falso positivo:
  // professores-engajamento.js também tem a tela Confirmar Presença, que é do
  // dia a dia e NÃO pode ser travada.
  const casos = [
    {
      arquivo: 'professores-engajamento.js', pageId: 'engaj-config', tela: 'Config. Pontos',
      handlers: ['saveEngajConfig', 'addEngajCycle', 'removeEngajCycle'],
    },
    {
      arquivo: 'professores-plr.js', pageId: 'plr-config', tela: 'PLR · Config',
      handlers: ['salvarPlrConfig', 'plrAddAvaliador', 'plrRemoveAvaliador'],
    },
  ];

  casos.forEach(({ arquivo, pageId, tela, handlers }) => {
    const src = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
    assert.ok(src.includes(`configLockInit('${pageId}'`), `${tela}: falta configLockInit`);
    assert.ok(src.includes(`configLockBanner('${pageId}')`), `${tela}: falta a faixa na tela`);
    assert.ok(src.includes(`configLockApply('${pageId}')`), `${tela}: falta configLockApply no fim do render`);

    handlers.forEach(fn => {
      const botoes = src.match(new RegExp(`<button[^>]*onclick="${fn}\\(`, 'g')) || [];
      assert.ok(botoes.length > 0, `${tela}: não achei o botão de ${fn} — o teste envelheceu junto com a tela`);
      // pega a tag inteira pra conferir o atributo
      const tags = src.match(new RegExp(`<button[^>]*onclick="${fn}\\([^"]*"[^>]*>`, 'g')) || [];
      tags.forEach(btn => assert.ok(/data-cfg-edit/.test(btn),
        `${tela}: botão de ${fn} sem data-cfg-edit — ficaria clicável com a tela travada: ${btn}`));
    });
    console.log(`✓ ${tela} plugada na trava (${handlers.length} ações protegidas)`);
  });
}

// ════════════════ 6. o script está carregado na página ════════════════
{
  const html = fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8');
  assert.ok(/professores-config-lock\.js/.test(html),
    'professores.html precisa carregar o professores-config-lock.js');
  assert.ok(/\.cfg-lock\s*\{/.test(html), 'falta o CSS .cfg-lock');
  console.log('✓ script e CSS registrados no professores.html');
}

console.log('\n✅ smoke-config-lock OK');
