import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Command} from '../../../../src/api.js';
import {checkCommandDocs} from '../../src/kit/text.js';

const run = () => {};

test('a fully documented command has no problems', () => {
	const cmd: Command = {
		name: 'doc',
		description: 'Documented command',
		usage: 'doc <subcommand>',
		args: [{name: 'subcommand', description: 'What to run'}],
		subcommands: [
			{
				name: 'ask',
				usage: 'doc ask [--new] [--model <m>|-m <m>] <text…>',
				description: 'Ask something',
				args: [{name: 'text', description: 'What to ask'}],
				options: [
					{name: '--new', description: 'New chat'},
					{name: '--model', aliases: ['-m'], value: '<m>', description: 'Model'},
				],
				subcommands: [{name: 'deep', usage: 'doc ask deep', description: 'Deeper'}],
			},
		],
		run,
	};
	assert.deepEqual(checkCommandDocs(cmd), []);
});

test('reports descriptions, usages, missing and stray docs, and a declared help', () => {
	const cmd = {
		name: 'bad',
		description: 'Ends with a dot (see bad help).',
		usage: 'bad <x> [--flag] [--opt <v>]',
		args: [{name: 'y', description: 'Stray'}],
		options: [{name: '--opt', value: '<v>', description: 'Opt'}, {name: '--gone', description: 'Gone'}],
		subcommands: [
			{name: 'help', usage: 'bad help', description: 'Own help'},
			{name: 'rel', usage: 'rel <a>', description: ''},
			{name: 'none', usage: '', description: 'x'.repeat(101)},
		],
		run,
	} as Command;
	assert.deepEqual(checkCommandDocs(cmd), [
		'bad: the description ends with "."',
		'bad: the description points to help',
		'bad: no argument doc for "x"',
		'bad: no option doc for "--flag"',
		'bad: the argument "y" is not in the usage',
		'bad: the option "--gone" is not in the usage',
		'bad help: core provides the help subcommand',
		'bad rel: the description is empty',
		'bad rel: the usage does not start with "bad rel"',
		'bad none: the description is longer than 100 characters',
		'bad none: no usage',
	]);
});

test('a command without a valid name is one problem', () => {
	assert.deepEqual(checkCommandDocs({name: 'two words', description: 'x', run} as Command), ['the command has no valid name']);
});
