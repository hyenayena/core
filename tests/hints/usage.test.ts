import assert from 'node:assert/strict';
import {test} from 'node:test';
import {computeHints} from '../../src/hints/model.js';
import {currentPlaceholder, parseUsage} from '../../src/hints/usage.js';
import {catalog} from './fixture.js';

test('parseUsage drops the path and classifies tokens', () => {
	const t = parseUsage('claude ask [--new] <text>', 2);
	assert.deepEqual(t.map(x => [x.text, x.kind]), [['[--new]', 'flag'], ['<text>', 'slot']]);
});

test('parseUsage marks variadic slots', () => {
	assert.equal(parseUsage('mod remove <name>…', 2)[0]!.variadic, true);
	assert.equal(parseUsage('echo [text]...', 1)[0]!.variadic, true);
	const t = parseUsage('echo <a> …', 1);
	assert.equal(t[0]!.variadic, true);
	assert.equal(t[1]!.kind, 'more');
	assert.equal(parseUsage('mod list', 2).length, 0);
});

test('parseUsage tolerates junk', () => {
	assert.deepEqual(parseUsage(undefined as never, 1), []);
	assert.deepEqual(parseUsage('a b', -3).length, 2);
	assert.ok(parseUsage('x '.repeat(10000), 0).length <= 64);
});

test('flags do not consume positional slots', () => {
	const t = parseUsage('claude ask [--new] <text>', 2);
	assert.equal(currentPlaceholder(t, [], true), 1);
	assert.equal(currentPlaceholder(t, ['--new'], true), 1);
	assert.equal(currentPlaceholder(t, ['--new', 'hello'], true), -1);
});

test('the last partial argument is not yet complete', () => {
	const t = parseUsage('x a b <c>', 1);
	assert.equal(currentPlaceholder(t, ['one'], false), 0);
	assert.equal(currentPlaceholder(t, ['one'], true), 1);
});

test('variadic slot repeats', () => {
	const t = parseUsage('mod remove <name>…', 2);
	assert.equal(currentPlaceholder(t, ['a', 'b', 'c'], true), 0);
	assert.equal(currentPlaceholder(t, ['a', 'b'], false), 0);
});

test('no slots gives no highlight', () => {
	assert.equal(currentPlaceholder(parseUsage('mod list', 2), ['x'], true), -1);
});

test('model highlights through the path', () => {
	const h = computeHints(catalog, 'claude ask --new ');
	assert.equal(h.usage!.tokens[h.usage!.active]!.text, '<text>');
	const first = computeHints(catalog, 'claude ask ');
	assert.equal(first.usage!.tokens[first.usage!.active]!.text, '<text>');
	assert.equal(computeHints(catalog, 'mod remove a b ').usage!.active, 0);
});

test('a usage that does not start with the command path is shown plain', () => {
	const odd = {
		commands: [],
		byName: new Map([
			['x', {name: 'x', description: '', usage: 'something else <a>', agent: 'confirm' as const, subs: [], index: 0}],
		]),
	};
	const h = computeHints(odd, 'x ');
	assert.equal(h.usage!.active, -1);
	assert.equal(h.usage!.head, 'something else <a>');
	assert.deepEqual(h.usage!.tokens, []);
});

test('a missing usage is synthesised from the path', () => {
	const h = computeHints(catalog, 'claude auth ');
	assert.equal(h.usage!.head, 'claude auth');
});
