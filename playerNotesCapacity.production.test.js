'use strict';

var assert = require('assert');
var notes = require('./playerNotesStore.js');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

var state = notes.normalize(null);
for (var index = 0; index < notes.MAX_PLAYERS; index += 1) state = notes.set(state, 'player-' + index, 'note-' + index);
var marker = '  function releaseStartupFramesAfterStorage() {';
var harness = harnessSupport.createHarness({
  gameId: 'notes-capacity-ui',
  transformContentSource: function (source) {
    var injection = [
      '  globalThis.__PNHUD_NOTES_CAPACITY_TEST__ = {',
      '    configure: function (saved) {',
      '      playerNotesState = PokerPlayerNotesStore.normalize(saved);',
      '      playerDashboardState.playerId = "new-player-at-capacity";',
      '      playerDashboardState.open = false;',
      '      var input = { value: "new note" };',
      '      playerDashboardElement = { isConnected: true, hidden: true, querySelector: function () { return input; }, setAttribute: function () {} };',
      '    },',
      '    save: savePlayerDashboardNote,',
      '    status: function () { return playerDashboardState.noteStatus; }',
      '  };',
      ''
    ].join('\n');
    return source.replace(marker, injection + marker);
  }
});
assert.deepStrictEqual(harness.evaluationErrors, []);
var writesBefore = harness.storageWrites.length;
harness.context.__PNHUD_NOTES_CAPACITY_TEST__.configure(state);
harness.context.__PNHUD_NOTES_CAPACITY_TEST__.save();
assert.strictEqual(harness.storageWrites.length, writesBefore, 'capacity rejection never writes a truncated replacement state');
assert.strictEqual(harness.context.__PNHUD_NOTES_CAPACITY_TEST__.status(), 'Note limit reached (500). Clear an existing note before adding another.', 'the dashboard shows an actionable capacity error');
console.log('Player Notes production UI capacity rejection regression passed.');
