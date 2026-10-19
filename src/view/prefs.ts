import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

export const TITLE_BAR_COLORS = ['olive', 'blue', 'teal', 'gray', 'inverse'] as const;
export type TitleBarColor = (typeof TITLE_BAR_COLORS)[number];
export type CorePrefs = {titleBar: TitleBarColor; colors: boolean};

export const DEFAULT_PREFS: CorePrefs = {titleBar: 'olive', colors: true};

let prefs: CorePrefs = {...DEFAULT_PREFS};
let file: string | undefined;
const listeners = new Set<() => void>();

const clean = (raw: unknown): CorePrefs => {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CorePrefs>;
	return {
		titleBar: TITLE_BAR_COLORS.includes(r.titleBar as TitleBarColor) ? (r.titleBar as TitleBarColor) : DEFAULT_PREFS.titleBar,
		colors: typeof r.colors === 'boolean' ? r.colors : DEFAULT_PREFS.colors,
	};
};

/** Reads `<dataDir>/appearance.json`; a missing or broken file gives the defaults. */
export function loadPrefs(dataDir: string): CorePrefs {
	file = path.join(dataDir, 'appearance.json');
	try {
		prefs = clean(JSON.parse(readFileSync(file, 'utf8')));
	} catch {
		prefs = {...DEFAULT_PREFS};
	}
	return prefs;
}

export const getPrefs = (): CorePrefs => prefs;

export function setPrefs(patch: Partial<CorePrefs>): void {
	prefs = clean({...prefs, ...patch});
	if (file) {
		mkdirSync(path.dirname(file), {recursive: true});
		writeFileSync(file, JSON.stringify(prefs, null, '\t') + '\n');
	}
	for (const l of [...listeners]) l();
}

export function subscribePrefs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
