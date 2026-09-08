'use strict';

var path = require('path');
var childProcess = require('child_process');
var suites = require('./testSuites.js');

var suiteName = process.argv[2] || 'fast';
var files = suites[suiteName];
if (!files) {
  console.error('Unknown suite "' + suiteName + '". Use "fast", "full", or "release".');
  process.exit(2);
}

files.forEach(function (file) {
  console.log('[TEST] ' + file);
  var result = childProcess.spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
});
console.log('Completed ' + suiteName + ' suite: ' + files.length + ' files passed.');
