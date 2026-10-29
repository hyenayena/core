import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text} from 'ink';
import App, {MAX_LINES} from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {createMouseTerminal} from '../../src/mouse/terminal.js';
import {stringCells} from '../../src/hints/width.js';
import {createFakeStdout, createFakeTty, mountHarness} from '../testkit.js';
import type {Command, MountControl} from '../../../../src/api.js';

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(ESC + '\\[[0-9;?]*[A-Za-z]', 'g');
const wheelUp = (x: number, y: number) => `${ESC}[<64;${x};${y}M`;
const wheelDown = (x: number, y: number) => `${ESC}[<65;${x};${y}M`;
const SHIFT_UP = `${ESC}[1;2A`;
const PG_UP = `${ESC}[5~`;
const CTRL_T = '\x14';

const paragraph = (tag: string, rows: number) =>
	Array.from({length: rows * 10}, (_, i) => `${tag}${String(i).padStart(2, '0')}`).join(' ');

function setup(size = {columns: 40, rows: 12}, extra: Command[] = []) {
	let control: MountControl | undefined;
	const commands: Command[] = [
		{
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				await ctx.mount!(c => {
					control = c;
					return <Text>CHAT</Text>;
				});
			},
		},
		...extra,
	];
	const tty = createFakeTty();
	const stdout = createFakeStdout(size);
	const proxy = createInputProxy(tty, {size: () => ({columns: stdout.columns, rows: stdout.rows})});
	const mouse = createMouseTerminal(stdout, proxy);
	const h = mountHarness(<App registry={createRegistry(commands)} mouse={mouse} />, size, {tty, stdin: proxy.stream, stdout});
	const send = async (text: string, ms = 80) => {
		h.press(text);
		await h.settle(ms);
	};
	const frame = () => h.lastFrame().replace(ANSI, '').split('\n');
	const transcript = () => {
		const lines = frame();
		const end = lines.findIndex(l => l.startsWith('CHAT'));
		return lines.slice(0, end).filter(l => !/newer line/.test(l));
	};
	const hint = () => frame().find(l => /newer line/.test(l));
	return {h, send, frame, transcript, hint, print: (text: string) => control!.print!(text)};
}

const fill = async (s: ReturnType<typeof setup>) => {
	await s.h.settle(60);
	for (const tag of ['a', 'b', 'c', 'd']) s.print(paragraph(tag, 5));
	await s.h.settle(80);
};

test('each wheel step moves the transcript by exactly one screen row', async () => {
	const s = setup();
	await fill(s);
	assert.match(s.transcript().at(-1)!, /^d40 /);
	assert.equal(s.hint(), undefined);
	await s.send(wheelUp(5, 3));
	assert.match(s.hint()!, /↓ 1 newer line · /);
	assert.match(s.transcript().at(-1)!, /^d30 /);
	let prev = s.transcript();
	for (let n = 2; n <= 8; n++) {
		await s.send(wheelUp(5, 3));
		const now = s.transcript();
		assert.equal(now.length, prev.length);
		assert.deepEqual(now.slice(1), prev.slice(0, -1), `step ${n}`);
		assert.match(s.hint()!, new RegExp(`↓ ${n} newer lines · `));
		prev = now;
	}
	assert.match(s.transcript().at(-1)!, /^c10 /);
	for (let n = 0; n < 8; n++) await s.send(wheelDown(5, 3), 40);
	await s.h.settle(60);
	assert.equal(s.hint(), undefined);
	assert.match(s.transcript().at(-1)!, /^d40 /);
	s.h.unmount();
});

test('Shift+↑ moves one row and PgUp the view height less one', async () => {
	const s = setup();
	await fill(s);
	const height = s.transcript().length;
	await s.send(SHIFT_UP);
	assert.match(s.hint()!, /↓ 1 newer line · /);
	await s.send(`${ESC}[1;2B`);
	assert.equal(s.hint(), undefined);
	await s.send(PG_UP);
	assert.match(s.hint()!, new RegExp(`↓ ${height - 1} newer lines`));
	s.h.unmount();
});

test('output arriving while scrolled keeps the rows and only grows the hint', async () => {
	const s = setup();
	await fill(s);
	await s.send(wheelUp(5, 3).repeat(3));
	const before = s.transcript();
	assert.match(s.hint()!, /↓ 3 newer lines/);
	s.print(paragraph('e', 2));
	await s.h.settle(80);
	assert.deepEqual(s.transcript(), before);
	assert.match(s.hint()!, /↓ 5 newer lines/);
	s.h.unmount();
});

test('a resize keeps the anchored line at the bottom with a full view', async () => {
	const s = setup();
	await fill(s);
	await s.send(wheelUp(5, 3).repeat(7));
	assert.match(s.transcript().at(-1)!, /^c20 /);
	s.h.resize(30, 12);
	await s.h.settle(120);
	const rows = s.transcript();
	assert.match(rows.at(-1)!, /^c\d\d /, 'the c paragraph is still at the bottom');
	assert.ok(rows.every(r => r.trim() !== ''), 'no blank rows on top');
	for (const r of s.frame()) assert.ok(stringCells(r) <= 30);
	s.h.unmount();
});

test('trimming past the cap while at the top shows the oldest remaining line at the top', async () => {
	const s = setup();
	await s.h.settle(60);
	for (let i = 0; i < 20; i++) s.print(`n-${i}`);
	await s.h.settle(80);
	await s.send(PG_UP.repeat(4));
	assert.equal(s.transcript()[0], 'n-0', 'the first print of the view sits above the welcome line');
	assert.match(s.transcript()[1]!, /^press Tab /, 'the welcome line follows it');
	for (let i = 20; i < 20 + MAX_LINES; i++) s.print(`n-${i}`);
	await s.h.settle(300);
	assert.equal(s.transcript()[0], 'n-20');
	assert.ok(s.hint());
	s.h.unmount();
});

test('a CJK paragraph wraps without rows wider than the screen and without an ellipsis', async () => {
	const s = setup({columns: 41, rows: 12});
	await s.h.settle(60);
	s.print('漢字かなカナ한글'.repeat(20));
	await s.h.settle(80);
	const rows = s.transcript().filter(r => /[漢한]/.test(r));
	assert.ok(rows.length > 3);
	for (const r of rows) {
		assert.ok(stringCells(r) <= 41);
		assert.ok(!r.includes('…'));
	}
	s.h.unmount();
});

test('a coloured line keeps its colour on the following rows', async () => {
	const s = setup();
	await s.h.settle(60);
	s.print(`${ESC}[31m${paragraph('r', 2)}${ESC}[0m`);
	await s.h.settle(80);
	assert.match(s.h.allOutput(), new RegExp(ESC + '\\[31m[^' + ESC + ']*r10 '));
	s.h.unmount();
});

test('next to the open console the transcript wraps at the chat width', async () => {
	const s = setup({columns: 100, rows: 20});
	await s.h.settle(60);
	await s.send(CTRL_T);
	s.print(Array.from({length: 30}, (_, i) => `w${String(i).padStart(2, '0')}`).join(' '));
	await s.h.settle(80);
	const lines = s.frame();
	assert.ok(lines.some(l => l.startsWith('w00 ') && !l.slice(0, 60).includes('w15')));
	assert.ok(lines.some(l => l.startsWith('w15 ')));
	s.h.unmount();
});

test('console output with newlines takes one panel line per row and scrolls to its first line', async () => {
	const twoLines: Command = {
		name: 'two',
		description: 'print two lines many times',
		run: (_a, ctx) => {
			for (let i = 0; i < 20; i++) ctx.print(`p${i}a\np${i}b`);
		},
	};
	const s = setup({columns: 100, rows: 20}, [twoLines]);
	await s.h.settle(60);
	await s.send(CTRL_T);
	await s.send('two');
	await s.send('\r', 120);
	const at = (re: RegExp) => s.frame().findIndex(l => re.test(l));
	assert.equal(at(/p19b/), at(/p19a/) + 1);
	await s.send(wheelUp(80, 10).repeat(60), 150);
	assert.ok(at(/p0a/) >= 0);
	assert.equal(at(/p0b/), at(/p0a/) + 1);
	assert.ok(at(/newer line/) >= 0);
	await s.send(wheelDown(80, 10).repeat(60), 150);
	assert.ok(at(/p19b/) >= 0);
	assert.equal(at(/newer line/), -1);
	s.h.unmount();
});
