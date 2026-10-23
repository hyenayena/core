import React, {useEffect, useState} from 'react';
import {Text} from 'ink';

export const SPINNERS = {
	squareCorners: ['◰', '◳', '◲', '◱'],
	braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
	// Claude Code's look: a growing and shrinking star, and a blinking dot for a running tool.
	sparkle: ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'],
	blink: ['●', ' '],
};

/** Current frame of a spinner; the timer runs only while `active`. */
export function useSpinnerFrame(frames: readonly string[], intervalMs: number, active = true): string {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		if (!active || frames.length === 0) return;
		const timer = setInterval(() => setFrame(f => (f + 1) % frames.length), intervalMs);
		return () => clearInterval(timer);
	}, [frames, intervalMs, active]);
	return frames.length === 0 ? '' : (frames[frame % frames.length] as string);
}

export function Spinner({frames, intervalMs}: {frames: readonly string[]; intervalMs: number}) {
	return <Text>{useSpinnerFrame(frames, intervalMs)}</Text>;
}
