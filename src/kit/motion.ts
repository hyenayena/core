export const MOTION_ENV = 'YENA_MOTION';

type Env = Readonly<Record<string, string | undefined>>;

export function motionFromEnv(env: Env): 'full' | 'reduced' | undefined {
	const value = env[MOTION_ENV]?.trim().toLowerCase();
	if (value === 'off' || value === 'reduced') return 'reduced';
	if (value === 'on' || value === 'full') return 'full';
	return undefined;
}

let envMotion: 'full' | 'reduced' | undefined;
let envRead = false;
let prefReduced = false;
const overrides: boolean[] = [];
const listeners = new Set<() => void>();

const fromEnv = (): 'full' | 'reduced' | undefined => {
	if (!envRead) {
		envMotion = motionFromEnv(process.env);
		envRead = true;
	}
	return envMotion;
};

export function reducedMotion(): boolean {
	const top = overrides.at(-1);
	if (top !== undefined) return top;
	const env = fromEnv();
	return env === undefined ? prefReduced : env === 'reduced';
}

export function motionFixedBy(): string | undefined {
	return fromEnv() === undefined ? undefined : MOTION_ENV;
}

export function subscribeMotion(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const notify = (): void => {
	for (const l of [...listeners]) l();
};

export function setMotionPref(reduced: boolean): void {
	const before = reducedMotion();
	prefReduced = reduced;
	if (reducedMotion() !== before) notify();
}

export function withReducedMotion<T>(on: boolean, fn: () => T): T {
	overrides.push(on);
	try {
		return fn();
	} finally {
		overrides.pop();
	}
}

export function resetMotionForTests(): void {
	envMotion = undefined;
	envRead = false;
	prefReduced = false;
	overrides.length = 0;
	listeners.clear();
}
