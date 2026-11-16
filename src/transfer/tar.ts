import {ArchiveError} from './archive-error.js';
import {MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES} from './limits.js';

export type TarEntry = {path: string; mode: number; mtimeMs: number; data: Uint8Array};

export type TarLimits = {maxEntries: number; maxFileBytes: number; maxTotalBytes: number};

export const DEFAULT_TAR_LIMITS: TarLimits = {maxEntries: MAX_FILES + 1, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES};

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;
const MAX_OCTAL_11 = 0o77777777777;

const OFFSET = {name: 0, mode: 100, uid: 108, gid: 116, size: 124, mtime: 136, checksum: 148, type: 156, link: 157, magic: 257, version: 263, prefix: 345} as const;

const decoder = new TextDecoder('utf-8', {fatal: true});

function splitPath(path: string): {prefix: string; name: string} | undefined {
	const bytes = Buffer.byteLength(path);
	if (bytes <= NAME_MAX) return {prefix: '', name: path};
	for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
		const prefix = path.slice(0, i);
		const name = path.slice(i + 1);
		if (name === '') break;
		if (Buffer.byteLength(prefix) <= PREFIX_MAX && Buffer.byteLength(name) <= NAME_MAX) return {prefix, name};
	}
	return undefined;
}

export function fitsUstar(path: string): boolean {
	return path !== '' && !path.includes('\0') && splitPath(path) !== undefined;
}

function putOctal(block: Buffer, offset: number, length: number, value: number): void {
	if (!Number.isInteger(value) || value < 0 || value > MAX_OCTAL_11) throw new ArchiveError('A number does not fit a tar header');
	block.write(value.toString(8).padStart(length - 1, '0'), offset, 'latin1');
}

function header(path: string, mode: number, mtimeMs: number, size: number): Buffer {
	const parts = splitPath(path);
	if (!parts || path === '') throw new ArchiveError('A path is too long for the archive');
	const block = Buffer.alloc(BLOCK);
	block.write(parts.name, OFFSET.name, 'utf8');
	block.write(parts.prefix, OFFSET.prefix, 'utf8');
	putOctal(block, OFFSET.mode, 8, mode & 0o777);
	putOctal(block, OFFSET.uid, 8, 0);
	putOctal(block, OFFSET.gid, 8, 0);
	putOctal(block, OFFSET.size, 12, size);
	putOctal(block, OFFSET.mtime, 12, Math.max(0, Math.floor(mtimeMs / 1000)));
	block.fill(0x20, OFFSET.checksum, OFFSET.checksum + 8);
	block[OFFSET.type] = 0x30;
	block.write('ustar\0', OFFSET.magic, 'latin1');
	block.write('00', OFFSET.version, 'latin1');
	const sum = block.reduce((total, byte) => total + byte, 0);
	block.write(sum.toString(8).padStart(6, '0'), OFFSET.checksum, 'latin1');
	block[OFFSET.checksum + 6] = 0;
	block[OFFSET.checksum + 7] = 0x20;
	return block;
}

export function writeTar(entries: readonly TarEntry[]): Buffer {
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		chunks.push(header(entry.path, entry.mode, entry.mtimeMs, entry.data.length));
		chunks.push(Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.length));
		const pad = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
		if (pad > 0) chunks.push(Buffer.alloc(pad));
	}
	chunks.push(Buffer.alloc(BLOCK * 2));
	return Buffer.concat(chunks);
}

function isZeroBlock(buf: Uint8Array, offset: number): boolean {
	for (let i = offset; i < offset + BLOCK; i++) if (buf[i] !== 0) return false;
	return true;
}

function readOctal(block: Uint8Array, offset: number, length: number, what: string): number {
	let end = offset;
	const limit = offset + length;
	while (end < limit && block[end] !== 0 && block[end] !== 0x20) end++;
	if (end === offset) throw new ArchiveError(`Bad ${what} in a tar header`);
	for (let i = end; i < limit; i++) if (block[i] !== 0 && block[i] !== 0x20) throw new ArchiveError(`Bad ${what} in a tar header`);
	let value = 0;
	for (let i = offset; i < end; i++) {
		const digit = (block[i] as number) - 0x30;
		if (digit < 0 || digit > 7) throw new ArchiveError(`Bad ${what} in a tar header`);
		value = value * 8 + digit;
	}
	if (!Number.isSafeInteger(value)) throw new ArchiveError(`Bad ${what} in a tar header`);
	return value;
}

function readString(block: Uint8Array, offset: number, length: number): string {
	let end = offset;
	while (end < offset + length && block[end] !== 0) end++;
	try {
		return decoder.decode(block.subarray(offset, end));
	} catch {
		throw new ArchiveError('A tar path is not valid UTF-8');
	}
}

function checkSum(block: Uint8Array): void {
	let sum = 0;
	for (let i = 0; i < BLOCK; i++) sum += i >= OFFSET.checksum && i < OFFSET.checksum + 8 ? 0x20 : (block[i] as number);
	if (readOctal(block, OFFSET.checksum, 8, 'checksum') !== sum) throw new ArchiveError('A tar header has a bad checksum');
}

export function readTar(buf: Uint8Array, limits: TarLimits = DEFAULT_TAR_LIMITS): TarEntry[] {
	const entries: TarEntry[] = [];
	let offset = 0;
	let total = 0;
	for (;;) {
		if (offset + BLOCK > buf.length) throw new ArchiveError('The tar data ends without an end marker');
		if (isZeroBlock(buf, offset)) break;
		const block = buf.subarray(offset, offset + BLOCK);
		checkSum(block);
		const magic = Buffer.from(block.subarray(OFFSET.magic, OFFSET.magic + 8)).toString('latin1');
		if (magic !== 'ustar\x0000') throw new ArchiveError('A tar header has a bad magic');
		const type = block[OFFSET.type] as number;
		const isFile = type === 0x30 || type === 0;
		if (!isFile && type !== 0x35) throw new ArchiveError('The archive holds a link, device or extended entry, which is not allowed');
		const size = readOctal(block, OFFSET.size, 12, 'size');
		if (!isFile && size !== 0) throw new ArchiveError('A tar directory entry has data');
		const name = readString(block, OFFSET.name, NAME_MAX);
		const prefix = readString(block, OFFSET.prefix, PREFIX_MAX);
		const path = prefix === '' ? name : `${prefix}/${name}`;
		const padded = Math.ceil(size / BLOCK) * BLOCK;
		if (offset + BLOCK + padded > buf.length) throw new ArchiveError('A tar entry is larger than the data');
		if (isFile) {
			if (entries.length >= limits.maxEntries) throw new ArchiveError('The archive has too many files');
			if (size > limits.maxFileBytes) throw new ArchiveError('A file in the archive is too large');
			total += size;
			if (total > limits.maxTotalBytes) throw new ArchiveError('The archive is larger than the limit unpacked');
			if (path === '') throw new ArchiveError('A tar entry has no name');
			entries.push({
				path,
				mode: readOctal(block, OFFSET.mode, 8, 'mode') & 0o777,
				mtimeMs: readOctal(block, OFFSET.mtime, 12, 'mtime') * 1000,
				data: buf.subarray(offset + BLOCK, offset + BLOCK + size),
			});
		}
		offset += BLOCK + padded;
	}
	if (offset + BLOCK * 2 > buf.length || !isZeroBlock(buf, offset + BLOCK)) throw new ArchiveError('The tar end marker is incomplete');
	for (let i = offset + BLOCK * 2; i < buf.length; i++) if (buf[i] !== 0) throw new ArchiveError('The tar data has bytes after the end marker');
	return entries;
}
