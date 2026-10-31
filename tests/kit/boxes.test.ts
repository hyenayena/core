import test from 'node:test';
import assert from 'node:assert/strict';
import {badgeRows, boxRows, frameAround, gridLayout, joinBlocks, type SpanRow} from '../../src/kit/text.js';
import {stringCells} from '../../src/hints/width.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const cells = (row: SpanRow) => row.reduce((n, s) => n + stringCells(s.text), 0);
const plain = (row: SpanRow) => row.map(s => s.text).join('');
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]');

function assertShape(rows: SpanRow[], width: number, height: number) {
	assert.equal(rows.length, height);
	for (const row of rows) {
		assert.equal(cells(row), width, JSON.stringify(plain(row)));
		assert.doesNotMatch(plain(row), CONTROL);
	}
}

test('the grid fills the width exactly, boxes in a row differ by at most one cell', () => {
	for (const count of [1, 2, 3, 5, 7, 12, 31]) {
		for (const width of [1, 7, 24, 79, 80, 119, 200]) {
			for (const minBoxWidth of [10, 24, 30]) {
				const grid = gridLayout({count, width, minBoxWidth});
				assert.equal(grid.perRow, Math.max(1, Math.min(count, Math.floor(width / minBoxWidth))));
				assert.equal(grid.rows.reduce((n, r) => n + r.count, 0), count);
				let next = 0;
				for (const row of grid.rows) {
					assert.equal(row.start, next);
					next += row.count;
					assert.equal(row.widths.length, row.count);
					assert.equal(row.widths.reduce((a, b) => a + b, 0), width);
					assert.ok(Math.max(...row.widths) - Math.min(...row.widths) <= 1);
					assert.ok(row.widths[0]! >= row.widths[row.widths.length - 1]!);
				}
			}
		}
	}
});

test('a short last row gets wider boxes', () => {
	const grid = gridLayout({count: 5, width: 79, minBoxWidth: 24});
	assert.equal(grid.perRow, 3);
	assert.deepEqual(grid.rows.map(r => r.widths), [[27, 26, 26], [40, 39]]);
});

test('no boxes, no rows', () => {
	assert.deepEqual(gridLayout({count: 0, width: 80, minBoxWidth: 20}), {perRow: 0, rows: []});
});

test('a box is exactly height rows of exactly width cells', () => {
	const titles: SpanRow[] = [
		[{text: '⠋ '}, {text: 'reviewer', bold: true}],
		[{text: '漢字のエージェント名前がとても長い'}],
		[{text: '🧑‍💻 agent 👍🏽 emoji 🇩🇪'}],
		[{text: `${ESC}[31mred${ESC}[0m ${ESC}]0;evil${BEL}x\ny\tz`}],
		[],
	];
	for (const title of titles) {
		for (const width of [8, 9, 12, 20, 33, 80]) {
			for (const height of [3, 4, 8]) {
				const rows = boxRows({
					width,
					height,
					title,
					meta: 'opus-4 漢字',
					footer: `12 tools ${ESC}[2J`,
					body: [[{text: 'Read src/app.tsx', tone: 'dim'}], [{text: '漢字'.repeat(40)}], [{text: '🧑‍💻'.repeat(30)}]],
				});
				assertShape(rows, width, height);
			}
		}
	}
});

test('the box draws round corners, title, meta and footer', () => {
	const rows = boxRows({width: 30, height: 4, title: [{text: 'scout'}], meta: 'haiku', footer: 'done', body: [[{text: 'hello'}]]});
	assert.deepEqual(rows.map(plain), [
		`╭ scout ${'─'.repeat(14)} haiku ╮`,
		`│ hello${' '.repeat(21)} │`,
		`│${' '.repeat(28)}│`,
		`╰─ done ${'─'.repeat(21)}╯`,
	]);
});

test('a narrow box truncates the title first, then drops the meta', () => {
	const wide = boxRows({width: 30, height: 3, title: [{text: 'a-very-long-agent-name'}], meta: 'sonnet', body: []});
	assert.match(plain(wide[0]!), /^╭ a-very-long-agen…\s─+ sonnet ╮$/u);
	const narrow = boxRows({width: 14, height: 3, title: [{text: 'a-very-long-agent-name'}], meta: 'sonnet', body: []});
	assert.doesNotMatch(plain(narrow[0]!), /sonnet/);
	assert.match(plain(narrow[0]!), /^╭ a-very-l… ─╮$/u);
});

test('below the minimum the box still keeps its minimum size', () => {
	assertShape(boxRows({width: 2, height: 1, title: [{text: 'x'}], body: []}), 8, 3);
	assertShape(boxRows({width: Number.NaN, height: Number.NaN, title: [], body: []}), 8, 3);
});

test('highlight makes the border info and bold; open also inverts the title', () => {
	const selected = boxRows({width: 20, height: 3, title: [{text: 'a'}], body: [], highlight: 'selected', tone: 'dim'});
	assert.equal(selected[0]![0]!.tone, 'info');
	assert.equal(selected[0]![0]!.bold, true);
	assert.notEqual(selected[0]![1]!.inverse, true);
	const open = boxRows({width: 20, height: 3, title: [{text: 'a'}], body: [], highlight: 'open'});
	assert.equal(open[0]![1]!.inverse, true);
	const done = boxRows({width: 20, height: 3, title: [{text: 'a'}], body: [], tone: 'dim'});
	assert.equal(done[0]![0]!.tone, 'dim');
});

test('a badge replaces the body and sits in the middle', () => {
	const rows = boxRows({width: 20, height: 7, title: [{text: 'a'}], body: [[{text: 'hidden'}]], tone: 'dim', badge: {word: 'DONE', tone: 'add'}});
	assertShape(rows, 20, 7);
	const text = rows.map(plain);
	assert.ok(!text.some(r => r.includes('hidden')));
	assert.deepEqual(text.slice(2, 5), ['│     ┌──────┐     │', '│     │ DONE │     │', '│     └──────┘     │']);
	const word = rows[3]!.find(s => s.text === 'DONE')!;
	assert.equal(word.tone, 'add');
	assert.equal(word.bold, true);
});

test('the badge degrades to one row, then to the bare word', () => {
	assert.deepEqual(badgeRows('DONE', 'add', 20, 3).map(plain), ['┌──────┐', '│ DONE │', '└──────┘']);
	assert.deepEqual(badgeRows('DONE', 'add', 20, 2).map(plain), ['[ DONE ]']);
	assert.deepEqual(badgeRows('DONE', 'add', 6, 3).map(plain), ['DONE']);
	assert.deepEqual(badgeRows('STOPPED', 'warn', 4, 3).map(plain), ['STO…']);
	assert.deepEqual(badgeRows('DONE', 'add', 0, 3), []);
	const small = boxRows({width: 10, height: 3, title: [], body: [], badge: {word: 'FAILED', tone: 'del'}});
	assertShape(small, 10, 3);
	assert.match(plain(small[1]!), /FAIL…|FAILED/);
});

test('frameAround wraps a block with a titled frame of the given width', () => {
	const inner = boxRows({width: 18, height: 3, title: [{text: 'child'}], body: []});
	const framed = frameAround(inner, 20, {title: 'lead → 2 agents', footer: 'x', tone: 'dim'});
	assertShape(framed, 20, 5);
	assert.match(plain(framed[0]!), /^╭─ lead → 2 agen… ─╮$/u);
	assert.equal(framed[0]![0]!.tone, 'dim');
	assertShape(frameAround([[{text: '漢字'.repeat(30)}]], 9, {title: '漢字'.repeat(10)}), 9, 3);
});

test('joinBlocks puts blocks side by side and pads the shorter ones', () => {
	const a = boxRows({width: 10, height: 4, title: [{text: 'a'}], body: []});
	const b = boxRows({width: 12, height: 3, title: [{text: 'b'}], body: []});
	const joined = joinBlocks([a, b], [10, 12]);
	assertShape(joined, 22, 4);
	assert.equal(plain(joined[3]!).slice(10), ' '.repeat(12));
	assert.equal(plain(joined[0]!), plain(a[0]!) + plain(b[0]!));
});
