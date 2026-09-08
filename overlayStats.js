/*
 * Registry and preference normalization for statistics that may be shown in
 * compact seat overlays. PokerStats remains the sole calculation owner.
 */
(function (root) {
  'use strict';

  var PREFERENCE_VERSION = 3;
  var LEGACY_PREFERENCE_VERSIONS = Object.freeze([2]);
  var SHOWDOWN_STAT_IDS = Object.freeze(['wtsd', 'wsd']);
  var UNAVAILABLE_PLACEHOLDER = '---';
  var FIXED_VISIBLE_STAT_IDS = Object.freeze([]);
  var DEFAULT_DISPLAYED_STAT_IDS = Object.freeze(['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);

  function percentage(value) {
    return Math.round(Number(value || 0)) + '%';
  }

  function aggressionFactor(value) {
    return value === Infinity ? '\u221e' : Number(value || 0).toFixed(1);
  }

  function hasObservedHands(playerStats) {
    return Number(playerStats && playerStats.handsPlayed || 0) > 0;
  }

  function observedPercentage(value, playerStats) {
    return hasObservedHands(playerStats) ? percentage(value) : UNAVAILABLE_PLACEHOLDER;
  }

  function observedLeaderboardPercentage(value, playerStats) {
    return hasObservedHands(playerStats) ? Number(value || 0).toFixed(1) + '%' : UNAVAILABLE_PLACEHOLDER;
  }

  function observedAggressionFactor(value, playerStats) {
    return hasObservedHands(playerStats) ? aggressionFactor(value) : UNAVAILABLE_PLACEHOLDER;
  }

  function opportunityValue(playerStats, numeratorField, denominatorField) {
    return {
      numerator: Number(playerStats && playerStats[numeratorField] || 0),
      denominator: Number(playerStats && playerStats[denominatorField] || 0)
    };
  }

  function opportunityDisplay(value) {
    var numerator = Number(value && value.numerator || 0);
    var denominator = Number(value && value.denominator || 0);
    if (!denominator) return UNAVAILABLE_PLACEHOLDER + ' (' + numerator + '/' + denominator + ')';
    return Math.round((numerator / denominator) * 100) + '% (' + numerator + '/' + denominator + ')';
  }

  function opportunityPercentage(value) {
    var numerator = Number(value && value.numerator || 0);
    var denominator = Number(value && value.denominator || 0);
    if (!denominator) return UNAVAILABLE_PLACEHOLDER;
    return Math.round((numerator / denominator) * 100) + '%';
  }

  function count(label, value) {
    return { label: label, value: Number(value || 0) };
  }

  function ratioCalculation(numerator, denominator, suffix) {
    if (!denominator) return String(numerator) + ' \u00f7 0';
    return String(numerator) + ' \u00f7 ' + String(denominator) + ' = ' + ((numerator / denominator) * 100).toFixed(1) + (suffix || '');
  }

  var STAT_CATALOG = Object.freeze({
    hands: Object.freeze({
      id: 'hands',
      label: 'Hands',
      shortLabel: 'H',
      tableLabel: 'HANDS',
      category: 'General',
      getValue: function (playerStats) { return Number(playerStats && playerStats.handsPlayed || 0); },
      formatValue: function (value) { return String(Number(value || 0)); },
      leaderboardFormatValue: function (value) { return String(Number(value || 0)); },
      explanation: Object.freeze({
        fullName: 'Hands',
        description: 'Number of finalized hands included in the selected statistics scope.',
        formulaLabel: 'Finalized hands included',
        eligibilityNotes: Object.freeze(['Only finalized hands contribute to displayed statistics.']),
        getBreakdown: function (playerStats, context) {
          var hands = Number(playerStats && playerStats.handsDetails && playerStats.handsDetails.finalizedHands || playerStats && playerStats.handsPlayed || 0);
          return {
            displayedValue: context && context.displayedValue,
            components: [count('Finalized hands', hands)]
          };
        }
      })
    }),
    vpip: Object.freeze({
      id: 'vpip',
      label: 'VPIP',
      shortLabel: 'VPIP',
      tableLabel: 'VPIP',
      category: 'Preflop',
      getValue: function (playerStats) { return Number(playerStats && playerStats.vpip || 0); },
      formatValue: percentage,
      seatFormatValue: observedPercentage,
      leaderboardFormatValue: observedLeaderboardPercentage,
      explanation: Object.freeze({
        fullName: 'Voluntarily Put Money in Pot',
        description: 'Percentage of eligible hands in which the player voluntarily entered the pot preflop.',
        formulaLabel: 'VPIP-qualified hands \u00f7 eligible preflop opportunities',
        eligibilityNotes: Object.freeze(['Forced blinds do not count.', 'Big-blind walks are excluded from eligible opportunities.']),
        getBreakdown: function (playerStats, context) {
          var detail = playerStats && playerStats.vpipDetails || {};
          var numerator = Number(detail.qualifiedHands || playerStats && playerStats.vpipHands || 0);
          var denominator = Number(detail.opportunities || playerStats && playerStats.vpipOpportunities || 0);
          return {
            displayedValue: context && context.displayedValue,
            calculation: ratioCalculation(numerator, denominator, '%'),
            numerator: count('VPIP-qualified hands', numerator),
            denominator: count('Eligible preflop opportunities', denominator),
            components: [
              count('Hands with a voluntary preflop call', detail.callHands),
              count('Hands with a voluntary preflop raise', detail.raiseHands)
            ],
            exclusions: [count('Big-blind walks excluded', detail.walksExcluded)],
            notes: ['Call-hand and raise-hand categories may overlap; the VPIP numerator counts each qualifying hand once.']
          };
        }
      })
    }),
    pfr: Object.freeze({
      id: 'pfr',
      label: 'PFR',
      shortLabel: 'PFR',
      tableLabel: 'PFR',
      category: 'Preflop',
      getValue: function (playerStats) { return Number(playerStats && playerStats.pfr || 0); },
      formatValue: percentage,
      seatFormatValue: observedPercentage,
      leaderboardFormatValue: observedLeaderboardPercentage,
      explanation: Object.freeze({
        fullName: 'Preflop Raise',
        description: 'Percentage of eligible hands in which the player raised preflop.',
        formulaLabel: 'Hands with a preflop raise \u00f7 eligible preflop opportunities',
        eligibilityNotes: Object.freeze(['Multiple preflop raises in one hand count once.', 'Big-blind walks are excluded from eligible opportunities.']),
        getBreakdown: function (playerStats, context) {
          var detail = playerStats && playerStats.pfrDetails || {};
          var numerator = Number(detail.raisedHands || playerStats && playerStats.pfrHands || 0);
          var denominator = Number(detail.opportunities || playerStats && playerStats.pfrOpportunities || 0);
          return {
            displayedValue: context && context.displayedValue,
            calculation: ratioCalculation(numerator, denominator, '%'),
            numerator: count('Hands raised preflop', numerator),
            denominator: count('Eligible preflop opportunities', denominator),
            exclusions: [count('Big-blind walks excluded', detail.walksExcluded)]
          };
        }
      })
    }),
    threeBet: Object.freeze({
      id: 'threeBet',
      label: '3Bet',
      shortLabel: '3B',
      tableLabel: '3B',
      category: 'Preflop',
      seatOpportunityGroup: 'preflop',
      seatOpportunityOrder: 1,
      getValue: function (playerStats) { return opportunityValue(playerStats, 'threeBetMade', 'threeBetOpportunities'); },
      formatValue: opportunityDisplay,
      seatFormatValue: opportunityPercentage,
      leaderboardFormatValue: opportunityPercentage,
      explanation: Object.freeze({
        fullName: '3Bet',
        description: 'First supported full re-raise over the opening raise.',
        formulaLabel: '3Bets made \u00f7 supported 3Bet opportunities',
        eligibilityNotes: Object.freeze(['Squeezes and full legal all-in 3Bets count.', 'Short non-full all-ins and unsupported decisions do not contribute.']),
        getBreakdown: function (playerStats, context) {
          var numerator = Number(playerStats && playerStats.threeBetMade || 0);
          var denominator = Number(playerStats && playerStats.threeBetOpportunities || 0);
          return {
            displayedValue: context && context.displayedValue,
            calculation: ratioCalculation(numerator, denominator, '%'),
            numerator: count('3Bets made', numerator),
            denominator: count('Supported 3Bet opportunities', denominator)
          };
        }
      })
    }),
    foldToThreeBet: Object.freeze({
      id: 'foldToThreeBet',
      label: 'Fold to 3Bet',
      shortLabel: 'F3B',
      tableLabel: 'F3B',
      category: 'Preflop',
      seatOpportunityGroup: 'preflop',
      seatOpportunityOrder: 2,
      getValue: function (playerStats) { return opportunityValue(playerStats, 'foldToThreeBet', 'foldToThreeBetOpportunities'); },
      formatValue: opportunityDisplay,
      seatFormatValue: opportunityPercentage,
      leaderboardFormatValue: opportunityPercentage,
      explanation: Object.freeze({
        fullName: 'Fold to 3Bet',
        description: 'A voluntarily entered live player folds as their first direct response to a supported full 3Bet.',
        formulaLabel: 'Folds to 3Bet \u00f7 supported direct responses facing a 3Bet',
        eligibilityNotes: Object.freeze(['The opener and prior callers can each contribute when they directly face the qualifying 3Bet.', 'A call or full/short raise is a supported non-fold response.', 'A new full raise before action returns voids the original response opportunity; unsupported reopening does not contribute.']),
        getBreakdown: function (playerStats, context) {
          var numerator = Number(playerStats && playerStats.foldToThreeBet || 0);
          var denominator = Number(playerStats && playerStats.foldToThreeBetOpportunities || 0);
          return {
            displayedValue: context && context.displayedValue,
            calculation: ratioCalculation(numerator, denominator, '%'),
            numerator: count('Folds to 3Bet', numerator),
            denominator: count('Supported direct responses facing a 3Bet', denominator)
          };
        }
      })
    }),
    flopCBet: Object.freeze({
      id: 'flopCBet',
      label: 'Flop CBet',
      shortLabel: 'CB',
      tableLabel: 'CB',
      category: 'Postflop',
      seatOpportunityGroup: 'flop',
      seatOpportunityOrder: 3,
      seatRowBreakBefore: true,
      getValue: function (playerStats) { return opportunityValue(playerStats, 'flopCBetMade', 'flopCBetOpportunities'); },
      formatValue: opportunityDisplay,
      seatFormatValue: opportunityPercentage,
      leaderboardFormatValue: opportunityPercentage,
      explanation: Object.freeze({
        fullName: 'Flop CBet',
        description: 'A CBet opportunity belongs to the final supported preflop aggressor when action reaches that player on the flop without a prior opposing bet and the player has a meaningful betting action available.',
        formulaLabel: 'Flop CBets made \u00f7 supported Flop CBet opportunities',
        eligibilityNotes: Object.freeze(['Made: the player makes the first qualifying flop bet.', 'Donk bets and automatic runouts do not create CBet opportunities.', 'Unsupported hands do not count as failed opportunities.']),
        getBreakdown: function (playerStats, context) {
          var numerator = Number(playerStats && playerStats.flopCBetMade || 0);
          var denominator = Number(playerStats && playerStats.flopCBetOpportunities || 0);
          return {
            displayedValue: context && context.displayedValue,
            summary: numerator + ' made from ' + denominator + ' opportunities',
            calculation: ratioCalculation(numerator, denominator, '%'),
            numerator: count('Flop CBets made', numerator),
            denominator: count('Supported Flop CBet opportunities', denominator)
          };
        }
      })
    }),
    foldToFlopCBet: Object.freeze({
      id: 'foldToFlopCBet',
      label: 'Fold to Flop CBet',
      shortLabel: 'FCB',
      tableLabel: 'FCB',
      category: 'Postflop',
      seatOpportunityGroup: 'flop',
      seatOpportunityOrder: 4,
      getValue: function (playerStats) { return opportunityValue(playerStats, 'foldToFlopCBet', 'foldToFlopCBetOpportunities'); },
      formatValue: opportunityDisplay,
      seatFormatValue: opportunityPercentage,
      leaderboardFormatValue: opportunityPercentage,
      explanation: Object.freeze({
        fullName: 'Fold to Flop CBet',
        description: 'An opportunity is recorded when a player directly faces a qualifying flop CBet and has a meaningful fold, call, or raise response available.',
        formulaLabel: 'Folds to Flop CBet \u00f7 supported responses facing a Flop CBet',
        eligibilityNotes: Object.freeze(['Made: the player folds directly to that CBet.', 'Calls and raises contribute an opportunity but not a fold.', 'Unsupported hands do not count as failed opportunities.']),
        getBreakdown: function (playerStats, context) {
          var numerator = Number(playerStats && playerStats.foldToFlopCBet || 0);
          var denominator = Number(playerStats && playerStats.foldToFlopCBetOpportunities || 0);
          return {
            displayedValue: context && context.displayedValue,
            summary: numerator + ' folds from ' + denominator + ' opportunities',
            calculation: ratioCalculation(numerator, denominator, '%'),
            numerator: count('Folds to Flop CBet', numerator),
            denominator: count('Supported responses facing a Flop CBet', denominator)
          };
        }
      })
    }),
    wtsd: Object.freeze({
      id: 'wtsd',
      label: 'WTSD',
      shortLabel: 'WTSD',
      tableLabel: 'WTSD',
      category: 'Showdown',
      seatOpportunityGroup: 'showdown',
      seatOpportunityOrder: 5,
      getValue: function (playerStats) { return opportunityValue(playerStats, 'wentToShowdown', 'sawFlopForWTSD'); },
      formatValue: opportunityPercentage,
      seatFormatValue: opportunityPercentage,
      leaderboardFormatValue: opportunityPercentage,
      explanation: Object.freeze({
        fullName: 'Went to Showdown',
        description: 'Measures how often the player reached a contested showdown after seeing the flop.',
        formulaLabel: 'Hands reaching showdown \u00f7 hands where the player saw the flop',
        eligibilityNotes: Object.freeze(['A postflop fold counts as an opportunity but not as reaching showdown.', 'An uncontested river foldout does not count as reaching showdown.', 'Supported all-in runouts may count.']),
        getBreakdown: function (playerStats, context) {
          var numerator = Number(playerStats && playerStats.wentToShowdown || 0);
          var denominator = Number(playerStats && playerStats.sawFlopForWTSD || 0);
          return {
            displayedValue: context && context.displayedValue,
            summary: numerator + ' reached showdown from ' + denominator + ' hands where the player saw the flop',
            calculation: ratioCalculation(numerator, denominator, '%'),
            numerator: count('Reached showdown', numerator),
            denominator: count('Hands where the player saw the flop', denominator)
          };
        }
      })
    }),
    wsd: Object.freeze({
      id: 'wsd',
      label: 'W$SD',
      shortLabel: 'W$SD',
      tableLabel: 'W$SD',
      category: 'Showdown',
      seatOpportunityGroup: 'showdown',
      seatOpportunityOrder: 6,
      getValue: function (playerStats) { return opportunityValue(playerStats, 'wonMoneyAtShowdown', 'showdownsForWSD'); },
      formatValue: opportunityPercentage,
      seatFormatValue: opportunityPercentage,
      leaderboardFormatValue: opportunityPercentage,
      explanation: Object.freeze({
        fullName: 'Won Money at Showdown',
        description: 'Measures how often the player received a positive proven contested-pot award at showdown.',
        formulaLabel: 'Supported showdowns won \u00f7 supported showdowns',
        eligibilityNotes: Object.freeze(['Split-pot and side-pot recipients count as winning money when they receive a positive contested award.', 'Returned, refunded, or uncalled money does not count.', 'Showdowns with incomplete or unsupported settlement evidence are excluded from the denominator.']),
        getBreakdown: function (playerStats, context) {
          var numerator = Number(playerStats && playerStats.wonMoneyAtShowdown || 0);
          var denominator = Number(playerStats && playerStats.showdownsForWSD || 0);
          return {
            displayedValue: context && context.displayedValue,
            summary: numerator + ' won money from ' + denominator + ' supported showdowns',
            calculation: ratioCalculation(numerator, denominator, '%'),
            numerator: count('Won money at showdown', numerator),
            denominator: count('Supported showdowns', denominator)
          };
        }
      })
    }),
    af: Object.freeze({
      id: 'af',
      label: 'Aggression Factor',
      shortLabel: 'AF',
      tableLabel: 'AF',
      category: 'Postflop',
      getValue: function (playerStats) { return playerStats && playerStats.af === Infinity ? Infinity : Number(playerStats && playerStats.af || 0); },
      formatValue: aggressionFactor,
      seatFormatValue: observedAggressionFactor,
      leaderboardFormatValue: observedAggressionFactor,
      explanation: Object.freeze({
        fullName: 'Aggression Factor',
        description: 'Ratio of postflop aggressive actions to postflop calls.',
        formulaLabel: '(Bets + Raises) \u00f7 Calls',
        eligibilityNotes: Object.freeze(['Checks and folds are excluded.', 'Forced blinds and settlement movements do not contribute.']),
        getBreakdown: function (playerStats, context) {
          var detail = playerStats && playerStats.afDetails || {};
          var bets = Number(detail.bets || 0);
          var raises = Number(detail.raises || 0);
          var calls = Number(detail.calls || 0);
          var aggressive = bets + raises;
          var display = detail.display || aggressionFactor(playerStats && playerStats.af);
          var numerator = count('Aggressive actions', aggressive);
          var denominator = count('Calls', calls);
          var components = [count('Bets', bets), count('Raises', raises)];
          return {
            displayedValue: context && context.displayedValue,
            calculation: '(' + bets + ' + ' + raises + ') \u00f7 ' + calls + ' = ' + display,
            numerator: numerator,
            denominator: denominator,
            components: components,
            displayRows: [numerator].concat(components, [denominator]),
            specialValueNote: calls === 0
              ? (aggressive > 0 ? 'AF is \u221e because aggressive actions exist and Calls is zero.' : 'AF is 0.0 because there are no aggressive actions and no calls.')
              : ''
          };
        }
      })
    })
  });

  function catalogIds(catalog) {
    return Object.keys(catalog || STAT_CATALOG);
  }

  function withFixedVisibleStats(ids, catalog) {
    catalog = catalog || STAT_CATALOG;
    var fixed = catalogIds(catalog).filter(function (id) { return catalog[id] && catalog[id].fixedVisible === true; });
    var normalized = (ids || []).filter(function (id) { return !fixed.includes(id); });
    var insertAt = normalized.indexOf('foldToThreeBet');
    insertAt = insertAt >= 0 ? insertAt + 1 : normalized.length;
    normalized.splice.apply(normalized, [insertAt, 0].concat(fixed));
    return normalized;
  }

  function normalizePreference(stored, catalog, defaults) {
    catalog = catalog || STAT_CATALOG;
    defaults = (defaults || DEFAULT_DISPLAYED_STAT_IDS).filter(function (id) { return Boolean(catalog[id]); });
    var storedVersion = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored.version : null;
    var supportedVersion = storedVersion === PREFERENCE_VERSION || LEGACY_PREFERENCE_VERSIONS.includes(storedVersion);
    var rawIds = supportedVersion && Array.isArray(stored.displayedStatIds)
      ? stored.displayedStatIds
      : null;
    var malformed = rawIds === null;
    var invalidIdsRemoved = [];
    var duplicateIdsRemoved = [];
    var seen = new Set();
    var normalized = [];

    (rawIds || []).forEach(function (rawId) {
      var id = typeof rawId === 'string' ? rawId : '';
      if (!id || !catalog[id]) {
        invalidIdsRemoved.push(rawId);
        return;
      }
      if (seen.has(id)) {
        duplicateIdsRemoved.push(id);
        return;
      }
      seen.add(id);
      normalized.push(id);
    });

    var allIdsInvalid = !malformed && rawIds.length > 0 && normalized.length === 0;
    var defaultUsed = malformed || allIdsInvalid;
    if (defaultUsed) normalized = defaults.slice();
    if (!defaultUsed && storedVersion !== PREFERENCE_VERSION) {
      SHOWDOWN_STAT_IDS.forEach(function (id) {
        if (catalog[id] && !seen.has(id)) {
          normalized.push(id);
          seen.add(id);
        }
      });
    }
    normalized = withFixedVisibleStats(normalized, catalog);

    return {
      preference: { version: PREFERENCE_VERSION, displayedStatIds: normalized },
      storedDisplayedStatIds: rawIds === null ? null : rawIds.slice(),
      normalizedDisplayedStatIds: normalized.slice(),
      defaultUsed: defaultUsed,
      malformed: malformed,
      invalidIdsRemoved: invalidIdsRemoved,
      duplicateIdsRemoved: duplicateIdsRemoved,
      migratedFromVersion: storedVersion !== PREFERENCE_VERSION && supportedVersion ? storedVersion : null
    };
  }

  function definitionsFor(ids, catalog) {
    catalog = catalog || STAT_CATALOG;
    return (ids || []).map(function (id) { return catalog[id]; }).filter(Boolean);
  }

  function availableDefinitions(displayedIds, catalog) {
    catalog = catalog || STAT_CATALOG;
    var displayed = new Set(displayedIds || []);
    return catalogIds(catalog).filter(function (id) {
      return !displayed.has(id) && catalog[id] && catalog[id].customizable !== false;
    }).map(function (id) { return catalog[id]; });
  }

  function customizableDefinitionsFor(ids, catalog) {
    return definitionsFor(ids, catalog).filter(function (definition) { return definition.customizable !== false; });
  }

  function groupByCategory(definitions) {
    return (definitions || []).reduce(function (groups, definition) {
      var category = definition.category || 'Other';
      if (!groups[category]) groups[category] = [];
      groups[category].push(definition);
      return groups;
    }, {});
  }

  function formatStat(definition, playerStats) {
    if (!definition) return '';
    var value = definition.getValue(playerStats || {});
    return definition.shortLabel + ' ' + definition.formatValue(value);
  }

  function formatOverlay(playerStats, displayedIds, catalog) {
    return definitionsFor(displayedIds, catalog).map(function (definition) {
      return formatStat(definition, playerStats);
    }).join(' | ');
  }

  var api = Object.freeze({
    PREFERENCE_VERSION: PREFERENCE_VERSION,
    UNAVAILABLE_PLACEHOLDER: UNAVAILABLE_PLACEHOLDER,
    FIXED_VISIBLE_STAT_IDS: FIXED_VISIBLE_STAT_IDS,
    DEFAULT_DISPLAYED_STAT_IDS: DEFAULT_DISPLAYED_STAT_IDS,
    STAT_CATALOG: STAT_CATALOG,
    normalizePreference: normalizePreference,
    definitionsFor: definitionsFor,
    customizableDefinitionsFor: customizableDefinitionsFor,
    availableDefinitions: availableDefinitions,
    groupByCategory: groupByCategory,
    formatStat: formatStat,
    formatOverlay: formatOverlay
  });

  root.PokerOverlayStats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
