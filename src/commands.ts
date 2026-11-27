import type {Command, CommandContext, EventBus, Logger, MountControl, SettingsTab, UiElement} from '../../../src/api.js';
import {reportReload, type ReloadNotice} from './kit/reload.js';
import {runSourceOf} from './run-source.js';
import {collectSettingsTabs} from './view/settings-tabs.js';
import {AGENT_MODES, getPrefs, setPrefs, TITLE_BAR_COLORS, type AgentMode, type TitleBarColor} from './view/prefs.js';
import {buildCatalog, type Catalog} from './hints/catalog.js';
import {helpBlocks, helpError, helpLines} from './hints/help.js';
import {MAX_STYLED_BLOCKS, printStyled} from './kit/styled.js';
import {helpTarget} from './hints/path.js';
import {commandError} from './kit/command-error.js';
import {currentTimeZone, configuredTimeZone, formatUtcOffset, zonedParts} from './kit/time.js';
import {MOTION_ENV, motionFixedBy, reducedMotion} from './kit/motion.js';
import {noopLog} from './noop-log.js';
import {createUiCommand} from './gallery/command.js';
import {createTransferCommands, type TransferDeps} from './transfer/commands.js';

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

function timeTab(openTimeZone?: (control: MountControl) => UiElement): SettingsTab {
	return {
		title: 'Time',
		settings: [],
		actions: [
			{
				key: 'timeZone',
				label: 'Time zone…',
				description: `${currentTimeZone()} (${formatUtcOffset(zonedParts(Date.now()).offsetMinutes)})${configuredTimeZone() ? '' : ', the system zone'} · the chat's current time and the scheduler's daily and cron jobs follow it`,
				open: control => {
					if (!openTimeZone) throw new Error('The form is still loading; open it again');
					return openTimeZone(control);
				},
			},
		],
	};
}

export const settingsTabs = (commands: Command[], opts: {openTimeZone?: (control: MountControl) => UiElement} = {}): SettingsTab[] => [
	...collectSettingsTabs(commands),
	assistantTab(),
	timeTab(opts.openTimeZone),
];

function appearanceTab(): SettingsTab {
	const fixedBy = motionFixedBy();
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
				key: 'motion',
				label: 'Motion',
				description: fixedBy
					? `Spinners, the status bar shimmer and the chat banner intro; set by ${fixedBy} in the environment`
					: `Spinners, the status bar shimmer and the chat banner intro; Reduced shows them still (${MOTION_ENV}=off also reduces them)`,
				options: [
					{value: 'full', label: 'Full'},
					{value: 'reduced', label: 'Reduced'},
				],
				get: () => (fixedBy ? (reducedMotion() ? 'reduced' : 'full') : getPrefs().motion),
				set: value => setPrefs({motion: value === 'reduced' ? 'reduced' : 'full'}),
				...(fixedBy && {readOnly: `Set by ${fixedBy} in the environment; unset it and restart yena to change it here`}),
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
	if (problem !== undefined) throw commandError('usage', problem);
	const blocks = helpBlocks(catalog, path);
	if (blocks.length > MAX_STYLED_BLOCKS) ctx.print(helpLines(catalog, path).join('\n'));
	else printStyled(ctx, blocks);
}

export function createRegistry(extra: Command[], log: Logger = noopLog, options: {transfer?: TransferDeps; reload?: () => void; events?: EventBus} = {}): Registry {
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
		createUiCommand(log),
		...extra,
		...(options.transfer ? createTransferCommands(options.transfer) : []),
		{
			name: 'settings',
			description: 'Open the settings',
			usage: 'settings',
			agent: 'deny',
			settings: appearanceTab(),
			run: async (_args, ctx) => {
				if (!ctx.mount) throw new Error('"settings" needs an interface that can show views');
				const [{createElement}, {default: Settings}, {timeZoneField}] = await Promise.all([
					import('react'),
					import('./components/Settings.js'),
					import('./view/time-zone-field.js'),
				]);
				const opts = {openTimeZone: timeZoneField};
				const tabs = settingsTabs(commands, opts);
				await ctx.mount(control => createElement(Settings, {tabs, control, reload: () => settingsTabs(commands, opts)}), {target: 'panel'});
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
		{
			name: 'reload',
			description: 'Restart yena; an open chat in this app is cut off',
			usage: 'reload',
			notes: [
				'Ends this run like exit and starts yena again (code, modules and the start mode are read anew).',
				'An open chat stops; one kept working in the background (Keep working after exit) goes on and can be reopened with chat. When the reload was typed in that chat or run by its assistant, the chat opens again after the start.',
				'Works when yena was started with ./yena or ./yena start; ./yena restart restarts the whole container instead.',
			],
			agent: 'confirm',
			run: (_args, ctx) => {
				if (ctx.headless) throw new Error('reload restarts the running app and cannot run from the terminal; ./yena restart restarts the container');
				if (!options.reload) {
					throw new Error('reload needs the yena script: this app was not started with ./yena or ./yena start, so nothing would start it again; use exit and start it yourself');
				}
				const source = runSourceOf(ctx);
				const notice: ReloadNotice =
					typeof ctx.caller === 'string' ? {via: 'bridge', caller: ctx.caller} : source ? {via: 'view', view: source.view} : {via: 'console'};
				reportReload(options.events, notice);
				options.reload();
				ctx.exit();
			},
		},
	];

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
