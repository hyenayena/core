const ESC = String.fromCharCode(27);
// Leave the alternate screen and show the cursor; on return, come back to it, clear and hide the cursor.
const LEAVE = `${ESC}[?1049l${ESC}[?25h${ESC}[?2004l`;
const RETURN = `${ESC}[?1049h${ESC}[2J${ESC}[H${ESC}[?25l${ESC}[?2004h`;

type In = {
	listeners(event: 'readable'): Array<(...args: unknown[]) => void>;
	removeListener(event: 'readable', fn: (...args: unknown[]) => void): unknown;
	on(event: 'readable', fn: (...args: unknown[]) => void): unknown;
	setRawMode?: (mode: boolean) => unknown;
	isRaw?: boolean;
};
type Out = {write(s: string): unknown; emit(event: 'resize'): unknown};

/**
 * Hands the terminal to `fn` (an editor, an interactive login): Ink stops reading keys, the normal
 * screen is shown, and afterwards the app's screen is redrawn. `fn` should block (spawnSync) so that
 * nothing renders over the child program.
 */
export async function suspendTerminal<T>(stdin: In, stdout: Out, fn: () => T | Promise<T>): Promise<T> {
	const readers = stdin.listeners('readable');
	for (const r of readers) stdin.removeListener('readable', r);
	const wasRaw = stdin.isRaw === true;
	stdin.setRawMode?.(false);
	stdout.write(LEAVE);
	try {
		return await fn();
	} finally {
		stdin.setRawMode?.(wasRaw);
		for (const r of readers) stdin.on('readable', r);
		stdout.write(RETURN);
		// Ink repaints the whole frame on resize.
		stdout.emit('resize');
	}
}
