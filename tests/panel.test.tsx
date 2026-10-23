import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useEffect, useState} from 'react';
import {Text, useInput} from 'ink';
import App, {panelGeometry} from '../src/app.js';
import {windowStart} from '../src/kit/window.js';
import {createRegistry} from '../src/commands.js';
import {createFakeStdout, mountHarness} from './testkit.js';
import {useViewHost} from '../src/view/use-view-host.js';
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
			if (host.isHostKey(input, key)) return;
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
		await h.settle(80);
	};
	return {h, type, control: () => control!};
}

test('an autostarted main view takes the screen and the focus; the console is closed', async () => {
	const {h} = setup();
	await h.settle(60);
	const frame = h.lastFrame();
	assert.match(frame, /CHAT\[\] focused w100/);
	assert.doesNotMatch(frame, /Console/);
	assert.match(h.allOutput(), /press Tab \(or Ctrl\+T\) to open the console/);
	assert.doesNotMatch(frame, /chat-opened/, 'output before the chat opened is cleared');
	h.unmount();
});

test('Ctrl+T toggles the console beside the chat and moves the focus with it', async () => {
	const {h, type} = setup();
	await h.settle(60);
	await type('\x14');
	let frame = h.lastFrame();
	assert.match(frame, /Console/);
	assert.match(frame, /CHAT\[\] idle w60/);
	await type('abc');
	assert.match(h.lastFrame(), /> abc/);
	assert.match(h.lastFrame(), /CHAT\[\]/);
	await type('\x14');
	frame = h.lastFrame();
	assert.doesNotMatch(frame, /Console/);
	assert.match(frame, /CHAT\[\] focused w100/);
	h.unmount();
});

test('arrows move the input between the chat and the console', async () => {
	const {h, type} = setup();
	await h.settle(60);
	await type('\x14');
	await type(LEFT);
	assert.match(h.lastFrame(), /CHAT\[\] focused/);
	await type('x');
	assert.match(h.lastFrame(), /CHAT\[x\]/);
	await type('\x14');
	await type('\x14');
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
	await type('\x14');
	await type(LEFT);
	await type(RIGHT);
	assert.match(h.lastFrame(), /CHAT\[\] idle/);
	h.unmount();
});

test('console commands print into the panel, not above the chat', async () => {
	const echo: Command = {name: 'say', description: 'say', run: (args, ctx) => ctx.print(`said:${args.join(' ')}`)};
	const {h, type} = setup([echo]);
	await h.settle(60);
	await type('\x14');
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
	await type('\x14');
	await type('\x14');
	assert.match(h.lastFrame(), /CHAT/);
	control().close();
	await h.settle(60);
	assert.match(h.lastFrame(), /^>\s*$/m);
	h.unmount();
});

test('a narrow terminal shows the console instead of the chat without unmounting it', async () => {
	const {h, type} = setup([], {columns: 50, rows: 30});
	await h.settle(60);
	await type('\x14');
	assert.doesNotMatch(h.lastFrame(), /CHAT/);
	await type('\x14');
	assert.match(h.lastFrame(), /CHAT\[\] focused w50/);
	h.unmount();
});

test('panelGeometry splits wide terminals and stays inside the height', () => {
	assert.deepEqual(panelGeometry(100, 30, false), {split: false, panelColumns: 0, mainColumns: 100, panelRows: 30});
	const g = panelGeometry(100, 30, true);
	assert.equal(g.split, true);
	assert.equal(g.panelColumns + g.mainColumns, 100);
	assert.ok(g.mainColumns >= 30);
	assert.equal(panelGeometry(50, 30, true).mainColumns, 0);
	assert.equal(panelGeometry(100, 8, true).panelRows, 8);
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
	await type('\x14');
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
	assert.match(frame, /↑↓ select/);
	assert.match(frame, /● Opus/);
	assert.match(frame, /Saved · Chat model: Opus/);
	await type(DOWN);
	await type(ENTER);
	await h.settle(60);
	assert.equal(store.value, 'haiku');
	assert.match(h.lastFrame(), /● Haiku/);
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
	await type('\x14');
	await type('help');
	await type(ENTER);
	await type('settings');
	await type(ENTER);
	await h.settle(60);
	const check = () => {
		const frame = h.lastFrame();
		const panel = frame.split('\n').filter(l => l.includes('│')).map(l => l.slice(l.indexOf('│') + 2).trimEnd());
		assert.ok(panel.length <= rows, `panel has ${panel.length} rows`);
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
	assert.match(h.lastFrame(), /Settings  Appearance/);
	assert.doesNotMatch(h.lastFrame(), /Bad/);
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

test('the app fills the terminal and the transcript scrolls with PgUp/PgDn and Shift+↑/↓', async () => {
	const say: Command = {
		name: 'many',
		description: 'print many lines',
		run: (_a, ctx) => {
			for (let i = 0; i < 60; i++) ctx.print(`line-${i}`);
		},
	};
	const rows = 20;
	const h = mountHarness(<App registry={createRegistry([say])} />, {columns: 60, rows});
	await h.settle();
	h.press('many');
	await h.settle();
	h.press(ENTER);
	await h.settle(60);
	let frame = h.lastFrame();
	assert.equal(frame.split('\n').length, rows);
	assert.match(frame, /line-59/);
	assert.doesNotMatch(frame, /line-30\b/);
	h.press('\x1b[5~');
	await h.settle(60);
	frame = h.lastFrame();
	assert.doesNotMatch(frame, /line-59/);
	assert.match(frame, /newer lines · PgDn or Shift\+↓/);
	h.press('\x1b[1;2B');
	await h.settle(60);
	h.press('\x1b[6~');
	await h.settle(60);
	h.press('\x1b[6~');
	await h.settle(60);
	frame = h.lastFrame();
	assert.match(frame, /line-59/);
	assert.doesNotMatch(frame, /newer line/);
	h.press('\x1b[1;2A');
	await h.settle(60);
	assert.match(h.lastFrame(), /1 newer line ·/);
	h.unmount();
});

test('a scrolled-up transcript stays on the same lines while output arrives', async () => {
	let ctxRef: import('../../../src/api.js').CommandContext | undefined;
	const grab: Command = {name: 'grab', description: 'x', run: (_a, ctx) => void (ctxRef = ctx)};
	const h = mountHarness(<App registry={createRegistry([grab])} />, {columns: 60, rows: 12});
	await h.settle();
	h.press('grab');
	await h.settle();
	h.press(ENTER);
	await h.settle();
	for (let i = 0; i < 30; i++) ctxRef!.print(`old-${i}`);
	await h.settle(60);
	h.press('\x1b[5~');
	await h.settle(60);
	const before = h.lastFrame().match(/old-\d+/g)!.join(',');
	ctxRef!.print('fresh');
	await h.settle(60);
	assert.equal(h.lastFrame().match(/old-\d+/g)!.join(','), before);
	assert.doesNotMatch(h.lastFrame(), /fresh/);
	h.unmount();
});

test('§ and Ctrl+T toggle the console; Esc, t and \\ do not', async () => {
	const {h, type} = setup();
	await h.settle(60);
	for (const key of [ESC, 't', '\\', '\x1b[27;5u']) {
		await type(key);
		await h.settle(40);
		assert.doesNotMatch(h.lastFrame(), /Console/);
	}
	await type('\x14');
	assert.match(h.lastFrame(), /Console · Tab close/);
	await type('\x14');
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('§ (sent for ⌘+§ and Ctrl+§) toggles the console and is never typed', async () => {
	const {h, type} = setup();
	await h.settle(60);
	await type('§');
	assert.match(h.lastFrame(), /Console · Tab close/);
	assert.doesNotMatch(h.lastFrame(), /> .*§/);
	await type('§');
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('Esc no longer toggles the console; Ctrl+T and § still do', async () => {
	const {h, type} = setup();
	await h.settle(60);
	await type('§');
	assert.match(h.lastFrame(), /Console/);
	await type(ESC);
	await h.settle(40);
	await type(ESC);
	await h.settle(60);
	assert.match(h.lastFrame(), /Console/, 'double Esc leaves it open');
	await type('\x14');
	assert.doesNotMatch(h.lastFrame(), /Console/);
	assert.match(h.lastFrame(), /CHAT\[\] focused/);
	h.unmount();
});

test('a main view opens the console through host.togglePanel', async () => {
	const {h, control} = setup();
	await h.settle(60);
	assert.equal(control().host!.togglePanel!(), true);
	await h.settle(60);
	assert.match(h.lastFrame(), /Console/);
	assert.match(h.lastFrame(), /CHAT\[\] idle/);
	h.unmount();
});


test('a main view can show a title bar above the transcript; it goes when the view closes', async () => {
	const {h, control} = setup();
	await h.settle(60);
	control().host!.setTitle!('Build fix', 'API key · opus · idle');
	await h.settle(60);
	const lines = h.lastFrame().split('\n');
	assert.match(lines[0]!, /^ Build fix +API key · opus · idle\s*$/);
	control().host!.setTitle!(`Evil\u001b]0;x\u0007 name`, 'd');
	await h.settle(60);
	assert.doesNotMatch(h.lastFrame(), /\u001b\]0;/);
	control().close();
	await h.settle(60);
	assert.doesNotMatch(h.lastFrame(), /Evil/);
	h.unmount();
});

test('titleBarText keeps the detail on the right and shortens the title first', async () => {
	const {titleBarText} = await import('../src/components/TitleBar.js');
	const a = titleBarText('Chat', 'opus · idle', 30);
	assert.ok(a.left.startsWith(' Chat '));
	assert.equal(a.right, ' opus · idle ');
	assert.equal((a.left + a.right).length, 30);
	const b = titleBarText('A very long chat title indeed', 'opus · idle', 24);
	assert.equal([...(b.left + b.right)].length, 24);
	assert.match(b.left, /…/);
	assert.match(b.right, /opus · idle/);
});

test('the title bar is olive by default, follows the Appearance colour, and is inverse without colours', async () => {
	const {titleBarStyle} = await import('../src/components/TitleBar.js');
	assert.deepEqual(titleBarStyle({}), {backgroundColor: '#808000', color: '#000000'});
	assert.deepEqual(titleBarStyle({}, 'blue'), {backgroundColor: '#1f4e8c', color: '#ffffff'});
	assert.deepEqual(titleBarStyle({}, 'inverse'), {inverse: true});
	assert.deepEqual(titleBarStyle({NO_COLOR: '1'}), {inverse: true});
});

test('appearance prefs load, save and notify; broken files give the defaults', async () => {
	const {mkdtempSync, readFileSync, writeFileSync} = await import('node:fs');
	const {tmpdir} = await import('node:os');
	const {join} = await import('node:path');
	const {loadPrefs, getPrefs, setPrefs, subscribePrefs, DEFAULT_PREFS} = await import('../src/view/prefs.js');
	const {colorEnabled} = await import('../src/hints/style.js');
	const dir = mkdtempSync(join(tmpdir(), 'core-prefs-'));
	assert.deepEqual(loadPrefs(dir), DEFAULT_PREFS);
	let calls = 0;
	const off = subscribePrefs(() => calls++);
	setPrefs({titleBar: 'teal', colors: false});
	assert.equal(calls, 1);
	assert.deepEqual(JSON.parse(readFileSync(join(dir, 'appearance.json'), 'utf8')), {titleBar: 'teal', colors: false, mouse: true, agentCommands: 'policy'});
	assert.equal(colorEnabled({}), false);
	writeFileSync(join(dir, 'appearance.json'), '{"titleBar":"pink","colors":"x"}');
	assert.deepEqual(loadPrefs(dir), DEFAULT_PREFS);
	assert.equal(getPrefs().colors, true);
	off();
});

test(':q in the side console closes the console and keeps the chat', async () => {
	const {h, type} = setup();
	await h.settle(60);
	await type('§');
	await type(':q');
	await type(ENTER);
	await h.settle(60);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	assert.match(h.lastFrame(), /CHAT\[\] focused/);
	h.unmount();
});

test(':q in a full-screen console and host.quit from a view exit the app', async () => {
	const h = mountHarness(<App registry={createRegistry([])} />);
	await h.settle();
	h.press(':q');
	await h.settle();
	h.press(ENTER);
	await h.waitUntilExit();
	const {h: h2, control} = setup();
	await h2.settle(60);
	control().host!.quit!();
	await h2.waitUntilExit();
});

test('a new main view starts on a clean transcript, keeping the welcome line', async () => {
	const {h, control} = setup();
	await h.settle(60);
	control().print!('old message');
	await h.settle(60);
	assert.match(h.lastFrame(), /old message/);
	control().close();
	await h.settle(60);
	h.press('chat');
	await h.settle();
	h.press(ENTER);
	await h.settle(80);
	assert.doesNotMatch(h.lastFrame(), /old message/);
	assert.match(h.lastFrame(), /press Tab/);
	assert.match(h.lastFrame(), /CHAT\[\]/);
	h.unmount();
});

test('Tab on an empty console line closes the console, Tab with hints completes; Shift+← and Shift+→ move the focus', async () => {
	const {h, type} = setup();
	await h.settle(60);
	await type('\x14');
	assert.match(h.lastFrame(), /Console · Tab close/);
	assert.match(h.lastFrame(), /CHAT\[\] idle/);
	h.press('\x1b[1;2D');
	await h.settle(60);
	assert.match(h.lastFrame(), /CHAT\[\] focused/);
	h.press('\x1b[1;2D');
	await h.settle(60);
	assert.match(h.lastFrame(), /CHAT\[\] focused/, 'nothing further left; the chat ignores the host key');
	h.press('\x1b[1;2C');
	await h.settle(60);
	assert.match(h.lastFrame(), /CHAT\[\] idle/);
	await type('hel');
	await type('\t');
	assert.match(h.lastFrame(), /Console/, 'Tab completed the hint instead');
	assert.match(h.lastFrame(), /> help/);
	await type('\x15');
	await type('\t');
	assert.doesNotMatch(h.lastFrame(), /Console/);
	assert.match(h.lastFrame(), /CHAT\[\] focused/);
	h.unmount();
});

test('a view can run a console line: it opens the console and runs it there; unknown words run nothing', async () => {
	let ran: string[] = [];
	const say: Command = {name: 'say', description: 'say it', usage: 'say <text>', run: (args, ctx) => {
		ran = args;
		ctx.print(`said ${args.join(' ')}`);
	}};
	const {h, control} = setup([say]);
	await h.settle(60);
	const host = control().host as unknown as {runLine(l: string): boolean; listCommands(): Array<{name: string; description: string; usage?: string}>};
	assert.ok(host.listCommands().some(c => c.name === 'say' && c.description === 'say it' && c.usage === 'say <text>'));
	assert.equal(host.runLine('nope x'), false);
	assert.equal(host.runLine('say\u0007 x'), false);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	assert.equal(host.runLine('say hi there'), true);
	await h.settle(60);
	assert.deepEqual(ran, ['hi', 'there']);
	assert.match(h.lastFrame(), /Console/);
	assert.match(h.lastFrame(), /said hi there/);
	assert.match(h.lastFrame(), /CHAT\[\] focused/, 'the input stays in the view');
	h.unmount();
});

function WidthView({control}: {control: MountControl}) {
	const {columns, focused} = useViewHost(control.host);
	return <Text>{`VIEW w${columns} ${focused ? 'focused' : 'idle'}`}</Text>;
}

test('a mounted view gets the new width in the same frame the console opens and closes', async () => {
	const stdout = createFakeStdout({columns: 100, rows: 20});
	const frames: string[] = [];
	stdout.on('data', c => frames.push(String(c)));
	const view: Command = {
		name: 'view',
		description: 'a view',
		autostart: true,
		run: async (_a, ctx) => {
			await ctx.mount!(c => <WidthView control={c} />);
		},
	};
	const h = mountHarness(<App registry={createRegistry([view])} />, {columns: 100, rows: 20}, {stdout});
	await h.settle(80);
	assert.match(h.lastFrame(), /VIEW w100 focused/);
	for (const [key, width] of [['\x14', /VIEW w(\d+) idle/], ['\x14', /VIEW w100 focused/]] as const) {
		const from = frames.length;
		h.press(key);
		await h.settle(80);
		const drawn = frames.slice(from).filter(f => /VIEW w/.test(f));
		assert.ok(drawn.length > 0);
		for (const f of drawn) assert.match(f, width, 'no frame at the old width');
		if (key === '\x14' && width.source.includes('idle')) assert.notEqual(Number(/VIEW w(\d+)/.exec(drawn[0]!)?.[1]), 100);
	}
	h.unmount();
});
