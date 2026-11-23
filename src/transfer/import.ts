import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import type {CommandContext, ImportStep, ModuleDataReplace, ModuleInfo, ModuleTarget, StyledBlock} from '../../../../src/api.js';
import {commandError} from '../kit/command-error.js';
import {line, printStyled, span, table} from '../kit/styled.js';
import {sanitizeText} from '../hints/sanitize.js';
import {ArchiveError, parseArchive, type ParsedArchive} from './archive.js';
import {decryptArchive, isEncrypted, isGzip, readEncryptedHeader, WrongSecretError} from './crypto.js';
import type {TransferEnv} from './env.js';
import {clip, compareVersions, resolveFile, utcStamp} from './format.js';
import {ENCRYPTION_OVERHEAD, MAX_ARCHIVE_BYTES} from './limits.js';
import {noTerminalError} from './prompts.js';

const USAGE = 'Usage: import <file> [--yes]';

function parseArgs(args: string[]): {file: string; yes: boolean} {
	let yes = false;
	const words: string[] = [];
	for (const arg of args) {
		if (arg === '--yes') yes = true;
		else if (arg.startsWith('-')) throw commandError('usage', USAGE);
		else words.push(arg);
	}
	if (words.length !== 1) throw commandError('usage', USAGE);
	return {file: words[0]!, yes};
}

const short = (commit: string | undefined): string => (commit ? commit.slice(0, 7) : '?');

function changeText(step: ImportStep): string {
	const from = step.from === undefined ? '' : sanitizeText(step.from, 64);
	const to = sanitizeText(step.to, 64);
	const downgrade = step.action === 'downgrade' ? ' (downgrade)' : '';
	if (step.fromFile) {
		return step.action === 'install' ? 'install (code from the file)' : `replace code (from the file) ${from} → ${to}${downgrade}`;
	}
	switch (step.action) {
		case 'install':
			return 'install';
		case 'unchanged':
			return 'unchanged';
		case 'downgrade':
			return `downgrade ${from} → ${to}${downgrade}`;
		case 'update':
			return from === to ? `update (${short(step.fromCommit)} → ${short(step.toCommit)})` : `update ${from} → ${to}`;
	}
}

async function readArchiveFile(file: string): Promise<Buffer> {
	let info;
	try {
		info = await stat(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw commandError('not-found', `"${sanitizeText(file, 200)}" not found`);
		throw error;
	}
	if (!info.isFile()) throw commandError('invalid', `"${sanitizeText(file, 200)}" is not a file`);
	if (info.size > MAX_ARCHIVE_BYTES + ENCRYPTION_OVERHEAD) throw commandError('invalid', `"${sanitizeText(file, 200)}" is too large for an export file`);
	return readFile(file);
}

const notValid = (reason: string): Error => commandError('invalid', `Not a valid yena export: ${sanitizeText(reason, 200)}`);

async function openArchive(buf: Buffer, ctx: CommandContext, env: TransferEnv, noticeBlocks: StyledBlock[]): Promise<ParsedArchive | undefined> {
	let plain: Uint8Array = buf;
	if (isEncrypted(buf)) {
		let kind;
		try {
			kind = readEncryptedHeader(buf).kind;
		} catch (error) {
			if (error instanceof ArchiveError) throw notValid(error.message);
			throw error;
		}
		if (!env.prompts.available(ctx)) throw noTerminalError('import', 'it is needed to type the password of this encrypted file');
		const typed = await env.prompts.askSecret(ctx, kind);
		if (typed === undefined || typed === '') {
			ctx.print('Import cancelled; nothing was changed');
			env.log.info('import refused', {reason: 'cancelled'});
			return undefined;
		}
		const release = env.track(typed, typed.normalize('NFC'));
		try {
			plain = await decryptArchive(buf, typed);
		} catch (error) {
			if (error instanceof WrongSecretError) {
				env.log.info('import refused', {reason: 'secret'});
				throw commandError('invalid', 'Wrong password or code word, or the file is damaged; nothing was changed');
			}
			if (error instanceof ArchiveError) throw notValid(error.message);
			throw error;
		} finally {
			release();
		}
	} else if (isGzip(buf)) {
		noticeBlocks.push(line(span('This file is not encrypted', {tone: 'warn'})));
	} else {
		env.log.info('import refused', {reason: 'archive'});
		throw notValid('Not a yena export file');
	}
	try {
		return await parseArchive(plain);
	} catch (error) {
		if (error instanceof ArchiveError) {
			env.log.info('import refused', {reason: 'archive'});
			throw notValid(error.message);
		}
		throw error;
	}
}

export async function runImport(args: string[], ctx: CommandContext, env: TransferEnv): Promise<void> {
	const {file, yes} = parseArgs(args);
	if (!env.modules) throw new Error('import needs yena 0.9.0 or newer');
	const modules = env.modules;
	const started = Date.now();
	await env.prompts.preload(ctx);

	const target = resolveFile(env.dataDir, file);
	const buf = await readArchiveFile(target);
	const notices: StyledBlock[] = [];
	const archive = await openArchive(buf, ctx, env, notices);
	if (!archive) return;
	const {manifest} = archive;

	const targets: ModuleTarget[] = manifest.modules.map(m => ({
		name: m.name,
		version: m.version,
		...(m.host !== undefined && {host: m.host}),
		...(m.source !== undefined && {source: m.source}),
		...(m.commit !== undefined && {commit: m.commit}),
		...(m.account !== undefined && {account: m.account}),
		...(m.code !== undefined && {code: archive.code.get(m.name) ?? []}),
	}));
	const plan = await modules.planImport(targets);
	const installed = new Map<string, ModuleInfo>((await modules.list()).map(i => [i.name, i]));
	const steps = new Map(plan.steps.map(s => [s.name, s]));

	const blocks: StyledBlock[] = [...notices];
	blocks.push(line(`Archive from yena ${sanitizeText(manifest.yena, 64)}, made ${sanitizeText(manifest.created.slice(0, 16).replace('T', ' '), 32)} UTC`));
	const here = env.build?.version;
	if (here !== undefined && compareVersions(manifest.yena, here) > 0) {
		blocks.push(line(span(`The file was made by a newer yena (${sanitizeText(manifest.yena, 64)}); update yena with install.sh if a module fails to load`, {tone: 'warn'})));
	}
	const cells: string[][] = [];
	for (const m of manifest.modules) {
		const step = steps.get(m.name);
		const now = installed.get(m.name);
		let data: string;
		if (m.data === 'denied') data = 'not exported';
		else if (now && now.exportList !== true && step?.action === 'unchanged') data = 'keep (no export list here)';
		else data = `replace (${m.files} files)`;
		cells.push([sanitizeText(m.name, 64), sanitizeText(step ? (step.from ?? '-') : (now?.version ?? '-'), 64), sanitizeText(m.version, 64), step ? changeText(step) : '-', data]);
	}
	for (const name of plan.untouched) cells.push([sanitizeText(name, 64), sanitizeText(installed.get(name)?.version ?? '-', 64), '-', 'not in the export', 'untouched']);
	blocks.push(table(cells, {head: ['Module', 'Now', 'In the file', 'Change', 'Data']}));

	if (plan.problems.length > 0) {
		for (const problem of plan.problems) blocks.push(line(span(sanitizeText(problem, 500), {tone: 'error'})));
		printStyled(ctx, blocks);
		env.log.info('import refused', {reason: 'plan', problems: plan.problems.length});
		throw commandError('invalid', `Import refused, nothing was changed: ${plan.problems.length} module(s) do not match; see above`);
	}

	const carried = plan.steps.filter(s => s.fromFile && s.action !== 'unchanged').map(s => sanitizeText(s.name, 64));
	if (carried.length > 0) {
		blocks.push(
			line(
				span(
					`This import installs code that came from the file: ${carried.join(', ')}. Their install scripts run now and the code loads at the next start. Import only files you made yourself.`,
					{tone: 'error'},
				),
			),
		);
	}
	blocks.push(
		line(
			span(
				'Import only files you made yourself: module data holds instructions, docs and scheduled jobs that the assistant and the scheduler act on.',
				{tone: 'warn'},
			),
		),
	);
	printStyled(ctx, blocks);

	if (!yes) {
		const changed = plan.steps.filter(s => s.action !== 'unchanged').length;
		const replaced = manifest.modules.filter(m => m.data === 'exported').length;
		const answer = await env.prompts.confirmApply(ctx, `Apply the import? ${changed} module change(s), data of ${replaced} module(s) replaced.`);
		if (answer === undefined) {
			ctx.print(`Nothing was changed. Run "import ${clip(file)} --yes" to apply.`);
			return;
		}
		if (!answer) {
			ctx.print('Nothing was changed.');
			env.log.info('import refused', {reason: 'cancelled'});
			return;
		}
	}

	const data: ModuleDataReplace[] = manifest.modules.filter(m => m.data === 'exported').map(m => ({name: m.name, files: archive.data.get(m.name) ?? []}));
	const backupDir = path.join(env.dataDir, 'backups', `import-${utcStamp(env.now(), true)}`);
	let result;
	try {
		result = await modules.applyImport({targets, data, backupDir}, ctx.print);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		env.log.warn('import failed', {err: error});
		if (/nothing was changed|rolled back/i.test(message)) throw error;
		throw Object.assign(new Error(`Import failed, nothing was changed: ${message}`), {kind: 'failed' as const});
	}

	const out: StyledBlock[] = [];
	if (result.replaced.length > 0) {
		out.push(table(result.replaced.map(r => [sanitizeText(r.name, 64), String(r.written), String(r.removed), String(r.kept), String(r.skipped)]), {head: ['Module', 'Written', 'Removed', 'Kept', 'Skipped']}));
		out.push(line(`Backup of the replaced files: ${sanitizeText(backupDir, 300)}`));
	}
	out.push(line(span('Restart yena now (exit, then start it again): modules were changed or their data replaced; running modules still use the old code and data until then.', {tone: 'warn'})));
	printStyled(ctx, out);
	const total = (key: 'written' | 'removed' | 'kept' | 'skipped') => result.replaced.reduce((n, r) => n + r[key], 0);
	env.log.info('import done', {
		modules: manifest.modules.length,
		changed: result.plan.steps.filter(s => s.action !== 'unchanged').length,
		written: total('written'),
		removed: total('removed'),
		kept: total('kept'),
		skipped: total('skipped'),
		ms: Date.now() - started,
	});
}
