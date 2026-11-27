import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {MOTION_ENV, motionFixedBy, motionFromEnv, reducedMotion, setMotionPref, subscribeMotion, withReducedMotion} from '../../src/kit/text.js';
import {resetMotionForTests} from '../../src/kit/motion.js';

const saved = process.env[MOTION_ENV];
afterEach(() => {
	if (saved === undefined) delete process.env[MOTION_ENV];
	else process.env[MOTION_ENV] = saved;
	resetMotionForTests();
});

test('motionFromEnv reads off/reduced and on/full, trimmed and case-insensitive, and ignores the rest', () => {
	assert.equal(motionFromEnv({YENA_MOTION: ' OFF '}), 'reduced');
	assert.equal(motionFromEnv({YENA_MOTION: 'reduced'}), 'reduced');
	assert.equal(motionFromEnv({YENA_MOTION: 'On'}), 'full');
	assert.equal(motionFromEnv({YENA_MOTION: 'full'}), 'full');
	assert.equal(motionFromEnv({YENA_MOTION: 'maybe'}), undefined);
	assert.equal(motionFromEnv({}), undefined);
});

test('the env decides over the pref and is reported by motionFixedBy', () => {
	delete process.env[MOTION_ENV];
	resetMotionForTests();
	assert.equal(motionFixedBy(), undefined);
	setMotionPref(true);
	assert.equal(reducedMotion(), true);
	process.env[MOTION_ENV] = 'on';
	resetMotionForTests();
	setMotionPref(true);
	assert.equal(motionFixedBy(), 'YENA_MOTION');
	assert.equal(reducedMotion(), false);
});

test('subscribers are notified only when the effective value changes', () => {
	delete process.env[MOTION_ENV];
	resetMotionForTests();
	let n = 0;
	subscribeMotion(() => void n++);
	setMotionPref(false);
	assert.equal(n, 0);
	setMotionPref(true);
	setMotionPref(true);
	assert.equal(n, 1);
	setMotionPref(false);
	assert.equal(n, 2);
});

test('an env value silences pref changes', () => {
	process.env[MOTION_ENV] = 'off';
	resetMotionForTests();
	let n = 0;
	subscribeMotion(() => void n++);
	setMotionPref(true);
	setMotionPref(false);
	assert.equal(n, 0);
	assert.equal(reducedMotion(), true);
});

test('withReducedMotion nests and restores', () => {
	delete process.env[MOTION_ENV];
	resetMotionForTests();
	withReducedMotion(true, () => {
		assert.equal(reducedMotion(), true);
		withReducedMotion(false, () => assert.equal(reducedMotion(), false));
		assert.equal(reducedMotion(), true);
	});
	assert.equal(reducedMotion(), false);
});
