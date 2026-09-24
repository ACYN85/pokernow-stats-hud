(function () {
  'use strict';
  var console = globalThis.PokerHudDiagnostics && typeof globalThis.PokerHudDiagnostics.createConsole === 'function'
    ? globalThis.PokerHudDiagnostics.createConsole(globalThis.console)
    : globalThis.console;
  var PNHUD_BUILD_ID = 'v1.2.0-rc2-20260922-1612';
  var PNHUD_EXTENSION_ID = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id || 'unavailable';
  var runtimeScopeFallbackActive = false;

  function preflopDebug(stage, details) {
    var debugConsole = globalThis.console;
    if (globalThis.__PNHUD_PREFLOP_DEBUG__ === true && debugConsole && typeof debugConsole.log === 'function') {
      debugConsole.log('[PNHUD PREFLOP DEBUG]', Object.assign({ stage: stage }, details || {}));
    }
  }

  function showdownDebug(stage, details) {
    var debugConsole = globalThis.console;
    var exporter = globalThis.PokerShowdownDiagnosticExporter;
    var enabled = globalThis.__PNHUD_SHOWDOWN_DEBUG__ === true || Boolean(exporter && typeof exporter.enabled === 'function' && exporter.enabled());
    if (enabled && exporter && typeof exporter.record === 'function') exporter.record(stage, details || {});
    if (enabled && debugConsole && typeof debugConsole.log === 'function') {
      debugConsole.log('[PNHUD SHOWDOWN DEBUG]', Object.assign({ stage: stage }, details || {}));
    }
  }

  function preflopCounterFields(value) {
    value = value || {};
    return {
      threeBetMade: Number(value.threeBetMade || 0),
      threeBetOpportunities: Number(value.threeBetOpportunities || 0),
      foldToThreeBet: Number(value.foldToThreeBet || 0),
      foldToThreeBetOpportunities: Number(value.foldToThreeBetOpportunities || 0),
      flopCBetMade: Number(value.flopCBetMade || 0),
      flopCBetOpportunities: Number(value.flopCBetOpportunities || 0),
      foldToFlopCBet: Number(value.foldToFlopCBet || 0),
      foldToFlopCBetOpportunities: Number(value.foldToFlopCBetOpportunities || 0)
    };
  }

  function preflopEventSnapshots(events) {
    return (events || []).filter(function (event) {
      return ['threeBetMade', 'threeBetOpportunities', 'foldToThreeBet', 'foldToThreeBetOpportunities', 'flopCBetMade', 'flopCBetOpportunities', 'foldToFlopCBet', 'foldToFlopCBetOpportunities'].some(function (field) {
        return Object.prototype.hasOwnProperty.call(event || {}, field);
      });
    }).map(function (event, index) {
      return {
        eventId: String(event.eventKey || event.eventId || event.handId + ':' + (event.playerId || event.player || 'unknown') + ':' + index),
        handId: event.handId,
        playerId: event.playerId || null,
        player: event.player || null,
        counters: preflopCounterFields(event)
      };
    });
  }

  function showdownEventSnapshots(events) {
    return (events || []).filter(function (event) {
      return ['sawFlopForWTSD', 'wentToShowdown', 'showdownsForWSD', 'wonMoneyAtShowdown'].some(function (field) {
        return Object.prototype.hasOwnProperty.call(event || {}, field);
      });
    }).slice(-80).map(function (event, index) {
      return {
        eventId: String(event.eventKey || event.eventId || event.handId + ':' + (event.playerId || event.player || 'unknown') + ':' + index),
        handId: event.handId === null || event.handId === undefined ? null : String(event.handId),
        playerId: event.playerId === null || event.playerId === undefined ? null : String(event.playerId),
        contributionId: event.showdownStatsContributionId || null,
        fields: {
          sawFlopForWTSD: Number(event.sawFlopForWTSD || 0),
          wentToShowdown: Number(event.wentToShowdown || 0),
          showdownsForWSD: Number(event.showdownsForWSD || 0),
          wonMoneyAtShowdown: Number(event.wonMoneyAtShowdown || 0)
        }
      };
    });
  }

  function showdownCounterFields(value) {
    value = value || {};
    return {
      sawFlopForWTSD: Number(value.sawFlopForWTSD || 0),
      wentToShowdown: Number(value.wentToShowdown || 0),
      showdownsForWSD: Number(value.showdownsForWSD || 0),
      wonMoneyAtShowdown: Number(value.wonMoneyAtShowdown || 0)
    };
  }

  function showdownHandIdsForPlayer(playerName) {
    return Array.from(new Set(liveEvents.filter(function (event) {
      return event && event.player === playerName && ['sawFlopForWTSD', 'wentToShowdown', 'showdownsForWSD', 'wonMoneyAtShowdown'].some(function (field) {
        return Object.prototype.hasOwnProperty.call(event, field);
      });
    }).map(function (event) { return String(event.handId); }))).slice(-20);
  }

  function recordShowdownRenderedTotals(surface, playerId, playerName, stats) {
    var wtsdDefinition = PokerOverlayStats && PokerOverlayStats.STAT_CATALOG && PokerOverlayStats.STAT_CATALOG.wtsd;
    var wsdDefinition = PokerOverlayStats && PokerOverlayStats.STAT_CATALOG && PokerOverlayStats.STAT_CATALOG.wsd;
    showdownDebug('rendered-totals', {
      surface: surface,
      playerId: playerId === null || playerId === undefined ? null : String(playerId),
      candidateHandIds: showdownHandIdsForPlayer(playerName),
      fields: showdownCounterFields(stats),
      formattedWTSD: wtsdDefinition ? wtsdDefinition.formatValue(wtsdDefinition.getValue(stats)) : null,
      formattedWSD: wsdDefinition ? wsdDefinition.formatValue(wsdDefinition.getValue(stats)) : null
    });
  }
  console.log('[HUD BUILD] content ' + PNHUD_BUILD_ID, { extensionId: PNHUD_EXTENSION_ID, href: location.href });
  console.log('[HUD UI BOOT 1] content script loaded', { locationHref: location.href, hostname: location.hostname, pathname: location.pathname });
  var EARLY_BOOTSTRAP_BADGE_ID = 'pnhud-bootstrap-badge';
  var earlyBootBadgeState = { text: 'PokerNow HUD UI bootstrap reached', failure: false };
  showEarlyBootBadge(earlyBootBadgeState.text, false);
  var locationSnapshot = {
    href: String(location.href || ''),
    protocol: String(location.protocol || ''),
    hostname: String(location.hostname || ''),
    pathname: String(location.pathname || '')
  };
  var sharedRuntimeScope = globalThis.PokerNowRuntimeScope;
  var runtimeScope = sharedRuntimeScope;
  var runtimeScopeFunctionType = sharedRuntimeScope ? typeof sharedRuntimeScope.isPokerNowGamePage : 'undefined';
  var runtimeScopeFunctionExists = runtimeScopeFunctionType === 'function';
  var fallbackGuardResult = localFallbackGameGuard(window.location);
  var guardResult = runtimeScopeFunctionExists ? false : fallbackGuardResult;
  var guardError = null;
  try {
    if (runtimeScopeFunctionExists) guardResult = Boolean(sharedRuntimeScope.isPokerNowGamePage(window.location));
  } catch (error) {
    guardError = error;
  }
  console.log('[HUD UI BOOT 1.1] runtime guard symbol check', {
    helperScriptLoaded: Boolean(sharedRuntimeScope),
    namespaceExists: Boolean(sharedRuntimeScope),
    functionExists: runtimeScopeFunctionExists,
    functionType: runtimeScopeFunctionType,
    manifestOrder: 'runtimeScope.js -> dependencies -> content.js',
    guardResult: guardResult,
    fallbackGuardResult: fallbackGuardResult,
    fallbackActive: !runtimeScopeFunctionExists
  });
  console.log('[HUD UI BOOT 1.2] URL parsed', Object.assign({}, locationSnapshot));
  if (!sharedRuntimeScope || !runtimeScopeFunctionExists) {
    runtimeScopeFallbackActive = true;
    runtimeScope = Object.freeze({ isPokerNowGamePage: localFallbackGameGuard, isSupportedLocation: localFallbackGameGuard });
    (console.warn || console.log).call(console, '[HUD PACKAGING DIAGNOSTIC] runtimeScope.js did not install globalThis.PokerNowRuntimeScope before content.js; clean local guard active', {
      buildId: PNHUD_BUILD_ID,
      href: locationSnapshot.href,
      expectedManifestOrder: 'runtimeScope.js -> dependencies -> content.js',
      localGuardAccepted: fallbackGuardResult
    });
    showEarlyBootBadge('PokerNow HUD packaging warning: shared runtime guard helper is missing; local fallback active · Build ' + PNHUD_BUILD_ID, true);
    guardResult = fallbackGuardResult;
  }
  console.log('[HUD UI BOOT 1.3] guard result', {
    guardResult: guardResult,
    invocation: 'globalThis.PokerNowRuntimeScope.isPokerNowGamePage(window.location)',
    href: locationSnapshot.href
  });
  if (guardError) {
    runtimeScopeFallbackActive = true;
    runtimeScope = Object.freeze({ isPokerNowGamePage: localFallbackGameGuard, isSupportedLocation: localFallbackGameGuard });
    guardResult = fallbackGuardResult;
    (console.warn || console.log).call(console, '[HUD PACKAGING DIAGNOSTIC] shared runtime guard threw; clean local guard active', { buildId: PNHUD_BUILD_ID, message: String(guardError.message || guardError), localGuardAccepted: fallbackGuardResult });
    showEarlyBootBadge('PokerNow HUD packaging warning: shared runtime guard threw; local fallback active · Build ' + PNHUD_BUILD_ID, true);
  }
  if (!guardResult) {
    abortUiBoot('1.3', 'shared runtime guard rejected the current PokerNow game URL', null, {
      guardResult: false,
      missingSymbol: '',
      missingModule: ''
    });
    return;
  }
  console.log('[HUD UI BOOT 2] runtime guard passed', { locationHref: location.href, hostname: location.hostname, pathname: location.pathname, fallbackActive: runtimeScopeFallbackActive });
  if (!verifyUiModules()) return;
  console.log('[HUD] content script loaded');
  console.log('[HUD] init started');

  var rootId = 'pokernow-stats-hud-root';
  var detailsRootId = 'pnhud-details-root';
  var overlayRootId = 'pnhud-overlay-root';
  var potOddsRootId = 'pnhud-pot-odds-root';
  var heroPotOddsElementId = 'pnhud-hero-pot-odds';
  var toggleRootId = 'pnhud-toggle-root';
  var settingsLauncherId = 'pnhud-settings-launcher';
  var settingsPanelId = 'pnhud-settings-panel';
  var trackedPlayersPanelId = 'pnhud-tracked-players';
  var playerDashboardId = 'pnhud-player-dashboard';
  var statTooltipId = 'pnhud-stat-tooltip';
  var bootstrapBadgeId = 'pnhud-bootstrap-badge';
  var pauseMarkerIndicatorId = 'pnhud-pause-marker-indicator';
  var hudRuntimeBadgeSelector = '.pnhud-status-area .pnhud-demo';
  var hudRuntimeFooterSelector = '.pnhud-note';
  var isPokerNowPage = runtimeScope.isPokerNowGamePage(window.location);
  var pokerNowGameId = extractPokerNowGameId();
  var gameSessionKey = isPokerNowPage ? location.hostname + ':' + pokerNowGameId : 'demo';
  var storageNamespace = 'game:' + encodeURIComponent(gameSessionKey);
  var contentInitializedAt = Date.now();
  globalThis.__PNHUD_ACTIVE_CONTENT_INSTANCES__ = globalThis.__PNHUD_ACTIVE_CONTENT_INSTANCES__ || {};
  globalThis.__PNHUD_CONTENT_INSTANCE_SEQUENCE__ = Number(globalThis.__PNHUD_CONTENT_INSTANCE_SEQUENCE__ || 0) + 1;
  var contentScriptInstanceId = PNHUD_BUILD_ID + ':content:' + globalThis.__PNHUD_CONTENT_INSTANCE_SEQUENCE__ + ':' + contentInitializedAt;
  var runtimeStatusStoreInstanceId = contentScriptInstanceId + ':runtime-status';
  var hudRendererInstanceId = contentScriptInstanceId + ':renderer';
  // The DOM epoch spans isolated-world replacements as well as same-world
  // reinjection. Transfer synchronously retires the predecessor before startup.
  var controllerOwnerAttribute = 'data-pnhud-controller-owner';
  var controllerOwnerToken = contentScriptInstanceId + ':' + Math.random().toString(36).slice(2);
  document.documentElement.setAttribute(controllerOwnerAttribute, controllerOwnerToken);
  document.dispatchEvent(new Event('pnhud-controller-claimed'));
  document.addEventListener('pnhud-controller-claimed', handleControllerClaimed);

  function ownsRuntimeController() {
    return !extensionCleanedUp && document.documentElement.getAttribute(controllerOwnerAttribute) === controllerOwnerToken;
  }

  function requireRuntimeController() {
    if (!ownsRuntimeController()) throw new Error('superseded content controller');
  }

  function handleControllerClaimed() {
    if (!ownsRuntimeController()) cleanupExtension('superseded content controller');
  }

  globalThis.__PNHUD_ACTIVE_CONTENT_INSTANCES__[contentScriptInstanceId] = true;
  var firstHandLifecycle = PokerFirstHandLifecycle.create({
    buildId: PNHUD_BUILD_ID,
    lobbySessionKey: gameSessionKey,
    startupType: 'cold-start',
    startedAt: contentInitializedAt,
    details: { event: 'content.js startup began', href: location.href, storageNamespace: storageNamespace }
  });
  var LEGACY_LIVE_KEY = 'pokerNowHudLiveEvents';
  var STORAGE_KEYS = {
    session: 'pokerNowHudSessionEvents',
    allTime: 'pokerNowHudAllTimeEvents',
    live: 'pokerNowHudLiveEvents:' + storageNamespace,
    liveRevision: 'pokerNowHudLiveEventsRevision:' + storageNamespace,
    fingerprints: 'pokerNowHudLiveFingerprints:' + storageNamespace,
    schema: 'pokerNowHudLiveSchemaVersion:' + storageNamespace,
    playerMap: 'pokerNowHudPlayerMap:' + storageNamespace,
    handSignatures: 'pokerNowHudHandSignatures:' + storageNamespace,
    activeHand: 'pokerNowHudActiveHand:' + storageNamespace,
    finalizedHandIds: 'pokerNowHudFinalizedHandIds:' + storageNamespace,
    hostControl: 'pokerNowHudHostControl:' + storageNamespace,
    potOddsBoardReset: 'pokerNowHudPotOddsBoardReset:' + storageNamespace,
    sessionMeta: 'pokerNowHudSessionMeta:' + storageNamespace,
    mode: 'pokerNowHudMode',
    displayMode: 'pokerNowHudDisplayMode',
    showOverlayBoxes: 'pokerNowHudShowOverlayBoxes',
    debugSeatIdentity: 'pokerNowHudDebugSeatIdentity',
    showWithheldPlaceholders: 'pokerNowHudShowWithheldPlaceholders',
    presentationPreferencesSchema: 'pokerNowHudPresentationPreferencesSchema',
    overlayDraggingUnlocked: 'pokerNowHudOverlayDraggingUnlocked',
    manualOverlayPositions: 'pokerNowHudManualOverlayPositions:game:' + encodeURIComponent(pokerNowGameId),
    overlayStatPreferences: 'overlayStatPreferences',
    leaderboardStatPreferences: 'leaderboardStatPreferences',
    leaderboardHudPosition: 'leaderboardHudPosition',
    hudUiPreferences: 'hudUiPreferences',
    diagnosticsLevel: 'pokerNowHudDiagnosticsLevel',
    pauseLifecycleCaptureEnabled: 'pokerNowHudPauseLifecycleCaptureEnabled',
    playerNotes: 'pokerNowHudPlayerNotesV1'
  };
  console.log('[HUD] current game/session key', gameSessionKey);
  console.log('[HUD] storage namespace', { gameId: pokerNowGameId, sessionKey: gameSessionKey, namespace: storageNamespace });
  traceFirstHandLifecycle('initialization', { event: 'content initialized and websocket listener about to install', timestampName: 'contentInitializedAt', previousSnapshotPresent: false, activeHand: null }, contentInitializedAt);
  var observedLog = null;
  var logObserver = null;
  var panelDiscoveryObserver = null;
  var activePanel = null;
  var activeFullLogTab = null;
  var activeFullLogContent = null;
  var fullLogPollInterval = null;
  var fullLogPollAttempts = 0;
  var waitingForFullLogLogged = false;
  var logContainerHidden = false;
  var diagnosedFullLogButtons = new WeakSet();
  var processedNodes = new WeakSet();
  var processedText = new WeakMap();
  var backfillingFullLog = false;
  var handLogDomState = PokerHandLogDom.createState();
  var gameBreakLifecycleState = PokerGameBreakLifecycle.createState({ buildId: PNHUD_BUILD_ID, gameSessionKey: gameSessionKey });
  var hudRuntimeStatusState = PokerHudRuntimeStatus.createState({ timestamp: contentInitializedAt });
  var interruptedHandRecoveryState = PokerInterruptedHandRecovery.createState(null);
  var ownedHandReloadContinuityState = PokerOwnedHandReloadContinuity.createState(null);
  var rawLifecycleTraceState = PokerNowLifecycleSignal.createTraceState();
  var hostControlTraceState = PokerHostControlTrace.createState(null);
  var pauseStatusTraces = [];
  var pauseLifecycleCaptureEnabled = false;
  var pauseLifecycleCaptureState = PokerPauseLifecycleCapture.createState({
    enabled: false,
    buildId: PNHUD_BUILD_ID,
    contentScriptInstanceId: contentScriptInstanceId,
    runtimeStatusStoreInstanceId: runtimeStatusStoreInstanceId,
    hudRendererInstanceId: hudRendererInstanceId,
    createdAt: contentInitializedAt
  });
  var pauseCaptureFrameRecords = new Map();
  var pauseDiagnosticCaptureState = PokerPauseDiagnosticCapture.createState({
    enabled: false,
    buildId: PNHUD_BUILD_ID,
    extensionVersion: chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : 'unknown-version',
    contentScriptInstanceId: contentScriptInstanceId,
    runtimeStatusStoreInstanceId: runtimeStatusStoreInstanceId,
    hudRendererInstanceId: hudRendererInstanceId,
    createdAt: contentInitializedAt
  });
  var pauseDiagnosticDomObserver = null;
  var pauseDiagnosticSnapshotTimers = [];
  var localUserPlayerId = null;
  var localUserIdentityEvidence = { playerId: null, source: null, automatic: true, verifiedAt: null, eventName: null };
  var tableOwnerPlayerId = null;
  var lastHostControlUiClick = null;
  var settlementOrderingDiagnostics = [];
  var settlementOrderingSequence = 0;
  document.addEventListener('click', handleDiagnosticAndHostControlClick, true);
  document.addEventListener('keydown', capturePauseDiagnosticKeyEvent, true);
  document.addEventListener('keyup', capturePauseDiagnosticKeyEvent, true);
  var pausePersistenceDiagnostics = {
    activeHandPresentAtPause: false,
    handId: null,
    pauseVerifiedAt: null,
    persistenceRequestedAt: null,
    persistenceCompletedAt: null,
    persistenceError: null,
    persistedPausedVerified: false,
    persistedLifecycle: null,
    persistedRevision: 0
  };
  var handLogContainerIds = new WeakMap();
  var handLogNodeIds = new WeakMap();
  var handLogContainerIdSequence = 0;
  var handLogNodeIdSequence = 0;
  var activeHandLogObserverId = null;
  var liveEvents = [];
  var finalizedSessionRevision = 0;
  var sessionStatsCache = PokerSessionStatsCache.create({ maxEntries: 256 });
  var sessionPersistencePlanner = PokerSessionRuntime.createPersistencePlanner({ initialFinalizedRevision: 0, persistedFinalizedRevision: 0 });
  var activeHandState = null;
  // One fresh, fully observed deal may reacquire ownership after a lifecycle
  // interruption. This never owns the partial hand present at reset/reload.
  var lifecycleBoundaryAcquisition = { pending: true, excludedHandId: null };
  var handAccounting = null;
  var semanticLedgerState = PokerSemanticHandLedger.createState({ maxRecords: 50, maxObservationsPerHand: 240, maxAttempts: 100 });
  var preflopOpportunityState = PokerPreflopOpportunityReducer.createState({ maxRecords: 50, maxAttempts: 100, maxPlayers: 200 });
  var flopCBetOpportunityState = PokerFlopCBetOpportunityReducer.createState({ maxRecords: 50, maxAttempts: 100, maxPlayers: 200, maxAttachments: 200 });
  var showdownStatsState = PokerShowdownStatsReducer.createState({ maxRecords: 50, maxAttempts: 100, maxPlayers: 200, maxIdentityAliases: 400, maxAttachments: 200 });
  var careerStoreState = null;
  var careerIndexedService = null;
  var careerIndexedAppendQueue = Promise.resolve();
  var careerRestoreAppendGate = null;
  var careerTrackingReady = false;
  var careerPendingStorageUpdates = {};
  var careerDiagnostics = { accepted: 0, externalAccepted: 0, duplicates: 0, conflicts: 0, rejected: 0, recent: [] };
  var careerDataUiState = { info: null, summaryError: null, loading: false, busy: false, message: '', messageKind: 'none', activeFlow: null, importPreview: null, importCandidate: null, importRequestToken: 0, preview: null, backupCandidate: null, restoreRequestToken: 0, removalPreview: null, removalRequest: null, removalFlowActive: false, removalRequestToken: 0, fetchedAt: 0 };
  var playerNotesState = PokerPlayerNotesStore.normalize(null);
  var playerDashboardState = { open: false, playerId: null, displayName: '', mode: 'session', position: null, overallPosition: null, situation: 'overall', opponentMode: 'overall', selfPlayerId: null, coreStats: null, relationalStats: {}, sessionStats: null, careerStats: null, careerTrackingStartedAt: null, trends: null, trendWindow: null, trendError: null, loading: false, error: null, profile: null, note: '', noteDraft: '', noteStatus: '', requestToken: 0, returnFocus: null };
  var playerDashboardElement = null;
  var playerDashboardGeometry = { geometry: null, positionCustomized: false };
  var playerDashboardGeometryController = null;
  var trackedPlayersState = { open: false, search: '', sort: 'recent', summaries: [], loading: false, error: null, requestToken: 0, backendRequests: 0, renders: 0 };
  var trackedPlayersElement = null;
  var statExplanationState = PokerHandStatExplanation.createState({ maxHands: 30 });
  var handStatInspectorState = PokerHandStatInspector.createState();
  var handStatInspectorScrollState = { history: 0, detail: 0 };
  var playerProfileScoreInspectorState = PokerPlayerProfileScoreInspector.createState();
  var playerProfileScoreInspectorUi = PokerPlayerProfileScoreInspector.createUiController({
    state: playerProfileScoreInspectorState,
    entries: profileScoreInspectorPlayers,
    lookup: function (playerId) { return { record: PokerPlayerProfileShadowStore.get(playerProfileShadowState, playerId), decomposition: PokerPlayerProfileShadowStore.scoreDecomposition(playerProfileShadowState, playerId) }; },
    render: refreshProfileScoreInspectorView,
    defer: function (callback) { setTimeout(callback, 0); }
  });
  var counterRegressionDiagnostics = [];
  var authoritativePersistenceQueue = PokerStats.createSerializedPersistenceQueue(writeAuthoritativeStorageSnapshot, { initialRevision: 0, maxHistory: 50 });
  var sessionResetInProgress = false;
  var playerProfileShadowState = PokerPlayerProfileShadowStore.createState({
    maxPlayers: 200,
    maxHistoryPerPlayer: 10,
    confidenceDelta: 0.05,
    maxValidationTransitions: 100,
    maxValidationSamples: 250,
    sessionKey: gameSessionKey,
    presenter: PokerPlayerProfilePresentation
  });
  profileStartupDiagnostic('PROFILE MODULE LOADED', {
    classifierSchemaVersion: PokerPlayerProfileClassifier.SCHEMA_VERSION || null,
    presentationSchemaVersion: PokerPlayerProfilePresentation.SCHEMA_VERSION || null
  });
  profileStartupDiagnostic('PROFILE STORE CREATED', { maxPlayers: playerProfileShadowState.maxPlayers, maxHistoryPerPlayer: playerProfileShadowState.maxHistoryPerPlayer });
  if (typeof globalThis.__PNHUD_PROFILE_DEBUG__ !== 'boolean') globalThis.__PNHUD_PROFILE_DEBUG__ = false;
  var playerProfileDebugApi = createPlayerProfileDebugApi();
  installPlayerProfileDebugApi(playerProfileDebugApi);
  globalThis.__PNHUD_PROFILE_API_INSTANCE_ID__ = contentScriptInstanceId;
  globalThis.__PNHUD_PROFILE_API_WORLD__ = 'isolated-content-script';
  var careerDebugApi = createCareerDebugApi();
  installCareerDebugApi(careerDebugApi);
  var potOddsDebugApi = createPotOddsDebugApi();
  installPotOddsDebugApi(potOddsDebugApi);
  var boardCompanionDebugApi = createBoardCompanionDebugApi();
  installBoardCompanionDebugApi(boardCompanionDebugApi);
  globalThis.__PNHUD_CAREER_API_INSTANCE_ID__ = contentScriptInstanceId;
  profileStartupDiagnostic('PROFILE API EXPOSED', { world: globalThis.__PNHUD_PROFILE_API_WORLD__, methods: Object.keys(playerProfileDebugApi) });
  var capturedFingerprints = PokerRuntimeBounds.createFifoSet(5000);
  var capturedEventSemantics = new Set();
  var websocketStatsSourceAvailable = false;
  var fullLogDisplaySourceAvailable = false;
  var previousGcSnapshot = null;
  var socketPlayerNames = new Map();
  var socketGameContext = { handId: null, street: null };
  var socketHandSignatures = new Set();
  var restoredEventCount = 0;
  var newlyDecodedEventCount = 0;
  var throttledLogTimes = new Map();
  var LIVE_SCHEMA_VERSION = 4;
  var pipelineHealth = {
    hookInstalled: false,
    framesCaptured: 0,
    framesRelayed: 0,
    packetsDecoded: 0,
    gameStatePatchesMerged: 0,
    socketPlayerIdsDiscovered: 0,
    domSeatsDiscovered: 0,
    confirmedPlayerMappings: 0,
    rejectedMappingCandidates: 0,
    framesReceived: 0,
    incomingFrames: 0,
    gcFramesReceived: 0,
    snapshotsMerged: 0,
    playerMappingsFound: 0,
    handBoundariesDetected: 0,
    pokerEventsEmitted: 0,
    statsEventsStored: 0,
    restoredStatsEvents: 0,
    injectedTestEvents: 0,
    realLiveEvents: 0,
    actionCandidates: 0,
    checksDetected: 0,
    callsDetected: 0,
    betsDetected: 0,
    raisesDetected: 0,
    foldsDetected: 0,
    ambiguousActionsRejected: 0,
    pendingActionCandidates: 0,
    confirmedActionCandidates: 0,
    rejectedActionCandidates: 0,
    expiredActionCandidates: 0,
    rawTbTransitionsSeen: 0,
    normalizedTbTransitionsSeen: 0,
    voluntaryTbTransitionsGated: 0,
    activeStagedEvents: 0,
    finalizedHands: 0,
    finalizedStatsEvents: 0,
    confirmedMappedPlayers: 0,
    eligibleOverlayPlayers: 0,
    overlayElementsCreated: 0,
    overlayElementsAttached: 0,
    overlayElementsVisible: 0,
    overlayPlacementFailures: 0,
    visibleSocketPlayers: 0,
    visibleOccupiedSeats: 0,
    successfulAssignments: 0,
    assignmentsWithheld: 0,
    websocketHookInstallationCount: 0,
    pageBridgeListenerCount: 0,
    domHandLogObserverCount: 0,
    fullLogParserInstallationCount: 0,
    storageRestorationCallbackCount: 0,
    initializationReplayCount: 0,
    queuedFrameCount: 0,
    replayedFrameCount: 0,
    duplicateFrameFingerprintCount: 0,
    bodyMutationObserverCallbacks: 0,
    fullLogDiscoveryCallbacks: 0,
    seatDiscoveryRequests: 0,
    seatDiscoveryExecutions: 0,
    seatResizeObserverCallbacks: 0,
    seatOverlayReconciles: 0,
    hudRefreshRequests: 0,
    leaderboardRenderCount: 0,
    stagedStatRenderSkips: 0,
    topMappingRejectionReason: 'none',
    lastFailureReason: 'none yet'
  };
  var identityDiagnostics = {
    decodedEventNames: [],
    socketPlayers: new Map(),
    domSeats: [],
    mappingCandidates: [],
    lastChangedPaths: [],
    socketStackTransitions: [],
    domStackTransitions: []
  };
  var domSeatElementIds = new WeakMap();
  var domSeatElements = new Map();
  var domSeatAnchorElements = new Map();
  var confirmedSeatMappings = new Map();
  var overlayPlacementFailureKeys = PokerRuntimeBounds.createFifoSet(200);
  var nextDomSeatElementId = 1;
  var seenDomSeatElementIds = new Set();
  var previousDomSeats = new Map();
  var seenMappingCandidateKeys = PokerRuntimeBounds.createFifoSet(100);
  var seatInspectionTimers = [];
  var seatOverlayLayer = null;
  var potOddsLayer = null;
  var heroPotOddsElement = null;
  var activePotOddsDrag = null;
  var potOddsDragBehavior = null;
  var heroPotOddsRetryCount = 0;
  var heroPotOddsVisibilityFrame = null;
  var heroPotOddsVisibilityGeneration = 0;
  var heroPotOddsAnchorMutationObserver = null;
  var heroPotOddsAnchorResizeObserver = null;
  var heroPotOddsAnchorSignalFrame = null;
  var heroPotOddsAnchorPendingReason = null;
  var heroPotOddsObservedSeat = null;
  var heroPotOddsObservedCard = null;
  var heroPotOddsObservedAnchorType = null;
  var heroPotOddsObservedResizeTargets = [];
  var heroPotOddsDiscardedReferenceElements = new WeakSet();
  var heroPotOddsDiscardedReferenceCount = 0;
  var heroPotOddsAnchorDiagnostic = { chosenAnchorType: null, boardRect: null, boardCandidateCount: 0, selectedBoardCards: [], boardAcquisitionStrategy: 'fresh visible community-board query', fallbackUsed: false, heroSeatFound: false, heroSeatSelectorSource: null, heroSeatConnected: false, currentCardCandidateCount: 0, chosenCards: [], combinedHeroCardRect: null, cachedReferencesDiscarded: false, cachedReferenceDiscardCount: 0, acquisitionStrategy: 'live query from connected hero seat' };
  var potOddsForensicSequence = 0;
  var potOddsForensicTimeline = [];
  var potOddsLastViewport = { width: window.innerWidth, height: window.innerHeight, timestamp: Date.now() };
  var heroPotOddsVisibilityStats = {
    active: false, currentlyVisible: false, placementAttempts: 0, domWrites: 0, idleRetries: 0,
    animationFrameRetries: 0, timerRetries: 0, firstAttemptTimestamp: null, lastAttemptTimestamp: null,
    minimumAttemptIntervalMs: null, maximumAttemptIntervalMs: null, lastRetryDelayMs: null,
    maximumRetryDelayMs: 0, visibilityEstablishedTimestamp: null, remountCount: 0
  };
  var heroPotOddsRenderReason = null;
  var heroPotOddsPlacementDiagnostic = { renderRequested: false, supportedDecision: false, visible: false, suppressionReason: 'not rendered yet', retryCount: 0, retryState: 'idle' };
  var heroPotOddsRenderFrame = null;
  var heroPotOddsPendingRenderReason = null;
  var heroPotOddsDecisionRevision = 0;
  var heroPotOddsDecisionFingerprint = null;
  var potOddsPresentation = null;
  var heroPotOddsResetPending = false;
  var potOddsBoardResetState = PokerPotOddsPosition.createBoardResetState();
  var heroPotOddsLastVisibleRect = null;
  var boardCompanionEventSequence = 0;
  var boardCompanionEventHistory = [];
  var boardCompanionLastEventEssentials = null;
  var boardCompanionLastIllegalChangeSequence = 0;
  var lastPotOddsOffsetMutation = { reasonCode: 'PREFERENCE_MIGRATION', source: 'initial defaults', timestamp: Date.now(), before: null, after: { x: 0, y: 0 } };
  var boardCompanionLayoutState = PokerBoardCompanionLayout.createState({ tableId: pokerNowGameId, maxHistory: 48 });
  var boardCompanionLayoutUnsubscribe = PokerBoardCompanionLayout.subscribe(boardCompanionLayoutState, function (change) {
    recordBoardCompanionEvent('canonical-revision', change && change.reason || 'BoardCompanion revision changed', change && change.before || null, change && change.after || null);
    if (currentPotOddsPresentationDecision()) scheduleHeroPotOddsRender('BoardCompanion revision ' + String(change && change.revision || boardCompanionLayoutState.revision));
  });
  var potOddsTableUiState = {
    tableId: pokerNowGameId, localPlayerId: null, heroSeated: false, heroSeatedKnown: false,
    seatEvidenceSource: null, lifecycleState: 'initializing', definiteZero: false,
    lastVerifiedAt: null, lastUpdatedAt: null, failClosed: false
  };
  var heroPotOddsLastMountedFingerprint = null;
  var heroPotOddsRenderDiagnostic = {
    currentDecisionRevision: 0, currentRenderFingerprint: null, lastDecisionChangeTimestamp: null,
    lastRenderScheduledTimestamp: null, lastRenderExecutedTimestamp: null, renderTrigger: null,
    renderPending: false, lastRequestCoalesced: false, coalescedRequestCount: 0, lastMountedDecisionFingerprint: null
  };
  var seatOverlayController = null;
  var seatOverlayRendererSuperseded = false;
  var seatLayoutObserver = null;
  var seatResizeObserver = null;
  var observedSeatElements = new Set();
  var seatReconcileTimer = null;
  var seatDiscoveryTimer = null;
  var seatDiscoveryPendingSince = null;
  var nativePanelOcclusionFrame = null;
  var nativePanelClipSvg = null;
  var nativePanelLayeringDiagnostics = [];
  var lastNativePanelLayeringSignature = '';
  var expandedPokerNowPanelLayerElements = new Map();
  var seatReconcileLastAt = 0;
  var seatDiscoveryLastAt = 0;
  var windowLayoutListener = null;
  var windowLayoutFrame = null;
  var windowLayoutPriorViewport = null;
  var displayMode = 'seat-overlays-only';
  var showOverlayBoxes = false;
  var debugSeatIdentity = false;
  var showWithheldPlaceholders = false;
  var overlayDraggingUnlocked = false;
  var manualOverlayPositions = {};
  var seatHudCareerStatsByPlayer = new Map();
  // Presentation aggregates only; Career persistence, revisions and resolution remain backend-owned.
  var leaderboardCareerStatsByPlayer = new Map();
  var leaderboardCareerSignature = '';
  var leaderboardCareerSnapshotSignature = '';
  var leaderboardCareerFailedSignature = '';
  var leaderboardCareerRequestToken = 0;
  var seatHudCareerLoadedSignature = '';
  var seatHudCareerPendingSignature = '';
  var seatHudCareerRequestToken = 0;
  var seatHudCareerQueryDiagnostics = { batchRequests: 0, lastRequestedPlayerIds: [], lastResultPlayerCount: 0, lastQuery: null, lastError: null, loading: false };
  var seatHudPositionDiagnostics = new Map();
  var seatHudPositionHistory = [];
  var seatHudBlockingPanelState = { blocked: false, reasons: [], chatVisible: false, extensionSettingsOpen: false, extensionLogOpen: false, pokerNowGameSettingsOpen: false, expandedPokerNowPanelDetected: false, expandedPanelType: null, expandedPanelRect: null, expandedPanelAboveSeatHud: false };
  var seatHudLogPanelState = { open: false, panel: null, control: null, mode: null, panelType: null, revision: 0, lastReason: null };

  function seatOverlaysVisible() {
    return Boolean(hudUiPreferences && hudUiPreferences.seatOverlaysEnabled);
  }

  function leaderboardVisible() {
    return Boolean(hudUiPreferences && hudUiPreferences.leaderboardEnabled);
  }

  function synchronizeDerivedDisplayMode() {
    displayMode = PokerHudSettings.modeForVisibility(seatOverlaysVisible(), leaderboardVisible());
    return displayMode;
  }
  var displayedStatIds = PokerOverlayStats.DEFAULT_DISPLAYED_STAT_IDS.slice();
  var overlayStatPreferenceDiagnostics = {
    storedDisplayedStatIds: null,
    normalizedDisplayedStatIds: displayedStatIds.slice(),
    defaultUsed: true,
    invalidIdsRemoved: [],
    duplicateIdsRemoved: [],
    lastPreferenceChangeSource: 'startup-default',
    visibleRegisteredStats: displayedStatIds.slice(),
    availableRegisteredStats: []
  };
  var overlayCustomizerOpen = false;
  var leaderboardCustomizerOpen = false;
  var leaderboardStatPreferences = Object.assign({}, PokerLeaderboardStats.DEFAULTS, { displayedStatIds: PokerLeaderboardStats.DEFAULTS.displayedStatIds.slice() });
  var leaderboardStatPreferenceDiagnostics = {
    storedSyncWithOverlay: null,
    effectiveSyncWithOverlay: true,
    storedDisplayedStatIds: null,
    normalizedDisplayedStatIds: PokerLeaderboardStats.DEFAULTS.displayedStatIds.slice(),
    effectiveDisplayedStatIds: displayedStatIds.slice(),
    defaultUsed: true,
    invalidIdsRemoved: [],
    duplicateIdsRemoved: [],
    lastPreferenceChangeSource: 'startup-default'
  };
  var hudUiPreferences = Object.assign({}, PokerHudSettings.DEFAULTS);
  var potOddsDecision = PokerPotOdds.resolve({ enabled: true, localPlayerId: null });
  potOddsPresentation = derivePotOddsPresentation(potOddsDecision, null, { enabled: hudUiPreferences.showPotOdds, transitioning: false });
  heroPotOddsDecisionFingerprint = potOddsPresentationFingerprint(potOddsPresentation);
  heroPotOddsRenderDiagnostic.currentRenderFingerprint = heroPotOddsDecisionFingerprint;
  var potOddsLiveState = PokerPotOdds.createLiveStateContinuity({ maxObservationsPerHand: 240 });
  var settingsLauncher = null;
  var settingsPanel = null;
  var settingsKeydownListener = null;
  var settingsUiDiagnostics = {
    launcherCreated: false,
    settingsPanelCreated: false,
    settingsPanelOpen: false,
    selectedSection: 'general',
    settingsOpenCount: 0,
    settingsCloseCount: 0,
    activeAccentTheme: 'teal',
    hudOpacity: 0.96,
    settingsBackgroundOpacity: 0.96,
    hudSize: 'default',
    developerToolsVisible: false,
    preferenceRestoreUsedDefaults: true,
    duplicateListenerPreventions: 0,
    launcherDefaultOffset: { top: 12, left: 4 },
    launcherLogoOverlapDetected: false,
    contentPaneOverflowY: 'visible',
    contentPaneScrollHeight: 0,
    contentPaneClientHeight: 0,
    contentPaneCanScroll: false,
    activeSection: 'general'
  };
  var leaderboardHudPosition = Object.assign({}, PokerLeaderboardHudPosition.DEFAULTS);
  var leaderboardHudPositionDiagnostics = {
    storedPosition: null,
    effectivePosition: null,
    locked: true,
    viewportClamped: false,
    lastPositionChangeSource: 'startup-default',
    dragListenerInstalled: false,
    activeDrag: false
  };
  var activeLeaderboardHudDrag = null;
  var leaderboardHudDragBehavior = null;
  var currentStatsScope = 'session';
  var tooltipStatsByPlayerKey = new Map();
  var statTooltipElement = null;
  var statTooltipCloseTimer = null;
  var statTooltipListenersInstalled = false;
  var activeStatTooltipTarget = null;
  var statTooltipUiDiagnostics = {
    tooltipElementCreated: false,
    tooltipVisible: false,
    activeStatId: null,
    activePlayerId: null,
    activeScope: null,
    openCount: 0,
    closeCount: 0,
    duplicateListenerPreventions: 0,
    registryStatsWithExplanations: [],
    registryStatsMissingExplanations: []
  };
  var activeOverlayDrag = null;
  var overlayDragBehaviors = new WeakMap();
  var overlayDragTraceSequence = 0;
  var overlayDragTimeline = [];
  var deferredSeatDiscoveryDuringOverlayDrag = null;
  var deferredSeatReconcileDuringOverlayDrag = null;
  var withheldOverlayDiagnostics = [];
  var extensionCleanedUp = false;
  var uiRootObserver = null;
  var uiObserversInstalledLogged = false;
  var uiDisplayModeBootLogged = false;
  var uiDetailsBootLogged = false;
  var uiOverlayBootLogged = false;
  var firstRenderCompleted = false;
  var uiRootRecoveryTimer = null;
  var pendingBinaryQueue = PokerRuntimeBounds.createPendingBinaryQueue({ maxPackets: 16, maxBytes: 8 * 1024 * 1024, ttlMs: 15000, maxAttachments: 16, maxQuarantines: 32 });
  var handTransitionDiagnostics = {
    records: [],
    evaluations: [],
    labels: [],
    recentBlindDeductions: [],
    nextRecordId: 1,
    lastAcceptedBoundaryAt: 0,
    lastSettlementAt: 0
  };
  var liveWalkTraceByHand = new Map();
  var completedWalkTraces = [];
  var handCommitTraces = [];
  var handSourceTraces = [];
  var handCommitTraceSequence = 0;
  var processedFrameFingerprints = PokerRuntimeBounds.createFifoSet(1000);
  var initializationReplayActive = false;
  var currentSocketFrameContext = null;
  var firstIncomingRegisteredSeen = false;
  var recentWalkBlindSamples = [];
  var recentWalkDiagnosticTransportPackets = [];
  var walkTraceEmittedHandIds = PokerRuntimeBounds.createFifoSet(100);
  var liveActionTracker = {
    handId: null,
    street: null,
    actorId: null,
    highestStreetBet: 0,
    players: new Map(),
    commitmentFieldProfiles: new Map(),
    actorFieldProfiles: new Map(),
    numericFieldProfiles: new Map(),
    fieldDiagnostics: [],
    tbTracker: null,
    livePipelineState: null,
    currentHandSequence: null,
    completedHands: []
  };
  var tbTraceState = null;

  globalThis.__PNHUD_PAGE_BRIDGE_LISTENER_COUNT__ = Number(globalThis.__PNHUD_PAGE_BRIDGE_LISTENER_COUNT__ || 0) + 1;
  pipelineHealth.pageBridgeListenerCount = globalThis.__PNHUD_PAGE_BRIDGE_LISTENER_COUNT__;
  window.addEventListener('message', handlePageBridgeMessage);
  profileStartupDiagnostic('CONTENT INTEGRATION READY', { contentScriptInstanceId: contentScriptInstanceId, bridgeListenerInstalled: true });
  traceHandSource('page-bridge-listener-installed', { listenerCount: pipelineHealth.pageBridgeListenerCount, productionPath: 'content.js window.addEventListener(message, handlePageBridgeMessage)' });
  window.addEventListener('popstate', handleRuntimeLocationChange);
  window.addEventListener('hashchange', handleRuntimeLocationChange);
  window.addEventListener('pagehide', handlePageHide, { once: true });
  document.addEventListener('pokernow-hud-location-change', handleRuntimeLocationChange);
  installBootstrapBadge();
  console.log('[HUD UI BOOT 3] UI initialization started', {
    locationHref: location.href,
    hostname: location.hostname,
    pathname: location.pathname,
    detailsRootPresent: Boolean(document.getElementById(detailsRootId)),
    overlayRootPresent: Boolean(document.getElementById(overlayRootId)),
    toggleRootPresent: Boolean(document.getElementById(toggleRootId))
  });
  tbTraceState = PokerTbTrace.createState();
  window.postMessage({ source: 'pokernow-stats-hud-content', type: 'websocket-hook-probe' }, location.origin);

  function localFallbackGameGuard(locationLike) {
    try {
      var protocol = String(locationLike && locationLike.protocol || '').toLowerCase();
      var host = String(locationLike && locationLike.hostname || '').toLowerCase();
      var path = String(locationLike && locationLike.pathname || '').split(/[?#]/)[0];
      return protocol === 'https:' &&
        (host === 'pokernow.com' || host === 'www.pokernow.com') &&
        /^\/games\/[^/]+\/?$/.test(path);
    } catch (error) {
      return false;
    }
  }

  function showEarlyBootBadge(text, failure) {
    if (failure && runtimeScopeFallbackActive && /packaging warning/i.test(String(text || ''))) return;
    if (failure || !earlyBootBadgeState.failure) earlyBootBadgeState = { text: String(text || ''), failure: Boolean(failure) };
    function mountOrUpdate() {
      if (typeof document === 'undefined') return;
      if (!document.body) {
        setTimeout(mountOrUpdate, 25);
        return;
      }
      var badge = document.getElementById(EARLY_BOOTSTRAP_BADGE_ID);
      if (!badge) {
        badge = document.createElement('div');
        badge.id = EARLY_BOOTSTRAP_BADGE_ID;
        document.body.appendChild(badge);
      }
      badge.textContent = earlyBootBadgeState.text;
      badge.dataset.pnhudBootFailure = earlyBootBadgeState.failure ? 'true' : 'false';
      badge.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;max-width:min(620px,calc(100vw - 16px));padding:7px 10px;border:1px solid ' + (earlyBootBadgeState.failure ? '#f87171' : '#5eead4') + ';border-radius:5px;color:#fff;background:' + (earlyBootBadgeState.failure ? '#7f1d1d' : '#052e2b') + ';font:700 11px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:normal;overflow-wrap:anywhere;pointer-events:none';
    }
    mountOrUpdate();
  }

  function abortUiBoot(stage, reason, error, details) {
    details = details || {};
    var payload = {
      stage: String(stage || 'unknown'),
      reason: String(reason || 'unknown UI bootstrap failure'),
      message: String(error && error.message || reason || 'unknown UI bootstrap failure'),
      name: String(error && error.name || 'PokerNowHudUiBootAbort'),
      stack: String(error && error.stack || ''),
      href: String(locationSnapshot && locationSnapshot.href || location.href || ''),
      protocol: String(locationSnapshot && locationSnapshot.protocol || location.protocol || ''),
      hostname: String(locationSnapshot && locationSnapshot.hostname || location.hostname || ''),
      pathname: String(locationSnapshot && locationSnapshot.pathname || location.pathname || ''),
      guardResult: Object.prototype.hasOwnProperty.call(details, 'guardResult') ? details.guardResult : null,
      missingSymbol: String(details.missingSymbol || ''),
      missingModule: String(details.missingModule || '')
    };
    console.error('[HUD UI BOOT ABORT]', payload);
    console.error('[HUD UI BOOT ABORT STRING] ' + payload.reason);
    showEarlyBootBadge('PokerNow HUD failed at stage ' + payload.stage + ': ' + payload.reason, true);
    return payload;
  }

  function installBootstrapBadge() {
    function mount() {
      if (extensionCleanedUp || document.getElementById(bootstrapBadgeId)) return;
      if (!document.body) {
        setTimeout(mount, 25);
        return;
      }
      var badge = document.createElement('div');
      badge.id = bootstrapBadgeId;
      badge.textContent = 'PokerNow HUD UI bootstrap reached';
      badge.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;padding:7px 10px;border:1px solid #5eead4;border-radius:5px;color:#ecfdf5;background:#052e2b;font:700 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none';
      document.body.appendChild(badge);
      console.log('[HUD UI ROOT] created', { rootId: bootstrapBadgeId, parent: 'BODY', locationHref: location.href });
      if (firstRenderCompleted) removeBootstrapBadgeAfterMount();
    }
    mount();
  }

  function removeBootstrapBadgeAfterMount() {
    var badge = document.getElementById(bootstrapBadgeId);
    var detailsRoot = document.getElementById(detailsRootId);
    var overlayRoot = document.getElementById(overlayRootId);
    var toggleRoot = document.getElementById(toggleRootId);
    if (!badge || !detailsRoot || !detailsRoot.isConnected || !overlayRoot || !overlayRoot.isConnected || !toggleRoot || !toggleRoot.isConnected) return;
    setTimeout(function () {
      if (!firstRenderCompleted || !badge.isConnected) return;
      badge.remove();
      console.log('[HUD UI ROOT] removed', { rootId: bootstrapBadgeId, reason: 'full HUD roots mounted successfully' });
    }, 600);
  }

  function verifyUiModules() {
    var detailsAvailable = typeof render === 'function';
    var overlayAvailable = Boolean(globalThis.PokerSeatOverlay && typeof globalThis.PokerSeatOverlay.createController === 'function');
    var displayModeAvailable = Boolean(globalThis.PokerSeatOverlay && typeof globalThis.PokerSeatOverlay.visibilityForMode === 'function');
    var rootBootstrapAvailable = Boolean(globalThis.PokerHudUiBootstrap && typeof globalThis.PokerHudUiBootstrap.ensureRoots === 'function');
    console.log('[HUD UI MODULE] details renderer available: ' + (detailsAvailable ? 'yes' : 'no'), { symbol: 'render', type: typeof render });
    console.log('[HUD UI MODULE] overlay renderer available: ' + (overlayAvailable ? 'yes' : 'no'), { symbol: 'PokerSeatOverlay.createController', modulePresent: Boolean(globalThis.PokerSeatOverlay) });
    console.log('[HUD UI MODULE] display mode module available: ' + (displayModeAvailable ? 'yes' : 'no'), { symbol: 'PokerSeatOverlay.visibilityForMode', modulePresent: Boolean(globalThis.PokerSeatOverlay) });
    console.log('[HUD UI MODULE] root bootstrap available: ' + (rootBootstrapAvailable ? 'yes' : 'no'), { symbol: 'PokerHudUiBootstrap.ensureRoots', modulePresent: Boolean(globalThis.PokerHudUiBootstrap) });
    var required = [
      ['PokerStats', globalThis.PokerStats, 'stats.js'],
      ['PokerHudDiagnostics', globalThis.PokerHudDiagnostics, 'hudDiagnostics.js'],
      ['PokerHudHealth', globalThis.PokerHudHealth, 'hudHealth.js'],
      ['PokerFirstHandLifecycle', globalThis.PokerFirstHandLifecycle, 'firstHandLifecycle.js'],
      ['PokerGameBreakLifecycle', globalThis.PokerGameBreakLifecycle, 'gameBreakLifecycle.js'],
      ['PokerHudRuntimeStatus', globalThis.PokerHudRuntimeStatus, 'hudRuntimeStatus.js'],
      ['PokerNowLifecycleSignal', globalThis.PokerNowLifecycleSignal, 'pokerNowLifecycleSignal.js'],
      ['PokerPauseLifecycleCapture', globalThis.PokerPauseLifecycleCapture, 'pauseLifecycleCapture.js'],
      ['PokerPauseDiagnosticCapture', globalThis.PokerPauseDiagnosticCapture, 'pauseDiagnosticCapture.js'],
      ['PokerHostControlTrace', globalThis.PokerHostControlTrace, 'hostControlTrace.js'],
      ['PokerInterruptedHandRecovery', globalThis.PokerInterruptedHandRecovery, 'interruptedHandRecovery.js'],
      ['PokerOwnedHandReloadContinuity', globalThis.PokerOwnedHandReloadContinuity, 'ownedHandReloadContinuity.js'],
      ['PokerHandLogDom', globalThis.PokerHandLogDom, 'handLogDom.js'],
      ['PokerWalkDetection', globalThis.PokerWalkDetection, 'walkDetection.js'],
      ['PokerMockData', globalThis.PokerMockData, 'mockData.js'],
      ['PokerNowParser', globalThis.PokerNowParser, 'parser.js'],
      ['PokerActionInference', globalThis.PokerActionInference, 'actionInference.js'],
      ['PokerTbTrace', globalThis.PokerTbTrace, 'tbTrace.js'],
      ['PokerLiveActionPipeline', globalThis.PokerLiveActionPipeline, 'liveActionPipeline.js'],
      ['PokerHandFinalization', globalThis.PokerHandFinalization, 'handFinalization.js'],
      ['PokerPositionResolver', globalThis.PokerPositionResolver, 'positionResolver.js'],
      ['PokerSemanticHandLedger', globalThis.PokerSemanticHandLedger, 'semanticHandLedger.js'],
      ['PokerBoardCompanionLayout', globalThis.PokerBoardCompanionLayout, 'boardCompanionLayout.js'],
      ['PokerPotOddsPosition', globalThis.PokerPotOddsPosition, 'potOddsPosition.js'],
      ['PokerPotOdds', globalThis.PokerPotOdds, 'potOdds.js'],
      ['PokerPreflopOpportunityReducer', globalThis.PokerPreflopOpportunityReducer, 'preflopOpportunityReducer.js'],
      ['PokerFlopCBetOpportunityReducer', globalThis.PokerFlopCBetOpportunityReducer, 'flopCBetOpportunityReducer.js'],
      ['PokerShowdownStatsReducer', globalThis.PokerShowdownStatsReducer, 'showdownStatsReducer.js'],
      ['PokerCareerStatsAggregator', globalThis.PokerCareerStatsAggregator, 'careerStatsAggregator.js'],
      ['PokerFilteredStats', globalThis.PokerFilteredStats, 'filteredStats.js'],
      ['PokerSessionStatsCache', globalThis.PokerSessionStatsCache, 'sessionStatsCache.js'],
      ['PokerSessionRuntime', globalThis.PokerSessionRuntime, 'sessionRuntime.js'],
      ['PokerRuntimeBounds', globalThis.PokerRuntimeBounds, 'runtimeBounds.js'],
      ['PokerCareerContributionStore', globalThis.PokerCareerContributionStore, 'careerContributionStore.js'],
      ['PokerCareerIndexedStore', globalThis.PokerCareerIndexedStore, 'careerIndexedStore.js'],
      ['PokerCareerBackupPolicy', globalThis.PokerCareerBackupPolicy, 'careerBackupPolicy.js'],
      ['PokerCareerPortableFile', globalThis.PokerCareerPortableFile, 'careerPortableFile.js'],
      ['PokerCareerDataSettings', globalThis.PokerCareerDataSettings, 'careerDataSettings.js'],
      ['PokerPlayerNotesStore', globalThis.PokerPlayerNotesStore, 'playerNotesStore.js'],
      ['PokerStatEvidence', globalThis.PokerStatEvidence, 'statEvidence.js'],
      ['PokerPlayerDashboard', globalThis.PokerPlayerDashboard, 'playerDashboard.js'],
      ['PokerTrackedPlayers', globalThis.PokerTrackedPlayers, 'trackedPlayers.js'],
      ['PokerHandStatExplanation', globalThis.PokerHandStatExplanation, 'statExplanation.js'],
      ['PokerHandStatInspector', globalThis.PokerHandStatInspector, 'handStatInspector.js'],
      ['PokerPlayerProfileScoreInspector', globalThis.PokerPlayerProfileScoreInspector, 'playerProfileScoreInspector.js'],
      ['PokerPlayerProfileClassifier', globalThis.PokerPlayerProfileClassifier, 'playerProfileClassifier.js'],
      ['PokerPlayerProfilePresentation', globalThis.PokerPlayerProfilePresentation, 'playerProfilePresentation.js'],
      ['PokerPlayerProfileExplanation', globalThis.PokerPlayerProfileExplanation, 'playerProfileExplanation.js'],
      ['PokerPlayerProfileShadowStore', globalThis.PokerPlayerProfileShadowStore, 'playerProfileShadowStore.js'],
      ['PokerPlayerProfileCalibration', globalThis.PokerPlayerProfileCalibration, 'playerProfileCalibration.js'],
      ['PokerOverlayStats', globalThis.PokerOverlayStats, 'overlayStats.js'],
      ['PokerLeaderboardStats', globalThis.PokerLeaderboardStats, 'leaderboardStats.js'],
      ['PokerLeaderboardHudPosition', globalThis.PokerLeaderboardHudPosition, 'leaderboardHudPosition.js'],
      ['PokerStatTooltip', globalThis.PokerStatTooltip, 'statTooltip.js'],
      ['PokerHudSettings', globalThis.PokerHudSettings, 'settingsUi.js']
    ];
    var missingEntries = required.filter(function (entry) { return !entry[1]; });
    var missing = missingEntries.map(function (entry) { return entry[0]; });
    var missingModules = missingEntries.map(function (entry) { return entry[2]; });
    var missingSymbols = missing.concat(detailsAvailable ? [] : ['render']).concat(overlayAvailable ? [] : ['PokerSeatOverlay.createController']).concat(displayModeAvailable ? [] : ['PokerSeatOverlay.visibilityForMode']).concat(rootBootstrapAvailable ? [] : ['PokerHudUiBootstrap.ensureRoots']);
    console.log('[HUD UI BOOT 1.4] required modules checked', {
      available: missingSymbols.length === 0,
      missingSymbols: missingSymbols.slice(),
      runtimeScopeHelper: Boolean(globalThis.PokerNowRuntimeScope),
      displayModeHelper: displayModeAvailable,
      overlayRenderer: overlayAvailable,
      detailsRenderer: detailsAvailable,
      liveActionPipeline: Boolean(globalThis.PokerLiveActionPipeline)
    });
    if (!detailsAvailable || !overlayAvailable || !displayModeAvailable || !rootBootstrapAvailable || missing.length) {
      abortUiBoot('1.4', 'required UI/runtime module is missing: ' + missingSymbols.join(', '), null, {
        guardResult: true,
        missingSymbol: missingSymbols.join(', '),
        missingModule: missingModules.concat(overlayAvailable && displayModeAvailable ? [] : ['seatOverlay.js']).concat(rootBootstrapAvailable ? [] : ['uiBootstrap.js']).join(', ')
      });
      return false;
    }
    return true;
  }

  function extractPokerNowGameId() {
    var match = location.pathname.match(/\/games\/([^/?#]+)/i);
    if (match) return decodeURIComponent(match[1]);
    var queryGame = new URLSearchParams(location.search).get('game') || new URLSearchParams(location.search).get('gameId');
    return queryGame || ('unknown-' + stableHash(location.pathname || '/'));
  }

  function sameStringArray(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every(function (value, index) { return value === right[index]; });
  }

  function applyOverlayStatPreference(stored, source) {
    var normalized = PokerOverlayStats.normalizePreference(stored);
    displayedStatIds = normalized.normalizedDisplayedStatIds.slice();
    var available = PokerOverlayStats.availableDefinitions(displayedStatIds).map(function (definition) { return definition.id; });
    overlayStatPreferenceDiagnostics = {
      storedDisplayedStatIds: normalized.storedDisplayedStatIds,
      normalizedDisplayedStatIds: displayedStatIds.slice(),
      defaultUsed: normalized.defaultUsed,
      invalidIdsRemoved: normalized.invalidIdsRemoved.slice(),
      duplicateIdsRemoved: normalized.duplicateIdsRemoved.slice(),
      lastPreferenceChangeSource: source || 'unknown',
      visibleRegisteredStats: displayedStatIds.slice(),
      availableRegisteredStats: available
    };
    if (leaderboardStatPreferences) refreshLeaderboardPreferenceDiagnostics(source === 'storage-restore' ? 'storage-restore' : 'overlay-preference-propagation');
    return normalized;
  }

  function effectiveLeaderboardStatIds() {
    return PokerLeaderboardStats.effectiveDisplayedStatIds(leaderboardStatPreferences, displayedStatIds);
  }

  function refreshLeaderboardPreferenceDiagnostics(source) {
    var effective = effectiveLeaderboardStatIds();
    leaderboardStatPreferenceDiagnostics.effectiveSyncWithOverlay = Boolean(leaderboardStatPreferences.syncWithOverlay);
    leaderboardStatPreferenceDiagnostics.effectiveDisplayedStatIds = effective.slice();
    if (source) leaderboardStatPreferenceDiagnostics.lastPreferenceChangeSource = source;
    return effective;
  }

  function applyLeaderboardStatPreference(stored, source) {
    var normalized = PokerLeaderboardStats.normalize(stored);
    leaderboardStatPreferences = {
      version: normalized.preference.version,
      syncWithOverlay: normalized.preference.syncWithOverlay,
      displayedStatIds: normalized.preference.displayedStatIds.slice()
    };
    leaderboardStatPreferenceDiagnostics = {
      storedSyncWithOverlay: normalized.storedSyncWithOverlay,
      effectiveSyncWithOverlay: leaderboardStatPreferences.syncWithOverlay,
      storedDisplayedStatIds: normalized.storedDisplayedStatIds,
      normalizedDisplayedStatIds: leaderboardStatPreferences.displayedStatIds.slice(),
      effectiveDisplayedStatIds: effectiveLeaderboardStatIds(),
      defaultUsed: normalized.defaultUsed,
      invalidIdsRemoved: normalized.invalidIdsRemoved.slice(),
      duplicateIdsRemoved: normalized.duplicateIdsRemoved.slice(),
      lastPreferenceChangeSource: source || 'unknown'
    };
    return normalized;
  }

  function sameLeaderboardPreference(left, right) {
    return Boolean(left && right && left.version === right.version && left.syncWithOverlay === right.syncWithOverlay && sameStringArray(left.displayedStatIds, right.displayedStatIds));
  }

  function persistLeaderboardStatPreference(source) {
    leaderboardStatPreferenceDiagnostics.lastPreferenceChangeSource = source || 'unknown';
    var update = {};
    update[STORAGE_KEYS.leaderboardStatPreferences] = {
      version: PokerLeaderboardStats.VERSION,
      syncWithOverlay: leaderboardStatPreferences.syncWithOverlay,
      displayedStatIds: leaderboardStatPreferences.displayedStatIds.slice()
    };
    chrome.storage.local.set(update, function () {
      refreshHud();
      renderSettingsPanel();
    });
  }

  function updateLeaderboardStatIds(nextIds, source) {
    var normalized = PokerOverlayStats.normalizePreference({
      version: PokerOverlayStats.PREFERENCE_VERSION,
      displayedStatIds: Array.isArray(nextIds) ? nextIds.slice() : nextIds
    });
    if (sameStringArray(leaderboardStatPreferences.displayedStatIds, normalized.normalizedDisplayedStatIds)) return false;
    leaderboardStatPreferences.displayedStatIds = normalized.normalizedDisplayedStatIds.slice();
    leaderboardStatPreferenceDiagnostics.storedDisplayedStatIds = Array.isArray(nextIds) ? nextIds.slice() : nextIds;
    leaderboardStatPreferenceDiagnostics.normalizedDisplayedStatIds = leaderboardStatPreferences.displayedStatIds.slice();
    leaderboardStatPreferenceDiagnostics.invalidIdsRemoved = normalized.invalidIdsRemoved.slice();
    leaderboardStatPreferenceDiagnostics.duplicateIdsRemoved = normalized.duplicateIdsRemoved.slice();
    refreshLeaderboardPreferenceDiagnostics(source);
    persistLeaderboardStatPreference(source);
    return true;
  }

  function updateLeaderboardSync(syncWithOverlay, source) {
    syncWithOverlay = Boolean(syncWithOverlay);
    if (leaderboardStatPreferences.syncWithOverlay === syncWithOverlay) return false;
    leaderboardStatPreferences.syncWithOverlay = syncWithOverlay;
    refreshLeaderboardPreferenceDiagnostics(source || (syncWithOverlay ? 'sync-enabled' : 'sync-disabled'));
    persistLeaderboardStatPreference(source || (syncWithOverlay ? 'sync-enabled' : 'sync-disabled'));
    return true;
  }

  function updateDisplayedStatIds(nextIds, source) {
    var requested = {
      version: PokerOverlayStats.PREFERENCE_VERSION,
      displayedStatIds: Array.isArray(nextIds) ? nextIds.slice() : nextIds
    };
    var normalized = PokerOverlayStats.normalizePreference(requested);
    if (sameStringArray(displayedStatIds, normalized.normalizedDisplayedStatIds)) return false;
    applyOverlayStatPreference(requested, source);
    var update = {};
    update[STORAGE_KEYS.overlayStatPreferences] = normalized.preference;
    chrome.storage.local.set(update, function () {
      refreshHud();
      renderSettingsPanel();
    });
    return true;
  }

  function applyHudUiAppearance() {
    var theme = PokerHudSettings.ACCENT_THEMES[hudUiPreferences.accentTheme] || PokerHudSettings.ACCENT_THEMES.teal;
    [document.documentElement, document.getElementById(detailsRootId), document.getElementById(settingsPanelId), document.getElementById(trackedPlayersPanelId), document.getElementById(playerDashboardId), document.getElementById(overlayRootId), document.getElementById(potOddsRootId), document.getElementById(toggleRootId), document.getElementById(settingsLauncherId)].filter(Boolean).forEach(function (element) {
      element.style.setProperty('--pnhud-accent', theme.color);
    });
    var detailsRoot = document.getElementById(detailsRootId);
    if (detailsRoot) {
      var preset = PokerHudSettings.SIZE_PRESETS[hudUiPreferences.hudSize] || PokerHudSettings.SIZE_PRESETS.default;
      var columnCount = effectiveLeaderboardStatIds().length;
      var preferredWidth = Math.max(preset.minWidth, Math.min(preset.maxWidth, preset.baseWidth + preset.perStatWidth * columnCount));
      detailsRoot.style.setProperty('--pnhud-hud-opacity', String(hudUiPreferences.hudOpacity));
      detailsRoot.style.setProperty('--pnhud-surface-opacity', String(Math.max(0.04, Math.min(0.18, hudUiPreferences.hudOpacity * 0.16))));
      detailsRoot.style.setProperty('--pnhud-hud-width', preferredWidth + 'px');
      detailsRoot.dataset.pnhudLeaderboardStatCount = String(columnCount);
      detailsRoot.classList.remove('pnhud-size-small', 'pnhud-size-default', 'pnhud-size-large');
      detailsRoot.classList.add('pnhud-size-' + hudUiPreferences.hudSize);
    }
    var settingsRoot = document.getElementById(settingsPanelId);
    if (settingsRoot) {
      settingsRoot.style.setProperty('--pnhud-settings-background-opacity', String(hudUiPreferences.settingsBackgroundOpacity));
      settingsRoot.style.setProperty('--pnhud-settings-surface-opacity', String(Math.max(0.1, Math.min(0.34, hudUiPreferences.settingsBackgroundOpacity * 0.34))));
    }
    var trackedPlayersRoot = document.getElementById(trackedPlayersPanelId);
    if (trackedPlayersRoot) trackedPlayersRoot.style.setProperty('--pnhud-settings-background-opacity', String(hudUiPreferences.settingsBackgroundOpacity));
    var dashboardRoot = document.getElementById(playerDashboardId);
    if (dashboardRoot) dashboardRoot.style.setProperty('--pnhud-dashboard-background-opacity', String(hudUiPreferences.dashboardBackgroundOpacity));
    settingsUiDiagnostics.activeAccentTheme = hudUiPreferences.accentTheme;
    settingsUiDiagnostics.hudOpacity = hudUiPreferences.hudOpacity;
    settingsUiDiagnostics.settingsBackgroundOpacity = hudUiPreferences.settingsBackgroundOpacity;
    settingsUiDiagnostics.dashboardBackgroundOpacity = hudUiPreferences.dashboardBackgroundOpacity;
    settingsUiDiagnostics.hudSize = hudUiPreferences.hudSize;
    settingsUiDiagnostics.opportunityStatsLayout = hudUiPreferences.opportunityStatsLayout;
    settingsUiDiagnostics.showPlayerProfiles = hudUiPreferences.showPlayerProfiles;
    settingsUiDiagnostics.developerToolsVisible = hudUiPreferences.developerToolsVisible;
  }

  function applyHudUiPreference(stored, source) {
    var previousLeaderboardSource = hudUiPreferences && hudUiPreferences.leaderboardStatSource;
    var previousLeaderboardEnabled = hudUiPreferences && hudUiPreferences.leaderboardEnabled;
    var previousHudSize = hudUiPreferences && hudUiPreferences.hudSize;
    var previousShowPotOdds = hudUiPreferences && hudUiPreferences.showPotOdds;
    var previousPotOddsOffsetX = hudUiPreferences && hudUiPreferences.potOddsOffsetX;
    var previousPotOddsOffsetY = hudUiPreferences && hudUiPreferences.potOddsOffsetY;
    var normalized = PokerHudSettings.normalize(stored);
    var proposedOffsetChanged = previousPotOddsOffsetX !== undefined && previousPotOddsOffsetX !== normalized.value.potOddsOffsetX || previousPotOddsOffsetY !== undefined && previousPotOddsOffsetY !== normalized.value.potOddsOffsetY;
    var settingsOffsetWrite = proposedOffsetChanged && /settings/i.test(String(source || '')) && !/reset/i.test(String(source || ''));
    if (settingsOffsetWrite) {
      normalized.value = Object.assign({}, normalized.value, { potOddsOffsetX: previousPotOddsOffsetX, potOddsOffsetY: previousPotOddsOffsetY });
      recordBoardCompanionEvent('ILLEGAL_SETTINGS_OFFSET_CHANGE', 'Settings attempted to mutate the pot-odds feature offset', {
        offset: { x: previousPotOddsOffsetX, y: previousPotOddsOffsetY }, source: source || null
      }, {
        offset: { x: previousPotOddsOffsetX, y: previousPotOddsOffsetY }, rejectedOffset: { x: stored && stored.potOddsOffsetX, y: stored && stored.potOddsOffsetY }, source: source || null
      });
    }
    hudUiPreferences = normalized.value;
    if (previousLeaderboardSource !== hudUiPreferences.leaderboardStatSource || previousLeaderboardEnabled !== hudUiPreferences.leaderboardEnabled) invalidateLeaderboardCareerRequest();
    settingsUiDiagnostics.settingsPanelOpen = hudUiPreferences.settingsOpen;
    settingsUiDiagnostics.selectedSection = hudUiPreferences.selectedSettingsSection;
    if (source === 'storage-restore') settingsUiDiagnostics.preferenceRestoreUsedDefaults = normalized.defaultUsed;
    settingsUiDiagnostics.lastPreferenceChangeSource = source || 'unknown';
    settingsUiDiagnostics.invalidFields = normalized.invalidFields.slice();
    applyHudUiAppearance();
    if (previousShowPotOdds !== undefined && previousShowPotOdds !== hudUiPreferences.showPotOdds && semanticLedgerState) refreshPotOddsFromLedger('preference hydration changed');
    if (previousShowPotOdds !== undefined && previousShowPotOdds !== hudUiPreferences.showPotOdds) {
      recordBoardCompanionEvent('widget-setting-change', source || 'Show Pot Odds preference changed');
    }
    if (previousPotOddsOffsetX !== undefined && previousPotOddsOffsetX !== hudUiPreferences.potOddsOffsetX || previousPotOddsOffsetY !== undefined && previousPotOddsOffsetY !== hudUiPreferences.potOddsOffsetY) {
      var offsetMutationReason = /pointer-drag/i.test(String(source || '')) ? 'DRAG_COMMIT' : /reset/i.test(String(source || '')) ? 'RESET_POSITION' : 'PREFERENCE_MIGRATION';
      lastPotOddsOffsetMutation = {
        reasonCode: offsetMutationReason, source: String(source || 'unknown').slice(0, 180), timestamp: Date.now(),
        before: { x: previousPotOddsOffsetX, y: previousPotOddsOffsetY }, after: { x: hudUiPreferences.potOddsOffsetX, y: hudUiPreferences.potOddsOffsetY }
      };
      recordBoardCompanionEvent('offset-mutation', offsetMutationReason + ': ' + String(source || 'pot-odds offset preference changed'));
      if (currentPotOddsPresentationDecision()) scheduleHeroPotOddsRender('pot-odds offset preference changed: ' + String(source || 'preference'));
    }
    if (previousHudSize && previousHudSize !== hudUiPreferences.hudSize) {
      requestAnimationFrame(function () { applyLeaderboardHudPosition('size-change-clamp', true); });
    }
    return normalized;
  }

  function updateHudUiPreferences(patch, source, options) {
    options = options || {};
    var next = PokerHudSettings.merge(hudUiPreferences, patch);
    if (PokerHudSettings.equal(hudUiPreferences, next)) {
      settingsUiDiagnostics.duplicateListenerPreventions += 1;
      return false;
    }
    applyHudUiPreference(next, source);
    if (options.persist !== false) {
      var update = {};
      update[STORAGE_KEYS.hudUiPreferences] = next;
      chrome.storage.local.set(update, function () {
        if (typeof options.onPersisted === 'function') options.onPersisted(next);
      });
    }
    if (options.render !== false) renderSettingsPanel();
    return true;
  }

  function ensureDemoData(callback) {
    var keysToRead = Object.values(STORAGE_KEYS).concat([LEGACY_LIVE_KEY]);
    traceFirstHandLifecycle('initialization', {
      event: 'storage restoration requested',
      timestampName: 'storageRestoreStartedAt',
      previousSnapshotPresent: Boolean(previousGcSnapshot),
      previousHandId: previousGcSnapshot ? findHandIdentifier(previousGcSnapshot) : null,
      activeHand: handAccounting ? cloneJson(PokerHandFinalization.activeHand(handAccounting)) : null
    });
    chrome.storage.local.get(keysToRead, restoreSaved);
    function restoreSaved(saved) {
      if (!ownsRuntimeController()) return;
      var indexedCareerBackendAvailable = Boolean(globalThis.PokerCareerIndexedStore && chrome.runtime && typeof chrome.runtime.sendMessage === 'function');
      careerStoreState = indexedCareerBackendAvailable ? null : PokerCareerContributionStore.createState(saved, { initializedAt: Date.now(), buildId: PNHUD_BUILD_ID });
      authoritativePersistenceQueue.observeRevision(saved[STORAGE_KEYS.liveRevision]);
      pipelineHealth.storageRestorationCallbackCount += 1;
      updateHealthPanel();
      traceHandSource('storage-restoration-callback', { callbackCount: pipelineHealth.storageRestorationCallbackCount, savedLiveEventCount: Array.isArray(saved[STORAGE_KEYS.live]) ? saved[STORAGE_KEYS.live].length : 0, savedFinalizedHandIds: saved[STORAGE_KEYS.finalizedHandIds] || [], savedActiveHand: saved[STORAGE_KEYS.activeHand] || null });
      var update = {};
      var careerInitialization = Promise.resolve();
      if (indexedCareerBackendAvailable) {
        careerIndexedService = PokerCareerIndexedStore.createMessageService(chrome.runtime);
        careerInitialization = careerIndexedService.initialize().then(function () {
          careerTrackingReady = true;
        }).catch(function (error) {
          careerTrackingReady = false;
          careerDiagnostics.rejected += 1;
          careerDiagnostics.recent.unshift({ timestamp: Date.now(), accepted: false, reason: 'extension career service initialization failed: ' + String(error && error.message || error) });
          console.error('[HUD CAREER STORAGE] extension-origin IndexedDB initialization failed; Phase 1 records remain untouched', error);
        });
      } else {
        /* Deterministic test/legacy fallback; packaged production uses service-worker messaging. */
        careerTrackingReady = true;
        if (careerStoreState.initializedNow) Object.assign(update, PokerCareerContributionStore.initializationUpdate(careerStoreState));
      }
      if (saved[STORAGE_KEYS.schema] !== LIVE_SCHEMA_VERSION) {
        update[STORAGE_KEYS.live] = [];
        update[STORAGE_KEYS.fingerprints] = [];
        update[STORAGE_KEYS.handSignatures] = [];
        update[STORAGE_KEYS.activeHand] = null;
        update[STORAGE_KEYS.finalizedHandIds] = [];
        update[STORAGE_KEYS.hostControl] = null;
        update[STORAGE_KEYS.schema] = LIVE_SCHEMA_VERSION;
        update[STORAGE_KEYS.liveRevision] = authoritativePersistenceQueue.inspect().latestRevision + 1;
        authoritativePersistenceQueue.observeRevision(update[STORAGE_KEYS.liveRevision]);
        console.log('[HUD] cleared stale persisted live session data');
      }
      if (!saved[STORAGE_KEYS.session]) update[STORAGE_KEYS.session] = PokerMockData.generateMockEvents(62, 20260717);
      if (!saved[STORAGE_KEYS.allTime]) update[STORAGE_KEYS.allTime] = PokerMockData.generateMockEvents(96, 9081726);
      if (!saved[STORAGE_KEYS.live] && !update[STORAGE_KEYS.live]) update[STORAGE_KEYS.live] = [];
      if (!saved[STORAGE_KEYS.fingerprints] && !update[STORAGE_KEYS.fingerprints]) update[STORAGE_KEYS.fingerprints] = [];
      if (!saved[STORAGE_KEYS.playerMap]) update[STORAGE_KEYS.playerMap] = {};
      if (!saved[STORAGE_KEYS.handSignatures]) update[STORAGE_KEYS.handSignatures] = [];
      if (!Object.prototype.hasOwnProperty.call(saved, STORAGE_KEYS.activeHand) && !Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.activeHand)) update[STORAGE_KEYS.activeHand] = null;
      if (!saved[STORAGE_KEYS.finalizedHandIds] && !update[STORAGE_KEYS.finalizedHandIds]) update[STORAGE_KEYS.finalizedHandIds] = [];
      if (!Object.prototype.hasOwnProperty.call(saved, STORAGE_KEYS.hostControl) && !Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.hostControl)) update[STORAGE_KEYS.hostControl] = null;
      potOddsBoardResetState = PokerPotOddsPosition.createBoardResetState(saved[STORAGE_KEYS.potOddsBoardReset]);
      update[STORAGE_KEYS.sessionMeta] = { gameId: pokerNowGameId, sessionKey: gameSessionKey, url: location.href, updatedAt: Date.now() };
      if (!saved[STORAGE_KEYS.mode]) update[STORAGE_KEYS.mode] = 'session';
      if (!saved[STORAGE_KEYS.displayMode]) update[STORAGE_KEYS.displayMode] = 'seat-overlays-only';
      if (typeof saved[STORAGE_KEYS.showOverlayBoxes] !== 'boolean') update[STORAGE_KEYS.showOverlayBoxes] = false;
      if (saved[STORAGE_KEYS.presentationPreferencesSchema] !== 1) {
        update[STORAGE_KEYS.debugSeatIdentity] = false;
        update[STORAGE_KEYS.showWithheldPlaceholders] = false;
        update[STORAGE_KEYS.presentationPreferencesSchema] = 1;
      } else {
        if (typeof saved[STORAGE_KEYS.debugSeatIdentity] !== 'boolean') update[STORAGE_KEYS.debugSeatIdentity] = false;
        if (typeof saved[STORAGE_KEYS.showWithheldPlaceholders] !== 'boolean') update[STORAGE_KEYS.showWithheldPlaceholders] = false;
      }
      if (typeof saved[STORAGE_KEYS.overlayDraggingUnlocked] !== 'boolean') update[STORAGE_KEYS.overlayDraggingUnlocked] = false;
      if (!saved[STORAGE_KEYS.diagnosticsLevel]) update[STORAGE_KEYS.diagnosticsLevel] = 'basic';
      if (typeof saved[STORAGE_KEYS.pauseLifecycleCaptureEnabled] !== 'boolean') update[STORAGE_KEYS.pauseLifecycleCaptureEnabled] = false;
      if (!saved[STORAGE_KEYS.manualOverlayPositions] || typeof saved[STORAGE_KEYS.manualOverlayPositions] !== 'object' || Array.isArray(saved[STORAGE_KEYS.manualOverlayPositions])) update[STORAGE_KEYS.manualOverlayPositions] = {};
      var normalizedOverlayPreference = applyOverlayStatPreference(saved[STORAGE_KEYS.overlayStatPreferences], 'storage-restore');
      if (!saved[STORAGE_KEYS.overlayStatPreferences] ||
          saved[STORAGE_KEYS.overlayStatPreferences].version !== PokerOverlayStats.PREFERENCE_VERSION ||
          !sameStringArray(saved[STORAGE_KEYS.overlayStatPreferences].displayedStatIds, normalizedOverlayPreference.normalizedDisplayedStatIds)) {
        update[STORAGE_KEYS.overlayStatPreferences] = normalizedOverlayPreference.preference;
      }
      var normalizedLeaderboardPreference = applyLeaderboardStatPreference(saved[STORAGE_KEYS.leaderboardStatPreferences], 'storage-restore');
      if (!saved[STORAGE_KEYS.leaderboardStatPreferences] || !sameLeaderboardPreference(saved[STORAGE_KEYS.leaderboardStatPreferences], normalizedLeaderboardPreference.preference)) {
        update[STORAGE_KEYS.leaderboardStatPreferences] = normalizedLeaderboardPreference.preference;
      }
      var normalizedLeaderboardPosition = PokerLeaderboardHudPosition.normalize(saved[STORAGE_KEYS.leaderboardHudPosition]);
      leaderboardHudPosition = normalizedLeaderboardPosition.value;
      leaderboardHudPositionDiagnostics.storedPosition = cloneJson(saved[STORAGE_KEYS.leaderboardHudPosition] || null);
      leaderboardHudPositionDiagnostics.locked = leaderboardHudPosition.locked;
      leaderboardHudPositionDiagnostics.lastPositionChangeSource = 'storage-restore';
      if (!saved[STORAGE_KEYS.leaderboardHudPosition] || !PokerLeaderboardHudPosition.equal(saved[STORAGE_KEYS.leaderboardHudPosition], leaderboardHudPosition)) {
        update[STORAGE_KEYS.leaderboardHudPosition] = leaderboardHudPosition;
      }
      var effectiveLegacyDisplayMode = Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.displayMode) ? update[STORAGE_KEYS.displayMode] : saved[STORAGE_KEYS.displayMode];
      var normalizedHudUiPreference = PokerHudSettings.normalizeVisibility(saved[STORAGE_KEYS.hudUiPreferences], effectiveLegacyDisplayMode);
      applyHudUiPreference(normalizedHudUiPreference.value, 'storage-restore');
      if (!saved[STORAGE_KEYS.hudUiPreferences] || !PokerHudSettings.equal(saved[STORAGE_KEYS.hudUiPreferences], normalizedHudUiPreference.value)) {
        update[STORAGE_KEYS.hudUiPreferences] = normalizedHudUiPreference.value;
      }
      displayMode = normalizedHudUiPreference.displayMode;
      playerNotesState = PokerPlayerNotesStore.normalize(saved[STORAGE_KEYS.playerNotes]);
      if (effectiveLegacyDisplayMode !== displayMode) update[STORAGE_KEYS.displayMode] = displayMode;
      liveEvents = Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.live) ? update[STORAGE_KEYS.live] : (saved[STORAGE_KEYS.live] || []);
      advanceFinalizedSessionRevision('storage hydration');
      PokerSessionRuntime.observePersistedRevision(sessionPersistencePlanner, finalizedSessionRevision);
      preflopDebug('persistence-restore', { storageKey: STORAGE_KEYS.live, restoredCounters: preflopEventSnapshots(liveEvents) });
      showdownDebug('persistence-restore', { storageKey: STORAGE_KEYS.live, events: showdownEventSnapshots(liveEvents) });
      showOverlayBoxes = Boolean(Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.showOverlayBoxes) ? update[STORAGE_KEYS.showOverlayBoxes] : saved[STORAGE_KEYS.showOverlayBoxes]);
      debugSeatIdentity = Boolean(Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.debugSeatIdentity) ? update[STORAGE_KEYS.debugSeatIdentity] : saved[STORAGE_KEYS.debugSeatIdentity]);
      showWithheldPlaceholders = Boolean(Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.showWithheldPlaceholders) ? update[STORAGE_KEYS.showWithheldPlaceholders] : saved[STORAGE_KEYS.showWithheldPlaceholders]);
      overlayDraggingUnlocked = Boolean(Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.overlayDraggingUnlocked) ? update[STORAGE_KEYS.overlayDraggingUnlocked] : saved[STORAGE_KEYS.overlayDraggingUnlocked]);
      manualOverlayPositions = Object.assign({}, Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.manualOverlayPositions) ? update[STORAGE_KEYS.manualOverlayPositions] : saved[STORAGE_KEYS.manualOverlayPositions]);
      var diagnosticsLevel = Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.diagnosticsLevel) ? update[STORAGE_KEYS.diagnosticsLevel] : saved[STORAGE_KEYS.diagnosticsLevel];
      PokerHudDiagnostics.setLevel(diagnosticsLevel);
      window.postMessage({ source: 'pokernow-stats-hud-content', type: 'diagnostics-level', level: PokerHudDiagnostics.getLevel() }, location.origin);
      pauseLifecycleCaptureEnabled = Boolean(
        Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.pauseLifecycleCaptureEnabled)
          ? update[STORAGE_KEYS.pauseLifecycleCaptureEnabled]
          : saved[STORAGE_KEYS.pauseLifecycleCaptureEnabled]
      );
      setPauseDiagnosticCaptureEnabled(pauseLifecycleCaptureEnabled, Date.now());
      logDisplayModeState('[HUD DISPLAY MODE] content received', null, displayMode, displayMode);
      var restoredActiveHand = Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.activeHand) ? update[STORAGE_KEYS.activeHand] : saved[STORAGE_KEYS.activeHand];
      var restoredFinalizedIds = Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.finalizedHandIds) ? update[STORAGE_KEYS.finalizedHandIds] : saved[STORAGE_KEYS.finalizedHandIds];
      handAccounting = PokerHandFinalization.createState({ finalizedEvents: liveEvents, finalizedHandIds: restoredFinalizedIds || [], activeHand: restoredActiveHand || null });
      semanticLedgerState = PokerSemanticHandLedger.createState({ finalizedHandIds: restoredFinalizedIds || [], maxRecords: 50, maxObservationsPerHand: 240, maxAttempts: 100 });
      preflopOpportunityState = PokerPreflopOpportunityReducer.createState({ finalizedHandIds: restoredFinalizedIds || [], maxRecords: 50, maxAttempts: 100, maxPlayers: 200 });
      flopCBetOpportunityState = PokerFlopCBetOpportunityReducer.createState({ finalizedHandIds: restoredFinalizedIds || [], maxRecords: 50, maxAttempts: 100, maxPlayers: 200, maxAttachments: 200 });
      showdownStatsState = PokerShowdownStatsReducer.createState({ finalizedHandIds: restoredFinalizedIds || [], maxRecords: 50, maxAttempts: 100, maxPlayers: 200, maxIdentityAliases: 400, maxAttachments: 200 });
      if (restoredActiveHand) {
        var semanticSnapshotRestore = restoredActiveHand.semanticHandLedgerSnapshot
          ? PokerSemanticHandLedger.restoreActiveHandSnapshot(semanticLedgerState, restoredActiveHand.semanticHandLedgerSnapshot)
          : { restored: false, reason: 'no bounded semantic snapshot was persisted' };
        if (!semanticSnapshotRestore.restored) PokerSemanticHandLedger.seedRecoveredHand(semanticLedgerState, restoredActiveHand);
        preflopDebug('flop-cbet-semantic-restore', semanticSnapshotRestore);
      }
      activeHandState = PokerHandFinalization.activeHand(handAccounting);
      interruptedHandRecoveryState = PokerInterruptedHandRecovery.createState(activeHandState);
      ownedHandReloadContinuityState = PokerOwnedHandReloadContinuity.createState(activeHandState);
      var restoredHostControl = Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.hostControl) ? update[STORAGE_KEYS.hostControl] : saved[STORAGE_KEYS.hostControl];
      hostControlTraceState = PokerHostControlTrace.createState(restoredHostControl || null);
      if (hostControlTraceState.authoritativePauseState || hostControlTraceState.activeLocalCommand) {
        var restoredAuthoritativePauseState = hostControlTraceState.authoritativePauseState || (hostControlTraceState.activeLocalCommand === 'paused-local-command' ? 'paused' : null);
        reconcileHudRuntimeStatus({
          timestamp: Date.now(),
          tableClassification: restoredAuthoritativePauseState === 'paused' ? 'paused' : 'resumed',
          lifecycleConfidence: 'persisted-verified-host-outgoing-command',
          lifecycleEvidence: { persistedHostControl: PokerHostControlTrace.persistentSnapshot(hostControlTraceState) },
          verifiedInactiveReason: restoredAuthoritativePauseState === 'paused' ? 'persisted verified host Pause command' : null,
          verifiedActiveReason: restoredAuthoritativePauseState === 'resumed' ? 'persisted verified host Resume command' : null,
          gamePaused: restoredAuthoritativePauseState === 'paused',
          authoritativePauseState: restoredAuthoritativePauseState,
          authoritativePauseEvidence: hostControlTraceState.authoritativePauseEvidence,
          localLifecycleCommand: hostControlTraceState.activeLocalCommand,
          reason: 'persisted-verified-host-control-restored'
        });
      }
      if (activeHandState && activeHandState.recoveryMetadata) {
        var restoredRecoveryMetadata = activeHandState.recoveryMetadata;
        pausePersistenceDiagnostics.activeHandPresentAtPause = Boolean(restoredRecoveryMetadata.pausedVerified);
        pausePersistenceDiagnostics.handId = restoredRecoveryMetadata.pausedVerified ? String(activeHandState.handId) : null;
        pausePersistenceDiagnostics.pauseVerifiedAt = restoredRecoveryMetadata.authoritativePauseTimestamp || null;
        pausePersistenceDiagnostics.persistenceRequestedAt = restoredRecoveryMetadata.persistenceRequestedAt || null;
        pausePersistenceDiagnostics.persistenceCompletedAt = restoredRecoveryMetadata.persistenceCompletedAt || restoredRecoveryMetadata.commandPersistenceCompletedAt || null;
        pausePersistenceDiagnostics.persistenceError = restoredRecoveryMetadata.persistenceError || restoredRecoveryMetadata.commandPersistenceError || null;
        pausePersistenceDiagnostics.persistedPausedVerified = Boolean(restoredRecoveryMetadata.pausedVerified);
        pausePersistenceDiagnostics.persistedLifecycle = restoredRecoveryMetadata.lifecycleAtPersistence || null;
        pausePersistenceDiagnostics.persistedRevision = Number(restoredRecoveryMetadata.pausePersistenceRevision || 0);
      }
      if (activeHandState) console.log('[HUD HAND FINALIZE] incomplete hand discarded/recovered', { handId: activeHandState.handId, action: 'recovered but not finalized', stagedEvents: activeHandState.events.length });
      capturedFingerprints = PokerRuntimeBounds.createFifoSet(5000);
      (Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.fingerprints) ? update[STORAGE_KEYS.fingerprints] : (saved[STORAGE_KEYS.fingerprints] || [])).forEach(function (fingerprint) {
        capturedFingerprints.add(fingerprint);
      });
      capturedEventSemantics = new Set(liveEvents.concat(activeHandState ? activeHandState.events : []).map(eventSemanticFingerprint));
      socketPlayerNames = new Map();
      Object.entries(saved[STORAGE_KEYS.playerMap] || {}).forEach(function (entry) {
        var restoredPlayerId = PokerPlayerProfileShadowStore.livePlayerIdentity(entry[0]);
        var restoredPlayerName = String(entry[1] === undefined || entry[1] === null ? '' : entry[1]).trim();
        if (!restoredPlayerId) {
          PokerPlayerProfileShadowStore.recordIdentityDiagnostic(playerProfileShadowState, entry[0], { source: 'storage-restore-player-map' });
          return;
        }
        if (restoredPlayerName) socketPlayerNames.set(restoredPlayerId, restoredPlayerName);
      });
      socketPlayerNames.forEach(function (name, id) {
        console.log('[HUD] player ID mapped', { playerId: id, playerName: name, source: 'restored table mapping' });
      });
      refreshShadowProfiles('storage-restore', liveEvents);
      socketHandSignatures = new Set(Object.prototype.hasOwnProperty.call(update, STORAGE_KEYS.handSignatures) ? update[STORAGE_KEYS.handSignatures] : (saved[STORAGE_KEYS.handSignatures] || []));
      pipelineHealth.injectedTestEvents = liveEvents.filter(isInjectedTestEvent).length;
      pipelineHealth.restoredStatsEvents = liveEvents.length - pipelineHealth.injectedTestEvents;
      pipelineHealth.realLiveEvents = 0;
      restoredEventCount = pipelineHealth.restoredStatsEvents;
      newlyDecodedEventCount = 0;
      pipelineHealth.playerMappingsFound = socketPlayerNames.size;
      pipelineHealth.confirmedPlayerMappings = socketPlayerNames.size;
      pipelineHealth.statsEventsStored = liveEvents.length;
      updateHandAccountingHealth();
      console.log('[HUD] restored session events', { count: restoredEventCount, events: liveEvents });
      console.log('[HUD] restored unique hand IDs', Array.from(new Set(liveEvents.map(function (event) { return event.handId; }))));
      traceFirstHandLifecycle('initialization', {
        event: 'persisted lifecycle state restored',
        restoredStatsEventCount: restoredEventCount,
        restoredFinalizedHandIds: Array.from(handAccounting.finalizedHandIds),
        restoredActiveHand: cloneJson(PokerHandFinalization.activeHand(handAccounting)),
        previousSnapshotPresent: Boolean(previousGcSnapshot),
        previousHandId: previousGcSnapshot ? findHandIdentifier(previousGcSnapshot) : null,
        mappingCount: socketPlayerNames.size,
        handSignatureCount: socketHandSignatures.size,
        boundaryDetectorState: { lastAcceptedBoundaryAt: handTransitionDiagnostics.lastAcceptedBoundaryAt, lastSettlementAt: handTransitionDiagnostics.lastSettlementAt },
        blindTrackerState: { rawTbTransitions: tbTraceState.rawTransitions, normalizedTbTransitions: tbTraceState.normalizedTransitions },
        storageRestorationComplete: true
      });
      if (isPokerNowPage && Array.isArray(saved[LEGACY_LIVE_KEY]) && saved[LEGACY_LIVE_KEY].length) {
        console.log('[HUD] legacy unscoped session ignored', {
          count: saved[LEGACY_LIVE_KEY].length,
          reason: 'legacy records contain no PokerNow game ID, so ownership cannot be established safely'
        });
      }
      function finishStorageRestore(restored) {
        if (!ownsRuntimeController()) return;
        callback(restored);
        if (indexedCareerBackendAvailable) {
          careerInitialization.then(function () {
            if (playerDashboardState.open && playerDashboardState.mode === 'career') loadPlayerDashboardCareer();
            if (currentSeatHudStatSource() === 'career') {
              requestSeatHudCareerBatch(Array.from(confirmedSeatMappings.keys()), 'Career service initialized after storage restore', true);
            }
          });
        }
      }
      if (Object.keys(update).length) chrome.storage.local.set(update, function () { finishStorageRestore(Object.assign({}, saved, update)); });
      else finishStorageRestore(saved);
    }
  }

  function finalizedProfileDiagnosticSnapshot() {
    var finalizedHandIds = handAccounting && handAccounting.finalizedHandIds ? Array.from(handAccounting.finalizedHandIds) : [];
    var lastFinalizedHandId = finalizedHandIds.length ? String(finalizedHandIds[finalizedHandIds.length - 1]) : null;
    return Object.freeze({
      asOfHand: lastFinalizedHandId,
      lastFinalizedHandId: lastFinalizedHandId,
      snapshotVersion: finalizedHandIds.length
    });
  }

  function refreshShadowProfile(playerIdValue, playerNameValue, events, reason, diagnosticSnapshot) {
    var playerId = PokerPlayerProfileShadowStore.livePlayerIdentity(playerIdValue);
    var playerName = String(playerNameValue === undefined || playerNameValue === null ? '' : playerNameValue).trim();
    if (!playerId) {
      PokerPlayerProfileShadowStore.recordIdentityDiagnostic(playerProfileShadowState, playerIdValue, { source: reason || 'profile-refresh' });
      return { updated: false, reused: false, failed: true, reason: 'valid stable playerId is required', record: null };
    }
    if (!playerName) return { updated: false, reused: false, failed: true, reason: 'stable player identity is incomplete', record: null };
    var authoritativeStats;
    try {
      authoritativeStats = events === liveEvents
        ? cachedSessionPlayerStats(playerId, playerName)
        : PokerStats.computePlayerStatsByIdentity(events || [], playerId, playerName);
    } catch (error) {
      authoritativeStats = {};
      if (globalThis.__PNHUD_PROFILE_DEBUG__ === true) {
        console.warn('[PNHUD PROFILE] authoritative statistics computation failed closed', { playerId: playerId, reason: reason, message: String(error && error.message || error) });
      }
    }
    var deterministicRebuild = reason === 'storage-restore' || reason === 'manual-read-only-rebuild';
    var generatedAt = deterministicRebuild ? latestProfileEventTimestamp(events) : Date.now();
    var result = PokerPlayerProfileShadowStore.update(playerProfileShadowState, playerId, authoritativeStats, {
      generatedAt: generatedAt,
      reason: reason,
      diagnosticSnapshot: diagnosticSnapshot || finalizedProfileDiagnosticSnapshot()
    });
    if (result.failed && globalThis.__PNHUD_PROFILE_DEBUG__ === true) {
      console.warn('[PNHUD PROFILE] player profile unsupported', { playerId: playerId, reason: result.reason, source: reason });
    }
    return result;
  }

  function latestProfileEventTimestamp(events) {
    return (events || []).reduce(function (latest, event) {
      var timestamp = Number(event && event.timestamp);
      return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, 0);
  }

  function refreshShadowProfiles(reason, events) {
    var sourceEvents = events || liveEvents || [];
    var diagnosticSnapshot = finalizedProfileDiagnosticSnapshot();
    var results = [];
    socketPlayerNames.forEach(function (playerName, playerId) {
      results.push(refreshShadowProfile(playerId, playerName, sourceEvents, reason, diagnosticSnapshot));
    });
    return results;
  }

  function profileStartupDiagnostic(stage, details) {
    globalThis.__PNHUD_PROFILE_STARTUP_STAGES__ = globalThis.__PNHUD_PROFILE_STARTUP_STAGES__ || {};
    if (globalThis.__PNHUD_PROFILE_STARTUP_STAGES__[stage]) return;
    globalThis.__PNHUD_PROFILE_STARTUP_STAGES__[stage] = true;
    var targetConsole = globalThis.console;
    if (targetConsole && typeof targetConsole.log === 'function') targetConsole.log('[PNHUD PROFILE STARTUP] ' + stage, details || {});
  }

  function installPlayerProfileDebugApi(api) {
    var roots = [globalThis];
    if (typeof window !== 'undefined' && !roots.includes(window)) roots.push(window);
    if (typeof self !== 'undefined' && !roots.includes(self)) roots.push(self);
    roots.forEach(function (root) {
      try {
        Object.defineProperty(root, 'PokerNowHUDProfiles', {
          configurable: true,
          enumerable: true,
          writable: false,
          value: api
        });
      } catch (_error) {
        try { root.PokerNowHUDProfiles = api; } catch (_ignored) {}
      }
    });
  }

  function uninstallPlayerProfileDebugApi(api) {
    var roots = [globalThis];
    if (typeof window !== 'undefined' && !roots.includes(window)) roots.push(window);
    if (typeof self !== 'undefined' && !roots.includes(self)) roots.push(self);
    roots.forEach(function (root) {
      try { if (root.PokerNowHUDProfiles === api) delete root.PokerNowHUDProfiles; } catch (_error) {}
    });
  }

  function readAllProfileStorage() {
    return PokerPlayerProfileCalibration.readAllStorage(chrome);
  }

  function exportCurrentProfileCalibration() {
    return PokerPlayerProfileCalibration.exportCalibration(PokerPlayerProfileShadowStore.list(playerProfileShadowState), gameSessionKey);
  }

  function rebuildHistoricalProfileSession(sessionKey) {
    var normalizedSessionKey = String(sessionKey === undefined || sessionKey === null ? '' : sessionKey).trim().slice(0, 500);
    if (!normalizedSessionKey) return Promise.resolve({ schemaVersion: PokerPlayerProfileCalibration.SCHEMA_VERSION, session: null, profiles: [], unsupportedPlayers: [], error: 'session key is required' });
    return readAllProfileStorage().then(function (saved) {
      return PokerPlayerProfileCalibration.rebuildSession(saved, normalizedSessionKey);
    });
  }

  function createCareerDebugApi() {
    function filteredOptions(filters) {
      var normalized = Object.assign({}, filters || {});
      if ((normalized.counterpartMode === 'self' || normalized.counterpartMode === 'others') && !normalized.selfPlayerId) normalized.selfPlayerId = localUserPlayerId;
      return normalized;
    }
    function filteredCareer(playerId, filters) {
      var normalized = filteredOptions(filters);
      return careerIndexedService
        ? careerIndexedService.careerStatsFiltered(playerId, normalized)
        : careerStoreState
        ? PokerFilteredStats.careerStatsFiltered(PokerCareerContributionStore.records(careerStoreState), playerId, normalized)
        : null;
    }
    return Object.freeze({
      careerStats: function (playerId) { return careerIndexedService ? careerIndexedService.careerStats(playerId) : careerStoreState ? PokerCareerContributionStore.playerStats(careerStoreState, playerId) : null; },
      filteredCareerStats: filteredCareer,
      positionStats: function (playerId, position) { return filteredCareer(playerId, position ? { position: position } : {}); },
      relationalStats: function (playerId, counterpartPlayerId, statId, position) { return filteredCareer(playerId, { position: position || null, statId: statId, counterpartMode: 'specific', counterpartPlayerId: counterpartPlayerId }); },
      filteredSessionStats: function (playerId, filters) { return cachedSessionFilteredStats(playerId, filteredOptions(filters)); },
      sessionPerformanceInfo: runtimePerformanceInfo,
      selfIdentityInfo: function () { return Object.freeze(cloneJson(localUserIdentityEvidence)); },
      careerPlayers: function () { return careerIndexedService ? careerIndexedService.careerPlayers() : careerStoreState ? PokerCareerContributionStore.players(careerStoreState) : []; },
      careerLedgerInfo: function () {
        return careerIndexedService
          ? careerIndexedService.careerLedgerInfo().then(function (info) { return Object.assign(info, { persistence: authoritativePersistenceQueue.inspect(), diagnostics: cloneJson(careerDiagnostics) }); })
          : careerStoreState
          ? Object.assign(PokerCareerContributionStore.info(careerStoreState), { ready: careerTrackingReady, persistence: authoritativePersistenceQueue.inspect(), diagnostics: cloneJson(careerDiagnostics) })
          : { ready: false, reason: 'career storage hydration has not completed' };
      },
      careerPlayerRecordInfo: function (playerId) { return careerIndexedService ? careerIndexedService.careerPlayerRecordInfo(playerId) : Promise.resolve(null); },
      rebuildCareerStats: function () { return careerIndexedService ? careerIndexedService.rebuildCareerStats() : careerStoreState ? PokerCareerContributionStore.rebuild(careerStoreState) : null; },
      recentCareerRecords: function (limit) { return careerIndexedService ? careerIndexedService.recentCareerRecords(limit) : careerStoreState ? PokerCareerContributionStore.recentRecords(careerStoreState, limit) : []; },
      exportCareer: function () { return careerIndexedService ? careerIndexedService.exportCareer() : Promise.resolve(null); },
      exportCareerBackup: function () { return careerIndexedService ? careerIndexedService.exportCareerBackup() : Promise.reject(new Error('formal backup requires the extension service worker backend')); },
      validateCareerBackup: function (backup) { return careerIndexedService ? careerIndexedService.validateCareerBackup(backup) : Promise.reject(new Error('formal backup validation requires the extension service worker backend')); },
      careerRuntimeTimings: function (playerId) { return careerIndexedService ? careerIndexedService.careerRuntimeTimings(playerId) : Promise.reject(new Error('runtime timing diagnostics require the extension service worker backend')); },
      downloadCareerBackup: function () {
        if (!careerIndexedService) return Promise.reject(new Error('formal backup requires the extension service worker backend'));
        return careerIndexedService.exportCareerBackup().then(function (backup) {
          var fileName = 'pokernow-career-backup-v' + backup.backupFormatVersion + '-' + backup.integrity.payloadDigest.slice(0, 12) + '.json.gz';
          return triggerCareerBackupDownload(backup, fileName).then(function (download) {
            return { downloaded: true, fileName: download.fileName, compressedBytes: download.compressedBytes, decompressedBytes: download.decompressedBytes, summary: { physicalRecordCount: backup.integrity.physicalRecordCount, activeRecordCount: backup.integrity.activeRecordCount, playerCount: backup.integrity.playerCount, careerTrackingStartedAt: backup.careerMetadata.careerTrackingStartedAt, payloadDigest: backup.integrity.payloadDigest } };
          });
        });
      }
    });
  }

  function updatePotOddsTableUiState(liveState, options) {
    options = options || {};
    var snapshot = options.snapshot || previousGcSnapshot || null;
    var playerId = localUserPlayerId === null || localUserPlayerId === undefined ? null : String(localUserPlayerId);
    var playerStatus = playerId && snapshot && snapshot.pGS ? snapshot.pGS[playerId] : null;
    var normalizedStatus = String(playerStatus === null || playerStatus === undefined ? '' : playerStatus).toLowerCase().replace(/[^a-z]/g, '');
    var authoritativeLeft = /^(?:out|left|leave|spectator|notingame|notseated)$/.test(normalizedStatus);
    var playersMap = snapshot ? findPlayersMap(snapshot) || {} : {};
    var rosterContainsHero = Boolean(playerId && Object.prototype.hasOwnProperty.call(playersMap, playerId));
    var inHandIds = snapshot ? exactPlayerIdCollection(snapshot, 'iHPI').map(String) : [];
    var seatResolution = null;
    try { seatResolution = playerId ? currentHeroSeatForPotOdds() : null; } catch (_error) { seatResolution = null; }
    var connectedHeroSeat = Boolean(seatResolution && seatResolution.seatElement && seatResolution.seatElement.isConnected);
    if (!playerId) {
      potOddsTableUiState.heroSeated = false;
      potOddsTableUiState.heroSeatedKnown = false;
      potOddsTableUiState.seatEvidenceSource = 'canonical local player identity unavailable';
    } else if (authoritativeLeft) {
      potOddsTableUiState.heroSeated = false;
      potOddsTableUiState.heroSeatedKnown = true;
      potOddsTableUiState.seatEvidenceSource = 'authoritative pGS local-player out status';
    } else if (normalizedStatus || rosterContainsHero || connectedHeroSeat) {
      potOddsTableUiState.heroSeated = true;
      potOddsTableUiState.heroSeatedKnown = true;
      potOddsTableUiState.seatEvidenceSource = normalizedStatus ? 'authoritative pGS seated/table status' : rosterContainsHero ? 'authoritative merged table roster' : seatResolution.source || 'connected canonical hero seat';
      potOddsTableUiState.lastVerifiedAt = Date.now();
    } else if (potOddsTableUiState.localPlayerId !== playerId || potOddsTableUiState.tableId !== pokerNowGameId) {
      potOddsTableUiState.heroSeated = false;
      potOddsTableUiState.heroSeatedKnown = false;
      potOddsTableUiState.seatEvidenceSource = 'seat applicability has not been verified for this table';
    }
    potOddsTableUiState.tableId = pokerNowGameId;
    potOddsTableUiState.localPlayerId = playerId;
    potOddsTableUiState.failClosed = options.failClosed === true || extensionCleanedUp || !runtimeScope.isPokerNowGamePage(window.location);
    var street = String(liveState && liveState.street || '').toLowerCase();
    var terminal = options.terminal === true || street === 'terminal';
    if (terminal) potOddsTableUiState.lifecycleState = 'between-hands';
    else if (liveState && liveState.handId || playerId && inHandIds.indexOf(playerId) >= 0) potOddsTableUiState.lifecycleState = 'active-hand';
    else if (potOddsTableUiState.heroSeated && snapshot) potOddsTableUiState.lifecycleState = 'between-hands';
    else if (potOddsTableUiState.heroSeated) potOddsTableUiState.lifecycleState = 'table-ready-semantic-unknown';
    else potOddsTableUiState.lifecycleState = 'table-applicability-unknown';
    potOddsTableUiState.definiteZero = Boolean(options.definiteZero === true || terminal || potOddsTableUiState.lifecycleState === 'between-hands');
    potOddsTableUiState.lastUpdatedAt = Date.now();
    return potOddsTableUiState;
  }

  function derivePotOddsPresentation(decision, liveState, options) {
    options = options || {};
    var enabled = options.enabled !== false;
    var tableUi = updatePotOddsTableUiState(liveState, options);
    var players = liveState && Array.isArray(liveState.players) ? liveState.players : null;
    var self = players && localUserPlayerId ? players.find(function (player) { return String(player.playerId) === String(localUserPlayerId); }) || null : null;
    var street = String(liveState && liveState.street || decision && decision.street || '').toLowerCase() || null;
    var handActive = Boolean(liveState && liveState.handId && street !== 'terminal');
    var heroFolded = self ? self.folded === true : null;
    var heroAllIn = self ? self.allIn === true || typeof self.stack === 'number' && self.stack === 0 : null;
    var membershipTrusted = Boolean(players && self && handActive);
    var heroActiveInHand = Boolean(membershipTrusted && self.active !== false && self.inHand !== false && !heroFolded && !heroAllIn);
    var sameHandDecision = Boolean(decision && decision.status === 'supported' && (!decision.handId || !liveState || !liveState.handId || String(decision.handId) === String(liveState.handId)));
    var currentDecisionAvailable = Boolean(heroActiveInHand && sameHandDecision);
    var currentAmountToCall = currentDecisionAvailable ? Number(decision.amountToCall || 0) : null;
    var opponentActing = Boolean(liveState && liveState.actingPlayerId && localUserPlayerId && String(liveState.actingPlayerId) !== String(localUserPlayerId));
    var definitelyZero = Boolean(tableUi.definiteZero || heroFolded || heroAllIn || self && (self.active === false || self.inHand === false) || opponentActing || currentDecisionAvailable && currentAmountToCall === 0 || options.forceZero === true);
    var contentState = currentDecisionAvailable && currentAmountToCall > 0 ? 'CALL' : definitelyZero ? 'ZERO' : 'UNKNOWN';
    var presentationAmountToCall = contentState === 'CALL' ? currentAmountToCall : contentState === 'ZERO' ? 0 : null;
    var presentationRequiredEquity = contentState === 'CALL' ? decision.requiredEquity : null;
    var hiddenReason = !enabled ? 'Show Pot Odds disabled'
      : tableUi.failClosed ? 'route/table lifecycle is fail-closed'
      : !pokerNowGameId ? 'table identity is not safely known'
      : !localUserPlayerId ? 'canonical local player identity unavailable'
      : !tableUi.heroSeatedKnown ? 'canonical local seated-player state unavailable'
      : !tableUi.heroSeated ? 'canonical local player is no longer seated'
      : null;
    var visible = !hiddenReason;
    var visibleReason = visible ? 'persistent table companion: ' + contentState : null;
    var presentationDecision = visible ? {
      status: 'supported', playerId: String(localUserPlayerId), handId: liveState && liveState.handId || decision && decision.handId || null, street: street,
      currentEligiblePot: contentState === 'CALL' ? decision.currentEligiblePot : null,
      amountToCall: presentationAmountToCall,
      potAfterCall: contentState === 'CALL' ? decision.potAfterCall : null,
      requiredEquity: presentationRequiredEquity,
      presentationState: contentState,
      reasonCode: contentState === 'CALL' ? decision.reasonCode : contentState === 'ZERO' ? 'PERSISTENT_TABLE_ZERO' : 'PERSISTENT_TABLE_UNKNOWN',
      evidence: { actor: liveState && liveState.actingPlayerId || null, presentationOnlyZero: contentState === 'ZERO', tableLifecycle: tableUi.lifecycleState, seatEvidenceSource: tableUi.seatEvidenceSource }
    } : null;
    return {
      visible: visible, decision: presentationDecision, contentState: contentState, tableApplicable: visible,
      tableLifecycleState: tableUi.lifecycleState, heroSeated: tableUi.heroSeated, heroSeatedKnown: tableUi.heroSeatedKnown,
      heroActiveInHand: heroActiveInHand, heroFolded: heroFolded, heroAllIn: heroAllIn,
      handActive: handActive, membershipTrusted: membershipTrusted,
      currentDecisionAvailable: currentDecisionAvailable, currentDecisionStatus: decision && decision.status || null,
      currentAmountToCall: currentAmountToCall, presentationAmountToCall: visible ? presentationAmountToCall : null,
      presentationRequiredEquity: visible ? presentationRequiredEquity : null,
      persistentZeroState: Boolean(visible && contentState === 'ZERO'), panelVisibleReason: visibleReason,
      panelHiddenReason: hiddenReason, street: street, handId: liveState && liveState.handId || decision && decision.handId || null
    };
  }

  function potOddsPresentationFingerprint(presentation) {
    presentation = presentation || {};
    return JSON.stringify({
      visible: presentation.visible === true,
      panelHiddenReason: presentation.panelHiddenReason || null,
      presentation: presentation.decision ? PokerPotOdds.decisionRenderFingerprint(presentation.decision, hudUiPreferences.showPotOdds) : null
    });
  }

  function currentPotOddsPresentationDecision() {
    return potOddsPresentation && potOddsPresentation.visible ? potOddsPresentation.decision : null;
  }

  function reconcilePotOddsPresentationDependencies(reason) {
    var beforeApplicable = Boolean(potOddsPresentation && potOddsPresentation.tableApplicable);
    var liveState = PokerPotOdds.liveStateFromContinuity(potOddsLiveState);
    var street = String(liveState && liveState.street || '').toLowerCase();
    var knownBetweenHands = potOddsTableUiState.lifecycleState === 'between-hands';
    var changed = commitPotOddsDecision(potOddsDecision, 'pot-odds dependency changed: ' + String(reason || 'table applicability'), {
      liveState: liveState,
      snapshot: previousGcSnapshot || null,
      terminal: street === 'terminal' || knownBetweenHands,
      definiteZero: knownBetweenHands
    });
    var afterApplicable = Boolean(potOddsPresentation && potOddsPresentation.tableApplicable);
    if (beforeApplicable !== afterApplicable) recordBoardCompanionEvent('applicability-change', reason || 'table applicability changed');
    if (!changed && currentPotOddsPresentationDecision()) scheduleHeroPotOddsRender('pot-odds dependency reconcile: ' + String(reason || 'table/layout'));
    return changed;
  }

  function boardCompanionEventEssentials() {
    var info = boardCompanionLayoutState && boardCompanionLayoutState.lastInfo || null;
    var actual = heroPotOddsPlacementDiagnostic && (heroPotOddsPlacementDiagnostic.actualPanelRect || heroPotOddsPlacementDiagnostic.proposedPanelRect) || heroPotOddsLastVisibleRect;
    return {
      applicable: Boolean(potOddsPresentation && potOddsPresentation.tableApplicable),
      canonicalRevision: Number(boardCompanionLayoutState && boardCompanionLayoutState.revision || 0),
      layoutEpochId: info && info.layoutEpochId || null,
      tableOwnerSource: info && info.tableOwnerSource || null,
      viewport: cloneJson(info && info.viewport || null),
      tableViewportRect: cloneJson(info && info.tableViewportRect || null),
      tableTransform: cloneJson(info && info.tableTransform || null),
      canonicalBoardLocalRect: cloneJson(info && info.canonicalBoardLocalRect || null),
      canonicalBoardRect: cloneJson(info && info.canonicalBoardRect || null),
      canonicalLeftCompanionRect: cloneJson(info && info.canonicalLeftCompanionRect || null),
      geometryAvailable: Boolean(info && info.canonicalBoardRect && info.canonicalLeftCompanionRect),
      cachedGeometryReused: Boolean(info && info.cachedGeometryReused),
      hostConnected: Boolean(heroPotOddsElement && heroPotOddsElement.isConnected),
      visible: Boolean(heroPotOddsElement && heroPotOddsElement.isConnected && !heroPotOddsElement.hidden && heroPotOddsElement.style.visibility !== 'hidden'),
      panelRect: cloneJson(actual || null),
      offset: persistedPotOddsOffset(),
      offsetMutationSource: cloneJson(lastPotOddsOffsetMutation),
      viewportClampApplied: Boolean(heroPotOddsPlacementDiagnostic && heroPotOddsPlacementDiagnostic.viewportClampApplied),
      dragging: Boolean(activePotOddsDrag),
      dragState: activePotOddsDrag ? { pointerId: activePotOddsDrag.pointerId, moved: activePotOddsDrag.moved, captureRequested: activePotOddsDrag.captureRequested, captureEstablished: activePotOddsDrag.captureEstablished, listenerOwner: 'stable delegated #' + potOddsRootId } : { active: false, listenerOwner: 'stable delegated #' + potOddsRootId },
      resetPending: heroPotOddsResetPending === true,
      settingsVisible: hudUiPreferences.settingsOpen === true
    };
  }

  function recordBoardCompanionEvent(type, reason, before, after) {
    before = before === undefined ? cloneJson(boardCompanionLastEventEssentials) : cloneJson(before);
    after = after === undefined ? boardCompanionEventEssentials() : cloneJson(after);
    var alwaysMeaningful = /^(?:render-requested|render-committed|drag-pointerdown-accepted|drag-pointerdown-rejected|drag-capture|drag-threshold-crossed|drag-move|drag-start|drag-end|offset-mutation|offset-persisted|reset-requested|reset-applied|settings-open|settings-close|settings-tab-switch|settings-layout-signal|host-created|host-reused|hide-attempt|suppress-attempt|canonical-revision|layout-epoch-change|ILLEGAL_CANONICAL_GEOMETRY_CHANGE|ILLEGAL_SETTINGS_GEOMETRY_CHANGE|ILLEGAL_SETTINGS_OFFSET_CHANGE)$/.test(String(type || ''));
    if (!alwaysMeaningful && JSON.stringify(before || null) === JSON.stringify(after || null)) return null;
    boardCompanionEventSequence += 1;
    var entry = {
      sequence: boardCompanionEventSequence,
      timestamp: Date.now(),
      type: String(type || 'layout-change').slice(0, 80),
      reason: String(reason || 'unspecified').slice(0, 180),
      before: before || null,
      after: after || null
    };
    boardCompanionEventHistory.push(entry);
    if (boardCompanionEventHistory.length > 160) boardCompanionEventHistory.splice(0, boardCompanionEventHistory.length - 160);
    boardCompanionLastEventEssentials = boardCompanionEventEssentials();
    return entry;
  }

  function boardCompanionEventHistoryInfo() {
    return cloneJson({ schemaVersion: 2, capacity: 160, count: boardCompanionEventHistory.length, events: boardCompanionEventHistory });
  }

  function createPotOddsDebugApi() {
    return Object.freeze({
      currentDecision: function () {
        var decision = PokerPotOdds.currentDecision(potOddsDecision);
        decision.evidence = Object.assign({}, decision.evidence || {}, { liveStateProvenance: PokerPotOdds.liveStateContinuityInfo(potOddsLiveState) });
        return decision;
      },
      placementInfo: function () {
        var presentation = potOddsPresentation || {};
        var publicAnchorType = heroPotOddsPlacementDiagnostic.chosenAnchorType === 'canonical-board-slot' ? 'canonical-board-slot' : null;
        return cloneJson(Object.assign({}, heroPotOddsPlacementDiagnostic, heroPotOddsRenderDiagnostic, {
          anchorType: publicAnchorType,
          virtualBoardRect: null,
          actualBoardRect: heroPotOddsPlacementDiagnostic.actualBoardRect || heroPotOddsPlacementDiagnostic.boardRect || null,
          preflopAnchorSource: null,
          panelRect: heroPotOddsPlacementDiagnostic.proposedPanelRect || null,
          activeHeroHand: presentation.heroActiveInHand === true,
          amountToCall: presentation.presentationAmountToCall,
          zeroCallPersistentState: presentation.persistentZeroState === true,
          heroActiveInHand: presentation.heroActiveInHand === true, heroFolded: presentation.heroFolded,
          handActive: presentation.handActive === true, currentDecisionAvailable: presentation.currentDecisionAvailable === true,
          currentDecisionStatus: presentation.currentDecisionStatus || null, currentAmountToCall: presentation.currentAmountToCall,
          presentationAmountToCall: presentation.presentationAmountToCall,
          presentationRequiredEquity: presentation.presentationRequiredEquity,
          persistentZeroState: presentation.persistentZeroState === true,
          contentState: presentation.contentState || null,
          tableLifecycleState: presentation.tableLifecycleState || null,
          tableApplicable: presentation.tableApplicable === true,
          heroSeated: presentation.heroSeated === true,
          heroAllIn: presentation.heroAllIn,
          panelVisibleReason: presentation.panelVisibleReason || null, panelHiddenReason: presentation.panelHiddenReason || null,
          visibilityStats: heroPotOddsVisibilityStats
        }));
      },
      debugTimeline: function () {
        return cloneJson({
          buildId: PNHUD_BUILD_ID, capacity: 96, events: potOddsForensicTimeline,
          visibilityStats: heroPotOddsVisibilityStats, currentPlacement: Object.assign({}, heroPotOddsPlacementDiagnostic, heroPotOddsRenderDiagnostic),
          currentDecision: PokerPotOdds.currentDecision(potOddsDecision), dragEvents: overlayDragTimeline
        });
      }
    });
  }

  function updateBoardCompanionDiagnosticContext(collisionReason) {
    var pill = heroPotOddsElement && heroPotOddsElement.querySelector ? heroPotOddsElement.querySelector('.pnhud-pot-odds') : null;
    var pillRect = pill && pill.isConnected && pill.getBoundingClientRect ? pill.getBoundingClientRect() : null;
    return PokerBoardCompanionLayout.updateContext(boardCompanionLayoutState, {
      potOddsActualRect: pillRect,
      collisionReason: collisionReason === undefined ? heroPotOddsPlacementDiagnostic && heroPotOddsPlacementDiagnostic.collisionReason || null : collisionReason,
      street: potOddsPresentation && potOddsPresentation.street || null,
      settingsVisible: hudUiPreferences.settingsOpen === true,
      layoutResolutionTrigger: heroPotOddsPlacementDiagnostic && heroPotOddsPlacementDiagnostic.placementReason || heroPotOddsRenderReason || null,
      lifecycleState: potOddsPresentation && potOddsPresentation.tableLifecycleState || null,
      widgetVisibleReason: potOddsPresentation && (potOddsPresentation.panelVisibleReason || potOddsPresentation.panelHiddenReason) || null,
      contentState: potOddsPresentation && potOddsPresentation.contentState || null,
      persistedOffsetX: hudUiPreferences.potOddsOffsetX,
      persistedOffsetY: hudUiPreferences.potOddsOffsetY,
      unclampedActualRect: heroPotOddsPlacementDiagnostic && heroPotOddsPlacementDiagnostic.unclampedActualRect || null,
      actualPanelRect: heroPotOddsPlacementDiagnostic && heroPotOddsPlacementDiagnostic.actualPanelRect || pillRect,
      viewportClampApplied: heroPotOddsPlacementDiagnostic && heroPotOddsPlacementDiagnostic.viewportClampApplied === true,
      draggingNow: Boolean(activePotOddsDrag),
      dragState: activePotOddsDrag ? { pointerId: activePotOddsDrag.pointerId, moved: activePotOddsDrag.moved, captureRequested: activePotOddsDrag.captureRequested, captureEstablished: activePotOddsDrag.captureEstablished, listenerOwner: 'stable delegated #' + potOddsRootId } : { active: false, listenerOwner: 'stable delegated #' + potOddsRootId },
      resetPending: heroPotOddsResetPending === true,
      offsetMutationSource: cloneJson(lastPotOddsOffsetMutation)
    });
  }

  function createBoardCompanionDebugApi() {
    return Object.freeze({
      layoutInfo: function () {
        updateBoardCompanionDiagnosticContext();
        return PokerBoardCompanionLayout.layoutInfo(boardCompanionLayoutState);
      },
      captureLayoutSnapshot: function () {
        updateBoardCompanionDiagnosticContext();
        return PokerBoardCompanionLayout.captureLayoutSnapshot(boardCompanionLayoutState);
      },
      eventHistory: function () {
        return boardCompanionEventHistoryInfo();
      }
    });
  }

  function installBoardCompanionDebugApi(api) {
    try { Object.defineProperty(globalThis, 'PokerNowHUDBoardCompanion', { value: api, configurable: true, enumerable: false, writable: false }); }
    catch (_error) { globalThis.PokerNowHUDBoardCompanion = api; }
  }

  function uninstallBoardCompanionDebugApi(api) {
    if (globalThis.PokerNowHUDBoardCompanion !== api) return;
    try { delete globalThis.PokerNowHUDBoardCompanion; } catch (_error) { globalThis.PokerNowHUDBoardCompanion = undefined; }
  }

  function installPotOddsDebugApi(api) {
    try { Object.defineProperty(globalThis, 'PokerNowHUDPotOdds', { value: api, configurable: true, enumerable: false, writable: false }); }
    catch (_error) { globalThis.PokerNowHUDPotOdds = api; }
  }

  function uninstallPotOddsDebugApi(api) {
    if (globalThis.PokerNowHUDPotOdds !== api) return;
    try { delete globalThis.PokerNowHUDPotOdds; } catch (_error) { globalThis.PokerNowHUDPotOdds = undefined; }
  }

  function installCareerDebugApi(api) {
    try {
      Object.defineProperty(globalThis, 'PokerNowHUDCareer', { value: api, configurable: true, enumerable: false, writable: false });
    } catch (error) {
      globalThis.PokerNowHUDCareer = api;
    }
  }

  function uninstallCareerDebugApi(api) {
    if (globalThis.PokerNowHUDCareer !== api) return;
    try { delete globalThis.PokerNowHUDCareer; } catch (error) { globalThis.PokerNowHUDCareer = undefined; }
  }

  function statsDebugPercentage(made, opportunities) {
    return opportunities > 0 ? Math.round((made / opportunities) * 1000) / 10 : null;
  }

  function boundedReducerContributions(playerId) {
    playerId = String(playerId);
    var reducers = [
      { source: 'preflop', inspection: PokerPreflopOpportunityReducer.inspect(preflopOpportunityState) },
      { source: 'flop-cbet', inspection: PokerFlopCBetOpportunityReducer.inspect(flopCBetOpportunityState) },
      { source: 'showdown', inspection: PokerShowdownStatsReducer.inspect(showdownStatsState) }
    ];
    return reducers.reduce(function (records, reducer) {
      (reducer.inspection.contributionRecords || []).forEach(function (record) {
        if (!record || !record.players || !Object.prototype.hasOwnProperty.call(record.players, playerId)) return;
        records.push({
          source: reducer.source,
          handIdentity: cloneJson(record.handIdentity || null),
          reducerVersion: record.reducerVersion || record.version || record.schemaVersion || null,
          result: cloneJson(record.players[playerId])
        });
      });
      return records;
    }, []).slice(-20);
  }

  function statsDebug(playerIdValue) {
    var playerId = String(playerIdValue === null || playerIdValue === undefined ? '' : playerIdValue).trim();
    if (!playerId) return null;
    var playerName = stablePlayerNameForEvents(playerId, liveEvents);
    var stats = cachedSessionPlayerStats(playerId, playerName);
    var playerEvents = liveEvents.filter(function (event) { return event && String(event.playerId || '') === playerId; });
    return {
      playerId: playerId,
      hands: stats.handsPlayed,
      vpip: { made: stats.vpipHands, opportunities: stats.vpipOpportunities, percentage: stats.vpipOpportunities ? stats.vpip : null },
      pfr: { made: stats.pfrHands, opportunities: stats.pfrOpportunities, percentage: stats.pfrOpportunities ? stats.pfr : null },
      threeBet: { made: stats.threeBetMade, opportunities: stats.threeBetOpportunities, percentage: statsDebugPercentage(stats.threeBetMade, stats.threeBetOpportunities) },
      foldToThreeBet: { folds: stats.foldToThreeBet, opportunities: stats.foldToThreeBetOpportunities, percentage: statsDebugPercentage(stats.foldToThreeBet, stats.foldToThreeBetOpportunities) },
      flopCBet: { made: stats.flopCBetMade, opportunities: stats.flopCBetOpportunities, percentage: statsDebugPercentage(stats.flopCBetMade, stats.flopCBetOpportunities) },
      foldToFlopCBet: { folds: stats.foldToFlopCBet, opportunities: stats.foldToFlopCBetOpportunities, percentage: statsDebugPercentage(stats.foldToFlopCBet, stats.foldToFlopCBetOpportunities) },
      wtsd: { made: stats.wentToShowdown, opportunities: stats.sawFlopForWTSD, percentage: statsDebugPercentage(stats.wentToShowdown, stats.sawFlopForWTSD) },
      wsd: { made: stats.wonMoneyAtShowdown, opportunities: stats.showdownsForWSD, percentage: statsDebugPercentage(stats.wonMoneyAtShowdown, stats.showdownsForWSD) },
      lastHandContributions: playerEvents.filter(function (event) {
        return event.preflopOpportunityHandId || event.flopCBetContributionId || event.showdownStatsContributionId;
      }).slice(-20).map(function (event) {
        return {
          handId: String(event.handId),
          preflopContributionId: event.preflopOpportunityContributionId || (event.preflopOpportunityHandId ? ['preflop', event.preflopOpportunityVersion || 1, event.preflopOpportunityHandId, playerId].join(':') : null),
          flopCBetContributionId: event.flopCBetContributionId || null,
          showdownContributionId: event.showdownStatsContributionId || null,
          counters: PokerStats.authoritativeCounterSnapshot(PokerStats.computePlayerStatsByIdentity([event], playerId, playerName))
        };
      }),
      reducerResults: boundedReducerContributions(playerId),
      attemptedRegressions: counterRegressionDiagnostics.filter(function (entry) {
        return (entry.regressions || []).some(function (result) { return result.playerId === playerId; });
      }).slice(-20),
      persistence: authoritativePersistenceQueue.inspect()
    };
  }

  function createPlayerProfileDebugApi() {
    var base = PokerPlayerProfileShadowStore.createDebugApi(playerProfileShadowState);
    return Object.freeze({
      list: base.list,
      get: base.get,
      summary: base.summary,
      clear: base.clear,
      profileTimeline: base.profileTimeline,
      profileSamples: base.profileSamples,
      profileStability: base.profileStability,
      profileBandSnapshots: base.profileBandSnapshots,
      displayedProfile: base.displayedProfile,
      allDisplayedProfiles: base.allDisplayedProfiles,
      scoreDecomposition: base.scoreDecomposition,
      explainPlayerProfile: explainPlayerProfile,
      allProfileStability: base.allProfileStability,
      exportLiveProfileValidation: base.exportLiveProfileValidation,
      identityDiagnostics: base.identityDiagnostics,
      statsDebug: statsDebug,
      lastHandStatExplanation: function () {
        return PokerHandStatExplanation.latest(statExplanationState);
      },
      handStatExplanation: function (handId) {
        return PokerHandStatExplanation.get(statExplanationState, handId);
      },
      handStatExplanations: function () {
        return PokerHandStatExplanation.list(statExplanationState);
      },
      explainLastHand: function () {
        return PokerHandStatExplanation.summarize(PokerHandStatExplanation.latest(statExplanationState));
      },
      statsContinuityDiagnostics: function () {
        return {
          attemptedRegressions: cloneJson(counterRegressionDiagnostics),
          persistence: authoritativePersistenceQueue.inspect()
        };
      },
      sessions: function () {
        return readAllProfileStorage().then(function (saved) { return PokerPlayerProfileCalibration.discoverSessions(saved); });
      },
      rebuildFromExistingStats: function () {
        PokerPlayerProfileShadowStore.clear(playerProfileShadowState);
        refreshShadowProfiles('manual-read-only-rebuild', liveEvents);
        return exportCurrentProfileCalibration();
      },
      rebuildSession: rebuildHistoricalProfileSession,
      exportCalibration: exportCurrentProfileCalibration,
      exportSessionCalibration: rebuildHistoricalProfileSession,
      calibrationSummary: function () {
        return PokerPlayerProfileCalibration.calibrationSummary(exportCurrentProfileCalibration());
      },
      sessionCalibrationSummary: function (sessionKey) {
        return rebuildHistoricalProfileSession(sessionKey).then(function (result) {
          return { session: result.session, error: result.error, summary: PokerPlayerProfileCalibration.calibrationSummary(result.profiles) };
        });
      }
    });
  }

  function format(value, suffix) {
    if (value === Infinity) return '\u221e';
    return value.toFixed(1) + (suffix || '');
  }

  function logDisplayModeState(label, previousMode, selectedMode, storedValue) {
    var visibility = PokerSeatOverlay.visibilityForMode(selectedMode);
    var detailsPanel = document.getElementById(detailsRootId);
    var layer = document.getElementById(overlayRootId);
    console.log(label, {
      selectedMode: visibility.mode,
      storedValue: storedValue,
      previousMode: previousMode,
      overlaysExpectedVisible: visibility.overlaysVisible,
      detailsExpectedVisible: visibility.detailsVisible,
      overlaysActual: {
        layerAttached: Boolean(layer && layer.isConnected),
        computedDisplay: layer ? getComputedStyle(layer).display : 'not-created',
        overlayCount: layer ? layer.querySelectorAll('.pnhud-seat-overlay').length : 0
      },
      detailsActual: {
        attached: Boolean(detailsPanel && detailsPanel.isConnected),
        computedDisplay: detailsPanel ? getComputedStyle(detailsPanel).display : 'not-created'
      }
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function registerTooltipPlayer(playerId, playerName, stats, scope) {
    var key = String(scope || currentStatsScope) + '|' + String(playerId || ('name:' + playerName));
    tooltipStatsByPlayerKey.set(key, { playerId: playerId || null, playerName: playerName, stats: stats });
    return key;
  }

  function statTooltipTargetHtml(definition, displayedValue, playerKey, scope, tagName) {
    tagName = tagName || 'span';
    var playerAttribute = playerKey ? ' data-pnhud-player-key="' + escapeHtml(playerKey) + '"' : '';
    return '<' + tagName + ' class="pnhud-stat-tooltip-target" tabindex="0" data-pnhud-interactive="true" data-pnhud-stat-id="' + escapeHtml(definition.id) + '"' +
      playerAttribute + ' data-pnhud-scope="' + escapeHtml(scope || currentStatsScope) + '" data-pnhud-displayed-value="' + escapeHtml(displayedValue) + '">' +
      escapeHtml(displayedValue) + '</' + tagName + '>';
  }

  function tooltipRowsHtml(items, className) {
    if (!items || !items.length) return '';
    return '<dl class="' + className + '">' + items.map(function (item) {
      return '<div><dt>' + escapeHtml(item.label) + '</dt><dd>' + escapeHtml(item.value) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function statTooltipModelHtml(model) {
    var heading = model.playerName ? escapeHtml(model.playerName) + ' \u2014 ' + escapeHtml(model.label) : escapeHtml(model.label);
    var subtitle = model.fullName && model.fullName !== model.label ? '<span>' + escapeHtml(model.fullName) + '</span>' : '';
    var scope = model.scope ? '<p class="pnhud-tooltip-scope">' + escapeHtml(model.scope) + '</p>' : '';
    var formula = model.formulaLabel ? '<section><h4>Formula</h4><p>' + escapeHtml(model.formulaLabel) + '</p>' + (model.calculation ? '<p class="pnhud-tooltip-calculation">' + escapeHtml(model.calculation) + '</p>' : '') + '</section>' : '';
    var displayed = model.displayedValue !== undefined && model.displayedValue !== null ? '<p class="pnhud-tooltip-displayed">Displayed: ' + escapeHtml(model.displayedValue) + '</p>' : '';
    var summary = model.summary ? '<p class="pnhud-tooltip-summary">' + escapeHtml(model.summary) + '</p>' : '';
    var counts = tooltipRowsHtml(model.displayRows || [model.numerator, model.denominator].filter(Boolean).concat(model.components || []), 'pnhud-tooltip-counts');
    var exclusions = tooltipRowsHtml(model.exclusions || [], 'pnhud-tooltip-exclusions');
    var notes = (model.eligibilityNotes || []).concat(model.notes || []).map(function (note) { return '<li>' + escapeHtml(note) + '</li>'; }).join('');
    return '<div class="pnhud-tooltip-heading"><strong>' + heading + '</strong>' + subtitle + '</div>' + scope +
      (model.description ? '<p>' + escapeHtml(model.description) + '</p>' : '') + summary + formula + displayed + counts + exclusions +
      (model.specialValueNote ? '<p class="pnhud-tooltip-special">' + escapeHtml(model.specialValueNote) + '</p>' : '') +
      (notes ? '<ul class="pnhud-tooltip-notes">' + notes + '</ul>' : '');
  }

  function ensureStatTooltipUi() {
    if (!statTooltipElement || !statTooltipElement.isConnected) {
      statTooltipElement = document.createElement('div');
      statTooltipElement.id = statTooltipId;
      statTooltipElement.className = 'pnhud-stat-tooltip';
      statTooltipElement.setAttribute('role', 'tooltip');
      statTooltipElement.hidden = true;
      (document.body || document.documentElement).appendChild(statTooltipElement);
      statTooltipUiDiagnostics.tooltipElementCreated = true;
    }
    var definitions = Object.keys(PokerOverlayStats.STAT_CATALOG).map(function (id) { return PokerOverlayStats.STAT_CATALOG[id]; });
    statTooltipUiDiagnostics.registryStatsWithExplanations = definitions.filter(function (definition) { return definition.explanation; }).map(function (definition) { return definition.id; });
    statTooltipUiDiagnostics.registryStatsMissingExplanations = definitions.filter(function (definition) { return !definition.explanation; }).map(function (definition) { return definition.id; });
    if (statTooltipListenersInstalled) {
      statTooltipUiDiagnostics.duplicateListenerPreventions += 1;
      return statTooltipElement;
    }
    statTooltipListenersInstalled = true;
    document.addEventListener('pointerover', handleStatTooltipPointerOver, true);
    document.addEventListener('pointerout', handleStatTooltipPointerOut, true);
    document.addEventListener('focusin', handleStatTooltipFocusIn, true);
    document.addEventListener('focusout', handleStatTooltipFocusOut, true);
    return statTooltipElement;
  }

  function openStatTooltip(target) {
    if (!target || !target.isConnected) return;
    clearTimeout(statTooltipCloseTimer);
    if (target.classList.contains('pnhud-profile-tooltip-target')) {
      var profileScores = {};
      try { profileScores = JSON.parse(target.dataset.pnhudProfileScores || '{}'); } catch (_profileScoresError) { profileScores = {}; }
      var tooltipProfile = { visible: true, archetype: target.dataset.pnhudProfileArchetype, rawArchetype: target.dataset.pnhudProfileRawArchetype, rawScores: profileScores };
      var profile = PokerSeatOverlay.visibleProfilePresentation(tooltipProfile, true);
      if (!profile) return;
      ensureStatTooltipUi();
      if (activeStatTooltipTarget && activeStatTooltipTarget !== target) activeStatTooltipTarget.removeAttribute('aria-describedby');
      activeStatTooltipTarget = target;
      target.setAttribute('aria-describedby', statTooltipElement.id);
      statTooltipElement.innerHTML = PokerSeatOverlay.profileTooltipHtml(tooltipProfile, true, target.dataset.pnhudProfileSource, target.dataset.pnhudSeatStatSource);
      statTooltipElement.hidden = false;
      statTooltipUiDiagnostics.tooltipVisible = true;
      statTooltipUiDiagnostics.activeStatId = 'player-profile:' + profile.label;
      statTooltipUiDiagnostics.activePlayerId = target.closest('.pnhud-seat-overlay') && target.closest('.pnhud-seat-overlay').dataset.pnhudPlayerId || null;
      statTooltipUiDiagnostics.activeScope = null;
      statTooltipUiDiagnostics.openCount += 1;
      var profileAnchor = target.getBoundingClientRect();
      var profileTooltipRect = statTooltipElement.getBoundingClientRect();
      var profilePlacement = PokerStatTooltip.choosePlacement(profileAnchor, profileTooltipRect, leaderboardViewport(), 8);
      statTooltipElement.style.left = profilePlacement.left + 'px';
      statTooltipElement.style.top = profilePlacement.top + 'px';
      statTooltipElement.dataset.placement = profilePlacement.kind;
      return;
    }
    var definition = PokerOverlayStats.STAT_CATALOG[target.dataset.pnhudStatId];
    if (!definition || !definition.explanation) return;
    var playerRecord = target.dataset.pnhudPlayerKey ? tooltipStatsByPlayerKey.get(target.dataset.pnhudPlayerKey) : null;
    var scope = target.dataset.pnhudScope === 'career' ? 'Career' : target.dataset.pnhudScope === 'allTime' ? 'Session' : 'Session';
    var model = PokerStatTooltip.buildModel(definition, playerRecord && playerRecord.stats, {
      playerName: playerRecord && playerRecord.playerName,
      playerId: playerRecord && playerRecord.playerId,
      scope: playerRecord ? scope : null,
      displayedValue: playerRecord ? target.dataset.pnhudDisplayedValue : undefined
    });
    ensureStatTooltipUi();
    if (activeStatTooltipTarget && activeStatTooltipTarget !== target) activeStatTooltipTarget.removeAttribute('aria-describedby');
    activeStatTooltipTarget = target;
    target.setAttribute('aria-describedby', statTooltipElement.id);
    statTooltipElement.innerHTML = statTooltipModelHtml(model);
    statTooltipElement.hidden = false;
    statTooltipUiDiagnostics.tooltipVisible = true;
    statTooltipUiDiagnostics.activeStatId = definition.id;
    statTooltipUiDiagnostics.activePlayerId = playerRecord && playerRecord.playerId || null;
    statTooltipUiDiagnostics.activeScope = playerRecord ? scope : null;
    statTooltipUiDiagnostics.openCount += 1;
    var anchor = target.getBoundingClientRect();
    var tooltipRect = statTooltipElement.getBoundingClientRect();
    var placement = PokerStatTooltip.choosePlacement(anchor, tooltipRect, leaderboardViewport(), 8);
    statTooltipElement.style.left = placement.left + 'px';
    statTooltipElement.style.top = placement.top + 'px';
    statTooltipElement.dataset.placement = placement.kind;
  }

  function closeStatTooltip(reason) {
    clearTimeout(statTooltipCloseTimer);
    if (activeStatTooltipTarget) activeStatTooltipTarget.removeAttribute('aria-describedby');
    activeStatTooltipTarget = null;
    if (statTooltipElement && !statTooltipElement.hidden) {
      statTooltipElement.hidden = true;
      statTooltipUiDiagnostics.closeCount += 1;
    }
    statTooltipUiDiagnostics.tooltipVisible = false;
    statTooltipUiDiagnostics.activeStatId = null;
    statTooltipUiDiagnostics.activePlayerId = null;
    statTooltipUiDiagnostics.activeScope = null;
    statTooltipUiDiagnostics.lastCloseReason = reason || 'unknown';
  }

  function scheduleStatTooltipClose(reason) {
    clearTimeout(statTooltipCloseTimer);
    statTooltipCloseTimer = setTimeout(function () { closeStatTooltip(reason); }, 100);
  }

  function handleStatTooltipPointerOver(event) {
    var target = event.target.closest && event.target.closest('.pnhud-stat-tooltip-target, .pnhud-profile-tooltip-target');
    if (target) openStatTooltip(target);
  }

  function handleStatTooltipPointerOut(event) {
    var target = event.target.closest && event.target.closest('.pnhud-stat-tooltip-target, .pnhud-profile-tooltip-target');
    if (target && (!event.relatedTarget || !target.contains(event.relatedTarget))) scheduleStatTooltipClose('pointer-left-target');
  }

  function handleStatTooltipFocusIn(event) {
    var target = event.target.closest && event.target.closest('.pnhud-stat-tooltip-target, .pnhud-profile-tooltip-target');
    if (target) openStatTooltip(target);
  }

  function handleStatTooltipFocusOut(event) {
    var target = event.target.closest && event.target.closest('.pnhud-stat-tooltip-target, .pnhud-profile-tooltip-target');
    if (target) scheduleStatTooltipClose('focus-left-target');
  }

  function seatOverlayContent(entry) {
    var threeBetDefinition = PokerOverlayStats.STAT_CATALOG.threeBet;
    var foldToThreeBetDefinition = PokerOverlayStats.STAT_CATALOG.foldToThreeBet;
    var flopCBetDefinition = PokerOverlayStats.STAT_CATALOG.flopCBet;
    var foldToFlopCBetDefinition = PokerOverlayStats.STAT_CATALOG.foldToFlopCBet;
    preflopDebug('hud-render', {
      playerId: entry.playerId || null,
      playerName: entry.name || null,
      lookupKind: 'confirmed seat mapping name over authoritative liveEvents',
      rawCounters: preflopCounterFields(entry.stats),
      formattedThreeBet: threeBetDefinition.formatValue(threeBetDefinition.getValue(entry.stats)),
      formattedFoldToThreeBet: foldToThreeBetDefinition.formatValue(foldToThreeBetDefinition.getValue(entry.stats)),
      formattedFlopCBet: flopCBetDefinition.formatValue(flopCBetDefinition.getValue(entry.stats)),
      formattedFoldToFlopCBet: foldToFlopCBetDefinition.formatValue(foldToFlopCBetDefinition.getValue(entry.stats))
    });
    var grip = '<button type="button" class="pnhud-overlay-grip" aria-label="Drag ' + escapeHtml(entry.name) + ' statistics overlay" title="Drag overlay"><span aria-hidden="true"></span></button>';
    var playerName = '<button type="button" class="pnhud-player-name" data-pnhud-interactive="true" data-pnhud-player-id="' + escapeHtml(entry.playerId) + '" title="Open player dashboard">' + escapeHtml(entry.name) + '</button>';
    var identity = debugSeatIdentity ? '<span class="pnhud-seat-identity">[' + escapeHtml(String(entry.playerId || '').slice(0, 4)) + ']</span><span class="pnhud-seat-separator">&middot;</span>' : '';
    var profileChip = PokerSeatOverlay.profileChipHtml(entry.displayedProfile, entry.showPlayerProfiles, entry.profileStatSource, entry.statSource);
    var playerKey = registerTooltipPlayer(entry.playerId, entry.name, entry.stats, entry.statSource);
    var statRows = PokerSeatOverlay.compactStatRows(entry.stats, entry.displayedStatIds, entry.opportunityStatsLayout).map(function (row) {
      var segments = row.map(function (item) {
        return '<span class="pnhud-seat-stat-segment">' + statTooltipTargetHtml(item.definition, item.label, playerKey, entry.statSource) + '</span>';
      });
      return '<span class="pnhud-seat-stat-row">' + segments.join('<span class="pnhud-seat-separator">|</span>') + '</span>';
    });
    return grip + playerName + identity + profileChip + (statRows.length ? '<span class="pnhud-seat-stats">' + statRows.join('') + '</span>' : '');
  }

  function seatOverlayHasVisibleContent(entry) {
    return Boolean(entry && entry.name);
  }

  function seatOverlayAriaLabel(entry) {
    var profile = PokerSeatOverlay.visibleProfilePresentation(entry.displayedProfile, entry.showPlayerProfiles);
    var source = currentSeatHudStatSource() === 'career' ? 'Career' : 'Session';
    return entry.name + ' \u00b7 ' + source + ' finalized statistics' + (profile ? ' \u00b7 ' + profile.label + ' Session player profile' : '');
  }

  function explainPlayerProfile(playerId) {
    var record = PokerPlayerProfileShadowStore.get(playerProfileShadowState, playerId);
    var displayed = PokerPlayerProfileShadowStore.displayedProfile(playerProfileShadowState, playerId);
    if (!record && !displayed) return null;
    return PokerPlayerProfileExplanation.explain({
      record: record || {},
      presentation: displayed || {},
      decomposition: PokerPlayerProfileShadowStore.scoreDecomposition(playerProfileShadowState, playerId)
    });
  }

  function playerDashboardProfile(playerId) {
    var record = PokerPlayerProfileShadowStore.get(playerProfileShadowState, playerId);
    var displayed = PokerPlayerProfileShadowStore.displayedProfile(playerProfileShadowState, playerId);
    if (!record && !displayed) return null;
    return {
      displayedArchetype: displayed && displayed.visible === true ? displayed.archetype : null,
      rawArchetype: displayed && displayed.rawArchetype || record && record.primary && record.primary.archetype || null,
      rawScores: displayed && displayed.rawScores || record && record.primary && record.primary.scores || {},
      hands: record && record.hands || displayed && displayed.rawHands || 0,
      explanation: explainPlayerProfile(playerId)
    };
  }

  function ensurePlayerDashboard() {
    if (playerDashboardElement && playerDashboardElement.isConnected) return playerDashboardElement;
    if (playerDashboardGeometryController) playerDashboardGeometryController.dispose();
    playerDashboardElement = document.getElementById(playerDashboardId);
    if (!playerDashboardElement) {
      playerDashboardElement = document.createElement('section');
      playerDashboardElement.id = playerDashboardId;
      playerDashboardElement.hidden = true;
      playerDashboardElement.setAttribute('role', 'dialog');
      playerDashboardElement.setAttribute('aria-modal', 'false');
      playerDashboardElement.setAttribute('aria-label', 'Player Dashboard');
      playerDashboardElement.dataset.pnhudOwned = 'true';
      (document.body || document.documentElement).appendChild(playerDashboardElement);
      playerDashboardElement.addEventListener('click', handlePlayerDashboardClick);
      playerDashboardElement.addEventListener('input', handlePlayerDashboardInput);
      applyHudUiAppearance();
    }
    playerDashboardGeometryController = PokerPlayerDashboard.createGeometryController(playerDashboardElement, window, playerDashboardGeometry);
    return playerDashboardElement;
  }

  function renderPlayerDashboard(preferredFocus) {
    if (!ownsRuntimeController()) return;
    var panel = ensurePlayerDashboard();
    panel.hidden = !playerDashboardState.open;
    panel.setAttribute('aria-hidden', playerDashboardState.open ? 'false' : 'true');
    if (!playerDashboardState.open) return;
    panel.innerHTML = PokerPlayerDashboard.render(playerDashboardState);
    if (playerDashboardGeometryController) playerDashboardGeometryController.sync();
    var target = preferredFocus && panel.querySelector(preferredFocus);
    if (target && target.focus) target.focus();
  }

  function refreshPlayerDashboardSession() {
    if (!playerDashboardState.playerId) return;
    var name = socketPlayerNames.get(playerDashboardState.playerId) || playerDashboardState.displayName;
    playerDashboardState.displayName = name || playerDashboardState.displayName || 'Tracked player';
    playerDashboardState.sessionStats = cachedSessionPlayerStats(playerDashboardState.playerId, playerDashboardState.displayName);
    playerDashboardState.selfPlayerId = localUserPlayerId;
    playerDashboardState.coreStats = cachedSessionFilteredStats(playerDashboardState.playerId, dashboardScopeFilters());
    playerDashboardState.relationalStats = dashboardRelationalQueries(function (filters) {
      return cachedSessionFilteredStats(playerDashboardState.playerId, filters);
    });
    playerDashboardState.profile = playerDashboardProfile(playerDashboardState.playerId);
  }

  function dashboardScopeFilters() {
    if (playerDashboardState.situation === 'ip' || playerDashboardState.situation === 'oop') return { situation: playerDashboardState.situation };
    return playerDashboardState.position ? { position: playerDashboardState.position } : {};
  }

  function dashboardRelationalFilters(statId) {
    var filters = Object.assign({ statId: statId }, dashboardScopeFilters());
    if (playerDashboardState.opponentMode === 'self' || playerDashboardState.opponentMode === 'others') {
      filters.counterpartMode = playerDashboardState.opponentMode;
      filters.selfPlayerId = localUserPlayerId;
    }
    return filters;
  }

  function dashboardRelationalQueries(query) {
    if (playerDashboardState.opponentMode === 'overall') return {};
    return {
      threeBet: query(dashboardRelationalFilters('threeBet')),
      foldToThreeBet: query(dashboardRelationalFilters('foldToThreeBet')),
      foldToFlopCBet: query(dashboardRelationalFilters('foldToFlopCBet'))
    };
  }

  function loadPlayerDashboardCareer(revisionRetry) {
    var playerId = playerDashboardState.playerId;
    var token = ++playerDashboardState.requestToken;
    var position = playerDashboardState.position;
    var situation = playerDashboardState.situation || 'overall';
    var opponentMode = playerDashboardState.opponentMode;
    var requestSnapshot = { playerId: playerId, mode: 'career', position: position, situation: situation, opponentMode: opponentMode, requestToken: token };
    playerDashboardState.loading = true;
    playerDashboardState.profile = null;
    playerDashboardState.error = null;
    playerDashboardState.careerStats = null;
    playerDashboardState.coreStats = null;
    playerDashboardState.relationalStats = {};
    playerDashboardState.trends = null;
    playerDashboardState.trendError = null;
    playerDashboardState.selfPlayerId = localUserPlayerId;
    renderPlayerDashboard();
    if (!careerIndexedService) {
      playerDashboardState.loading = false;
      playerDashboardState.error = 'Career statistics are unavailable.';
      return renderPlayerDashboard();
    }
    var dashboardRequest = careerIndexedService.careerDashboardStats(playerId, {
      position: position,
      situation: situation,
      opponentMode: opponentMode,
      selfPlayerId: localUserPlayerId
    });
    var trendRequest = typeof careerIndexedService.careerTrendStats === 'function'
      ? careerIndexedService.careerTrendStats(playerId).then(function (value) { return { value: value, error: null }; }, function () { return { value: null, error: 'Recent trends could not be loaded.' }; })
      : Promise.resolve({ value: null, error: 'Recent trends are unavailable.' });
    Promise.all([dashboardRequest, trendRequest]).then(function (values) {
      var result = values[0]; var trendResult = values[1];
      if (!PokerPlayerDashboard.requestMatches(playerDashboardState, requestSnapshot)) return;
      if (trendResult.value && !PokerPlayerDashboard.careerRevisionsMatch(result, trendResult.value)) {
        if (!revisionRetry) return loadPlayerDashboardCareer(true);
        playerDashboardState.loading = false;
        playerDashboardState.error = 'Career statistics changed while loading. Please try again.';
        playerDashboardState.trends = null;
        playerDashboardState.trendError = null;
        return renderPlayerDashboard('[data-dashboard-mode="career"]');
      }
      playerDashboardState.profile = result.profileStats && String(result.profileStats.playerId) === playerId ? PokerPlayerDashboard.careerProfile(result.profileStats, PokerPlayerProfileClassifier, PokerPlayerProfilePresentation, PokerPlayerProfileExplanation) : null;
      playerDashboardState.coreStats = result.core;
      playerDashboardState.careerStats = result.core;
      playerDashboardState.careerTrackingStartedAt = result.careerTrackingStartedAt || null;
      playerDashboardState.relationalStats = result.relational || {};
      playerDashboardState.trends = trendResult.value;
      playerDashboardState.trendError = trendResult.error;
      playerDashboardState.trendWindow = PokerPlayerDashboard.selectTrendWindow(trendResult.value, playerDashboardState.trendWindow);
      playerDashboardState.loading = false;
      playerDashboardState.error = null;
      renderPlayerDashboard('[data-dashboard-mode="career"]');
    }).catch(function () {
      if (!PokerPlayerDashboard.requestMatches(playerDashboardState, requestSnapshot)) return;
      playerDashboardState.loading = false;
      playerDashboardState.error = 'Career statistics could not be loaded.';
      renderPlayerDashboard('[data-dashboard-mode="career"]');
    });
  }

  function openPlayerDashboard(playerId, displayName, returnFocus) {
    var canonicalId = PokerPlayerNotesStore.stableId(playerId);
    if (!canonicalId) return;
    closeStatTooltip('player-dashboard-open');
    playerDashboardState.open = true;
    playerDashboardState.playerId = canonicalId;
    playerDashboardState.displayName = String(displayName || socketPlayerNames.get(canonicalId) || 'Tracked player');
    playerDashboardState.returnFocus = returnFocus || document.activeElement;
    playerDashboardState.note = PokerPlayerNotesStore.get(playerNotesState, canonicalId);
    playerDashboardState.noteDraft = playerDashboardState.note;
    playerDashboardState.noteStatus = '';
    playerDashboardState.position = null;
    playerDashboardState.overallPosition = null;
    playerDashboardState.situation = 'overall';
    playerDashboardState.opponentMode = 'overall';
    playerDashboardState.selfPlayerId = localUserPlayerId;
    playerDashboardState.coreStats = null;
    playerDashboardState.relationalStats = {};
    playerDashboardState.careerStats = null;
    playerDashboardState.careerTrackingStartedAt = null;
    playerDashboardState.trends = null;
    playerDashboardState.trendWindow = null;
    playerDashboardState.trendError = null;
    playerDashboardState.error = null;
    refreshPlayerDashboardSession();
    playerDashboardState.mode = playerDashboardState.sessionStats && playerDashboardState.sessionStats.handsPlayed > 0 ? 'session' : 'career';
    renderPlayerDashboard('.pnhud-dashboard-close');
    if (playerDashboardState.mode === 'career') loadPlayerDashboardCareer();
  }

  function closePlayerDashboard() {
    if (!playerDashboardState.open) return;
    if (playerDashboardGeometryController) playerDashboardGeometryController.cancel();
    playerDashboardState.open = false;
    playerDashboardState.requestToken += 1;
    renderPlayerDashboard();
    var focusTarget = playerDashboardState.returnFocus;
    playerDashboardState.returnFocus = null;
    if (focusTarget && focusTarget.isConnected && focusTarget.focus) focusTarget.focus();
  }

  function resetPlayerDashboardPosition() {
    playerDashboardGeometry.positionCustomized = false;
    if (playerDashboardGeometryController) playerDashboardGeometryController.resetPosition();
    return true;
  }

  function ensureTrackedPlayers() {
    var host = settingsPanel && settingsPanel.querySelector('.pnhud-players-host');
    if (!host) return null;
    if (!trackedPlayersElement) {
      trackedPlayersElement = document.createElement('section');
      trackedPlayersElement.id = trackedPlayersPanelId;
      trackedPlayersElement.hidden = true;
      trackedPlayersElement.setAttribute('role', 'region');
      trackedPlayersElement.setAttribute('aria-label', 'Tracked Players');
      trackedPlayersElement.dataset.pnhudOwned = 'true';
      trackedPlayersElement.setAttribute('data-pnhud-owned', 'true');

    }
    if (trackedPlayersElement.parentNode !== host) host.appendChild(trackedPlayersElement);
    if (trackedPlayersElement.dataset.pnhudTrackedPlayersBound !== 'true') {
      trackedPlayersElement.dataset.pnhudTrackedPlayersBound = 'true';
      trackedPlayersElement.addEventListener('click', handleTrackedPlayersClick);
      trackedPlayersElement.addEventListener('input', handleTrackedPlayersInput);
      trackedPlayersElement.addEventListener('change', handleTrackedPlayersChange);
    }
    applyHudUiAppearance();
    return trackedPlayersElement;
  }

  function renderTrackedPlayers(preferredFocus, selection) {
    if (!ownsRuntimeController()) return;
    var panel = ensureTrackedPlayers();
    if (!panel) return;
    panel.hidden = !trackedPlayersState.open;
    panel.setAttribute('aria-hidden', trackedPlayersState.open ? 'false' : 'true');
    if (!trackedPlayersState.open) return;
    trackedPlayersState.renders += 1;
    panel.innerHTML = PokerTrackedPlayers.render(trackedPlayersState);
    var target = preferredFocus && panel.querySelector(preferredFocus);
    if (target && target.focus) {
      target.focus();
      if (selection && target.setSelectionRange) target.setSelectionRange(selection.start, selection.end);
    }
  }

  function requestTrackedPlayerSummaries() {
    if (!trackedPlayersState.open) return Promise.resolve(false);
    var token = ++trackedPlayersState.requestToken;
    trackedPlayersState.loading = true;
    trackedPlayersState.error = null;
    renderTrackedPlayers();
    if (!careerIndexedService || typeof careerIndexedService.careerPlayerSummaries !== 'function') {
      trackedPlayersState.loading = false;
      trackedPlayersState.error = 'Career summaries are unavailable in this browser session.';
      renderTrackedPlayers();
      return Promise.resolve(false);
    }
    trackedPlayersState.backendRequests += 1;
    return careerIndexedService.careerPlayerSummaries().then(function (rows) {
      if (!trackedPlayersState.open || extensionCleanedUp || token !== trackedPlayersState.requestToken) return false;
      trackedPlayersState.summaries = PokerTrackedPlayers.normalizeSummaries(rows);
      trackedPlayersState.loading = false;
      trackedPlayersState.error = null;
      renderTrackedPlayers();
      return true;
    }).catch(function () {
      if (!trackedPlayersState.open || extensionCleanedUp || token !== trackedPlayersState.requestToken) return false;
      trackedPlayersState.loading = false;
      trackedPlayersState.error = 'Career player summaries could not be loaded. Try again.';
      renderTrackedPlayers();
      return false;
    });
  }

  function closeTrackedPlayers() {
    if (!trackedPlayersState.open) return false;
    trackedPlayersState.open = false;
    trackedPlayersState.loading = false;
    trackedPlayersState.requestToken += 1;
    return true;
  }

  function invalidateTrackedPlayers(playerIds, reason, clearSettledPresentation) {
    if (clearSettledPresentation) trackedPlayersState.summaries = [];
    if (!trackedPlayersState.open) return false;
    requestTrackedPlayerSummaries();
    return true;
  }

  function handleTrackedPlayersClick(event) {
    if (event.target.closest && event.target.closest('.pnhud-tracked-players-retry')) return requestTrackedPlayerSummaries();
    var row = event.target.closest && event.target.closest('.pnhud-tracked-player-row');
    if (!row) return;
    openPlayerDashboard(row.dataset.trackedPlayerId, row.dataset.trackedPlayerName, row);
  }

  function handleTrackedPlayersInput(event) {
    if (!event.target.classList.contains('pnhud-tracked-players-search')) return;
    trackedPlayersState.search = event.target.value;
    renderTrackedPlayers('.pnhud-tracked-players-search', {
      start: Number.isInteger(event.target.selectionStart) ? event.target.selectionStart : String(event.target.value).length,
      end: Number.isInteger(event.target.selectionEnd) ? event.target.selectionEnd : String(event.target.value).length
    });
  }

  function handleTrackedPlayersChange(event) {
    if (!event.target.classList.contains('pnhud-tracked-players-sort')) return;
    trackedPlayersState.sort = PokerTrackedPlayers.SORT_OPTIONS.indexOf(event.target.value) >= 0 ? event.target.value : PokerTrackedPlayers.SORT_RECENT;
    renderTrackedPlayers('.pnhud-tracked-players-sort');
  }

  function savePlayerDashboardNote() {
    var panel = ensurePlayerDashboard(); var input = panel.querySelector('.pnhud-dashboard-note');
    if (!input || !playerDashboardState.playerId) return;
    var next;
    try {
      next = PokerPlayerNotesStore.set(playerNotesState, playerDashboardState.playerId, input.value);
    } catch (error) {
      playerDashboardState.noteStatus = error && error.code === 'PLAYER_NOTES_CAPACITY'
        ? 'Note limit reached (500). Clear an existing note before adding another.'
        : 'Note could not be saved.';
      renderPlayerDashboard('.pnhud-dashboard-note');
      return;
    }
    var update = {}; update[STORAGE_KEYS.playerNotes] = next;
    chrome.storage.local.set(update, function () {
      if (chrome.runtime && chrome.runtime.lastError) {
        playerDashboardState.noteStatus = 'Note could not be saved.';
      } else {
        playerNotesState = next;
        playerDashboardState.note = PokerPlayerNotesStore.get(next, playerDashboardState.playerId);
        playerDashboardState.noteDraft = playerDashboardState.note;
        playerDashboardState.noteStatus = 'Saved.';
      }
      renderPlayerDashboard('.pnhud-dashboard-note');
    });
  }

  function clearPlayerDashboardNote() {
    if (!playerDashboardState.playerId || (!playerDashboardState.note && !playerDashboardState.noteDraft)) return;
    var next = PokerPlayerNotesStore.clear(playerNotesState, playerDashboardState.playerId);
    var update = {}; update[STORAGE_KEYS.playerNotes] = next;
    chrome.storage.local.set(update, function () {
      if (chrome.runtime && chrome.runtime.lastError) playerDashboardState.noteStatus = 'Note could not be cleared.';
      else {
        playerNotesState = next;
        playerDashboardState.note = '';
        playerDashboardState.noteDraft = '';
        playerDashboardState.noteStatus = 'Note cleared.';
      }
      renderPlayerDashboard('.pnhud-dashboard-note');
    });
  }

  function handlePlayerDashboardClick(event) {
    if (event.target.closest('.pnhud-dashboard-close')) return closePlayerDashboard();
    var modeButton = event.target.closest('[data-dashboard-mode]');
    if (modeButton) {
      var nextMode = modeButton.dataset.dashboardMode === 'career' ? 'career' : 'session';
      if (nextMode === playerDashboardState.mode) return;
      playerDashboardState.mode = nextMode;
      playerDashboardState.error = null;
      if (nextMode === 'session') { playerDashboardState.requestToken += 1; playerDashboardState.loading = false; refreshPlayerDashboardSession(); renderPlayerDashboard('[data-dashboard-mode="session"]'); }
      else loadPlayerDashboardCareer();
      return;
    }
    var trendButton = event.target.closest('[data-dashboard-trend-window]');
    if (trendButton && !trendButton.disabled) {
      var nextTrendWindow = Number(trendButton.dataset.dashboardTrendWindow);
      if (!playerDashboardState.trends || playerDashboardState.trends.availableWindows.indexOf(nextTrendWindow) < 0 || nextTrendWindow === playerDashboardState.trendWindow) return;
      playerDashboardState.trendWindow = nextTrendWindow;
      renderPlayerDashboard('[data-dashboard-trend-window="' + nextTrendWindow + '"]');
      return;
    }
    var opponentButton = event.target.closest('[data-dashboard-opponent]');
    if (opponentButton && !opponentButton.disabled) {
      var nextOpponent = ['self', 'others'].includes(opponentButton.dataset.dashboardOpponent) ? opponentButton.dataset.dashboardOpponent : 'overall';
      if (nextOpponent === playerDashboardState.opponentMode) return;
      playerDashboardState.opponentMode = nextOpponent;
      playerDashboardState.error = null;
      if (playerDashboardState.mode === 'career') loadPlayerDashboardCareer();
      else { refreshPlayerDashboardSession(); renderPlayerDashboard('[data-dashboard-opponent="' + nextOpponent + '"]'); }
      return;
    }
    if (event.target.closest('.pnhud-dashboard-save-note')) return savePlayerDashboardNote();
    if (event.target.closest('.pnhud-dashboard-clear-note')) return clearPlayerDashboardNote();
  }

  function handlePlayerDashboardInput(event) {
    if (event.target.matches('[data-dashboard-situation]')) {
      var situation = PokerPlayerDashboard.SITUATION_OPTIONS.some(function (option) { return option.value === event.target.value; }) ? event.target.value : 'overall';
      if (situation === playerDashboardState.situation) return;
      if (situation === 'overall') {
        playerDashboardState.position = playerDashboardState.overallPosition || null;
        playerDashboardState.overallPosition = null;
      } else if (playerDashboardState.situation === 'overall') {
        playerDashboardState.overallPosition = playerDashboardState.position;
        playerDashboardState.position = null;
      }
      playerDashboardState.situation = situation;
      playerDashboardState.error = null;
      if (playerDashboardState.mode === 'career') loadPlayerDashboardCareer();
      else { refreshPlayerDashboardSession(); renderPlayerDashboard('[data-dashboard-situation]'); }
      return;
    }
    if (event.target.matches('[data-dashboard-position]')) {
      if (playerDashboardState.situation !== 'overall') return;
      var position = PokerPlayerDashboard.POSITION_OPTIONS.includes(event.target.value) ? event.target.value : null;
      if (position === playerDashboardState.position) return;
      playerDashboardState.position = position;
      playerDashboardState.error = null;
      if (playerDashboardState.mode === 'career') loadPlayerDashboardCareer();
      else { refreshPlayerDashboardSession(); renderPlayerDashboard('[data-dashboard-position]'); }
      return;
    }
    if (!event.target.classList.contains('pnhud-dashboard-note')) return;
    playerDashboardState.noteDraft = event.target.value;
    playerDashboardState.noteStatus = event.target.value === playerDashboardState.note ? '' : 'Unsaved changes';
    var status = playerDashboardElement.querySelector('.pnhud-dashboard-note-status');
    if (status) status.textContent = playerDashboardState.noteStatus;
  }

  function overlayStatItemHtml(definition, displayed, index, count) {
    var controls = displayed
      ? '<span class="pnhud-stat-item-actions"><button type="button" data-stat-action="move-up" aria-label="Move ' + escapeHtml(definition.label) + ' left"' + (index === 0 ? ' disabled' : '') + '>&larr;</button><button type="button" data-stat-action="move-down" aria-label="Move ' + escapeHtml(definition.label) + ' right"' + (index === count - 1 ? ' disabled' : '') + '>&rarr;</button><button type="button" data-stat-action="disable" aria-label="Remove ' + escapeHtml(definition.label) + ' from overlay">Remove</button></span>'
      : '<span class="pnhud-stat-item-actions"><button type="button" data-stat-action="enable" aria-label="Add ' + escapeHtml(definition.label) + ' to overlay">Add</button></span>';
    return '<li class="pnhud-stat-item" draggable="true" data-stat-id="' + escapeHtml(definition.id) + '" data-stat-list="' + (displayed ? 'displayed' : 'available') + '"><span class="pnhud-stat-drag" aria-hidden="true">\u2630</span><span class="pnhud-stat-item-label">' + escapeHtml(definition.label) + '<small>' + escapeHtml(definition.category || 'Other') + '</small></span>' + controls + '</li>';
  }

  function overlayStatCustomizerHtml() {
    var displayed = PokerOverlayStats.customizableDefinitionsFor(displayedStatIds);
    var available = PokerOverlayStats.availableDefinitions(displayedStatIds);
    var groups = PokerOverlayStats.groupByCategory(available);
    var preview = PokerOverlayStats.formatOverlay({ handsPlayed: 42, vpip: 27, pfr: 19, af: 2.3, threeBetMade: 2, threeBetOpportunities: 25, foldToThreeBet: 3, foldToThreeBetOpportunities: 6, flopCBetMade: 8, flopCBetOpportunities: 13, foldToFlopCBet: 4, foldToFlopCBetOpportunities: 9 }, displayedStatIds);
    var availableHtml = Object.keys(groups).map(function (category) {
      return '<div class="pnhud-stat-category"><h4>' + escapeHtml(category) + '</h4><ul>' + groups[category].map(function (definition, index) {
        return overlayStatItemHtml(definition, false, index, groups[category].length);
      }).join('') + '</ul></div>';
    }).join('');
    return '<details class="pnhud-stat-customizer"' + (overlayCustomizerOpen ? ' open' : '') + '><summary>Customize overlay</summary><div class="pnhud-stat-customizer-body">' +
      '<p>Displaying ' + displayed.length + ' ' + (displayed.length === 1 ? 'statistic' : 'statistics') + '. Fewer statistics produce a more compact overlay.</p>' +
      '<div class="pnhud-stat-preview"><span>Live preview</span><output>' + (preview ? escapeHtml(preview) : 'No statistics selected') + '</output></div>' +
      '<div class="pnhud-stat-lists"><section><h3>Displayed statistics</h3><p>Drag to set the left-to-right order.</p><ul class="pnhud-stat-dropzone pnhud-stat-displayed" data-stat-dropzone="displayed">' +
      (displayed.length ? displayed.map(function (definition, index) { return overlayStatItemHtml(definition, true, index, displayed.length); }).join('') : '<li class="pnhud-stat-empty">No statistics selected</li>') +
      '</ul></section><section><h3>Available statistics</h3><p>Drag here to disable, or use Add.</p><div class="pnhud-stat-dropzone pnhud-stat-available" data-stat-dropzone="available">' +
      (availableHtml || '<p class="pnhud-stat-empty">All registered statistics are displayed.</p>') +
      '</div></section></div><button type="button" class="pnhud-stat-reset">Reset to defaults</button></div></details>';
  }

  function bindOverlayStatCustomizer(host) {
    var customizer = host.querySelector('.pnhud-stat-customizer');
    if (!customizer) return;
    customizer.addEventListener('toggle', function () { overlayCustomizerOpen = customizer.open; });
    var dragState = null;
    function clearInsertion() {
      host.querySelectorAll('.pnhud-stat-insert-before, .pnhud-stat-insert-after, .pnhud-stat-drop-active').forEach(function (element) {
        element.classList.remove('pnhud-stat-insert-before', 'pnhud-stat-insert-after', 'pnhud-stat-drop-active');
      });
    }
    customizer.addEventListener('dragstart', function (event) {
      var item = event.target.closest && event.target.closest('[data-stat-id]');
      if (!item) return;
      dragState = { id: item.dataset.statId, from: item.dataset.statList };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragState.id);
      item.classList.add('pnhud-stat-dragging');
    });
    customizer.addEventListener('dragend', function () {
      dragState = null;
      clearInsertion();
      customizer.querySelectorAll('.pnhud-stat-dragging').forEach(function (item) { item.classList.remove('pnhud-stat-dragging'); });
    });
    customizer.addEventListener('dragover', function (event) {
      var zone = event.target.closest && event.target.closest('[data-stat-dropzone]');
      if (!zone || !dragState) return;
      event.preventDefault();
      clearInsertion();
      zone.classList.add('pnhud-stat-drop-active');
      if (zone.dataset.statDropzone === 'displayed') {
        var target = event.target.closest('[data-stat-id]');
        if (target && target.dataset.statId !== dragState.id) {
          var rect = target.getBoundingClientRect();
          target.classList.add(event.clientY < rect.top + rect.height / 2 ? 'pnhud-stat-insert-before' : 'pnhud-stat-insert-after');
        }
      }
    });
    customizer.addEventListener('drop', function (event) {
      var zone = event.target.closest && event.target.closest('[data-stat-dropzone]');
      if (!zone || !dragState) return;
      event.preventDefault();
      var dragged = dragState;
      var next = displayedStatIds.filter(function (id) { return id !== dragged.id; });
      if (zone.dataset.statDropzone === 'available') {
        updateDisplayedStatIds(next, 'drag-disable');
      } else {
        var target = event.target.closest('[data-stat-id]');
        var insertAt = next.length;
        if (target) {
          if (target.dataset.statId === dragged.id) {
            insertAt = Math.min(Math.max(displayedStatIds.indexOf(dragged.id), 0), next.length);
          } else {
            insertAt = next.indexOf(target.dataset.statId);
            if (target.classList.contains('pnhud-stat-insert-after')) insertAt += 1;
            if (insertAt < 0) insertAt = next.length;
          }
        }
        next.splice(insertAt, 0, dragged.id);
        updateDisplayedStatIds(next, dragged.from === 'displayed' ? 'drag-reorder' : 'drag-enable');
      }
      dragState = null;
      clearInsertion();
    });
    customizer.addEventListener('click', function (event) {
      var actionButton = event.target.closest && event.target.closest('[data-stat-action]');
      if (actionButton) {
        var item = actionButton.closest('[data-stat-id]');
        var id = item && item.dataset.statId;
        var index = displayedStatIds.indexOf(id);
        var next = displayedStatIds.slice();
        if (actionButton.dataset.statAction === 'enable' && index < 0) {
          next.push(id);
          updateDisplayedStatIds(next, 'button-enable');
        } else if (actionButton.dataset.statAction === 'disable' && index >= 0) {
          next.splice(index, 1);
          updateDisplayedStatIds(next, 'button-disable');
        } else if (actionButton.dataset.statAction === 'move-up' && index > 0) {
          next.splice(index - 1, 0, next.splice(index, 1)[0]);
          updateDisplayedStatIds(next, 'button-move');
        } else if (actionButton.dataset.statAction === 'move-down' && index >= 0 && index < next.length - 1) {
          next.splice(index + 1, 0, next.splice(index, 1)[0]);
          updateDisplayedStatIds(next, 'button-move');
        }
      }
      if (event.target.closest && event.target.closest('.pnhud-stat-reset')) {
        updateDisplayedStatIds(PokerOverlayStats.DEFAULT_DISPLAYED_STAT_IDS.slice(), 'reset-defaults');
      }
    });
  }

  function leaderboardStatItemHtml(definition, displayed, index, count) {
    var controls = displayed
      ? '<span class="pnhud-stat-item-actions"><button type="button" data-leaderboard-stat-action="move-up" aria-label="Move ' + escapeHtml(definition.label) + ' left"' + (index === 0 ? ' disabled' : '') + '>&larr;</button><button type="button" data-leaderboard-stat-action="move-down" aria-label="Move ' + escapeHtml(definition.label) + ' right"' + (index === count - 1 ? ' disabled' : '') + '>&rarr;</button><button type="button" data-leaderboard-stat-action="disable">Remove</button></span>'
      : '<span class="pnhud-stat-item-actions"><button type="button" data-leaderboard-stat-action="enable">Add</button></span>';
    return '<li class="pnhud-stat-item" draggable="true" data-leaderboard-stat-id="' + escapeHtml(definition.id) + '" data-leaderboard-stat-list="' + (displayed ? 'displayed' : 'available') + '"><span class="pnhud-stat-drag" aria-hidden="true">\u2630</span><span class="pnhud-stat-item-label">' + escapeHtml(definition.label) + '<small>' + escapeHtml(definition.category || 'Other') + '</small></span>' + controls + '</li>';
  }

  function leaderboardStatCustomizerHtml() {
    var sync = leaderboardStatPreferences.syncWithOverlay;
    var independentIds = leaderboardStatPreferences.displayedStatIds;
    var effectiveIds = effectiveLeaderboardStatIds();
    var displayed = PokerOverlayStats.customizableDefinitionsFor(independentIds);
    var available = PokerOverlayStats.availableDefinitions(independentIds);
    var groups = PokerOverlayStats.groupByCategory(available);
    var preview = ['PLAYER'].concat(PokerLeaderboardStats.definitions(effectiveIds).map(PokerLeaderboardStats.tableLabel)).join(' | ');
    var availableHtml = Object.keys(groups).map(function (category) {
      return '<div class="pnhud-stat-category"><h4>' + escapeHtml(category) + '</h4><ul>' + groups[category].map(function (definition, index) {
        return leaderboardStatItemHtml(definition, false, index, groups[category].length);
      }).join('') + '</ul></div>';
    }).join('');
    return '<div class="pnhud-leaderboard-customizer"><h3>Leaderboard statistics</h3>' +
      '<fieldset class="pnhud-settings-radio-group"><legend>Statistic source</legend>' + ['session', 'career'].map(function (source) {
        return '<label><input type="radio" name="pnhud-leaderboard-stat-source" value="' + source + '"' + (currentLeaderboardStatSource() === source ? ' checked' : '') + '> ' + (source === 'career' ? 'Career' : 'Session') + '</label>';
      }).join('') + '</fieldset><p class="pnhud-stat-sync-note">Career uses stored Career statistics for the same table players. Source is independent of seat overlays.</p>' +
      '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-sync-leaderboard"' + (sync ? ' checked' : '') + '> Use the same statistics and order as seat overlays</label>' +
      '<div class="pnhud-stat-preview"><span>Header preview</span><output>' + escapeHtml(preview) + '</output></div>' +
      (sync ? '<p class="pnhud-stat-sync-note">Controlled by the Seat Overlay configuration. Your independent leaderboard selection is preserved.</p>' :
        '<details class="pnhud-leaderboard-stat-editor"' + (leaderboardCustomizerOpen ? ' open' : '') + '><summary>Customize leaderboard columns</summary><div class="pnhud-leaderboard-editor-body"><div class="pnhud-stat-lists"><section><h3>Displayed statistics</h3><p>Drag to set the left-to-right order.</p><ul class="pnhud-stat-dropzone" data-leaderboard-dropzone="displayed">' +
        (displayed.length ? displayed.map(function (definition, index) { return leaderboardStatItemHtml(definition, true, index, displayed.length); }).join('') : '<li class="pnhud-stat-empty">Player column only</li>') +
        '</ul></section><section><h3>Available statistics</h3><p>Drag here to disable, or use Add.</p><div class="pnhud-stat-dropzone" data-leaderboard-dropzone="available">' + (availableHtml || '<p class="pnhud-stat-empty">All registered statistics are displayed.</p>') +
        '</div></section></div><button type="button" class="pnhud-leaderboard-stat-reset">Reset leaderboard defaults</button></div></details>') + '</div>';
  }

  function bindLeaderboardStatCustomizer(host) {
    var editor = host.querySelector('.pnhud-leaderboard-customizer');
    if (!editor || leaderboardStatPreferences.syncWithOverlay) return;
    var details = editor.querySelector('.pnhud-leaderboard-stat-editor');
    if (details) details.addEventListener('toggle', function () { leaderboardCustomizerOpen = details.open; });
    var dragState = null;
    function clearInsertion() {
      editor.querySelectorAll('.pnhud-stat-insert-before, .pnhud-stat-insert-after, .pnhud-stat-drop-active, .pnhud-stat-dragging').forEach(function (element) {
        element.classList.remove('pnhud-stat-insert-before', 'pnhud-stat-insert-after', 'pnhud-stat-drop-active', 'pnhud-stat-dragging');
      });
    }
    editor.addEventListener('dragstart', function (event) {
      var item = event.target.closest && event.target.closest('[data-leaderboard-stat-id]');
      if (!item) return;
      dragState = { id: item.dataset.leaderboardStatId, from: item.dataset.leaderboardStatList };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragState.id);
      item.classList.add('pnhud-stat-dragging');
    });
    editor.addEventListener('dragover', function (event) {
      var zone = event.target.closest && event.target.closest('[data-leaderboard-dropzone]');
      if (!zone || !dragState) return;
      event.preventDefault();
      clearInsertion();
      zone.classList.add('pnhud-stat-drop-active');
      if (zone.dataset.leaderboardDropzone === 'displayed') {
        var target = event.target.closest('[data-leaderboard-stat-id]');
        if (target && target.dataset.leaderboardStatId !== dragState.id) {
          var rect = target.getBoundingClientRect();
          target.classList.add(event.clientY < rect.top + rect.height / 2 ? 'pnhud-stat-insert-before' : 'pnhud-stat-insert-after');
        }
      }
    });
    editor.addEventListener('drop', function (event) {
      var zone = event.target.closest && event.target.closest('[data-leaderboard-dropzone]');
      if (!zone || !dragState) return;
      event.preventDefault();
      var dragged = dragState;
      var current = leaderboardStatPreferences.displayedStatIds;
      var next = current.filter(function (id) { return id !== dragged.id; });
      if (zone.dataset.leaderboardDropzone === 'available') {
        updateLeaderboardStatIds(next, 'drag-disable');
      } else {
        var target = event.target.closest('[data-leaderboard-stat-id]');
        var insertAt = next.length;
        if (target) {
          if (target.dataset.leaderboardStatId === dragged.id) insertAt = Math.min(Math.max(current.indexOf(dragged.id), 0), next.length);
          else {
            insertAt = next.indexOf(target.dataset.leaderboardStatId);
            if (target.classList.contains('pnhud-stat-insert-after')) insertAt += 1;
            if (insertAt < 0) insertAt = next.length;
          }
        }
        next.splice(insertAt, 0, dragged.id);
        updateLeaderboardStatIds(next, dragged.from === 'displayed' ? 'drag-reorder' : 'drag-enable');
      }
      dragState = null;
      clearInsertion();
    });
    editor.addEventListener('dragend', function () { dragState = null; clearInsertion(); });
    editor.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-leaderboard-stat-action]');
      if (button) {
        var item = button.closest('[data-leaderboard-stat-id]');
        var id = item && item.dataset.leaderboardStatId;
        var index = leaderboardStatPreferences.displayedStatIds.indexOf(id);
        var next = leaderboardStatPreferences.displayedStatIds.slice();
        if (button.dataset.leaderboardStatAction === 'enable' && index < 0) { next.push(id); updateLeaderboardStatIds(next, 'button-enable'); }
        else if (button.dataset.leaderboardStatAction === 'disable' && index >= 0) { next.splice(index, 1); updateLeaderboardStatIds(next, 'button-disable'); }
        else if (button.dataset.leaderboardStatAction === 'move-up' && index > 0) { next.splice(index - 1, 0, next.splice(index, 1)[0]); updateLeaderboardStatIds(next, 'button-move'); }
        else if (button.dataset.leaderboardStatAction === 'move-down' && index >= 0 && index < next.length - 1) { next.splice(index + 1, 0, next.splice(index, 1)[0]); updateLeaderboardStatIds(next, 'button-move'); }
      }
      if (event.target.closest && event.target.closest('.pnhud-leaderboard-stat-reset')) updateLeaderboardStatIds(PokerLeaderboardStats.DEFAULTS.displayedStatIds.slice(), 'reset-defaults');
    });
  }

  function settingsNavigationHtml() {
    var labels = { general: 'General', overlay: 'Overlay', hud: 'HUD', appearance: 'Appearance', players: 'Players', 'career-data': 'Data', diagnostics: 'Diagnostics', about: 'About' };
    return PokerHudSettings.SECTIONS.map(function (section) {
      var active = hudUiPreferences.selectedSettingsSection === section;
      return '<button type="button" class="pnhud-settings-nav-button' + (active ? ' active' : '') + '" data-settings-section="' + section + '" aria-selected="' + (active ? 'true' : 'false') + '">' + labels[section] + '</button>';
    }).join('');
  }

  function displayModeOptionsHtml() {
    return [
      ['seat-overlays-only', 'Seat overlays only'],
      ['leaderboard-only', 'Leaderboard only'],
      ['seat-overlays-leaderboard', 'Both'],
      ['hidden', 'Hidden']
    ].map(function (option) {
      return '<option value="' + option[0] + '"' + (displayMode === option[0] ? ' selected' : '') + '>' + option[1] + '</option>';
    }).join('');
  }

  function careerDataBodyHtml() {
    careerDataUiState.sessionHandCount = handAccounting && handAccounting.finalizedHandIds ? handAccounting.finalizedHandIds.size : 0;
    return PokerCareerDataSettings.render(careerDataUiState.info, careerDataUiState);
  }

  function refreshCareerDataView(preferredFocus) {
    if (!ownsRuntimeController()) return;
    if (!settingsPanel || !settingsPanel.isConnected || hudUiPreferences.selectedSettingsSection !== 'career-data') return;
    var host = settingsPanel.querySelector('.pnhud-career-data-host');
    if (!host) return;
    host.innerHTML = careerDataBodyHtml();
    var target = preferredFocus && host.querySelector(preferredFocus);
    if (target && target.focus) target.focus();
  }

  function refreshCareerDataSummary(force) {
    if (!careerIndexedService || careerDataUiState.loading || (!force && careerDataUiState.info && Date.now() - careerDataUiState.fetchedAt < 5000)) return Promise.resolve(careerDataUiState.info);
    careerDataUiState.loading = true;
    careerDataUiState.summaryError = null;
    if (!careerDataUiState.message) careerDataUiState.message = 'Loading career database summary...';
    refreshCareerDataView();
    return careerIndexedService.careerLedgerInfo().then(function (info) {
      careerDataUiState.info = info;
      careerDataUiState.summaryError = null;
      careerDataUiState.fetchedAt = Date.now();
      if (careerDataUiState.message === 'Loading career database summary...') careerDataUiState.message = '';
      return info;
    }).catch(function (error) {
      careerDataUiState.summaryError = String(error && error.message || error);
      careerDataUiState.message = 'Unable to read the career database summary.';
      careerDataUiState.messageKind = 'error';
      return null;
    }).finally(function () {
      careerDataUiState.loading = false;
      refreshCareerDataView();
    });
  }

  function careerPortableFileOptions() {
    return { maximumFileBytes: PokerCareerBackupPolicy.MAX_COMPRESSED_FILE_BYTES, maximumJsonBytes: PokerCareerBackupPolicy.MAX_BACKUP_BYTES };
  }

  function triggerCareerBackupDownload(backup, requestedFileName) {
    var fileName = requestedFileName || PokerCareerDataSettings.exportFileName(new Date());
    return PokerCareerPortableFile.compressBackup(backup, careerPortableFileOptions()).then(function (portable) {
      var blob = new Blob([portable.bytes], { type: portable.mediaType });
      var href = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.documentElement.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      return { fileName: fileName, compressedBytes: portable.compressedBytes, decompressedBytes: portable.decompressedBytes };
    });
  }

  function exportCareerBackupFromSettings() {
    careerDataUiState.result = null;
    if (!careerIndexedService || careerDataUiState.busy) return;
    careerDataUiState.removalFlowActive = false;
    careerDataUiState.activeFlow = 'transfer';
    careerDataUiState.busy = true;
    careerDataUiState.message = 'Creating verified portable Career data...';
    careerDataUiState.messageKind = 'none';
    refreshCareerDataView();
    careerIndexedAppendQueue.then(function () { return careerIndexedService.careerLedgerInfo(); }).then(function (info) {
      var preflight = info && info.backupSizePolicy || PokerCareerBackupPolicy.exportPreflight(info);
      careerDataUiState.info = Object.assign({}, info || {}, { backupSizePolicy: preflight });
      careerDataUiState.fetchedAt = Date.now();
      if (!preflight.allowed) throw PokerCareerBackupPolicy.limitError('export', preflight);
      return careerIndexedService.exportCareerBackup();
    }).then(function (backup) {
      return triggerCareerBackupDownload(backup);
    }).then(function (download) {
      careerDataUiState.message = 'Career data exported as ' + download.fileName + ' (gzip compressed). Session and notes are not included.';
      careerDataUiState.messageKind = 'success';
    }).catch(function (error) {
      careerDataUiState.message = PokerCareerDataSettings.errorMessage(error);
      careerDataUiState.messageKind = 'error';
    }).finally(function () {
      careerDataUiState.busy = false;
      refreshCareerDataView('.pnhud-career-export');
    });
  }

  function readCareerBackupFile(file) {
    return PokerCareerPortableFile.readBackupFile(file, careerPortableFileOptions());
  }

  function requireSupportedPortableCandidate(operation, backup) {
    var integrity = backup && backup.integrity;
    if (!integrity || !Number.isInteger(integrity.physicalRecordCount) || integrity.physicalRecordCount < 0) return;
    var preflight = PokerCareerBackupPolicy.exportPreflight({
      physicalRecordCount: integrity.physicalRecordCount,
      activeRecordCount: integrity.activeRecordCount
    });
    if (!preflight.allowed) throw PokerCareerBackupPolicy.limitError(operation, preflight);
  }

  function previewCareerImportFile(file) {
    if (!file || !careerIndexedService || careerDataUiState.busy) return;
    careerDataUiState.removalFlowActive = false;
    careerDataUiState.activeFlow = 'transfer';
    careerDataUiState.result = null;
    var requestToken = ++careerDataUiState.importRequestToken;
    var importPreflight = PokerCareerBackupPolicy.restorePreflight(file.size);
    if (!importPreflight.allowed) {
      careerDataUiState.importPreview = null;
      careerDataUiState.importCandidate = null;
      careerDataUiState.message = PokerCareerDataSettings.errorMessage(PokerCareerBackupPolicy.limitError('import', importPreflight));
      careerDataUiState.messageKind = 'error';
      refreshCareerDataView('.pnhud-career-import-select');
      return;
    }
    careerDataUiState.busy = true;
    careerDataUiState.importPreview = null;
    careerDataUiState.importCandidate = null;
    careerDataUiState.message = 'Validating and planning a safe Career merge without changing data...';
    careerDataUiState.messageKind = 'none';
    refreshCareerDataView();
    readCareerBackupFile(file).then(function (portable) {
      var candidate = portable.backup;
      requireSupportedPortableCandidate('import', candidate);
      return careerIndexedAppendQueue.then(function () { return careerIndexedService.prepareCareerImport(candidate); }).then(function (preview) {
        if (requestToken !== careerDataUiState.importRequestToken || careerDataUiState.activeFlow !== 'transfer') return;
        careerDataUiState.importCandidate = candidate;
        preview.fileName = PokerCareerDataSettings.fileName(file.name);
        preview.fileBytes = Number(file.size || 0);
        preview.decompressedBytes = portable.decompressedBytes;
        preview.portableFormat = portable.format;
        careerDataUiState.importPreview = preview;
        careerDataUiState.message = preview.canImport ? 'Career data validated. Review the merge details before importing.' : 'Career data validated, but its record graph conflicts with current Career history. Nothing can be imported safely.';
        careerDataUiState.messageKind = preview.canImport ? 'success' : 'error';
      });
    }).catch(function (error) {
      if (requestToken !== careerDataUiState.importRequestToken) return;
      careerDataUiState.message = PokerCareerDataSettings.errorMessage(error);
      careerDataUiState.messageKind = 'error';
    }).finally(function () {
      if (requestToken !== careerDataUiState.importRequestToken) return;
      careerDataUiState.busy = false;
      refreshCareerDataView(careerDataUiState.importPreview ? '.pnhud-career-confirm-import' : '.pnhud-career-import-select');
    });
  }

  function cancelCareerImportPreview() {
    careerDataUiState.result = null;
    careerDataUiState.importRequestToken += 1;
    careerDataUiState.activeFlow = 'transfer';
    careerDataUiState.importPreview = null;
    careerDataUiState.importCandidate = null;
    careerDataUiState.message = 'Import cancelled. Career and Session data were not changed.';
    careerDataUiState.messageKind = 'none';
    refreshCareerDataView('.pnhud-career-import-select');
  }

  function confirmCareerImport() {
    if (!ownsRuntimeController()) return;
    var preview = careerDataUiState.importPreview; var candidate = careerDataUiState.importCandidate;
    if (!careerIndexedService || !preview || !preview.canImport || !candidate || careerDataUiState.busy) return;
    careerDataUiState.activeFlow = 'transfer'; careerDataUiState.busy = true; preview.importing = true;
    careerDataUiState.message = 'Atomically merging Career history...'; careerDataUiState.messageKind = 'none'; refreshCareerDataView();
    careerIndexedAppendQueue.then(function () { requireRuntimeController(); return careerIndexedService.mergeCareerBackup(candidate, {
      mode: 'merge', confirmed: true,
      expectedPayloadDigest: preview.candidatePayloadDigest,
      expectedCurrentPayloadDigest: preview.currentPayloadDigest
    }); }).then(function (result) {
      requireRuntimeController();
      careerDataUiState.result = { mode: "merge", fileName: preview.fileName, summary: result.summary };
      careerDataUiState.info = result.ledgerInfo; careerDataUiState.fetchedAt = Date.now();
      careerDataUiState.importPreview = null; careerDataUiState.importCandidate = null;
      invalidateSeatHudCareerStats(null, 'Career data imported');
      careerDataUiState.message = 'Import complete. Existing local Career history was preserved; Session was unaffected.';
      careerDataUiState.messageKind = 'success';
    }).catch(function (error) {
      if (careerDataUiState.importPreview) careerDataUiState.importPreview.importing = false;
      careerDataUiState.message = PokerCareerDataSettings.errorMessage(error); careerDataUiState.messageKind = 'error';
    }).finally(function () {
      careerDataUiState.busy = false;
      refreshCareerDataView(careerDataUiState.result ? '.pnhud-career-result' : '.pnhud-career-confirm-import');
      if (!careerDataUiState.importPreview) refreshCareerDataSummary(true);
    });
  }

  function previewCareerBackupFile(file) {
    if (!file || !careerIndexedService || careerDataUiState.busy) return;
    careerDataUiState.removalFlowActive = false;
    careerDataUiState.activeFlow = 'recovery';
    careerDataUiState.result = null;
    var requestToken = ++careerDataUiState.restoreRequestToken;
    var restorePreflight = PokerCareerBackupPolicy.restorePreflight(file.size);
    if (!restorePreflight.allowed) {
      careerDataUiState.preview = null;
      careerDataUiState.backupCandidate = null;
      careerDataUiState.message = PokerCareerDataSettings.errorMessage(PokerCareerBackupPolicy.limitError('restore', restorePreflight));
      careerDataUiState.messageKind = 'error';
      refreshCareerDataView('.pnhud-career-restore-select');
      return;
    }
    careerDataUiState.busy = true;
    careerDataUiState.preview = null;
    careerDataUiState.backupCandidate = null;
    careerDataUiState.message = 'Validating backup without changing career data...';
    careerDataUiState.messageKind = 'none';
    refreshCareerDataView();
    readCareerBackupFile(file).then(function (portable) {
      var backupCandidate = portable.backup;
      requireSupportedPortableCandidate('restore', backupCandidate);
      return careerIndexedAppendQueue.then(function () { return careerIndexedService.prepareCareerRestore(backupCandidate); }).then(function (preview) {
        if (requestToken !== careerDataUiState.restoreRequestToken || careerDataUiState.activeFlow !== 'recovery') return;
        careerDataUiState.backupCandidate = backupCandidate;
        preview.fileName = PokerCareerDataSettings.fileName(file.name);
        preview.fileBytes = Number(file.size || 0);
        preview.decompressedBytes = portable.decompressedBytes;
        preview.portableFormat = portable.format;
        careerDataUiState.preview = preview;
        careerDataUiState.message = 'Backup validated. Review the replacement details before restoring.';
        careerDataUiState.messageKind = 'success';
      });
    }).catch(function (error) {
      if (requestToken !== careerDataUiState.restoreRequestToken) return;
      careerDataUiState.message = PokerCareerDataSettings.errorMessage(error);
      careerDataUiState.messageKind = 'error';
    }).finally(function () {
      if (requestToken !== careerDataUiState.restoreRequestToken) return;
      careerDataUiState.busy = false;
      refreshCareerDataView(careerDataUiState.preview ? '.pnhud-career-confirm-restore' : '.pnhud-career-restore-select');
    });
  }

  function cancelCareerRestorePreview() {
    careerDataUiState.result = null;
    careerDataUiState.restoreRequestToken += 1;
    careerDataUiState.removalFlowActive = false;
    careerDataUiState.activeFlow = 'recovery';
    careerDataUiState.preview = null;
    careerDataUiState.backupCandidate = null;
    careerDataUiState.message = 'Restore cancelled. Career history was not changed.';
    careerDataUiState.messageKind = 'none';
    refreshCareerDataView('.pnhud-career-restore-select');
  }

  function confirmCareerRestore() {
    if (!ownsRuntimeController()) return;
    var careerCommitted = false;
    var preview = careerDataUiState.preview;
    var candidate = careerDataUiState.backupCandidate;
    if (!careerIndexedService || !preview || !candidate || careerDataUiState.busy) return;
    careerDataUiState.removalFlowActive = false;
    careerDataUiState.activeFlow = 'recovery';
    careerDataUiState.busy = true;
    preview.restoring = true;
    careerDataUiState.message = 'Replacing career history with the validated backup...';
    careerDataUiState.messageKind = 'none';
    // A hand finalized during the worker transaction belongs to the old
    // Session epoch. Defer its Career append until Restore succeeds or fails.
    careerRestoreAppendGate = { records: [] };
    refreshCareerDataView();
    careerIndexedAppendQueue.then(function () { requireRuntimeController(); return careerIndexedService.replaceCareerBackup(candidate, {
      mode: 'replace',
      confirmed: true,
      expectedPayloadDigest: preview.candidate.payloadDigest,
      expectedCurrentPayloadDigest: preview.current.payloadDigest
    }); }).then(function (result) {
      requireRuntimeController();
      careerCommitted = true;
      careerDataUiState.info = result.ledgerInfo;
      invalidateSeatHudCareerStats(null, 'Career backup restored', true);
      careerDataUiState.fetchedAt = Date.now();
      careerDataUiState.preview = null;
      careerDataUiState.backupCandidate = null;
      careerDataUiState.message = 'Career history restored. Resetting the current Session...';
      return new Promise(function (resolve, reject) {
        resetCurrentSession({ preserveAuthoritativePause: true, source: 'successful Career restore' }, function (error) {
          if (error) reject(error); else resolve(result);
        });
        releaseCareerRestoreAppendGate(true);
      });
    }).then(function (result) {
      requireRuntimeController();
      careerDataUiState.result = { mode: "replace", fileName: preview.fileName, summary: result.summary };
      careerDataUiState.message = 'Career backup restored successfully. Current Session reset to 0.';
      careerDataUiState.messageKind = 'success';
    }).catch(function (error) {
      releaseCareerRestoreAppendGate(false);
      if (careerDataUiState.preview) careerDataUiState.preview.restoring = false;
      careerDataUiState.message = careerCommitted
        ? 'Career backup was restored, but Session reset persistence failed. Use Reset Session again before relying on the retained Session after reload.'
        : PokerCareerDataSettings.errorMessage(error);
      careerDataUiState.messageKind = 'error';
    }).finally(function () {
      careerDataUiState.busy = false;
      refreshCareerDataView(careerDataUiState.result ? '.pnhud-career-result' : '.pnhud-career-confirm-restore');
      if (!careerDataUiState.preview) refreshCareerDataSummary(true);
    });
  }

  function currentSessionRemovalRequest() {
    return {
      namespace: { provider: 'pokernow', host: location.hostname, gameId: pokerNowGameId },
      sessionHandIds: handAccounting && handAccounting.finalizedHandIds ? Array.from(handAccounting.finalizedHandIds).map(String).sort() : []
    };
  }

  function sameStringArray(left, right) {
    return JSON.stringify((left || []).map(String).sort()) === JSON.stringify((right || []).map(String).sort());
  }

  function prepareCurrentSessionCareerRemoval() {
    careerDataUiState.result = null;
    if (!careerIndexedService || careerDataUiState.busy) return;
    var request = currentSessionRemovalRequest();
    if (!request.sessionHandIds.length) {
      careerDataUiState.message = 'There are no finalized Session hands to remove.';
      careerDataUiState.messageKind = 'none';
      refreshCareerDataView('.pnhud-career-remove-session');
      return;
    }
    var requestToken = ++careerDataUiState.removalRequestToken;
    careerDataUiState.busy = true;
    careerDataUiState.removalFlowActive = true;
    careerDataUiState.activeFlow = 'removal';
    careerDataUiState.importRequestToken += 1;
    careerDataUiState.restoreRequestToken += 1;
    careerDataUiState.importPreview = null;
    careerDataUiState.importCandidate = null;
    careerDataUiState.preview = null;
    careerDataUiState.backupCandidate = null;
    careerDataUiState.removalPreview = null;
    careerDataUiState.removalRequest = request;
    careerDataUiState.message = 'Matching exact current-room Session hand provenance to Career...';
    careerDataUiState.messageKind = 'none';
    refreshCareerDataView();
    careerIndexedAppendQueue.then(function () {
      return careerIndexedService.prepareCareerSessionRemoval(request);
    }).then(function (preview) {
      if (requestToken !== careerDataUiState.removalRequestToken) return;
      if (hudUiPreferences.selectedSettingsSection !== 'career-data') {
        careerDataUiState.removalRequestToken += 1;
        careerDataUiState.removalFlowActive = false;
        careerDataUiState.removalRequest = null;
        careerDataUiState.busy = false;
        return;
      }
      if (!sameStringArray(request.sessionHandIds, currentSessionRemovalRequest().sessionHandIds)) throw new Error('Current Session changed while Career removal was being prepared; preview it again');
      careerDataUiState.removalPreview = preview;
      careerDataUiState.message = 'Exact Session-to-Career matching completed. Review the destructive action before confirming.';
      careerDataUiState.messageKind = 'success';
    }).catch(function (error) {
      if (requestToken !== careerDataUiState.removalRequestToken) return;
      careerDataUiState.removalRequest = null;
      careerDataUiState.message = PokerCareerDataSettings.errorMessage(error);
      careerDataUiState.messageKind = 'error';
    }).finally(function () {
      if (requestToken !== careerDataUiState.removalRequestToken) return;
      careerDataUiState.busy = false;
      refreshCareerDataView(careerDataUiState.removalPreview ? '.pnhud-career-confirm-removal' : '.pnhud-career-remove-session');
    });
  }

  function cancelCurrentSessionCareerRemoval() {
    careerDataUiState.removalRequestToken += 1;
    careerDataUiState.removalFlowActive = true;
    careerDataUiState.activeFlow = 'removal';
    careerDataUiState.removalPreview = null;
    careerDataUiState.removalRequest = null;
    careerDataUiState.message = 'Career removal cancelled. Career and Session data were not changed.';
    careerDataUiState.messageKind = 'none';
    refreshCareerDataView('.pnhud-career-remove-session');
  }

  function mergeCareerSessionRemovalResults(accumulated, result) {
    var prior = accumulated || { preview: { logicalHandCount: 0, physicalRecordCount: 0, affectedPlayerIds: [] }, ledgerInfo: null };
    var next = result && result.preview || {};
    var affected = new Set((prior.preview.affectedPlayerIds || []).map(String));
    (next.affectedPlayerIds || []).forEach(function (playerId) { affected.add(String(playerId)); });
    return {
      preview: {
        logicalHandCount: Number(prior.preview.logicalHandCount || 0) + Number(next.logicalHandCount || 0),
        physicalRecordCount: Number(prior.preview.physicalRecordCount || 0) + Number(next.physicalRecordCount || 0),
        affectedPlayerIds: Array.from(affected).sort()
      },
      ledgerInfo: result && result.ledgerInfo || prior.ledgerInfo
    };
  }

  function removeLateFinalizedSessionHands(accumulated, removedRequest) {
    requireRuntimeController();
    var latestRequest = currentSessionRemovalRequest();
    if (sameStringArray(removedRequest.sessionHandIds, latestRequest.sessionHandIds)) return Promise.resolve(accumulated);
    // A hand may finalize while IndexedDB is committing the prior snapshot. Drain
    // its durable append, obtain a fresh digest-bound preview, and remove it too.
    // Once the final equality check succeeds, resetCurrentSession is invoked in
    // the same JavaScript turn so no later finalization can interleave.
    return careerIndexedAppendQueue.then(function () {
      requireRuntimeController();
      latestRequest = currentSessionRemovalRequest();
      return careerIndexedService.prepareCareerSessionRemoval(latestRequest);
    }).then(function (latePreview) {
      requireRuntimeController();
      if (!sameStringArray(latestRequest.sessionHandIds, currentSessionRemovalRequest().sessionHandIds)) {
        return removeLateFinalizedSessionHands(accumulated, removedRequest);
      }
      return careerIndexedService.removeCareerSession(latestRequest, {
        mode: 'remove-current-session', confirmed: true,
        expectedCurrentDigest: latePreview.currentDigest,
        expectedConfirmationToken: latePreview.confirmationToken
      }).then(function (lateResult) {
        return removeLateFinalizedSessionHands(mergeCareerSessionRemovalResults(accumulated, lateResult), latestRequest);
      });
    });
  }

  function confirmCurrentSessionCareerRemoval() {
    if (!ownsRuntimeController()) return;
    var preview = careerDataUiState.removalPreview; var request = careerDataUiState.removalRequest;
    var careerCommitted = false;
    if (!careerIndexedService || !preview || !request || careerDataUiState.busy) return;
    if (!sameStringArray(request.sessionHandIds, currentSessionRemovalRequest().sessionHandIds)) {
      careerDataUiState.removalPreview = null; careerDataUiState.removalRequest = null;
      careerDataUiState.message = 'Current Session changed after preview. Nothing was removed; preview the action again.';
      careerDataUiState.messageKind = 'error'; refreshCareerDataView('.pnhud-career-remove-session'); return;
    }
    careerDataUiState.busy = true; preview.removing = true;
    careerDataUiState.activeFlow = 'removal';
    careerDataUiState.message = 'Atomically removing the matched Career hands...'; careerDataUiState.messageKind = 'none'; refreshCareerDataView();
    careerIndexedAppendQueue.then(function () {
      requireRuntimeController();
      if (!sameStringArray(request.sessionHandIds, currentSessionRemovalRequest().sessionHandIds)) throw new Error('Current Session changed while Career removal was waiting for pending hands; preview it again');
      return careerIndexedService.removeCareerSession(request, {
        mode: 'remove-current-session', confirmed: true,
        expectedCurrentDigest: preview.currentDigest,
        expectedConfirmationToken: preview.confirmationToken
      });
    }).then(function (result) {
      requireRuntimeController();
      careerCommitted = true;
      return removeLateFinalizedSessionHands(mergeCareerSessionRemovalResults(null, result), request);
    }).then(function (result) {
      requireRuntimeController();
      var affected = result && result.preview && result.preview.affectedPlayerIds || [];
      careerDataUiState.info = result.ledgerInfo; careerDataUiState.fetchedAt = Date.now();
      careerDataUiState.removalPreview = null; careerDataUiState.removalRequest = null;
      invalidateSeatHudCareerStats(affected, 'Current Session removed from Career');
      return new Promise(function (resolve, reject) {
        resetCurrentSession(function (error) { if (error) reject(error); else resolve(result); });
      });
    }).then(function (result) {
      careerDataUiState.message = 'Removed ' + Number(result.preview.logicalHandCount || 0) + ' exact Career hands and reset Session.';
      careerDataUiState.messageKind = 'success';
    }).catch(function (error) {
      if (careerDataUiState.removalPreview) careerDataUiState.removalPreview.removing = false;
      if (!careerCommitted && /current-digest-bound|Current Session changed/i.test(String(error && error.message || error))) {
        careerDataUiState.removalPreview = null; careerDataUiState.removalRequest = null;
      }
      careerDataUiState.removalFlowActive = true;
      if (careerCommitted) careerDataUiState.message = 'Career hands were removed, but Session reset persistence failed. Use Reset Session again before relying on the retained Session after reload.';
      else careerDataUiState.message = PokerCareerDataSettings.errorMessage(error);
      careerDataUiState.messageKind = 'error';
    }).finally(function () {
      careerDataUiState.busy = false;
      refreshCareerDataView(careerDataUiState.removalPreview ? '.pnhud-career-confirm-removal' : '.pnhud-career-remove-session');
      if (!careerDataUiState.removalPreview) refreshCareerDataSummary(true);
    });
  }

  function settingsSectionHtml() {
    var section = hudUiPreferences.selectedSettingsSection;
    if (section === 'general') {
      return '<section class="pnhud-settings-section" data-settings-content="general"><h2>General</h2><p>Choose each HUD surface independently. Display mode is a synchronized convenience view.</p>' +
        '<label class="pnhud-settings-field"><span>Display mode</span><select class="pnhud-settings-display-mode">' + displayModeOptionsHtml() + '</select></label>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-leaderboard-visible"' + (leaderboardVisible() ? ' checked' : '') + '> Show leaderboard HUD</label></section>';
    }
    if (section === 'overlay') {
      return '<section class="pnhud-settings-section" data-settings-content="overlay"><h2>Seat overlays</h2>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-overlays-visible"' + (seatOverlaysVisible() ? ' checked' : '') + '> Show Seat HUD</label>' +
        '<fieldset class="pnhud-seat-hud-source"><legend>Seat HUD Stats</legend><label><input type="radio" name="pnhud-seat-hud-stat-source" value="session"' + (currentSeatHudStatSource() === 'session' ? ' checked' : '') + '> Session</label><label><input type="radio" name="pnhud-seat-hud-stat-source" value="career"' + (currentSeatHudStatSource() === 'career' ? ' checked' : '') + '> Career</label><p class="pnhud-settings-help">Career uses all hands currently stored in PokerNow HUD Career data. Player profile chips remain Session-based.</p></fieldset>' +
        '<div class="pnhud-settings-control-row"><span>Positions are ' + (overlayDraggingUnlocked ? 'unlocked' : 'locked') + '</span><button type="button" class="pnhud-unlock-overlays"' + (overlayDraggingUnlocked ? ' disabled' : '') + '>Unlock dragging</button><button type="button" class="pnhud-lock-overlays"' + (!overlayDraggingUnlocked ? ' disabled' : '') + '>Lock positions</button><button type="button" class="pnhud-reset-overlays">Reset Seat HUD Positions</button></div>' +
        '<div class="pnhud-settings-position-group"><h3>Player Dashboard position</h3><div class="pnhud-settings-control-row"><span>Page-lifetime position</span><button type="button" class="pnhud-reset-player-dashboard-position">Reset Player Dashboard Position</button></div><p class="pnhud-settings-help">Restores the responsive default position without changing Dashboard data, filters, source, notes, or size.</p></div>' +
        '<label class="pnhud-settings-field"><span>Opportunity stats layout</span><select class="pnhud-settings-opportunity-layout"><option value="combined"' + (hudUiPreferences.opportunityStatsLayout === 'combined' ? ' selected' : '') + '>Combined</option><option value="stacked"' + (hudUiPreferences.opportunityStatsLayout === 'stacked' ? ' selected' : '') + '>Stacked</option></select></label>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-player-profiles"' + (hudUiPreferences.showPlayerProfiles ? ' checked' : '') + '> Show Player Profiles</label>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-debug-identity"' + (debugSeatIdentity ? ' checked' : '') + '> Show seat identity labels</label>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-withheld"' + (showWithheldPlaceholders ? ' checked' : '') + '> Show withheld overlay placeholders</label>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-anchor-boxes"' + (showOverlayBoxes ? ' checked' : '') + '> Deep debug: anchor boxes</label>' +
        overlayStatCustomizerHtml() + '</section>';
    }
    if (section === 'hud') {
      return '<section class="pnhud-settings-section" data-settings-content="hud"><h2>Leaderboard HUD</h2><p>The leaderboard is intentionally compact during play. Pipeline details are available under Diagnostics.</p>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-leaderboard-visible"' + (leaderboardVisible() ? ' checked' : '') + '> Show leaderboard</label>' +
        '<div class="pnhud-settings-position-group"><h3>Leaderboard HUD position</h3><div class="pnhud-settings-control-row"><span>Position is ' + (leaderboardHudPosition.locked ? 'locked' : 'unlocked') + '</span><button type="button" class="pnhud-unlock-leaderboard"' + (!leaderboardHudPosition.locked ? ' disabled' : '') + '>Unlock dragging</button><button type="button" class="pnhud-lock-leaderboard"' + (leaderboardHudPosition.locked ? ' disabled' : '') + '>Lock position</button><button type="button" class="pnhud-reset-leaderboard-position">Reset position</button></div><p class="pnhud-settings-help">Drag the leaderboard using an empty part of its header while unlocked.</p></div>' +
        '<p class="pnhud-settings-help">HUD size is controlled in Appearance. The existing top-right HUD button remains available when the leaderboard is hidden.</p>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-pot-odds"' + (hudUiPreferences.showPotOdds ? ' checked' : '') + '> Show pot odds</label>' +
        '<div class="pnhud-settings-position-group"><h3>Pot Odds position</h3><div class="pnhud-settings-control-row"><span>Offset ' + escapeHtml(hudUiPreferences.potOddsOffsetX) + ' / ' + escapeHtml(hudUiPreferences.potOddsOffsetY) + ' px</span><button type="button" class="pnhud-reset-pot-odds-position">Reset Pot Odds Position</button></div><p class="pnhud-settings-help">Drag the POT ODDS title. The saved offset remains relative to the canonical LEFT board-companion slot.</p></div>' +
        leaderboardStatCustomizerHtml() + '</section>';
    }
    if (section === 'appearance') {
      var palette = Object.keys(PokerHudSettings.ACCENT_THEMES).map(function (id) {
        var theme = PokerHudSettings.ACCENT_THEMES[id];
        return '<button type="button" class="pnhud-accent-choice' + (hudUiPreferences.accentTheme === id ? ' active' : '') + '" data-accent-theme="' + id + '" aria-pressed="' + (hudUiPreferences.accentTheme === id ? 'true' : 'false') + '"><span style="background:' + theme.color + '"></span>' + theme.label + '</button>';
      }).join('');
      return '<section class="pnhud-settings-section" data-settings-content="appearance"><h2>Appearance</h2>' +
        '<label class="pnhud-settings-field"><span>HUD background opacity <output class="pnhud-opacity-value">' + Math.round(hudUiPreferences.hudOpacity * 100) + '%</output></span><input class="pnhud-settings-opacity" type="range" min="10" max="100" step="1" value="' + Math.round(hudUiPreferences.hudOpacity * 100) + '"></label>' +
        '<label class="pnhud-settings-field"><span>Settings panel background opacity <output class="pnhud-settings-panel-opacity-value">' + Math.round(hudUiPreferences.settingsBackgroundOpacity * 100) + '%</output></span><input class="pnhud-settings-panel-opacity" type="range" min="10" max="100" step="1" value="' + Math.round(hudUiPreferences.settingsBackgroundOpacity * 100) + '"></label>' +
        '<label class="pnhud-settings-field"><span>Player dashboard background opacity <output class="pnhud-dashboard-opacity-value">' + Math.round(hudUiPreferences.dashboardBackgroundOpacity * 100) + '%</output></span><input class="pnhud-dashboard-opacity" type="range" min="10" max="100" step="1" value="' + Math.round(hudUiPreferences.dashboardBackgroundOpacity * 100) + '"></label>' +
        '<fieldset class="pnhud-accent-palette"><legend>Accent color</legend>' + palette + '</fieldset>' +
        '<label class="pnhud-settings-field"><span>HUD size</span><select class="pnhud-settings-hud-size"><option value="small"' + (hudUiPreferences.hudSize === 'small' ? ' selected' : '') + '>Small</option><option value="default"' + (hudUiPreferences.hudSize === 'default' ? ' selected' : '') + '>Default</option><option value="large"' + (hudUiPreferences.hudSize === 'large' ? ' selected' : '') + '>Large</option></select></label></section>';
    }
    if (section === 'players') return '<section class="pnhud-settings-section" data-settings-content="players"><div class="pnhud-players-host"></div></section>';
    if (section === 'career-data') {
      return '<section class="pnhud-settings-section" data-settings-content="career-data"><h2>Data</h2><p>Manage this room\'s Session and the separate durable Career database.</p><div class="pnhud-career-data-host">' + careerDataBodyHtml() + '</div></section>';
    }
    if (section === 'diagnostics') {
      var armedMarker = pauseDiagnosticCaptureState.pendingMarker && pauseDiagnosticCaptureState.pendingMarker.marker;
      return '<section class="pnhud-settings-section pnhud-settings-diagnostics" data-settings-content="diagnostics"><h2>Diagnostics</h2>' +
        '<div class="pnhud-settings-control-row pnhud-hand-stat-inspector-control"><span>Review finalized per-hand statistic decisions without DevTools.</span><button type="button" class="pnhud-open-hand-stat-inspector" aria-haspopup="dialog" aria-controls="pnhud-hand-stat-inspector-host" aria-expanded="' + (handStatInspectorState.open ? 'true' : 'false') + '">Hand Stat Inspector</button></div><div id="pnhud-hand-stat-inspector-host" class="pnhud-hand-stat-inspector-host">' + handStatInspectorHtml() + '</div>' +
        '<div class="pnhud-profile-score-inspector-host">' + profileScoreInspectorHtml() + '</div>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-developer-tools"' + (hudUiPreferences.developerToolsVisible ? ' checked' : '') + '> Show developer tools</label>' +
        '<label class="pnhud-settings-check"><input type="checkbox" class="pnhud-settings-pause-capture"' + (pauseLifecycleCaptureEnabled ? ' checked' : '') + '> Enable bounded Pause/Resume diagnostic capture</label>' +
        '<p class="pnhud-settings-help">Disabled by default. Mark a window, close the panel automatically, then trigger PokerNow by keyboard, button, menu, or touch. Captures are sanitized and never commit statistics or change hand lifecycle.</p>' +
        '<div class="pnhud-pause-capture-actions"><button type="button" class="pnhud-mark-next-pause"' + (pauseLifecycleCaptureEnabled ? '' : ' disabled') + '>Mark Pause Window</button><button type="button" class="pnhud-mark-next-resume"' + (pauseLifecycleCaptureEnabled ? '' : ' disabled') + '>Mark Resume Window</button><button type="button" class="pnhud-clear-pause-capture"' + (pauseLifecycleCaptureEnabled ? '' : ' disabled') + '>Clear Capture</button><button type="button" class="pnhud-export-pause-capture"' + (pauseLifecycleCaptureEnabled ? '' : ' disabled') + '>Export Pause Capture</button></div>' +
        (armedMarker ? '<p class="pnhud-settings-help pnhud-pause-capture-armed">Active ' + escapeHtml(armedMarker === 'pause' ? 'Pause' : 'Resume') + ' capture window; no click is required.</p>' : '') +
        healthPanelHtml(hudUiPreferences.developerToolsVisible) + '<p class="pnhud-build-inline">Build ' + escapeHtml(PNHUD_BUILD_ID) + '</p></section>';
    }
    var version = chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '1.2.0';
    return '<section class="pnhud-settings-section" data-settings-content="about"><h2>About</h2><p><strong>PokerNow Stats HUD</strong></p><p>Live finalized poker statistics with configurable per-seat overlays.</p><dl class="pnhud-about-meta"><div><dt>Version</dt><dd>' + escapeHtml(version) + '</dd></div><div><dt>Build</dt><dd>' + escapeHtml(PNHUD_BUILD_ID) + '</dd></div></dl><button type="button" class="pnhud-reset-configuration">Reset interface configuration</button><p class="pnhud-settings-help">Resets display, appearance, positions, and overlay selection. Accumulated poker statistics are not erased.</p></section>';
  }

  function renderSettingsPanel() {
    if (!ownsRuntimeController()) return;
    if (!settingsPanel || !settingsPanel.isConnected) return;
    settingsPanel.hidden = !hudUiPreferences.settingsOpen;
    settingsPanel.setAttribute('aria-hidden', hudUiPreferences.settingsOpen ? 'false' : 'true');
    if (settingsLauncher) settingsLauncher.setAttribute('aria-expanded', hudUiPreferences.settingsOpen ? 'true' : 'false');
    settingsPanel.innerHTML = '<div class="pnhud-settings-window" role="document"><header><div><strong>PokerNow Stats HUD</strong><span>Settings</span></div><button type="button" class="pnhud-settings-close" aria-label="Close settings">\u00d7</button></header><div class="pnhud-settings-layout"><nav aria-label="Settings sections">' + settingsNavigationHtml() + '</nav><main tabindex="-1">' + settingsSectionHtml() + '</main></div></div>';
    if (hudUiPreferences.settingsOpen && hudUiPreferences.selectedSettingsSection === 'players') {
      var wasOpen = trackedPlayersState.open;
      trackedPlayersState.open = true;
      renderTrackedPlayers();
      if (!wasOpen) requestTrackedPlayerSummaries();
    } else closeTrackedPlayers();
    if (hudUiPreferences.selectedSettingsSection === 'overlay') bindOverlayStatCustomizer(settingsPanel);
    if (hudUiPreferences.selectedSettingsSection === 'hud') bindLeaderboardStatCustomizer(settingsPanel);
    if (hudUiPreferences.selectedSettingsSection === 'career-data') refreshCareerDataSummary(false);
    applyHudUiAppearance();
  }

  function recordSettingsBoardCompanionTransition(type, reason, before) {
    if (currentPotOddsPresentationDecision()) positionHeroPotOdds(reason);
    var after = boardCompanionEventEssentials();
    var beforeOffset = before && before.offset || { x: 0, y: 0 };
    if (before && JSON.stringify(beforeOffset) !== JSON.stringify(after.offset)) {
      recordBoardCompanionEvent('ILLEGAL_SETTINGS_OFFSET_CHANGE', reason + ' attempted to change feature offset', before, after);
    }
    var stablePhysicalInputs = before && JSON.stringify(before.viewport || null) === JSON.stringify(after.viewport || null) &&
      JSON.stringify(before.tableViewportRect || null) === JSON.stringify(after.tableViewportRect || null) &&
      JSON.stringify(before.tableTransform || null) === JSON.stringify(after.tableTransform || null);
    var canonicalChanged = before && (before.layoutEpochId !== after.layoutEpochId || before.tableOwnerSource !== after.tableOwnerSource ||
      JSON.stringify(before.canonicalBoardLocalRect || null) !== JSON.stringify(after.canonicalBoardLocalRect || null) ||
      JSON.stringify(before.canonicalBoardRect || null) !== JSON.stringify(after.canonicalBoardRect || null) ||
      JSON.stringify(before.canonicalLeftCompanionRect || null) !== JSON.stringify(after.canonicalLeftCompanionRect || null));
    if (stablePhysicalInputs && canonicalChanged) recordBoardCompanionEvent('ILLEGAL_SETTINGS_GEOMETRY_CHANGE', reason + ' rejected canonical geometry change without a physical layout change', before, after);
    recordBoardCompanionEvent(type, reason, before, after);
    recordBoardCompanionEvent('settings-layout-signal', reason, before, after);
    return after;
  }

  function handStatInspectorModel() {
    return PokerHandStatInspector.buildModel(handStatInspectorState, PokerHandStatExplanation.list(statExplanationState));
  }

  function handStatInspectorHtml() {
    return PokerHandStatInspector.renderHtml(handStatInspectorModel());
  }

  function profileScoreInspectorPlayers() {
    return PokerPlayerProfileShadowStore.list(playerProfileShadowState).map(function (record) {
      return { playerId: record.playerId, displayName: socketPlayerNames.get(record.playerId) || 'Unknown player', hands: record.hands };
    });
  }

  function profileScoreInspectorModel() {
    return PokerPlayerProfileScoreInspector.buildModel(playerProfileScoreInspectorState, profileScoreInspectorPlayers());
  }

  function profileScoreInspectorHtml() {
    playerProfileScoreInspectorUi.ensureSelection();
    return PokerPlayerProfileScoreInspector.renderHtml(profileScoreInspectorModel());
  }

  function refreshProfileScoreInspectorView(preferredFocus) {
    if (!settingsPanel || !settingsPanel.isConnected || hudUiPreferences.selectedSettingsSection !== 'diagnostics') return;
    var host = settingsPanel.querySelector('.pnhud-profile-score-inspector-host');
    if (!host) return;
    host.innerHTML = profileScoreInspectorHtml();
    var target = preferredFocus && host.querySelector(preferredFocus);
    if (target && target.focus) target.focus();
  }

  function inspectProfileScore() {
    playerProfileScoreInspectorUi.inspectLatest();
  }

  function copyProfileScoreInspector(kind) {
    var model = profileScoreInspectorModel();
    if (!model.decomposition) return;
    var textValue = kind === 'json' ? PokerPlayerProfileScoreInspector.jsonText(model) : PokerPlayerProfileScoreInspector.summaryText(model);
    function copied() { var status = settingsPanel && settingsPanel.querySelector('.pnhud-profile-score-copy-status'); if (status) status.textContent = kind === 'json' ? 'JSON copied' : 'Summary copied'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textValue).then(copied).catch(function () { fallbackCopyText(textValue, copied); });
    else fallbackCopyText(textValue, copied);
  }

  function refreshHandStatInspectorView(preferredFocusKey, resetDetailScroll) {
    if (!settingsPanel || !settingsPanel.isConnected || hudUiPreferences.selectedSettingsSection !== 'diagnostics') return;
    var active = document.activeElement;
    var activeKey = preferredFocusKey || active && active.dataset && active.dataset.pnhudInspectorFocus || null;
    var host = settingsPanel.querySelector('.pnhud-hand-stat-inspector-host');
    if (!host) return;
    var previousHistory = host.querySelector('.pnhud-hand-stat-history');
    var previousDetail = host.querySelector('.pnhud-hand-stat-detail');
    if (previousHistory) handStatInspectorScrollState.history = Math.max(0, Number(previousHistory.scrollTop) || 0);
    if (previousDetail) handStatInspectorScrollState.detail = Math.max(0, Number(previousDetail.scrollTop) || 0);
    if (resetDetailScroll) handStatInspectorScrollState.detail = 0;
    host.innerHTML = handStatInspectorHtml();
    var nextHistory = host.querySelector('.pnhud-hand-stat-history');
    var nextDetail = host.querySelector('.pnhud-hand-stat-detail');
    if (nextHistory) nextHistory.scrollTop = handStatInspectorScrollState.history;
    if (nextDetail) nextDetail.scrollTop = handStatInspectorScrollState.detail;
    var launcher = settingsPanel.querySelector('.pnhud-open-hand-stat-inspector');
    if (launcher) launcher.setAttribute('aria-expanded', handStatInspectorState.open ? 'true' : 'false');
    var focusTarget = activeKey === 'launcher'
      ? launcher
      : activeKey ? host.querySelector('[data-pnhud-inspector-focus="' + String(activeKey).replace(/["\\]/g, '\\$&') + '"]') : null;
    if (!focusTarget && preferredFocusKey === 'close') focusTarget = host.querySelector('.pnhud-close-hand-stat-inspector');
    if (focusTarget && focusTarget.focus) focusTarget.focus();
  }

  function openHandStatInspector() {
    if (!handStatInspectorState.open) handStatInspectorScrollState = { history: 0, detail: 0 };
    PokerHandStatInspector.open(handStatInspectorState, PokerHandStatExplanation.list(statExplanationState));
    refreshHandStatInspectorView('close');
  }

  function closeHandStatInspector() {
    PokerHandStatInspector.close(handStatInspectorState);
    refreshHandStatInspectorView('launcher');
  }

  function copyHandStatInspector(kind) {
    var model = handStatInspectorModel();
    if (!model.selectedHand) return;
    var textValue = kind === 'json' ? PokerHandStatInspector.jsonText(model) : PokerHandStatInspector.summaryText(model);
    var buttonSelector = kind === 'json' ? '.pnhud-copy-hand-stat-json' : '.pnhud-copy-hand-stat-summary';
    function copied() {
      var status = settingsPanel && settingsPanel.querySelector('.pnhud-hand-stat-copy-status');
      if (status) status.textContent = kind === 'json' ? 'JSON copied' : 'Summary copied';
      var button = settingsPanel && settingsPanel.querySelector(buttonSelector);
      if (button) {
        var original = button.textContent;
        button.textContent = 'Copied';
        setTimeout(function () { if (button.isConnected) button.textContent = original; }, 1200);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textValue).then(copied).catch(function () { fallbackCopyText(textValue, copied); });
    else fallbackCopyText(textValue, copied);
  }

  function setSettingsOpen(open, source) {
    open = Boolean(open);
    if (hudUiPreferences.settingsOpen === open) {
      settingsUiDiagnostics.duplicateListenerPreventions += 1;
      return;
    }
    var before = boardCompanionEventEssentials();
    if (open) settingsUiDiagnostics.settingsOpenCount += 1;
    else {
      settingsUiDiagnostics.settingsCloseCount += 1;
      PokerHandStatInspector.close(handStatInspectorState);
    }
    updateHudUiPreferences({ settingsOpen: open }, source || (open ? 'launcher-open' : 'settings-close'), { render: false });
    renderSettingsPanel();
    scheduleNativePanelOcclusion(open ? 'extension Settings opened' : 'extension Settings closed');
    recordSettingsBoardCompanionTransition(open ? 'settings-open' : 'settings-close', (open ? 'Settings opened: ' : 'Settings closed: ') + String(source || 'settings visibility'), before);
    if (open) {
      var focusTarget = settingsPanel.querySelector('[data-settings-section="' + hudUiPreferences.selectedSettingsSection + '"]') || settingsPanel.querySelector('.pnhud-settings-close');
      if (focusTarget) focusTarget.focus();
    } else if (settingsLauncher && settingsLauncher.isConnected) {
      settingsLauncher.focus();
    }
  }

  function displayModeForSurfaceChange(surface, enabled) {
    var overlays = seatOverlaysVisible();
    var leaderboard = leaderboardVisible();
    if (surface === 'overlays') overlays = enabled;
    if (surface === 'leaderboard') leaderboard = enabled;
    return PokerHudSettings.modeForVisibility(overlays, leaderboard);
  }

  function writeVisibilityState(nextSeatOverlaysEnabled, nextLeaderboardEnabled, source) {
    var nextPreferences = PokerHudSettings.merge(hudUiPreferences, {
      seatOverlaysEnabled: Boolean(nextSeatOverlaysEnabled),
      leaderboardEnabled: Boolean(nextLeaderboardEnabled)
    });
    var normalized = PokerHudSettings.modeForVisibility(nextPreferences.seatOverlaysEnabled, nextPreferences.leaderboardEnabled);
    if (PokerHudSettings.equal(hudUiPreferences, nextPreferences) && normalized === displayMode) return false;
    applyHudUiPreference(nextPreferences, source || 'visibility-change');
    displayMode = normalized;
    renderSettingsPanel();
    var update = {};
    update[STORAGE_KEYS.displayMode] = normalized;
    update[STORAGE_KEYS.hudUiPreferences] = nextPreferences;
    chrome.storage.local.set(update, refreshHud);
    return true;
  }

  function writeDisplayMode(nextMode, source) {
    var visibility = PokerHudSettings.visibilityForMode(nextMode);
    return writeVisibilityState(visibility.seatOverlaysEnabled, visibility.leaderboardEnabled, source || 'display-mode');
  }

  function resetInterfaceConfiguration() {
    if (typeof window.confirm === 'function' && !window.confirm('Reset HUD interface settings? Poker statistics will be kept.')) return;
    updateDisplayedStatIds(PokerOverlayStats.DEFAULT_DISPLAYED_STAT_IDS.slice(), 'reset-defaults');
    applyLeaderboardStatPreference(PokerLeaderboardStats.DEFAULTS, 'reset-defaults');
    leaderboardHudPosition = Object.assign({}, PokerLeaderboardHudPosition.DEFAULTS);
    leaderboardHudPositionDiagnostics.storedPosition = null;
    leaderboardHudPositionDiagnostics.locked = true;
    leaderboardHudPositionDiagnostics.lastPositionChangeSource = 'interface-reset';
    manualOverlayPositions = {};
    var defaults = Object.assign({}, PokerHudSettings.DEFAULTS);
    applyHudUiPreference(defaults, 'reset-configuration');
    displayMode = PokerHudSettings.modeForVisibility(defaults.seatOverlaysEnabled, defaults.leaderboardEnabled);
    overlayDraggingUnlocked = false;
    showOverlayBoxes = false;
    debugSeatIdentity = false;
    showWithheldPlaceholders = false;
    var update = {};
    update[STORAGE_KEYS.hudUiPreferences] = hudUiPreferences;
    update[STORAGE_KEYS.leaderboardStatPreferences] = {
      version: leaderboardStatPreferences.version,
      syncWithOverlay: leaderboardStatPreferences.syncWithOverlay,
      displayedStatIds: leaderboardStatPreferences.displayedStatIds.slice()
    };
    update[STORAGE_KEYS.leaderboardHudPosition] = leaderboardHudPosition;
    update[STORAGE_KEYS.displayMode] = displayMode;
    update[STORAGE_KEYS.manualOverlayPositions] = {};
    update[STORAGE_KEYS.overlayDraggingUnlocked] = false;
    update[STORAGE_KEYS.showOverlayBoxes] = false;
    update[STORAGE_KEYS.debugSeatIdentity] = false;
    update[STORAGE_KEYS.showWithheldPlaceholders] = false;
    chrome.storage.local.set(update, function () {
      refreshHud();
      renderSettingsPanel();
      if (settingsLauncher && settingsLauncher.isConnected) settingsLauncher.focus();
    });
  }

  function handleSettingsPanelClick(event) {
    var sectionButton = event.target.closest && event.target.closest('[data-settings-section]');
    if (sectionButton) {
      var settingsBefore = boardCompanionEventEssentials();
      var selectedSection = sectionButton.dataset.settingsSection;
      if (selectedSection !== 'diagnostics') PokerHandStatInspector.close(handStatInspectorState);
      if (selectedSection !== 'career-data') {
        careerDataUiState.removalRequestToken += 1;
        careerDataUiState.importRequestToken += 1;
        careerDataUiState.restoreRequestToken += 1;
        careerDataUiState.removalFlowActive = false;
        if (!careerDataUiState.removalPreview) careerDataUiState.busy = false;
        careerDataUiState.preview = null;
        careerDataUiState.backupCandidate = null;
        careerDataUiState.importPreview = null;
        careerDataUiState.importCandidate = null;
        careerDataUiState.removalPreview = null;
        careerDataUiState.removalRequest = null;
        careerDataUiState.activeFlow = null;
      }
      updateHudUiPreferences({ selectedSettingsSection: selectedSection }, 'settings-navigation', { render: false });
      renderSettingsPanel();
      recordSettingsBoardCompanionTransition('settings-tab-switch', 'Settings tab switched to ' + selectedSection, settingsBefore);
      var activeSectionButton = settingsPanel.querySelector('[data-settings-section="' + selectedSection + '"]');
      if (activeSectionButton) activeSectionButton.focus();
      return;
    }
    if (event.target.closest && event.target.closest('.pnhud-settings-close')) return setSettingsOpen(false, 'settings-close-button');
    if (event.target.closest && event.target.closest('.pnhud-data-reset-session')) return resetCurrentSession();
    if (event.target.closest && event.target.closest('.pnhud-career-remove-session')) return prepareCurrentSessionCareerRemoval();
    if (event.target.closest && event.target.closest('.pnhud-career-confirm-removal')) return confirmCurrentSessionCareerRemoval();
    if (event.target.closest && event.target.closest('.pnhud-career-cancel-removal')) return cancelCurrentSessionCareerRemoval();
    if (event.target.closest && event.target.closest('.pnhud-career-export')) return exportCareerBackupFromSettings();
    if (event.target.closest && event.target.closest('.pnhud-career-import-select')) {
      var careerImportFileInput = settingsPanel.querySelector('.pnhud-career-import-file-input');
      if (careerImportFileInput) careerImportFileInput.click();
      return;
    }
    if (event.target.closest && event.target.closest('.pnhud-career-restore-select')) {
      var careerFileInput = settingsPanel.querySelector('.pnhud-career-restore-file-input');
      if (careerFileInput) careerFileInput.click();
      return;
    }
    if (event.target.closest && event.target.closest('.pnhud-career-confirm-import')) return confirmCareerImport();
    if (event.target.closest && event.target.closest('.pnhud-career-cancel-import')) return cancelCareerImportPreview();
    if (event.target.closest && event.target.closest('.pnhud-career-confirm-restore')) return confirmCareerRestore();
    if (event.target.closest && event.target.closest('.pnhud-career-cancel-restore')) return cancelCareerRestorePreview();
    if (event.target.closest && event.target.closest('.pnhud-open-hand-stat-inspector')) return openHandStatInspector();
    if (event.target.closest && event.target.closest('.pnhud-close-hand-stat-inspector')) return closeHandStatInspector();
    var selectedInspectorHand = event.target.closest && event.target.closest('[data-pnhud-inspector-hand-id]');
    if (selectedInspectorHand) {
      PokerHandStatInspector.select(handStatInspectorState, PokerHandStatExplanation.list(statExplanationState), selectedInspectorHand.dataset.pnhudInspectorHandId);
      refreshHandStatInspectorView('hand:' + selectedInspectorHand.dataset.pnhudInspectorHandId, true);
      return;
    }
    if (event.target.closest && event.target.closest('.pnhud-hand-stat-show-all')) {
      PokerHandStatInspector.toggleShowAll(handStatInspectorState);
      refreshHandStatInspectorView('show-all');
      return;
    }
    if (event.target.closest && event.target.closest('.pnhud-copy-hand-stat-summary')) return copyHandStatInspector('summary');
    if (event.target.closest && event.target.closest('.pnhud-copy-hand-stat-json')) return copyHandStatInspector('json');
    if (event.target.closest && event.target.closest('.pnhud-inspect-profile-score')) return inspectProfileScore();
    var profileEvidence = event.target.closest && event.target.closest('[data-pnhud-profile-score-details]');
    if (profileEvidence) {
      PokerPlayerProfileScoreInspector.toggleDetails(playerProfileScoreInspectorState, profileEvidence.dataset.pnhudProfileScoreDetails);
      return refreshProfileScoreInspectorView('[data-pnhud-profile-score-details="' + profileEvidence.dataset.pnhudProfileScoreDetails + '"]');
    }
    if (event.target.closest && event.target.closest('.pnhud-copy-profile-score-summary')) return copyProfileScoreInspector('summary');
    if (event.target.closest && event.target.closest('.pnhud-copy-profile-score-json')) return copyProfileScoreInspector('json');
    if (event.target.closest && event.target.closest('.pnhud-unlock-overlays')) {
      var unlock = {}; unlock[STORAGE_KEYS.overlayDraggingUnlocked] = true; chrome.storage.local.set(unlock); return;
    }
    if (event.target.closest && event.target.closest('.pnhud-lock-overlays')) {
      var lock = {}; lock[STORAGE_KEYS.overlayDraggingUnlocked] = false; chrome.storage.local.set(lock); return;
    }
    if (event.target.closest && event.target.closest('.pnhud-reset-overlays')) return resetOverlayPositions('settings overlay section');
    if (event.target.closest && event.target.closest('.pnhud-reset-player-dashboard-position')) return resetPlayerDashboardPosition();
    if (event.target.closest && event.target.closest('.pnhud-unlock-leaderboard')) return updateLeaderboardHudLock(false, 'settings-unlock');
    if (event.target.closest && event.target.closest('.pnhud-lock-leaderboard')) return updateLeaderboardHudLock(true, 'settings-lock');
    if (event.target.closest && event.target.closest('.pnhud-reset-leaderboard-position')) return resetLeaderboardHudPosition('reset-position');
    if (event.target.closest && event.target.closest('.pnhud-reset-pot-odds-position')) return resetPotOddsPosition('settings-reset-pot-odds-position');
    if (event.target.closest && event.target.closest('.pnhud-copy-diagnostics')) return copyDiagnostics();
    if (event.target.closest && event.target.closest('.pnhud-mark-next-pause')) return armPauseDiagnosticMarker('pause');
    if (event.target.closest && event.target.closest('.pnhud-mark-next-resume')) return armPauseDiagnosticMarker('resume');
    if (event.target.closest && event.target.closest('.pnhud-clear-pause-capture')) return clearPauseDiagnosticCapture();
    if (event.target.closest && event.target.closest('.pnhud-export-pause-capture')) return exportPauseDiagnosticCapture();
    if (event.target.closest && event.target.closest('.pnhud-inspect-seats')) return inspectSeats('settings diagnostics');
    if (event.target.closest && event.target.closest('.pnhud-mark-hand-start')) return markHandTransition('start');
    if (event.target.closest && event.target.closest('.pnhud-mark-hand-end')) return markHandTransition('end');
    if (event.target.closest && event.target.closest('.pnhud-copy-hand-sequence')) return copyHandSequence();
    if (event.target.closest && event.target.closest('.pnhud-copy-action-sequence')) return copyActionSequence();
    if (event.target.closest && event.target.closest('.pnhud-inject-test')) return injectTestEvent();
    var accent = event.target.closest && event.target.closest('[data-accent-theme]');
    if (accent) return updateHudUiPreferences({ accentTheme: accent.dataset.accentTheme }, 'appearance-accent');
    if (event.target.closest && event.target.closest('.pnhud-reset-configuration')) return resetInterfaceConfiguration();
  }

  function handleSettingsPanelInput(event) {
    if (event.target.classList.contains('pnhud-dashboard-opacity')) {
      var dashboardOpacity = Math.max(0.1, Math.min(1, Number(event.target.value) / 100));
      var dashboardRoot = document.getElementById(playerDashboardId);
      if (dashboardRoot) dashboardRoot.style.setProperty('--pnhud-dashboard-background-opacity', String(dashboardOpacity));
      var dashboardOutput = settingsPanel.querySelector('.pnhud-dashboard-opacity-value');
      if (dashboardOutput) dashboardOutput.textContent = Math.round(dashboardOpacity * 100) + '%';
      return;
    }
    if (event.target.classList.contains('pnhud-settings-panel-opacity')) {
      var settingsOpacity = Math.max(0.1, Math.min(1, Number(event.target.value) / 100));
      if (settingsPanel) {
        settingsPanel.style.setProperty('--pnhud-settings-background-opacity', String(settingsOpacity));
        settingsPanel.style.setProperty('--pnhud-settings-surface-opacity', String(Math.max(0.1, Math.min(0.34, settingsOpacity * 0.34))));
      }
      var settingsOutput = settingsPanel.querySelector('.pnhud-settings-panel-opacity-value');
      if (settingsOutput) settingsOutput.textContent = Math.round(settingsOpacity * 100) + '%';
      return;
    }
    if (!event.target.classList.contains('pnhud-settings-opacity')) return;
    var opacity = Math.max(0.1, Math.min(1, Number(event.target.value) / 100));
    var detailsRoot = document.getElementById(detailsRootId);
    if (detailsRoot) {
      detailsRoot.style.setProperty('--pnhud-hud-opacity', String(opacity));
      detailsRoot.style.setProperty('--pnhud-surface-opacity', String(Math.max(0.04, Math.min(0.18, opacity * 0.16))));
    }
    var output = settingsPanel.querySelector('.pnhud-opacity-value');
    if (output) output.textContent = Math.round(opacity * 100) + '%';
  }

  function handleSettingsPanelChange(event) {
    if (event.target.classList.contains('pnhud-career-import-file-input')) {
      var careerImportFile = event.target.files && event.target.files[0];
      event.target.value = '';
      return previewCareerImportFile(careerImportFile);
    }
    if (event.target.classList.contains('pnhud-career-restore-file-input')) {
      var careerBackupFile = event.target.files && event.target.files[0];
      event.target.value = '';
      return previewCareerBackupFile(careerBackupFile);
    }
    if (event.target.classList.contains('pnhud-profile-score-player')) {
      return playerProfileScoreInspectorUi.change(event.target.value);
    }
    if (event.target.classList.contains('pnhud-settings-display-mode')) return writeDisplayMode(event.target.value, 'settings-display-mode');
    if (event.target.classList.contains('pnhud-settings-overlays-visible')) return writeVisibilityState(event.target.checked, leaderboardVisible(), 'settings-seat-overlays');
    if (event.target.classList.contains('pnhud-settings-leaderboard-visible')) return writeVisibilityState(seatOverlaysVisible(), event.target.checked, 'settings-leaderboard');
    if (event.target.classList.contains('pnhud-settings-sync-leaderboard')) return updateLeaderboardSync(event.target.checked, event.target.checked ? 'sync-enabled' : 'sync-disabled');
    if (event.target.name === 'pnhud-leaderboard-stat-source') return updateLeaderboardSource(event.target.value);
    if (event.target.classList.contains('pnhud-settings-opportunity-layout')) {
      if (updateHudUiPreferences({ opportunityStatsLayout: event.target.value }, 'overlay-opportunity-layout')) refreshHud();
      return;
    }
    if (event.target.name === 'pnhud-seat-hud-stat-source') {
      var nextSeatHudSource = PokerSeatOverlay.normalizeStatSource(event.target.value);
      if (updateHudUiPreferences({ seatHudStatSource: nextSeatHudSource }, 'seat-hud-stat-source')) {
        seatHudCareerRequestToken += 1;
        seatHudCareerPendingSignature = '';
        if (nextSeatHudSource === 'career') {
          seatHudCareerLoadedSignature = '';
          requestSeatHudCareerBatch(Array.from(confirmedSeatMappings.keys()), 'Settings source switch', true);
        }
        refreshHud();
      }
      return;
    }
    if (event.target.classList.contains('pnhud-settings-player-profiles')) {
      if (updateHudUiPreferences({ showPlayerProfiles: event.target.checked }, 'overlay-player-profiles')) refreshHud();
      return;
    }
    if (event.target.classList.contains('pnhud-settings-pot-odds')) {
      if (updateHudUiPreferences({ showPotOdds: event.target.checked }, 'hud-pot-odds')) refreshPotOddsFromLedger('setting changed');
      return;
    }
    if (event.target.classList.contains('pnhud-settings-opacity')) return updateHudUiPreferences({ hudOpacity: Number(event.target.value) / 100 }, 'appearance-opacity');
    if (event.target.classList.contains('pnhud-settings-panel-opacity')) return updateHudUiPreferences({ settingsBackgroundOpacity: Number(event.target.value) / 100 }, 'appearance-settings-opacity');
    if (event.target.classList.contains('pnhud-dashboard-opacity')) return updateHudUiPreferences({ dashboardBackgroundOpacity: Number(event.target.value) / 100 }, 'appearance-dashboard-opacity');
    if (event.target.classList.contains('pnhud-settings-hud-size')) return updateHudUiPreferences({ hudSize: event.target.value }, 'appearance-size');
    if (event.target.classList.contains('pnhud-settings-developer-tools')) return updateHudUiPreferences({ developerToolsVisible: event.target.checked }, 'diagnostics-developer-tools');
    if (event.target.classList.contains('pnhud-settings-pause-capture')) {
      var pauseCaptureUpdate = {};
      pauseCaptureUpdate[STORAGE_KEYS.pauseLifecycleCaptureEnabled] = event.target.checked;
      chrome.storage.local.set(pauseCaptureUpdate);
      return;
    }
    if (event.target.classList.contains('pnhud-settings-debug-identity')) {
      var identityUpdate = {}; identityUpdate[STORAGE_KEYS.debugSeatIdentity] = event.target.checked; chrome.storage.local.set(identityUpdate); return;
    }
    if (event.target.classList.contains('pnhud-settings-withheld')) {
      var withheldUpdate = {}; withheldUpdate[STORAGE_KEYS.showWithheldPlaceholders] = event.target.checked; chrome.storage.local.set(withheldUpdate);
    }
    if (event.target.classList.contains('pnhud-settings-anchor-boxes')) {
      var anchorUpdate = {}; anchorUpdate[STORAGE_KEYS.showOverlayBoxes] = event.target.checked; chrome.storage.local.set(anchorUpdate);
    }
  }

  function ensureSettingsUi() {
    if (!document.body || extensionCleanedUp) return;
    var panelCreatedNow = false;
    settingsLauncher = document.getElementById(settingsLauncherId);
    if (!settingsLauncher) {
      settingsLauncher = document.createElement('button');
      settingsLauncher.id = settingsLauncherId;
      settingsLauncher.className = 'pnhud-settings-launcher';
      settingsLauncher.type = 'button';
      settingsLauncher.innerHTML = '<span aria-hidden="true">\u2699</span> Settings';
      settingsLauncher.setAttribute('aria-controls', settingsPanelId);
      settingsLauncher.setAttribute('aria-haspopup', 'dialog');
      settingsLauncher.dataset.pnhudOwned = 'true';
      settingsLauncher.setAttribute('data-pnhud-owned', 'true');
      document.body.appendChild(settingsLauncher);
      settingsUiDiagnostics.launcherCreated = true;
    }
    if (settingsLauncher.dataset.pnhudOwned !== 'true') settingsLauncher.dataset.pnhudOwned = 'true';
    if (settingsLauncher.getAttribute('data-pnhud-owned') !== 'true') settingsLauncher.setAttribute('data-pnhud-owned', 'true');
    if (settingsLauncher.dataset.pnhudSettingsBound !== 'true') {
      settingsLauncher.dataset.pnhudSettingsBound = 'true';
      settingsLauncher.addEventListener('click', function () { setSettingsOpen(!hudUiPreferences.settingsOpen, 'settings-launcher'); });
    } else {
      settingsUiDiagnostics.duplicateListenerPreventions += 1;
    }
    settingsPanel = document.getElementById(settingsPanelId);
    if (!settingsPanel) {
      settingsPanel = document.createElement('section');
      settingsPanel.id = settingsPanelId;
      settingsPanel.className = 'pnhud-settings-panel';
      settingsPanel.setAttribute('role', 'dialog');
      settingsPanel.setAttribute('aria-modal', 'false');
      settingsPanel.setAttribute('aria-label', 'PokerNow Stats HUD settings');
      settingsPanel.dataset.pnhudOwned = 'true';
      settingsPanel.setAttribute('data-pnhud-owned', 'true');
      document.body.appendChild(settingsPanel);
      settingsUiDiagnostics.settingsPanelCreated = true;
      panelCreatedNow = true;
    }
    if (settingsPanel.dataset.pnhudOwned !== 'true') settingsPanel.dataset.pnhudOwned = 'true';
    if (settingsPanel.getAttribute('data-pnhud-owned') !== 'true') settingsPanel.setAttribute('data-pnhud-owned', 'true');
    if (settingsPanel.dataset.pnhudSettingsBound !== 'true') {
      settingsPanel.dataset.pnhudSettingsBound = 'true';
      settingsPanel.addEventListener('click', handleSettingsPanelClick);
      settingsPanel.addEventListener('input', handleSettingsPanelInput);
      settingsPanel.addEventListener('change', handleSettingsPanelChange);
    } else {
      settingsUiDiagnostics.duplicateListenerPreventions += 1;
    }
    if (!settingsKeydownListener) {
      settingsKeydownListener = function (event) {
        if (event.key === 'Escape' && pauseDiagnosticCaptureState.pendingMarker) {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelPauseDiagnosticMarker('escape-key');
          return;
        }
        if (event.key === 'Escape' && statTooltipUiDiagnostics.tooltipVisible) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeStatTooltip('escape-key');
          return;
        }
        if (event.key === 'Escape' && handStatInspectorState.open) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeHandStatInspector();
          return;
        }
        if (event.key === 'Escape' && careerDataUiState.preview && hudUiPreferences.settingsOpen) {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelCareerRestorePreview();
          return;
        }
        if (event.key === 'Escape' && careerDataUiState.importPreview && hudUiPreferences.settingsOpen) {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelCareerImportPreview();
          return;
        }
        if (event.key === 'Escape' && careerDataUiState.removalPreview && hudUiPreferences.settingsOpen) {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelCurrentSessionCareerRemoval();
          return;
        }
        if (event.key === 'Escape' && playerDashboardState.open) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closePlayerDashboard();
          return;
        }
        if (event.key === 'Escape' && hudUiPreferences.settingsOpen) {
          event.preventDefault();
          setSettingsOpen(false, 'escape-key');
        }
      };
      document.addEventListener('keydown', settingsKeydownListener, true);
    } else {
      settingsUiDiagnostics.duplicateListenerPreventions += 1;
    }
    if (panelCreatedNow || !settingsPanel.innerHTML) renderSettingsPanel();
    else applyHudUiAppearance();
  }

  function validAnchorRect(rect) {
    return Boolean(rect && Number.isFinite(rect.left) && Number.isFinite(rect.top) &&
      Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0);
  }

  function viewportRect(element) {
    if (!element || !element.isConnected || (seatOverlayLayer && seatOverlayLayer.contains(element))) return null;
    var rect = element.getBoundingClientRect();
    if (!validAnchorRect(rect) || rect.width > 480 || rect.height > 260) return null;
    var style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return null;
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  }

  function collectOverlayObstacles(anchorRect) {
    var obstacles = [{ kind: 'assigned name/stack union', rect: anchorRect }];
    var selector = [
      '.table-player-name', '.table-player-stack',
      '.table-player-cards', '[class*="hole-card" i]', '[class*="player-card" i]',
      '.table-player-bet-value', '[class*="dealer" i]', '[class*="blind" i]',
      '[class*="bet-chip" i]', '[class*="bet-value" i]',
      '[class*="table-control" i]', '[class*="game-control" i]',
      '[class*="action-button" i]', '[class*="controls" i] button',
      '.game-controls button', '.table-controls button'
    ].join(',');
    Array.from(document.querySelectorAll(selector)).forEach(function (element) {
      var rect = viewportRect(element);
      if (rect) obstacles.push({ kind: String(element.className || element.tagName || 'table obstacle'), rect: rect });
    });
    var seen = new Set();
    return obstacles.filter(function (item) {
      var rect = item.rect;
      if (!validAnchorRect(rect)) return false;
      var key = [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isInteractiveDragExclusionTarget(target) {
    return Boolean(target && target.closest && target.closest([
      'button', 'a', 'input', 'select', 'textarea', '[contenteditable="true"]',
      '[data-pnhud-interactive]', '.pnhud-stat-tooltip-target',
      '.pnhud-tabs', 'th', 'td'
    ].join(',')));
  }

  function leaderboardViewport() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function leaderboardHudElement() {
    return document.getElementById(rootId);
  }

  function persistLeaderboardHudPosition(source) {
    leaderboardHudPositionDiagnostics.storedPosition = cloneJson(leaderboardHudPosition);
    leaderboardHudPositionDiagnostics.locked = leaderboardHudPosition.locked;
    leaderboardHudPositionDiagnostics.lastPositionChangeSource = source || 'unknown';
    var update = {};
    update[STORAGE_KEYS.leaderboardHudPosition] = cloneJson(leaderboardHudPosition);
    chrome.storage.local.set(update);
  }

  function applyLeaderboardHudPosition(source, persistClamp) {
    var element = leaderboardHudElement();
    if (!element || !element.isConnected) return null;
    var rect = element.getBoundingClientRect();
    // A closed details root has no rendered size. Do not persist a clamp based
    // on invented dimensions; the visible render will apply the saved intent.
    if (!(rect.width > 0 && rect.height > 0)) return null;
    var size = { width: rect.width, height: rect.height };
    var requested = leaderboardHudPosition.x === null || leaderboardHudPosition.y === null
      ? PokerLeaderboardHudPosition.defaultPosition(size, leaderboardViewport())
      : { x: leaderboardHudPosition.x, y: leaderboardHudPosition.y };
    var placement = PokerLeaderboardHudPosition.clamp(requested, size, leaderboardViewport());
    element.style.left = placement.x + 'px';
    element.style.top = placement.y + 'px';
    element.style.right = 'auto';
    element.classList.toggle('pnhud-leaderboard-drag-unlocked', !leaderboardHudPosition.locked);
    element.classList.toggle('pnhud-leaderboard-dragging', Boolean(activeLeaderboardHudDrag));
    leaderboardHudPositionDiagnostics.effectivePosition = { x: placement.x, y: placement.y };
    leaderboardHudPositionDiagnostics.locked = leaderboardHudPosition.locked;
    leaderboardHudPositionDiagnostics.viewportClamped = placement.clamped;
    leaderboardHudPositionDiagnostics.lastPositionChangeSource = source || leaderboardHudPositionDiagnostics.lastPositionChangeSource;
    if (placement.clamped && leaderboardHudPosition.x !== null && leaderboardHudPosition.y !== null) {
      var changed = leaderboardHudPosition.x !== placement.x || leaderboardHudPosition.y !== placement.y;
      leaderboardHudPosition.x = placement.x;
      leaderboardHudPosition.y = placement.y;
      if (changed && persistClamp) persistLeaderboardHudPosition(source || 'viewport-clamp');
    }
    return placement;
  }

  function updateLeaderboardHudLock(locked, source) {
    locked = Boolean(locked);
    if (leaderboardHudPosition.locked === locked) return false;
    if (locked && activeLeaderboardHudDrag) finishLeaderboardHudDrag(null, false);
    leaderboardHudPosition.locked = locked;
    persistLeaderboardHudPosition(source || (locked ? 'settings-lock' : 'settings-unlock'));
    applyLeaderboardHudPosition(source || 'lock-change', false);
    renderSettingsPanel();
    return true;
  }

  function resetLeaderboardHudPosition(source) {
    if (activeLeaderboardHudDrag) finishLeaderboardHudDrag(null, true);
    // Null coordinates persist the canonical default, independent of visibility
    // and panel size. Only a subsequent completed drag creates custom coordinates.
    leaderboardHudPosition.x = null;
    leaderboardHudPosition.y = null;
    applyLeaderboardHudPosition(source || 'reset-position', false);
    persistLeaderboardHudPosition(source || 'reset-position');
  }

  function moveLeaderboardHudDrag(event) {
    if (!activeLeaderboardHudDrag) return;
    if (activeLeaderboardHudDrag.pointerId !== null && event.pointerId !== undefined && event.pointerId !== activeLeaderboardHudDrag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    var drag = activeLeaderboardHudDrag;
    var placement = PokerLeaderboardHudPosition.clamp({
      x: drag.startX + Number(event.clientX) - drag.startClientX,
      y: drag.startY + Number(event.clientY) - drag.startClientY
    }, { width: drag.width, height: drag.height }, leaderboardViewport());
    drag.currentX = placement.x;
    drag.currentY = placement.y;
    drag.moved = drag.moved || Math.abs(placement.x - drag.startX) >= 1 || Math.abs(placement.y - drag.startY) >= 1;
    drag.element.style.left = placement.x + 'px';
    drag.element.style.top = placement.y + 'px';
    leaderboardHudPositionDiagnostics.effectivePosition = { x: placement.x, y: placement.y };
  }

  function finishLeaderboardHudDrag(event, cancelled) {
    if (!activeLeaderboardHudDrag) return;
    if (event && activeLeaderboardHudDrag.pointerId !== null && event.pointerId !== undefined && event.pointerId !== activeLeaderboardHudDrag.pointerId) return;
    var drag = activeLeaderboardHudDrag;
    activeLeaderboardHudDrag = null;
    leaderboardHudPositionDiagnostics.activeDrag = false;
    document.documentElement.classList.remove('pnhud-leaderboard-hud-dragging');
    drag.element.classList.remove('pnhud-leaderboard-dragging');
    document.removeEventListener('pointermove', moveLeaderboardHudDrag, true);
    document.removeEventListener('pointerup', finishLeaderboardHudDrag, true);
    document.removeEventListener('pointercancel', cancelLeaderboardHudDrag, true);
    document.removeEventListener('mousemove', moveLeaderboardHudDrag, true);
    document.removeEventListener('mouseup', finishLeaderboardHudDrag, true);
    if (event) { event.preventDefault(); event.stopPropagation(); }
    if (!cancelled && drag.moved) {
      leaderboardHudPosition.x = drag.currentX;
      leaderboardHudPosition.y = drag.currentY;
      persistLeaderboardHudPosition('pointer-drag');
    } else {
      applyLeaderboardHudPosition(cancelled ? 'drag-cancelled' : 'drag-no-op', false);
    }
  }

  function cancelLeaderboardHudDrag(event) {
    finishLeaderboardHudDrag(event, true);
  }

  function beginLeaderboardHudDrag(element, event) {
    if (leaderboardHudPosition.locked || activeLeaderboardHudDrag || activeOverlayDrag || (event.button !== undefined && event.button !== 0)) return;
    if (!event.target.closest || !event.target.closest('.pnhud-header') || isInteractiveDragExclusionTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    closeStatTooltip('leaderboard drag');
    var rect = element.getBoundingClientRect();
    activeLeaderboardHudDrag = {
      pointerId: event.pointerId === undefined ? null : event.pointerId,
      element: element,
      startClientX: Number(event.clientX),
      startClientY: Number(event.clientY),
      startX: rect.left,
      startY: rect.top,
      currentX: rect.left,
      currentY: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false
    };
    leaderboardHudPositionDiagnostics.activeDrag = true;
    element.classList.add('pnhud-leaderboard-dragging');
    document.documentElement.classList.add('pnhud-leaderboard-hud-dragging');
    document.addEventListener('pointermove', moveLeaderboardHudDrag, true);
    document.addEventListener('pointerup', finishLeaderboardHudDrag, true);
    document.addEventListener('pointercancel', cancelLeaderboardHudDrag, true);
    if (!window.PointerEvent) {
      document.addEventListener('mousemove', moveLeaderboardHudDrag, true);
      document.addEventListener('mouseup', finishLeaderboardHudDrag, true);
    }
  }

  function installLeaderboardHudDragBehavior(element) {
    if (!element) return;
    if (leaderboardHudDragBehavior && leaderboardHudDragBehavior.element === element) {
      leaderboardHudPositionDiagnostics.dragListenerInstalled = true;
      return;
    }
    if (leaderboardHudDragBehavior && leaderboardHudDragBehavior.element) {
      leaderboardHudDragBehavior.element.removeEventListener('pointerdown', leaderboardHudDragBehavior.pointerDown);
      leaderboardHudDragBehavior.element.removeEventListener('mousedown', leaderboardHudDragBehavior.mouseDown);
    }
    var pointerDown = function (event) { beginLeaderboardHudDrag(element, event); };
    var mouseDown = function (event) { beginLeaderboardHudDrag(element, event); };
    element.addEventListener('pointerdown', pointerDown);
    if (!window.PointerEvent) element.addEventListener('mousedown', mouseDown);
    leaderboardHudDragBehavior = { element: element, pointerDown: pointerDown, mouseDown: mouseDown };
    leaderboardHudPositionDiagnostics.dragListenerInstalled = true;
  }

  function persistManualOverlayPositions() {
    var update = {};
    update[STORAGE_KEYS.manualOverlayPositions] = manualOverlayPositions;
    chrome.storage.local.set(update);
  }

  function recordOverlayDragTrace(eventType, details) {
    var event = Object.assign({ sequence: ++overlayDragTraceSequence, timestamp: Date.now(), eventType: String(eventType || 'drag-event') }, details || {});
    var previous = overlayDragTimeline[overlayDragTimeline.length - 1];
    if (event.eventType === 'pointermove' && previous && previous.eventType === 'pointermove' && previous.pointerId === event.pointerId && previous.playerId === event.playerId) {
      previous.repeatCount = Number(previous.repeatCount || 1) + 1;
      previous.timestamp = event.timestamp;
      previous.clientX = event.clientX;
      previous.clientY = event.clientY;
      previous.transform = event.transform;
      return previous;
    }
    event.repeatCount = 1;
    overlayDragTimeline.push(event);
    if (overlayDragTimeline.length > 50) overlayDragTimeline.shift();
    console.log('[HUD DRAG TRACE]', event);
    return event;
  }

  function resetOverlayPositions(reason) {
    manualOverlayPositions = {};
    var prefix = 'pokerNowHudManualOverlayPositions:game:';
    chrome.storage.local.get(null, function (saved) {
      var keys = Object.keys(saved || {}).filter(function (key) { return key.indexOf(prefix) === 0; });
      chrome.storage.local.remove(keys, function () {
        persistManualOverlayPositions();
        console.log('[HUD SEAT OVERLAY] all manual positions reset', { gameId: pokerNowGameId, storageNamespace: storageNamespace, removedStorageKeys: keys.length, reason: reason || 'user reset' });
        scheduleSeatOverlayReconcile('all manual overlay positions reset to canonical under-player positions');
      });
    });
  }

  function applyOverlayDragState(element) {
    if (!element) return;
    element.classList.toggle('pnhud-drag-unlocked', overlayDraggingUnlocked);
    var grip = element.querySelector('.pnhud-overlay-grip');
    if (grip) grip.disabled = !overlayDraggingUnlocked;
  }

  function persistFinishedOverlayDrag(drag, cancelled) {
    if (cancelled) {
      scheduleSeatOverlayReconcile('overlay drag cancelled');
      return;
    }
    var record = seatOverlayController && seatOverlayController.records.get(drag.playerId);
    var entry = record && record.entry;
    var offset = entry && record.lastPlacement && record.canonicalPlacement && PokerSeatOverlay.relativeOffset(record.canonicalPlacement, record.lastPlacement);
    if (!offset) return;
    manualOverlayPositions[drag.playerId] = { playerId: drag.playerId, seatId: entry.seatId, offsetX: offset.offsetX, offsetY: offset.offsetY };
    persistManualOverlayPositions();
    recordOverlayDragTrace('position-persisted', { playerId: drag.playerId, pointerId: drag.pointerId, offsetX: offset.offsetX, offsetY: offset.offsetY });
    console.log('[HUD DRAG] offset persisted', { playerId: drag.playerId, overlayId: drag.element.id || null, locked: !overlayDraggingUnlocked, gameId: pokerNowGameId, offsets: manualOverlayPositions[drag.playerId] });
  }

  function finishOverlayDrag(event, cancelled) {
    if (!activeOverlayDrag) return;
    if (event && activeOverlayDrag.pointerId !== null && event.pointerId !== undefined && event.pointerId !== activeOverlayDrag.pointerId) return;
    var drag = activeOverlayDrag;
    var finishEventType = event ? (cancelled ? 'pointercancel' : 'pointerup') : (cancelled ? 'programmatic-cancel' : 'programmatic-finish');
    recordOverlayDragTrace(finishEventType, { playerId: drag.playerId, pointerId: drag.pointerId, elementConnected: Boolean(drag.element && drag.element.isConnected), cancelled: Boolean(cancelled) });
    activeOverlayDrag = null;
    document.removeEventListener('pointermove', moveOverlayDrag, true);
    document.removeEventListener('pointerup', finishOverlayDrag, true);
    document.removeEventListener('pointercancel', cancelOverlayDrag, true);
    document.removeEventListener('mousemove', moveOverlayDrag, true);
    document.removeEventListener('mouseup', finishOverlayDrag, true);
    document.documentElement.classList.remove('pnhud-overlay-dragging');
    drag.element.classList.remove('pnhud-dragging');
    if (event) { event.preventDefault(); event.stopPropagation(); }
    persistFinishedOverlayDrag(drag, Boolean(cancelled));
    scheduleNativePanelOcclusion('seat HUD drag finished');
    var deferredDiscovery = deferredSeatDiscoveryDuringOverlayDrag;
    var deferredReconcile = deferredSeatReconcileDuringOverlayDrag;
    deferredSeatDiscoveryDuringOverlayDrag = null;
    deferredSeatReconcileDuringOverlayDrag = null;
    if (deferredDiscovery || deferredReconcile) recordOverlayDragTrace('deferred-seat-work-flushed', { playerId: drag.playerId, pointerId: drag.pointerId, discoveryReason: deferredDiscovery, reconcileReason: deferredReconcile });
    if (deferredDiscovery) scheduleSeatDiscovery('deferred until overlay drag completed: ' + deferredDiscovery);
    else if (deferredReconcile) scheduleSeatOverlayReconcile('deferred until overlay drag completed: ' + deferredReconcile);
    scheduleHeroPotOddsAnchorReconcile('seat HUD drag finished');
  }

  function cancelOverlayDrag(event) {
    finishOverlayDrag(event, true);
  }

  function moveOverlayDrag(event) {
    if (!activeOverlayDrag) return;
    if (activeOverlayDrag.pointerId !== null && event.pointerId !== undefined && event.pointerId !== activeOverlayDrag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    var drag = activeOverlayDrag;
    var placement = PokerSeatOverlay.accessibleSeatHudPlacement({
      left: drag.startLeft + Number(event.clientX) - drag.startClientX,
      top: drag.startTop + Number(event.clientY) - drag.startClientY,
      width: drag.width,
      height: drag.height
    }, { width: window.innerWidth, height: window.innerHeight });
    drag.element.style.transform = 'translate3d(' + placement.left + 'px,' + placement.top + 'px,0)';
    recordOverlayDragTrace('pointermove', { playerId: drag.playerId, pointerId: drag.pointerId, clientX: Number(event.clientX), clientY: Number(event.clientY), transform: drag.element.style.transform });
    var record = seatOverlayController && seatOverlayController.records.get(drag.playerId);
    if (record) record.lastPlacement = Object.assign({ kind: 'manual-drag', manual: true }, placement);
    scheduleNativePanelOcclusion('seat HUD dragged');
  }

  function beginOverlayDrag(element, event) {
    event.stopPropagation();
    var grip = event.target.closest && event.target.closest('.pnhud-overlay-grip');
    recordOverlayDragTrace('pointerdown-received', { playerId: String(element.dataset.pnhudPlayerId || ''), pointerId: event.pointerId === undefined ? null : event.pointerId, gripMatched: Boolean(grip && element.contains(grip)), gripDisabled: Boolean(grip && grip.disabled), unlocked: overlayDraggingUnlocked, activeDrag: Boolean(activeOverlayDrag), button: event.button === undefined ? null : event.button });
    if (!grip || !element.contains(grip)) return;
    if (!overlayDraggingUnlocked || activeOverlayDrag || (event.button !== undefined && event.button !== 0)) {
      recordOverlayDragTrace('pointerdown-rejected', { playerId: String(element.dataset.pnhudPlayerId || ''), pointerId: event.pointerId === undefined ? null : event.pointerId, reason: !overlayDraggingUnlocked ? 'dragging locked' : activeOverlayDrag ? 'another drag active' : 'non-primary pointer button' });
      return;
    }
    event.preventDefault();
    var playerId = String(element.dataset.pnhudPlayerId || '');
    var record = seatOverlayController && seatOverlayController.records.get(playerId);
    if (!record || !record.entry) {
      recordOverlayDragTrace('pointerdown-rejected', { playerId: playerId, pointerId: event.pointerId === undefined ? null : event.pointerId, reason: 'overlay controller record unavailable' });
      return;
    }
    var rect = element.getBoundingClientRect();
    var last = record.lastPlacement || { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    activeOverlayDrag = {
      playerId: playerId,
      pointerId: event.pointerId === undefined ? null : event.pointerId,
      element: element,
      startClientX: Number(event.clientX),
      startClientY: Number(event.clientY),
      startLeft: Number(last.left),
      startTop: Number(last.top),
      width: rect.width || last.width || 132,
      height: rect.height || last.height || 18
    };
    console.log('[HUD DRAG] drag started', { playerId: playerId, overlayId: element.id || null, locked: !overlayDraggingUnlocked, gameId: pokerNowGameId, offsets: manualOverlayPositions[playerId] || null });
    element.classList.add('pnhud-dragging');
    document.documentElement.classList.add('pnhud-overlay-dragging');
    var captureEstablished = false;
    if (event.pointerId !== undefined && grip.setPointerCapture) {
      try {
        grip.setPointerCapture(event.pointerId);
        captureEstablished = !grip.hasPointerCapture || grip.hasPointerCapture(event.pointerId);
      } catch (captureError) { console.debug('[HUD SEAT OVERLAY] pointer capture unavailable', captureError); }
    }
    recordOverlayDragTrace('drag-started', { playerId: playerId, pointerId: activeOverlayDrag.pointerId, captureEstablished: captureEstablished, elementConnected: Boolean(element.isConnected), gripConnected: Boolean(grip.isConnected) });
    document.addEventListener('pointermove', moveOverlayDrag, true);
    document.addEventListener('pointerup', finishOverlayDrag, true);
    document.addEventListener('pointercancel', cancelOverlayDrag, true);
    if (!window.PointerEvent) {
      document.addEventListener('mousemove', moveOverlayDrag, true);
      document.addEventListener('mouseup', finishOverlayDrag, true);
    }
  }

  function installDragBehavior(element, playerId) {
    var existing = overlayDragBehaviors.get(element);
    if (existing) {
      applyOverlayDragState(element);
      console.log('[HUD DRAG] behavior already installed', { playerId: String(playerId), overlayId: element.id || null, locked: !overlayDraggingUnlocked, gameId: pokerNowGameId, offsets: manualOverlayPositions[String(playerId)] || null });
      return existing;
    }
    var pointerDown = function (event) { beginOverlayDrag(element, event); };
    var mouseDown = function (event) { beginOverlayDrag(element, event); };
    var stopPropagation = function (event) { event.stopPropagation(); };
    var openDashboard = function (event) {
      var button = event.target.closest && event.target.closest('.pnhud-player-name');
      if (!button) return;
      event.preventDefault(); event.stopPropagation();
      openPlayerDashboard(String(button.dataset.pnhudPlayerId || playerId), button.textContent, button);
    };
    element.addEventListener('pointerdown', pointerDown);
    if (!window.PointerEvent) element.addEventListener('mousedown', mouseDown);
    ['click', 'dblclick', 'contextmenu'].forEach(function (type) { element.addEventListener(type, stopPropagation); });
    element.addEventListener('click', openDashboard);
    var behavior = { playerId: String(playerId), pointerDown: pointerDown, mouseDown: mouseDown, stopPropagation: stopPropagation, openDashboard: openDashboard };
    overlayDragBehaviors.set(element, behavior);
    applyOverlayDragState(element);
    console.log('[HUD DRAG] behavior installed', { playerId: String(playerId), overlayId: element.id || null, locked: !overlayDraggingUnlocked, gameId: pokerNowGameId, offsets: manualOverlayPositions[String(playerId)] || null });
    return behavior;
  }

  function cleanupDragBehavior(element, playerId, reason) {
    var behavior = element && overlayDragBehaviors.get(element);
    if (!behavior) return;
    if (activeOverlayDrag && activeOverlayDrag.element === element) {
      recordOverlayDragTrace('drag-cancelled-by-overlay-removal', { playerId: String(playerId), pointerId: activeOverlayDrag.pointerId, reason: reason });
      finishOverlayDrag(null, true);
    }
    element.removeEventListener('pointerdown', behavior.pointerDown);
    element.removeEventListener('mousedown', behavior.mouseDown);
    ['click', 'dblclick', 'contextmenu'].forEach(function (type) { element.removeEventListener(type, behavior.stopPropagation); });
    element.removeEventListener('click', behavior.openDashboard);
    overlayDragBehaviors.delete(element);
    console.log('[HUD DRAG] cleanup', { playerId: String(playerId), overlayId: element.id || null, locked: !overlayDraggingUnlocked, gameId: pokerNowGameId, offsets: manualOverlayPositions[String(playerId)] || null, reason: reason });
  }

  var SEMANTIC_BLOCKING_PANEL_SELECTOR = 'dialog[open], [role="dialog"], [aria-modal="true"], [class*="ledger" i]';

  function isExtensionOwnedUiElement(element) {
    var current = element;
    while (current && current !== document.documentElement) {
      var id = String(current.id || '');
      var classes = [];
      try { classes = Array.from(current.classList || []); } catch (error) {}
      var ownedData = false;
      try {
        ownedData = current.getAttribute && current.getAttribute('data-pnhud-owned') === 'true' || Boolean(current.dataset && Object.keys(current.dataset).some(function (key) { return /^pnhud/.test(key); }));
      } catch (error) {}
      if (/^(?:pnhud-|pokernow-stats-hud-root$)/.test(id) || classes.some(function (name) { return /^pnhud-/.test(String(name)); }) || ownedData) return true;
      current = current.parentElement || current.host || null;
    }
    return false;
  }

  function seatHudSurfaceText(element) {
    return String(element && ((element.getAttribute && (element.getAttribute('aria-label') || element.getAttribute('data-title'))) || element.id || element.className || '') || '') + ' ' + String(element && (element.innerText || element.textContent) || '').slice(0, 500);
  }

  function isPokerNowChatSurface(element) {
    return /(?:^|[\s_-])chat(?:[\s_-]|$)/i.test(seatHudSurfaceText(element));
  }

  function seatHudLogControlLooksOpen(control) {
    if (!control || !control.isConnected || !isVisible(control)) return false;
    var expanded = control.getAttribute && (control.getAttribute('aria-expanded') === 'true' || control.getAttribute('aria-selected') === 'true' || control.getAttribute('aria-pressed') === 'true');
    var className = String(control.className || '');
    var active = /(?:^|[\s_-])(?:active|open|opened|selected)(?:[\s_-]|$)/i.test(className);
    return Boolean(expanded || active);
  }

  function expandedPanelTypeForControl(control) {
    var label = String(control && control.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (/^(?:game configurations?|preferences|video\s*\/\s*audio)$/.test(label)) return 'account_game_menu';
    if (/replay/.test(label)) return 'replayer';
    if (/ledger/.test(label)) return 'ledger';
    return 'session_log';
  }

  function expandedPokerNowPanelForControl(control) {
    if (!control || !control.isConnected || !isVisible(control)) return null;
    var menu = expandedPanelTypeForControl(control) === 'account_game_menu';
    var panelLabels = menu ? /^(?:Game Configurations?|Preferences|Video\s*\/\s*Audio)$/i : /^(?:Session Log|Full Log|Ledger|Log|Replayer|Replay)$/i;
    var current = control.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      if (!isExtensionOwnedUiElement(current) && isVisible(current)) {
        var rect = current.getBoundingClientRect();
        var descriptor = [current.id, String(current.className || '').replace(/pokernow-hud-expanded-panel-layer(?:-static)?/g, ''), current.getAttribute && current.getAttribute('role'), current.getAttribute && current.getAttribute('aria-label')].join(' ');
        var matchingControls = current.querySelectorAll ? Array.from(current.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"], a, li, [class*="tab" i], [class*="menu-item" i]')).filter(function (candidate) {
          return isVisible(candidate) && panelLabels.test(String(candidate.textContent || '').trim().replace(/\s+/g, ' '));
        }).length : 0;
        var activeControl = seatHudLogControlLooksOpen(control);
        var panelDescriptor = /(?:modal|drawer|dialog|panel|flyout|menu|session[\s_-]*log|logs?[\s_-]*(?:ctn|container)|ledger|replayer|replay)/i.test(descriptor);
        var positioned = /^(?:fixed|absolute)$/.test(String(getComputedStyle(current).position));
        var panelSized = rect && rect.width >= (menu ? 150 : 220) && rect.height >= (menu ? 60 : 100);
        // A launcher or generic app ancestor is not a panel. Multiple menu
        // items or log tabs must live in a credible panel/positioned root.
        if (panelSized && (panelDescriptor || positioned) && (menu ? matchingControls >= 2 : matchingControls >= 2 || activeControl || panelDescriptor)) return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function clearExpandedPokerNowPanelLayerMarker(nextPanel) {
    var retained = Array.isArray(nextPanel) ? nextPanel : nextPanel ? [nextPanel] : [];
    expandedPokerNowPanelLayerElements.forEach(function (_, panel) {
      if (retained.indexOf(panel) >= 0) return;
      panel.classList.remove('pokernow-hud-expanded-panel-layer', 'pokernow-hud-expanded-panel-layer-static');
      if (panel.dataset) delete panel.dataset.seatHudExpandedPanelType;
      expandedPokerNowPanelLayerElements.delete(panel);
    });
  }

  function applyExpandedPokerNowPanelLayerMarker(panel, panelType) {
    if (!panel || !panel.isConnected || !isVisible(panel)) return false;
    expandedPokerNowPanelLayerElements.set(panel, panelType);
    if (!panel.classList.contains('pokernow-hud-expanded-panel-layer')) panel.classList.add('pokernow-hud-expanded-panel-layer');
    if (String(getComputedStyle(panel).position || 'static') === 'static' && !panel.classList.contains('pokernow-hud-expanded-panel-layer-static')) panel.classList.add('pokernow-hud-expanded-panel-layer-static');
    if (panel.dataset && panel.dataset.seatHudExpandedPanelType !== panelType) panel.dataset.seatHudExpandedPanelType = panelType || 'session_log';
    return true;
  }

  function discoverSeatHudExpandedSurfaces() {
    var labels = /^(?:Session Log|Full Log|Ledger|Log|Replayer|Replay|Game Configurations?|Preferences|Video\s*\/\s*Audio)$/i;
    var controls = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"], a, li, [class*="tab" i], [class*="menu-item" i]')).filter(function (control) {
      return !isExtensionOwnedUiElement(control) && isVisible(control) && labels.test(String(control.textContent || '').trim().replace(/\s+/g, ' '));
    });
    var surfaces = [];
    controls.forEach(function (control) {
      var panel = expandedPokerNowPanelForControl(control);
      if (!panel) return;
      var current = surfaces.find(function (surface) { return surface.element === panel; });
      var kind = expandedPanelTypeForControl(control);
      if (current) { if (seatHudLogControlLooksOpen(control)) current.kind = kind; return; }
      if (surfaces.length < 8) surfaces.push({ element: panel, rect: panel.getBoundingClientRect(), kind: kind, blocking: false, expanded: true, evidence: kind === 'account_game_menu' ? 'multiple account/game menu commands in expanded root' : 'visible log/replay control in expanded root' });
    });
    return surfaces;
  }

  function refreshSeatHudLogPanelState(reason) {
    var labels = ['Session Log', 'Full Log', 'Ledger', 'Replayer', 'Replay', 'Log'];
    var controls = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], a, [class*="tab" i]')).filter(function (control) {
      return !isExtensionOwnedUiElement(control) && isVisible(control) && /^(?:Session Log|Full Log|Ledger|Replayer|Replay|Log)$/i.test(String(control.textContent || '').trim().replace(/\s+/g, ' '));
    });
    var candidates = controls.map(function (control) {
      return { control: control, panel: expandedPokerNowPanelForControl(control), active: seatHudLogControlLooksOpen(control), panelType: expandedPanelTypeForControl(control) };
    }).filter(function (candidate) { return candidate.panel; }).sort(function (left, right) {
      return Number(right.active) - Number(left.active) || labels.indexOf(String(left.control.textContent || '').trim().replace(/\s+/g, ' ')) - labels.indexOf(String(right.control.textContent || '').trim().replace(/\s+/g, ' '));
    });
    var selected = candidates[0] || null;
    var control = selected && selected.control || null;
    var panel = selected && selected.panel || null;
    var open = Boolean(control && panel && panel.isConnected && isVisible(panel));
    var mode = open ? String(control.textContent || '').trim().replace(/\s+/g, ' ') : null;
    var panelType = open ? selected.panelType : null;
    var previousSignature = JSON.stringify({ open: seatHudLogPanelState.open, mode: seatHudLogPanelState.mode, panelType: seatHudLogPanelState.panelType });
    var nextSignature = JSON.stringify({ open: open, mode: mode, panelType: panelType });
    seatHudLogPanelState = {
      open: open,
      panel: open ? panel : null,
      control: open ? control : null,
      mode: mode,
      panelType: panelType,
      revision: seatHudLogPanelState.revision + (previousSignature === nextSignature ? 0 : 1),
      lastReason: String(reason || 'seat HUD layer reconciliation')
    };
    return seatHudLogPanelState;
  }

  function blockingPanelCandidate(element) {
    if (!element || !element.isConnected || isExtensionOwnedUiElement(element) || !isVisible(element)) return null;
    var rect = element.getBoundingClientRect();
    if (!rect || rect.width < 120 || rect.height < 72) return null;
    var style = getComputedStyle(element);
    if (Number(style.opacity || 1) <= 0) return null;
    var text = seatHudSurfaceText(element);
    if (isPokerNowChatSurface(element)) return { element: element, rect: rect, kind: 'chat', blocking: false };
    if (/game configurations?/i.test(text) && /preferences|video\s*\/\s*audio/i.test(text)) return { element: element, rect: rect, kind: 'account_game_menu', blocking: false, expanded: true, evidence: 'account/game menu command group' };
    if (/\b(?:session\s+log|full\s+log|ledger|replayer|replay)\b/i.test(text)) {
      var panelType = /\breplay(?:er)?\b/i.test(text) ? 'replayer' : (/\bledger\b/i.test(text) ? 'ledger' : 'session_log');
      return { element: element, rect: rect, kind: panelType, blocking: false, expanded: true };
    }
    var semanticModal = String(element.tagName || '').toUpperCase() === 'DIALOG' || element.getAttribute && (element.getAttribute('role') === 'dialog' || element.getAttribute('aria-modal') === 'true');
    if (semanticModal) return { element: element, rect: rect, kind: /\b(?:game\s+)?settings\b/i.test(text) ? 'pokernow-game-settings' : 'pokernow-modal', blocking: true };
    return null;
  }

  function visibleSeatHudSurfaces() {
    var candidates = Array.from(document.querySelectorAll(SEMANTIC_BLOCKING_PANEL_SELECTOR));
    candidates = candidates.concat(Array.from(document.querySelectorAll('[aria-label*="chat" i], [class*="chat" i]')));
    if (seatHudLogPanelState.open && seatHudLogPanelState.panel && seatHudLogPanelState.panel.isConnected) candidates.push(seatHudLogPanelState.panel);
    if (activePanel && activePanel.isConnected) candidates.push(activePanel);
    ['Chat', 'Session Log', 'Full Log', 'Ledger', 'Replayer', 'Game Settings'].forEach(function (label) {
      var control = findVisibleTextElement(label);
      var surface = control && control.closest && control.closest(SEMANTIC_BLOCKING_PANEL_SELECTOR);
      if (surface) candidates.push(surface);
    });
    var unique = [];
    candidates.forEach(function (element) {
      if (unique.indexOf(element) < 0) unique.push(element);
    });
    var discovered = discoverSeatHudExpandedSurfaces();
    var visible = unique.map(blockingPanelCandidate).filter(Boolean).filter(function (candidate) {
      return !discovered.some(function (surface) { return candidate.element === surface.element || candidate.element.contains(surface.element); });
    }).concat(discovered);
    return visible.filter(function (candidate) {
      return !visible.some(function (other) {
        return other !== candidate && other.element.contains && other.element.contains(candidate.element);
      });
    });
  }

  function elementLayerDescriptor(element) {
    if (!element) return null;
    var rect = element.getBoundingClientRect();
    return {
      tag: String(element.tagName || ''),
      id: String(element.id || ''),
      className: String(element.className || '').slice(0, 180),
      rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
      stackingContexts: PokerSeatOverlay.stackingContextChain(element, getComputedStyle, document.documentElement)
    };
  }

  function removeSeatOverlayClip(element) {
    if (!element) return;
    var clipId = String(element.dataset.pnhudNativePanelClipId || String(element.id || 'pnhud-seat-overlay') + '-visible-region');
    var clipPath = document.getElementById(clipId);
    if (clipPath && clipPath.parentElement) clipPath.parentElement.removeChild(clipPath);
    if (element.style.clipPath) element.style.removeProperty('clip-path');
    if (element.style.webkitClipPath) element.style.removeProperty('-webkit-clip-path');
    delete element.dataset.pnhudNativePanelClipId;
    delete element.dataset.pnhudNativePanelClipSignature;
    delete element.dataset.pnhudNativePanelCoverage;
    delete element.dataset.pnhudNativePanelOccluded;
  }

  function applySeatHudExpandedPanelOcclusion(element, panelRects) {
    // z-index cannot escape a transformed/isolated PokerNow app ancestor.
    // Clip only overlapped pixels (and hit targets) in the extension's own HUD.
    // Never reparent native panels or raise their whole app/table ancestor.
    var result = PokerSeatOverlay.nativePanelVisibleFragments(element.getBoundingClientRect(), panelRects, 64);
    if (!result.occluded) { removeSeatOverlayClip(element); return result; }
    var path = result.fragments.map(function (rect) {
      return 'M ' + rect.left + ' ' + rect.top + ' H ' + rect.right + ' V ' + rect.bottom + ' H ' + rect.left + ' Z';
    }).join(' ') || 'M 0 0 H 0 V 0 Z';
    var value = 'path("' + path + '")';
    if (element.style.clipPath !== value) element.style.clipPath = value;
    element.dataset.pnhudNativePanelCoverage = result.fullyOccluded ? 'full-intersection' : 'partial-intersection';
    return result;
  }

  function applyNativePanelOcclusion(reason) {
    nativePanelOcclusionFrame = null;
    if (extensionCleanedUp || !seatOverlayController || !seatOverlayLayer) return;
    var surfaces = visibleSeatHudSurfaces();
    var panels = surfaces.filter(function (surface) { return surface.blocking; });
    var expandedSurfaces = surfaces.filter(function (surface) { return surface.expanded; }).slice(0, 8);
    var expandedSurface = expandedSurfaces[0] || null;
    var expandedPanel = expandedSurface && expandedSurface.element || null;
    var expandedPanelType = expandedSurface && expandedSurface.kind || null;
    var expandedPanelAboveSeatHud = false;
    expandedSurfaces.forEach(function (surface) { expandedPanelAboveSeatHud = applyExpandedPokerNowPanelLayerMarker(surface.element, surface.kind) || expandedPanelAboveSeatHud; });
    clearExpandedPokerNowPanelLayerMarker(expandedSurfaces.map(function (surface) { return surface.element; }));
    var chatVisible = surfaces.some(function (surface) { return surface.kind === 'chat'; });
    var reasons = [];
    if (hudUiPreferences.settingsOpen === true) reasons.push('extension-settings');
    panels.forEach(function (panel) { if (reasons.indexOf(panel.kind) < 0) reasons.push(panel.kind); });
    var expandedPanelRect = expandedPanel && expandedPanel.isConnected ? expandedPanel.getBoundingClientRect() : null;
    seatHudBlockingPanelState = {
      blocked: reasons.length > 0,
      reasons: reasons,
      chatVisible: chatVisible,
      extensionSettingsOpen: hudUiPreferences.settingsOpen === true,
      extensionLogOpen: seatHudLogPanelState.open,
      pokerNowGameSettingsOpen: reasons.indexOf('pokernow-game-settings') >= 0 || reasons.indexOf('pokernow-modal') >= 0,
      seatHudLayer: 2147483643,
      chatLayer: 'ordinary PokerNow UI below 2147483643',
      expandedPokerNowPanelDetected: Boolean(expandedPanel),
      expandedPanelType: expandedPanelType,
      expandedPanelRect: expandedPanelRect ? { left: Math.round(expandedPanelRect.left), top: Math.round(expandedPanelRect.top), width: Math.round(expandedPanelRect.width), height: Math.round(expandedPanelRect.height) } : null,
      expandedPanelAboveSeatHud: expandedPanelAboveSeatHud,
      expandedPanels: expandedSurfaces.map(function (surface) { var rect = surface.element.getBoundingClientRect(); return { type: surface.kind, evidence: surface.evidence || 'semantic expanded panel', rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, layerStrategy: 'native-panel-marker-plus-intersection-only-HUD-clip', stackingContexts: PokerSeatOverlay.stackingContextChain(surface.element, getComputedStyle, document.documentElement).slice(0, 12) }; }),
      extensionSettingsBlocker: hudUiPreferences.settingsOpen === true,
      settingsBlocker: hudUiPreferences.settingsOpen === true,
      gameSettingsBlocker: reasons.indexOf('pokernow-game-settings') >= 0 || reasons.indexOf('pokernow-modal') >= 0
    };
    seatOverlayLayer.classList.toggle('pnhud-seat-huds-blocked', seatHudBlockingPanelState.blocked);
    seatOverlayLayer.setAttribute('aria-hidden', seatOverlaysVisible() && !seatHudBlockingPanelState.blocked ? 'false' : 'true');
    var suppressedPlayers = [];
    seatOverlayController.records.forEach(function (record, playerId) {
      var element = record && record.element;
      if (!element || !element.isConnected) return;
      if (expandedSurfaces.length) applySeatHudExpandedPanelOcclusion(element, expandedSurfaces.map(function (surface) { return surface.element.getBoundingClientRect(); }));
      else removeSeatOverlayClip(element);
      if (seatHudBlockingPanelState.blocked) suppressedPlayers.push(String(playerId));
      var previousDiagnostic = seatHudPositionDiagnostics.get(String(playerId));
      if (previousDiagnostic) seatHudPositionDiagnostics.set(String(playerId), Object.assign({}, previousDiagnostic, {
        blockingPanelState: cloneJson(seatHudBlockingPanelState),
        suppressionReason: seatHudBlockingPanelState.blocked ? seatHudBlockingPanelState.reasons.slice() : [],
        layerOwnership: { owner: 'body-level-extension-root', seatHudZIndex: 2147483643, chatLayer: 'below-seat-hud', ordinaryLogLauncherLayer: 'below-seat-hud', expandedPokerNowPanelZIndex: 2147483644, expandedPanelAboveSeatHud: expandedPanelAboveSeatHud, belowExtensionModals: true }
      }));
    });
    var signature = JSON.stringify({
      panels: panels.map(function (panel) { return elementLayerDescriptor(panel.element); }),
      expandedPanel: expandedPanel ? elementLayerDescriptor(expandedPanel) : null,
      expandedPanelType: expandedPanelType,
      suppressedPlayers: suppressedPlayers,
      blockingState: seatHudBlockingPanelState
    });
    if (signature === lastNativePanelLayeringSignature) return;
    lastNativePanelLayeringSignature = signature;
    var diagnostic = {
      timestamp: Date.now(),
      reason: reason || 'unspecified',
      seatOverlayRoot: elementLayerDescriptor(seatOverlayLayer),
      nativePanels: panels.map(function (panel) { return elementLayerDescriptor(panel.element); }),
      expandedPokerNowPanel: expandedPanel ? elementLayerDescriptor(expandedPanel) : null,
      expandedPanelType: expandedPanelType,
      expandedPanelAboveSeatHud: expandedPanelAboveSeatHud,
      chatSurfaces: surfaces.filter(function (surface) { return surface.kind === 'chat'; }).map(function (surface) { return elementLayerDescriptor(surface.element); }),
      suppressedPlayers: suppressedPlayers,
      blockingPanelState: cloneJson(seatHudBlockingPanelState)
    };
    nativePanelLayeringDiagnostics.push(diagnostic);
    if (nativePanelLayeringDiagnostics.length > 20) nativePanelLayeringDiagnostics.shift();
    console.log('[HUD NATIVE PANEL LAYER]', diagnostic);
  }

  function scheduleNativePanelOcclusion(reason) {
    if (extensionCleanedUp || nativePanelOcclusionFrame !== null) return;
    nativePanelOcclusionFrame = requestAnimationFrame(function () {
      refreshSeatHudLogPanelState(reason);
      applyNativePanelOcclusion(reason);
    });
  }

  function observeSeatElement(element) {
    if (!seatResizeObserver || !element || observedSeatElements.has(element)) return;
    try {
      seatResizeObserver.observe(element);
      observedSeatElements.add(element);
    } catch (error) {}
  }

  function unobserveSeatElement(element) {
    if (!element || !observedSeatElements.has(element)) return;
    if (seatResizeObserver && typeof seatResizeObserver.unobserve === 'function') {
      try { seatResizeObserver.unobserve(element); } catch (error) {}
    }
    observedSeatElements.delete(element);
  }

  function removeConfirmedSeatMapping(playerId, reason) {
    var id = String(playerId);
    var mapping = confirmedSeatMappings.get(id);
    if (!mapping) return false;
    confirmedSeatMappings.delete(id);
    unobserveSeatElement(mapping.seatElement || domSeatElements.get(mapping.seatElementId));
    console.log('[HUD SEAT OVERLAY] mapping retired', { playerId: id, domSeatIdentifier: mapping.seatElementId, reason: reason || 'seat mapping is no longer authoritative' });
    return true;
  }

  function seatDomRetentionInfo() {
    var currentSeatIds = new Set(identityDiagnostics.domSeats.map(function (seat) { return seat.elementId; }));
    var retainedElements = new Set();
    domSeatElements.forEach(function (element) { retainedElements.add(element); });
    domSeatAnchorElements.forEach(function (element) { retainedElements.add(element); });
    observedSeatElements.forEach(function (element) { retainedElements.add(element); });
    return {
      liveSeatMappingEntries: domSeatElements.size,
      liveAnchorMappingEntries: domSeatAnchorElements.size,
      observedCurrentTargets: Array.from(observedSeatElements).filter(function (element) {
        if (!element || !element.isConnected) return false;
        return Array.from(currentSeatIds).some(function (seatId) { return domSeatElements.get(seatId) === element; });
      }).length,
      detachedRetainedTargets: Array.from(retainedElements).filter(function (element) { return element && !element.isConnected; }).length,
      previousDomSeatEntries: previousDomSeats.size,
      confirmedSeatMappings: confirmedSeatMappings.size
    };
  }

  function pruneDetachedSeatDomState(seats, reason) {
    var currentSeats = Array.isArray(seats) ? seats : [];
    var currentSeatIds = new Set(currentSeats.map(function (seat) { return seat.elementId; }));
    var currentSeatElements = new Set();
    currentSeatIds.forEach(function (seatId) {
      var element = domSeatElements.get(seatId);
      if (element && element.isConnected) currentSeatElements.add(element);
    });
    domSeatElements.forEach(function (element, seatId) {
      if (currentSeatIds.has(seatId) && element && element.isConnected) return;
      unobserveSeatElement(element);
      domSeatElements.delete(seatId);
      domSeatAnchorElements.delete(seatId);
    });
    domSeatAnchorElements.forEach(function (element, seatId) {
      if (!currentSeatIds.has(seatId) || !element || !element.isConnected) domSeatAnchorElements.delete(seatId);
    });
    observedSeatElements.forEach(function (element) {
      if (!currentSeatElements.has(element) || !element.isConnected) unobserveSeatElement(element);
    });
    confirmedSeatMappings.forEach(function (mapping, playerId) {
      var element = domSeatElements.get(mapping.seatElementId);
      if (!currentSeatIds.has(mapping.seatElementId) || !element || !element.isConnected) removeConfirmedSeatMapping(playerId, reason || 'seat disappeared');
    });
    previousDomSeats.clear();
    currentSeats.forEach(function (seat) { previousDomSeats.set(seat.displayedName || seat.elementId, seat); });
    seenDomSeatElementIds.clear();
    currentSeatIds.forEach(function (seatId) { seenDomSeatElementIds.add(seatId); });
    pipelineHealth.domSeatsDiscovered = currentSeatIds.size;
    return seatDomRetentionInfo();
  }

  function potOddsRect(rect) {
    if (!validAnchorRect(rect)) return null;
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.left + rect.width, bottom: rect.top + rect.height };
  }

  function unionPotOddsRects(rects) {
    if (!rects.length) return null;
    var left = Math.min.apply(null, rects.map(function (rect) { return rect.left; }));
    var top = Math.min.apply(null, rects.map(function (rect) { return rect.top; }));
    var right = Math.max.apply(null, rects.map(function (rect) { return rect.left + rect.width; }));
    var bottom = Math.max.apply(null, rects.map(function (rect) { return rect.top + rect.height; }));
    return { left: left, top: top, width: right - left, height: bottom - top, right: right, bottom: bottom };
  }

  function currentHeroSeatForPotOdds() {
    var mapping = localUserPlayerId ? confirmedSeatMappings.get(String(localUserPlayerId)) : null;
    var mappedSeat = mapping ? domSeatElements.get(mapping.seatElementId) : null;
    var currentMarkedSeats = Array.from(document.querySelectorAll('.table-player.you-player, .you-player')).map(function (element) {
      return element.closest && element.closest('.table-player') || element;
    }).filter(function (element, index, elements) {
      return Boolean(element && element.isConnected && elements.indexOf(element) === index && !(seatOverlayLayer && seatOverlayLayer.contains(element)));
    });
    var seatElement = null;
    var source = null;
    if (currentMarkedSeats.length === 1 && (!mappedSeat || !mappedSeat.isConnected || mappedSeat !== currentMarkedSeats[0])) {
      seatElement = currentMarkedSeats[0];
      source = 'unique live .table-player.you-player query';
    } else if (mappedSeat && mappedSeat.isConnected) {
      seatElement = mappedSeat;
      source = currentMarkedSeats.indexOf(mappedSeat) >= 0 ? 'canonical self mapping confirmed by live .you-player' : 'canonical self mapping current connected seat';
    } else if (currentMarkedSeats.length === 1) {
      seatElement = currentMarkedSeats[0];
      source = 'unique live .table-player.you-player query';
    }
    return { mapping: mapping, seatElement: seatElement, source: source, markedSeatCount: currentMarkedSeats.length, mappedSeatDiscarded: Boolean(mappedSeat && (!mappedSeat.isConnected || (currentMarkedSeats.length === 1 && mappedSeat !== currentMarkedSeats[0]))) };
  }

  function potOddsCardClass(element) {
    return boundedPotOddsText(element && (typeof element.className === 'string' ? element.className : element.getAttribute && element.getAttribute('class')) || '');
  }

  function noteDiscardedHeroPotOddsReferences(elements) {
    (elements || []).forEach(function (element) {
      if (!element || heroPotOddsDiscardedReferenceElements.has(element)) return;
      heroPotOddsDiscardedReferenceElements.add(element);
      heroPotOddsDiscardedReferenceCount += 1;
    });
  }

  function potOddsOwnedElement(element) {
    if (!element || !element.closest) return false;
    return Boolean(element.closest('#' + potOddsRootId + ', #' + overlayRootId + ', [data-pnhud-owned="true"]'));
  }

  function currentPokerNowTableElement() {
    var retained = boardCompanionLayoutState && boardCompanionLayoutState.tableElement;
    if (!(retained && retained.isConnected && !potOddsOwnedElement(retained))) retained = null;
    var selectors = ['#table', '.game-table', '[class~="game-table"]', 'main'];
    var retainedPriority = retained && retained.matches ? selectors.findIndex(function (selector) { return retained.matches(selector); }) : -1;
    for (var selectorIndex = 0; selectorIndex < selectors.length; selectorIndex += 1) {
      var candidates = Array.from(document.querySelectorAll(selectors[selectorIndex]));
      var candidate = candidates.find(function (element) {
        return Boolean(element && element.isConnected && !potOddsOwnedElement(element));
      });
      if (candidate) return retained && retainedPriority >= 0 && retainedPriority <= selectorIndex ? retained : candidate;
    }
    return retained || document.body || document.documentElement;
  }

  // Board/card DOM is collected only by PokerBoardCompanionLayout as validation evidence.
  // It no longer owns or reselects companion coordinates.
  function potOddsPlacementObstacles() {
    var selector = '.table-pot-size, [class*="table-pot" i], [class*="main-pot" i], [class*="pot-size" i], .table-actions button, [class*="table-action" i], [class*="action-button" i], [class*="decision-button" i]';
    var seen = new Set();
    return Array.from(document.querySelectorAll(selector)).filter(function (element) {
      if (!element || !element.isConnected || seen.has(element) || potOddsOwnedElement(element)) return false;
      seen.add(element);
      return true;
    }).map(function (element) {
      var className = potOddsCardClass(element);
      return { element: element, rect: viewportRect(element), type: /pot/i.test(className) ? 'pot-display' : 'action-control', className: className };
    }).filter(function (entry) { return Boolean(entry.rect); });
  }

  function boardCompanionPotOddsAnchors(panelSize, reason) {
    var seatResolution = currentHeroSeatForPotOdds();
    var seatElement = seatResolution.seatElement;
    var tableElement = currentPokerNowTableElement();
    var layout = PokerBoardCompanionLayout.resolveDom(boardCompanionLayoutState, {
      document: document,
      window: window,
      tableId: pokerNowGameId,
      tableElement: tableElement,
      isOwnedElement: potOddsOwnedElement,
      leftSize: panelSize,
      rightSize: panelSize,
      context: {
        trigger: reason || heroPotOddsRenderReason || 'pot-odds placement resolution',
        street: potOddsPresentation && potOddsPresentation.street || null,
        settingsVisible: hudUiPreferences.settingsOpen === true,
        lifecycleState: potOddsPresentation && potOddsPresentation.tableLifecycleState || null,
        widgetVisibleReason: potOddsPresentation && (potOddsPresentation.panelVisibleReason || potOddsPresentation.panelHiddenReason) || null,
        contentState: potOddsPresentation && potOddsPresentation.contentState || null,
        persistedOffsetX: hudUiPreferences.potOddsOffsetX,
        persistedOffsetY: hudUiPreferences.potOddsOffsetY,
        draggingNow: Boolean(activePotOddsDrag)
        , settingsTransition: /settings/i.test(String(reason || heroPotOddsRenderReason || ''))
        , dragState: activePotOddsDrag ? { pointerId: activePotOddsDrag.pointerId, moved: activePotOddsDrag.moved, captureRequested: activePotOddsDrag.captureRequested, captureEstablished: activePotOddsDrag.captureEstablished, listenerOwner: 'stable delegated #' + potOddsRootId } : { active: false, listenerOwner: 'stable delegated #' + potOddsRootId }
        , resetPending: heroPotOddsResetPending === true
        , offsetMutationSource: cloneJson(lastPotOddsOffsetMutation)
      }
    });
    var info = layout.info || {};
    var illegalChange = info.latestIllegalCanonicalGeometryChange || null;
    if (illegalChange && Number(illegalChange.sequence || 0) > boardCompanionLastIllegalChangeSequence) {
      boardCompanionLastIllegalChangeSequence = Number(illegalChange.sequence || 0);
      recordBoardCompanionEvent(illegalChange.type || 'ILLEGAL_CANONICAL_GEOMETRY_CHANGE', illegalChange.trigger || illegalChange.reason, {
        layoutEpochId: illegalChange.layoutEpochId,
        canonicalBoardLocalRect: illegalChange.acceptedCanonicalBoardLocalRect
      }, {
        layoutEpochId: illegalChange.layoutEpochId,
        canonicalBoardLocalRect: illegalChange.acceptedCanonicalBoardLocalRect,
        rejectedCanonicalBoardLocalRect: illegalChange.rejectedCanonicalBoardLocalRect,
        rejectedSource: illegalChange.rejectedSource,
        street: illegalChange.street,
        boardCardCount: illegalChange.boardCardCount,
        settingsVisible: illegalChange.settingsVisible
      });
    }
    var pageObstacles = potOddsPlacementObstacles();
    var selfRecord = seatOverlayController && seatOverlayController.records.get(String(localUserPlayerId));
    var selfHudRect = selfRecord && selfRecord.element && selfRecord.element.isConnected && selfRecord.element.style.visibility !== 'hidden' ? selfRecord.element.getBoundingClientRect() : null;
    if (selfHudRect) pageObstacles.push({ type: 'self-hud', className: 'pnhud-seat-overlay', rect: selfHudRect });
    heroPotOddsAnchorDiagnostic = {
      chosenAnchorType: 'canonical-board-slot',
      canonicalBoardSource: layout.source,
      canonicalBoardRect: potOddsRect(layout.canonicalBoardRect),
      canonicalBoardLocalRect: cloneJson(layout.canonicalBoardLocalRect || info.canonicalBoardLocalRect || null),
      canonicalBoardVerified: layout.verified === true,
      layoutEpochId: layout.layoutEpochId || info.layoutEpochId || null,
      tableOwnerSource: layout.tableOwnerSource || info.tableOwnerSource || null,
      tableTransform: cloneJson(info.tableTransform || null),
      cachedGeometryReused: layout.cachedGeometryReused === true,
      boardCandidateList: cloneJson(info.boardCandidates || []),
      selectedBoardCards: (info.actualVisibleCardRects || []).map(function (rect) { return { connected: true, rect: rect }; }),
      boardCandidateCount: (info.boardCandidates || []).length,
      boardRect: cloneJson(info.actualCardUnion || null),
      actualBoardCardUnion: cloneJson(info.actualCardUnion || null),
      explicitSlotRects: cloneJson(info.explicitSlotRects || []),
      cardPitchEvidence: cloneJson(info.pitchEvidence || null),
      boardAlignment: cloneJson(info.boardAlignment || null),
      boardAcquisitionStrategy: layout.source,
      fallbackUsed: Boolean(info.fallback),
      fallbackReason: info.fallback || null,
      heroSeatFound: Boolean(seatElement),
      heroSeatSelectorSource: seatResolution.source,
      heroSeatConnected: Boolean(seatElement && seatElement.isConnected),
      acquisitionStrategy: 'PokerBoardCompanionLayout authoritative service',
      tableRect: cloneJson(info.tableRect || null),
      layoutInfoRevision: info.revision || null
    };
    var anchors = {
      heroRect: viewportRect(seatElement),
      anchorRect: layout.canonicalBoardRect,
      canonicalBoardRect: layout.canonicalBoardRect,
      canonicalBoardSource: layout.source,
      actualBoardCardUnion: info.actualCardUnion || null,
      emptyBoardContainerRect: info.explicitSlotRects && info.explicitSlotRects.length === 5 ? layout.canonicalBoardRect : null,
      leftCompanionRect: layout.leftCompanionRect,
      rightCompanionRect: layout.rightCompanionRect,
      anchorType: 'canonical-board-slot',
      anchorLabel: 'canonical community board slot',
      boardRect: info.actualCardUnion || null,
      boardSource: layout.source,
      fallbackUsed: Boolean(info.fallback),
      fallbackReason: info.fallback || null,
      cardRect: layout.canonicalBoardRect,
      cardSource: layout.source,
      cardElement: layout.observerElement,
      observerElement: layout.observerElement,
      resizeElements: layout.resizeElements || [],
      seatElement: seatElement,
      selfHudRect: potOddsRect(selfHudRect),
      obstacleRects: pageObstacles.map(function (entry) { return entry.rect; }),
      obstacleDiagnostics: pageObstacles.map(function (entry) { return { type: entry.type, className: entry.className, rect: potOddsRect(entry.rect) }; }),
      heroAnchorDiagnostic: heroPotOddsAnchorDiagnostic,
      layoutInfo: info
    };
    observeHeroPotOddsAnchor(anchors);
    return anchors;
  }

  function boundedPotOddsText(value) { return String(value === undefined || value === null ? '' : value).slice(0, 240); }

  function potOddsForensicRect(rect) {
    if (!rect || !Number.isFinite(Number(rect.left)) || !Number.isFinite(Number(rect.top))) return null;
    return {
      left: Math.round(Number(rect.left) * 10) / 10, top: Math.round(Number(rect.top) * 10) / 10,
      width: Math.round(Number(rect.width || 0) * 10) / 10, height: Math.round(Number(rect.height || 0) * 10) / 10,
      right: Math.round(Number(rect.right === undefined ? Number(rect.left) + Number(rect.width || 0) : rect.right) * 10) / 10,
      bottom: Math.round(Number(rect.bottom === undefined ? Number(rect.top) + Number(rect.height || 0) : rect.bottom) * 10) / 10
    };
  }

  function potOddsForensicBase(trigger) {
    var pill = heroPotOddsElement && heroPotOddsElement.querySelector ? heroPotOddsElement.querySelector('.pnhud-pot-odds') : null;
    return {
      trigger: boundedPotOddsText(trigger), decisionRevision: heroPotOddsDecisionRevision,
      decisionFingerprint: heroPotOddsDecisionFingerprint, decisionStatus: potOddsDecision && potOddsDecision.status || null,
      reasonCode: potOddsDecision && potOddsDecision.reasonCode || null,
      renderRequested: heroPotOddsPlacementDiagnostic.renderRequested === true,
      renderScheduled: heroPotOddsRenderDiagnostic.renderPending === true,
      renderExecuted: heroPotOddsRenderDiagnostic.lastRenderExecutedTimestamp || null,
      rootExists: Boolean(potOddsLayer), rootConnected: Boolean(potOddsLayer && potOddsLayer.isConnected),
      hostExists: Boolean(heroPotOddsElement), pillExists: Boolean(pill), hostConnected: Boolean(heroPotOddsElement && heroPotOddsElement.isConnected),
      hostHidden: Boolean(heroPotOddsElement && heroPotOddsElement.hidden),
      chosenAnchorType: heroPotOddsPlacementDiagnostic.chosenAnchorType || null,
      boardRect: cloneJson(heroPotOddsPlacementDiagnostic.boardRect || null), fallbackUsed: heroPotOddsPlacementDiagnostic.fallbackUsed === true,
      heroCardRect: cloneJson(heroPotOddsPlacementDiagnostic.heroCardRect || null),
      selfHudRect: cloneJson(heroPotOddsPlacementDiagnostic.selfHudRect || null), selectedSide: heroPotOddsPlacementDiagnostic.selectedSide || null,
      suppressionReason: heroPotOddsPlacementDiagnostic.suppressionReason || null, retryState: heroPotOddsPlacementDiagnostic.retryState || null,
      css: heroPotOddsElement ? { left: heroPotOddsElement.style.left || null, top: heroPotOddsElement.style.top || null, visibility: heroPotOddsElement.style.visibility || null } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight }, documentVisibility: document.visibilityState || null
    };
  }

  function recordPotOddsForensic(eventType, trigger, details) {
    try {
      var event = Object.assign({ sequence: ++potOddsForensicSequence, timestamp: Date.now(), monotonicTimestamp: typeof performance !== 'undefined' && typeof performance.now === 'function' ? Math.round(performance.now() * 10) / 10 : null, eventType: boundedPotOddsText(eventType) }, potOddsForensicBase(trigger), details || {});
      var previous = potOddsForensicTimeline[potOddsForensicTimeline.length - 1];
      if (previous && previous.eventType === event.eventType && previous.trigger === event.trigger && previous.decisionFingerprint === event.decisionFingerprint && previous.suppressionReason === event.suppressionReason) {
        previous.repeatCount = Number(previous.repeatCount || 1) + 1;
        previous.lastTimestamp = event.timestamp;
        previous.lastMonotonicTimestamp = event.monotonicTimestamp;
        previous.lastSequence = event.sequence;
        Object.keys(event).forEach(function (key) {
          if (!['sequence', 'timestamp', 'monotonicTimestamp', 'repeatCount', 'firstTimestamp'].includes(key)) previous[key] = event[key];
        });
        return cloneJson(previous);
      }
      event.repeatCount = 1;
      event.firstTimestamp = event.timestamp;
      event.lastTimestamp = event.timestamp;
      event.lastSequence = event.sequence;
      potOddsForensicTimeline.push(event);
      if (potOddsForensicTimeline.length > 96) potOddsForensicTimeline.shift();
      return cloneJson(event);
    } catch (error) {
      var failure = {
        sequence: ++potOddsForensicSequence, timestamp: Date.now(), eventType: 'forensic-capture-error',
        trigger: boundedPotOddsText(trigger), failedEventType: boundedPotOddsText(eventType), error: boundedPotOddsText(error && (error.message || error)), repeatCount: 1
      };
      var last = potOddsForensicTimeline[potOddsForensicTimeline.length - 1];
      if (last && last.eventType === failure.eventType && last.failedEventType === failure.failedEventType) {
        last.repeatCount = Number(last.repeatCount || 1) + 1;
        last.lastTimestamp = failure.timestamp;
        last.lastSequence = failure.sequence;
        return Object.assign({}, last);
      }
      failure.firstTimestamp = failure.timestamp;
      failure.lastTimestamp = failure.timestamp;
      failure.lastSequence = failure.sequence;
      potOddsForensicTimeline.push(failure);
      if (potOddsForensicTimeline.length > 96) potOddsForensicTimeline.shift();
      return Object.assign({}, failure);
    }
  }

  function stampHeroPotOddsFingerprint(host) {
    if (!host) return null;
    var fingerprint = heroPotOddsDecisionFingerprint || '';
    if (host.dataset.pnhudDecisionFingerprint !== fingerprint) host.dataset.pnhudDecisionFingerprint = fingerprint;
    var pill = host.querySelector('.pnhud-pot-odds');
    if (pill && pill.dataset.pnhudDecisionFingerprint !== fingerprint) pill.dataset.pnhudDecisionFingerprint = fingerprint;
    return pill;
  }

  function persistedPotOddsOffset() {
    return PokerPotOddsPosition.normalizeOffset({ x: hudUiPreferences.potOddsOffsetX, y: hudUiPreferences.potOddsOffsetY });
  }

  function effectivePotOddsOffset() {
    return activePotOddsDrag && activePotOddsDrag.moved ? cloneJson(activePotOddsDrag.currentOffset) : persistedPotOddsOffset();
  }

  function movePotOddsDrag(event) {
    if (!activePotOddsDrag) return;
    if (activePotOddsDrag.pointerId !== null && event.pointerId !== undefined && event.pointerId !== activePotOddsDrag.pointerId) return;
    var drag = activePotOddsDrag;
    var deltaX = Number(event.clientX) - drag.startPointer.x;
    var deltaY = Number(event.clientY) - drag.startPointer.y;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    if (!drag.moved) recordBoardCompanionEvent('drag-threshold-crossed', 'pot-odds title drag crossed the 4px movement threshold');
    drag.moved = true;
    drag.currentOffset = PokerPotOddsPosition.offsetFromDrag(drag.startOffset, drag.startPointer, { x: Number(event.clientX), y: Number(event.clientY) });
    var liveElement = heroPotOddsElement && heroPotOddsElement.isConnected ? heroPotOddsElement : drag.element;
    if (liveElement) liveElement.classList.add('pnhud-pot-odds-dragging');
    document.documentElement.classList.add('pnhud-pot-odds-dragging');
    event.preventDefault();
    event.stopPropagation();
    positionHeroPotOdds('pot-odds pointer drag');
    recordBoardCompanionEvent('drag-move', 'pot-odds drag rendered transient feature offset');
  }

  function finishPotOddsDrag(event, cancelled) {
    if (!activePotOddsDrag) return;
    if (event && activePotOddsDrag.pointerId !== null && event.pointerId !== undefined && event.pointerId !== activePotOddsDrag.pointerId) return;
    var drag = activePotOddsDrag;
    activePotOddsDrag = null;
    if (drag.element) drag.element.classList.remove('pnhud-pot-odds-dragging');
    if (heroPotOddsElement && heroPotOddsElement !== drag.element) heroPotOddsElement.classList.remove('pnhud-pot-odds-dragging');
    document.documentElement.classList.remove('pnhud-pot-odds-dragging');
    document.removeEventListener('pointermove', movePotOddsDrag, true);
    document.removeEventListener('pointerup', finishPotOddsDrag, true);
    document.removeEventListener('pointercancel', cancelPotOddsDrag, true);
    document.removeEventListener('mousemove', movePotOddsDrag, true);
    document.removeEventListener('mouseup', finishPotOddsDrag, true);
    if (drag.pointerId !== null && drag.handle.releasePointerCapture) {
      try { drag.handle.releasePointerCapture(drag.pointerId); } catch (_error) {}
    }
    if (event && drag.moved) { event.preventDefault(); event.stopPropagation(); }
    if (!cancelled && drag.moved) {
      updateHudUiPreferences({ potOddsOffsetX: drag.currentOffset.x, potOddsOffsetY: drag.currentOffset.y }, 'pot-odds-pointer-drag', { render: false, onPersisted: function () { recordBoardCompanionEvent('offset-persisted', 'pot-odds drag offset storage write completed'); } });
      positionHeroPotOdds('pot-odds pointer drag committed');
    } else {
      positionHeroPotOdds(cancelled ? 'pot-odds drag cancelled' : 'pot-odds drag no-op');
    }
    recordBoardCompanionEvent('drag-end', cancelled ? 'pot-odds drag cancelled' : drag.moved ? 'pot-odds drag committed' : 'pot-odds drag ended without movement');
  }

  function cancelPotOddsDrag(event) {
    finishPotOddsDrag(event, true);
  }

  function beginPotOddsDrag(event) {
    if (activePotOddsDrag) {
      recordBoardCompanionEvent('drag-pointerdown-rejected', 'another pot-odds drag is already active');
      return;
    }
    if (event.button !== undefined && event.button !== 0) {
      recordBoardCompanionEvent('drag-pointerdown-rejected', 'non-primary pointer button');
      return;
    }
    var handle = event.target && event.target.closest ? event.target.closest('[data-pnhud-pot-odds-drag-handle="true"]') : null;
    var element = handle && handle.closest ? handle.closest('#' + heroPotOddsElementId) : null;
    if (!handle || !element || !potOddsLayer || !potOddsLayer.contains(element)) {
      recordBoardCompanionEvent('drag-pointerdown-rejected', 'pointerdown was outside the POT ODDS title handle');
      return;
    }
    var pointerId = event.pointerId === undefined ? null : event.pointerId;
    activePotOddsDrag = {
      pointerId: pointerId,
      element: element,
      handle: handle,
      startPointer: { x: Number(event.clientX), y: Number(event.clientY) },
      startOffset: persistedPotOddsOffset(),
      currentOffset: persistedPotOddsOffset(),
      moved: false,
      captureRequested: false,
      captureEstablished: false
    };
    event.preventDefault();
    event.stopPropagation();
    recordBoardCompanionEvent('drag-pointerdown-accepted', 'delegated POT ODDS title pointerdown accepted');
    recordBoardCompanionEvent('drag-start', 'pot-odds title pointer drag started');
    if (pointerId !== null && handle.setPointerCapture) {
      activePotOddsDrag.captureRequested = true;
      try {
        handle.setPointerCapture(pointerId);
        activePotOddsDrag.captureEstablished = handle.hasPointerCapture ? handle.hasPointerCapture(pointerId) === true : true;
      } catch (_error) {
        activePotOddsDrag.captureEstablished = false;
      }
      recordBoardCompanionEvent('drag-capture', activePotOddsDrag.captureEstablished ? 'pointer capture established on POT ODDS title' : 'pointer capture unavailable; document capture listeners remain active');
    }
    document.addEventListener('pointermove', movePotOddsDrag, true);
    document.addEventListener('pointerup', finishPotOddsDrag, true);
    document.addEventListener('pointercancel', cancelPotOddsDrag, true);
    if (!window.PointerEvent) {
      document.addEventListener('mousemove', movePotOddsDrag, true);
      document.addEventListener('mouseup', finishPotOddsDrag, true);
    }
    updateBoardCompanionDiagnosticContext();
  }

  function installPotOddsDragBehavior(element) {
    if (!element) return;
    if (potOddsDragBehavior && potOddsDragBehavior.element === element) return;
    if (potOddsDragBehavior && potOddsDragBehavior.element) {
      potOddsDragBehavior.element.removeEventListener('pointerdown', potOddsDragBehavior.pointerDown);
      potOddsDragBehavior.element.removeEventListener('mousedown', potOddsDragBehavior.mouseDown);
    }
    var pointerDown = function (event) { beginPotOddsDrag(event); };
    var mouseDown = function (event) { beginPotOddsDrag(event); };
    element.addEventListener('pointerdown', pointerDown);
    if (!window.PointerEvent) element.addEventListener('mousedown', mouseDown);
    potOddsDragBehavior = { element: element, pointerDown: pointerDown, mouseDown: mouseDown, owner: 'stable delegated #' + potOddsRootId };
  }

  function resetPotOddsPosition(source) {
    if (activePotOddsDrag) finishPotOddsDrag(null, true);
    heroPotOddsResetPending = true;
    recordBoardCompanionEvent('reset-requested', source || 'reset-pot-odds-position');
    lastPotOddsOffsetMutation = { reasonCode: 'RESET_POSITION', source: String(source || 'reset-pot-odds-position').slice(0, 180), timestamp: Date.now(), before: persistedPotOddsOffset(), after: { x: 0, y: 0 } };
    recordBoardCompanionEvent('offset-mutation', 'RESET_POSITION: feature offset set to exactly 0/0');
    updateHudUiPreferences({ potOddsOffsetX: 0, potOddsOffsetY: 0 }, source || 'reset-pot-odds-position', { render: false, onPersisted: function () { recordBoardCompanionEvent('offset-persisted', 'reset 0/0 storage write completed'); } });
    positionHeroPotOdds(source || 'reset-pot-odds-position');
    renderSettingsPanel();
  }

  function ensurePotOddsLayer() {
    var priorRoot = potOddsLayer;
    var candidates = Array.from(document.querySelectorAll('#' + potOddsRootId));
    var existing = potOddsLayer && potOddsLayer.isConnected ? potOddsLayer : candidates.find(function (element) { return element.isConnected; }) || null;
    candidates.forEach(function (element) { if (element !== existing) element.remove(); });
    if (existing && existing.isConnected) potOddsLayer = existing;
    if (!potOddsLayer || !potOddsLayer.isConnected) {
      potOddsLayer = document.createElement('div');
      potOddsLayer.id = potOddsRootId;
      potOddsLayer.dataset.pnhudOwned = 'true';
      (document.body || document.documentElement).appendChild(potOddsLayer);
      recordPotOddsForensic('host-root-created', 'ensure stable pot-odds root');
    } else if (document.body && potOddsLayer.parentElement !== document.body) {
      document.body.appendChild(potOddsLayer);
      recordPotOddsForensic('host-root-remounted', 'ensure stable pot-odds root');
    }
    if (potOddsLayer.dataset.pnhudOwned !== 'true') potOddsLayer.dataset.pnhudOwned = 'true';
    if (priorRoot && priorRoot !== potOddsLayer) {
      heroPotOddsLastMountedFingerprint = null;
      recordPotOddsForensic('host-root-adopted', 'same-id pot-odds root replacement');
    }
    installPotOddsDragBehavior(potOddsLayer);
    return potOddsLayer;
  }

  function ensureHeroPotOddsHost(trigger) {
    var root = ensurePotOddsLayer();
    var candidates = Array.from(document.querySelectorAll('#' + heroPotOddsElementId));
    var priorHost = heroPotOddsElement;
    var canonical = heroPotOddsElement && heroPotOddsElement.isConnected ? heroPotOddsElement : candidates.find(function (element) { return element.isConnected; }) || null;
    candidates.forEach(function (element) { if (element !== canonical) element.remove(); });
    var hostEventType = null;
    if (!canonical) {
      canonical = document.createElement('aside');
      canonical.id = heroPotOddsElementId;
      canonical.className = 'pnhud-hero-pot-odds';
      canonical.dataset.pnhudOwned = 'true';
      canonical.setAttribute('aria-label', 'Current hand pot odds');
      root.appendChild(canonical);
      heroPotOddsVisibilityStats.remountCount += 1;
      hostEventType = 'host-created';
      recordPotOddsForensic('host-created', trigger, { duplicateHostsRemoved: candidates.length });
    } else if (canonical.parentElement !== root) {
      root.appendChild(canonical);
      heroPotOddsVisibilityStats.remountCount += 1;
      hostEventType = 'host-reused';
      recordPotOddsForensic('host-remounted', trigger);
    }
    if (priorHost && priorHost !== canonical) {
      heroPotOddsLastMountedFingerprint = null;
    }
    heroPotOddsElement = canonical;
    if (hostEventType) recordBoardCompanionEvent(hostEventType, trigger || 'pot-odds host lifecycle');
    if (canonical.id !== heroPotOddsElementId) canonical.id = heroPotOddsElementId;
    if (!canonical.classList.contains('pnhud-hero-pot-odds')) canonical.className = 'pnhud-hero-pot-odds';
    if (canonical.dataset.pnhudOwned !== 'true') canonical.dataset.pnhudOwned = 'true';
    installPotOddsDragBehavior(root);
    var pill = canonical.querySelector('.pnhud-pot-odds');
    var fingerprintMatches = canonical.dataset.pnhudDecisionFingerprint === heroPotOddsDecisionFingerprint && pill && pill.dataset.pnhudDecisionFingerprint === heroPotOddsDecisionFingerprint;
    var presentationDecision = currentPotOddsPresentationDecision();
    if (presentationDecision && (!pill || !fingerprintMatches)) {
      canonical.innerHTML = PokerPotOdds.widgetHtml(presentationDecision);
      if (canonical.hidden) canonical.hidden = false;
      stampHeroPotOddsFingerprint(canonical);
      heroPotOddsLastMountedFingerprint = heroPotOddsDecisionFingerprint;
      heroPotOddsRenderDiagnostic.lastMountedDecisionFingerprint = heroPotOddsLastMountedFingerprint;
      heroPotOddsVisibilityStats.domWrites += 1;
      recordPotOddsForensic('pill-mounted', trigger);
    } else if (pill) {
      stampHeroPotOddsFingerprint(canonical);
    }
    return canonical;
  }

  function resetHeroPotOddsVisibilityStats(active) {
    heroPotOddsVisibilityStats.active = active === true;
    heroPotOddsVisibilityStats.currentlyVisible = false;
    heroPotOddsVisibilityStats.placementAttempts = 0;
    heroPotOddsVisibilityStats.domWrites = 0;
    heroPotOddsVisibilityStats.idleRetries = 0;
    heroPotOddsVisibilityStats.animationFrameRetries = 0;
    heroPotOddsVisibilityStats.timerRetries = 0;
    heroPotOddsVisibilityStats.firstAttemptTimestamp = null;
    heroPotOddsVisibilityStats.lastAttemptTimestamp = null;
    heroPotOddsVisibilityStats.minimumAttemptIntervalMs = null;
    heroPotOddsVisibilityStats.maximumAttemptIntervalMs = null;
    heroPotOddsVisibilityStats.lastRetryDelayMs = null;
    heroPotOddsVisibilityStats.maximumRetryDelayMs = 0;
    heroPotOddsVisibilityStats.visibilityEstablishedTimestamp = null;
  }

  function stopHeroPotOddsVisibilityRetryWork() {
    heroPotOddsVisibilityGeneration += 1;
    if (heroPotOddsVisibilityFrame !== null) cancelAnimationFrame(heroPotOddsVisibilityFrame);
    heroPotOddsVisibilityFrame = null;
  }

  function cancelHeroPotOddsVisibilityGuarantee(reason) {
    stopHeroPotOddsVisibilityRetryWork();
    heroPotOddsVisibilityStats.active = false;
    if (heroPotOddsAnchorMutationObserver) heroPotOddsAnchorMutationObserver.disconnect();
    if (heroPotOddsAnchorResizeObserver) heroPotOddsAnchorResizeObserver.disconnect();
    if (heroPotOddsAnchorSignalFrame !== null) cancelAnimationFrame(heroPotOddsAnchorSignalFrame);
    heroPotOddsAnchorSignalFrame = null;
    heroPotOddsAnchorPendingReason = null;
    heroPotOddsObservedSeat = null;
    heroPotOddsObservedCard = null;
    heroPotOddsObservedAnchorType = null;
    heroPotOddsObservedResizeTargets = [];
    heroPotOddsPlacementDiagnostic.retryState = 'cancelled';
    if (reason) {
      heroPotOddsPlacementDiagnostic.retryCancelReason = reason;
      recordPotOddsForensic('visibility-guarantee-cancelled', reason);
    }
  }

  function rearmHeroPotOddsBoundedRetry(reason) {
    if (heroPotOddsPlacementDiagnostic.retryState !== 'waiting-for-external-anchor-signal') return false;
    heroPotOddsRetryCount = 0;
    heroPotOddsPlacementDiagnostic.retryState = 'external-anchor-signal-received';
    recordPotOddsForensic('hero-anchor-signal', reason, { boundedRetryRearmed: true });
    return true;
  }

  function scheduleHeroPotOddsAnchorReconcile(reason) {
    if (extensionCleanedUp || !currentPotOddsPresentationDecision()) return false;
    rearmHeroPotOddsBoundedRetry(reason || 'hero anchor signal');
    heroPotOddsAnchorPendingReason = reason || heroPotOddsAnchorPendingReason || 'hero anchor signal';
    if (heroPotOddsAnchorSignalFrame !== null) return false;
    var reconcile = function () {
      heroPotOddsAnchorSignalFrame = null;
      var trigger = heroPotOddsAnchorPendingReason || 'hero anchor signal';
      heroPotOddsAnchorPendingReason = null;
      ensureHeroPotOddsVisibility(trigger);
    };
    heroPotOddsAnchorSignalFrame = requestAnimationFrame(reconcile);
    return true;
  }

  function observeHeroPotOddsAnchor(anchors) {
    if (!anchors || !currentPotOddsPresentationDecision()) return;
    var seat = anchors.seatElement || null;
    var card = anchors.cardElement || null;
    var observerElement = anchors.observerElement || seat;
    var proposedResizeTargets = anchors.resizeElements && anchors.resizeElements.length ? anchors.resizeElements : [card || observerElement || seat];
    var resizeTargets = proposedResizeTargets.filter(Boolean).filter(function (element, index, elements) { return elements.indexOf(element) === index; });
    var sameResizeTargets = resizeTargets.length === heroPotOddsObservedResizeTargets.length && resizeTargets.every(function (element, index) { return element === heroPotOddsObservedResizeTargets[index]; });
    if (observerElement === heroPotOddsObservedSeat && card === heroPotOddsObservedCard && (anchors.anchorType || null) === heroPotOddsObservedAnchorType && sameResizeTargets) return;
    rearmHeroPotOddsBoundedRetry('pot-odds anchor identity changed');
    if (heroPotOddsAnchorMutationObserver) heroPotOddsAnchorMutationObserver.disconnect();
    if (heroPotOddsAnchorResizeObserver) heroPotOddsAnchorResizeObserver.disconnect();
    heroPotOddsObservedSeat = observerElement;
    heroPotOddsObservedCard = card;
    heroPotOddsObservedAnchorType = anchors.anchorType || null;
    heroPotOddsObservedResizeTargets = resizeTargets;
    if (typeof MutationObserver !== 'undefined' && observerElement) {
      heroPotOddsAnchorMutationObserver = new MutationObserver(function () {
        recordPotOddsForensic('anchor-mutation-signal', 'pot-odds anchor DOM changed');
        scheduleHeroPotOddsAnchorReconcile('pot-odds anchor DOM changed');
      });
      heroPotOddsAnchorMutationObserver.observe(observerElement, { childList: true, subtree: true });
    }
    if (typeof ResizeObserver !== 'undefined' && (card || observerElement || seat)) {
      heroPotOddsAnchorResizeObserver = new ResizeObserver(function () {
        recordPotOddsForensic('anchor-resize-signal', 'pot-odds anchor region resized');
        scheduleHeroPotOddsAnchorReconcile('pot-odds anchor region resized');
      });
      resizeTargets.forEach(function (element) { try { heroPotOddsAnchorResizeObserver.observe(element); } catch (_error) {} });
    }
    recordPotOddsForensic('anchor-observer-updated', 'current pot-odds anchor changed', { observerConnected: Boolean(observerElement && observerElement.isConnected), seatConnected: Boolean(seat && seat.isConnected), cardConnected: Boolean(card && card.isConnected) });
  }

  function scheduleHeroPotOddsVisibilityRetry(reason) {
    if (extensionCleanedUp || !currentPotOddsPresentationDecision() || !hudUiPreferences.showPotOdds) return false;
    if (heroPotOddsVisibilityFrame !== null) return false;
    if (heroPotOddsRetryCount >= 6) {
      heroPotOddsVisibilityStats.active = false;
      heroPotOddsPlacementDiagnostic.retryState = 'waiting-for-external-anchor-signal';
      recordPotOddsForensic('placement-waiting-for-anchor-signal', reason, { boundedRetryCount: heroPotOddsRetryCount });
      return false;
    }
    var generation = heroPotOddsVisibilityGeneration;
    heroPotOddsVisibilityStats.active = true;
    heroPotOddsVisibilityStats.lastRetryDelayMs = 0;
    heroPotOddsPlacementDiagnostic.retryState = 'bounded-frame-scheduled';
    heroPotOddsPlacementDiagnostic.retryReason = reason || 'pot-odds anchor geometry is not ready';
    recordPotOddsForensic('placement-retry-scheduled', reason, { retryFrame: heroPotOddsRetryCount + 1, maximumRetryFrames: 6 });
    heroPotOddsVisibilityFrame = requestAnimationFrame(function () {
      heroPotOddsVisibilityFrame = null;
      if (generation !== heroPotOddsVisibilityGeneration) return;
      heroPotOddsVisibilityStats.animationFrameRetries += 1;
      heroPotOddsRetryCount += 1;
      ensureHeroPotOddsVisibility('bounded pot-odds anchor stabilization frame');
    });
    return true;
  }

  function ensureHeroPotOddsVisibility(reason) {
    if (extensionCleanedUp || !currentPotOddsPresentationDecision() || !hudUiPreferences.showPotOdds) {
      cancelHeroPotOddsVisibilityGuarantee('presentation or display gate no longer supported');
      return false;
    }
    ensureHeroPotOddsHost(reason);
    var now = Date.now();
    if (heroPotOddsVisibilityStats.lastAttemptTimestamp !== null) {
      var interval = Math.max(0, now - heroPotOddsVisibilityStats.lastAttemptTimestamp);
      heroPotOddsVisibilityStats.minimumAttemptIntervalMs = heroPotOddsVisibilityStats.minimumAttemptIntervalMs === null ? interval : Math.min(heroPotOddsVisibilityStats.minimumAttemptIntervalMs, interval);
      heroPotOddsVisibilityStats.maximumAttemptIntervalMs = heroPotOddsVisibilityStats.maximumAttemptIntervalMs === null ? interval : Math.max(heroPotOddsVisibilityStats.maximumAttemptIntervalMs, interval);
    }
    heroPotOddsVisibilityStats.firstAttemptTimestamp = heroPotOddsVisibilityStats.firstAttemptTimestamp === null ? now : heroPotOddsVisibilityStats.firstAttemptTimestamp;
    heroPotOddsVisibilityStats.lastAttemptTimestamp = now;
    heroPotOddsVisibilityStats.placementAttempts += 1;
    var placed = positionHeroPotOdds(reason || 'supported visibility reconciliation');
    var heldDuringAnchorReacquisition = Boolean(heroPotOddsPlacementDiagnostic && heroPotOddsPlacementDiagnostic.placementHeldDuringAnchorReacquisition);
    var mountedPill = heroPotOddsElement && heroPotOddsElement.querySelector('.pnhud-pot-odds');
    var mountedPillRect = mountedPill && mountedPill.getBoundingClientRect ? mountedPill.getBoundingClientRect() : null;
    var pillHasArea = Boolean(mountedPillRect && mountedPillRect.width > 0 && mountedPillRect.height > 0);
    var pillIntersectsViewport = Boolean(pillHasArea && mountedPillRect.right > 0 && mountedPillRect.bottom > 0 && mountedPillRect.left < window.innerWidth && mountedPillRect.top < window.innerHeight);
    var mounted = Boolean((placed || heldDuringAnchorReacquisition) && heroPotOddsElement && heroPotOddsElement.isConnected && !heroPotOddsElement.hidden && heroPotOddsElement.style.visibility !== 'hidden' && mountedPill && mountedPill.isConnected && pillIntersectsViewport);
    var mountedState = { visible: mounted, hostConnected: Boolean(heroPotOddsElement && heroPotOddsElement.isConnected), pillConnected: Boolean(mountedPill && mountedPill.isConnected), pillHasArea: pillHasArea, pillIntersectsViewport: pillIntersectsViewport, source: 'successful placement with connected nonzero viewport pill' };
    heroPotOddsPlacementDiagnostic = Object.assign({}, heroPotOddsPlacementDiagnostic, { visible: mounted, actualVisibility: cloneJson(mountedState), visibilityCheckedAt: now });
    if (mounted) {
      if (heldDuringAnchorReacquisition) {
        heroPotOddsVisibilityStats.currentlyVisible = true;
        heroPotOddsPlacementDiagnostic.retryState = 'holding-visible-during-anchor-reacquisition';
        scheduleHeroPotOddsVisibilityRetry(heroPotOddsPlacementDiagnostic.suppressionReason || 'community board geometry is being reacquired');
        recordPotOddsForensic('placement-held-visible', reason, { visibilityStats: cloneJson(heroPotOddsVisibilityStats) });
        return true;
      }
      stopHeroPotOddsVisibilityRetryWork();
      heroPotOddsVisibilityStats.active = false;
      heroPotOddsVisibilityStats.currentlyVisible = true;
      heroPotOddsVisibilityStats.visibilityEstablishedTimestamp = heroPotOddsVisibilityStats.visibilityEstablishedTimestamp || now;
      heroPotOddsRetryCount = 0;
      heroPotOddsPlacementDiagnostic.retryState = 'visible-stable';
      recordPotOddsForensic('placement-stable', reason, { visibilityStats: cloneJson(heroPotOddsVisibilityStats) });
      return true;
    }
    heroPotOddsVisibilityStats.currentlyVisible = false;
    heroPotOddsPlacementDiagnostic.retryState = 'supported-invisible';
    scheduleHeroPotOddsVisibilityRetry(heroPotOddsPlacementDiagnostic.suppressionReason || 'pot-odds anchor placement unavailable');
    return false;
  }

  function cancelHeroPotOddsRender(reason) {
    if (heroPotOddsRenderFrame !== null) cancelAnimationFrame(heroPotOddsRenderFrame);
    heroPotOddsRenderFrame = null;
    heroPotOddsPendingRenderReason = null;
    heroPotOddsRenderDiagnostic.renderPending = false;
    if (reason) {
      heroPotOddsRenderDiagnostic.renderCancelReason = String(reason).slice(0, 160);
      recordPotOddsForensic('render-cancelled', reason);
    }
  }

  function scheduleHeroPotOddsRender(reason) {
    if (extensionCleanedUp) return false;
    var requestedAt = Date.now();
    heroPotOddsPendingRenderReason = String(reason || 'pot odds UI reconcile').slice(0, 160);
    heroPotOddsRenderDiagnostic.lastRenderScheduledTimestamp = requestedAt;
    heroPotOddsRenderDiagnostic.renderTrigger = heroPotOddsPendingRenderReason;
    heroPotOddsRenderDiagnostic.currentDecisionRevision = heroPotOddsDecisionRevision;
    heroPotOddsRenderDiagnostic.currentRenderFingerprint = heroPotOddsDecisionFingerprint;
    if (heroPotOddsRenderFrame !== null) {
      heroPotOddsRenderDiagnostic.renderPending = true;
      heroPotOddsRenderDiagnostic.lastRequestCoalesced = true;
      heroPotOddsRenderDiagnostic.coalescedRequestCount += 1;
      recordPotOddsForensic('render-coalesced', heroPotOddsPendingRenderReason);
      return false;
    }
    heroPotOddsRenderDiagnostic.renderPending = true;
    heroPotOddsRenderDiagnostic.lastRequestCoalesced = false;
    recordPotOddsForensic('render-scheduled', heroPotOddsPendingRenderReason);
    recordBoardCompanionEvent('render-requested', heroPotOddsPendingRenderReason);
    heroPotOddsRenderFrame = requestAnimationFrame(function () {
      var trigger = heroPotOddsPendingRenderReason || 'pot odds UI reconcile';
      heroPotOddsRenderFrame = null;
      heroPotOddsPendingRenderReason = null;
      heroPotOddsRenderDiagnostic.renderPending = false;
      recordPotOddsForensic('render-executing', trigger);
      renderHeroPotOdds(trigger);
    });
    return true;
  }

  function commitPotOddsDecision(next, reason, presentationContext) {
    presentationContext = presentationContext || {};
    var nextDecisionFingerprint = PokerPotOdds.decisionRenderFingerprint(next, hudUiPreferences.showPotOdds);
    var nextPresentation = derivePotOddsPresentation(next, presentationContext.liveState || null, Object.assign({}, presentationContext, { enabled: hudUiPreferences.showPotOdds }));
    var nextFingerprint = potOddsPresentationFingerprint(nextPresentation);
    var previousFingerprint = heroPotOddsDecisionFingerprint;
    var previousStatus = potOddsDecision && potOddsDecision.status || null;
    var changed = nextFingerprint !== heroPotOddsDecisionFingerprint;
    potOddsDecision = next;
    potOddsPresentation = nextPresentation;
    if (!changed) return false;
    heroPotOddsDecisionRevision += 1;
    heroPotOddsDecisionFingerprint = nextFingerprint;
    heroPotOddsRenderDiagnostic.currentDecisionRevision = heroPotOddsDecisionRevision;
    heroPotOddsRenderDiagnostic.currentRenderFingerprint = nextFingerprint;
    heroPotOddsRenderDiagnostic.lastDecisionChangeTimestamp = Date.now();
    cancelHeroPotOddsVisibilityGuarantee('decision revision changed');
    heroPotOddsDiscardedReferenceElements = new WeakSet();
    heroPotOddsDiscardedReferenceCount = 0;
    heroPotOddsRetryCount = 0;
    resetHeroPotOddsVisibilityStats(nextPresentation.visible);
    recordPotOddsForensic('decision-committed', reason, { previousFingerprintChanged: true, previousFingerprint: previousFingerprint, nextFingerprint: nextFingerprint, nextDecisionFingerprint: nextDecisionFingerprint, previousStatus: previousStatus, nextStatus: next && next.status || null, presentationVisible: nextPresentation.visible, panelVisibleReason: nextPresentation.panelVisibleReason, panelHiddenReason: nextPresentation.panelHiddenReason });
    scheduleHeroPotOddsRender(reason || 'pot odds decision changed');
    return true;
  }

  function positionHeroPotOdds(reason) {
    if (!heroPotOddsElement || heroPotOddsElement.hidden || !heroPotOddsElement.isConnected) return false;
    var measuredPill = heroPotOddsElement.querySelector('.pnhud-pot-odds') || heroPotOddsElement;
    var measuredPillRect = measuredPill.getBoundingClientRect();
    var panelSize = { width: measuredPillRect.width || heroPotOddsElement.offsetWidth || 250, height: measuredPillRect.height || heroPotOddsElement.offsetHeight || 34 };
    var anchors = boardCompanionPotOddsAnchors(panelSize, reason);
    if (!anchors) {
      anchors = { leftCompanionRect: null, rightCompanionRect: null, canonicalBoardRect: null, anchorRect: null, anchorType: 'canonical-board-slot', obstacleRects: [], obstacleDiagnostics: [], heroAnchorDiagnostic: cloneJson(heroPotOddsAnchorDiagnostic) };
    }
    var boardReset = PokerPotOddsPosition.observeAuthoritativeBoard(potOddsBoardResetState, {
      handId: potOddsPresentation && potOddsPresentation.handId || potOddsLiveState.currentHandId || null,
      authoritativeStreet: potOddsPresentation && potOddsPresentation.street || null,
      canonicalBoardVerified: Boolean(anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.canonicalBoardVerified),
      measuredBoardCardCount: anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.selectedBoardCards ? anchors.heroAnchorDiagnostic.selectedBoardCards.length : 0
    });
    if (boardReset.reset) {
      var offsetBeforeBoardReset = persistedPotOddsOffset();
      heroPotOddsResetPending = true;
      lastPotOddsOffsetMutation = { reasonCode: 'NEW_BOARD_CANONICAL_RESET', source: boardReset.reason, timestamp: Date.now(), handId: boardReset.handId, sequence: boardReset.sequence, before: offsetBeforeBoardReset, after: { x: 0, y: 0 } };
      recordBoardCompanionEvent('offset-mutation', 'NEW_BOARD_CANONICAL_RESET: first authoritative board set the feature offset to exactly 0/0');
      updateHudUiPreferences({ potOddsOffsetX: 0, potOddsOffsetY: 0 }, 'new-board-canonical-reset', { render: false, persist: false });
      var boardResetUpdate = {};
      boardResetUpdate[STORAGE_KEYS.hudUiPreferences] = hudUiPreferences;
      boardResetUpdate[STORAGE_KEYS.potOddsBoardReset] = PokerPotOddsPosition.createBoardResetState(potOddsBoardResetState);
      chrome.storage.local.set(boardResetUpdate, function () { recordBoardCompanionEvent('offset-persisted', 'new-board canonical reset 0/0 and per-hand latch storage write completed'); });
      if (activePotOddsDrag) finishPotOddsDrag(null, true);
    }
    var viewport = { width: window.innerWidth, height: window.innerHeight };
    var canonicalPlacementReady = Boolean(anchors.leftCompanionRect);
    var retainedVisibleRect = !canonicalPlacementReady && potOddsRect(heroPotOddsLastVisibleRect || heroPotOddsPlacementDiagnostic && heroPotOddsPlacementDiagnostic.actualPanelRect || null);
    var manualPlacement = canonicalPlacementReady
      ? PokerPotOddsPosition.place(anchors.leftCompanionRect, effectivePotOddsOffset(), viewport)
      : retainedVisibleRect ? {
        canonicalLeftCompanionRect: null,
        persistedOffsetX: effectivePotOddsOffset().x,
        persistedOffsetY: effectivePotOddsOffset().y,
        unclampedActualRect: retainedVisibleRect,
        actualPanelRect: retainedVisibleRect,
        viewportClampApplied: false,
        fallback: 'last visible panel position retained while canonical geometry is unavailable'
      } : PokerPotOddsPosition.deterministicFallback(panelSize, effectivePotOddsOffset(), viewport);
    var canonicalLeft = anchors.leftCompanionRect;
    var proposedLeft = manualPlacement && manualPlacement.actualPanelRect || null;
    function overlaps(left, right) {
      return Boolean(left && right && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top);
    }
    var obstacleIndexes = (anchors.obstacleRects || []).map(function (rect, index) { return overlaps(proposedLeft, rect) ? index : -1; }).filter(function (index) { return index >= 0; });
    var companionCollisionLabel = manualPlacement && (manualPlacement.persistedOffsetX || manualPlacement.persistedOffsetY) ? 'offset LEFT companion' : 'fixed LEFT companion';
    var collisionReason = obstacleIndexes.length ? companionCollisionLabel + ' overlaps page obstacle(s) ' + obstacleIndexes.join(',') : manualPlacement && manualPlacement.viewportClampApplied ? 'minimal viewport safety clamp applied to user-offset position' : null;
    var placement = {
      left: proposedLeft ? proposedLeft.left : 0,
      top: proposedLeft ? proposedLeft.top : 0,
      width: panelSize.width,
      height: panelSize.height,
      anchored: Boolean(proposedLeft),
      safe: canonicalPlacementReady,
      visiblePlacement: Boolean(proposedLeft),
      strategy: canonicalPlacementReady ? 'canonical-left-board-companion-plus-user-offset' : retainedVisibleRect ? 'retain-last-visible-panel-pending-canonical-geometry' : 'deterministic-initial-companion-fallback-pending-canonical-geometry',
      selectedSide: proposedLeft ? 'left' : null,
      chosenAnchor: 'canonical-board-slot',
      proposedRect: proposedLeft ? potOddsRect(proposedLeft) : null,
      collision: { card: false, obstacleIndexes: obstacleIndexes },
      candidates: [
        { side: 'left', strategy: canonicalPlacementReady ? 'canonical-left-board-companion-plus-user-offset' : 'visible-fallback-pending-canonical-geometry', safe: canonicalPlacementReady, proposedRect: potOddsRect(proposedLeft), canonicalRect: potOddsRect(canonicalLeft), collision: { anchor: false, card: false, obstacleIndexes: obstacleIndexes } },
        { side: 'right-reserved', strategy: 'reserved-right-board-companion-slot', safe: Boolean(anchors.rightCompanionRect), proposedRect: potOddsRect(anchors.rightCompanionRect), collision: { anchor: false, card: false, obstacleIndexes: [] } }
      ],
      suppressionReason: canonicalPlacementReady ? null : 'canonical board-companion geometry unavailable; visible position retained',
      candidateCount: canonicalPlacementReady ? 2 : 0,
      horizontalGap: proposedLeft && anchors.canonicalBoardRect ? Math.round((anchors.canonicalBoardRect.left - proposedLeft.right) * 10) / 10 : null,
      verticalCenterDelta: proposedLeft && anchors.canonicalBoardRect ? Math.round(((proposedLeft.top + proposedLeft.height / 2) - (anchors.canonicalBoardRect.top + anchors.canonicalBoardRect.height / 2)) * 10) / 10 : null,
      collisionReason: collisionReason,
      canonicalLeftCompanionRect: potOddsRect(canonicalLeft),
      persistedOffsetX: hudUiPreferences.potOddsOffsetX,
      persistedOffsetY: hudUiPreferences.potOddsOffsetY,
      effectiveOffsetX: manualPlacement ? manualPlacement.persistedOffsetX : hudUiPreferences.potOddsOffsetX,
      effectiveOffsetY: manualPlacement ? manualPlacement.persistedOffsetY : hudUiPreferences.potOddsOffsetY,
      unclampedActualRect: manualPlacement ? potOddsRect(manualPlacement.unclampedActualRect) : null,
      actualPanelRect: manualPlacement ? potOddsRect(manualPlacement.actualPanelRect) : null,
      viewportClampApplied: Boolean(manualPlacement && manualPlacement.viewportClampApplied),
      draggingNow: Boolean(activePotOddsDrag)
    };
    var priorSafePanelRect = heroPotOddsPlacementDiagnostic && heroPotOddsPlacementDiagnostic.visible && heroPotOddsPlacementDiagnostic.proposedPanelRect || null;
    var holdLastSafePlacement = Boolean(!canonicalPlacementReady && proposedLeft);
    var nextLeft = placement.left + 'px';
    var nextTop = placement.top + 'px';
    var nextVisibility = 'visible';
    if (heroPotOddsElement.style.transform) { heroPotOddsElement.style.transform = ''; heroPotOddsVisibilityStats.domWrites += 1; }
    if (heroPotOddsElement.style.left !== nextLeft) { heroPotOddsElement.style.left = nextLeft; heroPotOddsVisibilityStats.domWrites += 1; }
    if (heroPotOddsElement.style.top !== nextTop) { heroPotOddsElement.style.top = nextTop; heroPotOddsVisibilityStats.domWrites += 1; }
    if (heroPotOddsElement.style.visibility !== nextVisibility) { heroPotOddsElement.style.visibility = nextVisibility; heroPotOddsVisibilityStats.domWrites += 1; }
    heroPotOddsElement.dataset.pnhudPlacement = placement.selectedSide ? placement.selectedSide + '-of-' + (anchors.anchorType || 'pot-odds-anchor') : 'awaiting-horizontal-pot-odds-placement';
    heroPotOddsElement.dataset.pnhudCollisionSafe = String(placement.safe);
    heroPotOddsElement.dataset.pnhudHorizontalGap = placement.horizontalGap === null ? 'unresolved' : String(placement.horizontalGap);
    heroPotOddsElement.dataset.pnhudVerticalCenterDelta = placement.verticalCenterDelta === null ? 'unresolved' : String(placement.verticalCenterDelta);
    if (proposedLeft) heroPotOddsLastVisibleRect = potOddsRect(proposedLeft);
    var resetAppliedNow = canonicalPlacementReady && heroPotOddsResetPending;
    if (resetAppliedNow) {
      heroPotOddsResetPending = false;
    }
    var retriedSuccessfully = placement.safe && heroPotOddsRetryCount > 0;
    var publicAnchorType = anchors.anchorType === 'canonical-board-slot' ? 'canonical-board-slot' : null;
    heroPotOddsPlacementDiagnostic = {
      timestamp: Date.now(), renderRequested: true, supportedDecision: true, renderingReason: heroPotOddsRenderReason,
      placementReason: reason || null, visible: placement.safe || holdLastSafePlacement,
      chosenAnchorType: anchors.anchorType, chosenAnchor: placement.chosenAnchor,
      anchorType: publicAnchorType,
      anchorRect: potOddsRect(anchors.anchorRect), boardRect: potOddsRect(anchors.boardRect), boardRectUsed: anchors.anchorType === 'community-board-region' ? potOddsRect(anchors.boardRect) : potOddsRect(anchors.canonicalBoardRect),
      canonicalBoardSource: anchors.canonicalBoardSource || null, canonicalBoardRect: potOddsRect(anchors.canonicalBoardRect),
      canonicalBoardLocalRect: cloneJson(anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.canonicalBoardLocalRect || null),
      layoutEpochId: anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.layoutEpochId || null,
      tableOwnerSource: anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.tableOwnerSource || null,
      canonicalLeftCompanionRect: placement.canonicalLeftCompanionRect,
      persistedOffsetX: placement.persistedOffsetX, persistedOffsetY: placement.persistedOffsetY,
      effectiveOffsetX: placement.effectiveOffsetX, effectiveOffsetY: placement.effectiveOffsetY,
      unclampedActualRect: placement.unclampedActualRect, actualPanelRect: placement.actualPanelRect,
      viewportClampApplied: placement.viewportClampApplied, draggingNow: placement.draggingNow,
      actualBoardCardUnion: potOddsRect(anchors.actualBoardCardUnion), emptyBoardContainerRect: potOddsRect(anchors.emptyBoardContainerRect),
      virtualBoardRect: null,
      actualBoardRect: potOddsRect(anchors.actualBoardCardUnion || anchors.boardRect),
      preflopAnchorSource: null,
      preflopToPostflopTransitionDelta: null,
      activeHeroHand: Boolean(potOddsPresentation && potOddsPresentation.heroActiveInHand), amountToCall: potOddsPresentation && potOddsPresentation.presentationAmountToCall,
      contentState: potOddsPresentation && potOddsPresentation.contentState || null,
      tableLifecycleState: potOddsPresentation && potOddsPresentation.tableLifecycleState || null,
      tableApplicable: Boolean(potOddsPresentation && potOddsPresentation.tableApplicable),
      heroSeated: Boolean(potOddsPresentation && potOddsPresentation.heroSeated),
      zeroCallPersistentState: Boolean(potOddsPresentation && potOddsPresentation.persistentZeroState),
      heroActiveInHand: Boolean(potOddsPresentation && potOddsPresentation.heroActiveInHand), heroFolded: potOddsPresentation && potOddsPresentation.heroFolded, heroAllIn: potOddsPresentation && potOddsPresentation.heroAllIn,
      handActive: Boolean(potOddsPresentation && potOddsPresentation.handActive), currentDecisionAvailable: Boolean(potOddsPresentation && potOddsPresentation.currentDecisionAvailable),
      currentDecisionStatus: potOddsPresentation && potOddsPresentation.currentDecisionStatus || null, currentAmountToCall: potOddsPresentation && potOddsPresentation.currentAmountToCall,
      presentationAmountToCall: potOddsPresentation && potOddsPresentation.presentationAmountToCall,
      presentationRequiredEquity: potOddsPresentation && potOddsPresentation.presentationRequiredEquity,
      persistentZeroState: Boolean(potOddsPresentation && potOddsPresentation.persistentZeroState),
      panelVisibleReason: potOddsPresentation && potOddsPresentation.panelVisibleReason || null, panelHiddenReason: potOddsPresentation && potOddsPresentation.panelHiddenReason || null,
      boardSource: anchors.boardSource, fallbackUsed: anchors.fallbackUsed === true, fallbackReason: anchors.fallbackReason || null,
      heroCardRect: potOddsRect(anchors.heroCardRect), heroCardSource: anchors.heroCardSource, heroAnchorDiagnostic: cloneJson(anchors.heroAnchorDiagnostic || heroPotOddsAnchorDiagnostic),
      heroSeatAnchorRect: potOddsRect(anchors.heroRect), selfHudRect: potOddsRect(anchors.selfHudRect),
      proposedPillRect: placement.proposedRect, proposedPanelRect: placement.proposedRect, selectedSide: placement.selectedSide, placementStrategy: placement.strategy,
      placementHeldDuringAnchorReacquisition: holdLastSafePlacement,
      canonicalGeometryPending: !canonicalPlacementReady,
      resetPending: heroPotOddsResetPending,
      boardContainerUsable: anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.boardContainerUsable === true,
      virtualBoardFallbackUsed: anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.virtualBoardFallbackUsed === true,
      tableRect: cloneJson(anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.tableRect || null), tableRectSource: anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.tableRectSource || null,
      potRect: cloneJson(anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.potRect || null), potCenterReference: cloneJson(anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.potCenterReference || null),
      derivedVirtualBoardRect: cloneJson(anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.derivedVirtualBoardRect || null),
      chosenPanelRect: placement.proposedRect,
      rightCompanionRect: potOddsRect(anchors.rightCompanionRect),
      collision: placement.collision, collisionInfo: { selected: placement.collision, candidates: placement.candidates || [], obstacles: cloneJson(anchors.obstacleDiagnostics || []) }, leftRightCollisionCandidates: cloneJson(placement.candidates || []), suppressionReason: placement.suppressionReason, candidateCount: placement.candidateCount,
      collisionReason: placement.collisionReason || null,
      cachedGeometryReused: anchors.heroAnchorDiagnostic && anchors.heroAnchorDiagnostic.cachedGeometryReused === true,
      horizontalGap: placement.horizontalGap, verticalCenterDelta: placement.verticalCenterDelta,
      retryCount: heroPotOddsRetryCount, retryState: placement.safe ? 'resolved' : 'unresolved', laterRetrySucceeded: retriedSuccessfully
    };
    updateBoardCompanionDiagnosticContext(placement.collisionReason || null);
    if (resetAppliedNow) recordBoardCompanionEvent('reset-applied', '0/0 reset rendered at the current canonical LEFT slot');
    recordPotOddsForensic(placement.safe ? 'placement-succeeded' : holdLastSafePlacement ? 'placement-held-visible' : 'placement-unavailable', reason, { anchorType: anchors.anchorType, boardGeometryAvailable: Boolean(anchors.boardRect), fallbackUsed: anchors.fallbackUsed === true, placementSafe: placement.safe, heldVisible: holdLastSafePlacement });
    recordBoardCompanionEvent(canonicalPlacementReady ? 'panel-position' : 'stale-geometry-retained', reason || 'pot-odds positioned');
    return placement.safe;
  }

  function renderHeroPotOdds(reason) {
    if (extensionCleanedUp) return;
    heroPotOddsRenderDiagnostic.lastRenderExecutedTimestamp = Date.now();
    heroPotOddsRenderDiagnostic.renderTrigger = String(reason || 'render').slice(0, 160);
    heroPotOddsRenderDiagnostic.renderPending = false;
    heroPotOddsRenderReason = reason || 'render';
    var presentationDecision = currentPotOddsPresentationDecision();
    var visible = hudUiPreferences.showPotOdds && Boolean(presentationDecision);
    if (!visible) {
      recordBoardCompanionEvent('hide-attempt', !hudUiPreferences.showPotOdds ? 'Show Pot Odds disabled' : potOddsPresentation && potOddsPresentation.panelHiddenReason || 'table companion is not applicable');
      cancelHeroPotOddsVisibilityGuarantee('render gate is not supported');
      if (heroPotOddsElement) {
        if (!heroPotOddsElement.hidden) { heroPotOddsElement.hidden = true; heroPotOddsVisibilityStats.domWrites += 1; }
        if (heroPotOddsElement.innerHTML) { heroPotOddsElement.innerHTML = ''; heroPotOddsVisibilityStats.domWrites += 1; }
      }
      heroPotOddsLastMountedFingerprint = null;
      heroPotOddsRenderDiagnostic.lastMountedDecisionFingerprint = null;
      heroPotOddsPlacementDiagnostic = { timestamp: Date.now(), renderRequested: false, supportedDecision: Boolean(potOddsPresentation && potOddsPresentation.visible), visible: false, suppressionReason: !hudUiPreferences.showPotOdds ? 'Show pot odds disabled' : potOddsPresentation && potOddsPresentation.panelHiddenReason || 'table companion is not applicable', panelVisibleReason: potOddsPresentation && potOddsPresentation.panelVisibleReason || null, panelHiddenReason: potOddsPresentation && potOddsPresentation.panelHiddenReason || null, retryCount: 0, retryState: 'cancelled', renderingReason: heroPotOddsRenderReason };
      recordPotOddsForensic('render-cleared', reason);
      recordBoardCompanionEvent('render-committed', reason || 'inapplicable render committed');
      return;
    }
    ensureHeroPotOddsHost(reason);
    var widget = PokerPotOdds.widgetHtml(presentationDecision);
    if (heroPotOddsLastMountedFingerprint !== heroPotOddsDecisionFingerprint || !heroPotOddsElement.querySelector('.pnhud-pot-odds')) {
      heroPotOddsElement.innerHTML = widget;
      heroPotOddsVisibilityStats.domWrites += 1;
    }
    if (heroPotOddsElement.hidden) { heroPotOddsElement.hidden = false; heroPotOddsVisibilityStats.domWrites += 1; }
    stampHeroPotOddsFingerprint(heroPotOddsElement);
    heroPotOddsLastMountedFingerprint = heroPotOddsDecisionFingerprint;
    heroPotOddsRenderDiagnostic.lastMountedDecisionFingerprint = heroPotOddsLastMountedFingerprint;
    ensureHeroPotOddsVisibility('render execution: ' + String(reason || 'render'));
    recordPotOddsForensic('render-executed', reason, { visibilityStats: cloneJson(heroPotOddsVisibilityStats) });
    recordBoardCompanionEvent('render-committed', reason || 'table companion render committed');
    console.log('[HUD POT ODDS UI]', { reason: reason || 'render', placement: heroPotOddsPlacementDiagnostic.chosenAnchorType || 'unresolved', decision: PokerPotOdds.currentDecision(potOddsDecision) });
  }

  function liveSeatTableRect() {
    var rects = identityDiagnostics.domSeats.map(function (seat) {
      var element = domSeatElements.get(seat.elementId);
      if (element && element.isConnected) {
        var liveRect = element.getBoundingClientRect();
        if (validAnchorRect(liveRect)) return { rect: { left: liveRect.left, top: liveRect.top, width: liveRect.width, height: liveRect.height } };
      }
      return validAnchorRect(seat.boundingBox) ? { rect: seat.boundingBox } : null;
    }).filter(Boolean);
    return PokerSeatOverlay.tableRectForSeats(rects) || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, right: window.innerWidth, bottom: window.innerHeight };
  }

  function recordSeatHudPositionDiagnostic(playerId, value) {
    var diagnostic = Object.assign({ timestamp: Date.now(), currentStatSource: currentSeatHudStatSource(), blockingPanelState: cloneJson(seatHudBlockingPanelState) }, value || {});
    seatHudPositionDiagnostics.set(String(playerId), diagnostic);
    seatHudPositionHistory.push(cloneJson(diagnostic));
    if (seatHudPositionHistory.length > 80) seatHudPositionHistory.shift();
  }

  function positionAllSeatOverlays(entries) {
    if (!seatOverlayController || !seatOverlayLayer || !seatOverlaysVisible()) return;
    var confirmedEntries = entries.filter(function (entry) { return entry.confirmed && seatOverlayController.records.has(String(entry.playerId)); }).sort(function (left, right) {
      return Number(left.clockwiseIndex || 0) - Number(right.clockwiseIndex || 0) || String(left.playerId).localeCompare(String(right.playerId));
    });
    var sizes = {};
    confirmedEntries.forEach(function (entry) {
      var record = seatOverlayController.records.get(String(entry.playerId));
      record.element.classList.toggle('pnhud-debug-identity', debugSeatIdentity);
      if (!activeOverlayDrag || activeOverlayDrag.playerId !== String(entry.playerId)) record.element.style.visibility = 'hidden';
      sizes[String(entry.playerId)] = { width: record.element.offsetWidth || 132, height: record.element.offsetHeight || 18 };
    });
    var viewport = { width: window.innerWidth, height: window.innerHeight };
    var tableRect = liveSeatTableRect();
    var canonicalLayout = PokerSeatOverlay.layoutCanonicalSeatHudOverlays(confirmedEntries, sizes, viewport, manualOverlayPositions, tableRect);
    var placements = canonicalLayout.placements;
    var positionsChanged = false;
    confirmedEntries.forEach(function (entry) {
      var record = seatOverlayController.records.get(String(entry.playerId));
      var placement = placements.get(String(entry.playerId));
      if (!placement) {
        record.element.style.visibility = 'hidden';
        console.warn('[HUD SEAT OVERLAY] removed', { playerId: entry.playerId, fullName: entry.name, domSeatIdentifier: entry.seatId, reason: 'no collision-free placement exists; overlay withheld instead of covering table content' });
        return;
      }
      if (activeOverlayDrag && activeOverlayDrag.playerId === String(entry.playerId)) return;
      var left = Math.round(placement.left);
      var top = Math.round(placement.top);
      record.element.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
      record.element.style.visibility = 'visible';
      var previousPlacement = record.lastPlacement || null;
      record.lastPlacement = Object.assign({}, placement, { left: left, top: top });
      record.canonicalPlacement = Object.assign({}, placement.canonicalRect);
      record.element.dataset.pnhudPlacement = placement.manual ? 'canonical-plus-manual-offset' : 'canonical-seat-slot';
      record.element.dataset.pnhudStatSource = currentSeatHudStatSource();
      record.element.dataset.pnhudViewportClamped = placement.viewportClampApplied ? 'true' : 'false';
      if (placement.manual && manualOverlayPositions[String(entry.playerId)] && manualOverlayPositions[String(entry.playerId)].seatId !== entry.seatId) {
        manualOverlayPositions[String(entry.playerId)] = Object.assign({}, manualOverlayPositions[String(entry.playerId)], { seatId: entry.seatId });
        positionsChanged = true;
      }
      var pureDiagnostic = canonicalLayout.diagnostics.get(String(entry.playerId)) || {};
      recordSeatHudPositionDiagnostic(entry.playerId, Object.assign({}, pureDiagnostic, seatHudPanelBodyAlignmentDiagnostic(entry.visualAnchorReference, entry.visualRect || entry.rect, placement.canonicalRect), {
        stablePlayerId: String(entry.playerId),
        seatIndex: entry.seatIndex === undefined ? null : entry.seatIndex,
        physicalSeatIndex: entry.seatIndex === undefined ? null : entry.seatIndex,
        physicalSeat: entry.physicalSeat,
        horizontalAnchorSource: entry.visualAnchorReference && entry.visualAnchorReference.horizontalAnchorSource || entry.visualAnchorSource,
        horizontalAnchorRect: cloneJson(entry.visualAnchorReference && entry.visualAnchorReference.horizontalAnchorRect || entry.visualRect),
        verticalAnchorSource: entry.visualAnchorReference && entry.visualAnchorReference.verticalAnchorSource || entry.visualAnchorSource,
        verticalAnchorRect: cloneJson(entry.visualAnchorReference && entry.visualAnchorReference.verticalAnchorRect || entry.visualRect),
        canonicalCenterX: placement.canonicalRect.left + placement.canonicalRect.width / 2,
        canonicalTop: placement.canonicalRect.top,
        connectedAnchorState: { connected: true, seatId: entry.seatId, identityAnchorReference: entry.anchorReference || null, visualAnchorSource: entry.visualAnchorSource || 'authoritative-seat-fallback', visualAnchorReference: entry.visualAnchorReference || null },
        tableRect: cloneJson(tableRect),
        currentStatSource: entry.statSource,
        statSource: entry.statSource,
        profileSource: entry.profileStatSource,
        careerBatchState: { requestToken: seatHudCareerRequestToken, loadedSignature: seatHudCareerLoadedSignature, pendingSignature: seatHudCareerPendingSignature, loading: seatHudCareerQueryDiagnostics.loading },
        blockingPanelState: cloneJson(seatHudBlockingPanelState),
        suppressionReason: seatHudBlockingPanelState.blocked ? seatHudBlockingPanelState.reasons.slice() : [],
        layerOwnership: { owner: 'body-level-extension-root', seatHudZIndex: 2147483643, chatLayer: 'below-seat-hud', ordinaryLogLauncherLayer: 'below-seat-hud', expandedPokerNowPanelZIndex: 2147483644, expandedPanelAboveSeatHud: Boolean(seatHudBlockingPanelState.expandedPanelAboveSeatHud), belowExtensionModals: true }
      }));
      console.log('[HUD SEAT OVERLAY] positioned', { playerId: entry.playerId, fullName: entry.name, domSeatIdentifier: entry.seatId, physicalSeat: entry.physicalSeat, identityAnchor: entry.anchorReference || null, visualAnchorSource: entry.visualAnchorSource || 'authoritative-seat-fallback', visualAnchor: entry.visualAnchorReference || null, placementKind: placement.kind, viewportClampApplied: Boolean(placement.viewportClampApplied), gripAccessible: Boolean(placement.gripAccessible), finalLeft: left, finalTop: top, placement: record.lastPlacement });
      if (previousPlacement && (previousPlacement.left !== left || previousPlacement.top !== top)) {
        console.log('[HUD SEAT OVERLAY] moved', { playerId: entry.playerId, fullName: entry.name, domSeatIdentifier: entry.seatId, selectedAnchor: entry.anchorReference || null, previousLeft: previousPlacement.left, previousTop: previousPlacement.top, finalLeft: left, finalTop: top, reason: 'live seat-local canonical base or viewport accessibility changed' });
      }
    });
    if (positionsChanged) persistManualOverlayPositions();
    scheduleNativePanelOcclusion('seat overlays positioned');
  }

  function ensureSeatOverlaySystem() {
    if (extensionCleanedUp || seatOverlayRendererSuperseded || !runtimeScope.isPokerNowGamePage(window.location)) return false;
    if (!seatOverlayLayer || !seatOverlayLayer.isConnected) {
      var existingLayer = document.getElementById(overlayRootId);
      if (existingLayer && existingLayer.isConnected) {
        seatOverlayLayer = existingLayer;
        console.log('[HUD UI ROOT] found existing', { rootId: overlayRootId, connected: true, source: 'minimal root bootstrap' });
      } else {
        seatOverlayLayer = document.createElement('div');
        seatOverlayLayer.id = overlayRootId;
        (document.body || document.documentElement).appendChild(seatOverlayLayer);
        console.log('[HUD UI ROOT] created', { rootId: overlayRootId, parent: seatOverlayLayer.parentElement && seatOverlayLayer.parentElement.tagName });
      }
      seatOverlayLayer.dataset.pnhudGameId = pokerNowGameId;
      seatOverlayLayer.setAttribute('aria-hidden', 'false');
    } else if (document.body && seatOverlayLayer.parentElement !== document.body) {
      document.body.appendChild(seatOverlayLayer);
      console.log('[HUD UI ROOT] replaced', { rootId: overlayRootId, reason: 'moved top-level overlay root under BODY' });
    } else {
      console.log('[HUD UI ROOT] found existing', { rootId: overlayRootId, connected: seatOverlayLayer.isConnected });
    }
    if (seatOverlayController) {
      if (!seatOverlayRendererOwnsLayer(seatOverlayLayer)) retireSupersededSeatOverlayRenderer('shared Seat HUD root claimed by a newer renderer');
      return !seatOverlayRendererSuperseded;
    }
    retireUnownedSeatOverlayDom(seatOverlayLayer);
    seatOverlayController = PokerSeatOverlay.createController({
      create: function (entry) {
        var element = document.createElement('div');
        element.className = 'pnhud-seat-overlay';
        element.dataset.pnhudPlayerId = entry.playerId;
        element.id = 'pnhud-seat-overlay-' + stableHash(pokerNowGameId + '|' + entry.playerId);
        element.dataset.pnhudSeatId = entry.seatId;
        element.dataset.pnhudGameId = pokerNowGameId;
        element.innerHTML = seatOverlayContent(entry);
        element.setAttribute('aria-label', seatOverlayAriaLabel(entry));
        element.classList.toggle('pnhud-debug-identity', debugSeatIdentity);
        element.classList.toggle('pnhud-no-visible-stats', !seatOverlayHasVisibleContent(entry));
        element.style.visibility = 'hidden';
        seatOverlayLayer.appendChild(element);
        installDragBehavior(element, entry.playerId);
        pipelineHealth.overlayElementsCreated += 1;
        console.log('[HUD SEAT OVERLAY] element created', { playerId: entry.playerId, name: entry.name, domSeatIdentifier: entry.seatId, appended: element.isConnected, placement: 'pending canonical under-player layout' });
        return element;
      },
      update: function (record, entry, reason) {
        record.element.innerHTML = seatOverlayContent(entry);
        record.element.setAttribute('aria-label', seatOverlayAriaLabel(entry));
        record.element.dataset.pnhudSeatId = entry.seatId;
        record.element.classList.toggle('pnhud-debug-identity', debugSeatIdentity);
        record.element.classList.toggle('pnhud-no-visible-stats', !seatOverlayHasVisibleContent(entry));
        installDragBehavior(record.element, entry.playerId);
        applyOverlayDragState(record.element);
        console.log('[HUD SEAT OVERLAY] updated', { playerId: entry.playerId, name: entry.name, domSeatIdentifier: entry.seatId, reason: reason });
      },
      move: function (record, entry, reason) {
        record.element.dataset.pnhudSeatId = entry.seatId;
        installDragBehavior(record.element, entry.playerId);
        console.log('[HUD SEAT OVERLAY] moved', { playerId: entry.playerId, fullName: entry.name, domSeatIdentifier: entry.seatId, previousDomSeatIdentifier: record.seatId, selectedAnchor: entry.anchorReference || null, placement: 'pending canonical under-player layout', reason: reason });
      },
      position: function () {},
      remove: function (record, reason) {
        cleanupDragBehavior(record.element, record.playerId, reason);
        removeSeatOverlayClip(record.element);
        if (record.element && record.element.remove) record.element.remove();
        console.log('[HUD SEAT OVERLAY] removed', { playerId: record.playerId, name: record.name, domSeatIdentifier: record.seatId, reason: reason });
      },
      skip: function (entry, reason) {
        console.log('[HUD SEAT OVERLAY] skipped: unconfirmed mapping', { playerId: entry && entry.playerId || null, name: entry && entry.name || null, domSeatIdentifier: entry && entry.seatId || null, reason: reason });
      }
    });
    return true;
  }

  function renderAnchorDebugBoxes(entries) {
    if (!seatOverlayLayer) return;
    seatOverlayLayer.querySelectorAll('.pnhud-anchor-box, .pnhud-anchor-line').forEach(function (element) { element.remove(); });
    if (!showOverlayBoxes || !seatOverlaysVisible()) return;
    entries.filter(function (entry) { return entry.confirmed && validAnchorRect(entry.rect); }).forEach(function (entry) {
      var box = document.createElement('div');
      box.className = 'pnhud-anchor-box';
      box.dataset.pnhudPlayerId = entry.playerId;
      box.style.width = Math.round(entry.rect.width) + 'px';
      box.style.height = Math.round(entry.rect.height) + 'px';
      box.style.transform = 'translate3d(' + Math.round(entry.rect.left) + 'px,' + Math.round(entry.rect.top) + 'px,0)';
      box.textContent = entry.name + ' [' + String(entry.playerId || '').slice(0, 4) + '] · ' + entry.seatId + ' · ' + String(entry.anchorReference && (entry.anchorReference.kind || entry.anchorReference.source) || 'anchor');
      seatOverlayLayer.appendChild(box);
      var overlay = Array.from(seatOverlayLayer.querySelectorAll('.pnhud-seat-overlay')).find(function (candidate) { return String(candidate.dataset.pnhudPlayerId || '') === String(entry.playerId); });
      if (overlay) {
        var overlayRect = overlay.getBoundingClientRect();
        var startX = entry.rect.left + entry.rect.width / 2;
        var startY = entry.rect.top + entry.rect.height;
        var endX = overlayRect.left + overlayRect.width / 2;
        var endY = overlayRect.top;
        var distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        var angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;
        var line = document.createElement('div');
        line.className = 'pnhud-anchor-line';
        line.dataset.pnhudPlayerId = entry.playerId;
        line.style.width = Math.round(distance) + 'px';
        line.style.transform = 'translate3d(' + Math.round(startX) + 'px,' + Math.round(startY) + 'px,0) rotate(' + angle + 'deg)';
        seatOverlayLayer.appendChild(line);
      }
    });
  }

  function genericWithheldIdentity(value) {
    return /^(?:gameplayer|game-player|player|players|currentplayer|current-player|localplayer|local-player|observer|unknown|null|undefined)$/i.test(String(value || '').trim());
  }

  function shortWithheldReason(reason) {
    var value = String(reason || '');
    if (/ambig|multiple|conflict|different pairing|optimal one-to-one/i.test(value)) return 'ambiguous mapping';
    if (/anchor/i.test(value)) return 'no safe seat anchor';
    if (/confirm|contract/i.test(value)) return 'identity unconfirmed';
    if (/insufficient|no corroborating|evidence/i.test(value)) return 'insufficient identity evidence';
    return 'mapping withheld';
  }

  function preparedWithheldPlaceholders() {
    var seenPlayerIds = new Set();
    var seenNames = new Set();
    return withheldOverlayDiagnostics.map(function (item) {
      var playerId = String(item.playerId || '').trim();
      var seat = identityDiagnostics.domSeats.find(function (candidate) { return String(candidate.elementId) === String(item.seatId); });
      var socketRecord = identityDiagnostics.socketPlayers.get(playerId);
      var visibleName = seat && String(seat.displayedName || '').trim();
      var suppliedName = String(item.playerName || '').trim();
      var playerName = suppliedName && suppliedName !== playerId && !genericWithheldIdentity(suppliedName) ? suppliedName : visibleName;
      var realSeatedPlayer = Boolean(playerId && !genericWithheldIdentity(playerId) && socketRecord && seat && seat.occupied !== false && visibleName && !genericWithheldIdentity(visibleName) && validAnchorRect(item.rect));
      if (!realSeatedPlayer) {
        console.log('[HUD MAP DEBUG] withheld placeholder filtered', { playerId: playerId || null, suppliedName: suppliedName || null, seatId: item.seatId || null, reason: 'generic, transient, internal, unseated, or missing a real occupied-seat candidate', originalRejectionEvidence: item.reason });
        return null;
      }
      var normalizedName = PokerSeatOverlay.normalizePlayerName(playerName);
      if (seenPlayerIds.has(playerId) || seenNames.has(normalizedName)) {
        console.log('[HUD MAP DEBUG] withheld placeholder deduplicated', { playerId: playerId, playerName: playerName, seatId: item.seatId, originalRejectionEvidence: item.reason });
        return null;
      }
      seenPlayerIds.add(playerId);
      seenNames.add(normalizedName);
      return Object.assign({}, item, {
        playerId: playerId,
        playerName: playerName,
        shortReason: shortWithheldReason(item.reason),
        obstacles: collectOverlayObstacles(item.rect),
        outward: { x: item.rect.left + item.rect.width / 2 - window.innerWidth / 2, y: item.rect.top + item.rect.height / 2 - window.innerHeight / 2 }
      });
    }).filter(Boolean);
  }

  function renderWithheldOverlayPlaceholders() {
    if (!seatOverlayLayer) return;
    seatOverlayLayer.querySelectorAll('.pnhud-withheld-placeholder').forEach(function (element) { element.remove(); });
    if (!showWithheldPlaceholders || !seatOverlaysVisible()) return;
    var items = preparedWithheldPlaceholders();
    var elements = new Map();
    var sizes = {};
    items.forEach(function (item) {
      var placeholder = document.createElement('div');
      placeholder.className = 'pnhud-withheld-placeholder';
      placeholder.dataset.pnhudPlayerId = item.playerId;
      placeholder.textContent = 'WITHHELD: ' + item.playerName + ' · ' + item.shortReason;
      placeholder.title = 'Player ID: ' + item.playerId + '\nCandidate seat: ' + item.seatId + '\nRejection evidence: ' + item.reason;
      placeholder.style.visibility = 'hidden';
      seatOverlayLayer.appendChild(placeholder);
      elements.set(item.playerId, placeholder);
      sizes[item.playerId] = { width: placeholder.offsetWidth || 180, height: placeholder.offsetHeight || 18 };
    });
    var acceptedHudRects = Array.from(seatOverlayLayer.querySelectorAll('.pnhud-seat-overlay')).map(function (element) {
      var rect = element.getBoundingClientRect();
      return validAnchorRect(rect) && getComputedStyle(element).visibility !== 'hidden' ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    }).filter(Boolean);
    var placements = PokerSeatOverlay.layoutWithheldPlaceholders(items, sizes, { width: window.innerWidth, height: window.innerHeight }, acceptedHudRects, 4);
    items.forEach(function (item) {
      var placeholder = elements.get(item.playerId);
      var placement = placements.get(item.playerId);
      if (!placement) {
        placeholder.remove();
        console.log('[HUD MAP DEBUG] overlay withheld', { playerId: item.playerId, playerName: item.playerName, domSeatIdentifier: item.seatId, exactRejectionReason: item.reason, placeholderRendered: false, reason: 'no safe position clear of accepted HUDs and seat content' });
        return;
      }
      placeholder.style.transform = 'translate3d(' + placement.left + 'px,' + placement.top + 'px,0)';
      placeholder.style.visibility = 'visible';
      console.log('[HUD MAP DEBUG] overlay withheld', { playerId: item.playerId, playerName: item.playerName, domSeatIdentifier: item.seatId, exactRejectionReason: item.reason, placeholderRendered: true, stackIndex: placement.withheldStackIndex, finalLeft: placement.left, finalTop: placement.top });
    });
  }

  function updateOverlayVisibilityDiagnostics() {
    if (!seatOverlayLayer) return;
    var overlayElements = Array.from(seatOverlayLayer.querySelectorAll('.pnhud-seat-overlay'));
    pipelineHealth.overlayElementsAttached = overlayElements.filter(function (element) { return element.isConnected; }).length;
    pipelineHealth.overlayElementsVisible = overlayElements.filter(function (element) {
      var style = getComputedStyle(element);
      var rect = element.getBoundingClientRect();
      return element.isConnected && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    }).length;
    overlayElements.forEach(function (element) {
      var style = getComputedStyle(element);
      var rect = element.getBoundingClientRect();
      var record = seatOverlayController && seatOverlayController.records.get(String(element.dataset.pnhudPlayerId || ''));
      console.log('[HUD SEAT OVERLAY] visibility', {
        playerId: element.dataset.pnhudPlayerId || null,
        name: record && record.name || null,
        domSeatIdentifier: element.dataset.pnhudSeatId || null,
        finalizedStats: record && record.entry && record.entry.stats || null,
        attached: element.isConnected,
        boundingRectangle: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        computedDisplay: style.display,
        computedVisibility: style.visibility,
        computedOpacity: style.opacity,
        computedZIndex: style.zIndex,
        computedTransform: style.transform
      });
    });
    var layerStyle = getComputedStyle(seatOverlayLayer);
    console.log('[HUD DISPLAY MODE] overlays visibility applied', {
      selectedMode: displayMode,
      storedValue: displayMode,
      previousMode: displayMode,
      expectedVisible: seatOverlaysVisible(),
      actual: {
        layerAttached: seatOverlayLayer.isConnected,
        parentTag: seatOverlayLayer.parentElement && seatOverlayLayer.parentElement.tagName,
        display: layerStyle.display,
        visibility: layerStyle.visibility,
        opacity: layerStyle.opacity,
        zIndex: layerStyle.zIndex,
        elementsAttached: pipelineHealth.overlayElementsAttached,
        elementsVisible: pipelineHealth.overlayElementsVisible
      }
    });
    updateHealthPanel();
  }

  function reconcileSeatOverlays(reason) {
    if (extensionCleanedUp || seatOverlayRendererSuperseded || !runtimeScope.isPokerNowGamePage(window.location)) return;
    if (activeOverlayDrag) {
      deferredSeatReconcileDuringOverlayDrag = reason || 'seat overlay reconcile';
      recordOverlayDragTrace('seat-reconcile-deferred', { playerId: activeOverlayDrag.playerId, pointerId: activeOverlayDrag.pointerId, reason: deferredSeatReconcileDuringOverlayDrag });
      return;
    }
    pipelineHealth.seatOverlayReconciles += 1;
    PokerPotOdds.preserveLiveStateOnVisualReconcile(potOddsLiveState, 'seat/table reconcile: ' + String(reason || 'unspecified'), Date.now());
    if (!ensureSeatOverlaySystem() || !seatOverlayController) return;
    var currentSeatIds = new Set(identityDiagnostics.domSeats.map(function (seat) { return seat.elementId; }));
    var entries = [];
    pipelineHealth.confirmedMappedPlayers = confirmedSeatMappings.size;
    if (currentSeatHudStatSource() === 'career') requestSeatHudCareerBatch(Array.from(confirmedSeatMappings.keys()), 'seat reconcile: ' + String(reason || 'unspecified'), false);
    confirmedSeatMappings.forEach(function (mapping, playerId) {
      var stringPlayerId = String(playerId);
      var seat = identityDiagnostics.domSeats.find(function (candidate) { return candidate.elementId === mapping.seatElementId; });
      var element = domSeatElements.get(mapping.seatElementId);
      var stats = seatHudStatsForPlayer(stringPlayerId, mapping.name);
      var displayedProfile = PokerPlayerProfileShadowStore.displayedProfile(playerProfileShadowState, stringPlayerId);
      recordShowdownRenderedTotals('seat-hud', stringPlayerId, mapping.name, stats);
      var eligibility = {
        playerId: stringPlayerId,
        name: mapping.name,
        domSeatIdentifier: mapping.seatElementId,
        confirmedMapping: true,
        seatRecordFound: Boolean(seat),
        seatElementFound: Boolean(element),
        seatElementConnected: Boolean(element && element.isConnected),
        currentSeatIdentifier: currentSeatIds.has(mapping.seatElementId),
        nameMatches: Boolean(seat && PokerSeatOverlay.exactNameMatch(seat.assignedFullName || seat.displayedName, mapping.name)),
        directIdMatches: Boolean(seat && (seat.directPlayerIds || []).map(String).includes(stringPlayerId)),
        finalizedStats: stats,
        reason: reason
      };
      if (!seat || !element || !element.isConnected || !currentSeatIds.has(mapping.seatElementId) || (!eligibility.nameMatches && !eligibility.directIdMatches)) {
        console.log('[HUD SEAT OVERLAY] eligibility', Object.assign(eligibility, { eligible: false, rejectionReason: 'confirmed seat anchor is missing, disconnected, stale, or has a different visible name' }));
        console.log('[HUD SEAT OVERLAY] anchor missing', eligibility);
        if (!overlayPlacementFailureKeys.has(stringPlayerId)) {
          overlayPlacementFailureKeys.add(stringPlayerId);
          pipelineHealth.overlayPlacementFailures += 1;
        }
        entries.push({ playerId: stringPlayerId, name: mapping.name, seatId: mapping.seatElementId, confirmed: false, rect: null, stats: stats, statSource: currentSeatHudStatSource(), profileStatSource: 'session', displayedProfile: displayedProfile, showPlayerProfiles: hudUiPreferences.showPlayerProfiles, displayedStatIds: displayedStatIds.slice(), opportunityStatsLayout: hudUiPreferences.opportunityStatsLayout, reason: reason });
        return;
      }
      var identityAnchorRect = anchorRectRecord(element);
      var visualGeometry = resolvePlayerVisualGeometry(element, mapping.name, seat.displayedStack);
      var anchorRect = visualGeometry && visualGeometry.rect || identityAnchorRect;
      if (!validAnchorRect(anchorRect)) {
        console.log('[HUD SEAT OVERLAY] eligibility', Object.assign(eligibility, { eligible: false, rejectionReason: 'current visual and authoritative identity anchors have no non-zero viewport rectangle' }));
        console.log('[HUD SEAT OVERLAY] anchor missing', Object.assign(eligibility, { visualAnchorRect: anchorRect, identityAnchorRect: identityAnchorRect }));
        if (!overlayPlacementFailureKeys.has(stringPlayerId)) {
          overlayPlacementFailureKeys.add(stringPlayerId);
          pipelineHealth.overlayPlacementFailures += 1;
        }
        entries.push({ playerId: stringPlayerId, name: mapping.name, seatId: mapping.seatElementId, confirmed: false, rect: null, stats: stats, statSource: currentSeatHudStatSource(), profileStatSource: 'session', displayedProfile: displayedProfile, showPlayerProfiles: hudUiPreferences.showPlayerProfiles, displayedStatIds: displayedStatIds.slice(), opportunityStatsLayout: hudUiPreferences.opportunityStatsLayout, reason: reason });
        return;
      }
      overlayPlacementFailureKeys.delete(stringPlayerId);
      console.log('[HUD SEAT OVERLAY] eligibility', Object.assign(eligibility, { eligible: true }));
      console.log('[HUD SEAT OVERLAY] stats resolved', { playerId: stringPlayerId, name: mapping.name, finalizedStats: stats, eventCount: liveEvents.length });
      console.log('[HUD SEAT OVERLAY] anchor found', { playerId: stringPlayerId, name: mapping.name, domSeatIdentifier: mapping.seatElementId, identityAnchorReference: seat.anchorReference || null, visualAnchorSource: visualGeometry && visualGeometry.source || 'authoritative-seat-fallback', identityAnchorRect: identityAnchorRect, visualAnchorRect: anchorRect });
      console.log('[HUD SEAT OVERLAY] assigned', { playerId: stringPlayerId, fullName: mapping.name, domSeatIdentifier: mapping.seatElementId, identityAnchor: seat.anchorReference || null, visualAnchor: visualGeometry && visualGeometry.reference || null, visualAnchorSource: visualGeometry && visualGeometry.source || 'authoritative-seat-fallback', identityAnchorRect: identityAnchorRect, visualAnchorRect: anchorRect, reason: reason });
      var cleanAnchorRect = { left: anchorRect.left, top: anchorRect.top, width: anchorRect.width, height: anchorRect.height };
      var cleanIdentityRect = identityAnchorRect ? { left: identityAnchorRect.left, top: identityAnchorRect.top, width: identityAnchorRect.width, height: identityAnchorRect.height } : cleanAnchorRect;
      entries.push({
        playerId: stringPlayerId,
        name: mapping.name,
        seatId: mapping.seatElementId,
        confirmed: true,
        rect: cleanAnchorRect,
        visualRect: cleanAnchorRect,
        identityAnchorRect: cleanIdentityRect,
        visualAnchorSource: visualGeometry && visualGeometry.source || 'authoritative-seat-fallback',
        visualAnchorReference: visualGeometry && visualGeometry.reference || null,
        anchorReference: seat.anchorReference || null,
        obstacles: collectOverlayObstacles(cleanAnchorRect),
        outward: {
          x: anchorRect.left + anchorRect.width / 2 - window.innerWidth / 2,
          y: anchorRect.top + anchorRect.height / 2 - window.innerHeight / 2
        },
        clockwiseIndex: seat.clockwiseIndex,
        seatIndex: seat.seatIndex === undefined ? null : seat.seatIndex,
        physicalSeat: seat.seatIndex !== null && seat.seatIndex !== undefined ? String(seat.seatIndex) : Number(seat.clockwiseIndex),
        stats: stats,
        statSource: currentSeatHudStatSource(),
        profileStatSource: 'session',
        displayedProfile: displayedProfile,
        showPlayerProfiles: hudUiPreferences.showPlayerProfiles,
        displayedStatIds: displayedStatIds.slice(),
        opportunityStatsLayout: hudUiPreferences.opportunityStatsLayout,
        reason: reason
      });
    });
    pipelineHealth.eligibleOverlayPlayers = entries.filter(function (entry) { return entry.confirmed; }).length;
    var overlaysVisible = seatOverlaysVisible();
    seatOverlayLayer.style.display = overlaysVisible ? 'block' : 'none';
    seatOverlayLayer.setAttribute('aria-hidden', overlaysVisible && !seatHudBlockingPanelState.blocked ? 'false' : 'true');
    seatOverlayController.reconcile(entries, { displayMode: displayMode });
    positionAllSeatOverlays(entries);
    renderWithheldOverlayPlaceholders();
    renderAnchorDebugBoxes(entries);
    reconcilePotOddsPresentationDependencies('seat/table reconcile: ' + reason);
    requestAnimationFrame(updateOverlayVisibilityDiagnostics);
  }

  function scheduleSeatOverlayReconcile(reason) {
    if (extensionCleanedUp || seatOverlayRendererSuperseded) return;
    if (activeOverlayDrag) {
      deferredSeatReconcileDuringOverlayDrag = reason || 'seat overlay reconcile';
      recordOverlayDragTrace('seat-reconcile-deferred', { playerId: activeOverlayDrag.playerId, pointerId: activeOverlayDrag.pointerId, reason: deferredSeatReconcileDuringOverlayDrag });
      return;
    }
    var now = Date.now();
    var delay = Math.max(0, 200 - (now - seatReconcileLastAt));
    clearTimeout(seatReconcileTimer);
    seatReconcileTimer = setTimeout(function () {
      seatReconcileLastAt = Date.now();
      reconcileSeatOverlays(reason);
    }, delay);
  }

  function scheduleSeatDiscovery(reason) {
    if (extensionCleanedUp) return;
    pipelineHealth.seatDiscoveryRequests += 1;
    if (activeOverlayDrag) {
      deferredSeatDiscoveryDuringOverlayDrag = reason || 'seat discovery';
      recordOverlayDragTrace('seat-discovery-deferred', { playerId: activeOverlayDrag.playerId, pointerId: activeOverlayDrag.pointerId, reason: deferredSeatDiscoveryDuringOverlayDrag });
      return;
    }
    var now = Date.now();
    if (seatDiscoveryPendingSince === null) seatDiscoveryPendingSince = now;
    var delay = Math.max(0, 250 - (now - seatDiscoveryLastAt));
    if (now - seatDiscoveryPendingSince >= 500) delay = 0;
    clearTimeout(seatDiscoveryTimer);
    seatDiscoveryTimer = setTimeout(function () {
      if (extensionCleanedUp || !runtimeScope.isPokerNowGamePage(window.location)) return;
      pipelineHealth.seatDiscoveryExecutions += 1;
      seatDiscoveryPendingSince = null;
      seatDiscoveryLastAt = Date.now();
      discoverDomSeats(reason);
    }, delay);
  }

  function retireUnownedSeatOverlayDom(layer) {
    if (!layer || typeof layer.querySelectorAll !== 'function') return 0;
    var staleElements = Array.from(layer.querySelectorAll('.pnhud-seat-overlay, .pnhud-anchor-box, .pnhud-anchor-line, .pnhud-withheld-placeholder'));
    staleElements.forEach(function (element) { if (element && typeof element.remove === 'function') element.remove(); });
    layer.dataset.pnhudRendererInstance = hudRendererInstanceId;
    if (staleElements.length) console.log('[HUD SEAT OVERLAY] retired unowned DOM from an earlier content-script instance', { count: staleElements.length, rendererInstanceId: hudRendererInstanceId });
    return staleElements.length;
  }

  function seatOverlayRendererOwnsLayer(layer) {
    return Boolean(!seatOverlayRendererSuperseded && layer && layer.dataset && layer.dataset.pnhudRendererInstance === hudRendererInstanceId);
  }

  function retireSupersededSeatOverlayRenderer(reason) {
    if (seatOverlayRendererSuperseded) return false;
    seatOverlayRendererSuperseded = true;
    clearTimeout(seatReconcileTimer);
    seatReconcileTimer = null;
    if (seatOverlayController) seatOverlayController.clear(reason || 'Seat HUD renderer ownership transferred');
    seatOverlayController = null;
    console.warn('[HUD SEAT OVERLAY] renderer ownership transferred; predecessor fenced from the shared root', { rendererInstanceId: hudRendererInstanceId, currentRendererInstanceId: seatOverlayLayer && seatOverlayLayer.dataset && seatOverlayLayer.dataset.pnhudRendererInstance || null, reason: reason || null });
    return true;
  }

  function potOddsOwnedMutationElement(element) {
    if (!element) return false;
    if (element.id === potOddsRootId || element.id === heroPotOddsElementId) return true;
    if (element.matches && element.matches('.pnhud-pot-odds')) return true;
    return Boolean(element.closest && (element.closest('#' + potOddsRootId) || element.closest('#' + heroPotOddsElementId)));
  }

  function startSeatOverlayObservers() {
    if (extensionCleanedUp || !document.body || seatLayoutObserver) return;
    if (!ensureSeatOverlaySystem()) return;
    seatLayoutObserver = new MutationObserver(function (mutations) {
      pipelineHealth.bodyMutationObserverCallbacks += 1;
      var externalMutation = mutations.some(function (mutation) {
        var element = mutation.target && (mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement);
        var targetOwned = element && (element.id === rootId || element.closest('#' + rootId) || element.id === overlayRootId || element.closest('#' + overlayRootId) || element.id === potOddsRootId || element.closest('#' + potOddsRootId) || element.id === settingsPanelId || element.closest('#' + settingsPanelId) || element.id === trackedPlayersPanelId || element.closest('#' + trackedPlayersPanelId) || element.id === playerDashboardId || element.closest('#' + playerDashboardId) || element.id === statTooltipId || element.closest('#' + statTooltipId) || element.id === settingsLauncherId || element.id === toggleRootId);
        if (targetOwned) return false;
        if (mutation.type === 'childList') {
          var changedElements = Array.from(mutation.addedNodes || []).concat(Array.from(mutation.removedNodes || [])).map(function (node) { return node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement); }).filter(Boolean);
          if (changedElements.length && changedElements.every(potOddsOwnedMutationElement)) return false;
        }
        return true;
      });
      if (externalMutation) scheduleSeatDiscovery('PokerNow seat/table DOM mutation');
      if (externalMutation) scheduleNativePanelOcclusion('PokerNow modal, log, or Chat DOM mutation');
    });
    seatLayoutObserver.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded', 'aria-selected', 'data-player-name', 'data-player-id', 'data-player-uuid', 'data-seat', 'data-seat-index', 'data-stack', 'data-chips'] });
    if (typeof ResizeObserver !== 'undefined') {
      seatResizeObserver = new ResizeObserver(function () {
        pipelineHealth.seatResizeObserverCallbacks += 1;
        scheduleSeatDiscovery('confirmed seat resized');
      });
      confirmedSeatMappings.forEach(function (mapping) { observeSeatElement(mapping.seatElement || domSeatElements.get(mapping.seatElementId)); });
    }
    windowLayoutListener = function () {
      if (!windowLayoutPriorViewport) windowLayoutPriorViewport = cloneJson(potOddsLastViewport);
      if (windowLayoutFrame !== null) return;
      windowLayoutFrame = requestAnimationFrame(function () {
        windowLayoutFrame = null;
        var priorViewport = windowLayoutPriorViewport;
        windowLayoutPriorViewport = null;
        var fingerprintBeforeResize = heroPotOddsDecisionFingerprint;
        recordPotOddsForensic('viewport-change', 'window or visual viewport resized', {
          oldViewport: priorViewport && { width: priorViewport.width, height: priorViewport.height },
          newViewport: { width: window.innerWidth, height: window.innerHeight },
          fingerprintBeforeResize: fingerprintBeforeResize, semanticStateChanged: false
        });
        potOddsLastViewport = { width: window.innerWidth, height: window.innerHeight, timestamp: Date.now(), decisionFingerprint: fingerprintBeforeResize };
        scheduleSeatDiscovery('window or table viewport resized');
        scheduleNativePanelOcclusion('window or table viewport resized');
        heroPotOddsRetryCount = 0;
        stopHeroPotOddsVisibilityRetryWork();
        var visibleAfterResize = currentPotOddsPresentationDecision() ? ensureHeroPotOddsVisibility('window or table viewport resized') : false;
        recordPotOddsForensic('viewport-repositioned', 'window or visual viewport resized', {
          oldViewport: priorViewport && { width: priorViewport.width, height: priorViewport.height },
          newViewport: { width: window.innerWidth, height: window.innerHeight },
          decisionFingerprintChanged: fingerprintBeforeResize !== heroPotOddsDecisionFingerprint,
          semanticStateChanged: false, placementSucceeded: visibleAfterResize
        });
        applyLeaderboardHudPosition('viewport-clamp', true);
        closeStatTooltip('viewport changed');
      });
    };
    window.addEventListener('resize', windowLayoutListener, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', windowLayoutListener, { passive: true });
      window.visualViewport.addEventListener('scroll', windowLayoutListener, { passive: true });
    }
    scheduleSeatDiscovery('seat overlay initialization');
  }

  function displayData(saved) {
    var mode = saved[STORAGE_KEYS.mode] || 'session';
    var realPage = isPokerNowPage;
    var useLive = realPage && liveEvents.length > 0;
    var events = realPage ? liveEvents : saved[mode === 'allTime' ? STORAGE_KEYS.allTime : STORAGE_KEYS.session] || [];
    var activeParticipants = realPage && activeHandState ? activeHandState.participants || {} : {};
    var players = realPage
      ? Array.from(new Set(events.map(function (event) { return event.player; })
        .concat(Object.keys(activeParticipants))
        .concat(Array.from(confirmedSeatMappings.values()).map(function (mapping) { return mapping.name; })))).sort()
      : PokerMockData.players.map(function (profile) { return profile.name; });
    var playerEntries = [];
    if (realPage) {
      var seenStableIds = new Set();
      events.forEach(function (event) {
        var playerId = event && event.playerId !== null && event.playerId !== undefined ? String(event.playerId) : '';
        if (!playerId || seenStableIds.has(playerId)) return;
        seenStableIds.add(playerId);
        playerEntries.push({ playerId: playerId, playerName: stablePlayerNameForEvents(playerId, events) || event.player || '' });
      });
      Object.keys(activeParticipants).forEach(function (participantName) {
        var participant = activeParticipants[participantName] || {};
        var playerId = PokerPlayerProfileShadowStore.livePlayerIdentity(participant.playerId);
        if (!playerId || seenStableIds.has(playerId)) return;
        seenStableIds.add(playerId);
        playerEntries.push({ playerId: playerId, playerName: participant.name || participantName });
      });
      confirmedSeatMappings.forEach(function (mapping, mappedPlayerId) {
        var playerId = PokerPlayerProfileShadowStore.livePlayerIdentity(mappedPlayerId);
        if (!playerId || seenStableIds.has(playerId)) return;
        seenStableIds.add(playerId);
        playerEntries.push({ playerId: playerId, playerName: mapping.name || socketPlayerNames.get(playerId) || '' });
      });
      players.forEach(function (playerName) {
        if (!playerEntries.some(function (entry) { return entry.playerName === playerName; })) playerEntries.push({ playerId: null, playerName: playerName });
      });
      playerEntries.sort(function (left, right) {
        return left.playerName.localeCompare(right.playerName) || String(left.playerId || '').localeCompare(String(right.playerId || ''));
      });
    }
    var runtimeStatus = hudRuntimeStatusState.displayedStatus;
    var fullLogAvailable = fullLogDisplaySourceAvailable && observedLog && observedLog.isConnected && isVisible(observedLog);
    var liveSource = runtimeStatus === 'live' || runtimeStatus === 'live-socket'
      ? 'websocket'
      : (runtimeStatus !== 'waiting' && runtimeStatus !== 'disconnected' && fullLogAvailable ? 'full-log' : null);
    return {
      mode: mode,
      events: events,
      players: players,
      playerEntries: playerEntries,
      useLive: useLive,
      realPage: realPage,
      waiting: realPage && (runtimeStatus === 'waiting' || runtimeStatus === 'initializing'),
      liveAttached: Boolean(liveSource),
      liveSource: liveSource,
      runtimeStatus: runtimeStatus
    };
  }

  function currentTableRosterKey() {
    return JSON.stringify(Array.from(confirmedSeatMappings.entries()).map(function (entry) {
      return [String(entry[0]), String(entry[1] && entry[1].name || '')];
    }).sort(function (left, right) { return left[0].localeCompare(right[0]); }));
  }

  function publishCurrentTableRosterChange(previousRosterKey, reason) {
    if (previousRosterKey === currentTableRosterKey()) return false;
    if (leaderboardVisible()) refreshHud();
    console.log('[HUD CURRENT TABLE] authoritative roster changed', { reason: reason || null, stablePlayerIds: Array.from(confirmedSeatMappings.keys()).map(String).sort() });
    return true;
  }

  function hudRuntimePresentation(status) {
    return PokerHudRuntimeStatus.presentation(status);
  }

  function resolveHudRuntimeStatusElements(root) {
    return {
      badge: root && root.querySelector(hudRuntimeBadgeSelector),
      footer: root && root.querySelector(hudRuntimeFooterSelector)
    };
  }

  function recordPauseLifecycleHudRender(source, root, presentation, elements) {
    if (!pauseLifecycleCaptureEnabled) return null;
    root = root || document.getElementById(detailsRootId);
    presentation = presentation || hudRuntimePresentation(hudRuntimeStatusState.displayedStatus);
    elements = elements || resolveHudRuntimeStatusElements(root);
    var badge = elements.badge;
    var note = elements.footer;
    var warningCount = pauseLifecycleCaptureState.warnings.length;
    var record = PokerPauseLifecycleCapture.recordRender(pauseLifecycleCaptureState, {
      timestamp: Date.now(),
      source: source || 'unknown-render',
      selectedStatus: hudRuntimeStatusState.displayedStatus,
      expectedBadgeText: presentation.label,
      expectedFooterText: presentation.note,
      actualBadgeText: badge && badge.textContent || null,
      actualFooterText: note && note.textContent || null,
      contentScriptInstanceId: contentScriptInstanceId,
      runtimeStatusStoreInstanceId: runtimeStatusStoreInstanceId,
      hudRendererInstanceId: hudRendererInstanceId,
      detailsRootCount: document.querySelectorAll('#' + detailsRootId).length,
      rendererRootCount: document.querySelectorAll('#' + rootId).length
    });
    logNewPauseCaptureWarnings(warningCount);
    return record;
  }

  function logNewPauseCaptureWarnings(previousCount) {
    if (!pauseLifecycleCaptureEnabled) return;
    pauseLifecycleCaptureState.warnings.slice(previousCount).forEach(function (entry) {
      console.warn('[HUD RAW LIFECYCLE CAPTURE] warning', entry);
    });
  }

  function updateHudRuntimeStatusDisplay(reason) {
    var root = document.getElementById(detailsRootId);
    if (!root) return false;
    var presentation = hudRuntimePresentation(hudRuntimeStatusState.displayedStatus);
    var elements = resolveHudRuntimeStatusElements(root);
    var badge = elements.badge;
    var note = elements.footer;
    if (badge && badge.textContent !== presentation.label) badge.textContent = presentation.label;
    if (note && note.textContent !== presentation.note) note.textContent = presentation.note;
    recordPauseLifecycleHudRender('targeted-status-update', root, presentation, elements);
    console.log('[HUD STATUS] display reconciled', {
      displayedStatus: presentation.label,
      derivedStatus: hudRuntimeStatusState.displayedStatus,
      reason: reason || hudRuntimeStatusState.lastStatusTransitionReason,
      targeted: true
    });
    return Boolean(badge);
  }

  function reconcileHudRuntimeStatus(input) {
    input = Object.assign({
      timestamp: Date.now(),
      socketHookInstalled: pipelineHealth.hookInstalled,
      framesCaptured: pipelineHealth.framesCaptured,
      packetsDecoded: pipelineHealth.packetsDecoded,
      gameStatePatchesMerged: pipelineHealth.gameStatePatchesMerged,
      activeHandPresent: Boolean(handAccounting && PokerHandFinalization.activeHand(handAccounting))
    }, input || {});
    var previousRuntimeState = PokerHudRuntimeStatus.snapshot(hudRuntimeStatusState);
    var result = PokerHudRuntimeStatus.reconcile(hudRuntimeStatusState, input);
    if (input.authoritativePauseState === 'resumed' && previousRuntimeState.authoritativePauseState === 'paused' && hudRuntimeStatusState.authoritativePauseState === 'resumed') {
      rearmLifecycleBoundaryAcquisition();
    }
    var presentation = hudRuntimePresentation(result.status);
    var pauseCaptureWarningCount = pauseLifecycleCaptureState.warnings.length;
    PokerPauseLifecycleCapture.recordRuntimeRecalculation(pauseLifecycleCaptureState, {
      timestamp: Number(input.timestamp || Date.now()),
      eventType: input.pauseStatusTrigger && input.pauseStatusTrigger.eventType || input.reason || null,
      previousPersistedPauseState: previousRuntimeState.authoritativePauseState === 'paused'
        ? 'paused'
        : (previousRuntimeState.localLifecycleCommand === 'paused-local-command' ? 'paused' : previousRuntimeState.authoritativePauseState),
      nextPersistedPauseState: currentEffectivePauseState(),
      verifiedResume: input.authoritativePauseState === 'resumed' ||
        input.localLifecycleCommand === 'resume-pending-confirmation' ||
        String(input.tableClassification || '').toLowerCase() === 'resumed',
      previousRuntimeStatus: previousRuntimeState.displayedStatus,
      nextRuntimeStatus: result.status,
      reason: result.reason,
      precedenceBranch: result.precedenceBranch,
      runtimeStatusInputs: cloneJson(input),
      contentScriptInstanceId: contentScriptInstanceId,
      runtimeStatusStoreInstanceId: runtimeStatusStoreInstanceId
    });
    logNewPauseCaptureWarnings(pauseCaptureWarningCount);
    var pauseRelevant = Boolean(
      input.pauseStatusTrigger ||
      input.authoritativePauseState !== undefined ||
      input.gamePaused === true ||
      input.localLifecycleCommand ||
      previousRuntimeState.authoritativePauseState === 'paused' ||
      previousRuntimeState.localLifecycleCommand
    );
    if (PokerHudDiagnostics.enabled('deep') && (pauseRelevant || result.changed)) {
      var pauseTrace = {
        timestamp: Number(input.timestamp || Date.now()),
        eventType: input.pauseStatusTrigger && input.pauseStatusTrigger.eventType || input.reason || null,
        snapshotFingerprint: input.pauseStatusTrigger && input.pauseStatusTrigger.snapshotFingerprint || null,
        socketConnected: Boolean(hudRuntimeStatusState.transportConnected && !hudRuntimeStatusState.transportDisconnected),
        socketHookInstalled: Boolean(hudRuntimeStatusState.socketHookInstalled),
        rawPauseRelatedFields: cloneJson(
          input.pauseStatusTrigger && input.pauseStatusTrigger.rawPauseRelatedFields ||
          input.authoritativePauseEvidence && input.authoritativePauseEvidence.currentPatchEvidence ||
          input.lifecycleEvidence && input.lifecycleEvidence.normalized && input.lifecycleEvidence.normalized.currentPatchEvidence ||
          []
        ),
        normalizedPauseFlag: Boolean(
          hudRuntimeStatusState.authoritativePauseState === 'paused' ||
          hudRuntimeStatusState.gamePaused ||
          hudRuntimeStatusState.localLifecycleCommand === 'paused-local-command' ||
          hudRuntimeStatusState.localLifecycleCommand === 'resume-pending-confirmation'
        ),
        authoritativePauseState: hudRuntimeStatusState.authoritativePauseState,
        locallyPendingHostControl: hudRuntimeStatusState.localLifecycleCommand,
        lifecycleClassification: hudRuntimeStatusState.lifecycleClassification,
        breakWaitingFlags: {
          waitingToStart: hudRuntimeStatusState.waitingToStart,
          gameStopped: hudRuntimeStatusState.gameStopped,
          gameBroken: hudRuntimeStatusState.gameBroken
        },
        freshActivityState: {
          freshLiveActivityObserved: hudRuntimeStatusState.freshLiveActivityObserved,
          lastFreshGameStateAt: hudRuntimeStatusState.lastFreshGameStateAt,
          framesCaptured: hudRuntimeStatusState.framesCaptured,
          packetsDecoded: hudRuntimeStatusState.packetsDecoded
        },
        previousRuntimeStatus: previousRuntimeState.displayedStatus,
        nextRuntimeStatus: result.status,
        reason: result.reason,
        precedenceBranch: result.precedenceBranch,
        badgeText: presentation.label,
        footerText: presentation.note
      };
      pauseStatusTraces.push(pauseTrace);
      if (pauseStatusTraces.length > 120) pauseStatusTraces.shift();
      console.log('[HUD PAUSE STATUS TRACE]', pauseTrace);
    }
    if (result.changed) {
      console.log('[HUD STATUS] transition', {
        previousStatus: result.previousStatus,
        derivedStatus: result.status,
        reason: result.reason,
        tableStatus: hudRuntimeStatusState.tableStatus,
        tableClassification: hudRuntimeStatusState.tableClassification,
        eligiblePlayerCount: hudRuntimeStatusState.eligiblePlayerCount,
        freshLiveActivityObserved: hudRuntimeStatusState.freshLiveActivityObserved
      });
      updateHudRuntimeStatusDisplay(result.reason);
    }
    return result;
  }

  function ensureHudToggle() {
    var detailsOpen = leaderboardVisible();
    var toggle = document.getElementById(toggleRootId);
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = toggleRootId;
      toggle.className = 'pnhud-toggle';
      toggle.type = 'button';
      (document.body || document.documentElement).appendChild(toggle);
      console.log('[HUD UI ROOT] created', { rootId: toggleRootId, parent: toggle.parentElement && toggle.parentElement.tagName });
    } else if (document.body && toggle.parentElement !== document.body) {
      document.body.appendChild(toggle);
      console.log('[HUD UI ROOT] replaced', { rootId: toggleRootId, reason: 'moved top-level toggle root under BODY' });
    } else {
      console.log('[HUD UI ROOT] found existing', { rootId: toggleRootId, connected: toggle.isConnected });
    }
    toggle.className = 'pnhud-toggle';
    toggle.type = 'button';
    if (toggle.dataset.pnhudToggleBound !== 'true') {
      toggle.dataset.pnhudToggleBound = 'true';
      toggle.addEventListener('click', function () {
        writeVisibilityState(seatOverlaysVisible(), !leaderboardVisible(), 'top-right-hud-toggle');
      });
    }
    toggle.textContent = detailsOpen ? 'Hide HUD' : 'HUD';
    toggle.setAttribute('aria-expanded', detailsOpen ? 'true' : 'false');
    toggle.title = detailsOpen ? 'Collapse PokerNow Stats HUD details' : 'Open PokerNow Stats HUD details';
    return toggle;
  }

  function ensureDetailsRoot() {
    var detailsRoot = document.getElementById(detailsRootId);
    if (!detailsRoot) {
      detailsRoot = document.createElement('div');
      detailsRoot.id = detailsRootId;
      detailsRoot.dataset.pnhudGameId = pokerNowGameId;
      (document.body || document.documentElement).appendChild(detailsRoot);
      console.log('[HUD UI ROOT] created', { rootId: detailsRootId, parent: detailsRoot.parentElement && detailsRoot.parentElement.tagName });
    } else if (document.body && detailsRoot.parentElement !== document.body) {
      document.body.appendChild(detailsRoot);
      console.log('[HUD UI ROOT] replaced', { rootId: detailsRootId, reason: 'moved top-level details root under BODY' });
    } else {
      console.log('[HUD UI ROOT] found existing', { rootId: detailsRootId, connected: detailsRoot.isConnected });
    }
    var host = detailsRoot.querySelector('#' + rootId);
    if (!host) {
      host = document.createElement('section');
      host.id = rootId;
      host.setAttribute('aria-label', 'PokerNow Stats HUD');
      detailsRoot.appendChild(host);
      console.log('[HUD UI ROOT] created', { rootId: rootId, parent: detailsRootId });
    }
    return { root: detailsRoot, host: host };
  }

  function logUiDisplayModeLoaded(saved) {
    if (uiDisplayModeBootLogged) return;
    uiDisplayModeBootLogged = true;
    console.log('[HUD UI BOOT 4] display mode loaded', {
      displayMode: displayMode,
      storedDisplayMode: saved && saved[STORAGE_KEYS.displayMode],
      storedDatasetMode: saved && saved[STORAGE_KEYS.mode],
      detailsRequired: leaderboardVisible(),
      overlaysRequired: seatOverlaysVisible(),
      storageValues: { displayMode: saved && saved[STORAGE_KEYS.displayMode], mode: saved && saved[STORAGE_KEYS.mode], showOverlayBoxes: saved && saved[STORAGE_KEYS.showOverlayBoxes] }
    });
  }

  function ensureUiShells(saved, reason) {
    if (!ownsRuntimeController()) return;
    if (seatOverlayController && seatOverlayLayer && !seatOverlayRendererOwnsLayer(seatOverlayLayer)) {
      retireSupersededSeatOverlayRenderer('HUD refresh observed a newer Seat HUD renderer');
      return null;
    }
    if (seatOverlayRendererSuperseded) return null;
    synchronizeDerivedDisplayMode();
    var detailsOpen = leaderboardVisible();
    logUiDisplayModeLoaded(saved);
    var bootstrapped = PokerHudUiBootstrap.ensureRoots(document, displayMode);
    if (bootstrapped.created.details) {
      console.log('[HUD UI ROOT] created', { rootId: detailsRootId, parent: bootstrapped.detailsRoot.parentElement && bootstrapped.detailsRoot.parentElement.tagName, source: 'minimal root bootstrap' });
    }
    if (bootstrapped.created.overlay) {
      console.log('[HUD UI ROOT] created', { rootId: overlayRootId, parent: bootstrapped.overlayRoot.parentElement && bootstrapped.overlayRoot.parentElement.tagName, source: 'minimal root bootstrap' });
    }
    if (bootstrapped.created.toggle) console.log('[HUD UI ROOT] created', { rootId: toggleRootId, parent: bootstrapped.toggleRoot.parentElement && bootstrapped.toggleRoot.parentElement.tagName, source: 'minimal root bootstrap' });
    if (!uiDetailsBootLogged) {
      uiDetailsBootLogged = true;
      console.log('[HUD UI BOOT 5] details root created', { displayMode: displayMode, rootId: detailsRootId, connected: bootstrapped.detailsRoot.isConnected, createdNow: bootstrapped.created.details });
    }
    if (!uiOverlayBootLogged) {
      uiOverlayBootLogged = true;
      console.log('[HUD UI BOOT 6] overlay layer created', { displayMode: displayMode, rootId: overlayRootId, connected: bootstrapped.overlayRoot.isConnected, createdNow: bootstrapped.created.overlay, childOverlayCount: bootstrapped.overlayRoot.querySelectorAll ? bootstrapped.overlayRoot.querySelectorAll('.pnhud-seat-overlay').length : 0 });
    }
    if (!seatOverlayLayer || !seatOverlayLayer.isConnected) seatOverlayLayer = bootstrapped.overlayRoot;
    if (ensureSeatOverlaySystem()) seatOverlayLayer.style.display = seatOverlaysVisible() ? 'block' : 'none';
    if (!seatOverlaysVisible()) console.log('[HUD UI ROOT] hidden', { rootId: overlayRootId, displayMode: displayMode, reason: reason });
    ensureHudToggle();
    ensureSettingsUi();
    var details = ensureDetailsRoot();
    applyHudUiAppearance();
    details.root.style.display = detailsOpen ? 'block' : 'none';
    if (!detailsOpen) console.log('[HUD UI ROOT] hidden', { rootId: detailsRootId, displayMode: displayMode, reason: reason });
    if (!details.host.innerHTML) {
      details.host.innerHTML = '<div class="pnhud-header"><div class="pnhud-header-summary"><span class="pnhud-title">PokerNow Stats HUD</span><span class="pnhud-status-area"><span class="pnhud-demo">Connecting\u2026</span></span></div></div><table><tbody><tr><td colspan="5" class="pnhud-empty">Waiting for live data…</td></tr></tbody></table><p class="pnhud-note">HUD shell mounted · full renderer pending</p>';
    }
    console.log('[HUD UI ROOT] hard fallback applied', {
      reason: reason,
      displayMode: displayMode,
      detailsRequired: detailsOpen,
      overlaysRequired: seatOverlaysVisible(),
      detailsRootPresent: details.root.isConnected,
      overlayRootPresent: seatOverlayLayer.isConnected,
      toggleRootPresent: Boolean(document.getElementById(toggleRootId))
    });
    return details;
  }

  function render(saved) {
    if (!ownsRuntimeController()) return;
    if (seatOverlayRendererSuperseded) return;
    if (!document.documentElement) {
      setTimeout(function () { render(saved); }, 0);
      return;
    }
    synchronizeDerivedDisplayMode();
    pipelineHealth.leaderboardRenderCount += 1;
    tooltipStatsByPlayerKey.clear();
    closeStatTooltip('HUD rerender or scope change');
    var detailsOpen = leaderboardVisible();
    logUiDisplayModeLoaded(saved);
    if (ensureSeatOverlaySystem()) seatOverlayLayer.style.display = seatOverlaysVisible() ? 'block' : 'none';
    ensureHudToggle();
    ensureSettingsUi();
    var details = ensureDetailsRoot();
    applyHudUiAppearance();
    var host = details.host;
    details.root.style.display = detailsOpen ? 'block' : 'none';
    var data = displayData(saved);
    currentStatsScope = currentLeaderboardStatSource() === 'career' ? 'career' : data.mode === 'allTime' ? 'allTime' : 'session';
    ensureStatTooltipUi();
    var rows = leaderboardRows(data);
    rows.forEach(function (row) {
      if (currentLeaderboardStatSource() === 'career') return;
      var playerEntry = row.playerId ? [row.playerId, row.player] : Array.from(socketPlayerNames.entries()).find(function (entry) { return entry[1] === row.player; });
      var threeBetDefinition = PokerOverlayStats.STAT_CATALOG.threeBet;
      var foldToThreeBetDefinition = PokerOverlayStats.STAT_CATALOG.foldToThreeBet;
      var flopCBetDefinition = PokerOverlayStats.STAT_CATALOG.flopCBet;
      var foldToFlopCBetDefinition = PokerOverlayStats.STAT_CATALOG.foldToFlopCBet;
      preflopDebug('hud-render', {
        surface: 'leaderboard',
        playerId: playerEntry ? String(playerEntry[0]) : null,
        playerName: row.player,
        lookupKind: 'render player name over authoritative liveEvents',
        rawCounters: preflopCounterFields(row),
        formattedThreeBet: threeBetDefinition.formatValue(threeBetDefinition.getValue(row)),
        formattedFoldToThreeBet: foldToThreeBetDefinition.formatValue(foldToThreeBetDefinition.getValue(row)),
        formattedFlopCBet: flopCBetDefinition.formatValue(flopCBetDefinition.getValue(row)),
        formattedFoldToFlopCBet: foldToFlopCBetDefinition.formatValue(foldToFlopCBetDefinition.getValue(row))
      });
      recordShowdownRenderedTotals('leaderboard', playerEntry ? playerEntry[0] : null, row.player, row);
    });
    var leaderboardDefinitions = PokerLeaderboardStats.definitions(effectiveLeaderboardStatIds());
    var tableHeaderHtml = '<th>Player</th>' + leaderboardDefinitions.map(function (definition) {
      return '<th>' + statTooltipTargetHtml(definition, PokerLeaderboardStats.tableLabel(definition), null, currentStatsScope) + '</th>';
    }).join('');
    var tableRowsHtml = rows.length ? rows.map(function (stat) {
      var playerKey = registerTooltipPlayer(stat.playerId || null, stat.player, stat);
      var cells = leaderboardDefinitions.map(function (definition) {
        if (stat.careerPending) return '<td class="pnhud-career-pending" aria-label="Career statistics loading">Loading\u2026</td>';
        if (stat.careerUnavailable) return '<td class="pnhud-career-pending" aria-label="Career statistics unavailable">Unavailable</td>';
        var value = PokerLeaderboardStats.formatValue(definition, stat);
        return '<td>' + statTooltipTargetHtml(definition, value, playerKey, currentStatsScope) + '</td>';
      }).join('');
      return '<tr><td>' + escapeHtml(stat.player) + '</td>' + cells + '</tr>';
    }).join('') : '<tr><td colspan="' + (leaderboardDefinitions.length + 1) + '" class="pnhud-empty">Waiting for live data\u2026</td></tr>';
    var runtimePresentation = hudRuntimePresentation(data.runtimeStatus);
    var dataLabel = data.realPage ? runtimePresentation.label : 'DEMO DATA';
    var dataNote = data.realPage
      ? runtimePresentation.note
      : 'Mock stats only \u00b7 no page data is read';
    host.innerHTML = '<div class="pnhud-header"><div class="pnhud-header-summary"><span class="pnhud-title">PokerNow Stats HUD</span><span class="pnhud-status-area"><span class="pnhud-demo">' + dataLabel + '</span></span></div><div class="pnhud-header-actions"><button class="pnhud-open-settings" title="Open HUD settings">Settings</button><button class="pnhud-close" title="Hide HUD" aria-label="Hide HUD">\u00d7</button></div></div>' +
      '<div class="pnhud-tabs" aria-label="Leaderboard statistic source">' + ['session', 'career'].map(function (source) {
        return '<button data-leaderboard-source="' + source + '" aria-pressed="' + (currentLeaderboardStatSource() === source) + '" class="' + (currentLeaderboardStatSource() === source ? 'active' : '') + '">' + (source === 'career' ? 'Career' : 'Session') + '</button>';
      }).join('') + '</div>' +
      '<div class="pnhud-table-scroll"><table><thead><tr>' + tableHeaderHtml + '</tr></thead><tbody>' + tableRowsHtml +
      '</tbody></table></div><p class="pnhud-note">' + dataNote + '</p>';
    recordPauseLifecycleHudRender('full-hud-render', details.root, runtimePresentation);
    host.querySelectorAll('[data-leaderboard-source]').forEach(function (button) {
      button.addEventListener('click', function () {
        updateLeaderboardSource(button.dataset.leaderboardSource);
      });
    });
    host.querySelector('.pnhud-open-settings').addEventListener('click', function () { setSettingsOpen(true, 'leaderboard-settings-shortcut'); });
    host.querySelector('.pnhud-close').addEventListener('click', function () {
      writeDisplayMode(displayModeForSurfaceChange('leaderboard', false));
    });
    installLeaderboardHudDragBehavior(host);
    applyLeaderboardHudPosition(hudUiPreferences.hudSize === 'default' ? 'HUD render' : 'size-change-clamp', true);
    scheduleSeatOverlayReconcile('leaderboard render');
    logDisplayModeState('[HUD DISPLAY MODE] details visibility applied', displayMode, displayMode, saved[STORAGE_KEYS.displayMode]);
    firstRenderCompleted = true;
    console.log('[HUD UI BOOT 7] first render completed', {
      locationHref: location.href,
      displayMode: displayMode,
      detailsRootPresent: Boolean(document.getElementById(detailsRootId) && document.getElementById(detailsRootId).isConnected),
      detailsRootDisplay: getComputedStyle(details.root).display,
      overlayRootPresent: Boolean(document.getElementById(overlayRootId) && document.getElementById(overlayRootId).isConnected),
      overlayRootDisplay: getComputedStyle(seatOverlayLayer).display,
      toggleRootPresent: Boolean(document.getElementById(toggleRootId) && document.getElementById(toggleRootId).isConnected),
      playersRendered: rows.length
    });
    maybeLogUiBoot8();
    removeBootstrapBadgeAfterMount();
    console.log('[HUD PIPELINE 8] HUD rendered', {
      playersRendered: rows.length,
      statsEventsStored: liveEvents.length,
      health: Object.assign({}, pipelineHealth)
    });
  }

  function healthPanelHtml(developerToolsVisible) {
    return PokerHudHealth.renderHtml(pipelineHealth, escapeHtml, { developerToolsVisible: developerToolsVisible });
  }

  function updateHealthPanel() {
    PokerHudHealth.update(document.getElementById(settingsPanelId), pipelineHealth);
  }

  function traceFirstHandLifecycle(category, details, timestamp) {
    if (!firstHandLifecycle) return null;
    var entry = PokerFirstHandLifecycle.record(firstHandLifecycle, category, details || {}, timestamp);
    if (entry) console.log('[HUD FIRST HAND TRACE]', {
      startupType: firstHandLifecycle.currentTrace && firstHandLifecycle.currentTrace.startupType,
      category: category,
      timestamp: entry.timestamp,
      details: entry.details
    });
    return entry;
  }

  function traceHandSource(eventName, details, timestamp) {
    var at = Number(timestamp || Date.now());
    var entry = {
      timestamp: at,
      isoTime: new Date(at).toISOString(),
      buildId: PNHUD_BUILD_ID,
      lobbyId: pokerNowGameId,
      sessionKey: gameSessionKey,
      event: String(eventName || 'unknown'),
      details: cloneJson(details || {})
    };
    handSourceTraces.push(entry);
    if (handSourceTraces.length > 500) handSourceTraces.shift();
    console.log('[HUD HAND SOURCE TRACE]', entry);
    return entry;
  }

  function handLogOpenState() {
    var candidate = activeFullLogContent || observedLog;
    return Boolean(candidate && candidate.isConnected && isVisible(candidate));
  }

  function summarizeHandEvents(events) {
    return (events || []).map(function (event) {
      return { playerId: event.playerId || null, player: event.player, action: event.action, street: event.street, amount: Number(event.amount || 0), blindType: event.blindType || null };
    });
  }

  function handEvidenceKeys(handId, events) {
    var summary = summarizeHandEvents(events);
    var participantIds = Array.from(new Set(summary.map(function (event) { return event.playerId || event.player; }).filter(Boolean).map(String))).sort();
    return {
      rawHandIdKey: String(handId || ''),
      participantKey: stableHash(participantIds.join('|')),
      strictEventKey: stableHash(JSON.stringify(summary)),
      actionShapeKey: stableHash(summary.map(function (event) { return [event.player, event.action, event.street, event.blindType || '', event.amount].join(':'); }).join('|'))
    };
  }

  function statsHandsForPlayers(events, playerNames) {
    var values = {};
    (playerNames || []).forEach(function (player) { values[player] = PokerStats.computePlayerStats(events || [], player).handsPlayed; });
    return values;
  }

  function lifecycleTraceValue(value) {
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    return { type: 'object', keys: Object.keys(value).slice(0, 30) };
  }

  function setPipelineFailure(reason, details) {
    pipelineHealth.lastFailureReason = String(reason || 'unknown failure');
    updateHealthPanel();
    console.log('[HUD PIPELINE] failure', { reason: pipelineHealth.lastFailureReason, details: details || null });
  }

  function pipelineEventCreated(event, source, evidence) {
    pipelineHealth.pokerEventsEmitted += 1;
    updateHealthPanel();
    traceFirstHandLifecycle('emittedEvents', {
      handId: event && event.handId,
      playerId: event && event.playerId || null,
      player: event && event.player,
      action: event && event.action,
      street: event && event.street,
      source: source,
      evidence: evidence || null,
      activeHandId: handAccounting && handAccounting.activeHandId || null
    }, event && event.timestamp);
    console.log('[HUD PIPELINE 6] poker event created', {
      source: source,
      handId: event && event.handId,
      player: event && event.player,
      action: event && event.action,
      street: event && event.street,
      amount: event && event.amount,
      evidence: evidence || null,
      event: event
    });
  }

  function injectTestEvent() {
    var timestamp = Date.now();
    var event = {
      handId: 'HUD-PIPELINE-SELF-TEST-' + timestamp,
      player: 'HUD_TEST_PLAYER',
      action: 'raise',
      street: 'preflop',
      amount: 20,
      timestamp: timestamp
    };
    pipelineEventCreated(event, 'self-test', 'temporary Inject Test Event button');
    acceptHandEvent(event, '[HUD SELF TEST] ' + JSON.stringify(event), 'self-test', null);
  }

  function settingsLayoutDiagnostics() {
    var pane = settingsPanel && settingsPanel.querySelector('.pnhud-settings-layout > main');
    if (!pane) return { contentPanePresent: false, contentPaneOverflowY: 'missing', contentPaneScrollable: false, contentPaneCanScroll: false, contentScrollHeight: 0, contentClientHeight: 0, activeSection: hudUiPreferences.selectedSettingsSection };
    var style = getComputedStyle(pane);
    var canScroll = pane.scrollHeight > pane.clientHeight;
    return {
      contentPanePresent: true,
      contentPaneOverflowY: style.overflowY,
      contentPaneScrollable: /^(auto|scroll)$/.test(style.overflowY) && canScroll,
      contentPaneCanScroll: canScroll,
      contentScrollHeight: pane.scrollHeight,
      contentClientHeight: pane.clientHeight,
      overscrollBehaviorY: style.overscrollBehaviorY,
      activeSection: hudUiPreferences.selectedSettingsSection
    };
  }

  function launcherOverlapsPokerNowLogo() {
    if (!settingsLauncher || !settingsLauncher.isConnected) return false;
    var launcherRect = settingsLauncher.getBoundingClientRect();
    var candidates = Array.from(document.querySelectorAll('header img, a[href="/"] img, [class*="logo" i], [aria-label*="PokerNow" i]')).filter(function (element) {
      return element !== settingsLauncher && !settingsLauncher.contains(element) && (!settingsPanel || !settingsPanel.contains(element));
    });
    return candidates.some(function (element) {
      var rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        launcherRect.left < rect.right && launcherRect.right > rect.left &&
        launcherRect.top < rect.bottom && launcherRect.bottom > rect.top;
    });
  }

  function pauseDiagnosticElementPath(element) {
    if (!element || element.nodeType !== 1) return null;
    var parts = [];
    while (element && element.nodeType === 1 && parts.length < 7) {
      var part = element.tagName.toLowerCase();
      if (element.id && !/^pnhud-/.test(element.id)) { part += '#' + String(element.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80); parts.unshift(part); break; }
      var stableClasses = Array.from(element.classList || []).filter(function (name) { return name && name.length <= 48 && !/^pnhud-/.test(name) && !/^[a-z0-9_-]{20,}$/i.test(name); }).slice(0, 2);
      if (stableClasses.length) part += '.' + stableClasses.join('.');
      if (element.parentElement) {
        var siblings = Array.from(element.parentElement.children).filter(function (item) { return item.tagName === element.tagName; });
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(element) + 1) + ')';
      }
      parts.unshift(part);
      element = element.parentElement;
    }
    return parts.join(' > ').slice(0, 500);
  }

  function pauseDiagnosticClickDetails(event) {
    var element = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    var control = element && element.closest ? element.closest('button,[role="button"],[role="menuitem"],a,input') || element : element;
    var attributes = {};
    ['type', 'name', 'aria-label', 'aria-expanded', 'aria-pressed', 'title', 'role', 'data-action', 'data-testid', 'disabled'].forEach(function (name) {
      if (control && control.hasAttribute && control.hasAttribute(name)) attributes[name] = String(control.getAttribute(name)).slice(0, 240);
    });
    var nearby = control && control.parentElement ? Array.from(control.parentElement.querySelectorAll('button,[role="button"],[role="menuitem"]')).slice(0, 12).map(function (item) { return String(item.innerText || item.textContent || item.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 120); }).filter(Boolean) : [];
    return {
      tagName: control && control.tagName || null,
      visibleText: control ? String(control.innerText || control.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300) : '',
      ariaLabel: control && control.getAttribute && control.getAttribute('aria-label') || null,
      title: control && control.getAttribute && control.getAttribute('title') || null,
      role: control && control.getAttribute && control.getAttribute('role') || null,
      selectorPath: pauseDiagnosticElementPath(control),
      nearbyButtonOrMenuText: nearby,
      relevantAttributes: attributes,
      defaultPreventedAtCapture: Boolean(event.defaultPrevented),
      defaultPrevented: Boolean(event.defaultPrevented),
      trusted: Boolean(event.isTrusted)
    };
  }

  function pauseDiagnosticKnownLifecycleFields(value, depth) {
    if (!value || typeof value !== 'object' || depth > 3) return value;
    var output = Array.isArray(value) ? [] : {};
    Object.keys(value).slice(0, 80).forEach(function (key) {
      if (!/status|pause|state|hand|dealer|button|blind|timer|time|owner|host|room|game|turn|active|running/i.test(key)) return;
      var field = value[key];
      if (field === null || ['string', 'number', 'boolean'].includes(typeof field)) output[key] = field;
      else if (Array.isArray(field)) output[key] = { type: 'array', length: field.length };
      else if (field && typeof field === 'object') output[key] = pauseDiagnosticKnownLifecycleFields(field, depth + 1);
    });
    return output;
  }

  function handleDiagnosticAndHostControlClick(event) {
    if (!ownsRuntimeController()) return;
    capturePauseDiagnosticPointerEvent(event);
    var control = event.target && event.target.closest ? event.target.closest('button,[role="button"]') : null;
    var text = control ? String(control.textContent || control.getAttribute('aria-label') || '').trim() : '';
    var command = /\bpause\b/i.test(text) ? 'pause' : (/\bresume\b|\bcontinue\b/i.test(text) ? 'resume' : null);
    if (!command) return;
    lastHostControlUiClick = { command: command, timestamp: Date.now(), text: text.slice(0, 80) };
    console.log('[HUD HOST CONTROL] UI click corroboration only', lastHostControlUiClick);
  }

  function pauseDiagnosticPageState() {
    return {
      runtimeStatus: PokerHudRuntimeStatus.snapshot(hudRuntimeStatusState),
      socketGameContext: cloneJson(socketGameContext),
      authoritativePauseState: currentEffectivePauseState(),
      activeHand: handAccounting ? cloneJson(PokerHandFinalization.activeHand(handAccounting)) : null,
      knownGcLifecycleFields: pauseDiagnosticKnownLifecycleFields(previousGcSnapshot, 0),
      latestHostControlClick: cloneJson(lastHostControlUiClick),
      ownerControlContext: { localUserPlayerId: localUserPlayerId, tableOwnerPlayerId: tableOwnerPlayerId },
      lifecycleTraceTail: PokerNowLifecycleSignal.snapshot(rawLifecycleTraceState),
      stablePageWorldStoreAccessible: false,
      stablePageWorldStoreReason: 'No stable page-world store is referenced by the extension; global and React-tree crawling intentionally skipped.'
    };
  }

  function pauseDiagnosticRecordSnapshot(phase, checkpointId, timestamp) {
    return PokerPauseDiagnosticCapture.recordPageState(pauseDiagnosticCaptureState, phase, checkpointId, pauseDiagnosticPageState(), timestamp || Date.now());
  }


  function updatePauseDiagnosticMarkerIndicator() {
    var pending = pauseDiagnosticCaptureState.pendingMarker;
    var indicator = document.getElementById(pauseMarkerIndicatorId);
    if (!pending) {
      if (indicator) indicator.remove();
      return null;
    }
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = pauseMarkerIndicatorId;
      indicator.className = 'pnhud-pause-marker-indicator pnhud-extension-owned';
      indicator.dataset.pnhudOwned = 'true';
      indicator.setAttribute('data-pnhud-owned', 'true');
      indicator.setAttribute('role', 'status');
      indicator.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(indicator);
    }
    indicator.textContent = pending.marker === 'pause'
      ? 'Pause capture window active — trigger PokerNow Pause by keyboard, button, menu, or touch'
      : 'Resume capture window active — trigger PokerNow Resume by keyboard, button, menu, or touch';
    return indicator;
  }

  function cancelPauseDiagnosticMarker(reason) {
    var canceled = PokerPauseDiagnosticCapture.cancelMarker(pauseDiagnosticCaptureState, reason || 'canceled', Date.now());
    updatePauseDiagnosticMarkerIndicator();
    return canceled;
  }

  function pauseDiagnosticEventOwnership(event) {
    return PokerPauseDiagnosticCapture.extensionUiOwnership(event, [rootId, detailsRootId, overlayRootId, potOddsRootId, toggleRootId, settingsLauncherId, settingsPanelId, trackedPlayersPanelId, playerDashboardId, statTooltipId, bootstrapBadgeId, pauseMarkerIndicatorId]);
  }

  function capturePauseDiagnosticPointerEvent(event) {
    if (!pauseLifecycleCaptureEnabled || !pauseDiagnosticCaptureState.pendingMarker) return null;
    var at = Date.now(); var details = pauseDiagnosticClickDetails(event); var ownership = pauseDiagnosticEventOwnership(event);
    details.extensionOwned = ownership.owned; details.extensionOwnership = ownership;
    if (event.isTrusted === true && !ownership.owned) PokerPauseDiagnosticCapture.recordActivation(pauseDiagnosticCaptureState, pauseDiagnosticCaptureState.pendingMarker.checkpointId, 'pointer', details, at);
    PokerPauseDiagnosticCapture.recordEntry(pauseDiagnosticCaptureState, { timestamp: at, api: 'pointer', direction: 'observed', eventType: ownership.owned ? 'extension-ui-context' : (event.isTrusted === true ? 'page-activation-context' : 'untrusted-context'), payload: details });
    return { observed: true, markerStillActive: true, ownership: ownership };
  }

  function capturePauseDiagnosticKeyEvent(event) {
    if (!pauseLifecycleCaptureEnabled || !pauseDiagnosticCaptureState.pendingMarker || !event || event.key === 'Escape') return null;
    var at = Date.now(); var ownership = pauseDiagnosticEventOwnership(event); var keyDetails = { code: String(event.code || '').slice(0, 80), key: event.target && String(event.target.type || '').toLowerCase() === 'password' ? '[REDACTED]' : String(event.key || '').slice(0, 80), targetType: (String(event.target && (event.target.tagName || event.target.nodeName) || '') + (event.target && event.target.type ? ':' + String(event.target.type) : '')).slice(0, 80), repeat: Boolean(event.repeat), altKey: Boolean(event.altKey), ctrlKey: Boolean(event.ctrlKey), metaKey: Boolean(event.metaKey), shiftKey: Boolean(event.shiftKey), trusted: event.isTrusted === true, extensionOwned: ownership.owned, extensionOwnership: ownership };
    if (event.isTrusted === true && !ownership.owned) PokerPauseDiagnosticCapture.recordActivation(pauseDiagnosticCaptureState, pauseDiagnosticCaptureState.pendingMarker.checkpointId, 'keyboard', keyDetails, at);
    PokerPauseDiagnosticCapture.recordEntry(pauseDiagnosticCaptureState, { timestamp: at, api: 'keyboard', direction: 'observed', eventType: String(event.type || 'key'), payload: keyDetails });
    return { observed: true, markerStillActive: true, ownership: ownership };
  }
  function armPauseDiagnosticMarker(marker) {
    var checkpoint = PokerPauseDiagnosticCapture.armMarker(pauseDiagnosticCaptureState, marker, Date.now());
    if (checkpoint) {
      pauseDiagnosticRecordSnapshot('marker-armed', checkpoint.checkpointId, checkpoint.armedAt);
      updatePauseDiagnosticMarkerIndicator();
      setSettingsOpen(false, 'pause-diagnostic-marker-armed');
      [100, 1000, 4000, 7900].forEach(function (delay) {
        var timer = setTimeout(function () { pauseDiagnosticRecordSnapshot('after-marker-armed-' + delay + 'ms', checkpoint.checkpointId, Date.now()); }, delay);
        pauseDiagnosticSnapshotTimers.push(timer);
      });
      var completionTimer = setTimeout(function () {
        pauseDiagnosticRecordSnapshot('marker-window-completed', checkpoint.checkpointId, checkpoint.windowEnd);
        PokerPauseDiagnosticCapture.completeMarkerWindow(pauseDiagnosticCaptureState, checkpoint.checkpointId, Date.now());
        updatePauseDiagnosticMarkerIndicator();
      }, PokerPauseDiagnosticCapture.LIMITS.postArmMs);
      pauseDiagnosticSnapshotTimers.push(completionTimer);
    }
    return checkpoint;
  }
  function pauseDiagnosticMutationText(node) {
    if (!node) return '';
    return String(node.nodeType === 3 ? node.nodeValue : node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  }

  function pauseDiagnosticMutationRelevant(text) {
    return /room owner paused the game|\bpaused\b|\bresumed\b|game started|game resumed/i.test(String(text || ''));
  }

  function handlePauseDiagnosticMutations(records) {
    if (!pauseLifecycleCaptureEnabled) return;
    records.forEach(function (mutation) {
      if (mutation.type === 'characterData') {
        var changedText = pauseDiagnosticMutationText(mutation.target);
        if (pauseDiagnosticMutationRelevant(changedText)) PokerPauseDiagnosticCapture.recordEntry(pauseDiagnosticCaptureState, { timestamp: Date.now(), api: 'dom-mutation', direction: 'observed', eventType: 'changed', target: pauseDiagnosticElementPath(mutation.target.parentElement), payload: { text: changedText, mutationType: mutation.type, disposition: 'changed' } });
        return;
      }
      Array.from(mutation.addedNodes || []).forEach(function (node) {
        var text = pauseDiagnosticMutationText(node);
        if (pauseDiagnosticMutationRelevant(text)) PokerPauseDiagnosticCapture.recordEntry(pauseDiagnosticCaptureState, { timestamp: Date.now(), api: 'dom-mutation', direction: 'observed', eventType: 'appeared', target: pauseDiagnosticElementPath(node.nodeType === 1 ? node : mutation.target), payload: { text: text, mutationType: mutation.type, disposition: 'appeared' } });
      });
      Array.from(mutation.removedNodes || []).forEach(function (node) {
        var text = pauseDiagnosticMutationText(node);
        if (pauseDiagnosticMutationRelevant(text)) PokerPauseDiagnosticCapture.recordEntry(pauseDiagnosticCaptureState, { timestamp: Date.now(), api: 'dom-mutation', direction: 'observed', eventType: 'disappeared', target: pauseDiagnosticElementPath(mutation.target), payload: { text: text, mutationType: mutation.type, disposition: 'disappeared' } });
      });
    });
  }

  function setPauseDiagnosticCaptureEnabled(enabled, timestamp) {
    pauseLifecycleCaptureEnabled = enabled === true;
    PokerPauseLifecycleCapture.setEnabled(pauseLifecycleCaptureState, pauseLifecycleCaptureEnabled, timestamp || Date.now());
    PokerPauseDiagnosticCapture.setEnabled(pauseDiagnosticCaptureState, pauseLifecycleCaptureEnabled, timestamp || Date.now());
    window.postMessage({ source: 'pokernow-stats-hud-content', type: 'pause-lifecycle-capture-mode', enabled: pauseLifecycleCaptureEnabled }, location.origin);
    window.postMessage({ source: 'pokernow-stats-hud-content', type: 'pause-diagnostic-capture-mode', enabled: pauseLifecycleCaptureEnabled }, location.origin);
    if (pauseLifecycleCaptureEnabled && !pauseDiagnosticDomObserver && document.documentElement) {
      pauseDiagnosticDomObserver = new MutationObserver(handlePauseDiagnosticMutations);
      pauseDiagnosticDomObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    } else if (!pauseLifecycleCaptureEnabled && pauseDiagnosticDomObserver) {
      pauseDiagnosticDomObserver.disconnect();
      pauseDiagnosticDomObserver = null;
    }
    updatePauseDiagnosticMarkerIndicator();
    return pauseLifecycleCaptureEnabled;
  }

  function clearPauseDiagnosticCapture() {
    pauseDiagnosticSnapshotTimers.forEach(clearTimeout);
    pauseDiagnosticSnapshotTimers = [];
    PokerPauseDiagnosticCapture.clearCapture(pauseDiagnosticCaptureState, Date.now());
    updatePauseDiagnosticMarkerIndicator();
    window.postMessage({ source: 'pokernow-stats-hud-content', type: 'pause-diagnostic-clear' }, location.origin);
    renderSettingsPanel();
  }

  function exportPauseDiagnosticCapture() {
    if (!pauseLifecycleCaptureEnabled) return null;
    var exportValue = PokerPauseDiagnosticCapture.createExport(pauseDiagnosticCaptureState, {
      runtimeStatusTraces: pauseStatusTraces,
      pauseRecognizerOutputs: {
        authoritativePauseState: currentEffectivePauseState(),
        lifecycleSignalTrace: PokerNowLifecycleSignal.snapshot(rawLifecycleTraceState),
        hostControlTrace: PokerHostControlTrace.snapshot(hostControlTraceState),
        legacyRawPauseLifecycleCapture: PokerPauseLifecycleCapture.snapshot(pauseLifecycleCaptureState)
      },
      instanceIds: {
        contentScriptInstanceId: contentScriptInstanceId,
        websocketHookInstanceId: pauseLifecycleCaptureState.websocketHookInstanceId,
        runtimeStatusStoreInstanceId: runtimeStatusStoreInstanceId,
        hudRendererInstanceId: hudRendererInstanceId
      }
    }, Date.now());
    if (!exportValue.captureValidity.valid && typeof window.alert === 'function') {
      window.alert(exportValue.captureValidity.reasons[0].message);
    }
    var textValue = JSON.stringify(exportValue, null, 2);
    var blob = new Blob([textValue], { type: 'application/json' });
    var href = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'pokernow-pause-capture-' + PNHUD_BUILD_ID + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    anchor.style.display = 'none';
    (document.body || document.documentElement).appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 0);
    return textValue;
  }

  function diagnosticPauseDomComparison() {
    var text = document.body ? String(document.body.innerText || '') : '';
    var match = text.match(/(?:the\s+room\s+owner|host|game)[^\n.]{0,80}(?:paused|resumed|stopped|started)[^\n.]{0,80}/i);
    return match ? match[0].trim().slice(0, 180) : null;
  }

  function markPauseLifecycleCheckpoint() {
    if (!pauseLifecycleCaptureEnabled) return null;
    var defaultLabel = 'checkpoint-' + (pauseLifecycleCaptureState.checkpoints.length + 1);
    var label = typeof window.prompt === 'function'
      ? window.prompt('Lifecycle checkpoint label', defaultLabel)
      : defaultLabel;
    if (label === null) return null;
    var presentation = hudRuntimePresentation(hudRuntimeStatusState.displayedStatus);
    var checkpoint = PokerPauseLifecycleCapture.markCheckpoint(pauseLifecycleCaptureState, label || defaultLabel, {
      runtimeStatus: PokerHudRuntimeStatus.snapshot(hudRuntimeStatusState),
      badgeText: presentation.label,
      footerText: presentation.note,
      diagnosticDomComparisonOnly: diagnosticPauseDomComparison(),
      activeContentInstanceIds: Object.keys(globalThis.__PNHUD_ACTIVE_CONTENT_INSTANCES__ || {}),
      detailsRootCount: document.querySelectorAll('#' + detailsRootId).length,
      hudRootCount: document.querySelectorAll('#' + rootId).length,
      contentScriptInstanceId: contentScriptInstanceId,
      websocketHookInstanceId: pauseLifecycleCaptureState.websocketHookInstanceId,
      runtimeStatusStoreInstanceId: runtimeStatusStoreInstanceId,
      hudRendererInstanceId: hudRendererInstanceId
    }, Date.now());
    console.log('[HUD RAW LIFECYCLE CAPTURE] checkpoint', checkpoint);
    return checkpoint;
  }

  function copyDiagnostics() {
    refreshLeaderboardPreferenceDiagnostics();
    var layoutDiagnostics = settingsLayoutDiagnostics();
    settingsUiDiagnostics.launcherLogoOverlapDetected = launcherOverlapsPokerNowLogo();
    settingsUiDiagnostics.settingsBackgroundOpacity = hudUiPreferences.settingsBackgroundOpacity;
    settingsUiDiagnostics.contentPaneOverflowY = layoutDiagnostics.contentPaneOverflowY;
    settingsUiDiagnostics.contentPaneScrollHeight = layoutDiagnostics.contentScrollHeight;
    settingsUiDiagnostics.contentPaneClientHeight = layoutDiagnostics.contentClientHeight;
    settingsUiDiagnostics.contentPaneCanScroll = layoutDiagnostics.contentPaneCanScroll;
    settingsUiDiagnostics.activeSection = layoutDiagnostics.activeSection;
    var activeContentInstanceIds = Object.keys(globalThis.__PNHUD_ACTIVE_CONTENT_INSTANCES__ || {});
    if (pauseLifecycleCaptureEnabled && activeContentInstanceIds.length > 1) {
      PokerPauseLifecycleCapture.warning(pauseLifecycleCaptureState, 'multiple-content-instances', 'multiple active content-script instances are registered', {
        activeContentInstanceIds: activeContentInstanceIds
      }, Date.now());
    }
    if (pauseLifecycleCaptureEnabled && (document.querySelectorAll('#' + detailsRootId).length > 1 || document.querySelectorAll('#' + rootId).length > 1)) {
      PokerPauseLifecycleCapture.warning(pauseLifecycleCaptureState, 'multiple-hud-renderers', 'multiple HUD root instances are present', {
        detailsRootCount: document.querySelectorAll('#' + detailsRootId).length,
        rendererRootCount: document.querySelectorAll('#' + rootId).length
      }, Date.now());
    }
    var diagnostics = {
      generatedAt: new Date().toISOString(),
      buildId: PNHUD_BUILD_ID,
      extensionId: PNHUD_EXTENSION_ID,
      contentScriptLoadedAt: contentInitializedAt,
      contentScriptInstanceId: contentScriptInstanceId,
      activeContentScriptInstanceIds: activeContentInstanceIds,
      activeContentScriptInstanceCount: activeContentInstanceIds.length,
      websocketHookInstanceId: pauseLifecycleCaptureState.websocketHookInstanceId,
      runtimeStatusStoreInstanceId: runtimeStatusStoreInstanceId,
      hudRendererInstanceId: hudRendererInstanceId,
      hudRootCounts: {
        details: document.querySelectorAll('#' + detailsRootId).length,
        renderer: document.querySelectorAll('#' + rootId).length,
        overlay: document.querySelectorAll('#' + overlayRootId).length
      },
      gameSessionKey: gameSessionKey,
      counters: Object.assign({}, pipelineHealth),
      last20DecodedEventNames: identityDiagnostics.decodedEventNames.slice(-20),
      socketPlayers: Array.from(identityDiagnostics.socketPlayers.values()).map(function (record) { return cloneJson(record); }),
      domSeatCandidates: identityDiagnostics.domSeats.map(function (seat) { return cloneJson(seat); }),
      seatDomRetention: seatDomRetentionInfo(),
      mappingCandidates: identityDiagnostics.mappingCandidates.slice(-100).map(function (candidate) { return cloneJson(candidate); }),
      lastChangedPaths: cloneJson(identityDiagnostics.lastChangedPaths),
      tbTrace: {
        rawTransitions: tbTraceState.rawTransitions,
        normalizedTransitions: tbTraceState.normalizedTransitions,
        voluntaryGates: tbTraceState.voluntaryGates,
        recentRecords: cloneJson(tbTraceState.records.slice(-200))
      },
      handFinalization: handAccounting ? {
        activeHand: cloneJson(PokerHandFinalization.activeHand(handAccounting)),
        finalizedHandIds: Array.from(handAccounting.finalizedHandIds),
        finalizedStatsEventCount: handAccounting.finalizedEvents.length
      } : null,
      semanticHandLedger: PokerSemanticHandLedger.inspect(semanticLedgerState),
      shadowPreflopOpportunities: PokerPreflopOpportunityReducer.inspect(preflopOpportunityState),
      shadowFlopCBetOpportunities: PokerFlopCBetOpportunityReducer.inspect(flopCBetOpportunityState),
      firstHandLifecycleTraces: PokerFirstHandLifecycle.snapshot(firstHandLifecycle),
      handCommitTraces: cloneJson(handCommitTraces),
      handSourceTraces: cloneJson(handSourceTraces),
      handLogDomMutationTraces: PokerHandLogDom.snapshot(handLogDomState),
      gameBreakLifecycleTraces: PokerGameBreakLifecycle.snapshot(gameBreakLifecycleState),
      hudRuntimeStatus: Object.assign(PokerHudRuntimeStatus.snapshot(hudRuntimeStatusState), {
        displayedLabel: hudRuntimePresentation(hudRuntimeStatusState.displayedStatus).label
      }),
      interruptedHandRecovery: PokerInterruptedHandRecovery.snapshot(interruptedHandRecoveryState),
      ownedHandReloadContinuity: PokerOwnedHandReloadContinuity.snapshot(ownedHandReloadContinuityState),
      hostControlTrace: PokerHostControlTrace.snapshot(hostControlTraceState),
      pauseStatusTraces: cloneJson(pauseStatusTraces),
      rawPauseLifecycleCapture: PokerPauseLifecycleCapture.snapshot(pauseLifecycleCaptureState),
      settlementOrdering: cloneJson(settlementOrderingDiagnostics.slice(-20)),
      rawLifecycleTrace: PokerNowLifecycleSignal.snapshot(rawLifecycleTraceState),
      pausePersistence: cloneJson(pausePersistenceDiagnostics),
      overlayStatPreferences: cloneJson(overlayStatPreferenceDiagnostics),
      leaderboardStatPreferences: cloneJson(leaderboardStatPreferenceDiagnostics),
      leaderboardHudPosition: cloneJson(leaderboardHudPositionDiagnostics),
      nativePanelLayering: cloneJson(nativePanelLayeringDiagnostics),
      seatHudPositions: Array.from(seatHudPositionDiagnostics.entries()).map(function (entry) {
        return Object.assign({ playerId: entry[0] }, cloneJson(entry[1]));
      }),
      seatHudPositionHistory: cloneJson(seatHudPositionHistory),
      seatHudCareerQuery: cloneJson(seatHudCareerQueryDiagnostics),
      seatHudBlockingPanelState: cloneJson(seatHudBlockingPanelState),
      statTooltipUi: cloneJson(statTooltipUiDiagnostics),
      settingsUi: cloneJson(settingsUiDiagnostics),
      settingsLayout: layoutDiagnostics,
      handIdentityComparisons: handCommitTraces.map(function (trace) {
        return { traceId: trace.traceId, source: trace.source, rawHandId: trace.rawHandId, canonicalHandId: trace.canonicalHandId, generatedSyntheticHandId: trace.generatedSyntheticHandId, dedupeKeys: trace.dedupeKeys, dedupeMatchResult: trace.dedupeMatchResult, commitAccepted: trace.commitAccepted };
      }),
      completedWalkTraces: completedWalkTraces.slice(-10),
      lastFailureReason: pipelineHealth.lastFailureReason
    };
    var textValue = JSON.stringify(diagnostics, null, 2);
    var button = document.querySelector('#' + settingsPanelId + ' .pnhud-copy-diagnostics');
    function copied() {
      if (!button) return;
      var original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(function () { if (button.isConnected) button.textContent = original; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textValue).then(copied).catch(function () { fallbackCopyText(textValue, copied); });
    } else {
      fallbackCopyText(textValue, copied);
    }
  }

  function markHandTransition(type) {
    var timestamp = Date.now();
    var label = {
      type: type,
      timestamp: timestamp,
      isoTime: new Date(timestamp).toISOString(),
      recordIds: handTransitionDiagnostics.records.filter(function (record) { return record.timestamp >= timestamp - 5000 && record.timestamp <= timestamp; }).map(function (record) { return record.id; })
    };
    handTransitionDiagnostics.labels.push(label);
    if (handTransitionDiagnostics.labels.length > 20) handTransitionDiagnostics.labels.shift();
    console.log('[HUD HAND] manual label', label);
    var selector = type === 'start' ? '.pnhud-mark-hand-start' : '.pnhud-mark-hand-end';
    var button = document.querySelector('#' + settingsPanelId + ' ' + selector);
    if (button) {
      var original = button.textContent;
      button.textContent = 'Marked ' + type;
      setTimeout(function () { if (button.isConnected) button.textContent = original; }, 1200);
    }
  }

  function isUnknownOrMinifiedPath(path) {
    var finalKey = String(path || '').split('.').pop().replace(/\[\d+\]/g, '');
    var known = /(?:players?|stack|chips?|balance|hand|board|community|pot|dealer|button|blind|bet|commit|fold|status|result|cards?|hole|street|phase|round|turn|action|current|timestamp|time|sequence|counter)/i;
    return !known.test(path) || finalKey.length <= 5;
  }

  function rankUnknownFields(labels, records) {
    var ranked = new Map();
    labels.forEach(function (label) {
      records.filter(function (record) { return Math.abs(record.timestamp - label.timestamp) <= 5000; }).forEach(function (record) {
        record.changedPaths.forEach(function (change) {
          if (!isUnknownOrMinifiedPath(change.path)) return;
          var key = label.type + '|' + change.path;
          var entry = ranked.get(key) || { labelType: label.type, path: change.path, withinOneSecond: 0, withinFiveSeconds: 0, examples: [] };
          var distanceMs = Math.abs(record.timestamp - label.timestamp);
          entry.withinFiveSeconds += 1;
          if (distanceMs <= 1000) entry.withinOneSecond += 1;
          if (entry.examples.length < 8) entry.examples.push({ distanceMs: record.timestamp - label.timestamp, previous: change.previous, current: change.current, eventName: record.eventName });
          ranked.set(key, entry);
        });
      });
    });
    return Array.from(ranked.values()).map(function (entry) {
      entry.correlationScore = entry.withinOneSecond * 5 + entry.withinFiveSeconds;
      return entry;
    }).sort(function (left, right) { return right.correlationScore - left.correlationScore; });
  }

  function copyHandSequence() {
    var labels = handTransitionDiagnostics.labels.map(function (label) {
      var records = handTransitionDiagnostics.records.filter(function (record) { return Math.abs(record.timestamp - label.timestamp) <= 5000; });
      var evaluations = handTransitionDiagnostics.evaluations.filter(function (evaluation) { return Math.abs(evaluation.timestamp - label.timestamp) <= 5000; });
      return Object.assign({}, label, { snapshotsAndDiffs: records, candidateEvaluations: evaluations });
    });
    var exportValue = {
      generatedAt: new Date().toISOString(),
      gameSessionKey: gameSessionKey,
      labels: labels,
      unknownMinifiedFieldsRankedByCorrelation: rankUnknownFields(handTransitionDiagnostics.labels, handTransitionDiagnostics.records),
      recentCandidateEvaluations: handTransitionDiagnostics.evaluations.slice(-100),
      detectorStatus: { handBoundariesDetected: pipelineHealth.handBoundariesDetected, lastAcceptedBoundaryAt: handTransitionDiagnostics.lastAcceptedBoundaryAt }
    };
    var textValue = JSON.stringify(exportValue, null, 2);
    var button = document.querySelector('#' + settingsPanelId + ' .pnhud-copy-hand-sequence');
    function copied() {
      if (!button) return;
      var original = button.textContent;
      button.textContent = 'Copied hand data';
      setTimeout(function () { if (button.isConnected) button.textContent = original; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textValue).then(copied).catch(function () { fallbackCopyText(textValue, copied); });
    else fallbackCopyText(textValue, copied);
  }

  function copyActionSequence() {
    var sequence = liveActionTracker.completedHands.length
      ? liveActionTracker.completedHands[liveActionTracker.completedHands.length - 1]
      : liveActionTracker.currentHandSequence;
    var exportValue = {
      generatedAt: new Date().toISOString(),
      gameSessionKey: gameSessionKey,
      counters: {
        actionCandidates: pipelineHealth.actionCandidates,
        checksDetected: pipelineHealth.checksDetected,
        callsDetected: pipelineHealth.callsDetected,
        betsDetected: pipelineHealth.betsDetected,
        raisesDetected: pipelineHealth.raisesDetected,
        foldsDetected: pipelineHealth.foldsDetected,
        ambiguousActionsRejected: pipelineHealth.ambiguousActionsRejected,
        rawTbTransitionsSeen: pipelineHealth.rawTbTransitionsSeen,
        normalizedTbTransitionsSeen: pipelineHealth.normalizedTbTransitionsSeen,
        voluntaryTbTransitionsGated: pipelineHealth.voluntaryTbTransitionsGated
      },
      hand: sequence || null,
      commitmentFieldProfiles: Array.from(liveActionTracker.commitmentFieldProfiles.entries()).map(function (entry) { return { field: entry[0], profile: entry[1] }; }),
      actorFieldProfiles: Array.from(liveActionTracker.actorFieldProfiles.entries()).map(function (entry) { return { path: entry[0], profile: entry[1] }; }),
      numericFieldProfilesRanked: Array.from(liveActionTracker.numericFieldProfiles.values()).sort(function (left, right) { return right.correlationScore - left.correlationScore; }),
      actionFieldDiagnostics: liveActionTracker.fieldDiagnostics.slice(-500),
      tbActionState: liveActionTracker.tbTracker ? cloneJson(liveActionTracker.tbTracker) : null,
      liveActionLifecycle: liveActionTracker.livePipelineState ? cloneJson(liveActionTracker.livePipelineState.lifecycle) : [],
      tbTraceRecords: cloneJson(tbTraceState.records.slice(-500))
    };
    var textValue = JSON.stringify(exportValue, null, 2);
    var button = document.querySelector('#' + settingsPanelId + ' .pnhud-copy-action-sequence');
    function copied() {
      if (!button) return;
      var original = button.textContent;
      button.textContent = 'Copied actions';
      setTimeout(function () { if (button.isConnected) button.textContent = original; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textValue).then(copied).catch(function () { fallbackCopyText(textValue, copied); });
    else fallbackCopyText(textValue, copied);
  }

  function fallbackCopyText(textValue, callback) {
    var textarea = document.createElement('textarea');
    textarea.value = textValue;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.documentElement.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); callback(); } catch (error) { setPipelineFailure('Copy Diagnostics failed', error && (error.message || error)); }
    textarea.remove();
  }

  function addDecodedEventName(eventName, frameId, metadata) {
    identityDiagnostics.decodedEventNames.push(Object.assign({ eventName: eventName, frameId: frameId || null, timestamp: Date.now() }, metadata || {}));
    if (identityDiagnostics.decodedEventNames.length > 20) identityDiagnostics.decodedEventNames.shift();
  }

  function primitiveFields(value) {
    var fields = {};
    if (!value || typeof value !== 'object') return fields;
    Object.keys(value).slice(0, 100).forEach(function (key) {
      var fieldValue = value[key];
      if (fieldValue === null || ['string', 'number', 'boolean'].includes(typeof fieldValue)) fields[key] = fieldValue;
    });
    return fields;
  }

  function valueByKeyPattern(fields, pattern, expectedType) {
    var keys = Object.keys(fields || {});
    for (var index = 0; index < keys.length; index += 1) {
      if (!pattern.test(keys[index])) continue;
      var value = fields[keys[index]];
      if (!expectedType || typeof value === expectedType) return value;
    }
    return null;
  }

  function discoverSocketPlayers(eventName, payload) {
    var discoveredThisEvent = new Set();
    var orderCounter = 0;
    function visit(value, path, depth, inheritedId, inheritedOrder) {
      if (!value || typeof value !== 'object' || depth > 10) return;
      if (Array.isArray(value)) {
        value.forEach(function (item, index) { visit(item, path + '[' + index + ']', depth + 1, null, index); });
        return;
      }
      var fields = primitiveFields(value);
      var directId = value.id || value._id || value.playerId || value.player_id || value.userId || value.user_id || value.uuid || value.playerUuid || value.player_uuid;
      var playerish = Object.keys(fields).some(function (key) { return /(?:stack|chip|balance|player|seat|position|name|nickname|username|winCount)/i.test(key); });
      var playerId = PokerPlayerProfileShadowStore.livePlayerIdentity(directId) || (playerish ? PokerPlayerProfileShadowStore.livePlayerIdentity(inheritedId) : null);
      if (playerId) {
        var normalizedId = playerId;
        var existing = identityDiagnostics.socketPlayers.get(normalizedId);
        var stack = valueByKeyPattern(fields, /^(?:stack|chips?|balance)$/i, 'number');
        var seatIndex = /(?:gameResult|results?|winners?)/i.test(path) ? null : valueByKeyPattern(fields, /(?:seat|position|index|order)/i);
        var name = valueByKeyPattern(fields, /^(?:name|playerName|player_name|nickname|username)$/i, 'string');
        var record = existing || { playerId: normalizedId, knownFields: {}, sources: [], eventNames: [], firstSeenAt: Date.now(), stack: null, seatIndex: null, orderIndex: null };
        var previousStack = record.stack;
        Object.assign(record.knownFields, fields);
        if (typeof stack === 'number') record.stack = stack;
        if (seatIndex !== null && seatIndex !== undefined) record.seatIndex = seatIndex;
        if (inheritedOrder !== null && inheritedOrder !== undefined) record.orderIndex = inheritedOrder;
        else if (record.orderIndex === null && /(?:players|roster|seats)/i.test(path)) record.orderIndex = orderCounter++;
        if (!record.sources.includes(path)) record.sources.push(path);
        if (!record.eventNames.includes(eventName)) record.eventNames.push(eventName);
        record.lastSeenAt = Date.now();
        identityDiagnostics.socketPlayers.set(normalizedId, record);
        discoveredThisEvent.add(normalizedId);
        if (typeof previousStack === 'number' && typeof record.stack === 'number' && previousStack !== record.stack) {
          var transition = { playerId: normalizedId, before: previousStack, after: record.stack, delta: record.stack - previousStack, eventName: eventName, timestamp: Date.now() };
          identityDiagnostics.socketStackTransitions.push(transition);
          if (identityDiagnostics.socketStackTransitions.length > 50) identityDiagnostics.socketStackTransitions.shift();
          console.log('[HUD MAP] stack transition candidate', { source: 'socket', transition: transition });
        }
        if (name) confirmIdentityMapping(normalizedId, name, 'socket event contains ID and name', { eventName: eventName, path: path, fields: fields });
      } else if (playerish && valueByKeyPattern(fields, /^(?:name|playerName|player_name|nickname|username)$/i, 'string')) {
        PokerPlayerProfileShadowStore.recordIdentityDiagnostic(playerProfileShadowState, directId, { source: 'socket-player-discovery' });
      }
      Object.keys(value).forEach(function (key, index) {
        var child = value[key];
        var exactPlayerMap = /(?:^|\.)(?:players|roster|playerMap|player_map|playerData|player_data|users)$/i.test(path);
        var childPlayerId = child && typeof child === 'object' && exactPlayerMap && /^[a-zA-Z0-9_-]+$/.test(key) ? key : null;
        var childOrder = /(?:players|roster|seats)/i.test(path + '.' + key) ? index : null;
        visit(child, path ? path + '.' + key : key, depth + 1, childPlayerId, childOrder);
      });
    }
    visit(payload, '$', 0, null, null);
    pipelineHealth.socketPlayerIdsDiscovered = identityDiagnostics.socketPlayers.size;
    updateHealthPanel();
    console.log('[HUD MAP] socket IDs discovered', {
      eventName: eventName,
      idsThisEvent: Array.from(discoveredThisEvent),
      allSocketPlayers: Array.from(identityDiagnostics.socketPlayers.values())
    });
  }

  function inspectReactInternals(element) {
    var targets = [element].concat(Array.from(element.querySelectorAll('*')).slice(0, 30));
    var reactRoots = [];
    targets.forEach(function (target, targetIndex) {
      Object.getOwnPropertyNames(target).filter(function (key) { return key.indexOf('__reactProps$') === 0 || key.indexOf('__reactFiber$') === 0; }).forEach(function (key) {
        reactRoots.push({ target: target, key: key, label: (targetIndex ? 'descendant[' + targetIndex + '].' : '') + key });
      });
    });
    var propertyKeys = reactRoots.map(function (root) { return root.label; });
    var relevantValues = {};
    var knownIds = new Set(identityDiagnostics.socketPlayers.keys());
    var seen = new WeakSet();
    var valueCount = 0;
    function visit(value, path, depth) {
      if (valueCount >= 160 || value === null || value === undefined || depth > 6) return;
      if (['string', 'number', 'boolean'].includes(typeof value)) {
        if (/(?:player|user|seat|position|index|name|nick|stack|chip|balance|uuid|\bid\b)/i.test(path) || knownIds.has(String(value))) {
          relevantValues[path] = value;
          valueCount += 1;
        }
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      Object.keys(value).slice(0, 100).forEach(function (key) {
        try { visit(value[key], path + '.' + key, depth + 1); } catch (error) {}
      });
    }
    reactRoots.forEach(function (root) {
      try { visit(root.target[root.key], root.label, 0); } catch (error) {}
    });
    return { propertyKeys: propertyKeys, relevantValues: relevantValues };
  }

  function parseVisibleNumber(value) {
    var matches = String(value || '').match(/-?\d[\d,]*(?:\.\d+)?/g);
    if (!matches || !matches.length) return null;
    var number = Number(matches[matches.length - 1].replace(/,/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function firstReactValue(reactInfo, pattern, expectedType) {
    var paths = Object.keys(reactInfo.relevantValues);
    for (var index = 0; index < paths.length; index += 1) {
      var value = reactInfo.relevantValues[paths[index]];
      if (pattern.test(paths[index]) && (!expectedType || typeof value === expectedType)) return value;
    }
    return null;
  }

  function anchorRectRecord(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    var rect = element.getBoundingClientRect();
    if (!validAnchorRect(rect)) return null;
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 };
  }

  function unionAnchorRects(left, right) {
    if (!left) return right;
    if (!right) return left;
    var x1 = Math.min(left.left, right.left);
    var y1 = Math.min(left.top, right.top);
    var x2 = Math.max(left.right, right.right);
    var y2 = Math.max(left.bottom, right.bottom);
    return { left: x1, top: y1, width: x2 - x1, height: y2 - y1, right: x2, bottom: y2, centerX: (x1 + x2) / 2, centerY: (y1 + y2) / 2 };
  }

  function anchorElementReference(element, source) {
    if (!element) return { source: source, selector: 'synthetic name/stack union' };
    return { source: source, selector: String(element.tagName || '').toLowerCase() + (element.id ? '#' + element.id : '') + (element.className ? '.' + String(element.className).trim().replace(/\s+/g, '.') : '') };
  }

  function isActionMarkerElement(element) {
    if (!element) return false;
    var descriptors = [];
    var current = element;
    for (var depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      descriptors.push([current.id, current.className, current.getAttribute && current.getAttribute('data-testid'), current.getAttribute && current.getAttribute('aria-label')].join(' '));
      if (/(?:table-player-infos-ctn|infos-ctn-container)/i.test(String(current.className || ''))) break;
    }
    var descriptor = descriptors.join(' ');
    return /(?:blind|dealer|button|bet|wager|pot|marker|action|amount)/i.test(descriptor);
  }

  function nearestCommonSeatDescendant(left, right, seatElement) {
    if (!left || !right) return null;
    var current = left;
    while (current && current !== seatElement.parentElement) {
      if (current.contains && current.contains(right)) return current;
      if (current === seatElement) break;
      current = current.parentElement;
    }
    return null;
  }

  function findExactTextElement(seatElement, text) {
    var normalized = String(text || '').trim().replace(/\s+/g, ' ');
    if (!normalized) return null;
    return Array.from(seatElement.querySelectorAll('*')).filter(function (candidate) {
      return String(candidate.textContent || '').trim().replace(/\s+/g, ' ') === normalized && validAnchorRect(candidate.getBoundingClientRect());
    }).sort(function (left, right) {
      var leftRect = left.getBoundingClientRect();
      var rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || null;
  }

  function elementVisibleText(element) {
    return String(element && (element.innerText || element.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  }

  function seatHudVisualTextRect(element, expectedText) {
    if (!element || !element.isConnected || !isVisible(element) || isExtensionOwnedUiElement(element)) return null;
    if (!document.createTreeWalker || !document.createRange) return null;
    // Measure painted text, not the CSS width of a name/stack row. Badges can
    // live inside that row (or even inside the player link).
    var excluded = '[class*="badge" i], [class*="trophy" i], [class*="action" i], [class*="fold-icon" i], [class*="fold-marker" i], [class*="dealer" i], [class*="blind" i], [aria-hidden="true"], .pnhud-seat-overlay';
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    var nodes = []; var node;
    while ((node = walker.nextNode())) {
      if (!String(node.nodeValue || '').trim() || !node.parentElement || node.parentElement.closest(excluded) || !isVisible(node.parentElement)) continue;
      nodes.push(node);
    }
    var text = nodes.map(function (value) { return value.nodeValue; }).join('').trim().replace(/\s+/g, ' ');
    if (!text || expectedText && !PokerSeatOverlay.exactNameMatch(text, expectedText)) return null;
    var rect = null;
    nodes.forEach(function (value) {
      var range = document.createRange();
      range.selectNodeContents(value);
      Array.from(range.getClientRects()).forEach(function (part) {
        if (validAnchorRect(part)) rect = unionAnchorRects(rect, { left: part.left, top: part.top, width: part.width, height: part.height, right: part.right, bottom: part.bottom });
      });
    });
    return rect;
  }

  function seatHudVerticalPanelGeometry(seatElement, nameElement, stackElement, nameRect, stackRect) {
    var panelRect = unionAnchorRects(nameRect, stackRect);
    var references = [];
    var selector = '.table-player-name, .table-player-stack, .table-player-infos-ctn, .infos-ctn-container, [class*="player-info" i], [class*="player-panel" i], [class*="player-card" i], [data-player-card], [data-player-panel], [data-cards], [class*="avatar" i]';
    var candidates = new Set(Array.from(seatElement.querySelectorAll(selector)));
    [nameElement, stackElement].forEach(function (element) {
      for (var current = element; current && current !== seatElement.parentElement; current = current.parentElement) {
        candidates.add(current);
        if (current === seatElement) break;
      }
    });
    candidates.forEach(function (candidate) {
      if (!candidate.isConnected || !isVisible(candidate) || isExtensionOwnedUiElement(candidate)) return;
      // A folded player panel is still a panel. Only its transient markers are
      // excluded; never treat the folded state itself as non-player geometry.
      for (var current = candidate; current; current = current.parentElement) {
        var descriptor = [current.id, current.className, current.getAttribute && current.getAttribute('data-testid')].join(' ');
        if ((current !== seatElement || current === candidate) && /(?:action|animation|bubble|badge|trophy|dealer|blind|wager|marker|control|fold-icon)/i.test(descriptor)) return;
        if (current === seatElement) break;
      }
      var semanticPanel = candidate.matches && candidate.matches(selector);
      var style = getComputedStyle(candidate);
      var paintedPanel = style.backgroundImage && style.backgroundImage !== 'none' || style.backgroundColor && !/^(?:transparent|rgba\([^)]*,\s*0(?:\.0+)?\))$/.test(style.backgroundColor) || parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== 'none';
      if (!semanticPanel && !paintedPanel) return;
      var rect = anchorRectRecord(candidate);
      // Stay within the existing bounded seat-presentation scale, but allow
      // tall avatars/cards and panel padding that exceed the former text guard.
      if (!rect || rect.width > 500 || rect.height > 350 || rect.right < nameRect.left - 40 || rect.left > nameRect.right + 40) return;
      panelRect = unionAnchorRects(panelRect, rect);
      references.push(Object.assign(anchorElementReference(candidate, semanticPanel ? 'player panel/card box' : 'painted identity ancestor'), { rect: rect }));
    });
    return { rect: panelRect, source: references.length ? 'complete-visible-player-panel' : 'visible-identity-text-fallback', references: references };
  }

  function resolvePlayerPanelBodyGeometry(seatElement) {
    if (!seatElement || !seatElement.isConnected || isExtensionOwnedUiElement(seatElement)) return null;
    // Live PokerNow evidence: this direct child paints the dark seat body.
    // The transparent infos-ctn-container inside it can have zero height;
    // trophy/rebuy signals, status icons and cards are separate seat siblings.
    var owner = seatElement.closest && seatElement.closest('.table-player');
    if (!owner || !owner.isConnected) return null;
    var bodies = Array.from(owner.querySelectorAll('.table-player-infos-ctn')).filter(function (candidate) {
      if (candidate.parentElement !== owner || !candidate.isConnected || !isVisible(candidate) || isExtensionOwnedUiElement(candidate)) return false;
      if (!candidate.querySelector('.table-player-name') || !candidate.querySelector('.table-player-stack')) return false;
      var style = getComputedStyle(candidate);
      var painted = style.backgroundImage && style.backgroundImage !== 'none' || style.backgroundColor && !/^(?:transparent|rgba\([^)]*,\s*0(?:\.0+)?\))$/.test(style.backgroundColor);
      return Boolean(painted && anchorRectRecord(candidate));
    });
    // Do not guess between multiple bodies or select another player's panel.
    if (bodies.length !== 1) return null;
    var body = bodies[0];
    var rect = anchorRectRecord(body);
    return {
      source: 'live-player-panel-body',
      playerPanelBodySource: 'live_panel',
      playerPanelBodyRect: rect,
      rect: rect,
      horizontalVisualRect: rect,
      verticalPanelRect: rect,
      nameElement: body.querySelector('.table-player-name'),
      stackElement: body.querySelector('.table-player-stack'),
      reference: Object.assign(anchorElementReference(body, 'live-inspected painted PokerNow player panel'), {
        structuralSelector: '.table-player > .table-player-infos-ctn',
        playerPanelBodySource: 'live_panel', playerPanelBodyRect: rect,
        horizontalAnchorSource: 'live_panel', horizontalAnchorRect: rect,
        verticalAnchorSource: 'live_panel', verticalAnchorRect: rect,
        backgroundColor: getComputedStyle(body).backgroundColor,
        geometryOwner: 'direct painted panel border box; no child union'
      })
    };
  }

  function seatHudPanelBodyAlignmentDiagnostic(reference, fallbackRect, canonicalRect) {
    var rect = reference && reference.playerPanelBodyRect || fallbackRect;
    var center = rect.left + rect.width / 2;
    var bottom = rect.top + rect.height;
    var hudCenter = canonicalRect.left + canonicalRect.width / 2;
    return {
      playerPanelBodySource: reference && reference.playerPanelBodySource || 'seat_fallback',
      playerPanelBodyRect: Object.assign({}, rect),
      panelCenterX: center, hudCanonicalCenterX: hudCenter, centerDeltaX: hudCenter - center,
      panelBottom: bottom, canonicalHudTop: canonicalRect.top, verticalGap: canonicalRect.top - bottom
    };
  }

  function resolvePlayerVisualGeometry(seatElement, displayedName, targetStack) {
    if (!seatElement || !seatElement.isConnected) return null;
    var panelBody = resolvePlayerPanelBodyGeometry(seatElement);
    if (panelBody) return panelBody;
    var normalizedName = String(displayedName || '').trim().replace(/\s+/g, ' ');
    var nameSelector = 'a[href^="/players/"], [data-player-name], [class*="player-name" i], [class*="nickname" i], [class*="username" i]';
    var nameElement = Array.from(seatElement.querySelectorAll(nameSelector)).find(function (candidate) {
      return Boolean(seatHudVisualTextRect(candidate, normalizedName));
    }) || findExactTextElement(seatElement, normalizedName);
    var stackElement = seatElement.querySelector('.table-player-stack') || Array.from(seatElement.querySelectorAll('[data-stack], [data-chips], [class*="stack" i], [class*="chips" i]')).find(function (candidate) {
      if (isActionMarkerElement(candidate) || !validAnchorRect(candidate.getBoundingClientRect())) return false;
      if (!Number.isFinite(Number(targetStack))) return true;
      return parseVisibleNumber(candidate.getAttribute('data-stack') || candidate.getAttribute('data-chips') || candidate.textContent) === Number(targetStack);
    }) || null;
    if (stackElement && isActionMarkerElement(stackElement)) stackElement = null;
    var nameRect = seatHudVisualTextRect(nameElement, normalizedName);
    var stackRect = seatHudVisualTextRect(stackElement);
    if (nameRect) {
      // Independent owners: compact painted identity for X; complete current
      // player panel/card presentation (including box padding) for the bottom.
      var vertical = seatHudVerticalPanelGeometry(seatElement, nameElement, stackElement, nameRect, stackRect);
      var bottom = vertical.rect.bottom;
      // Compatibility adapter for the unchanged canonical/offset/clamp math.
      var visualRect = { left: nameRect.left, top: nameRect.top, width: nameRect.width, height: bottom - nameRect.top, right: nameRect.right, bottom: bottom, centerX: nameRect.left + nameRect.width / 2, centerY: (nameRect.top + bottom) / 2 };
      return {
        source: 'painted-player-identity-with-card-clearance',
        playerPanelBodySource: 'visual_fallback',
        rect: visualRect,
        horizontalVisualRect: nameRect,
        verticalPanelRect: vertical.rect,
        nameElement: nameElement,
        stackElement: stackElement,
        reference: Object.assign(anchorElementReference(nameElement, 'painted player identity; wrapper width excluded'), { playerPanelBodySource: 'visual_fallback', playerPanelBodyRect: visualRect, nameTextRect: nameRect, stackTextRect: stackRect, horizontalOwner: 'painted-player-name', verticalOwner: vertical.source, horizontalAnchorSource: 'painted-player-name', horizontalAnchorRect: nameRect, verticalAnchorSource: vertical.source, verticalAnchorRect: vertical.rect, verticalPanelReferences: vertical.references })
      };
    }
    var infoSelector = '.table-player-infos-ctn, .infos-ctn-container, [class*="player-info" i], [class*="player-card" i], [data-player-card]';
    var infoElement = Array.from(seatElement.querySelectorAll(infoSelector)).filter(function (candidate) {
      var descriptor = [candidate.id, candidate.className, candidate.getAttribute && candidate.getAttribute('aria-label')].join(' ');
      return !/(?:action|fold|bet|wager|badge|trophy|dealer|blind|button)/i.test(descriptor) && validAnchorRect(candidate.getBoundingClientRect());
    }).sort(function (left, right) {
      var leftRect = left.getBoundingClientRect();
      var rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || null;
    var infoRect = anchorRectRecord(infoElement);
    if (infoRect) {
      return {
        source: 'player-info-container',
        playerPanelBodySource: 'visual_fallback',
        rect: infoRect,
        nameElement: null,
        stackElement: null,
        reference: Object.assign(anchorElementReference(infoElement, 'smallest current player info/card container'), { playerPanelBodySource: 'visual_fallback', playerPanelBodyRect: infoRect })
      };
    }
    var broadRect = anchorRectRecord(seatElement);
    return broadRect ? {
      source: 'authoritative-seat-fallback',
      playerPanelBodySource: 'seat_fallback',
      rect: broadRect,
      nameElement: null,
      stackElement: null,
      reference: Object.assign(anchorElementReference(seatElement, 'authoritative connected seat fallback'), { playerPanelBodySource: 'seat_fallback', playerPanelBodyRect: broadRect })
    } : null;
  }

  function selectSeatAnchor(element, nameElement, stackElement, displayedName, elementId, requireExact) {
    if (!nameElement && displayedName) nameElement = findExactTextElement(element, displayedName);
    var nameRect = anchorRectRecord(nameElement);
    var stackRect = anchorRectRecord(stackElement);
    var common = nearestCommonSeatDescendant(nameElement, stackElement, element);
    var commonRect = anchorRectRecord(common);
    var unionRect = unionAnchorRects(nameRect, stackRect);
    var useCommonRect = validAnchorRect(commonRect);
    var cardsElement = element.querySelector('[class*="card" i], [data-cards]');
    var exactNamePresent = Boolean(nameElement && PokerSeatOverlay.exactNameMatch(elementVisibleText(nameElement), displayedName));
    var stackPresent = Boolean(stackElement && !isActionMarkerElement(stackElement));
    var candidates = [
      { kind: 'name-stack-block', reference: anchorElementReference(useCommonRect && common !== element ? common : null, useCommonRect && common !== element ? 'nearest name/stack wrapper' : 'name/stack rectangle union'), rect: useCommonRect && common !== element ? commonRect : unionRect, element: useCommonRect && common !== element ? common : null, containsExactName: exactNamePresent, containsCurrentStack: stackPresent },
      { kind: 'name', reference: anchorElementReference(nameElement, 'visible player name'), rect: nameRect, element: nameElement, containsExactName: exactNamePresent, hasNearbyStack: stackPresent },
      { kind: 'stack', reference: anchorElementReference(stackElement, 'visible player stack'), rect: stackRect, element: stackElement, containsCurrentStack: stackPresent, isBlindOrBetMarker: isActionMarkerElement(stackElement) },
      { kind: 'occupied-seat-wrapper', reference: anchorElementReference(element, 'stable occupied-seat wrapper'), rect: anchorRectRecord(element), element: element, containsExactName: exactNamePresent },
      { kind: 'cards', reference: anchorElementReference(cardsElement, 'cards container'), rect: anchorRectRecord(cardsElement), element: cardsElement }
    ];
    Array.from(element.querySelectorAll('[class*="dealer" i], [class*="blind" i], [class*="bet" i], [class*="wager" i], [class*="pot" i], [class*="seat-number" i], [data-seat-number]')).slice(0, 12).forEach(function (marker) {
      candidates.push({ kind: 'blind-or-bet-marker', reference: anchorElementReference(marker, 'excluded table marker'), rect: anchorRectRecord(marker), element: marker, isBlindOrBetMarker: !/(?:seat-number)/i.test(String(marker.className || '')), isSeatNumber: /(?:seat-number)/i.test(String(marker.className || '')) || marker.hasAttribute('data-seat-number') });
    });
    var selection = PokerSeatOverlay.chooseAnchorCandidate(candidates);
    selection.ranked.forEach(function (candidate) {
      console.log('[HUD SEAT ANCHOR] candidate', {
        playerName: displayedName,
        domSeatIdentifier: elementId,
        tag: candidate.element && candidate.element.tagName || null,
        id: candidate.element && candidate.element.id || null,
        classes: candidate.element && String(candidate.element.className || '') || null,
        visibleText: elementVisibleText(candidate.element),
        boundingRectangle: candidate.rect,
        containsExactPlayerName: Boolean(candidate.containsExactName),
        containsCurrentStack: Boolean(candidate.containsCurrentStack || candidate.hasNearbyStack),
        isBlindDealerBetCardOrSeatNumber: Boolean(candidate.isBlindOrBetMarker || candidate.isSeatNumber || candidate.kind === 'cards'),
        score: candidate.score,
        rejectionReason: candidate.rejectionReason,
        selected: Boolean(selection.selected && selection.selected === candidate)
      });
    });
    console.log('[HUD SEAT OVERLAY] anchor candidates', { domSeatIdentifier: elementId, displayedName: displayedName, selected: selection.selected ? { kind: selection.selected.kind, reference: selection.selected.reference, rect: selection.selected.rect } : null });
    if (selection.selected) return selection.selected;
    return requireExact ? null : { kind: 'occupied-seat-wrapper', reference: anchorElementReference(element, 'unconfirmed discovery fallback only'), rect: anchorRectRecord(element), element: element };
  }

  function canonicalSeatElement(element) {
    var current = element;
    var best = element;
    for (var depth = 0; current && current !== document.body && depth < 7; depth += 1, current = current.parentElement) {
      var rect = current.getBoundingClientRect();
      if (!validAnchorRect(rect) || rect.width > 500 || rect.height > 350) continue;
      var descriptor = [current.className, current.id].join(' ');
      var explicitSeat = current.hasAttribute('data-seat') || current.hasAttribute('data-seat-index') || current.hasAttribute('data-player-id') || /(?:table-player|player-seat|seat-player|occupied-seat|seat-container)/i.test(descriptor);
      var hasName = Boolean(current.matches('[data-player-name], [class*="player-name" i], [class*="nickname" i], [class*="username" i]') || current.querySelector('[data-player-name], [class*="player-name" i], [class*="nickname" i], [class*="username" i]'));
      var hasStack = Boolean(current.matches('[data-stack], [data-chips], [class*="stack" i], [class*="chips" i]') || current.querySelector('[data-stack], [data-chips], [class*="stack" i], [class*="chips" i]'));
      if (hasName && hasStack && best === element) best = current;
      if (explicitSeat && hasName) return current;
    }
    return best;
  }

  function normalizeSeatNameFragment(value, stackValue) {
    var text = String(value || '').replace(/(?:FOLD|CHECK|CALL|BET|RAISE)?\s*\((?:OFFLINE|AWAY|SITTING OUT)\)/gi, ' ').replace(/\b(?:OFFLINE|AWAY|SITTING OUT|FOLD|CHECK|CALL|BET|RAISE)\b/gi, ' ').replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (stackValue !== null && stackValue !== undefined) text = text.replace(new RegExp('\\s+' + String(stackValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '').trim();
    return text;
  }

  function domSeatCandidate(element, domIndex) {
    var elementId = domSeatElementIds.get(element);
    if (!elementId) {
      elementId = 'dom-seat-' + nextDomSeatElementId++;
      domSeatElementIds.set(element, elementId);
    }
    domSeatElements.set(elementId, element);
    var dataAttributes = {};
    Array.from(element.attributes || []).forEach(function (attribute) { if (attribute.name.indexOf('data-') === 0) dataAttributes[attribute.name] = attribute.value; });
    var reactInfo = inspectReactInternals(element);
    var playerLink = element.querySelector('a[href^="/players/"]');
    var playerHrefMatch = playerLink && String(playerLink.getAttribute('href') || '').match(/^\/players\/([^/?#]+)/i);
    var directHrefPlayerId = playerHrefMatch ? decodeURIComponent(playerHrefMatch[1]) : null;
    var playerLinkName = playerLink ? elementVisibleText(playerLink) : null;
    var nameSelector = '[data-player-name], [class*="player-name" i], [class*="nickname" i], [class*="username" i]';
    var nameElements = (element.matches(nameSelector) ? [element] : []).concat(Array.from(element.querySelectorAll(nameSelector)));
    var nameElementTexts = nameElements.map(function (candidate) { return { element: candidate, text: elementVisibleText(candidate) }; }).filter(function (candidate) { return candidate.text && candidate.text.length <= 40 && /[a-zA-Z]/.test(candidate.text); });
    var knownVisibleName = null;
    socketPlayerNames.forEach(function (knownName) {
      var exact = nameElementTexts.find(function (candidate) { return PokerSeatOverlay.exactNameMatch(candidate.text, knownName); });
      if (exact && !knownVisibleName) knownVisibleName = { name: String(knownName).trim().replace(/\s+/g, ' '), element: exact.element };
    });
    var reactName = firstReactValue(reactInfo, /(?:playerName|player_name|nickname|username|\.name)$/i, 'string');
    var dataName = element.getAttribute('data-player-name');
    var longestNameCandidate = nameElementTexts.slice().sort(function (left, right) { return right.text.length - left.text.length; })[0] || null;
    var displayedName = playerLinkName || dataName || (knownVisibleName && knownVisibleName.name) || reactName || (longestNameCandidate && longestNameCandidate.text) || null;
    var nameElement = playerLink ? (playerLink.closest('.table-player-name') || playerLink) : (knownVisibleName && knownVisibleName.element || (displayedName && nameElementTexts.find(function (candidate) { return PokerSeatOverlay.exactNameMatch(candidate.text, displayedName); }) || {}).element || null);
    var stackElement = element.querySelector('.table-player-stack') || Array.from(element.querySelectorAll('[data-stack], [data-chips], [class*="stack" i], [class*="chips" i]')).find(function (candidate) { return !isActionMarkerElement(candidate) && validAnchorRect(candidate.getBoundingClientRect()); }) || null;
    var displayedStack = parseVisibleNumber((stackElement && (stackElement.getAttribute('data-stack') || stackElement.getAttribute('data-chips') || stackElement.textContent)) || element.getAttribute('data-stack') || element.getAttribute('data-chips'));
    if (displayedStack === null) {
      var reactStack = firstReactValue(reactInfo, /(?:stack|chips?|balance)$/i, 'number');
      if (typeof reactStack === 'number') displayedStack = reactStack;
    }
    var textLines = String(element.innerText || element.textContent || '').split(/\r?\n/).map(function (line) { return line.trim().replace(/\s+/g, ' '); }).filter(Boolean);
    if (!displayedName) {
      var nameLine = textLines.find(function (line) { return /[a-zA-Z]/.test(line) && line.length <= 40 && !/^(?:fold|check|call|bet|raise|sit|leave|empty|dealer|small blind|big blind)$/i.test(line); }) || null;
      displayedName = nameLine ? nameLine.replace(/\s+\(?-?\d[\d,.]*\)?\s*$/, '').trim() : null;
    }
    if (displayedStack === null) displayedStack = parseVisibleNumber(textLines.slice(0, 6).join(' '));
    displayedName = normalizeSeatNameFragment(displayedName, displayedStack);
    var rawFragments = [];
    [element].concat(Array.from(element.querySelectorAll('*')).slice(0, 100)).forEach(function (candidate) {
      var directText = Array.from(candidate.childNodes || []).filter(function (node) { return node.nodeType === 3; }).map(function (node) { return String(node.textContent || '').trim(); }).filter(Boolean).join(' ');
      if (directText) rawFragments.push({ source: 'direct text node', value: directText, tag: candidate.tagName, className: String(candidate.className || '') });
      ['aria-label', 'title', 'data-player-name', 'data-name', 'data-username'].forEach(function (attribute) { var value = candidate.getAttribute && candidate.getAttribute(attribute); if (value) rawFragments.push({ source: attribute, value: value, tag: candidate.tagName, className: String(candidate.className || '') }); });
    });
    Object.keys(reactInfo.relevantValues).filter(function (path) { return /(?:playerName|player_name|nickname|username|\.name)$/i.test(path); }).forEach(function (path) { rawFragments.push({ source: 'React ' + path, value: reactInfo.relevantValues[path] }); });
    if (playerLinkName) rawFragments.unshift({ source: 'direct /players/<id> link text', value: playerLinkName, href: playerLink.getAttribute('href') });
    var parsedFragments = rawFragments.slice(0, 100).map(function (fragment) {
      var normalized = normalizeSeatNameFragment(fragment.value, displayedStack);
      var selected = PokerSeatOverlay.exactNameMatch(normalized, displayedName);
      var reason = selected ? 'exact full name from authoritative occupied-seat content' : (!normalized ? 'empty after removing status/badge text' : (/^[-+]?\d[\d,.]*$/.test(normalized) ? 'numeric stack/bet/seat fragment' : 'does not exactly equal selected full player name'));
      return Object.assign({}, fragment, { normalized: normalized, selected: selected, rejectionReason: selected ? null : reason });
    });
    console.log('[HUD NAME PARSE]', { domSeatIdentifier: elementId, rawSeatText: textLines.join(' | '), candidateTextFragments: parsedFragments, selectedName: displayedName || null, rejectedFragments: parsedFragments.filter(function (fragment) { return !fragment.selected; }), reason: playerLinkName ? 'selected exact text from /players/<socket-id> link' : (dataName ? 'selected data-player-name' : (reactName ? 'selected React player name' : 'selected normalized visible name candidate')) });
    var rect = element.getBoundingClientRect();
    var anchorSelection = selectSeatAnchor(element, nameElement, stackElement, displayedName, elementId);
    var anchorElement = anchorSelection.element || nameElement || stackElement || element;
    domSeatAnchorElements.set(elementId, anchorElement);
    var anchorRect = anchorSelection.rect || anchorRectRecord(anchorElement);
    var visualGeometry = resolvePlayerVisualGeometry(element, displayedName, displayedStack) || { source: 'authoritative-seat-fallback', rect: anchorRectRecord(element), reference: anchorElementReference(element, 'authoritative connected seat fallback') };
    var directPlayerIds = [];
    if (directHrefPlayerId) directPlayerIds.push(String(directHrefPlayerId));
    ['data-player-id', 'data-player-uuid', 'data-user-id'].forEach(function (attributeName) { var value = element.getAttribute(attributeName); if (value) directPlayerIds.push(String(value)); });
    Object.keys(reactInfo.relevantValues).forEach(function (path) { var value = String(reactInfo.relevantValues[path]); if (identityDiagnostics.socketPlayers.has(value)) directPlayerIds.push(value); });
    var seatClassMatch = String(element.className || '').match(/(?:^|\s)table-player-(\d+)(?:\s|$)/i);
    var explicitSeatIndex = element.getAttribute('data-seat') || element.getAttribute('data-seat-index') || (seatClassMatch && seatClassMatch[1]) || firstReactValue(reactInfo, /(?:seat|position|seatIndex|seat_index)$/i);
    return {
      elementId: elementId,
      domIndex: domIndex,
      displayedName: displayedName ? String(displayedName).trim().replace(/\s+/g, ' ') : null,
      displayedStack: displayedStack,
      seatIndex: explicitSeatIndex,
      dataAttributes: dataAttributes,
      reactPropKeys: reactInfo.propertyKeys,
      reactRelevantValues: reactInfo.relevantValues,
      directPlayerIds: Array.from(new Set(directPlayerIds)),
      boundingBox: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 },
      anchorBox: { left: anchorRect.left, top: anchorRect.top, width: anchorRect.width, height: anchorRect.height, right: anchorRect.right, bottom: anchorRect.bottom, centerX: anchorRect.left + anchorRect.width / 2 },
      anchorReference: Object.assign({ kind: anchorSelection.kind }, anchorSelection.reference || {}),
      visualAnchorBox: visualGeometry && visualGeometry.rect ? Object.assign({}, visualGeometry.rect) : null,
      visualAnchorSource: visualGeometry && visualGeometry.source || 'authoritative-seat-fallback',
      visualAnchorReference: visualGeometry && visualGeometry.reference || null,
      occupied: Boolean(displayedName && playerLink),
      inactive: /(?:sitting\s*out|sit\s*out|away|offline|disconnected|observer)/i.test(textLines.join(' ')),
      visibleStatus: (textLines.find(function (line) { return /(?:sitting\s*out|sit\s*out|away|offline|disconnected|observer)/i.test(line); }) || 'active/occupied'),
      directText: textLines.slice(0, 8).join(' | ').slice(0, 240)
    };
  }

  function distinctDomSeatCandidates(rawSeats) {
    var seatsByIdentity = new Map();
    var unnamedSeats = [];
    (rawSeats || []).forEach(function (seat) {
      if (!seat.displayedName) { unnamedSeats.push(seat); return; }
      var directIds = Array.from(new Set((seat.directPlayerIds || []).map(String).filter(Boolean))).sort();
      var identityKey = directIds.length
        ? 'player:' + directIds.join('|')
        : (seat.seatIndex !== null && seat.seatIndex !== undefined && String(seat.seatIndex) !== '' ? 'seat:' + String(seat.seatIndex) : 'name:' + seat.displayedName);
      var existing = seatsByIdentity.get(identityKey);
      var score = seat.reactPropKeys.length * 10 + Object.keys(seat.dataAttributes).length * 4 - (seat.boundingBox.width * seat.boundingBox.height / 100000);
      var existingScore = existing ? existing.reactPropKeys.length * 10 + Object.keys(existing.dataAttributes).length * 4 - (existing.boundingBox.width * existing.boundingBox.height / 100000) : -Infinity;
      if (!existing || score > existingScore) seatsByIdentity.set(identityKey, seat);
    });
    return Array.from(seatsByIdentity.values()).concat(unnamedSeats);
  }

  function discoverDomSeats(reason) {
    if (activeOverlayDrag) {
      deferredSeatDiscoveryDuringOverlayDrag = reason || 'seat discovery';
      recordOverlayDragTrace('seat-discovery-deferred', { playerId: activeOverlayDrag.playerId, pointerId: activeOverlayDrag.pointerId, reason: deferredSeatDiscoveryDuringOverlayDrag });
      return identityDiagnostics.domSeats.slice();
    }
    var previousRosterKey = currentTableRosterKey();
    var selector = '[data-seat], [data-seat-index], [data-player-id], [data-player-uuid], [class*="table-player" i], [class*="player-seat" i], [class*="seat-player" i], [class*="player" i], [class~="seat"]';
    var canonicalElements = new Set();
    var elements = Array.from(document.querySelectorAll(selector)).map(canonicalSeatElement).filter(function (element) {
      if (!element || canonicalElements.has(element)) return false;
      canonicalElements.add(element);
      if (element.id === rootId || element.closest('#' + rootId) || element.id === settingsPanelId || element.closest('#' + settingsPanelId) || element.id === trackedPlayersPanelId || element.closest('#' + trackedPlayersPanelId) || element.id === settingsLauncherId || !isVisible(element)) return false;
      var rect = element.getBoundingClientRect();
      return rect.width >= 20 && rect.height >= 15 && rect.width <= 500 && rect.height <= 350;
    });
    var rawSeats = elements.map(domSeatCandidate).filter(function (seat) {
      return seat.displayedName || seat.displayedStack !== null || seat.reactPropKeys.length || Object.keys(seat.dataAttributes).length;
    });
    var seats = distinctDomSeatCandidates(rawSeats);
    seats.forEach(function (seat) { seenDomSeatElementIds.add(seat.elementId); });
    if (seats.length) {
      var centerX = seats.reduce(function (sum, seat) { return sum + seat.boundingBox.centerX; }, 0) / seats.length;
      var centerY = seats.reduce(function (sum, seat) { return sum + seat.boundingBox.centerY; }, 0) / seats.length;
      seats.slice().sort(function (left, right) {
        return Math.atan2(left.boundingBox.centerY - centerY, left.boundingBox.centerX - centerX) - Math.atan2(right.boundingBox.centerY - centerY, right.boundingBox.centerX - centerX);
      }).forEach(function (seat, clockwiseIndex) { seat.clockwiseIndex = clockwiseIndex; });
    }
    identityDiagnostics.domSeats = seats;
    pipelineHealth.domSeatsDiscovered = seenDomSeatElementIds.size;
    seats.forEach(function (seat) {
      var transitionKey = seat.displayedName || seat.elementId;
      var previous = previousDomSeats.get(transitionKey);
      if (previous && typeof previous.displayedStack === 'number' && typeof seat.displayedStack === 'number' && previous.displayedStack !== seat.displayedStack) {
        var transition = { elementId: seat.elementId, displayedName: seat.displayedName, before: previous.displayedStack, after: seat.displayedStack, delta: seat.displayedStack - previous.displayedStack, timestamp: Date.now() };
        identityDiagnostics.domStackTransitions.push(transition);
        if (identityDiagnostics.domStackTransitions.length > 50) identityDiagnostics.domStackTransitions.shift();
        console.log('[HUD MAP] stack transition candidate', { source: 'DOM', transition: transition });
      }
    });
    updateHealthPanel();
    console.log('[HUD MAP] DOM seats discovered', { reason: reason, count: seats.length, seats: seats });
    evaluateMappingCandidates(seats);
    confirmedSeatMappings.forEach(function (mapping, playerId) {
      var currentStillPresent = seats.some(function (seat) { return seat.elementId === mapping.seatElementId; });
      if (currentStillPresent) return;
      var matches = seats.filter(function (seat) { return seat.displayedName === mapping.name; });
      if (matches.length === 1) confirmIdentityMapping(playerId, mapping.name, 'previously confirmed identity reanchored to unique recreated seat', { previousSeatElementId: mapping.seatElementId, reason: reason }, matches[0]);
      else if (!matches.length) console.log('[HUD SEAT OVERLAY] skipped: unconfirmed mapping', { playerId: playerId, name: mapping.name, domSeatIdentifier: mapping.seatElementId, reason: 'previous seat disappeared and no unique matching visible seat exists' });
    });
    pruneDetachedSeatDomState(seats, 'DOM seat discovery: ' + reason);
    scheduleSeatOverlayReconcile('DOM seat discovery: ' + reason);
    publishCurrentTableRosterChange(previousRosterKey, 'DOM seat discovery: ' + reason);
    return seats;
  }

  function inspectSeats(reason) {
    var seats = discoverDomSeats(reason || 'manual inspection');
    seats.forEach(function (seat) {
      console.log('[HUD MAP] seat inspection', {
        domIndex: seat.domIndex,
        displayedName: seat.displayedName,
        displayedStack: seat.displayedStack,
        dataAttributes: seat.dataAttributes,
        reactPropKeys: seat.reactPropKeys,
        reactRelevantPrimitiveValues: seat.reactRelevantValues,
        boundingBox: seat.boundingBox
      });
    });
  }

  function scheduleSeatInspections(eventName) {
    seatInspectionTimers.forEach(clearTimeout);
    seatInspectionTimers = [
      setTimeout(function () { scheduleSeatDiscovery('socket event ' + eventName + ' settled'); }, 120)
    ];
  }

  function recordMappingCandidate(candidate) {
    var key = [candidate.method, candidate.playerId, candidate.seatElementId, candidate.displayedName, candidate.reason, candidate.socketStack, candidate.domStack].join('|');
    if (seenMappingCandidateKeys.has(key)) return false;
    seenMappingCandidateKeys.add(key);
    identityDiagnostics.mappingCandidates.push(candidate);
    if (identityDiagnostics.mappingCandidates.length > 100) identityDiagnostics.mappingCandidates.shift();
    return true;
  }

  function rejectMapping(playerId, seat, method, reason, evidence) {
    var candidate = { accepted: false, method: method, playerId: playerId || null, seatElementId: seat && seat.elementId, displayedName: seat && seat.displayedName, socketStack: evidence && evidence.socketStack, domStack: seat && seat.displayedStack, reason: reason, evidence: evidence || null, timestamp: Date.now() };
    if (!recordMappingCandidate(candidate)) return;
    pipelineHealth.rejectedMappingCandidates += 1;
    updateHealthPanel();
    console.log('[HUD MAP] mapping rejected', candidate);
  }

  function confirmIdentityMapping(playerId, displayedName, method, evidence, seat) {
    var normalizedId = PokerPlayerProfileShadowStore.livePlayerIdentity(playerId);
    var normalizedName = String(displayedName || '').trim();
    if (!normalizedId || !normalizedName) {
      if (!normalizedId) PokerPlayerProfileShadowStore.recordIdentityDiagnostic(playerProfileShadowState, playerId, { source: 'confirmed-seat-mapping' });
      rejectMapping(normalizedId, seat, method, 'missing socket player ID or visible name', evidence);
      return false;
    }
    var strongIdentityEvidence = /(?:direct internal player ID|DOM data attribute contains socket ID|React internal contains exact socket player ID)/i.test(method || '') || (/(?:global one-to-one assignment)/i.test(method || '') && Number(evidence && evidence.score || 0) >= 1000);
    var conflictingId = null;
    socketPlayerNames.forEach(function (knownName, knownId) { if (knownName === normalizedName && knownId !== normalizedId) conflictingId = knownId; });
    if (conflictingId) {
      if (!strongIdentityEvidence) {
        rejectMapping(normalizedId, seat, method, 'visible name is already mapped to a different socket ID', Object.assign({ conflictingId: conflictingId }, evidence || {}));
        return false;
      }
      if (!identityDiagnostics.socketPlayers.has(String(conflictingId))) {
        socketPlayerNames.delete(String(conflictingId));
        removeConfirmedSeatMapping(String(conflictingId), 'stale name-only mapping displaced by direct internal player ID evidence');
        console.log('[HUD MAP DEBUG] rejected conflict', { playerId: String(conflictingId), conflictingCandidate: normalizedId, displayedDomName: normalizedName, accepted: false, rejectionReason: 'stale name-only mapping displaced by direct internal player ID evidence' });
      }
    }
    var existingName = socketPlayerNames.get(normalizedId);
    var confirmedNameChanged = false;
    if (existingName && existingName !== normalizedName) {
      var strongRenameEvidence = strongIdentityEvidence;
      if (!strongRenameEvidence) {
        rejectMapping(normalizedId, seat, method, 'socket ID is already mapped to a different visible name', Object.assign({ existingName: existingName }, evidence || {}));
        return false;
      }
      renameConfirmedPlayer(normalizedId, existingName, normalizedName);
      confirmedNameChanged = true;
    }
    var candidate = { accepted: true, method: method, playerId: normalizedId, seatElementId: seat && seat.elementId, displayedName: normalizedName, reason: 'identity evidence is unique and conflict-free', evidence: evidence || null, timestamp: Date.now() };
    recordMappingCandidate(candidate);
    rememberPlayerMapping(normalizedId, normalizedName, method);
    if (confirmedNameChanged) persistPlayerMappings();
    if (seat && seat.elementId && domSeatElements.get(seat.elementId)) {
      var confirmedElement = domSeatElements.get(seat.elementId);
      var previousMapping = confirmedSeatMappings.get(normalizedId);
      if (previousMapping && previousMapping.seatElement !== confirmedElement) unobserveSeatElement(previousMapping.seatElement || domSeatElements.get(previousMapping.seatElementId));
      confirmedSeatMappings.set(normalizedId, {
        playerId: normalizedId,
        name: normalizedName,
        seatElementId: seat.elementId,
        seatElement: confirmedElement,
        method: method,
        confirmedAt: Date.now()
      });
      observeSeatElement(confirmedElement);
    }
    pipelineHealth.confirmedPlayerMappings = socketPlayerNames.size;
    pipelineHealth.playerMappingsFound = socketPlayerNames.size;
    updateHealthPanel();
    console.log('[HUD MAP] mapping confirmed', candidate);
    scheduleSeatOverlayReconcile('identity mapping confirmed');
    return true;
  }

  function renameConfirmedPlayer(playerId, previousName, nextName) {
    socketPlayerNames.set(String(playerId), nextName);
    var finalizedEventsRenamed = false;
    liveEvents = liveEvents.map(function (event) {
      if (String(event.playerId || '') !== String(playerId) && event.player !== previousName) return event;
      finalizedEventsRenamed = true;
      return Object.assign({}, event, { playerId: String(playerId), player: nextName });
    });
    if (handAccounting) {
      handAccounting.finalizedEvents = liveEvents;
      Object.keys(handAccounting.stagedHands).forEach(function (handId) {
        var hand = handAccounting.stagedHands[handId];
        hand.events = hand.events.map(function (event) {
          return String(event.playerId || '') === String(playerId) || event.player === previousName ? Object.assign({}, event, { playerId: String(playerId), player: nextName }) : event;
        });
        if (hand.participants[previousName]) {
          hand.participants[nextName] = Object.assign({}, hand.participants[previousName], { playerId: String(playerId), name: nextName });
          delete hand.participants[previousName];
        }
      });
    }
    capturedEventSemantics = new Set(liveEvents.concat(handAccounting && PokerHandFinalization.activeHand(handAccounting) ? PokerHandFinalization.activeHand(handAccounting).events : []).map(eventSemanticFingerprint));
    if (finalizedEventsRenamed) advanceFinalizedSessionRevision('stable player identity correction');
    persistHandAccounting();
    refreshShadowProfile(String(playerId), nextName, liveEvents, 'stable-player-rename');
    console.log('[HUD SEAT OVERLAY] updated', { playerId: String(playerId), name: nextName, previousName: previousName, domSeatIdentifier: null, reason: 'strong socket-ID evidence confirmed a display-name change' });
  }

  function deriveVerifiedOrderPairs(players, seats) {
    var orderedPlayers = players.filter(function (player) { return typeof player.orderIndex === 'number'; }).sort(function (left, right) { return left.orderIndex - right.orderIndex; });
    var orderedSeats = seats.filter(function (seat) { return typeof seat.clockwiseIndex === 'number'; }).sort(function (left, right) { return left.clockwiseIndex - right.clockwiseIndex; });
    if (orderedPlayers.length < 2 || orderedPlayers.length !== orderedSeats.length) return [];
    var variants = [];
    [1, -1].forEach(function (orientation) {
      for (var offset = 0; offset < orderedSeats.length; offset += 1) {
        var pairs = orderedPlayers.map(function (player, index) { return { player: player, seat: orderedSeats[(offset + index * orientation + orderedSeats.length * 2) % orderedSeats.length] }; });
        var evidenceScore = pairs.reduce(function (score, pair) {
          if ((pair.seat.directPlayerIds || []).map(String).includes(String(pair.player.playerId))) return score + 100;
          if (pair.player.name && pair.seat.displayedName && pair.player.name.toLowerCase() === pair.seat.displayedName.toLowerCase()) return score + 10;
          if (pair.player.seatIndex !== null && pair.player.seatIndex !== undefined && pair.seat.seatIndex !== null && pair.seat.seatIndex !== undefined && String(pair.player.seatIndex) === String(pair.seat.seatIndex)) return score + 1;
          return score;
        }, 0);
        variants.push({ evidenceScore: evidenceScore, pairs: pairs, signature: pairs.map(function (pair) { return pair.player.playerId + '|' + pair.seat.elementId; }).sort().join(',') });
      }
    });
    variants.sort(function (left, right) { return right.evidenceScore - left.evidenceScore; });
    if (!variants.length || variants[0].evidenceScore <= 0) return [];
    var bestSignatures = Array.from(new Set(variants.filter(function (variant) { return variant.evidenceScore === variants[0].evidenceScore; }).map(function (variant) { return variant.signature; })));
    if (bestSignatures.length !== 1) return [];
    return variants.find(function (variant) { return variant.signature === bestSignatures[0]; }).pairs.map(function (pair) { return pair.player.playerId + '|' + pair.seat.elementId; });
  }

  function preferredAssignedDisplayName(playerName, domName, methods) {
    var socketName = String(playerName || '').trim().replace(/\s+/g, ' ');
    var visibleName = String(domName || '').trim().replace(/\s+/g, ' ');
    if (!socketName) return visibleName;
    if (!visibleName || PokerSeatOverlay.exactNameMatch(socketName, visibleName)) return socketName;
    var corroborated = (methods || []).some(function (method) { return method !== 'stable previous assignment' && method !== 'exact displayed name match'; });
    if (corroborated) return visibleName.length >= socketName.length ? visibleName : socketName;
    return socketName;
  }

  function resolveAssignedSeatAnchor(assignment, fullName) {
    var seat = assignment.seat;
    var element = domSeatElements.get(seat.elementId);
    if (!element || !element.isConnected) return null;
    var strongAssignment = assignment.methods.some(function (method) { return ['direct internal player ID', 'verified seat index/order', 'verified socket/clockwise order', 'synchronized stack transition'].includes(method); });
    var playerLink = element.querySelector('a[href^="/players/"]');
    var visibleLinkName = playerLink ? elementVisibleText(playerLink) : null;
    var exactNameElement = PokerSeatOverlay.exactNameMatch(elementVisibleText(element), fullName) ? element : findExactTextElement(element, fullName);
    if (!exactNameElement && strongAssignment && playerLink) exactNameElement = playerLink.closest('.table-player-name') || playerLink;
    var targetVisibleStack = typeof seat.displayedStack === 'number' ? seat.displayedStack : assignment.player.stack;
    var stackCandidates = Array.from(element.querySelectorAll('[data-stack], [data-chips], [class*="stack" i], [class*="chips" i]')).filter(function (candidate) {
      if (isActionMarkerElement(candidate) || !validAnchorRect(candidate.getBoundingClientRect())) return false;
      return typeof targetVisibleStack !== 'number' || parseVisibleNumber(candidate.getAttribute('data-stack') || candidate.getAttribute('data-chips') || candidate.textContent) === targetVisibleStack;
    });
    var exactStackElement = stackCandidates[0] || null;
    var anchorName = exactNameElement && visibleLinkName && strongAssignment ? visibleLinkName : fullName;
    var selected = selectSeatAnchor(element, exactNameElement, exactStackElement, anchorName, seat.elementId, !strongAssignment);
    if (!selected) return null;
    seat.anchorBox = selected.rect;
    seat.anchorReference = Object.assign({ kind: selected.kind }, selected.reference || {});
    seat.assignedFullName = fullName;
    seat.anchorAssignmentStrength = strongAssignment ? 'strong corroborated seat assignment' : 'exact full-name assignment';
    var visualGeometry = resolvePlayerVisualGeometry(element, fullName, targetVisibleStack);
    seat.visualAnchorBox = visualGeometry && visualGeometry.rect ? Object.assign({}, visualGeometry.rect) : anchorRectRecord(element);
    seat.visualAnchorSource = visualGeometry && visualGeometry.source || 'authoritative-seat-fallback';
    seat.visualAnchorReference = visualGeometry && visualGeometry.reference || anchorElementReference(element, 'authoritative connected seat fallback');
    domSeatAnchorElements.set(seat.elementId, selected.element || exactNameElement || element);
    return selected;
  }

  function evaluateGlobalMappingCandidates(seats) {
    var socketRecords = Array.from(identityDiagnostics.socketPlayers.values()).map(function (record) {
      return Object.assign({}, record, { name: socketPlayerNames.get(String(record.playerId)) || null });
    });
    var now = Date.now();
    var recentSocket = identityDiagnostics.socketStackTransitions.filter(function (transition) { return transition.timestamp >= now - 3000; });
    var recentDom = identityDiagnostics.domStackTransitions.filter(function (transition) { return transition.timestamp >= now - 3000; });
    var transitionPairs = [];
    recentSocket.forEach(function (socketTransition) {
      var sameSocketDelta = recentSocket.filter(function (candidate) { return candidate.delta === socketTransition.delta; });
      var sameDomDelta = recentDom.filter(function (candidate) { return candidate.delta === socketTransition.delta; });
      if (sameSocketDelta.length === 1 && sameDomDelta.length === 1) transitionPairs.push(socketTransition.playerId + '|' + sameDomDelta[0].elementId);
    });
    var previousAssignments = {};
    confirmedSeatMappings.forEach(function (mapping, playerId) { previousAssignments[String(playerId)] = mapping.seatElementId; });
    var orderPairs = deriveVerifiedOrderPairs(socketRecords, seats);
    socketRecords.forEach(function (player) {
      console.log('[HUD MAP DEBUG] socket player', {
        playerId: player.playerId,
        fullMappedName: player.name,
        socketSeatOrder: { seatIndex: player.seatIndex, orderIndex: player.orderIndex },
        socketStack: player.stack,
        visibleSeatCount: seats.length
      });
    });
    seats.forEach(function (seat) {
      console.log('[HUD MAP DEBUG] DOM seat', { domSeatIdentifier: seat.elementId, fullVisibleDomName: seat.displayedName, displayedStack: seat.displayedStack, occupied: seat.occupied, visibleStatus: seat.visibleStatus, domSeatOrder: { seatIndex: seat.seatIndex, clockwiseIndex: seat.clockwiseIndex }, directPlayerIds: seat.directPlayerIds, anchorReference: seat.anchorReference, boundingRectangle: seat.boundingBox });
    });
    var result = PokerSeatOverlay.assignPlayersToSeats(socketRecords, seats, { transitionPairs: transitionPairs, orderPairs: orderPairs, previousAssignments: previousAssignments });
    var assignmentByPlayer = new Map(result.assignments.map(function (assignment) { return [String(assignment.player.playerId), assignment]; }));
    var withheld = [];
    result.comparisons.forEach(function (comparison) {
      var player = socketRecords.find(function (candidate) { return String(candidate.playerId) === comparison.playerId; });
      var seat = seats.find(function (candidate) { return String(candidate.elementId) === comparison.seatElementId; });
      var selected = assignmentByPlayer.get(comparison.playerId);
      var accepted = Boolean(selected && selected.seat.elementId === comparison.seatElementId);
      var diagnostic = {
        playerId: comparison.playerId,
        socketPlayerName: player && player.name || null,
        domSeatIdentifier: comparison.seatElementId,
        rawDomText: seat && seat.directText || null,
        extractedFullName: seat && seat.displayedName || null,
        extractedStack: seat && seat.displayedStack,
        playerStatus: seat && seat.visibleStatus || null,
        socketStack: player && player.stack,
        socketSeatOrder: player ? { seatIndex: player.seatIndex, orderIndex: player.orderIndex } : null,
        domClockwiseOrder: seat && seat.clockwiseIndex,
        allPairingEvidence: comparison.methods,
        totalScore: comparison.score,
        qualified: comparison.qualified,
        accepted: accepted,
        rejected: !accepted,
        rejectionReason: accepted ? null : (comparison.rejectionReason || (comparison.score ? 'a different pairing produced the globally optimal one-to-one assignment' : 'no corroborating identity, order, transition, or unique-stack evidence')),
        conflictingCandidate: !accepted && selected ? selected.seat.elementId : null
      };
      recordMappingCandidate(Object.assign({ method: 'global one-to-one assignment', seatElementId: comparison.seatElementId, displayedName: seat && seat.displayedName, reason: diagnostic.rejectionReason || 'globally selected pairing', timestamp: Date.now() }, diagnostic));
      console.log('[HUD MAP DEBUG] pairing score', diagnostic);
      if (!accepted && comparison.score > 0) console.log('[HUD MAP DEBUG] assignment rejected', diagnostic);
    });
    result.rejected.forEach(function (rejection) {
      console.log('[HUD MAP DEBUG] assignment rejected', Object.assign({ accepted: false }, rejection));
      rejectMapping(rejection.playerId, null, 'global one-to-one assignment', rejection.reason, { conflictingCandidates: rejection.conflictingCandidates, optimalAssignmentCount: result.optimalAssignmentCount });
      var player = socketRecords.find(function (candidate) { return String(candidate.playerId) === String(rejection.playerId); });
      var bestComparison = result.comparisons.filter(function (comparison) { return comparison.playerId === String(rejection.playerId); }).sort(function (left, right) { return right.score - left.score; })[0] || null;
      var bestSeat = bestComparison && seats.find(function (seat) { return String(seat.elementId) === bestComparison.seatElementId; });
      withheld.push({ playerId: String(rejection.playerId), playerName: player && player.name || String(rejection.playerId), reason: bestComparison && bestComparison.rejectionReason || rejection.reason, seatId: bestSeat && bestSeat.elementId || null, rect: bestSeat && (bestSeat.anchorBox || bestSeat.boundingBox) || null });
    });
    var assignedPlayerIds = new Set();
    result.assignments.forEach(function (assignment) {
      var playerId = String(assignment.player.playerId);
      var fullName = preferredAssignedDisplayName(assignment.player.name, assignment.seat.displayedName, assignment.methods);
      var selectedAnchor = resolveAssignedSeatAnchor(assignment, fullName);
      if (!selectedAnchor) {
        var anchorReason = 'assigned seat has no safe name, stack, or occupied-seat anchor';
        console.log('[HUD MAP DEBUG] assignment rejected', { playerId: playerId, fullMappedName: fullName, fullVisibleDomName: assignment.seat.displayedName, domSeatIdentifier: assignment.seat.elementId, accepted: false, score: assignment.score, evidenceUsed: assignment.methods, rejectionReason: anchorReason });
        withheld.push({ playerId: playerId, playerName: fullName, reason: anchorReason, seatId: assignment.seat.elementId, rect: assignment.seat.anchorBox || assignment.seat.boundingBox || null });
        return;
      }
      var method = 'global one-to-one assignment: ' + assignment.methods.join(', ');
      var accepted = confirmIdentityMapping(playerId, fullName, method, { score: assignment.score, methods: assignment.methods, socketSeatOrder: { seatIndex: assignment.player.seatIndex, orderIndex: assignment.player.orderIndex }, domClockwiseOrder: assignment.seat.clockwiseIndex }, assignment.seat);
      if (accepted) assignedPlayerIds.add(playerId);
      else withheld.push({ playerId: playerId, playerName: fullName, reason: 'confirmation contract rejected the globally selected pair', seatId: assignment.seat.elementId, rect: assignment.seat.anchorBox || assignment.seat.boundingBox || null });
      console.log('[HUD MAP DEBUG] final assignment', { playerId: playerId, fullMappedName: fullName, fullVisibleDomName: assignment.seat.displayedName, domSeatIdentifier: assignment.seat.elementId, displayedStack: assignment.seat.displayedStack, socketStack: assignment.player.stack, socketSeatOrder: { seatIndex: assignment.player.seatIndex, orderIndex: assignment.player.orderIndex }, domSeatOrder: assignment.seat.clockwiseIndex, evidenceUsed: assignment.methods, score: assignment.score, selectedAnchor: assignment.seat.anchorReference, accepted: accepted, rejectionReason: accepted ? null : 'confirmation contract rejected the globally selected pair' });
    });
    confirmedSeatMappings.forEach(function (mapping, playerId) {
      if (!identityDiagnostics.socketPlayers.has(String(playerId)) || assignedPlayerIds.has(String(playerId))) return;
      removeConfirmedSeatMapping(String(playerId), 'player was not part of the current globally optimal visible-seat assignment');
      console.log('[HUD MAP DEBUG] final assignment', { playerId: String(playerId), mappedPlayerName: mapping.name, domSeatIdentifier: mapping.seatElementId, accepted: false, rejectionReason: 'player was not part of the current globally optimal visible-seat assignment' });
    });
    var reasonCounts = {};
    withheld.forEach(function (item) {
      reasonCounts[item.reason] = (reasonCounts[item.reason] || 0) + 1;
      console.log('[HUD MAP DEBUG] overlay withheld', { playerId: item.playerId, playerName: item.playerName, domSeatIdentifier: item.seatId, exactRejectionReason: item.reason, bestCandidateRect: item.rect });
    });
    withheldOverlayDiagnostics = withheld;
    pipelineHealth.visibleSocketPlayers = socketRecords.filter(function (player) { return result.comparisons.some(function (comparison) { return comparison.playerId === String(player.playerId) && comparison.score > 0; }); }).length;
    pipelineHealth.visibleOccupiedSeats = seats.filter(function (seat) { return seat.occupied !== false; }).length;
    pipelineHealth.successfulAssignments = assignedPlayerIds.size;
    pipelineHealth.assignmentsWithheld = withheld.length;
    pipelineHealth.topMappingRejectionReason = Object.keys(reasonCounts).sort(function (left, right) { return reasonCounts[right] - reasonCounts[left]; })[0] || 'none';
    console.log('[HUD MAP DEBUG] assignment summary', { visibleSocketPlayers: pipelineHealth.visibleSocketPlayers, visibleOccupiedSeats: pipelineHealth.visibleOccupiedSeats, successfulAssignments: pipelineHealth.successfulAssignments, assignmentsWithheld: pipelineHealth.assignmentsWithheld, topRejectionReason: pipelineHealth.topMappingRejectionReason, assignments: Array.from(assignedPlayerIds), withheld: withheld });
    pipelineHealth.confirmedMappedPlayers = confirmedSeatMappings.size;
    updateHealthPanel();
  }

  function evaluateMappingCandidates(seats) {
    evaluateGlobalMappingCandidates(seats);
    return;
    var socketRecords = Array.from(identityDiagnostics.socketPlayers.values());
    var knownSocketIds = new Set(socketRecords.map(function (record) { return record.playerId; }));
    seats.forEach(function (seat) {
      var explicitDomId = seat.dataAttributes['data-player-id'] || seat.dataAttributes['data-player-uuid'] || seat.dataAttributes['data-user-id'];
      if (explicitDomId && knownSocketIds.has(String(explicitDomId))) {
        if (seat.displayedName) confirmIdentityMapping(explicitDomId, seat.displayedName, 'DOM data attribute contains socket ID', { dataAttributes: seat.dataAttributes }, seat);
        else rejectMapping(explicitDomId, seat, 'DOM data attribute contains socket ID', 'seat has no reliable visible name', { dataAttributes: seat.dataAttributes });
      }
      Object.keys(seat.reactRelevantValues).forEach(function (path) {
        var value = String(seat.reactRelevantValues[path]);
        if (!knownSocketIds.has(value)) return;
        console.log('[HUD MAP] React identity candidate', { playerId: value, seat: seat, reactPath: path });
        if (seat.displayedName) confirmIdentityMapping(value, seat.displayedName, 'React internal contains exact socket player ID', { reactPath: path, reactValue: seat.reactRelevantValues[path] }, seat);
        else rejectMapping(value, seat, 'React internal contains exact socket player ID', 'React ID matched but visible name was not found', { reactPath: path });
      });
    });

    socketPlayerNames.forEach(function (confirmedName, playerId) {
      var nameMatches = seats.filter(function (seat) { return seat.displayedName === confirmedName; });
      if (nameMatches.length === 1) {
        confirmIdentityMapping(playerId, confirmedName, 'confirmed player ID/name matched one unique visible seat', { confirmedName: confirmedName, visibleMatchCount: 1 }, nameMatches[0]);
      } else if (nameMatches.length > 1) {
        rejectMapping(playerId, nameMatches[0], 'confirmed player ID/name visible-seat reconciliation', 'multiple visible seats share the confirmed player name', { confirmedName: confirmedName, visibleMatchCount: nameMatches.length });
      }
    });

    socketRecords.forEach(function (record) {
      if (typeof record.stack !== 'number') return;
      var socketMatches = socketRecords.filter(function (candidate) { return candidate.stack === record.stack; });
      var domMatches = seats.filter(function (seat) { return seat.displayedStack === record.stack && seat.displayedName; });
      if (socketMatches.length === 1 && domMatches.length === 1) {
        confirmIdentityMapping(record.playerId, domMatches[0].displayedName, 'unique visible stack match', { socketStack: record.stack, socketPlayerId: record.playerId }, domMatches[0]);
      } else if (domMatches.length || socketMatches.length > 1) {
        rejectMapping(record.playerId, domMatches[0] || null, 'visible stack match', 'stack value is not unique on both socket and DOM sides', { socketStack: record.stack, socketMatchCount: socketMatches.length, domMatchCount: domMatches.length });
      }
    });

    socketRecords.forEach(function (record) {
      if (record.seatIndex === null || record.seatIndex === undefined) return;
      var matches = seats.filter(function (seat) { return seat.seatIndex !== null && seat.seatIndex !== undefined && String(seat.seatIndex) === String(record.seatIndex) && seat.displayedName; });
      if (matches.length === 1) confirmIdentityMapping(record.playerId, matches[0].displayedName, 'explicit seat position match', { socketSeatIndex: record.seatIndex, domSeatIndex: matches[0].seatIndex }, matches[0]);
      else if (matches.length > 1) rejectMapping(record.playerId, matches[0], 'explicit seat position match', 'multiple DOM seats share the same seat index', { seatIndex: record.seatIndex, matchCount: matches.length });
    });

    var orderedSocketPlayers = socketRecords.filter(function (record) { return typeof record.orderIndex === 'number'; }).sort(function (left, right) { return left.orderIndex - right.orderIndex; });
    var clockwiseDomSeats = seats.filter(function (seat) { return typeof seat.clockwiseIndex === 'number' && seat.displayedName; }).sort(function (left, right) { return left.clockwiseIndex - right.clockwiseIndex; });
    if (orderedSocketPlayers.length >= 2 && orderedSocketPlayers.length === clockwiseDomSeats.length) {
      var anchors = [];
      orderedSocketPlayers.forEach(function (record, socketIndex) {
        var knownName = socketPlayerNames.get(record.playerId);
        if (!knownName) return;
        var domIndex = clockwiseDomSeats.findIndex(function (seat) { return seat.displayedName === knownName; });
        if (domIndex >= 0) anchors.push({ socketIndex: socketIndex, domIndex: domIndex, playerId: record.playerId, name: knownName });
      });
      if (anchors.length >= 2) {
        var anchor = anchors[0];
        var secondAnchor = anchors[1];
        var socketDelta = (secondAnchor.socketIndex - anchor.socketIndex + orderedSocketPlayers.length) % orderedSocketPlayers.length;
        var domDelta = (secondAnchor.domIndex - anchor.domIndex + clockwiseDomSeats.length) % clockwiseDomSeats.length;
        var orientation = domDelta === socketDelta ? 1 : (domDelta === (orderedSocketPlayers.length - socketDelta) % orderedSocketPlayers.length ? -1 : 0);
        if (!orientation) rejectMapping(null, null, 'socket order to clockwise DOM order', 'confirmed anchors disagree with both clockwise and counterclockwise ordering', { anchors: anchors });
        else orderedSocketPlayers.forEach(function (record, socketIndex) {
          var offset = (socketIndex - anchor.socketIndex) * orientation;
          var seat = clockwiseDomSeats[(anchor.domIndex + offset + clockwiseDomSeats.length) % clockwiseDomSeats.length];
          confirmIdentityMapping(record.playerId, seat.displayedName, 'anchored socket order to clockwise DOM order', { anchors: anchors.slice(0, 2), orientation: orientation, socketOrderIndex: record.orderIndex, clockwiseDomIndex: seat.clockwiseIndex }, seat);
        });
      } else {
        rejectMapping(null, null, 'socket order to clockwise DOM order', 'ordering cannot be trusted until two player identities provide orientation anchors', { anchors: anchors, socketOrder: orderedSocketPlayers.map(function (record) { return record.playerId; }), clockwiseDomNames: clockwiseDomSeats.map(function (seat) { return seat.displayedName; }) });
      }
    } else if (orderedSocketPlayers.length || clockwiseDomSeats.length) {
      rejectMapping(null, null, 'socket order to clockwise DOM order', 'socket and DOM seat counts do not match', { socketCount: orderedSocketPlayers.length, domCount: clockwiseDomSeats.length });
    }

    var recentCutoff = Date.now() - 3000;
    var socketTransitions = identityDiagnostics.socketStackTransitions.filter(function (transition) { return transition.timestamp >= recentCutoff; });
    var domTransitions = identityDiagnostics.domStackTransitions.filter(function (transition) { return transition.timestamp >= recentCutoff && transition.displayedName; });
    socketTransitions.forEach(function (socketTransition) {
      var matchingSocket = socketTransitions.filter(function (candidate) { return candidate.delta === socketTransition.delta; });
      var matchingDom = domTransitions.filter(function (candidate) { return candidate.delta === socketTransition.delta; });
      console.log('[HUD MAP] stack transition candidate', { socketTransition: socketTransition, matchingSocketCount: matchingSocket.length, matchingDomTransitions: matchingDom });
      if (matchingSocket.length === 1 && matchingDom.length === 1) {
        var seat = seats.find(function (candidate) { return candidate.elementId === matchingDom[0].elementId || candidate.displayedName === matchingDom[0].displayedName; });
        confirmIdentityMapping(socketTransition.playerId, matchingDom[0].displayedName, 'unique synchronized stack transition', { socketTransition: socketTransition, domTransition: matchingDom[0] }, seat || null);
      } else if (matchingDom.length) {
        rejectMapping(socketTransition.playerId, null, 'stack transition match', 'stack delta is not unique on both socket and DOM sides', { socketTransition: socketTransition, socketMatchCount: matchingSocket.length, domMatchCount: matchingDom.length });
      }
    });
  }

  function updateHandAccountingHealth() {
    activeHandState = handAccounting ? PokerHandFinalization.activeHand(handAccounting) : null;
    if (handAccounting) liveEvents = handAccounting.finalizedEvents;
    pipelineHealth.activeStagedEvents = activeHandState ? activeHandState.events.length : 0;
    pipelineHealth.finalizedHands = handAccounting ? handAccounting.finalizedHandIds.size : new Set(liveEvents.map(function (event) { return String(event.handId); })).size;
    pipelineHealth.finalizedStatsEvents = liveEvents.length;
    pipelineHealth.statsEventsStored = liveEvents.length;
    updateHealthPanel();
  }

  function persistHostControlState(callback) {
    if (!ownsRuntimeController()) return;
    var update = {};
    update[STORAGE_KEYS.hostControl] = PokerHostControlTrace.persistentSnapshot(hostControlTraceState);
    chrome.storage.local.set(update, function () {
      var storageError = chrome.runtime && chrome.runtime.lastError
        ? new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError))
        : null;
      if (typeof callback === 'function') callback(storageError);
    });
  }

  function serializedActiveHandWithSemanticShadow() {
    var serialized = handAccounting ? PokerHandFinalization.serializeActiveHand(handAccounting) : null;
    if (!serialized) return null;
    var semanticSnapshot = PokerSemanticHandLedger.activeHandSnapshot(semanticLedgerState, serialized.handId);
    if (semanticSnapshot) serialized.semanticHandLedgerSnapshot = semanticSnapshot;
    return serialized;
  }

  function writeAuthoritativeStorageSnapshot(update, revision, callback) {
    if (!ownsRuntimeController()) { callback(new Error("superseded content controller")); return; }
    Object.keys(careerPendingStorageUpdates).forEach(function (key) { update[key] = careerPendingStorageUpdates[key]; });
    update[STORAGE_KEYS.liveRevision] = revision;
    chrome.storage.local.set(update, function () {
      var storageError = chrome.runtime && chrome.runtime.lastError
        ? new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError))
        : null;
      if (!storageError) {
        Object.keys(update).filter(function (key) { return key.indexOf('pokerNowHudCareerV1:') === 0; }).forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(careerPendingStorageUpdates, key) &&
              JSON.stringify(careerPendingStorageUpdates[key]) === JSON.stringify(update[key])) delete careerPendingStorageUpdates[key];
        });
      }
      if (typeof callback === 'function') callback(storageError);
    });
  }

  function queueAuthoritativeStorageSnapshot(update, callback) {
    return authoritativePersistenceQueue.enqueue(update, callback);
  }

  function advanceFinalizedSessionRevision(reason) {
    finalizedSessionRevision = PokerSessionStatsCache.advance(sessionStatsCache, reason || 'authoritative finalized-session data changed');
    return finalizedSessionRevision;
  }

  function cachedSessionPlayerStats(playerId, playerName) {
    var stableId = playerId === null || playerId === undefined || String(playerId) === '' ? 'legacy-name:' + String(playerName || '') : String(playerId);
    return PokerSessionStatsCache.get(sessionStatsCache, {
      kind: 'exact-player-stats', playerId: stableId, playerName: String(playerName || '')
    }, function () {
      return PokerStats.computePlayerStatsByIdentity(liveEvents, playerId, playerName);
    });
  }

  function currentLeaderboardStatSource() {
    return hudUiPreferences.leaderboardStatSource === 'career' ? 'career' : 'session';
  }

  function updateLeaderboardSource(source) {
    if (updateHudUiPreferences({ leaderboardStatSource: source }, 'leaderboard-stat-source')) refreshHud();
  }

  function clearLeaderboardCareerStats() {
    leaderboardCareerRequestToken += 1;
    leaderboardCareerSignature = '';
    leaderboardCareerSnapshotSignature = '';
    leaderboardCareerFailedSignature = '';
    leaderboardCareerStatsByPlayer.clear();
  }

  function invalidateLeaderboardCareerRequest() {
    leaderboardCareerRequestToken += 1;
    leaderboardCareerSignature = '';
    leaderboardCareerFailedSignature = '';
  }

  function leaderboardCareerIds(data) {
    return Array.from(new Set(data.playerEntries.map(function (entry) { return entry.playerId; }).filter(function (id) {
      return id !== null && id !== undefined && String(id) !== '';
    }).map(String))).sort();
  }

  function leaderboardCareerKey(ids) {
    return JSON.stringify([pokerNowGameId, ids]);
  }

  function requestLeaderboardCareerBatch(data) {
    if (!leaderboardVisible() || currentLeaderboardStatSource() !== 'career') return;
    var ids = leaderboardCareerIds(data);
    var signature = leaderboardCareerKey(ids);
    // One signature covers pending and settled requests, including missing/error results.
    if (signature === leaderboardCareerSignature) return;
    invalidateLeaderboardCareerRequest();
    if (leaderboardCareerSnapshotSignature !== signature) {
      leaderboardCareerSnapshotSignature = '';
      leaderboardCareerStatsByPlayer.clear();
    }
    leaderboardCareerSignature = signature;
    if (!ids.length) {
      leaderboardCareerFailedSignature = signature;
      return;
    }
    var token = leaderboardCareerRequestToken;
    function stillCurrent() {
      return ownsRuntimeController() && token === leaderboardCareerRequestToken && leaderboardVisible() && currentLeaderboardStatSource() === 'career' &&
        signature === leaderboardCareerKey(leaderboardCareerIds(displayData({})));
    }
    // The existing HUD message interface accepts at most 64 IDs. Long table Sessions
    // can retain more participants; keep those rows without silently truncating them.
    var batches = [];
    for (var index = 0; index < ids.length; index += 64) batches.push(careerHudBatchFromCurrentBackend(ids.slice(index, index + 64)));
    Promise.all(batches).then(function (results) {
      if (!stillCurrent()) return;
      var players = Object.assign.apply(Object, [{}].concat(results.map(function (result) { return result && result.players || {}; })));
      leaderboardCareerStatsByPlayer = new Map(ids.map(function (id) {
        return [id, Object.prototype.hasOwnProperty.call(players, id) ? players[id] : null];
      }));
      leaderboardCareerSnapshotSignature = signature;
      leaderboardCareerFailedSignature = '';
      refreshHud();
    }).catch(function (error) {
      if (!stillCurrent()) return;
      leaderboardCareerFailedSignature = signature;
      refreshHud();
      console.warn('[HUD LEADERBOARD SOURCE] Career batch unavailable; unavailable state retained', error);
    });
  }

  function invalidateLeaderboardCareerStats(playerIds, reason, clearSettledPresentation) {
    invalidateTrackedPlayers(playerIds, reason, clearSettledPresentation);
    if (playerDashboardState.open && playerDashboardState.mode === 'career' && (!playerIds || playerIds.some(function (id) { return String(id) === playerDashboardState.playerId; }))) loadPlayerDashboardCareer();
    if (playerIds) {
      var relevantIds = new Set(leaderboardCareerIds(displayData({})));
      if (!playerIds.some(function (id) { return relevantIds.has(String(id)); })) return;
    }
    if (clearSettledPresentation) clearLeaderboardCareerStats();
    else invalidateLeaderboardCareerRequest();
    if (leaderboardVisible() && currentLeaderboardStatSource() === 'career') refreshHud();
  }

  function leaderboardRows(data) {
    // Invalidate identity even while Session is selected, so a roster that leaves
    // and later returns cannot resurrect a snapshot from an earlier context.
    if (leaderboardCareerSnapshotSignature && leaderboardCareerSnapshotSignature !== leaderboardCareerKey(leaderboardCareerIds(data))) clearLeaderboardCareerStats();
    if (currentLeaderboardStatSource() === 'career') {
      requestLeaderboardCareerBatch(data);
      var signature = leaderboardCareerKey(leaderboardCareerIds(data));
      var snapshotMatches = leaderboardCareerSnapshotSignature === signature;
      var entries = data.realPage ? data.playerEntries : data.players.map(function (name) { return { playerId: null, playerName: name }; });
      return entries.map(function (entry) {
        var careerStats = !snapshotMatches || entry.playerId === null || entry.playerId === undefined ? null : leaderboardCareerStatsByPlayer.get(String(entry.playerId));
        return Object.assign(PokerSeatOverlay.careerStatsToOverlayStats(careerStats || null), {
          playerId: entry.playerId, player: entry.playerName,
          careerPending: !snapshotMatches && leaderboardCareerFailedSignature !== signature,
          careerUnavailable: !snapshotMatches && leaderboardCareerFailedSignature === signature
        });
      });
    }
    return data.realPage ? data.playerEntries.map(function (entry) {
      return cachedSessionPlayerStats(entry.playerId, entry.playerName);
    }) : data.players.map(function (player) {
      return PokerStats.computePlayerStats(data.events, player);
    });
  }

  function currentSeatHudStatSource() {
    return PokerSeatOverlay.normalizeStatSource(hudUiPreferences && hudUiPreferences.seatHudStatSource);
  }

  function seatHudStatsForPlayer(playerId, playerName) {
    if (currentSeatHudStatSource() !== 'career') return cachedSessionPlayerStats(playerId, playerName);
    return PokerSeatOverlay.careerStatsToOverlayStats(seatHudCareerStatsByPlayer.get(String(playerId)) || null);
  }

  function careerHudBatchFromCurrentBackend(playerIds) {
    if (careerIndexedService && typeof careerIndexedService.careerHudStats === 'function') return careerIndexedService.careerHudStats(playerIds);
    if (careerStoreState) {
      var players = {};
      playerIds.forEach(function (playerId) { players[playerId] = PokerCareerContributionStore.playerStats(careerStoreState, playerId) || null; });
      return Promise.resolve({ players: players, query: { batched: true, backend: 'phase-one-memory-fallback', requestedCount: playerIds.length, uniquePlayerCount: playerIds.length, runtimeMessages: 0 } });
    }
    return Promise.resolve({ players: {}, query: { batched: true, backend: 'unavailable', requestedCount: playerIds.length, uniquePlayerCount: playerIds.length, runtimeMessages: 0 } });
  }

  function requestSeatHudCareerBatch(playerIds, reason, force) {
    var ids = Array.from(new Set((playerIds || []).map(String).filter(Boolean))).sort();
    var signature = ids.join('|');
    if (currentSeatHudStatSource() !== 'career') return Promise.resolve(false);
    if (!force && (signature === seatHudCareerLoadedSignature || signature === seatHudCareerPendingSignature)) return Promise.resolve(false);
    var token = ++seatHudCareerRequestToken;
    seatHudCareerPendingSignature = signature;
    seatHudCareerQueryDiagnostics.batchRequests += 1;
    seatHudCareerQueryDiagnostics.lastRequestedPlayerIds = ids.slice();
    seatHudCareerQueryDiagnostics.lastError = null;
    seatHudCareerQueryDiagnostics.loading = true;
    return careerHudBatchFromCurrentBackend(ids).then(function (result) {
      if (token !== seatHudCareerRequestToken || currentSeatHudStatSource() !== 'career') return false;
      var players = result && result.players && typeof result.players === 'object' ? result.players : {};
      seatHudCareerStatsByPlayer = new Map(ids.map(function (playerId) { return [playerId, players[playerId] || null]; }));
      seatHudCareerLoadedSignature = signature;
      seatHudCareerPendingSignature = '';
      seatHudCareerQueryDiagnostics.lastResultPlayerCount = Object.keys(players).length;
      seatHudCareerQueryDiagnostics.lastQuery = cloneJson(result && result.query || null);
      seatHudCareerQueryDiagnostics.loading = false;
      scheduleSeatOverlayReconcile('batched Career seat HUD aggregates loaded: ' + String(reason || 'request'));
      return true;
    }).catch(function (error) {
      if (token !== seatHudCareerRequestToken) return false;
      seatHudCareerLoadedSignature = signature;
      seatHudCareerPendingSignature = '';
      seatHudCareerQueryDiagnostics.lastError = String(error && error.message || error);
      seatHudCareerQueryDiagnostics.loading = false;
      console.warn('[HUD SEAT SOURCE] Career batch unavailable; zero-sample placeholders retained', { reason: reason || null, error: seatHudCareerQueryDiagnostics.lastError });
      scheduleSeatOverlayReconcile('Career seat HUD aggregate request failed');
      return false;
    });
  }

  function invalidateSeatHudCareerStats(playerIds, reason, clearSettledPresentation) {
    invalidateLeaderboardCareerStats(playerIds, reason, clearSettledPresentation);
    if (playerIds) playerIds.map(String).forEach(function (playerId) { seatHudCareerStatsByPlayer.delete(playerId); });
    else seatHudCareerStatsByPlayer.clear();
    seatHudCareerLoadedSignature = '';
    seatHudCareerPendingSignature = '';
    seatHudCareerRequestToken += 1;
    if (currentSeatHudStatSource() === 'career') requestSeatHudCareerBatch(Array.from(confirmedSeatMappings.keys()), reason || 'Career aggregate invalidated', true);
  }

  function cachedSessionFilteredStats(playerId, filters) {
    var normalized = PokerFilteredStats.normalizeFilters(filters || {});
    return PokerSessionStatsCache.get(sessionStatsCache, {
      kind: 'filtered-player-stats', playerId: String(playerId), filters: normalized
    }, function () {
      return PokerFilteredStats.sessionStatsFiltered(liveEvents, playerId, normalized);
    });
  }

  function runtimePerformanceInfo() {
    var binary = pendingBinaryQueue.inspect();
    return {
      finalizedSessionRevision: finalizedSessionRevision,
      sessionStatsCache: PokerSessionStatsCache.inspect(sessionStatsCache),
      persistenceCadence: PokerSessionRuntime.inspectPersistence(sessionPersistencePlanner),
      runtimeCounts: {
        bodyMutationObserverCallbacks: pipelineHealth.bodyMutationObserverCallbacks,
        fullLogDiscoveryCallbacks: pipelineHealth.fullLogDiscoveryCallbacks,
        seatDiscoveryRequests: pipelineHealth.seatDiscoveryRequests,
        seatDiscoveryExecutions: pipelineHealth.seatDiscoveryExecutions,
        seatResizeObserverCallbacks: pipelineHealth.seatResizeObserverCallbacks,
        seatOverlayReconciles: pipelineHealth.seatOverlayReconciles,
        hudRefreshRequests: pipelineHealth.hudRefreshRequests,
        leaderboardRenderCount: pipelineHealth.leaderboardRenderCount,
        stagedStatRenderSkips: pipelineHealth.stagedStatRenderSkips
      },
      collections: {
        processedFrameFingerprints: processedFrameFingerprints.inspect(),
        walkTraceEmittedHandIds: walkTraceEmittedHandIds.inspect(),
        mappingCandidateKeys: seenMappingCandidateKeys.inspect(),
        overlayPlacementFailureKeys: overlayPlacementFailureKeys.inspect(),
        capturedFingerprints: Object.assign(capturedFingerprints.inspect(), { policy: 'bounded recent raw-line accelerator; the exact retained-event semantic set remains the correctness backstop after eviction' }),
        capturedEventSemantics: { size: capturedEventSemantics.size, policy: 'correctness-critical; exactly mirrors retained finalized plus active events' },
        finalizedHandIds: { size: handAccounting ? handAccounting.finalizedHandIds.size : 0, policy: 'correctness-critical; proportional to retained finalized Session history and reset only at authoritative Session/table boundary' },
        socketHandSignatures: { size: socketHandSignatures.size, policy: 'correctness-critical boundary dedupe; proportional to retained Session hands and reset at Session/table boundary' },
        reducerIdentitySets: {
          semanticFinalizedHands: semanticLedgerState && semanticLedgerState.finalizedHandIds ? semanticLedgerState.finalizedHandIds.size : 0,
          preflopReducedHands: preflopOpportunityState && preflopOpportunityState.reducedHandIds ? preflopOpportunityState.reducedHandIds.size : 0,
          flopCBetReducedHands: flopCBetOpportunityState && flopCBetOpportunityState.reducedHandIds ? flopCBetOpportunityState.reducedHandIds.size : 0,
          showdownAliases: showdownStatsState && showdownStatsState.reducedHandIds ? showdownStatsState.reducedHandIds.size : 0,
          policy: 'semantic/preflop/flop exactly-once identities remain Session-proportional and reset at the authoritative Session boundary; showdown aliases use the reducer\'s bounded alias horizon'
        },
        socketPlayerDiagnostics: { size: identityDiagnostics.socketPlayers.size, policy: 'stable player identity and reconnect mapping state; proportional to distinct players observed in the current table Session and reset at table lifecycle cleanup' },
        pendingBinary: binary
      }
    };
  }

  function stablePlayerNameForEvents(playerId, events) {
    playerId = String(playerId);
    if (socketPlayerNames && socketPlayerNames.has(playerId)) return socketPlayerNames.get(playerId);
    var match = (events || []).find(function (event) {
      return event && String(event.playerId || '') === playerId && event.player;
    });
    return match ? match.player : '';
  }

  function stablePlayerIdsFromEvents(events) {
    return Array.from(new Set((events || []).map(function (event) {
      return event && event.playerId !== null && event.playerId !== undefined ? String(event.playerId) : '';
    }).filter(Boolean)));
  }

  function recordCounterRegression(details) {
    counterRegressionDiagnostics.push(Object.assign({ timestamp: Date.now(), buildId: PNHUD_BUILD_ID }, cloneJson(details || {})));
    if (counterRegressionDiagnostics.length > 50) counterRegressionDiagnostics.shift();
    console.error('[HUD STATS INVARIANT] authoritative counter regression rejected', counterRegressionDiagnostics[counterRegressionDiagnostics.length - 1]);
  }

  function counterRegressionsBetweenEventSets(beforeEvents, afterEvents) {
    var playerIds = Array.from(new Set(stablePlayerIdsFromEvents(beforeEvents).concat(stablePlayerIdsFromEvents(afterEvents))));
    var results = [];
    playerIds.forEach(function (playerId) {
      var name = stablePlayerNameForEvents(playerId, beforeEvents) || stablePlayerNameForEvents(playerId, afterEvents);
      var before = PokerStats.computePlayerStatsByIdentity(beforeEvents || [], playerId, name);
      var after = PokerStats.computePlayerStatsByIdentity(afterEvents || [], playerId, name);
      var regressions = PokerStats.authoritativeCounterRegressions(before, after);
      if (regressions.length) {
        results.push({
          playerId: playerId,
          regressions: regressions,
          before: PokerStats.authoritativeCounterSnapshot(before),
          after: PokerStats.authoritativeCounterSnapshot(after)
        });
      }
    });
    return results;
  }

  function persistHandAccounting(callback, reason) {
    if (!ownsRuntimeController()) return;
    if (!handAccounting) {
      if (typeof callback === 'function') callback(new Error('hand accounting is unavailable'));
      return;
    }
    updateHandAccountingHealth();
    var finalized = {};
    finalized[STORAGE_KEYS.live] = liveEvents;
    finalized[STORAGE_KEYS.finalizedHandIds] = Array.from(handAccounting.finalizedHandIds);
    var recovery = {};
    recovery[STORAGE_KEYS.activeHand] = serializedActiveHandWithSemanticShadow();
    recovery[STORAGE_KEYS.fingerprints] = Array.from(capturedFingerprints);
    recovery[STORAGE_KEYS.handSignatures] = Array.from(socketHandSignatures);
    recovery[STORAGE_KEYS.hostControl] = PokerHostControlTrace.persistentSnapshot(hostControlTraceState);
    Object.keys(careerPendingStorageUpdates).forEach(function (key) { recovery[key] = careerPendingStorageUpdates[key]; });
    var plan = PokerSessionRuntime.planPersistence(sessionPersistencePlanner, {
      finalizedRevision: finalizedSessionRevision,
      finalized: finalized,
      recovery: recovery,
      reason: reason || (activeHandState ? 'active-hand recovery checkpoint' : 'hand-accounting checkpoint')
    });
    if (plan.includesFinalized) {
      preflopDebug('persistence-save', { storageKey: STORAGE_KEYS.live, savedCounters: preflopEventSnapshots(liveEvents) });
      showdownDebug('persistence-save', { storageKey: STORAGE_KEYS.live, events: showdownEventSnapshots(liveEvents), phase: 'queued' });
    }
    queueAuthoritativeStorageSnapshot(plan.payload, function (storageError) {
      PokerSessionRuntime.completePersistence(sessionPersistencePlanner, plan, storageError);
      if (plan.includesFinalized) showdownDebug('persistence-save-complete', {
        storageKey: STORAGE_KEYS.live,
        finalizedRevision: plan.finalizedRevision,
        error: storageError ? storageError.message : null
      });
      if (typeof callback === 'function') callback(storageError);
    });
  }

  function classifyCommitSource(context) {
    context = context || {};
    var rawSource = String(context.source || '').toLowerCase();
    if (context.sourceClassification) return context.sourceClassification;
    if (context.initializationReplay || initializationReplayActive) return 'initialization-replay';
    if ((context.source === 'full-log' || rawSource.indexOf('full log') >= 0) && context.historical) return 'full-log-parser';
    if (context.source === 'full-log' || rawSource.indexOf('full log') >= 0) return 'hand-log-dom';
    if (context.source === 'storage-restore') return 'storage-restore';
    if ((context.source === 'websocket' || rawSource.indexOf('websocket') >= 0) && context.initialSnapshot) return 'current-snapshot';
    if ((context.source === 'websocket' || rawSource.indexOf('websocket') >= 0) && handLogOpenState()) return 'hand-log-websocket';
    if ((context.source === 'websocket' || rawSource.indexOf('websocket') >= 0) && context.reconnectReplay) return 'reconnect-replay';
    if (context.source === 'websocket' || rawSource.indexOf('websocket') >= 0) return 'live-websocket';
    return context.source || 'unknown';
  }

  function recordHandCommitTrace(result, handId, reason, context) {
    if (!PokerHudDiagnostics.enabled('deep')) return null;
    context = context || {};
    var beforeEvents = context.beforeEvents || [];
    var afterEvents = handAccounting ? handAccounting.finalizedEvents : liveEvents;
    var rangeStart = Number(result && result.finalizedRangeStart);
    var rangeLength = Number(result && result.finalizedRangeLength);
    var finalizedForHand = Number.isInteger(rangeStart) && Number.isInteger(rangeLength)
      ? afterEvents.slice(rangeStart, rangeStart + rangeLength)
      : afterEvents.filter(function (event) { return String(event.handId) === String(handId); });
    var handEvents = finalizedForHand.length ? finalizedForHand : result && result.hand && result.hand.events || [];
    var participantRecords = result && result.hand && result.hand.participants ? Object.keys(result.hand.participants).map(function (name) { return result.hand.participants[name]; }) : [];
    var playerNames = Array.from(new Set(handEvents.map(function (event) { return event.player; }).concat(participantRecords.map(function (participant) { return participant.name; })).filter(Boolean)));
    var playerIds = Array.from(new Set(handEvents.map(function (event) { return event.playerId; }).concat(participantRecords.map(function (participant) { return participant.playerId; })).filter(Boolean).map(String)));
    var evidenceKeys = handEvidenceKeys(handId, handEvents);
    var priorEvidenceMatch = handCommitTraces.find(function (trace) {
      return trace.commitAccepted && trace.rawHandId !== String(handId) && (trace.dedupeKeys.strictEventKey === evidenceKeys.strictEventKey || trace.dedupeKeys.actionShapeKey === evidenceKeys.actionShapeKey);
    }) || null;
    var rawHandId = String(context.rawHandId || handId || '');
    var syntheticHandId = rawHandId.indexOf(pokerNowGameId + ':socket:') === 0 ? rawHandId : null;
    var source = classifyCommitSource(context);
    var trace = {
      traceId: 'commit-' + (++handCommitTraceSequence),
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      buildId: PNHUD_BUILD_ID,
      lobbyId: pokerNowGameId,
      sessionKey: gameSessionKey,
      canonicalHandId: String(handId || ''),
      rawHandId: rawHandId,
      generatedSyntheticHandId: syntheticHandId,
      source: source,
      sourceSpecificEventName: context.eventName || null,
      socketNamespace: context.namespace || null,
      socketEventName: context.socketEventName || context.eventName || null,
      handLogOpen: handLogOpenState(),
      historicalData: Boolean(context.historical || source === 'full-log-parser'),
      participantIds: playerIds,
      participantNames: playerNames,
      finalizedActionSummary: summarizeHandEvents(handEvents),
      settlementSummary: cloneJson(context.settlementSummary || null),
      activeHandIdBefore: context.activeHandIdBefore || null,
      activeHandIdAfter: handAccounting && handAccounting.activeHandId || null,
      previousHandId: context.previousHandId || null,
      dedupeKeys: evidenceKeys,
      dedupeStateChecked: {
        finalizedHandIdBefore: Boolean(context.finalizedHandIdsBefore && context.finalizedHandIdsBefore.includes(String(handId))),
        finalizedHandIdsBefore: context.finalizedHandIdsBefore || [],
        capturedFingerprintCount: capturedFingerprints.size,
        capturedSemanticCount: capturedEventSemantics.size,
        socketHandSignatureCount: socketHandSignatures.size
      },
      dedupeMatchResult: priorEvidenceMatch ? { matchedTraceId: priorEvidenceMatch.traceId, matchedCanonicalHandId: priorEvidenceMatch.canonicalHandId, matchedSource: priorEvidenceMatch.source, matchKind: priorEvidenceMatch.dedupeKeys.strictEventKey === evidenceKeys.strictEventKey ? 'strict-event-key' : 'action-shape-key' } : null,
      commitAccepted: Boolean(result && result.committed),
      commitRejected: !result || !result.committed,
      duplicate: Boolean(result && result.duplicate),
      discarded: Boolean(result && result.discarded),
      rejectionReason: result && !result.committed ? result.reason || (result.duplicate ? 'duplicate finalized hand ID' : 'commit rejected') : null,
      finalizationReason: reason,
      handsBefore: statsHandsForPlayers(beforeEvents, playerNames),
      handsAfter: statsHandsForPlayers(afterEvents, playerNames),
      finalizedEventCountBefore: beforeEvents.length,
      finalizedEventCountAfter: afterEvents.length,
      productionPath: context.productionPath || 'content.js finalizeStatsHand/beginStatsHand -> PokerHandFinalization.commitHand -> applyHandCommitResult',
      callStack: String(new Error('hand commit trace').stack || '')
    };
    handCommitTraces.push(trace);
    if (handCommitTraces.length > 300) handCommitTraces.shift();
    console.log('[HUD HAND COMMIT TRACE]', trace);
    traceHandSource('hand-commit-attempt', { traceId: trace.traceId, source: trace.source, rawHandId: trace.rawHandId, canonicalHandId: trace.canonicalHandId, accepted: trace.commitAccepted, duplicate: trace.duplicate, evidenceMatch: trace.dedupeMatchResult });
    return trace;
  }

  function finalizedPreflopIdentityMap(result) {
    var identityByPlayerId = {};
    socketPlayerNames.forEach(function (name, playerId) { identityByPlayerId[String(playerId)] = String(name); });
    var participants = result && result.hand && result.hand.participants || {};
    Object.keys(participants).forEach(function (participantName) {
      var participant = participants[participantName] || {};
      if (participant.playerId !== null && participant.playerId !== undefined) {
        identityByPlayerId[String(participant.playerId)] = String(participant.name || participantName);
      }
    });
    return identityByPlayerId;
  }

  function applyFinalizedPreflopContribution(result, reductionResult, range) {
    if (!reductionResult || !reductionResult.reduced || !reductionResult.contribution || !handAccounting) return null;
    var integration = PokerStats.applyPreflopContributionRange(
      handAccounting.finalizedEvents,
      reductionResult.contribution,
      finalizedPreflopIdentityMap(result),
      range
    );
    handAccounting.finalizedEvents = integration.events;
    liveEvents = handAccounting.finalizedEvents;
    (integration.attachmentResults || []).forEach(function (attachment) {
      preflopDebug('contribution-attachment', attachment);
    });
    if (integration.missingPlayerIds.length) {
      console.warn('[HUD PREFLOP STATS] finalized contribution could not be mapped to a finalized player event', {
        handId: reductionResult.handId,
        missingPlayerIds: integration.missingPlayerIds
      });
    }
    return integration;
  }

  function applyFinalizedFlopCBetContribution(reductionResult, range) {
    if (!reductionResult || !reductionResult.reduced || !reductionResult.contribution || !handAccounting) return null;
    var integration = PokerStats.applyFlopCBetContributionRange(
      handAccounting.finalizedEvents,
      reductionResult.contribution,
      range
    );
    handAccounting.finalizedEvents = integration.events;
    liveEvents = handAccounting.finalizedEvents;
    (integration.attachmentResults || []).forEach(function (record) {
      preflopDebug('flop-cbet-stats-attachment', record);
    });
    if (integration.missingPlayerIds.length) {
      console.warn('[HUD FLOP CBET STATS] contribution could not be matched by exact stable player ID', {
        handId: reductionResult.handId,
        missingPlayerIds: integration.missingPlayerIds
      });
    }
    var shadowAttachment = PokerFlopCBetOpportunityReducer.attach(
      flopCBetOpportunityState,
      handAccounting.finalizedEvents,
      reductionResult.contribution,
      range
    );
    (shadowAttachment.attachmentResults || []).forEach(function (record) {
      preflopDebug('flop-cbet-contribution-attachment', record);
    });
    if (shadowAttachment.missingPlayerIds.length) {
      console.warn('[HUD FLOP CBET SHADOW] contribution could not be matched by stable player ID', {
        handId: reductionResult.handId,
        missingPlayerIds: shadowAttachment.missingPlayerIds
      });
    }
    return { integration: integration, shadowAttachment: shadowAttachment };
  }

  function associateFinalizedShowdownShadow(reductionResult, range) {
    if (!reductionResult || !reductionResult.reduced || !reductionResult.contribution || !handAccounting) return null;
    var shadowAttachment = PokerShowdownStatsReducer.attach(
      showdownStatsState,
      handAccounting.finalizedEvents,
      reductionResult.contribution,
      range
    );
    (shadowAttachment.attachmentResults || []).forEach(function (record) {
      showdownDebug('shadow-attachment', record);
    });
    return shadowAttachment;
  }

  function applyFinalizedShowdownContribution(reductionResult, range) {
    if (!reductionResult || !reductionResult.reduced || !reductionResult.contribution || !handAccounting) return null;
    var integration = PokerStats.applyShowdownContributionRange(
      handAccounting.finalizedEvents,
      reductionResult.contribution,
      range
    );
    handAccounting.finalizedEvents = integration.events;
    liveEvents = handAccounting.finalizedEvents;
    (integration.attachmentResults || []).forEach(function (record) {
      showdownDebug('authoritative-stats-attachment', record);
    });
    if (integration.missingPlayerIds.length) {
      console.warn('[HUD SHOWDOWN STATS] contribution could not be matched by exact stable player ID', {
        handId: reductionResult.handId,
        missingPlayerIds: integration.missingPlayerIds
      });
    }
    return integration;
  }

  function finalizedBasicContributionsForExplanation(record, range) {
    var identity = record && record.handIdentity || {};
    var aliases = [identity.handId, identity.lifecycleHandId].filter(function (value, index, values) {
      return value !== null && value !== undefined && values.map(String).indexOf(String(value)) === index;
    }).map(String);
    var handEvents = range ? liveEvents.slice(range.start, range.start + range.length) : liveEvents.filter(function (event) { return event && aliases.includes(String(event.handId)); });
    var result = {};
    (record && record.players || []).forEach(function (player) {
      if (!player || player.playerId === null || player.playerId === undefined) return;
      var playerId = String(player.playerId);
      var playerName = stablePlayerNameForEvents(playerId, handEvents);
      var stats = PokerStats.computePlayerStatsByIdentity(handEvents, playerId, playerName);
      result[playerId] = {
        vpip: { made: stats.vpipHands, opportunities: stats.vpipOpportunities },
        pfr: { made: stats.pfrHands, opportunities: stats.pfrOpportunities }
      };
    });
    return result;
  }

  function recordFinalizedStatExplanation(record, preflopReduction, preflopIntegration, flopReduction, flopIntegration, showdownReduction, showdownIntegration, range) {
    if (!record) return null;
    var recorded = PokerHandStatExplanation.record(statExplanationState, {
      semanticRecord: record,
      preflopContribution: preflopReduction && preflopReduction.contribution || null,
      preflopIntegration: preflopIntegration,
      flopCBetContribution: flopReduction && flopReduction.contribution || null,
      flopCBetIntegration: flopIntegration && flopIntegration.integration || flopIntegration,
      showdownContribution: showdownReduction && showdownReduction.contribution || null,
      showdownIntegration: showdownIntegration,
      basicContributionsByPlayer: finalizedBasicContributionsForExplanation(record, range),
      finalizedAt: Date.now()
    });
    if (recorded && recorded.recorded && handStatInspectorState.open) refreshHandStatInspectorView();
    return recorded;
  }

  function enqueueIndexedCareerRecord(careerRecord, allowRetiredController) {
    var outboxKey = PokerCareerIndexedStore.outboxKey(careerRecord);
    var outboxUpdate = {}; outboxUpdate[outboxKey] = careerRecord;
    var outboxPersistence = new Promise(function (resolve) {
      chrome.storage.local.set(outboxUpdate, function () {
        resolve(chrome.runtime && chrome.runtime.lastError ? new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)) : null);
      });
    });
    careerIndexedAppendQueue = careerIndexedAppendQueue.then(function () { return outboxPersistence; }).then(function (outboxError) {
      if (outboxError) throw outboxError;
      if (!allowRetiredController && !ownsRuntimeController()) throw new Error('superseded content controller before Career append');
      return careerIndexedService.append(careerRecord);
    }).then(function (indexedResult) {
      if (!ownsRuntimeController()) return indexedResult;
      if (indexedResult.accepted) careerDiagnostics.accepted += 1;
      else if (indexedResult.duplicate) careerDiagnostics.duplicates += 1;
      else if (indexedResult.conflict) careerDiagnostics.conflicts += 1;
      else careerDiagnostics.rejected += 1;
      if (indexedResult.accepted || indexedResult.duplicate) chrome.storage.local.remove(outboxKey);
      if (indexedResult.accepted) invalidateSeatHudCareerStats(careerRecord.players.map(function (entry) { return entry.playerId; }), 'accepted Career hand append');
      else if (indexedResult.duplicate) invalidateLeaderboardCareerStats(careerRecord.players.map(function (entry) { return entry.playerId; }), 'confirmed Career outbox replay');
      return indexedResult;
    }).catch(function (error) {
      careerDiagnostics.rejected += 1;
      console.error('[HUD CAREER STORAGE] append failed; durable outbox retained for reload recovery', error);
    });
    return { accepted: true, pendingIndexedCommit: true, handKey: careerRecord.handKey };
  }

  function releaseCareerRestoreAppendGate(discard, allowRetiredController) {
    var gate = careerRestoreAppendGate;
    careerRestoreAppendGate = null;
    if (!gate || discard) return;
    gate.records.forEach(function (record) { enqueueIndexedCareerRecord(record, Boolean(allowRetiredController)); });
  }

  function consumeCertifiedCareerHand(record, preflopResult, flopResult, showdownResult) {
    if (!ownsRuntimeController()) return { accepted: false, reason: "superseded content controller" };
    if (!careerTrackingReady || (!careerIndexedService && !careerStoreState)) return { accepted: false, reason: 'career tracking is not initialized' };
    try {
      var identity = record && record.handIdentity || {};
      var careerRecord = PokerCareerContributionStore.buildCertifiedHandRecord({
        namespace: { host: location.hostname, gameId: pokerNowGameId },
        authoritativeHandId: identity.handId,
        lifecycleHandIds: [identity.lifecycleHandId],
        semanticRecord: record,
        finalizedEvents: handAccounting && handAccounting.finalizedEvents || liveEvents,
        preflopContribution: preflopResult && preflopResult.contribution,
        flopCBetContribution: flopResult && flopResult.contribution,
        showdownContribution: showdownResult && showdownResult.contribution
      });
      if (careerIndexedService) {
        if (careerRestoreAppendGate) {
          careerRestoreAppendGate.records.push(careerRecord);
          return { accepted: true, pendingRestoreOutcome: true, handKey: careerRecord.handKey };
        }
        return enqueueIndexedCareerRecord(careerRecord, false);
      }
      var appendResult = PokerCareerContributionStore.append(careerStoreState, careerRecord);
      if (appendResult.accepted) {
        Object.assign(careerPendingStorageUpdates, appendResult.storageUpdate);
        careerDiagnostics.accepted += 1;
        invalidateSeatHudCareerStats(careerRecord.players.map(function (entry) { return entry.playerId; }), 'accepted fallback Career hand append');
      } else if (appendResult.duplicate) careerDiagnostics.duplicates += 1;
      else if (appendResult.conflict) careerDiagnostics.conflicts += 1;
      else careerDiagnostics.rejected += 1;
      careerDiagnostics.recent.unshift({ timestamp: Date.now(), handKey: careerRecord.handKey, accepted: Boolean(appendResult.accepted), duplicate: Boolean(appendResult.duplicate), conflict: Boolean(appendResult.conflict), reason: appendResult.reason || null });
      if (careerDiagnostics.recent.length > 20) careerDiagnostics.recent.length = 20;
      return appendResult;
    } catch (error) {
      careerDiagnostics.rejected += 1;
      careerDiagnostics.recent.unshift({ timestamp: Date.now(), handKey: null, accepted: false, reason: String(error.message || error) });
      if (careerDiagnostics.recent.length > 20) careerDiagnostics.recent.length = 20;
      console.warn('[HUD CAREER] finalized hand was not persisted', { reason: String(error.message || error), handIdentity: record && record.handIdentity || null });
      return { accepted: false, reason: String(error.message || error) };
    }
  }

  function applyHandCommitResult(result, handId, reason, commitContext) {
    if (!result) return;
    var finalizedRange = Number.isInteger(result.finalizedRangeStart) && Number.isInteger(result.finalizedRangeLength)
      ? { start: result.finalizedRangeStart, length: result.finalizedRangeLength }
      : null;
    showdownDebug('finalization-attempt', {
      lifecycleHandId: String(handId),
      authoritativeHandId: commitContext && commitContext.authoritativeHandId || null,
      reason: reason,
      source: commitContext && commitContext.source || null,
      ready: commitContext && typeof commitContext.showdownFinalizationReady === 'boolean' ? commitContext.showdownFinalizationReady : null,
      committed: Boolean(result.committed),
      duplicate: Boolean(result.duplicate),
      discarded: Boolean(result.discarded),
      resultReason: result.reason || null
    });
    if (result.committed || result.duplicate) {
      var semanticResult = PokerSemanticHandLedger.finalize(semanticLedgerState, String(handId), {
        reason: reason,
        timestamp: Date.now(),
        nextAuthoritativeHandId: commitContext && commitContext.nextAuthoritativeHandId || null,
        fallbackHand: result.hand || null
      });
      preflopDebug('semantic-finalization', {
        called: true,
        lifecycleHandId: String(handId),
        finalized: Boolean(semanticResult && semanticResult.finalized),
        reason: semanticResult && semanticResult.reason || reason,
        handIdentity: semanticResult && semanticResult.record && semanticResult.record.handIdentity || null,
        playerIds: semanticResult && semanticResult.record ? (semanticResult.record.players || []).map(function (player) {
          if (!player || player.playerId === null || player.playerId === undefined) return null;
          return String(player.playerId);
        }).filter(Boolean) : [],
        preflopActions: semanticResult && semanticResult.record ? (semanticResult.record.actions || []).filter(function (action) {
          return action.street === 'preflop';
        }).map(function (action) {
          return { sequence: action.sequence, playerId: action.playerId, type: action.type, amountTo: action.amountTo, isFullRaise: action.isFullRaise, isAllIn: action.isAllIn };
        }) : [],
        flopActions: semanticResult && semanticResult.record ? (semanticResult.record.actions || []).filter(function (action) {
          return action.street === 'flop';
        }).map(function (action) {
          return { sequence: action.sequence, playerId: action.playerId, type: action.type, amountTo: action.amountTo, isAllIn: action.isAllIn };
        }) : []
      });
      showdownDebug('semantic-finalization', {
        lifecycleHandId: String(handId),
        finalized: Boolean(semanticResult && semanticResult.finalized),
        duplicate: Boolean(semanticResult && semanticResult.duplicate),
        reason: semanticResult && semanticResult.reason || reason,
        handIdentity: semanticResult && semanticResult.record && semanticResult.record.handIdentity || null,
        playerIds: semanticResult && semanticResult.record ? (semanticResult.record.players || []).map(function (player) {
          return player && player.playerId !== null && player.playerId !== undefined ? String(player.playerId) : null;
        }).filter(Boolean) : [],
        actions: semanticResult && semanticResult.record ? (semanticResult.record.actions || []).map(function (action) {
          return { sequence: action.sequence, street: action.street, playerId: action.playerId, type: action.type, amountTo: action.amountTo, isAllIn: action.isAllIn };
        }) : []
      });
      if (semanticResult && semanticResult.duplicate) {
        showdownDebug('duplicate-rejection', { lifecycleHandId: String(handId), reason: semanticResult.reason || 'semantic finalization duplicate' });
        showdownDebug('duplicate-or-upgrade-rejection', {
          lifecycleHandId: String(handId),
          duplicate: true,
          upgradeAttempted: false,
          reason: 'the exact hand was already committed; post-commit contribution upgrades are not used'
        });
      }
      if (semanticResult.finalized && semanticResult.record) {
        showdownDebug('showdown-evidence-completeness', {
          handIdentity: semanticResult.record.handIdentity,
          flopEntrantPlayerIds: semanticResult.record.streets && semanticResult.record.streets.flop && semanticResult.record.streets.flop.entrants || [],
          showdownDetected: semanticResult.record.showdown && semanticResult.record.showdown.detected,
          showdownParticipantIds: semanticResult.record.showdown && semanticResult.record.showdown.participants || [],
          playerStates: (semanticResult.record.players || []).map(function (player) {
            return { playerId: player.playerId, sawFlop: player.sawFlop, folded: player.folded, allIn: player.allIn, reachedShowdown: player.reachedShowdown };
          })
        });
        showdownDebug('settlement-completeness', {
          handIdentity: semanticResult.record.handIdentity,
          status: semanticResult.record.settlement && semanticResult.record.settlement.status || null,
          awardCount: semanticResult.record.settlement && (semanticResult.record.settlement.awards || []).length || 0,
          awardPlayerIds: semanticResult.record.settlement ? (semanticResult.record.settlement.awards || []).map(function (award) { return award.playerId; }) : [],
          ambiguityCodes: (semanticResult.record.ambiguities || []).map(function (ambiguity) { return ambiguity.code; })
        });
        preflopDebug('reducer-invocation', { called: true, phase: 'before', handIdentity: semanticResult.record.handIdentity });
        var reductionResult = PokerPreflopOpportunityReducer.reduce(preflopOpportunityState, semanticResult.record);
        preflopDebug('reducer-invocation', {
          called: true,
          phase: 'after',
          reduced: Boolean(reductionResult && reductionResult.reduced),
          duplicate: Boolean(reductionResult && reductionResult.duplicate),
          reason: reductionResult && reductionResult.reason || null,
          handId: reductionResult && reductionResult.handId || null,
          contributions: reductionResult && reductionResult.contribution && reductionResult.contribution.players || null,
          ambiguities: reductionResult && reductionResult.contribution && reductionResult.contribution.ambiguities || []
        });
        var preflopIntegration = applyFinalizedPreflopContribution(result, reductionResult, finalizedRange);
        preflopDebug('flop-cbet-reducer-invocation', { called: true, phase: 'before', handIdentity: semanticResult.record.handIdentity });
        var flopCBetReductionResult = PokerFlopCBetOpportunityReducer.reduce(flopCBetOpportunityState, semanticResult.record);
        preflopDebug('flop-cbet-reducer-invocation', {
          called: true,
          phase: 'after',
          reduced: Boolean(flopCBetReductionResult && flopCBetReductionResult.reduced),
          duplicate: Boolean(flopCBetReductionResult && flopCBetReductionResult.duplicate),
          reason: flopCBetReductionResult && flopCBetReductionResult.reason || null,
          handId: flopCBetReductionResult && flopCBetReductionResult.handId || null,
          contributions: flopCBetReductionResult && flopCBetReductionResult.contribution && flopCBetReductionResult.contribution.players || null,
          ambiguities: flopCBetReductionResult && flopCBetReductionResult.contribution && flopCBetReductionResult.contribution.ambiguities || []
        });
        var flopCBetIntegration = applyFinalizedFlopCBetContribution(flopCBetReductionResult, finalizedRange);
        showdownDebug('reducer-invocation', { phase: 'before', handIdentity: semanticResult.record.handIdentity });
        var showdownReductionResult = PokerShowdownStatsReducer.reduce(showdownStatsState, semanticResult.record);
        showdownDebug('reducer-invocation', {
          phase: 'after',
          reduced: Boolean(showdownReductionResult && showdownReductionResult.reduced),
          duplicate: Boolean(showdownReductionResult && showdownReductionResult.duplicate),
          handId: showdownReductionResult && showdownReductionResult.handId || null,
          reason: showdownReductionResult && showdownReductionResult.reason || null,
          outputs: showdownReductionResult && showdownReductionResult.contribution && showdownReductionResult.contribution.players || {},
          identityAliases: showdownReductionResult && showdownReductionResult.contribution ? [
            showdownReductionResult.contribution.handIdentity.lifecycleHandId,
            showdownReductionResult.contribution.handIdentity.handId
          ].filter(Boolean) : []
        });
        if (showdownReductionResult && showdownReductionResult.contribution) {
          showdownDebug('settlement-evidence', {
            handIdentity: showdownReductionResult.contribution.handIdentity,
            settlementStatus: semanticResult.record.settlement && semanticResult.record.settlement.status || null,
            uncontested: semanticResult.record.settlement && semanticResult.record.settlement.uncontested,
            awards: (semanticResult.record.settlement && semanticResult.record.settlement.awards || []).map(function (award) {
              return { playerId: award.playerId, amount: award.amount, kind: award.kind || award.type || 'award', potId: award.potId, boardIndex: award.boardIndex };
            }),
            refunds: (semanticResult.record.settlement && semanticResult.record.settlement.refunds || []).map(function (refund) {
              return { playerId: refund.playerId, amount: refund.amount, kind: refund.kind || refund.type || 'refund' };
            })
          });
          Object.keys(showdownReductionResult.contribution.players || {}).forEach(function (playerId) {
            var player = showdownReductionResult.contribution.players[playerId];
            showdownDebug('wtsd-decision', {
              handIdentity: showdownReductionResult.contribution.handIdentity,
              playerId: playerId,
              sawFlopForWTSD: player.sawFlopForWTSD,
              wentToShowdown: player.wentToShowdown,
              wtsdSupported: player.wtsdSupported,
              showdownOutcome: player.showdownOutcome,
              outcomeSupported: player.outcomeSupported,
              wonMoneyAtShowdownCandidate: player.wonMoneyAtShowdownCandidate,
              wonMoneyAtShowdownCandidateSupported: player.wonMoneyAtShowdownCandidateSupported,
              wonMoneyAtShowdownCandidateReason: player.wonMoneyAtShowdownCandidateReason,
              contestedGrossAward: player.contestedGrossAward,
              excludedReturnAmount: player.excludedReturnAmount,
              unsupportedReason: player.unsupportedReason
            });
          });
        }
        var showdownIntegration = applyFinalizedShowdownContribution(showdownReductionResult, finalizedRange);
        associateFinalizedShowdownShadow(showdownReductionResult, finalizedRange);
        handAccounting.finalizedEvents = PokerFilteredStats.annotateSessionEventRange(
          handAccounting.finalizedEvents,
          finalizedRange ? finalizedRange.start : 0,
          finalizedRange ? finalizedRange.length : handAccounting.finalizedEvents.length,
          semanticResult.record,
          reductionResult && reductionResult.contribution,
          flopCBetReductionResult && flopCBetReductionResult.contribution,
          showdownReductionResult && showdownReductionResult.contribution
        );
        liveEvents = handAccounting.finalizedEvents;
        recordFinalizedStatExplanation(
          semanticResult.record,
          reductionResult,
          preflopIntegration,
          flopCBetReductionResult,
          flopCBetIntegration,
          showdownReductionResult,
          showdownIntegration,
          finalizedRange
        );
        showdownDebug('committed-contribution', {
          handIdentity: showdownReductionResult && showdownReductionResult.contribution && showdownReductionResult.contribution.handIdentity || semanticResult.record.handIdentity,
          contributionId: showdownReductionResult && showdownReductionResult.contribution && showdownReductionResult.contribution.contributionId || null,
          reduced: Boolean(showdownReductionResult && showdownReductionResult.reduced),
          duplicate: Boolean(showdownReductionResult && showdownReductionResult.duplicate),
          playerIds: showdownReductionResult && showdownReductionResult.contribution ? Object.keys(showdownReductionResult.contribution.players || {}) : []
        });
        consumeCertifiedCareerHand(semanticResult.record, reductionResult, flopCBetReductionResult, showdownReductionResult);
      }
    }
    if (result.committed) advanceFinalizedSessionRevision(result.reconciled ? 'finalized hand reconciliation' : 'finalized hand commit');
    if (result.discarded) {
      PokerSemanticHandLedger.discard(semanticLedgerState, String(handId), { reason: result.reason || reason });
      console.log('[HUD HAND FINALIZE] incomplete hand discarded/recovered', { handId: handId, reason: result.reason || reason, hand: result.hand || null });
    } else if (result.duplicate) {
      console.log('[HUD HAND FINALIZE] duplicate commit prevented', { handId: handId, reason: result.reason || reason });
    } else if (result.committed) {
      (result.addedEvents || []).forEach(function (event) { PokerStats.addEvent([], event); });
      console.log('[HUD HAND FINALIZE] hand committed', { handId: handId, reason: reason, reconciled: Boolean(result.reconciled), addedEvents: result.addedEvents || [], finalizedEventCount: handAccounting.finalizedEvents.length });
      PokerInterruptedHandRecovery.finalize(interruptedHandRecoveryState, handId);
      refreshShadowProfiles('finalized-hand-commit', handAccounting.finalizedEvents);
    }
    traceFirstHandLifecycle('finalizationDecisions', {
      handId: String(handId),
      reason: reason,
      committed: Boolean(result.committed),
      duplicate: Boolean(result.duplicate),
      discarded: Boolean(result.discarded),
      reconciled: Boolean(result.reconciled),
      resultReason: result.reason || null,
      activeHandIdAfterDecision: handAccounting && handAccounting.activeHandId || null,
      finalizedHandIds: handAccounting ? Array.from(handAccounting.finalizedHandIds) : [],
      addedEventCount: (result.addedEvents || []).length
    });
    (result.addedEvents || []).forEach(function (event) {
      traceFirstHandLifecycle('finalizedEvents', { handId: event.handId, playerId: event.playerId || null, player: event.player, action: event.action, street: event.street, amount: event.amount || 0 }, event.timestamp);
    });
    traceFirstHandLifecycle('dedupeState', {
      handId: String(handId),
      finalizedHandIds: handAccounting ? Array.from(handAccounting.finalizedHandIds) : [],
      capturedFingerprintCount: capturedFingerprints.size,
      capturedSemanticCount: capturedEventSemantics.size,
      handSignatureCount: socketHandSignatures.size
    });
    var tracePlayerNames = result.hand && result.hand.participants ? Object.keys(result.hand.participants) : [];
    var displayedHandsByPlayer = {};
    if (PokerHudDiagnostics.enabled('deep')) tracePlayerNames.forEach(function (playerName) { displayedHandsByPlayer[playerName] = PokerStats.computePlayerStats(handAccounting.finalizedEvents, playerName).handsPlayed; });
    traceFirstHandLifecycle('statsIncrements', {
      handId: String(handId),
      displayedHands: handAccounting ? handAccounting.finalizedHandIds.size : 0,
      displayedHandsByPlayer: displayedHandsByPlayer,
      finalizedStatsEventCount: handAccounting ? handAccounting.finalizedEvents.length : liveEvents.length,
      committed: Boolean(result.committed),
      traceComplete: Boolean(result.committed || result.duplicate)
    });
    recordHandCommitTrace(result, handId, reason, commitContext || {});
    var committedRecoveryMetadata = result.hand && result.hand.recoveryMetadata || null;
    if (PokerHudDiagnostics.enabled('deep') && committedRecoveryMetadata && committedRecoveryMetadata.firstHandAfterReloadBreak) {
      console.log('[HUD BREAK RELOAD COMMIT]', {
        finalizedHandId: String(handId),
        commitAccepted: Boolean(result.committed),
        duplicate: Boolean(result.duplicate),
        discarded: Boolean(result.discarded),
        decisionReason: result.reason || reason,
        breakEpoch: committedRecoveryMetadata.breakEpoch,
        resumeEpochSource: committedRecoveryMetadata.resumeEpochSource,
        boundarySignature: committedRecoveryMetadata.boundarySignature,
        cumulativeCommitCount: handAccounting ? handAccounting.finalizedHandIds.size : 0,
        finalizedHandIds: handAccounting ? Array.from(handAccounting.finalizedHandIds) : []
      });
    }
    if (handAccounting && handAccounting.finalizedHandIds.has(String(handId)) && !walkTraceEmittedHandIds.has(String(handId))) recordFinalizedWalkTrace(result, String(handId), reason);
    var commitRegressions = commitContext && Array.isArray(commitContext.beforeEvents)
      ? counterRegressionsBetweenEventSets(commitContext.beforeEvents, handAccounting && handAccounting.finalizedEvents || liveEvents)
      : [];
    if (commitRegressions.length) {
      recordCounterRegression({
        source: 'applyHandCommitResult',
        reason: 'hand finalization attempted to decrease cumulative counters',
        handId: String(handId),
        finalizationReason: reason,
        regressions: commitRegressions
      });
    }
    persistHandAccounting(null, result.committed ? 'finalized hand commit' : 'finalization checkpoint');
    refreshHud();
  }

  function beginStatsHand(handId, source, timestamp, activate) {
    if (!ownsRuntimeController()) return null;
    if (!handId) return null;
    if (!handAccounting) handAccounting = PokerHandFinalization.createState({ finalizedEvents: liveEvents });
    var beforeEvents = PokerHudDiagnostics.enabled('deep') ? handAccounting.finalizedEvents.slice() : null;
    var priorActiveHandId = handAccounting.activeHandId;
    var finalizedHandIdsBefore = Array.from(handAccounting.finalizedHandIds);
    var result = PokerHandFinalization.beginHand(handAccounting, String(handId), { activate: activate !== false, timestamp: timestamp, priorReason: 'next distinct hand began via ' + source });
    if (result.priorResult) applyHandCommitResult(result.priorResult, result.priorResult.hand && result.priorResult.hand.handId || 'previous-active-hand', 'next distinct hand began', {
      source: source,
      historical: source === 'full-log' && backfillingFullLog,
      initializationReplay: initializationReplayActive,
      eventName: currentSocketFrameContext && currentSocketFrameContext.eventName,
      namespace: currentSocketFrameContext && currentSocketFrameContext.namespace,
      initialSnapshot: currentSocketFrameContext && currentSocketFrameContext.initialSnapshot,
      reconnectReplay: currentSocketFrameContext && currentSocketFrameContext.reconnectReplay,
      settlementSummary: currentSocketFrameContext && currentSocketFrameContext.settlementSummary,
      nextAuthoritativeHandId: currentSocketFrameContext && currentSocketFrameContext.authoritativeHandId || null,
      beforeEvents: beforeEvents,
      activeHandIdBefore: priorActiveHandId,
      previousHandId: priorActiveHandId,
      finalizedHandIdsBefore: finalizedHandIdsBefore,
      productionPath: 'content.js beginStatsHand -> PokerHandFinalization.beginHand -> implicit prior commit'
    });
    activeHandState = PokerHandFinalization.activeHand(handAccounting);
    if (result.created) console.log('[HUD HAND FINALIZE] active hand created', { handId: String(handId), source: source, active: activate !== false, timestamp: timestamp });
    traceFirstHandLifecycle('activeHandCreation', {
      handId: String(handId),
      source: source,
      created: Boolean(result.created),
      activated: activate !== false,
      previousActiveHandCommitted: Boolean(result.priorResult && result.priorResult.committed),
      activeHandId: handAccounting.activeHandId,
      activeHand: cloneJson(PokerHandFinalization.activeHand(handAccounting))
    }, timestamp);
    persistHandAccounting();
    return result.hand;
  }

  function includeHandParticipant(handId, playerId, playerName, evidence, status, timestamp) {
    if (!handId || !playerName || !handAccounting) return false;
    var result = PokerHandFinalization.addParticipant(handAccounting, String(handId), { playerId: playerId, name: playerName, evidence: evidence, status: status, timestamp: timestamp });
    var details = { playerId: playerId, name: playerName, evidence: evidence, status: status, handId: String(handId) };
    if (result.included) console.log('[HUD PARTICIPANT] included', details);
    else console.log('[HUD PARTICIPANT] excluded', Object.assign(details, { reason: result.reason }));
    updateHandAccountingHealth();
    return result.included;
  }

  function finalizeStatsHand(handId, reason, timestamp, sourceContext) {
    if (!ownsRuntimeController()) return { committed: false, reason: "superseded content controller", addedEvents: [] };
    if (!handAccounting || !handId) {
      traceFirstHandLifecycle('finalizationDecisions', {
        handId: handId || null,
        reason: reason,
        committed: false,
        earlyExit: true,
        exactReason: !handAccounting ? 'hand accounting is not initialized' : 'no hand ID was supplied',
        activeHandId: handAccounting && handAccounting.activeHandId || null
      }, timestamp);
      recordHandCommitTrace({ committed: false, duplicate: false, discarded: false, reason: !handAccounting ? 'hand accounting is not initialized' : 'no hand ID was supplied', addedEvents: [] }, handId || '', reason, Object.assign({}, sourceContext || {}, {
        beforeEvents: PokerHudDiagnostics.enabled('deep') ? (handAccounting ? handAccounting.finalizedEvents.slice() : liveEvents.slice()) : null,
        activeHandIdBefore: handAccounting && handAccounting.activeHandId || null,
        finalizedHandIdsBefore: handAccounting ? Array.from(handAccounting.finalizedHandIds) : []
      }));
      if (handId) showdownDebug('finalization-attempt', {
        lifecycleHandId: String(handId),
        reason: reason,
        source: sourceContext && sourceContext.source || null,
        ready: sourceContext && typeof sourceContext.showdownFinalizationReady === 'boolean' ? sourceContext.showdownFinalizationReady : null,
        committed: false,
        duplicate: false,
        discarded: false,
        exactReason: !handAccounting ? 'hand accounting is not initialized' : 'no hand ID was supplied'
      });
      return null;
    }
    var beforeEvents = PokerHudDiagnostics.enabled('deep') ? handAccounting.finalizedEvents.slice() : null;
    var context = Object.assign({}, sourceContext || {}, {
      beforeEvents: beforeEvents,
      activeHandIdBefore: handAccounting.activeHandId,
      previousHandId: previousGcSnapshot ? findHandIdentifier(previousGcSnapshot) : null,
      finalizedHandIdsBefore: Array.from(handAccounting.finalizedHandIds)
    });
    var result = PokerHandFinalization.commitHand(handAccounting, String(handId), reason, timestamp);
    applyHandCommitResult(result, String(handId), reason, context);
    return result;
  }

  function stageStatsEvent(handEvent, source) {
    if (!handAccounting) handAccounting = PokerHandFinalization.createState({ finalizedEvents: liveEvents });
    var isBackfill = source === 'full-log' && backfillingFullLog;
    var shouldActivate = !isBackfill && source !== 'self-test' && !handAccounting.finalizedHandIds.has(String(handEvent.handId));
    if (!handAccounting.stagedHands[String(handEvent.handId)]) beginStatsHand(handEvent.handId, source, handEvent.timestamp, shouldActivate);
    var staged = PokerHandFinalization.stageEvent(handAccounting, handEvent, { playerId: handEvent.playerId, reason: handEvent.action === 'blind' ? 'forced-blind participation' : 'verified ' + handEvent.action + ' action' });
    if (staged.staged && ownedHandReloadContinuityState.ownershipRestoreSucceeded && String(handEvent.handId) === String(ownedHandReloadContinuityState.persistedHandId)) {
      PokerOwnedHandReloadContinuity.markAction(ownedHandReloadContinuityState, handEvent.timestamp);
    }
    traceFirstHandLifecycle('stagedEvents', {
      handId: handEvent.handId,
      playerId: handEvent.playerId || null,
      player: handEvent.player,
      action: handEvent.action,
      street: handEvent.street,
      source: source,
      staged: Boolean(staged.staged),
      duplicate: Boolean(staged.duplicate),
      rejectionReason: staged.reason || null,
      activeHandId: handAccounting.activeHandId
    }, handEvent.timestamp);
    if (staged.staged) console.log('[HUD HAND FINALIZE] action staged', { handId: handEvent.handId, player: handEvent.player, action: handEvent.action, street: handEvent.street, amount: handEvent.amount, source: source });
    else if (staged.duplicate) console.log('[HUD HAND FINALIZE] duplicate commit prevented', { handId: handEvent.handId, event: handEvent, stage: 'duplicate staged event' });
    persistHandAccounting();
    return staged;
  }

  function rearmLifecycleBoundaryAcquisition() {
    if (!ownsRuntimeController()) return;
    lifecycleBoundaryAcquisition.pending = true;
    lifecycleBoundaryAcquisition.excludedHandId = previousGcSnapshot && previousGcSnapshot.hI || null;
  }

  function resetCurrentSession(options, completion) {
    if (typeof options === 'function') { completion = options; options = {}; }
    options = options || {};
    if (!ownsRuntimeController()) return;
    var resetCompletion = typeof completion === 'function' ? completion : null;
    var resetSource = String(options.source || 'explicit Reset Session');
    var preserveAuthoritativePause = options.preserveAuthoritativePause === true && currentEffectivePauseState() === 'paused';
    sessionResetInProgress = true;
    rearmLifecycleBoundaryAcquisition();
    PokerPotOdds.resetLiveStateContinuity(potOddsLiveState, resetSource, 'user session reset', Date.now());
    PokerFirstHandLifecycle.startResetTrace(firstHandLifecycle, {
      event: 'Reset Session requested after startup initialization',
      previousSnapshotPresent: Boolean(previousGcSnapshot),
      previousHandId: previousGcSnapshot ? findHandIdentifier(previousGcSnapshot) : null,
      activeHandBeforeReset: handAccounting ? cloneJson(PokerHandFinalization.activeHand(handAccounting)) : null,
      finalizedHandIdsBeforeReset: handAccounting ? Array.from(handAccounting.finalizedHandIds) : [],
      handSignaturesBeforeReset: Array.from(socketHandSignatures),
      mappingCount: socketPlayerNames.size,
      gateReady: firstHandLifecycle.ready,
      boundaryDetectorState: { lastAcceptedBoundaryAt: handTransitionDiagnostics.lastAcceptedBoundaryAt, lastSettlementAt: handTransitionDiagnostics.lastSettlementAt },
      blindTrackerState: { rawTbTransitions: tbTraceState.rawTransitions, normalizedTbTransitions: tbTraceState.normalizedTransitions, activePipelineHandId: liveActionTracker.handId }
    }, Date.now());
    console.log('[HUD FIRST HAND TRACE]', { startupType: 'reset-session', category: 'initialization', details: firstHandLifecycle.currentTrace.initialization[0].details });
    // The boundary cooldown and nearby blind/settlement evidence belong to the
    // discarded Session epoch. Keep the merged table snapshot and its excluded
    // hand ID so reset cannot reacquire the already-observed hand.
    handTransitionDiagnostics.lastAcceptedBoundaryAt = 0;
    handTransitionDiagnostics.lastSettlementAt = 0;
    handTransitionDiagnostics.recentBlindDeductions = [];
    liveEvents = [];
    advanceFinalizedSessionRevision(resetSource);
    activeHandState = null;
    handAccounting = PokerHandFinalization.createState({ finalizedEvents: [] });
    semanticLedgerState = PokerSemanticHandLedger.createState({ maxRecords: 50, maxObservationsPerHand: 240, maxAttempts: 100 });
    preflopOpportunityState = PokerPreflopOpportunityReducer.createState({ maxRecords: 50, maxAttempts: 100, maxPlayers: 200 });
    flopCBetOpportunityState = PokerFlopCBetOpportunityReducer.createState({ maxRecords: 50, maxAttempts: 100, maxPlayers: 200, maxAttachments: 200 });
    showdownStatsState = PokerShowdownStatsReducer.createState({ maxRecords: 50, maxAttempts: 100, maxPlayers: 200, maxIdentityAliases: 400, maxAttachments: 200 });
    statExplanationState = PokerHandStatExplanation.createState({ maxHands: 30 });
    handStatInspectorState = PokerHandStatInspector.createState();
    handStatInspectorScrollState = { history: 0, detail: 0 };
    PokerPlayerProfileShadowStore.clear(playerProfileShadowState);
    capturedFingerprints = PokerRuntimeBounds.createFifoSet(5000);
    capturedEventSemantics = new Set();
    socketHandSignatures = new Set();
    liveWalkTraceByHand.clear();
    completedWalkTraces = [];
    recentWalkBlindSamples = [];
    recentWalkDiagnosticTransportPackets = [];
    walkTraceEmittedHandIds = PokerRuntimeBounds.createFifoSet(100);
    processedFrameFingerprints.clear();
    seenMappingCandidateKeys.clear();
    overlayPlacementFailureKeys.clear();
    pendingBinaryQueue.clear();
    restoredEventCount = 0;
    newlyDecodedEventCount = 0;
    pipelineHealth.statsEventsStored = 0;
    pipelineHealth.restoredStatsEvents = 0;
    pipelineHealth.injectedTestEvents = 0;
    pipelineHealth.realLiveEvents = 0;
    pipelineHealth.actionCandidates = 0;
    pipelineHealth.checksDetected = 0;
    pipelineHealth.callsDetected = 0;
    pipelineHealth.betsDetected = 0;
    pipelineHealth.raisesDetected = 0;
    pipelineHealth.foldsDetected = 0;
    pipelineHealth.ambiguousActionsRejected = 0;
    pipelineHealth.pendingActionCandidates = 0;
    pipelineHealth.confirmedActionCandidates = 0;
    pipelineHealth.rejectedActionCandidates = 0;
    pipelineHealth.expiredActionCandidates = 0;
    pipelineHealth.rawTbTransitionsSeen = 0;
    pipelineHealth.normalizedTbTransitionsSeen = 0;
    pipelineHealth.voluntaryTbTransitionsGated = 0;
    pipelineHealth.activeStagedEvents = 0;
    pipelineHealth.finalizedHands = 0;
    pipelineHealth.finalizedStatsEvents = 0;
    pipelineHealth.confirmedMappedPlayers = confirmedSeatMappings.size;
    pipelineHealth.eligibleOverlayPlayers = 0;
    pipelineHealth.overlayElementsCreated = 0;
    pipelineHealth.overlayElementsAttached = 0;
    pipelineHealth.overlayElementsVisible = 0;
    pipelineHealth.overlayPlacementFailures = 0;
    tbTraceState = PokerTbTrace.createState();
    resetLiveActionTracker(true);
    websocketStatsSourceAvailable = false;
    fullLogDisplaySourceAvailable = false;
    interruptedHandRecoveryState = PokerInterruptedHandRecovery.createState(null);
    ownedHandReloadContinuityState = PokerOwnedHandReloadContinuity.createState(null);
    if (!preserveAuthoritativePause) hostControlTraceState = PokerHostControlTrace.createState(null);
    settlementOrderingDiagnostics = [];
    manualOverlayPositions = {};
    refreshShadowProfiles('session-reset', liveEvents);
    var update = {};
    update[STORAGE_KEYS.live] = [];
    update[STORAGE_KEYS.fingerprints] = [];
    update[STORAGE_KEYS.handSignatures] = [];
    update[STORAGE_KEYS.activeHand] = null;
    update[STORAGE_KEYS.finalizedHandIds] = [];
    update[STORAGE_KEYS.hostControl] = preserveAuthoritativePause ? PokerHostControlTrace.persistentSnapshot(hostControlTraceState) : null;
    update[STORAGE_KEYS.manualOverlayPositions] = {};
    update[STORAGE_KEYS.sessionMeta] = { gameId: pokerNowGameId, sessionKey: gameSessionKey, url: location.href, resetAt: Date.now(), updatedAt: Date.now() };
    queueAuthoritativeStorageSnapshot(update, function (storageError) {
      if (!ownsRuntimeController()) {
        sessionResetInProgress = false;
        if (resetCompletion) resetCompletion(new Error('superseded content controller'));
        return;
      }
      PokerSessionRuntime.observePersistedRevision(sessionPersistencePlanner, finalizedSessionRevision);
      sessionResetInProgress = false;
      console.log('[HUD] session reset', { gameId: pokerNowGameId, storageNamespace: storageNamespace });
      traceFirstHandLifecycle('initialization', {
        event: 'Reset Session storage clear completed',
        previousSnapshotPresent: Boolean(previousGcSnapshot),
        previousHandId: previousGcSnapshot ? findHandIdentifier(previousGcSnapshot) : null,
        activeHand: cloneJson(PokerHandFinalization.activeHand(handAccounting)),
        finalizedHandIds: Array.from(handAccounting.finalizedHandIds),
        handSignatureCount: socketHandSignatures.size,
        mappingCount: socketPlayerNames.size,
        gateReady: firstHandLifecycle.ready
      });
      reconcileSeatOverlays('authoritative Session reset committed');
      scheduleSeatDiscovery('authoritative current-table reconciliation after Session reset');
      if (playerDashboardState.open && playerDashboardState.mode === 'session') {
        refreshPlayerDashboardSession();
        renderPlayerDashboard();
      }
      refreshHud();
      if (resetCompletion) resetCompletion(storageError || null);
    });
  }

  function refreshHud() {
    if (!ownsRuntimeController()) return;
    pipelineHealth.hudRefreshRequests += 1;
    chrome.storage.local.get(Object.values(STORAGE_KEYS), function (saved) {
      try {
        ensureUiShells(saved, 'refresh before full render');
        render(saved);
      } catch (error) {
        logInitializationError(error, { stage: 'refreshHud full renderer', savedDisplayMode: saved && saved[STORAGE_KEYS.displayMode] });
        try { ensureUiShells(saved || {}, 'full renderer exception fallback'); } catch (fallbackError) {
          abortUiBoot('render-fallback', 'hard fallback render also failed', fallbackError, { guardResult: true, missingSymbol: '', missingModule: '' });
          console.error('[HUD UI BOOT CONTEXT] original renderer error', error && (error.stack || error.message || error));
        }
      }
    });
  }

  function recordLine(line, source) {
    source = source || 'full-log';
    var normalizedLine = PokerNowParser.cleanLine(line);
    if (!normalizedLine) return;
    traceHandSource('parser-invocation', { source: source, historical: source === 'full-log' && backfillingFullLog, handLogOpen: handLogOpenState(), normalizedLine: normalizedLine.slice(0, 300), parserStateBefore: PokerNowParser.getState() });
    console.log('[HUD] new log line', normalizedLine);
    var parsed = PokerNowParser.parseLogLineDetailed(line);
    traceHandSource('parser-result', {
      source: source,
      sourceClassification: source === 'full-log' ? (backfillingFullLog ? 'full-log-parser' : 'hand-log-dom') : source,
      historical: source === 'full-log' && backfillingFullLog,
      rawHandId: parsed.handId || parsed.event && parsed.event.handId || null,
      parserReason: parsed.reason,
      rejected: parsed.rejected,
      event: parsed.event ? { player: parsed.event.player, action: parsed.event.action, street: parsed.event.street, amount: parsed.event.amount } : null,
      handLogOpen: handLogOpenState()
    });
    console.log('[HUD] parser trace', {
      rawLine: line,
      normalizedLine: normalizedLine,
      parserResult: parsed.event,
      rejected: parsed.rejected,
      rejectionReason: parsed.reason
    });
    console.log('[HUD] source: ' + source);
    if (source === 'full-log') {
      var ownershipDecision = PokerHandLogDom.statsOwnershipDecision();
      traceHandSource('full-log-stats-withheld', {
        rawHandId: parsed.handId || parsed.event && parsed.event.handId || null,
        parserReason: parsed.reason,
        parsedEvent: parsed.event ? { player: parsed.event.player, action: parsed.event.action, street: parsed.event.street, amount: parsed.event.amount } : null,
        commitAttempted: ownershipDecision.commitAttempted,
        statsMutationAllowed: ownershipDecision.mutateStats,
        owner: ownershipDecision.owner,
        rejectionReason: ownershipDecision.reason
      });
      console.log('[HUD FULL LOG] stats mutation withheld', ownershipDecision);
      return { parsed: parsed, ownershipDecision: ownershipDecision };
    }
    if (!parsed.event) {
      console.log('[HUD] action rejected: ' + parsed.reason, { rawLine: line, normalizedLine: normalizedLine });
      return null;
    }
    if (parsed.roster && parsed.roster.length && !parsed.playerNameMatched) {
      console.log('[HUD] action rejected: player name does not exactly match dealt-in roster', {
        player: parsed.event.player,
        roster: parsed.roster,
        rawLine: line
      });
      return null;
    }
    pipelineEventCreated(parsed.event, source, 'text log parser emitted an action');
    return acceptHandEvent(parsed.event, line, source, parsed);
  }

  function acceptHandEvent(handEvent, rawLine, source, parserMetadata) {
    console.log('[HUD] action parsed', handEvent);
    if (source === 'websocket' && !websocketStatsSourceAvailable) { websocketStatsSourceAvailable = true; refreshHud(); }
    if (source === 'full-log' && !fullLogDisplaySourceAvailable) { fullLogDisplaySourceAvailable = true; refreshHud(); }
    if (parserMetadata) console.log('[HUD] player name exact match', { player: handEvent.player, roster: parserMetadata.roster || [], matched: parserMetadata.playerNameMatched });
    var fingerprint = eventFingerprint(handEvent, rawLine);
    if (capturedFingerprints.has(fingerprint)) {
      setPipelineFailure('event rejected before stage 7: duplicate event fingerprint', { fingerprint: fingerprint, event: handEvent });
      console.log('[HUD] duplicate event fingerprint ignored', fingerprint);
      return null;
    }
    var semanticFingerprint = eventSemanticFingerprint(handEvent);
    if (capturedEventSemantics.has(semanticFingerprint)) {
      if (interruptedHandRecoveryState.recoverySucceeded && String(handEvent.handId) === String(interruptedHandRecoveryState.persistedHandId)) {
        interruptedHandRecoveryState.duplicateActionsSkipped += 1;
      }
      setPipelineFailure('event rejected before stage 7: duplicate semantic event', { semanticFingerprint: semanticFingerprint, event: handEvent });
      console.log('[HUD] duplicate semantic event ignored', semanticFingerprint);
      capturedFingerprints.add(fingerprint);
      return null;
    }
    capturedFingerprints.add(fingerprint);
    capturedEventSemantics.add(semanticFingerprint);
    console.log('[HUD] parsed:', rawLine);
    console.log('[HUD] parsed event', handEvent);
    var stagedResult = stageStatsEvent(handEvent, source);
    if (!stagedResult || (!stagedResult.staged && !stagedResult.duplicate)) {
      setPipelineFailure('event rejected before staging: ' + (stagedResult && stagedResult.reason || 'unknown staging failure'), handEvent);
      return null;
    }
    newlyDecodedEventCount += 1;
    if (source === 'self-test' || isInjectedTestEvent(handEvent)) pipelineHealth.injectedTestEvents += 1;
    else if (source === 'websocket' || source === 'full-log') pipelineHealth.realLiveEvents += 1;
    if (source === 'self-test' || isInjectedTestEvent(handEvent)) finalizeStatsHand(handEvent.handId, 'explicit HUD self-test event', handEvent.timestamp, { source: 'self-test', eventName: 'HUD self-test' });
    else if (stagedResult.staged) pipelineHealth.stagedStatRenderSkips += 1;
    console.log('[HUD] stats updated', { player: handEvent.player, stagedHandId: handEvent.handId, activeStagedEvents: pipelineHealth.activeStagedEvents, finalizedHands: pipelineHealth.finalizedHands, finalizedEventCount: liveEvents.length });
    return handEvent;
  }

  function eventFingerprint(event, line) {
    var normalizedLine = PokerNowParser.cleanLine(line).toLowerCase().replace(/\s+/g, ' ');
    return event.handId + '|' + normalizedLine;
  }

  function eventSemanticFingerprint(event) {
    return [event.handId, event.player, event.action, event.street, event.amount].join('|');
  }

  function isInjectedTestEvent(event) {
    return Boolean(event && (String(event.handId || '').indexOf('HUD-PIPELINE-SELF-TEST-') === 0 || event.player === 'HUD_TEST_PLAYER'));
  }

  function reconcileSocketHandId(realHandId) {
    if (!realHandId) return;
    var syntheticHandId = socketGameContext.handId;
    if (!syntheticHandId || String(syntheticHandId) === String(realHandId)) return;
    if (String(syntheticHandId).indexOf(pokerNowGameId + ':socket:') !== 0) {
      traceHandSource('hand-id-reconciliation-skipped', { syntheticHandId: syntheticHandId, realHandId: String(realHandId), reason: 'current socket hand ID is not synthetic' });
      socketGameContext.handId = String(realHandId);
      return;
    }
    var rewrites = 0;
    var finalizedIdentityChanged = Boolean(handAccounting && handAccounting.finalizedHandIds.has(String(syntheticHandId)));
    liveEvents = liveEvents.map(function (event) {
      if (String(event.handId) !== String(syntheticHandId)) return event;
      rewrites += 1;
      return Object.assign({}, event, { handId: String(realHandId) });
    });
    if (handAccounting) PokerHandFinalization.renameHand(handAccounting, syntheticHandId, String(realHandId));
    updateHandAccountingHealth();
    socketGameContext.handId = String(realHandId);
    socketHandSignatures.add(gameSessionKey + '|hand:' + realHandId);
    activeHandState = handAccounting ? PokerHandFinalization.activeHand(handAccounting) : null;
    capturedEventSemantics = new Set(liveEvents.concat(activeHandState ? activeHandState.events : []).map(eventSemanticFingerprint));
    if (rewrites || finalizedIdentityChanged) advanceFinalizedSessionRevision('authoritative hand identity correction');
    persistHandAccounting(null, 'authoritative hand identity correction');
    traceHandSource('hand-id-reconciled', { syntheticHandId: String(syntheticHandId), realHandId: String(realHandId), eventsRewritten: rewrites, historicalBackfill: backfillingFullLog, finalizedHandIds: handAccounting ? Array.from(handAccounting.finalizedHandIds) : [] });
    if (rewrites) console.log('[HUD] Full Log reconciled socket hand ID', { syntheticHandId: syntheticHandId, realHandId: realHandId, eventsRewritten: rewrites });
  }

  function discoverLocalHostIdentity(eventName, payload) {
    if (String(eventName || '').toLowerCase() !== 'registered' || !payload || typeof payload !== 'object') return;
    var currentPlayer = firstObjectByKeyPattern(payload, /^currentPlayer$/i);
    var localId = currentPlayer && (currentPlayer.id || currentPlayer._id || currentPlayer.playerId || currentPlayer.player_id);
    var ownerId = findFirstScalarByKeys(payload, ['ownerID', 'ownerId', 'owner_id']);
    if (localId !== undefined && localId !== null && localId !== '<D>') {
      localUserPlayerId = String(localId);
      localUserIdentityEvidence = { playerId: localUserPlayerId, source: 'registered.currentPlayer.id', automatic: true, verifiedAt: Date.now(), eventName: String(eventName) };
      refreshPotOddsFromLedger('canonical self identity discovered');
      if (playerDashboardState.open) {
        playerDashboardState.selfPlayerId = localUserPlayerId;
        if (playerDashboardState.mode === 'career') loadPlayerDashboardCareer();
        else { refreshPlayerDashboardSession(); renderPlayerDashboard(); }
      }
    }
    if (ownerId !== undefined && ownerId !== null && ownerId !== '<D>') tableOwnerPlayerId = String(ownerId);
    hostControlTraceState.localUserIsVerifiedHost = Boolean(
      localUserPlayerId && tableOwnerPlayerId && localUserPlayerId === tableOwnerPlayerId
    );
    console.log('[HUD HOST CONTROL] local host identity', {
      eventName: eventName,
      localUserPlayerId: localUserPlayerId,
      tableOwnerPlayerId: tableOwnerPlayerId,
      localUserIsVerifiedHost: hostControlTraceState.localUserIsVerifiedHost
    });
  }

  function persistRecognizedHostCommand(record) {
    if (!ownsRuntimeController()) return;
    var command = record && record.recognizedCommand;
    if (!record || !record.localUserIsVerifiedHost || !record.appearsTableControl || !command) return false;
    var timestamp = Number(record.timestamp || Date.now());
    var application = PokerHostControlTrace.applyRecognizedCommand(hostControlTraceState, record, timestamp);
    if (!application.applied) return false;
    var active = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    var previousRevision = Number(active && active.recoveryMetadata && active.recoveryMetadata.pausePersistenceRevision || 0);
    var nextCommandPersistenceRevision = previousRevision + (application.changed ? 1 : 0);
    hostControlTraceState.commandPersistenceRequestedAt = Date.now();
    record.authoritativeApplication = cloneJson(application);
    record.persistenceReason = command === 'pause'
      ? 'verified-host-outgoing-up-established-authoritative-pause'
      : 'verified-host-outgoing-ur-established-authoritative-resume';
    var result = reconcileHudRuntimeStatus({
      timestamp: timestamp,
      tableClassification: command === 'pause' ? 'paused' : 'resumed',
      lifecycleConfidence: 'verified-host-outgoing-command',
      lifecycleEvidence: { verifiedHostOutgoingCommand: application.evidence },
      verifiedInactiveReason: command === 'pause' ? 'verified outgoing host UP Pause command' : null,
      verifiedActiveReason: command === 'resume' ? 'verified outgoing host UR Resume command' : null,
      gamePaused: command === 'pause',
      authoritativePauseState: application.nextState,
      authoritativePauseEvidence: application.evidence,
      localLifecycleCommand: hostControlTraceState.activeLocalCommand,
      pauseStatusTrigger: {
        eventType: record.recognizerBranch,
        snapshotFingerprint: record.payloadFingerprint,
        rawPauseRelatedFields: record.primitiveCommandFields || []
      },
      reason: record.persistenceReason
    });
    record.resultingRuntimeStatus = result.status;
    record.precedenceBranch = result.precedenceBranch;
    if (active) {
      PokerHandFinalization.setRecoveryMetadata(handAccounting, active.handId, {
        fingerprint: interruptedHandFingerprint(previousGcSnapshot || {}),
        pausedVerified: command === 'pause',
        localPauseCommandObserved: command === 'pause' || Boolean(active.recoveryMetadata && active.recoveryMetadata.localPauseCommandObserved),
        pauseCommandTimestamp: command === 'pause' ? timestamp : active.recoveryMetadata && active.recoveryMetadata.pauseCommandTimestamp || null,
        resumeCommandTimestamp: command === 'resume' ? timestamp : active.recoveryMetadata && active.recoveryMetadata.resumeCommandTimestamp || null,
        pauseCommandPayloadFingerprint: record.payloadFingerprint,
        lifecycleAtPersistence: command === 'pause' ? 'paused-verified-host-command' : 'active-after-verified-host-resume',
        pausePersistenceRevision: nextCommandPersistenceRevision,
        persistenceRequestedAt: hostControlTraceState.commandPersistenceRequestedAt,
        authoritativePauseTimestamp: command === 'pause' ? timestamp : active.recoveryMetadata && active.recoveryMetadata.authoritativePauseTimestamp || null,
        authoritativeResumeTimestamp: command === 'resume' ? timestamp : active.recoveryMetadata && active.recoveryMetadata.authoritativeResumeTimestamp || null,
        authoritativePauseEvidence: application.evidence,
        timestamp: timestamp
      });
    }
    if (command === 'pause' && active) {
      pausePersistenceDiagnostics.activeHandPresentAtPause = true;
      pausePersistenceDiagnostics.handId = String(active.handId);
      pausePersistenceDiagnostics.pauseVerifiedAt = timestamp;
      pausePersistenceDiagnostics.persistenceRequestedAt = hostControlTraceState.commandPersistenceRequestedAt;
      pausePersistenceDiagnostics.persistenceCompletedAt = null;
      pausePersistenceDiagnostics.persistenceError = null;
      pausePersistenceDiagnostics.persistedPausedVerified = true;
      pausePersistenceDiagnostics.persistedLifecycle = 'paused-verified-host-command';
      pausePersistenceDiagnostics.persistedRevision = nextCommandPersistenceRevision;
    }
    var completePersistence = function (error) {
      if (!ownsRuntimeController()) return;
      hostControlTraceState.commandPersistenceCompletedAt = Date.now();
      if (command === 'pause') {
        pausePersistenceDiagnostics.persistenceCompletedAt = hostControlTraceState.commandPersistenceCompletedAt;
        pausePersistenceDiagnostics.persistenceError = error ? String(error.message || error) : null;
      }
      var currentActive = handAccounting && PokerHandFinalization.activeHand(handAccounting);
      if (currentActive && active && String(currentActive.handId) === String(active.handId)) {
        PokerHandFinalization.setRecoveryMetadata(handAccounting, currentActive.handId, {
          commandPersistenceCompletedAt: hostControlTraceState.commandPersistenceCompletedAt,
          commandPersistenceError: error ? String(error.message || error) : null,
          timestamp: hostControlTraceState.commandPersistenceCompletedAt
        });
        persistHandAccounting();
      } else persistHostControlState();
      if (error) console.error('[HUD HOST CONTROL] command persistence failed', { command: command, error: String(error.message || error) });
      console.log('[HUD HOST CONTROL] verified command persisted', {
        command: command,
        commandType: record.commandType,
        frameId: record.frameId,
        changed: application.changed,
        handId: active && active.handId || null,
        requestedAt: hostControlTraceState.commandPersistenceRequestedAt,
        completedAt: hostControlTraceState.commandPersistenceCompletedAt,
        runtimeStatus: hudRuntimeStatusState.displayedStatus,
        error: error ? String(error.message || error) : null
      });
    };
    if (active) persistHandAccounting(completePersistence);
    else persistHostControlState(completePersistence);
    return true;
  }
  // This is the sole production path for exact verified-host UP/UR commands.
  // Host-control UI clicks and marker captures remain diagnostic corroboration only.
  function recordOutgoingHostControl(frame, packet) {
    var record = PokerHostControlTrace.record(hostControlTraceState, {
      frameId: frame.frameId,
      timestamp: Number(frame.capturedAt || Date.now()),
      eventName: packet.eventName,
      namespace: packet.namespace,
      direction: frame.direction,
      payload: packet.payload,
      localUserPlayerId: localUserPlayerId,
      tableOwnerPlayerId: tableOwnerPlayerId,
      immediatelyAfterPauseOrResumeClick: lastHostControlUiClick && Date.now() - lastHostControlUiClick.timestamp <= 2000
        ? cloneJson(lastHostControlUiClick)
        : null
    });
    console.log('[HUD HOST CONTROL] outgoing command', record);
    record.persistenceApplied = persistRecognizedHostCommand(record);
    return record;
  }

  function confirmLocalResumeFromProgression(changedPaths, transitionRecord) {
    if (hostControlTraceState.activeLocalCommand !== 'resume-pending-confirmation') return false;
    var progression = (changedPaths || []).filter(function (change) {
      return /(?:^|\.)(?:tB|cPI|pITT|cRPI|iHPI|pot|gameResult|board|communityCards|players?\.[^.]+\.(?:stack|status))(?=\.|$)/i.test(String(change.path || ''));
    });
    if (!progression.length) return false;
    hostControlTraceState.activeLocalCommand = null;
    var active = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    if (active) {
      PokerHandFinalization.setRecoveryMetadata(handAccounting, active.handId, {
        lifecycleAtPersistence: 'active-after-local-resume',
        localResumeConfirmedAt: transitionRecord.timestamp,
        localResumeProgressionPaths: progression.slice(0, 20).map(function (change) { return change.path; }),
        timestamp: transitionRecord.timestamp
      });
    }
    persistHandAccounting();
    console.log('[HUD HOST CONTROL] Resume confirmed by incoming game progression', {
      frameId: currentSocketFrameContext && currentSocketFrameContext.frameId || null,
      patchRecordId: transitionRecord.id,
      progressionPaths: progression.slice(0, 20).map(function (change) { return change.path; })
    });
    return true;
  }

  function reconcileAuthoritativeSocketLifecycleControl(frame, packet) {
    if (!ownsRuntimeController()) return;
    var signal = PokerNowLifecycleSignal.authoritativeControl(packet.eventName, packet.payload, frame.direction);
    if (!signal) return null;
    var paused = signal.classification === 'paused';
    var authoritativeState = paused ? 'paused' : 'resumed';
    var previousAuthoritativeState = hostControlTraceState.authoritativePauseState || null;
    var authoritativeEvidence = Object.assign({}, signal, {
      frameId: frame.frameId,
      timestamp: Number(frame.capturedAt || Date.now()),
      eventName: packet.eventName,
      source: 'authoritative-socket-lifecycle-control',
      previousAuthoritativePauseState: previousAuthoritativeState,
      nextAuthoritativePauseState: authoritativeState,
      transitionChanged: previousAuthoritativeState !== authoritativeState
    });
    hostControlTraceState.authoritativePauseState = authoritativeState;
    hostControlTraceState.authoritativePauseEvidence = cloneJson(authoritativeEvidence);
    if (previousAuthoritativeState !== authoritativeState) hostControlTraceState.authoritativeTransitionCount += 1;
    if (!paused) hostControlTraceState.activeLocalCommand = null;
    var result = reconcileHudRuntimeStatus({
      timestamp: Date.now(),
      tableClassification: paused ? 'paused' : 'resumed',
      lifecycleConfidence: signal.confidence,
      lifecycleEvidence: { authoritativeSocketControl: signal },
      verifiedInactiveReason: paused ? signal.reason : null,
      verifiedActiveReason: paused ? null : signal.reason,
      gamePaused: paused,
      authoritativePauseState: authoritativeState,
      authoritativePauseEvidence: authoritativeEvidence,
      localLifecycleCommand: hostControlTraceState.activeLocalCommand,
      pauseStatusTrigger: {
        eventType: 'incoming-socket-lifecycle-control:' + packet.eventName,
        snapshotFingerprint: stableHash(JSON.stringify(packet.payload || {})),
        rawPauseRelatedFields: signal.currentPatchEvidence || []
      },
      reason: signal.reason
    });
    persistHostControlState();
    console.log('[HUD LIFECYCLE] authoritative room-owner control', {
      frameId: frame.frameId,
      eventName: packet.eventName,
      signal: signal,
      runtimeStatus: result.status,
      precedenceBranch: result.precedenceBranch
    });
    return signal;
  }

  function currentEffectivePauseState() {
    if (hudRuntimeStatusState.authoritativePauseState === 'paused') return 'paused';
    if (hudRuntimeStatusState.authoritativePauseState === 'resumed') return 'resumed';
    if (hostControlTraceState.activeLocalCommand === 'paused-local-command') return 'paused';
    if (hostControlTraceState.activeLocalCommand === 'resume-pending-confirmation') return 'resume-pending';
    return null;
  }

  function beginRawPauseLifecycleFrame(frame, transport) {
    if (!pauseLifecycleCaptureEnabled) return null;
    var record = PokerPauseLifecycleCapture.recordFrame(pauseLifecycleCaptureState, {
      frameId: frame.frameId,
      timestamp: Date.now(),
      transportDirection: frame.direction,
      engineIoPacketType: transport.engineIoPacketType,
      socketIoPacketType: transport.socketIoPacketType,
      namespace: transport.namespace,
      eventName: transport.eventName,
      decodedSuccessfully: transport.decodedSuccessfully,
      rawFrame: frame.data || '',
      websocketHookInstanceId: frame.hookInstanceId
    });
    if (record) {
      record.previousPersistedPauseState = currentEffectivePauseState();
      pauseCaptureFrameRecords.set(frame.frameId, record);
    }
    return record;
  }

  function completeRawPauseLifecycleFrame(frame, transport, packet, recognizer, reason) {
    if (!pauseLifecycleCaptureEnabled) return null;
    var record = pauseCaptureFrameRecords.get(frame.frameId);
    if (!record) record = beginRawPauseLifecycleFrame(frame, transport);
    if (!record) return null;
    var branchName = recognizer && recognizer.recognizerBranch || null;
    var branch = recognizer && (
      recognizer.recognizedCommand ||
      recognizer.classification ||
      recognizer.normalizedSignal && recognizer.normalizedSignal.classification
    ) || null;
    if (branch === 'paused') branch = 'pause';
    if (branch === 'resumed') branch = 'resume';
    if (branch !== 'pause' && branch !== 'resume') branch = null;
    var root = document.getElementById(detailsRootId);
    var elements = resolveHudRuntimeStatusElements(root);
    var badge = elements.badge;
    var note = elements.footer;
    var presentation = hudRuntimePresentation(hudRuntimeStatusState.displayedStatus);
    var warningCount = pauseLifecycleCaptureState.warnings.length;
    PokerPauseLifecycleCapture.completeFrame(pauseLifecycleCaptureState, record, {
      socketIoPacketType: transport.socketIoPacketType || packet && socketPacketName(packet.socketType),
      namespace: packet && packet.namespace || transport.namespace,
      eventName: packet && packet.eventName || transport.eventName,
      decodedSuccessfully: Boolean(packet || transport.controlPacket && transport.decodedSuccessfully),
      decodedArgumentList: packet ? packet.rawPayload : null,
      recognizerMatched: Boolean(branch),
      recognizerBranch: branch,
      recognizerBranchName: branchName,
      normalizedLifecycleSignal: recognizer && (recognizer.normalizedSignal || recognizer) || null,
      previousPersistedPauseState: record.previousPersistedPauseState,
      nextPersistedPauseState: currentEffectivePauseState(),
      persistenceReason: reason || (branch ? 'recognizer matched' : 'no lifecycle recognizer matched'),
      runtimeStatusInputsAfterProcessing: PokerHudRuntimeStatus.snapshot(hudRuntimeStatusState),
      selectedStatus: hudRuntimeStatusState.displayedStatus,
      renderedBadgeText: badge && badge.textContent || presentation.label,
      renderedFooterText: note && note.textContent || presentation.note
    });
    logNewPauseCaptureWarnings(warningCount);
    pauseCaptureFrameRecords.delete(frame.frameId);
    return record;
  }

  function handlePageBridgeMessage(messageEvent) {
    if (!ownsRuntimeController()) return;
    try {
      if (messageEvent.source !== window || messageEvent.origin !== location.origin) return;
      var frame = messageEvent.data;
      if (frame && frame.source === 'pokernow-stats-hud-board-companion-page' && frame.type === 'board-companion-diagnostic-request') {
        var requestId = String(frame.requestId || '').slice(0, 120);
        var method = String(frame.method || '');
        var diagnosticValue = null;
        var diagnosticError = null;
        try {
          if (method === 'layoutInfo') diagnosticValue = boardCompanionDebugApi.layoutInfo();
          else if (method === 'captureLayoutSnapshot') diagnosticValue = boardCompanionDebugApi.captureLayoutSnapshot();
          else if (method === 'eventHistory') diagnosticValue = boardCompanionDebugApi.eventHistory();
          else throw new Error('unsupported read-only BoardCompanion diagnostic method');
        } catch (error) {
          diagnosticError = String(error && error.message || error || 'diagnostic request failed').slice(0, 240);
        }
        if (diagnosticValue && typeof diagnosticValue === 'object') {
          diagnosticValue = JSON.parse(JSON.stringify(diagnosticValue, function (key, value) {
            return /^(?:tableId|playerId|playerName|name|holeCards|cards|chat|token|authorization|cookie)$/i.test(String(key || '')) ? undefined : value;
          }));
        }
        window.postMessage({
          source: 'pokernow-stats-hud-board-companion-content',
          type: 'board-companion-diagnostic-response',
          requestId: requestId,
          method: method,
          ok: !diagnosticError,
          value: diagnosticValue,
          error: diagnosticError
        }, location.origin);
        return;
      }
      if (!frame || frame.source !== 'pokernow-stats-hud-main') return;
      if (frame.type === 'pause-diagnostic-event') {
        if (pauseLifecycleCaptureEnabled && frame.entry) {
          PokerPauseDiagnosticCapture.recordEntry(pauseDiagnosticCaptureState, Object.assign({}, frame.entry, { payloadDetails: frame.entry.payload }));
          if (pauseDiagnosticCaptureState.pendingMarker) PokerPauseDiagnosticCapture.recordActivation(pauseDiagnosticCaptureState, pauseDiagnosticCaptureState.pendingMarker.checkpointId, 'transport-only', { api: frame.entry.api, direction: frame.entry.direction, eventType: frame.entry.eventType || null }, frame.entry.timestamp || Date.now());
        }
        return;
      }
      if (frame.type === 'pause-diagnostic-socket') {
        if (pauseLifecycleCaptureEnabled && frame.socket) {
          var importedSocket = PokerPauseDiagnosticCapture.recordSocket(pauseDiagnosticCaptureState, frame.socket);
          var lifecycle = frame.socket.lifecycle || [];
          var latest = lifecycle.length ? lifecycle[lifecycle.length - 1] : null;
          var duplicate = latest && importedSocket && importedSocket.lifecycle.some(function (item) { return item.type === latest.type && item.timestamp === latest.timestamp; });
          if (latest && !duplicate) PokerPauseDiagnosticCapture.recordSocket(pauseDiagnosticCaptureState, Object.assign({}, frame.socket, { lifecycleType: latest.type, timestamp: latest.timestamp, code: latest.code, reason: latest.reason, wasClean: latest.wasClean }));
        }
        return;
      }
      if (frame.type === 'websocket-hook-status') {
        PokerPauseLifecycleCapture.setHookInstance(pauseLifecycleCaptureState, frame.hookInstanceId);
        pauseDiagnosticCaptureState.instances.websocketHookInstanceId = frame.hookInstanceId || null;
        pipelineHealth.hookInstalled = Boolean(frame.installed);
        pipelineHealth.websocketHookInstallationCount = Math.max(pipelineHealth.websocketHookInstallationCount, Number(frame.hookInstallationCount || 0));
        pipelineHealth.framesCaptured = Math.max(pipelineHealth.framesCaptured, Number(frame.framesCaptured || 0));
        updateHealthPanel();
        console.log('[HUD] websocket hook health confirmed', { installed: pipelineHealth.hookInstalled });
        reconcileHudRuntimeStatus({ socketHookInstalled: pipelineHealth.hookInstalled, socketHookStatusObserved: true, reason: pipelineHealth.hookInstalled ? 'socket-hook-installed' : 'socket-hook-unavailable' });
        traceFirstHandLifecycle('initialization', { event: 'websocket hook status received', installed: pipelineHealth.hookInstalled, framesCaptured: pipelineHealth.framesCaptured, timestampName: 'websocketHookConfirmedAt' });
        return;
      }
      if (frame.type !== 'websocket-frame') return;
      PokerPauseLifecycleCapture.setHookInstance(pauseLifecycleCaptureState, frame.hookInstanceId);
      var startupHold = PokerFirstHandLifecycle.holdFrame(firstHandLifecycle, frame, Date.now());
      if (startupHold.queued) {
        pipelineHealth.queuedFrameCount += 1;
        updateHealthPanel();
        traceHandSource('startup-frame-queued', { frameId: frame.frameId, direction: frame.direction, queuedCount: startupHold.queuedCount });
        console.log('[HUD FIRST HAND TRACE]', {
          startupType: firstHandLifecycle.currentTrace && firstHandLifecycle.currentTrace.startupType,
          category: 'initialization',
          details: { event: 'frame held before storage readiness', frameId: frame.frameId, direction: frame.direction, queuedCount: startupHold.queuedCount }
        });
        return;
      }
      var processedFrameFingerprint = stableHash([frame.frameId, frame.direction, frame.socketUrl, frame.dataType, String(frame.data || ''), JSON.stringify(frame.binaryBytes || null)].join('|'));
      if (processedFrameFingerprints.has(processedFrameFingerprint)) {
        pipelineHealth.duplicateFrameFingerprintCount += 1;
        updateHealthPanel();
        traceHandSource('duplicate-frame-fingerprint-observed', { frameId: frame.frameId, direction: frame.direction, fingerprint: processedFrameFingerprint, initializationReplayActive: initializationReplayActive });
      } else {
        processedFrameFingerprints.add(processedFrameFingerprint);
      }
      pipelineHealth.framesCaptured = Math.max(pipelineHealth.framesCaptured, Number(frame.framesCaptured || 0));
      pipelineHealth.framesRelayed += 1;
      pipelineHealth.framesReceived += 1;
      if (frame.direction === 'incoming') pipelineHealth.incomingFrames += 1;
      updateHealthPanel();
      console.log('[HUD PIPELINE 2] frame relayed', {
        frameId: frame.frameId,
        direction: frame.direction,
        socketUrl: frame.socketUrl,
        dataType: frame.dataType,
        data: frame.data
      });
      var rawFrame = String(frame.data || '');
      var transport = decodeTransportFrame(frame);
      pendingBinaryQueue.prune(Date.now());
      if (transport.binaryAttachment && pendingBinaryQueue.inspect().pendingPacketCount) {
        var pendingForFrame = pendingBinaryQueue.peek(frame, Date.now());
        if (pendingForFrame) {
          transport.eventName = pendingForFrame.packet.eventName;
          transport.namespace = pendingForFrame.packet.namespace;
          transport.socketIoPacketType = 'binary attachment for ' + socketPacketName(pendingForFrame.packet.socketType);
        }
      }
      logTransportFrame(frame, transport);
      beginRawPauseLifecycleFrame(frame, transport);
      if (transport.controlPacket) {
        console.log('[HUD TRANSPORT] Engine.IO control packet handled', { frameId: frame.frameId, type: transport.engineIoPacketType, rawPrefix: transport.rawPrefix });
        if (transport.engineIoPacketType === 'close') reconcileHudRuntimeStatus({ transportDisconnected: true, reason: 'socket-disconnected' });
        else if (transport.engineIoPacketType === 'open') reconcileHudRuntimeStatus({ transportDisconnected: false, reason: 'socket-connected' });
        completeRawPauseLifecycleFrame(frame, transport, null, null, 'Engine.IO control packet; not a Socket.IO lifecycle event');
        return;
      }
      var packet = transport.binaryAttachment ? consumeBinaryTransport(transport, frame) : transport.socketPacket;
      if (!transport.decodedSuccessfully || (!packet && !transport.binaryAttachment)) {
        setPipelineFailure('stage 3: Socket.IO packet could not be decoded', { frameId: frame.frameId, transport: transport, rawFrame: rawFrame });
        completeRawPauseLifecycleFrame(frame, transport, null, null, 'Socket.IO decoder failed');
        return;
      }
      if (transport.binaryAttachment && !packet) {
        var binaryQueueStatus = transport.binaryQueueStatus || { status: 'rejected', reason: 'binary attachment arrived without a pending Socket.IO binary packet' };
        if (binaryQueueStatus.status === 'rejected') setPipelineFailure('stage 3: ' + binaryQueueStatus.reason, { frameId: frame.frameId, byteLength: transport.binaryBytes.length, binaryQueue: pendingBinaryQueue.inspect() });
        completeRawPauseLifecycleFrame(frame, transport, null, null, binaryQueueStatus.status === 'pending' ? 'binary attachment retained for pending Socket.IO packet' : 'binary attachment rejected fail-closed');
        return;
      }
      console.log('[HUD PIPELINE 3] socket packet decoded', {
        frameId: frame.frameId,
        direction: frame.direction,
        packetPrefix: packet.prefix,
        socketPacketType: socketPacketName(packet.socketType),
        namespace: packet.namespace,
        attachmentsExpected: packet.attachmentsExpected,
        eventName: packet.eventName,
        payload: packet.payload
      });
      traceFirstHandLifecycle('initialization', {
        event: 'Socket.IO packet decoded during first-hand lifecycle',
        frameId: frame.frameId,
        direction: frame.direction,
        eventName: packet.eventName,
        timestampName: packet.eventName === 'registered' ? 'registeredSnapshotDecodedAt' : null,
        previousSnapshotPresent: Boolean(previousGcSnapshot),
        previousHandId: previousGcSnapshot ? findHandIdentifier(previousGcSnapshot) : null,
        activeHandId: handAccounting && handAccounting.activeHandId || null
      });
      if (!packet.wasCounted) {
        pipelineHealth.packetsDecoded += 1;
        packet.wasCounted = true;
      }
      updateHealthPanel();
      if (packet.attachmentsExpected > 0 && !packet.completedFromBinary) {
        var binaryEnqueue = pendingBinaryQueue.enqueue(packet, frame, Date.now());
        if (!binaryEnqueue.accepted) {
          setPipelineFailure('stage 3: ' + binaryEnqueue.reason, { frameId: frame.frameId, attachmentsExpected: packet.attachmentsExpected, binaryQueue: pendingBinaryQueue.inspect() });
          completeRawPauseLifecycleFrame(frame, transport, packet, null, 'Socket.IO binary packet rejected fail-closed');
          return;
        }
        addDecodedEventName(packet.eventName, frame.frameId, { namespace: packet.namespace, socketPacketType: socketPacketName(packet.socketType), contributesToGameState: false, contributionReason: 'waiting for ' + packet.attachmentsExpected + ' binary attachment(s)' });
        if (frame.direction === 'incoming') {
          discoverSocketPlayers(packet.eventName, packet.payload);
          scheduleSeatInspections(packet.eventName);
        }
        completeRawPauseLifecycleFrame(frame, transport, packet, null, 'Socket.IO binary event awaiting attachment frames');
        return;
      }
      recordWalkDiagnosticTransportPacket(frame, packet);
      if (frame.direction !== 'incoming') {
        var outgoingHostControlRecord = recordOutgoingHostControl(frame, packet);
        PokerNowLifecycleSignal.recordEventName(rawLifecycleTraceState, {
          frameId: frame.frameId,
          timestamp: Date.now(),
          direction: frame.direction,
          eventName: packet.eventName
        });
        addDecodedEventName(packet.eventName, frame.frameId, { namespace: packet.namespace, socketPacketType: socketPacketName(packet.socketType), contributesToGameState: false, contributionReason: 'outgoing packet' });
        completeRawPauseLifecycleFrame(frame, transport, packet, outgoingHostControlRecord, outgoingHostControlRecord && outgoingHostControlRecord.persistenceReason || (outgoingHostControlRecord && outgoingHostControlRecord.candidateCommand ? outgoingHostControlRecord.rejectionReason : 'outgoing packet was not a recognized pause/resume control'));
        throttledLog('outgoing:' + packet.eventName, '[HUD] socket event ignored: outgoing client command ' + packet.eventName, 5000);
        return;
      }
      var reconnectReplay = packet.eventName === 'registered' && firstIncomingRegisteredSeen;
      if (packet.eventName === 'registered') firstIncomingRegisteredSeen = true;
      discoverLocalHostIdentity(packet.eventName, packet.payload);
      var authoritativeSocketControl = reconcileAuthoritativeSocketLifecycleControl(frame, packet);
      currentSocketFrameContext = {
        source: 'websocket',
        frameId: frame.frameId,
        eventName: packet.eventName,
        socketEventName: packet.eventName,
        namespace: packet.namespace,
        initializationReplay: initializationReplayActive,
        initialSnapshot: previousGcSnapshot === null,
        reconnectReplay: reconnectReplay,
        historical: false,
        authoritativeSocketControl: authoritativeSocketControl,
        settlementSummary: firstObjectByKeyPattern(packet.payload, /^(?:gameResult|game_result|settlement|results?|winners?)$/i)
      };
      traceHandSource('incoming-socket-event', { frameId: frame.frameId, eventName: packet.eventName, namespace: packet.namespace, initializationReplay: initializationReplayActive, initialSnapshot: currentSocketFrameContext.initialSnapshot, reconnectReplay: reconnectReplay, handLogOpen: handLogOpenState() });
      var rawTbTrace = PokerTbTrace.traceRaw(tbTraceState, packet.eventName, packet.payload, { frameId: frame.frameId, namespace: packet.namespace, socketPacketType: socketPacketName(packet.socketType) });
      pipelineHealth.rawTbTransitionsSeen = tbTraceState.rawTransitions;
      updateHealthPanel();
      console.log('[HUD TB TRACE] raw', rawTbTrace);
      var gameStateContribution = findGameStateContribution(packet.eventName, packet.payload);
      var rawLifecycleRecord = PokerNowLifecycleSignal.recordPatch(rawLifecycleTraceState, {
        frameId: frame.frameId,
        eventName: packet.eventName,
        timestamp: Date.now(),
        direction: frame.direction,
        payload: packet.payload,
        contribution: gameStateContribution,
        previousMergedState: previousGcSnapshot,
        classificationBefore: hudRuntimeStatusState.lifecycleClassification,
        statusBefore: hudRuntimeStatusState.displayedStatus
      });
      addDecodedEventName(packet.eventName, frame.frameId, {
        namespace: packet.namespace,
        socketPacketType: socketPacketName(packet.socketType),
        contributesToGameState: Boolean(gameStateContribution),
        contributionPath: gameStateContribution && gameStateContribution.path,
        contributionScore: gameStateContribution && gameStateContribution.score,
        completedFromBinary: Boolean(packet.completedFromBinary)
      });
      discoverSocketPlayers(packet.eventName, packet.payload);
      scheduleSeatInspections(packet.eventName);
      if (/^gc$/i.test(String(packet.eventName || ''))) {
        pipelineHealth.gcFramesReceived += 1;
        updateHealthPanel();
      }
      console.log('[HUD TRANSPORT] decoded event classification', {
        frameId: frame.frameId,
        eventName: packet.eventName,
        namespace: packet.namespace,
        socketPacketType: socketPacketName(packet.socketType),
        contributesToGameState: Boolean(gameStateContribution),
        contribution: gameStateContribution
      });
      var gameStateDiff = gameStateContribution ? processGcSnapshot(gameStateContribution.patch, {
        frameId: frame.frameId,
        eventName: packet.eventName,
        contributionPath: gameStateContribution.path,
        contributionScore: gameStateContribution.score,
        completedFromBinary: Boolean(packet.completedFromBinary)
      }) : { events: [], unchanged: false };
      var rawLifecycleCaptureRecognizer = (
        authoritativeSocketControl ||
        gameStateDiff.lifecycleSignal && /^(?:paused|resumed)$/.test(String(gameStateDiff.lifecycleSignal.classification || ''))
      ) ? (authoritativeSocketControl || gameStateDiff.lifecycleSignal) : null;
      completeRawPauseLifecycleFrame(
        frame,
        transport,
        packet,
        rawLifecycleCaptureRecognizer,
        rawLifecycleCaptureRecognizer ? 'incoming lifecycle recognizer result' : 'incoming packet produced no verified pause/resume signal'
      );
      if (gameStateDiff.unchanged) {
        throttledLog('state-unchanged', '[HUD] socket event ignored: unchanged game-state snapshot', 3000);
        currentSocketFrameContext = null;
        return;
      }
      console.log('[HUD] websocket frame', { direction: frame.direction, socketUrl: frame.socketUrl, dataType: frame.dataType, raw: rawFrame });
      console.log('[HUD] socket event name', packet.eventName);
      console.log('[HUD] socket payload object', packet.payload);
      if (PokerHudDiagnostics.enabled('deep')) {
        console.log('[HUD] socket payload full', JSON.stringify(packet.payload));
        console.log('[HUD] socket payload keys', listPayloadKeyPaths(packet.payload));
      }
      var decoded = decodePokerNowSocketEvent(packet.eventName, packet.payload);
      decoded.events = decoded.events.concat(gameStateDiff.events);
      var lifecycleOnlyPatch = Boolean(gameStateContribution && !decoded.lines.length && !decoded.events.length && !gameStateDiff.finalizeHandId);
      PokerNowLifecycleSignal.completePatch(rawLifecycleTraceState, rawLifecycleRecord, {
        classificationAfter: hudRuntimeStatusState.lifecycleClassification,
        statusAfter: hudRuntimeStatusState.displayedStatus,
        lifecycleOnly: lifecycleOnlyPatch,
        normalizedSignal: gameStateDiff.lifecycleSignal || null
      });
      console.log('[HUD] socket event classification', classifySocketEvent(packet.eventName, decoded));
      var parsedCount = 0;
      decoded.lines.forEach(function (line) {
        var event = recordLine(line, 'websocket');
        if (event) {
          parsedCount += 1;
          websocketStatsSourceAvailable = true;
          console.log('[HUD] websocket event parsed', event);
          console.log('[HUD] socket action decoded', event);
        }
      });
      decoded.events.forEach(function (event) {
        console.log('[HUD] source: websocket');
        pipelineEventCreated(event, 'websocket', 'decoded Socket.IO event or gc snapshot diff');
        var accepted = acceptHandEvent(event, JSON.stringify(event), 'websocket', null);
        if (accepted) {
          parsedCount += 1;
          websocketStatsSourceAvailable = true;
          console.log('[HUD] websocket event parsed', accepted);
          console.log('[HUD] socket action decoded', accepted);
        }
      });
      var settlementFinalizationResult = null;
      var settlementFinalizerCalled = false;
      var settlementOrderingTrace = gameStateDiff.settlementOrderingTraceId
        ? settlementOrderingDiagnostics.find(function (trace) { return trace.traceId === gameStateDiff.settlementOrderingTraceId; })
        : null;
      if (gameStateDiff.finalizeHandId) {
        settlementFinalizerCalled = true;
        if (settlementOrderingTrace) settlementOrderingTrace.finalizeAttemptedBeforeBoundary = true;
        settlementFinalizationResult = finalizeStatsHand(gameStateDiff.finalizeHandId, gameStateDiff.finalizeReason || 'socket settlement/gameResult', Date.now(), Object.assign({}, currentSocketFrameContext, {
          settlementSummary: gameStateDiff.settlementSummary || currentSocketFrameContext.settlementSummary,
          authoritativeHandId: gameStateDiff.authoritativeHandId || null,
          showdownFinalizationReady: true
        }));
        if (settlementFinalizationResult && settlementFinalizationResult.committed) PokerOwnedHandReloadContinuity.markFinalized(ownedHandReloadContinuityState, Date.now());
      }
      if (settlementOrderingTrace) {
        settlementOrderingTrace.finalizeResult = settlementFinalizationResult ? {
          committed: Boolean(settlementFinalizationResult.committed),
          duplicate: Boolean(settlementFinalizationResult.duplicate),
          discarded: Boolean(settlementFinalizationResult.discarded),
          reason: settlementFinalizationResult.reason || null
        } : {
          committed: false,
          provisional: Boolean(gameStateDiff.finalizationDeferredReason),
          reason: gameStateDiff.finalizationDeferredReason || 'no valid owned hand ID was available for settlement'
        };
        settlementOrderingTrace.handCountAfter = handAccounting ? handAccounting.finalizedHandIds.size : settlementOrderingTrace.handCountBefore;
        settlementOrderingTrace.boundaryEvaluationRanAfterFinalize = true;
        settlementOrderingTrace.boundaryEvaluationResult = {
          accepted: false,
          reason: 'a terminal settlement patch cannot also begin a new hand; await the next authoritative patch'
        };
      }
      if (gameStateDiff.settlementTraceId) {
        var completedSettlementTrace = PokerGameBreakLifecycle.completeSettlementEvaluation(gameBreakLifecycleState, gameStateDiff.settlementTraceId, {
          finalizeStatsHandCalled: settlementFinalizerCalled,
          derivedFinalizeHandId: gameStateDiff.finalizeHandId || null,
          result: settlementFinalizationResult ? {
            committed: Boolean(settlementFinalizationResult.committed),
            duplicate: Boolean(settlementFinalizationResult.duplicate),
            discarded: Boolean(settlementFinalizationResult.discarded),
            reason: settlementFinalizationResult.reason || null,
            addedEventCount: (settlementFinalizationResult.addedEvents || []).length
          } : null,
          accepted: Boolean(settlementFinalizationResult && settlementFinalizationResult.committed),
          exactReason: settlementFinalizerCalled
            ? (settlementFinalizationResult ? settlementFinalizationResult.reason || (settlementFinalizationResult.committed ? 'hand committed' : 'finalizer returned without commit') : 'finalizeStatsHand returned null')
            : gameStateDiff.finalizationDeferredReason
              ? 'settlement retained provisionally: ' + gameStateDiff.finalizationDeferredReason
              : 'settlement observed but socketGameContext.handId was null, so no finalizeHandId was derived'
        });
        console.log('[HUD RESUME SETTLEMENT]', completedSettlementTrace);
      }
      if (lifecycleOnlyPatch) {
        console.log('[HUD LIFECYCLE] authoritative lifecycle-only patch accepted', {
          frameId: frame.frameId,
          eventName: packet.eventName,
          signal: gameStateDiff.lifecycleSignal || rawLifecycleRecord.normalizedSignal
        });
      } else if (!decoded.lines.length && !decoded.events.length && !gameStateDiff.finalizeHandId) {
        setPipelineFailure('stage 6: decoded socket event contained no poker event', { eventName: packet.eventName, payload: packet.payload });
        console.log('[HUD] socket event ignored: ' + packet.eventName + ' contained no recognized hand-log or game-action data');
      } else if (!parsedCount) {
        setPipelineFailure('stage 7: emitted events were metadata or duplicates', { eventName: packet.eventName, events: decoded.events, lines: decoded.lines });
        console.log('[HUD] socket event ignored: decoded data was metadata or a duplicate');
      }
      currentSocketFrameContext = null;
    } catch (error) {
      setPipelineFailure('pipeline exception: ' + (error && (error.message || error)), error && (error.stack || error));
      console.error('[HUD] websocket frame processing error', error && (error.stack || error));
    }
  }

  function throttledLog(key, message, intervalMs) {
    var now = Date.now();
    var last = throttledLogTimes.get(key) || 0;
    if (now - last < intervalMs) return;
    throttledLogTimes.set(key, now);
    console.log(message);
  }

  function enginePacketName(type) {
    return { '0': 'open', '1': 'close', '2': 'ping', '3': 'pong', '4': 'message', '5': 'upgrade', '6': 'noop' }[String(type)] || 'unknown';
  }

  function socketPacketName(type) {
    return { '0': 'connect', '1': 'disconnect', '2': 'event', '3': 'ack', '4': 'connect_error', '5': 'binary_event', '6': 'binary_ack' }[String(type)] || null;
  }

  function decodeTransportFrame(frame) {
    var raw = String(frame.data || '');
    var binaryBytes = Array.isArray(frame.binaryBytes) ? frame.binaryBytes : null;
    if (!binaryBytes && /^b4/.test(raw)) {
      try {
        var binaryString = atob(raw.slice(2));
        binaryBytes = Array.from(binaryString).map(function (character) { return character.charCodeAt(0); });
      } catch (error) {}
    }
    if (binaryBytes && binaryBytes.length) {
      return {
        rawPrefix: binaryBytes.slice(0, 16).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join(' '),
        engineIoPacketType: 'binary message',
        socketIoPacketType: 'binary attachment',
        namespace: null,
        eventName: null,
        decodedSuccessfully: true,
        binaryAttachment: true,
        binaryBytes: binaryBytes
      };
    }
    var engineType = raw.charAt(0);
    var engineName = enginePacketName(engineType);
    var result = {
      rawPrefix: raw.slice(0, 80),
      engineIoPacketType: engineName,
      socketIoPacketType: null,
      namespace: null,
      eventName: null,
      decodedSuccessfully: engineName !== 'unknown',
      controlPacket: engineType !== '4',
      raw: raw
    };
    if (engineName === 'unknown') return result;
    if (engineType !== '4') {
      if (engineType === '0' && raw.length > 1) {
        try { result.enginePayload = JSON.parse(raw.slice(1)); } catch (error) { result.enginePayload = raw.slice(1); }
      }
      return result;
    }
    result.controlPacket = false;
    var socketPacket = decodeSocketIoMessage(raw.slice(1));
    if (!socketPacket) {
      result.decodedSuccessfully = false;
      return result;
    }
    result.socketPacket = socketPacket;
    result.socketIoPacketType = socketPacketName(socketPacket.socketType);
    result.namespace = socketPacket.namespace;
    result.eventName = socketPacket.eventName;
    result.decodedSuccessfully = true;
    return result;
  }

  function decodeSocketIoMessage(message) {
    if (!message || !/^[0-6]/.test(message)) return null;
    var cursor = 0;
    var socketType = message.charAt(cursor++);
    var attachments = 0;
    if (socketType === '5' || socketType === '6') {
      var attachmentMatch = message.slice(cursor).match(/^(\d+)-/);
      if (!attachmentMatch) return null;
      attachments = Number(attachmentMatch[1]);
      cursor += attachmentMatch[0].length;
    }
    var namespace = '/';
    if (message.charAt(cursor) === '/') {
      var commaIndex = message.indexOf(',', cursor);
      if (commaIndex < 0) {
        namespace = message.slice(cursor);
        cursor = message.length;
      } else {
        namespace = message.slice(cursor, commaIndex);
        cursor = commaIndex + 1;
      }
    }
    var ackStart = cursor;
    while (/\d/.test(message.charAt(cursor))) cursor += 1;
    var ackId = cursor > ackStart ? Number(message.slice(ackStart, cursor)) : null;
    var payloadText = message.slice(cursor);
    var decodedPayload = null;
    if (payloadText) {
      try { decodedPayload = JSON.parse(payloadText); } catch (error) { return null; }
    }
    var eventName = null;
    var payload = decodedPayload;
    if ((socketType === '2' || socketType === '5') && Array.isArray(decodedPayload)) {
      eventName = typeof decodedPayload[0] === 'string' ? decodedPayload[0] : null;
      payload = decodedPayload.length === 2 ? decodedPayload[1] : decodedPayload.slice(1);
    }
    return {
      socketType: socketType,
      namespace: namespace,
      ackId: ackId,
      attachmentsExpected: attachments,
      eventName: eventName || '(' + socketPacketName(socketType) + ')',
      payload: payload,
      rawPayload: decodedPayload,
      prefix: socketType + (attachments ? String(attachments) + '-' : '') + (namespace !== '/' ? namespace + ',' : '')
    };
  }

  function decodeBinaryValue(bytes) {
    var normalizedBytes = bytes.slice();
    if (normalizedBytes[0] === 4) normalizedBytes.shift();
    var textValue = '';
    try { textValue = new TextDecoder().decode(new Uint8Array(normalizedBytes)); } catch (error) {}
    var trimmed = textValue.trim();
    var jsonValue = null;
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      try { jsonValue = JSON.parse(trimmed); } catch (error) {}
    }
    if (jsonValue !== null) return jsonValue;
    var messagePackValue = tryDecodeMessagePack(normalizedBytes);
    return messagePackValue !== null ? messagePackValue : { binaryByteLength: normalizedBytes.length, utf8Preview: textValue.slice(0, 500), bytePrefix: normalizedBytes.slice(0, 32) };
  }

  function tryDecodeMessagePack(bytes) {
    if (!bytes.length) return null;
    var array = new Uint8Array(bytes);
    var view = new DataView(array.buffer, array.byteOffset, array.byteLength);
    var offset = 0;
    var decoder = new TextDecoder();
    function need(length) { if (offset + length > array.length) throw new Error('truncated MessagePack'); }
    function number(length, signed) {
      need(length);
      var value;
      if (length === 1) value = signed ? view.getInt8(offset) : view.getUint8(offset);
      else if (length === 2) value = signed ? view.getInt16(offset) : view.getUint16(offset);
      else if (length === 4) value = signed ? view.getInt32(offset) : view.getUint32(offset);
      else {
        var big = signed ? view.getBigInt64(offset) : view.getBigUint64(offset);
        value = Number(big);
      }
      offset += length;
      return value;
    }
    function string(length) { need(length); var value = decoder.decode(array.slice(offset, offset + length)); offset += length; return value; }
    function binary(length) { need(length); var value = Array.from(array.slice(offset, offset + length)); offset += length; return { binaryBytes: value, binaryByteLength: value.length }; }
    function list(length) { var result = []; for (var index = 0; index < length; index += 1) result.push(read()); return result; }
    function map(length) { var result = {}; for (var index = 0; index < length; index += 1) result[String(read())] = read(); return result; }
    function read() {
      need(1);
      var prefix = array[offset++];
      if (prefix <= 0x7f) return prefix;
      if (prefix >= 0xe0) return prefix - 0x100;
      if ((prefix & 0xe0) === 0xa0) return string(prefix & 0x1f);
      if ((prefix & 0xf0) === 0x90) return list(prefix & 0x0f);
      if ((prefix & 0xf0) === 0x80) return map(prefix & 0x0f);
      if (prefix === 0xc0) return null;
      if (prefix === 0xc2) return false;
      if (prefix === 0xc3) return true;
      if (prefix === 0xc4) return binary(number(1, false));
      if (prefix === 0xc5) return binary(number(2, false));
      if (prefix === 0xc6) return binary(number(4, false));
      if (prefix === 0xca) { need(4); var float32 = view.getFloat32(offset); offset += 4; return float32; }
      if (prefix === 0xcb) { need(8); var float64 = view.getFloat64(offset); offset += 8; return float64; }
      if (prefix === 0xcc) return number(1, false);
      if (prefix === 0xcd) return number(2, false);
      if (prefix === 0xce) return number(4, false);
      if (prefix === 0xcf) return number(8, false);
      if (prefix === 0xd0) return number(1, true);
      if (prefix === 0xd1) return number(2, true);
      if (prefix === 0xd2) return number(4, true);
      if (prefix === 0xd3) return number(8, true);
      if (prefix === 0xd9) return string(number(1, false));
      if (prefix === 0xda) return string(number(2, false));
      if (prefix === 0xdb) return string(number(4, false));
      if (prefix === 0xdc) return list(number(2, false));
      if (prefix === 0xdd) return list(number(4, false));
      if (prefix === 0xde) return map(number(2, false));
      if (prefix === 0xdf) return map(number(4, false));
      throw new Error('unsupported MessagePack prefix 0x' + prefix.toString(16));
    }
    try {
      var result = read();
      return offset === array.length ? result : null;
    } catch (error) {
      return null;
    }
  }

  function replaceBinaryPlaceholders(value, attachments) {
    if (!value || typeof value !== 'object') return value;
    if (!Array.isArray(value) && value._placeholder === true && typeof value.num === 'number') return attachments[value.num];
    if (Array.isArray(value)) return value.map(function (item) { return replaceBinaryPlaceholders(item, attachments); });
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = replaceBinaryPlaceholders(value[key], attachments); });
    return result;
  }

  function consumeBinaryTransport(transport, frame) {
    var consumed = pendingBinaryQueue.consume(
      decodeBinaryValue(transport.binaryBytes),
      transport.binaryBytes.length,
      frame,
      Date.now()
    );
    transport.binaryQueueStatus = consumed;
    if (consumed.status !== 'complete') return null;
    var packet = consumed.packet;
    packet.payload = replaceBinaryPlaceholders(packet.payload, packet.attachments);
    packet.rawPayload = replaceBinaryPlaceholders(packet.rawPayload, packet.attachments);
    delete packet.attachments;
    packet.completedFromBinary = true;
    return packet;
  }

  function logTransportFrame(frame, transport) {
    console.log('[HUD TRANSPORT]', {
      frameId: frame.frameId,
      direction: frame.direction,
      rawPrefix: transport.rawPrefix,
      engineIoPacketType: transport.engineIoPacketType,
      socketIoPacketType: transport.socketIoPacketType,
      namespace: transport.namespace,
      eventName: transport.eventName,
      decodedSuccessfully: transport.decodedSuccessfully
    });
  }

  function gameStateObjectScore(value, path, eventName) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
    var keys = Object.keys(value);
    var score = 0;
    if (value.players && typeof value.players === 'object') score += 8;
    var keyedPlayerRecords = keys.filter(function (key) {
      var record = value[key];
      return /^[a-zA-Z0-9_-]{6,}$/.test(key) && record && typeof record === 'object' && Object.keys(record).some(function (field) { return /^(?:stack|chips?|balance|bet|currentBet|folded|seat|position)$/i.test(field); });
    }).length;
    if (keyedPlayerRecords >= 2) score += 6;
    if (keys.some(function (key) { return /^(?:handId|hand_id|handNumber|hand_number|street|round|board|communityCards|community_cards|pot|potSize|dealerId|buttonId|currentPlayerId|turnPlayerId)$/i.test(key); })) score += 5;
    if (keys.some(function (key) { return /^(?:eventsData|gameResult|now|pre|sN|uP|mEV|fv)$/i.test(key); })) score += 2;
    if (/(?:^|\.)(?:gameState|game_state|tableState|table_state|snapshot|state|gc)$/i.test(path)) score += 3;
    if (/^(?:gc|gameState|game_state|tableState|table_state|state|snapshot|updateState|gameUpdate)$/i.test(eventName || '')) score += 4;
    return score;
  }

  function findGameStateContribution(eventName, payload) {
    var authoritativeLifecycleContribution = PokerNowLifecycleSignal.authoritativeContribution(eventName, payload);
    if (authoritativeLifecycleContribution) return authoritativeLifecycleContribution;
    var best = null;
    var seen = new WeakSet();
    function visit(value, path, depth) {
      if (!value || typeof value !== 'object' || depth > 9 || seen.has(value)) return;
      seen.add(value);
      if (!Array.isArray(value)) {
        var score = gameStateObjectScore(value, path, eventName);
        if (!best || score > best.score) best = { patch: value, path: path, score: score, reason: 'state-shaped object in ' + eventName };
        Object.keys(value).forEach(function (key) { visit(value[key], path + '.' + key, depth + 1); });
      } else {
        value.forEach(function (item, index) { visit(item, path + '[' + index + ']', depth + 1); });
      }
    }
    visit(payload, '$', 0);
    return best && best.score >= 6 ? best : null;
  }

  function decodePokerNowSocketEvent(eventName, payload) {
    var lines = [];
    var events = [];
    collectLogStrings(payload, lines, 0);
    var playerLookup = buildPlayerLookup(payload);
    playerLookup.forEach(function (name, id) { rememberPlayerMapping(id, name, 'socket event player/seat data'); });
    var context = {
      handId: findHandIdentifier(payload),
      street: normalizeStreet(findFirstScalarByKeys(payload, ['street', 'round', 'bettingRound', 'betting_round'])) || inferStreetFromBoard(payload)
    };
    if (context.handId !== undefined && context.handId !== null) socketGameContext.handId = context.handId;
    if (context.street) socketGameContext.street = context.street;
    collectStructuredEvents(payload, events, context, 0, playerLookup);
    if (eventName === 'gc') console.log('[HUD] gc decode context', { handId: context.handId, street: context.street, players: Array.from(playerLookup.entries()) });
    return { lines: Array.from(new Set(lines)), events: events };
  }

  function recordMergedStateTransition(incomingPatch, mergedSnapshot, changedPaths, metadata) {
    var timestamp = Date.now();
    var players = findPlayersMap(mergedSnapshot) || {};
    var record = {
      id: handTransitionDiagnostics.nextRecordId++,
      timestamp: timestamp,
      isoTime: new Date(timestamp).toISOString(),
      frameId: metadata.frameId || null,
      eventName: metadata.eventName || '(unknown)',
      contributionPath: metadata.contributionPath || '$',
      contributionScore: metadata.contributionScore || null,
      completedFromBinary: Boolean(metadata.completedFromBinary),
      changedPaths: cloneJson(changedPaths),
      mappedPlayers: Object.keys(players).map(function (playerId) {
        return { playerId: String(playerId), playerName: socketPlayerNames.get(String(playerId)) || null, knownFields: primitiveFields(players[playerId]) };
      }),
      incomingPatch: cloneJson(incomingPatch),
      mergedSnapshot: cloneJson(mergedSnapshot)
    };
    handTransitionDiagnostics.records.push(record);
    if (handTransitionDiagnostics.records.length > 300) handTransitionDiagnostics.records.shift();
    handTransitionDiagnostics.labels.forEach(function (label) {
      if (timestamp >= label.timestamp && timestamp <= label.timestamp + 5000 && !label.recordIds.includes(record.id)) label.recordIds.push(record.id);
    });
    return record;
  }

  function exactFieldRecords(payload, fieldNames) {
    var records = [];
    var wanted = new Set(fieldNames || []);
    function visit(value, path, depth) {
      if (!value || typeof value !== 'object' || depth > 9 || records.length >= 50) return;
      if (Array.isArray(value)) {
        value.forEach(function (item, index) { visit(item, path + '[' + index + ']', depth + 1); });
        return;
      }
      Object.keys(value).forEach(function (key) {
        var nextPath = path ? path + '.' + key : '$.' + key;
        if (wanted.has(key) && (typeof value[key] === 'string' || typeof value[key] === 'number' || value[key] === null)) {
          records.push({ path: nextPath, key: key, value: value[key], valueType: value[key] === null ? 'null' : typeof value[key] });
        }
        visit(value[key], nextPath, depth + 1);
      });
    }
    visit(payload, '', 0);
    return records;
  }

  function exactValueRecords(payload, fieldNames) {
    var records = [];
    var wanted = new Set(fieldNames || []);
    function visit(value, path, depth) {
      if (!value || typeof value !== 'object' || depth > 9 || records.length >= 80) return;
      if (Array.isArray(value)) {
        value.forEach(function (item, index) { visit(item, path + '[' + index + ']', depth + 1); });
        return;
      }
      Object.keys(value).forEach(function (key) {
        var nextPath = path ? path + '.' + key : '$.' + key;
        if (wanted.has(key)) records.push({ path: nextPath, key: key, value: cloneJson(value[key]) });
        visit(value[key], nextPath, depth + 1);
      });
    }
    visit(payload, '', 0);
    return records;
  }

  function recordWalkDiagnosticTransportPacket(frame, packet) {
    if (!packet) return;
    var payloadText = JSON.stringify(packet.payload || null);
    if (frame.direction !== 'outgoing' && !/(?:fold|check|call|raise|bet)/i.test(payloadText)) return;
    recentWalkDiagnosticTransportPackets.push({
      timestamp: Date.now(),
      frameId: frame.frameId,
      direction: frame.direction,
      eventName: packet.eventName,
      namespace: packet.namespace,
      associatedHandId: socketGameContext.handId ? String(socketGameContext.handId) : null,
      payload: cloneJson(packet.payload)
    });
    if (recentWalkDiagnosticTransportPackets.length > 100) recentWalkDiagnosticTransportPackets.shift();
  }

  function captureLiveWalkSnapshot(mergedSnapshot, incomingPatch, transitionRecord, handTransition) {
    var handId = socketGameContext.handId ? String(socketGameContext.handId) : null;
    var players = findPlayersMap(mergedSnapshot) || {};
    var rawBigBlindRecords = exactFieldRecords(mergedSnapshot, ['bBPI']);
    var rawSmallBlindRecords = exactFieldRecords(mergedSnapshot, ['sBPI']);
    var patchBigBlindRecords = exactFieldRecords(incomingPatch, ['bBPI']);
    var patchSmallBlindRecords = exactFieldRecords(incomingPatch, ['sBPI']);
    var rawDealerRecords = exactFieldRecords(mergedSnapshot, ['dealerId', 'dealer_id', 'dealerPlayerId', 'dealer_player_id', 'buttonId', 'button_id', 'buttonPlayerId', 'button_player_id', 'dealerSeat', 'dealer_seat', 'buttonSeat', 'button_seat']);
    var selectedBigBlind = findFirstScalarByKeys(mergedSnapshot, ['bBPI']);
    var selectedSmallBlind = findFirstScalarByKeys(mergedSnapshot, ['sBPI']);
    var normalizedBlindIdentity = Object.keys(players).map(function (playerId) {
      return {
        playerId: String(playerId),
        playerName: socketPlayerNames.get(String(playerId)) || null,
        blindType: PokerWalkDetection.blindTypeForPlayer(playerId, selectedSmallBlind, selectedBigBlind)
      };
    }).filter(function (item) { return item.blindType !== null; });
    var sample = {
      timestamp: transitionRecord.timestamp,
      recordId: transitionRecord.id,
      eventName: transitionRecord.eventName,
      contributionPath: transitionRecord.contributionPath,
      handBoundaryDetected: Boolean(handTransition && handTransition.detected),
      raw: {
        bBPI: rawBigBlindRecords,
        sBPI: rawSmallBlindRecords,
        patchBPI: patchBigBlindRecords,
        patchSPI: patchSmallBlindRecords,
        dealerOrButton: rawDealerRecords
      },
      selected: {
        bBPI: selectedBigBlind === undefined ? null : selectedBigBlind,
        sBPI: selectedSmallBlind === undefined ? null : selectedSmallBlind,
        dealerOrButton: findDealerOrButton(mergedSnapshot)
      },
      normalizedBlindIdentity: normalizedBlindIdentity,
      inHandPlayerIds: exactPlayerIdCollection(mergedSnapshot, 'iHPI'),
      actionStateRecords: exactValueRecords(mergedSnapshot, ['tB', 'iHPI', 'cPI', 'pITT', 'cRPI', 'bigBlindCheck']),
      terminalStateRecords: exactValueRecords(incomingPatch, ['gameResult', 'game_result', 'settlement', 'result', 'results', 'winners']),
      playerStates: Object.keys(players).map(function (playerId) { return { playerId: String(playerId), playerName: socketPlayerNames.get(String(playerId)) || null, fields: primitiveFields(players[playerId]) }; }),
      changedBlindPaths: (transitionRecord.changedPaths || []).filter(function (change) { return /(?:bBPI|sBPI|blind|dealer|button)/i.test(change.path); })
    };
    recentWalkBlindSamples.push(Object.assign({ associatedHandId: handId }, sample));
    if (recentWalkBlindSamples.length > 100) recentWalkBlindSamples.shift();
    if (!handId) return;
    var trace = liveWalkTraceByHand.get(handId) || { buildId: PNHUD_BUILD_ID, gameId: pokerNowGameId, handId: handId, samples: [] };
    var prior = trace.samples[trace.samples.length - 1];
    var signature = JSON.stringify({ raw: sample.raw, selected: sample.selected, normalized: sample.normalizedBlindIdentity });
    if (!prior || prior.signature !== signature || sample.handBoundaryDetected || sample.changedBlindPaths.length) {
      sample.signature = signature;
      trace.samples.push(sample);
      if (trace.samples.length > 60) trace.samples.shift();
    }
    trace.latest = sample;
    liveWalkTraceByHand.set(handId, trace);
    while (liveWalkTraceByHand.size > 20) liveWalkTraceByHand.delete(liveWalkTraceByHand.keys().next().value);
  }

  function statsIncrement(before, after) {
    return {
      hands: after.handsPlayed - before.handsPlayed,
      vpipHands: after.vpipHands - before.vpipHands,
      vpipOpportunities: after.vpipOpportunities - before.vpipOpportunities,
      pfrHands: after.pfrHands - before.pfrHands,
      pfrOpportunities: after.pfrOpportunities - before.pfrOpportunities
    };
  }

  function emitFinalizedWalkTrace(result, handId, reason) {
    if (!handAccounting) return null;
    var traceState = liveWalkTraceByHand.get(String(handId)) || { buildId: PNHUD_BUILD_ID, gameId: pokerNowGameId, handId: String(handId), samples: [], latest: null };
    var finalizedActions = handAccounting.finalizedEvents.filter(function (event) { return String(event.handId) === String(handId); });
    var stagedActions = result.hand && result.hand.events || [];
    var beforeEvents = handAccounting.finalizedEvents.filter(function (event) { return String(event.handId) !== String(handId); });
    var latest = traceState.latest || null;
    var rawBigBlind = latest && latest.selected.bBPI;
    var rawSmallBlind = latest && latest.selected.sBPI;
    var finalizedBigBlind = finalizedActions.find(function (event) { return event.action === 'blind' && event.blindType === 'big'; }) || null;
    var bigBlindPlayerId = finalizedBigBlind && finalizedBigBlind.playerId || (rawBigBlind !== null && rawBigBlind !== undefined ? String(rawBigBlind) : null);
    var bigBlindPlayerName = finalizedBigBlind && finalizedBigBlind.player || (bigBlindPlayerId ? socketPlayerNames.get(String(bigBlindPlayerId)) || null : null);
    var overlayMapping = bigBlindPlayerId ? confirmedSeatMappings.get(String(bigBlindPlayerId)) || null : null;
    var overlayPlayerName = overlayMapping && overlayMapping.name || bigBlindPlayerName;
    var socketRecord = bigBlindPlayerId ? identityDiagnostics.socketPlayers.get(String(bigBlindPlayerId)) || null : null;
    var domSeat = overlayMapping ? identityDiagnostics.domSeats.find(function (seat) { return seat.elementId === overlayMapping.seatElementId; }) || null : null;
    var participantNames = Array.from(new Set(finalizedActions.map(function (event) { return event.player; }).filter(Boolean)));
    var beforeStats = bigBlindPlayerName ? PokerStats.computePlayerStats(beforeEvents, bigBlindPlayerName) : null;
    var afterStats = bigBlindPlayerName ? PokerStats.computePlayerStats(handAccounting.finalizedEvents, bigBlindPlayerName) : null;
    var overlayStats = overlayPlayerName ? PokerStats.computePlayerStats(handAccounting.finalizedEvents, overlayPlayerName) : null;
    var walkResult = bigBlindPlayerName ? PokerWalkDetection.detectBigBlindWalk(finalizedActions, bigBlindPlayerName) : { applicable: false, isWalk: false, reason: 'no finalized Big Blind identity could be mapped to a player name' };
    var voluntaryActions = finalizedActions.filter(function (event) { return event.street === 'preflop' && (event.action === 'call' || event.action === 'bet' || event.action === 'raise'); });
    var bbVoluntaryActions = bigBlindPlayerName ? voluntaryActions.filter(function (event) { return event.player === bigBlindPlayerName; }) : [];
    var players = participantNames.map(function (playerName) {
      var eventWithId = finalizedActions.find(function (event) { return event.player === playerName && event.playerId; });
      var playerId = eventWithId && String(eventWithId.playerId) || Array.from(socketPlayerNames.entries()).find(function (entry) { return entry[1] === playerName; })?.[0] || null;
      var playerSocket = playerId ? identityDiagnostics.socketPlayers.get(String(playerId)) || null : null;
      var playerMapping = playerId ? confirmedSeatMappings.get(String(playerId)) || null : null;
      return {
        playerId: playerId,
        playerName: playerName,
        socketSeatIndex: playerSocket && playerSocket.seatIndex,
        socketOrderIndex: playerSocket && playerSocket.orderIndex,
        domSeatIdentifier: playerMapping && playerMapping.seatElementId,
        finalizedStats: PokerStats.computePlayerStats(handAccounting.finalizedEvents, playerName),
        walkDetectionResult: PokerWalkDetection.detectBigBlindWalk(finalizedActions, playerName)
      };
    });
    var trace = {
      buildId: PNHUD_BUILD_ID,
      extensionId: PNHUD_EXTENSION_ID,
      gameId: pokerNowGameId,
      handId: String(handId),
      finalizationReason: reason,
      finalizationPath: 'content.js applyHandCommitResult <- finalizeStatsHand or beginStatsHand <- PokerHandFinalization.commitHand',
      playerId: bigBlindPlayerId,
      playerName: bigBlindPlayerName,
      seatOrIndex: { socketSeatIndex: socketRecord && socketRecord.seatIndex, socketOrderIndex: socketRecord && socketRecord.orderIndex, domSeatIdentifier: overlayMapping && overlayMapping.seatElementId, domClockwiseIndex: domSeat && domSeat.clockwiseIndex },
      detectedDealerOrButton: latest && latest.selected.dealerOrButton,
      detectedSmallBlindPlayer: rawSmallBlind !== null && rawSmallBlind !== undefined ? { raw: rawSmallBlind, mappedName: socketPlayerNames.get(String(rawSmallBlind)) || null } : null,
      detectedBigBlindPlayer: rawBigBlind !== null && rawBigBlind !== undefined ? { raw: rawBigBlind, mappedName: socketPlayerNames.get(String(rawBigBlind)) || null } : null,
      rawBPI: traceState.samples.map(function (sample) { return { recordId: sample.recordId, eventName: sample.eventName, records: sample.raw.bBPI, patchRecords: sample.raw.patchBPI }; }),
      rawSPI: traceState.samples.map(function (sample) { return { recordId: sample.recordId, eventName: sample.eventName, records: sample.raw.sBPI, patchRecords: sample.raw.patchSPI }; }),
      normalizedBlindIdentity: latest && latest.normalizedBlindIdentity || [],
      stagedPreflopActions: stagedActions.filter(function (event) { return event.street === 'preflop'; }),
      finalizedActions: finalizedActions,
      anyPlayerVoluntarilyEnteredPot: voluntaryActions.length > 0,
      voluntaryPreflopActions: voluntaryActions,
      bigBlindTookVoluntaryAction: bbVoluntaryActions.length > 0,
      bigBlindVoluntaryActions: bbVoluntaryActions,
      settlementWalkEvaluation: traceState.settlementWalkEvaluation || null,
      walkDetectionResult: walkResult,
      walkRejectionReason: walkResult.isWalk ? null : walkResult.reason,
      statsBeforeCommit: beforeStats,
      incrementsApplied: beforeStats && afterStats ? statsIncrement(beforeStats, afterStats) : null,
      vpipNumeratorAndDenominatorChange: beforeStats && afterStats ? {
        numeratorBefore: beforeStats.vpipHands,
        numeratorAfter: afterStats.vpipHands,
        numeratorDelta: afterStats.vpipHands - beforeStats.vpipHands,
        denominatorBefore: beforeStats.vpipOpportunities,
        denominatorAfter: afterStats.vpipOpportunities,
        denominatorDelta: afterStats.vpipOpportunities - beforeStats.vpipOpportunities
      } : null,
      statsAfterCommit: afterStats,
      overlayProjection: {
        codePath: 'content.js reconcileSeatOverlays -> PokerStats.computePlayerStats(liveEvents, mapping.name) -> seatOverlay.js compactStatsLabel',
        sourceRepresentation: 'handAccounting.finalizedEvents via liveEvents',
        mappedPlayerName: overlayPlayerName,
        finalStatsObject: overlayStats,
        displayedVPIP: overlayStats && overlayStats.vpip,
        displayedPFR: overlayStats && overlayStats.pfr,
        compactLabel: overlayStats ? PokerSeatOverlay.compactStatsLabel(overlayStats) : null
      },
      players: players,
      mergedBlindStateSamples: traceState.samples,
      surroundingRawBlindSamples: recentWalkBlindSamples.slice(-40),
      surroundingSocketActionPackets: recentWalkDiagnosticTransportPackets.filter(function (packet) { return !packet.associatedHandId || packet.associatedHandId === String(handId); }).slice(-40)
    };
    completedWalkTraces.push(trace);
    if (completedWalkTraces.length > 20) completedWalkTraces.shift();
    console.log('[HUD WALK TRACE]', trace);
    return trace;
  }

  function recordFinalizedWalkTrace(result, handId, reason) {
    try {
      var trace = emitFinalizedWalkTrace(result, handId, reason);
      if (trace) walkTraceEmittedHandIds.add(String(handId));
    } catch (error) {
      var failureTrace = {
        buildId: PNHUD_BUILD_ID,
        extensionId: PNHUD_EXTENSION_ID,
        gameId: pokerNowGameId,
        handId: String(handId),
        finalizationReason: reason,
        traceInstrumentationError: String(error && (error.stack || error.message) || error),
        finalizedActions: handAccounting && handAccounting.finalizedEvents.filter(function (event) { return String(event.handId) === String(handId); }),
        surroundingSocketActionPackets: recentWalkDiagnosticTransportPackets.slice(-40),
        surroundingRawBlindSamples: recentWalkBlindSamples.slice(-40)
      };
      completedWalkTraces.push(failureTrace);
      if (completedWalkTraces.length > 20) completedWalkTraces.shift();
      console.error('[HUD WALK TRACE ERROR]', failureTrace);
    }
  }

  function firstObjectByKeyPattern(payload, pattern) {
    var found = null;
    function visit(value, depth) {
      if (found || !value || typeof value !== 'object' || depth > 8) return;
      Object.keys(value).forEach(function (key) {
        if (found) return;
        if (pattern.test(key) && value[key] && typeof value[key] === 'object') {
          found = value[key];
          return;
        }
        visit(value[key], depth + 1);
      });
    }
    visit(payload, 0);
    return found;
  }

  function firstValueByExactKey(payload, keyName) {
    var found;
    function visit(value, depth) {
      if (found !== undefined || !value || typeof value !== 'object' || depth > 8) return;
      if (Object.prototype.hasOwnProperty.call(value, keyName)) {
        found = value[keyName];
        return;
      }
      Object.keys(value).forEach(function (key) { visit(value[key], depth + 1); });
    }
    visit(payload, 0);
    return found;
  }

  function hasShowdownEvidence(payload) {
    var records = exactValueRecords(payload, ['showdown', 'isShowdown', 'showCards', 'shownCards', 'revealedCards']);
    return records.some(function (record) {
      var value = record.value;
      return value === true || (Array.isArray(value) && value.length > 0) || (value && typeof value === 'object' && Object.keys(value).length > 0);
    });
  }

  function inferCapturedSettlementFolds(previousSnapshot, currentSnapshot, incomingPatch, transitionRecord) {
    var handId = socketGameContext.handId ? String(socketGameContext.handId) : null;
    var stagedHand = handId && handAccounting && handAccounting.stagedHands[handId];
    if (!stagedHand) return [];
    var settlement = firstObjectByKeyPattern(incomingPatch, /^(?:gameResult|game_result|settlement|results?|winners?)$/i);
    if (!settlement) return [];
    var previousTbRecord = PokerTbTrace.preferredTb(previousSnapshot);
    var currentTbRecord = PokerTbTrace.preferredTb(currentSnapshot);
    var smallBlindPlayerId = findFirstScalarByKeys(currentSnapshot, ['sBPI']);
    var bigBlindPlayerId = findFirstScalarByKeys(currentSnapshot, ['bBPI']);
    var participantIds = Object.keys(stagedHand.participants || {}).map(function (name) { return stagedHand.participants[name].playerId; }).filter(function (playerId) { return playerId !== null && playerId !== undefined; }).map(String);
    var currentPlayers = findPlayersMap(currentSnapshot) || {};
    var playerNames = {};
    Object.keys(currentPlayers).forEach(function (playerId) { playerNames[playerId] = { name: socketPlayerNames.get(String(playerId)) || currentPlayers[playerId].name || null }; });
    var boardLength = findBoardLength(currentSnapshot);
    if (boardLength === null) boardLength = collectCardCollections(currentSnapshot).filter(function (collection) { return collection.kind === 'board'; }).reduce(function (total, collection) { return total + collection.length; }, 0);
    var walkEvaluation = PokerWalkDetection.evaluateSettlementWalk({
      handId: handId,
      street: socketGameContext.street,
      players: playerNames,
      participants: participantIds,
      smallBlindPlayerId: smallBlindPlayerId,
      bigBlindPlayerId: bigBlindPlayerId,
      previousTb: previousTbRecord && previousTbRecord.value || {},
      currentTb: currentTbRecord && currentTbRecord.value || {},
      stagedEvents: stagedHand.events || [],
      boardCardCount: boardLength,
      settlement: settlement,
      showdown: hasShowdownEvidence(incomingPatch),
      bigBlindCheck: firstValueByExactKey(currentSnapshot, 'bigBlindCheck') === true,
      timestamp: transitionRecord.timestamp
    });
    var traceState = liveWalkTraceByHand.get(handId);
    if (traceState) traceState.settlementWalkEvaluation = cloneJson(walkEvaluation);
    if (PokerHudDiagnostics.enabled('deep')) {
      console.log('[HUD WALK DECISION]', {
        handId: handId,
        dealtInPlayerIds: walkEvaluation.dealtInPlayerIds,
        eligiblePreflopPlayerIds: walkEvaluation.eligiblePreflopPlayerIds,
        foldSequence: walkEvaluation.foldSequence,
        voluntaryPreflopActions: walkEvaluation.voluntaryPreflopActions,
        detectedBigBlindPlayerId: walkEvaluation.bigBlindPlayerId,
        walkEligible: walkEvaluation.isWalk,
        reason: walkEvaluation.reason,
        missingFoldPlayerIds: walkEvaluation.missingFoldPlayerIds
      });
    }
    return walkEvaluation.inferredFolds;
  }

  // Merged WebSocket gC state is authoritative for production hand tracking;
  // Full Log and DOM observations remain display/diagnostic-only.
  function processGcSnapshot(payload, contributionMetadata) {
    if (!ownsRuntimeController()) return;
    if (!payload || typeof payload !== 'object') {
      setPipelineFailure('stage 4: gc payload is not an object', payload);
      throttledLog('gc-nonobject', '[HUD] socket event ignored: gc payload is not an object', 5000);
      return { events: [], unchanged: false };
    }
    var incomingPatch = cloneJson(payload);
    var previousSnapshot = previousGcSnapshot;
    var currentSnapshot = previousSnapshot ? PokerTbTrace.mergeSnapshot(previousSnapshot, incomingPatch) : cloneJson(incomingPatch);
    var previousMergedHandId = previousSnapshot ? findHandIdentifier(previousSnapshot) : null;
    var currentMergedHandId = findHandIdentifier(currentSnapshot);
    var mergedTbTrace = PokerTbTrace.traceMerge(tbTraceState, previousSnapshot, incomingPatch, currentSnapshot, { frameId: contributionMetadata && contributionMetadata.frameId, eventName: contributionMetadata && contributionMetadata.eventName, contributionPath: contributionMetadata && contributionMetadata.contributionPath });
    console.log('[HUD TB TRACE] merged', mergedTbTrace);
    pipelineHealth.snapshotsMerged += 1;
    pipelineHealth.gameStatePatchesMerged += 1;
    updateHealthPanel();
    console.log('[HUD PIPELINE 4] snapshot merged', {
      snapshotNumber: pipelineHealth.snapshotsMerged,
      incomingKeys: Object.keys(incomingPatch),
      mergedPlayerIds: Object.keys(findPlayersMap(currentSnapshot) || {}),
      previousHandId: previousMergedHandId,
      currentHandId: currentMergedHandId,
      incomingPatch: incomingPatch,
      mergedSnapshot: currentSnapshot
    });
    var changedPaths = [];
    if (previousSnapshot) diffSnapshotValues(previousSnapshot, currentSnapshot, '', changedPaths);
    else changedPaths.push({ path: '$', change: 'initial snapshot', previous: undefined, current: currentSnapshot });
    identityDiagnostics.lastChangedPaths = cloneJson(changedPaths);
    var transitionRecord = recordMergedStateTransition(incomingPatch, currentSnapshot, changedPaths, contributionMetadata || {});
    var currentAuthoritativeHandId = typeof currentSnapshot.hI === 'string' && currentSnapshot.hI !== '<D>' ? currentSnapshot.hI : null;
    var previousAuthoritativeHandId = previousSnapshot && typeof previousSnapshot.hI === 'string' && previousSnapshot.hI !== '<D>' ? previousSnapshot.hI : null;
    if (currentSocketFrameContext) currentSocketFrameContext.authoritativeHandId = currentAuthoritativeHandId;
    var lifecycleTbRecord = PokerTbTrace.preferredTb(currentSnapshot);
    traceFirstHandLifecycle('stateSnapshots', {
      eventName: contributionMetadata && contributionMetadata.eventName || null,
      frameId: contributionMetadata && contributionMetadata.frameId || null,
      initialBaseline: previousSnapshot === null,
      previousSnapshotPresent: Boolean(previousSnapshot),
      previousHandId: previousMergedHandId,
      currentHandId: currentMergedHandId,
      activeHandId: handAccounting && handAccounting.activeHandId || null,
      finalizedHandIds: handAccounting ? Array.from(handAccounting.finalizedHandIds) : [],
      blindState: {
        smallBlindPlayerId: findFirstScalarByKeys(currentSnapshot, ['sBPI']),
        bigBlindPlayerId: findFirstScalarByKeys(currentSnapshot, ['bBPI']),
        tBPath: lifecycleTbRecord && lifecycleTbRecord.path || null,
        tB: lifecycleTbRecord && cloneJson(lifecycleTbRecord.value) || null
      },
      mappingCount: socketPlayerNames.size,
      changedPaths: changedPaths.slice(0, 80).map(function (change) {
        return { path: change.path, change: change.change, previous: lifecycleTraceValue(change.previous), current: lifecycleTraceValue(change.current) };
      })
    }, transitionRecord.timestamp);

    console.log('[HUD] previous gc snapshot', previousSnapshot);
    console.log('[HUD] current gc snapshot', currentSnapshot);
    console.log('[HUD] gc changed paths', changedPaths);

    updateSocketContext(currentSnapshot);
    captureVisiblePlayerMappings();
    confirmLocalResumeFromProgression(changedPaths, transitionRecord);
    var gameBreakSnapshotTrace = recordGameBreakSnapshot(previousSnapshot, currentSnapshot, incomingPatch, changedPaths, transitionRecord);
    var authoritativePausedSnapshot = Boolean(
      gameBreakSnapshotTrace.normalizedLifecycle &&
      gameBreakSnapshotTrace.normalizedLifecycle.classification === 'paused' &&
      gameBreakSnapshotTrace.normalizedLifecycle.confidence === 'authoritative'
    );
    reconcileHudRuntimeStatus({
      timestamp: transitionRecord.timestamp,
      tableStatus: gameBreakSnapshotTrace.currentTableStatus,
      tableClassification: gameBreakSnapshotTrace.classification,
      lifecycleConfidence: gameBreakSnapshotTrace.normalizedLifecycle && gameBreakSnapshotTrace.normalizedLifecycle.confidence,
      lifecycleEvidence: {
        classificationFlags: gameBreakSnapshotTrace.classificationFlags,
        normalized: gameBreakSnapshotTrace.normalizedLifecycle || null
      },
      verifiedInactiveReason: gameBreakSnapshotTrace.verifiedInactiveReason,
      verifiedActiveReason: gameBreakSnapshotTrace.verifiedActiveReason,
      waitingToStart: gameBreakSnapshotTrace.waitingToStart,
      gamePaused: gameBreakSnapshotTrace.gamePaused,
      gameStopped: gameBreakSnapshotTrace.gameStopped,
      gameBroken: gameBreakSnapshotTrace.gameBroken,
      // Undefined deliberately preserves a latched verified-host Pause state; a
      // generic active/in-progress gC patch is not authoritative Resume evidence.
      authoritativePauseState: authoritativePausedSnapshot ? 'paused' : undefined,
      authoritativePauseEvidence: authoritativePausedSnapshot ? gameBreakSnapshotTrace.normalizedLifecycle : undefined,
      localLifecycleCommand: hostControlTraceState.activeLocalCommand,
      eligiblePlayerCount: gameBreakSnapshotTrace.activeInGamePlayerCount,
      freshGameState: true,
      transportDisconnected: false,
      pauseStatusTrigger: {
        eventType: 'merged-game-state:' + String(transitionRecord.eventName || 'unknown'),
        snapshotFingerprint: stableHash(JSON.stringify({
          frameId: currentSocketFrameContext && currentSocketFrameContext.frameId || null,
          status: gameBreakSnapshotTrace.currentTableStatus,
          classification: gameBreakSnapshotTrace.classification,
          changedPaths: changedPaths.slice(0, 40).map(function (change) { return change.path; })
        })),
        rawPauseRelatedFields: gameBreakSnapshotTrace.normalizedLifecycle && gameBreakSnapshotTrace.normalizedLifecycle.currentPatchEvidence || []
      },
      reason: 'fresh-active-game-state'
    });
    // A verified PokerNow Pause is authoritative negative evidence for hand
    // progression. Sparse/stale gC traffic can continue while paused, including
    // identifiers that otherwise bypass boundary confidence scoring. Keep
    // settlement handling and recovery metadata live, but never let such a
    // snapshot create a boundary or inferred action.
    var verifiedPauseBlocksHandProgression = currentEffectivePauseState() === 'paused';
    // Reload continuity may reclaim only the persisted hand when current socket
    // evidence proves ownership; it must not invent a boundary or historical hand.
    var continuityResult = reconcileOwnedHandReloadContinuity(currentSnapshot, transitionRecord);
    var recoveryResult = continuityResult.claimed
      ? { claimed: true, handId: continuityResult.handId, reason: continuityResult.reason || 'owned-hand reload continuity' }
      : reconcileInterruptedHandRecovery(currentSnapshot, gameBreakSnapshotTrace, transitionRecord);
    var recoveryOwnsCurrentHand = Boolean(
      continuityResult.claimed ||
      recoveryResult.claimed ||
      interruptedHandRecoveryState.recoverySucceeded &&
      PokerInterruptedHandRecovery.remainsSameHand(interruptedHandRecoveryState, interruptedHandFingerprint(currentSnapshot))
    );
    var terminalSettlement = nonEmptyObjectByKeyPattern(incomingPatch, /^(?:gameResult|game_result|settlement|results?|winners?)$/i);
    var activeBeforeSettlement = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    var activeParticipantsBeforeSettlement = activeBeforeSettlement && activeBeforeSettlement.participants ? Object.keys(activeBeforeSettlement.participants) : [];
    var settlementOwnershipValid = Boolean(
      terminalSettlement &&
      activeBeforeSettlement &&
      activeParticipantsBeforeSettlement.length > 0 &&
      !handAccounting.finalizedHandIds.has(String(activeBeforeSettlement.handId)) &&
      (!activeBeforeSettlement.recovered || recoveryOwnsCurrentHand)
    );
    if (settlementOwnershipValid && String(socketGameContext.handId || '') !== String(activeBeforeSettlement.handId)) {
      socketGameContext.handId = String(activeBeforeSettlement.handId);
    }
    var settlementOrdering = terminalSettlement ? {
      traceId: 'settlement-order-' + (++settlementOrderingSequence),
      timestamp: transitionRecord.timestamp,
      frameId: currentSocketFrameContext && currentSocketFrameContext.frameId || null,
      activeHandIdBeforePatch: activeBeforeSettlement && activeBeforeSettlement.handId || null,
      settlementIntroduced: true,
      ownershipValidBeforeSettlement: settlementOwnershipValid,
      finalizeAttemptedBeforeBoundary: false,
      finalizeResult: null,
      boundaryEvaluationRanAfterFinalize: false,
      boundaryEvaluationSuppressedReason: settlementOwnershipValid ? 'settlement owns this patch; next boundary waits for a later authoritative patch' : null,
      handCountBefore: handAccounting ? handAccounting.finalizedHandIds.size : 0,
      handCountAfter: null
    } : null;
    if (settlementOrdering) {
      settlementOrderingDiagnostics.push(settlementOrdering);
      if (settlementOrderingDiagnostics.length > 20) settlementOrderingDiagnostics.shift();
    }
    var handTransition = settlementOwnershipValid
      ? { detected: false, recovered: Boolean(activeBeforeSettlement && activeBeforeSettlement.recovered), settlementOwned: true, handId: String(activeBeforeSettlement.handId), events: [] }
      : recoveryOwnsCurrentHand
      ? { detected: false, recovered: true, handId: ownedHandReloadContinuityState.persistedHandId || interruptedHandRecoveryState.persistedHandId, events: [] }
      : verifiedPauseBlocksHandProgression
      ? { detected: false, paused: true, reason: 'verified PokerNow Pause suppresses hand progression', events: [] }
      : detectGcNewHand(previousSnapshot, currentSnapshot, changedPaths, transitionRecord, gameBreakSnapshotTrace);
    var liveBettingHandId = currentAuthoritativeHandId || currentMergedHandId || socketGameContext.handId || handTransition.handId || null;
    var currentLocalPlayerStatus = localUserPlayerId && currentSnapshot.pGS && currentSnapshot.pGS[localUserPlayerId];
    var authoritativeLiveResetReason = terminalSettlement
      ? 'authoritative terminal settlement'
      : currentLocalPlayerStatus === 'out'
      ? 'authoritative local user left active table/seat'
      : /^(?:broken|stopped|waiting)$/i.test(String(gameBreakSnapshotTrace.newLifecycleState || ''))
      ? 'authoritative table lifecycle ' + String(gameBreakSnapshotTrace.newLifecycleState)
      : null;
    if (authoritativeLiveResetReason) {
      PokerPotOdds.resetLiveStateContinuity(potOddsLiveState, authoritativeLiveResetReason, 'merged PokerNow game-state lifecycle', transitionRecord.timestamp);
    } else if (liveBettingHandId) {
      var liveContinuityObservation = PokerPotOdds.observeLiveStateContinuity(potOddsLiveState, {
        handId: String(liveBettingHandId),
        authoritativeHandId: currentAuthoritativeHandId || String(liveBettingHandId),
        frameId: currentSocketFrameContext && currentSocketFrameContext.frameId || transitionRecord.id,
        timestamp: transitionRecord.timestamp,
        eventName: transitionRecord.eventName,
        source: 'authoritative merged PokerNow game state',
        previousState: previousSnapshot,
        currentState: currentSnapshot,
        patch: incomingPatch
      });
      recordPotOddsForensic('authoritative-live-state-observed', 'authoritative merged PokerNow game state', { continuityRevision: liveContinuityObservation && liveContinuityObservation.revision || null, authoritativeHandId: currentAuthoritativeHandId || null });
    }
    var semanticLedgerOwnedHand = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    var semanticFinalizationReadiness = { ready: false, reason: 'no active semantic hand owns this patch' };
    if (semanticLedgerOwnedHand && (!verifiedPauseBlocksHandProgression || settlementOwnershipValid)) {
      var semanticObservationPatch = incomingPatch;
      if (verifiedPauseBlocksHandProgression && settlementOwnershipValid) {
        // The owned settlement may complete, but repeated paused betting fields
        // remain negative evidence and cannot become semantic actions.
        semanticObservationPatch = Object.assign({}, incomingPatch);
        delete semanticObservationPatch.tB;
        delete semanticObservationPatch.pGS;
      }
      PokerSemanticHandLedger.observe(semanticLedgerState, {
        handId: String(semanticLedgerOwnedHand.handId),
        authoritativeHandId: currentAuthoritativeHandId,
        previousHandId: currentAuthoritativeHandId && previousAuthoritativeHandId === currentAuthoritativeHandId ? String(semanticLedgerOwnedHand.handId) : null,
        previousAuthoritativeHandId: previousAuthoritativeHandId,
        sameHand: Boolean(activeBeforeSettlement && String(activeBeforeSettlement.handId) === String(semanticLedgerOwnedHand.handId)),
        frameId: currentSocketFrameContext && currentSocketFrameContext.frameId || transitionRecord.id,
        timestamp: transitionRecord.timestamp,
        eventName: transitionRecord.eventName,
        previousState: previousSnapshot,
        currentState: currentSnapshot,
        patch: semanticObservationPatch
      });
      semanticFinalizationReadiness = PokerSemanticHandLedger.finalizationReadiness(
        semanticLedgerState,
        String(semanticLedgerOwnedHand.handId)
      );
      if (semanticFinalizationReadiness.settlementObserved || semanticFinalizationReadiness.terminalPhaseKnown) {
        showdownDebug('finalization-readiness', {
          lifecycleHandId: String(semanticLedgerOwnedHand.handId),
          authoritativeHandId: semanticFinalizationReadiness.authoritativeHandId || currentAuthoritativeHandId,
          lifecycleState: gameBreakSnapshotTrace.newLifecycleState || null,
          ready: semanticFinalizationReadiness.ready,
          reason: semanticFinalizationReadiness.reason,
          terminalPhaseKnown: semanticFinalizationReadiness.terminalPhaseKnown,
          settlementObserved: semanticFinalizationReadiness.settlementObserved,
          settlementRetained: semanticFinalizationReadiness.settlementRetained,
          settlementSourceSequence: semanticFinalizationReadiness.settlementSourceSequence,
          latestSourceSequence: semanticFinalizationReadiness.latestSourceSequence,
          showdownEvidencePlayerIds: semanticFinalizationReadiness.revealPlayerIds || [],
          settlementPlayerIds: semanticFinalizationReadiness.settlementPlayerIds || []
        });
      }
      if (terminalSettlement && semanticFinalizationReadiness.ready !== true) {
        showdownDebug('provisional-contribution', {
          lifecycleHandId: String(semanticLedgerOwnedHand.handId),
          committed: false,
          reason: semanticFinalizationReadiness.reason,
          laterCompleteContributionAllowed: true
        });
      }
    }
    if (handTransition.detected && interruptedHandRecoveryState.armed) {
      PokerInterruptedHandRecovery.clearStale(interruptedHandRecoveryState, 'different verified hand boundary superseded persisted unfinished hand');
    }
    if (!terminalSettlement) updateInterruptedHandRecoveryMetadata(currentSnapshot, gameBreakSnapshotTrace, transitionRecord);
    captureLiveWalkSnapshot(currentSnapshot, incomingPatch, transitionRecord, handTransition);
    var candidates = verifiedPauseBlocksHandProgression
      ? []
      : inferLiveActionCandidates(previousSnapshot, currentSnapshot, changedPaths, transitionRecord, handTransition);
    refreshPotOddsFromLedger('live merged state', {
      transitioning: Boolean(handTransition.detected || terminalSettlement || /^(?:paused|broken|stopped|waiting)$/i.test(String(gameBreakSnapshotTrace.newLifecycleState || ''))),
      snapshot: currentSnapshot,
      terminal: Boolean(terminalSettlement),
      definiteZero: Boolean(terminalSettlement || /^(?:broken|stopped|waiting)$/i.test(String(gameBreakSnapshotTrace.newLifecycleState || '')))
    });
    var events = handTransition.events.slice();
    candidates.forEach(function (candidate) {
      console.log('[HUD] inferred action candidate', candidate);
      if (!candidate.action || !candidate.player || !candidate.handId || !candidate.street || candidate.ambiguous) {
        setPipelineFailure('stage 6: inferred action candidate was incomplete or ambiguous', candidate);
        return;
      }
      events.push({
        handId: String(candidate.handId),
        playerId: candidate.playerId === null || candidate.playerId === undefined ? null : String(candidate.playerId),
        player: String(candidate.player),
        action: candidate.action,
        street: candidate.street,
        amount: Number(candidate.amount || 0),
        timestamp: Number(candidate.timestamp || transitionRecord.timestamp || Date.now())
      });
    });
    var settlementTrace = null;
    if (terminalSettlement) {
      PokerOwnedHandReloadContinuity.markSettlement(ownedHandReloadContinuityState, transitionRecord.timestamp);
      interruptedHandRecoveryState.settlementObservedAt = transitionRecord.timestamp;
      if (interruptedHandRecoveryState.recoverySucceeded && !interruptedHandRecoveryState.finalizedAfterRecovery) {
        interruptedHandRecoveryState.socketGameContextHandIdAfterRestore = socketGameContext.handId;
        interruptedHandRecoveryState.ownershipRestoredBeforeSettlement =
          String(socketGameContext.handId || '') === String(interruptedHandRecoveryState.persistedHandId || '');
        if (!interruptedHandRecoveryState.ownershipRestoredBeforeSettlement) {
          console.error('[HUD INTERRUPTED HAND] ownership invariant violation before settlement', {
            persistedHandId: interruptedHandRecoveryState.persistedHandId,
            socketGameContextHandId: socketGameContext.handId,
            patchRecordId: transitionRecord.id,
            frameId: currentSocketFrameContext && currentSocketFrameContext.frameId || null
          });
        }
      }
      var settlementFolds = inferCapturedSettlementFolds(previousSnapshot, currentSnapshot, incomingPatch, transitionRecord);
      settlementFolds.forEach(function (settlementFold) {
        events.push(settlementFold);
        console.log('[HUD WALK] settlement fold evidence preserved', settlementFold);
      });
      var settlementGameResult = firstObjectByKeyPattern(incomingPatch, /^(?:gameResult|game_result|settlement|results?|winners?)$/i);
      var settlementActiveHand = handAccounting && PokerHandFinalization.activeHand(handAccounting);
      var settlementFinalizeHandId = settlementOwnershipValid
        ? String(activeBeforeSettlement.handId)
        : (socketGameContext.handId ? String(socketGameContext.handId) : null);
      settlementTrace = PokerGameBreakLifecycle.recordSettlementEvaluation(gameBreakLifecycleState, {
        timestamp: transitionRecord.timestamp,
        frameId: currentSocketFrameContext && currentSocketFrameContext.frameId || null,
        patchRecordId: transitionRecord.id,
        eventName: transitionRecord.eventName,
        settlementObserved: true,
        gameResult: cloneJson(settlementGameResult),
        socketGameContextHandId: socketGameContext.handId,
        activeHandId: settlementActiveHand && settlementActiveHand.handId || null,
        activeHand: cloneJson(settlementActiveHand),
        derivedFinalizeHandId: semanticFinalizationReadiness.ready ? settlementFinalizeHandId : null,
        finalizeStatsHandCalled: false,
        exactPreCallReason: !settlementFinalizeHandId
          ? 'socketGameContext.handId is null; finalizer cannot be called'
          : semanticFinalizationReadiness.ready
            ? 'terminal phase and retained settlement evidence make the owned hand ready to finalize'
            : 'owned settlement is retained provisionally until the merged hand reaches terminal phase'
      });
      console.log('[HUD RESUME SETTLEMENT]', settlementTrace);
    }
    var readyFinalizeHandId = semanticLedgerOwnedHand && semanticFinalizationReadiness.ready && socketGameContext.handId
      ? String(socketGameContext.handId)
      : null;
    var finalizeReason = readyFinalizeHandId
      ? (terminalSettlement
        ? 'terminal settlement evidence completed in live game-state patch'
        : 'deferred settlement became terminal-ready after sparse game-state merge')
      : null;
    if (readyFinalizeHandId) {
      showdownDebug('provisional-versus-committed', {
        lifecycleHandId: readyFinalizeHandId,
        authoritativeHandId: semanticFinalizationReadiness.authoritativeHandId || currentAuthoritativeHandId,
        provisional: false,
        committed: true,
        reason: finalizeReason,
        settlementSourceSequence: semanticFinalizationReadiness.settlementSourceSequence,
        terminalSourceSequence: semanticFinalizationReadiness.latestSourceSequence
      });
    }
    previousGcSnapshot = currentSnapshot;
    return {
      events: events,
      unchanged: previousSnapshot !== null && changedPaths.length === 0,
      finalizeHandId: readyFinalizeHandId,
      finalizeReason: finalizeReason,
      finalizationDeferredReason: terminalSettlement && !readyFinalizeHandId ? semanticFinalizationReadiness.reason : null,
      authoritativeHandId: currentAuthoritativeHandId || null,
      settlementSummary: readyFinalizeHandId ? firstObjectByKeyPattern(currentSnapshot, /^(?:gameResult|game_result|settlement|results?|winners?)$/i) : null,
      settlementTraceId: settlementTrace && settlementTrace.traceId || null,
      settlementOrderingTraceId: settlementOrdering && settlementOrdering.traceId || null,
      lifecycleSignal: gameBreakSnapshotTrace.normalizedLifecycle || null
    };
  }

 function nonEmptyObjectByKeyPattern(payload, pattern) {
    var found = false;
    function visit(value, depth) {
      if (found || !value || typeof value !== 'object' || depth > 8) return;
      Object.keys(value).forEach(function (key) {
        if (found) return;
        if (pattern.test(key)) {
          var candidate = value[key];
          if (candidate && typeof candidate === 'object' && Object.keys(candidate).length) found = true;
        }
        visit(value[key], depth + 1);
      });
    }
    visit(payload, 0);
    return found;
  }

  function collectCardCollections(payload) {
    var collections = [];
    function cardLike(card) {
      if (typeof card === 'string') return /^(?:10|[2-9TJQKA])(?:[shdc♠♥♦♣])?$/i.test(card.trim());
      return Boolean(card && typeof card === 'object' && (card.rank || card.value) && (card.suit || card.color));
    }
    function visit(value, path, depth) {
      if (value === null || value === undefined || depth > 8) return;
      if (Array.isArray(value)) {
        var knownCardPath = /(?:board|community|shared|hole|pocket|cards?)/i.test(path);
        if (value.length <= 7 && (knownCardPath || (value.length && value.every(cardLike)))) {
          var kind = /(?:board|community|shared)/i.test(path) ? 'board' : (/(?:hole|pocket)/i.test(path) || value.length === 2 ? 'hole' : 'unknown');
          collections.push({ path: path, kind: kind, length: value.length, signature: JSON.stringify(value) });
        }
        value.forEach(function (item, index) { visit(item, path + '[' + index + ']', depth + 1); });
        return;
      }
      if (typeof value === 'object') Object.keys(value).forEach(function (key) { visit(value[key], path ? path + '.' + key : key, depth + 1); });
    }
    visit(payload, '$', 0);
    return collections;
  }

  function collectionTransition(previous, current, kind) {
    var previousCollections = previous ? collectCardCollections(previous).filter(function (item) { return item.kind === kind; }) : [];
    var currentCollections = collectCardCollections(current).filter(function (item) { return item.kind === kind; });
    var previousTotal = previousCollections.reduce(function (sum, item) { return sum + item.length; }, 0);
    var currentTotal = currentCollections.reduce(function (sum, item) { return sum + item.length; }, 0);
    return { previousTotal: previousTotal, currentTotal: currentTotal, previous: previousCollections, current: currentCollections };
  }

  function committedBetResets(previous, current) {
    var beforePlayers = findPlayersMap(previous) || {};
    var afterPlayers = findPlayersMap(current) || {};
    return Object.keys(afterPlayers).reduce(function (resets, playerId) {
      var before = beforePlayers[playerId] && playerBet(beforePlayers[playerId]);
      var after = playerBet(afterPlayers[playerId] || {});
      if (typeof before === 'number' && before > 0 && after === 0) resets.push({ playerId: playerId, player: socketPlayerNames.get(String(playerId)) || null, previous: before, current: after });
      return resets;
    }, []);
  }

  function flagResetChanges(changedPaths) {
    return changedPaths.filter(function (change) {
      return /(?:fold|status|active|inHand|in_hand|playing)/i.test(change.path) && (change.previous === true || /fold|out|inactive/i.test(String(change.previous))) && (change.current === false || change.current === null || /active|playing|waiting/i.test(String(change.current)));
    });
  }

  function phaseValue(payload) {
    return findFirstScalarByKeys(payload, ['street', 'round', 'phase', 'gamePhase', 'game_phase', 'bettingRound', 'betting_round', 'state']);
  }

  function actorValue(payload) {
    return findFirstScalarByKeys(payload, ['currentPlayerId', 'current_player_id', 'actingPlayerId', 'acting_player_id', 'turnPlayerId', 'turn_player_id', 'activePlayerId', 'active_player_id']);
  }

  function unknownTransitionSignals(changedPaths) {
    var signals = [];
    changedPaths.forEach(function (change) {
      if (!isUnknownOrMinifiedPath(change.path)) return;
      var previous = change.previous;
      var current = change.current;
      var kind = null;
      if (typeof previous === 'number' && typeof current === 'number') {
        if (current === 0 && previous !== 0) kind = 'numeric reset';
        else if (current < previous) kind = 'counter decreased';
        else if (current > 1000000000000 && current !== previous) kind = 'timestamp changed';
        else if (current === previous + 1) kind = 'counter incremented';
        else kind = 'numeric change';
      } else if (typeof previous === 'boolean' && typeof current === 'boolean') kind = 'flag toggled';
      else if (typeof current === 'string' && current !== previous) kind = 'enum/string changed';
      if (kind) signals.push({ path: change.path, kind: kind, previous: previous, current: current });
    });
    return signals.slice(0, 50);
  }

  function exactPlayerIdCollection(payload, keyName) {
    var found = [];
    function visit(value, depth) {
      if (!value || typeof value !== 'object' || depth > 9) return;
      if (Object.prototype.hasOwnProperty.call(value, keyName)) {
        var collection = value[keyName];
        if (Array.isArray(collection)) found = found.concat(collection.map(String));
        else if (collection && typeof collection === 'object') Object.keys(collection).forEach(function (id) { if (collection[id] !== false && collection[id] !== null && collection[id] !== '<D>') found.push(String(id)); });
      }
      Object.keys(value).forEach(function (key) { visit(value[key], depth + 1); });
    }
    visit(payload, 0);
    return Array.from(new Set(found));
  }

  function participantStatus(player) {
    player = player || {};
    function booleanByPattern(pattern) {
      var key = Object.keys(player).find(function (field) { return pattern.test(field) && typeof player[field] === 'boolean'; });
      return key ? player[key] : null;
    }
    return {
      inHand: booleanByPattern(/^(?:inHand|isInHand|activeInHand|playingHand)$/i),
      sittingOut: booleanByPattern(/^(?:sittingOut|isSittingOut|sitOut)$/i),
      away: booleanByPattern(/^(?:away|isAway)$/i),
      disconnected: booleanByPattern(/^(?:disconnected|isDisconnected)$/i)
    };
  }

  function playerHasHoleCards(player) {
    if (!player || typeof player !== 'object') return false;
    return Object.keys(player).some(function (key) {
      if (!/(?:hole|handCards|privateCards|cardsInHand)/i.test(key)) return false;
      var value = player[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value && value !== '<D>');
    });
  }

  function deriveHandParticipants(snapshot, blindPlayerIds) {
    var players = findPlayersMap(snapshot) || {};
    var allPlayerIds = Object.keys(players);
    var actor = actorValue(snapshot);
    var statusByPlayer = {};
    var holeCardPlayerIds = [];
    allPlayerIds.forEach(function (id) {
      statusByPlayer[id] = participantStatus(players[id]);
      if (playerHasHoleCards(players[id])) holeCardPlayerIds.push(id);
    });
    return PokerHandFinalization.deriveParticipants({
      allPlayerIds: allPlayerIds,
      inHandPlayerIds: exactPlayerIdCollection(snapshot, 'iHPI'),
      blindPlayerIds: blindPlayerIds || [],
      holeCardPlayerIds: holeCardPlayerIds,
      actionPlayerIds: actor !== null && actor !== undefined ? [String(actor)] : [],
      statusByPlayer: statusByPlayer
    });
  }

  function diagnosticGameStatus(snapshot, authoritativePatch) {
    var patchStatus = directDiagnosticGameStatus(authoritativePatch);
    if (patchStatus !== null && patchStatus !== undefined && patchStatus !== '<D>') return patchStatus;
    return directDiagnosticGameStatus(snapshot);
  }

  function directDiagnosticGameStatus(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    var directKeys = ['status', 'gameStatus', 'game_status', 'tableStatus', 'table_status', 'state'];
    for (var index = 0; index < directKeys.length; index += 1) {
      var value = snapshot[directKeys[index]];
      if (typeof value === 'string' || typeof value === 'number') return value;
    }
    return findFirstScalarByKeys(snapshot, ['gameStatus', 'game_status', 'tableStatus', 'table_status']);
  }

  function authoritativeLifecycleFlag(current, patch, keys) {
    function read(source) {
      if (!source || typeof source !== 'object') return undefined;
      for (var index = 0; index < keys.length; index += 1) {
        var value = firstValueByExactKey(source, keys[index]);
        if (value !== undefined && value !== '<D>') return value;
      }
      return undefined;
    }
    var patchValue = read(patch);
    var value = patchValue !== undefined ? patchValue : read(current);
    if (typeof value === 'string') return /^(?:true|yes|1|waiting|paused|stopped|broken)$/i.test(value);
    return value === true || value === 1;
  }

  function interruptedHandFingerprint(snapshot) {
    var baseline = diagnosticBoundaryBaseline(snapshot || {});
    var active = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    var persistedParticipantIds = active && active.participants
      ? Object.keys(active.participants).map(function (name) { return active.participants[name] && active.participants[name].playerId; }).filter(Boolean)
      : [];
    var currentParticipantIds = exactPlayerIdCollection(snapshot || {}, 'iHPI');
    return PokerInterruptedHandRecovery.fingerprint({
      explicitHandId: findHandIdentifier(snapshot || {}),
      participantIds: currentParticipantIds.length >= 2 ? currentParticipantIds : persistedParticipantIds,
      smallBlindPlayerId: findFirstScalarByKeys(snapshot || {}, ['sBPI']),
      bigBlindPlayerId: findFirstScalarByKeys(snapshot || {}, ['bBPI']),
      dealerOrButton: baseline.dealerOrButton,
      boardCardCount: baseline.boardCardCount,
      settlementPresent: baseline.settlementPresent
    });
  }

  function lifecycleIsInactive(trace) {
    return Boolean(trace && /waiting|stopped|broken/i.test(String(trace.classification || '')));
  }

  function reconcileOwnedHandReloadContinuity(snapshot, transitionRecord) {
    var active = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    if (!active || !active.recovered) return { claimed: false, reason: 'no persisted recovered hand requires continuity verification' };
    var bootstrapFingerprint = interruptedHandFingerprint(snapshot);
    if (ownedHandReloadContinuityState.ownershipRestoreSucceeded) {
      var compatibleFingerprint = Object.assign({}, bootstrapFingerprint, { settlementPresent: false });
      var compatible = PokerInterruptedHandRecovery.compare(
        active.recoveryMetadata && active.recoveryMetadata.fingerprint,
        compatibleFingerprint
      );
      if (bootstrapFingerprint.settlementPresent && compatible.verified) compatible.evidence.push('settlement patch observed for the strongly matching restored hand');
      if (compatible.verified) {
        PokerOwnedHandReloadContinuity.markCompatible(ownedHandReloadContinuityState, transitionRecord.timestamp);
        if (String(socketGameContext.handId || '') !== String(active.handId)) socketGameContext.handId = String(active.handId);
        return { claimed: true, continued: true, handId: String(active.handId), comparison: compatible };
      }
      return { claimed: false, reason: compatible.missing.join('; ') || 'post-reload snapshot no longer matches restored hand' };
    }
    var result = PokerOwnedHandReloadContinuity.attempt(ownedHandReloadContinuityState, {
      activeHand: active,
      bootstrapFingerprint: bootstrapFingerprint,
      bootstrapFingerprintBuildRejectedReason: 'registered/game-state snapshot lacks participants, blind identities, dealer, or compatible board state',
      alreadyFinalized: handAccounting.finalizedHandIds.has(String(active.handId)),
      verifiedNewHandBoundary: false
    });
    if (!result.claimed) {
      console.log('[HUD OWNED HAND] continuity rejected', {
        handId: active.handId,
        reason: result.reason,
        diagnostics: PokerOwnedHandReloadContinuity.snapshot(ownedHandReloadContinuityState)
      });
      return result;
    }
    var reclaimed = PokerHandFinalization.reclaimRecoveredHand(handAccounting, active.handId, {
      timestamp: transitionRecord.timestamp,
      recoveryReason: result.reason,
      sameHandEvidence: result.comparison && result.comparison.evidence || [],
      ownedHandReloadContinuity: true
    });
    if (!reclaimed.reclaimed) {
      PokerOwnedHandReloadContinuity.restored(ownedHandReloadContinuityState, { succeeded: false });
      return { claimed: false, reason: reclaimed.reason };
    }
    socketGameContext.handId = String(active.handId);
    socketGameContext.street = inferStreetFromBoard(snapshot) || socketGameContext.street || 'preflop';
    activeHandState = PokerHandFinalization.activeHand(handAccounting);
    var blindEvents = (activeHandState.events || []).filter(function (event) { return event.action === 'blind'; });
    baselineActionHand(snapshot, transitionRecord, { detected: false, recovered: true, events: blindEvents });
    inferTbActionCandidates(null, snapshot, [], transitionRecord, true);
    PokerOwnedHandReloadContinuity.restored(ownedHandReloadContinuityState, {
      succeeded: true,
      activeHandId: handAccounting.activeHandId,
      stagedHandId: activeHandState.handId,
      socketGameContextHandId: socketGameContext.handId,
      normalizedTbRestored: Boolean(liveActionTracker.handId === socketGameContext.handId && liveActionTracker.tbTracker)
    });
    PokerOwnedHandReloadContinuity.markCompatible(ownedHandReloadContinuityState, transitionRecord.timestamp);
    var ownershipIds = [
      handAccounting.activeHandId,
      activeHandState.handId,
      socketGameContext.handId,
      ownedHandReloadContinuityState.persistedHandId
    ].map(String);
    if (new Set(ownershipIds).size !== 1) {
      console.error('[HUD OWNED HAND] ownership invariant violation', {
        activeHandId: handAccounting.activeHandId,
        stagedHandId: activeHandState.handId,
        socketGameContextHandId: socketGameContext.handId,
        persistedHandId: ownedHandReloadContinuityState.persistedHandId
      });
    }
    persistHandAccounting();
    console.log('[HUD OWNED HAND] continuity restored', PokerOwnedHandReloadContinuity.snapshot(ownedHandReloadContinuityState));
    return result;
  }

  function reconcileInterruptedHandRecovery(snapshot, lifecycleTrace, transitionRecord) {
    var active = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    if (!active || !active.recovered || interruptedHandRecoveryState.recoverySucceeded || !lifecycleIsInactive(lifecycleTrace)) {
      return { claimed: false, reason: active && active.recovered ? 'waiting for authoritative paused bootstrap state' : 'no recovered unfinished hand requires ownership' };
    }
    var result = PokerInterruptedHandRecovery.attempt(interruptedHandRecoveryState, {
      timestamp: transitionRecord.timestamp,
      lifecycleInactive: true,
      persistedPausedVerified: Boolean(active.recoveryMetadata && active.recoveryMetadata.pausedVerified),
      bootstrapFingerprint: interruptedHandFingerprint(snapshot)
    });
    if (!result.claimed) {
      console.log('[HUD INTERRUPTED HAND] recovery rejected', { handId: active.handId, reason: result.reason, diagnostics: PokerInterruptedHandRecovery.snapshot(interruptedHandRecoveryState) });
      return result;
    }
    var reclaimed = PokerHandFinalization.reclaimRecoveredHand(handAccounting, active.handId, {
      timestamp: transitionRecord.timestamp,
      recoveryReason: result.reason,
      sameHandEvidence: result.comparison && result.comparison.evidence || [],
      pausedVerified: true,
      lifecycleAtPersistence: lifecycleTrace && lifecycleTrace.normalizedLifecycle && lifecycleTrace.normalizedLifecycle.classification || 'paused',
      authoritativePauseTimestamp: active.recoveryMetadata && active.recoveryMetadata.authoritativePauseTimestamp || transitionRecord.timestamp
    });
    if (!reclaimed.reclaimed) {
      PokerInterruptedHandRecovery.clearStale(interruptedHandRecoveryState, reclaimed.reason);
      return { claimed: false, reason: reclaimed.reason };
    }
    socketGameContext.handId = String(active.handId);
    socketGameContext.street = inferStreetFromBoard(snapshot);
    interruptedHandRecoveryState.socketGameContextHandIdAfterRestore = socketGameContext.handId;
    interruptedHandRecoveryState.ownershipRestoredBeforeSettlement = true;
    activeHandState = PokerHandFinalization.activeHand(handAccounting);
    persistHandAccounting();
    console.log('[HUD INTERRUPTED HAND] ownership recovered', {
      handId: active.handId,
      evidence: result.comparison.evidence,
      restoredActionCount: interruptedHandRecoveryState.restoredActionCount,
      street: socketGameContext.street
    });
    return result;
  }

  function updateInterruptedHandRecoveryMetadata(snapshot, lifecycleTrace, transitionRecord) {
    var active = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    if (!active || active.recovered && !interruptedHandRecoveryState.recoverySucceeded) return false;
    var nextFingerprint = interruptedHandFingerprint(snapshot);
    var previousMetadata = active.recoveryMetadata || {};
    var authoritativeInactive = lifecycleIsInactive(lifecycleTrace);
    var newlyVerifiedPause = authoritativeInactive && !previousMetadata.pausedVerified;
    var pausedVerified = Boolean(previousMetadata.pausedVerified || authoritativeInactive);
    var normalizedLifecycle = lifecycleTrace && lifecycleTrace.normalizedLifecycle || null;
    var lifecycleAtPersistence = newlyVerifiedPause
      ? (normalizedLifecycle && normalizedLifecycle.classification || 'paused')
      : (previousMetadata.lifecycleAtPersistence || lifecycleTrace && lifecycleTrace.classification || null);
    var pausePersistenceRevision = newlyVerifiedPause
      ? Number(previousMetadata.pausePersistenceRevision || 0) + 1
      : Number(previousMetadata.pausePersistenceRevision || 0);
    var pausePersistenceRequestedAt = newlyVerifiedPause ? Date.now() : previousMetadata.persistenceRequestedAt || null;
    var comparable = { fingerprint: nextFingerprint, pausedVerified: pausedVerified };
    var previousComparable = { fingerprint: previousMetadata.fingerprint || null, pausedVerified: Boolean(previousMetadata.pausedVerified) };
    if (JSON.stringify(comparable) === JSON.stringify(previousComparable)) return false;
    PokerHandFinalization.setRecoveryMetadata(handAccounting, active.handId, {
      fingerprint: nextFingerprint,
      pausedVerified: pausedVerified,
      lifecycleAtPersistence: lifecycleAtPersistence,
      authoritativePauseTimestamp: newlyVerifiedPause ? transitionRecord.timestamp : previousMetadata.authoritativePauseTimestamp || null,
      pausePersistenceRevision: pausePersistenceRevision,
      persistenceRequestedAt: pausePersistenceRequestedAt,
      lastAuthoritativeSnapshotAt: transitionRecord.timestamp,
      timestamp: transitionRecord.timestamp
    });
    if (newlyVerifiedPause) {
      pausePersistenceDiagnostics.activeHandPresentAtPause = true;
      pausePersistenceDiagnostics.handId = String(active.handId);
      pausePersistenceDiagnostics.pauseVerifiedAt = transitionRecord.timestamp;
      pausePersistenceDiagnostics.persistenceRequestedAt = pausePersistenceRequestedAt;
      pausePersistenceDiagnostics.persistenceCompletedAt = null;
      pausePersistenceDiagnostics.persistenceError = null;
      pausePersistenceDiagnostics.persistedPausedVerified = true;
      pausePersistenceDiagnostics.persistedLifecycle = lifecycleAtPersistence;
      pausePersistenceDiagnostics.persistedRevision = pausePersistenceRevision;
      var persistenceRevision = pausePersistenceDiagnostics.persistedRevision;
      persistHandAccounting(function (error) {
        if (persistenceRevision !== pausePersistenceDiagnostics.persistedRevision) return;
        pausePersistenceDiagnostics.persistenceCompletedAt = Date.now();
        pausePersistenceDiagnostics.persistenceError = error ? String(error.message || error) : null;
        var persistedActive = handAccounting && PokerHandFinalization.activeHand(handAccounting);
        if (persistedActive && String(persistedActive.handId) === String(active.handId)) {
          PokerHandFinalization.setRecoveryMetadata(handAccounting, persistedActive.handId, {
            persistenceCompletedAt: pausePersistenceDiagnostics.persistenceCompletedAt,
            persistenceError: pausePersistenceDiagnostics.persistenceError,
            pausePersistenceRevision: persistenceRevision,
            timestamp: pausePersistenceDiagnostics.persistenceCompletedAt
          });
          persistHandAccounting();
        }
        console.log('[HUD PAUSE PERSISTENCE]', cloneJson(pausePersistenceDiagnostics));
      });
    } else {
      persistHandAccounting();
    }
    return true;
  }

  function diagnosticPlayerStates(snapshot) {
    var players = findPlayersMap(snapshot) || {};
    var inHandIds = new Set(exactPlayerIdCollection(snapshot, 'iHPI').map(String));
    return Object.keys(players).map(function (playerId) {
      var player = players[playerId] || {};
      var flags = participantStatus(player);
      var rawStatus = player.status !== undefined ? player.status : (player.state !== undefined ? player.state : null);
      var normalizedStatus = String(rawStatus === null ? '' : rawStatus).toLowerCase().replace(/[\s_-]+/g, '');
      var inactive = flags.sittingOut === true || flags.away === true || flags.disconnected === true || /away|sitout|offline|disconnect|left|quit|observer|spectator|inactive/.test(normalizedStatus);
      var occupied = !/left|removed|empty|observer|spectator/.test(normalizedStatus);
      var activeInGame = !inactive && (inHandIds.has(String(playerId)) || flags.inHand === true || /ingame|active|playing|seated/.test(normalizedStatus));
      return {
        playerId: String(playerId),
        playerName: socketPlayerNames.get(String(playerId)) || player.name || null,
        rawStatus: rawStatus,
        normalizedStatus: normalizedStatus || null,
        participantFlags: flags,
        inHandList: inHandIds.has(String(playerId)),
        occupied: occupied,
        activeInGame: activeInGame,
        mapped: socketPlayerNames.has(String(playerId)),
        stack: numericField(player, ['stack', 'chips', 'balance'])
      };
    });
  }

  function diagnosticBoundaryBaseline(snapshot) {
    var tb = PokerTbTrace.preferredTb(snapshot);
    var holeCollections = collectCardCollections(snapshot).filter(function (collection) { return collection.kind === 'hole'; });
    var boardCollections = collectCardCollections(snapshot).filter(function (collection) { return collection.kind === 'board'; });
    var active = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    return {
      handIdentifier: findHandIdentifier(snapshot),
      socketGameContextHandId: socketGameContext.handId,
      activeHandId: active && active.handId || null,
      stagedEventCount: active && active.events ? active.events.length : 0,
      pendingActionCandidateCount: liveActionTracker.tbTracker && liveActionTracker.tbTracker.pending ? liveActionTracker.tbTracker.pending.length : 0,
      tBPath: tb && tb.path || null,
      tB: tb && cloneJson(tb.value) || null,
      pot: findPotValue(snapshot),
      holeCardCount: holeCollections.reduce(function (sum, item) { return sum + item.length; }, 0),
      holeCardCollections: cloneJson(holeCollections),
      boardCardCount: boardCollections.reduce(function (sum, item) { return sum + item.length; }, 0),
      inHandPlayerIds: exactPlayerIdCollection(snapshot, 'iHPI'),
      smallBlindPlayerId: findFirstScalarByKeys(snapshot, ['sBPI']),
      bigBlindPlayerId: findFirstScalarByKeys(snapshot, ['bBPI']),
      currentPlayerId: findFirstScalarByKeys(snapshot, ['cPI']),
      playerInTurnId: findFirstScalarByKeys(snapshot, ['pITT']),
      dealerOrButton: findDealerOrButton(snapshot),
      actor: actorValue(snapshot),
      phase: phaseValue(snapshot),
      settlementPresent: nonEmptyObjectByKeyPattern(snapshot, /^(?:gameResult|game_result|settlement|results?|winners?)$/i)
    };
  }

  function diagnosticDealFingerprint(baseline) {
    baseline = baseline || {};
    return stableHash(JSON.stringify({
      holeCardCollections: baseline.holeCardCollections || [],
      inHandPlayerIds: (baseline.inHandPlayerIds || []).slice().sort(),
      smallBlindPlayerId: baseline.smallBlindPlayerId || null,
      bigBlindPlayerId: baseline.bigBlindPlayerId || null,
      currentPlayerId: baseline.currentPlayerId || null,
      playerInTurnId: baseline.playerInTurnId || null,
      dealerOrButton: baseline.dealerOrButton || null,
      tB: baseline.tB || {},
      settlementPresent: Boolean(baseline.settlementPresent)
    }));
  }

  function recordGameBreakSnapshot(previous, current, incomingPatch, changedPaths, transitionRecord) {
    var playerStates = diagnosticPlayerStates(current);
    var baseline = diagnosticBoundaryBaseline(current);
    var activePlayerCount = playerStates.filter(function (player) { return player.activeInGame; }).length;
    var socketOccupiedCount = playerStates.filter(function (player) { return player.occupied; }).length;
    var visibleOccupiedCount = identityDiagnostics.domSeats.filter(function (seat) { return seat.occupied && !seat.inactive; }).length;
    var mappedPlayerCount = playerStates.filter(function (player) { return player.mapped; }).length;
    var activeHand = handAccounting && PokerHandFinalization.activeHand(handAccounting);
    var finalizedIds = handAccounting ? Array.from(handAccounting.finalizedHandIds) : [];
    var socketContextHandId = socketGameContext.handId === null || socketGameContext.handId === undefined ? null : String(socketGameContext.handId);
    var priorHandResolved = !activeHand && Boolean(
      (socketContextHandId && handAccounting && handAccounting.finalizedHandIds.has(socketContextHandId)) ||
      (handTransitionDiagnostics.lastSettlementAt && handTransitionDiagnostics.lastAcceptedBoundaryAt && handTransitionDiagnostics.lastSettlementAt >= handTransitionDiagnostics.lastAcceptedBoundaryAt)
    );
    var cleanPreDealBaseline = !activeHand && baseline.holeCardCount === 0 && baseline.boardCardCount === 0 && baseline.inHandPlayerIds.length === 0 && (baseline.pot === null || Number(baseline.pot) === 0);
    var normalizedLifecycle = PokerNowLifecycleSignal.normalize({
      eventName: transitionRecord.eventName,
      currentPatch: incomingPatch,
      mergedState: current,
      eligiblePlayerCount: activePlayerCount,
      occupiedPlayerCount: visibleOccupiedCount || socketOccupiedCount
    });
    var normalizedLifecycleClass = normalizedLifecycle.classification;
    var waitingToStart = normalizedLifecycleClass === 'waiting' || authoritativeLifecycleFlag(current, incomingPatch, ['waitingToStart', 'waiting_to_start']);
    var gamePaused = normalizedLifecycleClass === 'paused' || authoritativeLifecycleFlag(current, incomingPatch, ['paused', 'isPaused', 'gamePaused', 'game_paused']);
    var gameStopped = normalizedLifecycleClass === 'stopped' || authoritativeLifecycleFlag(current, incomingPatch, ['stopped', 'isStopped', 'gameStopped', 'game_stopped']);
    var gameBroken = normalizedLifecycleClass === 'broken' || authoritativeLifecycleFlag(current, incomingPatch, ['broken', 'isBroken', 'gameBroken', 'game_broken']);
    var trace = PokerGameBreakLifecycle.recordSnapshot(gameBreakLifecycleState, {
      timestamp: transitionRecord.timestamp,
      frameId: currentSocketFrameContext && currentSocketFrameContext.frameId || null,
      eventName: transitionRecord.eventName,
      contributionPath: transitionRecord.contributionPath,
      currentTableStatus: normalizedLifecycle.rawStatus || diagnosticGameStatus(current, incomingPatch),
      normalizedLifecycle: normalizedLifecycle,
      lifecycleConfidence: normalizedLifecycle.confidence,
      lifecycleEvidencePaths: normalizedLifecycle.evidencePaths,
      waitingToStart: waitingToStart,
      gamePaused: gamePaused,
      gameStopped: gameStopped,
      gameBroken: gameBroken,
      playerStatuses: playerStates,
      occupiedSeatCount: visibleOccupiedCount || socketOccupiedCount,
      occupiedSeatCountSource: visibleOccupiedCount ? 'visible DOM occupied seats' : 'socket player records',
      activeInGamePlayerCount: activePlayerCount,
      mappedPlayerCount: mappedPlayerCount,
      activeHand: cloneJson(activeHand),
      activeHandId: activeHand && activeHand.handId || null,
      socketGameContextHandId: socketGameContext.handId,
      lastFinalizedHandId: finalizedIds.length ? finalizedIds[finalizedIds.length - 1] : null,
      lastSettlementTimestamp: handTransitionDiagnostics.lastSettlementAt || null,
      lastAcceptedBoundaryTimestamp: handTransitionDiagnostics.lastAcceptedBoundaryAt || null,
      currentBoundaryBaseline: baseline,
      holeCardCount: baseline.holeCardCount,
      inHandPlayerIds: baseline.inHandPlayerIds,
      currentDealFingerprint: diagnosticDealFingerprint(baseline),
      priorHandResolved: priorHandResolved,
      cleanPreDealBaseline: cleanPreDealBaseline,
      dealingPossible: activePlayerCount >= 2 && mappedPlayerCount >= 2,
      changedPaths: cloneJson((changedPaths || []).slice(0, 120)),
      previousSnapshotHandIdentifier: previous ? findHandIdentifier(previous) : null,
      initialAuthoritativeSnapshot: previous === null,
      storageHydrationComplete: Boolean(firstHandLifecycle.ready)
    });
    if (PokerHudDiagnostics.enabled('deep') && (trace.breakInitializedFromReload || trace.gameBreakToActiveDetected)) {
      console.log('[HUD BREAK RELOAD TRACE]', {
        storageHydrationComplete: trace.storageHydrationComplete,
        initialAuthoritativeLifecycle: trace.initialAuthoritativeLifecycle,
        previousLifecycleState: trace.previousLifecycleState,
        newLifecycleState: trace.newLifecycleState,
        gameBreakToActiveDetected: trace.gameBreakToActiveDetected,
        previousEpoch: trace.previousEpoch,
        newEpoch: trace.newEpoch,
        snapshotHandIdentifier: baseline.handIdentifier,
        snapshotDealFingerprint: trace.currentDealFingerprint,
        activeHandId: trace.activeHandId,
        breakInitializedFromReload: trace.breakInitializedFromReload,
        resumeEpoch: trace.resumeEpoch
      });
    }
    if (trace.breakStartedOnThisSnapshot || trace.breakInitializedFromReload) {
      showdownDebug('game-break-entry', {
        breakEpoch: trace.breakEpoch,
        source: trace.breakInitializedFromReload ? 'reload-broken-baseline' : 'observed-active-to-break-transition',
        lifecycleState: trace.newLifecycleState,
        activeHandId: trace.activeHandId || null,
        stablePlayerIds: (trace.resumeEpoch && trace.resumeEpoch.expectedPlayerIds || []).map(String),
        priorHandResolved: trace.priorHandResolved === true
      });
    }
    if (trace.gameBreakToActiveDetected) {
      showdownDebug('player-return', {
        breakEpoch: trace.breakEpoch,
        previousLifecycleState: trace.previousLifecycleState,
        newLifecycleState: trace.newLifecycleState,
        stablePlayerIds: playerStates.filter(function (player) { return player.mapped && player.activeInGame; }).map(function (player) { return String(player.playerId); }),
        seatMappingCurrent: mappedPlayerCount >= 2
      });
    }
    console.log('[HUD GAME BREAK]', trace);
    return trace;
  }

  function detectGcNewHand(previous, current, changedPaths, transitionRecord, gameBreakSnapshotTrace) {
    var evaluationTimestamp = transitionRecord ? transitionRecord.timestamp : Date.now();
    var currentPlayers = findPlayersMap(current) || {};
    var rosterIds = Object.keys(currentPlayers);
    var mappedRosterIds = rosterIds.filter(function (id) { return socketPlayerNames.has(String(id)); });
    var identitiesComplete = rosterIds.length >= 2 && mappedRosterIds.length === rosterIds.length;
    var signals = [];
    function signal(name, weight, evidence, startAnchor) { signals.push({ name: name, weight: weight, evidence: evidence, startAnchor: Boolean(startAnchor) }); }

    mappedRosterIds.forEach(function (playerId) {
      console.log('[HUD PIPELINE 5] player mapped', { playerId: String(playerId), playerName: socketPlayerNames.get(String(playerId)), source: 'merged game-state identity lookup', restoredOrExisting: true });
    });

    var previousHandId = previous ? findHandIdentifier(previous) : null;
    var currentHandId = findHandIdentifier(current);
    var initialExplicitHand = !previous && currentHandId !== null && currentHandId !== undefined;
    var handIdChanged = previousHandId !== null && previousHandId !== undefined && currentHandId !== null && currentHandId !== undefined && String(previousHandId) !== String(currentHandId);
    if (handIdChanged) signal('explicit hand ID/counter changed', 100, { previous: previousHandId, current: currentHandId }, true);
    else if (initialExplicitHand) signal('initial explicit hand ID/counter appeared', 90, { current: currentHandId }, true);

    var boardTransition = collectionTransition(previous, current, 'board');
    var previousBoardLength = previous ? findBoardLength(previous) : null;
    var currentBoardLength = findBoardLength(current);
    var previousBoardCount = previousBoardLength !== null ? previousBoardLength : boardTransition.previousTotal;
    var currentBoardCount = currentBoardLength !== null ? currentBoardLength : boardTransition.currentTotal;
    if (previousBoardCount > 0 && currentBoardCount === 0) signal('board cards cleared', 32, { previousCount: previousBoardCount, currentCount: currentBoardCount, collections: boardTransition }, true);
    else if (previousBoardCount === 0 && currentBoardCount >= 3) signal('board cards appeared', 4, { previousCount: previousBoardCount, currentCount: currentBoardCount }, false);

    var previousPot = previous ? findPotValue(previous) : null;
    var currentPot = findPotValue(current);
    if (previousPot !== null && currentPot !== null && previousPot > 0 && currentPot === 0) signal('pot reset', 22, { previous: previousPot, current: currentPot }, true);
    else if (previousPot !== null && currentPot !== null && previousPot === 0 && currentPot > 0) signal('pot created', 10, { previous: previousPot, current: currentPot }, true);

    var betResets = previous ? committedBetResets(previous, current) : [];
    if (betResets.length) signal('player committed bets reset', Math.min(28, 12 + betResets.length * 4), betResets, true);
    var resetFlags = flagResetChanges(changedPaths || []);
    if (resetFlags.length) signal('folded/status flags reset', Math.min(20, 8 + resetFlags.length * 3), resetFlags, true);

    var previousDealer = previous ? findDealerOrButton(previous) : null;
    var currentDealer = findDealerOrButton(current);
    if (previousDealer !== null && currentDealer !== null && String(previousDealer) !== String(currentDealer)) signal('dealer/button moved', 26, { previous: previousDealer, current: currentDealer }, true);

    var patchBlindDeductions = previous ? findStackDeductions(previous, current) : [];
    patchBlindDeductions.forEach(function (deduction) { handTransitionDiagnostics.recentBlindDeductions.push(Object.assign({ timestamp: evaluationTimestamp }, deduction)); });
    handTransitionDiagnostics.recentBlindDeductions = handTransitionDiagnostics.recentBlindDeductions.filter(function (item) { return evaluationTimestamp - item.timestamp <= 2500; });
    var latestDeductionByPlayer = new Map();
    handTransitionDiagnostics.recentBlindDeductions.forEach(function (item) { latestDeductionByPlayer.set(String(item.playerId), item); });
    var recentBlindDeductions = Array.from(latestDeductionByPlayer.values());
    var plausibleBlindPair = isPlausibleBlindPair(recentBlindDeductions);
    if (plausibleBlindPair) signal('blinds deducted across recent patches', 38, recentBlindDeductions, true);
    else if (patchBlindDeductions.length) signal('single/recent stack deduction', 5, patchBlindDeductions, false);

    var previousSettlement = previous ? nonEmptyObjectByKeyPattern(previous, /^(?:gameResult|game_result|settlement|results?|winners?)$/i) : false;
    var currentSettlement = nonEmptyObjectByKeyPattern(current, /^(?:gameResult|game_result|settlement|results?|winners?)$/i);
    var settlementInPatch = transitionRecord && nonEmptyObjectByKeyPattern(transitionRecord.incomingPatch, /^(?:gameResult|game_result|settlement|results?|winners?)$/i);
    if ((!previousSettlement && currentSettlement) || settlementInPatch) handTransitionDiagnostics.lastSettlementAt = evaluationTimestamp;
    if (!previousSettlement && currentSettlement) signal('settlement/gameResult appeared', 0, { previous: false, current: true }, false);
    else if (previousSettlement && !currentSettlement) signal('settlement/gameResult disappeared', 24, { previous: true, current: false }, true);
    else if (plausibleBlindPair && evaluationTimestamp - handTransitionDiagnostics.lastSettlementAt <= 15000) signal('recent settlement context plus new blinds', 14, { millisecondsSinceSettlement: evaluationTimestamp - handTransitionDiagnostics.lastSettlementAt }, false);

    var holeTransition = collectionTransition(previous, current, 'hole');
    if (holeTransition.previousTotal === 0 && holeTransition.currentTotal > 0) signal('player hole cards appeared', 36, holeTransition, true);
    else if (holeTransition.previousTotal > 0 && holeTransition.currentTotal === 0) signal('player hole cards disappeared', 0, holeTransition, false);

    var previousActor = previous ? actorValue(previous) : null;
    var currentActor = actorValue(current);
    if ((previousActor === null || previousActor === undefined || previousActor === '') && currentActor !== null && currentActor !== undefined && currentActor !== '') signal('action turn started', 14, { previous: previousActor, current: currentActor }, true);
    else if (previousActor !== null && currentActor !== null && String(previousActor) !== String(currentActor)) signal('action turn advanced', 2, { previous: previousActor, current: currentActor }, false);

    var previousPhase = previous ? phaseValue(previous) : null;
    var currentPhase = phaseValue(current);
    if (previousPhase !== null && currentPhase !== null && String(previousPhase) !== String(currentPhase)) {
      var normalizedCurrentPhase = normalizeStreet(currentPhase);
      signal(normalizedCurrentPhase === 'preflop' ? 'phase/street transitioned to preflop' : 'phase/street field transitioned', normalizedCurrentPhase === 'preflop' ? 32 : 4, { previous: previousPhase, current: currentPhase }, normalizedCurrentPhase === 'preflop');
    }

    var unknownSignals = unknownTransitionSignals(changedPaths || []);
    var minifiedPlayerIdTransitions = (changedPaths || []).filter(function (change) {
      return rosterIds.includes(String(change.current)) && String(change.previous) !== String(change.current) && isUnknownOrMinifiedPath(change.path);
    });
    if (minifiedPlayerIdTransitions.length) signal('unknown/minified player-ID field became active', 12, minifiedPlayerIdTransitions, true);
    var unknownResetSignals = unknownSignals.filter(function (item) { return item.kind === 'numeric reset' || item.kind === 'counter decreased' || item.kind === 'flag toggled'; });
    if (unknownResetSignals.length) signal('unknown/minified reset signals', Math.min(12, unknownResetSignals.length * 3), unknownResetSignals, false);

    var requiredConfidence = 50;
    var confidenceScore = Math.min(100, signals.reduce(function (sum, item) { return sum + Math.max(0, item.weight); }, 0));
    var startAnchors = signals.filter(function (item) { return item.startAnchor; });
    var supportingSignals = signals.filter(function (item) { return item.weight > 0; });
    var accepted = identitiesComplete && startAnchors.length > 0 && supportingSignals.length >= 2 && confidenceScore >= requiredConfidence;
    if (handIdChanged || initialExplicitHand) accepted = identitiesComplete;
    var rejectionReason = null;
    if (!identitiesComplete) rejectionReason = rosterIds.length < 2 ? 'no complete player roster' : 'insufficient identity mapping for roster';
    else if (!startAnchors.length) rejectionReason = 'no start-oriented hand-boundary signal';
    else if (supportingSignals.length < 2) rejectionReason = 'only one supporting boundary signal';
    else if (confidenceScore < requiredConfidence) rejectionReason = 'multi-signal confidence below 50';

    var inHandPlayerIds = exactPlayerIdCollection(current, 'iHPI');
    var previousInHandPlayerIds = previous ? exactPlayerIdCollection(previous, 'iHPI') : [];
    var freshLifecycleHandId = typeof current.hI === 'string' && current.hI && current.hI !== '<D>' &&
      previous && current.hI !== previous.hI && current.hI !== lifecycleBoundaryAcquisition.excludedHandId ? current.hI : null;
    var coldStartBoundaryOverride = PokerFirstHandLifecycle.evaluateColdStartBoundaryOverride({
      startupType: firstHandLifecycle.currentTrace && firstHandLifecycle.currentTrace.startupType,
      lifecycleAcquisitionPending: !accepted && lifecycleBoundaryAcquisition.pending && Boolean(freshLifecycleHandId) && previousBoardCount === 0 && currentBoardCount === 0 && !previousSettlement && !currentSettlement,
      noActiveHand: !handAccounting || !handAccounting.activeHandId,
      noFinalizedHands: !handAccounting || handAccounting.finalizedHandIds.size === 0,
      noPreviousHandCommitted: !handAccounting || (handAccounting.finalizedHandIds.size === 0 && handAccounting.finalizedEvents.length === 0),
      mappedPlayersVerified: identitiesComplete,
      verifiedPlayerIds: mappedRosterIds,
      holeCardsDetected: holeTransition.previousTotal === 0 && holeTransition.currentTotal > 0,
      observedPreDealBaseline: Boolean(previous && previousInHandPlayerIds.length === 0 && holeTransition.previousTotal === 0),
      inHandPlayerIds: inHandPlayerIds,
      smallBlindPlayerId: findFirstScalarByKeys(current, ['sBPI']),
      bigBlindPlayerId: findFirstScalarByKeys(current, ['bBPI']),
      currentPlayerId: findFirstScalarByKeys(current, ['cPI']),
      playerInTurnId: findFirstScalarByKeys(current, ['pITT']),
      confidenceBeforeOverride: confidenceScore,
      requiredConfidence: requiredConfidence,
      observedSignals: signals.map(function (item) { return item.name; })
    });
    var resumeSmallBlindPlayerId = findFirstScalarByKeys(current, ['sBPI']);
    var resumeBigBlindPlayerId = findFirstScalarByKeys(current, ['bBPI']);
    var resumeCurrentPlayerId = findFirstScalarByKeys(current, ['cPI']);
    var resumePlayerInTurnId = findFirstScalarByKeys(current, ['pITT']);
    var resumeCurrentBaseline = diagnosticBoundaryBaseline(current);
    var resumeDealFingerprint = diagnosticDealFingerprint(resumeCurrentBaseline);
    var resumePlayerStates = diagnosticPlayerStates(current);
    var resumeRecoveredPlayerIds = resumePlayerStates.filter(function (player) { return player.mapped && player.activeInGame; }).map(function (player) { return player.playerId; });
    var resumeHoleCardPlayerIds = rosterIds.filter(function (playerId) {
      if (playerHasHoleCards(currentPlayers[playerId])) return true;
      return holeTransition.current.some(function (collection) { return String(collection.path || '').indexOf(String(playerId)) >= 0; });
    });
    var resumeTbRecord = PokerTbTrace.preferredTb(current);
    var resumeTb = resumeTbRecord && resumeTbRecord.value || {};
    var blindCommitmentsAvailable = Object.keys(resumeTb).some(function (playerId) {
      var value = resumeTb[playerId];
      return typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value));
    });
    function positiveCommitment(playerId) {
      var value = resumeTb[String(playerId)];
      return (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) && Number(value) > 0;
    }
    var blindCommitmentsValid = blindCommitmentsAvailable
      ? positiveCommitment(resumeSmallBlindPlayerId) && positiveCommitment(resumeBigBlindPlayerId)
      : null;
    var resumeDealTransitionPaths = (changedPaths || []).filter(function (change) {
      return /(?:^|\.)(?:cPI|pITT|tB|sBPI|bBPI|iHPI)(?:\.|$)/.test(change.path) || /(?:hole|private|handCards|cardsInHand)/i.test(change.path);
    });
    var resumeTableStatus = String(gameBreakSnapshotTrace && gameBreakSnapshotTrace.currentTableStatus || '').toLowerCase().replace(/[\s_-]+/g, '');
    var resumeVerifiedDealStarted = inHandPlayerIds.length >= 2 &&
      resumeSmallBlindPlayerId !== null && resumeSmallBlindPlayerId !== undefined &&
      resumeBigBlindPlayerId !== null && resumeBigBlindPlayerId !== undefined &&
      resumeCurrentPlayerId !== null && resumeCurrentPlayerId !== undefined &&
      resumeHoleCardPlayerIds.length > 0 && resumeDealTransitionPaths.length > 0;
    var resumeBoundaryOverride = PokerGameBreakLifecycle.evaluateResumeBoundary(gameBreakLifecycleState, {
      noActiveHand: !handAccounting || !handAccounting.activeHandId,
      mappedPlayerIds: mappedRosterIds,
      recoveredEligiblePlayerIds: resumeRecoveredPlayerIds,
      inHandPlayerIds: inHandPlayerIds,
      smallBlindPlayerId: resumeSmallBlindPlayerId,
      bigBlindPlayerId: resumeBigBlindPlayerId,
      currentPlayerId: resumeCurrentPlayerId,
      playerInTurnId: resumePlayerInTurnId,
      holeCardPlayerIds: resumeHoleCardPlayerIds,
      blindCommitmentsValid: blindCommitmentsValid,
      dealSpecificTransitionObserved: resumeDealTransitionPaths.length > 0,
      tableActive: /inprogress|active|running/.test(resumeTableStatus),
      verifiedDealStarted: resumeVerifiedDealStarted,
      lifecycleTransitionVerified: Boolean(gameBreakSnapshotTrace && gameBreakSnapshotTrace.gameBreakToActiveDetected),
      currentDealFingerprint: resumeDealFingerprint,
      confidenceBeforeOverride: confidenceScore,
      requiredConfidence: requiredConfidence,
      observedSignals: signals.map(function (item) { return item.name; }).concat(resumeDealTransitionPaths.map(function (change) { return 'deal transition: ' + change.path; }))
    });
    if (!accepted && coldStartBoundaryOverride) {
      accepted = true;
      rejectionReason = null;
    }
    if (!accepted && resumeBoundaryOverride && resumeBoundaryOverride.activated) {
      accepted = true;
      rejectionReason = null;
    }
    if (accepted && lifecycleBoundaryAcquisition.excludedHandId &&
        String(current.hI) === String(lifecycleBoundaryAcquisition.excludedHandId)) {
      accepted = false;
      rejectionReason = 'reset excluded the previously observed hand ID';
    }
    if (accepted && evaluationTimestamp - handTransitionDiagnostics.lastAcceptedBoundaryAt < 3000 && !(resumeBoundaryOverride && resumeBoundaryOverride.activated)) { accepted = false; rejectionReason = 'boundary candidate occurred inside 3-second duplicate cooldown'; }

    var expectedSignals = ['explicit hand ID or counter change', 'board cards clearing', 'pot reset or creation', 'committed bets resetting', 'folded/status flags resetting', 'dealer/button movement', 'blinds deducted', 'settlement disappearing', 'hole cards appearing', 'action turn starting', 'phase/street transition'];
    var detectedNames = signals.map(function (item) { return item.name; });
    var evaluation = {
      timestamp: evaluationTimestamp,
      isoTime: new Date(evaluationTimestamp).toISOString(),
      recordId: transitionRecord && transitionRecord.id,
      eventName: transitionRecord && transitionRecord.eventName,
      contributionPath: transitionRecord && transitionRecord.contributionPath,
      detectedSignals: signals,
      missingSignals: expectedSignals.filter(function (expected) { return !detectedNames.some(function (detected) { return detected.toLowerCase().indexOf(expected.split(' ')[0].toLowerCase()) >= 0; }); }),
      unknownMinifiedTransitions: unknownSignals,
      confidenceScore: confidenceScore,
      accepted: accepted,
      rejectionReason: accepted ? null : rejectionReason,
      coldStartBoundaryOverride: coldStartBoundaryOverride || false,
      resumeBoundaryOverride: resumeBoundaryOverride || false
    };

    // The rearmed sparse rule has an exact hI even when the legacy detector
    // uses a synthetic lifecycle ID. Persist its signature across reloads.
    var rearmedDealHandId = coldStartBoundaryOverride && coldStartBoundaryOverride.lifecycleAcquisition === true ? freshLifecycleHandId : null;
    var transitionToken = currentHandId !== null && currentHandId !== undefined ? 'hand:' + currentHandId : rearmedDealHandId ? 'hand:' + rearmedDealHandId : 'multi:' + stableHash(gameSessionKey + '|' + evaluationTimestamp + '|' + detectedNames.sort().join('|'));
    var signature = gameSessionKey + '|' + transitionToken;
    if (accepted && socketHandSignatures.has(signature)) { accepted = false; evaluation.accepted = false; evaluation.rejectionReason = 'duplicate hand transition signature'; }
    traceFirstHandLifecycle('mappingReadiness', {
      handId: currentHandId,
      rosterPlayerIds: rosterIds,
      mappedPlayerIds: mappedRosterIds,
      identitiesComplete: identitiesComplete,
      mappingCount: socketPlayerNames.size
    }, evaluationTimestamp);
    traceFirstHandLifecycle('dedupeState', {
      handId: currentHandId,
      signature: signature,
      signatureAlreadySeen: socketHandSignatures.has(signature),
      seenSignatures: Array.from(socketHandSignatures),
      finalizedHandIds: handAccounting ? Array.from(handAccounting.finalizedHandIds) : []
    }, evaluationTimestamp);
    traceFirstHandLifecycle('boundaryDecisions', {
      handId: currentHandId,
      previousHandId: previousHandId,
      initialExplicitHand: initialExplicitHand,
      handIdChanged: handIdChanged,
      accepted: accepted,
      rejectionReason: accepted ? null : evaluation.rejectionReason,
      confidenceScore: confidenceScore,
      detectedSignals: cloneJson(signals),
      coldStartBoundaryOverride: cloneJson(coldStartBoundaryOverride || false),
      resumeBoundaryOverride: cloneJson(resumeBoundaryOverride || false),
      activeHandIdBeforeBoundary: handAccounting && handAccounting.activeHandId || null
    }, evaluationTimestamp);
    function mappedIdentity(value) {
      return value !== null && value !== undefined && value !== '' && value !== '<D>' && mappedRosterIds.includes(String(value));
    }
    var completeResumeDealSignature = identitiesComplete &&
      holeTransition.previousTotal === 0 && holeTransition.currentTotal > 0 &&
      inHandPlayerIds.length >= 2 && inHandPlayerIds.every(function (playerId) { return mappedRosterIds.includes(String(playerId)); }) &&
      mappedIdentity(resumeSmallBlindPlayerId) && mappedIdentity(resumeBigBlindPlayerId) && String(resumeSmallBlindPlayerId) !== String(resumeBigBlindPlayerId) &&
      mappedIdentity(resumeCurrentPlayerId) && mappedIdentity(resumePlayerInTurnId);
    var boundaryClassification = coldStartBoundaryOverride ? 'cold start' :
      (currentSocketFrameContext && currentSocketFrameContext.reconnectReplay ? 'reconnect' :
        (!previous && holeTransition.currentTotal > 0 ? 'mid-hand join or reload' :
          (gameBreakSnapshotTrace && gameBreakSnapshotTrace.breakOpen ? 'resume boundary candidate' : 'ordinary boundary')));
    if (resumeBoundaryOverride && resumeBoundaryOverride.activated) completeResumeDealSignature = true;
    function recordResumeBoundaryResult(returnedHandId, activeHandCreated) {
      var insideResumeObservationWindow = Boolean(gameBreakLifecycleState.breakOpen || gameBreakLifecycleState.resumeObservationRemaining > 0);
      var trace = PokerGameBreakLifecycle.recordBoundaryEvaluation(gameBreakLifecycleState, {
        timestamp: evaluationTimestamp,
        frameId: currentSocketFrameContext && currentSocketFrameContext.frameId || null,
        patchRecordId: transitionRecord && transitionRecord.id || null,
        eventName: transitionRecord && transitionRecord.eventName || null,
        contributionPath: transitionRecord && transitionRecord.contributionPath || null,
        allChangedSnapshotPaths: cloneJson(insideResumeObservationWindow ? (changedPaths || []) : (changedPaths || []).slice(0, 160)),
        previousMergedSnapshot: insideResumeObservationWindow && completeResumeDealSignature ? cloneJson(previous) : null,
        currentMergedSnapshot: insideResumeObservationWindow && completeResumeDealSignature ? cloneJson(current) : null,
        firstDealtSnapshot: diagnosticBoundaryBaseline(current),
        previousBoundaryBaseline: previous ? diagnosticBoundaryBaseline(previous) : null,
        holeCardEvidence: cloneJson(holeTransition),
        blindPositionEvidence: {
          smallBlindPlayerId: resumeSmallBlindPlayerId,
          bigBlindPlayerId: resumeBigBlindPlayerId,
          blindDeductions: cloneJson(recentBlindDeductions),
          plausibleBlindPair: plausibleBlindPair
        },
        playerInHandEvidence: { previous: previousInHandPlayerIds, current: inHandPlayerIds },
        dealerButtonEvidence: { previous: previousDealer, current: currentDealer, changed: String(previousDealer) !== String(currentDealer) },
        settlementDisappearance: { previous: previousSettlement, current: currentSettlement, disappeared: Boolean(previousSettlement && !currentSettlement) },
        playerStateTransitions: cloneJson((changedPaths || []).filter(function (change) { return /players?|status|away|sit|disconnect|iHPI/i.test(change.path); }).slice(0, 100)),
        confidenceScore: confidenceScore,
        requiredConfidence: requiredConfidence,
        scoreContributions: cloneJson(signals),
        rejectionReason: accepted ? null : evaluation.rejectionReason,
        accepted: accepted,
        detectGcNewHandRan: true,
        detectGcNewHandReturnedHandId: returnedHandId || null,
        activeHandCreated: Boolean(activeHandCreated),
        activeHandCreationOrSuppressionReason: activeHandCreated
          ? 'accepted live boundary initialized the first post-break active hand'
          : (accepted ? 'accepted boundary reused an existing active-hand identity' : evaluation.rejectionReason),
        activeHandIdAfterEvaluation: handAccounting && handAccounting.activeHandId || null,
        dealClassification: boundaryClassification,
        completeDealSignature: completeResumeDealSignature,
        dealFingerprint: resumeDealFingerprint,
        coldStartBoundaryOverride: cloneJson(coldStartBoundaryOverride || false),
        resumeBoundaryOverride: cloneJson(resumeBoundaryOverride || false),
        retainedLifecycleState: {
          socketGameContextHandId: socketGameContext.handId,
          previousNormalizedTb: PokerTbTrace.preferredTb(previous),
          currentNormalizedTb: PokerTbTrace.preferredTb(current),
          activeHand: handAccounting && cloneJson(PokerHandFinalization.activeHand(handAccounting)) || null,
          stagedHands: handAccounting ? Object.keys(handAccounting.stagedHands) : [],
          pendingActionCandidates: liveActionTracker.tbTracker && cloneJson(liveActionTracker.tbTracker.pending) || [],
          previousSettlementPresent: previousSettlement,
          currentSettlementPresent: currentSettlement,
          lastFinalizedHandId: handAccounting && Array.from(handAccounting.finalizedHandIds).slice(-1)[0] || null,
          lastSettlementTimestamp: handTransitionDiagnostics.lastSettlementAt || null,
          lastAcceptedBoundaryTimestamp: handTransitionDiagnostics.lastAcceptedBoundaryAt || null
        },
        finalizedHandIds: handAccounting ? Array.from(handAccounting.finalizedHandIds) : [],
        cumulativeCommitCount: handAccounting ? handAccounting.finalizedHandIds.size : 0
      });
      if (trace.belongsToResumeEpoch && accepted && returnedHandId) {
        showdownDebug('first-post-break-hand', {
          breakEpoch: trace.breakEpoch,
          lifecycleHandId: String(returnedHandId),
          authoritativeHandId: currentHandId === null || currentHandId === undefined ? null : String(currentHandId),
          activeHandCreated: Boolean(activeHandCreated),
          stablePlayerIds: inHandPlayerIds.map(String),
          seatMappingCurrent: identitiesComplete,
          boundarySource: resumeBoundaryOverride && resumeBoundaryOverride.activated ? 'verified resume boundary' : 'ordinary authoritative boundary'
        });
      }
      console.log('[HUD RESUME BOUNDARY]', trace);
      return trace;
    }
    console.log('[HUD HAND] candidate evaluation', evaluation);
    handTransitionDiagnostics.evaluations.push(evaluation);
    if (handTransitionDiagnostics.evaluations.length > 500) handTransitionDiagnostics.evaluations.shift();

    if (!accepted) {
      recordResumeBoundaryResult(null, false);
      logSocketHandRejected([evaluation.rejectionReason || 'multi-signal candidate rejected'], evaluation);
      return { detected: false, events: [] };
    }

    if (resumeBoundaryOverride && resumeBoundaryOverride.activated) {
      var resumeBoundaryConsumed = PokerGameBreakLifecycle.consumeResumeBoundary(gameBreakLifecycleState, resumeBoundaryOverride, evaluationTimestamp);
      resumeBoundaryOverride.consumed = resumeBoundaryConsumed;
      if (!resumeBoundaryConsumed) {
        accepted = false;
        evaluation.accepted = false;
        evaluation.rejectionReason = 'verified resume boundary could not consume its armed epoch';
        recordResumeBoundaryResult(null, false);
        logSocketHandRejected([evaluation.rejectionReason], evaluation);
        return { detected: false, events: [] };
      }
    } else {
      PokerGameBreakLifecycle.closeEpochFromOrdinaryBoundary(gameBreakLifecycleState, resumeDealFingerprint, evaluationTimestamp);
    }

    socketHandSignatures.add(signature);
    persistHandSignatures();
    lifecycleBoundaryAcquisition.pending = false;
    handTransitionDiagnostics.lastAcceptedBoundaryAt = evaluationTimestamp;
    var handId = currentHandId !== null && currentHandId !== undefined ? String(currentHandId) : pokerNowGameId + ':socket:' + stableHash(signature);
    socketGameContext.handId = handId;
    socketGameContext.street = currentBoardCount >= 3 ? inferStreetFromBoard(current) : 'preflop';
    var blindByPlayer = new Map(recentBlindDeductions.map(function (item) { return [String(item.playerId), item]; }));
    var smallBlindPlayerId = findFirstScalarByKeys(current, ['sBPI']);
    var bigBlindPlayerId = findFirstScalarByKeys(current, ['bBPI']);
    var verifiedBlindPlayerIds = [smallBlindPlayerId, bigBlindPlayerId].filter(function (playerId) {
      return PokerWalkDetection.blindTypeForPlayer(playerId, smallBlindPlayerId, bigBlindPlayerId) !== null && rosterIds.includes(String(playerId));
    });
    var participantDecisions = deriveHandParticipants(current, Array.from(new Set(Array.from(blindByPlayer.keys()).concat(verifiedBlindPlayerIds))));
    var activeHandIdBeforeResumeBoundary = handAccounting && handAccounting.activeHandId || null;
    beginStatsHand(handId, 'websocket hand boundary', evaluationTimestamp, true);
    participantDecisions.forEach(function (decision) {
      var playerName = socketPlayerNames.get(String(decision.playerId)) || null;
      var details = { playerId: decision.playerId, name: playerName, evidence: decision.evidence, status: decision.status, handId: handId };
      if (decision.included && playerName) {
        includeHandParticipant(handId, decision.playerId, playerName, decision.evidence.join('; '), decision.status, evaluationTimestamp);
      } else {
        console.log('[HUD PARTICIPANT] excluded', Object.assign(details, { reason: playerName ? decision.exclusionReason : 'player identity is not mapped' }));
      }
    });
    PokerHandFinalization.setRecoveryMetadata(handAccounting, handId, {
      boundaryVerified: true,
      boundarySource: 'live-websocket',
      boundaryTimestamp: evaluationTimestamp,
      boundarySignature: signature,
      firstHandAfterReloadBreak: Boolean(resumeBoundaryOverride && resumeBoundaryOverride.activated && resumeBoundaryOverride.epochSource === 'reload-broken-baseline'),
      breakEpoch: resumeBoundaryOverride && resumeBoundaryOverride.breakEpoch || null,
      resumeEpochSource: resumeBoundaryOverride && resumeBoundaryOverride.epochSource || null,
      fingerprint: interruptedHandFingerprint(current),
      lifecycleAtPersistence: gameBreakSnapshotTrace && gameBreakSnapshotTrace.normalizedLifecycle && gameBreakSnapshotTrace.normalizedLifecycle.classification || 'active',
      timestamp: evaluationTimestamp
    });
    var includedIds = participantDecisions.filter(function (decision) { return decision.included && socketPlayerNames.has(String(decision.playerId)); }).map(function (decision) { return String(decision.playerId); });
    var events = includedIds.map(function (playerId) {
      return PokerWalkDetection.createInitialHandEvent({
        handId: handId,
        playerId: String(playerId),
        player: socketPlayerNames.get(String(playerId)),
        smallBlindPlayerId: smallBlindPlayerId,
        bigBlindPlayerId: bigBlindPlayerId,
        blindDeduction: blindByPlayer.get(String(playerId)) || null,
        timestamp: evaluationTimestamp
      });
    });
    console.log('[HUD] websocket new hand detected', { gameId: pokerNowGameId, handId: handId, signature: signature, confidenceScore: confidenceScore, detectedSignals: signals, players: events.map(function (event) { return event.player; }) });
    recordResumeBoundaryResult(handId, activeHandIdBeforeResumeBoundary !== handId && handAccounting && handAccounting.activeHandId === handId);
    pipelineHealth.handBoundariesDetected += 1;
    updateHealthPanel();
    return { detected: true, events: events };
  }

  function logSocketHandRejected(reasons, details) {
    var reasonText = reasons.length ? reasons.join('; ') : 'no recognized hand boundary';
    setPipelineFailure('hand boundary rejected: ' + reasonText, details);
    var key = 'hand-rejected:' + reasonText;
    var now = Date.now();
    var last = throttledLogTimes.get(key) || 0;
    if (now - last < 2000) return;
    throttledLogTimes.set(key, now);
    console.log('[HUD] websocket hand rejected: ' + reasonText, details || {});
  }

  function findStackDeductions(previous, current) {
    var beforePlayers = findPlayersMap(previous) || {};
    var afterPlayers = findPlayersMap(current) || {};
    return Object.keys(afterPlayers).reduce(function (deductions, playerId) {
      if (!beforePlayers[playerId]) return deductions;
      var beforeStack = numericField(beforePlayers[playerId], ['stack', 'chips', 'balance']);
      var afterStack = numericField(afterPlayers[playerId], ['stack', 'chips', 'balance']);
      if (beforeStack !== null && afterStack !== null && beforeStack > afterStack) {
        deductions.push({ playerId: String(playerId), player: socketPlayerNames.get(String(playerId)) || null, amount: beforeStack - afterStack });
      }
      return deductions;
    }, []);
  }

  function isPlausibleBlindPair(deductions) {
    if (deductions.length !== 2) return false;
    var amounts = deductions.map(function (item) { return Number(item.amount); }).sort(function (a, b) { return a - b; });
    if (!amounts.every(function (amount) { return Number.isFinite(amount) && amount > 0; })) return false;
    var ratio = amounts[1] / amounts[0];
    return ratio >= 1.5 && ratio <= 3;
  }

  function findDealerOrButton(payload) {
    var value = findFirstScalarByKeys(payload, ['dealerId', 'dealer_id', 'dealerPlayerId', 'dealer_player_id', 'buttonId', 'button_id', 'buttonPlayerId', 'button_player_id', 'dealerSeat', 'dealer_seat', 'buttonSeat', 'button_seat']);
    return value === undefined ? null : value;
  }

  function findPotValue(payload) {
    var value = findFirstScalarByKeys(payload, ['pot', 'potSize', 'pot_size', 'currentPot', 'current_pot', 'totalPot', 'total_pot']);
    return typeof value === 'number' ? value : null;
  }

  function findBoardLength(payload) {
    var boardLength = null;
    function visit(value, depth, parentKey) {
      if (boardLength !== null || value === null || value === undefined || depth > 7) return;
      if (Array.isArray(value)) {
        if (/(?:board|community(?:cards?)?|sharedcards?)/i.test(parentKey || '')) boardLength = value.length;
        else value.forEach(function (item) { visit(item, depth + 1, parentKey); });
        return;
      }
      if (typeof value === 'object') Object.keys(value).forEach(function (key) { visit(value[key], depth + 1, key); });
    }
    visit(payload, 0, '');
    return boardLength;
  }

  function stableHash(value) {
    var hash = 2166136261;
    var textValue = String(value);
    for (var index = 0; index < textValue.length; index += 1) {
      hash ^= textValue.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function diffSnapshotValues(previous, current, path, changes) {
    if (Object.is(previous, current)) return;
    var previousObject = previous !== null && typeof previous === 'object';
    var currentObject = current !== null && typeof current === 'object';
    if (!previousObject || !currentObject || Array.isArray(previous) !== Array.isArray(current)) {
      changes.push({ path: path || '$', change: 'changed', previous: previous, current: current });
      return;
    }
    var keys = Array.from(new Set(Object.keys(previous).concat(Object.keys(current)))).sort();
    keys.forEach(function (key) {
      var childPath = path ? path + '.' + key : key;
      if (!Object.prototype.hasOwnProperty.call(previous, key)) {
        changes.push({ path: childPath, change: 'added', previous: undefined, current: current[key] });
      } else if (!Object.prototype.hasOwnProperty.call(current, key)) {
        changes.push({ path: childPath, change: 'removed', previous: previous[key], current: undefined });
      } else {
        diffSnapshotValues(previous[key], current[key], childPath, changes);
      }
    });
  }

  function updateSocketContext(payload) {
    var names = buildPlayerLookup(payload);
    names.forEach(function (name, id) { rememberPlayerMapping(id, name, 'gc player/seat data'); });
    var handId = findHandIdentifier(payload);
    var street = normalizeStreet(findFirstScalarByKeys(payload, ['street', 'round', 'bettingRound', 'betting_round'])) || inferStreetFromBoard(payload);
    if (handId !== undefined && handId !== null) socketGameContext.handId = handId;
    if (street) socketGameContext.street = street;
  }

  function resetLiveActionTracker(clearHistory) {
    liveActionTracker.handId = null;
    liveActionTracker.street = null;
    liveActionTracker.actorId = null;
    liveActionTracker.highestStreetBet = 0;
    liveActionTracker.players = new Map();
    liveActionTracker.currentHandSequence = null;
    liveActionTracker.tbTracker = null;
    liveActionTracker.livePipelineState = null;
    commitPotOddsDecision(PokerPotOdds.resolve({ enabled: hudUiPreferences.showPotOdds, localPlayerId: localUserPlayerId, transitioning: true }), 'live action tracker reset changed pot odds to persistent table zero', { liveState: null, transitioning: true, snapshot: previousGcSnapshot, forceZero: true });
    if (clearHistory) {
      liveActionTracker.completedHands = [];
      liveActionTracker.commitmentFieldProfiles = new Map();
      liveActionTracker.actorFieldProfiles = new Map();
      liveActionTracker.numericFieldProfiles = new Map();
      liveActionTracker.fieldDiagnostics = [];
    }
  }

  function flattenPlayerPrimitives(record) {
    var fields = {};
    function visit(value, path, depth) {
      if (value === null || value === undefined || depth > 4) return;
      if (['number', 'string', 'boolean'].includes(typeof value)) { fields[path] = value; return; }
      if (typeof value === 'object' && !Array.isArray(value)) Object.keys(value).forEach(function (key) { visit(value[key], path ? path + '.' + key : key, depth + 1); });
    }
    visit(record || {}, '', 0);
    return fields;
  }

  function flattenPlayerSnapshotPrimitives(snapshot, playerId, playerRecord) {
    var fields = flattenPlayerPrimitives(playerRecord);
    var normalizedId = String(playerId);
    var seen = new WeakSet();
    function canonical(path) {
      return 'external.' + String(path || '$').split(normalizedId).join('$player');
    }
    function addValue(value, path, depth) {
      if (value === null || value === undefined || depth > 4) return;
      if (['number', 'string', 'boolean'].includes(typeof value)) {
        fields[canonical(path)] = value;
        return;
      }
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) value.forEach(function (item, index) { addValue(item, path + '[' + index + ']', depth + 1); });
      else Object.keys(value).forEach(function (key) { addValue(value[key], path + '.' + key, depth + 1); });
    }
    function visit(value, path, depth) {
      if (!value || typeof value !== 'object' || depth > 8) return;
      if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, normalizedId)) {
        addValue(value[normalizedId], path + '.' + normalizedId, 0);
      }
      if (!Array.isArray(value)) {
        var directId = value.id || value._id || value.playerId || value.player_id || value.userId || value.user_id;
        if (directId !== undefined && String(directId) === normalizedId) addValue(value, path, 0);
      }
      if (Array.isArray(value)) value.forEach(function (item, index) { visit(item, path + '[' + index + ']', depth + 1); });
      else Object.keys(value).forEach(function (key) { visit(value[key], path ? path + '.' + key : key, depth + 1); });
    }
    visit(snapshot, '$', 0);
    return fields;
  }

  function numericPrimitive(fields, pattern) {
    var path = Object.keys(fields).find(function (key) { return pattern.test(key) && typeof fields[key] === 'number'; });
    return path ? { path: path, value: fields[path] } : null;
  }

  function booleanPrimitive(fields, pattern) {
    var path = Object.keys(fields).find(function (key) { return pattern.test(key) && typeof fields[key] === 'boolean'; });
    return path ? { path: path, value: fields[path] } : null;
  }

  function chooseStreetCommitmentField(playerId, previousRecord, currentRecord, previousTrackedState, streetChanged, previousSnapshot, currentSnapshot) {
    var beforeFields = flattenPlayerSnapshotPrimitives(previousSnapshot, playerId, previousRecord);
    var afterFields = flattenPlayerSnapshotPrimitives(currentSnapshot, playerId, currentRecord);
    var previousStackInfo = numericPrimitive(beforeFields, /(?:^|\.)(?:stack|chips?|balance)$/i);
    var currentStackInfo = numericPrimitive(afterFields, /(?:^|\.)(?:stack|chips?|balance)$/i);
    var stackSpent = previousStackInfo && currentStackInfo ? previousStackInfo.value - currentStackInfo.value : null;
    var candidates = [];
    Object.keys(afterFields).forEach(function (path) {
      if (typeof afterFields[path] !== 'number' || typeof beforeFields[path] !== 'number') return;
      if (/(?:stack|chips?|balance|win|count|seat|position|time|timestamp|sequence|version|gained|profit|rank)/i.test(path)) return;
      var previousValue = beforeFields[path];
      var currentValue = afterFields[path];
      if (previousValue < 0 || currentValue < 0 || currentValue > 1000000000) return;
      var knownCumulative = /(?:^|\.)(?:bet|currentBet|current_bet|betAmount|bet_amount|committed|streetCommitted|street_committed|contribution|wager)$/i.test(path);
      var totalOnly = /(?:total|handCommitted|hand_committed)/i.test(path);
      if (totalOnly) return;
      var delta = currentValue - previousValue;
      var profileKey = String(playerId) + '|' + path;
      var profile = liveActionTracker.commitmentFieldProfiles.get(profileKey) || { playerId: String(playerId), path: path, score: 0, increases: 0, streetResets: 0, sameStreetDecreases: 0, observations: 0 };
      profile.observations += 1;
      if (delta > 0) profile.increases += 1;
      if (streetChanged && previousValue > 0 && currentValue === 0) profile.streetResets += 1;
      if (!streetChanged && delta < 0) profile.sameStreetDecreases += 1;
      if (typeof stackSpent === 'number' && stackSpent > 0 && Math.abs(delta - stackSpent) < 0.0001) profile.score += 5;
      if (streetChanged && previousValue > 0 && currentValue === 0) profile.score += 3;
      if (!streetChanged && delta < 0) profile.score -= 4;
      if (knownCumulative) profile.score += 20;
      liveActionTracker.commitmentFieldProfiles.set(profileKey, profile);
      var trackedPrevious = previousTrackedState ? previousTrackedState.streetCommitment : null;
      var matchesTrackedCumulative = trackedPrevious === null || trackedPrevious === undefined || Math.abs(previousValue - trackedPrevious) < 0.0001;
      var evidenceScore = (knownCumulative ? 100 : profile.score) + (matchesTrackedCumulative ? 8 : -20);
      candidates.push({ path: path, previous: previousValue, current: currentValue, delta: delta, knownCumulative: knownCumulative, matchesTrackedCumulative: matchesTrackedCumulative, evidenceScore: evidenceScore, stackSpent: stackSpent, profile: cloneJson(profile) });
    });
    candidates.sort(function (left, right) { return right.evidenceScore - left.evidenceScore; });
    var selected = candidates[0];
    if (!selected || (!selected.knownCumulative && selected.evidenceScore < 13)) return { selected: null, candidates: candidates, previousStack: previousStackInfo && previousStackInfo.value, currentStack: currentStackInfo && currentStackInfo.value };
    return { selected: selected, candidates: candidates, previousStack: previousStackInfo && previousStackInfo.value, currentStack: currentStackInfo && currentStackInfo.value };
  }

  function playerActionState(playerId, previousRecord, currentRecord, previousTrackedState, streetChanged, previousSnapshot, currentSnapshot) {
    var beforeFields = flattenPlayerSnapshotPrimitives(previousSnapshot, playerId, previousRecord);
    var afterFields = flattenPlayerSnapshotPrimitives(currentSnapshot, playerId, currentRecord);
    var commitmentChoice = chooseStreetCommitmentField(playerId, previousRecord, currentRecord, previousTrackedState, streetChanged, previousSnapshot, currentSnapshot);
    var selected = commitmentChoice.selected;
    var previousCommitment = streetChanged ? 0 : (previousTrackedState ? previousTrackedState.streetCommitment : (selected ? selected.previous : null));
    var currentCommitment = selected ? selected.current : previousCommitment;
    var explicitTotal = numericPrimitive(afterFields, /(?:totalCommitted|total_committed|handCommitted|hand_committed|committedThisHand|committed_this_hand)/i);
    var previousTotal = previousTrackedState ? previousTrackedState.totalCommitment : 0;
    var currentTotal = explicitTotal ? explicitTotal.value : previousTotal;
    var folded = booleanPrimitive(afterFields, /(?:^|\.)(?:folded|isFolded|is_folded)$/i);
    var allIn = booleanPrimitive(afterFields, /(?:allIn|all_in|isAllIn|is_all_in)/i);
    var active = booleanPrimitive(afterFields, /(?:^|\.)(?:active|isActive|is_active|inHand|in_hand|playing)$/i);
    return {
      playerId: String(playerId),
      playerName: socketPlayerNames.get(String(playerId)) || null,
      stack: commitmentChoice.currentStack,
      previousStack: commitmentChoice.previousStack,
      streetCommitment: currentCommitment,
      previousStreetCommitment: previousCommitment,
      totalCommitment: currentTotal,
      previousTotalCommitment: previousTotal,
      folded: folded ? folded.value : (previousTrackedState ? previousTrackedState.folded : false),
      allIn: allIn ? allIn.value : (previousTrackedState ? previousTrackedState.allIn : false),
      active: active ? active.value : (previousTrackedState ? previousTrackedState.active : true),
      commitmentEvidence: selected,
      commitmentCandidates: commitmentChoice.candidates,
      rawFields: afterFields
    };
  }

  function recordActionFieldDiagnostics(changedPaths, afterStates, previousActor, currentActor, previousHighestBet, currentHighestBet, previousSnapshot, currentSnapshot, transitionRecord) {
    var previousPot = findPotValue(previousSnapshot);
    var currentPot = findPotValue(currentSnapshot);
    var namedPotDelta = typeof previousPot === 'number' && typeof currentPot === 'number' ? currentPot - previousPot : null;
    var numericChanges = (changedPaths || []).filter(function (change) {
      return typeof change.previous === 'number' && typeof change.current === 'number';
    });
    afterStates.forEach(function (state) {
      var stackDelta = typeof state.previousStack === 'number' && typeof state.stack === 'number' ? state.previousStack - state.stack : null;
      var turnTransition = { previousActor: previousActor, currentActor: currentActor, actorChanged: Boolean(previousActor && currentActor && String(previousActor) !== String(currentActor)) };
      numericChanges.forEach(function (change) {
        var belongsToPlayer = change.path.indexOf(String(state.playerId)) >= 0;
        var isPlayerCollectionField = /(?:^|\.)players?(?:\.|\[)/i.test(change.path);
        if (isPlayerCollectionField && !belongsToPlayer) return;
        if (!belongsToPlayer && stackDelta === null && String(previousActor) !== state.playerId) return;
        var fieldDelta = change.current - change.previous;
        var exactStackCorrelation = typeof stackDelta === 'number' && stackDelta > 0 && Math.abs(fieldDelta - stackDelta) < 0.0001;
        var oppositeStackCorrelation = typeof stackDelta === 'number' && stackDelta > 0 && Math.abs(fieldDelta + stackDelta) < 0.0001;
        var namedCommitment = /(?:bet|wager|commit|contribut)/i.test(change.path);
        var namedPot = /(?:^|\.)(?:pot|potSize|pot_size|currentPot|current_pot|totalPot|total_pot)$/i.test(change.path);
        var inferredMeaning = 'unmapped numeric state';
        var confidence = 'low';
        if (/(?:^|\.)(?:stack|chips?|balance)$/i.test(change.path)) {
          inferredMeaning = 'player stack';
          confidence = 'high';
        } else if (namedCommitment && belongsToPlayer) {
          inferredMeaning = fieldDelta >= 0 ? 'named player commitment candidate' : 'named commitment reset';
          confidence = 'high';
        } else if (namedPot) {
          inferredMeaning = 'named pot candidate';
          confidence = 'high';
        } else if (belongsToPlayer && exactStackCorrelation) {
          inferredMeaning = 'possible cumulative street commitment or incremental chips';
          confidence = 'medium';
        } else if (!isPlayerCollectionField && exactStackCorrelation) {
          inferredMeaning = 'possible pot or table-level street wager';
          confidence = 'medium';
        } else if (belongsToPlayer && oppositeStackCorrelation) {
          inferredMeaning = 'possible stack-like balance mirror';
          confidence = 'medium';
        }
        var canonicalPath = change.path.split(String(state.playerId)).join('$player');
        var profileKey = state.playerId + '|' + canonicalPath;
        var profile = liveActionTracker.numericFieldProfiles.get(profileKey) || {
          playerId: state.playerId,
          player: state.playerName,
          candidateFieldPath: canonicalPath,
          observations: 0,
          exactStackMatches: 0,
          oppositeStackMatches: 0,
          positiveChanges: 0,
          resetsToZero: 0,
          turnChangeObservations: 0,
          correlationScore: 0
        };
        profile.observations += 1;
        if (fieldDelta > 0) profile.positiveChanges += 1;
        if (change.previous > 0 && change.current === 0) profile.resetsToZero += 1;
        if (turnTransition.actorChanged) profile.turnChangeObservations += 1;
        if (exactStackCorrelation) profile.exactStackMatches += 1;
        if (oppositeStackCorrelation) profile.oppositeStackMatches += 1;
        profile.correlationScore = profile.exactStackMatches * 8 + profile.resetsToZero * 3 + profile.turnChangeObservations - profile.oppositeStackMatches * 2 + (namedCommitment ? 30 : 0) + (namedPot ? 25 : 0);
        profile.lastPreviousValue = change.previous;
        profile.lastCurrentValue = change.current;
        profile.lastSeenAt = transitionRecord.timestamp;
        liveActionTracker.numericFieldProfiles.set(profileKey, profile);
        var diagnostic = {
          timestamp: transitionRecord.timestamp,
          recordId: transitionRecord.id,
          eventName: transitionRecord.eventName,
          playerId: state.playerId,
          player: state.playerName,
          candidateFieldPath: change.path,
          previousValue: change.previous,
          currentValue: change.current,
          fieldDelta: fieldDelta,
          stackDelta: stackDelta,
          potDelta: namedPot ? fieldDelta : namedPotDelta,
          turnTransition: turnTransition,
          previousHighestWager: previousHighestBet,
          currentHighestWager: currentHighestBet,
          inferredMeaning: inferredMeaning,
          confidence: confidence,
          correlationScore: profile.correlationScore
        };
        liveActionTracker.fieldDiagnostics.push(diagnostic);
        if (liveActionTracker.fieldDiagnostics.length > 1500) liveActionTracker.fieldDiagnostics.shift();
        console.log('[HUD ACTION FIELD]', diagnostic);
      });
    });
  }

  function collectRosterIdScalars(payload, rosterIds) {
    var matches = [];
    function visit(value, path, depth) {
      if (value === null || value === undefined || depth > 8) return;
      if (['string', 'number'].includes(typeof value)) {
        if (rosterIds.includes(String(value)) && !/(?:players?\.[^.]+|dealer|button|winner|result|gain)/i.test(path)) matches.push({ path: path, value: String(value) });
        return;
      }
      if (typeof value === 'object') {
        if (Array.isArray(value)) value.forEach(function (item, index) { visit(item, path + '[' + index + ']', depth + 1); });
        else Object.keys(value).forEach(function (key) { visit(value[key], path ? path + '.' + key : key, depth + 1); });
      }
    }
    visit(payload, '$', 0);
    return matches;
  }

  function resolveActionActor(current, rosterIds) {
    var explicit = actorValue(current);
    if (explicit !== null && explicit !== undefined && rosterIds.includes(String(explicit))) return { playerId: String(explicit), path: 'named actor field', confidence: 'high' };
    var matches = collectRosterIdScalars(current, rosterIds);
    matches.forEach(function (match) {
      var profile = liveActionTracker.actorFieldProfiles.get(match.path) || { score: 0, changes: 0, observations: 0, lastValue: null };
      profile.observations += 1;
      if (profile.lastValue !== null && profile.lastValue !== match.value) { profile.changes += 1; profile.score += 5; }
      if (/(?:actor|acting|turn|current|next|toAct|to_act)/i.test(match.path)) profile.score += 20;
      if (match.path.split('.').pop().length <= 5) profile.score += 1;
      profile.lastValue = match.value;
      liveActionTracker.actorFieldProfiles.set(match.path, profile);
      match.score = profile.score;
    });
    matches.sort(function (left, right) { return right.score - left.score; });
    return matches.length && matches[0].score >= 5 ? { playerId: matches[0].value, path: matches[0].path, confidence: 'learned', alternatives: matches } : { playerId: liveActionTracker.actorId, path: null, confidence: 'carried forward', alternatives: matches };
  }

  function actionStreet(current) {
    var named = normalizeStreet(phaseValue(current));
    if (named) return named;
    var boardLength = findBoardLength(current);
    if (boardLength >= 5) return 'river';
    if (boardLength === 4) return 'turn';
    if (boardLength >= 3) return 'flop';
    if (boardLength === 0) return 'preflop';
    var boards = collectCardCollections(current).filter(function (item) { return item.kind === 'board'; });
    var maxBoard = boards.reduce(function (max, board) { return Math.max(max, board.length); }, 0);
    if (maxBoard >= 5) return 'river';
    if (maxBoard === 4) return 'turn';
    if (maxBoard >= 3) return 'flop';
    return socketGameContext.street || liveActionTracker.street || 'preflop';
  }

  function actionLogCandidate(candidate) {
    if (candidate.forcedBlind) {
      console.log('[HUD ACTION LIVE] forced blind seed excluded from voluntary candidate lifecycle', candidate);
      return;
    }
    if (!candidate.lifecycleManaged) pipelineHealth.actionCandidates += 1;
    if (candidate.accepted) {
      var counterKey = { check: 'checksDetected', call: 'callsDetected', bet: 'betsDetected', raise: 'raisesDetected', fold: 'foldsDetected' }[candidate.inferredAction];
      if (counterKey) pipelineHealth[counterKey] += 1;
    } else if (!candidate.forcedBlind && !candidate.excludedTransition && !candidate.pending) {
      pipelineHealth.ambiguousActionsRejected += 1;
    }
    updateHealthPanel();
    console.log('[HUD ACTION] candidate', candidate);
  }

  function archiveCurrentActionHand() {
    if (!liveActionTracker.currentHandSequence) return;
    liveActionTracker.currentHandSequence.endedAt = Date.now();
    liveActionTracker.completedHands.push(liveActionTracker.currentHandSequence);
    if (liveActionTracker.completedHands.length > 10) liveActionTracker.completedHands.shift();
  }

  function baselineActionHand(current, transitionRecord, handTransition) {
    archiveCurrentActionHand();
    liveActionTracker.handId = socketGameContext.handId;
    liveActionTracker.street = 'preflop';
    liveActionTracker.actorId = resolveActionActor(current, Object.keys(findPlayersMap(current) || {})).playerId;
    liveActionTracker.players = new Map();
    if (!liveActionTracker.livePipelineState) {
      liveActionTracker.livePipelineState = PokerLiveActionPipeline.createState({ handId: liveActionTracker.handId, street: liveActionTracker.street, maxPatchDistance: 8, maxWindowMs: 5000, schemaConfirmed: true });
    }
    liveActionTracker.tbTracker = liveActionTracker.livePipelineState.tracker;
    var blindByPlayer = new Map((handTransition.events || []).filter(function (event) { return event.action === 'blind'; }).map(function (event) { return [event.player, event.amount]; }));
    var players = findPlayersMap(current) || {};
    Object.keys(players).forEach(function (playerId) {
      var state = playerActionState(playerId, players[playerId], players[playerId], null, true, current, current);
      if ((state.streetCommitment === null || state.streetCommitment === 0) && blindByPlayer.has(state.playerName)) state.streetCommitment = blindByPlayer.get(state.playerName);
      state.totalCommitment = state.streetCommitment || 0;
      liveActionTracker.players.set(String(playerId), state);
    });
    liveActionTracker.highestStreetBet = Array.from(liveActionTracker.players.values()).reduce(function (max, state) { return Math.max(max, Number(state.streetCommitment || 0)); }, 0);
    liveActionTracker.currentHandSequence = {
      handId: liveActionTracker.handId,
      startedAt: transitionRecord.timestamp,
      startingStreet: liveActionTracker.street,
      patches: [],
      acceptedActions: [],
      rejectedCandidates: [],
      voluntaryActionCount: 0,
      forcedBlinds: (handTransition.events || []).filter(function (event) { return event.action === 'blind'; }).map(function (event) { return cloneJson(event); })
    };
  }

  function refreshPotOddsFromLedger(reason, options) {
    options = options || {};
    var liveState = PokerPotOdds.liveStateFromContinuity(potOddsLiveState);
    var input = liveState ? Object.assign({}, liveState, {
      enabled: hudUiPreferences.showPotOdds,
      localPlayerId: localUserPlayerId,
      transitioning: options.transitioning === true,
      actorSource: liveState.evidence && 'semantic ledger ' + (liveState.evidence.fields || []).join(', '),
      actionSource: 'PokerSemanticHandLedger.liveBettingState'
    }) : { enabled: hudUiPreferences.showPotOdds, localPlayerId: localUserPlayerId, handId: potOddsLiveState.currentHandId || socketGameContext.handId, transitioning: options.transitioning === true };
    var next = PokerPotOdds.resolve(input);
    recordPotOddsForensic('decision-resolved', reason, { resolvedStatus: next.status, resolvedReasonCode: next.reasonCode, resolvedFingerprint: PokerPotOdds.decisionRenderFingerprint(next, hudUiPreferences.showPotOdds) });
    var changed = commitPotOddsDecision(next, 'pot odds decision changed: ' + String(reason || 'semantic update'), {
      liveState: liveState,
      transitioning: options.transitioning === true,
      snapshot: options.snapshot || null,
      terminal: options.terminal === true,
      forceZero: options.forceZero === true,
      definiteZero: options.definiteZero === true,
      failClosed: options.failClosed === true
    });
    if (changed) {
      console.log('[HUD POT ODDS]', { reason: reason, decision: PokerPotOdds.currentDecision(next) });
    }
    return next;
  }

  function inferTbActionCandidates(previous, current, changedPaths, transitionRecord, newHand) {
    if (!liveActionTracker.livePipelineState) return null;
    var productionResult = PokerLiveActionPipeline.handleMergedPatch(liveActionTracker.livePipelineState, previous, current, {
      recordId: transitionRecord.id,
      timestamp: transitionRecord.timestamp,
      incomingPatch: transitionRecord.incomingPatch,
      handId: liveActionTracker.handId,
      street: liveActionTracker.street,
      newHand: Boolean(newHand)
    });
    if (!productionResult.handled) return null;
    liveActionTracker.tbTracker = liveActionTracker.livePipelineState.tracker;
    pipelineHealth.pendingActionCandidates = productionResult.pendingCount;
    updateHealthPanel();
    var patch = productionResult.normalized;
    var result = productionResult.inference;
    console.log('[HUD ACTION LIVE] normalized live fields', {
      handId: liveActionTracker.handId,
      patchRecordId: patch.recordId,
      street: liveActionTracker.tbTracker && liveActionTracker.tbTracker.street,
      tB: patch.tB,
      cPI: patch.cPI,
      pITT: patch.pITT,
      cRPI: patch.cRPI,
      sBPI: patch.sBPI,
      bBPI: patch.bBPI,
      players: patch.players,
      potDelta: patch.potDelta,
      settlement: patch.settlement,
      candidates: result.candidates
    });
    var normalizedTbTrace = PokerTbTrace.traceNormalized(tbTraceState, patch, { handId: liveActionTracker.handId, street: liveActionTracker.tbTracker && liveActionTracker.tbTracker.street, patchRecordId: patch.recordId });
    pipelineHealth.normalizedTbTransitionsSeen = tbTraceState.normalizedTransitions;
    console.log('[HUD TB TRACE] normalized', normalizedTbTrace);
    var gateTrace = PokerTbTrace.recordGates(tbTraceState, result.gates || [], { handId: liveActionTracker.handId, street: liveActionTracker.tbTracker && liveActionTracker.tbTracker.street, patchRecordId: patch.recordId });
    pipelineHealth.voluntaryTbTransitionsGated = tbTraceState.voluntaryGates;
    var gatesByPlayer = new Map((result.gates || []).map(function (gate) { return [String(gate.playerId), gate]; }));
    (normalizedTbTrace.transitions || []).forEach(function (transition) {
      var gate = gatesByPlayer.get(String(transition.playerId));
      if (gate) return;
      console.log('[HUD TB TRACE] resolver', {
        handId: liveActionTracker.handId,
        street: liveActionTracker.tbTracker && liveActionTracker.tbTracker.street,
        patchRecordId: patch.recordId,
        playerId: transition.playerId,
        player: socketPlayerNames.get(String(transition.playerId)) || null,
        previousTb: transition.previous,
        currentTb: transition.current,
        currentTbType: transition.currentType,
        smallBlindPlayerId: patch.sBPI,
        bigBlindPlayerId: patch.bBPI,
        actor: patch.cPI || patch.pITT || null,
        cRPI: patch.cRPI
      });
      console.log('[HUD TB TRACE] candidate gate', {
        handId: liveActionTracker.handId,
        street: liveActionTracker.tbTracker && liveActionTracker.tbTracker.street,
        patchRecordId: patch.recordId,
        playerId: transition.playerId,
        previousTb: transition.previous,
        currentTb: transition.current,
        candidateCreated: false,
        branch: 'resolver-produced-no-gate',
        rejectionReason: 'normalized tB changed but actionInference returned no gate for this player'
      });
    });
    (result.gates || []).forEach(function (gate) {
      var resolverTrace = {
        handId: liveActionTracker.handId,
        street: liveActionTracker.tbTracker && liveActionTracker.tbTracker.street,
        patchRecordId: patch.recordId,
        playerId: gate.playerId,
        player: socketPlayerNames.get(String(gate.playerId)) || null,
        previousTb: gate.previousTb,
        currentTb: gate.currentTb,
        currentTbType: gate.currentTb === null ? 'null' : typeof gate.currentTb,
        smallBlindPlayerId: patch.sBPI,
        bigBlindPlayerId: patch.bBPI,
        actor: patch.cPI || patch.pITT || null,
        cRPI: patch.cRPI
      };
      console.log('[HUD TB TRACE] resolver', resolverTrace);
      console.log('[HUD TB TRACE] candidate gate', Object.assign({}, resolverTrace, { candidateCreated: gate.candidateCreated, voluntaryTransition: gate.voluntaryTransition, action: gate.action || null, amount: gate.amount || 0, branch: gate.branch, rejectionReason: gate.reason }));
    });
    if (!(result.gates || []).length) console.log('[HUD TB TRACE] candidate gate', { handId: liveActionTracker.handId, street: liveActionTracker.tbTracker && liveActionTracker.tbTracker.street, patchRecordId: patch.recordId, candidateCreated: false, branch: 'no-tB-transition', rejectionReason: 'normalized tB values did not change in this patch', normalizedTrace: normalizedTbTrace, gateTrace: gateTrace });
    if (productionResult.invariant) {
      pipelineHealth.actionCandidates = productionResult.invariant.created;
      pipelineHealth.pendingActionCandidates = productionResult.invariant.pending;
      pipelineHealth.confirmedActionCandidates = productionResult.invariant.confirmed;
      pipelineHealth.rejectedActionCandidates = productionResult.invariant.rejected;
      pipelineHealth.expiredActionCandidates = productionResult.invariant.expired;
      console.log('[HUD ACTION LIVE] lifecycle invariant', productionResult.invariant);
    }
    (productionResult.invariantViolations || []).forEach(function (violation) {
      console.error('[HUD ACTION LIVE] invariant violation: candidate lost', violation);
      setPipelineFailure('action lifecycle invariant violation: candidate lost', violation);
    });
    updateHealthPanel();
    var tB = patch.tB;
    var players = patch.players;
    var settlement = patch.settlement;
    productionResult.lifecycle.forEach(function (lifecycle) {
      var mappedLifecycle = Object.assign({}, lifecycle, { player: socketPlayerNames.get(String(lifecycle.playerId)) || null });
      var label = lifecycle.kind === 'created' ? 'candidate created'
        : lifecycle.kind === 'retained' ? 'candidate retained'
          : lifecycle.kind === 'confirmed' ? 'candidate confirmed'
            : lifecycle.kind === 'expired' ? 'candidate expired'
              : 'candidate rejected';
      console.log('[HUD ACTION LIVE] ' + label, mappedLifecycle);
    });
    var mappedCandidates = [];
    result.candidates.forEach(function (item) {
      var mappedName = socketPlayerNames.get(String(item.playerId)) || null;
      var diagnosticCandidate = {
        timestamp: item.timestamp,
        recordId: item.recordId,
        playerId: String(item.playerId || ''),
        mappedName: mappedName,
        previousStack: null,
        currentStack: players[item.playerId] && players[item.playerId].stack,
        previousStreetCommitment: null,
        currentStreetCommitment: null,
        previousTotalCommitment: null,
        currentTotalCommitment: null,
        previousHighestBet: null,
        currentHighestBet: liveActionTracker.tbTracker.highestWager,
        previousActor: null,
        currentActor: patch.cPI || patch.pITT || null,
        street: item.street,
        inferredAction: item.action,
        amount: item.amount || 0,
        accepted: item.accepted,
        pending: Boolean(item.pending),
        lifecycleManaged: true,
        forcedBlind: Boolean(item.forcedBlind),
        reason: item.reason,
        evidencePath: 'external.$.tB.$player'
      };
      actionLogCandidate(diagnosticCandidate);
      mappedCandidates.push(diagnosticCandidate);
      if (item.accepted && item.action && item.action !== 'blind') {
        liveActionTracker.currentHandSequence.acceptedActions.push({ handId: liveActionTracker.handId, player: mappedName, action: item.action, street: item.street, amount: item.amount || 0, timestamp: item.timestamp });
        if (item.action === 'call' || item.action === 'bet' || item.action === 'raise') liveActionTracker.currentHandSequence.voluntaryActionCount += 1;
      } else if (!item.accepted && !item.pending && !item.forcedBlind) {
        liveActionTracker.currentHandSequence.rejectedCandidates.push(diagnosticCandidate);
      }
    });
    result.diagnostics.forEach(function (item) {
      var mappedName = socketPlayerNames.get(String(item.playerId)) || null;
      var stackDelta = typeof item.previousStack === 'number' && typeof item.currentStack === 'number' ? item.previousStack - item.currentStack : null;
      var profileKey = String(item.playerId) + '|external.$.tB.$player';
      var profile = liveActionTracker.numericFieldProfiles.get(profileKey) || {
        playerId: String(item.playerId),
        player: mappedName,
        candidateFieldPath: 'external.$.tB.$player',
        observations: 0,
        numericAbsoluteTotals: 0,
        explicitChecks: 0,
        cleanupTransitions: 0,
        delayedStackMatches: 0,
        correlationScore: 0
      };
      profile.observations += 1;
      if (typeof item.currentValue === 'number') profile.numericAbsoluteTotals += 1;
      else if (String(item.currentValue).toLowerCase() === 'check') profile.explicitChecks += 1;
      else if (item.currentValue === '<D>' || item.currentValue === null || item.currentValue === undefined) profile.cleanupTransitions += 1;
      if (!item.settlement && typeof stackDelta === 'number' && stackDelta > 0 && typeof item.previousValue === 'number' && Math.abs(stackDelta - item.previousValue) < 0.0001) profile.delayedStackMatches += 1;
      profile.correlationScore = profile.numericAbsoluteTotals * 5 + profile.explicitChecks * 8 + profile.cleanupTransitions * 2 + profile.delayedStackMatches * 20;
      profile.lastPreviousValue = item.previousValue;
      profile.lastCurrentValue = item.currentValue;
      profile.lastSeenAt = transitionRecord.timestamp;
      liveActionTracker.numericFieldProfiles.set(profileKey, profile);
      var fieldDiagnostic = {
        timestamp: transitionRecord.timestamp,
        recordId: transitionRecord.id,
        eventName: transitionRecord.eventName,
        playerId: String(item.playerId),
        player: mappedName,
        candidateFieldPath: '$.tB.' + item.playerId,
        canonicalFieldPath: 'external.$.tB.$player',
        previousValue: item.previousValue,
        currentValue: item.currentValue,
        stackDelta: stackDelta,
        potDelta: patch.potDelta,
        turnTransition: { currentActor: patch.cPI, timerActor: patch.pITT, roundPlayers: patch.cRPI },
        inferredMeaning: typeof item.currentValue === 'number'
          ? 'absolute current-street wager total'
          : (String(item.currentValue).toLowerCase() === 'check'
            ? 'explicit check action token'
            : (/^(?:fold|folded)$/i.test(String(item.currentValue)) ? 'explicit fold action token' : 'action display cleanup')),
        confidence: liveActionTracker.tbTracker.schemaConfirmed ? 'high' : 'pending cross-patch corroboration',
        correlationScore: profile.correlationScore
      };
      liveActionTracker.fieldDiagnostics.push(fieldDiagnostic);
      if (liveActionTracker.fieldDiagnostics.length > 1500) liveActionTracker.fieldDiagnostics.shift();
      console.log('[HUD ACTION FIELD]', fieldDiagnostic);
    });
    liveActionTracker.street = liveActionTracker.tbTracker.street;
    liveActionTracker.highestStreetBet = liveActionTracker.tbTracker.highestWager;
    liveActionTracker.currentHandSequence.patches.push({
      recordId: transitionRecord.id,
      timestamp: transitionRecord.timestamp,
      eventName: transitionRecord.eventName,
      source: 'PokerNow tB action state',
      street: liveActionTracker.tbTracker.street,
      transportFields: { tB: cloneJson(tB), cPI: patch.cPI, pITT: patch.pITT, cRPI: cloneJson(patch.cRPI), bBPI: patch.bBPI, sBPI: patch.sBPI, settlement: settlement, potDelta: patch.potDelta },
      players: cloneJson(players),
      pendingActions: cloneJson(liveActionTracker.tbTracker.pending),
      candidates: mappedCandidates,
      fieldDiagnostics: cloneJson(result.diagnostics)
    });
    return result.events.map(function (event) {
      return {
        handId: liveActionTracker.handId,
        playerId: String(event.playerId),
        player: socketPlayerNames.get(String(event.playerId)) || null,
        action: event.action,
        street: event.street,
        amount: Number(event.amount || 0),
        timestamp: event.timestamp,
        confidence: 'PokerNow tB ordered action state',
        evidence: event.evidence,
        ambiguous: false
      };
    });
  }

  function inferLiveActionCandidates(previous, current, changedPaths, transitionRecord, handTransition) {
    var acceptedEvents = [];
    var players = findPlayersMap(current) || {};
    var previousPlayers = previous ? findPlayersMap(previous) || {} : {};
    var rosterIds = Object.keys(players);
    if (handTransition.detected) {
      var duplicateSameHandBoundary = liveActionTracker.livePipelineState && liveActionTracker.handId && String(liveActionTracker.handId) === String(socketGameContext.handId);
      if (!duplicateSameHandBoundary) {
        baselineActionHand(current, transitionRecord, handTransition);
        liveActionTracker.currentHandSequence.patches.push({ recordId: transitionRecord.id, timestamp: transitionRecord.timestamp, eventName: transitionRecord.eventName, reason: 'new-hand baseline; forced blinds are not actions', street: liveActionTracker.street, actor: liveActionTracker.actorId, highestStreetBet: liveActionTracker.highestStreetBet });
      } else {
        console.log('[HUD ACTION LIVE] duplicate hand boundary retained action state', { handId: liveActionTracker.handId, patchRecordId: transitionRecord.id, pendingCount: liveActionTracker.tbTracker ? liveActionTracker.tbTracker.pending.length : 0 });
      }
      var boundaryTbCandidates = inferTbActionCandidates(previous, current, changedPaths, transitionRecord, true);
      return boundaryTbCandidates || acceptedEvents;
    }
    if (!previous || !liveActionTracker.handId || !liveActionTracker.currentHandSequence) return acceptedEvents;

    var tbCandidates = inferTbActionCandidates(previous, current, changedPaths, transitionRecord, false);
    if (tbCandidates) return tbCandidates;

    var street = actionStreet(current);
    var streetChanged = street !== liveActionTracker.street;
    var previousActor = liveActionTracker.actorId;
    var actorResolution = resolveActionActor(current, rosterIds);
    var currentActor = actorResolution.playerId;
    var previousHighestBet = liveActionTracker.highestStreetBet;
    var beforeStates = Array.from(liveActionTracker.players.values()).map(function (state) { return cloneJson(state); });
    var afterStates = new Map();
    rosterIds.forEach(function (playerId) {
      var tracked = liveActionTracker.players.get(String(playerId)) || null;
      afterStates.set(String(playerId), playerActionState(playerId, previousPlayers[playerId] || players[playerId], players[playerId], tracked, streetChanged, previous, current));
    });

    if (streetChanged) {
      afterStates.forEach(function (state) { state.streetCommitment = 0; state.previousStreetCommitment = 0; });
    }
    var currentHighestBet = Array.from(afterStates.values()).reduce(function (max, state) { return Math.max(max, Number(state.streetCommitment || 0)); }, 0);
    recordActionFieldDiagnostics(changedPaths, afterStates, previousActor, currentActor, previousHighestBet, currentHighestBet, previous, current, transitionRecord);
    var settlementPatch = nonEmptyObjectByKeyPattern(transitionRecord.incomingPatch, /^(?:gameResult|game_result|settlement|results?|winners?)$/i);
    var contributionChanges = Array.from(afterStates.values()).filter(function (state) { return typeof state.streetCommitment === 'number' && typeof state.previousStreetCommitment === 'number' && state.streetCommitment > state.previousStreetCommitment; });
    var stackOnlyChanges = Array.from(afterStates.values()).filter(function (state) {
      return typeof state.previousStack === 'number' && typeof state.stack === 'number' && state.previousStack > state.stack && !state.commitmentEvidence && Number(state.streetCommitment || 0) === Number(state.previousStreetCommitment || 0);
    });
    afterStates.forEach(function (state) {
      var added = Number(state.streetCommitment || 0) - Number(state.previousStreetCommitment || 0);
      if (added > 0) state.totalCommitment = Number(state.previousTotalCommitment || 0) + added;
    });
    var patchCandidates = [];

    function candidateFor(state, action, accepted, reason, amount, extra) {
      var candidate = Object.assign({
        timestamp: transitionRecord.timestamp,
        recordId: transitionRecord.id,
        playerId: state && state.playerId,
        mappedName: state && state.playerName,
        previousStack: state && state.previousStack,
        currentStack: state && state.stack,
        previousStreetCommitment: state && state.previousStreetCommitment,
        currentStreetCommitment: state && state.streetCommitment,
        previousTotalCommitment: state && state.previousTotalCommitment,
        currentTotalCommitment: state && state.totalCommitment,
        previousHighestBet: previousHighestBet,
        currentHighestBet: currentHighestBet,
        previousActor: previousActor,
        currentActor: currentActor,
        street: street,
        inferredAction: action,
        accepted: accepted,
        reason: reason,
        commitmentEvidence: state && state.commitmentEvidence
      }, extra || {});
      actionLogCandidate(candidate);
      patchCandidates.push(candidate);
      if (accepted) {
        var event = { handId: liveActionTracker.handId, player: state.playerName, action: action, street: street, amount: Number(amount || 0), timestamp: transitionRecord.timestamp };
        acceptedEvents.push({ handId: event.handId, player: event.player, action: event.action, street: event.street, amount: event.amount, timestamp: transitionRecord.timestamp, confidence: 'ordered-state-transition', evidence: reason, ambiguous: false });
        liveActionTracker.currentHandSequence.acceptedActions.push(event);
        if (action === 'call' || action === 'bet' || action === 'raise') liveActionTracker.currentHandSequence.voluntaryActionCount += 1;
      } else {
        liveActionTracker.currentHandSequence.rejectedCandidates.push(candidate);
      }
    }

    if (!streetChanged && !settlementPatch && contributionChanges.length > 1) {
      contributionChanges.forEach(function (state) { candidateFor(state, null, false, 'multiple players changed commitments in one patch; action order is ambiguous', 0); });
    } else if (!streetChanged && !settlementPatch) {
      contributionChanges.forEach(function (state) {
        var added = state.streetCommitment - state.previousStreetCommitment;
        if (!state.commitmentEvidence) { candidateFor(state, null, false, 'stack changed without a reliable committed-bet field; stack-only inference is forbidden', 0); return; }
        if (previousActor && String(previousActor) !== state.playerId) { candidateFor(state, null, false, 'commitment changed for a player who was not the previous actor', 0); return; }
        var classification = PokerActionInference.classifyCommitmentTransition({ previousCommitment: state.previousStreetCommitment, currentCommitment: state.streetCommitment, previousHighestBet: previousHighestBet });
        candidateFor(state, classification.action, classification.accepted, classification.reason, classification.amount || 0, { addedAmount: classification.addedAmount, amountIsTotalTo: classification.amountIsTotalTo });
      });
    }

    if (!streetChanged && !settlementPatch) {
      stackOnlyChanges.forEach(function (state) {
        if (patchCandidates.some(function (candidate) { return candidate.playerId === state.playerId; })) return;
        candidateFor(state, null, false, 'stack decreased but no corroborating cumulative commitment field was available; rejected rather than guessing', 0, {
          stackDelta: state.previousStack - state.stack,
          commitmentFieldCandidates: state.commitmentCandidates.slice(0, 10)
        });
      });
    }

    afterStates.forEach(function (state) {
      var before = liveActionTracker.players.get(state.playerId);
      if (!before || streetChanged || settlementPatch) return;
      if (before.folded === false && state.folded === true) candidateFor(state, 'fold', true, 'folded flag changed false to true', 0);
      else if (before.active === true && state.active === false && String(previousActor) === state.playerId) candidateFor(state, 'fold', true, 'active/in-hand flag changed while player was actor', 0);
    });

    var previousActorState = previousActor && afterStates.get(String(previousActor));
    var actorChanged = previousActor && currentActor && String(previousActor) !== String(currentActor);
    var actorAlreadyHasCandidate = patchCandidates.some(function (candidate) { return candidate.playerId === String(previousActor); });
    if (!streetChanged && !settlementPatch && actorChanged && previousActorState && !actorAlreadyHasCandidate) {
      var outstanding = previousHighestBet - Number(previousActorState.previousStreetCommitment || 0);
      var addedByActor = Number(previousActorState.streetCommitment || 0) - Number(previousActorState.previousStreetCommitment || 0);
      var allCommitmentsVerified = Array.from(afterStates.values()).filter(function (state) { return state.active !== false && state.folded !== true; }).every(function (state) { return Boolean(state.commitmentEvidence); });
      if (!previousActorState.commitmentEvidence || !allCommitmentsVerified) {
        candidateFor(previousActorState, null, false, 'turn changed, but zero added chips and the outstanding wager cannot be verified until commitment fields are mapped', 0, {
          checkRejected: true,
          actorCommitmentVerified: Boolean(previousActorState.commitmentEvidence),
          allActiveCommitmentsVerified: allCommitmentsVerified
        });
      } else {
        var turnClassification = PokerActionInference.classifyActorTurnEnd({
          actorChanged: true,
          foldedChanged: false,
          becameInactive: false,
          commitmentsVerified: true,
          addedAmount: addedByActor,
          outstandingAmount: outstanding
        });
        if (turnClassification.action === 'check' || (!turnClassification.accepted && Math.abs(addedByActor) < 0.0001)) {
          candidateFor(previousActorState, turnClassification.action, turnClassification.accepted, turnClassification.reason, turnClassification.amount || 0);
        }
      }
    }

    var patchRecord = {
      recordId: transitionRecord.id,
      timestamp: transitionRecord.timestamp,
      eventName: transitionRecord.eventName,
      street: street,
      streetChanged: streetChanged,
      turnChange: { previousActor: previousActor, currentActor: currentActor, actorEvidence: actorResolution },
      highestBetChange: { previous: previousHighestBet, current: currentHighestBet },
      playersBefore: beforeStates,
      playersAfter: Array.from(afterStates.values()).map(function (state) { return cloneJson(state); }),
      commitmentChanges: contributionChanges.map(function (state) { return { playerId: state.playerId, previous: state.previousStreetCommitment, current: state.streetCommitment, field: state.commitmentEvidence && state.commitmentEvidence.path }; }),
      candidates: patchCandidates,
      settlementIgnored: settlementPatch
    };
    liveActionTracker.currentHandSequence.patches.push(patchRecord);
    liveActionTracker.players = afterStates;
    liveActionTracker.street = street;
    liveActionTracker.actorId = currentActor;
    liveActionTracker.highestStreetBet = currentHighestBet;
    return acceptedEvents;
  }

 function findPlayersMap(payload) {
    var found = null;
    function visit(value, depth) {
      if (found || !value || typeof value !== 'object' || depth > 7) return;
      if (!Array.isArray(value) && value.players && typeof value.players === 'object' && !Array.isArray(value.players)) {
        found = value.players;
        return;
      }
      Object.keys(value).forEach(function (key) { visit(value[key], depth + 1); });
    }
    visit(payload, 0);
    return found;
  }

 function rememberPlayerMapping(playerId, name, source) {
    var normalizedId = PokerPlayerProfileShadowStore.livePlayerIdentity(playerId);
    var normalizedName = String(name || '').trim();
    if (!normalizedId || !normalizedName || normalizedId === normalizedName) {
      if (!normalizedId) PokerPlayerProfileShadowStore.recordIdentityDiagnostic(playerProfileShadowState, playerId, { source: source || 'player-map-update' });
      setPipelineFailure('stage 5: insufficient player identity data', { playerId: playerId, name: name, source: source });
      return false;
    }
    if (socketPlayerNames.get(normalizedId) === normalizedName) {
      console.log('[HUD PIPELINE 5] player mapped', { playerId: normalizedId, playerName: normalizedName, source: source, restoredOrExisting: true });
      pipelineHealth.playerMappingsFound = socketPlayerNames.size;
      pipelineHealth.confirmedPlayerMappings = socketPlayerNames.size;
      updateHealthPanel();
      return false;
    }
    socketPlayerNames.set(normalizedId, normalizedName);
    pipelineHealth.playerMappingsFound = socketPlayerNames.size;
    pipelineHealth.confirmedPlayerMappings = socketPlayerNames.size;
    updateHealthPanel();
    console.log('[HUD PIPELINE 5] player mapped', { playerId: normalizedId, playerName: normalizedName, source: source, restoredOrExisting: false });
    console.log('[HUD] player ID mapped', { playerId: normalizedId, playerName: normalizedName, source: source });
    refreshShadowProfile(normalizedId, normalizedName, liveEvents, 'stable-player-mapping');
    persistPlayerMappings();
    return true;
  }

  function persistPlayerMappings() {
    if (!ownsRuntimeController()) return;
    var playerMapObject = {};
    socketPlayerNames.forEach(function (name, id) {
      var playerId = PokerPlayerProfileShadowStore.livePlayerIdentity(id);
      if (playerId) playerMapObject[playerId] = name;
    });
    var update = {};
    update[STORAGE_KEYS.playerMap] = playerMapObject;
    chrome.storage.local.set(update);
  }

  function persistHandSignatures() {
    if (!ownsRuntimeController()) return;
    var update = {};
    update[STORAGE_KEYS.handSignatures] = Array.from(socketHandSignatures);
    chrome.storage.local.set(update);
  }

  function captureVisiblePlayerMappings() {
    if (!document.documentElement) return;
    var selectors = [
      '[data-player-id]',
      '[data-player-uuid]',
      '[data-user-id]'
    ];
    Array.from(document.querySelectorAll(selectors.join(','))).forEach(function (element) {
      var playerId = element.getAttribute('data-player-id') || element.getAttribute('data-player-uuid') || element.getAttribute('data-user-id');
      if (!playerId) return;
      var nameElement = element.querySelector('[class*="player-name" i], [class*="nickname" i], [data-player-name]');
      var name = (nameElement && (nameElement.getAttribute('data-player-name') || nameElement.textContent)) || element.getAttribute('data-player-name') || element.getAttribute('aria-label') || element.getAttribute('title');
      if (name) rememberPlayerMapping(playerId, String(name).trim().replace(/\s+/g, ' '), 'visible PokerNow seat');
    });
  }

  function numericField(value, keys) {
    for (var index = 0; index < keys.length; index += 1) {
      if (typeof value[keys[index]] === 'number') return value[keys[index]];
    }
    return null;
  }

 function playerBet(player) {
    return numericField(player, ['bet', 'currentBet', 'current_bet', 'betAmount', 'bet_amount', 'committed', 'contribution', 'wager']);
  }

 function classifySocketEvent(eventName, decoded) {
    var normalizedLines = decoded.lines.map(function (line) { return PokerNowParser.cleanLine(line); });
    return {
      eventName: eventName,
      handStart: normalizedLines.some(function (line) { return /--\s*starting hand/i.test(line); }),
      playerStacks: normalizedLines.some(function (line) { return /^Player stacks:/i.test(line); }),
      street: normalizedLines.some(function (line) { return /^(?:Flop|Turn|River):/i.test(line); }),
      blinds: normalizedLines.some(function (line) { return /posts a (?:small|big) blind/i.test(line); }) || decoded.events.some(function (event) { return event.action === 'blind'; }),
      callsRaisesBetsFoldsChecks: normalizedLines.some(function (line) { return /\b(?:folds|checks|calls\s+[\d,]+|bets\s+[\d,]+|raises to\s+[\d,]+)/i.test(line); }) || decoded.events.some(function (event) { return event.action !== 'blind'; }),
      structuredActions: decoded.events.map(function (event) { return event.action; })
    };
  }

  function listPayloadKeyPaths(payload) {
    var paths = [];
    function visit(value, path, depth) {
      if (!value || typeof value !== 'object' || depth > 4 || paths.length >= 250) return;
      Object.keys(value).forEach(function (key) {
        var nextPath = path ? path + '.' + key : key;
        paths.push(nextPath);
        visit(value[key], nextPath, depth + 1);
      });
    }
    visit(payload, '', 0);
    return paths;
  }

  function collectLogStrings(value, lines, depth) {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      value.split(/\r?\n/).forEach(function (line) {
        if (/(?:--\s*(?:starting|ending) hand|Player stacks:|posts a (?:small|big) blind|\b(?:folds|checks|calls\s+[\d,]+|bets\s+[\d,]+|raises to\s+[\d,]+)|^(?:Flop|Turn|River):)/im.test(line)) lines.push(line);
      });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(function (item) { collectLogStrings(item, lines, depth + 1); });
      return;
    }
    if (typeof value === 'object') Object.keys(value).forEach(function (key) { collectLogStrings(value[key], lines, depth + 1); });
  }

  function collectStructuredEvents(value, events, context, depth, playerLookup) {
    if (!value || depth > 8 || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(function (item) { collectStructuredEvents(item, events, context, depth + 1, playerLookup); });
      return;
    }
    var nextContext = {
      handId: directHandIdentifier(value) || context.handId,
      street: normalizeStreet(value.street || value.round || value.bettingRound || value.betting_round || context.street)
    };
    var rawAction = value.action || value.actionType || value.action_type || value.lastAction || value.last_action || value.type;
    if (rawAction && typeof rawAction === 'object') rawAction = rawAction.type || rawAction.name;
    var action = normalizeAction(rawAction);
    var playerValue = value.playerName || value.player_name || value.username || value.nickname || value.player;
    var player = typeof playerValue === 'string' ? playerValue : (playerValue && (playerValue.name || playerValue.username || playerValue.nickname));
    var playerId = value.playerId || value.player_id || value.userId || value.user_id || (playerValue && (playerValue.id || playerValue._id));
    if (!player && playerId && playerLookup.has(String(playerId))) player = playerLookup.get(String(playerId));
    if (action && player && nextContext.handId && nextContext.street) {
      events.push({
        handId: String(nextContext.handId),
        player: String(player),
        action: action,
        street: nextContext.street,
        amount: Number(value.amount || value.betAmount || value.bet_amount || value.total || value.value || 0),
        timestamp: Date.now()
      });
    }
    Object.keys(value).forEach(function (key) { collectStructuredEvents(value[key], events, nextContext, depth + 1, playerLookup); });
  }

  function buildPlayerLookup(payload) {
    var players = new Map();
    function visit(value, depth, inheritedId, parentKey) {
      if (!value || typeof value !== 'object' || depth > 8) return;
      if (Array.isArray(value)) { value.forEach(function (item) { visit(item, depth + 1, null, parentKey); }); return; }
      var directId = value.id || value._id || value.playerId || value.player_id || value.userId || value.user_id;
      var name = value.name || value.playerName || value.player_name || value.nickname || value.username;
      var stablePlayerId = PokerPlayerProfileShadowStore.livePlayerIdentity(directId) || PokerPlayerProfileShadowStore.livePlayerIdentity(inheritedId);
      if (stablePlayerId && typeof name === 'string' && name.trim()) players.set(stablePlayerId, name);
      else if (!stablePlayerId && typeof name === 'string' && name.trim()) PokerPlayerProfileShadowStore.recordIdentityDiagnostic(playerProfileShadowState, directId, { source: 'socket-player-lookup' });
      Object.keys(value).forEach(function (key) {
        var exactPlayerMapEntry = /^(?:players|playerMap|player_map|playerData|player_data|users)$/i.test(parentKey || '') && /^[a-zA-Z0-9_-]+$/.test(key);
        visit(value[key], depth + 1, exactPlayerMapEntry ? key : null, key);
      });
    }
    visit(payload, 0, null, '');
    return players;
  }

  function findFirstScalarByKeys(payload, keys) {
    var found;
    function visit(value, depth) {
      if (found !== undefined || !value || typeof value !== 'object' || depth > 8) return;
      if (Array.isArray(value)) { value.forEach(function (item) { visit(item, depth + 1); }); return; }
      for (var index = 0; index < keys.length; index += 1) {
        if (value[keys[index]] !== undefined && (typeof value[keys[index]] === 'string' || typeof value[keys[index]] === 'number')) {
          found = value[keys[index]];
          return;
        }
      }
      Object.keys(value).forEach(function (key) { visit(value[key], depth + 1); });
    }
    visit(payload, 0);
    return found;
  }

  function findHandIdentifier(payload) {
    var direct = findFirstScalarByKeys(payload, ['handId', 'hand_id', 'handUuid', 'hand_uuid', 'currentHandId', 'current_hand_id', 'handNumber', 'hand_number']);
    if (direct !== undefined && direct !== null && direct !== '<D>') return direct;
    var found;
    function visit(value, depth) {
      if (found !== undefined || !value || typeof value !== 'object' || depth > 7) return;
      Object.keys(value).forEach(function (key) {
        if (found !== undefined) return;
        var normalizedKey = key.toLowerCase().replace(/_/g, '');
        if (normalizedKey === 'hand' || normalizedKey === 'currenthand') {
          var hand = value[key];
          if (typeof hand === 'string' || typeof hand === 'number') found = hand;
          else if (hand && typeof hand === 'object') found = hand.id || hand._id || hand.uuid;
        }
        visit(value[key], depth + 1);
      });
    }
    visit(payload, 0);
    return found;
  }

  function directHandIdentifier(value) {
    if (!value || typeof value !== 'object') return null;
    var direct = value.handId || value.hand_id || value.handUuid || value.hand_uuid || value.currentHandId || value.current_hand_id || value.handNumber || value.hand_number;
    if (direct !== undefined && direct !== null && direct !== '<D>') return direct;
    var hand = value.hand || value.currentHand || value.current_hand;
    if (typeof hand === 'string' || typeof hand === 'number') return hand;
    return hand && typeof hand === 'object' ? hand.id || hand._id || hand.uuid || null : null;
  }

  function inferStreetFromBoard(payload) {
    var boardLength;
    function visit(value, depth, parentKey) {
      if (boardLength !== undefined || value === null || value === undefined || depth > 7) return;
      if (Array.isArray(value)) {
        if (/(?:board|community(?:cards?)?|sharedcards?)/i.test(parentKey || '')) boardLength = value.length;
        else value.forEach(function (item) { visit(item, depth + 1, parentKey); });
        return;
      }
      if (typeof value === 'object') Object.keys(value).forEach(function (key) { visit(value[key], depth + 1, key); });
    }
    visit(payload, 0, '');
    if (boardLength >= 5) return 'river';
    if (boardLength === 4) return 'turn';
    if (boardLength >= 3) return 'flop';
    if (boardLength === 0) return 'preflop';
    return null;
  }

  function normalizeAction(action) {
    var normalized = String(action || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (normalized === 'fold' || normalized === 'folded') return 'fold';
    if (normalized === 'check' || normalized === 'checked') return 'check';
    if (normalized === 'call' || normalized === 'called') return 'call';
    if (normalized === 'bet' || normalized === 'betted') return 'bet';
    if (normalized === 'raise' || normalized === 'raised') return 'raise';
    if (normalized === 'smallblind' || normalized === 'bigblind' || normalized === 'blind') return 'blind';
    return null;
  }

  function normalizeStreet(street) {
    if (typeof street === 'number') return ['preflop', 'flop', 'turn', 'river'][street] || null;
    var normalized = String(street || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (normalized === 'preflop' || normalized === 'pref') return 'preflop';
    return ['flop', 'turn', 'river'].includes(normalized) ? normalized : null;
  }

  // PokerNow shows the newest entry at the top. Initial history is therefore
  // processed from bottom to top, while each newly inserted entry is parsed as
  // it arrives.
  function processLogText(text, newestFirst, source) {
    var lines = String(text || '').split(/\r?\n/).filter(function (line) { return line.trim(); });
    if (newestFirst) lines.reverse();
    backfillingFullLog = Boolean(newestFirst && (source || 'full-log') === 'full-log');
    traceHandSource('full-log-text-processing', { source: source || 'full-log', newestFirst: Boolean(newestFirst), historicalBackfill: backfillingFullLog, lineCount: lines.length, handLogOpen: handLogOpenState() });
    var results = lines.map(function (line) { return recordLine(line, source || 'full-log'); });
    backfillingFullLog = false;
    return results;
  }

  function handLogContainerIdentity(container) {
    if (!container) return null;
    if (!handLogContainerIds.has(container)) handLogContainerIds.set(container, 'hand-log-container-' + (++handLogContainerIdSequence));
    return handLogContainerIds.get(container);
  }

  function handLogNodeIdentity(node) {
    if (!node) return null;
    if (!handLogNodeIds.has(node)) handLogNodeIds.set(node, 'hand-log-node-' + (++handLogNodeIdSequence));
    return handLogNodeIds.get(node);
  }

  function explicitPokerNowHandId(text) {
    var match = String(text || '').match(/--\s*starting hand\s+#\d+\s+\(id:\s*([^\s)]+)\)/i);
    return match ? match[1] : null;
  }

  function traceHandLogDomNode(node, options) {
    options = options || {};
    var text = String(node && node.textContent || options.text || '');
    var parseResult = options.parseResult && options.parseResult.parsed || null;
    var trace = PokerHandLogDom.classifyMutation(handLogDomState, {
      timestamp: options.timestamp || Date.now(),
      observerInstanceId: activeHandLogObserverId,
      observerInstallationCount: pipelineHealth.fullLogParserInstallationCount,
      containerId: handLogContainerIdentity(observedLog || activeFullLogContent),
      nodeId: handLogNodeIdentity(node),
      textFingerprint: text ? stableHash(PokerNowParser.cleanLine(text) || text.trim()) : null,
      parsedPokerNowHandId: explicitPokerNowHandId(text) || parseResult && (parseResult.handId || parseResult.event && parseResult.event.handId) || null,
      firstRender: Boolean(options.firstRender),
      removed: Boolean(options.removed),
      characterData: Boolean(options.characterData),
      containerReplacement: Boolean(options.containerReplacement)
    });
    console.log('[HUD HAND LOG DOM TRACE]', trace);
    return trace;
  }

  function logLineNodesFromNode(node) {
    if (!node || (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE)) return [];
    var element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    var nodes = [];
    if (element && element.matches && element.matches('p.content')) nodes.push(element);
    if (element && element.closest) {
      var containingLine = element.closest('p.content');
      if (containingLine) nodes.push(containingLine);
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.querySelectorAll) nodes = nodes.concat(Array.from(node.querySelectorAll('p.content')));
    return Array.from(new Set(nodes));
  }

  function processAddedNode(node) {
    var lineNodes = logLineNodesFromNode(node);
    if (!lineNodes.length) {
      extractLogLinesFromNode(node).forEach(function (line) {
        var result = recordLine(line, 'full-log');
        traceHandLogDomNode(node, { parseResult: result, text: line });
      });
      return;
    }
    lineNodes.forEach(function (lineNode) {
      var result = recordLine(lineNode.textContent, 'full-log');
      traceHandLogDomNode(lineNode, { parseResult: result });
    });
  }

  function processRemovedNode(node) {
    var lineNodes = logLineNodesFromNode(node);
    if (!lineNodes.length) lineNodes = [node];
    lineNodes.forEach(function (lineNode) { traceHandLogDomNode(lineNode, { removed: true }); });
  }

  function processChangedTextNode(node) {
    var text = node.textContent;
    if (processedText.get(node) === text) return;
    processedText.set(node, text);
    var results = extractLogLinesFromNode(node).map(function (line) { return recordLine(line, 'full-log'); });
    traceHandLogDomNode(node.parentElement || node, { parseResult: results[0], characterData: true, text: text });
  }

  function extractLogLinesFromNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) return [];
    var lineElements = [];
    var element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (element && element.matches && element.matches('p.content')) lineElements.push(element);
    if (element && element.closest) {
      var containingLine = element.closest('p.content');
      if (containingLine) lineElements.push(containingLine);
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      lineElements = lineElements.concat(Array.from(node.querySelectorAll('p.content')));
    }
    lineElements = Array.from(new Set(lineElements));
    if (!lineElements.length && node.nodeType === Node.TEXT_NODE) return [node.textContent];
    // Entries display newest at the top. DOM order is reversed so a batch
    // works whether PokerNow inserted it at the beginning or the end.
    lineElements.sort(function (a, b) {
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    }).reverse();
    return lineElements.map(function (lineElement) { return lineElement.textContent; });
  }

  function mutationDescription(node) {
    if (node.nodeType === Node.TEXT_NODE) return { type: 'text', text: node.textContent };
    return { type: node.nodeType, tag: node.tagName, className: String(node.className || ''), text: (node.textContent || '').slice(0, 160) };
  }

  function observeLog(container) {
    if (observedLog === container) return;
    if (logObserver) logObserver.disconnect();
    observedLog = container;
    var containerId = handLogContainerIdentity(container);
    var observerInstallation = PokerHandLogDom.installObserver(handLogDomState, containerId, Date.now());
    activeHandLogObserverId = observerInstallation.observerId;
    PokerNowParser.reset();
    processedNodes = new WeakSet();
    processedText = new WeakMap();
    pipelineHealth.fullLogParserInstallationCount = observerInstallation.installationCount;
    updateHealthPanel();
    traceHandSource('full-log-parser-installed', {
      installationCount: pipelineHealth.fullLogParserInstallationCount,
      observerInstanceId: activeHandLogObserverId,
      containerIdentity: containerId,
      containerReplacement: observerInstallation.containerReplacement,
      previousObserverInstanceId: observerInstallation.previousObserverId || null,
      previousContainerIdentity: observerInstallation.previousContainerId || null,
      containerTag: container.tagName,
      containerClass: String(container.className || ''),
      existingLineCount: container.querySelectorAll('p.content').length
    });
    if (observerInstallation.containerReplacement) {
      traceHandLogDomNode(container, { containerReplacement: true });
    }
    var initialLineNodes = Array.from(container.querySelectorAll('p.content'));
    if (initialLineNodes.length) {
      backfillingFullLog = true;
      initialLineNodes.slice().reverse().forEach(function (lineNode) {
        var result = recordLine(lineNode.textContent, 'full-log');
        traceHandLogDomNode(lineNode, { firstRender: true, parseResult: result });
      });
      backfillingFullLog = false;
    } else {
      var initialResults = processLogText(container.innerText || container.textContent, true, 'full-log');
      traceHandLogDomNode(container, { firstRender: true, parseResult: initialResults && initialResults[0] });
    }
    refreshHud();
    logObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        console.log('[HUD] live mutation', {
          type: mutation.type,
          target: mutationDescription(mutation.target),
          addedNodes: Array.from(mutation.addedNodes).map(mutationDescription),
          removedNodes: Array.from(mutation.removedNodes).map(mutationDescription)
        });
        traceHandSource('hand-log-dom-mutation', {
          mutationType: mutation.type,
          addedNodeCount: mutation.addedNodes.length,
          removedNodeCount: mutation.removedNodes.length,
          addedContentLineCount: Array.from(mutation.addedNodes).reduce(function (count, node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return count;
            return count + (node.matches && node.matches('p.content') ? 1 : 0) + (node.querySelectorAll ? node.querySelectorAll('p.content').length : 0);
          }, 0),
          handLogOpen: handLogOpenState()
        });
        if (logContainerHidden) console.log('[HUD] hidden log container mutation', mutation.type);
        if (mutation.type === 'characterData') processChangedTextNode(mutation.target);
        mutation.addedNodes.forEach(processAddedNode);
        mutation.removedNodes.forEach(processRemovedNode);
      });
    });
    pipelineHealth.domHandLogObserverCount = handLogDomState.activeObserverId ? 1 : 0;
    updateHealthPanel();
    traceHandSource('dom-hand-log-observer-installed', {
      observerCount: pipelineHealth.domHandLogObserverCount,
      observerInstanceId: activeHandLogObserverId,
      installationCount: observerInstallation.installationCount,
      containerIdentity: containerId,
      containerTag: container.tagName,
      containerClass: String(container.className || '')
    });
    logObserver.observe(container, { childList: true, subtree: true, characterData: true });
    logContainerHidden = !isVisible(container);
    console.log('[HUD] observer attached', container);
    refreshHud();
  }

  function stopObservingLog() {
    if (logObserver) logObserver.disconnect();
    if (activeHandLogObserverId) PokerHandLogDom.disconnectObserver(handLogDomState, activeHandLogObserverId);
    activeHandLogObserverId = null;
    logObserver = null;
    observedLog = null;
    pipelineHealth.domHandLogObserverCount = 0;
    logContainerHidden = false;
    fullLogDisplaySourceAvailable = false;
    activePanel = null;
    activeFullLogTab = null;
    activeFullLogContent = null;
    refreshHud();
  }

 function isVisible(element) {
    if (!element || !element.isConnected || !element.getClientRects().length) return false;
    var style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findVisibleTextElement(label) {
    var controls = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], a, [class*="tab" i]'));
    return controls.find(function (element) {
      return isVisible(element) && element.textContent.trim().replace(/\s+/g, ' ') === label;
    }) || null;
  }

  function panelForFullLogTab(tab) {
    var markerPattern = /(?:--\s*(?:starting|ending) hand|posts a (?:small|big) blind|Player stacks:|\b(?:folds|checks|calls\s+\d+|bets\s+\d+|raises to\s+\d+)|^(?:Flop|Turn|River):)/im;
    var ancestors = [];
    var element = tab.parentElement;
    while (element && element !== document.body) {
      var directText = Array.from(element.childNodes).filter(function (node) {
        return node.nodeType === Node.TEXT_NODE;
      }).map(function (node) {
        return node.textContent.trim().replace(/\s+/g, ' ');
      }).filter(Boolean).join(' ').slice(0, 180);
      var contentLines = Array.from(element.querySelectorAll('p.content'));
      var realLineCount = contentLines.filter(function (line) {
        return markerPattern.test(line.textContent || '');
      }).length;
      if (!realLineCount) {
        realLineCount = String(element.innerText || '').split(/\r?\n/).filter(function (line) {
          return markerPattern.test(line);
        }).length;
      }
      ancestors.push({
        element: element,
        tag: element.tagName,
        className: String(element.className || '').slice(0, 180),
        directText: directText,
        pContentDescendants: contentLines.length,
        realHandLogLines: realLineCount
      });
      element = element.parentElement;
    }
    if (!diagnosedFullLogButtons.has(tab)) {
      diagnosedFullLogButtons.add(tab);
      console.log('[HUD] Full Log modal ancestor diagnostics', ancestors.map(function (item) {
        return {
          tag: item.tag,
          className: item.className,
          directText: item.directText,
          pContentDescendants: item.pContentDescendants,
          realHandLogLines: item.realHandLogLines
        };
      }));
    }
    var containingAncestor = ancestors.find(function (item) {
      return item.realHandLogLines >= 2 || item.pContentDescendants >= 2;
    });
    return containingAncestor
      ? containingAncestor.element
      : tab.closest('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="drawer" i], [class*="ledger" i]') || tab.parentElement;
  }

  function findFullLogContent(panel) {
    if (!panel) return null;
    var realLinePattern = /(?:--\s*(?:starting|ending) hand|posts a (?:small|big) blind|Player stacks:|\b(?:folds|checks|calls\s+\d+|bets\s+\d+|raises to\s+\d+)|^(?:Flop|Turn|River):)/im;
    var lines = Array.from(panel.querySelectorAll('p.content')).filter(function (line) {
      return realLinePattern.test(line.textContent || '');
    });
    if (lines.length < 2) return null;
    var content = lines[0].parentElement || lines[0];
    while (content && content !== panel && !lines.every(function (line) { return content.contains(line); })) {
      content = content.parentElement;
    }
    return content || panel;
  }

  function inspectClosedLogContainer() {
    if (!observedLog) return;
    if (!observedLog.isConnected) {
      console.log('[HUD] log container removed');
      traceHandSource('hand-log-container-removed', { observerCount: pipelineHealth.domHandLogObserverCount, parserInstallationCount: pipelineHealth.fullLogParserInstallationCount });
      stopObservingLog();
      return;
    }
    if (!isVisible(observedLog)) {
      var becameHidden = !logContainerHidden;
      if (becameHidden) console.log('[HUD] log container hidden');
      if (becameHidden) traceHandSource('hand-log-container-hidden', { observerCount: pipelineHealth.domHandLogObserverCount });
      logContainerHidden = true;
      fullLogDisplaySourceAvailable = false;
      activePanel = null;
      activeFullLogTab = null;
      activeFullLogContent = null;
      if (becameHidden) refreshHud();
    }
  }

  function logInitializationError(error, context) {
    var stack = error && (error.stack || error.message || error);
    console.error('[HUD] initialization error', stack);
    var stage = context && context.stage ? context.stage : 'post-guard initialization';
    abortUiBoot(stage, 'UI initialization/render exception', error, {
      guardResult: true,
      missingSymbol: '',
      missingModule: ''
    });
    console.error('[HUD UI BOOT CONTEXT]', {
      context: context || null,
      displayMode: displayMode,
      detailsRenderer: typeof render === 'function',
      overlayRenderer: Boolean(globalThis.PokerSeatOverlay && globalThis.PokerSeatOverlay.createController),
      displayModeModule: Boolean(globalThis.PokerSeatOverlay && globalThis.PokerSeatOverlay.visibilityForMode),
      detailsRoot: Boolean(document.getElementById(detailsRootId)),
      overlayRoot: Boolean(document.getElementById(overlayRootId)),
      toggleRoot: Boolean(document.getElementById(toggleRootId)),
      bootstrapBadge: Boolean(document.getElementById(bootstrapBadgeId))
    });
  }

  function installUiRootObserver() {
    if (uiRootObserver || !document.documentElement) return;
    var stableRootIds = [detailsRootId, overlayRootId, toggleRootId, settingsLauncherId, settingsPanelId];
    uiRootObserver = new MutationObserver(function (mutations) {
      var removedIds = new Set();
      mutations.forEach(function (mutation) {
        Array.from(mutation.removedNodes || []).forEach(function (node) {
          if (!node || node.nodeType !== 1) return;
          if (stableRootIds.includes(node.id)) removedIds.add(node.id);
          stableRootIds.forEach(function (id) { if (node.querySelector && node.querySelector('#' + id)) removedIds.add(id); });
        });
      });
      if (!removedIds.size || extensionCleanedUp) return;
      var genuinelyMissing = Array.from(removedIds).filter(function (id) {
        var current = document.getElementById(id);
        return !current || !current.isConnected;
      });
      if (!genuinelyMissing.length) return;
      console.error('[HUD UI ROOT] removed unexpectedly', {
        rootIds: genuinelyMissing,
        mutationTargets: mutations.map(function (mutation) { return mutation.target && (mutation.target.id || mutation.target.nodeName); }),
        displayMode: displayMode,
        locationHref: location.href,
        cleanupActive: extensionCleanedUp
      });
      if (genuinelyMissing.includes(overlayRootId) && seatOverlayController) seatOverlayController.clear('overlay root removed by page DOM mutation');
      clearTimeout(uiRootRecoveryTimer);
      uiRootRecoveryTimer = setTimeout(function () {
        if (extensionCleanedUp || !runtimeScope.isPokerNowGamePage(window.location)) return;
        refreshHud();
      }, 0);
    });
    uiRootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function startFullLogPolling() {
    if (!fullLogDiagnosticsEnabled()) return;
    if (fullLogPollInterval) return;
    fullLogPollAttempts = 0;
    fullLogPollInterval = setInterval(function () {
      fullLogPollAttempts += 1;
      scanLogLedgerPanel();
      if (fullLogPollAttempts >= 20 || !activeFullLogTab) {
        clearInterval(fullLogPollInterval);
        fullLogPollInterval = null;
      }
    }, 500);
  }

  function scanLogLedgerPanel() {
    if (!fullLogDiagnosticsEnabled()) return;
    try {
      var fullLogTab = findVisibleTextElement('Full Log');
      if (!fullLogTab) {
        if (!waitingForFullLogLogged) {
          console.log('[HUD] waiting for Full Log');
          waitingForFullLogLogged = true;
        }
        inspectClosedLogContainer();
        scheduleNativePanelOcclusion('log or ledger panel scan without Full Log tab');
        return;
      }
      waitingForFullLogLogged = false;
      var panel = panelForFullLogTab(fullLogTab);
      if (panel !== activePanel) {
        activePanel = panel;
        console.log('[HUD] Log/Ledger panel detected', panel);
        traceHandSource('log-ledger-panel-detected', { panelTag: panel.tagName, panelClass: String(panel.className || ''), handLogOpen: handLogOpenState() });
        console.log('[HUD] Full Log panel found', panel);
        scheduleNativePanelOcclusion('log or ledger panel discovered');
      }
      if (fullLogTab !== activeFullLogTab) {
        activeFullLogTab = fullLogTab;
        console.log('[HUD] Full Log detected', fullLogTab);
        traceHandSource('full-log-tab-detected', { tabText: String(fullLogTab.textContent || '').trim(), handLogOpen: handLogOpenState() });
        startFullLogPolling();
      }
      var fullLogContent = findFullLogContent(panel);
      if (!fullLogContent) return;
      if (fullLogContent !== activeFullLogContent) {
        activeFullLogContent = fullLogContent;
        console.log('[HUD] Full Log content found', fullLogContent);
        traceHandSource('full-log-content-found', { contentTag: fullLogContent.tagName, contentClass: String(fullLogContent.className || ''), existingLineCount: fullLogContent.querySelectorAll('p.content').length });
      }
      if (observedLog && observedLog.isConnected && observedLog === fullLogContent) {
        if (logContainerHidden && isVisible(observedLog)) {
          logContainerHidden = false;
          refreshHud();
        }
        return;
      }
      if (observedLog && !observedLog.isConnected) {
        console.log('[HUD] log container replaced');
        traceHandSource('hand-log-container-replaced', { observerCount: pipelineHealth.domHandLogObserverCount });
      }
      var container = fullLogContent;
      console.log('[HUD] selected log container', {
        tag: container.tagName,
        className: String(container.className || '').slice(0, 180),
        pContentDescendants: container.querySelectorAll('p.content').length
      });
      if (container) observeLog(container);
    } catch (error) {
      logInitializationError(error);
    }
  }

  function maybeLogUiBoot8() {
    if (uiObserversInstalledLogged || !firstRenderCompleted || !uiRootObserver || !seatLayoutObserver || (fullLogDiagnosticsEnabled() && !panelDiscoveryObserver)) return;
    uiObserversInstalledLogged = true;
    console.log('[HUD UI BOOT 8] observers/listeners installed', {
      storageListener: true,
      rootObserver: true,
      seatObserver: true,
      fullLogDiscoveryObserver: Boolean(panelDiscoveryObserver),
      websocketRelayListener: true,
      locationHref: location.href,
      roots: {
        details: Boolean(document.getElementById(detailsRootId)),
        overlay: Boolean(document.getElementById(overlayRootId)),
        toggle: Boolean(document.getElementById(toggleRootId))
      }
    });
  }

  function fullLogDiagnosticsEnabled() {
    return PokerHudDiagnostics.enabled('deep');
  }

  function startFullLogDiagnostics() {
    if (!fullLogDiagnosticsEnabled() || panelDiscoveryObserver || !document.body) return;
    panelDiscoveryObserver = new MutationObserver(function () {
      pipelineHealth.bodyMutationObserverCallbacks += 1;
      pipelineHealth.fullLogDiscoveryCallbacks += 1;
      scanLogLedgerPanel();
      scheduleNativePanelOcclusion('PokerNow panel DOM mutation');
    });
    panelDiscoveryObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
    });
    console.log('[HUD] waiting for Full Log');
    waitingForFullLogLogged = true;
    scanLogLedgerPanel();
    maybeLogUiBoot8();
  }

  function stopFullLogDiagnostics() {
    if (panelDiscoveryObserver) panelDiscoveryObserver.disconnect();
    panelDiscoveryObserver = null;
    clearInterval(fullLogPollInterval);
    fullLogPollInterval = null;
    if (observedLog || logObserver) stopObservingLog();
  }

  function startPokerNowObserver() {
    if (!isPokerNowPage) return;
    var attachBodyWatcher = function () {
      if (!document.body) {
        setTimeout(attachBodyWatcher, 50);
        return;
      }
      installUiRootObserver();
      chrome.storage.local.get(Object.values(STORAGE_KEYS), function (saved) {
        try { ensureUiShells(saved, 'document.body became available'); } catch (error) { logInitializationError(error, { stage: 'body-ready UI fallback' }); }
      });
      startSeatOverlayObservers();
      startFullLogDiagnostics();
      maybeLogUiBoot8();
    };
    attachBodyWatcher();
  }

  function handleRuntimeLocationChange() {
    if (!runtimeScope.isPokerNowGamePage(window.location)) {
      cleanupExtension('navigated away from a supported PokerNow game page');
      return;
    }
    var nextGameId = extractPokerNowGameId();
    if (String(nextGameId) !== String(pokerNowGameId)) {
      var previousGameId = pokerNowGameId;
      cleanupExtension('same-document PokerNow game changed from ' + previousGameId + ' to ' + nextGameId + '; failing closed');
      showEarlyBootBadge('PokerNow table changed from ' + previousGameId + ' to ' + nextGameId + '. Reload this page to start the HUD safely for the new table.', true);
    }
  }

  function handlePageHide() {
    cleanupExtension('page hidden or unloaded');
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (!ownsRuntimeController()) return;
    if (!message || message.type !== 'PNHUD_RESET_OVERLAY_POSITIONS') return false;
    resetOverlayPositions('popup reset button');
    if (sendResponse) sendResponse({ ok: true, gameId: pokerNowGameId });
    return false;
  }

  function cleanupExtension(reason) {
    if (extensionCleanedUp) return;
    // A superseded controller cannot complete its Restore confirmation, but
    // must not strand hands finalized while that confirmation was pending.
    releaseCareerRestoreAppendGate(false, true);
    if (activeOverlayDrag) finishOverlayDrag(null, false);
    if (activeLeaderboardHudDrag) finishLeaderboardHudDrag(null, true);
    if (activePotOddsDrag) finishPotOddsDrag(null, true);
    PokerPotOdds.resetLiveStateContinuity(potOddsLiveState, 'extension/table lifecycle cleanup', reason || 'page lifecycle', Date.now());
    if (boardCompanionLayoutUnsubscribe) boardCompanionLayoutUnsubscribe();
    PokerBoardCompanionLayout.invalidate(boardCompanionLayoutState, 'extension/table lifecycle cleanup', true);
    potOddsTableUiState.failClosed = true;
    potOddsTableUiState.heroSeated = false;
    extensionCleanedUp = true;
    document.removeEventListener('pnhud-controller-claimed', handleControllerClaimed);
    if (globalThis.__PNHUD_ACTIVE_CONTENT_INSTANCES__) delete globalThis.__PNHUD_ACTIVE_CONTENT_INSTANCES__[contentScriptInstanceId];
    if (logObserver) logObserver.disconnect();
    if (globalThis.__PNHUD_PROFILE_API_INSTANCE_ID__ === contentScriptInstanceId) {
      uninstallPlayerProfileDebugApi(playerProfileDebugApi);
      delete globalThis.__PNHUD_PROFILE_API_INSTANCE_ID__;
      delete globalThis.__PNHUD_PROFILE_API_WORLD__;
    }
    if (globalThis.__PNHUD_CAREER_API_INSTANCE_ID__ === contentScriptInstanceId) {
      uninstallCareerDebugApi(careerDebugApi);
      uninstallPotOddsDebugApi(potOddsDebugApi);
      uninstallBoardCompanionDebugApi(boardCompanionDebugApi);
      delete globalThis.__PNHUD_CAREER_API_INSTANCE_ID__;
    }
    if (panelDiscoveryObserver) panelDiscoveryObserver.disconnect();
    if (seatLayoutObserver) seatLayoutObserver.disconnect();
    observedSeatElements.forEach(function (element) { unobserveSeatElement(element); });
    if (seatResizeObserver) seatResizeObserver.disconnect();
    observedSeatElements.clear();
    if (uiRootObserver) uiRootObserver.disconnect();
    if (pauseDiagnosticDomObserver) pauseDiagnosticDomObserver.disconnect();
    var pauseMarkerIndicator = document.getElementById(pauseMarkerIndicatorId);
    if (pauseMarkerIndicator) pauseMarkerIndicator.remove();
    pauseDiagnosticSnapshotTimers.forEach(clearTimeout);
    pauseDiagnosticSnapshotTimers = [];
    clearInterval(fullLogPollInterval);
    clearTimeout(seatReconcileTimer);
    clearTimeout(seatDiscoveryTimer);
    seatDiscoveryPendingSince = null;
    clearTimeout(uiRootRecoveryTimer);
    if (windowLayoutFrame !== null) cancelAnimationFrame(windowLayoutFrame);
    windowLayoutFrame = null;
    windowLayoutPriorViewport = null;
    if (nativePanelOcclusionFrame !== null) cancelAnimationFrame(nativePanelOcclusionFrame);
    nativePanelOcclusionFrame = null;
    cancelHeroPotOddsRender('extension cleanup');
    cancelHeroPotOddsVisibilityGuarantee('extension cleanup');
    seatInspectionTimers.forEach(clearTimeout);
    seatInspectionTimers = [];
    if (windowLayoutListener) window.removeEventListener('resize', windowLayoutListener);
    if (windowLayoutListener && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', windowLayoutListener);
      window.visualViewport.removeEventListener('scroll', windowLayoutListener);
    }
    window.removeEventListener('message', handlePageBridgeMessage);
    window.removeEventListener('popstate', handleRuntimeLocationChange);
    window.removeEventListener('hashchange', handleRuntimeLocationChange);
    window.removeEventListener('pagehide', handlePageHide);
    document.removeEventListener('pokernow-hud-location-change', handleRuntimeLocationChange);
    if (settingsKeydownListener) document.removeEventListener('keydown', settingsKeydownListener, true);
    document.removeEventListener('keydown', capturePauseDiagnosticKeyEvent, true);
    document.removeEventListener('keyup', capturePauseDiagnosticKeyEvent, true);
    document.removeEventListener('click', handleDiagnosticAndHostControlClick, true);
    if (statTooltipListenersInstalled) {
      document.removeEventListener('pointerover', handleStatTooltipPointerOver, true);
      document.removeEventListener('pointerout', handleStatTooltipPointerOut, true);
      document.removeEventListener('focusin', handleStatTooltipFocusIn, true);
      document.removeEventListener('focusout', handleStatTooltipFocusOut, true);
      statTooltipListenersInstalled = false;
    }
    if (statTooltipElement) statTooltipElement.remove();
    if (leaderboardHudDragBehavior && leaderboardHudDragBehavior.element) {
      leaderboardHudDragBehavior.element.removeEventListener('pointerdown', leaderboardHudDragBehavior.pointerDown);
      leaderboardHudDragBehavior.element.removeEventListener('mousedown', leaderboardHudDragBehavior.mouseDown);
      leaderboardHudDragBehavior = null;
      leaderboardHudPositionDiagnostics.dragListenerInstalled = false;
    }
    if (potOddsDragBehavior && potOddsDragBehavior.element) {
      potOddsDragBehavior.element.removeEventListener('pointerdown', potOddsDragBehavior.pointerDown);
      potOddsDragBehavior.element.removeEventListener('mousedown', potOddsDragBehavior.mouseDown);
      potOddsDragBehavior = null;
    }
    chrome.storage.onChanged.removeListener(handleStorageChanged);
    if (chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    if (seatOverlayController) seatOverlayController.clear(reason);
    pendingBinaryQueue.clear();
    PokerSessionStatsCache.clear(sessionStatsCache, 'extension/table lifecycle cleanup');
    trackedPlayersState.open = false;
    trackedPlayersState.loading = false;
    trackedPlayersState.requestToken += 1;
    processedFrameFingerprints.clear();
    walkTraceEmittedHandIds.clear();
    seenMappingCandidateKeys.clear();
    overlayPlacementFailureKeys.clear();
    confirmedSeatMappings.clear();
    clearLeaderboardCareerStats();
    seatHudCareerRequestToken += 1;
    seatHudCareerStatsByPlayer.clear();
    seatHudCareerPendingSignature = '';
    seatHudCareerLoadedSignature = '';
    seatHudCareerQueryDiagnostics.loading = false;
    seatHudPositionDiagnostics.clear();
    seatHudPositionHistory = [];
    clearExpandedPokerNowPanelLayerMarker(null);
    seatHudBlockingPanelState = { blocked: false, reasons: [], chatVisible: false, extensionSettingsOpen: false, extensionLogOpen: false, pokerNowGameSettingsOpen: false, expandedPokerNowPanelDetected: false, expandedPanelType: null, expandedPanelRect: null, expandedPanelAboveSeatHud: false };
    seatHudLogPanelState = { open: false, panel: null, control: null, mode: null, panelType: null, revision: 0, lastReason: null };
    domSeatElements.clear();
    domSeatAnchorElements.clear();
    previousDomSeats.clear();
    seenDomSeatElementIds.clear();
    identityDiagnostics.domSeats = [];
    if (seatOverlayLayer) {
      console.log('[HUD UI ROOT] removed', { rootId: overlayRootId, reason: reason, intentionalCleanup: true });
      seatOverlayLayer.remove();
    }
    if (potOddsLayer) {
      console.log('[HUD UI ROOT] removed', { rootId: potOddsRootId, reason: reason, intentionalCleanup: true });
      potOddsLayer.remove();
    }
    nativePanelClipSvg = null;
    var detailsRoot = document.getElementById(detailsRootId);
    if (detailsRoot) {
      console.log('[HUD UI ROOT] removed', { rootId: detailsRootId, reason: reason, intentionalCleanup: true });
      detailsRoot.remove();
    }
    var leaderboard = document.getElementById(rootId);
    if (leaderboard) leaderboard.remove();
    var toggle = document.getElementById(toggleRootId);
    if (toggle) {
      console.log('[HUD UI ROOT] removed', { rootId: toggleRootId, reason: reason, intentionalCleanup: true });
      toggle.remove();
    }
    var launcher = document.getElementById(settingsLauncherId);
    if (launcher) launcher.remove();
    var settings = document.getElementById(settingsPanelId);
    if (settings) settings.remove();
    var trackedPlayers = document.getElementById(trackedPlayersPanelId);
    if (trackedPlayers) trackedPlayers.remove();
    trackedPlayersElement = null;
    if (playerDashboardGeometryController) playerDashboardGeometryController.dispose();
    playerDashboardGeometryController = null;
    var dashboard = document.getElementById(playerDashboardId);
    if (dashboard) dashboard.remove();
    playerDashboardElement = null;
    var bootstrapBadge = document.getElementById(bootstrapBadgeId);
    if (bootstrapBadge) bootstrapBadge.remove();
    console.log('[HUD] runtime cleaned up', { reason: reason, location: location.href });
  }

  function releaseStartupFramesAfterStorage() {
    if (!ownsRuntimeController()) return;
    var queuedFrames = PokerFirstHandLifecycle.markReady(firstHandLifecycle, {
      finalizedHandIds: handAccounting ? Array.from(handAccounting.finalizedHandIds) : [],
      activeHand: handAccounting ? cloneJson(PokerHandFinalization.activeHand(handAccounting)) : null,
      restoredStatsEventCount: restoredEventCount,
      previousSnapshotPresent: Boolean(previousGcSnapshot),
      previousHandId: previousGcSnapshot ? findHandIdentifier(previousGcSnapshot) : null,
      mappingCount: socketPlayerNames.size
    }, Date.now());
    console.log('[HUD FIRST HAND TRACE]', {
      startupType: firstHandLifecycle.currentTrace && firstHandLifecycle.currentTrace.startupType,
      category: 'initialization',
      details: { event: 'replaying startup frames through production handler', queuedFrameCount: queuedFrames.length }
    });
    pipelineHealth.initializationReplayCount += 1;
    pipelineHealth.replayedFrameCount += queuedFrames.length;
    updateHealthPanel();
    traceHandSource('initialization-replay-started', { replayCount: pipelineHealth.initializationReplayCount, queuedFrameCount: queuedFrames.length, frameIds: queuedFrames.map(function (frame) { return frame.frameId; }) });
    queuedFrames.forEach(function (frame) {
      initializationReplayActive = true;
      try {
        traceHandSource('initialization-frame-replayed', { frameId: frame.frameId, direction: frame.direction });
        handlePageBridgeMessage({ source: window, origin: location.origin, data: frame });
      } finally {
        initializationReplayActive = false;
      }
    });
  }

  chrome.storage.onChanged.addListener(handleStorageChanged);
  if (chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  try {
    ensureDemoData(function (saved) {
      try {
        releaseStartupFramesAfterStorage();
        startPokerNowObserver();
        refreshHud();
      } catch (error) {
        logInitializationError(error);
      }
    });
  } catch (error) {
    logInitializationError(error);
  }
  function handleStorageChanged(changes, area) {
    if (!ownsRuntimeController()) return;
    if (area !== 'local') return;
    if (careerTrackingReady && careerStoreState) {
      Object.keys(changes).filter(function (key) { return key.indexOf(PokerCareerContributionStore.RECORD_PREFIX) === 0 && changes[key].newValue; }).forEach(function (key) {
        var externalResult = PokerCareerContributionStore.append(careerStoreState, changes[key].newValue);
        if (externalResult.accepted) {
          careerDiagnostics.externalAccepted += 1;
          invalidateLeaderboardCareerStats(changes[key].newValue.players.map(function (entry) { return entry.playerId; }), 'external Career append');
        }
        else if (externalResult.conflict) {
          careerDiagnostics.conflicts += 1;
          console.error('[HUD CAREER INVARIANT] conflicting immutable hand record observed', { key: key, reason: externalResult.reason });
        }
      });
    }
    var overlayPreferenceChanged = false;
    var leaderboardPreferenceChanged = false;
    var hudUiPreferenceChanged = false;
    var settingsPresentationChanged = false;
    var acceptedLiveStorageChange = false;
    if (changes[STORAGE_KEYS.hudUiPreferences]) {
      var previousDisplayMode = displayMode;
      var previousHudUiPreferences = hudUiPreferences;
      var incomingLegacyMode = changes[STORAGE_KEYS.displayMode] ? changes[STORAGE_KEYS.displayMode].newValue : displayMode;
      var incomingUiPreference = PokerHudSettings.normalizeVisibility(changes[STORAGE_KEYS.hudUiPreferences].newValue, incomingLegacyMode);
      if (!PokerHudSettings.equal(hudUiPreferences, incomingUiPreference.value)) {
        applyHudUiPreference(incomingUiPreference.value, 'storage-change');
        hudUiPreferenceChanged = [
          'seatOverlaysEnabled', 'leaderboardEnabled', 'opportunityStatsLayout', 'seatHudStatSource', 'leaderboardStatSource', 'showPlayerProfiles', 'developerToolsVisible'
        ].some(function (field) { return previousHudUiPreferences[field] !== incomingUiPreference.value[field]; });
        if (previousHudUiPreferences.seatHudStatSource !== incomingUiPreference.value.seatHudStatSource) {
          seatHudCareerRequestToken += 1;
          seatHudCareerPendingSignature = '';
          seatHudCareerLoadedSignature = '';
          seatHudCareerQueryDiagnostics.loading = false;
          if (incomingUiPreference.value.seatHudStatSource === 'career') {
            requestSeatHudCareerBatch(Array.from(confirmedSeatMappings.keys()), 'stored Seat HUD source changed to Career', true);
          }
        }
      }
      displayMode = incomingUiPreference.displayMode;
      var correctedVisibilityState = {};
      if (!PokerHudSettings.equal(changes[STORAGE_KEYS.hudUiPreferences].newValue, incomingUiPreference.value)) {
        correctedVisibilityState[STORAGE_KEYS.hudUiPreferences] = incomingUiPreference.value;
      }
      if (incomingLegacyMode !== displayMode) {
        correctedVisibilityState[STORAGE_KEYS.displayMode] = displayMode;
      }
      if (Object.keys(correctedVisibilityState).length) {
        chrome.storage.local.set(correctedVisibilityState);
      }
      settingsPresentationChanged = true;
      logDisplayModeState('[HUD DISPLAY MODE] canonical visibility received', previousDisplayMode, displayMode, incomingLegacyMode);
    } else if (changes[STORAGE_KEYS.displayMode]) {
      var previousLegacyDisplayMode = displayMode;
      var legacyVisibility = PokerHudSettings.visibilityForMode(changes[STORAGE_KEYS.displayMode].newValue);
      var migratedUiPreference = PokerHudSettings.merge(hudUiPreferences, legacyVisibility);
      applyHudUiPreference(migratedUiPreference, 'legacy-display-mode-command');
      displayMode = PokerHudSettings.modeForVisibility(migratedUiPreference.seatOverlaysEnabled, migratedUiPreference.leaderboardEnabled);
      var canonicalVisibilityUpdate = {};
      canonicalVisibilityUpdate[STORAGE_KEYS.hudUiPreferences] = migratedUiPreference;
      chrome.storage.local.set(canonicalVisibilityUpdate);
      hudUiPreferenceChanged = true;
      settingsPresentationChanged = true;
      logDisplayModeState('[HUD DISPLAY MODE] legacy command normalized', previousLegacyDisplayMode, displayMode, changes[STORAGE_KEYS.displayMode].newValue);
    }
    if (changes[STORAGE_KEYS.diagnosticsLevel]) {
      PokerHudDiagnostics.setLevel(changes[STORAGE_KEYS.diagnosticsLevel].newValue);
      window.postMessage({ source: 'pokernow-stats-hud-content', type: 'diagnostics-level', level: PokerHudDiagnostics.getLevel() }, location.origin);
      if (fullLogDiagnosticsEnabled()) startFullLogDiagnostics();
      else stopFullLogDiagnostics();
    }
    if (changes[STORAGE_KEYS.playerNotes]) {
      playerNotesState = PokerPlayerNotesStore.normalize(changes[STORAGE_KEYS.playerNotes].newValue);
      if (playerDashboardState.open && playerDashboardState.playerId && playerDashboardState.noteDraft === playerDashboardState.note) {
        playerDashboardState.note = PokerPlayerNotesStore.get(playerNotesState, playerDashboardState.playerId);
        playerDashboardState.noteDraft = playerDashboardState.note;
        renderPlayerDashboard();
      }
    }
    if (changes[STORAGE_KEYS.pauseLifecycleCaptureEnabled]) {
      pauseLifecycleCaptureEnabled = Boolean(changes[STORAGE_KEYS.pauseLifecycleCaptureEnabled].newValue);
      setPauseDiagnosticCaptureEnabled(pauseLifecycleCaptureEnabled, Date.now());
      settingsPresentationChanged = true;
      console.log('[HUD RAW LIFECYCLE CAPTURE] mode changed', {
        enabled: pauseLifecycleCaptureEnabled,
        buildId: PNHUD_BUILD_ID,
        contentScriptInstanceId: contentScriptInstanceId
      });
    }
    if (changes[STORAGE_KEYS.showOverlayBoxes]) { showOverlayBoxes = Boolean(changes[STORAGE_KEYS.showOverlayBoxes].newValue); settingsPresentationChanged = true; }
    if (changes[STORAGE_KEYS.debugSeatIdentity]) { debugSeatIdentity = Boolean(changes[STORAGE_KEYS.debugSeatIdentity].newValue); settingsPresentationChanged = true; }
    if (changes[STORAGE_KEYS.showWithheldPlaceholders]) { showWithheldPlaceholders = Boolean(changes[STORAGE_KEYS.showWithheldPlaceholders].newValue); settingsPresentationChanged = true; }
    if (changes[STORAGE_KEYS.overlayDraggingUnlocked]) {
      overlayDraggingUnlocked = Boolean(changes[STORAGE_KEYS.overlayDraggingUnlocked].newValue);
      settingsPresentationChanged = true;
      if (!overlayDraggingUnlocked && activeOverlayDrag) finishOverlayDrag(null, false);
      if (seatOverlayLayer) seatOverlayLayer.querySelectorAll('.pnhud-seat-overlay').forEach(applyOverlayDragState);
    }
    if (changes[STORAGE_KEYS.manualOverlayPositions]) {
      manualOverlayPositions = Object.assign({}, changes[STORAGE_KEYS.manualOverlayPositions].newValue || {});
      scheduleSeatOverlayReconcile('stored manual overlay positions changed');
    }
    if (changes[STORAGE_KEYS.overlayStatPreferences]) {
      var incomingPreference = PokerOverlayStats.normalizePreference(changes[STORAGE_KEYS.overlayStatPreferences].newValue);
      overlayPreferenceChanged = !sameStringArray(displayedStatIds, incomingPreference.normalizedDisplayedStatIds);
      if (overlayPreferenceChanged) applyOverlayStatPreference(changes[STORAGE_KEYS.overlayStatPreferences].newValue, 'storage-change');
      if (overlayPreferenceChanged) settingsPresentationChanged = true;
    }
    if (changes[STORAGE_KEYS.leaderboardStatPreferences]) {
      var incomingLeaderboardPreference = PokerLeaderboardStats.normalize(changes[STORAGE_KEYS.leaderboardStatPreferences].newValue);
      leaderboardPreferenceChanged = !sameLeaderboardPreference(leaderboardStatPreferences, incomingLeaderboardPreference.preference);
      if (leaderboardPreferenceChanged) applyLeaderboardStatPreference(changes[STORAGE_KEYS.leaderboardStatPreferences].newValue, 'storage-change');
      if (leaderboardPreferenceChanged) settingsPresentationChanged = true;
    }
    if (changes[STORAGE_KEYS.leaderboardHudPosition]) {
      var incomingHudPosition = PokerLeaderboardHudPosition.normalize(changes[STORAGE_KEYS.leaderboardHudPosition].newValue).value;
      if (!PokerLeaderboardHudPosition.equal(leaderboardHudPosition, incomingHudPosition)) {
        if (incomingHudPosition.locked && activeLeaderboardHudDrag) finishLeaderboardHudDrag(null, false);
        leaderboardHudPosition = incomingHudPosition;
        leaderboardHudPositionDiagnostics.storedPosition = cloneJson(changes[STORAGE_KEYS.leaderboardHudPosition].newValue || null);
        leaderboardHudPositionDiagnostics.lastPositionChangeSource = 'storage-change';
        applyLeaderboardHudPosition('storage-change', false);
        settingsPresentationChanged = true;
      }
    }
    if (changes[STORAGE_KEYS.live]) {
      var incomingLiveEvents = changes[STORAGE_KEYS.live].newValue || [];
      var incomingRevision = changes[STORAGE_KEYS.liveRevision] ? Number(changes[STORAGE_KEYS.liveRevision].newValue) : null;
      var latestRevision = authoritativePersistenceQueue.inspect().latestRevision;
      var staleRevision = Number.isFinite(incomingRevision) && incomingRevision < latestRevision;
      var ownPersistenceEcho = Number.isFinite(incomingRevision) && incomingRevision === latestRevision;
      var externallyAdvanced = !Number.isFinite(incomingRevision) || incomingRevision > latestRevision;
      var regressions = sessionResetInProgress || ownPersistenceEcho ? [] : counterRegressionsBetweenEventSets(liveEvents, incomingLiveEvents);
      if (staleRevision || regressions.length) {
        if (regressions.length) {
          recordCounterRegression({
            source: 'chrome.storage.onChanged',
            reason: 'incoming snapshot would decrease cumulative counters',
            incomingRevision: Number.isFinite(incomingRevision) ? incomingRevision : null,
            latestRevision: latestRevision,
            staleRevision: staleRevision,
            regressions: regressions
          });
        }
        if (regressions.length && handAccounting) persistHandAccounting();
      } else {
        if (Number.isFinite(incomingRevision)) authoritativePersistenceQueue.observeRevision(incomingRevision);
        liveEvents = incomingLiveEvents;
        if (handAccounting) handAccounting.finalizedEvents = liveEvents;
        updateHandAccountingHealth();
        if (externallyAdvanced) {
          advanceFinalizedSessionRevision('accepted external finalized-session storage change');
          PokerSessionRuntime.observePersistedRevision(sessionPersistencePlanner, finalizedSessionRevision);
          refreshShadowProfiles('authoritative-live-events-storage-change', liveEvents);
          if (playerDashboardState.open) { refreshPlayerDashboardSession(); if (playerDashboardState.mode === 'session') renderPlayerDashboard(); }
          acceptedLiveStorageChange = true;
        }
      }
    }
    if (settingsPresentationChanged) renderSettingsPanel();
    if (changes[STORAGE_KEYS.mode] || changes[STORAGE_KEYS.session] || changes[STORAGE_KEYS.allTime] || acceptedLiveStorageChange || changes[STORAGE_KEYS.displayMode] || changes[STORAGE_KEYS.showOverlayBoxes] || changes[STORAGE_KEYS.debugSeatIdentity] || changes[STORAGE_KEYS.showWithheldPlaceholders] || changes[STORAGE_KEYS.overlayDraggingUnlocked] || overlayPreferenceChanged || leaderboardPreferenceChanged || hudUiPreferenceChanged) refreshHud();
  }
})();
