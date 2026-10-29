import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AgentPolicy, Command} from '../../../../src/api.js';
import {createCommandBridge} from '../../src/agent/bridge.js';
import {createRegistry} from '../../src/commands.js';
import {buildCatalog} from '../../src/hints/catalog.js';
import {resolveCommandLine} from '../../src/kit/agent.js';
import type {AgentMode} from '../../src/view/prefs.js';
import {fakeLogger} from '../testkit.js';

const tree = (log: string[]): Command[] => [
	{
		name: 'tk',
		description: 'tasks',
		agent: 'confirm',
		subcommands: [
			{name: 'new', usage: 'tk new <project> [text…]', description: 'n', agent: 'safe'},
			{
				name: 'kind',
				aliases: ['k'],
				usage: 'tk kind <subcommand>',
				description: 'k',
				subcommands: [
					{name: 'add', usage: 'tk kind add <kind>', description: 'a', agent: 'safe'},
					{name: 'remove', aliases: ['rm'], usage: 'tk kind remove <kind>', description: 'r'},
				],
			},
			{name: 'wipe', usage: 'tk wipe', description: 'w', agent: 'deny'},
		],
		run: (args, ctx) => {
			log.push(args.join(' '));
			ctx.print(`ran ${args.join(' ')}`);
		},
	},
	{
		name: 'plain',
		description: 'no subcommands',
		agent: 'safe',
		run: (args, ctx) => {
			log.push(`plain ${args.join(' ')}`);
			ctx.print(args.join(' '));
		},
	},
];

function setup(mode: AgentMode = 'policy') {
	const log: string[] = [];
	const registry = createRegistry(tree(log));
	const state = {mode};
	const bridge = createCommandBridge({
		find: name => registry.find(name),
		catalog: () => buildCatalog(registry.commands),
		mode: () => state.mode,
		tee: () => {},
		clear: () => {},
		exit: () => {},
		log: fakeLogger().log,
	});
	return {bridge, log, state};
}

test('the word help as a value is never taken for the help subcommand', async () => {
	const s = setup();
	const confirm = async () => true;
	assert.equal((await s.bridge.run({line: 'tk new web help', caller: 't'})).output, 'ran new web help');
	assert.equal((await s.bridge.run({line: 'tk new help help', caller: 't'})).output, 'ran new help help');
	assert.equal((await s.bridge.run({line: 'tk kind add help', caller: 't'})).output, 'ran kind add help');
	assert.equal((await s.bridge.run({line: 'tk kind rm help', caller: 't', confirm})).output, 'ran kind rm help');
	assert.equal((await s.bridge.run({line: 'plain help', caller: 't'})).output, 'help');
	assert.equal((await s.bridge.run({line: 'tk bogus help', caller: 't', confirm})).output, 'ran bogus help');
	assert.deepEqual(s.log, ['new web help', 'new help help', 'kind add help', 'kind rm help', 'plain help', 'bogus help']);
});

test('help below a node prints help, runs nothing and needs no confirmation (ask mode asks, as for every safe command), also next to a denied sibling', async () => {
	for (const mode of ['policy', 'ask'] as const) {
		const s = setup(mode);
		for (const line of ['tk help', 'tk help wipe', 'tk kind help', 'tk k help', 'tk kind help rm', 'tk help kind add']) {
			const r = await s.bridge.run({line, caller: 't', confirm: async () => mode === 'ask'});
			assert.equal(r.status, 'ok', `${mode}: ${line}`);
			assert.match(r.output, /^Usage: tk/, `${mode}: ${line}`);
		}
		assert.deepEqual(s.log, []);
	}
});

test('help with extra tokens does not run the command either', async () => {
	const s = setup();
	assert.equal((await s.bridge.run({line: 'tk kind help nope', caller: 't'})).status, 'error');
	assert.equal((await s.bridge.run({line: 'tk help kind add extra', caller: 't'})).status, 'error');
	assert.deepEqual(s.log, []);
});

test('the policy the bridge applies equals the one the listing resolves, for names, aliases and extra tokens', async () => {
	for (const mode of ['policy', 'ask'] as const) {
		const s = setup(mode);
		const list = s.bridge.list();
		const lines = ['tk', 'tk new a', 'tk wipe', 'tk wipe x', 'tk kind', 'tk k add x', 'tk kind rm x y', 'tk kind remove', 'tk kind help', 'tk help', 'tk bogus', 'plain', 'plain help', 'plain x y'];
		for (const line of lines) {
			let asked = false;
			const r = await s.bridge.run({
				line,
				caller: 't',
				confirm: async () => ((asked = true), false),
			});
			const got: AgentPolicy = r.status === 'denied' ? 'deny' : asked ? 'confirm' : 'safe';
			assert.equal(resolveCommandLine(list, line)?.policy, got, `${mode}: ${line}`);
		}
	}
});
