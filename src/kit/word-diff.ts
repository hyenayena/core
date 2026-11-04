export type Range = {readonly from: number; readonly to: number};

export const WORD_DIFF_MAX_CHARS = 400;
export const WORD_DIFF_MAX_TOKENS = 120;
export const WORD_DIFF_MAX_RUN = 32;
export const WORD_DIFF_MIN_SIMILARITY = 0.4;

const WORD = /[\p{L}\p{N}_]/u;

export function tokenizeWords(line: string): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < line.length) {
		const cp = line.codePointAt(i)!;
		const ch = String.fromCodePoint(cp);
		let j = i + ch.length;
		if (WORD.test(ch)) {
			while (j < line.length) {
				const c = String.fromCodePoint(line.codePointAt(j)!);
				if (!WORD.test(c)) break;
				j += c.length;
			}
		} else if (/\s/.test(ch)) {
			while (j < line.length && /\s/.test(line[j]!)) j++;
		}
		out.push(line.slice(i, j));
		i = j;
	}
	return out;
}

function changedRanges(tokens: readonly string[], keep: readonly boolean[]): Range[] {
	const out: Range[] = [];
	const text = tokens.join('');
	let pos = 0;
	tokens.forEach((t, i) => {
		const end = pos + t.length;
		if (!keep[i]) {
			const last = out[out.length - 1];
			if (last !== undefined && /^\s*$/.test(text.slice(last.to, pos))) out[out.length - 1] = {from: last.from, to: end};
			else out.push({from: pos, to: end});
		}
		pos = end;
	});
	return out;
}

export function wordDiff(a: string, b: string): {a: Range[]; b: Range[]} | undefined {
	if (a.length > WORD_DIFF_MAX_CHARS || b.length > WORD_DIFF_MAX_CHARS) return undefined;
	const ta = tokenizeWords(a);
	const tb = tokenizeWords(b);
	if (ta.length > WORD_DIFF_MAX_TOKENS || tb.length > WORD_DIFF_MAX_TOKENS) return undefined;
	const n = ta.length;
	const m = tb.length;
	const w = m + 1;
	const table = new Uint16Array((n + 1) * w);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i * w + j] = ta[i] === tb[j] ? table[(i + 1) * w + j + 1]! + 1 : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!);
		}
	}
	const keepA = new Array<boolean>(n).fill(false);
	const keepB = new Array<boolean>(m).fill(false);
	let kept = 0;
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (ta[i] === tb[j]) {
			keepA[i] = keepB[j] = true;
			kept += ta[i]!.length;
			i++;
			j++;
		} else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) i++;
		else j++;
	}
	const longest = Math.max(a.length, b.length);
	if (longest === 0 || kept / longest < WORD_DIFF_MIN_SIMILARITY) return undefined;
	return {a: changedRanges(ta, keepA), b: changedRanges(tb, keepB)};
}

// A del run directly followed by an add run pairs i-th with i-th; runs over the cap pair nothing.
export function pairRuns(kinds: readonly ('ctx' | 'add' | 'del')[]): [number, number][] {
	const pairs: [number, number][] = [];
	let i = 0;
	while (i < kinds.length) {
		if (kinds[i] !== 'del') {
			i++;
			continue;
		}
		const delStart = i;
		while (i < kinds.length && kinds[i] === 'del') i++;
		const addStart = i;
		while (i < kinds.length && kinds[i] === 'add') i++;
		const dels = addStart - delStart;
		const adds = i - addStart;
		if (adds === 0 || dels > WORD_DIFF_MAX_RUN || adds > WORD_DIFF_MAX_RUN) continue;
		for (let k = 0; k < Math.min(dels, adds); k++) pairs.push([delStart + k, addStart + k]);
	}
	return pairs;
}
