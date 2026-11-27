export const FRAME_IDLE_MS = 60_000;
const MAX_OPEN_TURNS = 8;
const PEAK_QUEUE_CAP = 256;
const PEAK_WINDOW_MS = 1000;
const OUTCOME_PATTERN = /^[a-z][a-z-]{0,23}$/;

export interface FrameTimers {
	setInterval(fn: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
}

export interface FrameTurn {
	end(outcome?: string): void;
	drop(): void;
}

export interface FrameMetrics {
	readonly enabled: boolean;
	render(renderTimeMs: number): void;
	rawWrite(): void;
	input(): void;
	clockTick(): void;
	setLiveHeightProbe(probe: () => number): () => void;
	turn(): FrameTurn;
	stop(): void;
}

export interface FrameMetricsOptions {
	debug: boolean;
	log?: {debug(msg: string, fields?: Record<string, unknown>): void};
	now?: () => number;
	timers?: FrameTimers;
	idleMs?: number;
}

export interface FrameLog {
	debug(msg: string, fields?: Record<string, unknown>): void;
	level?(): string;
	onLevel?(listener: (level: string) => void): () => void;
}

export interface StartFrameMetricsOptions {
	log?: FrameLog;
	now?: () => number;
	timers?: FrameTimers;
	idleMs?: number;
}

interface Window {
	start: number;
	renders: number;
	frameMaxMs: number;
	frameTotalMs: number;
	peak: number;
	queue: number[];
	heightChanges: number;
	rawWrites: number;
	inputs: number;
	clockTicks: number;
}

const globalTimers: FrameTimers = {
	setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
	clearInterval: handle => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

const NOOP_TURN: FrameTurn = {end() {}, drop() {}};

const DISABLED: FrameMetrics = {
	enabled: false,
	render() {},
	rawWrite() {},
	input() {},
	clockTick() {},
	setLiveHeightProbe: () => () => {},
	turn: () => NOOP_TURN,
	stop() {},
};

const freshWindow = (start: number): Window => ({start, renders: 0, frameMaxMs: 0, frameTotalMs: 0, peak: 0, queue: [], heightChanges: 0, rawWrites: 0, inputs: 0, clockTicks: 0});
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function createFrameMetrics(opts: FrameMetricsOptions): FrameMetrics {
	const log = opts.log;
	if (!opts.debug || !log) return DISABLED;
	const now = opts.now ?? (() => performance.now());
	const timers = opts.timers ?? globalTimers;
	let idle = freshWindow(now());
	const turns = new Set<Window>();
	const probes: Array<() => number> = [];
	let lastHeight: number | undefined;
	let stopped = false;

	const emit = (kind: 'idle' | 'turn', w: Window, end: number, outcome?: string): void => {
		log.debug('frames', {
			kind,
			ms: Math.max(0, Math.round(end - w.start)),
			renders: w.renders,
			peakPerSec: w.peak,
			frameMaxMs: round1(w.frameMaxMs),
			frameAvgMs: w.renders === 0 ? 0 : round1(w.frameTotalMs / w.renders),
			heightChanges: w.heightChanges,
			rawWrites: w.rawWrites,
			inputs: w.inputs,
			clockTicks: w.clockTicks,
			...(kind === 'turn' && {outcome: outcome !== undefined && OUTCOME_PATTERN.test(outcome) ? outcome : 'other'}),
		});
	};

	const targets = (): Iterable<Window> => (turns.size > 0 ? turns : [idle]);

	const handle = timers.setInterval(() => {
		if (stopped) return;
		const t = now();
		if (idle.renders > 0) emit('idle', idle, t);
		idle = freshWindow(t);
	}, opts.idleMs ?? FRAME_IDLE_MS);
	(handle as {unref?: () => void} | null)?.unref?.();

	return {
		enabled: true,
		render(renderTimeMs) {
			if (stopped) return;
			const t = now();
			const ms = Number.isFinite(renderTimeMs) && renderTimeMs > 0 ? renderTimeMs : 0;
			let changed = false;
			const probe = probes[probes.length - 1];
			if (probe) {
				try {
					const h = probe();
					if (lastHeight !== undefined && h !== lastHeight) changed = true;
					lastHeight = h;
				} catch {
				}
			}
			for (const w of targets()) {
				w.renders++;
				w.frameMaxMs = Math.max(w.frameMaxMs, ms);
				w.frameTotalMs += ms;
				w.queue.push(t);
				while (w.queue.length > 0 && w.queue[0]! <= t - PEAK_WINDOW_MS) w.queue.shift();
				while (w.queue.length > PEAK_QUEUE_CAP) w.queue.shift();
				w.peak = Math.max(w.peak, w.queue.length);
				if (changed) w.heightChanges++;
			}
		},
		rawWrite() {
			if (stopped) return;
			for (const w of targets()) w.rawWrites++;
		},
		input() {
			if (stopped) return;
			for (const w of targets()) w.inputs++;
		},
		clockTick() {
			if (stopped) return;
			for (const w of targets()) w.clockTicks++;
		},
		setLiveHeightProbe(probe) {
			probes.push(probe);
			return () => {
				const i = probes.indexOf(probe);
				if (i >= 0) probes.splice(i, 1);
			};
		},
		turn() {
			if (stopped || turns.size >= MAX_OPEN_TURNS) return NOOP_TURN;
			const w = freshWindow(now());
			turns.add(w);
			return {
				end(outcome) {
					if (!turns.delete(w)) return;
					emit('turn', w, now(), outcome);
				},
				drop() {
					turns.delete(w);
				},
			};
		},
		stop() {
			if (stopped) return;
			stopped = true;
			timers.clearInterval(handle);
			turns.clear();
		},
	};
}

let current: FrameMetrics = DISABLED;
let unsubscribe: () => void = () => {};
let probes: Array<{probe: () => number; detach: () => void}> = [];

const attachProbes = (): void => {
	for (const entry of probes) entry.detach = current.setLiveHeightProbe(entry.probe);
};

const facade: FrameMetrics = {
	get enabled() {
		return current.enabled;
	},
	render: ms => current.render(ms),
	rawWrite: () => current.rawWrite(),
	input: () => current.input(),
	clockTick: () => current.clockTick(),
	turn: () => current.turn(),
	setLiveHeightProbe(probe) {
		const entry = {probe, detach: current.setLiveHeightProbe(probe)};
		probes.push(entry);
		return () => {
			entry.detach();
			const i = probes.indexOf(entry);
			if (i >= 0) probes.splice(i, 1);
		};
	},
	stop() {
		unsubscribe();
		unsubscribe = () => {};
		current.stop();
		current = DISABLED;
	},
};

export function startFrameMetrics(opts: StartFrameMetricsOptions = {}): FrameMetrics {
	facade.stop();
	probes = [];
	const {log} = opts;
	const follow = (level: string): void => {
		const debug = level === 'debug';
		if (debug === current.enabled) return;
		current.stop();
		current = debug ? createFrameMetrics({debug: true, log, now: opts.now, timers: opts.timers, idleMs: opts.idleMs}) : DISABLED;
		attachProbes();
	};
	if (log?.level) {
		follow(log.level());
		const off = log.onLevel?.(follow);
		if (off) unsubscribe = off;
	}
	return facade;
}

export const frameMetrics = (): FrameMetrics => facade;
export const startFrameTurn = (): FrameTurn => facade.turn();
export const countRawWrite = (): void => facade.rawWrite();
export const countInput = (): void => facade.input();
export const countClockTick = (): void => facade.clockTick();
