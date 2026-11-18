import React, {useSyncExternalStore} from 'react';
import {Text} from 'ink';
import {asciiGlyphs, spinnerFrame} from './glyphs.js';
import {spinnerClock} from './spinner-clock.js';

const noopSubscribe = (): (() => void) => () => {};
const readIdle = (): number => 0;

export function useSpinnerTick(active = true): number {
	return useSyncExternalStore(active ? spinnerClock.subscribe : noopSubscribe, active ? spinnerClock.tick : readIdle);
}

export function useSpinner(active = true): string {
	return spinnerFrame(useSpinnerTick(active), {ascii: asciiGlyphs(process.env)});
}

export function Spinner({active = true}: {active?: boolean} = {}) {
	return <Text>{useSpinner(active)}</Text>;
}
