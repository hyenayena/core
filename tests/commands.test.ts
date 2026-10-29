import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Command, CommandContext, SettingsTab} from '../../../src/api.js';
import {createRegistry} from '../src/commands.js';

const ctxWith = (out: string[]): CommandContext => ({print: t => void out.push(t), clear() {}, exit() {}});

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
	await assert.rejects(async () => registry.find('help')!.run(['x', 'og'], ctxWith([])), /Unknown subcommand: og \(x\)\. Did you mean: go\?/);
	const list: string[] = [];
	await registry.find('help')!.run([], ctxWith(list));
	assert.equal(list.at(-1), 'help <command> [subcommand…] shows details');
});
