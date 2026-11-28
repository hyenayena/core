type Mouse = {pause(): void; resume(): void};
type Input = {holdRawModeErrors(): () => unknown};

export async function runSuspended<T>(
	inkSuspend: (callback: () => Promise<void>) => Promise<void>,
	fn: () => T | Promise<T>,
	deps: {mouse?: Mouse; input?: Input} = {},
): Promise<T> {
	const {mouse, input} = deps;
	let outcome: {ok: true; value: T} | {ok: false; error: unknown} | undefined;
	let paused = false;
	let release: (() => unknown) | undefined;
	let inkFailure: {error: unknown} | undefined;
	try {
		await inkSuspend(async () => {
			try {
				mouse?.pause();
				paused = mouse !== undefined;
				outcome = {ok: true, value: await fn()};
			} catch (error) {
				outcome = {ok: false, error};
			}
			// Last statement: Ink restores raw mode right after the callback returns.
			release = input?.holdRawModeErrors();
		});
	} catch (error) {
		inkFailure = {error};
	}
	// Every restore step runs even when one fails; the first failure is rethrown, the child's own wins.
	const held = release?.();
	let resumeFailure: {error: unknown} | undefined;
	if (paused) {
		try {
			mouse?.resume();
		} catch (error) {
			resumeFailure = {error};
		}
	}
	if (outcome === undefined) throw (inkFailure ?? {error: new Error('Terminal suspend did not run')}).error;
	const done = outcome as {ok: true; value: T} | {ok: false; error: unknown};
	if (!done.ok) throw done.error;
	if (inkFailure) throw inkFailure.error;
	if (held !== undefined) throw held;
	if (resumeFailure) throw resumeFailure.error;
	return done.value;
}
