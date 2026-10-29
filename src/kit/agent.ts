import type {AgentPolicy, CommandInfo, CommandInfoSub, CommandRunResult} from '../../../../src/api.js';
import {parseLine} from '../parse-line.js';

export type CommandToolSpec = {
	name: string;
	description: string;
	inputSchema: {type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false};
};

/** Neutral tool specs for any agent module to adapt to its model API. */
export const COMMAND_TOOLS: {list_commands: CommandToolSpec; run_command: CommandToolSpec} = {
	list_commands: {
		name: 'list_commands',
		description:
			'List the yena console commands, with usage and whether each may run directly ("safe"), needs the user\'s approval ("confirm") or is unavailable ("deny").',
		inputSchema: {type: 'object', properties: {}, required: [], additionalProperties: false},
	},
	run_command: {
		name: 'run_command',
		description:
			'Run one yena console command line, for example "help" or "mod list", and return its output. Commands that need approval ask the user first.',
		inputSchema: {
			type: 'object',
			properties: {command: {type: 'string', maxLength: 4096, description: 'The full command line, command name first'}},
			required: ['command'],
			additionalProperties: false,
		},
	},
};

const MAX_DEPTH = 8;

// Core's own `help` subcommand; the closing line points to `help` instead of repeating it everywhere.
const isBuiltinHelp = (sub: CommandInfoSub): boolean =>
	sub.name === 'help' && !(sub.subcommands?.length) && sub.usage.endsWith(' help [subcommand…]');

const subsOf = (node: {subcommands?: CommandInfoSub[]}): CommandInfoSub[] => (Array.isArray(node.subcommands) ? node.subcommands : []);

// Pushes the lines of the subcommands the model may run; returns how many were left out.
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

/**
 * Plain text listing for a model; one line per command and per subcommand it may run, nested ones
 * indented. Entries the model cannot run ("deny") cost most of the listing (e.g. every Claude Code
 * skill), so they are only named in one closing line: the model still knows they exist and that the
 * user runs them.
 */
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
		lines.push(`${cmd.usage ?? cmd.name} [${cmd.policy}]${cmd.description ? ` - ${cmd.description}` : ''}`);
		lines.push(...open);
		if (closed > 0) denied.push(`${closed} ${cmd.name} subcommand${closed === 1 ? '' : 's'}`);
	}
	if (denied.length > 0) lines.push(`Not available to the assistant (the user runs them): ${denied.join(', ')}.`);
	lines.push('Arguments and options: help <command> [subcommand…]');
	return lines.join('\n');
}

export type ResolvedCommandLine = {command: string; subcommand?: string; policy: AgentPolicy};

/**
 * The command and subcommand path a line runs and the policy listed for it, walked as the bridge
 * walks the catalog (name before alias); undefined for a blank line or an unknown command.
 */
export function resolveCommandLine(list: readonly CommandInfo[], line: string): ResolvedCommandLine | undefined {
	if (typeof line !== 'string' || !Array.isArray(list)) return undefined;
	const parsed = parseLine(line);
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

/** Plain text result for a model: the output, or why the command did not run. */
export function formatRunResult(result: CommandRunResult): string {
	const parts: string[] = [];
	if (result.status !== 'ok') parts.push(`Command ${result.status}${result.reason ? `: ${result.reason}` : ''}`);
	if (result.output !== '') parts.push(result.output);
	else if (result.status === 'ok') parts.push('(no output)');
	if (result.truncated) parts.push('[output truncated]');
	return parts.join('\n');
}
