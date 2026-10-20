import test from 'node:test';
import assert from 'node:assert/strict';
import {createMouseTerminal, MOUSE_DISABLE, MOUSE_ENABLE} from '../../src/mouse/terminal.js';
import type {MouseInputEvent} from '../../src/mouse/sgr.js';

const ESC = String.fromCharCode(27);

function fakeProxy() {
	const enabled: boolean[] = [];
	const listeners: Array<(e: MouseInputEvent) => void> = [];
	return {
		enabled,
		listeners,
		onMouse(listener: (e: MouseInputEvent) => void) {
			listeners.push(listener);
			return () => void listeners.splice(listeners.indexOf(listener), 1);
		},
		setEnabled: (on: boolean) => void enabled.push(on),
	};
}

function fakeStdout(isTTY = true) {
	const writes: string[] = [];
	return {writes, stdout: {isTTY, write: (s: string) => void writes.push(s)}};
}

test('the mode strings enable and disable click and SGR reporting only', () => {
	assert.equal(MOUSE_ENABLE, `${ESC}[?1000h${ESC}[?1006h`);
	assert.equal(MOUSE_DISABLE, `${ESC}[?1006l${ESC}[?1000l`);
});

test('setWanted is idempotent and forwards the state to the proxy', () => {
	const {writes, stdout} = fakeStdout();
	const proxy = fakeProxy();
	const mouse = createMouseTerminal(stdout, proxy);
	assert.deepEqual(writes, []);
	mouse.setWanted(false);
	mouse.setWanted(true);
	mouse.setWanted(true);
	mouse.setWanted(false);
	mouse.setWanted(false);
	assert.deepEqual(writes, [MOUSE_ENABLE, MOUSE_DISABLE]);
	assert.deepEqual(proxy.enabled, [false, true, true, false, false]);
});

test('nothing is written without a TTY or without a proxy', () => {
	const plain = fakeStdout(false);
	const proxy = fakeProxy();
	const a = createMouseTerminal(plain.stdout, proxy);
	a.setWanted(true);
	a.pause();
	a.resume();
	a.shutdown();
	assert.deepEqual(plain.writes, []);
	assert.deepEqual(proxy.enabled, [true]);
	const tty = fakeStdout();
	const b = createMouseTerminal(tty.stdout);
	b.setWanted(true);
	b.shutdown();
	assert.deepEqual(tty.writes, []);
	assert.equal(typeof b.onMouse(() => {}), 'function');
});

test('pause and resume switch reporting off and back on only while wanted', () => {
	const {writes, stdout} = fakeStdout();
	const mouse = createMouseTerminal(stdout, fakeProxy());
	mouse.pause();
	mouse.resume();
	assert.deepEqual(writes, []);
	mouse.setWanted(true);
	mouse.pause();
	mouse.pause();
	mouse.resume();
	mouse.resume();
	assert.deepEqual(writes, [MOUSE_ENABLE, MOUSE_DISABLE, MOUSE_ENABLE]);
	mouse.pause();
	mouse.setWanted(true);
	assert.equal(writes.length, 4);
	mouse.resume();
	assert.deepEqual(writes.slice(4), [MOUSE_ENABLE]);
});

test('shutdown disables an active terminal once and nothing re-enables it', () => {
	const {writes, stdout} = fakeStdout();
	const mouse = createMouseTerminal(stdout, fakeProxy());
	mouse.setWanted(true);
	mouse.shutdown();
	mouse.shutdown();
	mouse.resume();
	mouse.setWanted(true);
	assert.deepEqual(writes, [MOUSE_ENABLE, MOUSE_DISABLE]);
	const idle = fakeStdout();
	const off = createMouseTerminal(idle.stdout, fakeProxy());
	off.shutdown();
	assert.deepEqual(idle.writes, []);
	const paused = fakeStdout();
	const p = createMouseTerminal(paused.stdout, fakeProxy());
	p.setWanted(true);
	p.pause();
	p.shutdown();
	assert.deepEqual(paused.writes, [MOUSE_ENABLE, MOUSE_DISABLE]);
});

test('a throwing write is swallowed and the state still advances', () => {
	let calls = 0;
	const stdout = {
		isTTY: true,
		write() {
			calls++;
			throw new Error('EPIPE');
		},
	};
	const mouse = createMouseTerminal(stdout, fakeProxy());
	assert.doesNotThrow(() => mouse.setWanted(true));
	assert.doesNotThrow(() => mouse.pause());
	assert.doesNotThrow(() => mouse.shutdown());
	assert.equal(calls, 2);
});

test('onMouse subscribes through the proxy', () => {
	const proxy = fakeProxy();
	const mouse = createMouseTerminal(fakeStdout().stdout, proxy);
	const off = mouse.onMouse(() => {});
	assert.equal(proxy.listeners.length, 1);
	off();
	assert.equal(proxy.listeners.length, 0);
});
