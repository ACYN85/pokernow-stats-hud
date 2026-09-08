'use strict';

var assert = require('assert');
var fs = require('fs');

var content = fs.readFileSync('./content.js', 'utf8');
var worker = fs.readFileSync('./careerServiceWorker.js', 'utf8');
var indexed = fs.readFileSync('./careerIndexedStore.js', 'utf8');
var backup = fs.readFileSync('./careerBackup.js', 'utf8');
var manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));

assert.strictEqual(manifest.background.service_worker, 'careerServiceWorker.js');
assert.match(worker, /importScripts\('stats\.js', 'careerStatsAggregator\.js', 'filteredStats\.js', 'careerContributionStore\.js', 'careerIndexedStore\.js', 'careerBackupPolicy\.js', 'careerBackup\.js'\)/, 'formal backup validator, size policy, and filtered query layer load in the extension service worker');
assert.match(worker, /PokerCareerBackup\.validateBackup[\s\S]*replaceCareerRecords/, 'worker validates the complete candidate before entering replacement');
assert.match(worker, /expectedPayloadDigest !== plan\.summary\.payloadDigest[\s\S]*expectedCurrentPayloadDigest !== currentBackup\.integrity\.payloadDigest/, 'destructive replacement confirmation is bound to both validated backup and current-career SHA-256 values');
assert.match(indexed, /db\.transaction\(\[STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS\], 'readwrite'\)/, 'career replacement uses one transaction over exactly the four career stores');
assert.match(indexed, /recordStore\.clear\(\); metadataStore\.clear\(\); aggregateStore\.clear\(\); headStore\.clear\(\)/, 'replace clears old career state only inside its atomic transaction');
assert.match(indexed, /tx\.abort\(\)/, 'in-transaction verification can abort replacement');
assert.doesNotMatch(backup, /PokerPlayerProfile|hudUi|overlay|leaderboard|sessionStorage|pokerNowHudSession/, 'backup format contains no profile, HUD, or session state');
assert.doesNotMatch(worker, /PokerPlayerProfile|resetCurrentSession|STORAGE_KEYS\.session|pokerNowHudSession/, 'worker restore cannot reach session/profile state');

var debugStart = content.indexOf('function createCareerDebugApi'); var debugEnd = content.indexOf('function installCareerDebugApi', debugStart);
var debugApi = content.slice(debugStart, debugEnd);
assert.match(debugApi, /exportCareerBackup/);
assert.match(debugApi, /validateCareerBackup/);
assert.match(debugApi, /downloadCareerBackup/);
assert.match(debugApi, /careerRuntimeTimings/);
assert.doesNotMatch(debugApi, /replaceCareerBackup/, 'page debug surface exposes read-only export/validation/timings but no mutable restore');
assert.doesNotMatch(content, /career dashboard|career leaderboard|session-vs-career|career HUD/i, 'Phase 3A adds no career dashboard/HUD surface');
['playerProfileClassifier.js', 'playerProfilePresentation.js', 'playerProfileExplanation.js', 'playerProfileShadowStore.js'].forEach(function (file) {
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /CareerBackup|replaceCareer|exportCareerBackup/, file + ' remains separated from career backup/restore');
});
console.log('Career backup/restore remains isolated from session stats, profiles, HUD state, and mutable page APIs.');
