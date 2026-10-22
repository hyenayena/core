import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BRAILLE_FILL, brailleCells, brailleRows, brailleText, stringCells, type DotState} from '../../src/kit/text.js';

const ESC = String.fromCharCode(27);
const code = (g: string) => (g.codePointAt(0) as number) - 0x2800;
const dots = (n: number, s: DotState): DotState[] => Array.from({length: n}, () => s);

test('fill order and code points', () => {
	for (let n = 1; n <= 8; n++) {
		const [cell] = brailleCells(dots(n, 'pass'));
		const expected = BRAILLE_FILL.slice(0, n).reduce((a, b) => a | b, 0);
		assert.equal(code(cell!.glyph), expected);
	}
	assert.equal(brailleCells(dots(8, 'pass'))[0]!.glyph, '⣿');
});

test('partial last cell shows the track', () => {
	const cells = brailleCells(dots(3, 'pending'));
	assert.equal(cells.length, 1);
	assert.equal(cells[0]!.glyph, '⠇');
	assert.equal(cells[0]!.tone, 'dim');
	assert.equal(cells[0]!.capacity, 3);
	assert.equal(cells[0]!.done, 0);
});

test('finished dots only, rest of cell hidden', () => {
	const cell = brailleCells(['pass', 'pass', 'pending'])[0]!;
	assert.equal(code(cell.glyph), 0x03);
	assert.equal(cell.done, 2);
	assert.equal(cell.capacity, 3);
});

test('worst tone wins', () => {
	assert.equal(brailleCells(['pass', 'pass'])[0]!.tone, 'add');
	assert.equal(brailleCells(['pass', 'skip'])[0]!.tone, 'warn');
	assert.equal(brailleCells(['skip', 'fail', 'pass'])[0]!.tone, 'del');
});

test('empty input', () => {
	assert.deepEqual(brailleCells([]), []);
	assert.deepEqual(brailleRows([], 5), {rows: [], hiddenBefore: 0, hiddenAfter: 0});
	assert.equal(brailleText([], {color: false}), '');
});

test('rows wrap by width', () => {
	const cells = brailleCells(dots(8 * 7, 'pass'));
	const {rows} = brailleRows(cells, 3);
	assert.deepEqual(rows.map(r => r.length), [3, 3, 1]);
});

test('maxRows and focus window with hidden counts', () => {
	const cells = brailleCells(dots(8 * 10, 'pass'));
	const top = brailleRows(cells, 2, {maxRows: 2});
	assert.equal(top.rows.length, 2);
	assert.equal(top.hiddenBefore, 0);
	assert.equal(top.hiddenAfter, 6);
	const mid = brailleRows(cells, 2, {maxRows: 2, focus: 5});
	assert.equal(mid.hiddenBefore + mid.hiddenAfter + 4, 10);
	assert.ok(mid.hiddenBefore > 0 && mid.hiddenAfter > 0);
	const end = brailleRows(cells, 2, {maxRows: 2, focus: 9});
	assert.equal(end.hiddenAfter, 0);
	assert.equal(end.hiddenBefore, 6);
});

test('width 0 and negative clamp to 1', () => {
	const cells = brailleCells(dots(24, 'pass'));
	assert.equal(brailleRows(cells, 0).rows.length, 3);
	assert.equal(brailleRows(cells, -4).rows.length, 3);
});

test('brailleText: no escapes without colour, only SGR with colour', () => {
	const cells = brailleCells(['pass', 'fail', 'skip', 'pending'].flatMap(s => dots(8, s as DotState)));
	const plain = brailleText(cells, {color: false});
	assert.ok(!plain.includes(ESC));
	assert.equal(plain.length, 4);
	const colored = brailleText(cells, {color: true});
	assert.ok(colored.includes(ESC));
	const stripped = colored.replace(new RegExp(ESC + '\\[[0-9;]*m', 'g'), '');
	assert.ok(!stripped.includes(ESC));
	assert.equal(stripped, plain);
	assert.ok(colored.endsWith(ESC + '[0m'));
	assert.match(colored, new RegExp(ESC + '\\[31m'));
});

test('glyphs are one cell wide', () => {
	for (const cell of brailleCells(dots(20, 'pass'))) assert.equal(stringCells(cell.glyph), 1);
});

test('non-finite width clamps to 1, focus is clamped into range', () => {
	const cells = brailleCells(Array.from({length: 24}, () => 'pass' as const));
	assert.equal(brailleRows(cells, Number.NaN).rows.length, 3);
	assert.equal(brailleRows(cells, Number.POSITIVE_INFINITY).rows.length, 3);
	for (const focus of [-5, 999]) {
		const {rows, hiddenBefore, hiddenAfter} = brailleRows(cells, 1, {maxRows: 2, focus});
		assert.equal(rows.length, 2, String(focus));
		assert.equal(hiddenBefore + hiddenAfter + rows.flat().length, 3, String(focus));
	}
});

test('skip without failure is warn, fail beats skip, pending track is dim', () => {
	assert.equal(brailleCells(['pass', 'skip'])[0]?.tone, 'warn');
	assert.equal(brailleCells(['skip', 'fail'])[0]?.tone, 'del');
	const [cell] = brailleCells(['pending', 'pending']);
	assert.equal(cell?.tone, 'dim');
	assert.equal(cell?.done, 0);
});

test('maxRows that fits everything hides nothing', () => {
	const cells = brailleCells(Array.from({length: 16}, () => 'pass' as const));
	assert.deepEqual(brailleRows(cells, 1, {maxRows: 2}).hiddenAfter, 0);
	assert.equal(brailleRows(cells, 1, {maxRows: 2}).rows.length, 2);
});

test('non-finite focus is treated as 0', () => {
	const cells = brailleCells(dots(8 * 10, 'pass'));
	for (const focus of [NaN, Infinity, -Infinity]) {
		const r = brailleRows(cells, 1, {maxRows: 2, focus});
		assert.equal(r.rows.length, 2);
		assert.equal(r.hiddenBefore, 0);
	}
});
