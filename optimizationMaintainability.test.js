'use strict';

var assert = require('assert');
var fs = require('fs');
var PokerHudRuntimeStatus = require('./hudRuntimeStatus.js');
var PokerHostControlTrace = require('./hostControlTrace.js');

var content = fs.readFileSync('./content.js', 'utf8');
var architecture = fs.readFileSync('./ARCHITECTURE.md', 'utf8');

function count(text, needle) {
  return text.split(needle).length - 1;
}

assert.strictEqual(count(content, "document.addEventListener('click', handleDiagnosticAndHostControlClick, true);"), 1, 'the shared capture listener is installed exactly once');
assert.strictEqual(count(content, "document.removeEventListener('click', handleDiagnosticAndHostControlClick, true);"), 1, 'the shared capture listener is removed during instance cleanup');
assert.ok(!content.includes("document.addEventListener('click', function (event) {"), 'the former anonymous global click listener is not reintroduced');
var clickHandlerStart = content.indexOf('function handleDiagnosticAndHostControlClick(event)');
var clickHandlerEnd = content.indexOf('var pauseDiagnosticPageState', clickHandlerStart);
var clickHandler = content.slice(clickHandlerStart, clickHandlerEnd);
assert.ok(clickHandler.includes('capturePauseDiagnosticPointerEvent(event);'), 'the named listener preserves diagnostic capture');
assert.ok(clickHandler.includes('lastHostControlUiClick ='), 'the named listener preserves UI corroboration');

assert.strictEqual(count(content, "window.addEventListener('message', handlePageBridgeMessage);"), 1, 'the page bridge listener is installed exactly once');
assert.strictEqual(count(content, "window.removeEventListener('message', handlePageBridgeMessage);"), 1, 'the page bridge listener has a matching teardown');
assert.ok(!/\bhandleWebSocketMessage\b/.test(content), 'the bridge callback no longer implies ownership of WebSocket decoding');
assert.ok(!/\bwebsocketLive\b|\bfullLogLive\b|\bcurrentPersistedPauseState\b|\brecordWalkTransportPacket\b|\brecentWalkTransportPackets\b/.test(content), 'ambiguous internal-only names stay removed');
assert.ok(content.includes('websocketStatsSourceAvailable') && content.includes('fullLogDisplaySourceAvailable'), 'source-availability names describe their display/statistics roles');
assert.ok(content.includes('currentEffectivePauseState'), 'diagnostic snapshots use the effective-state name');
assert.ok(content.includes('recordWalkDiagnosticTransportPacket') && content.includes('recentWalkDiagnosticTransportPackets'), 'walk transport names remain explicitly diagnostic');
assert.ok(content.includes('Merged WebSocket gC state is authoritative for production hand tracking'), 'the authoritative WebSocket ownership invariant stays documented at the coordinator boundary');
assert.ok(content.includes('Reload continuity may reclaim only the persisted hand'), 'the reload ownership invariant stays documented at its decision point');

assert.strictEqual(count(content, '.pnhud-status-area .pnhud-demo'), 1, 'the runtime badge selector has one source of truth');
assert.strictEqual(count(content, '.pnhud-note'), 1, 'the runtime footer selector has one source of truth');
assert.ok(content.includes('function resolveHudRuntimeStatusElements(root)'), 'runtime child lookups share a within-call resolver');
assert.ok(content.includes("recordPauseLifecycleHudRender('targeted-status-update', root, presentation, elements);"), 'targeted rendering reuses the resolved elements for diagnostics');

assert.strictEqual(count(content, 'var previousMergedHandId = previousSnapshot ? findHandIdentifier(previousSnapshot) : null;'), 1, 'the previous hand ID is derived once per merged snapshot');
assert.strictEqual(count(content, 'var currentMergedHandId = findHandIdentifier(currentSnapshot);'), 1, 'the current hand ID is derived once per merged snapshot');
assert.strictEqual(count(content, 'previousHandId: previousMergedHandId,'), 2, 'both trace consumers reuse the previous hand ID');
assert.strictEqual(count(content, 'currentHandId: currentMergedHandId,'), 2, 'both trace consumers reuse the current hand ID');

assert.deepStrictEqual(PokerHudRuntimeStatus.presentation('live'), { label: 'Live', note: 'PokerNow game is actively running.' });
assert.deepStrictEqual(PokerHudRuntimeStatus.presentation('live-socket'), { label: 'Paused', note: 'PokerNow game is paused.' });
assert.strictEqual(PokerHudRuntimeStatus.presentation('waiting').label, 'Waiting');
assert.strictEqual(PokerHudRuntimeStatus.presentation('initializing').label, 'Connecting…');
assert.strictEqual(PokerHudRuntimeStatus.presentation('disconnected').label, 'Disconnected');

var verifiedPause = PokerHostControlTrace.recognizeVerifiedHostPauseResume({ direction: 'outgoing', eventName: 'action', payload: { type: 'UP' }, localUserPlayerId: 'host', tableOwnerPlayerId: 'host' });
var unverifiedPause = PokerHostControlTrace.recognizeVerifiedHostPauseResume({ direction: 'outgoing', eventName: 'action', payload: { type: 'UP' }, localUserPlayerId: 'guest', tableOwnerPlayerId: 'host' });
assert.strictEqual(verifiedPause.recognizedCommand, 'pause', 'the exact verified-owner production recognizer is unchanged');
assert.strictEqual(unverifiedPause.recognizedCommand, null, 'a non-owner cannot create an authoritative Pause');

assert.ok(architecture.includes('## State ownership'), 'architecture documents state ownership');
assert.ok(architecture.includes('## Authoritative Pause/Resume flow'), 'architecture documents exact authoritative Pause/Resume flow');
assert.ok(architecture.includes('## Deferred / Higher-Risk Optimization'), 'higher-risk ideas remain deferred');
assert.ok(architecture.includes('generic active/in-progress patch therefore cannot clear Pause'), 'the verified Pause latch invariant is documented');

console.log('Behavior-preserving optimization and maintainability regression checks passed.');
