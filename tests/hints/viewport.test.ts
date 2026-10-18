import assert from 'node:assert/strict';
import {test} from 'node:test';
import {windowLine} from '../../src/hints/viewport.js';
import {graphemes, stringCells} from '../../src/hints/width.js';

const total = (w: ReturnType<typeof windowLine>) => stringCells(w.before + w.cursorCell + w.after + w.ghost);

test('a short line is shown whole', () => {
	const w = windowLine(graphemes('hello'), 2, '', 20);
	assert.deepEqual(w, {before: 'he', cursorCell: 'l', after: 'lo', ghost: '', leftCut: false, rightCut: false});
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
