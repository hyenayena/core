import assert from 'node:assert/strict';
import {test} from 'node:test';
import {styledCells, stringCells, wrapRows} from '../../src/kit/text.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test('empty and non-string input is 0', () => {
	assert.equal(styledCells(''), 0);
	assert.equal(styledCells(undefined as unknown as string), 0);
	assert.equal(styledCells(5 as unknown as string), 0);
});

test('plain text equals stringCells', () => {
	for (const s of ['abc', 'a b', '日本語', 'x😀y']) assert.equal(styledCells(s), stringCells(s));
});

test('SGR, CSI and OSC take no cells', () => {
	assert.equal(styledCells(`${ESC}[1;31mab${ESC}[0m`), 2);
	assert.equal(styledCells(`a${ESC}[2Kb`), 2);
	assert.equal(styledCells(`${ESC}]8;;http://x${BEL}link${ESC}]8;;${BEL}`), 4);
	assert.equal(styledCells(`${ESC}]8;;http://x${ESC}\\link${ESC}]8;;${ESC}\\`), 4);
});

test('CJK and emoji count as 2', () => {
	assert.equal(styledCells(`${ESC}[1m日本${ESC}[0m`), 4);
	assert.equal(styledCells(`${ESC}[1m😀${ESC}[0m`), 2);
});

test('wrapped rows never exceed the width', () => {
	let seed = 12345;
	const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
	const parts = ['ab', ' ', 'word', '日本', '😀', `${ESC}[31m`, `${ESC}[0m`, `${ESC}[1m`, 'x'];
	for (let i = 0; i < 200; i++) {
		let s = '';
		for (let j = 0, n = 1 + rnd(20); j < n; j++) s += parts[rnd(parts.length)];
		const w = 2 + rnd(10);
		for (const mode of ['word', 'char'] as const) {
			for (const row of wrapRows(s, w, {mode})) assert.ok(styledCells(row) <= w, JSON.stringify([s, w, row]));
		}
	}
});
