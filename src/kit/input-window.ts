import {cellWidth, graphemes} from '../hints/width.js';

export type InputWindowRow = {
	offset: number;
	before: string;
	cell: string | null;
	after: string;
	leftCut: boolean;
	rightCut: boolean;
};

type Segment = {gs: string[]; start: number; end: number; offset: number; lastOfLine: boolean};

const lengthOf = (gs: readonly string[], from: number, to: number) => {
	let n = 0;
	for (let i = from; i < to && i < gs.length; i++) n += (gs[i] as string).length;
	return n;
};

function wrapLine(gs: string[], width: number, lineOffset: number): Segment[] {
	const out: Segment[] = [];
	let start = 0;
	let offset = lineOffset;
	for (;;) {
		let used = 0;
		let i = start;
		let breakAt = -1;
		while (i < gs.length) {
			const w = cellWidth(gs[i] as string);
			if (used + w > width) break;
			used += w;
			i++;
			if (gs[i - 1] === ' ') breakAt = i;
		}
		if (i >= gs.length) {
			out.push({gs, start, end: gs.length, offset, lastOfLine: true});
			return out;
		}
		const end = i === start ? start + 1 : breakAt > start && gs[i] !== ' ' ? breakAt : i;
		out.push({gs, start, end, offset, lastOfLine: false});
		offset += lengthOf(gs, start, end);
		start = end;
	}
}

const wrapWidth = (maxCells: number) => Math.max(1, (Math.floor(maxCells) || 1) - 1);

function segments(text: string, maxCells: number): Segment[] {
	const width = wrapWidth(maxCells);
	const out: Segment[] = [];
	let offset = 0;
	for (const line of text.split('\n')) {
		out.push(...wrapLine(graphemes(line), width, offset));
		offset += line.length + 1;
	}
	return out;
}

function locate(segs: Segment[], text: string, cursor: number): {index: number; at: number} {
	const target = Math.min(Math.max(0, Math.floor(cursor) || 0), text.length);
	for (let s = 0; s < segs.length; s++) {
		const seg = segs[s] as Segment;
		const segEnd = seg.offset + lengthOf(seg.gs, seg.start, seg.end);
		const inside = target < segEnd || (seg.lastOfLine && target <= segEnd);
		if (target < seg.offset || !inside) continue;
		let pos = seg.offset;
		let at = seg.end;
		for (let g = seg.start; g < seg.end; g++) {
			const len = (seg.gs[g] as string).length;
			if (target < pos + len) {
				at = g;
				break;
			}
			pos += len;
		}
		return {index: s, at};
	}
	const last = segs.length - 1;
	return {index: last, at: (segs[last] as Segment).end};
}

function shown(text: string, cursor: number, maxCells: number, maxRows: number) {
	const segs = segments(text, maxCells);
	const rows = Math.max(1, Math.floor(maxRows) || 1);
	const {index, at} = locate(segs, text, cursor);
	const first = Math.max(0, Math.min(index - rows + 1, segs.length - rows));
	return {segs: segs.slice(first, first + rows), cursorRow: index - first, at};
}

export function inputRowCount(text: string, maxCells: number): number {
	return segments(text, maxCells).length;
}

export function inputWindow(text: string, cursor: number, maxCells: number, maxRows: number): InputWindowRow[] {
	const {segs, cursorRow, at} = shown(text, cursor, maxCells, maxRows);
	return segs.map((seg, r) => {
		const part = (from: number, to: number) => seg.gs.slice(from, to).join('');
		const base = {offset: seg.offset, leftCut: false, rightCut: false};
		if (r !== cursorRow) return {...base, before: part(seg.start, seg.end), cell: null, after: ''};
		return {
			...base,
			before: part(seg.start, at),
			cell: at < seg.end ? (seg.gs[at] as string) : ' ',
			after: part(at + 1, seg.end),
		};
	});
}

export function offsetAtCell(
	text: string,
	cursor: number,
	maxCells: number,
	maxRows: number,
	row: number,
	cell: number,
): number | undefined {
	const {segs, cursorRow, at} = shown(text, cursor, maxCells, maxRows);
	if (!Number.isInteger(row) || row < 0 || row >= segs.length) return undefined;
	const seg = segs[row] as Segment;
	if (!Number.isFinite(cell)) return seg.offset + lengthOf(seg.gs, seg.start, row === cursorRow ? at : seg.start);
	const target = Math.max(0, Math.floor(cell));
	let used = 0;
	for (let g = seg.start; g < seg.end; g++) {
		const w = cellWidth(seg.gs[g] as string);
		if (target < used + w) return seg.offset + lengthOf(seg.gs, seg.start, g);
		used += w;
	}
	const end = seg.lastOfLine || seg.end === seg.start ? seg.end : seg.end - 1;
	return seg.offset + lengthOf(seg.gs, seg.start, end);
}
