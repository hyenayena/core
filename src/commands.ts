import type {Command, CommandContext, SettingsTab} from '../../../src/api.js';
import {collectSettingsTabs} from './view/settings-tabs.js';
import {AGENT_MODES, getPrefs, setPrefs, TITLE_BAR_COLORS, type AgentMode, type TitleBarColor} from './view/prefs.js';
import {buildCatalog, type Catalog} from './hints/catalog.js';
import {helpError, helpLines} from './hints/help.js';
import {helpTarget} from './hints/path.js';

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
export type Registry = {
	commands: Command[];
	find: (name: string) => Command | undefined;
};

function printHelp(catalog: Catalog, path: readonly string[], ctx: CommandContext): void {
	const problem = helpError(catalog, path);
	if (problem !== undefined) throw new Error(problem);
	for (const line of helpLines(catalog, path)) ctx.print(line);
}

/** Builds the command list: core's own commands plus the ones yena provides. */
export function createRegistry(extra: Command[]): Registry {
	const commands: Command[] = [
		{
			name: 'help',
			description: 'Show the commands, or the details of one',
			usage: 'help [command] [subcommand…]',
			args: [
				{name: 'command', description: 'Command to describe'},
				{name: 'subcommand', description: 'Path of the subcommand to describe'},
			],
			agent: 'safe',
			run: (args, ctx) => printHelp(buildCatalog(commands), args, ctx),
		},
		{
			name: 'echo',
			description: 'Print text',
			usage: 'echo <text…>',
			args: [{name: 'text', description: 'Text to print'}],
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
			usage: 'clear',
			agent: 'confirm',
			run: (_args, ctx) => ctx.clear(),
		},
		{
			name: 'exit',
			description: 'Exit the application',
			usage: 'exit',
			agent: 'confirm',
			run: (_args, ctx) => ctx.exit(),
		},
	];

	// Cached so a command keeps one identity; a prototype link keeps getters such as `settings` live.
	const wrapped = new WeakMap<Command, Command>();
	const withHelp = (original: Command, name: string): Command => {
		let w = wrapped.get(original);
		if (w) return w;
		const run: Command['run'] = (args, ctx) => {
			const target = helpTarget(buildCatalog(commands), name, Array.isArray(args) ? args : []);
			if (target) return printHelp(buildCatalog(commands), target, ctx);
			const showHelp = (path?: string[]) => {
				const tail = Array.isArray(path) ? path.filter((p): p is string => typeof p === 'string') : [];
				printHelp(buildCatalog(commands), [name, ...tail], ctx);
			};
			return original.run(args, {...ctx, showHelp});
		};
		w = Object.create(original, {run: {value: run, enumerable: true}}) as Command;
		wrapped.set(original, w);
		return w;
	};

	return {
		commands,
		find: name => {
			for (const c of commands) {
				try {
					if (c.name === name) return withHelp(c, name);
				} catch {
					continue;
				}
			}
			return undefined;
		},
	};
}
