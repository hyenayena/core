import type {Command, Setting, SettingAction, SettingsTab} from '../../../../src/api.js';

const MAX_TABS = 20;
const MAX_SETTINGS = 20;
const MAX_OPTIONS = 50;

const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';

function validSetting(raw: unknown): Setting | undefined {
	const s = raw as Partial<Setting> | null;
	if (!s || typeof s !== 'object') return undefined;
	if (!isText(s.key) || !isText(s.label) || typeof s.get !== 'function' || typeof s.set !== 'function') return undefined;
	if (!Array.isArray(s.options)) return undefined;
	const options = s.options
		.filter(o => o && typeof o === 'object' && typeof o.value === 'string' && isText(o.label))
		.slice(0, MAX_OPTIONS);
	if (options.length === 0) return undefined;
	return {...(s as Setting), options};
}

function validAction(raw: unknown): SettingAction | undefined {
	const s = raw as Partial<SettingAction> | null;
	if (!s || typeof s !== 'object' || !isText(s.key) || !isText(s.label) || typeof s.open !== 'function') return undefined;
	return s as SettingAction;
}

/** Settings tabs contributed by commands; malformed entries are dropped. */
export function collectSettingsTabs(commands: Command[]): SettingsTab[] {
	const tabs: SettingsTab[] = [];
	for (const command of commands) {
		try {
			const tab = command?.settings;
			if (!tab || typeof tab !== 'object' || !isText(tab.title) || !Array.isArray(tab.settings)) continue;
			const settings = tab.settings.map(validSetting).filter((s): s is Setting => s !== undefined).slice(0, MAX_SETTINGS);
			const actions = (Array.isArray(tab.actions) ? tab.actions : []).map(validAction).filter((a): a is SettingAction => a !== undefined).slice(0, MAX_SETTINGS);
			if (settings.length > 0 || actions.length > 0) tabs.push({title: tab.title, settings, ...(actions.length > 0 && {actions})});
		} catch {
			continue;
		}
		if (tabs.length >= MAX_TABS) break;
	}
	return tabs;
}
