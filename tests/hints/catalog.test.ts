import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCatalog} from '../../src/hints/catalog.js';
import {createRegistry} from '../../src/commands.js';

const run = () => {};

test('keeps valid commands in registry order', () => {
	const cat = buildCatalog([
		{name: 'b', description: 'B', run},
		{name: 'a', description: 'A', usage: 'a <x>', run},
	]);
	assert.deepEqual(cat.commands.map(c => c.name), ['b', 'a']);
	assert.equal(cat.byName.get('a')?.usage, 'a <x>');
	assert.equal(cat.byName.get('b')?.usage, undefined);
	assert.deepEqual(cat.commands.map(c => c.index), [0, 1]);
});

test('ignores invalid names', () => {
	const cat = buildCatalog([
		null, 'str', 42, {},
		{name: 5}, {name: ''}, {name: 'has space'}, {name: 'tab\tx'},
		{name: 'x'.repeat(65)}, {name: 'new\nline'}, {name: '\u001b[31mred'},
		{name: 'ok', description: 'fine'},
	]);
	assert.deepEqual(cat.commands.map(c => c.name), ['ok']);
});

test('first duplicate wins, matching registry.find', () => {
	const extra = [{name: 'clear', description: 'shadow', run}, {name: 'clear', description: 'dup', run}];
	const reg = createRegistry(extra as never);
	const cat = buildCatalog(reg.commands);
	assert.equal(cat.byName.get('clear')?.description, reg.find('clear')?.description);
	assert.equal(cat.commands.filter(c => c.name === 'clear').length, 1);
	assert.deepEqual(cat.commands.map(c => c.name).slice(0, 3), ['help', 'echo', 'clear']);
});

test('a throwing getter drops only that command', () => {
	const bad = {
		get name(): string {
			throw new Error('boom');
		},
	};
	const badDesc = {
		name: 'x',
		get description(): string {
			throw new Error('boom');
		},
	};
	const cat = buildCatalog([{name: 'a'}, bad, badDesc, {name: 'b'}]);
	assert.deepEqual(cat.commands.map(c => c.name), ['a', 'b']);
});

test('descriptions and usage are sanitised and capped', () => {
	const cat = buildCatalog([{name: 'a', description: `x\ny\u001b]52;c;q\u0007${'z'.repeat(500)}`, usage: 'u'.repeat(500)}]);
	const a = cat.commands[0];
	assert.ok(a);
	assert.ok(a.description.startsWith('x y'));
	assert.ok(Array.from(a.description).length <= 200);
	assert.ok(!a.description.includes('\u001b'));
	assert.ok(Array.from(a.usage ?? '').length <= 200);
	assert.equal(buildCatalog([{name: 'n', description: 5}]).commands[0]?.description, '');
});

test('malformed subcommands are dropped individually', () => {
	const cat = buildCatalog([
		{
			name: 'mod',
			subcommands: [
				null, 'x', {name: 3}, {name: 'bad name'},
				{name: 'install', aliases: ['i', 7, 'bad alias', 'i'], usage: 'install <s>', description: 'Install'},
				{name: 'install', description: 'dup'},
				{name: 'list', aliases: 'nope'},
			],
		},
		{name: 'plain', subcommands: 'nope'},
	]);
	const mod = cat.byName.get('mod');
	assert.deepEqual(mod?.subs.map(s => s.name), ['install', 'list']);
	assert.deepEqual(mod?.subs[0]?.aliases, ['i']);
	assert.equal(mod?.subs[0]?.description, 'Install');
	assert.deepEqual(mod?.subs[1]?.aliases, []);
	assert.deepEqual(cat.byName.get('plain')?.subs, []);
});

test('size and depth caps', () => {
	const many = Array.from({length: 700}, (_, i) => ({name: `c${i}`}));
	assert.equal(buildCatalog(many).commands.length, 500);

	const subs = Array.from({length: 300}, (_, i) => ({name: `s${i}`}));
	assert.equal(buildCatalog([{name: 'a', subcommands: subs}]).commands[0]?.subs.length, 100);

	const deep = {name: 'l1', subcommands: [{name: 'l2', subcommands: [{name: 'l3', subcommands: [{name: 'l4'}]}]}]};
	const l1 = buildCatalog([{name: 'a', subcommands: [deep]}]).commands[0]?.subs[0];
	assert.equal(l1?.subs[0]?.subs[0]?.name, 'l3');
	assert.deepEqual(l1?.subs[0]?.subs[0]?.subs, []);
});

test('non-array input never throws', () => {
	assert.deepEqual(buildCatalog(undefined as never).commands, []);
});

test('agent: only the three literals pass, a command defaults to confirm, a subcommand inherits', () => {
	const cat = buildCatalog([
		{name: 'a', description: 'A', agent: 'safe', run, subcommands: [{name: 's', agent: 'deny'}, {name: 'u'}, {name: 'bad', agent: 'yes'}]},
		{name: 'b', description: 'B', run},
		{name: 'c', description: 'C', agent: 'allow', run},
		{name: 'd', description: 'D', agent: 5, run},
	]);
	assert.deepEqual(cat.commands.map(c => c.agent), ['safe', 'confirm', 'confirm', 'confirm']);
	assert.deepEqual(cat.byName.get('a')!.subs.map(s => s.agent), ['deny', undefined, 'confirm']);
});

test('agent: a throwing getter becomes confirm and keeps the entry', () => {
	const cmd = {name: 'x', description: 'X', get agent(): never { throw new Error('no'); }, subcommands: [{name: 'y', get agent(): never { throw new Error('no'); }}], run};
	const cat = buildCatalog([cmd]);
	assert.equal(cat.byName.get('x')?.agent, 'confirm');
	assert.equal(cat.byName.get('x')?.subs[0]?.agent, 'confirm');
});

test("core's own commands declare their policies", () => {
	const cat = buildCatalog(createRegistry([]).commands);
	const policy = (n: string) => cat.byName.get(n)?.agent;
	assert.deepEqual(['help', 'echo', 'clear', 'exit', 'settings'].map(policy), ['safe', 'safe', 'confirm', 'confirm', 'deny']);
});
