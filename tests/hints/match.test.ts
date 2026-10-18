import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchName, rank} from '../../src/hints/match.js';

test('tiers are ordered exact < prefix < boundary < substring < subsequence', () => {
	assert.equal(matchName('echo', 'echo')?.tier, 0);
	assert.equal(matchName('ECHO', 'echo')?.tier, 0);
	assert.equal(matchName('ec', 'echo')?.tier, 1);
	assert.equal(matchName('skill', 'my-skill')?.tier, 2);
	assert.equal(matchName('ms', 'my-skill')?.tier, 2);
	assert.equal(matchName('Skill', 'mySkill')?.tier, 2);
	assert.equal(matchName('kil', 'my-skill')?.tier, 3);
	assert.equal(matchName('mkl', 'my-skill')?.tier, 4);
	assert.equal(matchName('zzz', 'echo'), null);
	assert.equal(matchName('x', ''), null);
	assert.equal(matchName('echoo', 'echo'), null);
});

test('highlight ranges per tier', () => {
	assert.deepEqual(matchName('echo', 'echo')?.ranges, [[0, 4]]);
	assert.deepEqual(matchName('ec', 'echo')?.ranges, [[0, 2]]);
	assert.deepEqual(matchName('skill', 'my-skill')?.ranges, [[3, 8]]);
	assert.deepEqual(matchName('ms', 'my-skill')?.ranges, [[0, 1], [3, 4]]);
	assert.deepEqual(matchName('kil', 'my-skill')?.ranges, [[4, 7]]);
	assert.deepEqual(matchName('mkl', 'my-skill')?.ranges, [[0, 1], [4, 5], [6, 7]]);
	assert.deepEqual(matchName('sk', 'my-skill')?.ranges, [[3, 5]]);
});

test('fuzzy window is tightened backwards', () => {
	const m = matchName('abc', 'axxabxxc');
	assert.equal(m?.tier, 4);
	assert.equal(m?.gap, 2);
	assert.deepEqual(m?.ranges, [[3, 5], [7, 8]]);
});

test('empty query matches everything with no ranges in registry order', () => {
	assert.deepEqual(matchName('', 'anything'), {tier: 1, gap: 0, ranges: []});
	const items = ['zeta', 'a', 'mid'];
	const r = rank('', items, t => [t]);
	assert.deepEqual(r.map(x => x.item), items);
});

test('rank orders by tier, gap, length, then registry index', () => {
	const items = ['xxecho', 'echo', 'echoes', 'e-c-h-o', 'ech'];
	const r = rank('ech', items, t => [t]);
	assert.deepEqual(r.map(x => x.item), ['ech', 'echo', 'echoes', 'e-c-h-o', 'xxecho']);
});

test('registry order is the final tie-break and stable', () => {
	const items = ['bbb1', 'aaa1', 'ccc1', 'ddd1'];
	for (let i = 0; i < 100; i++) {
		assert.deepEqual(rank('1', items, t => [t]).map(x => x.index), [0, 1, 2, 3]);
	}
});

test('rank picks the best alias and reports it', () => {
	const items = [{n: 'update', a: ['up']}, {n: 'upgrade', a: []}];
	const r = rank('up', items, t => [t.n, ...t.a]);
	assert.equal(r[0]?.item.n, 'update');
	assert.equal(r[0]?.matchedName, 'up');
	assert.equal(r[0]?.match.tier, 0);
});

test('unicode and case-insensitivity', () => {
	assert.equal(matchName('É', 'école')?.tier, 1);
	assert.equal(matchName('éc', 'école')?.tier, 1);
	assert.deepEqual(matchName('本', '日本語')?.ranges, [[1, 2]]);
	assert.equal(matchName('😀', 'a😀b')?.tier, 3);
});

test('queries and names are capped at 64 code points', () => {
	const long = 'a'.repeat(100);
	assert.equal(matchName(long, 'a'.repeat(64))?.tier, 0);
	assert.equal(matchName('a'.repeat(64), long)?.tier, 0);
});

test('rank survives a throwing names callback', () => {
	const r = rank('a', [1, 2], t => {
		if (t === 1) throw new Error('boom');
		return ['a'];
	});
	assert.equal(r.length, 1);
});

test('hostile long input stays fast', () => {
	const start = Date.now();
	matchName('a'.repeat(5000) + 'b', 'a'.repeat(5000));
	assert.ok(Date.now() - start < 500);
});
