import type {
	AgentPolicy,
	Command,
	CommandBridge,
	CommandContext,
	CommandInfo,
	CommandInfoSub,
	CommandRunRequest,
	CommandRunResult,
	CommandRunStatus,
	Logger,
	MountControl,
	UiElement,
} from '../../../../src/api.js';
import type {Catalog, CatalogCommand, CatalogSub} from '../hints/catalog.js';
import {policyOf, walkPath} from '../hints/path.js';
import {sanitizeBlock, sanitizeText, sanitizeToken} from '../hints/sanitize.js';
import {unknownCommandLines} from '../hints/typo.js';
import {c} from '../hints/style.js';
import {errorLines} from '../error-lines.js';
import {createCapture} from './capture.js';
import {normalizeStyled, plainLines, type NormalStyled} from '../kit/styled.js';
import {parseLine} from '../parse-line.js';
import {isQuitLine} from '../view/keys.js';
import type {AgentMode} from '../view/prefs.js';

export const MAX_LINE = 4096;
export {MAX_OUTPUT_CHARS, MAX_OUTPUT_LINES} from './capture.js';
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 600_000;

const UNSAFE_LINE = new RegExp('[\\p{Cc}\\p{Cf}]', 'u');

export const hasUnsafeChars = (line: string): boolean => UNSAFE_LINE.test(line);

export type AgentViewHandle = {done: Promise<void>; close: () => void};

export type BridgeDeps = {
	find: (name: string) => Command | undefined;
	catalog: () => Catalog;
	mode: () => AgentMode;
	tee: (text: string, color?: string) => void;
	teeStyled?: (blocks: NormalStyled) => void;
	clear: () => void;
	exit: () => void;
	mountView?: (build: (control: MountControl) => UiElement, print: (text: string) => void) => AgentViewHandle;
	afterRun?: () => void;
	beforeRun?: () => void;
	endRun?: () => void;
	log: Logger;
	now?: () => number;
};

type Resolved = {policy: AgentPolicy; subcommand?: string};

function resolvePolicy(cmd: CatalogCommand | undefined, args: readonly string[]): Resolved {
	if (!cmd) return {policy: 'confirm'};
	const {path} = walkPath(cmd, args);
	const resolved: Resolved = {policy: policyOf(cmd, path)};
	if (path.length > 0) resolved.subcommand = path.map(s => s.name).join(' ');
	return resolved;
}

const effective = (policy: AgentPolicy, mode: AgentMode): AgentPolicy => (mode === 'ask' && policy === 'safe' ? 'confirm' : policy);

const clampTimeout = (ms: number | undefined): number =>
	typeof ms === 'number' && Number.isFinite(ms) ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(ms))) : DEFAULT_TIMEOUT_MS;

export function createCommandBridge(deps: BridgeDeps): CommandBridge {
	const now = deps.now ?? Date.now;
	let busy = false;

	const list = (): CommandInfo[] => {
		const mode = deps.mode();
		if (mode === 'off') return [];
		return deps.catalog().commands.map(cmd => {
			const subsOf = (subs: readonly CatalogSub[], inherited: AgentPolicy): CommandInfoSub[] =>
				subs.map(s => {
					const own = s.agent ?? inherited;
					const sub: CommandInfoSub = {
						name: s.name,
						aliases: [...s.aliases],
						usage: s.usage,
						description: s.description,
						policy: effective(own, mode),
					};
					if (s.subs.length > 0) sub.subcommands = subsOf(s.subs, own);
					return sub;
				});
			const info: CommandInfo = {
				name: cmd.name,
				description: cmd.description,
				policy: effective(cmd.agent, mode),
				subcommands: subsOf(cmd.subs, cmd.agent),
			};
			if (cmd.usage !== undefined) info.usage = cmd.usage;
			return info;
		});
	};

	const run = async (req: CommandRunRequest): Promise<CommandRunResult> => {
		const started = now();
		const caller = sanitizeToken(typeof req?.caller === 'string' ? req.caller : '', 40) || 'agent';
		const meta: {command?: string; subcommand?: string; policy?: AgentPolicy; confirmed?: boolean} = {};
		let outputChars = 0;
		const output = createCapture();
		let mounted = false;
		let viewForced = false;
		let running = false;

		const finish = (status: CommandRunStatus, text = '', reason?: string): CommandRunResult => {
			outputChars = text.length;
			const truncated = output.truncated;
			const result: CommandRunResult = {status, output: text, truncated, ms: Math.max(0, now() - started)};
			if (reason !== undefined) result.reason = reason;
			if (status !== 'off') {
				try {
					deps.log[status === 'ok' ? 'info' : 'warn']('agent command', {
						caller,
						...(meta.command !== undefined && {command: meta.command}),
						...(meta.subcommand !== undefined && {subcommand: meta.subcommand}),
						...(meta.policy !== undefined && {policy: meta.policy}),
						status,
						...(meta.confirmed !== undefined && {confirmed: meta.confirmed}),
						ms: result.ms,
						outputChars,
						truncated,
						...(mounted && {mounted: true}),
						...(viewForced && {viewForced: true}),
					});
				} catch {}
			}
			if (status !== 'ok' && status !== 'off') {
				const label = meta.command ?? 'command';
				const suffix = reason === undefined ? '' : ` (${sanitizeText(reason, 200)})`;
				safeTee(`[${caller}] ${label}: ${status}${suffix}`, c('yellow'));
			}
			if (running) {
				running = false;
				try {
					deps.endRun?.();
				} catch {}
			}
			return result;
		};

		const safeTee = (text: string, color?: string) => {
			try {
				deps.tee(text, color);
			} catch {}
		};

		try {
			const mode = deps.mode();
			if (mode === 'off') return finish('off', '', 'agent commands are turned off in the settings');

			const raw = req?.line;
			if (typeof raw !== 'string') return finish('invalid', '', 'the line must be a string');
			safeTee(`[${caller}] > ${sanitizeText(raw, MAX_LINE)}`, c('magenta'));
			if (raw.trim() === '') return finish('invalid', '', 'the line is empty');
			if (raw.length > MAX_LINE) return finish('invalid', '', `the line is longer than ${MAX_LINE} characters`);
			if (hasUnsafeChars(raw)) return finish('invalid', '', 'the line contains control or formatting characters');
			const parsed = parseLine(raw);
			if (!parsed || isQuitLine(parsed.line)) return finish('invalid', '', 'the line is not a runnable command');

			const catalog = deps.catalog();
			const command = deps.find(parsed.name);
			if (!command) {
				const [unknown, hint] = unknownCommandLines(catalog, parsed.name);
				return finish('unknown', '', hint === undefined ? unknown : `${unknown}. ${hint}`);
			}
			const catalogCommand = catalog.byName.get(parsed.name);
			if (catalogCommand) meta.command = catalogCommand.name;
			const resolved = resolvePolicy(catalogCommand, parsed.args);
			if (resolved.subcommand !== undefined) meta.subcommand = resolved.subcommand;
			const policy = effective(resolved.policy, mode);
			meta.policy = policy;

			if (policy === 'deny') return finish('denied', '', 'this command is not available to assistants');

			const signal = req.signal;
			if (signal?.aborted) return finish('aborted');
			if (busy) return finish('busy', '', 'another assistant command is still running');

			if (policy === 'confirm') {
				if (typeof req.confirm !== 'function') {
					meta.confirmed = false;
					return finish('declined', '', 'this caller cannot ask the user');
				}
				let answer: boolean | 'aborted';
				try {
					answer = await raceAbort(
						req.confirm({
							line: parsed.line,
							command: meta.command ?? parsed.name,
							...(meta.subcommand !== undefined && {subcommand: meta.subcommand}),
							caller,
						}),
						signal,
					);
				} catch {
					answer = false;
				}
				if (answer === 'aborted') return finish('aborted');
				meta.confirmed = answer === true;
				if (!meta.confirmed) return finish('declined', '', 'the user declined');
				if (busy) return finish('busy', '', 'another assistant command is still running');
			}

			busy = true;
			running = true;
			try {
				deps.beforeRun?.();
			} catch {}
			const controller = new AbortController();
			let capturing = true;
			let ended = false;
			const views = new Set<AgentViewHandle>();

			const closeViews = (forced: boolean) => {
				if (forced && views.size > 0) viewForced = true;
				for (const handle of [...views]) {
					try {
						handle.close();
					} catch {}
				}
			};

			const capture = (text: string) => {
				for (const line of text.split('\n')) output.push(line);
			};

			const ctx: CommandContext = {
				print: text => {
					const clean = sanitizeBlock(typeof text === 'string' ? text : String(text));
					safeTee(clean);
					if (capturing) capture(clean);
				},
				printStyled: blocks => {
					const styled = normalizeStyled(blocks);
					const plain = plainLines(styled).join('\n');
					if (deps.teeStyled) {
						try {
							deps.teeStyled(styled);
						} catch {}
					} else if (plain !== '') safeTee(plain);
					if (capturing && plain !== '') capture(plain);
				},
				clear: deps.clear,
				exit: deps.exit,
				signal: controller.signal,
			};

			const mountView = deps.mountView;
			if (mountView) {
				ctx.mount = (build, options) => {
					if (ended) return Promise.reject(new Error('The assistant command has ended'));
					if (typeof build !== 'function') return Promise.reject(new Error('A view needs a build function'));
					let panel = false;
					try {
						panel = options?.target === 'panel';
					} catch {}
					if (!panel) return Promise.reject(new Error('Assistant commands can only show views in the console panel'));
					let handle: AgentViewHandle;
					try {
						handle = mountView(build, ctx.print);
					} catch (error) {
						return Promise.reject(error instanceof Error ? error : new Error(String(error)));
					}
					views.add(handle);
					mounted = true;
					const cleanup = () => void views.delete(handle);
					handle.done.then(cleanup, cleanup);
					return handle.done;
				};
			}

			let failure: string[] | undefined;
			const execution = Promise.resolve()
				.then(() => command.run(parsed.args, ctx))
				.then(
					() => undefined,
					(error: unknown) => {
						failure = errorLines(error);
					},
				)
				.finally(() => {
					ended = true;
					closeViews(true);
					busy = false;
					try {
						deps.afterRun?.();
					} catch {}
				});

			const outcome = await raceRun(execution, clampTimeout(req.timeoutMs), signal);
			capturing = false;
			if (outcome !== 'done') {
				ended = true;
				controller.abort();
				closeViews(true);
				return finish(outcome, output.text());
			}
			if (failure) {
				const shown = failure.map((text, i) => (i === 0 ? `Error: ${text}` : `  ${text}`));
				for (const text of shown) safeTee(text, c('red'));
				capture(shown.join('\n'));
				capturing = false;
				return finish('error', output.text(), failure[0]);
			}
			return finish('ok', output.text());
		} catch (error) {
			return finish('error', '', sanitizeText(error instanceof Error ? error.message : String(error), 200));
		}
	};

	return {list, run};
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | 'aborted'> {
	if (!signal) return promise;
	return new Promise((resolve, reject) => {
		const onAbort = () => resolve('aborted');
		signal.addEventListener('abort', onAbort, {once: true});
		promise.then(
			v => {
				signal.removeEventListener('abort', onAbort);
				resolve(v);
			},
			e => {
				signal.removeEventListener('abort', onAbort);
				reject(e);
			},
		);
	});
}

function raceRun(execution: Promise<void>, timeoutMs: number, signal: AbortSignal | undefined): Promise<'done' | 'timeout' | 'aborted'> {
	return new Promise(resolve => {
		const onAbort = () => finish('aborted');
		const timer = setTimeout(() => finish('timeout'), timeoutMs);
		const finish = (v: 'done' | 'timeout' | 'aborted') => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			resolve(v);
		};
		if (signal?.aborted) return finish('aborted');
		signal?.addEventListener('abort', onAbort, {once: true});
		void execution.then(() => finish('done'));
	});
}
