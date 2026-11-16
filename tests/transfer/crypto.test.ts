import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ArchiveError} from '../../src/transfer/archive-error.js';
import {
	canonicalCodeWord,
	decryptArchive,
	encryptArchive,
	generateCodeWord,
	isEncrypted,
	isGzip,
	readEncryptedHeader,
	WrongSecretError,
	type KdfParams,
} from '../../src/transfer/crypto.js';

const LOW: KdfParams = {logN: 10, r: 8, p: 1};
const plain = Buffer.from('some archive bytes');
const password = {text: 'correct horse battery', kind: 'password' as const};

test('a password round trips and a wrong one fails with WrongSecretError', async () => {
	const enc = await encryptArchive(plain, password, LOW);
	assert.equal(isEncrypted(enc), true);
	assert.deepEqual(readEncryptedHeader(enc), {kind: 'password', params: LOW});
	assert.deepEqual(await decryptArchive(enc, password.text), plain);
	await assert.rejects(decryptArchive(enc, 'wrong password!'), WrongSecretError);
});

test('a password is normalised to NFC', async () => {
	const enc = await encryptArchive(plain, {text: 'café-secret', kind: 'password'}, LOW);
	assert.deepEqual(await decryptArchive(enc, 'café-secret'), plain);
});

test('a password outside 8..1024 characters is refused when encrypting', async () => {
	await assert.rejects(encryptArchive(plain, {text: 'short', kind: 'password'}, LOW));
});

test('a code word opens with or without dashes, lower case and look-alike letters', async () => {
	const code = generateCodeWord();
	const enc = await encryptArchive(plain, {text: code, kind: 'code'}, LOW);
	assert.equal(readEncryptedHeader(enc).kind, 'code');
	assert.deepEqual(await decryptArchive(enc, code), plain);
	assert.deepEqual(await decryptArchive(enc, code.replaceAll('-', '').toLowerCase()), plain);
	assert.deepEqual(await decryptArchive(enc, code.replaceAll('-', ' ')), plain);
	const aliased = await encryptArchive(plain, {text: '0O1I-L111-2222-3333-4444-5555-6666', kind: 'code'}, LOW);
	assert.deepEqual(await decryptArchive(aliased, '0011-1111-2222-3333-4444-5555-6666'), plain);
	assert.equal(canonicalCodeWord('oil-'), '011');
});

test('every changed header or body byte fails', async () => {
	const enc = await encryptArchive(plain, password, LOW);
	const spots = [16, 20, 10, 11, 12, 13, 32, 36, 48, 50, enc.length - 1, enc.length - 8];
	for (const at of spots) {
		const copy = Buffer.from(enc);
		copy[at] = (copy[at] as number) ^ 1;
		await assert.rejects(decryptArchive(copy, password.text), (e: Error) => e instanceof WrongSecretError || e instanceof ArchiveError, `byte ${at}`);
	}
});

test('truncated files are refused', async () => {
	const enc = await encryptArchive(plain, password, LOW);
	assert.throws(() => readEncryptedHeader(enc.subarray(0, 40)), ArchiveError);
	await assert.rejects(decryptArchive(enc.subarray(0, enc.length - 1), password.text), (e: Error) => e instanceof WrongSecretError);
});

test('unknown versions, kdf ids and reserved bytes say a newer yena made the file', async () => {
	const enc = await encryptArchive(plain, password, LOW);
	for (const [at, value] of [[8, 2], [9, 2], [14, 1], [15, 1], [44, 1]] as const) {
		const copy = Buffer.from(enc);
		copy[at] = value;
		assert.throws(() => readEncryptedHeader(copy), /newer yena/);
	}
});

test('parameters outside the bounds are refused before scrypt runs', async () => {
	const enc = await encryptArchive(plain, password, LOW);
	for (const [at, value] of [[11, 9], [11, 21], [12, 0], [12, 17], [13, 0], [13, 5], [11, 20]] as const) {
		const copy = Buffer.from(enc);
		copy[at] = value;
		if (at === 11 && value === 20) {
			copy[12] = 16;
			copy[13] = 4;
		}
		assert.throws(() => readEncryptedHeader(copy), /out of range/, `${at}=${value}`);
	}
	await assert.rejects(encryptArchive(plain, password, {logN: 30, r: 8, p: 1}), ArchiveError);
});

test('two encryptions of the same data differ', async () => {
	const [a, b] = await Promise.all([encryptArchive(plain, password, LOW), encryptArchive(plain, password, LOW)]);
	assert.notDeepEqual(a, b);
});

test('code words have 7 groups of 4 Crockford characters and differ', () => {
	const a = generateCodeWord();
	assert.match(a, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/);
	assert.equal(a.replaceAll('-', '').length, 28);
	assert.notEqual(a, generateCodeWord());
});

test('detection tells encrypted, gzip and other data apart', async () => {
	const enc = await encryptArchive(plain, password, LOW);
	assert.deepEqual([isEncrypted(enc), isGzip(enc)], [true, false]);
	assert.deepEqual([isEncrypted(Buffer.from([0x1f, 0x8b, 8])), isGzip(Buffer.from([0x1f, 0x8b, 8]))], [false, true]);
	assert.deepEqual([isEncrypted(Buffer.from('hello')), isGzip(Buffer.from('hello'))], [false, false]);
});
