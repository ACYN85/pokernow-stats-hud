/* Generic tooltip-model and viewport-placement helpers. Explanation ownership stays in overlayStats.js. */
(function (root) {
  'use strict';

  function buildModel(definition, playerStats, context) {
    context = context || {};
    var explanation = definition && definition.explanation || {};
    var breakdown = typeof explanation.getBreakdown === 'function' && playerStats
      ? (explanation.getBreakdown(playerStats, context) || {})
      : {};
    return {
      statId: definition && definition.id || null,
      label: definition && definition.label || '',
      fullName: explanation.fullName || definition && definition.label || '',
      description: explanation.description || '',
      formulaLabel: explanation.formulaLabel || '',
      eligibilityNotes: (explanation.eligibilityNotes || []).slice(),
      playerName: context.playerName || null,
      playerId: context.playerId || null,
      scope: context.scope || null,
      displayedValue: breakdown.displayedValue === undefined && definition && playerStats
        ? definition.formatValue(definition.getValue(playerStats))
        : breakdown.displayedValue,
      summary: breakdown.summary || '',
      calculation: breakdown.calculation || '',
      numerator: breakdown.numerator || null,
      denominator: breakdown.denominator || null,
      components: (breakdown.components || []).slice(),
      displayRows: Array.isArray(breakdown.displayRows) ? breakdown.displayRows.slice() : null,
      exclusions: (breakdown.exclusions || []).slice(),
      notes: (breakdown.notes || []).slice(),
      specialValueNote: breakdown.specialValueNote || ''
    };
  }

  function choosePlacement(anchor, tooltipSize, viewport, gap) {
    gap = Number(gap || 8);
    var width = Number(tooltipSize && tooltipSize.width || 0);
    var height = Number(tooltipSize && tooltipSize.height || 0);
    var viewportWidth = Number(viewport && viewport.width || 0);
    var viewportHeight = Number(viewport && viewport.height || 0);
    var candidates = [
      { kind: 'below', left: anchor.left + (anchor.width - width) / 2, top: anchor.bottom + gap },
      { kind: 'above', left: anchor.left + (anchor.width - width) / 2, top: anchor.top - height - gap },
      { kind: 'right', left: anchor.right + gap, top: anchor.top + (anchor.height - height) / 2 },
      { kind: 'left', left: anchor.left - width - gap, top: anchor.top + (anchor.height - height) / 2 }
    ];
    var fitting = candidates.find(function (candidate) {
      return candidate.left >= gap && candidate.top >= gap &&
        candidate.left + width <= viewportWidth - gap &&
        candidate.top + height <= viewportHeight - gap;
    }) || candidates[0];
    return {
      kind: fitting.kind,
      left: Math.max(gap, Math.min(Math.max(gap, viewportWidth - width - gap), fitting.left)),
      top: Math.max(gap, Math.min(Math.max(gap, viewportHeight - height - gap), fitting.top))
    };
  }

  var api = Object.freeze({ buildModel: buildModel, choosePlacement: choosePlacement });
  root.PokerStatTooltip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
