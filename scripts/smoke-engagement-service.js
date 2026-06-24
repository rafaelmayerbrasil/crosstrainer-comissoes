'use strict';
// Roda: node scripts/smoke-engagement-service.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const ES = require('../engagement-service.js');
const EC = require('../engagement-config.js');
const PE = require('../points-engine.js');

// deps injetadas: db fake + timestamp/uid determinísticos + engine/config
function mkDeps(db) { return { db, ts: () => 'TS', uid: () => 'tester', PE, EC }; }

(async () => {
  const db = makeFakeDb();
  const deps = mkDeps(db);

  // getConfig sem doc → defaults
  let r = await ES.getConfig(deps);
  assert.ok(r.success && r.data.pts.reuniaoStaff === 8, 'getConfig defaults');

  // saveConfig grava overrides; getConfig mescla
  await ES.saveConfig({ pts: { reuniaoStaff: 12 } }, deps);
  r = await ES.getConfig(deps);
  assert.strictEqual(r.data.pts.reuniaoStaff, 12, 'override aplicado');
  assert.strictEqual(r.data.pts.escolaInternaParticipar, 1, 'demais preservados');

  console.log('✓ smoke-engagement-service: config OK');
})();
