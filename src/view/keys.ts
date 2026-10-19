type KeyLike = {ctrl?: boolean};

// ⌘+§ / Ctrl+§ reach the app as a plain "§" (terminals drop those modifiers), so the character is
// the toggle and cannot be typed. Ctrl+T (one byte, 0x14) also works where the IDE does not take it.
export function isConsoleToggle(input: string, key?: KeyLike): boolean {
	return input === '§' || (Boolean(key?.ctrl) && input === 't');
}

// Two Esc presses this close together open or close the console; every terminal sends Esc.
export const DOUBLE_ESC_MS = 500;

/** Tracks Esc presses on an empty input; returns true on the second one within the window. */
export function createDoubleEsc(windowMs = DOUBLE_ESC_MS, now: () => number = Date.now) {
	let last = 0;
	return {
		press(): boolean {
			const t = now();
			if (last !== 0 && t - last <= windowMs) {
				last = 0;
				return true;
			}
			last = t;
			return false;
		},
		reset(): void {
			last = 0;
		},
	};
}

// Vim-style quit typed as a whole line: in the console it closes the console, in a chat it exits.
const QUIT_LINES = new Set([':q', ':q!']);

export const isQuitLine = (line: string): boolean => QUIT_LINES.has(line.trim());
