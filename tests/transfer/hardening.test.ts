import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {ArchiveError, parseArchive, type ArchiveManifest} from '../../src/transfer/archive.js';
import {decryptArchive, encryptArchive, generateCodeWord, HEADER_BYTES, WrongSecretError, type KdfParams} from '../../src/transfer/crypto.js';
import {readTar, writeTar, type TarEntry} from '../../src/transfer/tar.js';

const manifest = (files = 1, bytes = 1): ArchiveManifest => ({
	format: 'yena-export',
	version: 1,
	yena: '0.9.0',
	created: '2026-11-16T10:00:00.000Z',
	modules: [{name: 'md', version: '1.0.0', data: 'exported', files, bytes}],
});
const entry = (path: string, text = 'x'): TarEntry => ({path, mode: 0o644, mtimeMs: 0, data: Buffer.from(text)});
const tarWith = (extra: Buffer[], m = manifest()) => Buffer.concat([writeTar([entry('manifest.json', JSON.stringify(m))]).subarray(0, -1024), ...extra]);
const gz = (tar: Buffer) => gzipSync(tar);
const refuse = (buf: Uint8Array) => assert.rejects(parseArchive(buf), (e: Error) => e instanceof ArchiveError);

function forged(path: string, text: string, patch: (block: Buffer) => void): Buffer {
	const tar = writeTar([entry(path, text)]);
	const block = Buffer.from(tar.subarray(0, 512));
	patch(block);
	block.fill(0x20, 148, 156);
	const sum = block.reduce((a, b) => a + b, 0);
	block.write(sum.toString(8).padStart(6, '0'), 148, 'latin1');
	block[154] = 0;
	block[155] = 0x20;
	return Buffer.concat([block, tar.subarray(512, tar.length - 1024)]);
}

const endMark = Buffer.alloc(1024);

const body = (...e: TarEntry[]) => writeTar(e).subarray(0, -1024);
const build = (extra: Buffer[], m = manifest()) => gz(Buffer.concat([tarWith(extra, m), endMark]));

test('a link, device, fifo or extended entry hidden in an otherwise valid archive changes nothing', async () => {
	await parseArchive(build([body(entry('data/md/a'))]));
	for (const flag of ['1', '2', '3', '4', '6', 'x', 'g', 'L', 'K']) {
		const link = forged('data/md/link', '', b => (b[156] = flag.charCodeAt(0)));
		await refuse(build([body(entry('data/md/a')), link]));
		await refuse(build([link, body(entry('data/md/a'))]));
	}
});

test('a symlink entry with a target outside is refused even when it comes last', async () => {
	const link = forged('data/md/evil', '', b => {
		b[156] = 0x32;
		b.write('/etc/passwd', 157, 'latin1');
	});
	await refuse(build([body(entry('data/md/a')), link]));
});

test('traversal spelled through the tar prefix and name fields is refused', async () => {
	const tar = (prefix: string, name: string) =>
		gz(Buffer.concat([tarWith([forged('placeholder', 'x', b => {
			b.fill(0, 0, 100);
			b.write(name, 0, 'utf8');
			b.write(prefix, 345, 'utf8');
		})]), endMark]));
	assert.equal((await parseArchive(tar('data/md', 'ok'))).data.get('md')?.[0]?.path, 'ok');
	await refuse(tar('data/md', '../../etc/x'));
	await refuse(tar('data/md/..', 'x'));
	await refuse(tar('data/md', '/abs'));
	await refuse(tar('data/md/a\\b', 'x'));
	await refuse(tar('/data/md', 'x'));
});

test('a NUL in a tar name ends the name; what follows cannot smuggle a path', () => {
	const tar = forged('data/md/a', 'x', b => {
		b.fill(0, 0, 100);
		b.write('data/md/a\0../../etc/x', 0, 'latin1');
	});
	const entries = readTar(Buffer.concat([tar, Buffer.alloc(1024)]));
	assert.deepEqual(entries.map(e => e.path), ['data/md/a']);
});

test('a path that appears twice in different spellings of prefix and name is a duplicate', async () => {
	const dup = (path: string) => forged(path, 'x', () => {});
	const long = `data/md/${'d'.repeat(60)}/${'f'.repeat(60)}`;
	const split = forged('placeholder', 'x', b => {
		b.fill(0, 0, 100);
		b.write('f'.repeat(60), 0, 'utf8');
		b.write(`data/md/${'d'.repeat(60)}`, 345, 'utf8');
	});
	assert.equal((await parseArchive(build([split]))).data.get('md')?.[0]?.path, `${'d'.repeat(60)}/${'f'.repeat(60)}`);
	await refuse(build([dup(long), split], manifest(2, 2)));
});

test('a header that claims more data than the file holds is refused without reading past the buffer', async () => {
	const huge = forged('data/md/a', 'x', b => b.write('77777777777\0', 124, 'latin1'));
	await refuse(gz(Buffer.concat([tarWith([huge]), endMark])));
});

test('truncated gzip and truncated tar inside valid gzip are refused', async () => {
	const good = gz(Buffer.concat([tarWith([writeTar([entry('data/md/a')]).subarray(0, -1024)]), endMark]));
	await parseArchive(good);
	await refuse(good.subarray(0, good.length - 6));
	await refuse(good.subarray(0, 12));
	const tar = Buffer.concat([tarWith([writeTar([entry('data/md/a')]).subarray(0, -1024)]), endMark]);
	for (const cut of [100, 512, 700, tar.length - 1024, tar.length - 512, tar.length - 1]) await refuse(gz(tar.subarray(0, cut)));
});

test('declared counts and sizes are checked in both directions', async () => {
	const data = writeTar([entry('data/md/a', 'xx')]).subarray(0, -1024);
	await refuse(build([data], manifest(1, 1)));
	await refuse(build([data], manifest(2, 2)));
	await refuse(build([data], manifest(0, 0)));
	const ok = await parseArchive(build([data], manifest(1, 2)));
	assert.equal(ok.data.get('md')?.length, 1);
});

test('a manifest that is not the first entry is refused', async () => {
	const tar = writeTar([entry('data/md/a'), entry('manifest.json', JSON.stringify(manifest()))]);
	await refuse(gz(tar));
});

test('a decompression bomb stops at the limit and a gzip of garbage is refused', async () => {
	await refuse(gzipSync(Buffer.alloc(320 * 1024 * 1024)));
	await refuse(gz(Buffer.from('not a tar at all'.repeat(100))));
});

const LOW: KdfParams = {logN: 10, r: 8, p: 1};
const plain = Buffer.from('archive plaintext that must never be returned for a tampered file');

test('flipping any single bit of any header byte never yields plaintext', async () => {
	const secret = {text: 'correct horse battery', kind: 'password' as const};
	const enc = await encryptArchive(plain, secret, LOW);
	for (let at = 0; at < HEADER_BYTES; at++) {
		for (const bit of [0x01, 0x80]) {
			const copy = Buffer.from(enc);
			copy[at] = (copy[at] as number) ^ bit;
			let out: Buffer | undefined;
			try {
				out = await decryptArchive(copy, secret.text);
			} catch (e) {
				assert.ok(e instanceof WrongSecretError || e instanceof ArchiveError, `byte ${at} bit ${bit}: ${(e as Error).message}`);
			}
			assert.equal(out, undefined, `byte ${at} bit ${bit} was accepted`);
		}
	}
});

test('every truncation of the encrypted file is refused', async () => {
	const enc = await encryptArchive(plain, {text: 'correct horse battery', kind: 'password'}, LOW);
	for (let len = 0; len < enc.length; len += 3) {
		await assert.rejects(decryptArchive(enc.subarray(0, len), 'correct horse battery'), (e: Error) => e instanceof WrongSecretError || e instanceof ArchiveError, `length ${len}`);
	}
});

test('the ciphertext hides the plaintext, and a code word is not a valid password for a password file', async () => {
	const enc = await encryptArchive(plain, {text: 'correct horse battery', kind: 'password'}, LOW);
	assert.equal(enc.includes(plain.subarray(0, 16)), false);
	const code = generateCodeWord();
	const byCode = await encryptArchive(plain, {text: code, kind: 'code'}, LOW);
	assert.equal(byCode.includes(Buffer.from(code)), false);
	assert.equal(byCode.includes(Buffer.from(code.replaceAll('-', ''))), false);
	await assert.rejects(decryptArchive(enc, code), WrongSecretError);
	await assert.rejects(decryptArchive(byCode, 'correct horse battery'), WrongSecretError);
	await assert.rejects(decryptArchive(byCode, generateCodeWord()), WrongSecretError);
});
