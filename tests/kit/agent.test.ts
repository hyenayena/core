import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	BATCH_MAX_LINES,
	COMMAND_TOOLS,
	formatBatchResult,
	formatCommandList,
	formatCommandTree,
	formatRunResult,
	resolveCommandLine,
} from '../../src/kit/text.js';
import type {CommandInfo} from '../../../../src/api.js';

const HINT = 'Arguments and options: help <command> [subcommand…]. Quote an argument that holds spaces: "a b" or \'a b\'.';
const LIST_HINT = `Subcommands: list_commands {"command": "<name>"}. ${HINT}`;

test('tool specs are neutral JSON Schema', () => {
	assert.equal(COMMAND_TOOLS.list_commands.name, 'list_commands');
	assert.deepEqual(COMMAND_TOOLS.list_commands.inputSchema.properties, {
		command: {type: 'string', maxLength: 200, description: 'Command name, optionally followed by subcommand words'},
	});
	assert.deepEqual(COMMAND_TOOLS.list_commands.inputSchema.required, []);
	const run = COMMAND_TOOLS.run_command;
	assert.deepEqual(run.inputSchema.required, []);
	assert.deepEqual(run.inputSchema.properties['command'], {type: 'string', maxLength: 4096, description: 'The full command line, command name first'});
	assert.deepEqual(run.inputSchema.properties['commands'], {type: 'array', items: {type: 'string', maxLength: 4096}, minItems: 1, maxItems: BATCH_MAX_LINES});
	assert.deepEqual(run.inputSchema.properties['stopOnError'], {type: 'boolean'});
	const read = COMMAND_TOOLS.read_output;
	assert.equal(read.name, 'read_output');
	assert.deepEqual(read.inputSchema.required, ['id']);
	assert.deepEqual(Object.keys(read.inputSchema.properties), ['id', 'from', 'lines', 'grep']);
	assert.doesNotThrow(() => JSON.stringify(COMMAND_TOOLS));
});

test('formatCommandList lists commands, subcommands and policies', () => {
	assert.equal(formatCommandList([]), 'No commands are available.');
	const text = formatCommandList([
		{name: 'mod', description: 'Modules', usage: 'mod <sub>', policy: 'confirm', subcommands: [{name: 'list', aliases: ['ls'], usage: 'mod list', description: 'Show', policy: 'safe'}]},
		{name: 'help', description: '', policy: 'safe', subcommands: []},
	]);
	assert.equal(text, `mod <sub> [confirm] - Modules (1 subcommand)\nhelp [safe]\n${LIST_HINT}`);
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
		`claude [deny] - Claude (1 subcommand)\none [safe]\nNot available to the assistant (the user runs them): 2 claude subcommands, chat, 1 one subcommand.\n${LIST_HINT}`,
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

test('formatCommandList shows only the top level with a subcommand count and counts every denied node', () => {
	assert.equal(
		formatCommandList(nested),
		[
			'claude <subcommand> [confirm] - Claude (2 subcommands)',
			'Not available to the assistant (the user runs them): 3 claude subcommands.',
			LIST_HINT,
		].join('\n'),
	);
	const declared = formatCommandList([{name: 'm', description: '', policy: 'safe', subcommands: [{name: 'help', aliases: [], usage: 'm help', description: 'Own help', policy: 'confirm'}]}]);
	assert.match(declared, /^m \[safe\] \(1 subcommand\)$/m);
});

test('formatCommandTree indents the subcommands of one command, by name or alias', () => {
	assert.deepEqual(formatCommandTree(nested, 'claude'), {
		found: true,
		text: [
			'claude <subcommand> [confirm] - Claude',
			'  claude auth <subcommand> (a) [confirm] - Auth',
			'    claude auth status [safe] - Status',
			'Not available to the assistant (the user runs them): 3 claude subcommands.',
			'Arguments and options: help claude [subcommand…]. Quote an argument that holds spaces: "a b" or \'a b\'.',
		].join('\n'),
	});
	const auth = formatCommandTree(nested, ' claude   a ');
	assert.equal(auth.found, true);
	assert.match(auth.text, /^claude auth <subcommand> \(a\) \[confirm\] - Auth\n {2}claude auth status \[safe\] - Status\n/);
	assert.match(auth.text, /1 claude auth subcommand\./);
	assert.match(auth.text, /help claude auth \[subcommand…\]\./);
});

test('formatCommandTree refuses unknown and wholly denied paths', () => {
	const unknown = formatCommandTree(nested, `claude${String.fromCharCode(27)}[31m nope`);
	assert.equal(unknown.found, false);
	assert.ok(!unknown.text.includes(String.fromCharCode(27)));
	assert.match(unknown.text, /^Unknown command ".*"\. Call list_commands without arguments/);
	assert.equal(formatCommandTree(nested, '').found, false);
	assert.equal(formatCommandTree(nested, 'a b c d e f g h i').found, false);
	const denied = formatCommandTree(nested, 'claude skills');
	assert.equal(denied.found, false);
	assert.match(denied.text, /is not available to the assistant \(the user runs it\)\.$/);
});

test('formatBatchResult labels each line with its position and status', () => {
	assert.equal(
		formatBatchResult([
			{line: 'mod list', status: 'ok', text: 'a'},
			{line: 'x', status: 'skipped', text: 'not run'},
		]),
		'[1/2 ok] mod list\na\n\n[2/2 skipped] x\nnot run',
	);
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

test('resolveCommandLine reads quoted words and refuses an unclosed quote', () => {
	assert.deepEqual(resolveCommandLine(nested, '"claude" "auth" "status"'), {command: 'claude', subcommand: 'auth status', policy: 'safe'});
	assert.deepEqual(resolveCommandLine(nested, 'claude "auth status"'), {command: 'claude', policy: 'confirm'});
	assert.equal(resolveCommandLine(nested, 'claude "auth'), undefined);
	assert.equal(resolveCommandLine(nested, '""'), undefined);
});

test('the run_command description tells to quote arguments with spaces', () => {
	assert.match(COMMAND_TOOLS.run_command.description, /Quote an argument that holds spaces: "a b" or 'a b'\./);
});
