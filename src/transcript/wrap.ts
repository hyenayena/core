import {cellWidth, graphemes, stringCells} from '../hints/width.js';

const ESC = '\\u001b';
const BEL = '\\u0007';
const TOKEN = new RegExp(
	`${ESC}\\[[0-9;:]{0,64}m|${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
	'g',
);
const SGR = new RegExp(`^${ESC}\\[([0-9;:]{0,64})m$`);
const RESET = String.fromCharCode(27) + '[0m';
const MAX_CARRY = 32;

export function styledCells(text: string): number {
	if (typeof text !== 'string' || text === '') return 0;
	return stringCells(text.replace(TOKEN, ''));
}

export function stripStyles(text: string): string {
	return typeof text === 'string' ? text.replace(TOKEN, '') : '';
}

export function sliceStyledCells(text: string, from: number, to: number): string {
	if (typeof text !== 'string' || text === '' || !(to > from)) return '';
	let out = '';
	let cells = 0;
	let styled = false;
	let last = 0;
	const add = (part: string) => {
		for (const g of graphemes(part)) {
			const w = cellWidth(g);
			if (cells >= from && cells + w <= to) out += g;
			cells += w;
		}
	};
	for (const m of text.matchAll(TOKEN)) {
		add(text.slice(last, m.index));
		if (SGR.test(m[0])) {
			out += m[0];
			styled = true;
		}
		last = m.index + m[0].length;
	}
	add(text.slice(last));
	return styled ? out + RESET : out;
}

type Piece = {s: string; w: number; space: boolean; sgr: boolean};

function applySgr(active: string[], seq: string): string[] {
	const params = SGR.exec(seq)![1]!;
	if (/^0*$/.test(params)) return [];
	const next = [...active, seq];
	return next.length > MAX_CARRY ? next.slice(next.length - MAX_CARRY) : next;
}

function activeAfter(start: string[], pieces: Piece[]): string[] {
	let active = start;
	for (const p of pieces) if (p.sgr) active = applySgr(active, p.s);
	return active;
}

export type WrapOptions = {
	mode?: 'word' | 'char';
};

export function wrapRows(text: string, width: number, options: WrapOptions = {}): string[] {
	const charMode = options.mode === 'char';
	if (typeof text !== 'string' || text === '') return [''];
	const max = Number.isFinite(width) && width >= 1 ? Math.floor(width) : 1;
	const rows: string[] = [];
	let start: string[] = [];
	let pieces: Piece[] = [];
	let cells = 0;
	let breakAt = -1;
	let seenVisible = false;

	const emit = (row: Piece[], rowStart: string[]): string[] => {
		const end = activeAfter(rowStart, row);
		rows.push(row.length === 0 ? '' : rowStart.join('') + row.map(p => p.s).join('') + (end.length > 0 ? RESET : ''));
		return end;
	};
	const reset = (next: string[], rest: Piece[] = []) => {
		start = next;
		pieces = rest;
		cells = 0;
		breakAt = -1;
		seenVisible = false;
		for (const p of rest) {
			cells += p.w;
			if (p.w > 0 && !p.space) seenVisible = true;
		}
	};
	const newline = () => reset(emit(pieces, start));

	const addGrapheme = (g: string) => {
		if (g === '\n' || g === '\r\n') {
			newline();
			return;
		}
		if (g === '\r') return;
		const w = cellWidth(g);
		const space = g === ' ';
		if (charMode) {
			if (cells + w > max && cells > 0) newline();
			pieces.push({s: g, w, space: false, sgr: false});
			cells += w;
			return;
		}
		if (cells + w > max) {
			if (space) {
				newline();
				return;
			}
			if (breakAt > 0) {
				const head = pieces.slice(0, breakAt);
				const tail = pieces.slice(breakAt);
				reset(emit(head, start), tail);
			} else if (cells > 0) {
				newline();
			}
		}
		pieces.push({s: g, w, space, sgr: false});
		cells += w;
		if (space && seenVisible) breakAt = pieces.length;
		if (w > 0 && !space) seenVisible = true;
	};

	let last = 0;
	for (const m of text.matchAll(TOKEN)) {
		for (const g of graphemes(text.slice(last, m.index))) addGrapheme(g);
		pieces.push({s: m[0], w: 0, space: false, sgr: SGR.test(m[0])});
		last = m.index + m[0].length;
	}
	for (const g of graphemes(text.slice(last))) addGrapheme(g);
	emit(pieces, start);
	return rows;
}

export function wrapLines(lines: readonly string[], width: number, options: WrapOptions = {}): string[] {
	return lines.flatMap(line => wrapRows(line, width, options));
}
