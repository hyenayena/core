import type {Catalog, CatalogArg, CatalogCommand, CatalogOption, CatalogSub} from './catalog.js';
import {sanitizeToken} from './sanitize.js';
import {stringCells} from './width.js';
import {nearestName, unknownCommandLines} from './typo.js';

const MIN_NAME_COLUMN = 8;
const MAX_PATH = 8;

type Node = CatalogCommand | CatalogSub;

type Resolved = {node: Node; names: string[]} | {error: string[]};

function pad(s: string, cells: number): string {
	return s + ' '.repeat(Math.max(0, cells - stringCells(s)));
}

function subLabel(sub: CatalogSub): string {
	return sub.aliases.length > 0 ? `${sub.name} (${sub.aliases.join(', ')})` : sub.name;
}

// The usage after the subcommand's own path; a relative usage (`install <src>`) after its name.
function usageTail(usage: string, names: readonly string[], sub: CatalogSub): string {
	const words = usage.trim().split(/\s+/).filter(Boolean);
	if (names.length > 0 && names.every((w, i) => words[i] === w)) return words.slice(names.length).join(' ');
	if (words[0] === sub.name || sub.aliases.includes(words[0] ?? '')) return words.slice(1).join(' ');
	return usage.trim();
}

const listed = (subs: readonly CatalogSub[]) => subs.filter(s => !s.builtin);

function subLines(subs: readonly CatalogSub[], parent: readonly string[], indent: string): string[] {
	const shown = listed(subs);
	const rows = shown.map(s => ({s, label: subLabel(s), usage: usageTail(s.usage, [...parent, s.name], s)}));
	const labelW = Math.max(0, ...rows.map(r => stringCells(r.label)));
	const usageW = Math.max(0, ...rows.map(r => stringCells(r.usage)));
	const lines: string[] = [];
	for (const r of rows) {
		lines.push(`${indent}${pad(r.label, labelW)}  ${pad(r.usage, usageW)}  ${r.s.description}`.trimEnd());
		lines.push(...subLines(r.s.subs, [...parent, r.s.name], indent + '  '));
	}
	return lines;
}

export function argLabel(a: CatalogArg): string {
	return `${a.optional ? `[${a.name}]` : `<${a.name}>`}${a.repeatable ? '…' : ''}`;
}

export function optionLabel(o: CatalogOption): string {
	const head = o.value !== undefined ? `${o.name} ${o.value}` : o.name;
	return [head, ...o.aliases].join(', ') + (o.repeatable ? ' …' : '');
}

function table(rows: {label: string; description: string}[]): string[] {
	const w = Math.max(0, ...rows.map(r => stringCells(r.label)));
	return rows.map(r => `  ${pad(r.label, w)}  ${r.description}`.trimEnd());
}

function resolve(catalog: Catalog, path: readonly string[]): Resolved {
	const [name, ...rest] = path;
	const cmd = name === undefined ? undefined : catalog.byName.get(name);
	if (!cmd) return {error: unknownCommandLines(catalog, String(name))};
	let node: Node = cmd;
	const names = [cmd.name];
	for (const token of rest.slice(0, MAX_PATH)) {
		const subs: CatalogSub[] = node.subs;
		const sub = subs.find(s => s.name === token) ?? subs.find(s => s.aliases.includes(token));
		if (!sub) {
			const lines = [`Unknown subcommand: ${sanitizeToken(token)} (${names.join(' ')})`];
			const suggestion = nearestName(listed(subs).map(s => s.name), token);
			if (suggestion !== undefined) lines.push(`Did you mean: ${suggestion}?`);
			return {error: lines};
		}
		node = sub;
		names.push(sub.name);
	}
	return {node, names};
}

const cleanPath = (path: unknown): string[] =>
	Array.isArray(path) ? path.slice(0, MAX_PATH + 1).filter((p): p is string => typeof p === 'string') : [];

/** Why `helpLines` cannot describe the path (an unknown command or subcommand), as one message. */
export function helpError(catalog: Catalog, path: readonly string[]): string | undefined {
	const p = cleanPath(path);
	if (p.length === 0) return undefined;
	const r = resolve(catalog, p);
	return 'error' in r ? r.error.join('. ') : undefined;
}

function nodeLines(node: Node, names: readonly string[]): string[] {
	const lines = [`Usage: ${node.usage || names.join(' ')}`];
	if (node.description !== '') lines.push(node.description);
	if (node.args.length > 0) {
		lines.push('', 'Arguments:', ...table(node.args.map(a => ({label: argLabel(a), description: a.description}))));
	}
	if (node.options.length > 0) {
		lines.push('', 'Options:', ...table(node.options.map(o => ({label: optionLabel(o), description: o.description}))));
	}
	const subs = listed(node.subs);
	if (subs.length > 0) lines.push('', 'Subcommands:', ...subLines(node.subs, names, '  '));
	if (node.notes.length > 0) lines.push('', 'Notes:', ...node.notes.map(n => `  ${n}`));
	if (subs.length > 0) {
		const builtin = node.subs.some(s => s.builtin);
		const path = names.join(' ');
		lines.push('', builtin ? `${path} help <subcommand> shows details` : `help ${path} <subcommand> shows details`);
	}
	return lines;
}

/** Lines for `help` (empty path) or `help <command> [subcommand…]`; an unknown path yields its error lines. */
export function helpLines(catalog: Catalog, path: readonly string[] = []): string[] {
	const p = cleanPath(path);
	if (p.length === 0) {
		const w = Math.max(MIN_NAME_COLUMN, ...catalog.commands.map(c => stringCells(c.name)));
		return [
			...catalog.commands.map(c => `  ${pad(c.name, w)} ${c.description}`.trimEnd()),
			'help <command> [subcommand…] shows details',
		];
	}
	const r = resolve(catalog, p);
	if ('error' in r) return r.error;
	return nodeLines(r.node, r.names);
}
