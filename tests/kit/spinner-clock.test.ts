import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSpinnerClock, type SpinnerTimers} from '../../src/kit/spinner-clock.js';

function fakeTimers() {
	const state = {started: 0, cleared: 0, fire: () => {}};
	const timers: SpinnerTimers = {
		setInterval: fn => {
			state.started++;
			state.fire = fn;
			return {};
		},
		clearInterval: () => {
			state.cleared++;
		},
	};
	return {state, timers};
}

test('no timer before the first subscriber, one timer for many', () => {
	const {state, timers} = fakeTimers();
	const clock = createSpinnerClock(120, timers);
	assert.equal(state.started, 0);
	const offs = [clock.subscribe(() => {}), clock.subscribe(() => {}), clock.subscribe(() => {})];
	assert.equal(state.started, 1);
	assert.equal(clock.size(), 3);
	for (const off of offs) off();
});

test('one fire advances the tick once and calls every listener once', () => {
	const {state, timers} = fakeTimers();
	const clock = createSpinnerClock(120, timers);
	const calls = [0, 0];
	const offs = [clock.subscribe(() => calls[0]!++), clock.subscribe(() => calls[1]!++)];
	state.fire();
	assert.equal(clock.tick(), 1);
	assert.deepEqual(calls, [1, 1]);
	for (const off of offs) off();
});

test('the last unsubscribe clears the timer, a second unsubscribe is harmless, a new subscribe restarts', () => {
	const {state, timers} = fakeTimers();
	const clock = createSpinnerClock(120, timers);
	const a = clock.subscribe(() => {});
	const b = clock.subscribe(() => {});
	a();
	assert.equal(state.cleared, 0);
	b();
	assert.equal(state.cleared, 1);
	assert.equal(clock.size(), 0);
	a();
	b();
	assert.equal(state.cleared, 1);
	state.fire();
	const c = clock.subscribe(() => {});
	assert.equal(state.started, 2);
	assert.equal(clock.tick(), 1);
	c();
});

test('a listener added during a tick is not called in that tick', () => {
	const {state, timers} = fakeTimers();
	const clock = createSpinnerClock(120, timers);
	let late = 0;
	let off2: () => void = () => {};
	const off1 = clock.subscribe(() => {
		off2 = clock.subscribe(() => late++);
	});
	state.fire();
	assert.equal(late, 0);
	assert.equal(clock.size(), 2);
	off1();
	off2();
});

test('unsubscribing inside a listener is safe and the last one clears the timer', () => {
	const {state, timers} = fakeTimers();
	const clock = createSpinnerClock(120, timers);
	let calls = 0;
	const off = clock.subscribe(() => {
		calls++;
		off();
	});
	state.fire();
	assert.equal(calls, 1);
	assert.equal(clock.size(), 0);
	assert.equal(state.cleared, 1);
});

test('the tick never goes back across a stop and restart', () => {
	const {state, timers} = fakeTimers();
	const clock = createSpinnerClock(120, timers);
	const a = clock.subscribe(() => {});
	state.fire();
	state.fire();
	a();
	const b = clock.subscribe(() => {});
	assert.equal(clock.tick(), 2);
	state.fire();
	assert.equal(clock.tick(), 3);
	b();
});

test('subscribing the same function twice counts twice and each unsubscribe is independent', () => {
	const {timers} = fakeTimers();
	const clock = createSpinnerClock(120, timers);
	const fn = (): void => {};
	const a = clock.subscribe(fn);
	const b = clock.subscribe(fn);
	assert.equal(clock.size(), 2);
	a();
	assert.equal(clock.size(), 1);
	b();
});
