/* Extension-page-only client. A lost connection never retries or replays a request. */
(function (root) {
  'use strict';
  function connect(runtime, changed) {
    var port = null, sequence = 0, pending = new Map(), healthy = false, observedAt = 0, lease = null, revoking = false;
    function unknown() { return Object.assign(Error('Result UNKNOWN. Accept consent and refresh native identity before another change.'), { code: 'PERSON_TRANSPORT_UNKNOWN' }); }
    function lost(current) {
      if (port !== current) return;
      port = null; healthy = false; clearTimeout(lease);
      pending.forEach(function (p) { clearTimeout(p.timer); p.reject(unknown()); }); pending.clear(); changed('connection');
    }
    function call(method, args) {
      if (!port) {
        var current = runtime.connect({ name: root.PokerPersonAuthorization.PORT }); port = current;
        current.onDisconnect.addListener(function () { lost(current); });
        current.onMessage.addListener(function (m) {
          if (port !== current) return;
          if (m.revoked) { healthy = false; clearTimeout(lease); if (!revoking) changed('revoked'); return; }
          if (m.changed) { changed('revision'); return; }
          if (m.observed) {
            healthy = true; observedAt = Date.now(); clearTimeout(lease);
            lease = setTimeout(function () { lost(current); current.disconnect(); }, root.PokerPersonAuthorization.LIMITS.leaseMs); return;
          }
          var p = pending.get(m.id); if (!p) return;
          pending.delete(m.id); clearTimeout(p.timer);
          if (!m.ok) { p.reject(Object.assign(Error(m.message || m.code), { code: m.code })); return; }
          try { p.resolve(JSON.parse(m.wire, function (_, v) { return v && typeof v === 'object' && Object.keys(v).length === 1 && v.personNumber === 'Infinity' ? Infinity : v; })); }
          catch (_) { lost(current); current.disconnect(); p.reject(unknown()); }
        });
      }
      return new Promise(function (resolve, reject) {
        var id = ++sequence, current = port;
        var timer = setTimeout(function () { lost(current); current.disconnect(); }, 30000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try { current.postMessage({ version: 1, id: id, method: method, args: args }); }
        catch (_) { lost(current); current.disconnect(); }
      });
    }
    function method(name) { return function () { return call(name, Array.from(arguments)); }; }
    function fresh(name, args) { if (!healthy || Date.now() < observedAt || Date.now() - observedAt >= root.PokerPersonAuthorization.LIMITS.leaseMs) return Promise.reject(unknown()); return call(name, args); }
    var owners = {
      identity: { read: method('read'), setAssignedName: method('name') },
      links: { previewPublishedLink: function (ids, revision, personId) { return call('preview', [ids, revision, personId || null]); }, confirmPublishedLink: method('confirm'),
        previewUnlink: method('previewUnlink'), confirmUnlink: method('confirmUnlink'), readEligibility: method('eligibility') },
      catalog: { read: method('catalog') },
      groupedCareer: { evidence: 'native-owner', owner: { query: function () { return fresh('query', Array.from(arguments)); }, queryRecent:function(){return fresh('recentQuery',Array.from(arguments));},queryTrends:function(){return fresh('trendsQuery',Array.from(arguments));},querySession:function(){return fresh('sessionQuery',Array.from(arguments));},listSessions:function(){return fresh('history',Array.from(arguments));}, validateFence: function () { return fresh('fence', Array.from(arguments)); } } },
      close: function () { if (port) { var current = port; lost(current); current.disconnect(); } }
    };
    return Object.freeze({ owners: owners, status: method('status'), accept: function () { return call('consent', ['manual-person-consent-v1']); }, revoke: function () { revoking = true; return call('revoke', []).finally(function () { revoking = false; }); } });
  }
  root.PokerPersonManagementTransport = Object.freeze({ connect: connect });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PokerPersonManagementTransport;
})(typeof globalThis !== 'undefined' ? globalThis : this);
