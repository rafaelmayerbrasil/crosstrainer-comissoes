'use strict';
// Cenário de teste da gravação do mês das comissões (30/09/2026) — dados INVENTADOS.
//
// Usado por scripts/smoke-comissoes-mes-paridade.js: o MESMO cenário roda pelo
// código antigo da tela (referência congelada) e pelo módulo comissoes-mes.js, e
// o banco tem que sair igual. Três passos: 1ª carga do mês · recarga com uma venda
// a menos, uma a mais e um valor mudado · recálculo depois de editar a vendedora.

const path = require('path');
const raiz = path.join(__dirname, '..');
const L = require(path.join(raiz, 'pacto-api-linhas.js'));

const MES = '2026-10';
const UNIT = 'unit-pp';

function linha(o) {
  const l = new Array(L.TAMANHO_LINHA).fill('');
  const put = (k, v) => { l[L.COL[k]] = v == null ? '' : v; };
  put('matricula', o.mat || ''); put('nome', o.nome); put('cadastro', '01/01/2026');
  put('resp1', o.resp1 || o.consultor || ''); put('resp2', o.resp2 || o.resp1 || o.consultor || '');
  put('produto', o.produto || o.plano || ''); put('contrato', o.contrato || '0');
  put('inicio', o.inicio || ''); put('termino', o.termino || ''); put('duracao', o.duracao || '');
  put('plano', o.plano || ''); put('situacao', o.situacao || ''); put('lancamento', o.dia);
  put('valor', o.valor); put('forma', o.forma || 'PIX'); put('empresa', L.EMPRESA.PP);
  put('consultor', o.consultor || '');
  return l;
}

const V1 = 'VENDEDORA TESTE UM', V2 = 'VENDEDORA TESTE DOIS', NOVA = 'VENDEDORA TESTE NOVA', ROD = 'RODRIGO ROJAIS';

function linhasPasso1() {
  return [
    linha({ nome: 'CLIENTE A', contrato: '9101', plano: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO.', situacao: 'Matrícula', inicio: '02/10/2026', termino: '01/10/2027', duracao: '12', dia: '02/10/2026', valor: '329,00', consultor: V1, forma: 'CARTÃO RECORRENTE' }),
    linha({ nome: 'CLIENTE B', contrato: '9102', plano: 'ACESSO LIVRE | RECORRENTE | FLEX | ILIMITADO | PADRÃO.', situacao: 'Renovação', inicio: '03/10/2026', termino: '02/11/2026', duracao: '1', dia: '03/10/2026', valor: '419,00', consultor: V2 }),
    linha({ nome: 'CLIENTE C', contrato: '9103', plano: 'MÊS DEGUSTAÇÃO LIVRE.', situacao: 'Matrícula', inicio: '04/10/2026', termino: '03/11/2026', duracao: '1', dia: '04/10/2026', valor: '89,00', consultor: V1 }),
    linha({ nome: 'CLIENTE D', contrato: '9104', plano: 'ECONÔMICO | SEMESTRAL | FLEX | ILIMITADO | PADRÃO.', situacao: 'Rematrícula', inicio: '05/10/2026', termino: '04/04/2027', duracao: '6', dia: '05/10/2026', valor: '239,00', consultor: ROD, resp1: V2, resp2: V2 }),
    linha({ nome: 'CLIENTE E', contrato: '9105', plano: 'HIIT/MAROMBINHA | RECORRENTE | 3X | PADRÃO.', situacao: 'Matrícula', inicio: '06/10/2026', termino: '05/11/2026', duracao: '1', dia: '06/10/2026', valor: '309,00', consultor: NOVA }),
    linha({ nome: 'CLIENTE F', contrato: '0', produto: 'MONSTER', dia: '06/10/2026', valor: '12,00', consultor: V1 }),
    linha({ nome: 'CLIENTE F', contrato: '0', produto: 'MONSTER', dia: '06/10/2026', valor: '12,00', consultor: V1 }),
    linha({ nome: 'CLIENTE G', contrato: '9107', plano: 'IMPORTAÇÃO', produto: 'IMPORTAÇÃO', situacao: 'Rematrícula', inicio: '10/03/2026', termino: '09/03/2027', duracao: '12', dia: '07/10/2026', valor: '199,00', consultor: V2 }),
    linha({ nome: 'CLIENTE H', contrato: '9108', plano: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO.', situacao: 'Renovação', inicio: '08/10/2026', termino: '07/10/2027', duracao: '12', dia: '08/10/2026', valor: '329,00', consultor: V2 }),
  ];
}

function linhasPasso2() {
  const l = linhasPasso1().filter(x => x[L.COL.contrato] !== '9105');          // uma venda a menos
  l.find(x => x[L.COL.contrato] === '9102')[L.COL.valor] = '399,00';           // valor mudado
  l.push(linha({ nome: 'CLIENTE I', contrato: '9109', plano: 'ACESSO LIVRE | RECORRENTE | FLEX | ILIMITADO | PADRÃO.', situacao: 'Matrícula', inicio: '09/10/2026', termino: '08/11/2026', duracao: '1', dia: '09/10/2026', valor: '419,00', consultor: V1 }));
  return l;
}

/** O banco antes do passo 1: unidade, vendedoras, o mês anterior (P4) e metas do mês */
async function semear(db) {
  await db.collection('units').doc(UNIT).set({ name: 'PP', config: { meta: 40, superMeta: 46, metaGold: 52 } });
  await db.collection('users').doc('u1').set({ name: V1, role: 'vendedor', allowedUnits: [UNIT], unitId: UNIT, status: 'ativo', jornadasComerciais: [{ desde: '2026-10', tipo: 'integral' }] });
  await db.collection('users').doc('u2').set({ name: V2, role: 'vendedor', allowedUnits: ['unit-cp'], unitId: 'unit-cp', status: 'ativo' });
  await db.collection('users').doc('u3').set({ name: ROD, role: 'admin', allowedUnits: [UNIT, 'unit-cp'], status: 'ativo' });
  await db.collection('periodos').doc(UNIT + '_2026-09').set({ unitId: UNIT, year: 2026, month: 9, uploadId: 'up9', codigosPagos: ['C9001'] });
  await db.collection('periodos').doc(UNIT + '_2026-09').collection('itens').doc('d1').set({
    type: 'processed', uploadId: 'up9', codigo: 'C9002', cliente: 'CLIENTE B', vendedor: V2, data: '10/09/2026',
    item: 'MÊS DEGUSTAÇÃO LIVRE.', valorCaixa: 89, category: 'voucher', isDegustacao: true, isContract: true, isActivation: true });
  await db.collection('periodos').doc(UNIT + '_' + MES).set({ unitId: UNIT, year: 2026, month: 10,
    metasMensais: { meta: 40, superMeta: 46, metaGold: 52, minNovos: 2, minRenov: 1, minVoucher: 1 },
    metaSugerida: { origem: 'sistema', revisadaPor: 'admin@teste' } });
}

module.exports = { MES, UNIT, V1, V2, NOVA, linhasPasso1, linhasPasso2, semear, comCabecalho: ls => L.comCabecalho(ls) };
