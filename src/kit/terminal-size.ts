import {useCallback, useSyncExternalStore} from 'react';
import {useStdout} from 'ink';

export type TerminalSize = {columns: number; rows: number};

type Out = {
	columns?: number;
	rows?: number;
	on(event: 'resize', fn: () => void): unknown;
	off(event: 'resize', fn: () => void): unknown;
};

const sizes = new WeakMap<object, TerminalSize>();
const subscriptions = new WeakMap<object, {listeners: Set<() => void>; onResize: () => void}>();

export function terminalSizeOf(stdout: Out): TerminalSize {
	const columns = stdout.columns && stdout.columns > 0 ? stdout.columns : 80;
	const rows = stdout.rows && stdout.rows > 0 ? stdout.rows : 24;
	const cached = sizes.get(stdout);
	if (cached && cached.columns === columns && cached.rows === rows) return cached;
	const next = {columns, rows};
	sizes.set(stdout, next);
	return next;
}

export function subscribeTerminalSize(stdout: Out, fn: () => void): () => void {
	let entry = subscriptions.get(stdout);
	if (!entry) {
		const listeners = new Set<() => void>();
		entry = {
			listeners,
			onResize: () => {
				for (const listener of [...listeners]) listener();
			},
		};
		subscriptions.set(stdout, entry);
		stdout.on('resize', entry.onResize);
	}
	entry.listeners.add(fn);
	const owner = entry;
	return () => {
		owner.listeners.delete(fn);
		if (owner.listeners.size === 0 && subscriptions.get(stdout) === owner) {
			stdout.off('resize', owner.onResize);
			subscriptions.delete(stdout);
		}
	};
}

export function useTerminalSize(): TerminalSize {
	const {stdout} = useStdout();
	const subscribe = useCallback((fn: () => void) => subscribeTerminalSize(stdout, fn), [stdout]);
	return useSyncExternalStore(subscribe, () => terminalSizeOf(stdout));
}
