import {sanitizeBlock} from '../hints/sanitize.js';
import {stringCells, sliceCells, truncateCells} from '../hints/width.js';
import {TONE_THEME, type Tone} from './types.js';

export type Span = {text: string; tone?: Tone; bold?: boolean; inverse?: boolean};

export type SpanRow = Span[];

export type GridRow = {start: number; count: number; widths: number[]};

export type GridLayout = {perRow: number; rows: GridRow[]};

export type BoxHighlight = 'selected' | 'open';

export type BoxBadge = {word: string; tone: Tone};

export type BoxOptions = {
	width: number;
	height: number;
	title: SpanRow;
	meta?: string;
	footer?: string;
	body: SpanRow[];
	tone?: Tone;
	highlight?: BoxHighlight;
	badge?: BoxBadge;
};

export type FrameOptions = {title?: string; footer?: string; tone?: Tone};

const MAX_SPAN_CODE_UNITS = 2048;
const MIN_BOX_WIDTH = 8;
const MIN_BOX_HEIGHT = 3;
const MIN_TITLE_CELLS = 8;
const ELLIPSIS = '…';

const isTone = (t: unknown): t is Tone => typeof t === 'string' && Object.hasOwn(TONE_THEME, t);

const whole = (n: number, min: number): number => (Number.isFinite(n) ? Math.max(min, Math.floor(n)) : min);

export function cleanSpanText(text: unknown): string {
	if (typeof text !== 'string') return '';
	return sanitizeBlock(text.slice(0, MAX_SPAN_CODE_UNITS)).replace(/\n/g, ' ');
}

export function cleanRow(row: readonly Span[] | undefined): SpanRow {
	if (!Array.isArray(row)) return [];
	const out: SpanRow = [];
	for (const s of row) {
		if (typeof s !== 'object' || s === null) continue;
		const text = cleanSpanText(s.text);
		if (text === '') continue;
		out.push({text, ...(isTone(s.tone) && {tone: s.tone}), ...(s.bold === true && {bold: true}), ...(s.inverse === true && {inverse: true})});
	}
	return out;
}

export const rowCells = (row: readonly Span[]): number => row.reduce((n, s) => n + stringCells(s.text), 0);

function fitRow(row: SpanRow, max: number): SpanRow {
	if (max <= 0) return [];
	if (rowCells(row) <= max) return row;
	const budget = max - stringCells(ELLIPSIS);
	const out: SpanRow = [];
	let used = 0;
	for (const s of row) {
		const cells = stringCells(s.text);
		if (used + cells <= budget) {
			out.push(s);
			used += cells;
			continue;
		}
		const part = sliceCells(s.text, 0, budget - used);
		out.push({...s, text: part + ELLIPSIS});
		return out;
	}
	return out;
}

function exactRow(row: SpanRow, width: number): SpanRow {
	const fitted = fitRow(row, width);
	const gap = width - rowCells(fitted);
	return gap > 0 ? [...fitted, {text: ' '.repeat(gap)}] : fitted;
}

export function gridLayout({count, width, minBoxWidth}: {count: number; width: number; minBoxWidth: number}): GridLayout {
	const n = whole(count, 0);
	const w = whole(width, 1);
	if (n === 0) return {perRow: 0, rows: []};
	const perRow = Math.max(1, Math.min(n, Math.floor(w / whole(minBoxWidth, 1))));
	const rows: GridRow[] = [];
	for (let start = 0; start < n; start += perRow) {
		const k = Math.min(perRow, n - start);
		const base = Math.floor(w / k);
		const extra = w - base * k;
		rows.push({start, count: k, widths: Array.from({length: k}, (_, i) => base + (i < extra ? 1 : 0))});
	}
	return {perRow, rows};
}

export function badgeRows(word: string, badgeTone: Tone, maxWidth: number, maxHeight: number): SpanRow[] {
	const tone = isTone(badgeTone) ? badgeTone : 'plain';
	const text = cleanSpanText(word).trim();
	const w = Math.floor(maxWidth);
	const h = Math.floor(maxHeight);
	if (text === '' || !(w > 0) || !(h > 0)) return [];
	const cells = stringCells(text);
	const frame: Span = {text: '', tone};
	const label: Span = {text, tone, bold: true};
	if (cells + 4 <= w && h >= 3) {
		const rule = '─'.repeat(cells + 2);
		return [
			[{...frame, text: `┌${rule}┐`}],
			[{...frame, text: '│ '}, label, {...frame, text: ' │'}],
			[{...frame, text: `└${rule}┘`}],
		];
	}
	if (cells + 4 <= w) return [[{...frame, text: '[ '}, label, {...frame, text: ' ]'}]];
	return [[{...label, text: truncateCells(text, w)}]];
}

function topBorder(width: number, title: SpanRow, meta: string, border: Span): SpanRow {
	const inner = width - 2;
	const metaCells = stringCells(meta);
	const titleCells = rowCells(title);
	const titleRoom = (withMeta: boolean) => inner - 3 - (withMeta ? metaCells + 2 : 0);
	let withMeta = metaCells > 0;
	if (withMeta && titleCells > 0 && titleRoom(true) < Math.min(titleCells, MIN_TITLE_CELLS)) withMeta = false;
	if (withMeta && titleCells === 0 && metaCells + 3 > inner) withMeta = false;
	const shown = titleCells > 0 ? fitRow(title, titleRoom(withMeta)) : [];
	const shownCells = rowCells(shown);
	const dashes = inner - (shownCells > 0 ? shownCells + 2 : 0) - (withMeta ? metaCells + 2 : 0);
	const out: SpanRow = [{...border, text: shownCells > 0 ? '╭ ' : '╭'}, ...shown];
	out.push({...border, text: `${shownCells > 0 ? ' ' : ''}${'─'.repeat(Math.max(0, dashes))}${withMeta ? ' ' : ''}`});
	if (withMeta) out.push({...border, text: meta});
	out.push({...border, text: withMeta ? ' ╮' : '╮'});
	return out;
}

function bottomBorder(width: number, footer: string, border: Span): SpanRow {
	const inner = width - 2;
	const room = inner - 4;
	const shown = room > 0 ? truncateCells(footer, room) : '';
	if (shown === '') return [{...border, text: `╰${'─'.repeat(inner)}╯`}];
	const dashes = inner - 3 - stringCells(shown);
	return [{...border, text: `╰─ ${shown} ${'─'.repeat(dashes)}╯`}];
}

export function boxRows(options: BoxOptions): SpanRow[] {
	const width = whole(options.width, MIN_BOX_WIDTH);
	const height = whole(options.height, MIN_BOX_HEIGHT);
	const highlighted = options.highlight === 'selected' || options.highlight === 'open';
	const border: Span = highlighted ? {text: '', tone: 'info', bold: true} : {text: '', ...(isTone(options.tone) && {tone: options.tone})};
	let title = cleanRow(options.title);
	if (options.highlight === 'open') title = title.map(s => ({...s, inverse: true}));
	const meta = cleanSpanText(options.meta).trim();
	const footer = cleanSpanText(options.footer).trim();
	const innerWidth = width - 4;
	const bodyHeight = height - 2;
	let body: SpanRow[];
	if (options.badge) {
		const badge = badgeRows(options.badge.word, options.badge.tone, innerWidth, bodyHeight);
		const top = Math.floor((bodyHeight - badge.length) / 2);
		body = Array.from({length: bodyHeight}, (_, i) => {
			const row = badge[i - top];
			if (!row) return [];
			const left = Math.floor((innerWidth - rowCells(row)) / 2);
			return left > 0 ? [{text: ' '.repeat(left)}, ...row] : row;
		});
	} else {
		const source = Array.isArray(options.body) ? options.body : [];
		body = Array.from({length: bodyHeight}, (_, i) => cleanRow(source[i]));
	}
	return [
		topBorder(width, title, meta, border),
		...body.map(row => [{...border, text: '│ '}, ...exactRow(row, innerWidth), {...border, text: ' │'}]),
		bottomBorder(width, footer, border),
	];
}

export function frameAround(rows: SpanRow[], width: number, options: FrameOptions = {}): SpanRow[] {
	const w = whole(width, 2);
	const inner = w - 2;
	const border: Span = {text: '', ...(isTone(options.tone) && {tone: options.tone})};
	const title = cleanSpanText(options.title).trim();
	const footer = cleanSpanText(options.footer).trim();
	const edge = (left: string, right: string, label: string): SpanRow => {
		const room = inner - 4;
		const shown = room > 0 ? truncateCells(label, room) : '';
		if (shown === '') return [{...border, text: `${left}${'─'.repeat(inner)}${right}`}];
		return [{...border, text: `${left}─ ${shown} ${'─'.repeat(inner - 3 - stringCells(shown))}${right}`}];
	};
	const body = (Array.isArray(rows) ? rows : []).map(row => [{...border, text: '│'}, ...exactRow(cleanRow(row), inner), {...border, text: '│'}]);
	return [edge('╭', '╮', title), ...body, edge('╰', '╯', footer)];
}

export function joinBlocks(blocks: SpanRow[][], widths: number[]): SpanRow[] {
	const list = Array.isArray(blocks) ? blocks : [];
	const height = list.reduce((n, b) => Math.max(n, Array.isArray(b) ? b.length : 0), 0);
	return Array.from({length: height}, (_, r) =>
		list.flatMap((block, i) => {
			const w = whole(widths[i] ?? 0, 0);
			return exactRow(cleanRow(Array.isArray(block) ? block[r] : undefined), w);
		}),
	);
}
