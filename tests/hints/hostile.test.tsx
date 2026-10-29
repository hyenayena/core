import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {mountHarness} from '../testkit.js';
import type {Command} from '../../../../src/api.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(7);
const RLO = String.fromCharCode(0x202e);
const LS = String.fromCharCode(0x2028);

const hostileDescription = [
	`${ESC}]52;c;ZXZpbA==${BEL}`,
	`${ESC}]8;;http://evil.example${BEL}link${ESC}]8;;${BEL}`,
	`${ESC}[31mred${ESC}[0m`,
	`${RLO}gnp.exe`,
	`line1\nline2${LS}line3`,
	'A'.repeat(10 * 1024),
].join(' ');

const plugin: Command[] = [
	{name: 'evil', description: hostileDescription, run: () => {}},
	{name: `bad${ESC}]52;c;AAAA${BEL}name`, description: 'dropped by name', run: () => {}},
	{name: 'new\nline', description: 'dropped by newline', run: () => {}},
	{name: `${RLO}rtl`, description: 'dropped by bidi', run: () => {}},
];

const INK_CSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');

function assertClean(output: string) {
	const rest = output.replace(INK_CSI, '');
	assert.ok(!rest.includes(ESC), 'raw ESC left in output');
	assert.ok(!rest.includes(BEL), 'raw BEL left in output');
	assert.ok(!rest.includes(RLO), 'bidi override left in output');
	assert.ok(!rest.includes(LS), 'line separator left in output');
	assert.ok(!output.includes('evil.example'), 'OSC 8 payload left in output');
	assert.ok(!output.includes('ZXZpbA'), 'OSC 52 payload left in output');
}

async function submit(h: ReturnType<typeof mountHarness>, line: string) {
	h.press(line);
	await h.settle();
	h.press('\r');
	await h.settle();
}

test('hostile metadata is sanitised in the list, help and the usage line', async () => {
	const columns = 60;
	const h = mountHarness(<App registry={createRegistry(plugin)} />, {columns, rows: 30});
	await h.settle();

	h.press('e');
	await h.settle();
	assert.match(h.lastFrame(), /evil/);
	const prompt = h.lastFrame().split('\n');
	for (const l of prompt) assert.ok(Array.from(l.replace(INK_CSI, '')).length <= columns, l);

	h.press('\x7f');
	await submit(h, 'help');
	await submit(h, 'help evil');
	await submit(h, 'help bad');
	assert.match(h.lastFrame(), /evil/);
	assert.doesNotMatch(h.lastFrame(), /rtl|dropped by/);
	assertClean(h.allOutput());
	h.unmount();
});

test('a hostile typed token is sanitised in the echo and the unknown-command line', async () => {
	const h = mountHarness(<App registry={createRegistry(plugin)} />, {columns: 60, rows: 30});
	await h.settle();
	h.press(`\x1b[200~${ESC}]52;c;ZXZpbA==${BEL}${RLO}zz\x1b[201~`);
	await h.settle();
	h.press('\r');
	await h.settle();
	assert.match(h.lastFrame(), /Unknown command:/);
	assertClean(h.allOutput());
	h.unmount();
});
