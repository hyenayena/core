import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCatalog} from '../../src/hints/catalog.js';
import {helpError, helpLines} from '../../src/hints/help.js';
import {stringCells} from '../../src/hints/width.js';
import {catalog as documented} from './fixture.js';

const cat = buildCatalog([
	{name: 'help', description: 'Show the list of commands'},
	{name: '日本', description: 'wide name'},
	{
		name: 'mod',
		description: 'Manage modules',
		usage: 'mod <install|update> [args]',
		subcommands: [
			{name: 'install', aliases: ['i'], usage: 'install <src>', description: 'Install a module'},
			{name: 'update', aliases: ['up', 'u'], usage: 'update', description: 'Update', subcommands: [{name: 'all', usage: 'all', description: 'Everything'}]},
		],
	},
	{name: 'evil', description: 'x\ny\u001b]52;c;a\u0007z'},
]);

test('help without arguments pads by cell width and points to the details', () => {
	const lines = helpLines(cat);
	assert.equal(lines.length, 5);
	assert.equal(lines[0], '  help     Show the list of commands');
	assert.equal(lines[1], '  日本     wide name');
	assert.equal(stringCells(lines[1]?.split('wide')[0] ?? ''), stringCells('  help     '));
	assert.equal(lines[3], '  evil     x yz');
	assert.equal(lines[4], 'help <command> [subcommand…] shows details');
});

test('help for a command lists usage, description and subcommands, without the builtin help', () => {
	assert.deepEqual(helpLines(cat, ['mod']), [
		'Usage: mod <install|update> [args]',
		'Manage modules',
		'',
		'Subcommands:',
		'  install (i)     <src>  Install a module',
		'  update (up, u)         Update',
		'    all    Everything',
		'',
		'mod help <subcommand> shows details',
	]);
});

test('help for a command without usage shows its name', () => {
	assert.deepEqual(helpLines(cat, ['help']), ['Usage: help', 'Show the list of commands']);
});

test('unknown command yields the unknown-command lines', () => {
	assert.deepEqual(helpLines(cat, ['mdo']), ['Unknown command: mdo', 'Did you mean: mod?']);
	assert.deepEqual(helpLines(cat, ['qqqqqq']), ['Unknown command: qqqqqq']);
	assert.equal(helpError(cat, ['mdo']), 'Unknown command: mdo. Did you mean: mod?');
	assert.equal(helpError(cat, []), undefined);
	assert.equal(helpError(cat, ['mod', 'up']), undefined);
});

test('an unknown subcommand names its parent path and the nearest subcommand', () => {
	assert.deepEqual(helpLines(documented, ['claude', 'auth', 'logn']), ['Unknown subcommand: logn (claude auth)', 'Did you mean: login?']);
	assert.equal(helpError(documented, ['claude', 'atuh']), 'Unknown subcommand: atuh (claude). Did you mean: auth?');
	assert.equal(helpError(documented, ['echo', 'x\u001b[31m']), 'Unknown subcommand: x (echo)');
});

test('a documented node shows arguments, options, subcommands and notes in order', () => {
	assert.deepEqual(helpLines(documented, ['doc', 'ask']), [
		'Usage: doc ask [--new] [--model <m>] <text…>',
		'Ask',
		'',
		'Arguments:',
		'  <text>…  What to ask',
		'',
		'Options:',
		'  --new            Start a new chat',
		'  --model <m>, -m  Model to use',
		'',
		'Notes:',
		'  The answer streams into the chat',
	]);
	assert.deepEqual(helpLines(documented, ['doc', 'auth']), [
		'Usage: doc auth <login|logout>',
		'Authentication',
		'',
		'Arguments:',
		'  <login|logout>  Subcommand',
		'',
		'Subcommands:',
		'  login   [account]  Log in',
		'  logout             Log out',
		'  status             Show the login',
		'',
		'doc auth help <subcommand> shows details',
	]);
	assert.deepEqual(helpLines(documented, ['doc', 'auth', 'help']).slice(0, 2), ['Usage: doc auth help [subcommand…]', 'Show usage, arguments and subcommands']);
});
