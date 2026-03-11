const fs = require('fs');
const path = require('path');

// Mock CommissionEngine if needed or load it from file
const commissionJsPath = path.resolve('c:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes/commission.js');
const commissionJsContent = fs.readFileSync(commissionJsPath, 'utf8');

// The file defines CommissionEngine as a global const. We can eval it or simulate it.
let CommissionEngine;
eval(commissionJsContent.replace('const CommissionEngine', 'CommissionEngine'));

const testCases = [
  { item: '1 AULA AVULSA', tipoVenda: 'Novo', expected: 'avulsa' },
  { item: 'AULA AVULSA', tipoVenda: 'Renovacao', expected: 'avulsa' },
  { item: 'PACOTE 10 AULAS', tipoVenda: 'Venda direta', expected: 'avulsa' },
  { item: '1 DIÁRIA', tipoVenda: 'Novo', expected: 'avulsa' },
  { item: 'DIARIA AVULSA', tipoVenda: 'Renovacao', expected: 'avulsa' },
  { item: '10 AULAS (01/01/2026)', tipoVenda: 'Novo', expected: 'avulsa' },
];

console.log('--- Iniciando Testes de Detecção de Aula Avulsa ---');
let successCount = 0;

testCases.forEach((tc, i) => {
  const row = { 'Itens': tc.item, 'Tipo de Venda': tc.tipoVenda };
  const info = CommissionEngine.classifyRow(row);
  const result = info.category;
  
  if (result === tc.expected) {
    console.log(`✅ Teste ${i+1}: "${tc.item}" (${tc.tipoVenda}) -> ${result} [OK]`);
    successCount++;
  } else {
    console.log(`❌ Teste ${i+1}: "${tc.item}" (${tc.tipoVenda}) -> ESPERADO: ${tc.expected}, OBTIDO: ${result} [FALHA]`);
  }
});

console.log(`\nResultado: ${successCount}/${testCases.length} testes passaram.`);
if (successCount === testCases.length) {
  process.exit(0);
} else {
  process.exit(1);
}
