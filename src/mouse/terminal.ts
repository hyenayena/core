import type {InputProxy} from './input.js';
import type {MouseInputEvent} from './sgr.js';

const ESC = String.fromCharCode(27);
export const MOUSE_ENABLE = `${ESC}[?1002h${ESC}[?1006h`;
export const MOUSE_DISABLE = `${ESC}[?1006l${ESC}[?1002l${ESC}[?1000l`;

export type MouseTerminal = {
	onMouse(listener: (e: MouseInputEvent) => void): () => void;
	setWanted(on: boolean): void;
	pause(): void;
	resume(): void;
	shutdown(): void;
};

export function createMouseTerminal(
	stdout: {isTTY?: boolean; write(s: string): unknown},
	proxy?: Pick<InputProxy, 'onMouse' | 'setEnabled'>,
): MouseTerminal {
	let wanted = false;
	let paused = false;
	let closed = false;
	let active = false;
	const canWrite = stdout.isTTY === true && proxy !== undefined;

	const sync = () => {
		const next = canWrite && wanted && !paused && !closed;
		if (next === active) return;
		active = next;
		try {
			stdout.write(next ? MOUSE_ENABLE : MOUSE_DISABLE);
		} catch {
		}
	};

	return {
		onMouse: listener => proxy?.onMouse(listener) ?? (() => {}),
		setWanted(on) {
			wanted = on;
			proxy?.setEnabled(on);
			sync();
		},
		pause() {
			paused = true;
			sync();
		},
		resume() {
			paused = false;
			sync();
		},
		shutdown() {
			closed = true;
			sync();
		},
	};
}
