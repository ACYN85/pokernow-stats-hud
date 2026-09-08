'use strict';

// Test-only instrumentation counts the actual rebuild body, including createState's
// private call. Production exports are frozen; wrapping only the export misses it.
var fs = require('fs');
var path = require('path');
var fixtures = require('./careerBackupFixtures.js');

function scaleRecords(count) {
  return Array.from({ length: count }, function (_, index) {
    var subject = fixtures.player('subject', 'Subject', {
      vpipMade: index % 2, pfrMade: index % 3 === 0 ? 1 : 0,
      postflopAggressiveActions: 1, postflopCalls: 0,
      threeBetMade: index % 2, threeBetOpportunities: 1,
      foldToThreeBet: index % 2, foldToThreeBetOpportunities: 1,
      foldToFlopCBet: index % 2, foldToFlopCBetOpportunities: 1
    });
    subject.position = { schemaVersion: 1, status: 'supported', dealtPosition: index % 2 ? 'BB' : 'SB', dealtPlayerCount: 2, unsupportedReason: null };
    Object.keys(subject.relational).filter(function (key) { return /PlayerId$/.test(key); }).forEach(function (key) { subject.relational[key] = index % 3 ? 'me' : 'other'; });
    return fixtures.record('QUERY', String(index), [subject, fixtures.player(index % 3 ? 'me' : 'other', 'Counterpart')], { finalizedAt: 1000 + index });
  });
}

async function openHarness(browserMode, sourceRef) {
  var run; var close; var environment;
  if (browserMode) {
    // Optional existing Playwright installation; no dependency installation or profile reuse.
    var playwright = require('playwright');
    var http = require('http');
    var server = http.createServer(function (_, response) { response.end('<!doctype html><title>Career query fixture</title>'); });
    await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
    var browser;
    try { browser = await playwright.chromium.launch({ headless: true, channel: process.env.CAREER_TEST_BROWSER || 'chrome' }); }
    catch (error) { server.close(); throw error; }
    var page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    run = function (fn, arg) { return page.evaluate(fn, arg); };
    close = async function () { await browser.close(); await new Promise(function (resolve) { server.close(resolve); }); };
    environment = 'isolated headless ' + browser.version() + ' / native IndexedDB';
  } else {
    run = async function (fn, arg) {
      return structuredClone(await fn(structuredClone(arg)));
    };
    close = async function () {};
    environment = 'synthetic Node ' + process.version + ' / memory service';
  }
  var files = ['stats.js', 'careerStatsAggregator.js', 'careerContributionStore.js', 'filteredStats.js', 'careerIndexedStore.js'];
  var sources = files.map(function (file) {
    var source = sourceRef
      ? require('child_process').execFileSync('git', ['show', sourceRef + ':' + file], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      : fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    if (file === 'careerStatsAggregator.js') {
      var marker = 'function rebuild(records) {';
      if (source.split(marker).length !== 2) throw new Error('rebuild instrumentation marker changed');
      source = source.replace(marker, marker + '\n globalThis.queryProbe.passes += 1; globalThis.queryProbe.records += (records || []).length;');
    }
    return source;
  });
  await run(function (sources) {
    globalThis.queryProbe = { passes: 0, records: 0 };
    sources.forEach(function (source) { new Function('module', 'require', source)(undefined, undefined); });
  }, sources);
  return {
    environment: environment, run: run, close: close,
    reset: function (records, cold) {
      return run(async function (args) {
        if (globalThis.queryService && queryService.close) queryService.close();
        if (args.browser) await new Promise(function (resolve, reject) {
          var request = indexedDB.deleteDatabase(PokerCareerIndexedStore.DATABASE_NAME);
          request.onsuccess = resolve; request.onerror = function () { reject(request.error); };
        });
        var saved = {};
        args.records.forEach(function (record) { saved[PokerCareerContributionStore.storageRecordKey(record.handKey, record.fingerprint)] = record; });
        var options = { initializedAt: 1, migratedAt: 2, buildId: 'query-fixture' };
        globalThis.queryService = args.browser
          ? await PokerCareerIndexedStore.createIndexedService(indexedDB, saved, options)
          : PokerCareerIndexedStore.createMemoryService(saved, options);
        if (args.cold) {
          if (!args.browser) queryService.testHooks.caches.clear();
          else {
            var db = await new Promise(function (resolve) { var request = indexedDB.open(PokerCareerIndexedStore.DATABASE_NAME); request.onsuccess = function () { resolve(request.result); }; });
            await new Promise(function (resolve, reject) { var tx = db.transaction('careerAggregateCache', 'readwrite'); tx.objectStore('careerAggregateCache').clear(); tx.oncomplete = resolve; tx.onerror = function () { reject(tx.error); }; });
            db.close();
          }
        }
      }, { records: records, cold: cold, browser: browserMode });
    },
    call: function (method, args) { return run(function (request) { return queryService[request.method].apply(queryService, request.args); }, { method: method, args: args || [] }); },
    sample: function (playerId, filters) {
      return run(async function (args) {
        queryProbe.passes = 0; queryProbe.records = 0;
        var start = performance.now();
        var result = await queryService.careerDashboardStats(args.playerId, args.filters);
        return { passes: queryProbe.passes, records: queryProbe.records, ms: performance.now() - start, result: result };
      }, { playerId: playerId, filters: filters });
    }
  };
}

module.exports = { openHarness: openHarness, scaleRecords: scaleRecords };
