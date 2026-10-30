/* Readonly version observation in the existing DB5 control store; never publishes identity. */
(function (root) {
  'use strict';
  async function open(indexedDB) {
    var R = root.PokerCareerIndexedStore.routing, db = await R.openDatabase(indexedDB);
    function request(r) { return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error); }; }); }
    return Object.freeze({ read: async function () {
      var tx = await R.transaction(db, [R.controlStore], 'readonly');
      var completion = new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onabort = tx.onerror = function () { reject(tx.error || Error('Revision authority unavailable')); }; });
      completion.catch(function () {});
      try {
        var rows = await Promise.all([request(tx.objectStore(R.controlStore).get([root.PokerPlayerIdentityStore.NAMESPACE, 'control'])), request(tx.objectStore(R.controlStore).get(root.PokerPlayerIdentityEligibility.key('control')))]);
        var id = rows[0];
        if (id && (id.schemaVersion !== 1 || !Number.isSafeInteger(id.identityRevision) || id.identityRevision < 0 || Object.keys(id).sort().join(',') !== 'identityRevision,key,schemaVersion')) throw Error('Invalid identity revision');
        if (typeof tx.route.ledgerRevision !== 'string' || !tx.route.ledgerRevision) throw Error('Missing Career revision');
        var value = { route: structuredClone(tx.route), identityRevision: id ? id.identityRevision : 0, publishedControl: rows[1] || null };
        await completion; return value;
      } catch (e) { try { tx.abort(); } catch (_) {} await completion.catch(function () {}); throw e; }
    }, close: function () { db.close(); } });
  }
  root.PokerPersonAuthorityObservation = Object.freeze({ open: open });
})(globalThis);
