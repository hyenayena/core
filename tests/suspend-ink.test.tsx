import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text, useApp, useInput} from 'ink';
import {runSuspended} from '../src/view/suspend.js';
import {createInputProxy} from '../src/mouse/input.js';
import {createFakeTty, mountHarness, wait, type FakeTty} from './testkit.js';

type Suspend = (callback: () => Promise<void>) => Promise<void>;

function setup(tty: FakeTty = createFakeTty()) {
	const proxy = createInputProxy(tty, {size: () => ({columns: 80, rows: 24})});
	const keys: string[] = [];
	const hooks: {suspend?: Suspend} = {};
	function Probe() {
		const {suspendTerminal} = useApp();
		hooks.suspend = suspendTerminal;
		useInput(input => void keys.push(input));
		return <Text>FRAME-MARK</Text>;
	}
	const harness = mountHarness(<Probe />, undefined, {tty, stdin: proxy.stream});
	const calls: string[] = [];
	const mouse = {pause: () => void calls.push('pause'), resume: () => void calls.push('resume')};
	const run = <T,>(fn: () => T | Promise<T>) => runSuspended(hooks.suspend!, fn, {mouse, input: proxy});
	return {tty, proxy, keys, harness, calls, run, hooks};
}

test('the child gets the terminal: raw mode off, no reader on the proxy; afterwards Ink takes it back and redraws', async () => {
	const {tty, proxy, keys, harness, calls, run} = setup();
	await harness.settle();
	assert.equal(tty.raw.at(-1), true);
	assert.ok(proxy.stream.listenerCount('readable') > 0);

	let rawDuring: boolean | undefined;
	let readersDuring = -1;
	let sourceReadersDuring = -1;
	let framesBefore = 0;
	const value = await run(async () => {
		rawDuring = tty.raw.at(-1);
		readersDuring = proxy.stream.listenerCount('readable');
		sourceReadersDuring = tty.listenerCount('readable');
		framesBefore = harness.frameCount();
		return 42;
	});
	await harness.settle();

	assert.equal(value, 42);
	assert.equal(rawDuring, false);
	assert.equal(readersDuring, 0);
	assert.equal(sourceReadersDuring, 0);
	assert.deepEqual(calls, ['pause', 'resume']);
	assert.equal(tty.raw.at(-1), true);
	assert.ok(harness.frameCount() > framesBefore);
	assert.ok(harness.lastFrame().includes('FRAME-MARK'));

	harness.press('x');
	await harness.settle();
	assert.deepEqual(keys, ['x']);
	harness.unmount();
});

test('an EIO from setRawMode(true) on resume still lets Ink redraw, then runSuspended rejects with it', async () => {
	const tty = createFakeTty();
	const {proxy, keys, harness, calls, run} = setup(tty);
	await harness.settle();

	const eio = Object.assign(new Error('EIO'), {code: 'EIO'});
	const original = tty.setRawMode.bind(tty);
	let framesBefore = 0;
	await assert.rejects(
		run(async () => {
			framesBefore = harness.frameCount();
			tty.setRawMode = (value: boolean) => {
				if (value) throw eio;
				return original(value);
			};
		}),
		(error: unknown) => error === eio,
	);
	tty.setRawMode = original;
	await harness.settle();

	assert.deepEqual(calls, ['pause', 'resume']);
	assert.ok(harness.frameCount() > framesBefore);
	assert.ok(harness.lastFrame().includes('FRAME-MARK'));
	assert.ok(proxy.stream.listenerCount('readable') > 0);
	harness.press('y');
	await harness.settle();
	assert.deepEqual(keys, ['y']);
	harness.unmount();
});

test('a raw-mode failure outside a suspension is not swallowed by the proxy', async () => {
	const tty = createFakeTty();
	const proxy = createInputProxy(tty);
	tty.setRawMode = () => {
		throw new Error('EIO');
	};
	assert.throws(() => proxy.stream.setRawMode(true), /EIO/);
	const release = proxy.holdRawModeErrors();
	proxy.stream.setRawMode(true);
	assert.match(String(release()), /EIO/);
	await wait(0);
});

test('a nested suspend rejects without touching the mouse and leaves the outer one intact', async () => {
	const {tty, proxy, harness, calls, run, hooks} = setup();
	await harness.settle();
	const inner: string[] = [];
	const innerMouse = {pause: () => void inner.push('pause'), resume: () => void inner.push('resume')};
	let nested: unknown;
	let childRan = false;
	await run(async () => {
		try {
			await runSuspended(hooks.suspend!, () => void (childRan = true), {mouse: innerMouse, input: proxy});
		} catch (error) {
			nested = error;
		}
	});
	assert.match((nested as Error).message, /already suspended/);
	assert.equal(childRan, false);
	assert.deepEqual(inner, []);
	assert.deepEqual(calls, ['pause', 'resume']);
	await harness.settle();
	assert.equal(tty.raw.at(-1), true);
	harness.unmount();
});
