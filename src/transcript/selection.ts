import {cellWidth, graphemes, stringCells} from '../hints/width.js';
import {lineText, type Line, type RowsOf, type VisibleRow} from './scroll.js';
import {stripStyles} from './wrap.js';

export type Mark = {id: number; offset: number; end: number};
export type Bound = {id: number; offset: number};
export type Span = {from: Bound; to: Bound};

export type LineLayout = {plain: string; rows: string[]; starts: number[]};
export type LayoutOf = (line: Line, width: number) => LineLayout;

export function createLayoutCache(rowsOf: RowsOf): LayoutOf {
	const cache = new WeakMap<Line, {width: number; layout: LineLayout}>();
	return (line, width) => {
		const hit = cache.get(line);
		if (hit && hit.width === width) return hit.layout;
		const layout = lineLayout(lineText(line, width), rowsOf(line, width));
		cache.set(line, {width, layout});
		return layout;
	};
}

export function lineLayout(text: string, styledRows: string[]): LineLayout {
	const plain = stripStyles(text);
	const rows = styledRows.map(stripStyles);
	const starts: number[] = [];
	let cursor = 0;
	for (const row of rows) {
		const at = plain.indexOf(row, cursor);
		const start = at >= 0 ? at : Math.min(cursor, plain.length);
		starts.push(start);
		cursor = start + row.length;
	}
	return {plain, rows, starts};
}

export function markAt(id: number, layout: LineLayout, row: number, col: number): Mark {
	const r = Math.max(0, Math.min(layout.rows.length - 1, row));
	const text = layout.rows[r] ?? '';
	const start = layout.starts[r] ?? 0;
	let cells = 0;
	let off = 0;
	for (const g of graphemes(text)) {
		const w = Math.max(1, cellWidth(g));
		if (col < cells + w) return {id, offset: start + off, end: start + off + g.length};
		cells += w;
		off += g.length;
	}
	return {id, offset: start + text.length, end: start + text.length};
}

const before = (a: Bound, b: Bound): boolean => a.id < b.id || (a.id === b.id && a.offset < b.offset);

export function spanOf(anchor: Mark, head: Mark): Span {
	const [first, last] = before(head, anchor) ? [head, anchor] : [anchor, head];
	return {from: {id: first.id, offset: first.offset}, to: {id: last.id, offset: Math.max(last.end, last.offset)}};
}

export const emptySpan = (s: Span): boolean => s.from.id === s.to.id && s.from.offset >= s.to.offset;

const WORD = /[\p{L}\p{N}\p{M}_\-./~:@%+#=?&]/u;

export function wordSpan(layout: LineLayout, mark: Mark): Span {
	const {plain} = layout;
	const at = (i: number) => plain.charAt(i);
	if (mark.offset >= plain.length || !WORD.test(at(mark.offset))) return spanOf(mark, mark);
	let from = mark.offset;
	let to = mark.offset;
	while (from > 0 && WORD.test(at(from - 1))) from--;
	while (to < plain.length && WORD.test(at(to))) to++;
	return {from: {id: mark.id, offset: from}, to: {id: mark.id, offset: to}};
}

export const lineSpan = (layout: LineLayout, id: number): Span => ({from: {id, offset: 0}, to: {id, offset: layout.plain.length}});

export function selectedText(lines: readonly Line[], span: Span, layoutOf: LayoutOf, width: number): string {
	const out: string[] = [];
	for (const line of lines) {
		if (line.id < span.from.id || line.id > span.to.id) continue;
		const {plain} = layoutOf(line, width);
		const from = line.id === span.from.id ? span.from.offset : 0;
		const to = line.id === span.to.id ? span.to.offset : plain.length;
		out.push(plain.slice(from, Math.max(from, to)));
	}
	return out.join('\n').replace(/[ \t]+$/gm, '');
}

export function rowCells(row: VisibleRow, span: Span, layout: LineLayout): [number, number] | undefined {
	if (row.id < span.from.id || row.id > span.to.id) return undefined;
	const text = layout.rows[row.row];
	const start = layout.starts[row.row];
	if (text === undefined || start === undefined) return undefined;
	const end = start + text.length;
	const from = row.id === span.from.id ? Math.max(start, span.from.offset) : start;
	const to = row.id === span.to.id ? Math.min(end, span.to.offset) : end;
	if (to <= from) return undefined;
	return [stringCells(text.slice(0, from - start)), stringCells(text.slice(0, to - start))];
}
