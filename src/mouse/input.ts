import {Readable} from 'node:stream';
import {createMouseTokenizer, decode, type MouseInputEvent} from './sgr.js';

export type InputSource = {
	setEncoding(encoding: BufferEncoding): unknown;
	on(event: 'readable', listener: () => void): unknown;
	removeListener(event: 'readable', listener: () => void): unknown;
	read(): string | Buffer | null;
	setRawMode?: (mode: boolean) => unknown;
	isRaw?: boolean;
	ref?: () => unknown;
	unref?: () => unknown;
};

type TimerHandle = {unref?: () => unknown};
export type ProxyTimers = {
	setTimeout(fn: () => void, ms: number): TimerHandle;
	clearTimeout(handle: TimerHandle): void;
};

export type ProxyStream = Readable & {
	readonly isTTY: true;
	readonly isRaw: boolean;
	setRawMode(mode: boolean): ProxyStream;
	ref(): ProxyStream;
	unref(): ProxyStream;
};

export type InputProxy = {
	stream: ProxyStream;
	onMouse(listener: (e: MouseInputEvent) => void): () => void;
	setEnabled(on: boolean): void;
};

const SHORT_HOLD_MS = 10;
const LONG_HOLD_MS = 50;

const defaultSize = () => ({columns: process.stdout.columns ?? 0, rows: process.stdout.rows ?? 0});

export function createInputProxy(
	source: InputSource,
	options: {timers?: ProxyTimers; size?: () => {columns: number; rows: number}} = {},
): InputProxy {
	const timers: ProxyTimers = options.timers ?? {
		setTimeout: (fn, ms) => setTimeout(fn, ms),
		clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
	};
	const size = options.size ?? defaultSize;
	const tokenizer = createMouseTokenizer();
	const listeners = new Set<(e: MouseInputEvent) => void>();
	let enabled = false;
	let attached = false;
	let timer: TimerHandle | undefined;

	const readable = new Readable({read() {}, encoding: 'utf8'});
	const stream = readable as ProxyStream;

	const cancelTimer = () => {
		if (timer === undefined) return;
		timers.clearTimeout(timer);
		timer = undefined;
	};

	const release = () => {
		timer = undefined;
		const text = tokenizer.flush();
		if (text) stream.push(text);
	};

	const schedule = (ms: number) => {
		timer = timers.setTimeout(release, ms);
		timer.unref?.();
	};

	const dispatch = (event: MouseInputEvent) => {
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch {
				// A failing listener must not break keyboard input.
			}
		}
	};

	const handle = (chunk: string) => {
		cancelTimer();
		const result = tokenizer.push(chunk);
		if (result.text) stream.push(result.text);
		if (enabled && result.events.length > 0) {
			let screen: {columns: number; rows: number};
			try {
				screen = size();
			} catch {
				screen = {columns: 0, rows: 0};
			}
			for (const raw of result.events) {
				const event = decode(raw, screen.columns, screen.rows);
				if (event) dispatch(event);
			}
		}
		if (result.hold === 'short' && !enabled) {
			release();
		} else if (result.hold !== 'none') {
			schedule(result.hold === 'short' ? SHORT_HOLD_MS : LONG_HOLD_MS);
		}
	};

	const onSourceReadable = () => {
		let chunk: string | Buffer | null;
		while ((chunk = source.read()) !== null) handle(String(chunk));
	};

	const attach = () => {
		if (attached) return;
		attached = true;
		source.setEncoding('utf8');
		source.on('readable', onSourceReadable);
	};

	// While nobody reads the proxy (a suspended terminal), the source is not drained either.
	const detach = () => {
		if (!attached) return;
		attached = false;
		source.removeListener('readable', onSourceReadable);
	};

	readable.on('newListener', (event: string | symbol) => {
		if (event === 'readable') attach();
	});
	readable.on('removeListener', (event: string | symbol) => {
		if (event === 'readable' && readable.listenerCount('readable') === 0) detach();
	});

	Object.defineProperty(stream, 'isTTY', {value: true});
	Object.defineProperty(stream, 'isRaw', {get: () => source.isRaw === true});
	stream.setRawMode = (mode: boolean) => {
		source.setRawMode?.(mode);
		return stream;
	};
	stream.ref = () => {
		source.ref?.();
		return stream;
	};
	stream.unref = () => {
		source.unref?.();
		return stream;
	};
	stream.setEncoding = (encoding?: BufferEncoding) => {
		if (encoding !== undefined && encoding.toLowerCase() !== 'utf8' && encoding.toLowerCase() !== 'utf-8') {
			throw new Error(`Unsupported input encoding: ${encoding}`);
		}
		return stream;
	};

	return {
		stream,
		onMouse(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		setEnabled(on) {
			enabled = on;
			// X10 reports carry raw bytes that look like text, so they are only consumed while mouse reporting is wanted.
			tokenizer.setX10(on);
		},
	};
}
