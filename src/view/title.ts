import {sanitizeText} from '../hints/sanitize.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

export const APP_TITLE = 'yena';

export function titleSequence(title: string): string {
	return `${ESC}]0;${sanitizeText(title, 100)}${BEL}`;
}

export function setTerminalTitle(stream: {isTTY?: boolean; write: (s: string) => unknown}, title: string): void {
	if (!stream.isTTY) return;
	try {
		stream.write(titleSequence(title));
	} catch {
	}
}
