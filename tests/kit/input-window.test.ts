import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inputWindow, offsetAtCell} from '../../src/kit/text.js';

const FAMILY = '\u{1f468}‍\u{1f469}‍\u{1f467}';
const at = (text: string, cursor: number, cells: number, rows: number, row: number, cell: number) =>
	offsetAtCell(text, cursor, cells, rows, row, cell);

test('ASCII: cells map to offsets, past the end to the line end', () => {
	assert.equal(at('hello', 5, 78, 1, 0, 0), 0);
	assert.equal(at('hello', 5, 78, 1, 0, 2), 2);
	assert.equal(at('hello', 0, 78, 1, 0, 4), 4);
	assert.equal(at('hello', 0, 78, 1, 0, 5), 5);
	assert.equal(at('hello', 0, 78, 1, 0, 70), 5);
	assert.equal(at('', 0, 78, 1, 0, 9), 0);
});

test('wide characters take two cells each', () => {
	const text = '日本語';
	assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(c => at(text, 0, 78, 1, 0, c)), [0, 0, 1, 1, 2, 2, 3]);
});

test('a ZWJ emoji is one two-cell cluster', () => {
	const text = `a${FAMILY}b`;
	assert.equal(at(text, 0, 78, 1, 0, 1), 1);
	assert.equal(at(text, 0, 78, 1, 0, 2), 1);
	assert.equal(at(text, 0, 78, 1, 0, 3), 1 + FAMILY.length);
});

test('combining marks belong to their base; a cursor inside a cluster snaps to its start', () => {
	assert.equal(at('éx', 0, 78, 1, 0, 1), 2);
	const [row] = inputWindow('éx', 1, 78, 1);
	assert.equal(row?.cell, 'é');
});

test('the scrolled cursor row maps from its first shown grapheme; clicks on the cut marker', () => {
	const text = 'abcdefghijkl';
	const [row] = inputWindow(text, 12, 9, 1);
	assert.equal(row?.leftCut, true);
	assert.equal(row?.before, '…fghijkl');
	assert.equal(at(text, 12, 9, 1, 0, 0), 5);
	assert.equal(at(text, 12, 9, 1, 0, 1), 5);
	assert.equal(at(text, 12, 9, 1, 0, 3), 7);
	assert.equal(at(text, 12, 9, 1, 0, 40), 12);
});

test('other rows are cut with a right ellipsis; clicking it gives the first hidden grapheme', () => {
	const text = 'abcdefghij\nabcdefghijkl';
	const rows = inputWindow(text, text.length, 9, 2);
	assert.equal(rows[0]?.before, 'abcdefgh…');
	assert.equal(rows[0]?.rightCut, true);
	assert.equal(rows[0]?.cell, null);
	assert.equal(at(text, text.length, 9, 2, 0, 3), 3);
	assert.equal(at(text, text.length, 9, 2, 0, 8), 8);
	assert.equal(at(text, text.length, 9, 2, 0, 40), 10);
});

test('wide characters in a cut non-cursor row', () => {
	const text = '日本語日本語\nx';
	const rows = inputWindow(text, text.length, 7, 2);
	assert.equal(rows[0]?.before, '日本語…');
	assert.equal(at(text, text.length, 7, 2, 0, 6), 3);
	assert.equal(at(text, text.length, 7, 2, 0, 7), 6);
});

test('with the first lines scrolled off, row 0 is the first shown line', () => {
	const text = 'a\nb\nc\nd';
	assert.deepEqual(inputWindow(text, 7, 78, 2).map(r => r.before), ['c', 'd']);
	assert.deepEqual(inputWindow(text, 7, 78, 2).map(r => r.offset), [4, 6]);
	assert.equal(at(text, 7, 78, 2, 0, 0), 4);
	assert.equal(at(text, 7, 78, 2, 0, 9), 5);
	assert.equal(at(text, 7, 78, 2, 1, 5), 7);
});

test('multi-row scrolling follows the cursor up', () => {
	const text = 'a\nb\nc\nd\ne';
	assert.deepEqual(inputWindow(text, 0, 78, 2).map(r => r.offset), [0, 2]);
	assert.deepEqual(inputWindow(text, 4, 78, 2).map(r => r.offset), [2, 4]);
});

test('rows that are not shown give undefined', () => {
	assert.equal(at('a\nb\nc', 0, 78, 2, 2, 2), undefined);
	assert.equal(at('abc', 0, 78, 3, 1, 2), undefined);
	assert.equal(at('abc', 0, 78, 1, -1, 2), undefined);
	assert.equal(at('abc', 0, 78, 1, 0.5, 2), undefined);
});

test('an empty last line and a cursor at the end of text', () => {
	const rows = inputWindow('ab\n', 3, 78, 3);
	assert.deepEqual(rows.map(r => r.cell), [null, ' ']);
	assert.equal(at('ab\n', 3, 78, 3, 1, 4), 3);
});
