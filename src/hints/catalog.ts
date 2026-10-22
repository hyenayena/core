import type {AgentPolicy} from '../../../../src/api.js';
import {sanitizeText} from './sanitize.js';

export type CatalogSub = {
	name: string;
	aliases: string[];
	usage: string;
	description: string;
	// Undefined when the subcommand declares nothing and inherits its command's policy.
	agent: AgentPolicy | undefined;
	subs: CatalogSub[];
};

export type CatalogCommand = {
	name: string;
	description: string;
	usage?: string;
	agent: AgentPolicy;
	subs: CatalogSub[];
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

// A throwing getter or any value but the three literals must never widen access.
function readAgent(e: Record<string, unknown>): AgentPolicy | undefined {
	try {
		const v = e['agent'];
		if (v === undefined) return undefined;
		return v === 'safe' || v === 'confirm' || v === 'deny' ? v : 'confirm';
	} catch {
		return 'confirm';
	}
}

function buildSubs(raw: unknown, depth: number): CatalogSub[] {
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
			const sub: CatalogSub = {
				name,
				aliases,
				usage: sanitizeText(e['usage'], MAX_TEXT),
				description: sanitizeText(e['description'], MAX_TEXT),
				agent: readAgent(e),
				subs: buildSubs(e['subcommands'], depth + 1),
			};
			seen.add(name);
			out.push(sub);
		} catch {
			continue;
		}
	}
	return out;
}

/** Validates, sanitises and caps registry data once; never throws. */
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
				subs: buildSubs(e['subcommands'], 1),
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
