import {cellWidth, graphemes} from './width.js';

export type Windowed = {
	before: string;
	cursorCell: string;
	after: string;
	ghost: string;
	// Grapheme index of the first grapheme of `before` (after a left `…`)
	start: number;
	leftCut: boolean;
	rightCut: boolean;
};

const ELLIPSIS = '…';

const cells = (gs: readonly string[]) => gs.reduce((n, g) => n + cellWidth(g), 0);

function tail(gs: readonly string[], budget: number): string[] {
	const out: string[] = [];
	let used = 0;
	for (let i = gs.length - 1; i >= 0; i--) {
		const w = cellWidth(gs[i] as string);
		if (used + w > budget) break;
		out.unshift(gs[i] as string);
		used += w;
	}
	return out;
}

function head(gs: readonly string[], budget: number): string[] {
	const out: string[] = [];
	let used = 0;
	for (const g of gs) {
		const w = cellWidth(g);
		if (used + w > budget) break;
		out.push(g);
		used += w;
	}
	return out;
}

/**
 * Fits a single-row view of the line into `maxCells`. `cursor` is a grapheme index;
 * the ghost is only shown when the cursor is at the end of the line.
 */
export function windowLine(
	gs: readonly string[],
	cursor: number,
	ghost: string,
	maxCells: number,
): Windowed {
	const out: Windowed = {before: '', cursorCell: '', after: '', ghost: '', start: 0, leftCut: false, rightCut: false};
	const max = Math.floor(maxCells);
	if (!(max >= 1)) return out;
	const list = Array.isArray(gs) ? gs : [];
	const at = Math.min(Math.max(0, Math.floor(cursor) || 0), list.length);
	const atEnd = at === list.length;
	const ghostGs = atEnd && typeof ghost === 'string' ? graphemes(ghost) : [];

	let cell = atEnd ? (ghostGs.shift() ?? ' ') : (list[at] as string);
	if (cellWidth(cell) > max || cellWidth(cell) === 0) cell = ' ';
	out.cursorCell = cell;

	const avail = max - cellWidth(cell);
	const left = list.slice(0, at);
	const right = atEnd ? ghostGs : list.slice(at + 1);
	const leftNeed = cells(left);
	const rightNeed = cells(right);

	let leftBudget: number;
	let rightBudget: number;
	if (atEnd) {
		leftBudget = avail;
		rightBudget = Math.max(0, avail - leftNeed);
	} else if (leftNeed + rightNeed <= avail) {
		leftBudget = leftNeed;
		rightBudget = rightNeed;
	} else {
		rightBudget = Math.min(rightNeed, Math.max(Math.floor(avail / 2), avail - leftNeed));
		leftBudget = avail - rightBudget;
	}

	if (leftNeed <= leftBudget) {
		out.before = left.join('');
	} else {
		out.leftCut = true;
		const kept = leftBudget >= 1 ? tail(left, leftBudget - 1) : [];
		out.before = leftBudget >= 1 ? ELLIPSIS + kept.join('') : '';
		out.start = at - kept.length;
	}

	if (atEnd) {
		out.ghost = head(right, rightBudget).join('');
	} else if (rightNeed <= rightBudget) {
		out.after = right.join('');
	} else {
		out.rightCut = true;
		out.after = rightBudget >= 1 ? head(right, rightBudget - 1).join('') + ELLIPSIS : '';
	}
	return out;
}

/**
 * Grapheme index for a click on `cell` (0-based, from the start of the window) of a window built by
 * `windowLine` for a line of `length` graphemes with the cursor at grapheme `cursor`. The left `…`
 * and negative cells give the first visible grapheme, the right `…` the first hidden one, the ghost
 * and anything past the end the end of the line.
 */
export function indexAtCell(win: Windowed, length: number, cursor: number, cell: number): number {
	const n = Math.max(0, Math.floor(length) || 0);
	const clamp = (i: number) => Math.min(Math.max(0, i), n);
	const at = clamp(Math.floor(cursor) || 0);
	const start = clamp(Math.floor(win.start) || 0);
	if (!Number.isFinite(cell)) return at;
	const target = Math.floor(cell);
	if (target < 0) return start;

	let pos = 0;
	let before = win.before;
	if (win.leftCut && before.startsWith(ELLIPSIS)) {
		if (target < 1) return start;
		pos = 1;
		before = before.slice(ELLIPSIS.length);
	}
	let index = start;
	for (const g of graphemes(before)) {
		const w = cellWidth(g);
		if (target < pos + w) return clamp(index);
		pos += w;
		index++;
	}

	const cw = Math.max(1, cellWidth(win.cursorCell || ' '));
	if (target < pos + cw) return at;
	pos += cw;
	if (at >= n) return n;

	let after = win.after;
	if (win.rightCut && after.endsWith(ELLIPSIS)) after = after.slice(0, -ELLIPSIS.length);
	index = at + 1;
	for (const g of graphemes(after)) {
		const w = cellWidth(g);
		if (target < pos + w) return clamp(index);
		pos += w;
		index++;
	}
	if (win.rightCut && target < pos + 1) return clamp(index);
	return n;
}
