import type {FocusDirection} from '../../../../src/api.js';

type KeyLike = {ctrl?: boolean; shift?: boolean; meta?: boolean; leftArrow?: boolean; rightArrow?: boolean};

export function isConsoleToggle(input: string, key?: KeyLike): boolean {
	return input === '§' || (Boolean(key?.ctrl) && input === 't');
}

export function focusMove(key?: KeyLike): FocusDirection | undefined {
	if (!key?.shift || key.ctrl || key.meta) return undefined;
	return key.leftArrow ? 'left' : key.rightArrow ? 'right' : undefined;
}

export const isHostKey = (input: string, key?: KeyLike): boolean => isConsoleToggle(input, key) || focusMove(key) !== undefined;

const QUIT_LINES = new Set([':q', ':q!']);

export const isQuitLine = (line: string): boolean => QUIT_LINES.has(line.trim());
