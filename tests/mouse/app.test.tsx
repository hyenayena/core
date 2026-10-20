import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {MOUSE_DISABLE, MOUSE_ENABLE, createMouseTerminal} from '../../src/mouse/terminal.js';
import {getPrefs, setPrefs} from '../../src/view/prefs.js';
import {createFakeStdout, createFakeTty, mountHarness} from '../testkit.js';
import type {Command, MountControl, ViewHost} from '../../../../src/api.js';
import type {ViewMouseEvent, ViewMouseHost} from '../../src/mouse/view-mouse.js';

const ESC = '\x1b';
// x and y are 1-based, as the terminal sends them.
const wheelUp = (x: number, y: number) => `${ESC}[<64;${x};${y}M`;
const wheelDown = (x: number, y: number) => `${ESC}[<65;${x};${y}M`;
const click = (x: number, y: number) => `${ESC}[<0;${x};${y}M`;
const CTRL_T = '\x14';

function Chat({control}: {control: MountControl}) {
	const host = control.host!;
	const [focused, setFocused] = useState(host.isFocused());
	const [typed, setTyped] = useState('');
	useEffect(() => host.subscribe(() => setFocused(host.isFocused())), [host]);
	useInput(
		(input, key) => {
			if (host.isHostKey(input, key)) return;
			setTyped(t => t + input);
		},
		{isActive: focused},
	);
	return <Text>{`CHAT[${typed}] ${focused ? 'focused' : 'idle'}`}</Text>;
}

function setup({size = {columns: 100, rows: 30}, view = true} = {}) {
	let control: MountControl | undefined;
	const commands: Command[] = [
		{
			name: 'many',
			description: 'print many lines',
			run: (_a, ctx) => {
				for (let i = 0; i < 60; i++) ctx.print(`row-${i}`);
			},
		},
	];
	if (view) {
		commands.push({
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				await ctx.mount!(c => {
					control = c;
					return <Chat control={c} />;
				});
			},
		});
	}
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
	return {h, send, fillMain, control: () => control!};
}

test('the mouse modes are switched on at start and off at unmount', async () => {
	const {h} = setup();
	await h.settle(60);
	assert.ok(h.allOutput().includes(MOUSE_ENABLE));
	assert.ok(!h.allOutput().includes(MOUSE_DISABLE));
	h.unmount();
	await h.settle(30);
	assert.ok(h.allOutput().endsWith(MOUSE_DISABLE) || h.allOutput().lastIndexOf(MOUSE_DISABLE) > h.allOutput().lastIndexOf(MOUSE_ENABLE));
});

test('the wheel over the main transcript scrolls it and back', async () => {
	const {h, send, fillMain} = setup();
	await h.settle(60);
	await fillMain();
	assert.doesNotMatch(h.lastFrame(), /newer line/);
	await send(wheelUp(10, 5));
	assert.match(h.lastFrame(), /↓ 1 newer line · PgDn or Shift\+↓/);
	assert.match(h.lastFrame(), /line-58/);
	assert.doesNotMatch(h.lastFrame(), /line-59/);
	await send(wheelDown(10, 5));
	assert.doesNotMatch(h.lastFrame(), /newer line/);
	assert.match(h.lastFrame(), /line-59/);
	h.unmount();
});

test('the wheel over the main view rows scrolls the transcript too', async () => {
	const {h, send, fillMain} = setup();
	await h.settle(60);
	await fillMain();
	await send(wheelUp(1, 30));
	assert.match(h.lastFrame(), /↓ 1 newer line/);
	assert.match(h.lastFrame(), /CHAT\[\] focused/, 'the view receives nothing');
	h.unmount();
});

test('the wheel over the panel scrolls the panel output only', async () => {
	const {h, send, fillMain} = setup();
	await h.settle(60);
	await fillMain();
	await send(CTRL_T);
	await send('many');
	await send('\r', 120);
	assert.match(h.lastFrame(), /row-59/);
	await send(wheelUp(80, 10));
	let frame = h.lastFrame();
	assert.match(frame, /↓ 1 newer line/);
	assert.doesNotMatch(frame, /PgDn/, 'the panel hint has no keys, the transcript did not scroll');
	assert.doesNotMatch(frame, /row-59/);
	assert.match(frame, /row-56/);
	await send(wheelDown(80, 10));
	frame = h.lastFrame();
	assert.doesNotMatch(frame, /newer line/);
	assert.match(frame, /row-59/);
	h.unmount();
});

test('a scrolled panel stays on its lines while output arrives', async () => {
	const {h, send} = setup();
	await h.settle(60);
	await send(CTRL_T);
	await send('many');
	await send('\r', 120);
	await send(wheelUp(80, 10));
	await send('many');
	await send('\r', 120);
	const frame = h.lastFrame();
	assert.doesNotMatch(frame, /row-59/);
	assert.match(frame, /newer line/);
	h.unmount();
});

test('a click moves the focus between the chat and the panel, and nothing else', async () => {
	const {h, send} = setup();
	await h.settle(60);
	await send(CTRL_T);
	assert.match(h.lastFrame(), /CHAT\[\] idle/);
	await send(click(10, 10));
	assert.match(h.lastFrame(), /CHAT\[\] focused/);
	await send('x');
	assert.match(h.lastFrame(), /CHAT\[x\] focused/, 'the click itself typed nothing into the view');
	await send(click(80, 10));
	assert.match(h.lastFrame(), /CHAT\[x\] idle/);
	await send('ab');
	assert.match(h.lastFrame(), /> ab/);
	h.unmount();
});

test('a narrow screen sends everything to the console', async () => {
	const {h, send} = setup({size: {columns: 50, rows: 30}});
	await h.settle(60);
	await send(CTRL_T);
	await send('many');
	await send('\r', 120);
	await send(click(5, 5));
	await send('zz');
	assert.match(h.lastFrame(), /> zz/, 'the click kept the console focused');
	await send(wheelUp(5, 5));
	assert.match(h.lastFrame(), /↓ 1 newer line/);
	assert.doesNotMatch(h.lastFrame(), /PgDn/);
	h.unmount();
});

test('without a main view the wheel scrolls the transcript', async () => {
	const {h, send} = setup({view: false});
	await h.settle(60);
	await send('many');
	await send('\r', 120);
	await send(wheelUp(10, 5));
	assert.match(h.lastFrame(), /↓ 1 newer line · PgDn/);
	h.unmount();
});

test('the Mouse preference off writes no mode switch and ignores the wheel; it applies live', async () => {
	const before = getPrefs().mouse;
	setPrefs({mouse: false});
	try {
		const {h, send, fillMain} = setup();
		await h.settle(60);
		await fillMain();
		assert.ok(!h.allOutput().includes(MOUSE_ENABLE));
		await send(wheelUp(10, 5));
		assert.doesNotMatch(h.lastFrame(), /newer line/);
		assert.doesNotMatch(h.lastFrame(), /\[</);
		setPrefs({mouse: true});
		await h.settle(60);
		assert.ok(h.allOutput().includes(MOUSE_ENABLE));
		await send(wheelUp(10, 5));
		assert.match(h.lastFrame(), /↓ 1 newer line/);
		setPrefs({mouse: false});
		await h.settle(60);
		assert.ok(h.allOutput().lastIndexOf(MOUSE_DISABLE) > h.allOutput().lastIndexOf(MOUSE_ENABLE));
		h.unmount();
	} finally {
		setPrefs({mouse: before});
	}
});

type Recorded = ViewMouseEvent[];

function mouseSetup(handler: (event: ViewMouseEvent) => boolean | void, size = {columns: 100, rows: 30}) {
	const seen: Recorded = [];
	let control: MountControl | undefined;
	let host: (ViewHost & Partial<ViewMouseHost>) | undefined;
	const commands: Command[] = [
		{
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				await ctx.mount!(c => {
					control = c;
					host = c.host as ViewHost & Partial<ViewMouseHost>;
					return <MouseView host={host} onEvent={e => {
						seen.push(e);
						return handler(e);
					}} />;
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
	return {h, send, fillMain, seen, control: () => control!, host: () => host!};
}

function MouseView({host, onEvent}: {host: ViewHost & Partial<ViewMouseHost>; onEvent: (e: ViewMouseEvent) => boolean | void}) {
	useEffect(() => host.subscribeMouse?.(onEvent), [host]);
	return (
		<Box flexDirection="column">
			<Text>VIEW-1</Text>
			<Text>VIEW-2</Text>
			<Text>VIEW-3</Text>
		</Box>
	);
}

test('the host passed to views offers subscribeMouse', async () => {
	const {h, host} = mouseSetup(() => undefined);
	await h.settle(60);
	assert.equal(typeof host().subscribeMouse, 'function');
	h.unmount();
});

test('a view gets its events in local coordinates with its box size', async () => {
	const {h, send, seen} = mouseSetup(() => true);
	await h.settle(60);
	// 30 rows: the three view rows are the screen rows 28..30 (1-based).
	await send(click(5, 29));
	await send(wheelDown(7, 30));
	assert.equal(seen.length, 2);
	const [press, wheel] = seen;
	assert.deepEqual({...press}, {kind: 'press', button: 'left', x: 4, y: 1, width: 100, height: 3, shift: false, meta: false, ctrl: false});
	assert.equal(wheel!.kind, 'wheel');
	assert.equal(wheel!.wheel, 'down');
	assert.equal(wheel!.x, 6);
	assert.equal(wheel!.y, 2);
	assert.ok(Object.isFrozen(press));
	h.unmount();
});

test('clicks outside the view box do not reach the view', async () => {
	const {h, send, seen} = mouseSetup(() => true);
	await h.settle(60);
	await send(click(5, 5));
	assert.equal(seen.length, 0);
	h.unmount();
});

test('a view returning true suppresses the transcript scroll', async () => {
	const {h, send, fillMain, seen} = mouseSetup(() => true);
	await h.settle(60);
	await fillMain();
	await send(wheelUp(5, 29));
	assert.equal(seen.length, 1);
	assert.doesNotMatch(h.lastFrame(), /newer line/);
	h.unmount();
});

for (const [label, handler] of [
	['false', () => false],
	['undefined', () => undefined],
	['a throw', () => {
		throw new Error('view bug');
	}],
] as const) {
	test(`a view returning ${label} falls back to the default scroll`, async () => {
		const {h, send, fillMain, seen} = mouseSetup(handler as (e: ViewMouseEvent) => boolean | void);
		await h.settle(60);
		await fillMain();
		await send(wheelUp(5, 29));
		assert.equal(seen.length, 1);
		assert.match(h.lastFrame(), /↓ 1 newer line/);
		h.unmount();
	});
}

test('an unfocused view still gets the wheel; a press focuses it first', async () => {
	const {h, send, seen, host} = mouseSetup(e => e.kind === 'wheel');
	await h.settle(60);
	await send(CTRL_T);
	assert.equal(host().isFocused(), false);
	await send(wheelUp(5, 29));
	assert.equal(seen.length, 1);
	assert.equal(host().isFocused(), false);
	let focusedAtPress: boolean | undefined;
	const off = host().subscribeMouse!(() => {
		focusedAtPress = host().isFocused();
	});
	await send(click(5, 29));
	assert.equal(focusedAtPress, true);
	off();
	h.unmount();
});

test('a closed view receives no events', async () => {
	const {h, send, seen, control, fillMain} = mouseSetup(() => true);
	await h.settle(60);
	const host = control().host as ViewHost & ViewMouseHost;
	await fillMain();
	control().close();
	await h.settle(60);
	const late: ViewMouseEvent[] = [];
	host.subscribeMouse(e => void late.push(e));
	await send(wheelUp(5, 29));
	await send(click(5, 29));
	assert.equal(seen.length, 0);
	assert.equal(late.length, 0);
	h.unmount();
});

test('at most 8 mouse listeners per view area', async () => {
	const {h, send, host} = mouseSetup(() => undefined);
	await h.settle(60);
	const calls: number[] = [];
	const offs = Array.from({length: 9}, (_, i) => host().subscribeMouse!(() => void calls.push(i)));
	await send(click(5, 29));
	assert.deepEqual(calls, [0, 1, 2, 3, 4, 5, 6], 'the view listener plus 7 more; the 9th and 10th were refused');
	for (const off of offs) off();
	calls.length = 0;
	host().subscribeMouse!(() => void calls.push(99));
	await send(click(5, 29));
	assert.deepEqual(calls, [99], 'unsubscribing frees the slots');
	h.unmount();
});

test('no view events while the Mouse preference is off', async () => {
	const before = getPrefs().mouse;
	setPrefs({mouse: false});
	try {
		const {h, send, seen} = mouseSetup(() => true);
		await h.settle(60);
		await send(click(5, 29));
		await send(wheelUp(5, 29));
		assert.equal(seen.length, 0);
		h.unmount();
	} finally {
		setPrefs({mouse: before});
	}
});
