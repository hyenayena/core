import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Command, CommandContext, SettingsTab, StyledBlock} from '../../../src/api.js';
import {createRegistry} from '../src/commands.js';
import {withRunSource} from '../src/run-source.js';
import type {EventBus} from '../../../src/api.js';

const ctxWith = (out: string[]): CommandContext => ({print: t => void out.push(...t.split('\n')), clear() {}, exit() {}});

test('find returns one stable help-aware wrapper whose getters stay live', async () => {
	let title = 'First';
	const original: Command = {
		name: 'x',
		description: 'X',
		subcommands: [{name: 'go', usage: 'x go', description: 'Go'}],
		get settings(): SettingsTab {
			return {title, settings: []};
		},
		run: () => {},
	};
	const registry = createRegistry([original]);
	const found = registry.find('x')!;
	assert.equal(registry.find('x'), found);
	assert.notEqual(found, original);
	assert.equal(found.name, 'x');
	title = 'Second';
	assert.equal(found.settings?.title, 'Second');
	assert.equal(registry.commands.includes(original), true);
	assert.equal(registry.find('nope'), undefined);
});

test('the wrapper passes the context through with showHelp added', async () => {
	let got: CommandContext | undefined;
	const original: Command = {name: 'x', description: 'X', usage: 'x [a]', run: (_a, ctx) => void (got = ctx)};
	const out: string[] = [];
	const ctx = {...ctxWith(out), headless: true};
	await createRegistry([original]).find('x')!.run(['help'], ctx);
	assert.equal(got?.headless, true);
	assert.equal(got?.print, ctx.print);
	got!.showHelp!();
	assert.deepEqual(out, ['Usage: x [a]', 'X']);
	assert.throws(() => got!.showHelp!(['nope']), /^Error: Unknown subcommand: nope \(x\)$/);
});

test('help with a path prints that node; an unknown path throws', async () => {
	const registry = createRegistry([{name: 'x', description: 'X', subcommands: [{name: 'go', usage: 'x go', description: 'Go'}], run() {}}]);
	const out: string[] = [];
	await registry.find('help')!.run(['x', 'go'], ctxWith(out));
	assert.deepEqual(out, ['Usage: x go', 'Go']);
	await assert.rejects(async () => registry.find('help')!.run(['x', 'og'], ctxWith([])), (e: Error & {kind?: string}) => e.kind === 'usage' && /Unknown subcommand: og \(x\)\. Did you mean: go\?/.test(e.message));
	const list: string[] = [];
	await registry.find('help')!.run([], ctxWith(list));
	assert.equal(list.at(-2), 'help <command> [subcommand…] shows details');
	assert.equal(list.at(-1), "Quote an argument that holds spaces: \"a b\" or 'a b'");
});

test('help goes to printStyled as line blocks when the context has it', async () => {
	const registry = createRegistry([{name: 'x', description: 'X', subcommands: [{name: 'go', usage: 'x go', description: 'Go'}], run() {}}]);
	const printed: string[] = [];
	const styled: StyledBlock[][] = [];
	await registry.find('help')!.run(['x'], {...ctxWith(printed), printStyled: b => void styled.push([...b])});
	assert.deepEqual(printed, []);
	assert.equal(styled.length, 1);
	const blocks = styled[0]!;
	assert.equal(blocks.every(b => b.kind === 'line'), true);
	const spans = blocks.flatMap(b => (b.kind === 'line' ? b.spans : [])).filter(s => typeof s !== 'string');
	assert.deepEqual(spans[0], {text: 'Usage:', bold: true});
	assert.equal(spans.some(s => s.text === 'go' && s.tone === 'accent'), true);
	assert.equal(spans.some(s => s.text === 'Go' && s.tone === 'muted'), true);
});

test('reload is confirm, calls reload then exit, and refuses without the yena script or headless', async () => {
	assert.equal(createRegistry([]).find('reload')?.agent, 'confirm');
	const order: string[] = [];
	const ctx = {...ctxWith([]), exit: () => void order.push('exit')};
	await createRegistry([], undefined, {reload: () => void order.push('reload')}).find('reload')!.run([], ctx);
	assert.deepEqual(order, ['reload', 'exit']);

	const none: string[] = [];
	await assert.rejects(
		async () => createRegistry([]).find('reload')!.run([], {...ctxWith([]), exit: () => void none.push('exit')}),
		/reload needs the yena script/,
	);
	assert.deepEqual(none, []);

	const calls: string[] = [];
	await assert.rejects(
		async () => createRegistry([], undefined, {reload: () => void calls.push('reload')}).find('reload')!.run([], {...ctxWith([]), headless: true, exit: () => void calls.push('exit')}),
		/cannot run from the terminal/,
	);
	assert.deepEqual(calls, []);
});

test('reload reports who ran it before it restarts, and nothing when it refuses', async () => {
	const order: unknown[] = [];
	const events: EventBus = {emit: (_t, payload) => void order.push(payload), on: () => () => {}};
	const registry = createRegistry([], undefined, {reload: () => void order.push('reload'), events});
	const base = {...ctxWith([]), exit: () => void order.push('exit')};
	await registry.find('reload')!.run([], base);
	await registry.find('reload')!.run([], {...base, caller: 'yena'});
	await registry.find('reload')!.run([], withRunSource(base, {view: 'main'}));
	await registry.find('reload')!.run([], {...withRunSource(base, {view: 'main'}), caller: 'scheduler'});
	assert.deepEqual(order, [
		{via: 'console'}, 'reload', 'exit',
		{via: 'bridge', caller: 'yena'}, 'reload', 'exit',
		{via: 'view', view: 'main'}, 'reload', 'exit',
		{via: 'bridge', caller: 'scheduler'}, 'reload', 'exit',
	]);

	const none: unknown[] = [];
	const quiet: EventBus = {emit: (_t, payload) => void none.push(payload), on: () => () => {}};
	await assert.rejects(async () => createRegistry([], undefined, {reload: () => {}, events: quiet}).find('reload')!.run([], {...base, headless: true}), /cannot run from the terminal/);
	await assert.rejects(async () => createRegistry([], undefined, {events: quiet}).find('reload')!.run([], base), /reload needs the yena script/);
	assert.deepEqual(none, []);
});
