/* Pure, isolated, interpretable player-profile classifier. */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 4;
  var MODE = 'isolated';

  var DEFAULT_CONFIG = deepFreeze({
    minimumPrimaryHands: 20,
    minimumPrimaryScore: 0.42,
    minimumScoreMargin: 0.08,
    tableContext: {
      referenceSize: 9,
      minimumSupportedSize: 3,
      maximumShiftAtMinimumSize: {
        vpipRate: 0.10,
        pfrRate: 0.10,
        vpipPfrGap: 0.01,
        threeBetRate: 0.03
      }
    },
    priors: {
      vpipRate: { mean: 0.28, strength: 24, minimumOpportunities: 20, minimumConfidence: 0.40 },
      pfrRate: { mean: 0.20, strength: 24, minimumOpportunities: 20, minimumConfidence: 0.40 },
      threeBetRate: { mean: 0.08, strength: 30, minimumOpportunities: 12, minimumConfidence: 0.30 },
      foldToThreeBetRate: { mean: 0.50, strength: 20, minimumOpportunities: 12, minimumConfidence: 0.35 },
      flopCBetRate: { mean: 0.55, strength: 20, minimumOpportunities: 12, minimumConfidence: 0.35 },
      foldToFlopCBetRate: { mean: 0.45, strength: 20, minimumOpportunities: 12, minimumConfidence: 0.35 },
      wtsdRate: { mean: 0.28, strength: 24, minimumOpportunities: 15, minimumConfidence: 0.35 },
      wsdRate: { mean: 0.50, strength: 20, minimumOpportunities: 12, minimumConfidence: 0.35 },
      aggressionFrequency: { mean: 0.60, strength: 12, minimumOpportunities: 12, minimumConfidence: 0.40 }
    },
    tagRules: [
      { tag: '3B Heavy', feature: 'threeBetRate', direction: 'high', threshold: 0.12 },
      { tag: '3B Light', feature: 'threeBetRate', direction: 'low', threshold: 0.055 },
      { tag: 'Folds to 3B', feature: 'foldToThreeBetRate', direction: 'high', threshold: 0.62 },
      { tag: 'Sticky vs 3B', feature: 'foldToThreeBetRate', direction: 'low', threshold: 0.38 },
      { tag: 'High CBet', feature: 'flopCBetRate', direction: 'high', threshold: 0.65 },
      { tag: 'Low CBet', feature: 'flopCBetRate', direction: 'low', threshold: 0.42 },
      { tag: 'Sticky vs CBet', feature: 'foldToFlopCBetRate', direction: 'low', threshold: 0.34 },
      { tag: 'Fit-or-Fold', feature: 'foldToFlopCBetRate', direction: 'high', threshold: 0.58 },
      { tag: 'Showdown Heavy', feature: 'wtsdRate', direction: 'high', threshold: 0.34 },
      { tag: 'Showdown Selective', feature: 'wtsdRate', direction: 'low', threshold: 0.22 },
      { tag: 'High W$SD', feature: 'wsdRate', direction: 'high', threshold: 0.58 },
      { tag: 'Low W$SD', feature: 'wsdRate', direction: 'low', threshold: 0.42 }
    ],
    archetypeRequirements: {
      Nit: {
        allPositiveMembership: ['vpipRate'],
        definingReason: 'nit_requires_tight_vpip_compatibility'
      },
      TAG: {
        allPositiveMembership: ['vpipRate'],
        definingReason: 'tag_requires_tight_to_moderate_vpip_compatibility',
        // TAG is a conjunction of tightness and aggression.  Positive VPIP
        // compatibility remains the semantic eligibility rule, while this
        // continuous ramp prevents other matching features from fully
        // compensating for only marginal tightness evidence.
        scoreCompatibilityRamp: {
          feature: 'vpipRate',
          minimumScale: 0.60,
          exponent: 2
        }
      },
      LAG: {
        allPositiveMembership: ['vpipRate'],
        definingReason: 'lag_requires_loose_vpip_compatibility'
      },
      'Tight Passive': {
        allPositiveMembership: ['vpipRate'],
        definingReason: 'tight_passive_requires_tight_to_moderate_vpip_compatibility'
      },
      'Loose Passive': {
        allPositiveMembership: ['vpipRate'],
        definingReason: 'loose_passive_requires_loose_vpip_compatibility'
      },
      'Calling Station': {
        allPositiveMembership: ['vpipRate'],
        definingReason: 'calling_station_requires_loose_vpip_compatibility',
        anyPositiveMembership: ['foldToFlopCBetRate', 'wtsdRate'],
        reason: 'calling_station_requires_supported_stickiness_evidence'
      },
      Maniac: {
        allPositiveMembership: ['vpipRate'],
        definingReason: 'maniac_requires_very_loose_vpip_compatibility'
      }
    },
    archetypes: {
      Nit: [
        factor('vpipRate', 0.05, 0.14, 0.24, 4),
        factor('pfrRate', 0.02, 0.10, 0.20, 3),
        factor('vpipPfrGap', 0.00, 0.04, 0.13, 1.2),
        factor('pfrVpipRatio', 0.35, 0.68, 0.95, 1),
        factor('aggressionFrequency', 0.30, 0.52, 0.75, 0.8)
      ],
      TAG: [
        factor('vpipRate', 0.16, 0.24, 0.34, 4),
        factor('pfrRate', 0.12, 0.20, 0.30, 3),
        factor('vpipPfrGap', 0.00, 0.05, 0.14, 1.5),
        factor('pfrVpipRatio', 0.52, 0.82, 1.00, 2),
        factor('aggressionFrequency', 0.48, 0.65, 0.84, 1.5),
        factor('threeBetRate', 0.03, 0.08, 0.16, 0.6)
      ],
      LAG: [
        factor('vpipRate', 0.27, 0.39, 0.58, 4),
        factor('pfrRate', 0.22, 0.32, 0.49, 3),
        factor('vpipPfrGap', 0.02, 0.08, 0.19, 1),
        factor('pfrVpipRatio', 0.58, 0.83, 1.00, 2),
        factor('aggressionFrequency', 0.52, 0.70, 0.90, 1.5),
        factor('threeBetRate', 0.06, 0.14, 0.27, 1)
      ],
      'Tight Passive': [
        factor('vpipRate', 0.11, 0.22, 0.32, 4),
        factor('pfrRate', 0.00, 0.08, 0.17, 3),
        factor('vpipPfrGap', 0.06, 0.14, 0.26, 2),
        factor('pfrVpipRatio', 0.05, 0.36, 0.67, 1.5),
        factor('aggressionFrequency', 0.12, 0.36, 0.57, 2)
      ],
      'Loose Passive': [
        factor('vpipRate', 0.33, 0.49, 0.72, 4),
        factor('pfrRate', 0.04, 0.16, 0.30, 2.5),
        factor('vpipPfrGap', 0.15, 0.31, 0.50, 2.5),
        factor('pfrVpipRatio', 0.08, 0.33, 0.59, 1.5),
        factor('aggressionFrequency', 0.10, 0.34, 0.56, 2)
      ],
      'Calling Station': [
        factor('vpipRate', 0.38, 0.57, 0.82, 3),
        factor('pfrRate', 0.02, 0.13, 0.27, 1.5),
        factor('vpipPfrGap', 0.22, 0.39, 0.64, 1.25),
        factor('pfrVpipRatio', 0.04, 0.24, 0.50, 0.75),
        factor('aggressionFrequency', 0.04, 0.25, 0.48, 2.5),
        factor('foldToThreeBetRate', 0.05, 0.22, 0.42, 1),
        factor('foldToFlopCBetRate', 0.04, 0.22, 0.40, 3),
        factor('wtsdRate', 0.29, 0.43, 0.61, 3)
      ],
      Maniac: [
        factor('vpipRate', 0.54, 0.78, 1.00, 4),
        factor('pfrRate', 0.43, 0.67, 0.96, 3.5),
        factor('vpipPfrGap', 0.00, 0.10, 0.28, 1),
        factor('pfrVpipRatio', 0.60, 0.86, 1.00, 1.5),
        factor('aggressionFrequency', 0.64, 0.83, 0.98, 2),
        factor('threeBetRate', 0.14, 0.29, 0.52, 1.5)
      ]
    }
  });

  function factor(feature, low, target, high, weight) {
    return { feature: feature, low: low, target: target, high: high, weight: weight };
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function round(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function nonnegativeInteger(value) {
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
  }

  function mergeConfig(overrides) {
    var config = clone(DEFAULT_CONFIG);
    var source = overrides && typeof overrides === 'object' ? overrides : {};
    ['minimumPrimaryHands', 'minimumPrimaryScore', 'minimumScoreMargin'].forEach(function (key) {
      if (Number.isFinite(Number(source[key]))) config[key] = Number(source[key]);
    });
    if (source.priors && typeof source.priors === 'object') {
      Object.keys(source.priors).forEach(function (key) {
        if (!config.priors[key]) return;
        config.priors[key] = Object.assign({}, config.priors[key], source.priors[key]);
      });
    }
    Object.keys(config.priors).forEach(function (key) {
      var prior = config.priors[key];
      var fallback = DEFAULT_CONFIG.priors[key];
      prior.mean = Number.isFinite(Number(prior.mean)) ? clamp(Number(prior.mean), 0, 1) : fallback.mean;
      prior.strength = Number.isFinite(Number(prior.strength)) && Number(prior.strength) > 0 ? Number(prior.strength) : fallback.strength;
      prior.minimumOpportunities = nonnegativeInteger(prior.minimumOpportunities);
      if (prior.minimumOpportunities === null) prior.minimumOpportunities = fallback.minimumOpportunities;
      prior.minimumConfidence = Number.isFinite(Number(prior.minimumConfidence))
        ? clamp(Number(prior.minimumConfidence), 0, 1)
        : fallback.minimumConfidence;
    });
    if (Array.isArray(source.tagRules)) config.tagRules = clone(source.tagRules);
    if (source.archetypes && typeof source.archetypes === 'object') config.archetypes = clone(source.archetypes);
    if (source.archetypeRequirements && typeof source.archetypeRequirements === 'object') config.archetypeRequirements = clone(source.archetypeRequirements);
    if (source.tableContext && typeof source.tableContext === 'object') {
      config.tableContext = Object.assign({}, config.tableContext, clone(source.tableContext));
      config.tableContext.maximumShiftAtMinimumSize = Object.assign(
        {}, DEFAULT_CONFIG.tableContext.maximumShiftAtMinimumSize,
        source.tableContext.maximumShiftAtMinimumSize && clone(source.tableContext.maximumShiftAtMinimumSize)
      );
    }
    return config;
  }

  function tableContext(stats, config) {
    var sum = nonnegativeInteger(stats && stats.preflopTableSizeSum);
    var opportunities = nonnegativeInteger(stats && stats.preflopTableSizeOpportunities);
    var required = nonnegativeInteger(stats && stats.vpipOpportunities);
    var effective = sum !== null && opportunities > 0 ? sum / opportunities : null;
    var complete = sum !== null && opportunities !== null && required !== null && required > 0 &&
      opportunities === required && Number.isFinite(effective) && effective >= 2;
    var headsUp = complete && effective < config.tableContext.minimumSupportedSize;
    var denominator = Math.max(1, config.tableContext.referenceSize - config.tableContext.minimumSupportedSize);
    var shortHandedness = complete
      ? clamp((config.tableContext.referenceSize - effective) / denominator, 0, 1)
      : 0;
    return {
      supported: complete && !headsUp,
      applied: complete && !headsUp && shortHandedness > 0,
      status: !complete ? 'unsupported' : headsUp ? 'heads_up_unsupported' : 'supported',
      effectiveTableSize: complete ? round(effective) : null,
      tableSizeSum: sum,
      opportunities: opportunities,
      requiredOpportunities: required,
      referenceSize: config.tableContext.referenceSize,
      minimumSupportedSize: config.tableContext.minimumSupportedSize,
      shortHandedness: round(shortHandedness),
      unsupportedReason: !complete
        ? (required === 0 ? 'zero_preflop_opportunities' : 'incomplete_or_missing_exact_table_context')
        : headsUp ? 'heads_up_archetype_vocabulary_not_calibrated' : null
    };
  }

  function adjustedDefinitions(definitions, context, config) {
    var shifts = config.tableContext.maximumShiftAtMinimumSize;
    return definitions.map(function (definition) {
      var maximumShift = Number(shifts[definition.feature] || 0);
      var shift = context.supported ? maximumShift * context.shortHandedness : 0;
      return Object.assign({}, definition, {
        low: clamp(definition.low + shift, 0, 1),
        target: clamp(definition.target + shift, 0, 1),
        high: clamp(definition.high + shift, 0, 1),
        tableSizeShift: round(shift),
        referenceCurve: { low: definition.low, target: definition.target, high: definition.high }
      });
    });
  }

  function rateFeature(name, numeratorValue, denominatorValue, prior) {
    var numerator = nonnegativeInteger(numeratorValue);
    var denominator = nonnegativeInteger(denominatorValue);
    var valid = numerator !== null && denominator !== null && numerator <= denominator;
    var opportunities = valid ? denominator : 0;
    var rawRate = valid && denominator > 0 ? numerator / denominator : null;
    var stabilizedRate = valid
      ? (numerator + prior.mean * prior.strength) / (denominator + prior.strength)
      : prior.mean;
    var confidence = valid ? denominator / (denominator + prior.strength) : 0;
    var supported = valid && denominator >= prior.minimumOpportunities && confidence >= prior.minimumConfidence;
    return {
      feature: name,
      numerator: valid ? numerator : null,
      denominator: valid ? denominator : null,
      opportunities: opportunities,
      rawRate: round(rawRate),
      stabilizedRate: round(stabilizedRate),
      confidence: round(confidence),
      supported: supported,
      unsupportedReason: !valid
        ? 'invalid_counts'
        : denominator === 0
          ? 'zero_denominator'
          : denominator < prior.minimumOpportunities
            ? 'insufficient_opportunities'
            : confidence < prior.minimumConfidence ? 'insufficient_confidence' : null,
      prior: { mean: prior.mean, strength: prior.strength },
      minimumOpportunities: prior.minimumOpportunities,
      minimumConfidence: prior.minimumConfidence
    };
  }

  function derivedFeature(name, rawRate, stabilizedRate, sources, supported, reason) {
    var confidence = sources.reduce(function (minimum, feature) {
      return Math.min(minimum, Number(feature.confidence || 0));
    }, 1);
    return {
      feature: name,
      numerator: null,
      denominator: null,
      opportunities: Math.min.apply(Math, sources.map(function (feature) { return feature.opportunities; })),
      rawRate: round(rawRate),
      stabilizedRate: round(stabilizedRate),
      confidence: round(confidence),
      supported: Boolean(supported),
      unsupportedReason: supported ? null : reason,
      sourceFeatures: sources.map(function (feature) { return feature.feature; })
    };
  }

  function aggressionFeatures(stats, prior) {
    var bets = nonnegativeInteger(stats && stats.afDetails && stats.afDetails.bets);
    var raises = nonnegativeInteger(stats && stats.afDetails && stats.afDetails.raises);
    var calls = nonnegativeInteger(stats && stats.afDetails && stats.afDetails.calls);
    var valid = bets !== null && raises !== null && calls !== null;
    var aggressive = valid ? bets + raises : null;
    var decisions = valid ? aggressive + calls : 0;
    var frequency = rateFeature('aggressionFrequency', aggressive, decisions, prior);
    var rawInfinity = valid && aggressive > 0 && calls === 0;
    var rawAf = valid && calls > 0 ? aggressive / calls : valid && aggressive === 0 ? 0 : null;
    var stabilizedShare = frequency.stabilizedRate;
    var stabilizedAf = stabilizedShare < 1 ? stabilizedShare / (1 - stabilizedShare) : null;
    var af = {
      feature: 'aggressionFactor',
      numerator: aggressive,
      denominator: calls,
      opportunities: decisions,
      rawRate: round(rawAf),
      rawValue: rawInfinity ? 'infinity' : round(rawAf),
      isInfinite: rawInfinity,
      stabilizedRate: round(stabilizedAf),
      confidence: frequency.confidence,
      supported: frequency.supported,
      unsupportedReason: frequency.unsupportedReason,
      sourceFeatures: ['afDetails.bets', 'afDetails.raises', 'afDetails.calls']
    };
    return { frequency: frequency, af: af };
  }

  function buildFeatures(stats, config) {
    var features = {};
    features.vpipRate = rateFeature('vpipRate', stats.vpipHands, stats.vpipOpportunities, config.priors.vpipRate);
    features.pfrRate = rateFeature('pfrRate', stats.pfrHands, stats.pfrOpportunities, config.priors.pfrRate);
    features.threeBetRate = rateFeature('threeBetRate', stats.threeBetMade, stats.threeBetOpportunities, config.priors.threeBetRate);
    features.foldToThreeBetRate = rateFeature('foldToThreeBetRate', stats.foldToThreeBet, stats.foldToThreeBetOpportunities, config.priors.foldToThreeBetRate);
    features.flopCBetRate = rateFeature('flopCBetRate', stats.flopCBetMade, stats.flopCBetOpportunities, config.priors.flopCBetRate);
    features.foldToFlopCBetRate = rateFeature('foldToFlopCBetRate', stats.foldToFlopCBet, stats.foldToFlopCBetOpportunities, config.priors.foldToFlopCBetRate);
    features.wtsdRate = rateFeature('wtsdRate', stats.wentToShowdown, stats.sawFlopForWTSD, config.priors.wtsdRate);
    features.wsdRate = rateFeature('wsdRate', stats.wonMoneyAtShowdown, stats.showdownsForWSD, config.priors.wsdRate);

    var vpip = features.vpipRate;
    var pfr = features.pfrRate;
    var pairConsistent = vpip.rawRate === null || pfr.rawRate === null || pfr.rawRate <= vpip.rawRate;
    var pairSupported = vpip.supported && pfr.supported && pairConsistent;
    var pairReason = pairConsistent ? 'vpip_or_pfr_unsupported' : 'pfr_exceeds_vpip';
    features.vpipPfrGap = derivedFeature(
      'vpipPfrGap',
      vpip.rawRate === null || pfr.rawRate === null ? null : vpip.rawRate - pfr.rawRate,
      vpip.stabilizedRate - pfr.stabilizedRate,
      [vpip, pfr], pairSupported, pairReason
    );
    features.pfrVpipRatio = derivedFeature(
      'pfrVpipRatio',
      vpip.rawRate > 0 && pfr.rawRate !== null ? pfr.rawRate / vpip.rawRate : null,
      vpip.stabilizedRate > 0 ? pfr.stabilizedRate / vpip.stabilizedRate : null,
      [vpip, pfr], pairSupported, pairReason
    );
    var aggression = aggressionFeatures(stats, config.priors.aggressionFrequency);
    features.aggressionFrequency = aggression.frequency;
    features.aggressionFactor = aggression.af;
    return features;
  }

  function membership(value, definition) {
    if (!Number.isFinite(value) || value <= definition.low || value >= definition.high) return 0;
    if (value === definition.target) return 1;
    return value < definition.target
      ? (value - definition.low) / (definition.target - definition.low)
      : (definition.high - value) / (definition.high - definition.target);
  }

  function semanticEligibility(requirement, definitions, features) {
    requirement = requirement && typeof requirement === 'object' ? requirement : {};
    var requiredFeatures = Array.isArray(requirement.allPositiveMembership) ? requirement.allPositiveMembership : [];
    var compatibleRequiredFeatures = [];
    var unsupportedRequiredFeatures = [];
    var contradictoryFeatures = [];
    requiredFeatures.forEach(function (featureName) {
      var feature = features[featureName];
      var definition = definitions.find(function (candidate) { return candidate.feature === featureName; });
      if (!feature || !feature.supported || !definition) {
        unsupportedRequiredFeatures.push(featureName);
        return;
      }
      if (membership(feature.stabilizedRate, definition) > 0) compatibleRequiredFeatures.push(featureName);
      else contradictoryFeatures.push(featureName);
    });

    var optionalFeatures = Array.isArray(requirement.anyPositiveMembership) ? requirement.anyPositiveMembership : [];
    var supportedFeatures = [];
    var positiveFeatures = [];
    optionalFeatures.forEach(function (featureName) {
      var feature = features[featureName];
      var definition = definitions.find(function (candidate) { return candidate.feature === featureName; });
      if (!feature || !feature.supported || !definition) return;
      supportedFeatures.push(featureName);
      if (membership(feature.stabilizedRate, definition) > 0) positiveFeatures.push(featureName);
    });
    var definingEligible = contradictoryFeatures.length === 0;
    var optionalEligible = !optionalFeatures.length || positiveFeatures.length > 0;
    return {
      eligible: definingEligible && optionalEligible,
      reason: !definingEligible
        ? String(requirement.definingReason || 'defining_feature_compatibility_required')
        : optionalEligible ? null : String(requirement.reason || 'required_semantic_evidence_unavailable'),
      supportedFeatures: supportedFeatures,
      positiveFeatures: positiveFeatures,
      requiredFeatures: requiredFeatures.slice(),
      compatibleRequiredFeatures: compatibleRequiredFeatures,
      unsupportedRequiredFeatures: unsupportedRequiredFeatures,
      contradictoryFeatures: contradictoryFeatures
    };
  }

  function scoreCompatibilityRamp(requirement, definitions, features) {
    var ramp = requirement && requirement.scoreCompatibilityRamp;
    if (!ramp || typeof ramp !== 'object') return { applied: false, scale: 1 };
    var featureName = typeof ramp.feature === 'string' ? ramp.feature : null;
    var feature = featureName && features[featureName];
    var definition = featureName && definitions.find(function (candidate) { return candidate.feature === featureName; });
    if (!feature || !feature.supported || !definition) {
      return { applied: false, scale: 1, feature: featureName, reason: 'compatibility_feature_unsupported' };
    }
    var minimumScale = Number(ramp.minimumScale);
    var exponent = Number(ramp.exponent);
    minimumScale = Number.isFinite(minimumScale) ? clamp(minimumScale, 0, 1) : 0;
    exponent = Number.isFinite(exponent) && exponent > 0 ? exponent : 1;
    var featureMembership = membership(feature.stabilizedRate, definition);
    var scale = minimumScale + (1 - minimumScale) * Math.pow(featureMembership, exponent);
    return {
      applied: true,
      feature: featureName,
      membership: round(featureMembership),
      minimumScale: round(minimumScale),
      exponent: exponent,
      scale: round(scale)
    };
  }

  function scoreArchetype(name, definitions, features, requirement) {
    var totalConfiguredWeight = definitions.reduce(function (sum, definition) { return sum + definition.weight; }, 0);
    var effectiveWeight = 0;
    var weightedScore = 0;
    var evidence = [];
    definitions.forEach(function (definition) {
      var feature = features[definition.feature];
      if (!feature || !feature.supported) return;
      var confidenceWeight = definition.weight * feature.confidence;
      var featureMembership = membership(feature.stabilizedRate, definition);
      var contribution = confidenceWeight * featureMembership;
      effectiveWeight += confidenceWeight;
      weightedScore += contribution;
      evidence.push({
        feature: definition.feature,
        stabilizedRate: feature.stabilizedRate,
        confidence: feature.confidence,
        weight: definition.weight,
        membership: round(featureMembership),
        effectiveWeight: round(confidenceWeight),
        weightedContribution: round(contribution),
        membershipCurve: { low: definition.low, target: definition.target, high: definition.high },
        referenceCurve: clone(definition.referenceCurve || { low: definition.low, target: definition.target, high: definition.high }),
        tableSizeShift: Number(definition.tableSizeShift || 0)
      });
    });
    var eligibility = semanticEligibility(requirement, definitions, features);
    var compatibility = scoreCompatibilityRamp(requirement, definitions, features);
    var rawScore = effectiveWeight ? weightedScore / effectiveWeight : 0;
    var unadjustedScore = round(rawScore);
    return {
      archetype: name,
      score: eligibility.eligible ? round(rawScore * compatibility.scale) : 0,
      unadjustedScore: unadjustedScore,
      weightedScore: round(weightedScore),
      normalizationDenominator: round(effectiveWeight),
      semanticEligibility: eligibility,
      scoreCompatibility: compatibility,
      evidenceCoverage: round(definitions.reduce(function (sum, definition) {
        return sum + (features[definition.feature] && features[definition.feature].supported ? definition.weight : 0);
      }, 0) / totalConfiguredWeight),
      evidence: evidence
    };
  }

  function scoreDecomposition(playerStats, options) {
    var stats = playerStats && typeof playerStats === 'object' ? playerStats : {};
    var config = mergeConfig(options && options.config);
    var features = buildFeatures(stats, config);
    var context = tableContext(stats, config);
    var scored = Object.keys(config.archetypes).map(function (name) {
      return scoreArchetype(name, adjustedDefinitions(config.archetypes[name], context, config), features, config.archetypeRequirements[name]);
    }).sort(function (left, right) {
      return right.score - left.score || right.unadjustedScore - left.unadjustedScore || left.archetype.localeCompare(right.archetype);
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      tableContext: context,
      gates: {
        minimumPrimaryHands: config.minimumPrimaryHands,
        minimumPrimaryScore: config.minimumPrimaryScore,
        minimumScoreMargin: config.minimumScoreMargin
      },
      featureDiagnostics: Object.keys(features).reduce(function (result, name) {
        var feature = features[name];
        var rawAvailable = Number.isFinite(feature.rawRate) || feature.rawValue === 'infinity';
        result[name] = {
          numerator: feature.numerator === undefined ? null : feature.numerator,
          denominator: feature.denominator === undefined ? null : feature.denominator,
          rawRate: feature.rawRate === undefined ? null : feature.rawRate,
          rawValue: feature.rawValue === undefined ? null : feature.rawValue,
          stabilizedRate: feature.stabilizedRate === undefined ? null : feature.stabilizedRate,
          confidence: feature.confidence,
          opportunities: feature.opportunities,
          dataAvailable: feature.opportunities > 0 && rawAvailable,
          scoringSupported: feature.supported === true,
          scoringUnsupportedReason: feature.unsupportedReason || null,
          minimumOpportunities: feature.minimumOpportunities === undefined ? null : feature.minimumOpportunities,
          minimumConfidence: feature.minimumConfidence === undefined ? null : feature.minimumConfidence,
          sourceFeatures: clone(feature.sourceFeatures || [])
        };
        return result;
      }, {}),
      supportedFeatures: Object.keys(features).filter(function (name) { return features[name].supported; }).reduce(function (result, name) {
        result[name] = {
          stabilizedRate: features[name].stabilizedRate,
          confidence: features[name].confidence,
          opportunities: features[name].opportunities
        };
        return result;
      }, {}),
      ranking: scored.map(function (entry) { return entry.archetype; }),
      archetypes: scored.reduce(function (result, entry) {
        result[entry.archetype] = {
          finalScore: entry.score,
          unadjustedScore: entry.unadjustedScore,
          weightedScore: entry.weightedScore,
          normalizationDenominator: entry.normalizationDenominator,
          semanticEligibility: clone(entry.semanticEligibility),
          scoreCompatibility: clone(entry.scoreCompatibility),
          evidenceCoverage: entry.evidenceCoverage,
          evidence: clone(entry.evidence)
        };
        return result;
      }, {})
    };
  }

  function primaryClassification(stats, features, config, context) {
    var hands = nonnegativeInteger(stats.handsPlayed) || 0;
    var scored = Object.keys(config.archetypes).map(function (name) {
      return scoreArchetype(name, adjustedDefinitions(config.archetypes[name], context, config), features, config.archetypeRequirements[name]);
    }).sort(function (left, right) {
      return right.score - left.score || right.unadjustedScore - left.unadjustedScore || left.archetype.localeCompare(right.archetype);
    });
    var best = scored[0];
    var runnerUp = scored[1];
    var margin = best.score - runnerUp.score;
    var coreConfidence = (features.vpipRate.confidence + features.pfrRate.confidence) / 2;
    var confidence = clamp(0.45 * best.score + 0.35 * coreConfidence + 0.20 * Math.min(1, margin / 0.25), 0, 1);
    var unsupportedContext = context.status === 'heads_up_unsupported';
    var insufficient = hands < config.minimumPrimaryHands || !features.vpipRate.supported || !features.pfrRate.supported ||
      !features.vpipPfrGap.supported || !features.pfrVpipRatio.supported;
    var ambiguous = !insufficient && (best.score < config.minimumPrimaryScore || margin < config.minimumScoreMargin);
    return {
      archetype: unsupportedContext ? 'Unknown / Unsupported' : insufficient ? 'Unknown / Insufficient Sample' : ambiguous ? 'Unknown / Uncertain' : best.archetype,
      classificationStatus: unsupportedContext ? 'unsupported' : insufficient ? 'insufficient_sample' : ambiguous ? 'ambiguous' : 'supported',
      bestCandidate: best.archetype,
      runnerUp: runnerUp.archetype,
      confidence: round(unsupportedContext ? 0 : insufficient ? Math.min(confidence, 0.39) : ambiguous ? Math.min(confidence, 0.59) : confidence),
      scoreMargin: round(margin),
      scores: scored.reduce(function (result, entry) {
        result[entry.archetype] = entry.score;
        return result;
      }, {}),
      scoreDiagnostics: scored.reduce(function (result, entry) {
        result[entry.archetype] = {
          unadjustedScore: entry.unadjustedScore,
          semanticEligibility: entry.semanticEligibility,
          scoreCompatibility: entry.scoreCompatibility,
          evidenceCoverage: entry.evidenceCoverage
        };
        return result;
      }, {}),
      evidence: best.evidence,
      supportedEvidence: best.evidence.map(function (entry) { return entry.feature; }),
      unsupportedEvidence: Object.keys(features).filter(function (name) { return !features[name].supported; }).map(function (name) {
        return { feature: name, reason: features[name].unsupportedReason };
      }),
      unsupportedReason: unsupportedContext ? context.unsupportedReason : insufficient ? 'primary_sample_or_core_features_insufficient' : ambiguous ? 'competing_or_weak_archetype_scores' : null
    };
  }

  function secondaryTags(features, config) {
    return config.tagRules.reduce(function (tags, rule) {
      var feature = features[rule.feature];
      if (!feature || !feature.supported) return tags;
      var matches = rule.direction === 'high'
        ? feature.stabilizedRate >= rule.threshold
        : feature.stabilizedRate <= rule.threshold;
      if (!matches) return tags;
      tags.push({
        tag: rule.tag,
        feature: rule.feature,
        rawRate: feature.rawRate,
        stabilizedRate: feature.stabilizedRate,
        opportunities: feature.opportunities,
        confidence: feature.confidence,
        threshold: rule.threshold,
        direction: rule.direction
      });
      return tags;
    }, []);
  }

  function classify(playerStats, options) {
    var stats = playerStats && typeof playerStats === 'object' ? playerStats : {};
    var config = mergeConfig(options && options.config);
    var features = buildFeatures(stats, config);
    var context = tableContext(stats, config);
    var featureNames = Object.keys(features);
    var supportedFeatures = featureNames.filter(function (name) { return features[name].supported; });
    var unsupportedFeatures = featureNames.filter(function (name) { return !features[name].supported; }).map(function (name) {
      return { feature: name, reason: features[name].unsupportedReason, opportunities: features[name].opportunities };
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      playerId: stats.playerId === undefined || stats.playerId === null ? null : String(stats.playerId),
      player: stats.player === undefined || stats.player === null ? null : String(stats.player),
      primary: primaryClassification(stats, features, config, context),
      tags: secondaryTags(features, config),
      features: features,
      tableContext: context,
      support: {
        hands: nonnegativeInteger(stats.handsPlayed) || 0,
        supportedFeatures: supportedFeatures,
        unsupportedFeatures: unsupportedFeatures
      },
      provenance: {
        source: 'authoritative-player-statistics',
        classifierSchemaVersion: SCHEMA_VERSION,
        deterministic: true,
        priors: clone(config.priors),
        tableContextMethod: 'primary-membership-curve-shift-v1',
        tableContextMaximumShifts: clone(config.tableContext.maximumShiftAtMinimumSize)
      }
    };
  }

  var api = Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    MODE: MODE,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    classify: classify,
    scoreDecomposition: scoreDecomposition,
    buildFeatures: function (playerStats, options) {
      return buildFeatures(playerStats || {}, mergeConfig(options && options.config));
    },
    createConfig: mergeConfig
  });

  root.PokerPlayerProfileClassifier = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
