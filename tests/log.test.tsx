import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text} from 'ink';
import App from '../src/app.js';
import {createRegistry} from '../src/commands.js';
import {fakeLogger, mountHarness} from './testkit.js';
import type {Command} from '../../../src/api.js';

const SECRET = 'sk-ant-oat-TESTVALUE0123456789abcdef';

function Bomb(): never {
	throw new Error('boom');
}

function setup() {
	const {log, records} = fakeLogger();
	const commands: Command[] = [
		{
			name: 'fail',
			description: 'throws',
			run: () => {
				throw new Error('nope');
			},
		},
		{
			name: 'view',
			description: 'mounts',
			run: (_a, ctx) => void ctx.mount!(() => <Text>V</Text>),
		},
		{
			name: 'bomb',
			description: 'render throws',
			run: (_a, ctx) => ctx.mount!(() => <Bomb />).catch(() => {}),
		},
	];
	const h = mountHarness(<App registry={createRegistry(commands)} log={log} />);
	const run = async (line: string) => {
		h.press(line);
		await h.settle();
		h.press('\r');
		await h.settle();
	};
	return {h, run, records};
}

test('a throwing command is logged at warn without its args', async () => {
	const {h, run, records} = setup();
	await h.settle();
	await run(`fail ${SECRET}`);
	const rec = records.find(r => r.msg === 'command failed');
	assert.equal(rec?.level, 'warn');
	assert.equal(rec?.fields?.command, 'fail');
	assert.doesNotMatch(JSON.stringify(records, (_k, v) => (v instanceof Error ? v.message : v)), /sk-ant/);
	assert.match(h.lastFrame(), /Error: nope/);
	h.unmount();
});

test('an unknown command never logs the typed token', async () => {
	const {h, run, records} = setup();
	await h.settle();
	await run(SECRET);
	assert.doesNotMatch(JSON.stringify(records), /sk-ant/);
	assert.match(h.lastFrame(), /Unknown command/);
	h.unmount();
});

test('mounting and closing a view logs numeric ids at debug', async () => {
	const {h, run, records} = setup();
	await h.settle();
	await run('view');
	h.unmount();
	const mounted = records.find(r => r.msg === 'view mounted');
	assert.equal(mounted?.level, 'debug');
	assert.equal(typeof mounted?.fields?.id, 'number');
});

test('a view that throws while rendering logs at warn', async () => {
	const {h, run, records} = setup();
	await h.settle();
	await run('bomb');
	const rec = records.find(r => r.msg === 'view failed');
	assert.equal(rec?.level, 'warn');
	assert.equal(typeof rec?.fields?.id, 'number');
	h.unmount();
});
