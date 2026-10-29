import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useEffect, useState} from 'react';
import {Text} from 'ink';
import App, {panelGeometry, shareAtBorder} from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {createMouseTerminal} from '../../src/mouse/terminal.js';
import {DEFAULT_PREFS, getPrefs, setPrefs} from '../../src/view/prefs.js';
import {createFakeStdout, createFakeTty, mountHarness} from '../testkit.js';
import type {Command, MountControl} from '../../../../src/api.js';

const ESC = '\x1b';
const press = (x: number, y: number) => `${ESC}[<0;${x};${y}M`;
const drag = (x: number, y: number) => `${ESC}[<32;${x};${y}M`;
const release = (x: number, y: number) => `${ESC}[<0;${x};${y}m`;
const CTRL_T = '\x14';

function Chat({control}: {control: MountControl}) {
	const host = control.host!;
	const [width, setWidth] = useState(host.columns());
	useEffect(() => host.subscribe(() => setWidth(host.columns())), [host]);
	return <Text>{`CHAT w${width}`}</Text>;
}

function setup() {
	const size = {columns: 100, rows: 30};
	const commands: Command[] = [
		{
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				await ctx.mount!(c => <Chat control={c} />);
			},
		},
	];
	const tty = createFakeTty();
	const stdout = createFakeStdout(size);
	const proxy = createInputProxy(tty, {size: () => ({columns: stdout.columns, rows: stdout.rows})});
	const mouse = createMouseTerminal(stdout, proxy);
	const h = mountHarness(<App registry={createRegistry(commands)} mouse={mouse} />, size, {tty, stdin: proxy.stream, stdout});
	const send = async (text: string) => {
		h.press(text);
		await h.settle(80);
	};
	return {h, send};
}

test('panelGeometry follows the share within the limits of both areas', () => {
	assert.equal(panelGeometry(100, 30, true, 0.5).panelColumns, 50);
	assert.equal(panelGeometry(100, 30, true, 0.1).panelColumns, 28);
	assert.equal(panelGeometry(100, 30, true, 0.9).mainColumns, 30);
	assert.equal(shareAtBorder(100, 50), 0.5);
	assert.equal(shareAtBorder(100, 95), 0.28);
	assert.equal(shareAtBorder(100, 5), 0.7);
});

test('dragging the console border resizes the chat and saves the share on release', async () => {
	setPrefs({panelShare: DEFAULT_PREFS.panelShare});
	const {h, send} = setup();
	await h.settle(60);
	await send(CTRL_T);
	assert.match(h.lastFrame(), /CHAT w60/);
	await send(press(61, 10));
	await send(drag(51, 10));
	assert.match(h.lastFrame(), /CHAT w50/);
	assert.equal(getPrefs().panelShare, DEFAULT_PREFS.panelShare);
	await send(drag(41, 12));
	await send(release(41, 12));
	assert.match(h.lastFrame(), /CHAT w40/);
	assert.equal(getPrefs().panelShare, 0.6);
	await send(drag(70, 12));
	assert.match(h.lastFrame(), /CHAT w40/);
	h.unmount();
	setPrefs({panelShare: DEFAULT_PREFS.panelShare});
});

test('a press next to the border does not resize', async () => {
	setPrefs({panelShare: DEFAULT_PREFS.panelShare});
	const {h, send} = setup();
	await h.settle(60);
	await send(CTRL_T);
	await send(press(62, 10));
	await send(drag(51, 10));
	await send(release(51, 10));
	assert.match(h.lastFrame(), /CHAT w60/);
	assert.equal(getPrefs().panelShare, DEFAULT_PREFS.panelShare);
	h.unmount();
});
