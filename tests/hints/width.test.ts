import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cellWidth, graphemes, sliceCells, stringCells, truncateCells} from '../../src/hints/width.js';

const table: Array<[string, number]> = [
	['日', 2], ['😀', 2], ['é', 1], ['é', 1], ['❤️', 2], ['❤', 1],
	['👨‍👩‍👧', 2], ['🇯🇵', 2], ['​', 0], ['ｱ', 1], ['Ａ', 2], ['한', 2],
	['✓', 1], ['…', 1], ['›', 1], ['⚠️', 2], ['a', 1], ['\u0007', 0],
];

test('cellWidth matches the verified table', () => {
	for (const [g, w] of table) assert.equal(cellWidth(g), w, JSON.stringify(g));
	assert.equal(cellWidth(''), 0);
});

test('graphemes keeps clusters together and tolerates bad input', () => {
	assert.deepEqual(graphemes('aé日'), ['a', 'é', '日']);
	assert.deepEqual(graphemes(''), []);
	assert.deepEqual(graphemes(undefined as unknown as string), []);
});

test('stringCells sums grapheme widths', () => {
	assert.equal(stringCells('a日😀'), 5);
});

test('truncateCells never splits a grapheme nor exceeds the budget', () => {
	const samples = ['hello world', '日本語のテキスト', '👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', 'éééé', 'a日b日c😀'];
	for (const s of samples) {
		for (let max = 0; max <= 12; max++) {
			const out = truncateCells(s, max);
			assert.ok(stringCells(out) <= max, `${s} ${max}`);
			const gs = new Set(graphemes(s));
			for (const g of graphemes(out)) assert.ok(gs.has(g) || g === '…');
		}
	}
	assert.equal(truncateCells('hello', 10), 'hello');
	assert.equal(truncateCells('hello world', 6), 'hello…');
	assert.equal(truncateCells('日本語', 4), '日…');
	assert.equal(truncateCells('abc', 0), '');
});

test('sliceCells returns whole graphemes inside the window', () => {
	assert.equal(sliceCells('abcdef', 2, 3), 'cde');
	assert.equal(sliceCells('日本語', 1, 4), '本');
	assert.equal(sliceCells('abc', 0, 0), '');
});
