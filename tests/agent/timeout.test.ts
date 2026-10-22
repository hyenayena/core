import assert from 'node:assert/strict';
import {mock, test} from 'node:test';
import type {Command} from '../../../../src/api.js';
import {createCommandBridge, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS} from '../../src/agent/bridge.js';
import {buildCatalog} from '../../src/hints/catalog.js';
import {fakeLogger} from '../testkit.js';

const hang: Command = {name: 'hang', description: 'h', agent: 'safe', run: () => new Promise<void>(() => {})};

async function timeoutAt(timeoutMs: number | undefined): Promise<number> {
	mock.timers.enable({apis: ['setTimeout']});
	try {
		const bridge = createCommandBridge({
			find: n => (n === 'hang' ? hang : undefined),
			catalog: () => buildCatalog([hang]),
			mode: () => 'policy',
			tee: () => {},
			clear: () => {},
			exit: () => {},
			log: fakeLogger().log,
		});
		const pending = bridge.run({line: 'hang', caller: 't', ...(timeoutMs !== undefined && {timeoutMs})});
		await Promise.resolve();
		await new Promise<void>(r => setImmediate(r));
		const before = mock.timers;
		let elapsed = 0;
		const step = 500;
		let status: string | undefined;
		void pending.then(r => (status = r.status));
		while (status === undefined && elapsed < MAX_TIMEOUT_MS * 2) {
			before.tick(step);
			elapsed += step;
			await new Promise<void>(r => setImmediate(r));
		}
		assert.equal(status, 'timeout');
		return elapsed;
	} finally {
		mock.timers.reset();
	}
}

test('timeout is clamped to 1 s .. 600 s and defaults to 60 s', async () => {
	assert.equal(await timeoutAt(1), MIN_TIMEOUT_MS);
	assert.equal(await timeoutAt(-5), MIN_TIMEOUT_MS);
	assert.equal(await timeoutAt(10_000_000), MAX_TIMEOUT_MS);
	assert.equal(await timeoutAt(undefined), DEFAULT_TIMEOUT_MS);
	assert.equal(await timeoutAt(Number.NaN), DEFAULT_TIMEOUT_MS);
	assert.equal(await timeoutAt(5_000), 5_000);
});

test('timeout and abort close the view at once, after the signal aborted, and keep the lock until the command settles', async () => {
	for (const how of ['timeout', 'abort'] as const) {
		mock.timers.enable({apis: ['setTimeout']});
		try {
			const closes: string[] = [];
			let ctxSignal: AbortSignal | undefined;
			let release!: () => void;
			let resolveDone!: () => void;
			let mountResult: Promise<void> | undefined;
			const ping: Command = {name: 'ping', description: 'p', agent: 'safe', run: () => {}};
			const command: Command = {
				name: 'view',
				description: 'v',
				agent: 'safe',
				run: async (_a, ctx) => {
					ctxSignal = ctx.signal;
					mountResult = ctx.mount!(() => ({}), {target: 'panel'}).then(() => void closes.push(`resolved aborted=${ctx.signal?.aborted}`));
					await mountResult;
					await new Promise<void>(r => (release = r));
				},
			};
			const bridge = createCommandBridge({
				find: n => (n === 'view' ? command : n === 'ping' ? ping : undefined),
				catalog: () => buildCatalog([command, ping]),
				mode: () => 'policy',
				tee: () => {},
				clear: () => {},
				exit: () => {},
				mountView: () => {
					const done = new Promise<void>(r => (resolveDone = r));
					return {
						done,
						close: () => {
							closes.push('close');
							resolveDone();
						},
					};
				},
				log: fakeLogger().log,
			});
			const controller = new AbortController();
			const pending = bridge.run({line: 'view', caller: 't', signal: controller.signal});
			await new Promise<void>(r => setImmediate(r));
			if (how === 'timeout') mock.timers.tick(DEFAULT_TIMEOUT_MS);
			else controller.abort();
			const result = await pending;
			assert.equal(result.status, how === 'timeout' ? 'timeout' : 'aborted');
			await new Promise<void>(r => setImmediate(r));
			assert.deepEqual(closes, ['close', 'resolved aborted=true'], how);
			assert.equal(ctxSignal?.aborted, true);
			assert.equal((await bridge.run({line: 'view', caller: 't'})).status, 'busy', how);
			release();
			await new Promise<void>(r => setImmediate(r));
			assert.equal((await bridge.run({line: 'ping', caller: 't'})).status, 'ok', how);
		} finally {
			mock.timers.reset();
		}
	}
});
