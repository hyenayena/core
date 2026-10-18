import type {Catalog} from './catalog.js';
import {sanitizeToken} from './sanitize.js';

const MAX_UNITS = 64;

function codePoints(s: string): string[] {
	return Array.from(String(s).slice(0, MAX_UNITS * 4).normalize('NFC').toLowerCase()).slice(0, MAX_UNITS);
}

/** Optimal string alignment distance (Levenshtein plus adjacent transposition). */
function distance(a: string[], b: string[]): number {
	const w = b.length + 1;
	const d: number[] = new Array((a.length + 1) * w).fill(0);
	for (let i = 0; i <= a.length; i++) d[i * w] = i;
	for (let j = 0; j <= b.length; j++) d[j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let v = Math.min(
				(d[(i - 1) * w + j] as number) + 1,
				(d[i * w + j - 1] as number) + 1,
				(d[(i - 1) * w + j - 1] as number) + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				v = Math.min(v, (d[(i - 2) * w + j - 2] as number) + 1);
			}
			d[i * w + j] = v;
		}
	}
	return d[a.length * w + b.length] as number;
}

/** The single best command name for a mistyped token, if any is close enough. */
export function nearest(catalog: Catalog, typed: string): string | undefined {
	try {
		const t = codePoints(typed);
		if (t.length === 0) return undefined;
		const limit = t.length <= 4 ? 1 : 2;
		let best: {name: string; dist: number; prefix: boolean} | undefined;
		for (const cmd of catalog.commands) {
			const n = codePoints(cmd.name);
			const dist = distance(t, n);
			const prefix = t.length >= 2 && t.length <= n.length && t.every((ch, i) => n[i] === ch);
			if (dist > limit && !prefix) continue;
			if (
				!best ||
				dist < best.dist ||
				(dist === best.dist && prefix && !best.prefix)
			) {
				best = {name: cmd.name, dist, prefix};
			}
		}
		return best?.name;
	} catch {
		return undefined;
	}
}

export function unknownCommandLines(catalog: Catalog, token: string): string[] {
	const lines = [`Unknown command: ${sanitizeToken(token)}`];
	const suggestion = nearest(catalog, token);
	if (suggestion !== undefined) lines.push(`Did you mean: ${suggestion}?`);
	return lines;
}
