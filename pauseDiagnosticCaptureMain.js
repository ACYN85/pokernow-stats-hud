/* Pure, bounded Pause/Resume diagnostic capture and export helpers. */
(function (root) {
  'use strict';
  var LIMITS = Object.freeze({ maxEntries: 900, maxSockets: 48, maxMarkers: 12, maxClicks: 12, maxSnapshots: 48, maxPayloadExcerpt: 1200, maxDecodedExcerpt: 2400, maxExportBytes: 700000, preArmMs: 2000, postArmMs: 8000, preClickMs: 2000, postClickMs: 6000 });
  var SECRET_KEY = /authorization|cookie|password|passwd|secret|token|api[-_]?key|session[-_]?id|jwt|credential/i;
  var SECRET_TEXT = /((?:authorization|cookie|password|passwd|secret|token|api[-_]?key|session[-_]?id|jwt|credential)\s*["']?\s*[:=]\s*["']?)([^"',;\s}]+)/ig;
  function now(value) { return Number(value || Date.now()); }
  function clone(value) { if (value === undefined) return undefined; try { return JSON.parse(JSON.stringify(value)); } catch (error) { return String(value); } }
  function trimOldest(list, limit, truncation, key) { while (list.length > limit) { list.shift(); truncation[key] = Number(truncation[key] || 0) + 1; } }
  function redactText(value, metadata) {
    var text = String(value === undefined || value === null ? '' : value); var count = 0;
    text = text.replace(SECRET_TEXT, function (match, prefix) { count += 1; return prefix + '[REDACTED]'; });
    text = text.replace(/([?&](?:auth|authorization|password|secret|token|api_key|apikey|session|session_id|key)=)([^&#]*)/ig, function (match, prefix) { count += 1; return prefix + '[REDACTED]'; });
    if (metadata && count) metadata.redactedValues += count; return text;
  }
  function sanitizeUrl(value, metadata) {
    var text = redactText(value, metadata);
    try { var parsed = new URL(text, 'https://diagnostic.invalid/'); parsed.searchParams.forEach(function (item, key) { if (SECRET_KEY.test(key)) { parsed.searchParams.set(key, '[REDACTED]'); if (metadata) metadata.redactedValues += 1; } }); return parsed.origin === 'https://diagnostic.invalid' ? parsed.pathname + parsed.search + parsed.hash : parsed.toString(); } catch (error) { return text; }
  }
  function sanitizeValue(value, metadata, depth, seen) {
    depth = Number(depth || 0); seen = seen || [];
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactText(value, metadata);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value !== 'object') return String(value);
    if (seen.indexOf(value) >= 0) return '[CIRCULAR]';
    if (depth >= 5) return '[DEPTH-LIMIT]';
    seen.push(value);
    if (Array.isArray(value)) { var arrayValue = value.slice(0, 40).map(function (item) { return sanitizeValue(item, metadata, depth + 1, seen); }); if (value.length > 40) arrayValue.push('[TRUNCATED ' + (value.length - 40) + ' ITEMS]'); seen.pop(); return arrayValue; }
    var output = {};
    Object.keys(value).slice(0, 50).forEach(function (key) { if (SECRET_KEY.test(key) || /^headers?$/i.test(key)) { output[key] = '[REDACTED]'; if (metadata) { metadata.redactedFields += 1; if (/^headers?$/i.test(key)) metadata.headersOmitted += 1; } } else output[key] = sanitizeValue(value[key], metadata, depth + 1, seen); });
    if (Object.keys(value).length > 50) output.__truncatedKeys = Object.keys(value).length - 50; seen.pop(); return output;
  }
  function boundedText(value, limit, metadata) { var text; try { text = typeof value === 'string' ? value : JSON.stringify(sanitizeValue(value, metadata)); } catch (error) { text = String(value); } text = redactText(text, metadata); limit = Number(limit || LIMITS.maxPayloadExcerpt); return { excerpt: text.slice(0, limit), originalLength: text.length, truncated: text.length > limit }; }
  function decodeFrameText(value, metadata) {
    var packets = String(value || '').split('\x1e').slice(0, 12); var decoded = []; var parseErrors = [];
    packets.forEach(function (packet, index) { var engineType = /^[0-6]/.test(packet) ? packet.charAt(0) : null; var socketText = engineType === '4' ? packet.slice(1) : packet; var socketType = /^[0-6]/.test(socketText) ? socketText.charAt(0) : null; var jsonText = socketType ? socketText.slice(1) : socketText; var namespace = '/'; if (socketType && jsonText.charAt(0) === '/') { var comma = jsonText.indexOf(','); if (comma >= 0) { namespace = jsonText.slice(0, comma); jsonText = jsonText.slice(comma + 1); } } var parsed = null; if (jsonText && /^[\[{]/.test(jsonText)) { try { parsed = sanitizeValue(JSON.parse(jsonText), metadata); } catch (error) { parseErrors.push({ packetIndex: index, message: String(error.message || error).slice(0, 180) }); } } decoded.push({ packetIndex: index, engineIoPacketType: engineType, socketIoPacketType: socketType, namespace: namespace, eventName: Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : null, decodedJson: parsed }); });
    var bounded = boundedText(decoded, LIMITS.maxDecodedExcerpt, metadata);
    return { packets: bounded.truncated ? bounded.excerpt : decoded, truncated: bounded.truncated, parseErrors: parseErrors, socketIoOrEngineIoCandidate: decoded.some(function (item) { return item.engineIoPacketType !== null || item.socketIoPacketType !== null; }), carriesKnownGcTraffic: decoded.some(function (item) { return item.eventName === 'gC'; }) };
  }
  function payloadDetails(value, metadata) {
    if (typeof value === 'string') { var text = boundedText(value, LIMITS.maxPayloadExcerpt, metadata); return { dataType: 'text', payloadExcerpt: text.excerpt, payloadOriginalLength: text.originalLength, payloadTruncated: text.truncated, framing: decodeFrameText(text.excerpt, metadata) }; }
    if (value && typeof Blob !== 'undefined' && value instanceof Blob) return { dataType: 'blob', byteLength: value.size, mimeType: value.type || null, payloadExcerpt: null, payloadTruncated: value.size > LIMITS.maxPayloadExcerpt };
    if (value && typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) return { dataType: value instanceof ArrayBuffer ? 'arraybuffer' : 'typed-array', byteLength: value.byteLength, payloadExcerpt: null, payloadTruncated: value.byteLength > LIMITS.maxPayloadExcerpt };
    var json = boundedText(value, LIMITS.maxPayloadExcerpt, metadata); return { dataType: value === null ? 'null' : typeof value, payloadExcerpt: json.excerpt, payloadOriginalLength: json.originalLength, payloadTruncated: json.truncated, decodedJson: sanitizeValue(value, metadata) };
  }
  function createState(options) {
    options = options || {};
    return { enabled: options.enabled === true, buildId: String(options.buildId || 'unknown-build'), extensionVersion: String(options.extensionVersion || 'unknown-version'), createdAt: now(options.createdAt), captureStartedAt: options.enabled === true ? now(options.createdAt) : null, captureEndedAt: null, sequence: 0, pendingMarker: null, markerCheckpoints: [], clickedElements: [], sockets: [], entries: [], pageStateSnapshots: [], truncation: { entriesDropped: 0, socketsDropped: 0, markersDropped: 0, clicksDropped: 0, snapshotsDropped: 0, exportEntriesDropped: 0, exportBytesBeforeTruncation: 0 }, redaction: { policy: 'authorization/cookies/credentials/secrets/tokens/API keys/session identifiers and all header collections are omitted or replaced', redactedFields: 0, redactedValues: 0, headersOmitted: 0 }, instances: { contentScriptInstanceId: options.contentScriptInstanceId || null, websocketHookInstanceId: options.websocketHookInstanceId || null, runtimeStatusStoreInstanceId: options.runtimeStatusStoreInstanceId || null, hudRendererInstanceId: options.hudRendererInstanceId || null } };
  }
  function setEnabled(state, enabled, timestamp) { state.enabled = enabled === true; var at = now(timestamp); if (state.enabled) { if (!state.captureStartedAt) state.captureStartedAt = at; state.captureEndedAt = null; } else if (state.captureStartedAt) { state.captureEndedAt = at; state.pendingMarker = null; } return state.enabled; }
  function clearCapture(state, timestamp) { state.sequence = 0; state.pendingMarker = null; state.markerCheckpoints = []; state.clickedElements = []; state.sockets = []; state.entries = []; state.pageStateSnapshots = []; Object.keys(state.truncation).forEach(function (key) { state.truncation[key] = 0; }); state.redaction.redactedFields = 0; state.redaction.redactedValues = 0; state.redaction.headersOmitted = 0; state.captureStartedAt = state.enabled ? now(timestamp) : null; state.captureEndedAt = null; return state; }
  function recordSocket(state, input) {
    input = input || {}; var id = String(input.socketId || ''); if (!id) return null; var socket = state.sockets.find(function (candidate) { return candidate.socketId === id; });
    if (!socket) { socket = { socketId: id, creationOrder: Number(input.creationOrder || state.sockets.length + 1), url: sanitizeUrl(input.url || '', state.redaction), protocols: sanitizeValue(input.protocols || [], state.redaction), createdAt: now(input.createdAt), lifecycle: [], carriesKnownGcTraffic: false }; state.sockets.push(socket); trimOldest(state.sockets, LIMITS.maxSockets, state.truncation, 'socketsDropped'); }
    if (input.hookInstanceId) state.instances.websocketHookInstanceId = String(input.hookInstanceId); if (input.carriesKnownGcTraffic) socket.carriesKnownGcTraffic = true;
    if (input.lifecycleType) { socket.lifecycle.push({ type: String(input.lifecycleType), timestamp: now(input.timestamp), code: input.code === undefined ? null : Number(input.code), reason: input.reason ? boundedText(input.reason, 240, state.redaction).excerpt : null, wasClean: input.wasClean === true }); if (socket.lifecycle.length > 20) socket.lifecycle.shift(); }
    return socket;
  }
  function recordEntry(state, input) {
    if (!state.enabled) return null; input = input || {};
    var entry = { entryId: 'pause-diagnostic-' + (++state.sequence), timestamp: now(input.timestamp), api: String(input.api || input.transport || 'unknown'), direction: String(input.direction || 'unknown'), socketId: input.socketId || null, url: input.url ? sanitizeUrl(input.url, state.redaction) : null, target: input.target ? sanitizeUrl(input.target, state.redaction) : null, method: input.method ? String(input.method).slice(0, 24) : null, eventType: input.eventType ? String(input.eventType).slice(0, 120) : null, status: input.status === undefined ? null : Number(input.status), lifecycleType: input.lifecycleType || null, payload: input.payloadDetails ? sanitizeValue(input.payloadDetails, state.redaction) : payloadDetails(input.payload, state.redaction), parseError: input.parseError ? boundedText(input.parseError, 300, state.redaction).excerpt : null, markerCorrelation: null, correlationStartSource: null, millisecondsFromMarkerArm: null, millisecondsFromMarkedClick: null };
    state.entries.push(entry); trimOldest(state.entries, LIMITS.maxEntries, state.truncation, 'entriesDropped'); if (entry.socketId && entry.payload && entry.payload.framing && entry.payload.framing.carriesKnownGcTraffic) recordSocket(state, { socketId: entry.socketId, carriesKnownGcTraffic: true }); return entry;
  }
  function armMarker(state, marker, timestamp) {
    if (!state.enabled) return null; marker = String(marker || '').toLowerCase(); if (marker !== 'pause' && marker !== 'resume') return null;
    var at = now(timestamp);
    if (state.pendingMarker) { var replaced = state.markerCheckpoints.find(function (item) { return item.checkpointId === state.pendingMarker.checkpointId; }); if (replaced && replaced.status === 'active') { replaced.status = 'replaced-before-completion'; replaced.replacedAt = at; } }
    var checkpoint = { checkpointId: 'pause-window-' + (state.markerCheckpoints.length + 1) + '-' + at, marker: marker, armedAt: at, windowStart: at - LIMITS.preArmMs, windowEnd: at + LIMITS.postArmMs, completedAt: null, status: 'active', correlationStartSource: 'marker-armed', activationObserved: 'unknown', activationEvents: [] };
    state.markerCheckpoints.push(checkpoint); trimOldest(state.markerCheckpoints, LIMITS.maxMarkers, state.truncation, 'markersDropped'); state.pendingMarker = { checkpointId: checkpoint.checkpointId, marker: marker, armedAt: at, windowEnd: checkpoint.windowEnd }; return checkpoint;
  }
  function completeMarkerWindow(state, checkpointId, timestamp) {
    if (!state.enabled) return null; var checkpoint = state.markerCheckpoints.find(function (item) { return item.checkpointId === checkpointId; });
    if (!checkpoint || checkpoint.status !== 'active') return checkpoint || null;
    checkpoint.status = 'completed'; checkpoint.completedAt = now(timestamp);
    if (state.pendingMarker && state.pendingMarker.checkpointId === checkpoint.checkpointId) state.pendingMarker = null;
    return checkpoint;
  }
  function recordActivation(state, checkpointId, activationType, details, timestamp) {
    if (!state.enabled) return null; var id = checkpointId || (state.pendingMarker && state.pendingMarker.checkpointId); var checkpoint = state.markerCheckpoints.find(function (item) { return item.checkpointId === id; }); var at = now(timestamp);
    if (!checkpoint || checkpoint.status !== 'active' || at < checkpoint.armedAt || at > checkpoint.windowEnd) return null;
    var type = /^(?:keyboard|pointer|transport-only)$/.test(String(activationType || '')) ? String(activationType) : 'unknown';
    if (type === 'keyboard' || type === 'pointer' || checkpoint.activationObserved === 'unknown') checkpoint.activationObserved = type;
    checkpoint.activationEvents.push({ timestamp: at, type: type, details: sanitizeValue(details || {}, state.redaction) }); if (checkpoint.activationEvents.length > 16) checkpoint.activationEvents.shift(); return checkpoint;
  }
  function cancelMarker(state, reason, timestamp) {
    if (!state.enabled || !state.pendingMarker) return null;
    var pending = state.pendingMarker; state.pendingMarker = null;
    var checkpoint = state.markerCheckpoints.find(function (item) { return item.checkpointId === pending.checkpointId; });
    if (checkpoint) { checkpoint.status = 'canceled'; checkpoint.canceledAt = now(timestamp); checkpoint.cancelReason = String(reason || 'canceled'); }
    return checkpoint || pending;
  }
  function ignoreArmedClick(state, details, reason, timestamp) {
    if (!state.enabled || !state.pendingMarker) return null;
    return recordEntry(state, {
      timestamp: now(timestamp), api: 'marker-ownership', direction: 'ignored', eventType: String(reason || 'ignored-click'),
      payload: { checkpointId: state.pendingMarker.checkpointId, marker: state.pendingMarker.marker, reason: String(reason || 'ignored-click'), click: details || {} }
    });
  }
  function extensionUiOwnership(event, extraRootIds) {
    var rootIds = ['pokernow-stats-hud-root', 'pnhud-details-root', 'pnhud-overlay-root', 'pnhud-toggle-root', 'pnhud-settings-launcher', 'pnhud-settings-panel', 'pnhud-stat-tooltip', 'pnhud-bootstrap-badge', 'pnhud-pause-marker-indicator'].concat(extraRootIds || []);
    var path = [];
    try { if (event && typeof event.composedPath === 'function') path = event.composedPath() || []; } catch (error) {}
    if (!path.length && event && event.target) { var current = event.target; while (current && path.length < 30) { path.push(current); current = current.parentNode || current.parentElement || current.host || null; } }
    var summaries = [];
    function inspect(node) {
      if (!node) return null;
      if (node.host) { var hostMatch = inspect(node.host); if (hostMatch) return hostMatch; }
      var id = String(node.id || '');
      var classes = [];
      try { classes = Array.from(node.classList || []); } catch (error) {}
      var ownedAttribute = false;
      try { ownedAttribute = Boolean(node.dataset && Object.keys(node.dataset).some(function (key) { return /^pnhud/.test(key); })) || Boolean(node.getAttribute && node.getAttribute('data-pnhud-owned') === 'true'); } catch (error) {}
      summaries.push({ nodeName: String(node.nodeName || node.tagName || ''), id: id.slice(0, 100), classes: classes.slice(0, 6) });
      if (rootIds.indexOf(id) >= 0) return 'root-id:' + id;
      if (/^(?:pnhud-|pokernow-stats-hud-root$)/.test(id)) return 'extension-id:' + id;
      var ownedClass = classes.find(function (name) { return /^pnhud-/.test(String(name)); });
      if (ownedClass) return 'extension-class:' + ownedClass;
      if (ownedAttribute) return 'extension-owned-attribute';
      return null;
    }
    for (var index = 0; index < path.length; index += 1) { var matched = inspect(path[index]); if (matched) return { owned: true, matchedBy: matched, pathSummary: summaries.slice(0, 20) }; }
    return { owned: false, matchedBy: null, pathSummary: summaries.slice(0, 20) };
  }
  function clickLooksExtensionOwned(click) {
    if (!click) return false;
    if (click.extensionOwned === true) return true;
    return /pnhud-|pokernow-stats-hud|extension diagnostics/i.test(String(click.selectorPath || '')) || /Mark Next Click:|Clear Capture|Export Pause Capture|PokerNow Stats HUD|Settings/i.test(String(click.visibleText || ''));
  }
  function captureValidity(state) {
    var reasons = []; var invalidCheckpoints = [];
    state.clickedElements.forEach(function (click) {
      if (!clickLooksExtensionOwned(click)) return;
      var markerName = click.marker === 'resume' ? 'Resume' : 'Pause';
      var reason = { code: 'legacy-extension-ui-click', checkpointId: click.checkpointId || null, marker: click.marker || null, selectorPath: click.selectorPath || null, visibleText: click.visibleText || null, message: 'Invalid capture: the ' + markerName + ' marker captured an extension control in the legacy click workflow. Repeat the capture with Mark ' + markerName + ' Window.' };
      reasons.push(reason); invalidCheckpoints.push(reason.checkpointId);
    });
    ['pause', 'resume'].forEach(function (marker) {
      var completed = state.markerCheckpoints.some(function (checkpoint) { return checkpoint.marker === marker && checkpoint.status === 'completed'; });
      if (!completed) reasons.push({ code: 'missing-completed-window', checkpointId: null, marker: marker, message: 'Invalid capture: no completed ' + (marker === 'pause' ? 'Pause' : 'Resume') + ' diagnostic window was recorded.' });
    });
    return { valid: reasons.length === 0, validityRule: 'A valid capture requires completed Pause and Resume marker-armed windows; no click is required.', reasons: reasons, invalidCheckpointIds: invalidCheckpoints.filter(Boolean) };
  }
  function consumeNextClick(state, details, timestamp) {
    if (!state.enabled || !state.pendingMarker) return null;
    if (!details || details.trusted !== true) { ignoreArmedClick(state, details || {}, 'ignored-untrusted-click', timestamp); return null; }
    if (details.extensionOwned === true) { ignoreArmedClick(state, details, 'ignored-extension-ui-click', timestamp); return null; }
    var checkpoint = recordActivation(state, state.pendingMarker.checkpointId, 'pointer', details, timestamp); if (!checkpoint) return null;
    var context = sanitizeValue(Object.assign({ checkpointId: checkpoint.checkpointId, marker: checkpoint.marker, timestamp: now(timestamp), extensionOwned: false }, details || {}), state.redaction);
    recordEntry(state, { timestamp: now(timestamp), api: 'pointer', direction: 'observed', eventType: 'activation-context', payload: context });
    return { checkpoint: checkpoint, activationOnly: true, click: context };
  }
  function recordPageState(state, phase, checkpointId, value, timestamp) { if (!state.enabled) return null; var snapshot = { timestamp: now(timestamp), phase: String(phase || 'unknown'), checkpointId: checkpointId || null, state: sanitizeValue(value || {}, state.redaction) }; state.pageStateSnapshots.push(snapshot); trimOldest(state.pageStateSnapshots, LIMITS.maxSnapshots, state.truncation, 'snapshotsDropped'); return snapshot; }
  function correlationFor(state, timestamp) { return state.markerCheckpoints.filter(function (marker) { return (marker.status === 'active' || marker.status === 'completed') && timestamp >= marker.windowStart && timestamp <= marker.windowEnd; }).map(function (marker) { return { checkpointId: marker.checkpointId, marker: marker.marker, correlationStartSource: 'marker-armed', millisecondsFromMarkerArm: timestamp - marker.armedAt }; }); }
  function correlatedEntries(state) { return state.entries.map(function (entry) { var copy = clone(entry); var correlations = correlationFor(state, copy.timestamp); copy.markerCorrelations = correlations; copy.markerCorrelation = correlations.length ? correlations[correlations.length - 1].marker : null; copy.correlationStartSource = correlations.length ? 'marker-armed' : null; copy.millisecondsFromMarkerArm = correlations.length ? correlations[correlations.length - 1].millisecondsFromMarkerArm : null; copy.millisecondsFromMarkedClick = null; return copy; }).filter(function (entry) { return entry.markerCorrelations.length > 0; }); }
  function correlatedSnapshots(state) { return state.pageStateSnapshots.map(function (snapshot) { var copy = clone(snapshot); copy.markerCorrelations = correlationFor(state, copy.timestamp); copy.correlationStartSource = copy.markerCorrelations.length ? 'marker-armed' : null; copy.millisecondsFromMarkerArm = copy.markerCorrelations.length ? copy.markerCorrelations[copy.markerCorrelations.length - 1].millisecondsFromMarkerArm : null; return copy; }).filter(function (snapshot) { return snapshot.markerCorrelations.length > 0; }); }
  function createExport(state, extras, timestamp) {
    extras = extras || {}; var correlated = correlatedEntries(state); var snapshots = correlatedSnapshots(state);
    var transportApis = ['websocket', 'fetch', 'xhr', 'sendBeacon', 'postMessage', 'custom-event'];
    function markerOrder(checkpointId) { return state.markerCheckpoints.findIndex(function (item) { return item.checkpointId === checkpointId; }); }
    function orderedPerMarker(records, recordType) {
      var flattened = [];
      records.forEach(function (record) { (record.markerCorrelations || []).forEach(function (correlation) { var copy = Object.assign({}, record, { checkpointId: correlation.checkpointId, marker: correlation.marker, correlationStartSource: 'marker-armed', millisecondsFromMarkerArm: correlation.millisecondsFromMarkerArm }); if (recordType) copy.recordType = recordType; delete copy.markerCorrelations; flattened.push(copy); }); });
      return flattened.sort(function (a, b) { return markerOrder(a.checkpointId) - markerOrder(b.checkpointId) || a.millisecondsFromMarkerArm - b.millisecondsFromMarkerArm || a.timestamp - b.timestamp; });
    }
    var candidateTransportFrames = orderedPerMarker(correlated.filter(function (entry) { return transportApis.indexOf(entry.api) >= 0; }));
    var correlatedStateAndDomChanges = orderedPerMarker(correlated.filter(function (entry) { return entry.api === 'dom-mutation'; }), 'dom-mutation').concat(orderedPerMarker(snapshots, 'state-snapshot')).sort(function (a, b) { return markerOrder(a.checkpointId) - markerOrder(b.checkpointId) || a.millisecondsFromMarkerArm - b.millisecondsFromMarkerArm || a.timestamp - b.timestamp; });
    var exportValue = { schemaVersion: 2, diagnosticPurpose: 'Pause/Resume signal discovery only; no production classification or statistics ownership', captureMode: { type: 'marker-armed-window', clickRequired: false, preArmMilliseconds: LIMITS.preArmMs, postArmMilliseconds: LIMITS.postArmMs, activationMethods: ['keyboard', 'pointer', 'transport-only', 'unknown'] }, buildId: state.buildId, extensionVersion: state.extensionVersion, captureStartTimestamp: state.captureStartedAt, captureEndTimestamp: state.captureEndedAt || now(timestamp), exportedAt: now(timestamp), captureValidity: captureValidity(state), markerCheckpoints: clone(state.markerCheckpoints), clickedElements: clone(state.clickedElements), ignoredMarkerClicks: clone(state.entries.filter(function (entry) { return entry.api === 'marker-ownership'; })), sockets: clone(state.sockets), correlatedEvents: correlated, candidateTransportFrames: candidateTransportFrames, correlatedDomMutations: correlated.filter(function (entry) { return entry.api === 'dom-mutation'; }), correlatedStateAndDomChanges: correlatedStateAndDomChanges, pageStateSnapshots: clone(state.pageStateSnapshots), existingRuntimeStatusTraces: sanitizeValue(extras.runtimeStatusTraces || [], state.redaction), pauseRecognizerOutputs: sanitizeValue(extras.pauseRecognizerOutputs || {}, state.redaction), instanceIds: sanitizeValue(Object.assign({}, state.instances, extras.instanceIds || {}), state.redaction), knownPageWorldStoreInspection: sanitizeValue(extras.knownPageWorldStoreInspection || { accessible: false, reason: 'No stable page-world store is referenced by the extension; no global or React-tree crawl was performed.' }, state.redaction), truncation: clone(state.truncation), limits: clone(LIMITS), redaction: clone(state.redaction) };
    var json = JSON.stringify(exportValue, null, 2); exportValue.truncation.exportBytesBeforeTruncation = json.length;
    while (json.length > LIMITS.maxExportBytes && exportValue.correlatedEvents.length) { exportValue.correlatedEvents.shift(); exportValue.truncation.exportEntriesDropped += 1; exportValue.correlatedDomMutations = exportValue.correlatedEvents.filter(function (entry) { return entry.api === 'dom-mutation'; }); exportValue.candidateTransportFrames = orderedPerMarker(exportValue.correlatedEvents.filter(function (entry) { return transportApis.indexOf(entry.api) >= 0; })); exportValue.correlatedStateAndDomChanges = orderedPerMarker(exportValue.correlatedDomMutations, 'dom-mutation').concat(orderedPerMarker(snapshots, 'state-snapshot')).sort(function (a, b) { return markerOrder(a.checkpointId) - markerOrder(b.checkpointId) || a.millisecondsFromMarkerArm - b.millisecondsFromMarkerArm || a.timestamp - b.timestamp; }); json = JSON.stringify(exportValue, null, 2); }
    while (json.length > LIMITS.maxExportBytes && exportValue.ignoredMarkerClicks.length) { exportValue.ignoredMarkerClicks.shift(); exportValue.truncation.exportEntriesDropped += 1; json = JSON.stringify(exportValue, null, 2); }
    if (json.length > LIMITS.maxExportBytes) { exportValue.pageStateSnapshots = exportValue.pageStateSnapshots.slice(-8); exportValue.correlatedStateAndDomChanges = exportValue.correlatedStateAndDomChanges.filter(function (entry) { return entry.recordType !== 'state-snapshot'; }); exportValue.truncation.snapshotsDropped += Math.max(0, state.pageStateSnapshots.length - 8); json = JSON.stringify(exportValue, null, 2); }
    exportValue.truncation.finalExportBytes = json.length; return exportValue;
  }
  function exportJson(state, extras, timestamp) { return JSON.stringify(createExport(state, extras, timestamp), null, 2); }
  var api = Object.freeze({ LIMITS: LIMITS, createState: createState, setEnabled: setEnabled, clearCapture: clearCapture, redactText: redactText, sanitizeUrl: sanitizeUrl, sanitizeValue: sanitizeValue, boundedText: boundedText, decodeFrameText: decodeFrameText, payloadDetails: payloadDetails, recordSocket: recordSocket, recordEntry: recordEntry, armMarker: armMarker, completeMarkerWindow: completeMarkerWindow, recordActivation: recordActivation, cancelMarker: cancelMarker, ignoreArmedClick: ignoreArmedClick, extensionUiOwnership: extensionUiOwnership, captureValidity: captureValidity, consumeNextClick: consumeNextClick, recordPageState: recordPageState, correlationFor: correlationFor, correlatedEntries: correlatedEntries, correlatedSnapshots: correlatedSnapshots, createExport: createExport, exportJson: exportJson });
  root.PokerPauseDiagnosticCapture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
