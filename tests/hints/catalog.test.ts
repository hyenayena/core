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
	assert.deepEqual(mod?.subs.map(s => s.name), ['install', 'list', 'help']);
	assert.deepEqual(mod?.subs[0]?.aliases, ['i']);
	assert.equal(mod?.subs[0]?.description, 'Install');
	assert.deepEqual(mod?.subs[1]?.aliases, []);
	assert.deepEqual(cat.byName.get('plain')?.subs, []);
});

test('size and depth caps', () => {
	const many = Array.from({length: 700}, (_, i) => ({name: `c${i}`}));
	assert.equal(buildCatalog(many).commands.length, 500);

	const subs = Array.from({length: 300}, (_, i) => ({name: `s${i}`}));
	const capped = buildCatalog([{name: 'a', subcommands: subs}]).commands[0]?.subs;
	assert.equal(capped?.length, 101);
	assert.equal(capped?.[100]?.builtin, true);

	const deep = {name: 'l1', subcommands: [{name: 'l2', subcommands: [{name: 'l3', subcommands: [{name: 'l4'}]}]}]};
	const l1 = buildCatalog([{name: 'a', subcommands: [deep]}]).commands[0]?.subs[0];
	assert.equal(l1?.subs[0]?.subs[0]?.name, 'l3');
	assert.deepEqual(l1?.subs[0]?.subs[0]?.subs, []);
	assert.equal(l1?.subs[0]?.subs[1]?.usage, 'a l1 l2 help [subcommand…]');
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
	assert.deepEqual(cat.byName.get('a')!.subs.map(s => s.agent), ['deny', undefined, 'confirm', 'safe']);
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

test('every node with subcommands gets a safe builtin help; a declared help keeps its place and policy', () => {
	const cat = buildCatalog([
		{name: 'a', description: 'A', run, subcommands: [{name: 'x', usage: 'a x', subcommands: [{name: 'y'}]}, {name: 'z'}]},
		{name: 'b', description: 'B', run, subcommands: [{name: 'help', usage: 'b help', agent: 'confirm'}, {name: 'q'}]},
		{name: 'c', description: 'C', run, subcommands: [{name: 'info', aliases: ['help']}]},
		{name: 'leaf', description: 'L', run},
	]);
	const a = cat.byName.get('a')!;
	const help = a.subs.find(s => s.name === 'help')!;
	assert.equal(help.builtin, true);
	assert.equal(help.agent, 'safe');
	assert.equal(help.usage, 'a help [subcommand…]');
	assert.deepEqual(help.args.map(x => [x.name, x.optional, x.repeatable]), [['subcommand', true, true]]);
	assert.equal(a.subs[0]!.subs.at(-1)?.usage, 'a x help [subcommand…]');
	assert.equal(a.subs[1]!.subs.length, 0);
	const b = cat.byName.get('b')!;
	assert.deepEqual(b.subs.map(s => [s.name, s.agent, s.builtin]), [['help', 'confirm', undefined], ['q', undefined, undefined]]);
	assert.deepEqual(cat.byName.get('c')!.subs.map(s => s.name), ['info']);
	assert.deepEqual(cat.byName.get('leaf')!.subs, []);
});

test('argument, option and note docs are validated, sanitised and capped', () => {
	const cat = buildCatalog([
		{
			name: 'x',
			usage: 'x [--name <n>] <project>… [model]',
			args: [
				{name: 'project', description: 'Project\u001b[31m'},
				{name: 'model', description: 'Model', optional: false},
				{name: 'project', description: 'dup'},
				{name: 'two words', description: 'bad'},
				null,
				{name: 'free', description: 'not in the usage'},
			],
			options: [
				{name: '--name', aliases: ['-n', 'bad', '-n', 7], value: '<n>', description: 'Name', repeatable: true},
				{name: 'plain', description: 'no dash'},
				{name: '--flag', value: '', description: 'Switch'},
				{name: '--<field>', value: '<value>', description: 'Any field'},
			],
			notes: ['one', 5, '', 'two\nlines'],
			run,
		},
	]);
	const x = cat.byName.get('x')!;
	assert.deepEqual(x.args, [
		{name: 'project', description: 'Project', optional: false, repeatable: true},
		{name: 'model', description: 'Model', optional: false, repeatable: false},
		{name: 'free', description: 'not in the usage', optional: false, repeatable: false},
	]);
	assert.deepEqual(x.options, [
		{name: '--name', aliases: ['-n'], value: '<n>', description: 'Name', repeatable: true},
		{name: '--flag', aliases: [], description: 'Switch', repeatable: false},
		{name: '--<field>', aliases: [], value: '<value>', description: 'Any field', repeatable: false},
	]);
	assert.deepEqual(x.notes, ['one', 'two lines']);

	const many = buildCatalog([
		{
			name: 'm',
			args: Array.from({length: 50}, (_, i) => ({name: `a${i}`, description: 'd'})),
			options: Array.from({length: 90}, (_, i) => ({name: `--o${i}`, value: 'v'.repeat(100), description: 'd'})),
			notes: Array.from({length: 60}, () => 'n'.repeat(500)),
			run,
		},
	]).byName.get('m')!;
	assert.equal(many.args.length, 32);
	assert.equal(many.options.length, 64);
	assert.ok(Array.from(many.options[0]!.value!).length <= 64);
	assert.equal(many.notes.length, 40);
	assert.ok(many.notes.every(n => Array.from(n).length <= 200));
});

test('throwing doc getters drop only the field', () => {
	const cmd = {
		name: 'x',
		get args(): never {
			throw new Error('no');
		},
		options: [{name: '--a', get description(): never { throw new Error('no'); }}, {name: '--b', description: 'B'}],
		run,
	};
	const x = buildCatalog([cmd]).byName.get('x')!;
	assert.deepEqual(x.args, []);
	assert.deepEqual(x.options.map(o => [o.name, o.description]), [['--a', ''], ['--b', 'B']]);
});
