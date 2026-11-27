import assert from 'node:assert/strict';
import {afterEach, describe, test} from 'node:test';
import {PassThrough} from 'node:stream';
import {
	createFrameMetrics,
	frameMetrics,
	startFrameMetrics,
	startFrameTurn,
	countRawWrite,
	type FrameTimers,
} from '../../src/kit/frame-metrics.js';
import {setTerminalTitle} from '../../src/view/title.js';
import {copyToClipboard} from '../../src/view/clipboard.js';
import {createMouseTerminal} from '../../src/mouse/terminal.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {createFakeTty} from '../testkit.js';
import {suspendTerminal} from '../../src/view/suspend.js';

type Rec = {msg: string; fields: Record<string, unknown> | undefined};

function setup(over: {debug?: boolean; idleMs?: number} = {}) {
	const records: Rec[] = [];
	const clock = {t: 0, calls: 0};
	const timer = {started: 0, cleared: 0, fire: () => {}};
	const timers: FrameTimers = {
		setInterval: fn => {
			timer.started++;
			timer.fire = fn;
			return {};
		},
		clearInterval: () => {
			timer.cleared++;
		},
	};
	const debug = over.debug ?? true;
	const levels = {current: debug ? 'debug' : 'info', listeners: new Set<(level: string) => void>()};
	const opts = {
		debug,
		log: {
			debug: (msg: string, fields?: Record<string, unknown>) => void records.push({msg, fields}),
			level: () => levels.current,
			onLevel: (listener: (level: string) => void) => {
				levels.listeners.add(listener);
				return () => void levels.listeners.delete(listener);
			},
		},
		now: () => {
			clock.calls++;
			return clock.t;
		},
		timers,
		...(over.idleMs !== undefined && {idleMs: over.idleMs}),
	};
	const setLevel = (level: string) => {
		levels.current = level;
		for (const listener of [...levels.listeners]) listener(level);
	};
	return {records, clock, timer, opts, levels, setLevel, metrics: createFrameMetrics(opts)};
}

afterEach(() => {
	startFrameMetrics();
});

describe('frame metrics', () => {
	test('disabled: no clock, no timer, no records', () => {
		const s = setup({debug: false});
		assert.equal(s.metrics.enabled, false);
		s.metrics.render(5);
		s.metrics.rawWrite();
		s.metrics.setLiveHeightProbe(() => 1)();
		s.metrics.turn().end('ok');
		s.metrics.stop();
		assert.equal(s.clock.calls, 0);
		assert.equal(s.timer.started, 0);
		assert.equal(s.records.length, 0);
	});

	test('renders go into an open turn, not into idle', () => {
		const s = setup();
		const turn = s.metrics.turn();
		s.metrics.render(2);
		turn.end('ok');
		s.timer.fire();
		assert.equal(s.records.length, 1);
		assert.equal(s.records[0]!.fields!.renders, 1);
		s.metrics.render(1);
		s.timer.fire();
		assert.equal(s.records.length, 2);
		assert.equal(s.records[1]!.fields!.kind, 'idle');
	});

	test('overlapping turns both count', () => {
		const s = setup();
		const a = s.metrics.turn();
		const b = s.metrics.turn();
		s.metrics.render(1);
		a.end('ok');
		s.metrics.render(1);
		b.end('ok');
		assert.deepEqual(s.records.map(r => r.fields!.renders), [1, 2]);
	});

	test('end logs one frames record with the numbers', () => {
		const s = setup();
		const turn = s.metrics.turn();
		s.clock.t = 100;
		s.metrics.render(2.04);
		s.metrics.render(4.06);
		s.metrics.rawWrite();
		s.clock.t = 250;
		turn.end('ok');
		turn.end('ok');
		turn.drop();
		assert.equal(s.records.length, 1);
		assert.equal(s.records[0]!.msg, 'frames');
		assert.deepEqual(s.records[0]!.fields, {
			kind: 'turn',
			ms: 250,
			renders: 2,
			peakPerSec: 2,
			frameMaxMs: 4.1,
			frameAvgMs: 3.1,
			heightChanges: 0,
			rawWrites: 1,
			inputs: 0,
			clockTicks: 0,
			outcome: 'ok',
		});
	});

	test('inputs and clock ticks are counted into the open window', () => {
		const s = setup();
		const turn = s.metrics.turn();
		s.metrics.input();
		s.metrics.input();
		s.metrics.clockTick();
		turn.end('ok');
		assert.equal(s.records[0]!.fields!.inputs, 2);
		assert.equal(s.records[0]!.fields!.clockTicks, 1);
	});

	test('drop logs nothing', () => {
		const s = setup();
		const turn = s.metrics.turn();
		turn.drop();
		turn.end('ok');
		assert.equal(s.records.length, 0);
	});

	test('peak is a sliding one-second window', () => {
		const s = setup();
		const turn = s.metrics.turn();
		for (const t of [0, 100, 200, 300, 400]) {
			s.clock.t = t;
			s.metrics.render(1);
		}
		for (const t of [1300, 1350, 1400]) {
			s.clock.t = t;
			s.metrics.render(1);
		}
		turn.end('ok');
		assert.equal(s.records[0]!.fields!.peakPerSec, 5);
		const s2 = setup();
		const t2 = s2.metrics.turn();
		for (const t of [0, 300, 600, 900, 1100, 1200]) {
			s2.clock.t = t;
			s2.metrics.render(1);
		}
		t2.end('ok');
		assert.equal(s2.records[0]!.fields!.peakPerSec, 5);
	});

	test('bad render times count as zero', () => {
		const s = setup();
		const turn = s.metrics.turn();
		s.metrics.render(NaN);
		s.metrics.render(-3);
		turn.end('ok');
		assert.equal(s.records[0]!.fields!.renders, 2);
		assert.equal(s.records[0]!.fields!.frameMaxMs, 0);
	});

	test('height changes: first reading is the baseline', () => {
		const s = setup();
		let h = 5;
		const off = s.metrics.setLiveHeightProbe(() => h);
		const turn = s.metrics.turn();
		s.metrics.render(1);
		s.metrics.render(1);
		h = 7;
		s.metrics.render(1);
		h = 3;
		s.metrics.render(1);
		turn.end('ok');
		assert.equal(s.records[0]!.fields!.heightChanges, 2);
		off();
		const t2 = s.metrics.turn();
		h = 9;
		s.metrics.render(1);
		t2.end('ok');
		assert.equal(s.records[1]!.fields!.heightChanges, 0);
	});

	test('a throwing probe is ignored', () => {
		const s = setup();
		s.metrics.setLiveHeightProbe(() => {
			throw new Error('x');
		});
		const turn = s.metrics.turn();
		s.metrics.render(1);
		turn.end('ok');
		assert.equal(s.records[0]!.fields!.renders, 1);
		assert.equal(s.records[0]!.fields!.heightChanges, 0);
	});

	test('idle tick logs only when frames were drawn, then resets', () => {
		const s = setup({idleMs: 1000});
		assert.equal(s.timer.started, 1);
		s.clock.t = 1000;
		s.timer.fire();
		assert.equal(s.records.length, 0);
		s.metrics.render(1);
		s.clock.t = 2000;
		s.timer.fire();
		assert.equal(s.records.length, 1);
		assert.equal(s.records[0]!.fields!.kind, 'idle');
		assert.equal(s.records[0]!.fields!.ms, 1000);
		assert.equal(s.records[0]!.fields!.outcome, undefined);
		s.clock.t = 3000;
		s.timer.fire();
		assert.equal(s.records.length, 1);
	});

	test('outcome is sanitised', () => {
		const s = setup();
		for (const o of ['limit', 'Bad Value', undefined, 'x'.repeat(40)]) s.metrics.turn().end(o);
		assert.deepEqual(s.records.map(r => r.fields!.outcome), ['limit', 'other', 'other', 'other']);
	});

	test('at most eight turns are open', () => {
		const s = setup();
		const turns = Array.from({length: 9}, () => s.metrics.turn());
		for (const t of turns) t.end('ok');
		assert.equal(s.records.length, 8);
	});

	test('record fields are numbers and fixed words', () => {
		const s = setup();
		const turn = s.metrics.turn();
		s.metrics.render(1);
		turn.end('ok');
		for (const [k, v] of Object.entries(s.records[0]!.fields!)) {
			assert.ok(typeof v === 'number' || k === 'kind' || k === 'outcome', k);
		}
	});

	test('startFrameMetrics replaces and stops the previous collector', () => {
		const a = setup();
		const first = startFrameMetrics(a.opts);
		assert.equal(frameMetrics(), first);
		const b = setup();
		const second = startFrameMetrics(b.opts);
		assert.equal(a.timer.cleared, 1);
		assert.equal(frameMetrics(), second);
		startFrameTurn().end('ok');
		assert.equal(b.records.length, 1);
		assert.equal(a.records.length, 0);
		countRawWrite();
	});
});

describe('frame metrics following the log level', () => {
	test('info: disabled with no clock and no timer; debug turns it on, leaving debug clears the timer', () => {
		const s = setup({debug: false});
		const m = startFrameMetrics(s.opts);
		assert.equal(m.enabled, false);
		m.render(2);
		assert.equal(s.clock.calls, 0);
		assert.equal(s.timer.started, 0);
		s.setLevel('debug');
		assert.equal(m.enabled, true);
		assert.equal(s.timer.started, 1);
		const turn = m.turn();
		m.render(2);
		turn.end('ok');
		assert.equal(s.records.length, 1);
		s.setLevel('info');
		assert.equal(m.enabled, false);
		assert.equal(s.timer.cleared, 1);
		assert.equal(frameMetrics(), m);
	});

	test('a probe registered while disabled is used once enabled and detached by its remover', () => {
		const s = setup({debug: false});
		const m = startFrameMetrics(s.opts);
		let height = 1;
		const remove = m.setLiveHeightProbe(() => height);
		s.setLevel('debug');
		const turn = m.turn();
		m.render(1);
		height = 2;
		m.render(1);
		turn.end('ok');
		assert.equal(s.records[0]!.fields!.heightChanges, 1);
		remove();
		s.setLevel('info');
		s.setLevel('debug');
		const second = m.turn();
		m.render(1);
		height = 3;
		m.render(1);
		second.end('ok');
		assert.equal(s.records[1]!.fields!.heightChanges, 0);
	});

	test('a second startFrameMetrics unsubscribes the first; a log without level stays off', () => {
		const a = setup({debug: false});
		startFrameMetrics(a.opts);
		const b = setup({debug: false});
		startFrameMetrics(b.opts);
		assert.equal(a.levels.listeners.size, 0);
		assert.equal(b.levels.listeners.size, 1);
		const older = startFrameMetrics({log: {debug: () => {}}});
		assert.equal(older.enabled, false);
		assert.equal(b.levels.listeners.size, 0);
	});

	test('starting at debug is enabled at once', () => {
		const s = setup();
		const before = s.timer.started;
		assert.equal(startFrameMetrics(s.opts).enabled, true);
		assert.equal(s.timer.started, before + 1);
	});
});

describe('frame metrics: disabled and stopped', () => {
	test('the singleton disabled path never reads the clock or creates a timer', () => {
		const s = setup({debug: false});
		const m = startFrameMetrics(s.opts);
		assert.equal(m.enabled, false);
		assert.equal(frameMetrics().enabled, false);
		countRawWrite();
		startFrameTurn().end('ok');
		frameMetrics().render(3);
		assert.equal(s.clock.calls, 0);
		assert.equal(s.timer.started, 0);
		assert.equal(s.records.length, 0);
	});

	test('debug without a logger is disabled', () => {
		const s = setup({debug: false});
		const m = createFrameMetrics({debug: true, now: s.opts.now, timers: s.opts.timers});
		assert.equal(m.enabled, false);
		assert.equal(s.clock.calls, 0);
		assert.equal(s.timer.started, 0);
	});

	test('stop clears the idle timer and ignores later calls', () => {
		const s = setup();
		const turn = s.metrics.turn();
		s.metrics.stop();
		s.metrics.stop();
		assert.equal(s.timer.cleared, 1);
		s.metrics.render(1);
		s.metrics.rawWrite();
		s.metrics.turn().end('ok');
		turn.end('ok');
		s.timer.fire();
		assert.equal(s.records.length, 0);
	});

	test('the idle window receives nothing while a turn is open', () => {
		const s = setup();
		const turn = s.metrics.turn();
		s.metrics.render(1);
		s.metrics.rawWrite();
		s.timer.fire();
		assert.equal(s.records.length, 0);
		turn.end('ok');
		s.timer.fire();
		assert.equal(s.records.length, 1);
	});
});

describe('raw write failures', () => {
	const throwing = () => ({
		isTTY: true,
		write: (): boolean => {
			throw new Error('closed');
		},
	});

	async function count(run: () => void): Promise<unknown> {
		const s = setup();
		startFrameMetrics(s.opts);
		const turn = startFrameTurn();
		run();
		turn.end('ok');
		return s.records[0]!.fields!.rawWrites;
	}

	test('a throwing stream is not counted and does not throw', async () => {
		assert.equal(await count(() => setTerminalTitle(throwing(), 'x')), 0);
		assert.equal(await count(() => assert.equal(copyToClipboard(throwing(), 'hi', {}), false)), 0);
		const proxy = {onMouse: () => () => {}, setEnabled: () => {}};
		assert.equal(await count(() => createMouseTerminal(throwing(), proxy).setWanted(true)), 0);
	});
});

describe('raw write sites', () => {
	function rawWritesAfter(run: () => void | Promise<void>) {
		const s = setup();
		startFrameMetrics(s.opts);
		const turn = startFrameTurn();
		return Promise.resolve(run()).then(() => {
			turn.end('ok');
			return s.records[0]!.fields!.rawWrites;
		});
	}
	const tty = () => ({isTTY: true, write: () => true});

	test('title', async () => {
		assert.equal(await rawWritesAfter(() => setTerminalTitle(tty(), 'x')), 1);
	});

	test('clipboard', async () => {
		assert.equal(await rawWritesAfter(() => void copyToClipboard(tty(), 'hi', {})), 1);
	});

	test('mouse mode', async () => {
		const proxy = {onMouse: () => () => {}, setEnabled: () => {}};
		assert.equal(await rawWritesAfter(() => createMouseTerminal(tty(), proxy).setWanted(true)), 1);
	});

	test('suspend leave and return', async () => {
		const stdin = Object.assign(new PassThrough(), {setRawMode: () => {}, isRaw: false});
		const stdout = Object.assign(new PassThrough(), {isTTY: true});
		const n = await rawWritesAfter(async () => {
			await suspendTerminal(stdin as never, stdout as never, async () => {});
		});
		assert.equal(n, 2);
	});
});

describe('input sites', () => {
	test('the input proxy counts one input per chunk', async () => {
		const s = setup();
		startFrameMetrics(s.opts);
		const turn = startFrameTurn();
		const tty = createFakeTty();
		const proxy = createInputProxy(tty, {size: () => ({columns: 80, rows: 24})});
		proxy.stream.on('readable', () => void proxy.stream.read());
		tty.write('a');
		await new Promise(resolve => setImmediate(resolve));
		tty.write('bc');
		await new Promise(resolve => setImmediate(resolve));
		turn.end('ok');
		assert.equal(s.records[0]!.fields!.inputs, 2);
	});
});
