import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCatalog} from '../../src/hints/catalog.js';
import {nearest, unknownCommandLines} from '../../src/hints/typo.js';

const mk = (...names: string[]) => buildCatalog(names.map(name => ({name})));
const base = mk('help', 'echo', 'mod', 'claude', 'clear', 'exit');

test('close typos resolve to the command', () => {
	assert.equal(nearest(base, 'ecoh'), 'echo');
	assert.equal(nearest(base, 'hlep'), 'help');
	assert.equal(nearest(base, 'exti'), 'exit');
	assert.equal(nearest(base, 'Help'), 'help');
	assert.equal(nearest(base, 'claud'), 'claude');
	assert.equal(nearest(base, 'cluade'), 'claude');
});

test('prefixes qualify, distant words and empty do not', () => {
	assert.equal(nearest(base, 'clau'), 'claude');
	assert.equal(nearest(base, 'zzzzzz'), undefined);
	assert.equal(nearest(base, 'q'), undefined);
	assert.equal(nearest(base, ''), undefined);
	assert.equal(nearest(base, 'xyz'), undefined);
});

test('ties break by distance, then prefix, then registry order', () => {
	assert.equal(nearest(mk('abd', 'abc'), 'abx'), 'abd');
	assert.equal(nearest(mk('abd', 'abc'), 'abc'), 'abc');
	assert.equal(nearest(mk('abcdef', 'abcxe'), 'abcd'), 'abcdef');
	assert.equal(nearest(mk('abcdef', 'abcxe'), 'abcx'), 'abcxe');
});

test('unknownCommandLines sanitises and caps the token', () => {
	assert.deepEqual(unknownCommandLines(base, 'ecoh'), ['Unknown command: ecoh', 'Did you mean: echo?']);
	assert.deepEqual(unknownCommandLines(base, 'qqqqqq'), ['Unknown command: qqqqqq']);
	const lines = unknownCommandLines(base, `\u001b[31m${'x'.repeat(200)}\n`);
	assert.equal(lines.length, 1);
	assert.ok(!lines[0]?.includes('\u001b'));
	assert.ok(Array.from(lines[0] ?? '').length <= 'Unknown command: '.length + 40);
});

test('very long tokens stay cheap', () => {
	const start = Date.now();
	nearest(base, 'a'.repeat(100_000));
	assert.ok(Date.now() - start < 500);
});
