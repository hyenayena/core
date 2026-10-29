import assert from 'node:assert/strict';
import {test} from 'node:test';
import {COMMAND_TOOLS, formatCommandList, formatRunResult, resolveCommandLine} from '../../src/kit/text.js';
import type {CommandInfo} from '../../../../src/api.js';

const HINT = 'Arguments and options: help <command> [subcommand…]';

test('tool specs are neutral JSON Schema', () => {
	assert.equal(COMMAND_TOOLS.list_commands.name, 'list_commands');
	assert.deepEqual(COMMAND_TOOLS.list_commands.inputSchema.properties, {});
	const run = COMMAND_TOOLS.run_command;
	assert.deepEqual(run.inputSchema.required, ['command']);
	assert.deepEqual(run.inputSchema.properties['command'], {type: 'string', maxLength: 4096, description: 'The full command line, command name first'});
	assert.doesNotThrow(() => JSON.stringify(COMMAND_TOOLS));
});

test('formatCommandList lists commands, subcommands and policies', () => {
	assert.equal(formatCommandList([]), 'No commands are available.');
	const text = formatCommandList([
		{name: 'mod', description: 'Modules', usage: 'mod <sub>', policy: 'confirm', subcommands: [{name: 'list', aliases: ['ls'], usage: 'mod list', description: 'Show', policy: 'safe'}]},
		{name: 'help', description: '', policy: 'safe', subcommands: []},
	]);
	assert.equal(text, `mod <sub> [confirm] - Modules\n  mod list (ls) [safe] - Show\nhelp [safe]\n${HINT}`);
});

test('formatRunResult explains non-ok statuses and truncation', () => {
	const base = {truncated: false, ms: 1};
	assert.equal(formatRunResult({...base, status: 'ok', output: 'hi'}), 'hi');
	assert.equal(formatRunResult({...base, status: 'ok', output: ''}), '(no output)');
	assert.equal(formatRunResult({...base, status: 'denied', output: '', reason: 'nope'}), 'Command denied: nope');
	assert.equal(formatRunResult({...base, status: 'timeout', output: 'part', truncated: true}), 'Command timeout\npart\n[output truncated]');
});

test('formatCommandList names the entries the assistant cannot run in one closing line', () => {
	const sub = (name: string, policy: 'safe' | 'confirm' | 'deny') => ({name, aliases: [], usage: `claude ${name}`, description: `${name} it`, policy});
	const text = formatCommandList([
		{name: 'claude', description: 'Claude', policy: 'deny', subcommands: [sub('ping', 'confirm'), sub('docx', 'deny'), sub('pdf', 'deny')]},
		{name: 'chat', description: 'Chat', policy: 'deny', subcommands: []},
		{name: 'one', description: '', policy: 'safe', subcommands: [sub('x', 'deny')]},
	]);
	assert.equal(
		text,
		`claude [deny] - Claude\n  claude ping [confirm] - ping it\none [safe]\nNot available to the assistant (the user runs them): 2 claude subcommands, chat, 1 one subcommand.\n${HINT}`,
	);
});

const nested: CommandInfo[] = [
	{
		name: 'claude',
		description: 'Claude',
		usage: 'claude <subcommand>',
		policy: 'confirm',
		subcommands: [
			{
				name: 'auth',
				aliases: ['a'],
				usage: 'claude auth <subcommand>',
				description: 'Auth',
				policy: 'confirm',
				subcommands: [
					{name: 'status', aliases: [], usage: 'claude auth status', description: 'Status', policy: 'safe'},
					{name: 'login', aliases: ['in'], usage: 'claude auth login', description: 'Log in', policy: 'deny'},
					{name: 'help', aliases: [], usage: 'claude auth help [subcommand…]', description: 'Help', policy: 'safe'},
				],
			},
			{name: 'skills', aliases: [], usage: 'claude skills', description: 'Skills', policy: 'deny', subcommands: [{name: 'x', aliases: [], usage: 'claude skills x', description: 'X', policy: 'deny'}]},
			{name: 'help', aliases: [], usage: 'claude help [subcommand…]', description: 'Help', policy: 'safe'},
		],
	},
];

test('formatCommandList indents nested subcommands, leaves out the builtin help and counts every denied node', () => {
	assert.equal(
		formatCommandList(nested),
		[
			'claude <subcommand> [confirm] - Claude',
			'  claude auth <subcommand> (a) [confirm] - Auth',
			'    claude auth status [safe] - Status',
			'Not available to the assistant (the user runs them): 3 claude subcommands.',
			HINT,
		].join('\n'),
	);
	const declared = formatCommandList([{name: 'm', description: '', policy: 'safe', subcommands: [{name: 'help', aliases: [], usage: 'm help', description: 'Own help', policy: 'confirm'}]}]);
	assert.match(declared, /^ {2}m help \[confirm\] - Own help$/m);
});

test('resolveCommandLine walks names before aliases and takes the deepest listed policy', () => {
	assert.deepEqual(resolveCommandLine(nested, 'claude auth status --json'), {command: 'claude', subcommand: 'auth status', policy: 'safe'});
	assert.deepEqual(resolveCommandLine(nested, '  claude a in '), {command: 'claude', subcommand: 'auth login', policy: 'deny'});
	assert.deepEqual(resolveCommandLine(nested, 'claude auth help login'), {command: 'claude', subcommand: 'auth help', policy: 'safe'});
	assert.deepEqual(resolveCommandLine(nested, 'claude nope'), {command: 'claude', policy: 'confirm'});
	assert.equal(resolveCommandLine(nested, 'other'), undefined);
	assert.equal(resolveCommandLine(nested, '   '), undefined);
	assert.equal(resolveCommandLine(nested, 5 as never), undefined);
});
