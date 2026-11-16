import {mkdir, open, unlink} from 'node:fs/promises';
import path from 'node:path';
import type {CommandContext, ModuleDataFile, StyledBlock} from '../../../../src/api.js';
import {commandError} from '../kit/command-error.js';
import {line, printStyled, span, table} from '../kit/styled.js';
import {sanitizeText} from '../hints/sanitize.js';
import {buildArchive, type ArchiveFile, type ArchiveManifest, type ArchiveModule} from './archive.js';
import {canonicalCodeWord, encryptArchive, generateCodeWord, normalizePassword, type SecretKind} from './crypto.js';
import type {TransferEnv} from './env.js';
import {clip, exportsDir, formatBytes, resolveFile, utcStamp} from './format.js';
import {MAX_FILE_BYTES, MAX_FILES, MAX_MODULES, MAX_TOTAL_BYTES} from './limits.js';
import {noTerminalError} from './prompts.js';
import {fitsUstar} from './tar.js';

const USAGE = 'Usage: export [file] [--no-encrypt]';
const CANCELLED = 'Export cancelled; nothing was written';

type Parsed = {file?: string; encrypt: boolean};

function parseArgs(args: string[]): Parsed {
	const parsed: Parsed = {encrypt: true};
	const words: string[] = [];
	for (const arg of args) {
		if (arg === '--no-encrypt') parsed.encrypt = false;
		else if (arg.startsWith('-')) throw commandError('usage', USAGE);
		else words.push(arg);
	}
	if (words.length > 1) throw commandError('usage', USAGE);
	if (words[0] !== undefined) parsed.file = words[0];
	return parsed;
}

type Packed = {data: ArchiveFile[]; code: ArchiveFile[]; modules: ArchiveModule[]; cells: string[][]; warnings: string[]; totals: {files: number; skipped: number; bytes: number}};

function usable(module: string, kind: 'data' | 'code', files: readonly ModuleDataFile[]): {files: ModuleDataFile[]; unfit: number} {
	const fit = files.filter(f => fitsUstar(`${kind}/${module}/${f.path}`));
	return {files: fit, unfit: files.length - fit.length};
}

const sum = (files: readonly ModuleDataFile[]): number => files.reduce((total, f) => total + f.data.length, 0);

async function pack(env: TransferEnv): Promise<Packed> {
	const modules = env.modules!;
	const infos = await modules.list();
	if (infos.length > MAX_MODULES) throw new Error(`More than ${MAX_MODULES} modules are installed`);
	const out: Packed = {data: [], code: [], modules: [], cells: [], warnings: [], totals: {files: 0, skipped: 0, bytes: 0}};
	let files = 0;
	let bytes = 0;
	const limits = () => ({maxFiles: MAX_FILES - files, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES - bytes});

	for (const info of infos) {
		const name = sanitizeText(info.name, 64);
		const read = await modules.readData(info.name, limits());
		const data = usable(info.name, 'data', read.files);
		files += data.files.length;
		bytes += sum(data.files);
		for (const note of read.notes) out.warnings.push(`${name}: ${sanitizeText(note, 200)}`);
		if (data.unfit > 0) out.warnings.push(`${name}: ${data.unfit} files with paths too long for the archive skipped`);
		if (read.defaultDeny) out.warnings.push(`${name} has no export list in its yena.json: its ${read.skipped} files were not exported`);
		for (const file of data.files) out.data.push({module: info.name, file});

		const entry: ArchiveModule = {
			name: info.name,
			version: info.version,
			...(info.host !== undefined && {host: info.host}),
			data: read.defaultDeny ? 'denied' : 'exported',
			files: data.files.length,
			bytes: sum(data.files),
		};
		let codeCell = 'from source';
		if (info.code.carry) {
			const code = await modules.readCode(info.name, limits());
			const packed = usable(info.name, 'code', code.files);
			files += packed.files.length;
			bytes += sum(packed.files);
			for (const note of code.notes) out.warnings.push(`${name}: ${sanitizeText(note, 200)}`);
			if (packed.unfit > 0) out.warnings.push(`${name}: ${packed.unfit} code files with paths too long for the archive skipped`);
			if (!packed.files.some(f => f.path === 'yena.json')) throw new Error(`${name}: its yena.json would not be packed`);
			out.warnings.push(`${name}: code carried in the file (${sanitizeText(info.code.reason, 200)}), ${packed.files.length} files`);
			entry.code = {files: packed.files.length, bytes: sum(packed.files)};
			for (const file of packed.files) out.code.push({module: info.name, file});
			codeCell = `carried (${packed.files.length} files)`;
		} else if (info.lock) {
			entry.source = info.lock.source;
			if (info.lock.commit !== undefined) entry.commit = info.lock.commit;
			if (info.lock.account !== undefined) entry.account = info.lock.account;
		}
		const skipped = read.skipped + data.unfit;
		out.modules.push(entry);
		out.totals.skipped += skipped;
		out.cells.push([name, sanitizeText(info.version, 64), String(data.files.length), String(skipped), formatBytes(entry.bytes), codeCell]);
	}
	out.totals.files = files;
	out.totals.bytes = bytes;
	return out;
}

async function writeFileOnce(file: string, content: Buffer): Promise<void> {
	const handle = await open(file, 'wx', 0o600);
	try {
		await handle.writeFile(content);
		await handle.close();
	} catch (error) {
		await handle.close().catch(() => {});
		await unlink(file).catch(() => {});
		throw error;
	}
}

async function save(env: TransferEnv, target: string | undefined, ext: string, content: Buffer): Promise<string> {
	if (target !== undefined) {
		const file = resolveFile(env.dataDir, target);
		await mkdir(path.dirname(file), {recursive: true});
		try {
			await writeFileOnce(file, content);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw commandError('invalid', `"${sanitizeText(file, 200)}" already exists`);
			throw error;
		}
		return file;
	}
	const dir = exportsDir(env.dataDir);
	await mkdir(dir, {recursive: true, mode: 0o700});
	const base = `yena-export-${utcStamp(env.now())}`;
	for (let n = 1; n <= 99; n++) {
		const file = path.join(dir, `${base}${n === 1 ? '' : `-${n}`}${ext}`);
		try {
			await writeFileOnce(file, content);
			return file;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		}
	}
	throw new Error('Too many export files with the same time stamp');
}

export async function runExport(args: string[], ctx: CommandContext, env: TransferEnv): Promise<void> {
	const parsed = parseArgs(args);
	if (!env.modules) throw new Error('export needs yena 0.9.0 or newer');
	const started = Date.now();
	if (parsed.encrypt && !env.prompts.available(ctx)) {
		throw noTerminalError('export', 'add --no-encrypt to write an unencrypted file');
	}

	const release: (() => void)[] = [];
	try {
		let secret: {text: string; kind: SecretKind} | undefined;
		let generated: string | undefined;
		if (parsed.encrypt) {
			const typed = await env.prompts.askNewSecret(ctx);
			if (typed === undefined) {
				ctx.print(CANCELLED);
				env.log.info('export cancelled', {stage: 'secret'});
				return;
			}
			if (typed === '') {
				generated = generateCodeWord();
				release.push(env.track(generated, canonicalCodeWord(generated)));
				secret = {text: generated, kind: 'code'};
			} else {
				release.push(env.track(typed, normalizePassword(typed)));
				secret = {text: typed, kind: 'password'};
			}
		}

		const packed = await pack(env);
		const manifest: ArchiveManifest = {
			format: 'yena-export',
			version: 1,
			yena: env.build?.version ?? 'unknown',
			created: env.now().toISOString(),
			modules: packed.modules,
		};
		const gz = await buildArchive(manifest, packed.data, packed.code);
		const content = secret ? await encryptArchive(gz, secret, env.kdf) : gz;

		if (generated !== undefined && !(await env.prompts.showCodeWord(ctx, generated))) {
			ctx.print(CANCELLED);
			env.log.info('export cancelled', {stage: 'code'});
			return;
		}

		const file = await save(env, parsed.file, secret ? '.tar.gz.enc' : '.tar.gz', content);
		const encryption = secret ? (secret.kind === 'code' ? 'code' : 'password') : 'none';
		const blocks: StyledBlock[] = [];
		if (packed.cells.length > 0) blocks.push(table(packed.cells, {head: ['Module', 'Version', 'Files', 'Skipped', 'Size', 'Code']}));
		for (const warning of packed.warnings) blocks.push(line(span(warning, {tone: 'warn'})));
		if (!secret) blocks.push(line(span('Unsafe: the file is not encrypted; anyone who gets it can read your instructions, docs, jobs and other module data.', {tone: 'warn'})));
		else blocks.push(line(secret.kind === 'code' ? 'Encrypted with the code word shown in the console' : 'Encrypted with the password you typed'));
		blocks.push(line(`Saved ${sanitizeText(file, 300)} (${formatBytes(content.length)}, ${packed.totals.files} files from ${packed.modules.length} modules)`));
		printStyled(ctx, blocks);
		env.log.info('export done', {
			modules: packed.modules.length,
			files: packed.totals.files,
			skipped: packed.totals.skipped,
			bytes: packed.totals.bytes,
			ms: Date.now() - started,
			warnings: packed.warnings.length,
			encryption,
		});
	} finally {
		for (const r of release) r();
	}
}
