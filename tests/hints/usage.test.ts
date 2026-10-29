import assert from 'node:assert/strict';
import {test} from 'node:test';
import {computeHints} from '../../src/hints/model.js';
import {argState, currentPlaceholder, optionNames, parseUsage, slotFlags, slotKey, splitUsage} from '../../src/hints/usage.js';
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
			['x', {name: 'x', description: '', usage: 'something else <a>', agent: 'confirm' as const, subs: [], args: [], options: [], notes: [], index: 0}],
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

test('splitUsage keeps bracketed groups together', () => {
	assert.deepEqual(splitUsage('x [--name <n>] [repo dir] [--file <path> | --data <text…>] <a b>…'), [
		'x',
		'[--name <n>]',
		'[repo dir]',
		'[--file <path> | --data <text…>]',
		'<a b>…',
	]);
	assert.deepEqual(splitUsage('x <unclosed a b'), ['x', '<unclosed a b']);
	assert.deepEqual(splitUsage('x ] y'), ['x', ']', 'y']);
	assert.deepEqual(splitUsage(5 as never), []);
});

test('parseUsage classifies bracketed groups as one token', () => {
	const t = parseUsage('x [--name <n>] [repo dir] <text…>', 1);
	assert.deepEqual(t.map(x => [x.text, x.kind, x.variadic]), [
		['[--name <n>]', 'flag', false],
		['[repo dir]', 'slot', false],
		['<text…>', 'slot', true],
	]);
});

test('optionNames lists names and whether each takes a value', () => {
	assert.deepEqual(optionNames('[--name <n>]'), [{name: '--name', takesValue: true}]);
	assert.deepEqual(optionNames('[--new]'), [{name: '--new', takesValue: false}]);
	assert.deepEqual(optionNames('[--file <path> | --data <text…>]'), [
		{name: '--file', takesValue: true},
		{name: '--data', takesValue: true},
	]);
	assert.deepEqual(optionNames('[-H name:value]…'), [{name: '-H', takesValue: true}]);
	assert.deepEqual(optionNames('[--json|-j]'), [
		{name: '--json', takesValue: false},
		{name: '-j', takesValue: false},
	]);
	assert.deepEqual(optionNames('[--model=<m>]'), [{name: '--model', takesValue: true}]);
	assert.deepEqual(optionNames('[--<field> <value>]'), [{name: '--<field>', takesValue: true}]);
	assert.deepEqual(optionNames('[--a] [--b x]'), [
		{name: '--a', takesValue: false},
		{name: '--b', takesValue: true},
	]);
	assert.deepEqual(optionNames(7 as never), []);
});

test('slotKey and slotFlags normalise a slot', () => {
	assert.equal(slotKey('<project>…'), 'project');
	assert.equal(slotKey('[model]'), 'model');
	assert.equal(slotKey('[source]...'), 'source');
	assert.equal(slotKey('[subcommand…]'), 'subcommand');
	assert.equal(slotKey('[<name>]'), 'name');
	assert.equal(slotKey('plain'), 'plain');
	assert.deepEqual(slotFlags('[subcommand…]'), {optional: true, repeatable: true});
	assert.deepEqual(slotFlags('<project>'), {optional: false, repeatable: false});
});

test('option values are skipped when counting arguments', () => {
	const t = parseUsage('x [--name <n>] [--new] <a> <b>', 1);
	assert.equal(currentPlaceholder(t, ['--name', 'v'], true), 2);
	assert.equal(currentPlaceholder(t, ['--new', 'one'], true), 3);
	assert.deepEqual(argState(t, ['--name'], true), {active: -1, option: '--name'});
	assert.deepEqual(argState(t, ['--name', 'va'], false), {active: -1, option: '--name'});
	assert.equal(currentPlaceholder(t, ['--name=v', 'one'], true), 3);
	assert.equal(currentPlaceholder(t, ['--new', 'one'], true, n => (n === '--new' ? true : undefined)), 2);
	assert.equal(currentPlaceholder(t, ['--name', 'one'], true, n => (n === '--name' ? false : undefined)), 3);
	assert.equal(currentPlaceholder(t, ['-x', 'one'], true, () => {
		throw new Error('bad');
	}), 3);
});
