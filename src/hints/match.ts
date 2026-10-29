import {graphemes} from './width.js';

export type Match = {
	tier: 0 | 1 | 2 | 3 | 4;
	gap: number;
	ranges: Array<[number, number]>;
};

export type Ranked<T> = {item: T; match: Match; matchedName: string; index: number};

const MAX_UNITS = 64;
const SEPARATORS = new Set(['-', '_', '.', ':', '/']);

type Prepared = {orig: string[]; key: string[]};

function prepare(s: string): Prepared {
	let g: string[];
	try {
		g = graphemes(String(s).normalize('NFC')).slice(0, MAX_UNITS);
	} catch {
		g = [];
	}
	return {orig: g, key: g.map(x => x.toLowerCase())};
}

function equalAt(name: string[], at: number, q: string[]): boolean {
	if (at + q.length > name.length) return false;
	for (let k = 0; k < q.length; k++) if (name[at + k] !== q[k]) return false;
	return true;
}

function wordStarts(orig: string[]): number[] {
	const starts: number[] = [];
	for (let i = 0; i < orig.length; i++) {
		const cur = orig[i] as string;
		if (SEPARATORS.has(cur)) continue;
		if (i === 0) {
			starts.push(i);
			continue;
		}
		const prev = orig[i - 1] as string;
		const camel =
			prev === prev.toLowerCase() &&
			prev !== prev.toUpperCase() &&
			cur !== cur.toLowerCase();
		if (SEPARATORS.has(prev) || camel) starts.push(i);
	}
	return starts;
}

function mergeRuns(positions: number[]): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	for (const p of positions) {
		const last = ranges[ranges.length - 1];
		if (last && last[1] === p) last[1] = p + 1;
		else ranges.push([p, p + 1]);
	}
	return ranges;
}

export function matchName(query: string, name: string): Match | null {
	const q = prepare(query).key;
	const n = prepare(name);
	if (q.length === 0) return {tier: 1, gap: 0, ranges: []};
	if (n.key.length === 0 || q.length > n.key.length) return null;

	if (q.length === n.key.length && equalAt(n.key, 0, q)) {
		return {tier: 0, gap: 0, ranges: [[0, q.length]]};
	}
	if (equalAt(n.key, 0, q)) return {tier: 1, gap: 0, ranges: [[0, q.length]]};

	const starts = wordStarts(n.orig);
	for (const w of starts) {
		if (w > 0 && equalAt(n.key, w, q)) {
			return {tier: 2, gap: 0, ranges: [[w, w + q.length]]};
		}
	}
	if (q.length >= 2) {
		const hit: number[] = [];
		let si = 0;
		for (const ch of q) {
			while (si < starts.length && n.key[starts[si] as number] !== ch) si++;
			if (si >= starts.length) break;
			hit.push(starts[si] as number);
			si++;
		}
		if (hit.length === q.length) {
			const window = (hit[hit.length - 1] as number) + 1 - (hit[0] as number);
			return {
				tier: 2,
				gap: window - q.length,
				ranges: hit.map(p => [p, p + 1] as [number, number]),
			};
		}
	}

	for (let i = 1; i + q.length <= n.key.length; i++) {
		if (equalAt(n.key, i, q)) return {tier: 3, gap: 0, ranges: [[i, i + q.length]]};
	}

	let qi = 0;
	let end = -1;
	for (let i = 0; i < n.key.length; i++) {
		if (n.key[i] === q[qi]) {
			qi++;
			if (qi === q.length) {
				end = i;
				break;
			}
		}
	}
	if (end < 0) return null;
	const positions: number[] = [];
	qi = q.length - 1;
	for (let i = end; i >= 0 && qi >= 0; i--) {
		if (n.key[i] === q[qi]) {
			positions.push(i);
			qi--;
		}
	}
	positions.reverse();
	const window = end + 1 - (positions[0] as number);
	return {tier: 4, gap: window - q.length, ranges: mergeRuns(positions)};
}

function better(a: Match, aLen: number, b: Match, bLen: number): boolean {
	if (a.tier !== b.tier) return a.tier < b.tier;
	if (a.gap !== b.gap) return a.gap < b.gap;
	return aLen < bLen;
}

export function rank<T>(
	query: string,
	items: readonly T[],
	names: (t: T) => readonly string[],
): Ranked<T>[] {
	const emptyQuery = prepare(query).key.length === 0;
	const out: Ranked<T>[] = [];
	items.forEach((item, index) => {
		let list: readonly string[];
		try {
			list = names(item);
		} catch {
			return;
		}
		let best: {match: Match; name: string; len: number} | undefined;
		for (const name of list) {
			if (typeof name !== 'string') continue;
			const m = matchName(query, name);
			if (!m) continue;
			const len = prepare(name).key.length;
			if (!best || better(m, len, best.match, best.len)) best = {match: m, name, len};
		}
		if (best) out.push({item, match: best.match, matchedName: best.name, index});
	});
	const len = new Map<Ranked<T>, number>();
	if (!emptyQuery) for (const r of out) len.set(r, prepare(r.matchedName).key.length);
	out.sort((a, b) => {
		if (a.match.tier !== b.match.tier) return a.match.tier - b.match.tier;
		if (a.match.gap !== b.match.gap) return a.match.gap - b.match.gap;
		if (!emptyQuery) {
			const d = (len.get(a) as number) - (len.get(b) as number);
			if (d !== 0) return d;
		}
		return a.index - b.index;
	});
	return out;
}
