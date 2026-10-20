import type {HintItem, HintResult, UsageLine} from './model.js';
import {colorEnabled} from './style.js';
import {cellWidth, graphemes, stringCells, truncateCells} from './width.js';

export type Segment = {
	text: string;
	bold?: boolean;
	underline?: boolean;
	dim?: boolean;
	color?: string;
	inverse?: boolean;
};

export type HintRow = {
	kind: 'item' | 'usage' | 'footer';
	selected?: boolean;
	// Index in `h.items`, set on item rows
	item?: number;
	segments: Segment[];
};

export type HintUi = {
	sel: number;
	// Defaults to colorEnabled()
	color?: boolean;
};

const MARKER = '› ';
const BLANK_MARKER = '  ';
const MIN_COLUMNS = 8;
const NAMES_ONLY_COLUMNS = 20;
const HIGHLIGHT_COLOR = 'cyan';

export function rowBudget(rows: number, columns: number): {max: number} {
	const r = Number.isFinite(rows) ? Math.floor(rows) : 24;
	const c = Number.isFinite(columns) ? Math.floor(columns) : 80;
	if (c < MIN_COLUMNS) return {max: 0};
	const cap = r >= 17 ? 7 : r >= 11 ? 4 : 2;
	return {max: Math.max(0, Math.min(cap, r - 2))};
}

function clip(segments: Segment[], max: number): Segment[] {
	const out: Segment[] = [];
	let left = max;
	for (const seg of segments) {
		if (left <= 0) break;
		const w = stringCells(seg.text);
		if (w <= left) {
			out.push(seg);
			left -= w;
			continue;
		}
		const text = truncateCells(seg.text, left);
		if (text !== '') out.push({...seg, text});
		break;
	}
	return out;
}

function pad(n: number): string {
	return ' '.repeat(Math.max(0, n));
}

function nameSegments(item: HintItem, width: number, color: boolean): {segments: Segment[]; cells: number} {
	let gs = graphemes(item.label);
	const total = gs.reduce((n, g) => n + cellWidth(g), 0);
	let ellipsis = false;
	if (total > width) {
		ellipsis = true;
		const kept: string[] = [];
		let used = 0;
		for (const g of gs) {
			const w = cellWidth(g);
			if (used + w > width - 1) break;
			kept.push(g);
			used += w;
		}
		gs = kept;
	}
	const hit = new Set<number>();
	for (const range of Array.isArray(item.ranges) ? item.ranges : []) {
		for (let i = range[0]; i < range[1]; i++) hit.add(i);
	}
	const segments: Segment[] = [];
	let run = '';
	let runHit = false;
	const flush = () => {
		if (run === '') return;
		segments.push(
			runHit
				? {text: run, bold: true, underline: true, ...(color ? {color: HIGHLIGHT_COLOR} : {})}
				: {text: run},
		);
		run = '';
	};
	gs.forEach((g, i) => {
		const isHit = hit.has(i);
		if (isHit !== runHit) flush();
		runHit = isHit;
		run += g;
	});
	flush();
	if (ellipsis) segments.push({text: '…'});
	const cells = gs.reduce((n, g) => n + cellWidth(g), 0) + (ellipsis ? 1 : 0);
	return {segments, cells};
}

function itemRow(
	item: HintItem,
	selected: boolean,
	nameWidth: number,
	columns: number,
	color: boolean,
): HintRow {
	const name = nameSegments(item, nameWidth, color);
	const segments: Segment[] = [
		selected ? {text: MARKER, bold: true, ...(color ? {color: HIGHLIGHT_COLOR} : {})} : {text: BLANK_MARKER},
		...name.segments,
	];
	if (columns >= NAMES_ONLY_COLUMNS) {
		const desc = `${item.via ? `(${item.via}) ` : ''}${item.description ?? ''}`.trim();
		if (desc !== '') {
			segments.push({text: pad(nameWidth - name.cells + 2)}, {text: desc, dim: true});
		}
	}
	return {kind: 'item', selected, segments: clip(segments, columns - 1)};
}

function usageRow(usage: UsageLine, columns: number): HintRow {
	const segments: Segment[] = [{text: BLANK_MARKER}, {text: usage.head, dim: true}];
	usage.tokens.forEach((t, i) => {
		segments.push({text: ' ', dim: true});
		segments.push(i === usage.active ? {text: t.text, bold: true, underline: true} : {text: t.text, dim: true});
	});
	return {kind: 'usage', segments: clip(segments, columns - 1)};
}

/** Rows for the hint list under the prompt; recomputed from `size` on every call, never throws. */
export function layoutHints(
	h: HintResult,
	ui: HintUi,
	size: {columns: number; rows: number},
): HintRow[] {
	try {
		return layout(h, ui, size);
	} catch {
		return [];
	}
}

function layout(h: HintResult, ui: HintUi, size: {columns: number; rows: number}): HintRow[] {
	const columns = Number.isFinite(size.columns) ? Math.floor(size.columns) : 80;
	const rows = Number.isFinite(size.rows) ? Math.floor(size.rows) : 24;
	const total = rowBudget(rows, columns).max;
	if (total < 1 || !h || h.stage === 'none') return [];

	const color = ui.color ?? colorEnabled();
	const items = Array.isArray(h.items) ? h.items : [];
	const sel = items.length === 0 ? 0 : Math.min(Math.max(0, Math.floor(ui.sel) || 0), items.length - 1);
	const usage = (h.stage === 'command' ? items[sel]?.usage : undefined) ?? h.usage;

	const out: HintRow[] = [];
	const wantUsage = usage !== undefined && (total >= 3 || items.length === 0);
	if (wantUsage && usage) out.push(usageRow(usage, columns));
	const r = total - out.length;
	if (items.length === 0 || r < 1) return out;

	let start = 0;
	let count = items.length;
	let footer = 0;
	if (items.length > r) {
		if (r === 1) {
			start = sel;
			count = 1;
		} else {
			count = r - 1;
			start = Math.min(Math.max(0, sel - Math.floor(count / 2)), items.length - count);
			footer = items.length - count;
		}
	}
	const visible = items.slice(start, start + count);
	const widest = Math.max(...visible.map(i => stringCells(i.label)));
	const nameWidth = Math.min(widest, Math.floor(columns / 2));
	visible.forEach((item, i) => {
		out.push({...itemRow(item, start + i === sel, nameWidth, columns, color), item: start + i});
	});
	if (footer > 0) {
		out.push({kind: 'footer', segments: clip([{text: `${BLANK_MARKER}+${footer} more`, dim: true}], columns - 1)});
	}
	return out;
}
