import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text} from 'ink';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {createMouseTerminal} from '../../src/mouse/terminal.js';
import {stringCells} from '../../src/hints/width.js';
import {ACTIVITY_TOPIC} from '../../src/kit/text.js';
import {createFakeStdout, createFakeTty, mountHarness} from '../testkit.js';
import type {Command, EventBus, Logger} from '../../../../src/api.js';

const ESC = '\x1b';
const CTRL_T = '\x14';
const CSI = new RegExp(ESC + '\\[[0-9;?]*[A-Za-z]', 'g');
const plain = (frame: string) => frame.replace(CSI, '');
const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

function bus(): EventBus {
	const handlers = new Map<string, Set<(p: unknown) => void>>();
	return {
		emit: (topic, payload) => void handlers.get(topic)?.forEach(h => h(payload)),
		on: (topic, handler) => {
			const set = handlers.get(topic) ?? new Set();
			handlers.set(topic, set);
			const safe = (p: unknown) => {
				try {
					handler(p);
				} catch {}
			};
			set.add(safe);
			return () => void set.delete(safe);
		},
	};
}

const chat: Command = {
	name: 'chat',
	description: 'open the chat',
	autostart: true,
	run: async (_a, ctx) => {
		await ctx.mount!(() => <Text>CHAT</Text>);
	},
};

const hello: Command = {name: 'hello', description: 'prints', run: (_a, ctx) => ctx.print('hello-x')};

function mount(options: {registry?: ReturnType<typeof createRegistry>; log?: Logger; events?: EventBus; size?: {columns: number; rows: number}} = {}) {
	const size = options.size ?? {columns: 100, rows: 30};
	const tty = createFakeTty();
	const stdout = createFakeStdout(size);
	const proxy = createInputProxy(tty, {size: () => ({columns: stdout.columns, rows: stdout.rows})});
	const mouse = createMouseTerminal(stdout, proxy);
	const h = mountHarness(
		<App
			registry={options.registry ?? createRegistry([hello, chat])}
			mouse={mouse}
			{...(options.log && {log: options.log})}
			{...(options.events && {events: options.events})}
		/>,
		size,
		{tty, stdin: proxy.stream, stdout},
	);
	const send = async (text: string, ms = 80) => {
		h.press(text);
		await h.settle(ms);
	};
	return {h, send, run: async (line: string) => (await send(line), await send('\r', 120))};
}

async function captureRejections(body: () => Promise<void>): Promise<unknown[]> {
	const seen: unknown[] = [];
	const listener = (reason: unknown) => void seen.push(reason);
	const previous = process.listeners('unhandledRejection');
	process.removeAllListeners('unhandledRejection');
	process.on('unhandledRejection', listener);
	try {
		await body();
	} finally {
		process.off('unhandledRejection', listener);
		previous.forEach(l => process.on('unhandledRejection', l));
	}
	return seen;
}

test('a throw from registry.find leaves a cross section, no spinner, and still rethrows', async () => {
	const base = createRegistry([hello, chat]);
	const registry = {commands: base.commands, find: (name: string) => {
		if (name === 'hello') throw new Error('lookup exploded');
		return base.find(name);
	}};
	const {h, send, run} = mount({registry});
	await h.settle(60);
	await send(CTRL_T);
	const seen = await captureRejections(async () => {
		await run('hello');
		await h.settle(100);
	});
	assert.equal(seen.length, 1);
	assert.match(String((seen[0] as Error).message), /lookup exploded/);
	const frame = plain(h.lastFrame());
	assert.match(frame, /✗ hello/);
	assert.doesNotMatch(frame, SPINNER);
	h.unmount();
});

test('a throw escaping runCommand leaves a cross section, no spinner, and still rethrows', async () => {
	const log: Logger = {
		debug: () => {},
		info: () => {},
		warn: () => { throw new Error('logger exploded'); },
		error: () => {},
		child: () => log,
	} as unknown as Logger;
	const boom: Command = {name: 'boom', description: 'fails', run: () => { throw new Error('command failed'); }};
	const {h, send, run} = mount({registry: createRegistry([boom, chat]), log});
	await h.settle(60);
	await send(CTRL_T);
	const seen = await captureRejections(async () => {
		await run('boom');
		await h.settle(100);
	});
	assert.equal(seen.length, 1);
	assert.match(String((seen[0] as Error).message), /logger exploded/);
	const frame = plain(h.lastFrame());
	assert.match(frame, /✗ boom/);
	assert.doesNotMatch(frame, SPINNER);
	h.unmount();
});

test('garbage activity payloads neither crash the app nor reach the screen', async () => {
	const events = bus();
	const {h, send} = mount({events});
	await h.settle(60);
	await send(CTRL_T);
	const circular: Record<string, unknown> = {source: 'dev', id: 'x', state: 'running'};
	circular['label'] = circular;
	const hostile = [
		undefined, null, 0, NaN, 'string', [], [1, 2], () => 1, Symbol('s'), {}, circular,
		{source: 'dev', id: 'x', state: 'running', label: 'Z'.repeat(100000)},
		{source: 'dev', id: `a${ESC}[2J`, state: 'running', label: 'esc-id'},
		{source: 'dev', id: '../../x', state: 'running', label: 'path-id'},
		{source: 'dev', id: 'x', state: 'running', label: `${ESC}[31mred\u0007\u0000bell`},
		{source: 'dev', id: 'x', state: 'running', label: 'n', done: 'a', total: {}},
		{get source(): string { throw new Error('getter'); }, id: 'x', state: 'running', label: 'g'},
	];
	for (const payload of hostile) events.emit(ACTIVITY_TOPIC, payload);
	await h.settle(250);
	const frame = h.lastFrame();
	assert.doesNotMatch(plain(frame), /esc-id|path-id|ZZZZZZZZ/);
	assert.equal(frame.includes('\u0007'), false);
	assert.equal(frame.includes('\u0000'), false);
	h.unmount();
});

for (const columns of [10, 20, 40]) {
	test(`at ${columns} columns no row of the console, title, activity row or hints reaches the last column`, async () => {
		const events = bus();
		const wide: Command = {name: 'wide', description: 'prints', run: (_a, ctx) => ctx.print('w'.repeat(200))};
		const {h, send, run} = mount({registry: createRegistry([hello, wide, chat]), events, size: {columns, rows: 24}});
		await h.settle(60);
		await send(CTRL_T);
		events.emit(ACTIVITY_TOPIC, {source: 'dev', id: 'test', label: 'dev', state: 'running', done: 12, total: 340, detail: 'd'.repeat(80)});
		await run('hello');
		await run('wide');
		await send('he', 100);
		const check = () => {
			for (const row of plain(h.lastFrame()).split('\n')) assert.ok(stringCells(row) <= columns - 1, `${columns}: ${JSON.stringify(row)}`);
		};
		check();
		await send('\t', 100);
		check();
		h.unmount();
	});
}
