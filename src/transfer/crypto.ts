import {createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb} from 'node:crypto';
import {promisify} from 'node:util';
import {ArchiveError} from './archive-error.js';

const scrypt = promisify(scryptCb) as (secret: string, salt: Buffer, keylen: number, options: {N: number; r: number; p: number; maxmem: number}) => Promise<Buffer>;

export type SecretKind = 'password' | 'code';
export type KdfParams = {logN: number; r: number; p: number};
export type EncryptedHeader = {kind: SecretKind; params: KdfParams};

export const DEFAULT_KDF: KdfParams = {logN: 17, r: 8, p: 1};
export const HEADER_BYTES = 48;
export const TAG_BYTES = 16;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 1024;

const MAGIC = Buffer.from('YENAENC\0', 'latin1');
const FORMAT = 1;
const KDF_SCRYPT = 1;
const KIND_BYTE: Record<SecretKind, number> = {password: 1, code: 2};
const KDF_MAX_BYTES = 256 * 1024 * 1024;
const SCRYPT_MAXMEM = 2 * KDF_MAX_BYTES;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export class WrongSecretError extends Error {
	constructor() {
		super('Wrong password or code word, or the file is damaged');
		this.name = 'WrongSecretError';
	}
}

export const isEncrypted = (buf: Uint8Array): boolean => buf.length >= MAGIC.length && MAGIC.equals(buf.subarray(0, MAGIC.length));

export const isGzip = (buf: Uint8Array): boolean => buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;

export function generateCodeWord(): string {
	const bytes = randomBytes(28);
	let word = '';
	for (const byte of bytes) word += ALPHABET[byte & 31];
	return word.match(/.{4}/g)!.join('-');
}

export function canonicalCodeWord(text: string): string {
	return text
		.toUpperCase()
		.replace(/[\s-]/g, '')
		.replace(/O/g, '0')
		.replace(/[IL]/g, '1');
}

export function normalizePassword(text: string): string {
	return text.normalize('NFC');
}

export const passwordProblem = (text: string): string | undefined => {
	const length = [...text].length;
	return length < PASSWORD_MIN || length > PASSWORD_MAX ? `Use between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters` : undefined;
};

const secretText = (text: string, kind: SecretKind): string => (kind === 'code' ? canonicalCodeWord(text) : normalizePassword(text));

function checkParams(params: KdfParams): void {
	const ok =
		Number.isInteger(params.logN) &&
		Number.isInteger(params.r) &&
		Number.isInteger(params.p) &&
		params.logN >= 10 &&
		params.logN <= 20 &&
		params.r >= 1 &&
		params.r <= 16 &&
		params.p >= 1 &&
		params.p <= 4 &&
		128 * 2 ** params.logN * params.r * params.p <= KDF_MAX_BYTES;
	if (!ok) throw new ArchiveError('The encryption settings of this file are out of range');
}

function newer(format: number): ArchiveError {
	return new ArchiveError(`This file was made by a newer yena (encryption format ${format})`);
}

export function readEncryptedHeader(buf: Uint8Array): EncryptedHeader {
	if (!isEncrypted(buf)) throw new ArchiveError('Not a yena export file');
	if (buf.length < HEADER_BYTES + TAG_BYTES) throw new ArchiveError('The encrypted file is too short');
	const format = buf[8] as number;
	if (format !== FORMAT || buf[9] !== KDF_SCRYPT || buf[14] !== 0 || buf[15] !== 0 || buf.subarray(44, 48).some(b => b !== 0)) throw newer(format);
	const kind = buf[10] === KIND_BYTE.password ? 'password' : buf[10] === KIND_BYTE.code ? 'code' : undefined;
	if (!kind) throw new ArchiveError('The encrypted file has an unknown secret kind');
	const params = {logN: buf[11] as number, r: buf[12] as number, p: buf[13] as number};
	checkParams(params);
	return {kind, params};
}

async function deriveKey(text: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
	return scrypt(text, salt, 32, {N: 2 ** params.logN, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM});
}

export async function encryptArchive(plain: Uint8Array, secret: {text: string; kind: SecretKind}, params: KdfParams = DEFAULT_KDF): Promise<Buffer> {
	checkParams(params);
	if (secret.kind === 'password' && passwordProblem(secret.text)) throw new Error(passwordProblem(secret.text));
	const salt = randomBytes(16);
	const nonce = randomBytes(12);
	const head = Buffer.alloc(HEADER_BYTES);
	MAGIC.copy(head, 0);
	head[8] = FORMAT;
	head[9] = KDF_SCRYPT;
	head[10] = KIND_BYTE[secret.kind];
	head[11] = params.logN;
	head[12] = params.r;
	head[13] = params.p;
	salt.copy(head, 16);
	nonce.copy(head, 32);
	const key = await deriveKey(secretText(secret.text, secret.kind), salt, params);
	try {
		const cipher = createCipheriv('aes-256-gcm', key, nonce, {authTagLength: TAG_BYTES});
		cipher.setAAD(head);
		const body = Buffer.concat([cipher.update(plain), cipher.final()]);
		return Buffer.concat([head, body, cipher.getAuthTag()]);
	} finally {
		key.fill(0);
	}
}

export async function decryptArchive(buf: Uint8Array, text: string): Promise<Buffer> {
	const {kind, params} = readEncryptedHeader(buf);
	const head = Buffer.from(buf.subarray(0, HEADER_BYTES));
	const key = await deriveKey(secretText(text, kind), head.subarray(16, 32), params);
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(32, 44), {authTagLength: TAG_BYTES});
		decipher.setAAD(head);
		decipher.setAuthTag(Buffer.from(buf.subarray(buf.length - TAG_BYTES)));
		const body = Buffer.from(buf.subarray(HEADER_BYTES, buf.length - TAG_BYTES));
		return Buffer.concat([decipher.update(body), decipher.final()]);
	} catch {
		throw new WrongSecretError();
	} finally {
		key.fill(0);
	}
}
