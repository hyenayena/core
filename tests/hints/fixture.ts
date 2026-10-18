import {buildCatalog} from '../../src/hints/catalog.js';
import {computeHints} from '../../src/hints/model.js';
import type {StepEnv} from '../../src/hints/editor.js';

export const catalog = buildCatalog([
	{name: 'help', description: 'Show help'},
	{name: 'echo', description: 'Print text', usage: 'echo [text]…'},
	{name: 'exit', description: 'Quit'},
	{name: 'clear', description: 'Clear screen'},
	{
		name: 'mod',
		description: 'Manage modules',
		usage: 'mod <install|update|remove|list|help> [args]',
		subcommands: [
			{name: 'install', aliases: ['i'], usage: 'mod install [source]…', description: 'Install modules'},
			{name: 'update', aliases: ['up'], usage: 'mod update [name]…', description: 'Update modules'},
			{name: 'remove', aliases: ['rm'], usage: 'mod remove <name>…', description: 'Remove modules'},
			{name: 'list', aliases: ['ls'], usage: 'mod list', description: 'List modules'},
		],
	},
	{
		name: 'claude',
		description: 'Claude tools',
		subcommands: [
			{name: 'ask', usage: 'claude ask [--new] <text>', description: 'Ask'},
			{
				name: 'auth',
				usage: 'claude auth',
				description: 'Authentication',
				subcommands: [
					{name: 'login', usage: 'claude auth login', description: 'Log in'},
					{name: 'logout', usage: 'claude auth logout', description: 'Log out'},
				],
			},
		],
	},
]);

export const env = (history: string[] = []): StepEnv => ({
	history,
	hints: value => computeHints(catalog, value),
});
