import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import headless from '../src/headless.js';
import type {Command, CommandContext, Logger, Yena} from '../../../src/api.js';

const log: Logger = {error() {}, warn() {}, info() {}, debug() {}, child: () => log, addRedactor() {}};
const yenaWith = (commands: Command[]): Yena => ({commands, dataDir: mkdtempSync(join(tmpdir(), 'core-headless-')), events: {} as never, log});

async function capture(fn: () => Promise<void>): Promise<{out: string; error?: Error & {exitCode?: number}}> {
	const original = process.stdout.write;
	let out = '';
	process.stdout.write = ((chunk: string | Uint8Array) => {
		out += String(chunk);
		return true;
	}) as typeof process.stdout.write;
	try {
		await fn();
		return {out};
	} catch (error) {
		return {out, error: error as Error};
	} finally {
		process.stdout.write = original;
	}
}

test('runs a command with a headless context and sanitizes what it prints', async () => {
	let seen: CommandContext | undefined;
	const probe: Command = {
		name: 'probe',
		description: 'Probe',
		run: async (args, ctx) => {
			seen = ctx;
			ctx.print(`args:${args.join(',')}\x1b[31m red`);
			assert.equal(await ctx.suspend!(() => 7), 7);
		},
	};
	const {out, error} = await capture(() => headless(yenaWith([probe]), {args: ['probe', 'a', 'b']}));
	assert.equal(error, undefined);
	assert.ok(out.startsWith('args:a,b'));
	assert.ok(!out.includes('\x1b'));
	assert.ok(out.endsWith('\n'));
	assert.equal(seen?.headless, true);
	assert.equal(seen?.mount, undefined);
	assert.equal(seen?.copyToClipboard, undefined);
	assert.ok(seen?.commandBridge);
});

test('an unknown command fails with exit code 2 and a suggestion', async () => {
	const {error} = await capture(() => headless(yenaWith([]), {args: ['ehco', 'x']}));
	assert.equal(error?.exitCode, 2);
	assert.match(error!.message, /Unknown command: ehco/);
});

test('empty, oversized, control character and quit lines are rejected with exit code 2', async () => {
	for (const args of [[], [''], ['echo', 'a'.repeat(5000)], ['echo', 'a\nb'], ['echo', '‮'], [':q']]) {
		const {error, out} = await capture(() => headless(yenaWith([]), {args}));
		assert.equal(error?.exitCode, 2, JSON.stringify(args).slice(0, 40));
		assert.equal(out, '');
	}
});

test('view commands fail without mount and keep their own error', async () => {
	const {error} = await capture(() => headless(yenaWith([]), {args: ['settings']}));
	assert.match(error!.message, /needs an interface that can show views/);
	assert.equal(error?.exitCode, undefined);
});

test('command errors are rethrown unchanged', async () => {
	const boom = new Error('boom');
	const {error} = await capture(() => headless(yenaWith([{name: 'boom', description: 'x', run() { throw boom; }}]), {args: ['boom']}));
	assert.equal(error, boom);
});

test('catalog prints only valid tab separated lines, runs no command and ignores args', async () => {
	let ran = false;
	const evil = {name: 'evil', description: 'Bad\x1b[31m\ttext', run() { ran = true; }, subcommands: [{name: 'go', description: 'Go'}]} as unknown as Command;
	const bad: Command = {name: 'bad name', description: 'x', run() { ran = true; }};
	const {out, error} = await capture(() => headless(yenaWith([evil, bad]), {args: ['evil', 'go'], catalog: true}));
	assert.equal(error, undefined);
	assert.equal(ran, false);
	assert.ok(!out.includes('\x1b'));
	const lines = out.trimEnd().split('\n');
	assert.ok(lines.length >= 2);
	assert.ok(lines.every(l => /^[A-Za-z0-9._-]+( [A-Za-z0-9._-]+)?\t[^\t]*$/.test(l)));
	assert.ok(lines.includes('evil go\tGo'));
	assert.ok(!lines.some(l => l.startsWith('bad')));
});

test('src/headless.ts has no react or ink in its import graph', () => {
	const FROM = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
	const seen = new Set<string>();
	const walk = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		for (const m of readFileSync(file, 'utf8').matchAll(FROM)) {
			const spec = (m[1] ?? m[2]) as string;
			if (spec.startsWith('node:')) continue;
			if (/^[^.]/.test(spec)) assert.fail(`${file} imports ${spec}`);
			assert.ok(!/\/(components|kit\/ui)\b/.test(spec) && !spec.endsWith('.tsx'), `${file} imports ${spec}`);
			if (spec.includes('/src/api')) continue;
			walk(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
		}
	};
	walk(resolve(dirname(fileURLToPath(import.meta.url)), '../src/headless.ts'));
	assert.ok(seen.size >= 8);
});

const tree = (seen: {args?: string[]; ctx?: CommandContext}): Command => ({
	name: 'tree',
	description: 'Tree',
	usage: 'tree <subcommand>',
	subcommands: [{name: 'leaf', usage: 'tree leaf <x>', description: 'Leaf', args: [{name: 'x', description: 'The x'}]}],
	run: (args, ctx) => {
		seen.args = args;
		seen.ctx = ctx;
		if (args.length === 0) ctx.showHelp!();
		if (args[0] === 'leafhelp') ctx.showHelp!(['leaf']);
		if (args[0] === 'badhelp') ctx.showHelp!(['nope']);
	},
});

test('<cmd> help prints core help and exits 0 without running the command', async () => {
	const seen: {args?: string[]} = {};
	const {out, error} = await capture(() => headless(yenaWith([tree(seen)]), {args: ['tree', 'help']}));
	assert.equal(error, undefined);
	assert.equal(seen.args, undefined);
	assert.match(out, /^Usage: tree <subcommand>$/m);
	assert.match(out, /^ {2}leaf +<x> +Leaf$/m);
	const leaf = await capture(() => headless(yenaWith([tree(seen)]), {args: ['tree', 'help', 'leaf']}));
	assert.match(leaf.out, /^ {2}<x> +The x$/m);
	const bad = await capture(() => headless(yenaWith([tree(seen)]), {args: ['tree', 'help', 'lef']}));
	assert.equal(bad.error?.message, 'Unknown subcommand: lef (tree). Did you mean: leaf?');
	assert.equal(seen.args, undefined);
});

test('commands get showHelp for themselves and their subcommands', async () => {
	const seen: {args?: string[]; ctx?: CommandContext} = {};
	const {out} = await capture(() => headless(yenaWith([tree(seen)]), {args: ['tree']}));
	assert.deepEqual(seen.args, []);
	assert.equal(seen.ctx?.headless, true);
	assert.match(out, /^Usage: tree <subcommand>$/m);
	const leaf = await capture(() => headless(yenaWith([tree(seen)]), {args: ['tree', 'leafhelp']}));
	assert.match(leaf.out, /^Usage: tree leaf <x>$/m);
	const bad = await capture(() => headless(yenaWith([tree(seen)]), {args: ['tree', 'badhelp']}));
	assert.match(bad.error?.message ?? '', /^Unknown subcommand: nope \(tree\)/);
});

test('help <command> <subcommand> describes the subcommand; an unknown path fails', async () => {
	const {out} = await capture(() => headless(yenaWith([tree({})]), {args: ['help', 'tree', 'leaf']}));
	assert.match(out, /^Usage: tree leaf <x>$/m);
	const {error} = await capture(() => headless(yenaWith([tree({})]), {args: ['help', 'tre']}));
	assert.equal(error?.message, 'Unknown command: tre. Did you mean: tree?');
});
