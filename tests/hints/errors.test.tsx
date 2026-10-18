import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {mountHarness} from '../testkit.js';
import type {Command} from '../../../../src/api.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const INK_CSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');

const thrower = (name: string, value: () => unknown): Command => ({
	name,
	description: name,
	run: () => {
		throw value();
	},
});

const hostile = `${ESC}]8;;http://evil.example${BEL}click${ESC}]8;;${BEL}${ESC}[31mRED`;

const commands: Command[] = [
	thrower('osc', () => new Error(hostile)),
	thrower('big', () => new Error('x'.repeat(100 * 1024))),
	thrower('multi', () => new Error(Array.from({length: 100}, (_, i) => `line${i}`).join('\n'))),
	thrower('str', () => `${hostile} string`),
	thrower('nul', () => null),
	thrower('bad', () => ({
		toString() {
			throw new Error('nope');
		},
	})),
	{name: 'ok', description: 'works', run: (_a, ctx) => ctx.print('still-alive')},
];

async function submit(h: ReturnType<typeof mountHarness>, line: string) {
	h.press(line);
	await h.settle();
	h.press('\r');
	await h.settle();
}

function assertSafe(output: string) {
	const rest = output.replace(INK_CSI, '');
	assert.ok(!rest.includes(ESC));
	assert.ok(!rest.includes(BEL));
	assert.ok(!output.includes('evil.example'));
}

test('thrown messages with OSC 8, BEL and SGR are sanitised, and non-Error throws are printed safely', async () => {
	const h = mountHarness(<App registry={createRegistry(commands)} />, {columns: 80, rows: 40});
	await h.settle();
	for (const name of ['osc', 'str', 'nul', 'bad']) await submit(h, name);
	assert.match(h.lastFrame(), /^Error: /m);
	assertSafe(h.allOutput());
	await submit(h, 'ok');
	assert.match(h.lastFrame(), /still-alive/);
	h.unmount();
});

test('a 100 KB error message is bounded', async () => {
	const h = mountHarness(<App registry={createRegistry(commands)} />, {columns: 80, rows: 40});
	await h.settle();
	await submit(h, 'big');
	assert.ok(h.allOutput().length < 20 * 1024);
	await submit(h, 'ok');
	assert.match(h.lastFrame(), /still-alive/);
	h.unmount();
});

test('a multi-line error keeps its lines, capped at 20', async () => {
	const h = mountHarness(<App registry={createRegistry(commands)} />, {columns: 80, rows: 60});
	await h.settle();
	await submit(h, 'multi');
	const frame = h.lastFrame();
	assert.match(frame, /^Error: line0$/m);
	assert.match(frame, /^ {2}line19$/m);
	assert.doesNotMatch(frame, /line20/);
	h.unmount();
});

test('malformed registry entries do not break lookup, hints or help', async () => {
	const broken = {
		get name(): string {
			throw new Error('getter');
		},
		description: 'x',
		run: () => {},
	};
	const list = [null, undefined, 5, broken, {name: 'good', description: 'Good one', run: (_a: string[], ctx: {print: (t: string) => void}) => ctx.print('good-ran')}];
	const registry = createRegistry(list as unknown as Command[]);
	const h = mountHarness(<App registry={registry} />, {columns: 80, rows: 40});
	await h.settle();
	h.press('go');
	await h.settle();
	assert.match(h.lastFrame(), /^› good/m);
	h.press('\x7f');
	h.press('\x7f');
	await submit(h, 'good');
	assert.match(h.lastFrame(), /good-ran/);
	await submit(h, 'help');
	assert.match(h.lastFrame(), /Good one/);
	h.unmount();
});
