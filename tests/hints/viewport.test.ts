import assert from 'node:assert/strict';
import {test} from 'node:test';
import {indexAtCell, windowLine} from '../../src/hints/viewport.js';
import {graphemes, stringCells} from '../../src/hints/width.js';

const total = (w: ReturnType<typeof windowLine>) => stringCells(w.before + w.cursorCell + w.after + w.ghost);

test('a short line is shown whole', () => {
	const w = windowLine(graphemes('hello'), 2, '', 20);
	assert.deepEqual(w, {before: 'he', cursorCell: 'l', after: 'lo', ghost: '', start: 0, leftCut: false, rightCut: false});
});

test('end of line shows an inverse space cell', () => {
	const w = windowLine(graphemes('hi'), 2, '', 10);
	assert.equal(w.cursorCell, ' ');
	assert.equal(w.before, 'hi');
});

test('the ghost supplies the cursor cell and dim remainder', () => {
	const w = windowLine(graphemes('ex'), 2, 'it', 10);
	assert.equal(w.cursorCell, 'i');
	assert.equal(w.ghost, 't');
});

test('the ghost is ignored when the cursor is not at the end', () => {
	const w = windowLine(graphemes('abc'), 1, 'zzz', 10);
	assert.equal(w.ghost, '');
	assert.equal(w.cursorCell, 'b');
});

test('the ghost is clipped to the remaining width', () => {
	const w = windowLine(graphemes('abc'), 3, 'defghij', 6);
	assert.equal(w.before + w.cursorCell + w.ghost, 'abcdef');
});

test('a long line is cut on the left with an ellipsis, cursor visible', () => {
	const w = windowLine(graphemes('abcdefghijklmnopqrstuvwxyz'), 26, '', 10);
	assert.equal(w.leftCut, true);
	assert.ok(w.before.startsWith('…'));
	assert.ok(w.before.endsWith('z'));
	assert.equal(total(w), 10);
});

test('a cursor in the middle of a long line cuts both sides', () => {
	const w = windowLine(graphemes('abcdefghijklmnopqrstuvwxyz'), 13, '', 11);
	assert.equal(w.leftCut, true);
	assert.equal(w.rightCut, true);
	assert.ok(w.before.startsWith('…'));
	assert.ok(w.after.endsWith('…'));
	assert.equal(w.cursorCell, 'n');
	assert.ok(total(w) <= 11);
});

test('a cursor at the start cuts only the right side', () => {
	const w = windowLine(graphemes('abcdefghijklmnop'), 0, '', 8);
	assert.equal(w.leftCut, false);
	assert.equal(w.rightCut, true);
	assert.equal(w.cursorCell, 'a');
	assert.equal(w.after, 'bcdefg…');
});

test('wide characters are never split and widths are respected', () => {
	const gs = graphemes('日本語のテキストです😀👨‍👩‍👧éx');
	for (let max = 1; max <= 14; max++) {
		for (let cursor = 0; cursor <= gs.length; cursor++) {
			const w = windowLine(gs, cursor, '', max);
			assert.ok(total(w) <= max, `max=${max} cursor=${cursor}`);
			assert.ok(w.cursorCell !== '', `cursor cell max=${max} cursor=${cursor}`);
			for (const part of [w.before, w.after]) {
				assert.equal(graphemes(part).join(''), part);
			}
		}
	}
});

test('a wide cursor cell that cannot fit becomes a space', () => {
	assert.equal(windowLine(graphemes('日'), 0, '', 1).cursorCell, ' ');
});

test('degenerate sizes and inputs do not throw', () => {
	assert.deepEqual(windowLine(['a'], 0, '', 0).cursorCell, '');
	assert.doesNotThrow(() => windowLine(null as never, NaN, null as never, NaN));
	assert.doesNotThrow(() => windowLine(['a'], -5, '', 3));
	assert.doesNotThrow(() => windowLine(['a'], 99, 'x', 3));
});

const at = (line: string, cursor: number, ghost: string, max: number) => {
	const gs = graphemes(line);
	const win = windowLine(gs, cursor, ghost, max);
	return {win, hit: (cell: number) => indexAtCell(win, gs.length, cursor, cell)};
};

test('start is 0 without a left cut and the first kept grapheme with one', () => {
	assert.equal(windowLine(graphemes('hello'), 2, '', 20).start, 0);
	const w = windowLine(graphemes('abcdefghij'), 10, '', 5);
	assert.equal(w.before, '…hij');
	assert.equal(w.start, 7);
});

test('start equals the cursor when no grapheme fits before it', () => {
	const w = windowLine(graphemes('abcdef'), 3, '', 1);
	assert.equal(w.before, '');
	assert.equal(w.leftCut, true);
	assert.equal(w.start, 3);
});

test('indexAtCell on an ASCII line maps each cell to its grapheme', () => {
	const {hit} = at('hello', 2, '', 20);
	assert.deepEqual([0, 1, 2, 3, 4].map(hit), [0, 1, 2, 3, 4]);
	assert.equal(hit(5), 5);
	assert.equal(hit(50), 5);
});

test('negative cells give the first visible grapheme', () => {
	assert.equal(at('hello', 2, '', 20).hit(-1), 0);
	const {win, hit} = at('abcdefghij', 10, '', 5);
	assert.equal(hit(-2), win.start);
	assert.equal(hit(Number.NaN), 10);
});

test('both cells of a wide grapheme count as that grapheme', () => {
	const {hit} = at('a漢字b', 4, '', 20);
	assert.deepEqual([0, 1, 2, 3, 4, 5].map(hit), [0, 1, 1, 2, 2, 3]);
	const {hit: mid} = at('a漢字b', 1, '', 20);
	assert.deepEqual([1, 2, 3, 4, 5].map(mid), [1, 1, 2, 2, 3]);
});

test('emoji ZWJ sequences and combining marks are single graphemes', () => {
	const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
	const {hit} = at(`x${family}y`, 0, '', 20);
	assert.deepEqual([0, 1, 2, 3].map(hit), [0, 1, 1, 2]);
	const {hit: marks} = at('aéo', 3, '', 20);
	assert.deepEqual([0, 1, 2, 3].map(marks), [0, 1, 2, 3]);
});

test('left-scrolled window: the left ellipsis gives the first visible grapheme', () => {
	const line = 'abcdefghijklmnop';
	const {win, hit} = at(line, 16, '', 6);
	assert.equal(win.leftCut, true);
	assert.equal(hit(0), win.start);
	assert.equal(hit(1), win.start);
	assert.equal(hit(2), win.start + 1);
	assert.equal(hit(5), 16);
	assert.equal(hit(6), 16);
});

test('right-scrolled window: the right ellipsis gives the first hidden grapheme', () => {
	const line = 'abcdefghijklmnop';
	const {win, hit} = at(line, 0, '', 6);
	assert.equal(win.rightCut, true);
	assert.equal(win.after, 'bcde…');
	assert.equal(hit(0), 0);
	assert.equal(hit(4), 4);
	assert.equal(hit(5), 5);
	assert.equal(line[5], 'f');
	assert.equal(hit(6), 16);
});

test('a window cut on both sides maps every cell', () => {
	const line = 'abcdefghijklmnopqrstuvwxyz';
	const {win, hit} = at(line, 13, '', 9);
	assert.equal(win.leftCut && win.rightCut, true);
	const cells = graphemes(win.before + win.cursorCell + win.after);
	const got = cells.map((_, i) => hit(i));
	assert.equal(got[0], win.start);
	assert.equal(got[1], win.start);
	assert.equal(got[graphemes(win.before).length], 13);
	const last = got[got.length - 1] as number;
	assert.equal(line[last - 1], graphemes(win.after).at(-2));
	for (let i = 2; i < got.length; i++) assert.ok((got[i] as number) >= (got[i - 1] as number));
});

test('a click on the ghost text gives the end of the line', () => {
	const {win, hit} = at('ec', 2, 'ho', 20);
	assert.equal(win.cursorCell, 'h');
	assert.equal(win.ghost, 'o');
	assert.equal(hit(2), 2);
	assert.equal(hit(3), 2);
	assert.equal(hit(10), 2);
});

test('wide graphemes on a scrolled line keep both cells', () => {
	const line = '漢字漢字漢字漢字';
	const {win, hit} = at(line, 8, '', 6);
	assert.equal(win.before, '…漢字');
	assert.equal(win.start, 6);
	assert.deepEqual([0, 1, 2, 3, 4, 5].map(hit), [6, 6, 6, 7, 7, 8]);
});
