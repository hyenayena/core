import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text} from 'ink';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {createMouseTerminal} from '../../src/mouse/terminal.js';
import {createFakeStdout, createFakeTty, mountHarness} from '../testkit.js';
import type {Command, CommandContext} from '../../../../src/api.js';

const ESC = '\x1b';
// x and y are 1-based, as the terminal sends them.
const wheelDown = (x: number, y: number) => `${ESC}[<65;${x};${y}M`;
const click = (x: number, y: number) => `${ESC}[<0;${x};${y}M`;
const GRACE = 400;
const SIZE = {columns: 100, rows: 30};

const say: Command = {name: 'say', description: 'say', agent: 'safe', run: (_a, ctx) => ctx.print('said-it')};

function boot() {
	const seen: {chat?: CommandContext} = {};
	const commands: Command[] = [
		{
			name: 'chat',
			description: 'view',
			autostart: true,
			run: async (_a, ctx) => {
				seen.chat = ctx;
				await ctx.mount!(() => <Text>CHAT-VIEW</Text>);
			},
		},
		say,
	];
	const tty = createFakeTty();
	const stdout = createFakeStdout(SIZE);
	const proxy = createInputProxy(tty, {size: () => ({columns: stdout.columns, rows: stdout.rows})});
	const mouse = createMouseTerminal(stdout, proxy);
	const h = mountHarness(<App registry={createRegistry(commands)} mouse={mouse} graceMs={GRACE} />, SIZE, {
		tty,
		stdin: proxy.stream,
		stdout,
	});
	const send = async (text: string) => {
		h.press(text);
		await h.settle(80);
	};
	return {h, send, run: () => seen.chat!.commandBridge!.run({line: 'say', caller: 'tester'})};
}

const pastGrace = (h: {settle: (ms?: number) => Promise<void>}) => h.settle(GRACE + 200);

test('mouse presses over the chat do not count as touching the auto-opened console', async () => {
	const {h, send, run} = boot();
	await h.settle(80);
	await run();
	await h.settle(80);
	assert.match(h.lastFrame(), /said-it/);
	await send(click(5, 10));
	await pastGrace(h);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('a press over the auto-opened console keeps it open and moves the focus there', async () => {
	const {h, send, run} = boot();
	await h.settle(80);
	await run();
	await h.settle(80);
	await send(click(95, 10));
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	await send('x');
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	h.unmount();
});

test('the wheel over the auto-opened console keeps it open', async () => {
	const {h, send, run} = boot();
	await h.settle(80);
	await run();
	await h.settle(80);
	await send(wheelDown(95, 10));
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	h.unmount();
});
