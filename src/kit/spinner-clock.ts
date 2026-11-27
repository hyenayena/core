import {createFrameClock, frameClock, type ClockTimers, type FrameClock} from './frame-clock.js';

export type SpinnerTimers = ClockTimers;
export type SpinnerClock = FrameClock;

export const createSpinnerClock = (intervalMs: number, timers?: SpinnerTimers): SpinnerClock => createFrameClock({intervalMs, timers});

export const spinnerClock: SpinnerClock = frameClock;
