import type {PrintAction} from '../../../../src/api.js';
import {wrapRows} from './wrap.js';

// `actions`: clicks on its printed lines that copy text; `render`: the text for a width (both `PrintOptions` of the host API).
export type Line = {
	id: number;
	text: string;
	color?: string | undefined;
	actions?: readonly PrintAction[] | undefined;
	render?: ((width: number) => string) | undefined;
};

/** The text of a line laid out for `width`; a `render` that throws or returns a non-string falls back to `text`. */
export function lineText(line: Line, width: number): string {
	if (!line.render) return line.text;
	try {
		const text = line.render(width);
		return typeof text === 'string' ? text : line.text;
	} catch {
		return line.text;
	}
}

/** The logical line at the bottom of the view, its rows hidden below, and its row count when set. */
export type Anchor = {id: number; hidden: number; of: number};

export type RowsOf = (line: Line, width: number) => string[];

// `id` is the logical line and `row` the row inside it, as wrapped for this width.
export type VisibleRow = {key: string; id: number; row: number; text: string; color?: string | undefined};

type Position = {i: number; h: number};

export function createRowCache(): RowsOf {
	const cache = new WeakMap<Line, {width: number; rows: string[]}>();
	return (line, width) => {
		const hit = cache.get(line);
		if (hit && hit.width === width) return hit.rows;
		const rows = wrapRows(lineText(line, width), width);
		cache.set(line, {width, rows});
		return rows;
	};
}

export function sameAnchor(a: Anchor | null, b: Anchor | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.id === b.id && a.hidden === b.hidden && a.of === b.of;
}

function indexOf(lines: Line[], id: number): number {
	let lo = 0;
	let hi = lines.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const at = lines[mid]!.id;
		if (at === id) return mid;
		if (at < id) lo = mid + 1;
		else hi = mid - 1;
	}
	return -1;
}

function effectiveHidden(anchor: Anchor, rowsNow: number): number {
	const h = anchor.of === rowsNow || anchor.of <= 0 ? anchor.hidden : Math.round((anchor.hidden * rowsNow) / anchor.of);
	return Math.max(0, Math.min(rowsNow - 1, Number.isFinite(h) ? h : 0));
}

const count = (lines: Line[], i: number, rowsOf: RowsOf, width: number) => rowsOf(lines[i]!, width).length;

function toAnchor(lines: Line[], p: Position | null, rowsOf: RowsOf, width: number): Anchor | null {
	if (!p || (p.i === lines.length - 1 && p.h === 0)) return null;
	return {id: lines[p.i]!.id, hidden: p.h, of: count(lines, p.i, rowsOf, width)};
}

/** Rows from the top of the transcript down to the bottom row of `p`, counted up to `limit`. */
function rowsAbove(lines: Line[], p: Position, rowsOf: RowsOf, width: number, limit: number): number {
	let n = count(lines, p.i, rowsOf, width) - p.h;
	for (let j = p.i - 1; j >= 0 && n < limit; j--) n += count(lines, j, rowsOf, width);
	return n;
}

/** The position that shows the first row at the top of a full view; null when everything fits. */
function topPosition(lines: Line[], rowsOf: RowsOf, width: number, viewport: number): Anchor | null {
	const view = Math.max(1, viewport);
	let cum = 0;
	for (let j = 0; j < lines.length; j++) {
		cum += count(lines, j, rowsOf, width);
		if (cum >= view) return toAnchor(lines, {i: j, h: cum - view}, rowsOf, width);
	}
	return null;
}

export function visibleWindow(
	lines: Line[],
	anchor: Anchor | null,
	rowsOf: RowsOf,
	width: number,
	maxRows: number,
): {rows: VisibleRow[]; newer: number} {
	if (lines.length === 0) return {rows: [], newer: 0};
	let i = lines.length - 1;
	let h = 0;
	if (anchor) {
		const at = indexOf(lines, anchor.id);
		if (at >= 0) {
			i = at;
			h = effectiveHidden(anchor, count(lines, i, rowsOf, width));
		}
	}
	let newer = h;
	for (let j = i + 1; j < lines.length; j++) newer += count(lines, j, rowsOf, width);
	const limit = Math.max(1, maxRows);
	const out: VisibleRow[] = [];
	for (let j = i; j >= 0 && out.length < limit; j--) {
		const line = lines[j]!;
		const rows = rowsOf(line, width);
		const end = j === i ? rows.length - h : rows.length;
		for (let r = end - 1; r >= 0 && out.length < limit; r--) {
			out.push({key: `${line.id}:${r}`, id: line.id, row: r, text: rows[r]!, color: line.color});
		}
	}
	out.reverse();
	return {rows: out, newer};
}

/** Moves the view by `delta` rows: positive scrolls back, negative forward; null follows the bottom. */
export function scrollAnchor(
	lines: Line[],
	anchor: Anchor | null,
	delta: number,
	rowsOf: RowsOf,
	width: number,
	viewport: number,
): Anchor | null {
	const base = normalizeAnchor(lines, anchor, rowsOf, width, viewport);
	if (lines.length === 0 || !Number.isFinite(delta) || delta === 0) return base;
	const last = lines.length - 1;
	let i = last;
	let h = 0;
	if (base) {
		i = indexOf(lines, base.id);
		h = effectiveHidden(base, count(lines, i, rowsOf, width));
	}
	if (delta > 0) {
		h += Math.round(delta);
		while (i > 0 && h >= count(lines, i, rowsOf, width)) {
			h -= count(lines, i, rowsOf, width);
			i--;
		}
		h = Math.min(h, count(lines, i, rowsOf, width) - 1);
	} else {
		h += Math.round(delta);
		while (h < 0) {
			if (i === last) return null;
			i++;
			h += count(lines, i, rowsOf, width);
		}
	}
	const view = Math.max(1, viewport);
	if (rowsAbove(lines, {i, h}, rowsOf, width, view) < view) return topPosition(lines, rowsOf, width, view);
	return toAnchor(lines, {i, h}, rowsOf, width);
}

/** Repairs an anchor after trimming, resizing or a smaller view; returns the same object when it still holds. */
export function normalizeAnchor(
	lines: Line[],
	anchor: Anchor | null,
	rowsOf: RowsOf,
	width: number,
	viewport: number,
): Anchor | null {
	if (!anchor || lines.length === 0) return null;
	const view = Math.max(1, viewport);
	const i = indexOf(lines, anchor.id);
	if (i < 0) return topPosition(lines, rowsOf, width, view);
	const h = effectiveHidden(anchor, count(lines, i, rowsOf, width));
	if (i === lines.length - 1 && h === 0) return null;
	if (rowsAbove(lines, {i, h}, rowsOf, width, view) < view) return topPosition(lines, rowsOf, width, view);
	return anchor;
}
