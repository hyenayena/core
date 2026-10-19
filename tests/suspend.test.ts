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
