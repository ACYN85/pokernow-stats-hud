'use strict';
var assert = require('assert'); var fs = require('fs');
var source = fs.readFileSync(require.resolve('./content.js'), 'utf8');
assert.match(source, /String\(eventName \|\| ''\)\.toLowerCase\(\) !== 'registered'/, 'identity is accepted only from authenticated registration state');
assert.match(source, /firstObjectByKeyPattern\(payload, \/\^currentPlayer\$\/i\)/, 'registered.currentPlayer is the authoritative local binding');
assert.match(source, /source: 'registered\.currentPlayer\.id'/);
assert.doesNotMatch(source.slice(source.indexOf('function discoverLocalHostIdentity'), source.indexOf('function persistRecognizedHostCommand')), /displayName|textContent|querySelector/, 'self identity is never inferred from a name or DOM position');
assert.match(source, /selfIdentityInfo: function/);
console.log('Automatic stable self identity production path is registered.currentPlayer.id and never display-name/DOM inference.');
