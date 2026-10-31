import type {SpanTone, StyledBlock, StyledCell, StyledSpan} from '../../../../src/api.js';
import {sanitizeBlock, sanitizeText} from '../hints/sanitize.js';
import {graphemes, sliceCells, stringCells} from '../hints/width.js';

export const TONE_SGR: Readonly<Record<SpanTone, string>> = Object.freeze({accent: '36', muted: '2', ok: '32', warn: '33', error: '31'});

export const MAX_STYLED_BLOCKS = 1000;
export const MAX_TABLE_ROWS = 5000;
export const MAX_ROW_CELLS = 16;
export const MAX_SPANS = 64;
export const MAX_SPAN_CODE_POINTS = 4096;
const MAX_HEAD_CODE_POINTS = 200;
const GAP = 2;
const MIN_FLEX = 8;

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;

export type NormalSpan = {readonly text: string; readonly tone?: SpanTone; readonly bold?: true; readonly decor?: true};
export type NormalCell = readonly NormalSpan[];
export type NormalBlock =
	| {readonly kind: 'line'; readonly spans: readonly NormalSpan[]; readonly decor: boolean}
	| {readonly kind: 'rule'}
	| {readonly kind: 'table'; readonly head?: readonly string[]; readonly rows: readonly (readonly NormalCell[])[]; readonly flex?: number}
	| {readonly kind: 'text'; readonly text: string; readonly tone?: SpanTone};
export type NormalStyled = readonly NormalBlock[];

type SpanOptions = {tone?: SpanTone; bold?: boolean; decor?: boolean};

export function span(text: string, options: SpanOptions = {}): StyledSpan {
	return {
		text,
		...(options.tone !== undefined && {tone: options.tone}),
		...(options.bold === true && {bold: true}),
		...(options.decor === true && {decor: true}),
	};
}

export const line = (...parts: (string | StyledSpan)[]): StyledBlock => ({kind: 'line', spans: parts});

export const decorLine = (...parts: (string | StyledSpan)[]): StyledBlock => ({kind: 'line', spans: parts, decor: true});

export const rule = (): StyledBlock => ({kind: 'rule'});

export function table(rows: readonly (readonly StyledCell[])[], options: {head?: readonly string[]; flex?: number} = {}): StyledBlock {
	return {kind: 'table', rows, ...(options.head !== undefined && {head: options.head}), ...(options.flex !== undefined && {flex: options.flex})};
}

export const textBlock = (text: string, tone?: SpanTone): StyledBlock => ({kind: 'text', text, ...(tone !== undefined && {tone})});

const TONES: ReadonlySet<string> = new Set(Object.keys(TONE_SGR));

const toneOf = (v: unknown): SpanTone | undefined => (typeof v === 'string' && TONES.has(v) ? (v as SpanTone) : undefined);

function capCodePoints(s: string, max: number): string {
	if (Array.from(s).length <= max) return s;
	let out = '';
	let count = 0;
	for (const g of graphemes(s)) {
		const n = Array.from(g).length;
		if (count + n > max - 1) break;
		out += g;
		count += n;
	}
	return `${out}…`;
}

function spanText(v: unknown): string {
	if (typeof v !== 'string') return '';
	return capCodePoints(sanitizeBlock(v.slice(0, MAX_SPAN_CODE_POINTS * 4)).replace(/\n/g, ' '), MAX_SPAN_CODE_POINTS);
}

function normSpan(v: unknown): NormalSpan | undefined {
	if (typeof v === 'string') {
		const text = spanText(v);
		return text === '' ? undefined : Object.freeze({text});
	}
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
	const s = v as Record<string, unknown>;
	const text = spanText(s['text']);
	if (text === '') return undefined;
	const tone = toneOf(s['tone']);
	return Object.freeze({
		text,
		...(tone !== undefined && {tone}),
		...(s['bold'] === true && {bold: true as const}),
		...(s['decor'] === true && {decor: true as const}),
	});
}

function normSpans(items: readonly unknown[]): NormalSpan[] {
	const out: NormalSpan[] = [];
	const n = Math.min(items.length, MAX_SPANS);
	for (let i = 0; i < n; i++) {
		const s = normSpan(items[i]);
		if (s) out.push(s);
	}
	return out;
}

const normCell = (v: unknown): NormalCell => Object.freeze(Array.isArray(v) ? normSpans(v) : normSpans([v]));

function normRows(v: readonly unknown[]): (readonly NormalCell[])[] {
	const rows: (readonly NormalCell[])[] = [];
	const n = Math.min(v.length, MAX_TABLE_ROWS);
	for (let i = 0; i < n; i++) {
		const row = v[i];
		if (!Array.isArray(row)) continue;
		const cells: NormalCell[] = [];
		const m = Math.min(row.length, MAX_ROW_CELLS);
		for (let j = 0; j < m; j++) cells.push(normCell(row[j]));
		rows.push(Object.freeze(cells));
	}
	return rows;
}

function normBlock(v: unknown): NormalBlock | undefined {
	if (typeof v !== 'object' || v === null) return undefined;
	const b = v as Record<string, unknown>;
	switch (b['kind']) {
		case 'line': {
			const spans = b['spans'];
			if (!Array.isArray(spans)) return undefined;
			return {kind: 'line', spans: Object.freeze(normSpans(spans)), decor: b['decor'] === true};
		}
		case 'rule':
			return {kind: 'rule'};
		case 'table': {
			const rows = b['rows'];
			if (!Array.isArray(rows)) return undefined;
			const head = b['head'];
			const flex = b['flex'];
			return {
				kind: 'table',
				rows: Object.freeze(normRows(rows)),
				...(Array.isArray(head) && {head: Object.freeze(head.slice(0, MAX_ROW_CELLS).map(h => sanitizeText(h, MAX_HEAD_CODE_POINTS)))}),
				...(typeof flex === 'number' && Number.isInteger(flex) && flex >= 0 && flex < MAX_ROW_CELLS && {flex}),
			};
		}
		case 'text': {
			const text = b['text'];
			if (typeof text !== 'string') return undefined;
			const tone = toneOf(b['tone']);
			return {kind: 'text', text: sanitizeBlock(text), ...(tone !== undefined && {tone})};
		}
		default:
			return undefined;
	}
}

const normalized = new WeakSet<object>();

export function normalizeStyled(input: unknown): NormalStyled {
	if (typeof input === 'object' && input !== null && normalized.has(input)) return input as NormalStyled;
	const out: NormalBlock[] = [];
	try {
		if (Array.isArray(input)) {
			const n = Math.min(input.length, MAX_STYLED_BLOCKS);
			for (let i = 0; i < n; i++) {
				try {
					const b = normBlock(input[i]);
					if (b) out.push(Object.freeze(b));
				} catch {}
			}
		}
	} catch {}
	const result = Object.freeze(out);
	normalized.add(result);
	return result;
}

const plainOf = (spans: readonly NormalSpan[]): string => spans.filter(s => !s.decor).map(s => s.text).join('');

const trimEnd = (s: string): string => s.replace(/ +$/, '');

export function plainLines(blocks: unknown): string[] {
	const out: string[] = [];
	for (const b of normalizeStyled(blocks)) {
		switch (b.kind) {
			case 'line':
				if (b.decor || (b.spans.length > 0 && b.spans.every(s => s.decor))) break;
				out.push(plainOf(b.spans));
				break;
			case 'table':
				for (const row of b.rows) out.push(row.map(plainOf).filter(c => c.trim() !== '').join(' '.repeat(GAP)));
				break;
			case 'text':
				out.push(...b.text.split('\n'));
				break;
			case 'rule':
				break;
		}
	}
	const lines = out.map(trimEnd);
	return lines.every(l => l === '') ? [] : lines;
}

type Style = {tone?: SpanTone | undefined; bold?: boolean | undefined};

function paint(text: string, style: Style, color: boolean): string {
	if (text === '') return text;
	const codes: string[] = [];
	if (style.bold) codes.push('1');
	if (style.tone !== undefined && (color || style.tone === 'muted')) codes.push(TONE_SGR[style.tone]);
	return codes.length === 0 ? text : `${ESC}[${codes.join(';')}m${text}${RESET}`;
}

const cellsOf = (spans: readonly NormalSpan[]): number => spans.reduce((n, s) => n + stringCells(s.text), 0);

function truncateSpans(spans: readonly NormalSpan[], max: number): readonly NormalSpan[] {
	if (cellsOf(spans) <= max) return spans;
	const budget = max - 1;
	const out: NormalSpan[] = [];
	let used = 0;
	for (const s of spans) {
		if (used >= budget) break;
		const w = stringCells(s.text);
		if (used + w <= budget) {
			out.push(s);
			used += w;
			continue;
		}
		out.push({...s, text: sliceCells(s.text, 0, budget - used)});
		break;
	}
	const last = out.at(-1);
	if (last) out[out.length - 1] = {...last, text: `${last.text}…`};
	else out.push({text: '…'});
	return out;
}

function renderTable(b: Extract<NormalBlock, {kind: 'table'}>, width: number, color: boolean): string[] {
	const head = b.head?.map(h => (h === '' ? [] : [{text: h, bold: true as const, tone: 'muted' as const}]));
	const all = head ? [head, ...b.rows] : b.rows;
	const columns = Math.max(0, ...all.map(r => r.length));
	const widths = Array.from({length: columns}, (_, i) => Math.max(0, ...all.map(r => cellsOf(r[i] ?? []))));
	const active = widths.flatMap((w, i) => (w > 0 ? [i] : []));
	const total = active.reduce((n, i) => n + widths[i]!, 0) + GAP * Math.max(0, active.length - 1);
	const flex = b.flex;
	if (flex !== undefined && active.includes(flex) && total > width) {
		const w = widths[flex]!;
		widths[flex] = Math.max(Math.min(MIN_FLEX, w), w - (total - width));
	}
	const out = all.map(row => {
		let text = '';
		active.forEach((i, k) => {
			const raw = row[i] ?? [];
			const cell = i === flex ? truncateSpans(raw, widths[i]!) : raw;
			text += cell.map(s => paint(s.text, s, color)).join('');
			if (k < active.length - 1) text += ' '.repeat(widths[i]! - cellsOf(cell) + GAP);
		});
		return trimEnd(text);
	});
	if (head) {
		const across = active.reduce((n, i) => n + widths[i]!, 0) + GAP * Math.max(0, active.length - 1);
		out.splice(1, 0, paint('─'.repeat(Math.max(1, Math.min(width, across))), {tone: 'muted'}, color));
	}
	return out;
}

export function renderStyled(blocks: unknown, width: number, {color}: {color: boolean}): string {
	const w = Number.isFinite(width) && width >= 1 ? Math.floor(width) : 1;
	const out: string[] = [];
	for (const b of normalizeStyled(blocks)) {
		switch (b.kind) {
			case 'line':
				out.push(trimEnd(b.spans.map(s => paint(s.text, s, color)).join('')));
				break;
			case 'rule':
				out.push(paint('─'.repeat(w), {tone: 'muted'}, color));
				break;
			case 'table':
				out.push(...renderTable(b, w, color));
				break;
			case 'text':
				for (const l of b.text.split('\n')) out.push(paint(trimEnd(l), {tone: b.tone}, color));
				break;
		}
	}
	return out.join('\n');
}

type StyledSink = {print(text: string): void; printStyled?: ((blocks: readonly StyledBlock[]) => void) | undefined};

export function printStyled(ctx: StyledSink, blocks: readonly StyledBlock[]): void {
	if (typeof ctx.printStyled === 'function') {
		ctx.printStyled(blocks);
		return;
	}
	const lines = plainLines(blocks);
	if (lines.length > 0) ctx.print(lines.join('\n'));
}
