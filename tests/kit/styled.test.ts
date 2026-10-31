import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {StyledBlock} from '../../../../src/api.js';
import {
	decorLine,
	line,
	MAX_ROW_CELLS,
	MAX_SPAN_CODE_POINTS,
	MAX_SPANS,
	MAX_STYLED_BLOCKS,
	MAX_TABLE_ROWS,
	normalizeStyled,
	plainLines,
	printStyled,
	renderStyled,
	rule,
	span,
	stringCells,
	table,
	textBlock,
} from '../../src/kit/text.js';

const ESC = String.fromCharCode(27);
const strip = (s: string) => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

test('the builders make the documented blocks', () => {
	assert.deepEqual(span('a', {tone: 'ok', bold: true, decor: true}), {text: 'a', tone: 'ok', bold: true, decor: true});
	assert.deepEqual(span('a'), {text: 'a'});
	assert.deepEqual(line('a', span('b')), {kind: 'line', spans: ['a', {text: 'b'}]});
	assert.deepEqual(decorLine(), {kind: 'line', spans: [], decor: true});
	assert.deepEqual(rule(), {kind: 'rule'});
	assert.deepEqual(table([['a']], {head: ['H'], flex: 0}), {kind: 'table', rows: [['a']], head: ['H'], flex: 0});
	assert.deepEqual(textBlock('x', 'muted'), {kind: 'text', text: 'x', tone: 'muted'});
});

test('normalizing drops unknown kinds, tones and non-boolean flags and copies the input', () => {
	const spans: unknown[] = [{text: 'a', tone: 'pink', bold: 'yes', decor: 1}, 42, null, 'b'];
	const input = [{kind: 'line', spans}, {kind: 'nope'}, null, 'text', {kind: 'line'}, {kind: 'table', rows: [['x'], 'bad'], flex: 1.5}];
	const n = normalizeStyled(input);
	assert.deepEqual(JSON.parse(JSON.stringify(n)), [
		{kind: 'line', spans: [{text: 'a'}, {text: 'b'}], decor: false},
		{kind: 'table', rows: [[[{text: 'x'}]]]},
	]);
	spans.push('later');
	assert.deepEqual(plainLines(n), ['ab', 'x']);
	assert.equal(normalizeStyled(n), n);
	assert.ok(Object.isFrozen(n));
	assert.deepEqual(normalizeStyled('x'), []);
	assert.deepEqual(normalizeStyled(undefined), []);
});

test('caps blocks, rows, cells, spans and span length', () => {
	assert.equal(normalizeStyled(Array.from({length: MAX_STYLED_BLOCKS + 5}, () => line('a'))).length, MAX_STYLED_BLOCKS);
	const big = normalizeStyled([table(Array.from({length: MAX_TABLE_ROWS + 3}, () => Array.from({length: MAX_ROW_CELLS + 4}, () => 'c')))]);
	const t = big[0] as Extract<(typeof big)[number], {kind: 'table'}>;
	assert.equal(t.rows.length, MAX_TABLE_ROWS);
	assert.equal(t.rows[0]!.length, MAX_ROW_CELLS);
	const many = normalizeStyled([line(...Array.from({length: MAX_SPANS + 10}, () => 'x'))]);
	assert.equal((many[0] as unknown as {spans: unknown[]}).spans.length, MAX_SPANS);
	const [long] = plainLines([line('y'.repeat(MAX_SPAN_CODE_POINTS * 3))]);
	assert.equal(Array.from(long!).length, MAX_SPAN_CODE_POINTS);
	assert.ok(long!.endsWith('…'));
	const head = normalizeStyled([table([], {head: ['h'.repeat(500)]})])[0] as unknown as {head: string[]};
	assert.ok(Array.from(head.head[0]!).length <= 200);
});

test('escapes, OSC sequences and format characters are stripped from every span', () => {
	const evil = `a${ESC}[31mred${ESC}]0;title\u0007b‮​c\td\ne\rf`;
	const blocks: StyledBlock[] = [
		line(evil, span(evil, {tone: 'warn'})),
		table([[evil, [span(evil)]]], {head: [evil]}),
		textBlock(`x${ESC}[2Jy\nz`),
	];
	const plain = plainLines(blocks).join('\n');
	const human = renderStyled(blocks, 200, {color: true});
	for (const out of [plain, strip(human)]) {
		assert.ok(!out.includes(ESC), out);
		assert.ok(!/[‮​\u0007\r\t]/.test(out), out);
	}
	assert.ok(plain.includes('aredbc    d ef'));
	assert.ok(plain.endsWith('xy\nz'));
});

test('the plain form drops decoration and joins table cells without padding', () => {
	const blocks = [
		line(span('Created ', {decor: true, tone: 'ok'}), '/tmp/x.md'),
		decorLine('between'),
		rule(),
		line(span('only decor', {decor: true})),
		table(
			[
				['  web/T-1', 'todo', 'Do it', '', '/a.md'],
				['web/LONG-22', 'done', 'Other', '(flag)', '/b.md   '],
			],
			{head: ['Task', 'Status']},
		),
		line('trailing   '),
		textBlock('one\ntwo  '),
	];
	assert.deepEqual(plainLines(blocks), ['/tmp/x.md', '  web/T-1  todo  Do it  /a.md', 'web/LONG-22  done  Other  (flag)  /b.md', 'trailing', 'one', 'two']);
	assert.deepEqual(plainLines([rule(), decorLine('x')]), []);
	assert.deepEqual(plainLines([]), []);
});

test('the human form pads columns, bolds and dims the head, rules it off and draws the rule across the width', () => {
	const blocks = [table([['a', 'todo', 'x'], ['long-label', 'done', 'y']], {head: ['Task', 'Status', 'Text']}), rule()];
	const out = renderStyled(blocks, 30, {color: true});
	assert.ok(out.includes(`${ESC}[1;2mTask${ESC}[0m`));
	assert.deepEqual(strip(out).split('\n'), [
		'Task        Status  Text',
		'─'.repeat(24),
		'a           todo    x',
		'long-label  done    y',
		'─'.repeat(30),
	]);
});

test('columns that are empty in every row are skipped in the human form', () => {
	const out = strip(renderStyled([table([['a', '', 'b'], ['c', '', 'd']], {head: ['A', '', 'B']})], 40, {color: false}));
	assert.deepEqual(out.split('\n'), ['A  B', '─'.repeat(4), 'a  b', 'c  d']);
});

test('the flex column is cut so rows fit the width, down to 8 cells', () => {
	const rows = [[span('id-1', {tone: 'accent'}), [span('[epic] ', {tone: 'accent', bold: true}), 'a rather long description of the task'], '/path/to/file.md']];
	const out = renderStyled([table(rows, {flex: 1})], 40, {color: true});
	for (const r of strip(out).split('\n')) assert.ok(stringCells(r) <= 40, r);
	assert.match(strip(out), /…/);
	assert.ok(out.includes(`${ESC}[1;36m[epic] ${ESC}[0m`));
	const narrow = strip(renderStyled([table(rows, {flex: 1})], 10, {color: false}));
	assert.match(narrow, /^id-1 {2}\[epic\] … {2}\/path/);
});

test('with colours off only bold and dim remain', () => {
	const blocks = [line(span('a', {tone: 'accent'}), span('b', {tone: 'muted'}), span('c', {bold: true}), span('d', {tone: 'error', bold: true})), textBlock('e', 'warn')];
	const out = renderStyled(blocks, 20, {color: false});
	assert.equal(out, `a${ESC}[2mb${ESC}[0m${ESC}[1mc${ESC}[0m${ESC}[1md${ESC}[0m\ne`);
	const on = renderStyled(blocks, 20, {color: true});
	assert.ok(on.includes(`${ESC}[36ma${ESC}[0m`));
	assert.ok(on.includes(`${ESC}[33me${ESC}[0m`));
});

test('a throwing getter drops only its own block', () => {
	const bad = {
		kind: 'line',
		get spans(): never {
			throw new Error('boom');
		},
	};
	assert.deepEqual(plainLines([line('a'), bad, line('b')]), ['a', 'b']);
	const revoked = Proxy.revocable([], {});
	revoked.revoke();
	assert.deepEqual(plainLines(revoked.proxy), []);
});

test('printStyled uses ctx.printStyled when present, else prints the plain form', () => {
	const blocks = [line(span('Done ', {decor: true}), 'x'), rule()];
	const printed: string[] = [];
	printStyled({print: t => void printed.push(t)}, blocks);
	assert.deepEqual(printed, ['x']);
	printStyled({print: t => void printed.push(t)}, [rule()]);
	assert.deepEqual(printed, ['x']);
	const got: unknown[] = [];
	printStyled({print: () => assert.fail('plain'), printStyled: b => void got.push(b)}, blocks);
	assert.deepEqual(got, [blocks]);
});
