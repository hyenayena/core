import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ArchiveError} from '../../src/transfer/archive-error.js';
import {fitsUstar, readTar, writeTar} from '../../src/transfer/tar.js';

const entry = (path: string, text: string, mode = 0o644, mtimeMs = 1_700_000_000_000) => ({path, mode, mtimeMs, data: Buffer.from(text)});

const refused = (buf: Uint8Array) => assert.throws(() => readTar(buf), ArchiveError);

function mutate(buf: Buffer, at: number, value: number, fixSum = true): Buffer {
	const copy = Buffer.from(buf);
	copy[at] = value;
	if (fixSum) {
		copy.fill(0x20, 148, 156);
		const sum = copy.subarray(0, 512).reduce((a, b) => a + b, 0);
		copy.write(sum.toString(8).padStart(6, '0'), 148, 'latin1');
		copy[154] = 0;
		copy[155] = 0x20;
	}
	return copy;
}

test('round trip keeps paths, modes, times and data, including an empty file and UTF-8 names', () => {
	const long = `${'a'.repeat(50)}/${'b'.repeat(50)}/${'c'.repeat(50)}/${'d'.repeat(50)}.txt`;
	assert.equal(long.length, 207);
	const entries = [entry('manifest.json', '{}', 0o600), entry('data/x/empty', ''), entry(long, 'long'), entry('data/ü/файл.txt', 'hi', 0o755)];
	const back = readTar(writeTar(entries));
	assert.deepEqual(
		back.map(e => [e.path, e.mode, e.mtimeMs, Buffer.from(e.data).toString()]),
		entries.map(e => [e.path, e.mode, 1_700_000_000_000, Buffer.from(e.data).toString()]),
	);
});

test('fitsUstar tells which paths can be split', () => {
	assert.equal(fitsUstar('a/b'), true);
	assert.equal(fitsUstar('x'.repeat(101)), false);
	assert.equal(fitsUstar(`${'a'.repeat(100)}/${'b'.repeat(100)}`), true);
	assert.equal(fitsUstar(`${'a'.repeat(200)}/${'b'.repeat(10)}`), false);
});

test('a path that cannot be split is refused when writing', () => {
	assert.throws(() => writeTar([entry('x'.repeat(300), '')]), ArchiveError);
});

test('typeflags other than file and directory are refused', () => {
	const base = writeTar([entry('a', 'x')]);
	for (const flag of ['1', '2', '3', '4', '6', 'x', 'g', 'L', 'K', '7']) refused(mutate(base, 156, flag.charCodeAt(0)));
	assert.equal(readTar(mutate(base, 156, 0)).length, 1);
});

test('a directory entry is ignored', () => {
	const files = readTar(Buffer.concat([mutate(writeTar([entry('d', '')]).subarray(0, 512), 156, 0x35), writeTar([entry('a', 'x')])]));
	assert.deepEqual(files.map(e => e.path), ['a']);
});

test('bad checksum, bad magic, truncated data and a size past the buffer are refused', () => {
	const base = writeTar([entry('a', 'x'.repeat(600))]);
	refused(mutate(base, 0, 0x7a, false));
	refused(mutate(base, 257, 0x58));
	refused(base.subarray(0, 700));
	refused(base.subarray(0, 512 * 3));
	const bigSize = Buffer.from(base);
	bigSize.write('77777777777', 124, 'latin1');
	refused(mutate(bigSize, 148, bigSize[148]!));
});

test('bytes after the end marker are refused', () => {
	const base = writeTar([entry('a', 'x')]);
	refused(Buffer.concat([base, Buffer.from([1])]));
	assert.equal(readTar(Buffer.concat([base, Buffer.alloc(1024)])).length, 1);
});

test('limits are enforced while reading', () => {
	const base = writeTar([entry('a', 'xxxx'), entry('b', 'xxxx')]);
	assert.throws(() => readTar(base, {maxEntries: 1, maxFileBytes: 10, maxTotalBytes: 10}), ArchiveError);
	assert.throws(() => readTar(base, {maxEntries: 5, maxFileBytes: 3, maxTotalBytes: 10}), ArchiveError);
	assert.throws(() => readTar(base, {maxEntries: 5, maxFileBytes: 10, maxTotalBytes: 7}), ArchiveError);
});
