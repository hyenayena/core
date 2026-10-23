import type {FocusDirection} from '../../../../src/api.js';

type KeyLike = {ctrl?: boolean; shift?: boolean; meta?: boolean; leftArrow?: boolean; rightArrow?: boolean};

// ⌘+§ / Ctrl+§ reach the app as a plain "§" (terminals drop those modifiers), so the character is
// the toggle and cannot be typed. Ctrl+T (one byte, 0x14) also works where the IDE does not take it.
export function isConsoleToggle(input: string, key?: KeyLike): boolean {
	return input === '§' || (Boolean(key?.ctrl) && input === 't');
}

/** Shift+← and Shift+→ move the input between the main view and the console. */
export function focusMove(key?: KeyLike): FocusDirection | undefined {
	if (!key?.shift || key.ctrl || key.meta) return undefined;
	return key.leftArrow ? 'left' : key.rightArrow ? 'right' : undefined;
}

/** Keys the host handles itself; views and the console prompt ignore them. */
export const isHostKey = (input: string, key?: KeyLike): boolean => isConsoleToggle(input, key) || focusMove(key) !== undefined;

// Vim-style quit typed as a whole line: in the console it closes the console, in a chat it exits.
const QUIT_LINES = new Set([':q', ':q!']);

export const isQuitLine = (line: string): boolean => QUIT_LINES.has(line.trim());
