import type {BuildInfo, Command, Logger, ModuleRegistry} from '../../../../src/api.js';
import type {KdfParams} from './crypto.js';
import type {TransferEnv} from './env.js';
import {runExport} from './export.js';
import {runImport} from './import.js';
import {createPrompts, type Prompts} from './prompts.js';

export type TransferDeps = {
	modules?: ModuleRegistry;
	build?: BuildInfo;
	dataDir: string;
	log: Logger;
	prompts?: Prompts;
	kdf?: KdfParams;
	now?: () => Date;
};

const liveSecrets = new Map<string, number>();
const CODE_SHAPE = new RegExp('\\b[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){6}\\b', 'g');

function track(...secrets: string[]): () => void {
	const held = secrets.filter(s => s !== '');
	for (const s of held) liveSecrets.set(s, (liveSecrets.get(s) ?? 0) + 1);
	return () => {
		for (const s of held) {
			const n = (liveSecrets.get(s) ?? 1) - 1;
			if (n <= 0) liveSecrets.delete(s);
			else liveSecrets.set(s, n);
		}
	};
}

const redact = (text: string): string => {
	let out = text;
	for (const secret of liveSecrets.keys()) out = out.split(secret).join('***');
	return out.replace(CODE_SHAPE, '***');
};

export function createTransferCommands(deps: TransferDeps): Command[] {
	deps.log.addRedactor(redact);
	const env: TransferEnv = {
		...(deps.modules && {modules: deps.modules}),
		...(deps.build && {build: deps.build}),
		dataDir: deps.dataDir,
		log: deps.log.child('transfer'),
		prompts: deps.prompts ?? createPrompts(),
		...(deps.kdf && {kdf: deps.kdf}),
		now: deps.now ?? (() => new Date()),
		track,
	};
	return [
		{
			name: 'export',
			description: 'Save the modules, their versions and their data to one file',
			usage: 'export [file] [--no-encrypt]',
			args: [{name: 'file', description: 'Where to save it; default core/exports/yena-<time>.yna'}],
			options: [{name: '--no-encrypt', description: 'Write the file without encryption (unsafe)'}],
			notes: [
				'The file is encrypted with a password you type, or a code word shown once.',
				"Files a [deny export] or [deny read] rule in a module's .yenarules covers are never exported.",
				'A module without a [deny export] section exports no files.',
				'Modules that cannot be reinstalled from a remote source carry their code in the file.',
				'An existing file is never overwritten.',
			],
			agent: 'confirm',
			run: (args, ctx) => runExport(args, ctx, env),
		},
		{
			name: 'import',
			description: 'Install the modules of an export file and replace their data',
			usage: 'import <file> [--yes]',
			args: [{name: 'file', description: 'The export file; relative paths start in core/exports'}],
			options: [{name: '--yes', description: 'Apply without asking (the plan is still shown)'}],
			notes: [
				'Every module in the file is aligned to its exported version.',
				"Each module's private files stay; replaced files are backed up to core/backups/import-<time>.",
				'Dependencies of installed modules come from npm and need the network.',
				'Restart yena afterwards.',
			],
			agent: 'deny',
			run: (args, ctx) => runImport(args, ctx, env),
		},
	];
}
