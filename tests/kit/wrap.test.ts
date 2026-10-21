import assert from 'node:assert/strict';
import {test} from 'node:test';
import {graphemes, stringCells, wrapLines, wrapRows} from '../../src/kit/text.js';

const ESC = String.fromCharCode(27);
const RED = `${ESC}[31m`;
const RESET = `${ESC}[0m`;
const SGR_ANY = new RegExp(ESC + '\\[[0-9;:]*m', 'g');
const stripSgr = (s: string) => s.replace(SGR_ANY, '');

test('word mode is the default and unchanged', () => {
	assert.deepEqual(wrapRows('hello world foo', 10), ['hello ', 'world foo']);
	assert.deepEqual(wrapRows('hello world foo', 10, {mode: 'word'}), ['hello ', 'world foo']);
});

test('char mode breaks per grapheme and keeps every space', () => {
	assert.deepEqual(wrapRows('hello world foo', 10, {mode: 'char'}), ['hello worl', 'd foo']);
	assert.deepEqual(wrapRows('ab cd', 3, {mode: 'char'}), ['ab ', 'cd']);
	assert.deepEqual(wrapRows('a    b', 2, {mode: 'char'}), ['a ', '  ', ' b']);
});

test('char mode: joined rows equal the input and rows fit', () => {
	const text = 'Aé 日本語 \u{1f468}‍\u{1f469} x   ýz';
	for (const width of [1, 2, 3, 4, 7]) {
		const rows = wrapRows(text, width, {mode: 'char'});
		assert.equal(rows.join(''), text);
		for (const r of rows) {
			const cells = stringCells(r);
			assert.ok(cells <= width || graphemes(r).length === 1, `${width}: ${r}`);
		}
	}
});

test('char mode: a grapheme wider than the width gets its own row', () => {
	assert.deepEqual(wrapRows('a日b', 1, {mode: 'char'}), ['a', '日', 'b']);
});

test('char mode: newline splits, trailing CR dropped, empty gives one empty row', () => {
	assert.deepEqual(wrapRows('ab\r\ncd\r', 5, {mode: 'char'}), ['ab', 'cd']);
	assert.deepEqual(wrapRows('', 5, {mode: 'char'}), ['']);
	assert.deepEqual(wrapRows('a\n\nb', 5, {mode: 'char'}), ['a', '', 'b']);
});

test('char mode carries SGR across rows', () => {
	const rows = wrapRows(`${RED}abcd${RESET}`, 2, {mode: 'char'});
	assert.deepEqual(rows.map(stripSgr), ['ab', 'cd']);
	assert.ok(rows[0]!.startsWith(RED) && rows[0]!.endsWith(RESET));
	assert.ok(rows[1]!.startsWith(RED));
});

test('wrapLines flattens and keeps empty lines', () => {
	assert.deepEqual(wrapLines(['abcd', '', 'e'], 2, {mode: 'char'}), ['ab', 'cd', '', 'e']);
	assert.deepEqual(wrapLines([], 5), []);
});
