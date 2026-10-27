import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inputRowCount, inputWindow, offsetAtCell} from '../../src/kit/text.js';

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

test('a long line wraps after the last space that fits, one cell short of the width', () => {
	const text = 'hello world again';
	const rows = inputWindow(text, 0, 9, 5);
	assert.deepEqual(rows.map(r => r.before + (r.cell ?? '') + r.after), ['hello ', 'world ', 'again']);
	assert.deepEqual(rows.map(r => r.offset), [0, 6, 12]);
	assert.equal(inputRowCount(text, 9), 3);
	assert.ok(rows.every(r => !r.leftCut && !r.rightCut));
});

test('a word longer than a row is cut by cells; wide characters never split', () => {
	assert.deepEqual(inputWindow('abcdefghijkl', 0, 5, 5).map(r => r.before + (r.cell ?? '') + r.after), ['abcd', 'efgh', 'ijkl']);
	assert.deepEqual(inputWindow('日本語日本', 0, 6, 5).map(r => r.before + (r.cell ?? '') + r.after), ['日本', '語日', '本']);
});

test('the whole typed text is visible: nothing is replaced with an ellipsis', () => {
	const text = 'x'.repeat(30) + '\n' + 'y'.repeat(30);
	const rows = inputWindow(text, text.length, 11, 10);
	assert.equal(rows.map(r => r.before + (r.cell ?? '') + r.after).join('').replace(/ $/, ''), 'x'.repeat(30) + 'y'.repeat(30));
	assert.ok(!rows.some(r => r.before.includes('…')));
});

test('the cursor at a wrap point sits at the start of the next row; at the line end after the text', () => {
	const text = 'abcdefgh';
	assert.deepEqual(inputWindow(text, 4, 5, 5).map(r => r.cell), [null, 'e']);
	assert.deepEqual(inputWindow(text, 8, 5, 5).map(r => [r.before, r.cell]), [['abcd', null], ['efgh', ' ']]);
});

test('the window follows the cursor over wrapped rows', () => {
	const text = 'aaaa bbbb cccc dddd';
	assert.deepEqual(inputWindow(text, text.length, 6, 2).map(r => r.offset), [10, 15]);
	assert.deepEqual(inputWindow(text, 0, 6, 2).map(r => r.offset), [0, 5]);
});

test('clicks on wrapped rows map into that row; past its end to its last grapheme', () => {
	const text = 'hello world';
	assert.equal(at(text, 0, 9, 5, 1, 0), 6);
	assert.equal(at(text, 0, 9, 5, 1, 3), 9);
	assert.equal(at(text, 0, 9, 5, 1, 40), 11);
	assert.equal(at(text, 0, 9, 5, 0, 40), 5);
});
