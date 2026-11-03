import {sliceCells, stringCells, truncateCells} from '../hints/width.js';

export type InlineField = {options: string[]; current?: string; focused: boolean};
export type InlineRow = {label: string; fields: InlineField[]};
export type InlineSegment = {text: string; focused?: boolean};

const LABEL_MAX = 20;
const FIELD_MAX = 16;
const ARROW = '→ ';
const ELLIPSIS = '…';

const shown = (field: InlineField) => (field.current === undefined ? '?' : field.current);

function cells(segments: InlineSegment[]): number {
	return segments.reduce((n, s) => n + stringCells(s.text), 0);
}

function cut(segments: InlineSegment[], width: number): InlineSegment[] {
	if (cells(segments) <= width) return segments;
	let budget = width - stringCells(ELLIPSIS);
	if (budget < 0) return [{text: sliceCells(ELLIPSIS, 0, width)}];
	const out: InlineSegment[] = [];
	for (const segment of segments) {
		if (budget <= 0) break;
		const text = sliceCells(segment.text, 0, budget);
		if (text === '') break;
		out.push({...segment, text});
		budget -= stringCells(text);
	}
	out.push({text: ELLIPSIS});
	return out;
}

function fieldSegments(row: InlineRow, columns: number[] | undefined): InlineSegment[] {
	const out: InlineSegment[] = [];
	row.fields.forEach((field, i) => {
		const value = truncateCells(shown(field), FIELD_MAX);
		const last = i === row.fields.length - 1;
		const pad = columns && !last ? ' '.repeat(Math.max(0, (columns[i] ?? 0) - stringCells(value))) : '';
		out.push({text: `[${value}]`, focused: field.focused});
		if (!last) out.push({text: `${pad} `});
	});
	return out;
}

export function layoutInlineRows(rows: InlineRow[], width: number): InlineSegment[][] {
	const labels = rows.map(r => truncateCells(r.label, LABEL_MAX));
	const labelWidth = Math.max(0, ...labels.map(stringCells));
	const columns: number[] = [];
	for (const row of rows) {
		row.fields.forEach((field, i) => {
			const widest = Math.max(1, ...field.options.map(o => stringCells(truncateCells(o, FIELD_MAX))));
			columns[i] = Math.max(columns[i] ?? 0, widest);
		});
	}
	const alignedWidth = (row: InlineRow) =>
		2 + labelWidth + 2 + stringCells(ARROW) + row.fields.reduce((n, _f, i) => n + (columns[i] ?? 0) + 2 + (i > 0 ? 1 : 0), 0);
	const aligned = rows.every(row => alignedWidth(row) <= width);

	return rows.map((row, r) => {
		const marker = row.fields.some(f => f.focused) ? '›' : ' ';
		if (aligned) {
			const label = labels[r]! + ' '.repeat(labelWidth - stringCells(labels[r]!));
			return [{text: `${marker} ${label}  ${ARROW}`}, ...fieldSegments(row, columns)];
		}
		const fields = fieldSegments(row, undefined);
		const rest = 2 + 1 + stringCells(ARROW) + cells(fields);
		const room = Math.max(1, width - rest);
		const label = room === 1 ? sliceCells(labels[r]!, 0, 1) || ELLIPSIS : truncateCells(labels[r]!, room);
		return cut([{text: `${marker} ${label} ${ARROW}`}, ...fields], width);
	});
}
