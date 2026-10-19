import {createElement} from 'react';
import type {Command} from '../../../src/api.js';
import Settings from './components/Settings.js';
import {collectSettingsTabs} from './view/settings-tabs.js';
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
			run: (args, ctx) => ctx.print(args.join(' ')),
		},
		...extra,
		{
			name: 'settings',
			description: 'Open the settings',
			usage: 'settings',
			run: async (_args, ctx) => {
				if (!ctx.mount) throw new Error('"settings" needs an interface that can show views');
				const tabs = collectSettingsTabs(commands);
				await ctx.mount(control => createElement(Settings, {tabs, control}), {target: 'panel'});
			},
		},
		{
			name: 'clear',
			description: 'Clear the screen',
			run: (_args, ctx) => ctx.clear(),
		},
		{
			name: 'exit',
			description: 'Exit the application',
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
