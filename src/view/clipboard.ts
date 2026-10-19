const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// Terminals cap OSC 52 payloads (often near 100 KB of base64); longer text is refused, not cut.
export const CLIPBOARD_MAX_CHARS = 50_000;

export function clipboardSequence(text: string): string {
	return `${ESC}]52;c;${Buffer.from(text, 'utf8').toString('base64')}${BEL}`;
}

/** Puts text on the terminal's clipboard with OSC 52 (passes through docker exec and ssh). */
export function copyToClipboard(stream: {write: (s: string) => unknown}, text: string): boolean {
	if (typeof text !== 'string' || text.length > CLIPBOARD_MAX_CHARS) return false;
	try {
		stream.write(clipboardSequence(text));
		return true;
	} catch {
		return false;
	}
}
