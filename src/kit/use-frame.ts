import {useEffect, useState, useSyncExternalStore} from 'react';
import {FRAME_MS, frameClock} from './frame-clock.js';
import {reducedMotion, subscribeMotion} from './motion.js';

const noopSubscribe = (): (() => void) => () => {};
const zero = (): number => 0;

export function useFrame(active = true, paceMs = FRAME_MS): number {
	return useSyncExternalStore(active ? frameClock.subscribe : noopSubscribe, active ? () => Math.floor(frameClock.time() / paceMs) * paceMs : zero);
}

export function useFrameDeadline(atMs: number | undefined): void {
	const [, setN] = useState(0);
	useEffect(() => {
		if (atMs === undefined) return;
		const delay = atMs - Date.now() + 1;
		if (delay <= 0) return;
		return frameClock.schedule(() => setN(n => n + 1), delay);
	}, [atMs]);
}

export function useReducedMotion(): boolean {
	return useSyncExternalStore(subscribeMotion, reducedMotion);
}
