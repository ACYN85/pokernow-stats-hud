/* Bounded, non-persistent shadow store for production player-profile inspection. */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 4;
  var DEFAULT_MAX_PLAYERS = 200;
  var DEFAULT_MAX_HISTORY = 10;
  var DEFAULT_CONFIDENCE_DELTA = 0.05;
  var LIVE_VALIDATION_SCHEMA_VERSION = 4;
  var DEFAULT_MAX_VALIDATION_TRANSITIONS = 100;
  var DEFAULT_MAX_VALIDATION_SAMPLES = 250;
  var DEFAULT_MAX_IDENTITY_DIAGNOSTICS = 50;
  var PRIMARY_SCORE_MARGIN_GATE = 0.08;
  var PROFILE_HAND_BANDS = Object.freeze([20, 40, 80, 150, 250]);
  var FEATURE_NAMES = Object.freeze([
    'vpipRate', 'pfrRate', 'vpipPfrGap', 'pfrVpipRatio', 'aggressionFrequency', 'aggressionFactor',
    'threeBetRate', 'foldToThreeBetRate', 'flopCBetRate', 'foldToFlopCBetRate', 'wtsdRate', 'wsdRate'
  ]);
  var REQUIRED_INPUT_FIELDS = Object.freeze([
    'handsPlayed', 'vpipHands', 'vpipOpportunities', 'pfrHands', 'pfrOpportunities',
    'afBets', 'afRaises', 'afCalls', 'threeBetMade', 'threeBetOpportunities',
    'foldToThreeBet', 'foldToThreeBetOpportunities', 'flopCBetMade', 'flopCBetOpportunities',
    'foldToFlopCBet', 'foldToFlopCBetOpportunities', 'wentToShowdown', 'sawFlopForWTSD',
    'wonMoneyAtShowdown', 'showdownsForWSD'
  ]);
  var INPUT_FIELDS = Object.freeze(REQUIRED_INPUT_FIELDS.concat([
    'preflopTableSizeSum', 'preflopTableSizeOpportunities', 'effectiveTableSize'
  ]));

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function boundedString(value, maximum) {
    if (value === undefined || value === null) return null;
    return String(value).slice(0, maximum || 200);
  }

  function boundedInteger(value, fallback, minimum, maximum) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
  }

  function invalidLivePlayerIdentityReason(value) {
    if (value === null) return 'null_player_identity';
    if (value === undefined) return 'undefined_player_identity';
    var playerId;
    try { playerId = String(value).trim(); } catch (_error) { return 'unstringifiable_player_identity'; }
    if (!playerId) return 'empty_player_identity';
    var normalized = playerId.toLowerCase();
    if (normalized === 'null') return 'literal_null_player_identity';
    if (normalized === 'undefined') return 'literal_undefined_player_identity';
    if (normalized === 'gameplayer') return 'placeholder_gameplayer_identity';
    return null;
  }

  function livePlayerIdentity(value) {
    if (invalidLivePlayerIdentityReason(value)) return null;
    try { return String(value).trim(); } catch (_error) { return null; }
  }

  function observedIdentity(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    try { return String(value).trim().slice(0, 64); } catch (_error) { return 'unstringifiable'; }
  }

  function recordIdentityDiagnostic(state, value, options) {
    if (!state || !Array.isArray(state.invalidIdentityObservations)) return null;
    options = options || {};
    var diagnostic = {
      reason: invalidLivePlayerIdentityReason(value) || boundedString(options.reason, 120) || 'invalid_player_identity',
      source: boundedString(options.source || options.reason || 'shadow-store-update', 80),
      observedIdentity: observedIdentity(value)
    };
    state.invalidIdentityObservationCount += 1;
    state.invalidIdentityObservations.push(diagnostic);
    while (state.invalidIdentityObservations.length > state.maxIdentityDiagnostics) {
      state.invalidIdentityObservations.shift();
      state.invalidIdentityObservationsTruncated = true;
    }
    return clone(diagnostic);
  }

  function recordMonotonicityViolation(state, playerId, previousHands, nextHands, options) {
    if (!state || !Array.isArray(state.monotonicityViolations)) return null;
    var diagnostic = {
      playerId: playerId,
      previousHands: Number(previousHands),
      observedHands: Number(nextHands),
      sessionKey: state.sessionKey,
      source: boundedString(options && options.reason || 'shadow-store-update', 80),
      reason: 'same_session_hand_count_decreased'
    };
    state.monotonicityViolationCount += 1;
    state.monotonicityViolations.push(diagnostic);
    while (state.monotonicityViolations.length > state.maxIdentityDiagnostics) {
      state.monotonicityViolations.shift();
      state.monotonicityViolationsTruncated = true;
    }
    return clone(diagnostic);
  }

  function numericCounter(value) {
    if (value === null || value === undefined || value === '') return null;
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function diagnosticSnapshot(value) {
    value = value && typeof value === 'object' ? value : {};
    var snapshotVersion = numericCounter(value.snapshotVersion);
    var asOfHand = boundedString(value.asOfHand || value.lastFinalizedHandId, 200);
    return {
      asOfHand: asOfHand,
      lastFinalizedHandId: asOfHand,
      snapshotVersion: snapshotVersion
    };
  }

  function inputSummary(stats) {
    stats = stats && typeof stats === 'object' ? stats : {};
    var af = stats.afDetails && typeof stats.afDetails === 'object' ? stats.afDetails : {};
    return {
      handsPlayed: numericCounter(stats.handsPlayed),
      vpipHands: numericCounter(stats.vpipHands),
      vpipOpportunities: numericCounter(stats.vpipOpportunities),
      pfrHands: numericCounter(stats.pfrHands),
      pfrOpportunities: numericCounter(stats.pfrOpportunities),
      preflopTableSizeSum: numericCounter(stats.preflopTableSizeSum),
      preflopTableSizeOpportunities: numericCounter(stats.preflopTableSizeOpportunities),
      effectiveTableSize: numericCounter(stats.effectiveTableSize),
      afBets: numericCounter(af.bets),
      afRaises: numericCounter(af.raises),
      afCalls: numericCounter(af.calls),
      threeBetMade: numericCounter(stats.threeBetMade),
      threeBetOpportunities: numericCounter(stats.threeBetOpportunities),
      foldToThreeBet: numericCounter(stats.foldToThreeBet),
      foldToThreeBetOpportunities: numericCounter(stats.foldToThreeBetOpportunities),
      flopCBetMade: numericCounter(stats.flopCBetMade),
      flopCBetOpportunities: numericCounter(stats.flopCBetOpportunities),
      foldToFlopCBet: numericCounter(stats.foldToFlopCBet),
      foldToFlopCBetOpportunities: numericCounter(stats.foldToFlopCBetOpportunities),
      wentToShowdown: numericCounter(stats.wentToShowdown),
      sawFlopForWTSD: numericCounter(stats.sawFlopForWTSD),
      wonMoneyAtShowdown: numericCounter(stats.wonMoneyAtShowdown),
      showdownsForWSD: numericCounter(stats.showdownsForWSD)
    };
  }

  function inputSignature(stats) {
    var summary = inputSummary(stats);
    return JSON.stringify(INPUT_FIELDS.map(function (field) { return summary[field]; }));
  }

  function compactFeature(feature) {
    if (!feature || typeof feature !== 'object') return null;
    return {
      numerator: feature.numerator === undefined ? null : feature.numerator,
      denominator: feature.denominator === undefined ? null : feature.denominator,
      rawRate: feature.rawRate === undefined ? null : feature.rawRate,
      rawValue: feature.rawValue === undefined ? null : feature.rawValue,
      stabilizedRate: feature.stabilizedRate === undefined ? null : feature.stabilizedRate,
      opportunities: Number(feature.opportunities || 0),
      confidence: Number(feature.confidence || 0),
      supported: feature.supported === true,
      unsupportedReason: feature.unsupportedReason || null
    };
  }

  function featureSummary(features) {
    return FEATURE_NAMES.reduce(function (summary, name) {
      summary[name] = compactFeature(features && features[name]);
      return summary;
    }, {});
  }

  function historySnapshot(record) {
    return {
      generatedAt: record.generatedAt,
      hands: record.hands,
      archetype: record.primary.archetype,
      classificationStatus: record.primary.classificationStatus,
      confidence: record.primary.confidence,
      runnerUp: record.primary.runnerUp,
      margin: record.primary.scoreMargin,
      tags: record.tags.map(function (tag) { return tag.tag; }),
      stabilizedFeatures: Object.keys(record.featureSummary).reduce(function (summary, name) {
        var feature = record.featureSummary[name];
        if (feature && feature.supported) summary[name] = feature.stabilizedRate;
        return summary;
      }, {})
    };
  }

  function sameTags(left, right) {
    return JSON.stringify(left || []) === JSON.stringify(right || []);
  }

  function meaningfulChange(previous, next, confidenceDelta) {
    if (!previous) return true;
    if (previous.archetype !== next.archetype || previous.classificationStatus !== next.classificationStatus) return true;
    if (!sameTags(previous.tags, next.tags)) return true;
    return Math.abs(Number(previous.confidence || 0) - Number(next.confidence || 0)) >= confidenceDelta;
  }

  function tagList(record) {
    return (record && record.tags || []).map(function (tag) { return boundedString(tag && tag.tag !== undefined ? tag.tag : tag, 80); }).filter(Boolean).sort();
  }

  function callingStationEligibility(record) {
    var featureSummary = record && record.featureSummary || {};
    var primary = record && record.primary || {};
    var diagnostics = primary.scoreDiagnostics && primary.scoreDiagnostics['Calling Station'];
    var semantic = diagnostics && diagnostics.semanticEligibility || {};
    var supported = Array.isArray(semantic.supportedFeatures) ? semantic.supportedFeatures : [];
    var positive = Array.isArray(semantic.positiveFeatures) ? semantic.positiveFeatures : [];
    return {
      foldToFlopCBetSupported: Boolean(featureSummary.foldToFlopCBetRate && featureSummary.foldToFlopCBetRate.supported),
      wtsdSupported: Boolean(featureSummary.wtsdRate && featureSummary.wtsdRate.supported),
      foldToFlopCBetPositiveMembership: positive.includes('foldToFlopCBetRate'),
      wtsdPositiveMembership: positive.includes('wtsdRate'),
      supportedFeatures: supported.slice(0, 2),
      positiveFeatures: positive.slice(0, 2),
      satisfied: semantic.eligible === true,
      reason: boundedString(semantic.reason, 160)
    };
  }

  function supportedFeatureTelemetry(featureSummary) {
    return Object.keys(featureSummary || {}).reduce(function (result, name) {
      var feature = featureSummary[name];
      if (!feature || feature.supported !== true) return result;
      result[name] = {
        stabilizedRate: feature.stabilizedRate === undefined ? null : feature.stabilizedRate,
        opportunities: Number(feature.opportunities || 0),
        confidence: Number(feature.confidence || 0)
      };
      return result;
    }, {});
  }

  function profileValidationSnapshot(record) {
    var primary = record && record.primary || {};
    var bestCandidate = boundedString(primary.bestCandidate, 80);
    return {
      playerId: boundedString(record && record.playerId, 200),
      hands: Number(record && record.hands || 0),
      archetype: boundedString(primary.archetype, 80),
      classificationStatus: boundedString(primary.classificationStatus, 80),
      bestCandidate: bestCandidate,
      runnerUp: boundedString(primary.runnerUp, 80),
      bestScore: bestCandidate && primary.scores ? Number(primary.scores[bestCandidate] || 0) : 0,
      scoreMargin: Number(primary.scoreMargin || 0),
      confidence: Number(primary.confidence || 0),
      tags: tagList(record),
      stabilizedSupportedFeatures: supportedFeatureTelemetry(record && record.featureSummary),
      callingStationEligibility: callingStationEligibility(record),
      tableContext: clone(record && record.tableContext || null),
      classifierSchemaVersion: record && record.classifierSchemaVersion === undefined ? null : record.classifierSchemaVersion,
      generatedAt: Number(record && record.generatedAt || 0)
    };
  }

  function compactValidationSample(snapshot) {
    return {
      hands: snapshot.hands,
      archetype: snapshot.archetype,
      classificationStatus: snapshot.classificationStatus,
      bestCandidate: snapshot.bestCandidate,
      runnerUp: snapshot.runnerUp,
      bestScore: snapshot.bestScore,
      scoreMargin: snapshot.scoreMargin,
      confidence: snapshot.confidence,
      tags: snapshot.tags.slice(),
      callingStationEligible: snapshot.callingStationEligibility.satisfied,
      effectiveTableSize: snapshot.tableContext && snapshot.tableContext.effectiveTableSize || null,
      tableContextStatus: snapshot.tableContext && snapshot.tableContext.status || 'unsupported',
      generatedAt: snapshot.generatedAt
    };
  }

  function arrayDifference(left, right) {
    return left.filter(function (value) { return !right.includes(value); });
  }

  function transitionReasons(previous, next, confidenceDelta) {
    if (!previous) return [{ type: 'initial_profile', from: null, to: next.archetype }];
    var reasons = [];
    if (previous.classificationStatus !== next.classificationStatus) reasons.push({ type: 'classification_status_changed', from: previous.classificationStatus, to: next.classificationStatus });
    if (previous.archetype !== next.archetype) reasons.push({ type: 'primary_changed', from: previous.archetype, to: next.archetype });
    if (previous.bestCandidate !== next.bestCandidate) reasons.push({ type: 'best_candidate_changed', from: previous.bestCandidate, to: next.bestCandidate });
    if (previous.runnerUp !== next.runnerUp) reasons.push({ type: 'runner_up_changed', from: previous.runnerUp, to: next.runnerUp });
    arrayDifference(next.tags, previous.tags).forEach(function (tag) { reasons.push({ type: 'tag_added', tag: tag }); });
    arrayDifference(previous.tags, next.tags).forEach(function (tag) { reasons.push({ type: 'tag_removed', tag: tag }); });
    var confidenceDeltaValue = Math.abs(next.confidence - previous.confidence);
    if (confidenceDeltaValue >= confidenceDelta) reasons.push({ type: 'confidence_delta', delta: Math.round((next.confidence - previous.confidence) * 10000) / 10000 });
    var previousMarginPasses = previous.scoreMargin >= PRIMARY_SCORE_MARGIN_GATE;
    var nextMarginPasses = next.scoreMargin >= PRIMARY_SCORE_MARGIN_GATE;
    if (previousMarginPasses !== nextMarginPasses) reasons.push({ type: 'score_margin_crossed', from: previousMarginPasses, to: nextMarginPasses, threshold: PRIMARY_SCORE_MARGIN_GATE });
    var previousEligibility = previous.callingStationEligibility;
    var nextEligibility = next.callingStationEligibility;
    if (previousEligibility.satisfied !== nextEligibility.satisfied) reasons.push({ type: 'semantic_eligibility_changed', from: previousEligibility.satisfied, to: nextEligibility.satisfied, archetype: 'Calling Station' });
    if (JSON.stringify(previousEligibility.supportedFeatures) !== JSON.stringify(nextEligibility.supportedFeatures) || JSON.stringify(previousEligibility.positiveFeatures) !== JSON.stringify(nextEligibility.positiveFeatures)) {
      reasons.push({ type: 'semantic_evidence_changed', archetype: 'Calling Station', supportedFeatures: nextEligibility.supportedFeatures.slice(), positiveFeatures: nextEligibility.positiveFeatures.slice() });
    }
    return reasons;
  }

  function createValidationTracker(snapshot) {
    return {
      playerId: snapshot.playerId,
      timeline: [],
      samples: [],
      bandSnapshots: [],
      timelineTruncated: false,
      samplesTruncated: false,
      lastSnapshot: null,
      metrics: {
        totalClassificationChanges: 0,
        supportedPrimaryChanges: 0,
        unknownSupportedTransitions: 0,
        tagChanges: 0,
        stablePrimaryStartHands: snapshot.hands,
        longestStablePrimarySpan: 1,
        initialConfidence: snapshot.confidence,
        minimumConfidence: snapshot.confidence,
        maximumConfidence: snapshot.confidence,
        latestConfidence: snapshot.confidence
      }
    };
  }

  function boundedPush(list, value, maximum, tracker, truncatedField) {
    list.push(value);
    while (list.length > maximum) {
      list.shift();
      tracker[truncatedField] = true;
    }
  }

  function updateValidationMetrics(tracker, previous, next) {
    var metrics = tracker.metrics;
    if (previous && previous.archetype !== next.archetype) {
      metrics.totalClassificationChanges += 1;
      if (previous.classificationStatus === 'supported' && next.classificationStatus === 'supported') metrics.supportedPrimaryChanges += 1;
      if ((previous.classificationStatus === 'supported') !== (next.classificationStatus === 'supported')) metrics.unknownSupportedTransitions += 1;
      metrics.longestStablePrimarySpan = Math.max(metrics.longestStablePrimarySpan, Math.max(1, previous.hands - metrics.stablePrimaryStartHands + 1));
      metrics.stablePrimaryStartHands = next.hands;
    }
    if (previous) metrics.tagChanges += arrayDifference(next.tags, previous.tags).length + arrayDifference(previous.tags, next.tags).length;
    metrics.minimumConfidence = Math.min(metrics.minimumConfidence, next.confidence);
    metrics.maximumConfidence = Math.max(metrics.maximumConfidence, next.confidence);
    metrics.latestConfidence = next.confidence;
    metrics.longestStablePrimarySpan = Math.max(metrics.longestStablePrimarySpan, Math.max(1, next.hands - metrics.stablePrimaryStartHands + 1));
  }

  function captureBandSnapshots(tracker, snapshot) {
    PROFILE_HAND_BANDS.forEach(function (band) {
      if (snapshot.hands < band || tracker.bandSnapshots.some(function (entry) { return entry.band === band; })) return;
      tracker.bandSnapshots.push(Object.assign({ band: band, capturedAtHands: snapshot.hands }, clone(snapshot)));
    });
  }

  function recordValidationUpdate(state, record) {
    var snapshot = profileValidationSnapshot(record);
    var tracker = state.validation.get(snapshot.playerId) || createValidationTracker(snapshot);
    var previous = tracker.lastSnapshot;
    updateValidationMetrics(tracker, previous, snapshot);
    boundedPush(tracker.samples, compactValidationSample(snapshot), state.maxValidationSamples, tracker, 'samplesTruncated');
    var reasons = transitionReasons(previous, snapshot, state.confidenceDelta);
    if (reasons.length) boundedPush(tracker.timeline, Object.assign({ reasons: reasons }, clone(snapshot)), state.maxValidationTransitions, tracker, 'timelineTruncated');
    captureBandSnapshots(tracker, snapshot);
    tracker.lastSnapshot = snapshot;
    state.validation.delete(snapshot.playerId);
    state.validation.set(snapshot.playerId, tracker);
  }

  function recordPresentationUpdate(state, record) {
    if (!state || !state.presenter || typeof state.presenter.resolveDisplayedProfile !== 'function') return null;
    try {
      var previous = state.presentation.get(record.playerId) || null;
      var resolved = state.presenter.resolveDisplayedProfile(record, previous, { policy: state.presentationPolicy });
      state.presentation.delete(record.playerId);
      state.presentation.set(record.playerId, clone(resolved));
      return resolved;
    } catch (_error) {
      state.presentationFailures += 1;
      return null;
    }
  }

  function createState(options) {
    options = options || {};
    return {
      schemaVersion: SCHEMA_VERSION,
      maxPlayers: boundedInteger(options.maxPlayers, DEFAULT_MAX_PLAYERS, 1, 2000),
      maxHistoryPerPlayer: boundedInteger(options.maxHistoryPerPlayer, DEFAULT_MAX_HISTORY, 1, 100),
      maxValidationTransitions: boundedInteger(options.maxValidationTransitions, DEFAULT_MAX_VALIDATION_TRANSITIONS, 1, 500),
      maxValidationSamples: boundedInteger(options.maxValidationSamples, DEFAULT_MAX_VALIDATION_SAMPLES, 1, 1000),
      maxIdentityDiagnostics: boundedInteger(options.maxIdentityDiagnostics, DEFAULT_MAX_IDENTITY_DIAGNOSTICS, 1, 200),
      confidenceDelta: Number.isFinite(Number(options.confidenceDelta))
        ? Math.max(0, Math.min(1, Number(options.confidenceDelta)))
        : DEFAULT_CONFIDENCE_DELTA,
      records: new Map(),
      validation: new Map(),
      presentation: new Map(),
      invalidIdentityObservations: [],
      invalidIdentityObservationCount: 0,
      invalidIdentityObservationsTruncated: false,
      monotonicityViolations: [],
      monotonicityViolationCount: 0,
      monotonicityViolationsTruncated: false,
      sessionKey: boundedString(options.sessionKey, 500),
      classifier: options.classifier || root.PokerPlayerProfileClassifier || null,
      presenter: options.presenter || root.PokerPlayerProfilePresentation || null,
      presentationPolicy: options.presentationPolicy && typeof options.presentationPolicy === 'object' ? clone(options.presentationPolicy) : null,
      updateAttempts: 0,
      classifications: 0,
      signatureReuses: 0,
      failures: 0,
      presentationFailures: 0,
      evictions: 0
    };
  }

  function unsupportedRecord(playerId, summary, signature, generatedAt, reason, previous) {
    return {
      playerId: playerId,
      generatedAt: generatedAt,
      hands: Number(summary.handsPlayed || 0),
      primary: {
        archetype: 'Unknown / Unsupported',
        classificationStatus: 'unsupported',
        confidence: 0,
        runnerUp: null,
        scoreMargin: 0,
        scores: {},
        unsupportedReason: reason
      },
      tags: [],
      featureSummary: {},
      tableContext: { supported: false, applied: false, status: 'unsupported', effectiveTableSize: null, unsupportedReason: reason },
      supportSummary: { hands: Number(summary.handsPlayed || 0), supportedFeatures: [], unsupportedFeatures: [{ feature: 'profile', reason: reason }] },
      classifierSchemaVersion: null,
      shadowStoreSchemaVersion: SCHEMA_VERSION,
      inputSignature: signature,
      inputSummary: summary,
      diagnostic: { unsupported: true, reason: reason },
      history: previous && Array.isArray(previous.history) ? clone(previous.history) : []
    };
  }

  function compactRecord(playerId, result, summary, signature, generatedAt, previous) {
    if (!result || !result.primary || !result.features || !result.support) throw new Error('classifier returned an invalid profile contract');
    return {
      playerId: playerId,
      generatedAt: generatedAt,
      hands: Number(summary.handsPlayed || 0),
      primary: clone(result.primary),
      tags: clone(result.tags || []),
      featureSummary: featureSummary(result.features),
      tableContext: clone(result.tableContext || null),
      supportSummary: clone(result.support),
      classifierSchemaVersion: result.schemaVersion,
      shadowStoreSchemaVersion: SCHEMA_VERSION,
      inputSignature: signature,
      inputSummary: summary,
      diagnostic: null,
      history: previous && Array.isArray(previous.history) ? clone(previous.history) : []
    };
  }

  function touch(state, playerId, record) {
    state.records.delete(playerId);
    state.records.set(playerId, record);
    while (state.records.size > state.maxPlayers) {
      var evictedPlayerId = state.records.keys().next().value;
      state.records.delete(evictedPlayerId);
      state.validation.delete(evictedPlayerId);
      state.presentation.delete(evictedPlayerId);
      state.evictions += 1;
    }
  }

  function update(state, playerIdValue, stats, options) {
    if (!state || !(state.records instanceof Map)) return { updated: false, reused: false, failed: true, reason: 'invalid shadow store state', record: null };
    state.updateAttempts += 1;
    var playerId = livePlayerIdentity(playerIdValue);
    if (!playerId) {
      recordIdentityDiagnostic(state, playerIdValue, { source: options && options.reason || 'shadow-store-update' });
      state.failures += 1;
      return { updated: false, reused: false, failed: true, reason: 'valid stable playerId is required', record: null };
    }
    var signature = inputSignature(stats);
    var summary = inputSummary(stats);
    var profileDiagnosticSnapshot = diagnosticSnapshot(options && options.diagnosticSnapshot);
    var previous = state.records.get(playerId) || null;
    if (previous && summary.handsPlayed !== null && summary.handsPlayed < Number(previous.hands || 0)) {
      var monotonicityReason = 'same-session hand count decreased from ' + Number(previous.hands || 0) + ' to ' + summary.handsPlayed;
      recordMonotonicityViolation(state, playerId, previous.hands, summary.handsPlayed, options);
      state.failures += 1;
      return { updated: false, reused: false, failed: true, rejected: true, reason: monotonicityReason, record: clone(previous) };
    }
    if (previous && previous.inputSignature === signature) {
      state.signatureReuses += 1;
      previous.diagnosticSnapshot = profileDiagnosticSnapshot;
      touch(state, playerId, previous);
      return { updated: false, reused: true, failed: false, reason: 'authoritative profile input signature unchanged', record: clone(previous) };
    }
    var generatedAt = Number(options && options.generatedAt);
    if (!Number.isFinite(generatedAt)) generatedAt = Date.now();
    var record;
    var failureReason = null;
    var invalidFields = REQUIRED_INPUT_FIELDS.filter(function (field) { return summary[field] === null; });
    if (invalidFields.length) {
      failureReason = 'malformed authoritative statistics fields: ' + invalidFields.join(', ');
      record = unsupportedRecord(playerId, summary, signature, generatedAt, failureReason, previous);
      state.failures += 1;
    } else {
      try {
        if (!state.classifier || typeof state.classifier.classify !== 'function') throw new Error('PokerPlayerProfileClassifier.classify is unavailable');
        record = compactRecord(playerId, state.classifier.classify(stats || {}), summary, signature, generatedAt, previous);
        state.classifications += 1;
      } catch (error) {
        failureReason = String(error && error.message || error || 'unknown classifier failure');
        record = unsupportedRecord(playerId, summary, signature, generatedAt, failureReason, previous);
        state.failures += 1;
      }
    }
    record.diagnosticSnapshot = profileDiagnosticSnapshot;
    var snapshot = historySnapshot(record);
    var previousSnapshot = record.history.length ? record.history[record.history.length - 1] : null;
    var changed = meaningfulChange(previousSnapshot, snapshot, state.confidenceDelta);
    if (changed) {
      record.history.push(snapshot);
      while (record.history.length > state.maxHistoryPerPlayer) record.history.shift();
    }
    recordValidationUpdate(state, record);
    recordPresentationUpdate(state, record);
    touch(state, playerId, record);
    if (changed && root.__PNHUD_PROFILE_DEBUG__ === true && root.console && typeof root.console.log === 'function') {
      root.console.log('[PNHUD PROFILE] player profile updated', {
        playerId: playerId,
        hands: record.hands,
        archetype: record.primary.archetype,
        confidence: record.primary.confidence,
        tags: record.tags.map(function (tag) { return tag.tag; })
      });
    }
    return { updated: true, reused: false, failed: Boolean(failureReason), reason: failureReason, historyChanged: changed, record: clone(record) };
  }

  function list(state) {
    return state && state.records instanceof Map ? Array.from(state.records.values()).filter(function (record) {
      return Boolean(livePlayerIdentity(record && record.playerId));
    }).map(clone) : [];
  }

  function get(state, playerId) {
    var normalizedPlayerId = livePlayerIdentity(playerId);
    var record = normalizedPlayerId && state && state.records instanceof Map ? state.records.get(normalizedPlayerId) : null;
    return record ? clone(record) : null;
  }

  function summary(state) {
    return list(state).map(function (record) {
      return {
        playerId: record.playerId,
        hands: record.hands,
        archetype: record.primary.archetype,
        confidence: record.primary.confidence,
        runnerUp: record.primary.runnerUp,
        margin: record.primary.scoreMargin,
        tags: record.tags.map(function (tag) { return tag.tag; })
      };
    });
  }

  function clear(state) {
    if (!state || !(state.records instanceof Map)) return 0;
    var removed = state.records.size;
    state.records.clear();
    state.validation.clear();
    state.presentation.clear();
    state.invalidIdentityObservations.length = 0;
    state.invalidIdentityObservationCount = 0;
    state.invalidIdentityObservationsTruncated = false;
    state.monotonicityViolations.length = 0;
    state.monotonicityViolationCount = 0;
    state.monotonicityViolationsTruncated = false;
    return removed;
  }

  function validationTracker(state, playerId) {
    var normalizedPlayerId = livePlayerIdentity(playerId);
    var tracker = normalizedPlayerId && state && state.validation instanceof Map ? state.validation.get(normalizedPlayerId) : null;
    return tracker || null;
  }

  function profileTimeline(state, playerId) {
    var tracker = validationTracker(state, playerId);
    return tracker ? clone(tracker.timeline) : [];
  }

  function profileSamples(state, playerId) {
    var tracker = validationTracker(state, playerId);
    return tracker ? clone(tracker.samples) : [];
  }

  function profileBandSnapshots(state, playerId) {
    var tracker = validationTracker(state, playerId);
    return tracker ? clone(tracker.bandSnapshots) : [];
  }

  function displayedProfile(state, playerId) {
    var normalizedPlayerId = livePlayerIdentity(playerId);
    var result = normalizedPlayerId && state && state.presentation instanceof Map ? state.presentation.get(normalizedPlayerId) : null;
    return result ? clone(result) : null;
  }

  function allDisplayedProfiles(state) {
    return state && state.presentation instanceof Map ? Array.from(state.presentation.entries()).filter(function (entry) {
      return Boolean(livePlayerIdentity(entry[0]));
    }).map(function (entry) {
      return { playerId: entry[0], presentation: clone(entry[1]) };
    }) : [];
  }

  function scoreDecomposition(state, playerId) {
    var record = get(state, playerId);
    if (!record || !record.inputSummary || !state || !state.classifier || typeof state.classifier.scoreDecomposition !== 'function') return null;
    var input = record.inputSummary;
    var decomposition = state.classifier.scoreDecomposition({
      handsPlayed: input.handsPlayed,
      vpipHands: input.vpipHands,
      vpipOpportunities: input.vpipOpportunities,
      pfrHands: input.pfrHands,
      pfrOpportunities: input.pfrOpportunities,
      preflopTableSizeSum: input.preflopTableSizeSum,
      preflopTableSizeOpportunities: input.preflopTableSizeOpportunities,
      effectiveTableSize: input.effectiveTableSize,
      afDetails: { bets: input.afBets, raises: input.afRaises, calls: input.afCalls },
      threeBetMade: input.threeBetMade,
      threeBetOpportunities: input.threeBetOpportunities,
      foldToThreeBet: input.foldToThreeBet,
      foldToThreeBetOpportunities: input.foldToThreeBetOpportunities,
      flopCBetMade: input.flopCBetMade,
      flopCBetOpportunities: input.flopCBetOpportunities,
      foldToFlopCBet: input.foldToFlopCBet,
      foldToFlopCBetOpportunities: input.foldToFlopCBetOpportunities,
      wentToShowdown: input.wentToShowdown,
      sawFlopForWTSD: input.sawFlopForWTSD,
      wonMoneyAtShowdown: input.wonMoneyAtShowdown,
      showdownsForWSD: input.showdownsForWSD
    });
    var snapshot = diagnosticSnapshot(record.diagnosticSnapshot);
    decomposition.asOfHand = snapshot.asOfHand;
    decomposition.lastFinalizedHandId = snapshot.lastFinalizedHandId;
    decomposition.snapshotVersion = snapshot.snapshotVersion;
    return decomposition;
  }

  function countRecentPrimaryChanges(tracker, currentHands, windowHands) {
    var minimumHands = Math.max(0, currentHands - windowHands + 1);
    return tracker.timeline.filter(function (entry) {
      return entry.hands >= minimumHands && entry.reasons.some(function (reason) { return reason.type === 'primary_changed'; });
    }).length;
  }

  function profileStability(state, playerId) {
    var tracker = validationTracker(state, playerId);
    if (!tracker || !tracker.lastSnapshot) return null;
    var current = tracker.lastSnapshot;
    var metrics = tracker.metrics;
    return {
      playerId: tracker.playerId,
      hands: current.hands,
      currentArchetype: current.archetype,
      currentClassificationStatus: current.classificationStatus,
      totalClassificationChanges: metrics.totalClassificationChanges,
      supportedPrimaryChanges: metrics.supportedPrimaryChanges,
      unknownSupportedTransitions: metrics.unknownSupportedTransitions,
      changesInLast20Hands: countRecentPrimaryChanges(tracker, current.hands, 20),
      changesInLast50Hands: countRecentPrimaryChanges(tracker, current.hands, 50),
      longestStablePrimarySpan: metrics.longestStablePrimarySpan,
      currentStablePrimarySpan: Math.max(1, current.hands - metrics.stablePrimaryStartHands + 1),
      tagChanges: metrics.tagChanges,
      confidenceTrajectory: {
        initial: metrics.initialConfidence,
        current: metrics.latestConfidence,
        minimum: metrics.minimumConfidence,
        maximum: metrics.maximumConfidence,
        delta: Math.round((metrics.latestConfidence - metrics.initialConfidence) * 10000) / 10000,
        samplesRetained: tracker.samples.length,
        samplesTruncated: tracker.samplesTruncated
      },
      transitionCountRetained: tracker.timeline.length,
      timelineTruncated: tracker.timelineTruncated,
      windowMetricsMayBeTruncated: tracker.timelineTruncated,
      callingStationEligibility: clone(current.callingStationEligibility)
    };
  }

  function allProfileStability(state) {
    return state && state.validation instanceof Map ? Array.from(state.validation.keys()).filter(function (playerId) {
      return Boolean(livePlayerIdentity(playerId));
    }).map(function (playerId) {
      return profileStability(state, playerId);
    }).filter(Boolean) : [];
  }

  function exportLiveProfileValidation(state) {
    var players = list(state).map(function (record) {
      return {
        playerId: record.playerId,
        hands: record.hands,
        currentProfile: profileValidationSnapshot(record),
        timeline: profileTimeline(state, record.playerId),
        samples: profileSamples(state, record.playerId),
        bandSnapshots: profileBandSnapshots(state, record.playerId),
        stability: profileStability(state, record.playerId),
        displayedProfile: displayedProfile(state, record.playerId)
      };
    });
    return {
      schemaVersion: LIVE_VALIDATION_SCHEMA_VERSION,
      session: { sessionKey: state && state.sessionKey || null },
      bounds: {
        maxPlayers: state && state.maxPlayers || 0,
        maxTransitionsPerPlayer: state && state.maxValidationTransitions || 0,
        maxSamplesPerPlayer: state && state.maxValidationSamples || 0,
        maxBandSnapshotsPerPlayer: PROFILE_HAND_BANDS.length,
        maxIdentityDiagnostics: state && state.maxIdentityDiagnostics || 0
      },
      players: players,
      identityDiagnostics: {
        invalidIdentityObservationCount: state && state.invalidIdentityObservationCount || 0,
        invalidIdentityObservationsTruncated: Boolean(state && state.invalidIdentityObservationsTruncated),
        invalidIdentityObservations: clone(state && state.invalidIdentityObservations || []),
        monotonicityViolationCount: state && state.monotonicityViolationCount || 0,
        monotonicityViolationsTruncated: Boolean(state && state.monotonicityViolationsTruncated),
        monotonicityViolations: clone(state && state.monotonicityViolations || [])
      }
    };
  }

  function inspect(state) {
    return {
      schemaVersion: SCHEMA_VERSION,
      size: state && state.records instanceof Map ? state.records.size : 0,
      maxPlayers: state && state.maxPlayers || 0,
      maxHistoryPerPlayer: state && state.maxHistoryPerPlayer || 0,
      maxValidationTransitions: state && state.maxValidationTransitions || 0,
      maxValidationSamples: state && state.maxValidationSamples || 0,
      validationPlayers: state && state.validation instanceof Map ? state.validation.size : 0,
      presentationPlayers: state && state.presentation instanceof Map ? state.presentation.size : 0,
      presentationFailures: state && state.presentationFailures || 0,
      invalidIdentityObservationCount: state && state.invalidIdentityObservationCount || 0,
      invalidIdentityObservationsRetained: state && state.invalidIdentityObservations ? state.invalidIdentityObservations.length : 0,
      invalidIdentityObservationsTruncated: Boolean(state && state.invalidIdentityObservationsTruncated),
      monotonicityViolationCount: state && state.monotonicityViolationCount || 0,
      monotonicityViolationsRetained: state && state.monotonicityViolations ? state.monotonicityViolations.length : 0,
      monotonicityViolationsTruncated: Boolean(state && state.monotonicityViolationsTruncated),
      updateAttempts: state && state.updateAttempts || 0,
      classifications: state && state.classifications || 0,
      signatureReuses: state && state.signatureReuses || 0,
      failures: state && state.failures || 0,
      evictions: state && state.evictions || 0
    };
  }

  function createDebugApi(state) {
    return Object.freeze({
      list: function () { return list(state); },
      get: function (playerId) { return get(state, playerId); },
      summary: function () { return summary(state); },
      clear: function () { return clear(state); },
      profileTimeline: function (playerId) { return profileTimeline(state, playerId); },
      profileSamples: function (playerId) { return profileSamples(state, playerId); },
      profileStability: function (playerId) { return profileStability(state, playerId); },
      profileBandSnapshots: function (playerId) { return profileBandSnapshots(state, playerId); },
      displayedProfile: function (playerId) { return displayedProfile(state, playerId); },
      allDisplayedProfiles: function () { return allDisplayedProfiles(state); },
      scoreDecomposition: function (playerId) { return scoreDecomposition(state, playerId); },
      allProfileStability: function () { return allProfileStability(state); },
      exportLiveProfileValidation: function () { return exportLiveProfileValidation(state); },
      identityDiagnostics: function () { return clone(exportLiveProfileValidation(state).identityDiagnostics); }
    });
  }

  var api = Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    LIVE_VALIDATION_SCHEMA_VERSION: LIVE_VALIDATION_SCHEMA_VERSION,
    PROFILE_HAND_BANDS: PROFILE_HAND_BANDS,
    INPUT_FIELDS: INPUT_FIELDS,
    invalidLivePlayerIdentityReason: invalidLivePlayerIdentityReason,
    livePlayerIdentity: livePlayerIdentity,
    recordIdentityDiagnostic: recordIdentityDiagnostic,
    createState: createState,
    inputSummary: inputSummary,
    inputSignature: inputSignature,
    update: update,
    list: list,
    get: get,
    summary: summary,
    clear: clear,
    profileTimeline: profileTimeline,
    profileSamples: profileSamples,
    profileStability: profileStability,
    profileBandSnapshots: profileBandSnapshots,
    displayedProfile: displayedProfile,
    allDisplayedProfiles: allDisplayedProfiles,
    scoreDecomposition: scoreDecomposition,
    allProfileStability: allProfileStability,
    exportLiveProfileValidation: exportLiveProfileValidation,
    inspect: inspect,
    createDebugApi: createDebugApi
  });

  root.PokerPlayerProfileShadowStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
