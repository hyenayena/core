import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cellWidth, graphemes, stringCells} from '../../src/hints/width.js';
import {renderCodeFrame, wrapCodeTokens} from '../../src/kit/code-frame.js';
import {SGR_ATTR, withColorDepth} from '../../src/kit/theme.js';
import {styledCells, stripStyles} from '../../src/kit/text.js';

const ESC = String.fromCharCode(27);
const plain = (rows: readonly string[]): string[] => rows.map(stripStyles);
const tok = (text: string, tone?: 'code.keyword') => (tone === undefined ? {text} : {text, tone});
const texts = (rows: ReturnType<typeof wrapCodeTokens>): string[] => rows.map(r => r.map(t => t.text).join(''));

test('rows never exceed the width, widths 4..200', () => {
	const lines = [
		[tok('const ', 'code.keyword'), tok('value = someFunction(argumentOne, argumentTwo, "a long string literal");')],
		[tok('    '.repeat(5) + 'x'.repeat(120))],
		[tok('日本語のテキスト😀😀😀 mixed with ascii words and more words to force wrapping')],
		[],
	];
	for (let w = 4; w <= 200; w++) {
		for (const depth of ['none', 'truecolor'] as const) {
			const rows = withColorDepth(depth, () => renderCodeFrame({lines, width: w, label: 'typescript', right: 'copy'}));
			for (const r of rows) assert.ok(styledCells(r) <= w, `${w}: ${stripStyles(r)}`);
		}
	}
});

test('wrap breaks between tokens and keeps the text', () => {
	const rows = texts(wrapCodeTokens([tok('alpha beta gamma delta')], 11));
	assert.deepEqual(rows, ['alpha beta', 'gamma delta']);
	assert.equal(rows.join(' ').replace(/ +/g, ' '), 'alpha beta gamma delta');
	assert.deepEqual(texts(wrapCodeTokens([tok('foo(a,b,c)')], 6)), ['foo(a,', 'b,c)']);
});

test('a token wider than the row is split', () => {
	const rows = texts(wrapCodeTokens([tok('x'.repeat(25))], 10));
	assert.deepEqual(rows, ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
	const cjk = wrapCodeTokens([tok('日本語日本語日本語')], 6);
	for (const r of cjk) assert.ok(stringCells(r.map(t => t.text).join('')) <= 6);
	assert.equal(cjk.map(r => r.map(t => t.text).join('')).join(''), '日本語日本語日本語');
});

test('tones survive the wrap and adjacent equal tones merge', () => {
	const rows = wrapCodeTokens([tok('let', 'code.keyword'), tok(' abc def ghi')], 8);
	assert.deepEqual(rows[0], [{text: 'let', tone: 'code.keyword'}, {text: ' abc'}]);
});

test('empty input is one empty row', () => {
	assert.deepEqual(wrapCodeTokens([], 10), [[]]);
});

test('tabs become spaces and hostile control sequences are removed', () => {
	const hostile = `a\tb${ESC}]8;;http://x${String.fromCharCode(7)}c${ESC}[31md${String.fromCharCode(0x9b)}e${String.fromCharCode(127)}`;
	const rows = renderCodeFrame({lines: [[tok(hostile)]], width: 80, depth: 'none'});
	const body = stripStyles(rows[1]!);
	assert.ok(body.startsWith('│ a    b'));
	assert.ok(!body.includes(ESC) && !rows[1]!.replace(/\x1b\[[0-9;]*m/g, '').includes(ESC));
	assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(body));
	assert.ok(!body.includes(String.fromCharCode(7)));
});

test('frame shape: top border with label and right, gutter, bottom border', () => {
	const rows = withColorDepth('none', () => plain(renderCodeFrame({lines: [[tok('one')], [tok('two')]], width: 30, label: 'typescript', right: 'copy'})));
	assert.equal(rows.length, 4);
	assert.equal(rows[0], '╭─ typescript ──────── copy ─╮');
	assert.equal(stringCells(rows[0]!), 30);
	assert.equal(rows[1], '│ one');
	assert.equal(rows[2], '│ two');
	assert.equal(rows[3], '╰' + '─'.repeat(28) + '╯');
});

test('continuation rows use the wrap gutter', () => {
	const rows = withColorDepth('none', () => plain(renderCodeFrame({lines: [[tok('x'.repeat(20))]], width: 12})));
	assert.equal(rows[1], '│ ' + 'x'.repeat(10));
	assert.equal(rows[2], '│↪' + 'x'.repeat(10));
});

test('label is truncated first, then the right text is dropped', () => {
	const top = (width: number, label: string, right?: string): string =>
		withColorDepth('none', () => stripStyles(renderCodeFrame({lines: [], width, label, ...(right === undefined ? {} : {right})})[0]!));
	const t20 = top(20, 'a-very-long-language-name', 'copy');
	assert.ok(t20.includes('copy'));
	assert.ok(t20.includes('…'));
	assert.equal(stringCells(t20), 20);
	const t10 = top(10, 'a-very-long-language-name', 'copy');
	assert.ok(!t10.includes('copy'));
	assert.ok(t10.includes('…'));
	assert.equal(stringCells(t10), 10);
	const t3 = top(3, 'typescript', 'copy');
	assert.ok(stringCells(t3) <= 3);
});

test('right text is underlined and muted; plain label is not', () => {
	const row = renderCodeFrame({lines: [], width: 30, label: 'ts', right: 'copy', depth: 'truecolor'})[0]!;
	assert.ok(row.includes(`${SGR_ATTR.underline}${ESC}[38;2;139;139;139mcopy`));
});

test('open frame has no bottom border', () => {
	const rows = plain(renderCodeFrame({lines: [[tok('a')]], width: 20, label: 'ts', open: true, depth: 'none'}));
	assert.equal(rows.length, 2);
	assert.ok(rows[0]!.startsWith('╭─ ts '));
});

test('maxRows hides the rest and reports it in the bottom border', () => {
	const lines = Array.from({length: 10}, (_, i) => [tok(`line ${i}`)]);
	const rows = plain(renderCodeFrame({lines, width: 30, maxRows: 4, depth: 'none'}));
	assert.equal(rows.length, 1 + 4 + 1);
	assert.equal(rows.at(-1), '╰─ ⋯ +6 lines ' + '─'.repeat(15) + '╯');
	assert.equal(stringCells(rows.at(-1)!), 30);
	const open = plain(renderCodeFrame({lines, width: 30, maxRows: 4, open: true, depth: 'none'}));
	assert.ok(open.at(-1)!.includes('+6 lines'));
	const one = plain(renderCodeFrame({lines: [[tok('x'.repeat(100))]], width: 12, maxRows: 3, depth: 'none'}));
	assert.equal(one.length, 5);
});

test('ascii glyphs', () => {
	const rows = plain(renderCodeFrame({lines: [[tok('x'.repeat(20))]], width: 12, label: 'ts', ascii: true, depth: 'none', maxRows: 1, ...{}}));
	assert.ok(rows.every(r => /^[\x20-\x7e]*$/.test(r)), rows.join('\n'));
	assert.equal(rows[0]![0], '+');
});

test('depths: syntax colours only at truecolor and 256', () => {
	const lines = [[tok('let', 'code.keyword'), tok(' x')]];
	const body = (d: 'none' | '16' | '256' | 'truecolor'): string => renderCodeFrame({lines, width: 20, depth: d})[1]!;
	assert.ok(body('truecolor').includes(`${ESC}[38;2;198;120;221mlet`));
	assert.ok(body('256').includes(`${ESC}[38;5;170mlet`));
	assert.ok(!body('16').includes('38;') && !body('16').includes('\x1b[3'));
	assert.equal(stripStyles(body('16')), '│ let x');
	assert.equal(stripStyles(body('none')), '│ let x');
});

test('hostile wide input stays within the width and is linear', () => {
	const big = [tok('日'.repeat(50_000))];
	const t = Date.now();
	const rows = renderCodeFrame({lines: [big], width: 40, maxRows: 120, depth: 'none'});
	assert.ok(Date.now() - t < 2000);
	for (const r of rows) assert.ok(styledCells(r) <= 40);
	assert.ok(graphemes('x').length === 1 && cellWidth('x') === 1);
});
