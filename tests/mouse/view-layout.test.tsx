import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {createMouseTerminal} from '../../src/mouse/terminal.js';
import {createFakeStdout, createFakeTty, mountHarness} from '../testkit.js';
import type {Command, MountControl, ViewHost} from '../../../../src/api.js';
import type {ViewMouseEvent, ViewMouseHost} from '../../src/mouse/view-mouse.js';

const ESC = '\x1b';
const CTRL_T = '\x14';
const click = (x: number, y: number) => `${ESC}[<0;${x};${y}M`;

type MouseViewHost = ViewHost & Partial<ViewMouseHost> & {setTitle?: (title: string, detail?: string) => void};

function RowsView({host, rows, onEvent}: {host: MouseViewHost; rows: () => number; onEvent: (e: ViewMouseEvent) => boolean}) {
	const [, setTick] = useState(0);
	useEffect(() => host.subscribeMouse?.(onEvent), [host]);
	useEffect(() => host.subscribe(() => setTick(n => n + 1)), [host]);
	return (
		<Box flexDirection="column">
			{Array.from({length: rows()}, (_, i) => (
				<Text key={i}>{`ROW-${i}`}</Text>
			))}
		</Box>
	);
}

function setup(size = {columns: 100, rows: 30}) {
	const seen: ViewMouseEvent[] = [];
	let viewRows = 4;
	let control: MountControl | undefined;
	let rerender: (() => void) | undefined;
	const commands: Command[] = [
		{
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				await ctx.mount!(c => {
					control = c;
					const host = c.host as MouseViewHost;
					const View = () => {
						const [, setTick] = useState(0);
						rerender = () => setTick(n => n + 1);
						return <RowsView host={host} rows={() => viewRows} onEvent={e => (seen.push(e), true)} />;
					};
					return <View />;
				});
			},
		},
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
	const fillMain = async () => {
		for (let i = 0; i < 60; i++) control!.print!(`line-${i}`);
		await h.settle(60);
	};
	const setRows = async (n: number) => {
		viewRows = n;
		rerender!();
		await h.settle(60);
	};
	return {h, send, fillMain, seen, setRows, host: () => control!.host as MouseViewHost};
}

// The screen row (0-based) that shows ROW-i, so a click can be aimed at it.
const screenRowOf = (frame: string, i: number): number => frame.split('\n').findIndex(l => l.includes(`ROW-${i}`) && !l.includes(`ROW-${i}0`));

// Views such as the claude chat anchor their input on the last rows, so the event's height must
// equal the rendered height of the view and y must count from the view's own top row.
async function assertRowsMap(ctx: ReturnType<typeof setup>, count: number, column: number) {
	const frame = ctx.h.lastFrame();
	for (let i = 0; i < count; i++) {
		const y = screenRowOf(frame, i);
		assert.ok(y >= 0, `ROW-${i} is on screen`);
		ctx.seen.length = 0;
		await ctx.send(click(column + 1, y + 1));
		assert.equal(ctx.seen.length, 1, `a click on ROW-${i} reaches the view`);
		const e = ctx.seen[0]!;
		assert.equal(e.height, count, 'height is the rendered height of the view');
		assert.equal(e.y, i, `the click on ROW-${i} has local y ${i}`);
		assert.equal(e.height - 1 - e.y, count - 1 - i, 'rows counted from the bottom match');
	}
}

test('view events map to the rendered rows below a full transcript', async () => {
	const ctx = setup();
	await ctx.h.settle(60);
	await ctx.fillMain();
	await assertRowsMap(ctx, 4, 3);
	ctx.h.unmount();
});

test('view events map to the rendered rows with a title bar above the transcript', async () => {
	const ctx = setup();
	await ctx.h.settle(60);
	ctx.host().setTitle?.('My chat', 'status');
	await ctx.fillMain();
	assert.match(ctx.h.lastFrame().split('\n')[0]!, /My chat/);
	await assertRowsMap(ctx, 4, 3);
	ctx.h.unmount();
});

test('view events map to the rendered rows and the main width while the panel is split', async () => {
	const ctx = setup();
	await ctx.h.settle(60);
	await ctx.fillMain();
	await ctx.send(CTRL_T);
	await assertRowsMap(ctx, 4, 10);
	assert.equal(ctx.seen[0]!.width, 60, 'the main area of a 100-column split');
	ctx.h.unmount();
});

test('view events follow a view whose height changes', async () => {
	const ctx = setup();
	await ctx.h.settle(60);
	await ctx.fillMain();
	await ctx.setRows(9);
	await assertRowsMap(ctx, 9, 2);
	await ctx.setRows(2);
	await assertRowsMap(ctx, 2, 2);
	ctx.h.unmount();
});

test('a click on the transcript above the view does not reach it', async () => {
	const ctx = setup();
	await ctx.h.settle(60);
	await ctx.fillMain();
	const y = screenRowOf(ctx.h.lastFrame(), 0);
	await ctx.send(click(3, y));
	assert.equal(ctx.seen.length, 0);
	ctx.h.unmount();
});
