'use strict';

var assert = require('assert');
var harness = require('./testSupport/careerDashboardQueryHarness.js');
var baseline = process.argv.includes('--baseline');
var repetitions = 5;
function percentile(values, fraction) { return values.slice().sort(function (a, b) { return a - b; })[Math.ceil(values.length * fraction) - 1]; }

(async function () {
  var driver = await harness.openHarness(process.argv.includes('--browser'), baseline ? '1c166577bdc2a0d5d2114f3b557bb628689ca622' : null);
  try {
    console.log(JSON.stringify({ environment: driver.environment, baseline: baseline, repetitions: repetitions, note: 'Query-only timings exclude fixture setup and driver transport; synthetic fixtures are not PokerNow latency.' }));
    for (var count of [100, 1000, 5000]) {
      var records = harness.scaleRecords(count);
      for (var scenario of ['cold', 'warm', 'hit', 'opponent-only']) {
        var samples = [];
        for (var iteration = 0; iteration < repetitions + 1; iteration += 1) {
          await driver.reset(records, scenario === 'cold');
          var filters = { position: scenario === 'opponent-only' ? null : 'SB', opponentMode: 'self', selfPlayerId: 'me' };
          if (scenario === 'hit') await driver.sample('subject', filters);
          var sample = await driver.sample('subject', filters);
          var passes = scenario === 'hit' ? 0 : baseline ? (scenario === 'cold' ? 5 : scenario === 'opponent-only' ? 3 : 4) : scenario === 'cold' ? 2 : 1;
          assert.strictEqual(sample.passes, passes, scenario);
          assert.strictEqual(sample.records, passes * count, scenario);
          assert.strictEqual(sample.result.query.playerRecordRetrievals, scenario === 'hit' ? 0 : 1);
          if (iteration) samples.push(sample); // One unreported warm-up per scenario/size.
        }
        console.log(JSON.stringify({ count: count, scenario: scenario, passes: samples[0].passes, recordsProcessed: samples[0].records, medianMs: +percentile(samples.map(function (s) { return s.ms; }), 0.5).toFixed(3), p95Ms: +percentile(samples.map(function (s) { return s.ms; }), 0.95).toFixed(3) }));
      }
    }
  } finally { await driver.close(); }
})().catch(function (error) { console.error(error); process.exitCode = 1; });
