import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {setColorsEnabled} from '../kit/theme.js';
import {setMotionPref} from '../kit/motion.js';
import {canonicalTimeZone, setTimeZone} from '../kit/time.js';

export const TITLE_BAR_COLORS = ['olive', 'blue', 'teal', 'gray', 'inverse'] as const;
export type TitleBarColor = (typeof TITLE_BAR_COLORS)[number];
export const AGENT_MODES = ['policy', 'ask', 'off'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];
export type CorePrefs = {titleBar: TitleBarColor; colors: boolean; mouse: boolean; agentCommands: AgentMode; motion: 'full' | 'reduced'; panelShare: number; timeZone?: string};

export const DEFAULT_PREFS: CorePrefs = {titleBar: 'olive', colors: true, mouse: true, agentCommands: 'policy', motion: 'full', panelShare: 0.4};

const validShare = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 0.9;

let prefs: CorePrefs = {...DEFAULT_PREFS};
let file: string | undefined;
const listeners = new Set<() => void>();

const clean = (raw: unknown): CorePrefs => {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CorePrefs>;
	const zone = canonicalTimeZone(r.timeZone);
	return {
		titleBar: TITLE_BAR_COLORS.includes(r.titleBar as TitleBarColor) ? (r.titleBar as TitleBarColor) : DEFAULT_PREFS.titleBar,
		colors: typeof r.colors === 'boolean' ? r.colors : DEFAULT_PREFS.colors,
		mouse: typeof r.mouse === 'boolean' ? r.mouse : DEFAULT_PREFS.mouse,
		agentCommands: AGENT_MODES.includes(r.agentCommands as AgentMode) ? (r.agentCommands as AgentMode) : DEFAULT_PREFS.agentCommands,
		motion: r.motion === 'reduced' || r.motion === 'full' ? r.motion : DEFAULT_PREFS.motion,
		panelShare: validShare(r.panelShare) ? r.panelShare : DEFAULT_PREFS.panelShare,
		...(zone !== undefined && {timeZone: zone}),
	};
};

export function loadPrefs(dataDir: string): CorePrefs {
	file = path.join(dataDir, 'appearance.json');
	try {
		prefs = clean(JSON.parse(readFileSync(file, 'utf8')));
	} catch {
		prefs = {...DEFAULT_PREFS};
	}
	setColorsEnabled(prefs.colors);
	setMotionPref(prefs.motion === 'reduced');
	setTimeZone(prefs.timeZone);
	return prefs;
}

export const getPrefs = (): CorePrefs => prefs;

export function setPrefs(patch: Partial<CorePrefs>): void {
	prefs = clean({...prefs, ...patch});
	setColorsEnabled(prefs.colors);
	setMotionPref(prefs.motion === 'reduced');
	setTimeZone(prefs.timeZone);
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
