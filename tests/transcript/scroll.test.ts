import test from 'node:test';
import assert from 'node:assert/strict';
import {createRowCache, lineText, renderedLine, normalizeAnchor, scrollAnchor, visibleWindow, type Anchor, type Line} from '../../src/transcript/scroll.js';

const W = 4;
let nextId = 0;
const line = (rows: number, tag = String(nextId)): Line => ({id: nextId++, text: `${tag}`.padEnd(W * rows, '.')});
const texts = (lines: Line[], a: Anchor | null, max: number) =>
	visibleWindow(lines, a, createRowCache(), W, max).rows.map(r => r.key);

test('the row cache wraps once per width', () => {
	const rowsOf = createRowCache();
	const l = line(3);
	const first = rowsOf(l, W);
	assert.equal(first.length, 3);
	assert.equal(rowsOf(l, W), first);
	assert.equal(rowsOf(l, W * 3).length, 1);
});

test('following the bottom shows the last rows and nothing newer', () => {
	const lines = [line(2), line(3), line(1)];
	const w = visibleWindow(lines, null, createRowCache(), W, 3);
	assert.deepEqual(
		w.rows.map(r => r.key),
		[`${lines[1]!.id}:1`, `${lines[1]!.id}:2`, `${lines[2]!.id}:0`],
	);
	assert.equal(w.newer, 0);
});

test('up and down move one row at a time through a multi-row line', () => {
	const rowsOf = createRowCache();
	const lines = [line(2), line(6), line(1)];
	const view = 3;
	let a: Anchor | null = null;
	const seen: string[] = [];
	for (let n = 1; n <= 5; n++) {
		a = scrollAnchor(lines, a, 1, rowsOf, W, view);
		const w = visibleWindow(lines, a, rowsOf, W, view);
		assert.equal(w.newer, n);
		seen.push(w.rows.at(-1)!.key);
	}
	assert.deepEqual(seen, [5, 4, 3, 2, 1].map(r => `${lines[1]!.id}:${r}`));
	for (let n = 4; n >= 1; n--) {
		a = scrollAnchor(lines, a, -1, rowsOf, W, view);
		assert.equal(visibleWindow(lines, a, rowsOf, W, view).newer, n);
	}
	a = scrollAnchor(lines, a, -1, rowsOf, W, view);
	assert.equal(a, null);
	assert.equal(scrollAnchor(lines, scrollAnchor(lines, null, 2, rowsOf, W, view), -10, rowsOf, W, view), null);
});

test('scrolling up stops where the first row is at the top of a full view', () => {
	const rowsOf = createRowCache();
	const lines = [line(2), line(3), line(2)];
	const a = scrollAnchor(lines, null, 100, rowsOf, W, 3);
	const w = visibleWindow(lines, a, rowsOf, W, 3);
	assert.equal(w.rows[0]!.key, `${lines[0]!.id}:0`);
	assert.equal(w.rows.length, 3);
	assert.equal(w.newer, 4);
	assert.deepEqual(scrollAnchor(lines, a, 1, rowsOf, W, 3), a);
});

test('everything that fits the view stays at the bottom', () => {
	const rowsOf = createRowCache();
	const lines = [line(1), line(2)];
	assert.equal(scrollAnchor(lines, null, 1, rowsOf, W, 3), null);
	assert.equal(scrollAnchor(lines, null, 1, rowsOf, W, 5), null);
	assert.equal(scrollAnchor([], null, 1, rowsOf, W, 5), null);
});

test('appended lines leave the window rows unchanged and grow newer by their rows', () => {
	const rowsOf = createRowCache();
	const lines = Array.from({length: 10}, () => line(2));
	const a = scrollAnchor(lines, null, 3, rowsOf, W, 4);
	const before = visibleWindow(lines, a, rowsOf, W, 4);
	const more = [...lines, line(3)];
	assert.equal(normalizeAnchor(more, a, rowsOf, W, 4), a);
	const after = visibleWindow(more, a, rowsOf, W, 4);
	assert.deepEqual(after.rows, before.rows);
	assert.equal(after.newer, before.newer + 3);
});

test('a trimmed anchor line moves the view to the top of what remains', () => {
	const rowsOf = createRowCache();
	const lines = Array.from({length: 10}, () => line(1));
	const a = scrollAnchor(lines, null, 100, rowsOf, W, 3)!;
	assert.equal(a.id, lines[2]!.id);
	const trimmed = lines.slice(4);
	const b = normalizeAnchor(trimmed, a, rowsOf, W, 3);
	assert.equal(visibleWindow(trimmed, b, rowsOf, W, 3).rows[0]!.key, `${trimmed[0]!.id}:0`);
	assert.equal(normalizeAnchor(lines.slice(8), a, rowsOf, W, 3), null);
});

test('a resize scales the hidden rows of the anchored line', () => {
	const rowsOf = createRowCache();
	const lines = [line(4), line(8), line(4)];
	const a: Anchor = {id: lines[1]!.id, hidden: 4, of: 8};
	assert.equal(visibleWindow(lines, a, rowsOf, W * 2, 2).newer, 2 + 2);
	assert.equal(normalizeAnchor(lines, a, rowsOf, W * 2, 2), a);
	assert.equal(visibleWindow(lines, a, rowsOf, W * 8, 2).newer, 0 + 1);
});

test('normalizeAnchor returns the same object when nothing changed and null when following', () => {
	const rowsOf = createRowCache();
	const lines = Array.from({length: 10}, () => line(1));
	const a = scrollAnchor(lines, null, 2, rowsOf, W, 3);
	assert.ok(a);
	assert.equal(normalizeAnchor(lines, a, rowsOf, W, 3), a);
	assert.equal(normalizeAnchor(lines, null, rowsOf, W, 3), null);
	const bottom: Anchor = {id: lines[9]!.id, hidden: 0, of: 1};
	assert.equal(normalizeAnchor(lines, bottom, rowsOf, W, 3), null);
});

test('a taller view at the top moves the anchor to the new top position', () => {
	const rowsOf = createRowCache();
	const lines = Array.from({length: 10}, () => line(1));
	const a = scrollAnchor(lines, null, 100, rowsOf, W, 5)!;
	assert.equal(a.id, lines[4]!.id);
	const b = normalizeAnchor(lines, a, rowsOf, W, 6)!;
	assert.equal(b.id, lines[5]!.id);
	assert.equal(texts(lines, b, 6)[0], `${lines[0]!.id}:0`);
});

test('a line with render is laid out from its text for each width, once per width', () => {
	const widths: number[] = [];
	const l: Line = {id: nextId++, text: 'fallback', render: w => (widths.push(w), 'x'.repeat(w))};
	const rowsOf = createRowCache();
	assert.deepEqual(rowsOf(l, 4), ['xxxx']);
	assert.deepEqual(rowsOf(l, 4), ['xxxx']);
	assert.deepEqual(rowsOf(l, 6), ['xxxxxx']);
	assert.deepEqual(widths, [4, 6]);
});

test('a render that throws or returns no string falls back to the printed text', () => {
	assert.equal(lineText({id: 1, text: 'plain', render: () => { throw new Error('boom'); }}, 10), 'plain');
	assert.equal(lineText({id: 2, text: 'plain', render: (() => 42) as unknown as (w: number) => string}, 10), 'plain');
	assert.equal(lineText({id: 3, text: 'plain'}, 10), 'plain');
	assert.equal(lineText({id: 4, text: 'plain', render: (() => ({text: 7})) as unknown as (w: number) => string}, 10), 'plain');
});

test('a render that returns text and actions replaces both for that width', () => {
	const printed = [{line: 0, copy: 'old'}];
	const l: Line = {id: nextId++, text: 'a\nb', actions: printed, render: w => ({text: `w${w}\nx\ny`, actions: [{line: 2, copy: `at ${w}`}, {line: -1, copy: 'bad'}]})};
	assert.deepEqual(renderedLine(l, 5), {text: 'w5\nx\ny', actions: [{line: 2, copy: 'at 5'}]});
	assert.deepEqual(renderedLine(l, 9).actions, [{line: 2, copy: 'at 9'}]);
	assert.equal(renderedLine({id: nextId++, text: 't', render: () => ({text: 'u'})}, 5).actions, undefined);
	assert.equal(renderedLine({id: nextId++, text: 't', actions: printed, render: () => 'u'}, 5).actions, printed);
	assert.equal(renderedLine({id: nextId++, text: 't', actions: printed}, 5).actions, printed);
});

test('a line is rendered once per width however often it is asked for', () => {
	let calls = 0;
	const l: Line = {id: nextId++, text: 't', render: w => (calls++, `r${w}`)};
	lineText(l, 3);
	renderedLine(l, 3);
	createRowCache()(l, 3);
	assert.equal(calls, 1);
	lineText(l, 4);
	assert.equal(calls, 2);
});
