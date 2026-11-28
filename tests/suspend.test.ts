import test from 'node:test';
import assert from 'node:assert/strict';
import {runSuspended} from '../src/view/suspend.js';

type Faults = {begin?: Error; end?: Error; resume?: Error; held?: Error};

const rig = (faults: Faults = {}) => {
	const order: string[] = [];
	const inkSuspend = async (callback: () => Promise<void>) => {
		if (faults.begin) throw faults.begin;
		order.push('ink begin');
		try {
			await callback();
		} finally {
			order.push('ink end');
		}
		if (faults.end) throw faults.end;
	};
	const mouse = {
		pause: () => void order.push('pause'),
		resume: () => {
			order.push('resume');
			if (faults.resume) throw faults.resume;
		},
	};
	const input = {
		holdRawModeErrors: () => {
			order.push('hold');
			return () => {
				order.push('release');
				return faults.held;
			};
		},
	};
	return {order, inkSuspend, mouse, input};
};

test('the result is returned and the steps run in order', async () => {
	const r = rig();
	const value = await runSuspended(r.inkSuspend, () => {
		r.order.push('child');
		return 42;
	}, {mouse: r.mouse, input: r.input});
	assert.equal(value, 42);
	assert.deepEqual(r.order, ['ink begin', 'pause', 'child', 'hold', 'ink end', 'release', 'resume']);
});

test('works without mouse and input', async () => {
	const r = rig();
	assert.equal(await runSuspended(r.inkSuspend, async () => 'x'), 'x');
});

test('a child failure is rethrown and the mouse is resumed', async () => {
	const r = rig();
	await assert.rejects(runSuspended(r.inkSuspend, () => {
		throw new Error('child failed');
	}, {mouse: r.mouse, input: r.input}), /child failed/);
	assert.deepEqual(r.order, ['ink begin', 'pause', 'hold', 'ink end', 'release', 'resume']);
});

test('when Ink cannot begin the child is skipped, the mouse untouched and the error rethrown', async () => {
	const r = rig({begin: Object.assign(new Error('EIO'), {code: 'EIO'})});
	let ran = false;
	await assert.rejects(runSuspended(r.inkSuspend, () => void (ran = true), {mouse: r.mouse, input: r.input}), {code: 'EIO'});
	assert.equal(ran, false);
	assert.deepEqual(r.order, []);
});

test('a held raw-mode error is rethrown after Ink finished', async () => {
	const r = rig({held: new Error('raw EIO')});
	await assert.rejects(runSuspended(r.inkSuspend, () => 1, {mouse: r.mouse, input: r.input}), /raw EIO/);
	assert.deepEqual(r.order, ['ink begin', 'pause', 'hold', 'ink end', 'release', 'resume']);
});

test('Ink end failure is rethrown and still resumes the mouse', async () => {
	const r = rig({end: new Error('ink end failed')});
	await assert.rejects(runSuspended(r.inkSuspend, () => 1, {mouse: r.mouse, input: r.input}), /ink end failed/);
	assert.equal(r.order.at(-1), 'resume');
});

test('a resume failure is rethrown when nothing else failed', async () => {
	const r = rig({resume: new Error('resume failed')});
	await assert.rejects(runSuspended(r.inkSuspend, () => 1, {mouse: r.mouse, input: r.input}), /resume failed/);
});

test('the child failure wins over held, Ink end and resume failures', async () => {
	const r = rig({held: new Error('held'), end: new Error('end'), resume: new Error('resume')});
	await assert.rejects(runSuspended(r.inkSuspend, () => Promise.reject(new Error('child failed')), {mouse: r.mouse, input: r.input}), /child failed/);
	assert.deepEqual(r.order, ['ink begin', 'pause', 'hold', 'ink end', 'release', 'resume']);
});
