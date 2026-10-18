import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useState} from 'react';
import {Text, useInput} from 'ink';
import App from '../src/app.js';
import {createRegistry} from '../src/commands.js';
import {mountHarness} from './testkit.js';
import type {Command, CommandContext, MountControl} from '../../../src/api.js';

function Probe({control}: {control: MountControl}) {
	const [typed, setTyped] = useState('');
	useInput((input, key) => {
		if (key.escape) control.close();
		else if (key.ctrl && input === 'c') setTyped(t => t + '<C-c>');
		else setTyped(t => t + input);
	});
	return <Text>VIEW[{typed}]</Text>;
}

function Bomb(): never {
	throw new Error('boom');
}

type Setup = {ctx?: CommandContext; result?: Promise<void>; state: string};

function setup() {
	const s: Setup = {state: 'idle'};
	const track = (p: Promise<void>) => {
		s.state = 'pending';
		s.result = p.then(
			() => void (s.state = 'resolved'),
			(e: Error) => void (s.state = `rejected:${e.message}`),
		);
	};
	const commands: Command[] = [
		{
			name: 'view',
			description: 'mount a view',
			run: (_a, ctx) => {
				s.ctx = ctx;
				track(ctx.mount!(control => <Probe control={control} />));
			},
		},
		{
			name: 'twice',
			description: 'mount while mounted',
			run: (_a, ctx) => ctx.mount!(() => <Text>second</Text>),
		},
		{
			name: 'throwing',
			description: 'build throws',
			run: (_a, ctx) => ctx.mount!(() => {
				throw new Error('build failed');
			}),
		},
		{
			name: 'bomb',
			description: 'render throws',
			run: (_a, ctx) => ctx.mount!(() => <Bomb />),
		},
		{
			name: 'await',
			description: 'awaits the view',
			run: async (_a, ctx) => {
				await ctx.mount!(control => <Probe control={control} />);
				ctx.print('after-mount');
			},
		},
	];
	const h = mountHarness(<App registry={createRegistry(commands)} />);
	const run = async (line: string) => {
		h.press(line);
		await h.settle();
		h.press('\r');
		await h.settle();
	};
	return {h, s, run};
}

test('mount replaces the prompt with the element', async () => {
	const {h, run} = setup();
	await h.settle();
	await run('view');
	assert.match(h.lastFrame(), /VIEW\[\]/);
	assert.doesNotMatch(h.lastFrame(), /^> $/m);
	h.unmount();
});

test('typing is not echoed by the prompt while mounted and is again after close', async () => {
	const {h, run} = setup();
	await h.settle();
	await run('view');
	h.press('abc');
	await h.settle();
	assert.doesNotMatch(h.lastFrame(), /^> abc/m);
	h.press('\x1b');
	await h.settle(60);
	h.press('abc');
	await h.settle();
	assert.match(h.lastFrame(), /^> abc/m);
	h.unmount();
});

test('only the mounted element receives typed input', async () => {
	const {h, run} = setup();
	await h.settle();
	await run('view');
	h.press('x');
	await h.settle();
	assert.match(h.lastFrame(), /VIEW\[x\]/);
	h.unmount();
});

test('close restores the prompt, history intact, and the promise resolves', async () => {
	const {h, s, run} = setup();
	await h.settle();
	await run('view');
	h.press('\x1b');
	await h.settle(60);
	assert.equal(s.state, 'resolved');
	assert.doesNotMatch(h.lastFrame(), /VIEW/);
	h.press('\x1b[A');
	await h.settle();
	assert.match(h.lastFrame(), /view/);
	h.unmount();
});

test('awaiting mount continues after close', async () => {
	const {h, run} = setup();
	await h.settle();
	await run('await');
	h.press('\x1b');
	await h.settle(60);
	assert.match(h.lastFrame(), /after-mount/);
	h.unmount();
});

test('a second mount rejects and the first view stays', async () => {
	const {h, s, run} = setup();
	await h.settle();
	await run('view');
	s.ctx!.print('x');
	await s.ctx!.mount!(() => <Text>second</Text>).then(
		() => assert.fail('should reject'),
		(e: Error) => assert.equal(e.message, 'A view is already mounted'),
	);
	assert.match(h.lastFrame(), /VIEW\[\]/);
	h.unmount();
});

test('build throwing rejects and the prompt stays', async () => {
	const {h, run} = setup();
	await h.settle();
	await run('throwing');
	assert.match(h.lastFrame(), /Error: build failed/);
	h.unmount();
});

test('a render error is caught, reported, and the prompt is restored', async () => {
	const {h, run} = setup();
	await h.settle();
	await run('bomb');
	await h.settle(60);
	assert.match(h.lastFrame(), /Error: boom/);
	h.press('e');
	await h.settle();
	assert.match(h.lastFrame(), /e/);
	h.unmount();
});

test('unmount while mounted resolves the pending promise', async () => {
	const {h, s, run} = setup();
	await h.settle();
	await run('view');
	h.unmount();
	await h.settle();
	assert.equal(s.state, 'resolved');
});

test('Ctrl+C at the prompt exits the app', async () => {
	const {h} = setup();
	await h.settle();
	h.press('\x03');
	await Promise.race([
		h.waitUntilExit(),
		h.settle(500).then(() => assert.fail('app did not exit')),
	]);
});

test('Ctrl+C while mounted reaches the element and does not exit', async () => {
	const {h, run} = setup();
	await h.settle();
	await run('view');
	h.press('\x03');
	await h.settle();
	assert.match(h.lastFrame(), /VIEW\[<C-c>\]/);
	h.unmount();
});

test('print while mounted reaches the scrollback', async () => {
	const {h, s, run} = setup();
	await h.settle();
	await run('view');
	s.ctx!.print('scrollback-line');
	await h.settle();
	assert.match(h.lastFrame(), /scrollback-line/);
	assert.match(h.lastFrame(), /VIEW\[\]/);
	h.unmount();
});

test('raw mode is released after unmount', async () => {
	const {h} = setup();
	await h.settle();
	h.unmount();
	await h.settle();
	assert.equal(h.raw.at(-1), false);
});
