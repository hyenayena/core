import type {StyledBlock, StyledSpan} from '../../../../src/api.js';
import type {Catalog, CatalogArg, CatalogCommand, CatalogOption, CatalogSub} from './catalog.js';
import {sanitizeToken} from './sanitize.js';
import {stringCells} from './width.js';
import {line, span} from '../kit/styled.js';
import {nearestName, unknownCommandLines} from './typo.js';

const MIN_NAME_COLUMN = 8;
const MAX_PATH = 8;

type Node = CatalogCommand | CatalogSub;

type Row = (string | StyledSpan)[];

type Resolved = {node: Node; names: string[]} | {error: string[]};

const fill = (s: string, cells: number): string => ' '.repeat(Math.max(0, cells - stringCells(s)));

const pad = (s: string, cells: number): string => s + fill(s, cells);

const accent = (text: string): StyledSpan => span(text, {tone: 'accent'});

const muted = (text: string): StyledSpan => span(text, {tone: 'muted'});

const bold = (text: string): StyledSpan => span(text, {bold: true});

function subLabel(sub: CatalogSub): string {
	return sub.aliases.length > 0 ? `${sub.name} (${sub.aliases.join(', ')})` : sub.name;
}

function usageTail(usage: string, names: readonly string[], sub: CatalogSub): string {
	const words = usage.trim().split(/\s+/).filter(Boolean);
	if (names.length > 0 && names.every((w, i) => words[i] === w)) return words.slice(names.length).join(' ');
	if (words[0] === sub.name || sub.aliases.includes(words[0] ?? '')) return words.slice(1).join(' ');
	return usage.trim();
}

const listed = (subs: readonly CatalogSub[]) => subs.filter(s => !s.builtin);

function subLines(subs: readonly CatalogSub[], parent: readonly string[], indent: string): Row[] {
	const shown = listed(subs);
	const rows = shown.map(s => ({s, label: subLabel(s), usage: usageTail(s.usage, [...parent, s.name], s)}));
	const labelW = Math.max(0, ...rows.map(r => stringCells(r.label)));
	const usageW = Math.max(0, ...rows.map(r => stringCells(r.usage)));
	const lines: Row[] = [];
	for (const r of rows) {
		lines.push([indent, accent(r.label), `${fill(r.label, labelW)}  `, r.usage, `${fill(r.usage, usageW)}  `, muted(r.s.description)]);
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

function table(rows: {label: string; description: string}[]): Row[] {
	const w = Math.max(0, ...rows.map(r => stringCells(r.label)));
	return rows.map(r => [`  ${pad(r.label, w)}  `, muted(r.description)]);
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

export function helpError(catalog: Catalog, path: readonly string[]): string | undefined {
	const p = cleanPath(path);
	if (p.length === 0) return undefined;
	const r = resolve(catalog, p);
	return 'error' in r ? r.error.join('. ') : undefined;
}

function nodeRows(node: Node, names: readonly string[]): Row[] {
	const rows: Row[] = [[bold('Usage:'), ' ', accent(node.usage || names.join(' '))]];
	if (node.description !== '') rows.push([node.description]);
	if (node.args.length > 0) {
		rows.push([], [bold('Arguments:')], ...table(node.args.map(a => ({label: argLabel(a), description: a.description}))));
	}
	if (node.options.length > 0) {
		rows.push([], [bold('Options:')], ...table(node.options.map(o => ({label: optionLabel(o), description: o.description}))));
	}
	const subs = listed(node.subs);
	if (subs.length > 0) rows.push([], [bold('Subcommands:')], ...subLines(node.subs, names, '  '));
	if (node.notes.length > 0) rows.push([], [bold('Notes:')], ...node.notes.map(n => [`  ${n}`]));
	if (subs.length > 0) {
		const builtin = node.subs.some(s => s.builtin);
		const path = names.join(' ');
		rows.push([], [muted(builtin ? `${path} help <subcommand> shows details` : `help ${path} <subcommand> shows details`)]);
	}
	return rows;
}

function helpRows(catalog: Catalog, path: readonly string[]): Row[] {
	const p = cleanPath(path);
	if (p.length === 0) {
		const w = Math.max(MIN_NAME_COLUMN, ...catalog.commands.map(c => stringCells(c.name)));
		return [
			...catalog.commands.map((c): Row => ['  ', accent(c.name), `${fill(c.name, w)} `, muted(c.description)]),
			[muted('help <command> [subcommand…] shows details')],
		];
	}
	const r = resolve(catalog, p);
	if ('error' in r) return r.error.map(l => [l]);
	return nodeRows(r.node, r.names);
}

const rowText = (row: Row): string => row.map(part => (typeof part === 'string' ? part : part.text)).join('').trimEnd();

export function helpLines(catalog: Catalog, path: readonly string[] = []): string[] {
	return helpRows(catalog, path).map(rowText);
}

export function helpBlocks(catalog: Catalog, path: readonly string[] = []): StyledBlock[] {
	return helpRows(catalog, path).map(row => line(...row));
}
