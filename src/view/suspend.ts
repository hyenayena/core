const ESC = String.fromCharCode(27);
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

export async function suspendTerminal<T>(
	stdin: In,
	stdout: Out,
	fn: () => T | Promise<T>,
	mouse?: {pause(): void; resume(): void},
): Promise<T> {
	const readers = stdin.listeners('readable');
	for (const r of readers) stdin.removeListener('readable', r);
	const wasRaw = stdin.isRaw === true;
	try {
		stdin.setRawMode?.(false);
	} catch (error) {
		for (const r of readers) stdin.on('readable', r);
		throw error;
	}
	// Every restore step runs even when one fails (setRawMode can throw EIO once the tty is gone);
	// the first failure is rethrown afterwards, unless the child already failed.
	const restore = (): {error: unknown} | undefined => {
		let failure: {error: unknown} | undefined;
		const step = (run: () => unknown) => {
			try {
				run();
			} catch (error) {
				failure ??= {error};
			}
		};
		step(() => stdin.setRawMode?.(wasRaw));
		for (const r of readers) stdin.on('readable', r);
		step(() => stdout.write(RETURN));
		step(() => mouse?.resume());
		step(() => stdout.emit('resize'));
		return failure;
	};
	let result: T;
	try {
		mouse?.pause();
		stdout.write(LEAVE);
		result = await fn();
	} catch (error) {
		restore();
		throw error;
	}
	const failure = restore();
	if (failure) throw failure.error;
	return result;
}
