import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCatalog} from '../../src/hints/catalog.js';
import {helpLines} from '../../src/hints/help.js';
import {stringCells} from '../../src/hints/width.js';

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

test('help without arguments pads by cell width', () => {
	const lines = helpLines(cat);
	assert.equal(lines.length, 4);
	assert.equal(lines[0], '  help     Show the list of commands');
	assert.equal(lines[1], '  日本     wide name');
	assert.equal(stringCells(lines[1]?.split('wide')[0] ?? ''), stringCells('  help     '));
	assert.equal(lines[3], '  evil     x yz');
});

test('help for a command lists usage, description and subcommands', () => {
	assert.deepEqual(helpLines(cat, 'mod'), [
		'mod <install|update> [args]',
		'Manage modules',
		'  install (i)     install <src>  Install a module',
		'  update (up, u)  update         Update',
		'    all  all  Everything',
	]);
});

test('help for a command without usage shows its name', () => {
	assert.deepEqual(helpLines(cat, 'help'), ['help', 'Show the list of commands']);
});

test('unknown command yields the unknown-command lines', () => {
	assert.deepEqual(helpLines(cat, 'mdo'), ['Unknown command: mdo', 'Did you mean: mod?']);
	assert.deepEqual(helpLines(cat, 'qqqqqq'), ['Unknown command: qqqqqq']);
});
