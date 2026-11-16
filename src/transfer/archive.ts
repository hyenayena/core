import {promisify} from 'node:util';
import {gunzip as gunzipCb, gzip as gzipCb} from 'node:zlib';
import type {ModuleDataFile} from '../../../../src/api.js';
import {ArchiveError} from './archive-error.js';
import {MAX_DEPTH, MAX_FILE_BYTES, MAX_FILES, MAX_MANIFEST_BYTES, MAX_MODULES, MAX_PATH_BYTES, MAX_TOTAL_BYTES} from './limits.js';
import {fitsUstar, readTar, writeTar, type TarEntry} from './tar.js';

export {ArchiveError};

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

export const ARCHIVE_FORMAT = 'yena-export';
export const ARCHIVE_VERSION = 1;

export type ArchiveModule = {
	name: string;
	version: string;
	host?: string;
	source?: string;
	commit?: string;
	account?: string;
	code?: {files: number; bytes: number};
	data: 'exported' | 'denied';
	files: number;
	bytes: number;
};

export type ArchiveManifest = {format: typeof ARCHIVE_FORMAT; version: number; yena: string; created: string; modules: ArchiveModule[]};

export type ArchiveFile = {module: string; file: ModuleDataFile};

export type ParsedArchive = {manifest: ArchiveManifest; data: Map<string, ModuleDataFile[]>; code: Map<string, ModuleDataFile[]>};

const NAME = /^[a-z0-9][a-z0-9._-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const ACCOUNT = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]');
const MAX_ENTRY_OVERHEAD = 1024 * 1024 + MAX_FILES * 1024;

export function checkPath(rel: string): void {
	if (rel === '' || rel.startsWith('/') || rel.includes('\\') || CONTROL.test(rel)) throw new ArchiveError('A file path is not allowed');
	if (Buffer.byteLength(rel) > MAX_PATH_BYTES) throw new ArchiveError('A file path is too long');
	const segments = rel.split('/');
	if (segments.length > MAX_DEPTH) throw new ArchiveError('A file path is nested too deeply');
	if (segments.some(s => s === '' || s === '.' || s === '..')) throw new ArchiveError('A file path is not allowed');
}

export async function buildArchive(manifest: ArchiveManifest, data: readonly ArchiveFile[], code: readonly ArchiveFile[] = []): Promise<Buffer> {
	const entries: TarEntry[] = [
		{path: 'manifest.json', mode: 0o600, mtimeMs: Date.parse(manifest.created) || 0, data: Buffer.from(JSON.stringify(manifest), 'utf8')},
	];
	const add = (kind: 'data' | 'code', items: readonly ArchiveFile[]) => {
		for (const {module, file} of items) {
			const path = `${kind}/${module}/${file.path}`;
			if (!fitsUstar(path)) throw new ArchiveError('A file path is too long for the archive');
			entries.push({path, mode: file.mode, mtimeMs: file.mtimeMs, data: file.data});
		}
	};
	add('data', data);
	add('code', code);
	return gzip(writeTar(entries));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(value: unknown, what: string, max: number, required = true): string | undefined {
	if (value === undefined && !required) return undefined;
	if (typeof value !== 'string' || (required && value === '') || value.length > max || CONTROL.test(value)) throw new ArchiveError(`The manifest has a bad ${what}`);
	return value;
}

function count(value: unknown, what: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ArchiveError(`The manifest has a bad ${what}`);
	return value;
}

function parseModule(raw: unknown): ArchiveModule {
	if (!isRecord(raw)) throw new ArchiveError('The manifest has a bad module entry');
	const name = raw.name;
	if (typeof name !== 'string' || name.length > 64 || !NAME.test(name) || name === 'host') throw new ArchiveError('The manifest has a bad module name');
	const mod: ArchiveModule = {name, version: text(raw.version, 'version', 64)!, data: 'denied', files: 0, bytes: 0};
	const host = text(raw.host, 'host range', 64, false);
	if (host !== undefined) mod.host = host;
	const source = text(raw.source, 'source', 500, false);
	if (source !== undefined) mod.source = source;
	if (raw.commit !== undefined) {
		if (typeof raw.commit !== 'string' || !COMMIT.test(raw.commit)) throw new ArchiveError('The manifest has a bad commit');
		mod.commit = raw.commit;
	}
	if (raw.account !== undefined) {
		if (typeof raw.account !== 'string' || !ACCOUNT.test(raw.account)) throw new ArchiveError('The manifest has a bad account');
		mod.account = raw.account;
	}
	if (raw.data !== 'exported' && raw.data !== 'denied') throw new ArchiveError('The manifest has a bad data flag');
	mod.data = raw.data;
	mod.files = count(raw.files, 'file count');
	mod.bytes = count(raw.bytes, 'byte count');
	if (raw.code !== undefined) {
		if (!isRecord(raw.code)) throw new ArchiveError('The manifest has a bad code entry');
		mod.code = {files: count(raw.code.files, 'code file count'), bytes: count(raw.code.bytes, 'code byte count')};
		if (mod.source !== undefined || mod.commit !== undefined || mod.account !== undefined) throw new ArchiveError(`${name} carries its code and also names a source`);
	}
	return mod;
}

function parseManifest(raw: Uint8Array): ArchiveManifest {
	if (raw.length > MAX_MANIFEST_BYTES) throw new ArchiveError('The manifest is too large');
	let json: unknown;
	try {
		json = JSON.parse(Buffer.from(raw).toString('utf8'));
	} catch {
		throw new ArchiveError('The manifest is not valid JSON');
	}
	if (!isRecord(json) || json.format !== ARCHIVE_FORMAT) throw new ArchiveError('The file is not a yena export');
	if (json.version !== ARCHIVE_VERSION) {
		const v = typeof json.version === 'number' ? String(json.version).slice(0, 12) : 'unknown';
		throw new ArchiveError(`This archive has format version ${v}; this yena reads version ${ARCHIVE_VERSION}`);
	}
	const yena = text(json.yena, 'yena version', 64)!;
	const created = text(json.created, 'creation time', 64)!;
	if (Number.isNaN(Date.parse(created))) throw new ArchiveError('The manifest has a bad creation time');
	if (!Array.isArray(json.modules) || json.modules.length > MAX_MODULES) throw new ArchiveError('The manifest lists too many modules');
	const modules = json.modules.map(parseModule);
	if (new Set(modules.map(m => m.name)).size !== modules.length) throw new ArchiveError('The manifest lists a module twice');
	return {format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, yena, created, modules};
}

export async function parseArchive(buf: Uint8Array): Promise<ParsedArchive> {
	let tar: Buffer;
	try {
		tar = await gunzip(buf, {maxOutputLength: MAX_TOTAL_BYTES + MAX_ENTRY_OVERHEAD});
	} catch (error) {
		if (error instanceof RangeError) throw new ArchiveError(`The archive is larger than ${MAX_TOTAL_BYTES / (1024 * 1024)} MiB unpacked`);
		throw new ArchiveError('The file is not a valid gzip archive');
	}
	const entries = readTar(tar);
	const first = entries[0];
	if (!first || first.path !== 'manifest.json') throw new ArchiveError('The first entry is not manifest.json');
	const manifest = parseManifest(first.data);

	const byName = new Map(manifest.modules.map(m => [m.name, m]));
	const data = new Map<string, ModuleDataFile[]>();
	const code = new Map<string, ModuleDataFile[]>();
	const bytes = {data: new Map<string, number>(), code: new Map<string, number>()};
	const seen = new Set<string>();
	for (const entry of entries.slice(1)) {
		if (seen.has(entry.path)) throw new ArchiveError('The archive lists a file twice');
		seen.add(entry.path);
		const [kind, module, ...rest] = entry.path.split('/');
		if ((kind !== 'data' && kind !== 'code') || module === undefined || rest.length === 0) throw new ArchiveError('The archive has an unexpected entry');
		const mod = byName.get(module);
		if (!mod) throw new ArchiveError('The archive has files of a module the manifest does not list');
		if (kind === 'data' ? mod.data !== 'exported' : mod.code === undefined) throw new ArchiveError(`The archive has ${kind} files that ${module} does not declare`);
		const rel = rest.join('/');
		checkPath(rel);
		if (entry.data.length > MAX_FILE_BYTES) throw new ArchiveError('A file in the archive is too large');
		const target = kind === 'data' ? data : code;
		const list = target.get(module) ?? [];
		list.push({path: rel, mode: entry.mode & 0o777, mtimeMs: entry.mtimeMs, data: entry.data});
		target.set(module, list);
		bytes[kind].set(module, (bytes[kind].get(module) ?? 0) + entry.data.length);
	}
	for (const mod of manifest.modules) {
		if ((data.get(mod.name)?.length ?? 0) !== mod.files || (bytes.data.get(mod.name) ?? 0) !== mod.bytes) {
			throw new ArchiveError(`The data of ${mod.name} does not match the manifest`);
		}
		if (mod.code) {
			const files = code.get(mod.name) ?? [];
			if (files.length !== mod.code.files || (bytes.code.get(mod.name) ?? 0) !== mod.code.bytes) throw new ArchiveError(`The code of ${mod.name} does not match the manifest`);
			if (!files.some(f => f.path === 'yena.json')) throw new ArchiveError(`The code of ${mod.name} has no yena.json`);
		}
	}
	return {manifest, data, code};
}
