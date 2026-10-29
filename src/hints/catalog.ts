import type {AgentPolicy} from '../../../../src/api.js';
import {sanitizeText} from './sanitize.js';
import {parseUsage, slotFlags, slotKey} from './usage.js';

export type CatalogArg = {name: string; description: string; optional: boolean; repeatable: boolean};

export type CatalogOption = {name: string; aliases: string[]; value?: string; description: string; repeatable: boolean};

export type CatalogSub = {
	name: string;
	aliases: string[];
	usage: string;
	description: string;
	agent: AgentPolicy | undefined;
	subs: CatalogSub[];
	args: CatalogArg[];
	options: CatalogOption[];
	notes: string[];
	builtin?: true;
};

export type CatalogCommand = {
	name: string;
	description: string;
	usage?: string;
	agent: AgentPolicy;
	subs: CatalogSub[];
	args: CatalogArg[];
	options: CatalogOption[];
	notes: string[];
	complete?: unknown;
	index: number;
};

export type Catalog = {commands: CatalogCommand[]; byName: Map<string, CatalogCommand>};

const MAX_COMMANDS = 500;
const MAX_SUBS = 100;
const MAX_DEPTH = 3;
const MAX_NAME = 64;
const MAX_TEXT = 200;
const MAX_SCAN = 1000;
const MAX_ARGS = 32;
const MAX_OPTIONS = 64;
const MAX_NOTES = 40;
const MAX_VALUE = 64;
const MAX_ALIASES = 16;

function validName(v: unknown): string | undefined {
	if (typeof v !== 'string' || v === '') return undefined;
	if (Array.from(v).length > MAX_NAME) return undefined;
	if (/\s/u.test(v)) return undefined;
	if (sanitizeText(v, MAX_NAME) !== v) return undefined;
	return v;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

function readAgent(e: Record<string, unknown>): AgentPolicy | undefined {
	try {
		const v = e['agent'];
		if (v === undefined) return undefined;
		return v === 'safe' || v === 'confirm' || v === 'deny' ? v : 'confirm';
	} catch {
		return 'confirm';
	}
}

function read(e: Record<string, unknown>, key: string): unknown {
	try {
		return e[key];
	} catch {
		return undefined;
	}
}

function readList(e: Record<string, unknown>, key: string, cap: number): unknown[] {
	const v = read(e, key);
	if (!Array.isArray(v)) return [];
	try {
		return v.slice(0, Math.min(cap, MAX_SCAN));
	} catch {
		return [];
	}
}

const readFlag = (e: Record<string, unknown>, key: string): boolean | undefined => {
	const v = read(e, key);
	return typeof v === 'boolean' ? v : undefined;
};

function buildArgs(e: Record<string, unknown>, usage: string): CatalogArg[] {
	const slots = parseUsage(usage, 0).filter(t => t.kind === 'slot');
	const out: CatalogArg[] = [];
	for (const raw of readList(e, 'args', MAX_SCAN)) {
		if (out.length >= MAX_ARGS) break;
		try {
			if (!isObject(raw)) continue;
			const name = validName(read(raw, 'name'));
			if (name === undefined || out.some(a => a.name === name)) continue;
			const slot = slots.find(t => slotKey(t.text) === name);
			const fromUsage = slot ? slotFlags(slot.text) : {optional: false, repeatable: false};
			out.push({
				name,
				description: sanitizeText(read(raw, 'description'), MAX_TEXT),
				optional: readFlag(raw, 'optional') ?? fromUsage.optional,
				repeatable: readFlag(raw, 'repeatable') ?? (fromUsage.repeatable || slot?.variadic === true),
			});
		} catch {
			continue;
		}
	}
	return out;
}

const optionName = (v: unknown): string | undefined => {
	const name = validName(v);
	return name !== undefined && name.startsWith('-') ? name : undefined;
};

function buildOptions(e: Record<string, unknown>): CatalogOption[] {
	const out: CatalogOption[] = [];
	for (const raw of readList(e, 'options', MAX_SCAN)) {
		if (out.length >= MAX_OPTIONS) break;
		try {
			if (!isObject(raw)) continue;
			const name = optionName(read(raw, 'name'));
			if (name === undefined || out.some(o => o.name === name)) continue;
			const aliases: string[] = [];
			for (const a of readList(raw, 'aliases', MAX_ALIASES)) {
				const alias = optionName(a);
				if (alias !== undefined && alias !== name && !aliases.includes(alias)) aliases.push(alias);
			}
			const option: CatalogOption = {
				name,
				aliases,
				description: sanitizeText(read(raw, 'description'), MAX_TEXT),
				repeatable: readFlag(raw, 'repeatable') ?? false,
			};
			const value = sanitizeText(read(raw, 'value'), MAX_VALUE);
			if (value !== '') option.value = value;
			out.push(option);
		} catch {
			continue;
		}
	}
	return out;
}

function buildNotes(e: Record<string, unknown>): string[] {
	const out: string[] = [];
	for (const raw of readList(e, 'notes', MAX_NOTES)) {
		const line = sanitizeText(raw, MAX_TEXT);
		if (line !== '') out.push(line);
	}
	return out;
}

function builtinHelp(path: readonly string[]): CatalogSub {
	return {
		name: 'help',
		aliases: [],
		usage: `${path.join(' ')} help [subcommand…]`,
		description: 'Show usage, arguments and subcommands',
		agent: 'safe',
		subs: [],
		args: [{name: 'subcommand', description: 'Path of the subcommand to describe', optional: true, repeatable: true}],
		options: [],
		notes: [],
		builtin: true,
	};
}

function withHelp(subs: CatalogSub[], path: readonly string[]): CatalogSub[] {
	if (subs.length === 0 || subs.some(s => s.name === 'help' || s.aliases.includes('help'))) return subs;
	return [...subs, builtinHelp(path)];
}

function buildSubs(raw: unknown, depth: number, path: readonly string[]): CatalogSub[] {
	if (depth > MAX_DEPTH || !Array.isArray(raw)) return [];
	const out: CatalogSub[] = [];
	const seen = new Set<string>();
	const limit = Math.min(raw.length, MAX_SCAN);
	for (let i = 0; i < limit && out.length < MAX_SUBS; i++) {
		try {
			const e: unknown = raw[i];
			if (!isObject(e)) continue;
			const name = validName(e['name']);
			if (name === undefined || seen.has(name)) continue;
			const aliases: string[] = [];
			const rawAliases = e['aliases'];
			if (Array.isArray(rawAliases)) {
				for (const a of rawAliases.slice(0, MAX_SUBS)) {
					const alias = validName(a);
					if (alias !== undefined && alias !== name && !aliases.includes(alias)) aliases.push(alias);
				}
			}
			const usage = sanitizeText(e['usage'], MAX_TEXT);
			const sub: CatalogSub = {
				name,
				aliases,
				usage,
				description: sanitizeText(e['description'], MAX_TEXT),
				agent: readAgent(e),
				subs: withHelp(buildSubs(e['subcommands'], depth + 1, [...path, name]), [...path, name]),
				args: buildArgs(e, usage),
				options: buildOptions(e),
				notes: buildNotes(e),
			};
			seen.add(name);
			out.push(sub);
		} catch {
			continue;
		}
	}
	return out;
}

export function buildCatalog(commands: readonly unknown[]): Catalog {
	const list: CatalogCommand[] = [];
	const byName = new Map<string, CatalogCommand>();
	if (!Array.isArray(commands)) return {commands: list, byName};
	for (let i = 0; i < commands.length && list.length < MAX_COMMANDS; i++) {
		try {
			const e: unknown = commands[i];
			if (!isObject(e)) continue;
			const name = validName(e['name']);
			if (name === undefined || byName.has(name)) continue;
			const usage = sanitizeText(e['usage'], MAX_TEXT);
			const cmd: CatalogCommand = {
				name,
				description: sanitizeText(e['description'], MAX_TEXT),
				agent: readAgent(e) ?? 'confirm',
				subs: withHelp(buildSubs(e['subcommands'], 1, [name]), [name]),
				args: buildArgs(e, usage),
				options: buildOptions(e),
				notes: buildNotes(e),
				index: i,
			};
			if (usage !== '') cmd.usage = usage;
			byName.set(name, cmd);
			list.push(cmd);
		} catch {
			continue;
		}
	}
	return {commands: list, byName};
}
