'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var support = require('./testSupport/productionContentScriptHarness.js');
var dashboard = require('./playerDashboard.js');
var seatOverlay = require('./seatOverlay.js');
var tooltip = require('./statTooltip.js');
var overlayStats = require('./overlayStats.js');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var registry = fs.readFileSync('./overlayStats.js', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });

assert.ok(isolated.js.includes('statTooltip.js'));
assert.ok(isolated.js.indexOf('overlayStats.js') < isolated.js.indexOf('statTooltip.js'));
assert.ok(isolated.js.indexOf('statTooltip.js') < isolated.js.indexOf('content.js'));
assert.strictEqual((content.match(/statTooltipElement = document\.createElement\('div'\)/g) || []).length, 1, 'single tooltip DOM owner');
assert.ok(content.includes("var statTooltipId = 'pnhud-stat-tooltip'"));
assert.ok(content.includes('statTooltipElement.id = statTooltipId'));
assert.ok(content.includes("statTooltipElement.setAttribute('role', 'tooltip')"));
assert.ok(content.includes("target.setAttribute('aria-describedby', statTooltipElement.id)"));
assert.ok(content.includes("activeStatTooltipTarget.removeAttribute('aria-describedby')"));
assert.ok(content.includes("event.key === 'Escape' && statTooltipUiDiagnostics.tooltipVisible"));
assert.ok(content.includes("document.addEventListener('pointerover', handleStatTooltipPointerOver, true)"));
assert.ok(content.includes("document.addEventListener('focusin', handleStatTooltipFocusIn, true)"));
assert.ok(content.includes('statTooltipListenersInstalled'), 'delegated listeners have one owner');
assert.ok(content.includes('closeStatTooltip(\'HUD rerender or scope change\')'), 'scope/rerender closes stale tooltip');
assert.ok(content.includes("return '<th>' + statTooltipTargetHtml"), 'headers use generic formula targets');
assert.ok(content.includes("statTooltipTargetHtml(definition, value, playerKey"), 'leaderboard values use player formula targets');
assert.ok(content.includes("return '<td>' + statTooltipTargetHtml(definition, value, playerKey, currentStatsScope) + '</td>'"), 'AF and other leaderboard values retain the same tooltip-trigger markup without a presentation-only cell class');
assert.ok(!content.includes('pnhud-af'), 'production leaderboard cells no longer receive the AF dotted-underline class');
assert.ok(!/td\.pnhud-af|text-decoration:\s*underline\s+dotted/.test(css), 'production CSS contains no AF dotted underline rule');
assert.ok(content.includes('statTooltipTargetHtml(item.definition, item.label'), 'row-grouped seat segments use the same tooltip path');
assert.ok(content.includes("event.target.closest('.pnhud-stat-tooltip-target, .pnhud-profile-tooltip-target')"), 'profile chips reuse the single delegated tooltip listener path');
assert.ok(content.includes("target.classList.contains('pnhud-profile-tooltip-target')"), 'the tooltip owner recognizes profile-chip targets');
assert.ok(content.includes('PokerSeatOverlay.visibleProfilePresentation(tooltipProfile, true)'), 'tooltip identity comes from the allow-listed displayed-profile presentation');
assert.ok(content.includes('PokerSeatOverlay.profileTooltipHtml(tooltipProfile, true, target.dataset.pnhudProfileSource, target.dataset.pnhudSeatStatSource)'), 'profile-fit copy and truthful Session/Career source note come from the pure seat-overlay presentation helper');
assert.ok(content.includes('PokerStatTooltip.choosePlacement(profileAnchor'), 'profile tooltip reuses the established viewport placement helper');
assert.ok(content.includes("var grip = event.target.closest && event.target.closest('.pnhud-overlay-grip')") && content.includes('if (!grip || !element.contains(grip)) return;'), 'seat dragging rejects tooltip/profile targets because only the owned grip can begin it');
assert.ok(content.includes("'[data-pnhud-interactive]', '.pnhud-stat-tooltip-target'"), 'the shared leaderboard drag exclusion still rejects tooltip targets');
assert.ok(css.includes('#pnhud-stat-tooltip { position: fixed;'));
assert.ok(css.includes('pointer-events: none'));
assert.ok(css.includes('.pnhud-stat-tooltip-target:focus-visible'));
assert.ok(css.includes('.pnhud-profile-tooltip-target:focus-visible'), 'profile tooltip trigger retains keyboard focus accessibility');
assert.ok(content.includes('statTooltipUi: cloneJson(statTooltipUiDiagnostics)'));
assert.ok(content.includes('model.displayRows || [model.numerator, model.denominator]'), 'optional metadata row order feeds the generic renderer');
assert.ok(content.includes("model.summary ? '<p class=\"pnhud-tooltip-summary\">'"), 'optional CB/FCB made-from-opportunities summary uses the generic tooltip renderer');
assert.ok(registry.includes("fullName: 'Flop CBet'"));
assert.ok(registry.includes("fullName: 'Fold to Flop CBet'"));
assert.ok(!registry.includes("customizable: false"), 'CB/FCB reuse the existing visibility controls without changing tooltip ownership');
assert.ok(css.includes('.pnhud-tooltip-summary'));
assert.ok(registry.includes("var components = [count('Bets', bets), count('Raises', raises)];"), 'AF components contain Bets and Raises only');
assert.ok(registry.includes('displayRows: [numerator].concat(components, [denominator])'), 'AF owns its exact nonduplicated display order');
assert.ok(!registry.includes('Passive actions'), 'AF denominator is never mislabeled as passive actions');
assert.ok(/seatOverlayController\.reconcile\(entries, \{ displayMode: displayMode \}\);\s*registerSeatOverlayTooltipPlayers\(\);/.test(content),
  'every settled Seat HUD reconcile restores tooltip data even when displayed values skip a DOM update');
assert.ok(/tooltipStatsByPlayerKey\.clear\(\);[\s\S]*?var rows = leaderboardRows\(data\);\s*\/\/ Existing seat cards remain interactive until the throttled reconcile runs\.\s*registerSeatOverlayTooltipPlayers\(true\);[\s\S]*?scheduleSeatOverlayReconcile\('leaderboard render'\);/.test(content),
  'render restores existing Seat HUD tooltip data before the delayed reconcile');

function hand(index) {
  var walk = index < 28;
  var eligibleIndex = index - 28;
  var action = walk ? 'blind' : eligibleIndex === 2 ? 'raise' : eligibleIndex < 2 || eligibleIndex === 29 ? 'call' : 'fold';
  var id = 'DETAIL-' + index;
  var subject = { handId: id, playerId: 'P1', player: 'Hero', street: 'preflop', action: action,
    blindType: walk ? 'big' : null, amount: action === 'raise' ? 20 : action === 'call' ? 10 : 0, timestamp: index * 10 + 1 };
  if (eligibleIndex === 0) Object.assign(subject, { threeBetMade: 1, threeBetOpportunities: 1,
    foldToThreeBet: 1, foldToThreeBetOpportunities: 1, flopCBetMade: 1, flopCBetOpportunities: 1,
    foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1, sawFlopForWTSD: 1, wentToShowdown: 1,
    showdownsForWSD: 1, wonMoneyAtShowdown: 1 });
  var events = [subject, { handId: id, playerId: 'P2', player: 'Opponent', street: 'preflop',
    action: walk ? 'fold' : 'dealt', amount: 0, timestamp: index * 10 + 2 }];
  if (eligibleIndex === 0) events.push({ handId: id, playerId: 'P1', player: 'Hero', street: 'flop', action: 'bet', amount: 10, timestamp: index * 10 + 3 });
  if (eligibleIndex === 1) events.push({ handId: id, playerId: 'P1', player: 'Hero', street: 'flop', action: 'call', amount: 10, timestamp: index * 10 + 3 });
  return events;
}
var hands = Array.from({ length: 58 }, function (_, index) { return hand(index); });
var baselineEvents = hands.slice(0, -1).flat();
var finalHand = hands.at(-1);
var harness = support.createHarness({ gameId: 'tooltip-live-refresh', runtimeSendMessage: function (_message, callback) { callback({ ok: true, value: {} }); },
  transformContentSource: function (source) {
    source = source.replace('function cachedSessionFilteredStats(playerId, filters) {',
      'function cachedSessionFilteredStats(playerId, filters) { globalThis.detailFullFilteredQueries = (globalThis.detailFullFilteredQueries || 0) + 1;');
    return source.replace(/\n\}\)\(\);\s*$/, `
      globalThis.detailLiveProbe = {
        setup: function (baseline) {
          liveEvents = baseline.slice();
          sessionContextState = PokerFilteredStats.rebuildSessionContexts(baseline);
          playerDashboardState.open = true; playerDashboardState.mode = 'session';
          playerDashboardState.playerId = 'P1'; playerDashboardState.displayName = 'Hero';
          playerDashboardState.position = null; playerDashboardState.situation = 'overall'; playerDashboardState.opponentMode = 'overall';
          playerDashboardState.sessionStats = PokerStats.computePlayerStatsByIdentity(baseline, 'P1', 'Hero');
          globalThis.detailBaselineStats = playerDashboardState.sessionStats;
          playerDashboardState.coreStats = PokerFilteredStats.sessionStatsFiltered(baseline, 'P1', {});
          playerDashboardState.relationalStats = {}; playerDashboardState.sessionRevision = finalizedSessionRevision;
        },
        commit: function (events) {
          liveEvents = liveEvents.concat(events);
          advanceFinalizedSessionRevision('detail test complete hand', events);
          refreshPlayerDashboardSession(events);
          return cloneJson({ session: playerDashboardState.sessionStats, core: playerDashboardState.coreStats });
        },
        authoritative: function () { return cloneJson({
          session: PokerStats.computePlayerStatsByIdentity(liveEvents, 'P1', 'Hero'),
          core: PokerFilteredStats.sessionStatsFiltered(liveEvents, 'P1', {})
        }); },
        hydrated: function () {
          var restoredEvents = JSON.parse(JSON.stringify(liveEvents));
          return cloneJson({
            session: PokerStats.computePlayerStatsByIdentity(restoredEvents, 'P1', 'Hero'),
            core: PokerFilteredStats.sessionStatsFiltered(restoredEvents, 'P1', {})
          });
        },
        fullQueries: function () { return globalThis.detailFullFilteredQueries || 0; },
        prepareOverlay: function () {
          var entry = { playerId: 'P1', name: 'Hero', seatId: 'seat-P1', confirmed: true,
            rect: { left: 1, top: 1, width: 10, height: 10 }, stats: playerDashboardState.sessionStats,
            statSource: 'session', displayedStatIds: ['vpip'] };
          globalThis.detailOverlayEntry = entry;
          globalThis.detailOverlayUpdates = 0;
          seatOverlayController = PokerSeatOverlay.createController({
            create: function () { return document.createElement('div'); },
            update: function () { globalThis.detailOverlayUpdates += 1; },
            move: function () {}, position: function () {}, remove: function () {}, skip: function () {}
          });
          seatOverlayController.reconcile([entry], { displayMode: 'seat-overlays-only' });
          registerSeatOverlayTooltipPlayers();
          tooltipStatsByPlayerKey.clear();
          seatOverlayController.reconcile([entry], { displayMode: 'seat-overlays-only' });
          var missingAfterSkippedUpdate = !tooltipStatsByPlayerKey.has('session|P1');
          registerSeatOverlayTooltipPlayers();
          return { updates: globalThis.detailOverlayUpdates, missingAfterSkippedUpdate: missingAfterSkippedUpdate,
            registered: tooltipStatsByPlayerKey.has('session|P1') };
        },
        immediateAfterRender: function () {
          seatOverlayController.records.get('P1').entry.stats = globalThis.detailBaselineStats;
          tooltipStatsByPlayerKey.clear();
          registerSeatOverlayTooltipPlayers(true);
          var record = tooltipStatsByPlayerKey.get('session|P1');
          seatOverlayController.records.get('P1').entry.stats = playerDashboardState.sessionStats;
          return { made: record.stats.vpipHands, opportunities: record.stats.vpipOpportunities,
            updates: globalThis.detailOverlayUpdates };
        },
        model: function (id) {
          var record = tooltipStatsByPlayerKey.get('session|P1');
          var definition = PokerOverlayStats.STAT_CATALOG[id];
          return cloneJson(PokerStatTooltip.buildModel(definition, record && record.stats,
            { playerName: record && record.playerName, playerId: record && record.playerId,
              scope: record ? 'Session' : null, displayedValue: definition.formatValue(definition.getValue(record && record.stats)) }));
        },
        popup: function (id) {
          var target = document.createElement('span'); document.body.appendChild(target);
          target.dataset.pnhudStatId = id; target.dataset.pnhudPlayerKey = 'session|P1'; target.dataset.pnhudScope = 'session';
          var definition = PokerOverlayStats.STAT_CATALOG[id];
          target.dataset.pnhudDisplayedValue = definition.formatValue(definition.getValue(playerDashboardState.sessionStats));
          openStatTooltip(target);
          return statTooltipElement.innerHTML;
        }
      };
    })();`);
  }
});
assert.deepStrictEqual(harness.evaluationErrors, []);
function probe(expression) { return harness.evaluateInIsolatedWorld('detailLiveProbe.' + expression); }
probe('setup(' + JSON.stringify(baselineEvents) + ')');
var beforeQueries = probe('fullQueries()');
var updated = JSON.parse(JSON.stringify(probe('commit(' + JSON.stringify(finalHand) + ')')));
assert.equal(probe('fullQueries()'), beforeQueries, 'live detail refresh adds no full-history filtered query');
assert.deepStrictEqual(updated, JSON.parse(JSON.stringify(probe('authoritative()'))), 'incremental public Session result equals hydrated authoritative result');
assert.deepStrictEqual(updated, JSON.parse(JSON.stringify(probe('hydrated()'))), 'persisted-event hydration preserves the same Session detail payload');
assert.deepStrictEqual([updated.session.handsPlayed, updated.session.vpipHands, updated.session.vpipOpportunities,
  updated.session.vpipDetails.callHands, updated.session.vpipDetails.raiseHands, updated.session.vpipDetails.walksExcluded],
  [58, 4, 30, 3, 1, 28], 'complete-hand BB walks and voluntary actions survive incremental refresh');
assert.deepStrictEqual(JSON.parse(JSON.stringify(probe('prepareOverlay()'))), { updates: 0, missingAfterSkippedUpdate: true, registered: true },
  'Seat HUD tooltip lookup is restored when unchanged displayed values skip DOM update');
assert.deepStrictEqual(JSON.parse(JSON.stringify(probe('immediateAfterRender()'))), { made: 4, opportunities: 30, updates: 0 },
  'the visible seat has current detail counts immediately after render clears its lookup, before reconcile updates its DOM');
assert.equal(probe('fullQueries()'), beforeQueries, 'tooltip registration does not re-enter historical Session filters');
var vpipModel = probe('model("vpip")');
assert.deepStrictEqual([vpipModel.numerator.value, vpipModel.denominator.value,
  vpipModel.components[0].value, vpipModel.components[1].value, vpipModel.exclusions[0].value], [4, 30, 3, 1, 28]);
assert.match(probe('popup("vpip")'), /4 ÷ 30 = 13\.3%/);
assert.match(probe('popup("vpip")'), /Displayed: 13%/);
var vpipCard = dashboard.fromCounterResult(updated.core, 'session', { position: null, situation: 'overall' }).find(function (card) { return card.id === 'vpip'; });
assert.deepStrictEqual([vpipCard.numerator, vpipCard.denominator, vpipCard.evidence.supportCount, vpipCard.value], [4, 30, 30, '13.3%'],
  'card, Evidence, and detail use the same current numerator and support');
var expectedDetails = {
  pfr: [1, 30], af: [1, 1], threeBet: [1, 1], foldToThreeBet: [1, 1],
  flopCBet: [1, 1], foldToFlopCBet: [1, 1], wtsd: [1, 1], wsd: [1, 1]
};
['hands', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'].forEach(function (id) {
  var model = probe('model(' + JSON.stringify(id) + ')');
  assert.ok(model.components.length || model.numerator, id + ' retains dynamic count rows');
  if (id === 'hands') assert.equal(model.components[0].value, 58);
  else assert.deepStrictEqual([model.numerator.value, model.denominator.value], expectedDetails[id], id + ' retains its exact current breakdown');
  assert.match(probe('popup(' + JSON.stringify(id) + ')'), /pnhud-tooltip-counts/, id + ' popup renders current calculation counts');
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(probe('model("af")').displayRows.map(function (row) { return row.value; }))), [1, 1, 0, 1],
  'AF keeps aggressive, bet, raise, and call detail rows');
var careerStats = seatOverlay.careerStatsToOverlayStats({ counters: { hands: 58, vpipMade: 4, vpipOpportunities: 30,
  pfrMade: 1, pfrOpportunities: 30, postflopAggressiveActions: 1, postflopCalls: 1,
  threeBetMade: 1, threeBetOpportunities: 1, foldToThreeBet: 1, foldToThreeBetOpportunities: 1,
  flopCBetMade: 1, flopCBetOpportunities: 1, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1,
  wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1 } });
assert.deepStrictEqual([tooltip.buildModel(overlayStats.STAT_CATALOG.vpip, careerStats).numerator.value,
  tooltip.buildModel(overlayStats.STAT_CATALOG.vpip, careerStats).denominator.value], [4, 30],
  'Career tooltip still uses its existing aggregate adapter');

console.log('Single-instance accessible leaderboard and seat stat tooltip production tests passed.');
