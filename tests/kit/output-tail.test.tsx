import React from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OutputTail} from '../../src/kit/ui.js';
import {tailRows} from '../../src/kit/text.js';
import {mountHarness} from '../testkit.js';

const ESC = String.fromCharCode(27);
const SGR = new RegExp(ESC + '\\[[0-9;?]*[A-Za-z]', 'g');
const plain = (s: string) => s.replace(SGR, '');

test('tailRows: everything fits, nothing is hidden', () => {
	assert.deepEqual(tailRows(['a', 'b'], 10, 5), {rows: ['a', 'b'], hiddenLines: 0});
	assert.deepEqual(tailRows([], 10, 5), {rows: [], hiddenLines: 0});
});

test('tailRows: the end is kept and an indicator replaces the first row', () => {
	const r = tailRows(['one', 'two', 'three', 'four'], 10, 3);
	assert.deepEqual(r.rows, ['… 2 earlier lines', 'three', 'four']);
	assert.equal(r.hiddenLines, 2);
});

test('tailRows: wrapped lines count by rows and a partly shown line counts as hidden', () => {
	const r = tailRows(['first', 'abcdefgh'], 4, 3);
	assert.equal(r.rows[0], '… 1 earlier line');
	assert.equal(r.rows.length, 3);
	assert.equal(r.rows.at(-1), 'efgh');
	assert.equal(r.hiddenLines, 1);
});

test('tailRows: a one-row budget shows the last row only, zero shows nothing', () => {
	assert.deepEqual(tailRows(['a', 'b', 'c'], 10, 1), {rows: ['c'], hiddenLines: 0});
	assert.deepEqual(tailRows(['a', 'b'], 10, 0), {rows: [], hiddenLines: 0});
	assert.deepEqual(tailRows(['a'], 10, Number.NaN).rows, []);
});

test('OutputTail draws the title, the indicator and the last rows', async () => {
	const lines = Array.from({length: 10}, (_v, i) => `line ${i}`);
	const h = mountHarness(<OutputTail lines={lines} width={30} rows={4} title="Bash" />, {columns: 40, rows: 10});
	await h.settle();
	const out = plain(h.lastFrame()).split('\n').map(l => l.trimEnd());
	assert.deepEqual(out.filter(Boolean), ['Bash', '… 8 earlier lines', 'line 8', 'line 9']);
	h.unmount();
});

test('OutputTail wraps long lines and never exceeds its rows', async () => {
	const h = mountHarness(<OutputTail lines={['x'.repeat(25), 'tail']} width={10} rows={3} />, {columns: 20, rows: 10});
	await h.settle();
	const out = plain(h.lastFrame()).split('\n').filter(l => l.trim() !== '');
	assert.equal(out.length, 3);
	assert.equal(out.at(-1)?.trim(), 'tail');
	h.unmount();
});

test('OutputTail strips escapes and control characters from the lines', async () => {
	const h = mountHarness(<OutputTail lines={[`a${ESC}]0;title\u0007b${ESC}[31mred‮`]} width={30} rows={2} />, {columns: 40, rows: 6});
	await h.settle();
	assert.ok(!h.allOutput().includes(`${ESC}]0`));
	assert.ok(!h.allOutput().includes('‮'));
	assert.match(plain(h.lastFrame()), /abred/);
	h.unmount();
});
