import {mkdirSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

export const CLIPBOARD_MAX_CHARS = 50_000;
export const CLIPBOARD_DIR_ENV = 'YENA_CLIPBOARD_DIR';

export function clipboardSequence(text: string): string {
	return `${ESC}]52;c;${Buffer.from(text, 'utf8').toString('base64')}${BEL}`;
}

let seq = 0;

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
	}
	const dir = env[CLIPBOARD_DIR_ENV];
	if (dir && writeClipboardFile(dir, text)) ok = true;
	return ok;
}
