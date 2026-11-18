import {SPINNER} from './glyphs.js';

export interface SpinnerTimers {
	setInterval(fn: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
}

export interface SpinnerClock {
	subscribe(listener: () => void): () => void;
	tick(): number;
	size(): number;
}

const globalTimers: SpinnerTimers = {
	setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
	clearInterval: handle => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export function createSpinnerClock(intervalMs: number, timers: SpinnerTimers = globalTimers): SpinnerClock {
	const listeners = new Set<() => void>();
	let tick = 0;
	let handle: unknown = null;
	return {
		subscribe(listener) {
			const entry = (): void => listener();
			listeners.add(entry);
			if (handle === null) {
				handle = timers.setInterval(() => {
					tick++;
					for (const l of [...listeners]) l();
				}, intervalMs);
				(handle as {unref?: () => void} | null)?.unref?.();
			}
			return () => {
				if (!listeners.delete(entry)) return;
				if (listeners.size === 0 && handle !== null) {
					timers.clearInterval(handle);
					handle = null;
				}
			};
		},
		tick: () => tick,
		size: () => listeners.size,
	};
}

export const spinnerClock = createSpinnerClock(SPINNER.intervalMs);
