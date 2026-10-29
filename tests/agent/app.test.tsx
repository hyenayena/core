import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text} from 'ink';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {loadPrefs, setPrefs} from '../../src/view/prefs.js';
import {mountHarness} from '../testkit.js';
import type {Command, CommandContext, MountControl} from '../../../../src/api.js';

const ENTER = '\r';

// Prefs are saved when a test changes them, so they go to a folder of their own.
const prefsDir = mkdtempSync(path.join(tmpdir(), 'yena-core-agent-'));
after(() => rmSync(prefsDir, {recursive: true, force: true}));

function setup(extra: Command[] = [], size = {columns: 100, rows: 30}) {
	const seen: {user?: CommandContext; agent?: CommandContext} = {};
	const commands: Command[] = [
		{
			name: 'grab',
			description: 'keep the context',
			run: (_a, ctx) => {
				seen.user = ctx;
			},
		},
		{
			name: 'probe',
			description: 'keep the agent context',
			agent: 'safe',
			run: (_a, ctx) => {
				seen.agent = ctx;
				ctx.print('probe-output');
			},
		},
		...extra,
	];
	const registry = createRegistry(commands);
	const h = mountHarness(<App registry={registry} />, size);
	const type = async (text: string) => {
		h.press(text);
		await h.settle(80);
	};
	const submit = async (text: string) => {
		await type(text);
		await type(ENTER);
	};
	return {h, seen, registry, submit, type};
}

test('the user context has a command bridge; the agent context has mount but no other UI members', async () => {
	loadPrefs(prefsDir);
	const {h, seen, submit} = setup();
	await submit('grab');
	assert.ok(seen.user?.commandBridge);
	const result = await seen.user!.commandBridge!.run({line: 'probe', caller: 'tester'});
	assert.equal(result.status, 'ok');
	assert.equal(result.output, 'probe-output');
	const ctx = seen.agent as unknown as Record<string, unknown>;
	assert.equal(typeof ctx['mount'], 'function');
	for (const key of ['suspend', 'copyToClipboard', 'commandBridge']) assert.equal(key in ctx, false, key);
	assert.ok(ctx['signal'] instanceof AbortSignal);
	await h.settle(50);
	assert.match(h.lastFrame(), /\[tester\] > probe/);
	assert.match(h.allOutput(), /probe-output/);
	h.unmount();
});

test('a command added to the registry later appears in list()', async () => {
	const {h, seen, registry, submit} = setup();
	await submit('grab');
	const bridge = seen.user!.commandBridge!;
	assert.equal(bridge.list().some(c => c.name === 'later'), false);
	registry.commands.push({name: 'later', description: 'added', agent: 'safe', run: () => {}});
	assert.deepEqual(bridge.list().find(c => c.name === 'later')?.policy, 'safe');
	h.unmount();
});

test('core commands: help runs, settings is denied, clear needs confirmation', async () => {
	const {h, seen, submit} = setup();
	await submit('grab');
	const bridge = seen.user!.commandBridge!;
	assert.equal((await bridge.run({line: 'help', caller: 'tester'})).status, 'ok');
	assert.equal((await bridge.run({line: 'settings', caller: 'tester'})).status, 'denied');
	assert.equal((await bridge.run({line: 'clear', caller: 'tester'})).status, 'declined');
	h.unmount();
});

test('an agent command may only mount into the console panel', async () => {
	const {h, seen, submit} = setup([
		{
			name: 'needsview',
			description: 'x',
			agent: 'safe',
			run: async (_a, ctx) => {
				await ctx.mount!(() => <Text>never</Text>);
			},
		},
	]);
	await submit('grab');
	const r = await seen.user!.commandBridge!.run({line: 'needsview', caller: 'tester'});
	assert.equal(r.status, 'error');
	assert.match(r.reason ?? '', /only show views in the console panel/);
	h.unmount();
});

test('with the Assistant setting off the bridge refuses', async () => {
	const {h, seen, submit} = setup();
	await submit('grab');
	setPrefs({agentCommands: 'off'});
	try {
		assert.equal((await seen.user!.commandBridge!.run({line: 'help', caller: 'tester'})).status, 'off');
	} finally {
		setPrefs({agentCommands: 'policy'});
	}
	h.unmount();
});

test('output goes to the console panel beside a view, and autostart still works', async () => {
	let ctxSeen: CommandContext | undefined;
	const {h, type} = (() => {
		const commands: Command[] = [
			{
				name: 'chat',
				description: 'view',
				autostart: true,
				run: async (_a, ctx) => {
					ctxSeen = ctx;
					await ctx.mount!(() => <Text>CHAT-VIEW</Text>);
				},
			},
			{name: 'say', description: 'say', agent: 'safe', run: (_a, ctx) => ctx.print('said-it')},
		];
		const h = mountHarness(<App registry={createRegistry(commands)} />, {columns: 100, rows: 30});
		return {h, type: async (t: string) => (h.press(t), h.settle(80))};
	})();
	await h.settle(80);
	assert.match(h.lastFrame(), /CHAT-VIEW/);
	assert.ok(ctxSeen?.commandBridge, 'the autostart context has the bridge');
	await type('\x14');
	const result = await ctxSeen!.commandBridge!.run({line: 'say', caller: 'bot'});
	assert.equal(result.status, 'ok');
	await h.settle(80);
	const frame = h.lastFrame();
	assert.match(frame, /\[bot\] > say/);
	assert.match(frame, /said-it/);
	h.unmount();
});

type Probe = {control?: MountControl; builds: number};

function peek(name: string, probe: Probe): Command {
	return {
		name,
		description: name,
		agent: 'safe',
		run: async (_a, ctx) => {
			try {
				await ctx.mount!(
					control => {
						probe.control = control;
						probe.builds++;
						return <Text>AGENT-VIEW</Text>;
					},
					{target: 'panel'},
				);
			} catch (error) {
				ctx.print(`fallback: ${(error as Error).message}`);
			}
		},
	};
}

// A chat in the main area, its control kept, plus extra commands.
function boot(size: {columns: number; rows: number}, extra: Command[] = []) {
	const seen: {chat?: CommandContext; chatControl?: MountControl; act?: CommandContext} = {};
	const commands: Command[] = [
		{
			name: 'chat',
			description: 'view',
			autostart: true,
			run: async (_a, ctx) => {
				seen.chat = ctx;
				await ctx.mount!(control => {
					seen.chatControl = control;
					return <Text>CHAT-VIEW</Text>;
				});
			},
		},
		{name: 'act', description: 'keep ctx', run: (_a, ctx) => void (seen.act = ctx)},
		...extra,
	];
	const h = mountHarness(<App registry={createRegistry(commands)} graceMs={GRACE} />, size);
	const type = async (text: string) => {
		h.press(text);
		await h.settle(80);
	};
	return {h, seen, type, bridge: () => seen.chat!.commandBridge!};
}

const TOGGLE = '\x14';
const GRACE = 400;
const pastGrace = (h: {settle: (ms?: number) => Promise<void>}) => h.settle(GRACE + 200);

test('an agent view opens the console beside the chat without taking focus, and the console closes after the grace', async () => {
	loadPrefs(prefsDir);
	const probe: Probe = {builds: 0};
	const {h, seen, bridge} = boot({columns: 100, rows: 30}, [peek('peek', probe)]);
	await h.settle(80);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	const run = bridge().run({line: 'peek', caller: 'tester'});
	await h.settle(80);
	assert.match(h.lastFrame(), /AGENT-VIEW/);
	assert.match(h.lastFrame(), /CHAT-VIEW/);
	assert.equal(probe.control!.host!.isFocused(), false);
	assert.equal(seen.chatControl!.host!.isFocused(), true);
	probe.control!.close();
	const result = await run;
	await h.settle(80);
	assert.equal(result.status, 'ok');
	const frame = h.lastFrame();
	assert.doesNotMatch(frame, /AGENT-VIEW/);
	assert.match(frame, /Console/);
	assert.match(frame, /\[tester\] > peek/);
	await pastGrace(h);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('in a narrow terminal the agent view takes the focus and the console closes after the grace', async () => {
	const probe: Probe = {builds: 0};
	const {h, bridge} = boot({columns: 50, rows: 30}, [peek('peek', probe)]);
	await h.settle(80);
	const run = bridge().run({line: 'peek', caller: 'tester'});
	await h.settle(80);
	assert.match(h.lastFrame(), /AGENT-VIEW/);
	assert.equal(probe.control!.host!.isFocused(), true);
	probe.control!.close();
	await run;
	await h.settle(80);
	assert.match(h.lastFrame(), /Console/);
	await pastGrace(h);
	assert.match(h.lastFrame(), /CHAT-VIEW/);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('a narrow console the user touched stays open after the agent view closes', async () => {
	const probe: Probe = {builds: 0};
	const {h, type, bridge} = boot({columns: 50, rows: 30}, [peek('peek', probe)]);
	await h.settle(80);
	const run = bridge().run({line: 'peek', caller: 'tester'});
	await h.settle(80);
	await type(TOGGLE);
	await type(TOGGLE);
	probe.control!.close();
	await run;
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	h.unmount();
});

test('a user panel view makes the agent mount fail before build and the command falls back to print', async () => {
	const probe: Probe = {builds: 0};
	let userControl: MountControl | undefined;
	const {h, type, bridge} = boot({columns: 100, rows: 30}, [
		peek('peek', probe),
		{
			name: 'userpanel',
			description: 'u',
			run: async (_a, ctx) => {
				await ctx.mount!(
					control => {
						userControl = control;
						return <Text>USER-PANEL</Text>;
					},
					{target: 'panel'},
				);
			},
		},
	]);
	await h.settle(80);
	await type(TOGGLE);
	for (const ch of 'userpanel\r') await type(ch);
	assert.match(h.lastFrame(), /USER-PANEL/);
	const result = await bridge().run({line: 'peek', caller: 'tester'});
	assert.equal(result.status, 'ok');
	assert.match(result.output, /fallback: A view is already mounted/);
	assert.equal(probe.builds, 0);
	userControl!.close();
	h.unmount();
});

test('the console draft survives an agent view', async () => {
	const probe: Probe = {builds: 0};
	const {h, type, bridge} = boot({columns: 100, rows: 30}, [peek('peek', probe)]);
	await h.settle(80);
	await type(TOGGLE);
	await type('half-typed');
	const run = bridge().run({line: 'peek', caller: 'tester'});
	await h.settle(80);
	assert.match(h.lastFrame(), /AGENT-VIEW/);
	assert.doesNotMatch(h.lastFrame(), /half-typed/);
	probe.control!.close();
	await run;
	await h.settle(80);
	assert.match(h.lastFrame(), /half-typed/);
	assert.doesNotMatch(h.lastFrame(), /AGENT-VIEW/);
	h.unmount();
});

test('a failed agent command with a view leaves its footer and the view is gone', async () => {
	const {h, bridge} = boot({columns: 100, rows: 30}, [
		{
			name: 'boom',
			description: 'b',
			agent: 'safe',
			run: async (_a, ctx) => {
				void ctx.mount!(() => <Text>AGENT-VIEW</Text>, {target: 'panel'});
				throw new Error('exploded');
			},
		},
	]);
	await h.settle(80);
	const result = await bridge().run({line: 'boom', caller: 'tester'});
	await h.settle(80);
	assert.equal(result.status, 'error');
	assert.doesNotMatch(h.lastFrame(), /AGENT-VIEW/);
	assert.match(h.lastFrame(), /\[tester\] > boom/);
	assert.match(h.lastFrame(), /exploded/);
	h.unmount();
});

function activityFromClosedConsole() {
	const state: {control?: MountControl} = {};
	return {
		state,
		start: (ctx: CommandContext, options: {target?: 'main' | 'panel'; activity?: boolean} = {target: 'panel', activity: true}) =>
			ctx.mount!(
				control => {
					state.control = control;
					return <Text>ACTIVITY-VIEW</Text>;
				},
				options,
			),
	};
}

test('an activity view from a user context opens the console, keeps the focus and the prompt draft, and closes it again', async () => {
	const {h, seen, type} = boot({columns: 100, rows: 30});
	await h.settle(80);
	await type(TOGGLE);
	for (const ch of 'act\r') await type(ch);
	await type(TOGGLE);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	const activity = activityFromClosedConsole();
	const done = activity.start(seen.act!);
	await h.settle(80);
	assert.match(h.lastFrame(), /ACTIVITY-VIEW/);
	assert.match(h.lastFrame(), /Console/);
	assert.equal(activity.state.control!.host!.isFocused(), false);
	activity.state.control!.close();
	await done;
	await h.settle(80);
	assert.match(h.lastFrame(), /Console/);
	await pastGrace(h);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('an activity view hides the prompt of an already open console and keeps its draft', async () => {
	const {h, seen, type} = boot({columns: 100, rows: 30});
	await h.settle(80);
	await type(TOGGLE);
	for (const ch of 'act\r') await type(ch);
	await type('draft');
	const activity = activityFromClosedConsole();
	const done = activity.start(seen.act!);
	await h.settle(80);
	assert.match(h.lastFrame(), /ACTIVITY-VIEW/);
	assert.doesNotMatch(h.lastFrame(), /draft/);
	activity.state.control!.close();
	await done;
	await h.settle(80);
	assert.match(h.lastFrame(), /draft/);
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	h.unmount();
});

test('an activity view that printed into the console follows the same grace rule', async () => {
	const {h, seen, type} = boot({columns: 100, rows: 30});
	await h.settle(80);
	await type(TOGGLE);
	for (const ch of 'act\r') await type(ch);
	await type(TOGGLE);
	const activity = activityFromClosedConsole();
	const done = activity.start(seen.act!);
	await h.settle(80);
	activity.state.control!.print!('printed-line');
	activity.state.control!.close();
	await done;
	await h.settle(80);
	assert.match(h.lastFrame(), /printed-line/);
	await pastGrace(h);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('an activity view the user touched leaves the console open', async () => {
	const {h, seen, type} = boot({columns: 100, rows: 30});
	await h.settle(80);
	await type(TOGGLE);
	for (const ch of 'act\r') await type(ch);
	await type(TOGGLE);
	const activity = activityFromClosedConsole();
	const done = activity.start(seen.act!);
	await h.settle(80);
	await type(TOGGLE);
	await type(TOGGLE);
	activity.state.control!.close();
	await done;
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	h.unmount();
});

test('an activity view is refused for main and without a target', async () => {
	const {h, seen} = boot({columns: 100, rows: 30});
	await h.settle(80);
	const activity = activityFromClosedConsole();
	await assert.rejects(activity.start(seen.chat!, {activity: true}), /only be shown in the console panel/);
	await assert.rejects(activity.start(seen.chat!, {target: 'main', activity: true}), /only be shown in the console panel/);
	assert.equal(activity.state.control, undefined);
	h.unmount();
});

const say: Command = {name: 'say', description: 'say', agent: 'safe', run: (_a, ctx) => ctx.print('said-it')};

test('a print-only agent command opens the console without moving the focus, then closes it after the grace', async () => {
	const {h, seen, bridge} = boot({columns: 100, rows: 30}, [say]);
	await h.settle(80);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	const r = await bridge().run({line: 'say', caller: 'tester'});
	assert.equal(r.status, 'ok');
	await h.settle(80);
	assert.match(h.lastFrame(), /Console/);
	assert.match(h.lastFrame(), /said-it/);
	assert.equal(seen.chatControl!.host!.isFocused(), true);
	await pastGrace(h);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('a console toggled during the grace stays open', async () => {
	const {h, type, bridge} = boot({columns: 100, rows: 30}, [say]);
	await h.settle(80);
	await bridge().run({line: 'say', caller: 'tester'});
	await h.settle(80);
	await type(TOGGLE);
	await type(TOGGLE);
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	h.unmount();
});

test('a console the user touched during the run stays open', async () => {
	const probe: Probe = {builds: 0};
	const {h, type, bridge} = boot({columns: 100, rows: 30}, [peek('peek', probe)]);
	await h.settle(80);
	const run = bridge().run({line: 'peek', caller: 'tester'});
	await h.settle(80);
	await type(TOGGLE);
	await type(TOGGLE);
	probe.control!.close();
	await run;
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	h.unmount();
});

test('a key pressed in the focused narrow console during the grace keeps it open', async () => {
	const {h, type, bridge} = boot({columns: 50, rows: 30}, [say]);
	await h.settle(80);
	await bridge().run({line: 'say', caller: 'tester'});
	await h.settle(80);
	assert.match(h.lastFrame(), /said-it/);
	await type('x');
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	h.unmount();
});

test('a second run inside the grace cancels the close and the grace restarts after it', async () => {
	const {h, bridge} = boot({columns: 100, rows: 30}, [say]);
	await h.settle(80);
	await bridge().run({line: 'say', caller: 'tester'});
	await h.settle(GRACE - 150);
	await bridge().run({line: 'say', caller: 'tester'});
	await h.settle(GRACE - 100);
	assert.match(h.lastFrame(), /Console/);
	await pastGrace(h);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('a console that was already open before the run is never closed by the grace', async () => {
	const {h, type, bridge} = boot({columns: 100, rows: 30}, [say]);
	await h.settle(80);
	await type(TOGGLE);
	await bridge().run({line: 'say', caller: 'tester'});
	await pastGrace(h);
	assert.match(h.lastFrame(), /Console/);
	h.unmount();
});
