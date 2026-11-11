import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	MAX_ENTRIES,
	MAX_SECTIONS,
	appendEntries,
	beginSection,
	endSection,
	hasFolds,
	sectionRows,
	toggleFold,
	type PanelEntry,
	type PanelSection,
} from '../../src/panel/sections.js';
import {createRowCache} from '../../src/transcript/scroll.js';
import {stringCells} from '../../src/hints/width.js';
import {stripStyles} from '../../src/kit/text.js';

const ESC = String.fromCharCode(27);
let n = 1000;
const entry = (text: string, tone?: PanelEntry['tone']): PanelEntry => (tone === undefined ? {id: n++, text} : {id: n++, text, tone});
const rowsOf = createRowCache();
const plain = (sections: readonly PanelSection[], width = 40, extra: {expandAll?: boolean; now?: number} = {}) =>
	sectionRows(sections, rowsOf, {width, depth: 'none', now: 0, ...extra}).map(r => stripStyles(r.text));

function three(): PanelSection[] {
	let s: PanelSection[] = [];
	for (const [id, echo] of [[1, 'one'], [2, 'two'], [3, 'three']] as const) {
		s = beginSection(s, {id, echo}, 0);
		s = appendEntries(s, id, [entry(`out-${echo}`)], 0);
		s = endSection(s, id, 'ok', 10);
	}
	return s;
}

test('beginSection opens a running section with a sanitized echo and caller', () => {
	const s = beginSection([], {id: 1, echo: `ls${ESC}[31m\nx`, caller: 'bot'}, 5);
	assert.equal(s.length, 1);
	assert.equal(s[0]!.status, 'running');
	assert.equal(s[0]!.startedAt, 5);
	assert.equal(s[0]!.echo!.includes(ESC), false);
	assert.equal(s[0]!.echo!.includes('\n'), false);
	assert.equal(s[0]!.caller, 'bot');
});

test('output goes to its section while running; late output goes to one trailing loose section', () => {
	let s = beginSection([], {id: 1, echo: 'a'}, 0);
	s = appendEntries(s, 1, [entry('x')], 1);
	s = endSection(s, 1, 'ok', 2);
	s = appendEntries(s, 1, [entry('late-1')], 3);
	s = appendEntries(s, 1, [entry('late-2')], 4);
	assert.deepEqual(s.map(x => x.kind), ['command', 'loose']);
	assert.deepEqual(s[1]!.entries.map(e => e.text), ['late-1', 'late-2']);
	assert.deepEqual(plain(s), ['❯ a', '  x', '─'.repeat(40), '  late-1', '  late-2']);
});

test('output without a section goes to a loose section; a new command starts a new one after it', () => {
	let s = appendEntries([], undefined, [entry('boot')], 0);
	s = beginSection(s, {id: 7, echo: 'cmd'}, 1);
	s = appendEntries(s, undefined, [entry('stray')], 2);
	assert.deepEqual(s.map(x => x.kind), ['loose', 'command', 'loose']);
});

test('endSection records the status, elapsed time and a sanitized note', () => {
	let s = beginSection([], {id: 1, echo: 'a'}, 100);
	s = endSection(s, 1, 'failed', 2600, `bad${ESC}[0m`);
	assert.equal(s[0]!.status, 'failed');
	assert.equal(s[0]!.ms, 2500);
	assert.equal(s[0]!.note, 'bad');
	assert.equal(endSection(s, 1, 'ok', 9000)[0]!.status, 'failed', 'a finished section stays as it ended');
});

test('caps: sections and entries drop the oldest', () => {
	let s: PanelSection[] = [];
	for (let i = 0; i < MAX_SECTIONS + 5; i++) s = beginSection(s, {id: i + 1, echo: `c${i}`}, i);
	assert.equal(s.length, MAX_SECTIONS);
	assert.equal(s[0]!.echo, 'c5');
	s = beginSection([], {id: 1, echo: 'a'}, 0);
	s = appendEntries(s, 1, Array.from({length: MAX_ENTRIES + 50}, (_, i) => entry(`l${i}`)), 0);
	assert.equal(s[0]!.entries.length, MAX_ENTRIES);
	assert.equal(s[0]!.entries[0]!.text, 'l50');
	let t = three();
	t = appendEntries(t, undefined, Array.from({length: MAX_ENTRIES}, (_, i) => entry(`m${i}`)), 0);
	assert.equal(t.reduce((a, x) => a + x.entries.length, 0) <= MAX_ENTRIES, true);
	assert.equal(t.at(-1)!.kind, 'loose');
});

test('only the last two commands and running ones stay open; older ones fold to their header', () => {
	const s = three();
	const rows = plain(s);
	assert.equal(rows.some(r => r.includes('out-one')), false);
	assert.equal(rows.some(r => r.includes('out-two')), true);
	assert.equal(rows.some(r => r.includes('out-three')), true);
	assert.match(rows[0]!, /^❯ one\s+\+1$/);
	assert.equal(rows.filter(r => r.startsWith('❯')).length, 3);
	const running = beginSection(s, {id: 4, echo: 'four'}, 20);
	assert.equal(plain(running).some(r => r.includes('out-two')), false, 'two has two newer commands');
	assert.equal(plain(running).some(r => r.includes('out-three')), true);
	assert.equal(hasFolds(s), true);
	assert.equal(hasFolds(beginSection([], {id: 1, echo: 'a'}, 0)), false);
});

test('expandAll opens everything; toggleFold flips one section on its effective state', () => {
	const s = three();
	assert.equal(plain(s, 40, {expandAll: true}).some(r => r.includes('out-one')), true);
	const opened = toggleFold(s, 1);
	assert.equal(plain(opened).some(r => r.includes('out-one')), true);
	const closed = toggleFold(opened, 1);
	assert.equal(plain(closed).some(r => r.includes('out-one')), false);
	const foldedNewest = toggleFold(s, 3);
	assert.equal(plain(foldedNewest).some(r => r.includes('out-three')), false);
	assert.equal(toggleFold(beginSection([], {id: 9, echo: 'r'}, 0), 9)[0]!.folded, undefined, 'a running section cannot fold');
	assert.equal(plain(toggleFold(s, 1, true), 40, {expandAll: true}).some(r => r.includes('out-one')), false);
});

test('marks: prompt while running and when ok, a cross when failed; the failed note is an error row', () => {
	let s = beginSection([], {id: 1, echo: 'run', caller: 'bot'}, 0);
	assert.match(plain(s)[0]!, /^❯ run\s+bot$/);
	s = endSection(s, 1, 'failed', 100, 'run: error (boom)');
	s = appendEntries(s, 1, [entry('x')], 100);
	const rows = plain(s);
	assert.match(rows[0]!, /^✗ run\s+bot$/);
	assert.equal(rows.includes('  run: error (boom)'), true);
	const ascii = sectionRows(s, rowsOf, {width: 30, depth: 'none', ascii: true}).map(r => r.text);
	assert.match(ascii[0]!, /^x run/);
});

test('the header shows the elapsed time from one second and the folded line count', () => {
	let s = beginSection([], {id: 1, echo: 'slow'}, 0);
	assert.doesNotMatch(plain(s, 40, {now: 500})[0]!, /s$/);
	assert.match(plain(s, 40, {now: 65_000})[0]!, /1m 05s$/);
	s = endSection(s, 1, 'ok', 2000);
	assert.match(plain(s)[0]!, /2\.0s$/);
});

test('styled colours are in the rows and every row fits the width', () => {
	let s = beginSection([], {id: 1, echo: 'a very long command line that will not fit into a narrow panel at all', caller: 'assistant'}, 0);
	s = appendEntries(s, 1, [entry('x'.repeat(200), 'error'), entry('漢字'.repeat(30), 'warn'), {id: n++, text: 'styled', render: w => 'y'.repeat(w + 20)}], 0);
	s = endSection(s, 1, 'failed', 3000, 'z'.repeat(300));
	for (const depth of ['truecolor', 'none'] as const) {
		for (const width of [1, 5, 12, 30, 80]) {
			for (const row of sectionRows(s, rowsOf, {width, depth})) {
				assert.ok(stringCells(stripStyles(row.text)) <= width, `${depth} ${width}: ${stripStyles(row.text)}`);
			}
		}
	}
	const rows = sectionRows(s, rowsOf, {width: 30, depth: 'truecolor'});
	assert.equal(rows.some(r => r.text.includes(ESC)), true);
	assert.equal(rows.filter(r => r.header).length, 1);
	assert.equal(new Set(rows.map(r => r.key)).size, rows.length, 'row keys are unique');
});
