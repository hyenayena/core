import type {AgentPolicy, CommandInfo, CommandInfoSub, CommandRunResult, CommandRunStatus} from '../../../../src/api.js';
import {sanitizeText} from '../hints/sanitize.js';
import {LineError, parseLine} from '../parse-line.js';

const QUOTE_HINT = 'Quote an argument that holds spaces: "a b" or \'a b\'.';

export type CommandToolSpec = {
	name: string;
	description: string;
	inputSchema: {type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false};
};

export const BATCH_MAX_LINES = 8;

export const COMMAND_TOOLS: {list_commands: CommandToolSpec; run_command: CommandToolSpec; read_output: CommandToolSpec} = {
	list_commands: {
		name: 'list_commands',
		description:
			'List the yena console commands and their policy: "safe" runs directly, "confirm" asks the user. Without arguments only the top-level commands; {command} shows one command\'s subcommands and usage.',
		inputSchema: {
			type: 'object',
			properties: {command: {type: 'string', maxLength: 200, description: 'Command name, optionally followed by subcommand words'}},
			required: [],
			additionalProperties: false,
		},
	},
	run_command: {
		name: 'run_command',
		description:
			`Run yena console command lines and return their output. One line in "command", or up to ${BATCH_MAX_LINES} in "commands", run in order (stopOnError, default true, skips the rest after a failed line). Each line that needs approval asks the user. Long output is shortened to its start and end; read the rest with read_output. ${QUOTE_HINT}`,
		inputSchema: {
			type: 'object',
			properties: {
				command: {type: 'string', maxLength: 4096, description: 'The full command line, command name first'},
				commands: {type: 'array', items: {type: 'string', maxLength: 4096}, minItems: 1, maxItems: BATCH_MAX_LINES},
				stopOnError: {type: 'boolean'},
			},
			required: [],
			additionalProperties: false,
		},
	},
	read_output: {
		name: 'read_output',
		description:
			'Read a shortened run_command output that yena kept: a line range (from, lines) or the lines matching grep (a case-insensitive JavaScript regular expression), with line numbers. Kept in memory for this chat only; the oldest are dropped.',
		inputSchema: {
			type: 'object',
			properties: {
				id: {type: 'string', maxLength: 32},
				from: {type: 'integer', minimum: 1},
				lines: {type: 'integer', minimum: 1, maximum: 400},
				grep: {type: 'string', maxLength: 200},
			},
			required: ['id'],
			additionalProperties: false,
		},
	},
};

const MAX_DEPTH = 8;

const isBuiltinHelp = (sub: CommandInfoSub): boolean =>
	sub.name === 'help' && !(sub.subcommands?.length) && sub.usage.endsWith(' help [subcommand…]');

const subsOf = (node: {subcommands?: CommandInfoSub[]}): CommandInfoSub[] => (Array.isArray(node.subcommands) ? node.subcommands : []);

function subLines(subs: readonly CommandInfoSub[], depth: number, lines: string[]): number {
	if (depth > MAX_DEPTH) return 0;
	let closed = 0;
	for (const sub of subs) {
		if (isBuiltinHelp(sub)) continue;
		const below: string[] = [];
		const closedBelow = subLines(subsOf(sub), depth + 1, below);
		if (sub.policy === 'deny' && below.length === 0) {
			closed += 1 + closedBelow;
			continue;
		}
		const aliases = sub.aliases.length > 0 ? ` (${sub.aliases.join(', ')})` : '';
		lines.push(`${'  '.repeat(depth)}${sub.usage || sub.name}${aliases} [${sub.policy}]${sub.description ? ` - ${sub.description}` : ''}`);
		lines.push(...below);
		closed += closedBelow;
	}
	return closed;
}

const deniedSummary = (denied: readonly string[]): string => `Not available to the assistant (the user runs them): ${denied.join(', ')}.`;

export function formatCommandList(list: readonly CommandInfo[]): string {
	if (list.length === 0) return 'No commands are available.';
	const lines: string[] = [];
	const denied: string[] = [];
	for (const cmd of list) {
		const open: string[] = [];
		const closed = subLines(subsOf(cmd), 1, open);
		if (cmd.policy === 'deny' && open.length === 0) {
			denied.push(cmd.name);
			continue;
		}
		const more = open.length > 0 ? ` (${open.length} subcommand${open.length === 1 ? '' : 's'})` : '';
		lines.push(`${cmd.usage ?? cmd.name} [${cmd.policy}]${cmd.description ? ` - ${cmd.description}` : ''}${more}`);
		if (closed > 0) denied.push(`${closed} ${cmd.name} subcommand${closed === 1 ? '' : 's'}`);
	}
	if (denied.length > 0) lines.push(deniedSummary(denied));
	lines.push(
		`Subcommands: list_commands {"command": "<name>"}. Arguments and options: help <command> [subcommand…]. ${QUOTE_HINT}`,
	);
	return lines.join('\n');
}

export function formatCommandTree(list: readonly CommandInfo[], path: string): {text: string; found: boolean} {
	const unknown = {
		text: `Unknown command "${sanitizeText(path, 80)}". Call list_commands without arguments to see the commands.`,
		found: false,
	};
	const words = typeof path === 'string' ? path.trim().split(/\s+/).filter(Boolean) : [];
	if (words.length === 0 || words.length > MAX_DEPTH || !Array.isArray(list)) return unknown;
	const top = list.find(c => c.name === words[0]);
	if (!top) return unknown;
	let node: {name: string; usage?: string; policy: AgentPolicy; description: string; aliases?: string[]; subcommands?: CommandInfoSub[]} = top;
	const names = [top.name];
	for (const word of words.slice(1)) {
		const sub = subsOf(node).find(s => s.name === word) ?? subsOf(node).find(s => s.aliases.includes(word));
		if (!sub) return unknown;
		node = sub;
		names.push(sub.name);
	}
	const where = names.join(' ');
	const open: string[] = [];
	const closed = subLines(subsOf(node), 1, open);
	if (node.policy === 'deny' && open.length === 0) {
		return {text: `Command "${sanitizeText(path, 80)}" is not available to the assistant (the user runs it).`, found: false};
	}
	const aliases = node.aliases && node.aliases.length > 0 ? ` (${node.aliases.join(', ')})` : '';
	const lines = [`${node.usage || node.name}${aliases} [${node.policy}]${node.description ? ` - ${node.description}` : ''}`, ...open];
	if (closed > 0) lines.push(deniedSummary([`${closed} ${where} subcommand${closed === 1 ? '' : 's'}`]));
	lines.push(`Arguments and options: help ${where} [subcommand…]. ${QUOTE_HINT}`);
	return {text: lines.join('\n'), found: true};
}

export function formatBatchResult(items: readonly {line: string; status: CommandRunStatus | 'skipped'; text: string}[]): string {
	return items.map((item, i) => `[${i + 1}/${items.length} ${item.status}] ${item.line}\n${item.text}`).join('\n\n');
}

export type ResolvedCommandLine = {command: string; subcommand?: string; policy: AgentPolicy};

export function resolveCommandLine(list: readonly CommandInfo[], line: string): ResolvedCommandLine | undefined {
	if (typeof line !== 'string' || !Array.isArray(list)) return undefined;
	let parsed: ReturnType<typeof parseLine>;
	try {
		parsed = parseLine(line);
	} catch (error) {
		if (error instanceof LineError) return undefined;
		throw error;
	}
	if (!parsed) return undefined;
	const cmd = list.find(c => c.name === parsed.name);
	if (!cmd) return undefined;
	let policy = cmd.policy;
	const names: string[] = [];
	let subs = subsOf(cmd);
	for (const token of parsed.args.slice(0, MAX_DEPTH)) {
		const sub = subs.find(s => s.name === token) ?? subs.find(s => s.aliases.includes(token));
		if (!sub) break;
		names.push(sub.name);
		policy = sub.policy;
		subs = subsOf(sub);
	}
	const resolved: ResolvedCommandLine = {command: cmd.name, policy};
	if (names.length > 0) resolved.subcommand = names.join(' ');
	return resolved;
}

export function formatRunResult(result: CommandRunResult): string {
	const parts: string[] = [];
	if (result.status !== 'ok') parts.push(`Command ${result.status}${result.reason ? `: ${result.reason}` : ''}`);
	if (result.output !== '') parts.push(result.output);
	else if (result.status === 'ok') parts.push('(no output)');
	if (result.truncated) parts.push('[output truncated]');
	return parts.join('\n');
}
