import {PassThrough} from 'node:stream';
import type {ReactElement} from 'react';
import {render} from 'ink';
import type {Logger} from '../../../src/api.js';

const CONTROL_ONLY = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[A-Za-z]', 'g');

export const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function mountHarness(
	element: ReactElement,
	size = {columns: 80, rows: 40},
	options: {debug?: boolean} = {},
) {
	const stdin = Object.assign(new PassThrough(), {
		isTTY: true,
		raw: [] as boolean[],
		setRawMode(value: boolean) {
			this.raw.push(value);
			return this;
		},
		ref() {},
		unref() {},
	});
	const stdout = Object.assign(new PassThrough(), {isTTY: true, ...size});
	const chunks: string[] = [];
	stdout.on('data', chunk => chunks.push(String(chunk)));

	const instance = render(element, {
		stdin: stdin as unknown as NodeJS.ReadStream,
		stdout: stdout as unknown as NodeJS.WriteStream,
		stderr: new PassThrough() as unknown as NodeJS.WriteStream,
		debug: options.debug ?? true,
		interactive: true,
		exitOnCtrlC: false,
		patchConsole: false,
	});

	return {
		raw: stdin.raw,
		press: (sequence: string) => stdin.write(sequence),
		// Escape is flushed by Ink after 20 ms, so waits must exceed that
		settle: (ms = 30) => wait(ms),
		// Mode switches (bracketed paste, cursor) arrive as chunks of their own; skip them.
		lastFrame: () => [...chunks].reverse().find(c => c.replace(CONTROL_ONLY, '') !== '') ?? '',
		allOutput: () => chunks.join(''),
		frameCount: () => chunks.length,
		resize: (columns: number, rows: number) => {
			Object.assign(stdout, {columns, rows});
			stdout.emit('resize');
		},
		unmount: () => instance.unmount(),
		waitUntilExit: () => instance.waitUntilExit(),
	};
}

export type LogRecord = {level: string; scope?: string; msg: string; fields?: Record<string, unknown>};

export function fakeLogger() {
	const records: LogRecord[] = [];
	const make = (scope?: string): Logger => {
		const at = (level: string) => (msg: string, fields?: Record<string, unknown>) => {
			records.push({level, scope, msg, fields});
		};
		return {
			error: at('error'),
			warn: at('warn'),
			info: at('info'),
			debug: at('debug'),
			child: child => make(scope ? `${scope}.${child}` : child),
			addRedactor() {},
		};
	};
	return {log: make(), records};
}
