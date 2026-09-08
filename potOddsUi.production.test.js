'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var settings = require('./settingsUi.js');
var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var potOdds = fs.readFileSync('./potOdds.js', 'utf8');
var boardLayout = fs.readFileSync('./boardCompanionLayout.js', 'utf8');

var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
assert.ok(isolated.js.includes('boardCompanionLayout.js'));
assert.ok(isolated.js.includes('potOdds.js'));
assert.ok(isolated.js.indexOf('uiBootstrap.js') < isolated.js.indexOf('boardCompanionLayout.js'));
assert.ok(isolated.js.indexOf('boardCompanionLayout.js') < isolated.js.indexOf('potOdds.js'));
assert.ok(isolated.js.indexOf('potOdds.js') < isolated.js.indexOf('content.js'));

assert.ok(content.includes("localUserIdentityEvidence = { playerId: localUserPlayerId, source: 'registered.currentPlayer.id'"), 'canonical self remains registered identity');
var seatPresenter = content.slice(content.indexOf('function seatOverlayContent'), content.indexOf('function seatOverlayHasVisibleContent'));
assert.doesNotMatch(seatPresenter, /PokerPotOdds|potOddsDecision|pnhud-pot-odds/, 'pot odds do not belong to a seat HUD row');
assert.match(content, /var widget = PokerPotOdds\.widgetHtml\(presentationDecision\)[\s\S]*heroPotOddsElement\.innerHTML = widget/, 'one dedicated host owns content');
assert.match(content, /var heroPotOddsElementId = 'pnhud-hero-pot-odds'[\s\S]*canonical\.id = heroPotOddsElementId/, 'host has stable identity');
assert.match(content, /var potOddsRootId = 'pnhud-pot-odds-root'[\s\S]*appendChild\(potOddsLayer\)/, 'root is extension owned');

assert.match(content, /PokerBoardCompanionLayout\.createState\(\{ tableId: pokerNowGameId, maxHistory: 48 \}\)/, 'one shared layout state exists');
assert.match(content, /function boardCompanionPotOddsAnchors\(panelSize, reason\)[\s\S]*PokerBoardCompanionLayout\.resolveDom/, 'pot odds consume the shared layout-epoch service');
assert.match(content, /var anchors = boardCompanionPotOddsAnchors\(panelSize, reason\)/, 'legacy street-specific resolver is not the production placement call');
assert.doesNotMatch(content.slice(content.indexOf('function positionHeroPotOdds'), content.indexOf('function renderHeroPotOdds')), /heroPotOddsAnchors\(\)/, 'positioning cannot fall back to hero/street-specific anchors');
assert.match(boardLayout, /SLOT_SELECTORS[\s\S]*table-card-slot[\s\S]*data-card-slot/, 'explicit slot children are preferred evidence');
assert.match(boardLayout, /canonicalBoardLocalRect[\s\S]*layoutEpochId/, 'one table-local canonical model is owned by a layout epoch');
assert.match(boardLayout, /validation-disagreement|validated-against-immutable-epoch-model/, 'actual cards are validation-only evidence');
assert.match(boardLayout, /ILLEGAL_CANONICAL_GEOMETRY_CHANGE/, 'same-epoch replacement proposals are rejected and logged');
assert.match(boardLayout, /actual viewport, zoom, or visual-viewport scale changed/, 'genuine viewport changes establish a diagnosed epoch');
assert.doesNotMatch(content, /function (?:resolveCanonicalBoardSlot|preflopBoardCompanionRegion|actualCommunityBoardRegion|heroPotOddsAnchors)/, 'street/card/virtual anchor ownership paths are removed');
assert.match(boardLayout, /boardRect\.left - gap - width/, 'LEFT companion is derived directly from board left');
assert.match(boardLayout, /boardRect\.right \+ gap/, 'RIGHT companion is reserved from board right');

assert.match(content, /var visible = hudUiPreferences\.showPotOdds && Boolean\(presentationDecision\)/, 'pot-odds setting and table applicability gate the host independently of seat-HUD visibility');
assert.match(content, /contentState = currentDecisionAvailable[\s\S]*'CALL'[\s\S]*'ZERO'[\s\S]*'UNKNOWN'/, 'CALL/ZERO/UNKNOWN are explicit');
assert.match(content, /heroFolded \|\| heroAllIn[\s\S]*definitelyZero/, 'fold and all-in map to visible ZERO content');
assert.match(content, /terminal: Boolean\(terminalSettlement\)/, 'terminal evidence reaches table presentation');
assert.match(content, /forceZero: true/, 'live tracker resets retain a visible zero table companion');
assert.match(content, /canonical local player is no longer seated/, 'seat departure is a true hide condition');
assert.doesNotMatch(content, /hero is all-in and no longer actionable under UI policy|hero folded'\s*:\s*null/, 'former all-in/fold hide policy is removed');

assert.ok(content.includes('PokerNowHUDPotOdds'));
assert.ok(content.includes('PokerNowHUDBoardCompanion'));
assert.match(content, /layoutInfo: function \(\)/);
assert.match(content, /captureLayoutSnapshot: function \(\)/);
assert.match(boardLayout, /privacy: 'geometry and board-layout identifiers only; no names, card values, or chat'/, 'snapshot privacy contract is explicit');
assert.match(boardLayout, /state\.history\.length > state\.maxHistory/, 'layout history is bounded');
assert.match(content, /debugTimeline: function \(\)[\s\S]*capacity: 96/, 'pot-odds forensic history remains bounded');

assert.ok(potOdds.includes('highestLiveContestableContribution'));
assert.ok(potOdds.includes('rejectionGate'));
assert.ok(potOdds.includes("players.slice(0, 10)"), 'arithmetic diagnostics remain bounded');
assert.strictEqual(settings.DEFAULTS.showPotOdds, true);
assert.strictEqual(settings.merge(settings.DEFAULTS, { showPotOdds: false }).showPotOdds, false);
assert.ok(content.includes('Show pot odds'));
assert.ok(content.includes("updateHudUiPreferences({ showPotOdds: event.target.checked }, 'hud-pot-odds')"));

assert.match(css, /#pnhud-pot-odds-root \{ position: fixed; z-index: 2147483644/);
assert.match(css, /#pnhud-pot-odds-root \.pnhud-hero-pot-odds \{ position: fixed/);
assert.match(css, /width: 100px; min-height: 60px/);
assert.doesNotMatch(css, /pnhud-has-pot-odds/, 'seat HUD height remains independent');
assert.match(content, /function potOddsPlacementObstacles/);
assert.match(content, /collisionReason: placement\.collisionReason/, 'collisions are diagnosed without side switching');
assert.match(content, /side: 'right-reserved'/, 'future RIGHT slot is exposed but unused');
assert.match(content, /selectedSide: proposedLeft \? 'left' : null/, 'pot odds cannot select RIGHT');
assert.match(content, /ensureHeroPotOddsVisibility\('window or table viewport resized'\)/, 'viewport remains a legitimate reconcile signal');
assert.doesNotMatch(content, /slow supported visibility reconciliation|heroPotOddsVisibilityTimer|timerRetries % 25/, 'no permanent visibility polling');
assert.match(content, /cancelHeroPotOddsVisibilityGuarantee\('extension cleanup'\)/);

assert.match(potOdds, /unknown = decision\.presentationState === 'UNKNOWN'/);
assert.match(potOdds, /callText = unknown \? '—'/);
assert.match(potOdds, /needText = unknown \? '—'/);
assert.match(potOdds, /Before rake; future betting not included/);
assert.doesNotMatch(potOdds, /indexedDB|career|profile|notes/i, 'ephemeral feature has no persistence coupling');
assert.doesNotMatch(potOdds, /outs|draw detection|range|recommend|card rank|card suit/i, 'no probability engine is added');
assert.ok(potOdds.includes('data-pnhud-interactive="true" aria-label="Pot odds. '));
assert.match(potOdds, /pnhud-pot-odds-title[^>]*data-pnhud-pot-odds-drag-handle="true"[^>]*>POT ODDS/);
assert.doesNotMatch(potOdds + css, /turn probability|river probability|turn\/river info/i, 'future probability panel is not implemented');

var dragStart = content.indexOf('function beginOverlayDrag');
var dragEnd = content.indexOf('function installDragBehavior', dragStart);
assert.ok(content.slice(dragStart, dragEnd).includes("event.target.closest('.pnhud-overlay-grip')"));
assert.ok(content.includes("event.target.closest('.pnhud-player-name')"));

console.log('Pot-odds table-lifetime, shared board companion, diagnostics, snapshot, toggle, and preservation production tests passed.');
