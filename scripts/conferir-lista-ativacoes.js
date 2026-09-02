// ═══════════════════════════════════════════════════════════════
// Confere a lista de ativações que as vendedoras mandam no grupo
// contra o que o tradutor produziu a partir do export da Pacto
// ═══════════════════════════════════════════════════════════════
//
//   node scripts/conferir-lista-ativacoes.js
//
// SOMENTE LEITURA. Lê as planilhas PACTO-<mês>-CP/PP.xlsx já geradas.
//
// Por que existe: sob regime de CAIXA a lista das vendedoras (que é por data
// da VENDA) e o fechamento (que é por data do RECEBIMENTO) não batem linha a
// linha, e isso é o desenho funcionando. Este script mostra ONDE não batem e
// por quê — é a conferência que o Rodrigo pediu em 01/09/2026.
//
// ⚠️ A lista abaixo é a de AGOSTO/2026, colada do grupo. Trocar a cada mês.
//    Achado de 01/09: a lista cobre 39 nomes, mas o mês tem muito mais — há
//    vendas da Francini, Kali, Bárbara e Rodrigo Rojais que não estão nela.
//    Ela NÃO é o gabarito do mês; é uma das três fontes.
//
// Conferência: lista das vendedoras (ativações de agosto) × o que o tradutor produziu
const { readXlsx } = require('./lib-xlsx-min.js');

const norm = s => String(s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z ]/g,'').replace(/\s+/g,' ').trim();

const LISTA = {
  'CP-NOVO': ['HELVECIO CORDEIRO DA SILVA','RAONI PENNA FIRME DE MELO','HENRIQUE LENTZ BAGETTI','JULIA DEL FABRO','RAFAEL FERREIRA DEL FABRO','ERIKA ALMEIDA','GABRIELA MENIN MACHADO','PEDRO HENRIQUE SCHONARTH','MARIANA BARROSO LUPIANHES','JORGE DUARTE','LUIZA FERNANDA DA CRUZ','KERRY RANDOLPH JOHNSON','VERONICA MITCHELLE MARTINEZ ALAS','JORGE EDUARDO SANCHEZ NUNEZ','MARIANA TROIANI DIAS','JULIA CAUANE DOS SANTOS','CARINA VALENDORF RETORE','BERNARDO DO NASCIMENTO KASSICK','JOAO FILIPE VIEIRA FERNANDES','JESSICA SORCE MARTINS DE CASTRO','FELIPE RODRIGUES LIMA','BRENO AURELIO HATSCHBACH','BEATRIZ MIRANDA CAMPOS GRACIA','DIETER MESQUITA GEHROLD'],
  'PP-NOVO': ['LORENZO PACHECO'],
  'CP-RENOV': ['CARLOS EDUARDO GONCALVES DA COSTA','RAYKE HECKLEL','MARIANA PAULA ZANINI','GIAN GIAROLI','MARIANA ODONNELL'],
  'PP-RENOV': ['MARIANA MINGHELLI BECKER'],
  'DEGUST': ['ANA LUIZA BRESEGHELLO PELOSINI','LORENZO PACHECO','ESTEFANE COUTINHO CAMPOS','DEBORA RIBEIRO','MARCIANE DE SOUSA ANDRADE','MIGUEL ANDRIONI STADLER','GIRLAINY XAVIER','OWEN PHILLIPS','BRUNO CARVALHO DE MELO'],
};

// tudo que o tradutor PRODUZIU (entrou na planilha)
const produzido = new Map();
for (const [un, f] of [['CP','relatorios pacto/PACTO-2026-08-CP.xlsx'],['PP','relatorios pacto/PACTO-2026-08-PP.xlsx']]) {
  const wb = readXlsx(f); const sh = wb.sheet(wb.sheetNames[0]);
  Object.keys(sh).map(Number).sort((a,b)=>a-b).slice(1).forEach(k => {
    const r = sh[k]; if (!r) return;
    const n = norm(r[1]); if (!n) return;
    if (!produzido.has(n)) produzido.set(n, []);
    produzido.get(n).push({ un, data: r[2], item: String(r[3]||''), valor: r[4], tipo: r[10]||'', vend: r[11]||'' });
  });
}

console.log('=== A. CADA NOME DA LISTA DAS VENDEDORAS ===\n');
const faltando = [];
for (const [grupo, nomes] of Object.entries(LISTA)) {
  console.log(`-- ${grupo} (${nomes.length}) --`);
  nomes.forEach(nm => {
    const linhas = produzido.get(norm(nm));
    if (!linhas) { console.log(`  ❌ ${nm}  — NAO ESTA NA PLANILHA`); faltando.push([grupo, nm]); }
    else {
      const contrato = linhas.filter(l => /\|/.test(l.item));
      const alvo = contrato.length ? contrato : linhas;
      console.log(`  ✅ ${nm.padEnd(34)} ${alvo.map(l=>`${l.un} ${l.data} R$${l.valor} ${l.tipo||'(sem tipo)'}`).join(' + ')}`);
    }
  });
  console.log('');
}
console.log(`\nFALTANDO NA PLANILHA: ${faltando.length}`);
faltando.forEach(([g,n]) => console.log(`  ${g}  ${n}`));
