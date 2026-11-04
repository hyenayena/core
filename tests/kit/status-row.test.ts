import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	formatElapsed,
	paintTokens,
	ruledRows,
	statusRow,
	stripStyles,
	styledCells,
} from '../../src/kit/text.js';
import {SGR_RESET, toneSgr, withColorDepth} from '../../src/kit/theme.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}]`);

test('formatElapsed table', () => {
	const table: [number, string][] = [
		[0, '0.0s'],
		[999, '0.9s'],
		[1000, '1.0s'],
		[9_949, '9.9s'],
		[10_000, '10s'],
		[125_000, '2m 05s'],
		[3_720_000, '1h 02m'],
		[-5, '0.0s'],
		[Number.NaN, '0.0s'],
	];
	for (const [ms, text] of table) assert.equal(formatElapsed(ms), text, String(ms));
});

test('statusRow fits every width, drops detail, then right, then cuts the title', () => {
	const o = {mark: '✓', glyph: '▤', title: 'Read src/app.ts', detail: '120 lines', right: '1.2s'};
	for (const width of [10, 20, 40, 80, 160]) {
		for (const depth of ['truecolor', '16', 'none'] as const) {
			const row = statusRow({...o, width, depth});
			assert.ok(styledCells(row) <= width, `${width} ${depth}`);
		}
	}
	const wide = stripStyles(statusRow({...o, width: 80, depth: 'none'}));
	assert.ok(wide.startsWith('✓ ▤ Read src/app.ts  120 lines'), wide);
	assert.ok(wide.endsWith('  1.2s'), wide);
	assert.equal(styledCells(wide), 80);
	const noDetail = stripStyles(statusRow({...o, width: 28, depth: 'none'}));
	assert.ok(!noDetail.includes('120') && noDetail.endsWith('1.2s'), noDetail);
	const noRight = stripStyles(statusRow({...o, width: 20, depth: 'none'}));
	assert.ok(!noRight.includes('1.2s') && !noRight.includes('120'), noRight);
	const cut = stripStyles(statusRow({...o, width: 10, depth: 'none'}));
	assert.ok(cut.endsWith('…') && styledCells(cut) <= 10, cut);
});

test('statusRow colours: none has no colour params, truecolor tones present', () => {
	const none = statusRow({mark: '✓', title: 'x', detail: 'd', right: 'r', width: 40, depth: 'none'});
	assert.ok(!new RegExp(`${ESC}\\[[0-9;]*(?:3[0-9]|4[0-9]|9[0-7])(?:;|m)`).test(none), JSON.stringify(none));
	const tc = withColorDepth('truecolor', () => statusRow({mark: '✓', title: 'x', detail: 'd', right: 'r', rightTone: 'error', width: 40, depth: 'truecolor'}));
	assert.ok(tc.includes(toneSgr('muted', 'truecolor')));
	assert.ok(tc.includes(toneSgr('error', 'truecolor')));
});

test('statusRow strips control sequences from title, detail and right', () => {
	const evil = `a${ESC}]0;pwn${BEL}b${ESC}[2Jc${String.fromCharCode(1)}d`;
	const row = statusRow({mark: '✓', title: evil, detail: evil, right: evil, width: 120, depth: 'none'});
	assert.ok(!CONTROL.test(stripStyles(row)), JSON.stringify(row));
	assert.ok(!row.includes('pwn'));
});

test('ruledRows: head and tail caps, counts, wrap, empty, ascii', () => {
	const lines = Array.from({length: 12}, (_, i) => `line ${i + 1}`);
	const head = ruledRows(lines, {width: 40, maxRows: 5, depth: 'none'}).map(stripStyles);
	assert.equal(head.length, 5);
	assert.equal(head[0], '  │ line 1');
	assert.equal(head[4], '  │ … +8 lines (ctrl+o to expand)');
	const tail = ruledRows(lines, {width: 60, maxRows: 5, keep: 'tail', depth: 'none'}).map(stripStyles);
	assert.equal(tail[0], '  │ … +8 earlier lines (ctrl+o to expand)');
	assert.equal(tail[4], '  │ line 12');
	assert.deepEqual(ruledRows([], {width: 40}), []);
	const wrapped = ruledRows(['x'.repeat(50)], {width: 20, depth: 'none'}).map(stripStyles);
	assert.ok(wrapped.length > 2);
	for (const r of wrapped) assert.ok(styledCells(r) <= 20);
	assert.equal(ruledRows(['a\nb'], {width: 20, depth: 'none'}).length, 2);
	assert.equal(stripStyles(ruledRows(['a'], {width: 20, ascii: true, depth: 'none'})[0]!), '  | a');
	assert.equal(stripStyles(ruledRows(lines, {width: 40, maxRows: 5, moreHint: '', depth: 'none'})[4]!), '  │ … +8 lines');
	const evil = ruledRows([`a${ESC}]0;pwn${BEL}b${String.fromCharCode(1)}`], {width: 40, depth: 'none'});
	assert.ok(!CONTROL.test(stripStyles(evil.join(''))));
	const tc = ruledRows(['a'], {width: 40, depth: 'truecolor'})[0]!;
	assert.ok(tc.includes(toneSgr('frame', 'truecolor')) && tc.includes(toneSgr('muted', 'truecolor')));
});

test('paintTokens per depth', () => {
	const tokens = [{text: 'if', tone: 'code.keyword' as const}, {text: ' x'}];
	assert.equal(paintTokens(tokens, 'none'), 'if x');
	assert.equal(paintTokens(tokens, '16'), 'if x');
	for (const depth of ['truecolor', '256'] as const) {
		const out = paintTokens(tokens, depth);
		assert.equal(out, `${toneSgr('code.keyword', depth)}if${ESC}[39m x`);
		assert.ok(!out.includes(SGR_RESET));
	}
});
