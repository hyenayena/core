import assert from 'node:assert/strict';
import {test} from 'node:test';
import {COMMAND_TOOLS, formatCommandList, formatRunResult} from '../../src/kit/text.js';

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
	assert.equal(text, 'mod <sub> [confirm] - Modules\n  mod list (ls) [safe] - Show\nhelp [safe]');
});

test('formatRunResult explains non-ok statuses and truncation', () => {
	const base = {truncated: false, ms: 1};
	assert.equal(formatRunResult({...base, status: 'ok', output: 'hi'}), 'hi');
	assert.equal(formatRunResult({...base, status: 'ok', output: ''}), '(no output)');
	assert.equal(formatRunResult({...base, status: 'denied', output: '', reason: 'nope'}), 'Command denied: nope');
	assert.equal(formatRunResult({...base, status: 'timeout', output: 'part', truncated: true}), 'Command timeout\npart\n[output truncated]');
});
