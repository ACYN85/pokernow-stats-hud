'use strict';
var fs = require('fs');
var path = require('path');
var source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
function sourceFunction(name) {
  var pattern = new RegExp('(?:^|\\n)[ \\t]*function ' + name + '\\(');
  var match = pattern.exec(source);
  if (!match) throw new Error('Missing production function: ' + name);
  var start = match.index + (source[match.index] === '\n' ? 1 : 0);
  var end = source.indexOf('\n  }', start);
  if (end < 0) throw new Error('Missing production function end: ' + name);
  return source.slice(start, end + 4);
}
var geometry = ['validAnchorRect', 'parseVisibleNumber', 'anchorRectRecord', 'unionAnchorRects', 'anchorElementReference', 'isActionMarkerElement', 'findExactTextElement', 'elementVisibleText', 'seatHudVisualTextRect', 'seatHudVerticalPanelGeometry', 'resolvePlayerPanelBodyGeometry', 'seatHudPanelBodyAlignmentDiagnostic', 'resolvePlayerVisualGeometry'];
var panels = ['isExtensionOwnedUiElement', 'seatHudSurfaceText', 'isPokerNowChatSurface', 'seatHudLogControlLooksOpen', 'expandedPanelTypeForControl', 'expandedPokerNowPanelForControl', 'clearExpandedPokerNowPanelLayerMarker', 'applyExpandedPokerNowPanelLayerMarker', 'discoverSeatHudExpandedSurfaces', 'refreshSeatHudLogPanelState', 'blockingPanelCandidate', 'visibleSeatHudSurfaces', 'elementLayerDescriptor', 'removeSeatOverlayClip', 'applySeatHudExpandedPanelOcclusion', 'applyNativePanelOcclusion', 'scheduleNativePanelOcclusion', 'isVisible', 'findVisibleTextElement'];
var drag = ['applyOverlayDragState', 'persistManualOverlayPositions', 'recordOverlayDragTrace', 'resetOverlayPositions', 'persistFinishedOverlayDrag', 'finishOverlayDrag', 'cancelOverlayDrag', 'moveOverlayDrag', 'beginOverlayDrag', 'installDragBehavior', 'cleanupDragBehavior'];
module.exports = { sourceFunction: sourceFunction, geometry: geometry, panels: panels, drag: drag, source: function () { return geometry.concat(panels, drag).map(sourceFunction).join('\n'); } };
