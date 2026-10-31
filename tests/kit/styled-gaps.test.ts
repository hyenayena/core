import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeStyled, plainLines, renderStyled, stringCells, table, line, span, textBlock, printStyled} from '../../src/kit/text.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CSI8 = String.fromCharCode(0x9b);
const strip = (s: string) => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
const hostile = `a${ESC}[31mb${ESC}]0;title${BEL}c${CSI8}31md‮e​f\ud800g\tz\nq`;
const noControl = (s: string) => !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩​-‏\ud800-\udfff]/.test(s);

test('hostile text never leaves control, bidi or lone surrogate characters in any block kind', () => {
	const blocks = [
		line(hostile, span(hostile, {tone: 'ok'})),
		table([[hostile, [span(hostile)]]], {head: [hostile, hostile]}),
		textBlock(hostile),
	];
	const text = JSON.stringify(blocks);
	assert.ok(text.includes('title'));
	const plain = plainLines(blocks).join('\n');
	assert.ok(noControl(plain.replace(/\n/g, '')), JSON.stringify(plain));
	for (const color of [true, false]) {
		const out = strip(renderStyled(blocks, 80, {color})).replace(/\n/g, '');
		assert.ok(noControl(out), JSON.stringify(out));
		assert.equal(out.includes(ESC), false);
	}
});

test('non-array and junk input yields no blocks without throwing', () => {
	for (const junk of [null, undefined, 5, 'x', {kind: 'rule'}, new Map(), () => 1]) {
		assert.deepEqual([...normalizeStyled(junk)], []);
		assert.deepEqual(plainLines(junk), []);
		assert.equal(renderStyled(junk, 40, {color: false}), '');
	}
});

test('circular and throwing structures are survived', () => {
	const loop: unknown[] = [];
	loop.push(loop, {kind: 'line', spans: loop}, {kind: 'table', rows: [loop, [loop]], head: loop});
	const out = normalizeStyled([...loop, {kind: 'line', spans: ['ok']}]);
	assert.ok(out.length >= 1);
	assert.ok(plainLines(out).includes('ok'));
	const bad = {
		get kind(): string {
			throw new Error('boom');
		},
	};
	assert.deepEqual(plainLines([bad, line('fine')]), ['fine']);
});

test('non-string head entries and span texts are tolerated', () => {
	const out = plainLines([{kind: 'table', head: [1, null, {}], rows: [[{text: 5}, [null, 'x']]]}]);
	assert.ok(Array.isArray(out));
});

test('wide characters never push a row past the width', () => {
	const rows = [['漢字漢字漢字漢字漢字漢字', '😀😀😀😀😀😀'], ['abc', 'é́́']];
	for (const width of [1, 2, 5, 10, 20, 40]) {
		const out = strip(renderStyled([table(rows, {head: ['名前', 'x'], flex: 0})], width, {color: false}));
		for (const l of out.split('\n')) {
			if (width >= 12 && l.includes('─')) assert.ok(stringCells(l) <= width);
		}
	}
	const flexed = strip(renderStyled([table([['漢字漢字漢字漢字漢字漢字漢字', 'ok']], {flex: 0})], 14, {color: false}));
	assert.ok(stringCells(flexed) <= 14, flexed);
	assert.ok(flexed.includes('…'));
});

test('a rule is exactly the width and width 0 or NaN does not throw', () => {
	assert.equal(strip(renderStyled([{kind: 'rule'}], 7, {color: false})), '─'.repeat(7));
	for (const w of [0, -3, NaN, Infinity]) assert.doesNotThrow(() => renderStyled([{kind: 'rule'}, line('a')], w, {color: true}));
});

test('colour off keeps only bold and dim, colour on adds tones', () => {
	const blocks = [line(span('e', {tone: 'error'}), span('m', {tone: 'muted'}), span('b', {bold: true}))];
	const off = renderStyled(blocks, 40, {color: false});
	assert.equal(off.includes(`${ESC}[31m`), false);
	assert.ok(off.includes(`${ESC}[2m`));
	assert.ok(off.includes(`${ESC}[1m`));
	assert.ok(renderStyled(blocks, 40, {color: true}).includes(`${ESC}[31m`));
});

test('printStyled falls back to plain print and prints nothing for empty output', () => {
	const seen: string[] = [];
	printStyled({print: t => seen.push(t)}, [line(span('x', {tone: 'ok'}), span('--', {decor: true}))]);
	printStyled({print: t => seen.push(t)}, []);
	assert.deepEqual(seen, ['x']);
});
