import React from 'react';
import {Text} from 'ink';
import {asciiGlyphs, SPINNER, spinnerFrame} from './glyphs.js';
import {useFrame, useReducedMotion} from './use-frame.js';

export const SPINNER_REDUCED_PACE_MS = 1000;

export function useSpinnerTick(active = true): number {
	const reduced = useReducedMotion();
	const t = useFrame(active, reduced ? SPINNER_REDUCED_PACE_MS : SPINNER.intervalMs);
	return reduced ? 0 : Math.floor(t / SPINNER.intervalMs);
}

export function useSpinner(active = true): string {
	return spinnerFrame(useSpinnerTick(active), {ascii: asciiGlyphs(process.env)});
}

export function Spinner({active = true}: {active?: boolean} = {}) {
	return <Text>{useSpinner(active)}</Text>;
}
