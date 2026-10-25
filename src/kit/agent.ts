import type {CommandInfo, CommandRunResult} from '../../../../src/api.js';

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

/**
 * Plain text listing for a model; one line per command and per subcommand it may run. Entries the
 * model cannot run ("deny") cost most of the listing (e.g. every Claude Code skill), so they are only
 * named in one closing line: the model still knows they exist and that the user runs them.
 */
export function formatCommandList(list: readonly CommandInfo[]): string {
	if (list.length === 0) return 'No commands are available.';
	const lines: string[] = [];
	const denied: string[] = [];
	for (const cmd of list) {
		const open = cmd.subcommands.filter(sub => sub.policy !== 'deny');
		const closed = cmd.subcommands.length - open.length;
		if (cmd.policy === 'deny' && open.length === 0) {
			denied.push(cmd.name);
			continue;
		}
		lines.push(`${cmd.usage ?? cmd.name} [${cmd.policy}]${cmd.description ? ` - ${cmd.description}` : ''}`);
		for (const sub of open) {
			const aliases = sub.aliases.length > 0 ? ` (${sub.aliases.join(', ')})` : '';
			lines.push(`  ${sub.usage || sub.name}${aliases} [${sub.policy}]${sub.description ? ` - ${sub.description}` : ''}`);
		}
		if (closed > 0) denied.push(`${closed} ${cmd.name} subcommand${closed === 1 ? '' : 's'}`);
	}
	if (denied.length > 0) lines.push(`Not available to the assistant (the user runs them): ${denied.join(', ')}.`);
	return lines.join('\n');
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
