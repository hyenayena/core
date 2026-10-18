import {graphemes} from './width.js';

const ESC = 0x1b;
const BEL = 0x07;
const ST_C1 = 0x9c;

const STRING_INTRODUCERS = new Set([0x5d, 0x50, 0x5f, 0x5e, 0x58]); // ] P _ ^ X
const C1_STRING_INTRODUCERS = new Set([0x9d, 0x90, 0x9f, 0x9e, 0x98]);

function isInvisible(c: number): boolean {
	return (
		(c >= 0x202a && c <= 0x202e) ||
		(c >= 0x2066 && c <= 0x2069) ||
		c === 0x200e ||
		c === 0x200f ||
		c === 0x061c ||
		(c >= 0x200b && c <= 0x200d) ||
		(c >= 0x2060 && c <= 0x2064) ||
		c === 0xfeff ||
		c === 0x00ad ||
		(c >= 0xfff9 && c <= 0xfffb)
	);
}

function skipCsi(s: string, i: number): number {
	let j = i;
	while (j < s.length && s.charCodeAt(j) >= 0x30 && s.charCodeAt(j) <= 0x3f) j++;
	while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f) j++;
	if (j < s.length && s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e) j++;
	return j;
}

// An unterminated string sequence consumes the remainder.
function skipString(s: string, i: number): number {
	for (let j = i; j < s.length; j++) {
		const c = s.charCodeAt(j);
		if (c === BEL || c === ST_C1) return j + 1;
		if (c === ESC && s.charCodeAt(j + 1) === 0x5c) return j + 2;
	}
	return s.length;
}

/** Linear single-pass removal of escape sequences and unsafe characters. */
function clean(s: string): string {
	const out: string[] = [];
	let i = 0;
	while (i < s.length) {
		const c = s.charCodeAt(i);
		if (c === ESC) {
			const n = s.charCodeAt(i + 1);
			if (i + 1 >= s.length) {
				i++;
			} else if (n === 0x5b) {
				i = skipCsi(s, i + 2);
			} else if (STRING_INTRODUCERS.has(n)) {
				i = skipString(s, i + 2);
			} else if (n >= 0x20 && n <= 0x2f) {
				let j = i + 1;
				while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f) j++;
				i = j < s.length ? j + 1 : j;
			} else {
				i += 2;
			}
			continue;
		}
		if (c === 0x9b) {
			i = skipCsi(s, i + 1);
			continue;
		}
		if (C1_STRING_INTRODUCERS.has(c)) {
			i = skipString(s, i + 1);
			continue;
		}
		if (c === 0x09 || c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029) {
			out.push(' ');
			i++;
			continue;
		}
		if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || isInvisible(c)) {
			i++;
			continue;
		}
		if (c >= 0xd800 && c <= 0xdbff) {
			const d = s.charCodeAt(i + 1);
			if (d >= 0xdc00 && d <= 0xdfff) {
				out.push(s.slice(i, i + 2));
				i += 2;
			} else {
				out.push('�');
				i++;
			}
			continue;
		}
		if (c >= 0xdc00 && c <= 0xdfff) {
			out.push('�');
			i++;
			continue;
		}
		out.push(s[i] as string);
		i++;
	}
	return out.join('');
}

// Tag characters are astral, so the code-unit scan above cannot see them.
function stripTags(s: string): string {
	let out = '';
	for (const ch of s) {
		const cp = ch.codePointAt(0) as number;
		if (cp >= 0xe0000 && cp <= 0xe007f) continue;
		out += ch;
	}
	return out;
}

/** Makes untrusted text safe to render on one terminal line; never throws. */
export function sanitizeText(input: unknown, maxCodePoints: number): string {
	if (typeof input !== 'string') return '';
	const max = Math.floor(maxCodePoints);
	if (!(max > 0)) return '';
	let s: string;
	try {
		s = stripTags(clean(input.slice(0, max * 4)));
		s = s.replace(/ {2,}/g, ' ').trim();
		if (Array.from(s).length <= max) return s;
		const parts = graphemes(s);
		let out = '';
		let count = 0;
		for (const g of parts) {
			const n = Array.from(g).length;
			if (count + n > max - 1) break;
			out += g;
			count += n;
		}
		return out + '…';
	} catch {
		return '';
	}
}

export function sanitizeToken(s: string, max = 40): string {
	return sanitizeText(s, max);
}
