import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputProxy, type ProxyTimers} from '../../src/mouse/input.js';
import type {MouseInputEvent} from '../../src/mouse/sgr.js';
import {createFakeTty} from '../testkit.js';

const ESC = String.fromCharCode(27);
const sgr = (code: number, x: number, y: number, final = 'M') => `${ESC}[<${code};${x};${y}${final}`;

function fakeTimers() {
	let now = 0;
	let unrefs = 0;
	const queue: Array<{at: number; fn: () => void; handle: {unref(): void}}> = [];
	const timers: ProxyTimers = {
		setTimeout(fn, ms) {
			const handle = {unref: () => void unrefs++};
			queue.push({at: now + ms, fn, handle});
			return handle;
		},
		clearTimeout(handle) {
			const i = queue.findIndex(t => t.handle === handle);
			if (i >= 0) queue.splice(i, 1);
		},
	};
	const advance = (ms: number) => {
		now += ms;
		for (;;) {
			const i = queue.findIndex(t => t.at <= now);
			if (i < 0) break;
			const [t] = queue.splice(i, 1);
			t!.fn();
		}
	};
	return {timers, advance, pending: () => queue.length, unrefs: () => unrefs};
}

function setup(enabled = false) {
	const tty = createFakeTty();
	const clock = fakeTimers();
	const proxy = createInputProxy(tty, {timers: clock.timers, size: () => ({columns: 80, rows: 24})});
	proxy.setEnabled(enabled);
	const received: string[] = [];
	const reader = () => {
		let chunk: string | null;
		while ((chunk = proxy.stream.read() as string | null) !== null) received.push(chunk);
	};
	proxy.stream.on('readable', reader);
	const events: MouseInputEvent[] = [];
	proxy.onMouse(e => events.push(e));
	const send = async (s: string) => {
		tty.write(s);
		await new Promise(resolve => setImmediate(resolve));
	};
	const text = async () => {
		await new Promise(resolve => setImmediate(resolve));
		return received.join('');
	};
	return {tty, proxy, clock, received, reader, events, send, text};
}

test('with mouse off input passes through byte for byte, SGR reports are dropped', async () => {
	const s = setup(false);
	const input = `hello 😀 ${ESC}[A${ESC}[1;5C${ESC}${ESC}b${ESC}[M !"${ESC}[200~${sgr(0, 1, 1)}${ESC}[201~`;
	await s.send(input);
	await s.send(`${ESC}`);
	await s.send(`${ESC}[`);
	await s.send(`x${sgr(0, 3, 3)}y`);
	assert.equal(await s.text(), `${input}${ESC}${ESC}[xy`);
	assert.equal(s.events.length, 0);
	assert.equal(s.clock.pending(), 0);
});

test('with mouse on reports are dispatched as events and removed from the text', async () => {
	const s = setup(true);
	await s.send(`a${sgr(0, 10, 3)}b${sgr(65, 1, 1)}${sgr(0, 99, 1)}`);
	assert.equal(await s.text(), 'ab');
	assert.deepEqual(s.events.map(e => [e.kind, e.button, e.wheel, e.x, e.y]), [
		['press', 'left', undefined, 9, 2],
		['wheel', 'none', 'down', 0, 0],
	]);
});

test('a held ESC is released after 10 ms, a following chunk cancels the hold', async () => {
	const s = setup(true);
	await s.send(`a${ESC}`);
	assert.equal(await s.text(), 'a');
	s.clock.advance(9);
	assert.equal(await s.text(), 'a');
	s.clock.advance(1);
	assert.equal(await s.text(), `a${ESC}`);
	assert.ok(s.clock.unrefs() >= 1);
	await s.send(`${ESC}[`);
	await s.send('A');
	assert.equal(await s.text(), `a${ESC}${ESC}[A`);
	assert.equal(s.clock.pending(), 0);
});

test('a split report is joined during the hold and dropped after 50 ms', async () => {
	const s = setup(true);
	await s.send(`${ESC}[<0;5`);
	s.clock.advance(49);
	await s.send(';6M');
	assert.equal(s.events.length, 1);
	assert.equal(await s.text(), '');
	await s.send(`${ESC}[<0;5`);
	s.clock.advance(50);
	assert.equal(s.clock.pending(), 0);
	await s.send(';6Mz');
	assert.equal(await s.text(), ';6Mz');
	assert.equal(s.events.length, 1);
});

test('X10 reports are consumed only while enabled', async () => {
	const s = setup(true);
	await s.send(`${ESC}[M !"`);
	assert.equal(s.events.length, 1);
	assert.equal(await s.text(), '');
	s.proxy.setEnabled(false);
	await s.send(`${ESC}[M !"`);
	assert.equal(await s.text(), `${ESC}[M !"`);
	assert.equal(s.events.length, 1);
});

test('setRawMode, isRaw, ref, unref and setEncoding are forwarded', () => {
	let refs = 0;
	let unrefs = 0;
	const tty = Object.assign(createFakeTty(), {isRaw: false});
	tty.setRawMode = function (value: boolean) {
		this.raw.push(value);
		this.isRaw = value;
		return this;
	};
	tty.ref = () => void refs++;
	tty.unref = () => void unrefs++;
	const proxy = createInputProxy(tty);
	assert.equal(proxy.stream.isTTY, true);
	assert.equal(proxy.stream.setRawMode(true), proxy.stream);
	assert.equal(proxy.stream.isRaw, true);
	proxy.stream.setRawMode(false);
	assert.equal(proxy.stream.isRaw, false);
	assert.deepEqual(tty.raw, [true, false]);
	assert.equal(proxy.stream.ref(), proxy.stream);
	proxy.stream.unref();
	assert.deepEqual([refs, unrefs], [1, 1]);
	assert.equal(proxy.stream.setEncoding('utf8'), proxy.stream);
	assert.throws(() => proxy.stream.setEncoding('latin1'), /Unsupported input encoding/);
});

test('the source is read only while the proxy has a readable listener', async () => {
	const s = setup(false);
	assert.equal(s.tty.listenerCount('readable'), 1);
	s.proxy.stream.removeListener('readable', s.reader);
	assert.equal(s.tty.listenerCount('readable'), 0);
	await s.send('kept');
	assert.equal(s.tty.readableLength, 4);
	assert.equal(await s.text(), '');
	s.proxy.stream.on('readable', s.reader);
	assert.equal(s.tty.listenerCount('readable'), 1);
	assert.equal(await s.text(), 'kept');
	const second = () => {};
	s.proxy.stream.on('readable', second);
	s.proxy.stream.removeListener('readable', second);
	assert.equal(s.tty.listenerCount('readable'), 1);
});

test('a throwing listener does not break input or other listeners', async () => {
	const s = setup(true);
	const off = s.proxy.onMouse(() => {
		throw new Error('boom');
	});
	const later: MouseInputEvent[] = [];
	s.proxy.onMouse(e => later.push(e));
	await s.send(`a${sgr(0, 1, 1)}b`);
	assert.equal(await s.text(), 'ab');
	assert.equal(s.events.length, 1);
	assert.equal(later.length, 1);
	off();
	await s.send(sgr(0, 1, 1));
	assert.equal(later.length, 2);
});

test('a throwing size callback drops the events but keeps the text', async () => {
	const tty = createFakeTty();
	const proxy = createInputProxy(tty, {
		size: () => {
			throw new Error('no size');
		},
	});
	proxy.setEnabled(true);
	const events: MouseInputEvent[] = [];
	proxy.onMouse(e => events.push(e));
	const received: string[] = [];
	proxy.stream.on('readable', () => {
		let chunk: string | null;
		while ((chunk = proxy.stream.read() as string | null) !== null) received.push(chunk);
	});
	tty.write(`a${sgr(0, 1, 1)}b`);
	await new Promise(resolve => setImmediate(resolve));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(received.join(''), 'ab');
	assert.equal(events.length, 0);
});

test('a trailing ESC[ is held 50 ms while mouse is on, so a slow split report is still joined', async () => {
	const s = setup(true);
	await s.send(`a${ESC}[`);
	s.clock.advance(20);
	assert.equal(await s.text(), 'a');
	await s.send('<0;4;5M');
	assert.equal(await s.text(), 'a');
	assert.deepEqual(s.events.map(e => [e.x, e.y]), [[3, 4]]);
	await s.send(`${ESC}[`);
	s.clock.advance(49);
	assert.equal(await s.text(), 'a');
	s.clock.advance(1);
	assert.equal(await s.text(), `a${ESC}[`);
});

test('a malformed report never reaches the text, also when split', async () => {
	const s = setup(true);
	await s.send(`x${ESC}[<12345;1`);
	await s.send(';1My');
	await s.send(`${ESC}[<0:1:1Mz`);
	assert.equal(await s.text(), 'xyz');
	assert.equal(s.events.length, 0);
	const off = setup(false);
	await off.send(`x${ESC}[<0;1;12345My`);
	assert.equal(await off.text(), 'xy');
});
