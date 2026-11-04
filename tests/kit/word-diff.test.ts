import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pairRuns, tokenizeWords, wordDiff} from '../../src/kit/text.js';

test('tokenizeWords: words, whitespace runs and single other characters', () => {
	assert.deepEqual(tokenizeWords('foo_1  bar(x)'), ['foo_1', '  ', 'bar', '(', 'x', ')']);
	assert.deepEqual(tokenizeWords(''), []);
	assert.deepEqual(tokenizeWords('a=>b'), ['a', '=', '>', 'b']);
});

test('wordDiff marks the changed tokens in UTF-16 offsets', () => {
	const d = wordDiff('const total = count + 1;', 'const total = count + 2;');
	assert.ok(d);
	assert.deepEqual(d.a, [{from: 22, to: 23}]);
	assert.deepEqual(d.b, [{from: 22, to: 23}]);
	const e = wordDiff('call(alpha, beta)', 'call(alpha, gamma, beta)');
	assert.ok(e);
	assert.equal(e.a.length, 0);
	assert.deepEqual(e.b, [{from: 12, to: 19}]);
});

test('wordDiff merges adjacent changed tokens', () => {
	const d = wordDiff('keep one two keep', 'keep uno dos keep');
	assert.ok(d);
	assert.deepEqual(d.a, [{from: 5, to: 12}]);
});

test('wordDiff gives up on long lines, many tokens and low similarity', () => {
	assert.equal(wordDiff('a'.repeat(401), 'b'), undefined);
	const many = Array.from({length: 130}, () => 'x').join(' ');
	assert.equal(wordDiff(many, many + 'y'), undefined);
	assert.equal(wordDiff('completely different text', 'zzz qqq www vvv'), undefined);
});

test('pairRuns pairs a del run with the add run that follows it', () => {
	assert.deepEqual(pairRuns(['ctx', 'del', 'add', 'ctx']), [[1, 2]]);
	assert.deepEqual(pairRuns(['del', 'del', 'del', 'add', 'add']), [
		[0, 3],
		[1, 4],
	]);
	assert.deepEqual(pairRuns(['del', 'add', 'add']), [[0, 1]]);
	assert.deepEqual(pairRuns(['add', 'del']), []);
	assert.deepEqual(pairRuns(['del', 'ctx', 'add']), []);
});

test('pairRuns ignores runs over 32 lines', () => {
	const kinds = [...Array.from({length: 33}, () => 'del' as const), ...Array.from({length: 33}, () => 'add' as const)];
	assert.deepEqual(pairRuns(kinds), []);
});
