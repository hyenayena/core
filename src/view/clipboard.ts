import {mkdirSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// Terminals cap OSC 52 payloads (often near 100 KB of base64); longer text is refused, not cut.
export const CLIPBOARD_MAX_CHARS = 50_000;
// Set by the host launcher (`./yena`) when it copies files from this folder to the host clipboard.
export const CLIPBOARD_DIR_ENV = 'YENA_CLIPBOARD_DIR';

export function clipboardSequence(text: string): string {
	return `${ESC}]52;c;${Buffer.from(text, 'utf8').toString('base64')}${BEL}`;
}

let seq = 0;

/**
 * Hands text to the host launcher: a `.txt` file in the shared folder, written under a dot name and
 * renamed, so the launcher never reads half a file. It copies the file to the clipboard and deletes it.
 */
export function writeClipboardFile(dir: string, text: string): boolean {
	if (!path.isAbsolute(dir)) return false;
	try {
		mkdirSync(dir, {recursive: true, mode: 0o700});
		const name = `${Date.now()}-${process.pid}-${seq++}`;
		const tmp = path.join(dir, `.${name}.tmp`);
		writeFileSync(tmp, text, {mode: 0o600});
		renameSync(tmp, path.join(dir, `${name}.txt`));
		return true;
	} catch {
		return false;
	}
}

/**
 * Puts text on the clipboard: OSC 52 to the terminal (passes through docker exec and ssh, where the
 * terminal allows it), and the launcher's folder when there is one.
 */
export function copyToClipboard(
	stream: {write: (s: string) => unknown},
	text: string,
	env: Record<string, string | undefined> = process.env,
): boolean {
	if (typeof text !== 'string' || text.length > CLIPBOARD_MAX_CHARS) return false;
	let ok = false;
	try {
		stream.write(clipboardSequence(text));
		ok = true;
	} catch {
		// The folder may still work.
	}
	const dir = env[CLIPBOARD_DIR_ENV];
	if (dir && writeClipboardFile(dir, text)) ok = true;
	return ok;
}
