import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Command, CommandRunResult} from '../../../../src/api.js';
import {createCommandBridge, type AgentViewHandle, type BridgeDeps, MAX_OUTPUT_CHARS, MAX_OUTPUT_LINES} from '../../src/agent/bridge.js';
import {buildCatalog} from '../../src/hints/catalog.js';
import type {AgentMode} from '../../src/view/prefs.js';
import {fakeLogger} from '../testkit.js';

type Setup = {commands?: Command[]; mode?: AgentMode; mountView?: BridgeDeps['mountView']; hooks?: Pick<BridgeDeps, 'beforeRun' | 'endRun'>};

function setup(opts: Setup = {}) {
	const commands: Command[] = opts.commands ?? [];
	const state = {mode: opts.mode ?? 'policy' as AgentMode};
	const tee: {text: string; color?: string | undefined}[] = [];
	const cleared: number[] = [];
	const afterRun: number[] = [];
	const {log, records} = fakeLogger();
	const bridge = createCommandBridge({
		find: name => commands.find(c => {
			try {
				return c.name === name;
			} catch {
				return false;
			}
		}),
		catalog: () => buildCatalog(commands),
		mode: () => state.mode,
		tee: (text, color) => tee.push({text, color}),
		clear: () => cleared.push(1),
		exit: () => {},
		afterRun: () => afterRun.push(1),
		...(opts.mountView && {mountView: opts.mountView}),
		...(opts.hooks && opts.hooks),
		log,
	});
	return {bridge, commands, state, tee, cleared, afterRun, records};
}

const say = (name: string, agent: Command['agent'], out = 'hi'): Command => ({name, description: name, agent, run: (_a, ctx) => ctx.print(out)});
const yes = async () => true;
const no = async () => false;
const run = (b: ReturnType<typeof setup>, line: string, extra: object = {}): Promise<CommandRunResult> =>
	b.bridge.run({line, caller: 'tester', ...extra});

test('a safe command runs and its output is captured and teed', async () => {
	const s = setup({commands: [say('hello', 'safe', 'a\nb')]});
	const r = await run(s, 'hello');
	assert.equal(r.status, 'ok');
	assert.equal(r.output, 'a\nb');
	assert.equal(r.truncated, false);
	assert.ok(r.ms >= 0);
	assert.equal(s.tee[0]?.text, '[tester] > hello');
	assert.ok(s.tee.some(t => t.text === 'a\nb'));
	assert.deepEqual(s.afterRun, [1]);
});

test('undeclared policy means confirm; no callback declines', async () => {
	const s = setup({commands: [say('x', undefined)]});
	const r = await run(s, 'x');
	assert.equal(r.status, 'declined');
	assert.match(r.reason ?? '', /cannot ask/);
	assert.equal((await run(s, 'x', {confirm: yes})).status, 'ok');
	assert.equal((await run(s, 'x', {confirm: no})).status, 'declined');
});

test('confirm receives the request and a throwing confirm declines', async () => {
	const s = setup({commands: [{...say('x', 'confirm'), subcommands: [{name: 'go', aliases: ['g'], usage: 'x go', description: 'd'}]}]});
	let seen: unknown;
	await run(s, 'x g', {confirm: async (req: unknown) => ((seen = req), true)});
	assert.deepEqual(seen, {line: 'x g', command: 'x', subcommand: 'go', caller: 'tester'});
	const r = await run(s, 'x', {confirm: async () => { throw new Error('boom'); }});
	assert.equal(r.status, 'declined');
});

test('deny never runs', async () => {
	let ran = false;
	const s = setup({commands: [{name: 'd', description: 'd', agent: 'deny', run: () => { ran = true; }}]});
	const r = await run(s, 'd', {confirm: yes});
	assert.equal(r.status, 'denied');
	assert.equal(ran, false);
});

test('a subcommand policy beats the command policy, matched by name or alias', async () => {
	const cmd: Command = {
		...say('m', 'safe'),
		subcommands: [
			{name: 'rm', aliases: ['remove'], usage: 'm rm', description: 'r', agent: 'deny'},
			{name: 'ls', aliases: [], usage: 'm ls', description: 'l'},
			{name: 'up', aliases: [], usage: 'm up', description: 'u', agent: 'confirm'},
		],
	};
	const s = setup({commands: [cmd]});
	assert.equal((await run(s, 'm rm')).status, 'denied');
	assert.equal((await run(s, 'm remove')).status, 'denied');
	assert.equal((await run(s, 'm ls')).status, 'ok');
	assert.equal((await run(s, 'm zzz')).status, 'ok');
	assert.equal((await run(s, 'm up')).status, 'declined');
});

test('ask upgrades safe to confirm; off refuses everything and lists nothing', async () => {
	const s = setup({commands: [say('a', 'safe')], mode: 'ask'});
	assert.equal((await run(s, 'a')).status, 'declined');
	assert.equal((await run(s, 'a', {confirm: yes})).status, 'ok');
	assert.equal(s.bridge.list()[0]?.policy, 'confirm');
	s.state.mode = 'off';
	const before = s.tee.length;
	const r = await run(s, 'a', {confirm: yes});
	assert.equal(r.status, 'off');
	assert.equal(s.tee.length, before);
	assert.deepEqual(s.bridge.list(), []);
});

test('invalid agent values and a throwing policy getter become confirm', async () => {
	const weird = {name: 'w', description: 'w', agent: 'allow', run: (_a: string[], ctx: {print(t: string): void}) => ctx.print('x')} as unknown as Command;
	const thrower = {name: 't', description: 't', get agent(): never { throw new Error('no'); }, run: () => {}} as unknown as Command;
	const s = setup({commands: [weird, thrower]});
	assert.equal((await run(s, 'w')).status, 'declined');
	assert.equal((await run(s, 't')).status, 'declined');
	assert.equal((await run(s, 't', {confirm: yes})).status, 'ok');
});

test('line validation matrix', async () => {
	const s = setup({commands: [say('a', 'safe')]});
	const bad = ['', '   ', 'a\nb', 'a\tb', 'a\u001b[31m', 'a\u0000', 'a​b', 'a‮b', 'a'.repeat(4097), ':q', '  :q  '];
	for (const line of bad) assert.equal((await run(s, line)).status, 'invalid', JSON.stringify(line));
	assert.equal((await run(s, 'a'.repeat(4096))).status, 'unknown');
	assert.equal((await run(s, '  a  ')).status, 'ok');
	assert.equal((await s.bridge.run({line: 5 as unknown as string, caller: 'x'})).status, 'invalid');
	assert.deepEqual(s.afterRun, [1]);
});

test('an unknown command carries a hint', async () => {
	const s = setup({commands: [say('hello', 'safe')]});
	const r = await run(s, 'helo');
	assert.equal(r.status, 'unknown');
	assert.match(r.reason ?? '', /Unknown command: helo.*Did you mean: hello/);
});

test('a thrown error becomes an error status with Error lines', async () => {
	const s = setup({commands: [{name: 'f', description: 'f', agent: 'safe', run: (_a, ctx) => { ctx.print('partial'); throw new Error('bad\nmore'); }}]});
	const r = await run(s, 'f');
	assert.equal(r.status, 'error');
	assert.equal(r.output, 'partial\nError: bad\n  more');
	assert.equal(r.reason, 'bad');
	assert.ok(s.tee.some(t => t.text === 'Error: bad'));
	assert.equal(s.tee.at(-1)?.text.startsWith('[tester] f: error'), true);
});

test('a command that throws synchronously from a broken run property is an error', async () => {
	const broken = {name: 'b', description: 'b', agent: 'safe', get run(): never { throw new Error('getter'); }} as unknown as Command;
	const s = setup({commands: [broken]});
	assert.equal((await run(s, 'b')).status, 'error');
});

test('output is sanitised: escapes stripped, in the capture and the tee', async () => {
	const s = setup({commands: [say('e', 'safe', 'a\u001b[31mred\u001b[0m \u001b]0;title\u0007b‮c')]});
	const r = await run(s, 'e');
	assert.equal(r.output, 'ared bc');
	assert.ok(!s.tee.some(t => t.text.includes('\u001b')));
});

test('caps: characters and lines set truncated', async () => {
	const big = setup({commands: [say('big', 'safe', 'x'.repeat(MAX_OUTPUT_CHARS + 500))]});
	const r = await run(big, 'big');
	assert.equal(r.truncated, true);
	assert.ok(r.output.length <= MAX_OUTPUT_CHARS);
	const many = setup({commands: [say('many', 'safe', Array.from({length: MAX_OUTPUT_LINES + 50}, (_, i) => `l${i}`).join('\n'))]});
	const r2 = await run(many, 'many');
	assert.equal(r2.truncated, true);
	assert.equal(r2.output.split('\n').length, MAX_OUTPUT_LINES);
	const small = await run(setup({commands: [say('s', 'safe')]}), 's');
	assert.equal(small.truncated, false);
});

test('timeout returns the partial output, aborts the signal and keeps the lock until the command settles', async () => {
	let release!: () => void;
	let signal: AbortSignal | undefined;
	const slow: Command = {
		name: 'slow',
		description: 's',
		agent: 'safe',
		run: async (_a, ctx) => {
			signal = ctx.signal;
			ctx.print('early');
			await new Promise<void>(r => (release = r));
			ctx.print('late');
		},
	};
	const s = setup({commands: [slow, say('fast', 'safe')]});
	const r = await run(s, 'slow', {timeoutMs: 1});
	assert.equal(r.status, 'timeout');
	assert.equal(r.output, 'early');
	assert.equal(signal?.aborted, true);
	assert.ok(r.ms >= 900);
	assert.equal((await run(s, 'fast')).status, 'busy');
	release();
	await new Promise(r => setTimeout(r, 10));
	assert.ok(s.tee.some(t => t.text === 'late'), 'late prints still reach the console');
	assert.equal((await run(s, 'fast')).status, 'ok');
	assert.equal((await run(s, 'slow', {timeoutMs: 1})).status, 'timeout');
	release();
});

test('an abort signal ends the run as aborted; an already aborted signal never starts it', async () => {
	let started = 0;
	let release!: () => void;
	const hang: Command = {name: 'hang', description: 'h', agent: 'safe', run: async () => { started++; await new Promise<void>(r => (release = r)); }};
	const s = setup({commands: [hang]});
	const ac = new AbortController();
	const p = run(s, 'hang', {signal: ac.signal});
	await new Promise(r => setTimeout(r, 10));
	ac.abort();
	assert.equal((await p).status, 'aborted');
	release();
	await new Promise(r => setTimeout(r, 10));
	const done = new AbortController();
	done.abort();
	assert.equal((await run(s, 'hang', {signal: done.signal})).status, 'aborted');
	assert.equal(started, 1);
});

test('aborting while the user is being asked ends the run as aborted', async () => {
	const s = setup({commands: [say('c', 'confirm')]});
	const ac = new AbortController();
	const p = run(s, 'c', {confirm: () => new Promise<boolean>(() => {}), signal: ac.signal});
	await new Promise(r => setTimeout(r, 5));
	ac.abort();
	assert.equal((await p).status, 'aborted');
});

test('only one run at a time', async () => {
	let release!: () => void;
	const hang: Command = {name: 'hang', description: 'h', agent: 'safe', run: () => new Promise<void>(r => (release = r))};
	const s = setup({commands: [hang]});
	const first = run(s, 'hang');
	await new Promise(r => setTimeout(r, 5));
	assert.equal((await run(s, 'hang')).status, 'busy');
	release();
	assert.equal((await first).status, 'ok');
});

test('non-ok results leave a footer line in the console', async () => {
	const s = setup({commands: [say('d', 'deny')]});
	await run(s, 'd');
	assert.equal(s.tee.at(-1)?.text, '[tester] d: denied (this command is not available to assistants)');
});

test('list reflects commands added later and carries effective policies', async () => {
	const s = setup({commands: [{...say('a', 'safe'), usage: 'a <x>', subcommands: [{name: 's', aliases: ['t'], usage: 'a s', description: 'sd', agent: 'deny'}]}]});
	assert.deepEqual(s.bridge.list(), [
		{
			name: 'a',
			description: 'a',
			usage: 'a <x>',
			policy: 'safe',
			subcommands: [{name: 's', aliases: ['t'], usage: 'a s', description: 'sd', policy: 'deny'}],
		},
	]);
	s.commands.push(say('late', undefined));
	const names = s.bridge.list().map(c => `${c.name}:${c.policy}`);
	assert.deepEqual(names, ['a:safe', 'late:confirm']);
});

test('the agent context offers print, clear, exit and signal only', async () => {
	let keys: string[] = [];
	const probe: Command = {
		name: 'probe',
		description: 'p',
		agent: 'safe',
		run: (_a, ctx) => {
			keys = Object.keys(ctx).sort();
			ctx.clear();
		},
	};
	const s = setup({commands: [probe]});
	await run(s, 'probe');
	assert.deepEqual(keys, ['clear', 'exit', 'print', 'signal']);
	assert.deepEqual(s.cleared, [1]);
});

test('log records carry metadata only: no line, args or output', async () => {
	const s = setup({commands: [{...say('m', 'safe', 'SECRET-OUTPUT'), subcommands: [{name: 'ls', aliases: [], usage: 'm ls', description: 'l'}]}]});
	await run(s, 'm ls SECRET-ARG');
	await run(s, 'nothere SECRET-ARG2');
	await run(s, 'm\u001b', {caller: 'tester'});
	const text = JSON.stringify(s.records);
	assert.doesNotMatch(text, /SECRET/);
	const ok = s.records[0]!;
	assert.equal(ok.level, 'info');
	assert.equal(ok.msg, 'agent command');
	assert.deepEqual(Object.keys(ok.fields!).sort(), ['caller', 'command', 'ms', 'outputChars', 'policy', 'status', 'subcommand', 'truncated']);
	assert.equal(ok.fields!['subcommand'], 'ls');
	assert.equal(s.records[1]!.level, 'warn');
	assert.equal(s.records[1]!.fields!['command'], undefined);
	assert.equal(s.records[1]!.fields!['status'], 'unknown');
});

function fakeViews(order: string[] = []) {
	const mounts: {handle: AgentViewHandle; print: (text: string) => void; closed: number; resolve: () => void; reject: (e: Error) => void}[] = [];
	const mountView: BridgeDeps['mountView'] = (_build, print) => {
		let resolve!: () => void;
		let reject!: (e: Error) => void;
		const done = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const entry = {
			handle: {
				done,
				close: () => {
					entry.closed++;
					order.push('close');
					resolve();
				},
			},
			print,
			closed: 0,
			resolve,
			reject,
		};
		mounts.push(entry);
		return entry.handle;
	};
	return {mounts, mountView};
}

const viewCommand = (name: string, body: (ctx: Parameters<Command['run']>[1]) => Promise<void> | void): Command => ({
	name,
	description: name,
	agent: 'safe',
	run: (_a, ctx) => body(ctx),
});

test('mount is rejected for main, a missing target, a throwing options getter and a non-function build', async () => {
	const errors: string[] = [];
	const views = fakeViews();
	const s = setup({
		mountView: views.mountView,
		commands: [
			viewCommand('v', async ctx => {
				const attempts: (() => Promise<void>)[] = [
					() => ctx.mount!(() => ({}), {target: 'main'}),
					() => ctx.mount!(() => ({})),
					() => ctx.mount!(() => ({}), {} as never),
					() => ctx.mount!(() => ({}), {get target(): never { throw new Error('boom'); }} as never),
					() => ctx.mount!('nope' as never, {target: 'panel'}),
				];
				for (const attempt of attempts) {
					try {
						await attempt();
					} catch (e) {
						errors.push((e as Error).message);
					}
				}
			}),
		],
	});
	const r = await run(s, 'v');
	assert.equal(r.status, 'ok');
	assert.equal(views.mounts.length, 0);
	assert.deepEqual(errors, [
		'Assistant commands can only show views in the console panel',
		'Assistant commands can only show views in the console panel',
		'Assistant commands can only show views in the console panel',
		'Assistant commands can only show views in the console panel',
		'A view needs a build function',
	]);
	assert.equal(s.records.find(x => x.msg === 'agent command')?.fields?.['mounted'], undefined);
});

test('without mountView the agent context has no mount', async () => {
	let has: boolean | undefined;
	const s = setup({commands: [viewCommand('v', ctx => void (has = 'mount' in ctx))]});
	await run(s, 'v');
	assert.equal(has, false);
});

test('a view still open when the command settles is closed before the lock is released', async () => {
	const order: string[] = [];
	const views = fakeViews(order);
	const s = setup({
		mountView: views.mountView,
		commands: [
			viewCommand('v', ctx => {
				void ctx.mount!(() => ({}), {target: 'panel'});
			}),
			{name: 'next', description: 'n', agent: 'safe', run: () => void order.push('next')},
		],
	});
	const r = await run(s, 'v');
	assert.equal(r.status, 'ok');
	assert.equal(views.mounts[0]?.closed, 1);
	assert.equal((await run(s, 'next')).status, 'ok');
	assert.deepEqual(order, ['close', 'next']);
	const log = s.records.find(x => x.msg === 'agent command' && x.fields?.['command'] === 'v');
	assert.equal(log?.fields?.['mounted'], true);
	assert.equal(log?.fields?.['viewForced'], true);
	assert.doesNotMatch(JSON.stringify(log), /line/);
});

test('a view closed by the command itself is not marked forced', async () => {
	const views = fakeViews();
	const s = setup({
		mountView: views.mountView,
		commands: [viewCommand('v', async ctx => {
			const done = ctx.mount!(() => ({}), {target: 'panel'});
			views.mounts[0]!.resolve();
			await done;
		})],
	});
	await run(s, 'v');
	const fields = s.records.find(x => x.msg === 'agent command')?.fields;
	assert.equal(fields?.['mounted'], true);
	assert.equal('viewForced' in (fields ?? {}), false);
});

test('mount after the command ended is rejected', async () => {
	const views = fakeViews();
	let saved: Parameters<Command['run']>[1] | undefined;
	const s = setup({mountView: views.mountView, commands: [viewCommand('v', ctx => void (saved = ctx))]});
	await run(s, 'v');
	await assert.rejects(saved!.mount!(() => ({}), {target: 'panel'}), /has ended/);
	assert.equal(views.mounts.length, 0);
});

test('control.print goes through the bridge: sanitised, teed and captured', async () => {
	const views = fakeViews();
	const s = setup({
		mountView: views.mountView,
		commands: [viewCommand('v', async ctx => {
			const done = ctx.mount!(() => ({}), {target: 'panel'});
			views.mounts[0]!.print('seen\u001b[31m red\u202e');
			views.mounts[0]!.resolve();
			await done;
		})],
	});
	const r = await run(s, 'v');
	assert.equal(r.output, 'seen red');
	assert.ok(s.tee.some(t => t.text === 'seen red'));
});

test('a refused view (rejected done) lets the command fall back to print', async () => {
	const s = setup({
		mountView: () => ({done: Promise.reject(new Error('A view is already mounted')), close: () => {}}),
		commands: [viewCommand('v', async ctx => {
			try {
				await ctx.mount!(() => ({}), {target: 'panel'});
			} catch {
				ctx.print('plain fallback');
			}
		})],
	});
	const r = await run(s, 'v');
	assert.equal(r.status, 'ok');
	assert.equal(r.output, 'plain fallback');
});

test('a throwing mountView rejects the mount without throwing from the bridge', async () => {
	const s = setup({
		mountView: () => {
			throw new Error('nope');
		},
		commands: [viewCommand('v', async ctx => ctx.mount!(() => ({}), {target: 'panel'}))],
	});
	const r = await run(s, 'v');
	assert.equal(r.status, 'error');
	assert.equal(r.reason, 'nope');
});

test('beforeRun and endRun wrap only runs that reached execution, and a throwing hook is harmless', async () => {
	const calls: string[] = [];
	const s = setup({
		commands: [say('a', 'safe'), say('c', 'confirm')],
		hooks: {
			beforeRun: () => {
				calls.push('before');
				throw new Error('x');
			},
			endRun: () => {
				calls.push('end');
				throw new Error('y');
			},
		},
	});
	assert.equal((await run(s, 'nope')).status, 'unknown');
	assert.equal((await run(s, 'c')).status, 'declined');
	assert.deepEqual(calls, []);
	assert.equal((await run(s, 'a')).status, 'ok');
	assert.deepEqual(calls, ['before', 'end']);
});
