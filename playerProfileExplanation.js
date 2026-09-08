/* Pure explainability adapter over authoritative classifier and presentation outputs. */
(function (root, factory) {
  'use strict';
  var classifier = root.PokerPlayerProfileClassifier;
  var presentation = root.PokerPlayerProfilePresentation;
  if (typeof module !== 'undefined' && module.exports) {
    if (!classifier) classifier = require('./playerProfileClassifier.js');
    if (!presentation) presentation = require('./playerProfilePresentation.js');
  }
  var api = factory(classifier, presentation);
  root.PokerPlayerProfileExplanation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (classifier, presentation) {
  'use strict';

  var SCHEMA_VERSION = 2;
  var ARCHETYPES = Object.freeze(['Nit', 'TAG', 'LAG', 'Tight Passive', 'Loose Passive', 'Calling Station', 'Maniac']);
  var GUIDE_ORDER = Object.freeze(ARCHETYPES.concat(['Unknown']));
  var FIT_NOTE = 'Fit scores measure how compatible this player\u2019s observed tendencies are with each archetype. They are not probabilities and do not have to sum to 100%.';
  var CONFIDENCE_NOTE = 'Confidence is the classifier\u2019s combined strength of the top fit, supported VPIP/PFR evidence, and separation from the second-best fit. A percentage alone does not replace the underlying sample.';
  var DEFINITIONS = Object.freeze({
    Nit: Object.freeze({ fullName: 'Nit', description: 'Very tight, selective preflop player. Enters relatively few pots and generally avoids borderline action.' }),
    TAG: Object.freeze({ fullName: 'Tight Aggressive', description: 'Tight-aggressive player. Selective preflop, but raises and applies aggression with the hands played.' }),
    LAG: Object.freeze({ fullName: 'Loose Aggressive', description: 'Loose-aggressive player. Plays a wider range while maintaining substantial raising and aggression.' }),
    'Tight Passive': Object.freeze({ fullName: 'Tight Passive', description: 'Selective but relatively passive player. Enters fewer pots and tends to raise or apply pressure less often once involved.' }),
    'Loose Passive': Object.freeze({ fullName: 'Loose Passive', description: 'Plays many hands but raises relatively infrequently, producing a wider and more call-heavy style.' }),
    'Calling Station': Object.freeze({ fullName: 'Calling Station', description: 'Loose, passive player with particularly strong calling and low-fold tendencies, often continuing toward showdown rather than applying aggression.' }),
    Maniac: Object.freeze({ fullName: 'Maniac', description: 'Extremely loose and aggressive player. The HUD requires substantial, persistent evidence before displaying this label.' }),
    Unknown: Object.freeze({ fullName: 'Unknown', description: 'No stable profile is currently displayed because evidence is insufficient, mixed, unstable, unsupported, or still waiting for the existing presentation policy to confirm it.' })
  });
  var FEATURE_LABELS = Object.freeze({
    vpipRate: 'VPIP',
    pfrRate: 'PFR',
    vpipPfrGap: 'VPIP\u2013PFR gap',
    pfrVpipRatio: 'PFR/VPIP ratio',
    aggressionFrequency: 'Postflop aggression',
    aggressionFactor: 'Aggression factor',
    threeBetRate: '3Bet',
    foldToThreeBetRate: 'Fold to 3Bet',
    flopCBetRate: 'Flop CBet',
    foldToFlopCBetRate: 'Fold to Flop CBet',
    wtsdRate: 'WTSD',
    wsdRate: 'W$SD'
  });

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function integer(value) {
    return Math.max(0, Math.floor(finite(value, 0)));
  }

  function percent(value) {
    var number = finite(value, null);
    return number === null ? null : Math.round(number * 1000) / 10;
  }

  function formatPercent(value) {
    var result = percent(value);
    return result === null ? '\u2014' : String(result).replace(/\.0$/, '') + '%';
  }

  function definitionFor(archetype) {
    return DEFINITIONS[archetype] || DEFINITIONS.Unknown;
  }

  function configuration(input) {
    return input && typeof input === 'object' ? input : {};
  }

  function classifierConfiguration(input) {
    return configuration(input && input.classifierConfig || classifier && classifier.DEFAULT_CONFIG);
  }

  function presentationPolicy(input) {
    return configuration(input && input.presentationPolicy || presentation && presentation.DEFAULT_POLICY);
  }

  function guide(input) {
    var config = classifierConfiguration(input);
    var archetypeConfig = config.archetypes || {};
    return GUIDE_ORDER.map(function (name) {
      var definition = definitionFor(name);
      var factors = Array.isArray(archetypeConfig[name]) ? archetypeConfig[name].slice().sort(function (left, right) {
        return finite(right.weight, 0) - finite(left.weight, 0);
      }) : [];
      return {
        archetype: name,
        fullName: definition.fullName,
        description: definition.description,
        majorTendencies: factors.map(function (factor) { return FEATURE_LABELS[factor.feature] || factor.feature; }),
        criteriaSource: name === 'Unknown' ? 'classifier_and_presentation_gates' : 'classifier_configuration'
      };
    });
  }

  function scoreMap(primary) {
    var scores = primary && primary.scores && typeof primary.scores === 'object' ? primary.scores : {};
    return ARCHETYPES.reduce(function (result, name) {
      result[name] = Math.max(0, finite(scores[name], 0));
      return result;
    }, {});
  }

  function featureDiagnostics(input, record) {
    var decomposition = input.decomposition && typeof input.decomposition === 'object' ? input.decomposition : {};
    if (decomposition.featureDiagnostics && typeof decomposition.featureDiagnostics === 'object') return decomposition.featureDiagnostics;
    return record.featureSummary && typeof record.featureSummary === 'object' ? record.featureSummary : {};
  }

  function archetypeDecomposition(input, archetype) {
    var decomposition = input.decomposition && input.decomposition.archetypes;
    return decomposition && decomposition[archetype] && typeof decomposition[archetype] === 'object'
      ? decomposition[archetype]
      : null;
  }

  function observedValue(diagnostic) {
    if (!diagnostic || typeof diagnostic !== 'object') return null;
    if (diagnostic.rawValue === 'infinity') return 'infinity';
    return Number.isFinite(Number(diagnostic.rawRate)) ? Number(diagnostic.rawRate) : null;
  }

  function featureValueText(feature, diagnostic) {
    var value = observedValue(diagnostic);
    if (value === 'infinity') return '\u221e';
    if (value === null) return '\u2014';
    if (feature === 'pfrVpipRatio' || feature === 'aggressionFactor') return String(Math.round(value * 100) / 100);
    return formatPercent(value);
  }

  function sampleText(diagnostic) {
    if (!diagnostic || typeof diagnostic !== 'object') return null;
    var hasCounts = diagnostic.numerator !== null && diagnostic.numerator !== undefined && diagnostic.denominator !== null && diagnostic.denominator !== undefined;
    var numerator = hasCounts ? Number(diagnostic.numerator) : NaN;
    var denominator = hasCounts ? Number(diagnostic.denominator) : NaN;
    if (Number.isFinite(numerator) && Number.isFinite(denominator)) return Math.max(0, numerator) + ' / ' + Math.max(0, denominator);
    var opportunities = Number(diagnostic.opportunities);
    return Number.isFinite(opportunities) && opportunities > 0 ? Math.floor(opportunities) + ' opportunities' : null;
  }

  function archetypeTraits(archetype) {
    var values = {
      Nit: ['tight', 'selective'],
      TAG: ['tight', 'aggressive'],
      LAG: ['loose', 'aggressive'],
      'Tight Passive': ['tight', 'passive'],
      'Loose Passive': ['loose', 'passive'],
      'Calling Station': ['loose', 'passive', 'calling', 'low-fold'],
      Maniac: ['extremely loose', 'extremely aggressive']
    };
    return values[archetype] ? values[archetype].slice() : [];
  }

  function tendencyFor(feature, archetype) {
    var traits = archetypeTraits(archetype);
    var loose = traits.some(function (value) { return value.indexOf('loose') >= 0; });
    var tight = traits.includes('tight') || traits.includes('selective');
    var aggressive = traits.some(function (value) { return value.indexOf('aggressive') >= 0; });
    var passive = traits.includes('passive');
    var calling = traits.includes('calling') || traits.includes('low-fold');
    if (feature === 'vpipRate') return loose
      ? { dimension: archetype === 'Maniac' ? 'Extremely loose' : 'Loose', summary: 'At this observed rate, the player enters enough pots to support the loose side of the profile.' }
      : { dimension: 'Tight / selective', summary: 'At this observed rate, the player enters pots selectively, supporting the tight side of the profile.' };
    if (feature === 'pfrRate') return aggressive
      ? { dimension: 'Aggressive preflop', summary: 'They raise preflop often enough to support the aggressive side of the profile.' }
      : passive
        ? { dimension: 'Passive preflop', summary: 'They raise fewer hands preflop, leaving more of their participation in calls or limps and supporting a passive style.' }
        : { dimension: tight ? 'Preflop selectivity' : 'Preflop tendency', summary: 'Their preflop raising rate contributes to the profile\u2019s selective range description.' };
    if (feature === 'pfrVpipRatio') return aggressive
      ? { dimension: 'Aggressive preflop', summary: 'A substantial share of the hands they enter are raised rather than entered passively, supporting an aggressive preflop style.' }
      : passive || calling
        ? { dimension: 'Passive / calling preflop', summary: 'A smaller share of entered hands are raised, leaving more calling or limping in the player\u2019s preflop pattern.' }
        : { dimension: 'Preflop selectivity', summary: 'The relationship between hands entered and hands raised contributes evidence about this player\u2019s selective preflop range.' };
    if (feature === 'vpipPfrGap') return passive || calling
      ? { dimension: calling ? 'Calling tendency' : 'Passive preflop', summary: 'The gap between hands entered and hands raised leaves meaningful calling or limping evidence, supporting the passive side of the profile.' }
      : aggressive
        ? { dimension: 'Aggressive preflop', summary: 'The relationship between hands entered and hands raised shows how often participation becomes a raise rather than a passive entry.' }
        : { dimension: 'Preflop selectivity', summary: 'The gap contributes evidence about how selectively this player enters and raises preflop.' };
    if (feature === 'threeBetRate') return aggressive
      ? { dimension: 'Aggressive preflop', summary: 'They reraise preflop often enough to add evidence for an aggressive preflop style.' }
      : { dimension: 'Preflop restraint', summary: 'They reraise preflop less often, adding evidence for a more restrained or passive preflop style.' };
    if (feature === 'aggressionFrequency' || feature === 'aggressionFactor' || feature === 'flopCBetRate') return aggressive
      ? { dimension: 'Aggressive postflop', summary: 'They bet or raise often enough after the flop to support the aggressive side of the profile.' }
      : passive
        ? { dimension: 'Passive postflop', summary: 'Their postflop actions contain more checking or calling relative to betting and raising, supporting a passive style.' }
        : { dimension: 'Postflop restraint', summary: 'Their postflop betting and raising pattern contributes evidence for a more selective, restrained style.' };
    if (feature === 'foldToThreeBetRate' || feature === 'foldToFlopCBetRate') return calling
      ? { dimension: 'Calling / low-fold tendency', summary: 'They continue against pressure often enough to support a strong calling and low-fold tendency.' }
      : { dimension: 'Folding tendency', summary: 'Their response to pressure contributes evidence about how readily they fold rather than continue.' };
    if (feature === 'wtsdRate') return calling
      ? { dimension: 'Calling / showdown tendency', summary: 'They continue to showdown often enough to reinforce the profile\u2019s calling and low-fold component.' }
      : { dimension: 'Showdown tendency', summary: 'Their rate of reaching showdown contributes evidence about continuing versus folding after the flop.' };
    return { dimension: aggressive ? 'Aggressive tendency' : passive ? 'Passive tendency' : tight ? 'Tight / selective tendency' : 'Observed tendency', summary: 'This observed tendency contributes to the behavioral shape of the profile.' };
  }

  function rawEvidenceFor(input, record, archetype) {
    var entry = archetypeDecomposition(input, archetype);
    var diagnostics = featureDiagnostics(input, record);
    if (!entry || !Array.isArray(entry.evidence)) return [];
    return entry.evidence.filter(function (item) {
      var diagnostic = diagnostics[item.feature];
      return diagnostic && (diagnostic.scoringSupported === true || diagnostic.supported === true) && finite(item.membership, 0) > 0;
    }).map(function (item) {
      var diagnostic = diagnostics[item.feature] || {};
      var label = FEATURE_LABELS[item.feature] || item.feature;
      var tendency = tendencyFor(item.feature, archetype);
      return {
        feature: item.feature,
        label: label,
        value: observedValue(diagnostic),
        valueText: featureValueText(item.feature, diagnostic),
        numerator: diagnostic.numerator === undefined ? null : diagnostic.numerator,
        denominator: diagnostic.denominator === undefined ? null : diagnostic.denominator,
        opportunities: integer(diagnostic.opportunities),
        sample: sampleText(diagnostic),
        stabilizedValue: Number.isFinite(Number(diagnostic.stabilizedRate)) ? Number(diagnostic.stabilizedRate) : null,
        evidenceConfidence: Number.isFinite(Number(diagnostic.confidence)) ? Number(diagnostic.confidence) : null,
        membership: finite(item.membership, 0),
        contribution: finite(item.weightedContribution, 0),
        weight: finite(item.weight, 0),
        tableSizeShift: finite(item.tableSizeShift, 0),
        targetArchetype: archetype,
        dimension: tendency.dimension,
        summary: tendency.summary
      };
    }).sort(function (left, right) {
      return right.contribution - left.contribution || right.weight - left.weight || left.label.localeCompare(right.label);
    });
  }

  function evidenceFor(input, record, archetype, secondBestArchetype) {
    var supporting = rawEvidenceFor(input, record, archetype);
    var competing = secondBestArchetype ? rawEvidenceFor(input, record, secondBestArchetype) : [];
    var competingByFeature = {};
    competing.forEach(function (item) { competingByFeature[item.feature] = item; });
    supporting.forEach(function (item, index) {
      var alternative = competingByFeature[item.feature];
      var pullsElsewhere = alternative && alternative.contribution > item.contribution;
      item.kind = pullsElsewhere ? 'mixed' : 'supporting';
      item.strength = pullsElsewhere ? 'Mixed evidence' : index === 0 ? 'Primary evidence' : 'Additional evidence';
      item.competingArchetype = pullsElsewhere ? secondBestArchetype : null;
      if (pullsElsewhere) item.summary += ' This same statistic contributes more strongly to ' + secondBestArchetype + ', so it is mixed evidence rather than unqualified support.';
      delete competingByFeature[item.feature];
    });
    Object.keys(competingByFeature).forEach(function (feature) {
      var item = competingByFeature[feature];
      item.kind = 'mixed';
      item.strength = 'Mixed evidence';
      item.competingArchetype = secondBestArchetype;
      item.summary += ' This tendency pulls toward ' + secondBestArchetype + ' rather than the top candidate, helping explain the competing fit.';
      supporting.push(item);
    });
    return supporting.sort(function (left, right) {
      if (left.kind !== right.kind) return left.kind === 'supporting' ? -1 : 1;
      return right.contribution - left.contribution || left.label.localeCompare(right.label);
    });
  }

  function pushReason(reasons, code, message, details) {
    if (reasons.some(function (entry) { return entry.code === code; })) return;
    reasons.push(Object.assign({ code: code, message: message }, details || {}));
  }

  function coreUnsupportedReasons(input, record, reasons) {
    var diagnostics = featureDiagnostics(input, record);
    ['vpipRate', 'pfrRate', 'vpipPfrGap', 'pfrVpipRatio'].forEach(function (feature) {
      var diagnostic = diagnostics[feature];
      if (!diagnostic || (diagnostic.scoringSupported !== true && diagnostic.supported !== true)) {
        pushReason(reasons, 'unsupported_' + feature, (FEATURE_LABELS[feature] || feature) + ' does not yet have enough supported classifier evidence.', {
          source: 'classifier_feature_support',
          feature: feature,
          opportunities: diagnostic ? integer(diagnostic.opportunities) : 0,
          internalReason: diagnostic && (diagnostic.scoringUnsupportedReason || diagnostic.unsupportedReason) || 'missing_feature_diagnostic'
        });
      }
    });
  }

  function rawGateReasons(input, record, primary, reasons) {
    var config = classifierConfiguration(input);
    var decompositionGates = input.decomposition && input.decomposition.gates || {};
    var gates = {
      minimumPrimaryHands: finite(decompositionGates.minimumPrimaryHands, finite(config.minimumPrimaryHands, 0)),
      minimumPrimaryScore: finite(decompositionGates.minimumPrimaryScore, finite(config.minimumPrimaryScore, 0)),
      minimumScoreMargin: finite(decompositionGates.minimumScoreMargin, finite(config.minimumScoreMargin, 0))
    };
    var hands = integer(record.hands !== undefined ? record.hands : record.support && record.support.hands);
    var scores = scoreMap(primary);
    var best = primary.bestCandidate;
    var bestScore = best && scores[best] || 0;
    var margin = finite(primary.scoreMargin, 0);
    if (primary.classificationStatus === 'insufficient_sample') {
      if (hands < gates.minimumPrimaryHands) pushReason(reasons, 'classifier_minimum_hands', 'The classifier needs more finalized hands before a primary profile can be supported.', { source: 'classifier_gate', actual: hands, required: gates.minimumPrimaryHands });
      coreUnsupportedReasons(input, record, reasons);
    }
    if (primary.classificationStatus === 'ambiguous') {
      if (bestScore < gates.minimumPrimaryScore) pushReason(reasons, 'classifier_winning_fit', 'The strongest fit is still below the classifier\u2019s required primary-fit strength.', { source: 'classifier_gate', actual: bestScore, required: gates.minimumPrimaryScore });
      if (margin < gates.minimumScoreMargin) pushReason(reasons, 'classifier_fit_margin', 'The top two archetype fits are too close for a supported raw classification.', { source: 'classifier_gate', actual: margin, required: gates.minimumScoreMargin });
    }
    if (primary.classificationStatus === 'unsupported') {
      pushReason(reasons, 'classifier_unsupported', 'The current statistics or table context are outside the classifier\u2019s supported contract.', { source: 'classifier_gate', internalReason: primary.unsupportedReason || record.tableContext && record.tableContext.unsupportedReason || null });
    }
    return gates;
  }

  function earlyStrengthThresholds(rawArchetype, hands, policy) {
    var lag = rawArchetype === 'LAG';
    if (hands > finite(policy.earlyMaximumHands, 0)) return null;
    return lag ? {
      minimumScore: finite(policy.lag && policy.lag.earlyMinimumScore, 0),
      minimumMargin: finite(policy.lag && policy.lag.earlyMinimumMargin, 0),
      minimumConfidence: finite(policy.lag && policy.lag.earlyMinimumConfidence, 0)
    } : {
      minimumScore: finite(policy.earlyStandard && policy.earlyStandard.minimumScore, 0),
      minimumMargin: finite(policy.earlyStandard && policy.earlyStandard.minimumMargin, 0),
      minimumConfidence: finite(policy.earlyStandard && policy.earlyStandard.minimumConfidence, 0)
    };
  }

  function initialPersistence(rawArchetype, hands, policy) {
    if (rawArchetype === 'Maniac') return { updates: integer(policy.maniac && policy.maniac.updates), hands: integer(policy.maniac && policy.maniac.hands) };
    if (rawArchetype === 'LAG') return hands <= finite(policy.earlyMaximumHands, 0)
      ? { updates: integer(policy.lag && policy.lag.earlyUpdates), hands: integer(policy.lag && policy.lag.earlyHands) }
      : { updates: integer(policy.lag && policy.lag.matureUpdates), hands: integer(policy.lag && policy.lag.matureHands) };
    return hands <= finite(policy.earlyMaximumHands, 0)
      ? { updates: integer(policy.earlyStandard && policy.earlyStandard.updates), hands: integer(policy.earlyStandard && policy.earlyStandard.hands) }
      : { updates: integer(policy.matureInitial && policy.matureInitial.updates), hands: integer(policy.matureInitial && policy.matureInitial.hands) };
  }

  function presentationReasons(input, record, primary, displayed, reasons) {
    var policy = presentationPolicy(input);
    var hands = integer(record.hands !== undefined ? record.hands : displayed.rawHands);
    var rawArchetype = primary.archetype || displayed.rawArchetype || null;
    var scores = scoreMap(primary);
    var bestScore = primary.bestCandidate && scores[primary.bestCandidate] || finite(displayed.rawBestScore, 0);
    var margin = finite(primary.scoreMargin, finite(displayed.rawMargin, 0));
    var confidence = finite(primary.confidence, finite(displayed.rawConfidence, 0));
    var reason = displayed.reason || null;
    if (reason === 'minimum_visible_hands_not_met') pushReason(reasons, 'presentation_minimum_hands', 'The HUD waits for more finalized hands before showing any profile.', { source: 'presentation_policy', actual: hands, required: finite(policy.minimumVisibleHands, 0) });
    if (reason === 'raw_profile_unsupported') pushReason(reasons, 'presentation_raw_unsupported', 'The raw classifier result is unsupported, so the dashboard does not show a profile.', { source: 'presentation_state' });
    if (reason === 'raw_profile_ambiguous') pushReason(reasons, 'presentation_raw_ambiguous', 'The raw classifier has not separated one archetype clearly enough to display it.', { source: 'presentation_state' });
    if (reason === 'early_lag_hidden') pushReason(reasons, 'presentation_lag_evidence', 'LAG currently fits best, but the HUD requires a larger early sample before displaying a stable LAG label.', { source: 'presentation_policy', actual: hands, required: finite(policy.lag && policy.lag.minimumHands, 0) });
    if (reason === 'early_maniac_hidden') pushReason(reasons, 'presentation_maniac_sample', 'Maniac currently fits best, but the HUD requires a substantial sample before displaying that label.', { source: 'presentation_policy', actual: hands, required: finite(policy.maniac && policy.maniac.minimumHands, 0) });
    if (reason === 'early_strength_requirements_not_met') {
      var thresholds = earlyStrengthThresholds(rawArchetype, hands, policy);
      if (thresholds) {
        if (bestScore < thresholds.minimumScore) pushReason(reasons, 'presentation_winning_fit', 'The current winning fit has not reached the presentation policy\u2019s early strength requirement.', { source: 'presentation_policy', actual: bestScore, required: thresholds.minimumScore });
        if (margin < thresholds.minimumMargin) pushReason(reasons, 'presentation_fit_margin', 'The top and second-best fits are still too close for an early stable label.', { source: 'presentation_policy', actual: margin, required: thresholds.minimumMargin });
        if (confidence < thresholds.minimumConfidence) pushReason(reasons, 'presentation_confidence', 'Classifier confidence is not yet high enough for an early stable label.', { source: 'presentation_policy', actual: confidence, required: thresholds.minimumConfidence });
      }
      if (!reasons.some(function (entry) { return entry.source === 'presentation_policy'; })) pushReason(reasons, 'presentation_early_strength', 'The early-sample presentation strength requirements are not yet met.', { source: 'presentation_policy' });
    }
    if (reason === 'initial_candidate_requires_persistence') {
      var initial = initialPersistence(rawArchetype, hands, policy);
      pushReason(reasons, 'hysteresis_initial_confirmation', 'The raw profile is eligible, but the HUD is waiting for repeated confirmation before showing its first stable label.', { source: 'presentation_hysteresis', requiredUpdates: initial.updates, requiredHands: initial.hands, pendingUpdates: integer(displayed.pendingUpdates), pendingSinceHands: displayed.pendingSinceHands });
    }
    if (reason === 'replacement_candidate_requires_persistence') pushReason(reasons, 'hysteresis_replacement_pending', 'Current stats favor a different profile, but the HUD is waiting for consistent evidence before replacing the displayed label.', { source: 'presentation_hysteresis', pendingCandidate: displayed.pendingCandidate || rawArchetype, pendingUpdates: integer(displayed.pendingUpdates), pendingSinceHands: displayed.pendingSinceHands });
    if (reason === 'temporary_raw_uncertainty_held') pushReason(reasons, 'hysteresis_temporary_uncertainty', 'The previous profile is being held temporarily to avoid switching labels during a short-term ambiguous fluctuation.', { source: 'presentation_hysteresis' });
    if (reason === 'maximum_stale_disagreement_reached') pushReason(reasons, 'hysteresis_stale_label_released', 'The previous label was removed after sustained disagreement with the current evidence.', { source: 'presentation_hysteresis' });
    if (reason === 'sustained_raw_uncertainty') pushReason(reasons, 'hysteresis_sustained_uncertainty', 'The previous label was removed because raw uncertainty persisted long enough to stop holding it.', { source: 'presentation_hysteresis' });
    return policy;
  }

  function hysteresisExplanation(displayed) {
    var status = displayed.status || 'unavailable';
    var reason = displayed.reason || null;
    var messages = {
      pending_initial: 'The HUD is waiting for repeated confirmation before showing the first profile.',
      visible_holding_uncertain: 'The established profile is being held through temporary raw uncertainty.',
      visible_holding_ineligible_candidate: 'A different raw candidate exists, but it has not cleared the unchanged presentation gates.',
      visible_pending_replacement: 'A different raw profile is leading, but replacement confirmation is still pending.',
      hidden_insufficient: 'The minimum display sample has not been reached.',
      hidden_unsupported: 'The raw classifier contract is currently unsupported.',
      hidden_uncertain: 'No profile is shown because uncertainty persisted beyond the hold window.',
      hidden_early_or_weak: 'The raw candidate has not cleared the unchanged early-display gates.',
      visible_stable: 'The displayed profile is stable under the existing presentation policy.'
    };
    return {
      active: ['pending_initial', 'visible_holding_uncertain', 'visible_holding_ineligible_candidate', 'visible_pending_replacement'].includes(status),
      status: status,
      reason: reason,
      message: messages[status] || 'The existing presentation policy has not produced a stable visible profile yet.',
      pendingCandidate: displayed.pendingCandidate || null,
      pendingUpdates: integer(displayed.pendingUpdates),
      pendingSinceHands: displayed.pendingSinceHands === undefined ? null : displayed.pendingSinceHands,
      disagreementSinceHands: displayed.disagreementSinceHands === undefined ? null : displayed.disagreementSinceHands
    };
  }

  function tableSizeExplanation(input, record) {
    var context = input.decomposition && input.decomposition.tableContext || record.tableContext || {};
    var effective = Number.isFinite(Number(context.effectiveTableSize)) ? Number(context.effectiveTableSize) : null;
    var applied = context.applied === true;
    return {
      status: context.status || 'unsupported',
      applied: applied,
      effectiveTableSize: effective,
      shortHandedness: Number.isFinite(Number(context.shortHandedness)) ? Number(context.shortHandedness) : null,
      message: applied
        ? 'Preflop profile expectations are adjusted for the typical number of players dealt into this player\u2019s hands.'
        : context.supported === true
          ? 'Exact table-size context is supported; no short-handed curve shift is currently required.'
          : 'Exact table-size adjustment is unavailable for the current sample.',
      internalReason: context.unsupportedReason || null
    };
  }

  function summaryText(displayedArchetype, rawArchetype, bestCandidate, reasons, hysteresis) {
    if (displayedArchetype) {
      if (rawArchetype === displayedArchetype) return displayedArchetype + ' has the strongest supported fit and is stable under the current presentation policy.';
      if (hysteresis.active) return 'The HUD is showing ' + displayedArchetype + ' while current raw evidence leans ' + (bestCandidate || rawArchetype || 'another profile') + '. ' + hysteresis.message;
      return 'The displayed ' + displayedArchetype + ' label remains the current presentation result.';
    }
    if (reasons.length) return reasons[0].message;
    if (bestCandidate) return bestCandidate + ' currently fits best, but no stable profile is displayed yet.';
    return 'Current evidence is insufficient to display a stable profile.';
  }

  function fitCompetitionText(topCandidate, secondBest, reasons) {
    if (!topCandidate || !secondBest) return null;
    var close = reasons.some(function (reason) { return reason.code === 'classifier_fit_margin' || reason.code === 'presentation_fit_margin'; });
    if (!close) return null;
    var topTraits = archetypeTraits(topCandidate);
    var secondTraits = archetypeTraits(secondBest);
    var shared = topTraits.filter(function (trait) { return secondTraits.includes(trait); });
    var topOnly = topTraits.filter(function (trait) { return !secondTraits.includes(trait); });
    var secondOnly = secondTraits.filter(function (trait) { return !topTraits.includes(trait); });
    var comparison = shared.length ? 'Both leading fits reflect ' + shared.join(' and ') + ' play. ' : '';
    if (topOnly.length && secondOnly.length) comparison += 'The evidence is mixed between ' + topOnly.join(' / ') + ' and ' + secondOnly.join(' / ') + ' tendencies. ';
    return comparison + topCandidate + ' currently has the strongest fit, while ' + secondBest + ' is close behind.';
  }

  function explain(input) {
    input = input && typeof input === 'object' ? input : {};
    var record = input.record && typeof input.record === 'object' ? input.record : input.classification && typeof input.classification === 'object' ? input.classification : {};
    var primary = record.primary && typeof record.primary === 'object' ? record.primary : {};
    var displayed = input.presentation && typeof input.presentation === 'object' ? input.presentation : {};
    var displayedArchetype = displayed.visible === true && ARCHETYPES.includes(displayed.archetype) ? displayed.archetype : null;
    var rawArchetype = primary.archetype || displayed.rawArchetype || 'Unknown / Unsupported';
    var scores = scoreMap(primary);
    var bestCandidate = primary.bestCandidate || displayed.rawBestCandidate || null;
    var runnerUp = primary.runnerUp || null;
    var explainedArchetype = displayedArchetype || (ARCHETYPES.includes(bestCandidate) ? bestCandidate : null);
    var reasons = [];
    var gates = rawGateReasons(input, record, primary, reasons);
    var policy = presentationReasons(input, record, primary, displayed, reasons);
    var hysteresis = hysteresisExplanation(displayed);
    var tableSize = tableSizeExplanation(input, record);
    var evidence = explainedArchetype ? evidenceFor(input, record, explainedArchetype, runnerUp) : [];
    var supportingEvidence = evidence.filter(function (item) { return item.kind === 'supporting'; });
    var counterEvidence = evidence.filter(function (item) { return item.kind === 'mixed'; });
    var fitComparison = fitCompetitionText(bestCandidate, runnerUp, reasons);
    var definition = definitionFor(displayedArchetype || 'Unknown');
    var hands = integer(record.hands !== undefined ? record.hands : record.support && record.support.hands !== undefined ? record.support.hands : displayed.rawHands);
    return {
      schemaVersion: SCHEMA_VERSION,
      rawArchetype: rawArchetype,
      displayedArchetype: displayedArchetype,
      explainedArchetype: explainedArchetype,
      title: displayedArchetype ? displayedArchetype + (definition.fullName !== displayedArchetype ? ' \u2014 ' + definition.fullName : '') : 'No profile shown yet',
      description: definition.description,
      summary: summaryText(displayedArchetype, rawArchetype, bestCandidate, reasons, hysteresis),
      winningArchetype: bestCandidate,
      winningFit: bestCandidate ? scores[bestCandidate] : null,
      runnerUpArchetype: runnerUp,
      runnerUpFit: runnerUp ? scores[runnerUp] : null,
      topCandidateArchetype: bestCandidate,
      topCandidateFit: bestCandidate ? scores[bestCandidate] : null,
      secondBestArchetype: runnerUp,
      secondBestFit: runnerUp ? scores[runnerUp] : null,
      fitMargin: Number.isFinite(Number(primary.scoreMargin)) ? Number(primary.scoreMargin) : null,
      confidence: Number.isFinite(Number(primary.confidence)) ? Number(primary.confidence) : null,
      hands: hands,
      fitScores: ARCHETYPES.map(function (name) { return { archetype: name, score: scores[name], percent: percent(scores[name]) }; }),
      fitExplanation: FIT_NOTE,
      confidenceExplanation: CONFIDENCE_NOTE,
      evidence: evidence,
      supportingEvidence: supportingEvidence,
      counterEvidence: counterEvidence,
      fitCompetition: fitComparison,
      gatingReasons: reasons,
      hysteresis: hysteresis,
      presentationState: { visible: displayed.visible === true, status: displayed.status || null, reason: displayed.reason || null },
      tableSize: tableSize,
      guide: guide(input),
      advanced: {
        rawClassification: rawArchetype,
        displayedProfile: displayedArchetype,
        winningArchetype: bestCandidate,
        runnerUpArchetype: runnerUp,
        topCandidateArchetype: bestCandidate,
        secondBestArchetype: runnerUp,
        fitMargin: Number.isFinite(Number(primary.scoreMargin)) ? Number(primary.scoreMargin) : null,
        confidence: Number.isFinite(Number(primary.confidence)) ? Number(primary.confidence) : null,
        effectiveTableSize: tableSize.effectiveTableSize,
        tableContextStatus: tableSize.status,
        tableSizeAdjustmentApplied: tableSize.applied,
        presentationStatus: displayed.status || null,
        presentationReason: displayed.reason || null,
        pendingCandidate: displayed.pendingCandidate || null,
        pendingUpdates: integer(displayed.pendingUpdates),
        pendingSinceHands: displayed.pendingSinceHands === undefined ? null : displayed.pendingSinceHands,
        classifierGates: clone(gates),
        presentationPolicySource: policy === presentationPolicy(input) ? 'active_presentation_policy' : 'presentation_policy'
      }
    };
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    ARCHETYPES: ARCHETYPES,
    GUIDE_ORDER: GUIDE_ORDER,
    DEFINITIONS: DEFINITIONS,
    FEATURE_LABELS: FEATURE_LABELS,
    FIT_NOTE: FIT_NOTE,
    CONFIDENCE_NOTE: CONFIDENCE_NOTE,
    guide: guide,
    explain: explain,
    formatPercent: formatPercent
  });
});
