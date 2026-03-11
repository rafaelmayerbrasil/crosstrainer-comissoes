const CommissionEngine = require('./commission.js');

const mockRows = [
  {
    'Cliente': 'BRUNA FERNANDA RUSSI',
    'Itens': '2 AULAS (28/02/2026 - 07/03/2026)',
    'Tipo de Venda': 'Renovação',
    'Valor Quitado/Recibo': 100,
    'Data': '28/02/2026',
    'Vendedor': 'FRANCINI'
  },
  {
    'Cliente': 'BEBIDAS E OUTROS',
    'Itens': '2 AULAS (24/02/2026 - 03/03/2026)',
    'Tipo de Venda': 'Renovação',
    'Valor Quitado/Recibo': 100,
    'Data': '25/02/2026',
    'Vendedor': 'FRANCINI'
  },
  {
    'Cliente': 'TAINAN BAGETTI',
    'Itens': '1 AULA (19/02/2026 - 26/02/2026)',
    'Tipo de Venda': 'Venda Nova',
    'Valor Quitado/Recibo': 60,
    'Data': '19/02/2026',
    'Vendedor': 'FRANCINI'
  }
];

const result = CommissionEngine.calculate(mockRows, {});

console.log('--- Resultados de Teste ---');
result.processed.forEach(p => {
  console.log(`Cliente: ${p.cliente}`);
  console.log(`Item: ${p.item}`);
  console.log(`Categoria: ${p.category}`);
  console.log(`P1 %: ${p.p1pct * 100}%`);
  console.log(`P1 Valor: R$ ${p.p1valor.toFixed(2)}`);
  console.log('---');
});

const allFivePercent = result.processed.every(p => p.p1pct === 0.05);
console.log(`Todos com 5%? ${allFivePercent ? 'SIM' : 'NÃO'}`);

if (!allFivePercent) {
  process.exit(1);
}
