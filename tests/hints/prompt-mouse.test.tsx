import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text} from 'ink';
import App, {type AppMouse} from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import type {MouseInputEvent} from '../../src/mouse/sgr.js';
import {mountHarness} from '../testkit.js';
import type {Command} from '../../../../src/api.js';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[A-Za-z]', 'g');

function fakeMouse() {
	const listeners = new Set<(e: MouseInputEvent) => void>();
	const mouse: AppMouse = {
		onMouse(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setWanted() {},
		pause() {},
		resume() {},
	};
	const send = (e: Partial<MouseInputEvent> & {x: number; y: number}) => {
		const event: MouseInputEvent = {kind: 'press', button: 'left', shift: false, meta: false, ctrl: false, ...e};
		for (const l of listeners) l(event);
	};
	return {mouse, send};
}

function setup(commands: Command[], size: {columns: number; rows: number}) {
	const {mouse, send} = fakeMouse();
	const h = mountHarness(<App registry={createRegistry(commands)} mouse={mouse} />, size);
	const lines = () => h.lastFrame().replace(ANSI, '').split('\n');
	const promptRow = (from = 0) => {
		const all = lines();
		for (let y = all.length - 1; y >= 0; y--) {
			const x = (all[y] as string).indexOf('> ', from);
			if (x >= 0) return {x, y, text: all[y] as string};
		}
		throw new Error('no prompt row');
	};
	const type = async (text: string) => {
		h.press(text);
		await h.settle(60);
	};
	const click = async (x: number, y: number, e: Partial<MouseInputEvent> = {}) => {
		send({x, y, ...e});
		await h.settle(60);
	};
	return {h, lines, promptRow, type, click};
}

const ran: string[] = [];
const basic: Command[] = [
	{name: 'echo', description: 'Print text', usage: 'echo [text]…', run: args => void ran.push(`echo ${args.join(' ')}`)},
	{name: 'ecology', description: 'Something else', run: () => void ran.push('ecology')},
];

const hintRow = (lines: string[], p: {x: number; y: number}, name: string) =>
	lines.findIndex((l, i) => i > p.y && new RegExp(`^(› |  )${name}\\b`).test(l.slice(p.x)));

test('a click on a hint row accepts it and never runs the line', async () => {
	ran.length = 0;
	const t = setup(basic, {columns: 80, rows: 30});
	await t.h.settle(60);
	await t.type('ec');
	const p = t.promptRow();
	const above = () => t.lines().slice(0, t.promptRow().y).filter(l => l.trim() !== '');
	const before = above();
	const y = hintRow(t.lines(), p, 'echo +Print');
	assert.ok(y > p.y, 'echo hint row is shown');
	await t.click(p.x + 3, y);
	assert.deepEqual(above(), before, 'nothing was printed');
	assert.equal(hintRow(t.lines(), p, 'ecology'), -1, 'the list now shows the usage only');
	await t.type('x');
	assert.equal(t.promptRow().text.slice(p.x).trimEnd(), '> echo x');
	assert.deepEqual(ran, []);
	t.h.unmount();
});

test('a click on a non-selected hint row accepts that item', async () => {
	ran.length = 0;
	const t = setup(basic, {columns: 80, rows: 30});
	await t.h.settle(60);
	await t.type('ec');
	const p = t.promptRow();
	const y = hintRow(t.lines(), p, 'ecology');
	assert.ok(y > p.y);
	await t.click(p.x, y);
	await t.type('x');
	assert.equal(t.promptRow().text.slice(p.x).trimEnd(), '> ecology x');
	assert.deepEqual(ran, []);
	t.h.unmount();
});

test('other buttons, releases and wheel events do nothing', async () => {
	const t = setup(basic, {columns: 80, rows: 30});
	await t.h.settle(60);
	await t.type('ec');
	const p = t.promptRow();
	const y = hintRow(t.lines(), p, 'ecology');
	assert.ok(y > p.y);
	await t.click(p.x, y, {button: 'right'});
	await t.click(p.x, y, {button: 'middle'});
	await t.click(p.x, y, {kind: 'release'});
	await t.click(p.x, y, {kind: 'wheel', button: 'none', wheel: 'up'});
	await t.click(p.x, p.y, {button: 'right'});
	await t.type('x');
	assert.equal(t.promptRow().text.slice(p.x).trimEnd(), '> ecx');
	t.h.unmount();
});

const LONG = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

test('a click inside a long scrolled line moves the cursor there', async () => {
	const t = setup(basic, {columns: 30, rows: 20});
	await t.h.settle(60);
	await t.type(LONG);
	const p = t.promptRow();
	const shown = p.text.slice(p.x + 2);
	assert.ok(shown.startsWith('…'), 'the line is scrolled');
	const cell = 6;
	const target = shown[cell] as string;
	await t.click(p.x + 2 + cell, p.y);
	await t.type('#');
	const after = t.promptRow().text;
	assert.ok(after.includes(`#${target}`), `"#" lands before "${target}": ${after}`);
	assert.ok(after.includes(`${shown[cell - 1]}#`));
	t.h.unmount();
});

function Chat() {
	return <Text>CHAT</Text>;
}

test('the same in the side panel, where offsets include the border and padding', async () => {
	const commands: Command[] = [
		...basic,
		{
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				await ctx.mount!(() => <Chat />);
			},
		},
	];
	ran.length = 0;
	const t = setup(commands, {columns: 100, rows: 30});
	await t.h.settle(60);
	await t.type('\x14');
	await t.type('ec');
	const p = t.promptRow(40);
	assert.ok(p.x > 40, 'prompt is in the panel');
	const y = hintRow(t.lines(), p, 'echo +Print');
	assert.ok(y > p.y, 'echo hint row is shown in the panel');
	await t.click(p.x + 3, y);
	assert.equal(t.promptRow(40).text.slice(p.x).trimEnd(), '> echo');
	assert.deepEqual(ran, []);

	await t.type(LONG);
	const q = t.promptRow(40);
	const shown = q.text.slice(q.x + 2);
	assert.ok(shown.startsWith('…'), 'the panel line is scrolled');
	const cell = 5;
	const target = shown[cell] as string;
	await t.click(q.x + 2 + cell, q.y);
	await t.type('#');
	assert.ok(t.promptRow(40).text.includes(`#${target}`));
	t.h.unmount();
});
