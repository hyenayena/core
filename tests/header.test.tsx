import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useEffect} from 'react';
import {Box, Text} from 'ink';
import App from '../src/app.js';
import {createRegistry} from '../src/commands.js';
import {createInputProxy} from '../src/mouse/input.js';
import {createMouseTerminal} from '../src/mouse/terminal.js';
import {createFakeStdout, createFakeTty, mountHarness} from './testkit.js';
import type {Command, MountControl, ViewHost} from '../../../src/api.js';
import type {ViewMouseEvent, ViewMouseHost} from '../src/mouse/view-mouse.js';
import type {ViewHeaderHost} from '../src/view/header.js';

const ESC = String.fromCharCode(27);
const SGR = new RegExp(ESC + '\\[[0-9;?]*[A-Za-z]', 'g');
const click = (x: number, y: number) => `${ESC}[<0;${x};${y}M`;
const wheelUp = (x: number, y: number) => `${ESC}[<64;${x};${y}M`;

type Host = ViewHost & ViewMouseHost & ViewHeaderHost;

function Header() {
	return (
		<Box flexDirection="column">
			<Text>HEADER-1</Text>
			<Text>HEADER-2</Text>
		</Box>
	);
}

function Bomb(): never {
	throw new Error('header exploded');
}

function View({host, seen}: {host: Host; seen: ViewMouseEvent[]}) {
	useEffect(
		() =>
			host.subscribeMouse(e => {
				seen.push(e);
				return e.kind !== 'wheel';
			}),
		[host],
	);
	return (
		<Box flexDirection="column">
			<Text>VIEW-1</Text>
			<Text>VIEW-2</Text>
		</Box>
	);
}

function setup(size = {columns: 100, rows: 30}) {
	const seen: ViewMouseEvent[] = [];
	const controls: MountControl[] = [];
	const errors: Error[] = [];
	const commands: Command[] = [
		{
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				try {
					await ctx.mount!(c => {
						controls.push(c);
						return <View host={c.host as Host} seen={seen} />;
					});
				} catch (err) {
					errors.push(err as Error);
				}
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
	const lines = () => h.lastFrame().replace(SGR, '').split('\n');
	const rowOf = (text: string) => lines().findIndex(l => l.includes(text));
	return {h, send, lines, rowOf, seen, errors, controls, host: (i = controls.length - 1) => controls[i]!.host as Host};
}

test('the header sits between the title bar and the transcript and goes away when the view closes', async () => {
	const {h, rowOf, host, controls} = setup();
	await h.settle(60);
	host().setTitle!('TITLE');
	host().setHeader(<Header />);
	await h.settle(60);
	const title = rowOf('TITLE');
	assert.equal(title, 0);
	assert.equal(rowOf('HEADER-1'), 1);
	assert.equal(rowOf('HEADER-2'), 2);
	assert.ok(rowOf('VIEW-1') > 2);
	host().setHeader(null);
	await h.settle(60);
	assert.equal(rowOf('HEADER-1'), -1);
	host().setHeader(<Header />);
	await h.settle(60);
	assert.equal(rowOf('HEADER-1'), 1);
	controls[0]!.close();
	await h.settle(60);
	assert.equal(rowOf('HEADER-1'), -1);
	h.unmount();
});

test('a throw inside the header rejects the mount', async () => {
	const {h, host, errors, rowOf} = setup();
	await h.settle(60);
	host().setHeader(<Bomb />);
	await h.settle(80);
	assert.equal(errors.length, 1);
	assert.match(errors[0]!.message, /header exploded/);
	assert.equal(rowOf('VIEW-1'), -1);
	h.unmount();
});

test('a click in the header reaches the view with region header and local coordinates', async () => {
	const {h, send, rowOf, host, seen} = setup();
	await h.settle(60);
	host().setHeader(<Header />);
	await h.settle(60);
	const y = rowOf('HEADER-2');
	await send(click(6, y + 1));
	assert.equal(seen.length, 1);
	assert.deepEqual({...seen[0]}, {kind: 'press', button: 'left', x: 5, y: 1, width: 100, height: 2, shift: false, meta: false, ctrl: false, region: 'header'});
	assert.ok(Object.isFrozen(seen[0]));
	const body = rowOf('VIEW-2');
	await send(click(3, body + 1));
	assert.equal(seen.length, 2);
	assert.equal(seen[1]!.region, undefined);
	assert.ok(!('region' in seen[1]!));
	h.unmount();
});

test('an unhandled wheel over the header does not scroll the transcript', async () => {
	const {h, send, rowOf, host, controls} = setup();
	await h.settle(60);
	for (let i = 0; i < 60; i++) controls[0]!.print!(`line-${i}`);
	host().setHeader(<Header />);
	await h.settle(60);
	await send(wheelUp(5, rowOf('HEADER-1') + 1));
	assert.doesNotMatch(h.lastFrame(), /newer line/);
	h.unmount();
});

test('a stale mount cannot set the header', async () => {
	const {h, send, rowOf, host, controls} = setup();
	await h.settle(60);
	const stale = host(0);
	controls[0]!.close();
	await h.settle(60);
	await send('chat');
	await send('\r', 120);
	assert.equal(controls.length, 2);
	assert.ok(rowOf('VIEW-1') >= 0);
	stale.setHeader(<Header />);
	await h.settle(60);
	assert.equal(rowOf('HEADER-1'), -1);
	host(1).setHeader(<Header />);
	await h.settle(60);
	assert.ok(rowOf('HEADER-1') >= 0);
	h.unmount();
});
