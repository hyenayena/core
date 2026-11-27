import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrameClock, type ClockTimers} from '../../src/kit/text.js';

function fake() {
	const state = {started: 0, cleared: 0, unref: 0, fire: () => {}, now: 1000};
	const timers: ClockTimers = {
		setInterval: fn => {
			state.started++;
			state.fire = fn;
			return {unref: () => void state.unref++};
		},
		clearInterval: () => void state.cleared++,
	};
	return {state, timers, now: () => state.now};
}

test('no timer before the first subscriber, one unref-ed timer for many', () => {
	const f = fake();
	const clock = createFrameClock({intervalMs: 50, timers: f.timers, now: f.now});
	assert.equal(f.state.started, 0);
	const offs = [clock.subscribe(() => {}), clock.subscribe(() => {})];
	assert.equal(f.state.started, 1);
	assert.equal(f.state.unref, 1);
	for (const off of offs) off();
});

test('the last unsubscribe clears the timer and a new subscriber restarts it', () => {
	const f = fake();
	const clock = createFrameClock({timers: f.timers, now: f.now});
	const a = clock.subscribe(() => {});
	a();
	a();
	assert.equal(f.state.cleared, 1);
	const b = clock.subscribe(() => {});
	assert.equal(f.state.started, 2);
	b();
});

test('schedule runs once on the first due tick and keeps the timer while pending', () => {
	const f = fake();
	const clock = createFrameClock({timers: f.timers, now: f.now});
	let ran = 0;
	clock.schedule(() => void ran++, 100);
	assert.equal(f.state.started, 1);
	f.state.now += 50;
	f.state.fire();
	assert.equal(ran, 0);
	assert.equal(f.state.cleared, 0);
	f.state.now += 60;
	f.state.fire();
	assert.equal(ran, 1);
	assert.equal(f.state.cleared, 1);
	f.state.fire();
	assert.equal(ran, 1);
});

test('cancelling the last task stops the timer', () => {
	const f = fake();
	const clock = createFrameClock({timers: f.timers, now: f.now});
	const cancel = clock.schedule(() => assert.fail('cancelled'));
	cancel();
	cancel();
	assert.equal(f.state.cleared, 1);
});

test('a tick runs onTick, then tasks, then listeners; time is stable between ticks', () => {
	const f = fake();
	const order: string[] = [];
	const clock = createFrameClock({timers: f.timers, now: f.now, onTick: () => order.push('tick')});
	clock.subscribe(() => order.push('listener'));
	clock.schedule(() => order.push('task'));
	f.state.now = 1200;
	assert.equal(clock.time(), 1000);
	f.state.fire();
	assert.deepEqual(order, ['tick', 'task', 'listener']);
	assert.equal(clock.time(), 1200);
	assert.equal(clock.tick(), 1);
});

test('a throwing listener or task does not stop the others', () => {
	const f = fake();
	const clock = createFrameClock({timers: f.timers, now: f.now});
	let seen = 0;
	clock.schedule(() => {
		throw new Error('x');
	});
	clock.schedule(() => void seen++);
	clock.subscribe(() => {
		throw new Error('y');
	});
	clock.subscribe(() => void seen++);
	f.state.fire();
	assert.equal(seen, 2);
});

test('a 120 ms divisor on a 50 ms clock steps 0 or 1 per tick and averages 120 ms', () => {
	const f = fake();
	const clock = createFrameClock({timers: f.timers, now: f.now});
	clock.subscribe(() => {});
	const start = f.state.now;
	let last = Math.floor(clock.time() / 120);
	let steps = 0;
	for (let i = 0; i < 240; i++) {
		f.state.now += 50;
		f.state.fire();
		const n = Math.floor(clock.time() / 120);
		assert.ok(n - last === 0 || n - last === 1);
		steps += n - last;
		last = n;
	}
	assert.ok(Math.abs((f.state.now - start) / steps - 120) < 5);
});
