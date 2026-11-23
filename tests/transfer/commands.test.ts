import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import type {Command, CommandContext, ImportPlan, ImportRequest, Logger, ModuleDataFile, ModuleDataRead, ModuleInfo, ModuleRegistry, ModuleTarget} from '../../../../src/api.js';
import {plainLines} from '../../src/kit/styled.js';
import {commandErrorKind} from '../../src/kit/command-error.js';
import {parseArchive} from '../../src/transfer/archive.js';
import {createTransferCommands} from '../../src/transfer/commands.js';
import {decryptArchive, isEncrypted, isGzip} from '../../src/transfer/crypto.js';
import type {Prompts} from '../../src/transfer/prompts.js';

const SECRET = 'SENTINEL-password-1234';
const KDF = {logN: 10, r: 8, p: 1};
const COMMIT = 'a'.repeat(40);
const NOW = new Date('2026-11-16T10:00:30.000Z');

const file = (p: string, text: string): ModuleDataFile => ({path: p, mode: 0o644, mtimeMs: 1_700_000_000_000, data: Buffer.from(text)});
const info = (name: string, over: Partial<ModuleInfo> = {}): ModuleInfo => ({
	name,
	version: '1.0.0',
	origin: 'image',
	exportList: true,
	lock: {source: name, version: '1.0.0', commit: COMMIT},
	code: {carry: false},
	...over,
});
const readOf = (files: ModuleDataFile[], over: Partial<ModuleDataRead> = {}): ModuleDataRead => ({files, skipped: 0, notes: [], defaultDeny: false, ...over});

type Fake = ModuleRegistry & {calls: string[]; requests: ImportRequest[]; planned: ModuleTarget[][]};

function fakeRegistry(over: {infos?: ModuleInfo[]; plan?: ImportPlan; apply?: () => Promise<void>} = {}): Fake {
	const infos = over.infos ?? [
		info('md'),
		info('priv', {exportList: false}),
		info('clan', {lock: undefined, code: {carry: true, reason: 'not in the module lock'}, exportList: false}),
	];
	const fake: Fake = {
		calls: [],
		requests: [],
		planned: [],
		async list() {
			return infos;
		},
		async readData(name) {
			if (name === 'md') return readOf([file('a.txt', 'hello'), file('notes/b.txt', 'world')], {skipped: 1, notes: ['1 links skipped']});
			if (name === 'priv') return readOf([], {skipped: 3, defaultDeny: true});
			return readOf([], {skipped: 0, defaultDeny: true});
		},
		async readCode(name) {
			assert.equal(name, 'clan');
			return readOf([file('yena.json', '{"name":"clan"}'), file('src/index.js', 'code')]);
		},
		async planImport(targets) {
			fake.calls.push('plan');
			fake.planned.push([...targets]);
			return over.plan ?? {hostVersion: '0.9.0', steps: [], untouched: [], problems: []};
		},
		async applyImport(request) {
			fake.calls.push('apply');
			fake.requests.push(request);
			await over.apply?.();
			return {plan: over.plan ?? {hostVersion: '0.9.0', steps: [], untouched: [], problems: []}, replaced: request.data.map(d => ({name: d.name, written: d.files.length, removed: 1, kept: 0, skipped: 0, defaultDeny: false}))};
		},
	};
	return fake;
}

function fakePrompts(over: Partial<Prompts> = {}): Prompts & {calls: string[]} {
	const calls: string[] = [];
	return {
		calls,
		available: () => true,
		async preload() {
			calls.push('preload');
		},
		async askNewSecret() {
			calls.push('askNewSecret');
			return SECRET;
		},
		async askSecret(_ctx, kind) {
			calls.push(`askSecret:${kind}`);
			return SECRET;
		},
		async showCodeWord() {
			calls.push('showCodeWord');
			return true;
		},
		async confirmApply() {
			calls.push('confirmApply');
			return true;
		},
		...over,
	};
}

async function setup(over: {registry?: ModuleRegistry | null; prompts?: Prompts; build?: {version: string}} = {}) {
	const dataDir = await mkdtemp(path.join(tmpdir(), 'transfer-'));
	const records: string[] = [];
	const redactors: ((t: string) => string)[] = [];
	const push = (level: string) => (message: string, fields?: unknown) => void records.push(JSON.stringify([level, message, fields, String((fields as {err?: unknown} | undefined)?.err ?? '')]));
	const log: Logger = {error: push('error'), warn: push('warn'), info: push('info'), debug: push('debug'), child: () => log, addRedactor: fn => void redactors.push(fn)};
	const registry = over.registry === null ? undefined : (over.registry ?? fakeRegistry());
	const prompts = over.prompts ?? fakePrompts();
	const commands = createTransferCommands({
		...(registry && {modules: registry}),
		build: {version: over.build?.version ?? '0.9.0', modules: []},
		dataDir,
		log,
		prompts,
		kdf: KDF,
		now: () => NOW,
	});
	const out: string[] = [];
	const ctx: CommandContext = {
		print: t => void out.push(t),
		printStyled: blocks => void out.push(...plainLines(blocks)),
		clear() {},
		exit() {},
	};
	const command = (name: string): Command => commands.find(c => c.name === name)!;
	return {dataDir, records, redactors, registry: registry as Fake, prompts: prompts as ReturnType<typeof fakePrompts>, out, ctx, run: async (name: string, ...args: string[]) => command(name).run(args, ctx), command};
}

const usage = (e: unknown) => commandErrorKind(e) === 'usage';
const exportsOf = async (dir: string) => readdir(path.join(dir, 'exports')).catch(() => [] as string[]);
const text = (t: {out: string[]}) => t.out.join('\n');

test('policies and docs', async () => {
	const t = await setup();
	assert.equal(t.command('export').agent, 'confirm');
	assert.equal(t.command('import').agent, 'deny');
	assert.deepEqual(t.command('export').options?.map(o => o.name), ['--no-encrypt']);
	assert.deepEqual(t.command('import').options?.map(o => o.name), ['--yes']);
});

test('without a registry both commands fail', async () => {
	const t = await setup({registry: null});
	await assert.rejects(t.run('export'), /needs yena 0\.9\.0/);
	await assert.rejects(t.run('import', 'x'), /needs yena 0\.9\.0/);
});

test('usage errors', async () => {
	const t = await setup();
	await assert.rejects(t.run('export', 'a', 'b'), usage);
	await assert.rejects(t.run('export', '--bogus'), usage);
	await assert.rejects(t.run('import'), usage);
	await assert.rejects(t.run('import', 'a', 'b'), usage);
	await assert.rejects(t.run('import', 'a', '--bogus'), usage);
	assert.deepEqual(t.registry.calls, []);
});

test('an encrypted export gets the default name, mode 0600, and opens with the password', async () => {
	const t = await setup();
	await t.run('export');
	const name = 'yena-2026-11-16-10-00.yna';
	assert.deepEqual(await exportsOf(t.dataDir), [name]);
	const target = path.join(t.dataDir, 'exports', name);
	assert.equal((await stat(target)).mode & 0o777, 0o600);
	const buf = await readFile(target);
	assert.equal(isEncrypted(buf), true);
	const parsed = await parseArchive(await decryptArchive(buf, SECRET));
	assert.deepEqual(
		parsed.manifest.modules.map(m => [m.name, m.data, m.files, m.source, m.commit, m.code?.files]),
		[['md', 'exported', 2, 'md', COMMIT, undefined], ['priv', 'denied', 0, 'priv', COMMIT, undefined], ['clan', 'denied', 0, undefined, undefined, 2]],
	);
	assert.deepEqual(parsed.code.get('clan')?.map(f => f.path), ['yena.json', 'src/index.js']);
	assert.match(text(t), /clan\s.*carried \(2 files\)/);
	assert.match(text(t), /clan: code carried in the file \(not in the module lock\), 2 files/);
	assert.match(text(t), /priv has no \[deny export\] section in its \.yenarules: its 3 files were not exported/);
	assert.match(text(t), /md: 1 links skipped/);
	assert.match(text(t), /Encrypted with the password you typed/);
	assert.match(text(t), /Saved .*yena-2026-11-16-10-00\.yna \(.*, 4 files from 3 modules\)/);
	await t.run('export');
	assert.deepEqual((await exportsOf(t.dataDir)).sort(), ['yena-2026-11-16-10-00-2.yna', name]);
});

test('an explicit path is never overwritten; relative paths start in exports', async () => {
	const t = await setup();
	await t.run('export', 'mine.yna');
	assert.deepEqual(await exportsOf(t.dataDir), ['mine.yna']);
	await assert.rejects(t.run('export', 'mine.yna'), (e: Error) => commandErrorKind(e) === 'invalid' && /already exists/.test(e.message));
	const abs = path.join(t.dataDir, 'elsewhere', 'x.enc');
	await t.run('export', abs);
	assert.equal((await stat(abs)).isFile(), true);
});

test('--no-encrypt writes a gzip file and the unsafe warning, without asking for a password', async () => {
	const t = await setup();
	await t.run('export', '--no-encrypt');
	assert.deepEqual(await exportsOf(t.dataDir), ['yena-2026-11-16-10-00.yna']);
	assert.equal(isGzip(await readFile(path.join(t.dataDir, 'exports', 'yena-2026-11-16-10-00.yna'))), true);
	assert.match(text(t), /Unsafe: the file is not encrypted/);
	assert.deepEqual(t.prompts.calls, []);
});

test('without an app or terminal encryption fails unless --no-encrypt is given', async () => {
	const t = await setup({prompts: fakePrompts({available: () => false})});
	await assert.rejects(t.run('export'), (e: Error) => commandErrorKind(e) === 'failed' && /add --no-encrypt/.test(e.message));
	assert.deepEqual(await exportsOf(t.dataDir), []);
	await t.run('export', '--no-encrypt');
	assert.equal((await exportsOf(t.dataDir)).length, 1);
});

test('an empty password generates a code word that is shown once and never printed or logged', async () => {
	let shown = '';
	const t = await setup({
		prompts: fakePrompts({
			async askNewSecret() {
				return '';
			},
			async showCodeWord(_ctx, code) {
				shown = code;
				return true;
			},
		}),
	});
	await t.run('export');
	assert.match(shown, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/);
	const files = await exportsOf(t.dataDir);
	const buf = await readFile(path.join(t.dataDir, 'exports', files[0]!));
	await parseArchive(await decryptArchive(buf, shown.replaceAll('-', '').toLowerCase()));
	assert.match(text(t), /Encrypted with the code word shown in the console/);
	assert.equal(text(t).includes(shown), false);
	assert.equal(t.records.join('\n').includes(shown), false);
	assert.equal(t.redactors[0]!(`code ${shown}`), 'code ***');
});

test('a code word that was not acknowledged writes nothing', async () => {
	const t = await setup({prompts: fakePrompts({askNewSecret: async () => '', showCodeWord: async () => false})});
	await t.run('export');
	assert.deepEqual(await exportsOf(t.dataDir), []);
	assert.match(text(t), /Export cancelled; nothing was written/);
});

test('cancelling the password prompt writes nothing and is not an error', async () => {
	const t = await setup({prompts: fakePrompts({askNewSecret: async () => undefined})});
	await t.run('export');
	assert.deepEqual(await exportsOf(t.dataDir), []);
	assert.match(text(t), /Export cancelled; nothing was written/);
	assert.deepEqual(t.registry.calls, []);
});

test('the password reaches neither the output nor the logs, and the redactor masks it while live', async () => {
	const t = await setup();
	await t.run('export');
	assert.equal(text(t).includes(SECRET), false);
	assert.equal(t.records.join('\n').includes(SECRET), false);
	assert.match(t.records.join('\n'), /export done/);
	assert.match(t.records.join('\n'), /"encryption":"password"/);
});

async function exported(t: Awaited<ReturnType<typeof setup>>, ...flags: string[]): Promise<string> {
	await t.run('export', 'in.bin', ...flags);
	t.out.length = 0;
	return 'in.bin';
}

const PLAN: ImportPlan = {
	hostVersion: '0.9.0',
	steps: [
		{name: 'md', action: 'update', from: '0.9.0', to: '1.0.0'},
		{name: 'priv', action: 'unchanged', from: '1.0.0', to: '1.0.0'},
		{name: 'clan', action: 'downgrade', from: '2.0.0', to: '1.0.0', fromFile: true},
	],
	untouched: ['extra'],
	problems: [],
};

test('import without --yes shows the plan and applies nothing when declined or unanswerable', async () => {
	const t = await setup({registry: fakeRegistry({plan: PLAN, infos: [info('md'), info('priv', {exportList: false}), info('extra'), info('clan')]}), prompts: fakePrompts({confirmApply: async () => false})});
	const name = await exported(t);
	await t.run('import', name);
	assert.deepEqual(t.registry.calls.filter(c => c !== 'plan'), []);
	const shown = text(t);
	assert.match(shown, /Archive from yena 0\.9\.0, made 2026-11-16 10:00 UTC/);
	assert.match(shown, /md\s+0\.9\.0\s+1\.0\.0\s+update 0\.9\.0 → 1\.0\.0\s+replace \(2 files\)/);
	assert.match(shown, /priv\s.*unchanged\s+not exported/);
	assert.match(shown, /clan\s.*replace code \(from the file\) 2\.0\.0 → 1\.0\.0 \(downgrade\)/);
	assert.match(shown, /extra\s.*not in the export\s+untouched/);
	assert.match(shown, /This import installs code that came from the file: clan\./);
	assert.match(shown, /Import only files you made yourself: module data holds instructions/);
	assert.match(shown, /Nothing was changed\./);

	const unanswerable = await setup({prompts: fakePrompts({confirmApply: async () => undefined})});
	await unanswerable.run('export', 'in.bin', '--no-encrypt');
	await unanswerable.run('import', 'in.bin');
	assert.match(text(unanswerable), /Run "import in\.bin --yes" to apply\./);
	assert.equal(unanswerable.registry.calls.includes('apply'), false);
});

test('Change texts for each action', async () => {
	const plan: ImportPlan = {
		hostVersion: '0.9.0',
		steps: [
			{name: 'md', action: 'install', to: '1.0.0'},
			{name: 'priv', action: 'update', from: '1.0.0', to: '1.0.0', fromCommit: 'abcdef0123', toCommit: '1234567890'},
			{name: 'clan', action: 'install', to: '1.0.0', fromFile: true},
		],
		untouched: [],
		problems: [],
	};
	const t = await setup({registry: fakeRegistry({plan}), prompts: fakePrompts({confirmApply: async () => false})});
	await t.run('export', 'in.bin', '--no-encrypt');
	t.out.length = 0;
	await t.run('import', 'in.bin');
	const shown = text(t);
	assert.match(shown, /md\s+-\s+1\.0\.0\s+install\s/);
	assert.match(shown, /update \(abcdef0 → 1234567\)/);
	assert.match(shown, /install \(code from the file\)/);
});

test('plan problems refuse the import before any change', async () => {
	const t = await setup({registry: fakeRegistry({plan: {...PLAN, problems: ['md: the export has no commit for it']}})});
	const name = await exported(t);
	await assert.rejects(t.run('import', name, '--yes'), (e: Error) => commandErrorKind(e) === 'invalid' && /Import refused, nothing was changed: 1 module\(s\)/.test(e.message));
	assert.match(text(t), /md: the export has no commit for it/);
	assert.equal(t.registry.calls.includes('apply'), false);
});

test('--yes applies once: targets, exported data only, backup dir, restart line', async () => {
	const t = await setup({registry: fakeRegistry({plan: PLAN})});
	const name = await exported(t);
	await t.run('import', name, '--yes');
	assert.equal(t.registry.requests.length, 1);
	const request = t.registry.requests[0]!;
	assert.deepEqual(request.targets.map(x => [x.name, x.source, x.code?.length]), [['md', 'md', undefined], ['priv', 'priv', undefined], ['clan', undefined, 2]]);
	assert.deepEqual(request.data.map(d => [d.name, d.files.length]), [['md', 2]]);
	assert.equal(request.backupDir.startsWith(path.join(t.dataDir, 'backups', 'import-')), true);
	assert.match(request.backupDir, /import-2026-11-16-10-00-30$/);
	assert.equal(t.prompts.calls.includes('confirmApply'), false);
	assert.match(text(t), /Backup of the replaced files: /);
	assert.match(text(t), /Restart yena now \(exit, then start it again\)/);
	assert.match(t.records.join('\n'), /import done/);
});

test('the views are loaded before applyImport and nothing is asked after it', async () => {
	const order: string[] = [];
	const registry = fakeRegistry({plan: PLAN});
	const apply = registry.applyImport.bind(registry);
	registry.applyImport = async (r, l) => {
		order.push('apply');
		return apply(r, l);
	};
	const prompts = fakePrompts({
		preload: async () => void order.push('preload'),
		askSecret: async () => (order.push('secret'), SECRET),
		confirmApply: async () => (order.push('confirm'), true),
	});
	const t = await setup({registry, prompts});
	await t.run('export', 'in.bin');
	await t.run('import', 'in.bin');
	assert.deepEqual(order, ['preload', 'secret', 'confirm', 'apply']);
});

test('an encrypted file asks for the secret of its kind; a wrong one changes nothing', async () => {
	const t = await setup({prompts: fakePrompts({askNewSecret: async () => ''})});
	await t.run('export', 'in.bin');
	t.out.length = 0;
	const wrong = await setup({prompts: fakePrompts({askSecret: async () => 'not the secret!!'})});
	await writeFile(path.join(wrong.dataDir, 'exports.tmp'), await readFile(path.join(t.dataDir, 'exports', 'in.bin')));
	await assert.rejects(wrong.run('import', path.join(wrong.dataDir, 'exports.tmp'), '--yes'), (e: Error) => commandErrorKind(e) === 'invalid' && /Wrong password or code word/.test(e.message));
	assert.equal(wrong.registry.calls.length, 0);
	assert.deepEqual(wrong.prompts.calls, ['preload']);
});

test('the secret prompt of an import uses the header kind and a cancelled prompt changes nothing', async () => {
	const kinds: string[] = [];
	const t = await setup({prompts: fakePrompts({askNewSecret: async () => ''})});
	await t.run('export', 'in.bin');
	const reader = await setup({
		prompts: fakePrompts({
			askSecret: async (_c, kind) => (kinds.push(kind), undefined),
		}),
	});
	const copy = path.join(reader.dataDir, 'copy.bin');
	await writeFile(copy, await readFile(path.join(t.dataDir, 'exports', 'in.bin')));
	await reader.run('import', copy, '--yes');
	assert.deepEqual(kinds, ['code']);
	assert.match(text(reader), /Import cancelled; nothing was changed/);
	assert.equal(reader.registry.calls.length, 0);
});

test('a plain file warns that it is not encrypted', async () => {
	const t = await setup({registry: fakeRegistry({plan: {hostVersion: '0.9.0', steps: [], untouched: [], problems: []}})});
	await t.run('export', 'in.bin', '--no-encrypt');
	t.out.length = 0;
	await t.run('import', 'in.bin', '--yes');
	assert.match(text(t), /This file is not encrypted/);
	assert.equal(t.registry.requests.length, 1);
});

test('malformed or missing files are refused with nothing changed', async () => {
	const t = await setup();
	await writeFile(path.join(t.dataDir, 'junk'), 'not an export');
	await assert.rejects(t.run('import', path.join(t.dataDir, 'junk'), '--yes'), (e: Error) => commandErrorKind(e) === 'invalid' && /Not a valid yena export/.test(e.message));
	await assert.rejects(t.run('import', 'missing.bin', '--yes'), (e: Error) => commandErrorKind(e) === 'not-found');
	await assert.rejects(t.run('import', t.dataDir, '--yes'), (e: Error) => commandErrorKind(e) === 'invalid');
	assert.equal(t.registry.calls.length, 0);
});

test('a failing applyImport says nothing was changed', async () => {
	const t = await setup({registry: fakeRegistry({plan: PLAN, apply: async () => Promise.reject(new Error('install script failed'))})});
	const name = await exported(t);
	await assert.rejects(t.run('import', name, '--yes'), /Import failed, nothing was changed: install script failed/);
});

test('a newer yena in the file is noted', async () => {
	const maker = await setup();
	await maker.run('export', 'in.bin', '--no-encrypt');
	const t = await setup({build: {version: '0.8.0'}, prompts: fakePrompts({confirmApply: async () => false})});
	const copy = path.join(t.dataDir, 'copy.bin');
	await writeFile(copy, await readFile(path.join(maker.dataDir, 'exports', 'in.bin')));
	await t.run('import', copy);
	assert.match(text(t), /The file was made by a newer yena \(0\.9\.0\)/);
});
