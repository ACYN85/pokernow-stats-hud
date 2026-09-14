'use strict';

var fs = require('fs');
var path = require('path');
var base = require('./careerDashboardQueryHarness.js');

// Reuse the existing isolated browser/Node fixture runner. Instrument production
// bodies and native IDB requests, never substitute a fake IndexedDB implementation.
async function openHarness(browserMode) {
  var harness = await base.openHarness(browserMode);
  var sources = ['stats.js', 'careerStatsAggregator.js', 'careerContributionStore.js', 'filteredStats.js', 'careerIndexedStore.js'].map(function (file) {
    var source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    function insert(marker, code) {
      if (source.split(marker).length !== 2) throw new Error('Instrumentation marker changed: ' + marker);
      source = source.replace(marker, marker + code);
    }
    if (file === 'careerStatsAggregator.js') {
      insert('function rebuild(records) {', ' summaryProbe.aggregateRebuilds += 1;');
      insert('async function rebuildCooperatively(records, yieldControl) {', ' summaryProbe.aggregateRebuilds += 1; summaryProbe.backfills += 1;');
      insert('function* resolutionSteps(candidates) {', ' summaryProbe.resolutionRecords += (candidates || []).length;');
    }
    if (file === 'careerIndexedStore.js') {
      insert('function recordsForPlayer(playerId) {', ' summaryProbe.historyRetrievals += 1; summaryProbe.playerHistoryRetrievals += 1; summaryProbe.memorySelectionScans += records.size;');
      insert('function recordsForHand(handKey) {', ' summaryProbe.historyRetrievals += 1; summaryProbe.memorySelectionScans += records.size;');
      insert('async function backfillSummaryHeads(wrappers, previousHeads) {', ' if (!summaryProbe.browser) { summaryProbe.historyRetrievals += 1; summaryProbe.memorySelectionScans += wrappers.length; }');
      insert('function summaryRows(heads) {', ' summaryProbe.headEnumerations += 1;');
      insert('function summaryYield() {', ' summaryProbe.yields += 1; if (summaryFault.pause) return new Promise(function (resolve, reject) { summaryFault.resume = function () { if (summaryFault.fail) reject(new Error("injected interrupted backfill")); else resolve(); }; });');
    }
    return source;
  });
  await harness.run(function (args) {
    globalThis.resetSummaryProbe = function () {
      globalThis.summaryProbe = { browser: args.browser, historyRetrievals: 0, playerHistoryRetrievals: 0, historyRecordsReturned: 0, memorySelectionScans: 0, aggregateRebuilds: 0, resolutionRecords: 0, backfills: 0, headEnumerations: 0, transactions: 0, yields: 0, headWrites: [] };
    };
    resetSummaryProbe(); globalThis.summaryFault = {};
    args.sources.forEach(function (source) { new Function('module', 'require', source)(undefined, undefined); });
    if (args.browser) {
      var transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function () { summaryProbe.transactions += 1; return transaction.apply(this, arguments); };
      [IDBObjectStore.prototype, IDBIndex.prototype].forEach(function (prototype) {
        var getAll = prototype.getAll;
        prototype.getAll = function () {
          var isRecords = this.name === 'careerRecords' || this.objectStore && this.objectStore.name === 'careerRecords';
          if (isRecords) {
            summaryProbe.historyRetrievals += 1;
            if (this.name === 'playerIds') summaryProbe.playerHistoryRetrievals += 1;
          }
          var request = getAll.apply(this, arguments);
          if (isRecords) request.addEventListener('success', function () { summaryProbe.historyRecordsReturned += request.result.length; });
          return request;
        };
      });
      ['put', 'add'].forEach(function (method) {
        var original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function (value) {
          if (this.name === 'careerPlayerHeads') {
            summaryProbe.headWrites.push(value.playerId);
            if (summaryFault.abortHeadWrite) {
              summaryFault.abortHeadWrite = false;
              this.transaction.abort();
              throw new Error('injected head write abort');
            }
          }
          return original.apply(this, arguments);
        };
      });
    }
    globalThis.openSummaryDb = function () {
      return new Promise(function (resolve, reject) { var request = indexedDB.open(PokerCareerIndexedStore.DATABASE_NAME); request.onsuccess = function () { resolve(request.result); }; request.onerror = function () { reject(request.error); }; });
    };
    globalThis.readSummaryHeads = async function () {
      if (!summaryProbe.browser) return Array.from(queryService.testHooks.heads.values());
      var db = await openSummaryDb();
      try {
        return await new Promise(function (resolve, reject) { var tx = db.transaction('careerPlayerHeads'); var request = tx.objectStore('careerPlayerHeads').getAll(); tx.oncomplete = function () { resolve(request.result); }; tx.onabort = function () { reject(tx.error); }; });
      } finally { db.close(); }
    };
  }, { browser: browserMode, sources: sources });

  harness.seedLegacy = async function (records) {
    await harness.reset([], true);
    await harness.call('careerPlayerSummaries'); // let initialization finish before raw fixture seeding
    await harness.run(async function (records) {
      var resolved = PokerCareerStatsAggregator.rebuild(records);
      var metadata = (await queryService.exportCareer()).metadata;
      delete metadata.playerSummaryVersion;
      metadata.nextSequence = records.length; metadata.physicalRecordCount = records.length;
      metadata.activeRecordCount = resolved.activeRecords.length; metadata.quarantinedHandCount = resolved.quarantinedHandKeys.length;
      var heads = new Map();
      var wrappers = records.map(function (record, index) {
        (record.players || []).forEach(function (entry) { heads.set(String(entry.playerId), { playerId: String(entry.playerId), revision: index + 1 }); });
        return PokerCareerIndexedStore.recordWrapper(record, index + 1);
      });
      if (!summaryProbe.browser) {
        var hooks = queryService.testHooks;
        hooks.records.clear(); hooks.heads.clear(); hooks.caches.clear();
        wrappers.forEach(function (wrapper) { hooks.records.set(wrapper.record.fingerprint, wrapper); });
        heads.forEach(function (head) { hooks.heads.set(head.playerId, head); });
        Object.keys(hooks.metadata).forEach(function (key) { delete hooks.metadata[key]; }); Object.assign(hooks.metadata, metadata);
      } else {
        queryService.close(); globalThis.queryService = null;
        var db = await openSummaryDb();
        try {
          await new Promise(function (resolve, reject) {
            var tx = db.transaction(['careerRecords', 'careerMetadata', 'careerPlayerHeads', 'careerAggregateCache'], 'readwrite');
            ['careerRecords', 'careerPlayerHeads', 'careerAggregateCache'].forEach(function (name) { tx.objectStore(name).clear(); });
            wrappers.forEach(function (wrapper) { tx.objectStore('careerRecords').put(wrapper); });
            heads.forEach(function (head) { tx.objectStore('careerPlayerHeads').put(head); });
            tx.objectStore('careerMetadata').put(metadata);
            tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error); };
          });
        } finally { db.close(); }
      }
    }, records);
  };
  harness.sampleSummary = function (method, args) {
    return harness.run(async function (request) {
      resetSummaryProbe(); var started = performance.now();
      if (!globalThis.queryService) globalThis.queryService = await PokerCareerIndexedStore.createIndexedService(indexedDB, {}, { initializedAt: 1 });
      var value = await queryService[request.method].apply(queryService, request.args);
      return { value: value, ms: performance.now() - started, probe: summaryProbe, serviceCalls: 1 };
    }, { method: method || 'careerPlayerSummaries', args: args || [] });
  };
  return harness;
}

module.exports = { openHarness: openHarness };
