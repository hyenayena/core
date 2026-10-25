import type {Command} from '../../../src/api.js';
import {collectSettingsTabs} from './view/settings-tabs.js';
import {AGENT_MODES, getPrefs, setPrefs, TITLE_BAR_COLORS, type AgentMode, type TitleBarColor} from './view/prefs.js';
import type {SettingsTab} from '../../../src/api.js';

const LABEL: Record<TitleBarColor, string> = {olive: 'Olive', blue: 'Blue', teal: 'Teal', gray: 'Gray', inverse: 'Inverse'};

const AGENT_LABEL: Record<AgentMode, string> = {policy: 'By policy', ask: 'Always ask', off: 'Off'};

function assistantTab(): SettingsTab {
	return {
		title: 'Assistant',
		settings: [
			{
				key: 'agentCommands',
				label: 'Console commands',
				description: 'Whether an assistant may run console commands: as each command allows, always after asking you, or never',
				options: AGENT_MODES.map(value => ({value, label: AGENT_LABEL[value]})),
				get: () => getPrefs().agentCommands,
				set: value => setPrefs({agentCommands: value as AgentMode}),
			},
		],
	};
}

/** Settings tabs in display order: the commands' own, then core's Assistant tab. */
export const settingsTabs = (commands: Command[]): SettingsTab[] => [...collectSettingsTabs(commands), assistantTab()];

function appearanceTab(): SettingsTab {
	return {
		title: 'Appearance',
		settings: [
			{
				key: 'titleBar',
				label: 'Title bar',
				description: 'Colour of the bar above the chat',
				options: TITLE_BAR_COLORS.map(value => ({value, label: LABEL[value]})),
				get: () => getPrefs().titleBar,
				set: value => setPrefs({titleBar: value as TitleBarColor}),
			},
			{
				key: 'colors',
				label: 'Colours',
				description: 'Colours in the console and hints (NO_COLOR also turns them off)',
				options: [
					{value: 'on', label: 'On'},
					{value: 'off', label: 'Off'},
				],
				get: () => (getPrefs().colors ? 'on' : 'off'),
				set: value => setPrefs({colors: value !== 'off'}),
			},
			{
				key: 'mouse',
				label: 'Mouse',
				description: 'Wheel scrolls, click focuses and moves the cursor. Hold Shift (Option in iTerm2, Fn in macOS Terminal) to select text',
				options: [
					{value: 'on', label: 'On'},
					{value: 'off', label: 'Off'},
				],
				get: () => (getPrefs().mouse ? 'on' : 'off'),
				set: value => setPrefs({mouse: value !== 'off'}),
			},
		],
	};
}
import {buildCatalog} from './hints/catalog.js';
import {helpLines} from './hints/help.js';
import {unknownCommandLines} from './hints/typo.js';

export type Registry = {
	commands: Command[];
	find: (name: string) => Command | undefined;
};

/** Builds the command list: core's own commands plus the ones yena provides. */
export function createRegistry(extra: Command[]): Registry {
	const commands: Command[] = [
		{
			name: 'help',
			description: 'Show the list of commands',
				agent: 'safe',
			run: (args, ctx) => {
				const catalog = buildCatalog(commands);
				const name = args[0];
				if (name !== undefined && !catalog.byName.has(name)) {
					const [unknown, hint] = unknownCommandLines(catalog, name);
					throw new Error(hint === undefined ? unknown! : `${unknown}. ${hint}`);
				}
				for (const line of helpLines(catalog, name)) ctx.print(line);
			},
		},
		{
			name: 'echo',
			description: 'Print text',
				agent: 'safe',
			run: (args, ctx) => ctx.print(args.join(' ')),
		},
		...extra,
		{
			name: 'settings',
			description: 'Open the settings',
			usage: 'settings',
				agent: 'deny',
			settings: appearanceTab(),
			run: async (_args, ctx) => {
				if (!ctx.mount) throw new Error('"settings" needs an interface that can show views');
				const [{createElement}, {default: Settings}] = await Promise.all([import('react'), import('./components/Settings.js')]);
				const tabs = settingsTabs(commands);
				await ctx.mount(control => createElement(Settings, {tabs, control, reload: () => settingsTabs(commands)}), {target: 'panel'});
			},
		},
		{
			name: 'clear',
			description: 'Clear the screen',
				agent: 'confirm',
			run: (_args, ctx) => ctx.clear(),
		},
		{
			name: 'exit',
			description: 'Exit the application',
				agent: 'confirm',
			run: (_args, ctx) => ctx.exit(),
		},
	];

	return {
		commands,
		find: name => {
			for (const c of commands) {
				try {
					if (c.name === name) return c;
				} catch {
					continue;
				}
			}
			return undefined;
		},
	};
}
