import {sanitizeText} from '../hints/sanitize.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

export const APP_TITLE = 'yena';

/** OSC 0 sequence that sets the terminal window and tab title. */
export function titleSequence(title: string): string {
	return `${ESC}]0;${sanitizeText(title, 100)}${BEL}`;
}

/** Sets the terminal title when the stream is a terminal; does nothing otherwise. */
export function setTerminalTitle(stream: {isTTY?: boolean; write: (s: string) => unknown}, title: string): void {
	if (!stream.isTTY) return;
	try {
		stream.write(titleSequence(title));
	} catch {
		// A failed title write must never stop the UI from starting.
	}
}
