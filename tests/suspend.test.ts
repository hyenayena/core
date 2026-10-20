import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {suspendTerminal} from '../src/view/suspend.js';

test('suspend detaches key reading and raw mode for the child, then restores them and repaints', async () => {
	const stdin = Object.assign(new EventEmitter(), {isRaw: true, modes: [] as boolean[], setRawMode(m: boolean) {
		this.modes.push(m);
		this.isRaw = m;
	}});
	const reader = () => {};
	stdin.on('readable', reader);
	const writes: string[] = [];
	const stdout = Object.assign(new EventEmitter(), {write: (s: string) => void writes.push(s)});
	let resized = 0;
	stdout.on('resize', () => resized++);
	const result = await suspendTerminal(stdin as never, stdout as never, () => {
		assert.equal(stdin.listenerCount('readable'), 0);
		assert.equal(stdin.isRaw, false);
		return 42;
	});
	assert.equal(result, 42);
	assert.deepEqual(stdin.listeners('readable'), [reader]);
	assert.deepEqual(stdin.modes, [false, true]);
	assert.match(writes[0]!, /\?1049l/);
	assert.match(writes[1]!, /\?1049h/);
	assert.equal(resized, 1);
	await assert.rejects(suspendTerminal(stdin as never, stdout as never, () => Promise.reject(new Error('child failed'))), /child failed/);
	assert.deepEqual(stdin.listeners('readable'), [reader]);
});

test('suspend pauses mouse reporting before leaving and resumes it after returning', async () => {
	const order: string[] = [];
	const stdin = Object.assign(new EventEmitter(), {isRaw: true, setRawMode(m: boolean) {
		order.push(`raw:${m}`);
	}});
	const stdout = Object.assign(new EventEmitter(), {
		write: (s: string) => void order.push(/\?1049l/.test(s) ? 'leave' : /\?1049h/.test(s) ? 'return' : 'other'),
	});
	const mouse = {pause: () => void order.push('pause'), resume: () => void order.push('resume')};
	await suspendTerminal(stdin as never, stdout as never, () => void order.push('child'), mouse);
	assert.deepEqual(order, ['raw:false', 'pause', 'leave', 'child', 'raw:true', 'return', 'resume']);
	order.length = 0;
	await assert.rejects(
		suspendTerminal(stdin as never, stdout as never, () => {
			order.push('child');
			throw new Error('child failed');
		}, mouse),
		/child failed/,
	);
	assert.deepEqual(order, ['raw:false', 'pause', 'leave', 'child', 'raw:true', 'return', 'resume']);
});
