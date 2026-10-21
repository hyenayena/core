import {graphemes, sliceCells, stringCells} from '../hints/width.js';
import {indexAtCell, windowLine, type Windowed} from '../hints/viewport.js';

export type InputWindowRow = {
	// UTF-16 offset of the start of the line in the text.
	offset: number;
	before: string;
	cell: string | null;
	after: string;
	leftCut: boolean;
	rightCut: boolean;
};

type Laid = {row: InputWindowRow; line: string; gs: string[]; win?: Windowed; at: number};

const ELLIPSIS = '…';

function layout(text: string, cursor: number, maxCells: number, maxRows: number): Laid[] {
	const lines = text.split('\n');
	const rowsMax = Math.max(1, Math.floor(maxRows) || 1);
	const cells = Math.max(1, Math.floor(maxCells) || 1);
	let remaining = Math.min(Math.max(0, Math.floor(cursor) || 0), text.length);
	let cursorLine = 0;
	for (let i = 0; i < lines.length; i++) {
		const len = (lines[i] as string).length;
		cursorLine = i;
		if (remaining <= len) break;
		remaining -= len + 1;
	}
	const first = Math.max(0, Math.min(cursorLine - rowsMax + 1, lines.length - rowsMax));
	let offset = 0;
	for (let i = 0; i < first; i++) offset += (lines[i] as string).length + 1;
	const out: Laid[] = [];
	for (let i = first; i < Math.min(lines.length, first + rowsMax); i++) {
		const line = lines[i] as string;
		const gs = graphemes(line);
		if (i === cursorLine) {
			let at = gs.length;
			let pos = 0;
			for (let g = 0; g < gs.length; g++) {
				const len = (gs[g] as string).length;
				if (remaining < pos + len) {
					at = g;
					break;
				}
				pos += len;
			}
			const win = windowLine(gs, at, '', cells);
			out.push({
				row: {offset, before: win.before, cell: win.cursorCell, after: win.after, leftCut: win.leftCut, rightCut: win.rightCut},
				line,
				gs,
				win,
				at,
			});
		} else {
			const cut = stringCells(line) > cells;
			const before = cut ? sliceCells(line, 0, cells - 1) + ELLIPSIS : line;
			out.push({row: {offset, before, cell: null, after: '', leftCut: false, rightCut: cut}, line, gs, at: 0});
		}
		offset += line.length + 1;
	}
	return out;
}

/** Rows of a multi-line input that fit `maxCells` x `maxRows`; shared by rendering and click mapping. */
export function inputWindow(text: string, cursor: number, maxCells: number, maxRows: number): InputWindowRow[] {
	return layout(text, cursor, maxCells, maxRows).map(l => l.row);
}

const lengthOf = (gs: readonly string[], count: number) => {
	let n = 0;
	for (let i = 0; i < count && i < gs.length; i++) n += (gs[i] as string).length;
	return n;
};

/**
 * Text offset for a click on shown row `row` (0-based) at `cell` (0-based within the text area).
 * A cut `…` maps to the neighbouring grapheme, past the end of a line to its end; undefined when
 * the row is not shown.
 */
export function offsetAtCell(
	text: string,
	cursor: number,
	maxCells: number,
	maxRows: number,
	row: number,
	cell: number,
): number | undefined {
	const rows = layout(text, cursor, maxCells, maxRows);
	if (!Number.isInteger(row) || row < 0 || row >= rows.length) return undefined;
	const {row: shown, line, gs, win, at} = rows[row] as Laid;
	const lineEnd = shown.offset + line.length;
	if (!Number.isFinite(cell)) return shown.offset + lengthOf(gs, at);
	if (win) return shown.offset + lengthOf(gs, indexAtCell(win, gs.length, at, cell));
	const target = Math.max(0, Math.floor(cell));
	const visible = shown.rightCut ? shown.before.slice(0, -ELLIPSIS.length) : shown.before;
	let used = 0;
	let index = 0;
	for (const g of graphemes(visible)) {
		const w = stringCells(g);
		if (target < used + w) return shown.offset + lengthOf(gs, index);
		used += w;
		index++;
	}
	if (shown.rightCut && target < used + 1) return shown.offset + lengthOf(gs, index);
	return lineEnd;
}
