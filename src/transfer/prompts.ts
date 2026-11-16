import type {CommandContext, MountControl, UiElement} from '../../../../src/api.js';
import {commandError} from '../kit/command-error.js';
import {PASSWORD_MIN, type SecretKind} from './crypto.js';
import {hasTerminal, readHidden, readLine, writeTerminal} from './tty.js';

export type Prompts = {
	available(ctx: CommandContext): boolean;
	preload(ctx: CommandContext): Promise<void>;
	askNewSecret(ctx: CommandContext): Promise<string | undefined>;
	askSecret(ctx: CommandContext, kind: SecretKind): Promise<string | undefined>;
	showCodeWord(ctx: CommandContext, code: string): Promise<boolean>;
	confirmApply(ctx: CommandContext, summary: string): Promise<boolean | undefined>;
};

type Views = typeof import('./views.js');

export type PromptDeps = {loadViews?: () => Promise<Views>};

type Mode = 'panel' | 'tty' | 'none';

const modeOf = (ctx: CommandContext): Mode => {
	if (ctx.mount && !ctx.headless) return 'panel';
	if (ctx.headless && hasTerminal()) return 'tty';
	return 'none';
};

export const noTerminalError = (what: string, hint: string): Error =>
	commandError('failed', `${what} needs a terminal or the app to type the password; ${hint}`);

export function createPrompts(deps: PromptDeps = {}): Prompts {
	const loadViews = deps.loadViews ?? (() => import('./views.js'));
	let loaded: Promise<Views> | undefined;
	const views = () => (loaded ??= loadViews());

	async function mountView<T>(ctx: CommandContext, build: (v: Views, control: MountControl, done: (value: T) => void) => UiElement): Promise<T | undefined> {
		const v = await views();
		let result: T | undefined;
		await ctx.mount!(control => build(v, control, value => (result = value)), {target: 'panel'});
		return result;
	}

	return {
		available: ctx => modeOf(ctx) !== 'none',
		async preload(ctx) {
			if (modeOf(ctx) === 'panel') await views();
		},
		async askNewSecret(ctx) {
			if (modeOf(ctx) === 'panel') {
				const {createElement} = await import('react');
				return mountView<string | undefined>(ctx, (v, control, onDone) => createElement(v.NewSecretView, {control, onDone}));
			}
			for (;;) {
				const first = readHidden('Password for the export (empty: generate a code word): ');
				if (first === '') return '';
				if ([...first].length < PASSWORD_MIN) {
					writeTerminal('Use at least 8 characters, or leave it empty for a code word\n');
					continue;
				}
				if (readHidden('Type the password again: ') === first) return first;
				writeTerminal('The passwords do not match\n');
			}
		},
		async askSecret(ctx, kind) {
			const label = kind === 'code' ? 'Code word of the export file' : 'Password of the export file';
			if (modeOf(ctx) === 'panel') {
				const {createElement} = await import('react');
				return mountView<string | undefined>(ctx, (v, control, onDone) => createElement(v.SecretView, {control, onDone, label}));
			}
			const value = readHidden(`${label}: `);
			return value === '' ? undefined : value;
		},
		async showCodeWord(ctx, code) {
			if (modeOf(ctx) === 'panel') {
				const {createElement} = await import('react');
				return (await mountView<boolean>(ctx, (v, control, onDone) => createElement(v.CodeWordView, {control, onDone, code}))) === true;
			}
			writeTerminal(`\nCode word: ${code}\nWrite it down: it is shown only this once and is needed to import the file.\n`);
			readLine('Press Enter once you have written it down (Ctrl-C cancels the export): ');
			return true;
		},
		async confirmApply(ctx, summary) {
			const mode = modeOf(ctx);
			if (mode === 'none') return undefined;
			if (mode === 'panel') {
				const {createElement} = await import('react');
				return (await mountView<boolean>(ctx, (v, control, onDone) => createElement(v.ConfirmView, {control, onDone, summary}))) === true;
			}
			return readLine(`${summary} Type yes to apply: `).trim().toLowerCase() === 'yes';
		},
	};
}
