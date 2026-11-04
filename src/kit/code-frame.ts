import {cellWidth, graphemes, stringCells, truncateCells} from '../hints/width.js';
import {sliceStyledCells, styledCells} from '../transcript/wrap.js';
import type {CodeToken} from './diff-card.js';
import {glyph} from './glyphs.js';
import {paintTokens} from './status-row.js';
import {SGR_ATTR, SGR_RESET, colorDepth, paintTone, toneSgr, type ColorDepth} from './theme.js';

export type CodeFrameOptions = {
	lines: readonly (readonly CodeToken[])[];
	width: number;
	label?: string;
	right?: string;
	open?: boolean;
	maxRows?: number;
	ascii?: boolean;
	depth?: ColorDepth;
};

const CONTROL = new RegExp(
	`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(10)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}]`,
	'g',
);
const BREAK_AFTER = new Set([',', ';', ')', ']', '}', '|', '&']);
const MIN_LABEL = 4;

function cleanText(text: string): string {
	return String(text).replace(/\t/g, '    ').replace(CONTROL, '');
}

type Cell = {g: string; w: number; tone: CodeToken['tone']};

function cellsOf(tokens: readonly CodeToken[]): Cell[] {
	const out: Cell[] = [];
	for (const t of tokens) {
		for (const g of graphemes(cleanText(t.text))) out.push({g, w: cellWidth(g), tone: t.tone});
	}
	return out;
}

function toTokens(cells: readonly Cell[]): CodeToken[] {
	const out: CodeToken[] = [];
	for (const c of cells) {
		const last = out.at(-1);
		if (last !== undefined && last.tone === c.tone) last.text += c.g;
		else out.push(c.tone === undefined ? {text: c.g} : {text: c.g, tone: c.tone});
	}
	return out;
}

// Segment ends: before whitespace that follows a word, after closing punctuation.
function segments(cells: readonly Cell[]): Cell[][] {
	const out: Cell[][] = [];
	let cur: Cell[] = [];
	let seenWord = false;
	for (let i = 0; i < cells.length; i++) {
		const c = cells[i]!;
		const space = c.g === ' ';
		if (space && seenWord) {
			out.push(cur);
			cur = [];
			seenWord = false;
		}
		cur.push(c);
		if (!space) {
			seenWord = true;
			if (BREAK_AFTER.has(c.g) && i + 1 < cells.length && cells[i + 1]!.g !== ' ') {
				out.push(cur);
				cur = [];
				seenWord = false;
			}
		}
	}
	if (cur.length > 0) out.push(cur);
	return out;
}

export function wrapCodeTokens(tokens: readonly CodeToken[], width: number): CodeToken[][] {
	const max = Number.isFinite(width) && width >= 1 ? Math.floor(width) : 1;
	const cells = cellsOf(tokens);
	if (cells.length === 0) return [[]];
	const rows: Cell[][] = [];
	let row: Cell[] = [];
	let used = 0;
	const flush = (): void => {
		rows.push(row);
		row = [];
		used = 0;
	};
	for (const seg of segments(cells)) {
		let w = 0;
		for (const c of seg) w += c.w;
		if (used + w <= max) {
			row.push(...seg);
			used += w;
			continue;
		}
		if (used > 0) flush();
		if (rows.length > 0) {
			// Whitespace opening a continuation row would only push the text right.
			let k = 0;
			while (k < seg.length - 1 && seg[k]!.g === ' ') k++;
			if (k > 0) {
				for (let j = 0; j < k; j++) w -= seg[j]!.w;
				seg.splice(0, k);
			}
		}
		if (w <= max) {
			row.push(...seg);
			used = w;
			continue;
		}
		for (const c of seg) {
			if (used + c.w > max && used > 0) flush();
			row.push(c);
			used += c.w;
		}
	}
	if (row.length > 0 || rows.length === 0) rows.push(row);
	return rows.map(toTokens);
}

function fit(text: string, width: number): string {
	return styledCells(text) > width ? sliceStyledCells(text, 0, Math.max(0, width)) : text;
}

export function renderCodeFrame(o: CodeFrameOptions): string[] {
	const width = Math.max(1, Math.floor(o.width));
	const depth = o.depth ?? colorDepth();
	const ascii = o.ascii === true;
	const g = (name: 'hRule' | 'vRule' | 'cornerTl' | 'cornerTr' | 'cornerBl' | 'cornerBr' | 'wrap' | 'fold'): string => glyph(name, {ascii});
	const frame = (text: string): string => paintTone(text, 'frame', depth);
	const hr = g('hRule');
	const bodyWidth = Math.max(1, width - 2);

	const body: string[] = [];
	const starts: boolean[] = [];
	const max = o.maxRows === undefined ? Infinity : Math.max(1, Math.floor(o.maxRows));
	let hidden = 0;
	for (let i = 0; i < o.lines.length; i++) {
		const wrapped = wrapCodeTokens(o.lines[i]!, bodyWidth);
		if (body.length + wrapped.length > max) {
			if (body.length === 0) {
				wrapped.slice(0, max).forEach((r, j) => {
					body.push(paintTokens(r, depth));
					starts.push(j === 0);
				});
				hidden = o.lines.length - 1;
			} else {
				hidden = o.lines.length - i;
			}
			break;
		}
		wrapped.forEach((r, j) => {
			body.push(paintTokens(r, depth));
			starts.push(j === 0);
		});
	}

	const rows: string[] = [];
	// Only the corners close the frame on the right: body rows carry no right edge, so a mouse selection copies just the code.
	const closed = width >= 3;
	const tr = closed ? frame(g('cornerTr')) : '';
	const br = closed ? frame(g('cornerBr')) : '';
	const edge = closed ? 1 : 0;
	rows.push(fit(topBorder(o, width - edge, depth, ascii) + tr, width));
	const vr = frame(g('vRule'));
	const cont = frame(g('vRule') + g('wrap'));
	body.forEach((text, i) => rows.push(fit(`${starts[i] ? `${vr} ` : cont}${text}`, width)));

	if (hidden > 0) {
		const note = `${g('fold')} +${hidden} ${hidden === 1 ? 'line' : 'lines'}`;
		const room = Math.max(0, width - 5 - edge);
		const text = truncateCells(note, room);
		const fill = Math.max(0, width - 4 - edge - stringCells(text));
		rows.push(fit(frame(`${g('cornerBl')}${hr} `) + text + frame(` ${hr.repeat(fill)}`) + br, width));
	} else if (o.open !== true) {
		rows.push(fit(frame(g('cornerBl') + hr.repeat(Math.max(0, width - 1 - edge))) + br, width));
	}
	return rows;
}

function topBorder(o: CodeFrameOptions, width: number, depth: ColorDepth, ascii: boolean): string {
	const hr = glyph('hRule', {ascii});
	const frame = (text: string): string => paintTone(text, 'frame', depth);
	const head = glyph('cornerTl', {ascii}) + hr;
	const label = cleanText(o.label ?? '').replace(/ +/g, ' ').trim();
	const right = cleanText(o.right ?? '').trim();
	const rightCells = right === '' ? 0 : stringCells(right) + 2;
	const paintRight = (): string => {
		const open = toneSgr('muted', depth);
		return `${SGR_ATTR.underline}${open}${right}${SGR_RESET}`;
	};
	const build = (lab: string, withRight: boolean): string => {
		const labCells = lab === '' ? 0 : stringCells(lab) + 2;
		const rc = withRight ? rightCells : 0;
		const fill = Math.max(1, width - 2 - labCells - rc - (withRight ? 1 : 0));
		const parts = [frame(head), lab === '' ? '' : frame(' ') + paintTone(lab, 'muted', depth) + frame(' '), frame(hr.repeat(fill))];
		if (withRight) parts.push(frame(' '), paintRight(), frame(` ${hr}`));
		return parts.join('');
	};
	if (right !== '') {
		// head + label + 1 fill + right part + trailing rule
		const roomForLabel = width - 2 - 1 - rightCells - 1 - (label === '' ? 0 : 2);
		if (label === '' && width >= 2 + 1 + rightCells + 1) return build('', true);
		if (label !== '' && roomForLabel >= Math.min(stringCells(label), MIN_LABEL)) {
			return build(truncateCells(label, roomForLabel), true);
		}
	}
	if (label === '') return frame(head + hr.repeat(Math.max(0, width - 2)));
	const room = width - 2 - 2 - 1;
	if (room < 1) return frame(head + hr.repeat(Math.max(0, width - 2)));
	return build(truncateCells(label, room), false);
}
