'use strict';
// Firestore fake mínimo p/ smokes Node. Só o subconjunto usado pelo EngagementService.
// NÃO é produção — apenas test support.
module.exports = function makeFakeDb() {
  const store = {}; // store[col] = { id: data }
  const col = (name) => (store[name] = store[name] || {});
  let auto = 0;

  function docRef(name, id) {
    return {
      _col: name, _id: id, id,
      async get() {
        const data = col(name)[id];
        return { exists: data !== undefined, id, data: () => data };
      },
      async set(obj, opts) {
        const clone = JSON.parse(JSON.stringify(obj));
        if (opts && opts.merge) col(name)[id] = Object.assign({}, col(name)[id] || {}, clone);
        else col(name)[id] = clone;
      },
      async delete() { delete col(name)[id]; },
    };
  }

  function query(name, filters, order) {
    return {
      where(field, op, val) { return query(name, filters.concat([[field, op, val]]), order); },
      orderBy(field) { return query(name, filters, field); },
      async get() {
        let rows = Object.keys(col(name)).map(id => ({ id, data: () => col(name)[id] }));
        filters.forEach(([f, op, v]) => { rows = rows.filter(r => r.data()[f] === v); });
        if (order) rows.sort((a, b) => (a.data()[order] > b.data()[order] ? 1 : a.data()[order] < b.data()[order] ? -1 : 0));
        return { docs: rows };
      },
    };
  }

  return {
    collection(name) {
      const q = query(name, [], null);
      return {
        doc(id) { return docRef(name, id || `auto_${++auto}`); },
        async add(obj) { const id = `auto_${++auto}`; await docRef(name, id).set(obj); return { id }; },
        where: q.where, orderBy: q.orderBy, get: q.get,
      };
    },
    batch() {
      const ops = [];
      return { set(ref, obj) { ops.push([ref, obj]); }, async commit() { for (const [ref, obj] of ops) await ref.set(obj); } };
    },
  };
};
