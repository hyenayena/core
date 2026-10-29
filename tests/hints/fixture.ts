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
	{
		name: 'doc',
		description: 'Documented',
		usage: 'doc <subcommand>',
		args: [{name: 'subcommand', description: 'What to run'}],
		subcommands: [
			{
				name: 'ask',
				usage: 'doc ask [--new] [--model <m>] <text…>',
				description: 'Ask',
				agent: 'safe',
				args: [{name: 'text', description: 'What to ask'}],
				options: [
					{name: '--new', description: 'Start a new chat'},
					{name: '--model', aliases: ['-m'], value: '<m>', description: 'Model to use'},
				],
				notes: ['The answer streams into the chat'],
			},
			{
				name: 'auth',
				usage: 'doc auth <login|logout>',
				description: 'Authentication',
				agent: 'confirm',
				args: [{name: 'login|logout', description: 'Subcommand'}],
				subcommands: [
					{name: 'login', usage: 'doc auth login [account]', description: 'Log in', agent: 'safe', args: [{name: 'account', description: 'Account name'}]},
					{name: 'logout', usage: 'doc auth logout', description: 'Log out', agent: 'deny'},
					{name: 'status', usage: 'doc auth status', description: 'Show the login'},
				],
			},
		],
	},
]);

export const env = (history: string[] = []): StepEnv => ({
	history,
	hints: value => computeHints(catalog, value),
});
