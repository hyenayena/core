import {cellWidth, graphemes} from './width.js';

export type Windowed = {
	before: string;
	cursorCell: string;
	after: string;
	ghost: string;
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
	const out: Windowed = {before: '', cursorCell: '', after: '', ghost: '', leftCut: false, rightCut: false};
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
		out.before = leftBudget >= 1 ? ELLIPSIS + tail(left, leftBudget - 1).join('') : '';
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
