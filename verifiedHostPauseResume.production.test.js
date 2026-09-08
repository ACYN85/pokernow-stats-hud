'use strict';

var assert = require('assert');
var fs = require('fs');
var host = require('./hostControlTrace.js');
var runtime = require('./hudRuntimeStatus.js');
var lifecycleCapture = require('./pauseLifecycleCapture.js');
var fixture = require('./fixtures/verifiedHostPauseResumeFixture.json');

function record(state, overrides) {
  return host.record(state, Object.assign({
    frameId: 'frame-default', timestamp: 1000, direction: 'outgoing', eventName: 'action', namespace: '/',
    payload: { type: 'UP' }, localUserPlayerId: 'owner-1', tableOwnerPlayerId: 'owner-1'
  }, overrides || {}));
}
function connectedRuntime() {
  var state = runtime.createState({ timestamp: 1 });
  runtime.reconcile(state, { timestamp: 2, socketHookInstalled: true, socketHookStatusObserved: true, transportDisconnected: false });
  runtime.reconcile(state, { timestamp: 3, socketHookInstalled: true, freshGameState: true, tableStatus: 'inProgress', tableClassification: 'active', eligiblePlayerCount: 2 });
  return state;
}
function reconcileApplication(hud, traceState, application, timestamp) {
  return runtime.reconcile(hud, {
    timestamp: timestamp,
    tableClassification: application.nextState === 'paused' ? 'paused' : 'resumed',
    gamePaused: application.nextState === 'paused',
    authoritativePauseState: application.nextState,
    authoritativePauseEvidence: application.evidence,
    localLifecycleCommand: traceState.activeLocalCommand,
    freshGameState: true,
    eligiblePlayerCount: 2
  });
}

assert.strictEqual(fixture.captureValidity.valid, true);
assert.strictEqual(fixture.pauseWindow.events[0].raw, '42["action",{"type":"UP"}]');
assert.strictEqual(fixture.pauseWindow.events[0].millisecondsFromMarkerArm, 3004);
assert.strictEqual(fixture.resumeWindow.events[0].raw, '42["action",{"type":"UR"}]');
assert.strictEqual(fixture.resumeWindow.events[0].millisecondsFromMarkerArm, 1490);
assert.strictEqual(fixture.pauseWindow.markerPurpose, 'synthetic-correlation-only');

var trace = host.createState();
var up = record(trace, { frameId: 'pause-frame', timestamp: 4004, payload: { type: 'UP' } });
assert.strictEqual(up.recognizedCommand, 'pause');
assert.strictEqual(up.recognizerBranch, 'verified-host-outgoing-action-up-pause');
assert.strictEqual(up.source, 'verified-host-outgoing-command');
assert.deepStrictEqual([up.localUserPlayerId, up.tableOwnerPlayerId], ['owner-1', 'owner-1']);
var pauseApplication = host.applyRecognizedCommand(trace, up, up.timestamp);
assert.strictEqual(pauseApplication.nextState, 'paused');
assert.strictEqual(pauseApplication.changed, true);
assert.strictEqual(trace.activeLocalCommand, 'paused-local-command');
assert.strictEqual(pauseApplication.evidence.commandType, 'UP');

var hud = connectedRuntime();
assert.strictEqual(hud.displayedStatus, 'live');
var pauseResult = reconcileApplication(hud, trace, pauseApplication, 4004);
assert.strictEqual(pauseResult.status, 'live-socket');
assert.deepStrictEqual(runtime.presentation(pauseResult.status), { label: 'Paused', note: 'PokerNow game is paused.' });
var transitionCountAfterPause = hud.transitionCount;
var genericInProgress = runtime.reconcile(hud, { timestamp: 4025, freshGameState: true, tableStatus: 'inProgress', tableClassification: 'active', gamePaused: false, localLifecycleCommand: null, eligiblePlayerCount: 2 });
assert.strictEqual(genericInProgress.status, 'live-socket', 'generic gC inProgress cannot clear authoritative Pause');
assert.strictEqual(hud.authoritativePauseState, 'paused');
assert.strictEqual(hud.transitionCount, transitionCountAfterPause);

var repeatedUp = record(trace, { frameId: 'pause-frame-duplicate', timestamp: 4100, payload: { type: 'UP' } });
var repeatedPauseApplication = host.applyRecognizedCommand(trace, repeatedUp, repeatedUp.timestamp);
assert.strictEqual(repeatedPauseApplication.changed, false);
assert.strictEqual(trace.authoritativeTransitionCount, 1, 'repeated UP does not create transition churn');
reconcileApplication(hud, trace, repeatedPauseApplication, repeatedUp.timestamp);
assert.strictEqual(hud.transitionCount, transitionCountAfterPause);

var ur = record(trace, { frameId: 'resume-frame', timestamp: 6490, payload: { type: 'UR' } });
assert.strictEqual(ur.recognizedCommand, 'resume');
assert.strictEqual(ur.recognizerBranch, 'verified-host-outgoing-action-ur-resume');
var resumeApplication = host.applyRecognizedCommand(trace, ur, ur.timestamp);
assert.strictEqual(resumeApplication.nextState, 'resumed');
assert.strictEqual(resumeApplication.changed, true);
assert.strictEqual(trace.activeLocalCommand, null);
var resumeResult = reconcileApplication(hud, trace, resumeApplication, ur.timestamp);
assert.strictEqual(resumeResult.status, 'live');
assert.deepStrictEqual(runtime.presentation(resumeResult.status), { label: 'Live', note: 'PokerNow game is actively running.' });
var transitionCountAfterResume = hud.transitionCount;
assert.strictEqual(runtime.reconcile(hud, { timestamp: 6632, freshGameState: true, tableStatus: 'inProgress', tableClassification: 'active', gamePaused: false, eligiblePlayerCount: 2 }).status, 'live');
assert.strictEqual(hud.transitionCount, transitionCountAfterResume);
var repeatedUr = record(trace, { frameId: 'resume-frame-duplicate', timestamp: 6525, payload: { type: 'UR' } });
assert.strictEqual(host.applyRecognizedCommand(trace, repeatedUr, repeatedUr.timestamp).changed, false);
assert.strictEqual(trace.authoritativeTransitionCount, 2, 'repeated UR does not create transition churn');

[
  { direction: 'incoming', payload: { type: 'UP' }, reason: 'not-outgoing' },
  { direction: 'incoming', payload: { type: 'UR' }, reason: 'not-outgoing' },
  { eventName: 'other', payload: { type: 'UP' }, reason: 'event-name-not-action' },
  { payload: { type: 'UPPER' } }, { payload: { type: 'URX' } }, { payload: { type: 'up' } }, { payload: { type: 'ur' } },
  { payload: { nested: { type: 'UP' } } }, { payload: { value: 'contains-UP' } }, { payload: ['UP'] }, { payload: null },
  { payload: { type: 'ATB' } }, { eventName: 'control', payload: { command: 'pause' } }
].forEach(function (candidate, index) {
  var rejected = record(host.createState(), Object.assign({ frameId: 'reject-' + index }, candidate));
  assert.strictEqual(rejected.recognizedCommand, null, 'non-exact candidate ' + index + ' is rejected');
  assert.strictEqual(rejected.appearsTableControl, false);
});
var incomingLike = record(host.createState(), { direction: 'incoming', eventName: 'gC', payload: { event: 'action', type: 'UP' } });
assert.strictEqual(incomingLike.recognizedCommand, null);
var nonOwnerState = host.createState();
var nonOwner = record(nonOwnerState, { localUserPlayerId: 'player-2', tableOwnerPlayerId: 'owner-1' });
assert.strictEqual(nonOwner.recognizedCommand, null);
assert.strictEqual(nonOwner.rejectionReason, 'verified-local-user-is-not-owner');
assert.strictEqual(nonOwnerState.unverifiedCandidates.length, 1);
var unknownOwnerState = host.createState();
var unknownOwner = record(unknownOwnerState, { localUserPlayerId: null, tableOwnerPlayerId: null });
assert.strictEqual(unknownOwner.recognizedCommand, null);
assert.strictEqual(unknownOwner.rejectionReason, 'host-verification-unavailable');
assert.strictEqual(unknownOwnerState.unverifiedCandidates.length, 1, 'unknown ownership is retained only as bounded evidence');
for (var unknownIndex = 0; unknownIndex < 25; unknownIndex += 1) record(unknownOwnerState, { frameId: 'unknown-owner-' + unknownIndex, localUserPlayerId: null, tableOwnerPlayerId: null });
assert.strictEqual(unknownOwnerState.unverifiedCandidates.length, 20, 'unverified host-command candidates remain bounded');
var atbWhilePausedState = host.createState();
var atbPause = record(atbWhilePausedState, { frameId: 'atb-baseline-up' });
host.applyRecognizedCommand(atbWhilePausedState, atbPause, 1900);
var atb = record(atbWhilePausedState, { frameId: 'atb', payload: { type: 'ATB' } });
assert.strictEqual(host.applyRecognizedCommand(atbWhilePausedState, atb, 1901).applied, false);
assert.strictEqual(atbWhilePausedState.authoritativePauseState, 'paused', 'ATB cannot alter Pause/Resume state');

['keyboard', 'pointer', 'touch', 'menu', undefined].forEach(function (activationMethod) {
  var result = host.recognizeVerifiedHostPauseResume({ direction: 'outgoing', eventName: 'action', payload: { type: 'UP' }, localUserPlayerId: 'owner-1', tableOwnerPlayerId: 'owner-1', activationMethod: activationMethod });
  assert.strictEqual(result.recognizedCommand, 'pause', 'transport recognition ignores activation method');
});

var pauseForReloadState = host.createState();
var reloadUp = record(pauseForReloadState, { frameId: 'reload-pause' });
host.applyRecognizedCommand(pauseForReloadState, reloadUp, 2000);
var persisted = host.persistentSnapshot(pauseForReloadState);
var restored = host.createState(persisted);
assert.strictEqual(restored.authoritativePauseState, 'paused');
assert.strictEqual(restored.authoritativePauseEvidence.frameId, 'reload-pause');
var reloadHud = connectedRuntime();
assert.strictEqual(runtime.reconcile(reloadHud, { timestamp: 2001, authoritativePauseState: restored.authoritativePauseState, authoritativePauseEvidence: restored.authoritativePauseEvidence, localLifecycleCommand: restored.activeLocalCommand }).status, 'live-socket');
var reloadUr = record(restored, { frameId: 'reload-resume', payload: { type: 'UR' } });
var reloadResume = host.applyRecognizedCommand(restored, reloadUr, 2002);
assert.strictEqual(reconcileApplication(reloadHud, restored, reloadResume, 2002).status, 'live');

var breakHud = connectedRuntime();
var breakTrace = host.createState();
var breakPause = host.applyRecognizedCommand(breakTrace, record(breakTrace), 3000);
reconcileApplication(breakHud, breakTrace, breakPause, 3000);
assert.strictEqual(runtime.reconcile(breakHud, { timestamp: 3001, waitingToStart: true, tableStatus: 'waiting', tableClassification: 'waiting', freshGameState: true }).status, 'waiting', 'Waiting/Break precedence remains above Pause');

var lifecycleState = lifecycleCapture.createState({ enabled: true, createdAt: 1 });
var lifecycleRecord = lifecycleCapture.recordFrame(lifecycleState, { frameId: 'diag-up', timestamp: 10, transportDirection: 'outgoing', rawFrame: fixture.pauseWindow.events[0].raw });
lifecycleCapture.completeFrame(lifecycleState, lifecycleRecord, { recognizerMatched: true, recognizerBranch: 'pause', recognizerBranchName: up.recognizerBranch, normalizedLifecycleSignal: Object.assign({}, up, { authoritativeApplication: pauseApplication }), previousPersistedPauseState: null, nextPersistedPauseState: 'paused', persistenceReason: 'verified-host-outgoing-up-established-authoritative-pause', selectedStatus: 'live-socket', renderedBadgeText: 'Paused', renderedFooterText: 'PokerNow game is paused.' });
assert.strictEqual(lifecycleRecord.recognizerBranchName, 'verified-host-outgoing-action-up-pause');
assert.strictEqual(lifecycleRecord.previousPersistedPauseState, null);
assert.strictEqual(lifecycleRecord.nextPersistedPauseState, 'paused');
assert.strictEqual(lifecycleRecord.renderedBadgeText, 'Paused');
assert.strictEqual(lifecycleRecord.renderedFooterText, 'PokerNow game is paused.');

var content = fs.readFileSync('./content.js', 'utf8');
var persistStart = content.indexOf('function persistRecognizedHostCommand(record) {');
var persistEnd = content.indexOf('\n  function recordOutgoingHostControl', persistStart);
var persistSource = content.slice(persistStart, persistEnd);
assert.ok(persistSource.includes('authoritativePauseState: application.nextState'));
assert.ok(persistSource.includes('persistHostControlState(completePersistence)'), 'between-hand Pause persists without an active hand');
assert.ok(!/commitHand|finalize|detectGcNewHand|startHand/.test(persistSource), 'Pause/Resume neither finalizes nor creates a hand boundary');
assert.ok(content.includes('direction: frame.direction'));
assert.ok(content.includes('localUserPlayerId: localUserPlayerId'));
assert.ok(content.includes('tableOwnerPlayerId: tableOwnerPlayerId'));
assert.ok(content.includes('recordOutgoingHostControl(frame, packet)'));
assert.ok(!content.includes("event.key === 'P'") && !content.includes("event.code === 'KeyP'"));
assert.ok(content.indexOf('recordOutgoingHostControl(frame, packet)') < content.indexOf("completeRawPauseLifecycleFrame(frame, transport, packet, outgoingHostControlRecord"));
assert.ok(!persistSource.includes('pauseLifecycleCaptureEnabled'), 'diagnostics-disabled state cannot disable production recognition');
var authoritativeStart = content.indexOf('function reconcileAuthoritativeSocketLifecycleControl');
var authoritativeEnd = content.indexOf('\n  function currentEffectivePauseState', authoritativeStart);
var authoritativeSource = content.slice(authoritativeStart, authoritativeEnd);
assert.ok(authoritativeSource.includes("source: 'authoritative-socket-lifecycle-control'"));
assert.ok(authoritativeSource.includes('hostControlTraceState.authoritativePauseState = authoritativeState'));
assert.ok(authoritativeSource.includes('persistHostControlState()'), 'an established authoritative transition clears or sets persisted Pause independently of hand state');

console.log('Verified-host outgoing UP/UR production recognition, persistence, precedence, idempotence, and safety tests passed.');
