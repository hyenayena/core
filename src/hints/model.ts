import type {Catalog, CatalogCommand, CatalogSub} from './catalog.js';
import {rank} from './match.js';
import {graphemes} from './width.js';
import {currentPlaceholder, parseUsage, type UsageToken} from './usage.js';

export type UsageLine = {
	// Text shown plain before the tokens (the command path, or the whole usage when it could not be parsed)
	head: string;
	tokens: UsageToken[];
	// Index into `tokens` of the argument slot to emphasise, or -1
	active: number;
};

export type HintItem = {
	insert: string;
	label: string;
	// Canonical name when `label` is an alias
	via?: string;
	description: string;
	// Grapheme ranges of `label` that matched the typed token
	ranges: Array<[number, number]>;
	// `insert` extends the typed token as a case-insensitive prefix (ghost-capable)
	prefix: boolean;
	usage?: UsageLine;
};

export type HintStage = 'none' | 'command' | 'sub' | 'arg';

export type HintResult = {
	stage: HintStage;
	tokenStart: number;
	token: string;
	items: HintItem[];
	usage?: UsageLine;
	unknown?: boolean;
};

const MAX_TOKENS = 64;
const NONE: HintResult = {stage: 'none', tokenStart: 0, token: '', items: []};

type Tok = {text: string; start: number; end: number};

const isSpace = (ch: string) => /\s/u.test(ch);

function tokenize(line: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	while (i < line.length && out.length < MAX_TOKENS) {
		while (i < line.length && isSpace(line[i] as string)) i++;
		if (i >= line.length) break;
		const start = i;
		while (i < line.length && !isSpace(line[i] as string)) i++;
		out.push({text: line.slice(start, i), start, end: i});
	}
	return out;
}

export function isPrefixCI(token: string, insert: string): boolean {
	const t = graphemes(token);
	const n = graphemes(insert);
	if (t.length === 0 || t.length > n.length) return false;
	for (let i = 0; i < t.length; i++) {
		if ((t[i] as string).toLowerCase() !== (n[i] as string).toLowerCase()) return false;
	}
	return true;
}

function buildUsage(
	usage: string | undefined,
	path: string[],
	typedPath: string[],
	typedArgs: string[] | undefined,
	endsWithSpace: boolean,
): UsageLine | undefined {
	// A synthesised name adds nothing to the command shown next to it
	if (!usage || usage.trim() === '') return undefined;
	const text = usage.trim();
	const words = text.split(/\s+/).filter(Boolean);
	const matches = (p: string[]) => p.length > 0 && p.every((w, i) => words[i] === w);
	if (!matches(path) && !matches(typedPath)) return {head: text, tokens: [], active: -1};
	const tokens = parseUsage(text, path.length);
	const active = typedArgs ? currentPlaceholder(tokens, typedArgs, endsWithSpace) : -1;
	return {head: words.slice(0, path.length).join(' '), tokens, active};
}

function optionalUsage(u: UsageLine | undefined): {usage?: UsageLine} {
	return u ? {usage: u} : {};
}

function itemsFor<T extends {name: string; description: string}>(
	token: string,
	nodes: readonly T[],
	namesOf: (n: T) => readonly string[],
	usageOf: (n: T) => UsageLine | undefined,
): HintItem[] {
	return rank(token, nodes, namesOf).map(r => {
		const item: HintItem = {
			insert: r.matchedName,
			label: r.matchedName,
			description: r.item.description,
			ranges: r.match.ranges.map(([a, b]) => [a, b] as [number, number]),
			prefix: isPrefixCI(token, r.matchedName),
		};
		if (r.matchedName !== r.item.name) item.via = r.item.name;
		const usage = usageOf(r.item);
		if (usage) item.usage = usage;
		return item;
	});
}

/** Analyses a line whose cursor is at its end; never throws. */
export function computeHints(catalog: Catalog, line: string): HintResult {
	try {
		return analyse(catalog, line);
	} catch {
		return NONE;
	}
}

function analyse(catalog: Catalog, line: string): HintResult {
	if (typeof line !== 'string' || line.trim() === '') return NONE;
	const toks = tokenize(line);
	const endsWithSpace = isSpace(line[line.length - 1] as string);
	const complete = endsWithSpace ? toks : toks.slice(0, -1);
	const cur: Tok = endsWithSpace
		? {text: '', start: line.length, end: line.length}
		: (toks[toks.length - 1] as Tok);

	if (complete.length === 0) {
		const items = itemsFor<CatalogCommand>(
			cur.text,
			catalog.commands,
			c => [c.name],
			c => buildUsage(c.usage, [c.name], [c.name], undefined, false),
		);
		const result: HintResult = {stage: 'command', tokenStart: cur.start, token: cur.text, items};
		if (items.length === 0) result.unknown = true;
		return result;
	}

	const command = catalog.byName.get((complete[0] as Tok).text);
	if (!command) return NONE;

	const path = [command.name];
	const typedPath = [command.name];
	let usage = command.usage;
	let subs: CatalogSub[] = command.subs;
	let consumed = 1;
	for (; consumed < complete.length; consumed++) {
		const word = (complete[consumed] as Tok).text;
		const sub = subs.find(s => s.name === word || s.aliases.includes(word));
		if (!sub) break;
		path.push(sub.name);
		typedPath.push(word);
		usage = sub.usage;
		subs = sub.subs;
	}
	const argsConsumed = consumed < complete.length;
	const nodeUsage = (typed: string[] | undefined) =>
		buildUsage(usage, path, typedPath, typed, endsWithSpace);

	if (!argsConsumed && subs.length > 0) {
		const items = itemsFor<CatalogSub>(
			cur.text,
			subs,
			s => (cur.text === '' ? [s.name] : [s.name, ...s.aliases]),
			() => undefined,
		);
		if (items.length > 0 || cur.text === '') {
			return {
				stage: 'sub',
				tokenStart: cur.start,
				token: cur.text,
				items,
				...optionalUsage(nodeUsage(undefined)),
			};
		}
	}

	const typedArgs = [...complete.slice(consumed).map(t => t.text), ...(endsWithSpace ? [] : [cur.text])];
	return {
		stage: 'arg',
		tokenStart: cur.start,
		token: cur.text,
		items: [],
		...optionalUsage(nodeUsage(typedArgs)),
	};
}

export function acceptEdit(
	line: string,
	hint: HintResult,
	item: HintItem,
): {value: string; cursor: number} {
	const start = Math.min(Math.max(0, hint.tokenStart), line.length);
	const end = Math.min(line.length, start + hint.token.length);
	const rest = line.slice(end);
	const spaced = /^\s/u.test(rest) ? rest : ' ' + rest;
	const head = line.slice(0, start) + item.insert;
	return {value: head + spaced, cursor: head.length + 1};
}
