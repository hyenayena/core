import assert from 'node:assert/strict';
import {test} from 'node:test';
import {layoutHints, rowBudget, type HintRow} from '../../src/hints/layout.js';
import type {HintItem, HintResult} from '../../src/hints/model.js';
import {computeHints} from '../../src/hints/model.js';
import {stringCells} from '../../src/hints/width.js';
import {catalog} from './fixture.js';

const item = (label: string, description = 'desc', ranges: Array<[number, number]> = []): HintItem => ({
	insert: label,
	label,
	description,
	ranges,
	prefix: true,
});

const many = (n: number, usage = true): HintResult => ({
	stage: 'command',
	tokenStart: 0,
	token: 'c',
	items: Array.from({length: n}, (_, i) => item(`cmd${i}`)),
	...(usage ? {usage: {head: 'cmd', tokens: [], active: -1}} : {}),
});

const text = (r: HintRow) => r.segments.map(s => s.text).join('');
const kinds = (rows: HintRow[]) => rows.map(r => r.kind);

test('row budget table', () => {
	const table: Array<[number, number]> = [
		[24, 7], [17, 7], [16, 4], [11, 4], [10, 2], [4, 2], [3, 1], [2, 0], [1, 0], [0, 0],
	];
	for (const [rows, max] of table) assert.equal(rowBudget(rows, 80).max, max, `rows=${rows}`);
	assert.equal(rowBudget(24, 7).max, 0);
	assert.equal(rowBudget(NaN, 80).max, 7);
});

test('24 rows: usage, five items and a footer', () => {
	const rows = layoutHints(many(20), {sel: 0}, {columns: 80, rows: 24});
	assert.deepEqual(kinds(rows), ['usage', 'item', 'item', 'item', 'item', 'item', 'footer']);
	assert.equal(text(rows[6]!).trim(), '+15 more');
});

test('10 rows: two rows, usage dropped', () => {
	const rows = layoutHints(many(20), {sel: 0}, {columns: 80, rows: 10});
	assert.deepEqual(kinds(rows), ['item', 'footer']);
	assert.equal(text(rows[1]!).trim(), '+19 more');
});

test('all items shown without footer when they fit', () => {
	const rows = layoutHints(many(3), {sel: 0}, {columns: 80, rows: 24});
	assert.deepEqual(kinds(rows), ['usage', 'item', 'item', 'item']);
});

test('a single available row shows only the selected item', () => {
	const rows = layoutHints(many(5), {sel: 3}, {columns: 80, rows: 3});
	assert.equal(rows.length, 1);
	assert.ok(text(rows[0]!).includes('cmd3'));
	assert.ok(rows[0]!.selected);
});

test('no rows at 2 rows or fewer and under 8 columns', () => {
	assert.deepEqual(layoutHints(many(5), {sel: 0}, {columns: 80, rows: 2}), []);
	assert.deepEqual(layoutHints(many(5), {sel: 0}, {columns: 7, rows: 24}), []);
});

test('usage-only result renders just the usage row', () => {
	const h = computeHints(catalog, 'claude ask ');
	const rows = layoutHints(h, {sel: 0}, {columns: 80, rows: 10});
	assert.deepEqual(kinds(rows), ['usage']);
	const active = rows[0]!.segments.find(s => s.bold && s.underline);
	assert.equal(active?.text, '<text>');
});

test('stage none renders nothing', () => {
	assert.deepEqual(layoutHints({stage: 'none', tokenStart: 0, token: '', items: []}, {sel: 0}, {columns: 80, rows: 24}), []);
});

test('the selection stays visible while scrolling and wraps', () => {
	const h = many(20);
	for (const sel of [0, 1, 4, 5, 9, 10, 18, 19]) {
		const rows = layoutHints(h, {sel}, {columns: 80, rows: 24});
		const selected = rows.filter(r => r.selected);
		assert.equal(selected.length, 1, `sel=${sel}`);
		assert.ok(text(selected[0]!).includes(`cmd${sel} `), `sel=${sel}`);
	}
});

test('selection out of range is clamped', () => {
	const rows = layoutHints(many(3), {sel: 99}, {columns: 80, rows: 24});
	assert.equal(rows.filter(r => r.selected).length, 1);
	assert.equal(layoutHints(many(3), {sel: -4}, {columns: 80, rows: 24}).filter(r => r.selected).length, 1);
});

test('command stage shows the usage of the selected item', () => {
	const h = computeHints(catalog, 'e');
	const first = layoutHints(h, {sel: 0}, {columns: 80, rows: 24})[0]!;
	const second = layoutHints(h, {sel: 1}, {columns: 80, rows: 24})[0]!;
	assert.equal(first.kind, 'usage');
	assert.notEqual(text(first), text(second));
});

test('matched ranges are underlined and bold, colour is optional', () => {
	const h: HintResult = {stage: 'command', tokenStart: 0, token: 'e', items: [item('echo', 'x', [[0, 2]])]};
	const coloured = layoutHints(h, {sel: 0, color: true}, {columns: 80, rows: 24})[0]!;
	const hit = coloured.segments.find(s => s.underline)!;
	assert.equal(hit.text, 'ec');
	assert.equal(hit.bold, true);
	assert.equal(hit.color, 'cyan');
	const plain = layoutHints(h, {sel: 0, color: false}, {columns: 80, rows: 24})[0]!;
	assert.equal(plain.segments.find(s => s.underline)!.color, undefined);
	assert.ok(text(plain).startsWith('› echo'));
});

test('rows are bounded by columns - 1 cells, including wide text', () => {
	const wide: HintResult = {
		stage: 'command',
		tokenStart: 0,
		token: '',
		usage: {head: '日本語'.repeat(10), tokens: [{text: '<😀>', kind: 'slot', variadic: false}], active: 0},
		items: [
			item('日本語コマンド', '説明'.repeat(30), [[0, 2]]),
			item('😀'.repeat(30), '👨‍👩‍👧'.repeat(30)),
			item('ascii-name', 'x'.repeat(300)),
			item('a', 'b'),
			item('c', 'd'),
			item('e', 'f'),
			item('g', 'h'),
		],
	};
	for (const columns of [80, 40, 20, 19, 8, 3]) {
		for (const rows of [24, 12, 5]) {
			const out = layoutHints(wide, {sel: 1}, {columns, rows});
			for (const r of out) {
				assert.ok(stringCells(text(r)) <= Math.max(0, columns - 1), `${columns}x${rows}: ${text(r)}`);
			}
		}
	}
});

test('narrow terminals drop descriptions', () => {
	const rows = layoutHints(many(2), {sel: 0}, {columns: 19, rows: 24});
	assert.ok(!text(rows[1]!).includes('desc'));
	const wideRows = layoutHints(many(2), {sel: 0}, {columns: 40, rows: 24});
	assert.ok(text(wideRows[1]!).includes('desc'));
});

test('alias rows mention the canonical name', () => {
	const h = computeHints(catalog, 'mod i');
	const rows = layoutHints(h, {sel: 0}, {columns: 80, rows: 24});
	assert.ok(text(rows.find(r => r.kind === 'item')!).includes('(install)'));
});

test('malformed results never throw', () => {
	const bad = [
		{stage: 'sub', items: null},
		{stage: 'command', tokenStart: 0, token: '', items: [{label: 5, ranges: 'x'}]},
		undefined,
	] as unknown as HintResult[];
	for (const h of bad) assert.doesNotThrow(() => layoutHints(h, {sel: 0}, {columns: 80, rows: 24}));
	assert.doesNotThrow(() => layoutHints(many(3), {sel: NaN}, {columns: NaN, rows: NaN}));
});

test('a usage-only result without items renders only the usage row at small heights', () => {
	const h = computeHints(catalog, 'claude auth login ');
	for (const rows of [24, 10, 3]) {
		assert.deepEqual(kinds(layoutHints(h, {sel: 0}, {columns: 80, rows})), ['usage']);
	}
	assert.deepEqual(layoutHints(h, {sel: 0}, {columns: 80, rows: 2}), []);
});

const items = (rows: HintRow[]) => rows.map(r => r.item);

test('item rows carry their index in h.items, other rows none', () => {
	const rows = layoutHints(many(3), {sel: 0}, {columns: 80, rows: 24});
	assert.deepEqual(items(rows), [undefined, 0, 1, 2]);
});

test('the item index follows the +N more window', () => {
	const rows = layoutHints(many(20), {sel: 12}, {columns: 80, rows: 24});
	assert.deepEqual(kinds(rows), ['usage', 'item', 'item', 'item', 'item', 'item', 'footer']);
	assert.deepEqual(items(rows), [undefined, 10, 11, 12, 13, 14, undefined]);
	for (const r of rows.filter(r => r.kind === 'item')) {
		assert.ok(text(r).includes(`cmd${r.item}`));
		assert.equal(r.selected, r.item === 12);
	}
	const end = layoutHints(many(20), {sel: 19}, {columns: 80, rows: 24});
	assert.deepEqual(items(end), [undefined, 15, 16, 17, 18, 19, undefined]);
});

test('a single available row carries the selected index', () => {
	assert.deepEqual(items(layoutHints(many(5), {sel: 3}, {columns: 80, rows: 3})), [3]);
});

test('the sub stage shows the selected subcommand usage', () => {
	const h = computeHints(catalog, 'doc ');
	const rows = layoutHints(h, {sel: 0}, {columns: 80, rows: 24});
	assert.equal(rows[0]!.kind, 'usage');
	assert.match(text(rows[0]!), /doc ask \[--new\]/);
	const second = layoutHints(h, {sel: 1}, {columns: 80, rows: 24});
	assert.match(text(second[0]!), /doc auth <login\|logout>/);
});

test('a doc row follows the usage when there are no items', () => {
	const h = computeHints(catalog, 'doc ask ');
	const rows = layoutHints(h, {sel: 0}, {columns: 80, rows: 24});
	assert.deepEqual(kinds(rows), ['usage', 'doc']);
	assert.equal(text(rows[1]!), '  <text>…  What to ask');
	assert.deepEqual(rows[1]!.segments.map(s => [s.bold === true, s.dim === true]), [[false, false], [true, false], [false, false], [false, true]]);
	assert.deepEqual(kinds(layoutHints(h, {sel: 0}, {columns: 80, rows: 3})), ['usage']);
	const narrow = layoutHints(h, {sel: 0}, {columns: 14, rows: 24});
	for (const r of narrow) assert.ok(stringCells(text(r)) <= 13);
	assert.deepEqual(kinds(layoutHints(computeHints(catalog, 'doc ask -'), {sel: 0}, {columns: 80, rows: 24})), ['usage', 'item', 'item']);
});
