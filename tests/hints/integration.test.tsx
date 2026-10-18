import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {mountHarness} from '../testkit.js';
import type {Command} from '../../../../src/api.js';

const ESC = String.fromCharCode(27);

const commands: Command[] = [
	{
		name: 'mod',
		description: 'Manage modules',
		usage: 'mod <install|remove> [args]',
		subcommands: [
			{name: 'install', aliases: ['i'], usage: 'mod install [source]…', description: 'Install modules'},
			{name: 'remove', aliases: ['rm'], usage: 'mod remove <name>…', description: 'Remove modules'},
		],
		run: () => {},
	},
	{
		name: 'tool',
		description: 'Tool',
		usage: 'tool ask [--new] <text>',
		subcommands: [{name: 'ask', usage: 'tool ask [--new] <text>', description: 'Ask'}],
		run: () => {},
	},
	{name: 'clone', description: 'Clone things', run: () => {}},
	{
		name: 'fail',
		description: 'Always fails',
		run: () => {
			throw new Error(`before ${ESC}]8;;http://example.invalid${String.fromCharCode(7)}link`);
		},
	},
];

function setup() {
	return mountHarness(<App registry={createRegistry(commands)} />, {columns: 80, rows: 40});
}

async function type(h: ReturnType<typeof setup>, sequence: string) {
	h.press(sequence);
	await h.settle(sequence === ESC ? 60 : 30);
}

test('an alias match shows the alias with its canonical name', async () => {
	const h = setup();
	await h.settle();
	await type(h, 'mod r');
	assert.match(h.lastFrame(), /^› rm\s+\(remove\) Remove modules$/m);
	h.unmount();
});

test('cycling with Tab and Shift+Tab, then Esc restores the typed text', async () => {
	const h = setup();
	await h.settle();
	await type(h, 'cl');
	await type(h, '\t');
	assert.match(h.lastFrame(), /^> clone/m);
	await type(h, '\x1b[Z');
	assert.match(h.lastFrame(), /^> clear/m);
	await type(h, '\t');
	await type(h, ESC);
	assert.match(h.lastFrame(), /^> cl$/m);
	assert.doesNotMatch(h.lastFrame(), /^› /m);
	h.unmount();
});

test('a subcommand with no further choices still shows its usage line', async () => {
	const h = setup();
	await h.settle();
	await type(h, 'tool ask ');
	assert.match(h.lastFrame(), /^\s+tool ask \[--new\] <text>$/m);
	h.unmount();
	const g = setup();
	await g.settle();
	await type(g, 'mod remove ');
	assert.match(g.lastFrame(), /^\s+mod remove <name>…$/m);
	await type(g, 'x');
	assert.match(g.lastFrame(), /^\s+mod remove <name>…$/m);
	g.unmount();
});

test('a thrown error message cannot carry a hyperlink escape to the terminal', async () => {
	const h = setup();
	await h.settle();
	await type(h, 'fail');
	await type(h, '\r');
	assert.ok(!h.allOutput().includes(`${ESC}]8;`));
	h.unmount();
});

test('a usage-only row is not interactive: Tab does nothing, Up recalls history, no usage for plain commands', async () => {
	const ran: string[][] = [];
	const extra: Command[] = [...commands, {name: 'rec', description: 'Record', run: args => void ran.push(args)}];
	const h = mountHarness(<App registry={createRegistry(extra)} />, {columns: 80, rows: 40});
	await h.settle();
	await type(h, 'rec one');
	await type(h, '\r');
	await type(h, 'rec ');
	assert.doesNotMatch(h.lastFrame(), /^\s+rec$/m);
	await type(h, '\x15');
	await type(h, 'tool ask ');
	await type(h, '\t');
	assert.match(h.lastFrame(), /^> tool ask$/m);
	assert.match(h.lastFrame(), /^\s+tool ask \[--new\] <text>$/m);
	await type(h, '\x1b[A');
	assert.match(h.lastFrame(), /^> rec one$/m);
	assert.doesNotMatch(h.lastFrame(), /<text>/);
	await type(h, '\r');
	assert.deepEqual(ran, [['one'], ['one']]);
	h.unmount();
});

test('a command without a run function prints an error and the prompt keeps working', async () => {
	const broken = {name: 'norun', description: 'No run'} as unknown as Command;
	const h = mountHarness(<App registry={createRegistry([broken, ...commands])} />, {columns: 80, rows: 40});
	await h.settle();
	await type(h, 'norun');
	await type(h, '\r');
	assert.match(h.lastFrame(), /^Error: /m);
	await type(h, 'mod ');
	assert.match(h.lastFrame(), /^› install/m);
	h.unmount();
});
