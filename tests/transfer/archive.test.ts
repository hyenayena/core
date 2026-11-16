import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import type {ModuleDataFile} from '../../../../src/api.js';
import {ArchiveError, buildArchive, parseArchive, type ArchiveManifest, type ArchiveModule} from '../../src/transfer/archive.js';
import {writeTar, type TarEntry} from '../../src/transfer/tar.js';

const file = (path: string, text = 'x', mode = 0o644): ModuleDataFile => ({path, mode, mtimeMs: 1_700_000_000_000, data: Buffer.from(text)});
const mod = (over: Partial<ArchiveModule> = {}): ArchiveModule => ({name: 'md', version: '1.0.0', data: 'exported', files: 1, bytes: 1, ...over});
const manifest = (modules: ArchiveModule[] = [mod()], over: Record<string, unknown> = {}) =>
	({format: 'yena-export', version: 1, yena: '0.9.0', created: '2026-11-16T10:00:00.000Z', modules, ...over}) as ArchiveManifest;
const raw = (entries: TarEntry[]) => gzipSync(writeTar(entries));
const tarEntry = (path: string, text: string): TarEntry => ({path, mode: 0o644, mtimeMs: 0, data: Buffer.from(text)});
const withManifest = (m: unknown, extra: TarEntry[] = []) => raw([tarEntry('manifest.json', JSON.stringify(m)), ...extra]);
const refuse = (buf: Uint8Array, pattern?: RegExp) => assert.rejects(parseArchive(buf), (e: Error) => e instanceof ArchiveError && (pattern ? pattern.test(e.message) : true));

test('a valid archive round trips data and code with masked modes', async () => {
	const m = manifest([
		mod({files: 2, bytes: 3}),
		mod({name: 'clan', version: '0.1.0', data: 'denied', files: 0, bytes: 0, code: {files: 2, bytes: 5}}),
		mod({name: 'task', version: '2.0.0', source: 'task', commit: 'a'.repeat(40), account: 'work', host: '^0.9.0', files: 0, bytes: 0}),
	]);
	m.modules[2]!.data = 'exported';
	const buf = await buildArchive(m, [{module: 'md', file: file('a.txt', 'a')}, {module: 'md', file: file('d/b.txt', 'bb', 0o100755)}], [
		{module: 'clan', file: file('yena.json', '{}')},
		{module: 'clan', file: file('bin/run', 'abc', 0o755)},
	]);
	const parsed = await parseArchive(buf);
	assert.deepEqual(parsed.manifest, m);
	assert.deepEqual(parsed.data.get('md')?.map(f => [f.path, f.mode, Buffer.from(f.data).toString()]), [['a.txt', 0o644, 'a'], ['d/b.txt', 0o755, 'bb']]);
	assert.deepEqual(parsed.code.get('clan')?.map(f => f.path), ['yena.json', 'bin/run']);
});

test('manifest problems are refused', async () => {
	await refuse(raw([tarEntry('data/md/a', 'x')]), /manifest\.json/);
	await refuse(raw([tarEntry('other', '{}'), tarEntry('manifest.json', '{}')]), /manifest\.json/);
	await refuse(raw([tarEntry('manifest.json', '{nope')]), /JSON/);
	await refuse(withManifest(manifest([], {format: 'zip'})), /not a yena export/);
	await refuse(withManifest(manifest([], {version: 2})), /format version 2; this yena reads version 1/);
	await refuse(withManifest(manifest([], {modules: 'x'})));
	await refuse(withManifest(manifest([], {created: 'yesterday'})));
});

test('module entries are validated', async () => {
	const bad = (over: Partial<ArchiveModule> | Record<string, unknown>) => refuse(withManifest(manifest([mod({files: 0, bytes: 0, ...over} as Partial<ArchiveModule>)])));
	await bad({name: 'Bad Name'});
	await bad({name: 'host'});
	await bad({name: '-x'});
	await bad({version: ''});
	await bad({version: 'v'.repeat(65)});
	await bad({source: 'x'.repeat(501)});
	await bad({source: 'a\nb'});
	await bad({commit: 'abc'});
	await bad({account: 'Bad Account'});
	await bad({data: 'maybe'});
	await bad({host: 'h'.repeat(65)});
	await bad({code: {files: 1, bytes: 1}, source: 'x'});
	await refuse(withManifest(manifest([mod({files: 0, bytes: 0}), mod({files: 0, bytes: 0})])), /twice/);
});

test('entry paths are validated', async () => {
	const one = (path: string) => refuse(withManifest(manifest(), [tarEntry(path, 'x')]));
	await one('data/md//a');
	await one('data/md/../a');
	await one('data/md/./a');
	await one('data/md/a\\b');
	await one(`data/md/a${String.fromCharCode(7)}b`);
	await one(`data/md/${'x'.repeat(70)}/${'y'.repeat(70)}/${'z'.repeat(99)}`);
	await one(`data/md/${Array.from({length: 33}, () => 'd').join('/')}`);
	await one('data/md');
	await one('data/other/a');
	await one('stuff/md/a');
	await one('/data/md/a');
	await refuse(withManifest(manifest([mod({files: 2, bytes: 2})]), [tarEntry('data/md/a', 'x'), tarEntry('data/md/a', 'x')]), /twice/);
});

test('entries must match what the manifest declares', async () => {
	await refuse(withManifest(manifest([mod({data: 'denied', files: 0, bytes: 0})]), [tarEntry('data/md/a', 'x')]), /does not declare/);
	await refuse(withManifest(manifest([mod({files: 2, bytes: 1})]), [tarEntry('data/md/a', 'x')]), /does not match/);
	await refuse(withManifest(manifest([mod({files: 1, bytes: 5})]), [tarEntry('data/md/a', 'x')]), /does not match/);
	await refuse(withManifest(manifest([mod({files: 0, bytes: 0})]), [tarEntry('code/md/yena.json', '{}')]), /does not declare/);
});

test('carried code needs yena.json and matching counts', async () => {
	const carried = (code: {files: number; bytes: number}) => manifest([mod({data: 'denied', files: 0, bytes: 0, code})]);
	await refuse(withManifest(carried({files: 1, bytes: 1}), [tarEntry('code/md/index.js', 'x')]), /no yena\.json/);
	await refuse(withManifest(carried({files: 2, bytes: 3}), [tarEntry('code/md/yena.json', '{}')]), /does not match/);
	await refuse(withManifest(carried({files: 1, bytes: 2}), [tarEntry('code/md/../yena.json', '{}')]));
	const ok = await parseArchive(withManifest(carried({files: 1, bytes: 2}), [tarEntry('code/md/yena.json', '{}')]));
	assert.equal(ok.code.get('md')?.length, 1);
});

test('a gzip that unpacks past the limit is refused', async () => {
	const bomb = gzipSync(Buffer.alloc(400 * 1024 * 1024));
	await refuse(bomb, /larger than 256 MiB unpacked/);
});

test('data that is not gzip is refused', async () => {
	await refuse(Buffer.from('plain text'), /gzip/);
});
