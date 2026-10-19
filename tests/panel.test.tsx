import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useEffect, useState} from 'react';
import {Text, useInput} from 'ink';
import App, {panelGeometry} from '../src/app.js';
import {windowStart} from '../src/components/Settings.js';
import {createRegistry} from '../src/commands.js';
import {mountHarness} from './testkit.js';
import type {Command, MountControl, Setting} from '../../../src/api.js';

const LEFT = '\x1b[D';
const RIGHT = '\x1b[C';
const ENTER = '\r';
const ESC = '\x1b';
const DOWN = '\x1b[B';

function Chat({control}: {control: MountControl}) {
	const host = control.host!;
	const [focused, setFocused] = useState(host.isFocused());
	const [width, setWidth] = useState(host.columns());
	const [typed, setTyped] = useState('');
	useEffect(
		() =>
			host.subscribe(() => {
				setFocused(host.isFocused());
				setWidth(host.columns());
			}),
		[host],
	);
	useInput(
		(input, key) => {
			if (host.isHostKey(input)) return;
			if (key.rightArrow && typed === '') return void host.move('right');
			setTyped(t => t + input);
		},
		{isActive: focused},
	);
	return <Text>{`CHAT[${typed}] ${focused ? 'focused' : 'idle'} w${width}`}</Text>;
}

function setup(extra: Command[] = [], size = {columns: 100, rows: 30}) {
	let control: MountControl | undefined;
	const commands: Command[] = [
		{
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				ctx.print('chat-opened');
				await ctx.mount!(c => {
					control = c;
					return <Chat control={c} />;
				});
			},
		},
		...extra,
	];
	const h = mountHarness(<App registry={createRegistry(commands)} />, size);
	const type = async (text: string) => {
		h.press(text);
		await h.settle();
	};
	return {h, type, control: () => control!};
}

test('an autostarted main view takes the screen and the focus; the console is closed', async () => {
	const {h} = setup();
	await h.settle(60);
	const frame = h.lastFrame();
	assert.match(frame, /CHAT\[\] focused w100/);
	assert.doesNotMatch(frame, /Console/);
	assert.match(h.allOutput(), /Ctrl\+§ opens the console/);
	assert.match(h.allOutput(), /chat-opened/);
	h.unmount();
});

test('§ toggles the console beside the chat and moves the focus with it', async () => {
	const {h, type} = setup();
	await h.settle(60);
	await type('§');
	let frame = h.lastFrame();
	assert.match(frame, /Console/);
	assert.match(frame, /CHAT\[\] idle w60/);
	await type('abc');
	assert.match(h.lastFrame(), /> abc/);
	assert.match(h.lastFrame(), /CHAT\[\]/);
	await type('§');
	frame = h.lastFrame();
	assert.doesNotMatch(frame, /Console/);
	assert.match(frame, /CHAT\[\] focused w100/);
	h.unmount();
});

test('arrows move the input between the chat and the console', async () => {
	const {h, type} = setup();
	await h.settle(60);
	await type('§');
	await type(LEFT);
	assert.match(h.lastFrame(), /CHAT\[\] focused/);
	await type('x');
	assert.match(h.lastFrame(), /CHAT\[x\]/);
	await type('§');
	await type('§');
	await type(LEFT);
	await type('\x15');
	assert.match(h.lastFrame(), /focused/);
	h.unmount();
});

test('the empty chat moves right into the open console only', async () => {
	const {h, type} = setup();
	await h.settle(60);
	await type(RIGHT);
	assert.match(h.lastFrame(), /CHAT\[\] focused/);
	await type('§');
	await type(LEFT);
	await type(RIGHT);
	assert.match(h.lastFrame(), /CHAT\[\] idle/);
	h.unmount();
});

test('console commands print into the panel, not above the chat', async () => {
	const echo: Command = {name: 'say', description: 'say', run: (args, ctx) => ctx.print(`said:${args.join(' ')}`)};
	const {h, type} = setup([echo]);
	await h.settle(60);
	await type('§');
	await type('say hi');
	await type(ENTER);
	const frame = h.lastFrame();
	assert.match(frame, /said:hi/);
	assert.match(frame, /Console/);
	h.unmount();
});

test('the chat keeps running while the console is open and after it closes', async () => {
	const {h, type, control} = setup();
	await h.settle(60);
	await type('§');
	await type('§');
	assert.match(h.lastFrame(), /CHAT/);
	control().close();
	await h.settle(60);
	assert.match(h.lastFrame(), /^>\s*$/m);
	h.unmount();
});

test('a narrow terminal shows the console instead of the chat without unmounting it', async () => {
	const {h, type} = setup([], {columns: 50, rows: 30});
	await h.settle(60);
	await type('§');
	assert.doesNotMatch(h.lastFrame(), /CHAT/);
	await type('§');
	assert.match(h.lastFrame(), /CHAT\[\] focused w50/);
	h.unmount();
});

test('panelGeometry splits wide terminals and stays inside the height', () => {
	assert.deepEqual(panelGeometry(100, 30, false), {split: false, panelColumns: 0, mainColumns: 100, panelRows: 20});
	const g = panelGeometry(100, 30, true);
	assert.equal(g.split, true);
	assert.equal(g.panelColumns + g.mainColumns, 100);
	assert.ok(g.mainColumns >= 30);
	assert.equal(panelGeometry(50, 30, true).mainColumns, 0);
	assert.ok(panelGeometry(100, 8, true).panelRows <= 5);
});

function modelSetting(store: {value?: string}): Setting {
	return {
		key: 'model',
		label: 'Chat model',
		options: [
			{value: '', label: 'Default'},
			{value: 'opus', label: 'Opus'},
			{value: 'haiku', label: 'Haiku'},
		],
		get: () => store.value,
		set: v => {
			store.value = v;
		},
	};
}

test('settings opens in the console with module tabs and saves a choice', async () => {
	const store: {value?: string} = {};
	const tabbed: Command = {
		name: 'tabbed',
		description: 'has settings',
		settings: {title: 'Claude', settings: [modelSetting(store)]},
		run: () => {},
	};
	const other: Command = {
		name: 'other',
		description: 'more settings',
		settings: {title: 'Other', settings: [{...modelSetting({}), label: 'Other model'}]},
		run: () => {},
	};
	const {h, type} = setup([tabbed, other]);
	await h.settle(60);
	await type('§');
	await type('settings');
	await type(ENTER);
	await h.settle(60);
	let frame = h.lastFrame();
	assert.match(frame, /Settings  Claude/);
	assert.match(frame, /Chat model/);
	assert.match(frame, /● Default/);
	await type(DOWN);
	await type(ENTER);
	await h.settle(60);
	assert.equal(store.value, 'opus');
	frame = h.lastFrame();
	assert.doesNotMatch(frame, /↑↓ select/);
	assert.match(frame, /Claude · Chat model: Opus/);
	await type('settings');
	await type(ENTER);
	await h.settle(60);
	assert.match(h.lastFrame(), /● Opus/);
	await type(RIGHT);
	await h.settle(60);
	assert.match(h.lastFrame(), /Other model/);
	await type(ESC);
	await h.settle(60);
	frame = h.lastFrame();
	assert.doesNotMatch(frame, /↑↓ select/);
	assert.match(frame, /Console/);
	assert.match(frame, /CHAT/);
	h.unmount();
});

test('settings taller than the panel scroll inside it and never overlap', async () => {
	const many: Setting[] = Array.from({length: 4}, (_v, i) => ({...modelSetting({}), key: `k${i}`, label: `Setting ${i}`}));
	const tabbed: Command = {name: 'tabbed', description: 'x', settings: {title: 'Claude', settings: many}, run: () => {}};
	const rows = 14;
	const {h, type} = setup([tabbed], {columns: 100, rows});
	await h.settle(60);
	await type('§');
	await type('help');
	await type(ENTER);
	await type('settings');
	await type(ENTER);
	await h.settle(60);
	const check = () => {
		const frame = h.lastFrame();
		const panel = frame.split('\n').filter(l => l.includes('│')).map(l => l.slice(l.indexOf('│') + 2).trimEnd());
		assert.ok(panel.length <= rows - 3, `panel has ${panel.length} rows`);
		for (const line of panel) assert.doesNotMatch(line, /(Default|Opus|Haiku).*(Default|Opus|Haiku)/, line);
		return panel.join('\n');
	};
	assert.match(check(), /Setting 0/);
	for (let i = 0; i < 11; i++) await type(DOWN);
	const shown = check();
	assert.match(shown, /Setting 3/);
	assert.doesNotMatch(shown, /Setting 0/);
	h.unmount();
});

test('settings without a chat runs full width and malformed tabs are dropped', async () => {
	const bad = {name: 'bad', description: 'bad', settings: {title: 'Bad', settings: [{key: 'x'}]}, run: () => {}} as unknown as Command;
	const h = mountHarness(<App registry={createRegistry([bad])} />);
	await h.settle();
	h.press('settings');
	await h.settle();
	h.press(ENTER);
	await h.settle(60);
	assert.match(h.lastFrame(), /No module provides settings/);
	h.press(ESC);
	await h.settle(60);
	assert.match(h.lastFrame(), /^>\s*$/m);
	h.unmount();
});

test('windowStart keeps the focus visible and pulls in its label when it fits', () => {
	assert.equal(windowStart(5, 10, 3, 0), 0);
	assert.equal(windowStart(30, 10, 0, 0), 0);
	assert.equal(windowStart(30, 10, 29, 25), 20);
	assert.equal(windowStart(30, 10, 15, 12), 10);
	assert.equal(windowStart(30, 5, 15, 2), 13);
	const s = windowStart(30, 6, 14, 11);
	assert.ok(s <= 11 && 14 < s + 6);
});
