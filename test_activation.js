const CommissionEngine = require('./commission.js');

const mockRow = {
  'Itens': 'SEMESTRAL, TREINO HIIT/MAROMBINHA ATÉ 3X/SEMANA (02/02/2026 - 02/08/2026)',
  'Tipo de Venda': 'Novo',
  'Vendedor': 'LOYSE OLIVEIRA',
  'Valor Quitado/Recibo': 594.00,
  'Data': '02/02/2026'
};

console.log('--- Teste 1: Configuração padrão (sem SEMESTRAL) ---');
const res1 = CommissionEngine.classifyRow(mockRow);
console.log('Is Activation:', res1.isActivation);
console.log('Category:', res1.category);

console.log('\n--- Teste 2: Configuração com SEMESTRAL ---');
const customConfig = {
  ...CommissionEngine.defaultConfig,
  planosAtivacao: ['BIANUAL', 'ANUAL', 'RECORRENTE', 'MENSAL', 'SEMESTRAL']
};

// Precisamos usar processRows para que a currentConfig seja setada
const result = CommissionEngine.processRows([mockRow], customConfig);
const processedItem = result.processed[0];
console.log('Is Activation (Processed):', processedItem.isActivation);
console.log('Category (Processed):', processedItem.category);

if (processedItem.isActivation === true && processedItem.category === 'novo') {
  console.log('\n✅ SUCESSO: O plano SEMESTRAL foi reconhecido corretamente!');
} else {
  console.log('\n❌ FALHA: O plano SEMESTRAL não foi reconhecido.');
  process.exit(1);
}
