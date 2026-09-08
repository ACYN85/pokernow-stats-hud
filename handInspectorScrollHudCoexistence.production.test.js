'use strict';

var assert = require('assert');
var fs = require('fs');
var inspector = require('./handStatInspector.js');
var overlays = require('./seatOverlay.js');
var bootstrap = require('./uiBootstrap.js');
var overlayStats = require('./overlayStats.js');

var css = fs.readFileSync('./hud.css', 'utf8');
var content = fs.readFileSync('./content.js', 'utf8');

function cssRule(selector) {
  var escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, 'CSS rule exists for ' + selector);
  return match[1];
}

function zIndex(selector) {
  var match = cssRule(selector).match(/z-index:\s*(\d+)/);
  assert.ok(match, selector + ' owns an explicit z-index');
  return Number(match[1]);
}

function explanation(handId, playerCount) {
  var players = {};
  for (var playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
    var stats = {};
    inspector.STAT_ORDER.forEach(function (statId, statIndex) {
      stats[statId] = {
        decision: { opportunity: statIndex % 3 !== 2, result: statIndex % 3 === 0 },
        semanticContribution: statIndex % 3 === 0 ? '1/1' : statIndex % 3 === 1 ? '0/1' : '0/0',
        counterContribution: statIndex % 3 === 0 ? '1/1' : statIndex % 3 === 1 ? '0/1' : '0/0',
        status: statIndex % 3 === 2 ? 'not_applicable' : 'counted',
        reasonCode: statId === 'flopCBet' ? 'prior_donk_removed_cbet_opportunity' : 'test_decision_' + statId,
        reasonText: 'test decision ' + statId
      };
    });
    players['stable-player-' + String(playerIndex + 1).padStart(2, '0')] = stats;
  }
  return { schemaVersion: 1, handId: handId, lifecycleHandId: 'life-' + handId, finalizationReason: 'terminal settlement', players: players };
}

// I1-I3: the dialog is a bounded three-row grid; only its middle row scrolls.
var state = inspector.createState();
var largeHand = explanation('large-hand', 12);
inspector.open(state, [largeHand]);
state.showAll = true;
var largeHtml = inspector.renderHtml(inspector.buildModel(state, [largeHand]));
assert.strictEqual((largeHtml.match(/pnhud-hand-stat-player/g) || []).length, 12, 'I1 renders the final player inside the independently scrollable detail pane');
assert.match(cssRule('#pnhud-settings-panel .pnhud-hand-stat-inspector'), /display:\s*grid/);
assert.match(cssRule('#pnhud-settings-panel .pnhud-hand-stat-inspector'), /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
assert.match(cssRule('#pnhud-settings-panel .pnhud-hand-stat-detail'), /min-height:\s*0/);
assert.match(cssRule('#pnhud-settings-panel .pnhud-hand-stat-detail'), /overflow-y:\s*auto/);
assert.ok(largeHtml.indexOf('pnhud-hand-stat-inspector-heading') < largeHtml.indexOf('pnhud-hand-stat-inspector-layout'), 'I2 header and close control stay outside the scrolling middle row');
assert.ok(largeHtml.indexOf('pnhud-hand-stat-copy-actions') > largeHtml.indexOf('pnhud-hand-stat-inspector-layout'), 'I3 copy controls stay in the fixed footer row');

// I4-I6: history and detail have separate scroll ownership.
var thirty = [];
for (var handIndex = 1; handIndex <= 30; handIndex += 1) thirty.push(explanation('hand-' + handIndex, 2));
var thirtyState = inspector.createState();
inspector.open(thirtyState, thirty);
var thirtyHtml = inspector.renderHtml(inspector.buildModel(thirtyState, thirty));
assert.strictEqual((thirtyHtml.match(/data-pnhud-inspector-hand-id=/g) || []).length, 30, 'I4 all 30 retained hands remain selectable');
assert.match(cssRule('#pnhud-settings-panel .pnhud-hand-stat-inspector-layout aside'), /overflow-y:\s*auto/);
assert.match(cssRule('#pnhud-settings-panel .pnhud-hand-stat-inspector-layout aside'), /overscroll-behavior:\s*contain/);
assert.ok(thirtyHtml.includes('class="pnhud-hand-stat-history"') && thirtyHtml.includes('class="pnhud-hand-stat-detail"'), 'I5-I6 history and detail are distinct sibling scroll containers');

// I7-I9: keyboard access and targeted rerenders preserve independent scroll/focus state.
assert.ok(thirtyHtml.includes('class="pnhud-hand-stat-history" tabindex="0"'));
assert.ok(thirtyHtml.includes('class="pnhud-hand-stat-detail" tabindex="0"'));
assert.ok(css.includes('.pnhud-hand-stat-inspector button:focus-visible'));
assert.ok(content.includes("handStatInspectorScrollState = { history: 0, detail: 0 }"));
assert.ok(content.includes('nextHistory.scrollTop = handStatInspectorScrollState.history'));
assert.ok(content.includes('nextDetail.scrollTop = handStatInspectorScrollState.detail'));
assert.ok(content.includes("refreshHandStatInspectorView('hand:' + selectedInspectorHand.dataset.pnhudInspectorHandId, true)"), 'I8 selecting an older hand preserves list position while resetting only its detail pane');
inspector.select(thirtyState, thirty, 'hand-10');
var withNewHand = inspector.buildModel(thirtyState, thirty.concat(explanation('hand-31', 2)));
assert.strictEqual(withNewHand.hands[0].handId, 'hand-31');
assert.strictEqual(withNewHand.selectedHand.handId, 'hand-10', 'I9 a newly finalized hand does not steal the selected older hand');
assert.ok(content.includes('recorded.recorded && handStatInspectorState.open') && content.includes('refreshHandStatInspectorView();'), 'I9 finalization uses the scroll-preserving targeted refresh');

// I10: the exact viewport clamp fits each required laptop height without page-level dialog overflow.
assert.match(cssRule('#pnhud-settings-panel .pnhud-hand-stat-inspector'), /height:\s*clamp\(300px, 62vh, 520px\)/);
assert.match(cssRule('#pnhud-settings-panel .pnhud-hand-stat-inspector'), /max-height:\s*calc\(100vh - 190px\)/);
[[1366, 768], [1440, 900], [1920, 1080]].forEach(function (viewport) {
  var viewportWidth = viewport[0];
  var viewportHeight = viewport[1];
  var preferredHeight = Math.min(520, Math.max(300, viewportHeight * 0.62));
  var settingsWidth = Math.min(780, viewportWidth - 24);
  assert.ok(Math.min(preferredHeight, viewportHeight - 190) <= viewportHeight - 190, 'I10 dialog fits viewport ' + viewportWidth + 'x' + viewportHeight);
  assert.ok(settingsWidth <= viewportWidth - 24 && settingsWidth >= 780, 'I10 settings/inspector width remains inside viewport ' + viewportWidth + 'x' + viewportHeight);
});

// S1-S6: seat overlays and leaderboard visibility are independent in both directions.
assert.strictEqual(overlays.modeForVisibility(true, true), 'seat-overlays-leaderboard');
assert.strictEqual(overlays.modeForVisibility(true, false), 'seat-overlays-only');
assert.strictEqual(overlays.modeForVisibility(false, true), 'leaderboard-only');
assert.strictEqual(overlays.modeForVisibility(false, false), 'hidden');
assert.deepStrictEqual(overlays.visibilityForMode(overlays.modeForVisibility(true, true)), { mode: 'seat-overlays-leaderboard', overlaysVisible: true, detailsVisible: true }, 'S1 both surfaces are visible');
assert.ok(content.includes('return PokerHudSettings.modeForVisibility(overlays, leaderboard)'), 'production settings use the canonical independent visibility preference');
assert.strictEqual(overlays.modeForVisibility(true, overlays.detailsEnabled('seat-overlays-leaderboard')), 'seat-overlays-leaderboard', 'S5 repeated overlay ON preserves leaderboard ON');
assert.strictEqual(overlays.modeForVisibility(false, overlays.detailsEnabled('seat-overlays-leaderboard')), 'leaderboard-only', 'S5 overlay OFF preserves leaderboard ON');
assert.strictEqual(overlays.modeForVisibility(overlays.overlaysEnabled('seat-overlays-leaderboard'), false), 'seat-overlays-only', 'S6 leaderboard OFF preserves overlays ON');
assert.strictEqual(overlays.modeForVisibility(overlays.overlaysEnabled('seat-overlays-only'), true), 'seat-overlays-leaderboard', 'S6 leaderboard ON preserves overlays ON');

// S2-S4 and S7-S8: the launcher wins its hitbox; closed UI leaves no pointer layer.
var seatLayer = zIndex('#pnhud-overlay-root');
var leaderboardLayer = zIndex('#pokernow-stats-hud-root');
var toggleLayer = zIndex('.pnhud-toggle');
var settingsLayer = zIndex('#pnhud-settings-panel');
assert.ok(seatLayer < leaderboardLayer && leaderboardLayer < toggleLayer && toggleLayer < settingsLayer, 'S2/S12 stacking preserves seat HUD < leaderboard < launcher < active settings/dialog');
assert.match(cssRule('#pnhud-overlay-root'), /pointer-events:\s*none/);
assert.match(cssRule('#pnhud-overlay-root .pnhud-seat-overlay'), /pointer-events:\s*auto/);
assert.match(cssRule('#pnhud-settings-panel\[hidden\]'), /display:\s*none\s*!important/);
var closedState = inspector.createState();
assert.strictEqual(inspector.renderHtml(inspector.buildModel(closedState, [largeHand])), '', 'S3/S7 closing removes inspector dialog markup entirely');
assert.doesNotMatch(largeHtml, /backdrop/i);
assert.doesNotMatch(cssRule('#pnhud-settings-panel .pnhud-hand-stat-inspector'), /position:\s*fixed|inset:/, 'S7/S8 inspector creates no viewport backdrop or transparent fixed hitbox');
assert.ok(content.includes("PokerHandStatInspector.close(handStatInspectorState)") && content.includes("settingsPanel.hidden = !hudUiPreferences.settingsOpen"), 'S3-S4 both inspector and settings close paths remove their interactive surface');

// S9-S11: layout mode, profile chips, and native clipping do not alter coexistence or hitboxes.
var sampleStats = { handsPlayed: 4, vpip: 50, pfr: 25, af: 1, threeBetMade: 1, threeBetOpportunities: 2, foldToThreeBet: 0, foldToThreeBetOpportunities: 1, flopCBetMade: 1, flopCBetOpportunities: 1, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1, wentToShowdown: 1, sawFlopForWTSD: 2, wonMoneyAtShowdown: 1, showdownsForWSD: 1 };
assert.ok(overlays.compactStatRows(sampleStats, overlayStats.DEFAULT_DISPLAYED_STAT_IDS, 'combined').length > 0);
assert.ok(overlays.compactStatRows(sampleStats, overlayStats.DEFAULT_DISPLAYED_STAT_IDS, 'stacked').length > 0);
assert.strictEqual(overlays.modeForVisibility(true, true), 'seat-overlays-leaderboard', 'S9 Combined/Stacked presentation is independent of surface visibility');
assert.ok(overlays.profileChipHtml({ archetype: 'TAG', presentation: { label: 'TAG', tone: 'tag' } }, true).includes('pnhud-profile-chip') || css.includes('.pnhud-profile-chip'), 'S10 profile chips remain scoped inside the low seat-overlay layer');
assert.ok(css.includes('.pnhud-native-panel-clip-defs') && cssRule('#pnhud-overlay-root .pnhud-native-panel-clip-defs').includes('pointer-events: none'), 'S11 native-panel clip definitions remain non-interactive');

console.log('Hand Inspector I1-I10 scrolling and HUD coexistence S1-S12 production regressions passed.');
