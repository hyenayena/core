import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useEffect, useState} from 'react';
import chalk from 'chalk';
import {Text, useInput} from 'ink';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {createMouseTerminal} from '../../src/mouse/terminal.js';
import {stringCells} from '../../src/hints/width.js';
import {resetColorDepthCacheForTests} from '../../src/kit/theme.js';
import {ACTIVITY_FLASH_MS, ACTIVITY_TOPIC, stripStyles, span, table} from '../../src/kit/text.js';
import {createFakeStdout, createFakeTty, mountHarness} from '../testkit.js';
import type {Command, EventBus, MountControl} from '../../../../src/api.js';

const ESC = '\x1b';
const CTRL_T = '\x14';
const CTRL_O = '\x0f';
const SHIFT_RIGHT = `${ESC}[1;2C`;
const click = (x: number, y: number) => `${ESC}[<0;${x};${y}M`;
const CSI = new RegExp(ESC + '\\[[0-9;?]*[A-Za-z]', 'g');
const plain = (frame: string) => frame.replace(CSI, '');

function Chat({control}: {control: MountControl}) {
	const host = control.host!;
	const [focused, setFocused] = useState(host.isFocused());
	useEffect(() => host.subscribe(() => setFocused(host.isFocused())), [host]);
	useEffect(() => host.setTitle?.('Session', 'idle'), [host]);
	useInput((input, key) => void (host.isHostKey(input, key) || undefined), {isActive: focused});
	return <Text>{`CHAT ${focused ? 'focused' : 'idle'}`}</Text>;
}

function bus(): EventBus {
	const handlers = new Map<string, Set<(p: unknown) => void>>();
	return {
		emit: (topic, payload) => void handlers.get(topic)?.forEach(h => h(payload)),
		on: (topic, handler) => {
			const set = handlers.get(topic) ?? new Set();
			handlers.set(topic, set);
			set.add(handler);
			return () => void set.delete(handler);
		},
	};
}

const WIDE = [
	['TASK-34', 'Add the activity API to the core kit', 'a-very-long-state-name'],
	['UI-6', 'Redesign the side console panel', 'running'],
];

function setup(extra: Command[] = [], options: {events?: EventBus; size?: {columns: number; rows: number}; chat?: boolean} = {}) {
	const size = options.size ?? {columns: 100, rows: 30};
	const commands: Command[] = [
		{name: 'hello', description: 'prints', run: (args, ctx) => ctx.print(`hello-${args[0] ?? 'x'}`)},
		{name: 'boom', description: 'fails', run: () => { throw new Error('exploded'); }},
		{
			name: 'wide',
			description: 'prints a table',
			run: (_a, ctx) => ctx.printStyled!([table(WIDE.map(r => r.map(c => span(c))), {head: ['Id', 'Title', 'State'], flex: 1})]),
		},
		{
			name: 'peek',
			description: 'mounts a panel view',
			run: async (_a, ctx) => {
				await ctx.mount!(c => <ViewOne control={c} />, {target: 'panel'});
			},
		},
		...extra,
	];
	if (options.chat !== false) {
		commands.push({
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				await ctx.mount!(c => <Chat control={c} />);
			},
		});
	}
	const tty = createFakeTty();
	const stdout = createFakeStdout(size);
	const proxy = createInputProxy(tty, {size: () => ({columns: stdout.columns, rows: stdout.rows})});
	const mouse = createMouseTerminal(stdout, proxy);
	const h = mountHarness(<App registry={createRegistry(commands)} mouse={mouse} {...(options.events && {events: options.events})} />, size, {
		tty,
		stdin: proxy.stream,
		stdout,
	});
	const send = async (text: string, ms = 80) => {
		h.press(text);
		await h.settle(ms);
	};
	const run = async (line: string) => {
		await send(line);
		await send('\r', 120);
	};
	return {h, send, run};
}

function ViewOne({control}: {control: MountControl}) {
	useInput(input => {
		if (input === 'q') control.close();
	});
	return <Text>PANEL-VIEW</Text>;
}

test('each command gets a header, its output and a rule; a failure gets a cross', async () => {
	const {h, send, run} = setup();
	await h.settle(60);
	await send(CTRL_T);
	await run('hello a');
	await run('boom');
	const frame = plain(h.lastFrame());
	assert.match(frame, /❯ hello a/);
	assert.match(frame, /hello-a/);
	assert.match(frame, /✗ boom/);
	assert.match(frame, /Error: exploded/);
	assert.ok(frame.split('\n').some(l => /│ ?─{10,}/.test(l)), 'a rule closes an expanded section');
	h.unmount();
});

test('older commands with output fold to their header; Ctrl+O opens them all and again closes them', async () => {
	const {h, send, run} = setup([], {size: {columns: 140, rows: 30}});
	await h.settle(60);
	await send(CTRL_T);
	await run('hello one');
	await run('hello two');
	await run('hello three');
	let frame = plain(h.lastFrame());
	assert.doesNotMatch(frame, /hello-one/);
	assert.match(frame, /❯ hello one\s+\+1/);
	assert.match(frame, /hello-two/);
	assert.match(frame, /hello-three/);
	assert.match(frame, /\^O unfold/);
	await send(CTRL_O);
	frame = plain(h.lastFrame());
	assert.match(frame, /hello-one/);
	assert.match(frame, /\^O fold/);
	await send(CTRL_O);
	assert.doesNotMatch(plain(h.lastFrame()), /hello-one/);
	h.unmount();
});

test('a left click on a header folds or unfolds that section', async () => {
	const {h, send, run} = setup();
	await h.settle(60);
	await send(CTRL_T);
	await run('hello one');
	await run('hello two');
	await run('hello three');
	const rowOf = (needle: RegExp) => plain(h.lastFrame()).split('\n').findIndex(l => needle.test(l));
	const x = plain(h.lastFrame()).split('\n')[rowOf(/❯ hello one/)]!.indexOf('❯') + 2;
	await send(click(x, rowOf(/❯ hello one/) + 1));
	assert.match(plain(h.lastFrame()), /hello-one/);
	await send(click(x, rowOf(/❯ hello one/) + 1));
	assert.doesNotMatch(plain(h.lastFrame()), /hello-one/);
	h.unmount();
});

test('a table too wide for the panel collapses into key/value rows and lays out again on resize', async () => {
	const {h, send, run} = setup();
	await h.settle(60);
	await send(CTRL_T);
	await run('wide');
	let frame = plain(h.lastFrame());
	assert.match(frame, /TASK-34/);
	assert.match(frame, /Title: /);
	assert.doesNotMatch(frame, /Id +Title +State/);
	h.resize(220, 30);
	await h.settle(120);
	frame = plain(h.lastFrame());
	assert.match(frame, /Id +Title +State/);
	assert.doesNotMatch(frame, /Title: /);
	h.unmount();
});

test('the border and title follow the focus; the chat title is muted while the console has it', async () => {
	process.env['YENA_COLOR'] = '256';
	resetColorDepthCacheForTests();
	chalk.level = 2;
	try {
		const { h, send } = setup();
		await h.settle(60);
		await send(CTRL_T);
		const style = (frame: string, needle: string) => {
			const line = frame.split('\n').find(l => plain(l).includes(needle))!;
			return line.slice(0, line.indexOf(needle.charAt(0)));
		};
		const consoleFocused = h.lastFrame();
		const bar = (frame: string) => /((?:\x1b\[[0-9;]*m)*)│/.exec(frame)![1]!;
		assert.doesNotMatch(style(consoleFocused, 'Session'), /\x1b\[[0-9;]*48;5;/, 'the chat title has no background while the console has the focus');
		assert.notEqual(bar(consoleFocused), '', 'a styled border');
		const borderWhileConsole = bar(consoleFocused);
		await send(`${ESC}[1;2D`);
		const chatFocused = h.lastFrame();
		assert.match(style(chatFocused, 'Session'), /\x1b\[[0-9;]*48;5;100/, 'the olive background returns with the chat focus');
		assert.notEqual(bar(chatFocused), borderWhileConsole, 'the border tone changes with the focus');
		await send(SHIFT_RIGHT);
		assert.equal(bar(h.lastFrame()), borderWhileConsole);
		h.unmount();
	} finally {
		chalk.level = 0;
		delete process.env['YENA_COLOR'];
		resetColorDepthCacheForTests();
	}
});

test('an activity report shows a row in the open console, flashes after it ends and goes', async () => {
	const events = bus();
	const { h, send } = setup([], { events });
	await h.settle(60);
	assert.doesNotMatch(plain(h.lastFrame()), /nightly/);
	await send(CTRL_T);
	events.emit(ACTIVITY_TOPIC, {source: 'dev', id: 'test', label: 'dev', state: 'running', done: 120, total: 340});
	events.emit(ACTIVITY_TOPIC, {source: 'bad id', id: 'x', label: 'ignored', state: 'running'});
	await h.settle(250);
	let frame = plain(h.lastFrame());
	assert.match(frame, /dev 120\/340/);
	assert.doesNotMatch(frame, /ignored/);
	events.emit(ACTIVITY_TOPIC, {source: 'dev', id: 'test', label: 'dev', state: 'ok', done: 340, total: 340});
	await h.settle(250);
	assert.match(plain(h.lastFrame()), /✓ dev 340\/340/);
	await h.settle(ACTIVITY_FLASH_MS);
	frame = plain(h.lastFrame());
	assert.doesNotMatch(frame, /340\/340/);
	events.emit(ACTIVITY_TOPIC, {source: 'chat', id: 'main', label: 'chat', state: 'running'});
	await h.settle(250);
	assert.match(plain(h.lastFrame()), /chat/);
	events.emit(ACTIVITY_TOPIC, {source: 'chat', id: 'main', label: 'chat', state: 'gone'});
	await h.settle(250);
	assert.doesNotMatch(plain(h.lastFrame()).split('\n').filter(l => l.includes('│')).join('\n'), /⠋ chat|⠙ chat|⠹ chat|⠸ chat|⠼ chat|⠴ chat|⠦ chat|⠧ chat|⠇ chat|⠏ chat/);
	h.unmount();
});

test('the activity row is hidden while a panel view is mounted and returns after it closes', async () => {
	const events = bus();
	const { h, send, run } = setup([], { events });
	await h.settle(60);
	await send(CTRL_T);
	events.emit(ACTIVITY_TOPIC, {source: 'dev', id: 'test', label: 'builder', state: 'running'});
	await h.settle(250);
	assert.match(plain(h.lastFrame()), /builder/);
	await run('peek');
	const frame = plain(h.lastFrame());
	assert.match(frame, /PANEL-VIEW/);
	assert.doesNotMatch(frame, /builder/);
	await send('q');
	assert.match(plain(h.lastFrame()), /builder/);
	h.unmount();
});

test('every console row stays short of the last column with sections, rules and the activity row', async () => {
	const events = bus();
	const { h, send, run } = setup([], { events, size: { columns: 70, rows: 24 } });
	await h.settle(60);
	await send(CTRL_T);
	events.emit(ACTIVITY_TOPIC, {source: 'dev', id: 'test', label: 'dev', state: 'running', done: 12, total: 340, detail: 'x'.repeat(50)});
	await run('wide');
	await run('boom');
	await run(`hello ${'y'.repeat(120)}`);
	await h.settle(200);
	const frame = plain(h.lastFrame());
	assert.ok(Math.max(...frame.split('\n').map(stringCells)) <= 69);
	assert.equal(stripStyles(frame).includes('undefined'), false);
	h.unmount();
});

test('a command that throws a plain Error leaves a cross header and no running section', async () => {
	const {h, send, run} = setup();
	await h.settle(60);
	await send(CTRL_T);
	await run('boom');
	const lines = plain(h.lastFrame()).split('\n').filter(l => l.includes('boom'));
	assert.ok(lines.some(l => /✗ boom/.test(l)));
	assert.equal(lines.some(l => /❯ boom/.test(l)), false);
	assert.doesNotMatch(plain(h.lastFrame()), /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
	h.unmount();
});
