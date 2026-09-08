(function (root) {
  'use strict';

  var BOARD_SELECTORS = '.table-cards, .table-community-cards, .table-board-cards, .community-cards, .community-board, .board-container, [class*="board-cards" i], [data-board-container], [data-community-cards], [data-community-board]';
  var SLOT_SELECTORS = '.table-card-slot, .community-card-slot, .board-card-slot, [data-card-slot], [data-board-slot], [class*="community-slot" i], [class*="board-slot" i]';
  var CARD_SELECTORS = '.card-container, .table-card, [class*="community-card" i], [class*="board-card" i]';
  var TABLE_SELECTOR_PRIORITY = ['#table', '.game-table', '[class~="game-table"]', 'main'];
  var TABLE_SELECTORS = TABLE_SELECTOR_PRIORITY.join(', ');
  var BOARD_GAP = 10;
  var DEFAULT_MODEL = Object.freeze({
    id: 'pokernow-five-card-table-local-v1',
    leftRatio: 520 / 1280,
    topRatio: 260 / 665,
    widthRatio: 306 / 1280,
    heightRatio: 80 / 665
  });

  function number(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? value : Number(fallback || 0);
  }

  function normalizedRect(value) {
    if (!value) return null;
    var left = number(value.left, value.x);
    var top = number(value.top, value.y);
    var width = number(value.width, number(value.right) - left);
    var height = number(value.height, number(value.bottom) - top);
    if (!(width > 0 && height > 0)) return null;
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
  }

  function roundedRect(value) {
    var valueRect = normalizedRect(value);
    if (!valueRect) return null;
    function round(item) { return Math.round(item * 10) / 10; }
    return { left: round(valueRect.left), top: round(valueRect.top), width: round(valueRect.width), height: round(valueRect.height), right: round(valueRect.right), bottom: round(valueRect.bottom) };
  }

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

  function union(rects) {
    var values = (rects || []).map(normalizedRect).filter(Boolean);
    if (!values.length) return null;
    var left = Math.min.apply(null, values.map(function (item) { return item.left; }));
    var top = Math.min.apply(null, values.map(function (item) { return item.top; }));
    var right = Math.max.apply(null, values.map(function (item) { return item.right; }));
    var bottom = Math.max.apply(null, values.map(function (item) { return item.bottom; }));
    return normalizedRect({ left: left, top: top, width: right - left, height: bottom - top });
  }

  function median(values) {
    values = (values || []).map(Number).filter(Number.isFinite).sort(function (left, right) { return left - right; });
    if (!values.length) return null;
    var middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  }

  function sameRow(entries) {
    var values = (entries || []).filter(function (entry) { return normalizedRect(entry && entry.rect || entry); }).slice().sort(function (left, right) {
      return normalizedRect(left.rect || left).left - normalizedRect(right.rect || right).left;
    });
    if (!values.length) return [];
    var reference = normalizedRect(values[0].rect || values[0]);
    return values.filter(function (entry) {
      var entryRect = normalizedRect(entry.rect || entry);
      return Math.abs(entryRect.top + entryRect.height / 2 - (reference.top + reference.height / 2)) <= Math.max(12, Math.min(reference.height, entryRect.height) * 0.3);
    });
  }

  function cardPitch(entries) {
    var row = sameRow(entries);
    var rects = row.map(function (entry) { return normalizedRect(entry.rect || entry); });
    var pitches = [];
    for (var index = 1; index < rects.length; index += 1) pitches.push(rects[index].left - rects[index - 1].left);
    var pitch = median(pitches);
    var cardWidth = median(rects.map(function (item) { return item.width; }));
    var cardHeight = median(rects.map(function (item) { return item.height; }));
    var credible = Boolean(pitch && cardWidth && pitch >= cardWidth * 0.72 && pitch <= cardWidth * 1.8);
    return { cardCount: rects.length, pitch: credible ? pitch : null, cardWidth: cardWidth, cardHeight: cardHeight, pitches: pitches, credible: credible };
  }

  function companionRect(boardRect, side, size, gap) {
    boardRect = normalizedRect(boardRect);
    if (!boardRect) return null;
    size = size || {};
    var width = Math.max(1, number(size.width, 100));
    var height = Math.max(1, number(size.height, 60));
    gap = number(gap, BOARD_GAP);
    var left = side === 'right' ? boardRect.right + gap : boardRect.left - gap - width;
    var top = boardRect.top + (boardRect.height - height) / 2;
    return normalizedRect({ left: left, top: top, width: width, height: height });
  }

  function materiallyDifferent(left, right) {
    left = normalizedRect(left); right = normalizedRect(right);
    if (!left || !right) return Boolean(left || right);
    var scale = Math.max(left.width, left.height, right.width, right.height, 1);
    return Math.abs(left.left - right.left) > Math.max(2, scale * 0.008) ||
      Math.abs(left.top - right.top) > Math.max(2, scale * 0.008) ||
      Math.abs(left.width - right.width) > Math.max(2, scale * 0.01) ||
      Math.abs(left.height - right.height) > Math.max(2, scale * 0.01);
  }

  function className(element) { return String(element && (typeof element.className === 'string' ? element.className : element.getAttribute && element.getAttribute('class')) || '').trim().slice(0, 240); }

  function safeClassTokens(element) {
    return className(element).split(/\s+/).filter(function (value) {
      return value && /(?:table|board|community|card|slot|game|stage|layout|mobile|desktop|narrow|wide|compact|full|portrait|landscape)/i.test(value) && !/(?:player-name|chat|message)/i.test(value);
    }).slice(0, 16);
  }

  function safeNodeDescriptor(element, key, getStyle) {
    if (!element) return null;
    var parent = element.parentElement;
    var style = getStyle ? getStyle(element) : null;
    return {
      key: key,
      tag: String(element.tagName || '').toLowerCase() || null,
      id: element.id && /(?:table|board|community|stage)/i.test(element.id) ? String(element.id).slice(0, 120) : null,
      classes: safeClassTokens(element),
      parentTag: parent ? String(parent.tagName || '').toLowerCase() || null : null,
      parentClasses: parent ? safeClassTokens(parent) : [],
      rect: roundedRect(element.getBoundingClientRect && element.getBoundingClientRect()),
      transform: style && style.transform && style.transform !== 'none' ? String(style.transform).slice(0, 160) : 'none',
      connected: element.isConnected !== false
    };
  }

  function elementRect(element) {
    try { return normalizedRect(element && element.getBoundingClientRect && element.getBoundingClientRect()); }
    catch (_error) { return null; }
  }

  function visibleElement(element, view) {
    var valueRect = elementRect(element);
    if (!element || element.isConnected === false || !valueRect) return false;
    var style = view && view.getComputedStyle ? view.getComputedStyle(element) : null;
    return !style || style.display !== 'none' && style.visibility !== 'hidden' && number(style.opacity, 1) > 0.01;
  }

  function isExcluded(element, options) {
    if (!element) return true;
    if (options && typeof options.isOwnedElement === 'function' && options.isOwnedElement(element)) return true;
    return Boolean(element.closest && element.closest('.table-player'));
  }

  function uniqueElements(values) { return (values || []).filter(function (element, index, elements) { return Boolean(element && elements.indexOf(element) === index); }); }

  function tableOwnerSource(element, supplied) {
    if (!element) return null;
    var id = String(element.id || '');
    var classes = className(element);
    if (id === 'table') return '#table persistent PokerNow table/stage owner';
    if (/(^|\s)game-table(\s|$)/.test(classes)) return '.game-table persistent PokerNow table/stage owner';
    if (String(element.tagName || '').toLowerCase() === 'main') return 'main persistent PokerNow table/stage owner';
    return supplied ? 'explicit persistent PokerNow table/stage owner' : 'connected table/stage selector owner';
  }

  function tableTransformEvidence(element, tableRect, view, style) {
    tableRect = normalizedRect(tableRect);
    var localWidth = number(element && (element.clientWidth || element.offsetWidth), tableRect && tableRect.width);
    var localHeight = number(element && (element.clientHeight || element.offsetHeight), tableRect && tableRect.height);
    if (!(localWidth > 0)) localWidth = tableRect && tableRect.width || 0;
    if (!(localHeight > 0)) localHeight = tableRect && tableRect.height || 0;
    var scaleX = tableRect && localWidth ? tableRect.width / localWidth : 1;
    var scaleY = tableRect && localHeight ? tableRect.height / localHeight : 1;
    return {
      transform: String(style && style.transform || 'none').slice(0, 160),
      transformOrigin: style && String(style.transformOrigin || '').slice(0, 120) || null,
      scaleX: Math.round(scaleX * 10000) / 10000,
      scaleY: Math.round(scaleY * 10000) / 10000,
      localWidth: Math.round(localWidth * 10) / 10,
      localHeight: Math.round(localHeight * 10) / 10,
      devicePixelRatio: number(view && view.devicePixelRatio, 1),
      visualViewportScale: number(view && view.visualViewport && view.visualViewport.scale, 1),
      layoutMode: safeClassTokens(element).filter(function (token) { return /(?:layout|mobile|desktop|narrow|wide|compact|full|portrait|landscape)/i.test(token); }).join(' ') || null
    };
  }

  function collectDomEvidence(documentLike, view, options) {
    options = options || {};
    var suppliedTable = options.tableElement && options.tableElement.isConnected !== false && !isExcluded(options.tableElement, options) ? options.tableElement : null;
    var queriedTableCandidates = [];
    TABLE_SELECTOR_PRIORITY.forEach(function (selector) {
      queriedTableCandidates = queriedTableCandidates.concat(Array.from(documentLike.querySelectorAll(selector)));
    });
    var rejectedOwnedTableCandidates = uniqueElements(queriedTableCandidates).filter(function (element) { return isExcluded(element, options); });
    var tableCandidates = uniqueElements([suppliedTable].concat(queriedTableCandidates)).filter(function (element) {
      return Boolean(element && element.isConnected !== false && !isExcluded(element, options) && elementRect(element));
    });
    var tableElement = tableCandidates.find(function (element) { return visibleElement(element, view); }) || suppliedTable || tableCandidates[0] || documentLike.body || documentLike.documentElement;
    var getStyle = view && view.getComputedStyle ? function (element) { return view.getComputedStyle(element); } : null;
    var tableRect = elementRect(tableElement);
    var tableStyle = getStyle ? getStyle(tableElement) : null;
    var wrappers = uniqueElements(Array.from(documentLike.querySelectorAll(BOARD_SELECTORS))).filter(function (element) { return !isExcluded(element, options) && visibleElement(element, view); });
    var rawCards = uniqueElements(Array.from(documentLike.querySelectorAll(CARD_SELECTORS)).map(function (element) {
      var outer = element.closest && element.closest('.card-container');
      return outer && outer.isConnected !== false ? outer : element;
    })).filter(function (element) {
      if (isExcluded(element, options) || !visibleElement(element, view)) return false;
      var value = elementRect(element);
      return Boolean(value && value.width >= 8 && value.height >= 12 && value.width <= 200 && value.height <= 220 && !/(?:slot)/i.test(className(element)));
    });
    var cardRows = rawCards.map(function (seed) {
      var seedRect = elementRect(seed);
      return rawCards.filter(function (element) {
        var value = elementRect(element);
        return Math.abs(value.top + value.height / 2 - (seedRect.top + seedRect.height / 2)) <= Math.max(14, Math.min(seedRect.height, value.height) * 0.35);
      }).sort(function (left, right) { return elementRect(left).left - elementRect(right).left; });
    }).filter(function (row) { return row.length >= 3 && row.length <= 5; });
    cardRows.sort(function (left, right) {
      if (right.length !== left.length) return right.length - left.length;
      var leftRect = union(left.map(elementRect)); var rightRect = union(right.map(elementRect)); var center = number(view && view.innerWidth) / 2;
      return Math.abs(leftRect.left + leftRect.width / 2 - center) - Math.abs(rightRect.left + rightRect.width / 2 - center);
    });
    var cards = cardRows[0] || [];
    var slots = uniqueElements(Array.from(documentLike.querySelectorAll(SLOT_SELECTORS))).filter(function (element) {
      if (isExcluded(element, options) || !visibleElement(element, view)) return false;
      var value = elementRect(element);
      return Boolean(value && value.width >= 8 && value.height >= 12 && value.width <= 200 && value.height <= 220);
    });
    var slotRow = sameRow(slots.map(function (element) { return { element: element, rect: elementRect(element) }; })).slice(0, 5);
    var wrapperEvidence = wrappers.map(function (element, index) {
      var style = getStyle ? getStyle(element) : null; var wrapperRect = elementRect(element);
      var paddingLeft = style ? number(style.paddingLeft) : 0; var paddingRight = style ? number(style.paddingRight) : 0; var paddingTop = style ? number(style.paddingTop) : 0; var paddingBottom = style ? number(style.paddingBottom) : 0;
      return {
        key: 'board-candidate-' + index, element: element, rect: wrapperRect,
        innerRect: normalizedRect({ left: wrapperRect.left + paddingLeft, top: wrapperRect.top + paddingTop, width: wrapperRect.width - paddingLeft - paddingRight, height: wrapperRect.height - paddingTop - paddingBottom }),
        classes: className(element), justifyContent: style && String(style.justifyContent || ''), alignItems: style && String(style.alignItems || ''), transform: style && String(style.transform || 'none'),
        cardEntries: cards.filter(function (card) { return element.contains && element.contains(card); }).map(function (card) { return { element: card, rect: elementRect(card), classes: className(card) }; }),
        slotEntries: slotRow.filter(function (entry) { return element.contains && element.contains(entry.element); }).map(function (entry) { return { element: entry.element, rect: entry.rect, classes: className(entry.element) }; })
      };
    });
    var potElement = documentLike.querySelector('.table-pot-size, [class*="table-pot" i], [class*="main-pot" i], [class*="pot-size" i]');
    var descriptors = [safeNodeDescriptor(tableElement, 'table-coordinate-owner', getStyle)];
    wrapperEvidence.forEach(function (candidate) { descriptors.push(safeNodeDescriptor(candidate.element, candidate.key, getStyle)); });
    slotRow.forEach(function (entry, index) { descriptors.push(safeNodeDescriptor(entry.element, 'slot-' + (index + 1), getStyle)); });
    cards.forEach(function (element, index) { descriptors.push(safeNodeDescriptor(element, 'validation-card-' + (index + 1), getStyle)); });
    return {
      tableId: options.tableId || null,
      viewport: { width: number(view && view.innerWidth), height: number(view && view.innerHeight), devicePixelRatio: number(view && view.devicePixelRatio, 1), visualViewportScale: number(view && view.visualViewport && view.visualViewport.scale, 1) },
      tableElement: tableElement,
      tableOwnerSource: tableOwnerSource(tableElement, Boolean(suppliedTable)),
      tableRect: tableRect,
      tableTransform: tableTransformEvidence(tableElement, tableRect, view, tableStyle),
      potRect: elementRect(potElement),
      wrapperCandidates: wrapperEvidence,
      slotEntries: slotRow.map(function (entry) { return { element: entry.element, rect: entry.rect, classes: className(entry.element) }; }),
      cardEntries: cards.map(function (element) { return { element: element, rect: elementRect(element), classes: className(element) }; }),
      rejectedOwnedTableCandidates: rejectedOwnedTableCandidates.map(function (element) { return safeNodeDescriptor(element, 'rejected-extension-owned-table-candidate', getStyle); }).filter(Boolean),
      domNodes: descriptors.filter(Boolean),
      collectedAt: Date.now()
    };
  }

  function createState(options) {
    options = options || {};
    return {
      tableId: options.tableId || null, tableElement: null, tableOwnerSource: null, viewportRect: null, tableRect: null, tableTransform: null,
      layoutEpochSequence: 0, layoutEpochId: null, epochSignature: null, canonicalBoardLocalRect: null, canonicalBoardSource: null, canonicalBoardVerified: false, canonicalChangeReason: null,
      lastKnownGood: null, lastResolved: null, verifiedModel: null, history: [], epochHistory: [], illegalChanges: [], illegalChangeSequence: 0, validationHistory: [],
      maxHistory: Math.max(8, Math.min(128, number(options.maxHistory, 48))), revision: 0, invalidationReason: null, lastInfo: null, signalEssentials: null, listeners: new Set()
    };
  }

  function epochSignature(evidence, tableRect) {
    var transform = evidence.tableTransform || {};
    return {
      tableId: evidence.tableId || null,
      viewport: { width: Math.round(number(evidence.viewport && evidence.viewport.width) * 10) / 10, height: Math.round(number(evidence.viewport && evidence.viewport.height) * 10) / 10, devicePixelRatio: Math.round(number(evidence.viewport && evidence.viewport.devicePixelRatio, 1) * 1000) / 1000, visualViewportScale: Math.round(number(evidence.viewport && evidence.viewport.visualViewportScale, transform.visualViewportScale || 1) * 1000) / 1000 },
      tableRect: roundedRect(tableRect), transform: String(transform.transform || 'none'), transformOrigin: transform.transformOrigin || null,
      scaleX: number(transform.scaleX, 1), scaleY: number(transform.scaleY, 1), localWidth: number(transform.localWidth, tableRect && tableRect.width), localHeight: number(transform.localHeight, tableRect && tableRect.height), layoutMode: transform.layoutMode || null,
      tableOwnerSource: evidence.tableOwnerSource || null
    };
  }

  function sameEpochSignature(left, right) { return JSON.stringify(left || null) === JSON.stringify(right || null); }

  function epochChangeReason(state, evidence, nextSignature) {
    if (!state.layoutEpochId) return 'initial stable PokerNow table coordinate owner became usable';
    if (state.tableId && evidence.tableId && String(state.tableId) !== String(evidence.tableId)) return 'route/table identity changed';
    if (state.tableElement && evidence.tableElement && state.tableElement !== evidence.tableElement) return 'persistent PokerNow table/stage coordinate owner changed';
    var prior = state.epochSignature || {};
    if (JSON.stringify(prior.viewport || null) !== JSON.stringify(nextSignature.viewport || null)) return 'actual viewport, zoom, or visual-viewport scale changed';
    if (JSON.stringify(prior.tableRect || null) !== JSON.stringify(nextSignature.tableRect || null)) return 'persistent PokerNow table/stage viewport geometry changed';
    if (prior.transform !== nextSignature.transform || prior.transformOrigin !== nextSignature.transformOrigin || prior.scaleX !== nextSignature.scaleX || prior.scaleY !== nextSignature.scaleY) return 'persistent PokerNow table/stage transform or scale changed';
    if (prior.localWidth !== nextSignature.localWidth || prior.localHeight !== nextSignature.localHeight || prior.layoutMode !== nextSignature.layoutMode) return 'responsive PokerNow table/stage coordinate space changed';
    return 'material table-layout epoch input changed';
  }

  function localSpace(signature) {
    signature = signature || {};
    return { width: number(signature.localWidth, signature.tableRect && signature.tableRect.width), height: number(signature.localHeight, signature.tableRect && signature.tableRect.height), scaleX: number(signature.scaleX, 1) || 1, scaleY: number(signature.scaleY, 1) || 1 };
  }

  function viewportToLocal(value, tableRect, signature) {
    value = normalizedRect(value); tableRect = normalizedRect(tableRect);
    if (!value || !tableRect) return null;
    var space = localSpace(signature);
    return normalizedRect({ left: (value.left - tableRect.left) / space.scaleX, top: (value.top - tableRect.top) / space.scaleY, width: value.width / space.scaleX, height: value.height / space.scaleY });
  }

  function localToViewport(value, tableRect, signature) {
    value = normalizedRect(value); tableRect = normalizedRect(tableRect);
    if (!value || !tableRect) return null;
    var space = localSpace(signature);
    return normalizedRect({ left: tableRect.left + value.left * space.scaleX, top: tableRect.top + value.top * space.scaleY, width: value.width * space.scaleX, height: value.height * space.scaleY });
  }

  function structuralSlotEnvelope(evidence) {
    var globalRow = sameRow(evidence.slotEntries || []).slice(0, 5);
    if (globalRow.length === 5) return { rect: union(globalRow.map(function (entry) { return entry.rect || entry; })), source: 'explicit five-card slot envelope', pitch: cardPitch(globalRow) };
    var wrappers = (evidence.wrapperCandidates || []).slice();
    for (var index = 0; index < wrappers.length; index += 1) {
      var row = sameRow(wrappers[index].slotEntries || []).slice(0, 5);
      if (row.length === 5) return { rect: union(row.map(function (entry) { return entry.rect || entry; })), source: 'explicit persistent five-card slot envelope in board owner', pitch: cardPitch(row) };
    }
    return null;
  }

  function observedFiveCardEnvelope(evidence) {
    var row = sameRow(evidence.cardEntries || []).slice(0, 5);
    var pitch = cardPitch(row);
    if (row.length < 3 || row.length > 5 || !pitch.credible) return null;
    var first = normalizedRect(row[0].rect || row[0]);
    if (!first) return null;
    return {
      rect: normalizedRect({ left: first.left, top: first.top, width: first.width + pitch.pitch * 4, height: first.height }),
      source: 'observed live first-card slot plus credible card pitch reconstructed five-card envelope',
      pitch: pitch
    };
  }

  function bootstrapBoardLocalRect(signature) {
    var space = localSpace(signature);
    if (!(space.width > 0 && space.height > 0)) return null;
    return normalizedRect({ left: space.width * DEFAULT_MODEL.leftRatio, top: space.height * DEFAULT_MODEL.topRatio, width: space.width * DEFAULT_MODEL.widthRatio, height: space.height * DEFAULT_MODEL.heightRatio });
  }

  function establishCanonicalLocal(evidence, signature, state) {
    var structural = structuralSlotEnvelope(evidence);
    var localStructural = structural && viewportToLocal(structural.rect, evidence.tableRect, signature);
    if (localStructural) return { rect: localStructural, source: structural.source, verified: true, pitch: structural.pitch, fallback: null };
    var observed = observedFiveCardEnvelope(evidence);
    var localObserved = observed && viewportToLocal(observed.rect, evidence.tableRect, signature);
    if (localObserved) return { rect: localObserved, source: observed.source, verified: true, pitch: observed.pitch, fallback: null };
    var priorModel = state && state.verifiedModel;
    var space = localSpace(signature);
    if (priorModel && priorModel.localWidth === space.width && priorModel.localHeight === space.height && priorModel.layoutMode === (signature.layoutMode || null)) {
      return { rect: normalizedRect(priorModel.rect), source: 'previously observed table-local five-card envelope for unchanged local table space', verified: true, pitch: clone(priorModel.pitch), fallback: null };
    }
    return { rect: bootstrapBoardLocalRect(signature), source: 'PokerNow table-local five-card board model ' + DEFAULT_MODEL.id, verified: false, pitch: null, fallback: 'table-local bootstrap model; fresh live alignment signoff pending' };
  }

  function signalEssentials(state, values) {
    values = values || {};
    return {
      tableId: values.tableId || state.tableId || null, layoutEpochId: values.layoutEpochId || state.layoutEpochId || null, tableOwnerSource: values.tableOwnerSource || state.tableOwnerSource || null,
      viewport: clone(values.viewport || null), tableViewportRect: roundedRect(values.tableRect), tableTransform: clone(values.tableTransform || null),
      canonicalBoardLocalRect: roundedRect(values.canonicalBoardLocalRect), canonicalBoardViewportRect: roundedRect(values.canonicalBoardRect), canonicalBoardSource: values.canonicalBoardSource || null,
      canonicalBoardVerified: values.canonicalBoardVerified === true, geometryAvailable: Boolean(normalizedRect(values.canonicalBoardRect)), canonicalChangeReason: values.canonicalChangeReason || null, invalidationReason: values.invalidationReason || null
    };
  }

  function sameSignal(left, right) { return JSON.stringify(left || null) === JSON.stringify(right || null); }

  function emitChange(state, reason, before, after) {
    var event = Object.freeze({ revision: state.revision, timestamp: Date.now(), reason: String(reason || 'placement-capable layout input changed').slice(0, 240), before: clone(before || null), after: clone(after || null) });
    state.listeners.forEach(function (listener) { try { listener(event); } catch (_error) {} });
    return event;
  }

  function subscribe(state, listener) {
    if (!state || !state.listeners || typeof listener !== 'function') return function () {};
    state.listeners.add(listener);
    return function () { state.listeners.delete(listener); };
  }

  function invalidate(state, reason) {
    var before = clone(state.signalEssentials);
    state.layoutEpochId = null; state.epochSignature = null; state.canonicalBoardLocalRect = null; state.canonicalBoardSource = null; state.canonicalBoardVerified = false; state.canonicalChangeReason = null;
    state.lastKnownGood = null; state.lastResolved = null; state.verifiedModel = null; state.invalidationReason = String(reason || 'layout invalidated').slice(0, 240); state.revision += 1;
    state.signalEssentials = signalEssentials(state, { tableId: state.tableId, viewport: state.lastInfo && state.lastInfo.viewport || null, tableRect: state.tableRect, canonicalBoardRect: null, invalidationReason: state.invalidationReason });
    if (state.lastInfo) { state.lastInfo.revision = state.revision; state.lastInfo.invalidationReason = state.invalidationReason; }
    emitChange(state, state.invalidationReason, before, state.signalEssentials);
    return state;
  }

  function settingsGeometrySignal(context) {
    return Boolean(context && (context.settingsTransition === true || /settings/i.test(String(context.trigger || ''))));
  }

  function recordIllegalChange(state, proposedLocal, context, evidence, proposedSource, forcedType) {
    var illegalType = forcedType || (settingsGeometrySignal(context) ? 'ILLEGAL_SETTINGS_GEOMETRY_CHANGE' : 'ILLEGAL_CANONICAL_GEOMETRY_CHANGE');
    var prior = state.illegalChanges.length ? state.illegalChanges[state.illegalChanges.length - 1] : null;
    if (prior && prior.type === illegalType && prior.layoutEpochId === state.layoutEpochId && prior.rejectedSource === (proposedSource || null) &&
      JSON.stringify(prior.acceptedCanonicalBoardLocalRect) === JSON.stringify(roundedRect(state.canonicalBoardLocalRect)) &&
      JSON.stringify(prior.rejectedCanonicalBoardLocalRect) === JSON.stringify(roundedRect(proposedLocal))) return prior;
    state.illegalChangeSequence += 1;
    var entry = {
      sequence: state.illegalChangeSequence, timestamp: Date.now(), type: illegalType, reason: illegalType === 'ILLEGAL_SETTINGS_GEOMETRY_CHANGE' ? 'Settings signal rejected replacement table owner or canonical geometry' : 'same layout epoch rejected replacement canonical board-local geometry',
      layoutEpochId: state.layoutEpochId, tableOwnerSource: state.tableOwnerSource, trigger: String(context.trigger || 'layout resolution').slice(0, 180), street: context.street || null,
      boardCardCount: (evidence.cardEntries || []).length, settingsVisible: context.settingsVisible === true, acceptedCanonicalBoardLocalRect: roundedRect(state.canonicalBoardLocalRect),
      rejectedCanonicalBoardLocalRect: roundedRect(proposedLocal), rejectedSource: proposedSource || null, tableViewportRect: roundedRect(evidence.tableRect), viewport: clone(evidence.viewport || null)
    };
    state.illegalChanges.push(entry); if (state.illegalChanges.length > 64) state.illegalChanges.shift(); return entry;
  }

  function validateActualCards(canonicalLocal, evidence, signature) {
    var rows = sameRow(evidence.cardEntries || []).slice(0, 5); var pitch = cardPitch(rows);
    var localRects = rows.map(function (entry) { return viewportToLocal(entry.rect || entry, evidence.tableRect, signature); }).filter(Boolean);
    if (!canonicalLocal || !localRects.length) return { status: 'no-visible-card-evidence', cardCount: localRects.length, actualCardLocalRects: localRects.map(roundedRect), pitch: pitch };
    var cardWidth = median(localRects.map(function (item) { return item.width; }));
    var expectedPitch = localRects.length > 1 && pitch.credible ? pitch.pitch / localSpace(signature).scaleX : (canonicalLocal.width - cardWidth) / 4;
    var tolerance = Math.max(3, cardWidth * 0.16); var mismatches = [];
    localRects.forEach(function (item, index) {
      var expectedLeft = canonicalLocal.left + expectedPitch * index;
      if (Math.abs(item.left - expectedLeft) > tolerance || Math.abs(item.top - canonicalLocal.top) > tolerance || Math.abs(item.height - canonicalLocal.height) > tolerance) mismatches.push({ slot: index + 1, expectedLeft: Math.round(expectedLeft * 10) / 10, actualRect: roundedRect(item) });
    });
    return { status: mismatches.length ? 'validation-disagreement' : 'validated-against-immutable-epoch-model', cardCount: localRects.length, actualCardLocalRects: localRects.map(roundedRect), pitch: pitch, expectedPitchLocal: Math.round(expectedPitch * 10) / 10, tolerance: Math.round(tolerance * 10) / 10, mismatches: mismatches };
  }

  function publicCandidate(candidate) {
    return { key: candidate.key, classes: String(candidate.classes || '').slice(0, 240), connected: Boolean(candidate.element && candidate.element.isConnected !== false), rect: roundedRect(candidate.rect), innerRect: roundedRect(candidate.innerRect), justifyContent: candidate.justifyContent || null, transform: candidate.transform || 'none', cardCount: (candidate.cardEntries || []).length, slotCount: (candidate.slotEntries || []).length };
  }

  function translatedRect(value, offsetX, offsetY) {
    value = normalizedRect(value);
    if (!value) return null;
    return normalizedRect({ left: value.left + number(offsetX), top: value.top + number(offsetY), width: value.width, height: value.height });
  }

  function boardAlignment(info) {
    var canonical = normalizedRect(info && info.canonicalBoardViewportRect);
    var observed = normalizedRect(info && info.observedFirstVisibleCardRect);
    var firstWidth = observed && observed.width || canonical && canonical.height * 0.725 || 0;
    var firstHeight = observed && observed.height || canonical && canonical.height || 0;
    var expectedFirst = canonical && normalizedRect({ left: canonical.left, top: canonical.top, width: firstWidth, height: firstHeight });
    var expectedPotOdds = translatedRect(info && info.canonicalLeftCompanionRect, info && info.persistedOffsetX, info && info.persistedOffsetY);
    var actualPotOdds = normalizedRect(info && (info.actualPanelRect || info.potOddsActualRect));
    var firstDeltaX = observed && expectedFirst ? Math.round((observed.left - expectedFirst.left) * 10) / 10 : null;
    var firstDeltaY = observed && expectedFirst ? Math.round((observed.top - expectedFirst.top) * 10) / 10 : null;
    var potDeltaX = actualPotOdds && expectedPotOdds ? Math.round((actualPotOdds.left - expectedPotOdds.left) * 10) / 10 : null;
    var potDeltaY = actualPotOdds && expectedPotOdds ? Math.round((actualPotOdds.top - expectedPotOdds.top) * 10) / 10 : null;
    var firstWithin = firstDeltaX === null ? null : Math.abs(firstDeltaX) <= 3 && Math.abs(firstDeltaY) <= 3;
    var potWithin = potDeltaX === null ? null : Math.abs(potDeltaX) <= 2 && Math.abs(potDeltaY) <= 2;
    return {
      expectedFirstSlotRect: roundedRect(expectedFirst), observedFirstVisibleCardRect: roundedRect(observed), firstSlotDeltaX: firstDeltaX, firstSlotDeltaY: firstDeltaY,
      expectedPotOddsRect: roundedRect(expectedPotOdds), actualPotOddsRect: roundedRect(actualPotOdds), potOddsDeltaX: potDeltaX, potOddsDeltaY: potDeltaY,
      firstSlotWithinTolerance: firstWithin, potOddsWithinTolerance: potWithin, withinTolerance: firstWithin === null ? potWithin : potWithin === null ? firstWithin : firstWithin && potWithin
    };
  }

  function makePublicInfo(state, evidence, result, sizes, context) {
    var canonical = roundedRect(result.rect); var left = roundedRect(companionRect(canonical, 'left', sizes.left, BOARD_GAP)); var right = roundedRect(companionRect(canonical, 'right', sizes.right, BOARD_GAP));
    return {
      schemaVersion: 3, revision: state.revision, timestamp: Date.now(), tableId: evidence.tableId || state.tableId || null,
      layoutEpochId: state.layoutEpochId, layoutEpochSequence: state.layoutEpochSequence, layoutEpochChanged: result.epochChanged === true, canonicalGeometryChanged: result.geometryChanged === true,
      canonicalGeometryChangeReason: result.geometryChanged ? state.canonicalChangeReason : null, lastAcceptedCanonicalChangeReason: state.canonicalChangeReason,
      tableOwnerSource: state.tableOwnerSource, tableOwnerConnected: Boolean(evidence.tableElement && evidence.tableElement.isConnected !== false), viewport: clone(evidence.viewport || null),
      tableRect: roundedRect(evidence.tableRect), tableViewportRect: roundedRect(evidence.tableRect), tableTransform: clone(evidence.tableTransform || null), boardCandidates: (evidence.wrapperCandidates || []).map(publicCandidate),
      chosenCanonicalBoardSource: state.canonicalBoardSource, canonicalBoardLocalRect: roundedRect(state.canonicalBoardLocalRect), canonicalBoardRect: canonical, canonicalBoardViewportRect: canonical, canonicalBoardVerified: state.canonicalBoardVerified === true,
      actualVisibleCardRects: (evidence.cardEntries || []).map(function (entry) { return roundedRect(entry.rect); }), observedFirstVisibleCardRect: roundedRect(sameRow(evidence.cardEntries || [])[0] && (sameRow(evidence.cardEntries || [])[0].rect || sameRow(evidence.cardEntries || [])[0])), validationOnlyActualCardRects: (evidence.cardEntries || []).map(function (entry) { return roundedRect(entry.rect); }),
      validationOnlyActualCardLocalRects: clone(result.validation && result.validation.actualCardLocalRects || []), cardValidation: clone(result.validation || null), actualCardUnion: roundedRect(union((evidence.cardEntries || []).map(function (entry) { return entry.rect; }))),
      explicitSlotRects: (evidence.slotEntries || []).map(function (entry) { return roundedRect(entry.rect); }), pitchEvidence: result.validation && result.validation.pitch ? clone(result.validation.pitch) : clone(result.pitch || null), reconstructionStrategy: 'immutable table-local five-card slot within layout epoch',
      leftCompanionRect: left, canonicalLeftCompanionRect: left, rightCompanionRect: right, canonicalRightCompanionRect: right, lastKnownGoodBoardRect: roundedRect(state.lastKnownGood && state.lastKnownGood.viewportRect),
      cachedGeometryReused: result.cachedGeometryReused === true, fallback: result.fallback || null, invalidationReason: state.invalidationReason, collisionReason: context.collisionReason || null, street: context.street || null,
      boardCardCount: (evidence.cardEntries || []).length, settingsVisible: context.settingsVisible === true, layoutResolutionTrigger: context.trigger || null, lifecycleState: context.lifecycleState || null, widgetVisibleReason: context.widgetVisibleReason || null, contentState: context.contentState || null,
      potOddsActualRect: roundedRect(context.potOddsActualRect), actualPotOddsRect: roundedRect(context.potOddsActualRect), persistedOffsetX: Number.isFinite(Number(context.persistedOffsetX)) ? Number(context.persistedOffsetX) : 0, persistedOffsetY: Number.isFinite(Number(context.persistedOffsetY)) ? Number(context.persistedOffsetY) : 0,
      featureOffset: { x: Number.isFinite(Number(context.persistedOffsetX)) ? Number(context.persistedOffsetX) : 0, y: Number.isFinite(Number(context.persistedOffsetY)) ? Number(context.persistedOffsetY) : 0 }, unclampedActualRect: roundedRect(context.unclampedActualRect), actualPanelRect: roundedRect(context.actualPanelRect || context.potOddsActualRect),
      viewportClampApplied: context.viewportClampApplied === true, draggingNow: context.draggingNow === true, dragState: clone(context.dragState || null), resetPending: context.resetPending === true, resetState: { pending: context.resetPending === true, offsetIsZero: number(context.persistedOffsetX) === 0 && number(context.persistedOffsetY) === 0 }, offsetMutationSource: context.offsetMutationSource || null, gapToCanonicalBoard: context.potOddsActualRect && canonical ? Math.round((canonical.left - normalizedRect(context.potOddsActualRect).right) * 10) / 10 : null,
      latestIllegalCanonicalGeometryChange: state.illegalChanges.length ? clone(state.illegalChanges[state.illegalChanges.length - 1]) : null, illegalCanonicalGeometryChanges: clone(state.illegalChanges), acceptedLayoutEpochChanges: clone(state.epochHistory), rejectedOwnedTableCandidates: clone(evidence.rejectedOwnedTableCandidates || []), dom: clone(evidence.domNodes || [])
    };
  }

  function resolveEvidence(state, evidence, options) {
    options = options || {}; evidence = evidence || {}; var context = options.context || {};
    var incomingTableId = evidence.tableId || options.tableId || state.tableId || null; evidence.tableId = incomingTableId;
    evidence.tableOwnerSource = evidence.tableOwnerSource || tableOwnerSource(evidence.tableElement, Boolean(options.tableElement));
    if (settingsGeometrySignal(context) && state.tableElement && state.tableElement.isConnected !== false && evidence.tableElement && evidence.tableElement !== state.tableElement) {
      recordIllegalChange(state, state.canonicalBoardLocalRect, context, evidence, evidence.tableOwnerSource, 'ILLEGAL_SETTINGS_GEOMETRY_CHANGE');
      evidence = Object.assign({}, evidence, {
        tableElement: state.tableElement, tableOwnerSource: state.tableOwnerSource, tableRect: clone(state.tableRect), tableTransform: clone(state.tableTransform)
      });
    }
    var tableRect = normalizedRect(evidence.tableRect); var viewportRect = normalizedRect({ left: 0, top: 0, width: evidence.viewport && evidence.viewport.width, height: evidence.viewport && evidence.viewport.height });
    var nextSignature = tableRect ? epochSignature(evidence, tableRect) : null;
    var ownerChanged = Boolean(state.tableElement && evidence.tableElement && state.tableElement !== evidence.tableElement);
    var epochChanged = Boolean(nextSignature && (!state.layoutEpochId || ownerChanged || !sameEpochSignature(state.epochSignature, nextSignature)));
    var previousSignal = clone(state.signalEssentials);
    var changeReason = epochChanged ? epochChangeReason(state, evidence, nextSignature) : null;

    state.tableId = incomingTableId; state.tableElement = evidence.tableElement || state.tableElement; state.tableOwnerSource = evidence.tableOwnerSource || state.tableOwnerSource;
    state.viewportRect = viewportRect || state.viewportRect; state.tableRect = tableRect || state.tableRect; state.tableTransform = clone(evidence.tableTransform || state.tableTransform);

    // A bootstrap estimate is provisional. Complete it once real five-slot evidence
    // arrives, then retain the verified model for the rest of this table epoch.
    // Settings transitions cannot supply or authorize that completion.
    var measuredBootstrap = !epochChanged && !state.canonicalBoardVerified && tableRect && !settingsGeometrySignal(context)
      ? establishCanonicalLocal(evidence, nextSignature, state) : null;
    var bootstrapCompleted = Boolean(measuredBootstrap && measuredBootstrap.verified);
    var geometryChanged = epochChanged || bootstrapCompleted && materiallyDifferent(measuredBootstrap.rect, state.canonicalBoardLocalRect);
    var established = null;
    if (epochChanged || bootstrapCompleted) {
      established = bootstrapCompleted ? measuredBootstrap : establishCanonicalLocal(evidence, nextSignature, state);
      if (epochChanged) {
        state.layoutEpochSequence += 1;
        state.layoutEpochId = String(incomingTableId || 'pokernow-table').replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) + ':layout-epoch-' + state.layoutEpochSequence;
      } else {
        changeReason = 'provisional table-local bootstrap completed by first measured five-card envelope';
      }
      state.epochSignature = clone(nextSignature); state.canonicalBoardLocalRect = normalizedRect(established.rect); state.canonicalBoardSource = established.source; state.canonicalBoardVerified = established.verified === true; state.canonicalChangeReason = changeReason; state.invalidationReason = null;
      if (established.verified && state.canonicalBoardLocalRect) {
        var establishedSpace = localSpace(nextSignature);
        state.verifiedModel = { rect: clone(state.canonicalBoardLocalRect), pitch: clone(established.pitch), localWidth: establishedSpace.width, localHeight: establishedSpace.height, layoutMode: nextSignature.layoutMode || null, source: established.source, observedAt: Date.now() };
      }
      if (epochChanged) state.epochHistory.push({ layoutEpochId: state.layoutEpochId, timestamp: Date.now(), reason: changeReason, tableOwnerSource: state.tableOwnerSource, viewport: clone(evidence.viewport || null), tableViewportRect: roundedRect(tableRect), tableTransform: clone(evidence.tableTransform || null), canonicalBoardLocalRect: roundedRect(state.canonicalBoardLocalRect), canonicalBoardSource: state.canonicalBoardSource });
      if (state.epochHistory.length > 32) state.epochHistory.shift();
    } else if (state.layoutEpochId && tableRect) {
      var structural = structuralSlotEnvelope(evidence); var proposedLocal = structural && viewportToLocal(structural.rect, tableRect, state.epochSignature);
      if (proposedLocal && materiallyDifferent(proposedLocal, state.canonicalBoardLocalRect)) recordIllegalChange(state, proposedLocal, context, evidence, structural.source);
    }

    var canonicalViewport = state.canonicalBoardLocalRect && tableRect ? localToViewport(state.canonicalBoardLocalRect, tableRect, state.epochSignature || nextSignature) : null;
    var validation = validateActualCards(state.canonicalBoardLocalRect, evidence, state.epochSignature || nextSignature);
    if (validation.status === 'validation-disagreement') {
      state.validationHistory.push({ timestamp: Date.now(), layoutEpochId: state.layoutEpochId, trigger: context.trigger || null, street: context.street || null, boardCardCount: validation.cardCount, status: validation.status, mismatches: clone(validation.mismatches) });
      if (state.validationHistory.length > 64) state.validationHistory.shift();
    }
    if (canonicalViewport) {
      state.lastKnownGood = { localRect: clone(state.canonicalBoardLocalRect), viewportRect: clone(canonicalViewport), source: state.canonicalBoardSource, layoutEpochId: state.layoutEpochId, timestamp: Date.now() };
      state.lastResolved = { rect: clone(canonicalViewport), source: state.canonicalBoardSource, timestamp: Date.now() };
    }
    var currentStructuralEvidence = structuralSlotEnvelope(evidence);
    var cachedGeometryReused = Boolean(!epochChanged && !bootstrapCompleted && !currentStructuralEvidence && canonicalViewport);
    var result = { rect: canonicalViewport, source: state.canonicalBoardSource, verified: state.canonicalBoardVerified, epochChanged: epochChanged, geometryChanged: geometryChanged, cachedGeometryReused: cachedGeometryReused, validation: validation, pitch: established && established.pitch || null, fallback: established && established.fallback || (!state.canonicalBoardVerified ? 'table-local bootstrap model; fresh live alignment signoff pending' : null) };
    var nextSignal = signalEssentials(state, { tableId: incomingTableId, layoutEpochId: state.layoutEpochId, tableOwnerSource: state.tableOwnerSource, viewport: evidence.viewport || null, tableRect: tableRect, tableTransform: evidence.tableTransform || null, canonicalBoardLocalRect: state.canonicalBoardLocalRect, canonicalBoardRect: canonicalViewport, canonicalBoardSource: state.canonicalBoardSource, canonicalBoardVerified: state.canonicalBoardVerified, canonicalChangeReason: state.canonicalChangeReason, invalidationReason: state.invalidationReason });
    var signalChanged = !sameSignal(previousSignal, nextSignal); if (signalChanged) state.revision += 1;
    var sizes = { left: options.leftSize || { width: 100, height: 60 }, right: options.rightSize || options.leftSize || { width: 100, height: 60 } };
    var info = makePublicInfo(state, evidence, result, sizes, context); info.boardAlignment = boardAlignment(info); info.expectedFirstSlotRect = clone(info.boardAlignment.expectedFirstSlotRect); var historyEntry = clone(info); delete historyEntry.history; delete historyEntry.illegalCanonicalGeometryChanges; delete historyEntry.acceptedLayoutEpochChanges;
    state.history.push(historyEntry); if (state.history.length > state.maxHistory) state.history.shift(); info.history = clone(state.history); state.lastInfo = info; state.signalEssentials = nextSignal;
    if (signalChanged) emitChange(state, epochChanged || bootstrapCompleted ? state.canonicalChangeReason : !previousSignal || !previousSignal.geometryAvailable && nextSignal.geometryAvailable ? 'stable table-local board-companion geometry became placement-capable' : 'placement-capable table-layout input materially changed', previousSignal, nextSignal);
    var wrappers = evidence.wrapperCandidates || [];
    return { canonicalBoardRect: normalizedRect(canonicalViewport), canonicalBoardLocalRect: normalizedRect(state.canonicalBoardLocalRect), leftCompanionRect: companionRect(canonicalViewport, 'left', sizes.left, BOARD_GAP), rightCompanionRect: companionRect(canonicalViewport, 'right', sizes.right, BOARD_GAP), source: state.canonicalBoardSource || null, verified: state.canonicalBoardVerified === true, cachedGeometryReused: cachedGeometryReused, layoutEpochId: state.layoutEpochId, tableOwnerSource: state.tableOwnerSource, observerElement: evidence.tableElement || null, resizeElements: uniqueElements([evidence.tableElement].concat(wrappers.map(function (candidate) { return candidate.element; }))), info: clone(info) };
  }

  function resolveDom(state, options) {
    options = options || {};
    return resolveEvidence(state, collectDomEvidence(options.document || root.document, options.window || root, options), options);
  }

  function layoutInfo(state) { return state && state.lastInfo ? clone(state.lastInfo) : null; }

  function updateContext(state, context) {
    if (!state || !state.lastInfo) return null;
    context = context || {}; var info = state.lastInfo;
    if (Object.prototype.hasOwnProperty.call(context, 'potOddsActualRect')) { info.potOddsActualRect = roundedRect(context.potOddsActualRect); info.actualPotOddsRect = roundedRect(context.potOddsActualRect); }
    if (Object.prototype.hasOwnProperty.call(context, 'collisionReason')) info.collisionReason = context.collisionReason || null;
    if (Object.prototype.hasOwnProperty.call(context, 'street')) info.street = context.street || null;
    if (Object.prototype.hasOwnProperty.call(context, 'settingsVisible')) info.settingsVisible = context.settingsVisible === true;
    if (Object.prototype.hasOwnProperty.call(context, 'layoutResolutionTrigger')) info.layoutResolutionTrigger = context.layoutResolutionTrigger || null;
    if (Object.prototype.hasOwnProperty.call(context, 'lifecycleState')) info.lifecycleState = context.lifecycleState || null;
    if (Object.prototype.hasOwnProperty.call(context, 'widgetVisibleReason')) info.widgetVisibleReason = context.widgetVisibleReason || null;
    if (Object.prototype.hasOwnProperty.call(context, 'contentState')) info.contentState = context.contentState || null;
    if (Object.prototype.hasOwnProperty.call(context, 'persistedOffsetX')) info.persistedOffsetX = Number.isFinite(Number(context.persistedOffsetX)) ? Number(context.persistedOffsetX) : 0;
    if (Object.prototype.hasOwnProperty.call(context, 'persistedOffsetY')) info.persistedOffsetY = Number.isFinite(Number(context.persistedOffsetY)) ? Number(context.persistedOffsetY) : 0;
    info.featureOffset = { x: info.persistedOffsetX || 0, y: info.persistedOffsetY || 0 };
    if (Object.prototype.hasOwnProperty.call(context, 'unclampedActualRect')) info.unclampedActualRect = roundedRect(context.unclampedActualRect);
    if (Object.prototype.hasOwnProperty.call(context, 'actualPanelRect')) info.actualPanelRect = roundedRect(context.actualPanelRect);
    if (Object.prototype.hasOwnProperty.call(context, 'viewportClampApplied')) info.viewportClampApplied = context.viewportClampApplied === true;
    if (Object.prototype.hasOwnProperty.call(context, 'draggingNow')) info.draggingNow = context.draggingNow === true;
    if (Object.prototype.hasOwnProperty.call(context, 'dragState')) info.dragState = clone(context.dragState || null);
    if (Object.prototype.hasOwnProperty.call(context, 'resetPending')) info.resetPending = context.resetPending === true;
    info.resetState = { pending: info.resetPending === true, offsetIsZero: number(info.persistedOffsetX) === 0 && number(info.persistedOffsetY) === 0 };
    if (Object.prototype.hasOwnProperty.call(context, 'offsetMutationSource')) info.offsetMutationSource = context.offsetMutationSource || null;
    if (info.potOddsActualRect && info.canonicalBoardRect) info.gapToCanonicalBoard = Math.round((info.canonicalBoardRect.left - info.potOddsActualRect.right) * 10) / 10;
    info.boardAlignment = boardAlignment(info); info.expectedFirstSlotRect = clone(info.boardAlignment.expectedFirstSlotRect);
    if (info.history && info.history.length) {
      var latest = info.history[info.history.length - 1];
      ['potOddsActualRect', 'actualPotOddsRect', 'gapToCanonicalBoard', 'collisionReason', 'street', 'settingsVisible', 'layoutResolutionTrigger', 'lifecycleState', 'widgetVisibleReason', 'contentState', 'persistedOffsetX', 'persistedOffsetY', 'featureOffset', 'unclampedActualRect', 'actualPanelRect', 'viewportClampApplied', 'draggingNow', 'dragState', 'resetPending', 'resetState', 'offsetMutationSource', 'boardAlignment', 'expectedFirstSlotRect'].forEach(function (key) { latest[key] = clone(info[key]); });
    }
    if (state.history.length && info.history && info.history.length) state.history[state.history.length - 1] = clone(info.history[info.history.length - 1]);
    return clone(info);
  }

  function captureLayoutSnapshot(state) {
    var info = layoutInfo(state); if (!info) return null;
    return {
      schemaVersion: 3, capturedAt: Date.now(), privacy: 'geometry and board-layout identifiers only; no names, card values, or chat', fixtureWorkflow: 'capture in live PokerNow DevTools, sanitize, save exact geometry as a regression fixture',
      layoutEpochId: info.layoutEpochId, layoutEpochSequence: info.layoutEpochSequence, tableOwnerSource: info.tableOwnerSource, tableOwnerConnected: info.tableOwnerConnected,
      viewport: info.viewport, tableViewportRect: info.tableViewportRect, tableTransform: info.tableTransform, boardCandidates: info.boardCandidates, chosenCanonicalBoardSource: info.chosenCanonicalBoardSource,
      canonicalBoardLocalRect: info.canonicalBoardLocalRect, canonicalBoardRect: info.canonicalBoardViewportRect, canonicalBoardViewportRect: info.canonicalBoardViewportRect, canonicalGeometryChanged: info.canonicalGeometryChanged, canonicalGeometryChangeReason: info.canonicalGeometryChangeReason, lastAcceptedCanonicalChangeReason: info.lastAcceptedCanonicalChangeReason,
      validationOnlyActualCardRects: info.validationOnlyActualCardRects, validationOnlyActualCardLocalRects: info.validationOnlyActualCardLocalRects, observedFirstVisibleCardRect: info.observedFirstVisibleCardRect, expectedFirstSlotRect: info.expectedFirstSlotRect, boardAlignment: info.boardAlignment, cardValidation: info.cardValidation, actualCardUnion: info.actualCardUnion, explicitSlotRects: info.explicitSlotRects, pitchEvidence: info.pitchEvidence,
      leftCompanionRect: info.canonicalLeftCompanionRect, rightCompanionRect: info.canonicalRightCompanionRect,
      canonicalLeftCompanionRect: info.canonicalLeftCompanionRect, canonicalRightCompanionRect: info.canonicalRightCompanionRect, featureOffset: info.featureOffset, potOddsActualRect: info.potOddsActualRect, actualPotOddsRect: info.actualPotOddsRect, unclampedActualRect: info.unclampedActualRect, actualPanelRect: info.actualPanelRect,
      viewportClampApplied: info.viewportClampApplied, draggingNow: info.draggingNow, dragState: info.dragState, resetPending: info.resetPending, resetState: info.resetState, offsetMutationSource: info.offsetMutationSource, gapToCanonicalBoard: info.gapToCanonicalBoard, street: info.street, boardCardCount: info.boardCardCount, settingsVisible: info.settingsVisible, layoutResolutionTrigger: info.layoutResolutionTrigger,
      cachedGeometryReused: info.cachedGeometryReused, fallback: info.fallback, collisionReason: info.collisionReason, lifecycleState: info.lifecycleState, contentState: info.contentState,
      latestIllegalCanonicalGeometryChange: info.latestIllegalCanonicalGeometryChange, acceptedLayoutEpochChanges: info.acceptedLayoutEpochChanges, rejectedOwnedTableCandidates: info.rejectedOwnedTableCandidates, dom: info.dom
    };
  }

  var api = Object.freeze({
    BOARD_SELECTORS: BOARD_SELECTORS, SLOT_SELECTORS: SLOT_SELECTORS, TABLE_SELECTORS: TABLE_SELECTORS, DEFAULT_MODEL: DEFAULT_MODEL,
    createState: createState, invalidate: invalidate, subscribe: subscribe, collectDomEvidence: collectDomEvidence, resolveEvidence: resolveEvidence, resolveDom: resolveDom,
    companionRect: companionRect, updateContext: updateContext, layoutInfo: layoutInfo, captureLayoutSnapshot: captureLayoutSnapshot
  });
  root.PokerBoardCompanionLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
