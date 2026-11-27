import {countClockTick} from './frame-metrics.js';

export const FRAME_MS = 50;

export interface ClockTimers {
	setInterval(fn: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
}

export interface FrameClock {
	readonly intervalMs: number;
	subscribe(listener: () => void): () => void;
	// A pending task keeps the clock running, so use it for delays of seconds, not hours.
	schedule(fn: () => void, delayMs?: number): () => void;
	tick(): number;
	time(): number;
	size(): number;
}

export interface FrameClockOptions {
	intervalMs?: number;
	timers?: ClockTimers;
	now?: () => number;
	onTick?: () => void;
}

interface Task {
	fn: () => void;
	due: number;
}

const globalTimers: ClockTimers = {
	setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
	clearInterval: handle => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export function createFrameClock(opts: FrameClockOptions = {}): FrameClock {
	const intervalMs = opts.intervalMs ?? FRAME_MS;
	const timers = opts.timers ?? globalTimers;
	const now = opts.now ?? Date.now;
	const listeners = new Set<() => void>();
	const tasks = new Set<Task>();
	let tick = 0;
	let time = now();
	let handle: unknown = null;

	const guard = (fn: () => void): void => {
		try {
			fn();
		} catch {
		}
	};

	const fire = (): void => {
		tick++;
		time = now();
		if (opts.onTick) guard(opts.onTick);
		for (const task of [...tasks]) {
			if (task.due > time || !tasks.delete(task)) continue;
			guard(task.fn);
		}
		for (const l of [...listeners]) guard(l);
		stopIfIdle();
	};

	const start = (): void => {
		if (handle !== null) return;
		time = now();
		handle = timers.setInterval(fire, intervalMs);
		(handle as {unref?: () => void} | null)?.unref?.();
	};

	function stopIfIdle(): void {
		if (handle === null || listeners.size > 0 || tasks.size > 0) return;
		timers.clearInterval(handle);
		handle = null;
	}

	return {
		intervalMs,
		subscribe(listener) {
			const entry = (): void => listener();
			listeners.add(entry);
			start();
			return () => {
				if (!listeners.delete(entry)) return;
				stopIfIdle();
			};
		},
		schedule(fn, delayMs = 0) {
			const task: Task = {fn, due: now() + delayMs};
			tasks.add(task);
			start();
			return () => {
				if (!tasks.delete(task)) return;
				stopIfIdle();
			};
		},
		tick: () => tick,
		time: () => time,
		size: () => listeners.size,
	};
}

export const frameClock: FrameClock = createFrameClock({onTick: countClockTick});
