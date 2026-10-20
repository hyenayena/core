import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapRows} from '../../src/transcript/wrap.js';
import {stringCells} from '../../src/hints/width.js';

const ESC = String.fromCharCode(27);
const RED = `${ESC}[31m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;
const SGR_ANY = new RegExp(ESC + '\\[[0-9;:]*m', 'g');
const stripSgr = (s: string) => s.replace(SGR_ANY, '');

test('words wrap at spaces and the breaking space stays at the row end', () => {
	assert.deepEqual(wrapRows('hello world foo', 10), ['hello ', 'world foo']);
	assert.deepEqual(wrapRows('aaa bbb ccc', 9), ['aaa bbb ', 'ccc']);
});

test('a space that overflows ends the row and is consumed', () => {
	assert.deepEqual(wrapRows('abcde fgh', 5), ['abcde', 'fgh']);
});

test('a word longer than the width is split hard', () => {
	assert.deepEqual(wrapRows('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
});

test('leading indentation is kept and is not a break point', () => {
	assert.deepEqual(wrapRows('  abcdef', 4), ['  ab', 'cdef']);
	assert.deepEqual(wrapRows('  ab cd', 5), ['  ab ', 'cd']);
});

test('a wide grapheme that does not fit in the last cell moves down', () => {
	assert.deepEqual(wrapRows('abc漢字', 4), ['abc', '漢字']);
	assert.deepEqual(wrapRows('ab😀', 3), ['ab', '😀']);
	for (const row of wrapRows('漢字漢字漢字漢', 5)) assert.ok(stringCells(row) <= 5);
});

test('combining marks take no cells', () => {
	const e = 'é';
	assert.deepEqual(wrapRows(`${e}${e}${e}`, 3), [`${e}${e}${e}`]);
});

test('newlines start rows; CRLF counts once and a lone CR is dropped', () => {
	assert.deepEqual(wrapRows('a\nb', 10), ['a', 'b']);
	assert.deepEqual(wrapRows('a\r\nb', 10), ['a', 'b']);
	assert.deepEqual(wrapRows('a\rb', 10), ['ab']);
	assert.deepEqual(wrapRows('a\n\nb', 10), ['a', '', 'b']);
});

test('empty input gives one empty row', () => {
	assert.deepEqual(wrapRows('', 10), ['']);
	assert.deepEqual(wrapRows(undefined as unknown as string, 10), ['']);
});

test('SGR takes no cells', () => {
	assert.deepEqual(wrapRows(`${RED}abc${RESET}`, 3), [`${RED}abc${RESET}`]);
});

test('SGR is carried across wraps and newlines and a reset stops the carry', () => {
	assert.deepEqual(wrapRows(`${RED}abcdef`, 3), [`${RED}abc${RESET}`, `${RED}def${RESET}`]);
	assert.deepEqual(wrapRows(`${RED}${BOLD}ab\ncd`, 5), [`${RED}${BOLD}ab${RESET}`, `${RED}${BOLD}cd${RESET}`]);
	assert.deepEqual(wrapRows(`${RED}ab${RESET}cdef`, 3), [`${RED}ab${RESET}c`, 'def']);
	assert.deepEqual(wrapRows(`${RED}ab${ESC}[mcdef`, 3), [`${RED}ab${ESC}[mc`, 'def']);
});

test('the carry list is capped', () => {
	const many = Array.from({length: 40}, (_, i) => `${ESC}[${30 + (i % 8)}m`).join('');
	const rows = wrapRows(`${many}abcd`, 2);
	assert.equal(rows[1]!.match(SGR_ANY)!.length, 32 + 1);
});

test('other escape sequences take no cells and are not carried', () => {
	const osc = `${ESC}]8;;http://x${ESC}\\`;
	const csi = `${ESC}[2K`;
	assert.deepEqual(wrapRows(`${osc}abcdef`, 3), [`${osc}abc`, 'def']);
	assert.deepEqual(wrapRows(`ab${csi}cdef`, 4), [`ab${csi}cd`, 'ef']);
});

test('width 1 and width 0 put one grapheme per row; a wide one sits alone', () => {
	assert.deepEqual(wrapRows('abc', 1), ['a', 'b', 'c']);
	assert.deepEqual(wrapRows('abc', 0), ['a', 'b', 'c']);
	assert.deepEqual(wrapRows('a漢b', 1), ['a', '漢', 'b']);
});

test('no row is wider than the width and no row contains a newline', () => {
	const parts = ['word', ' ', '  ', '漢字', '😀', 'é', RED, RESET, BOLD, '\n', 'x', 'longwordwithoutspaces'];
	let seed = 7;
	const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	for (let n = 0; n < 300; n++) {
		let text = '';
		const len = Math.floor(rand() * 30);
		for (let i = 0; i < len; i++) text += parts[Math.floor(rand() * parts.length)];
		const width = 1 + Math.floor(rand() * 12);
		const rows = wrapRows(text, width);
		assert.ok(rows.length >= 1);
		for (const row of rows) {
			assert.ok(!row.includes('\n'));
			const cells = stringCells(stripSgr(row));
			assert.ok(cells <= width || (cells === 2 && width === 1), `${JSON.stringify(row)} at ${width}`);
		}
	}
});
