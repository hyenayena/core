import type {Tone} from './types.js';
import {windowStart} from './window.js';

export type DotState = 'pending' | 'pass' | 'fail' | 'skip';

export const BRAILLE_FILL: readonly number[] = [0x01, 0x02, 0x04, 0x40, 0x08, 0x10, 0x20, 0x80];

export type BrailleCell = {glyph: string; tone: Tone; done: number; capacity: number};

const BASE = 0x2800;
const PER_CELL = BRAILLE_FILL.length;

export function brailleCells(states: readonly DotState[]): BrailleCell[] {
	const cells: BrailleCell[] = [];
	for (let start = 0; start < states.length; start += PER_CELL) {
		const slice = states.slice(start, start + PER_CELL);
		let all = 0;
		let finished = 0;
		let done = 0;
		let fail = false;
		let skip = false;
		slice.forEach((state, i) => {
			const bit = BRAILLE_FILL[i] as number;
			all |= bit;
			if (state === 'pending') return;
			finished |= bit;
			done++;
			if (state === 'fail') fail = true;
			else if (state === 'skip') skip = true;
		});
		const tone: Tone = done === 0 ? 'dim' : fail ? 'del' : skip ? 'warn' : 'add';
		cells.push({
			glyph: String.fromCodePoint(BASE + (done === 0 ? all : finished)),
			tone,
			done,
			capacity: slice.length,
		});
	}
	return cells;
}

export function brailleRows(
	cells: readonly BrailleCell[],
	width: number,
	options: {maxRows?: number; focus?: number} = {},
): {rows: BrailleCell[][]; hiddenBefore: number; hiddenAfter: number} {
	const w = Math.max(1, Math.floor(Number.isFinite(width) ? width : 1));
	const all: BrailleCell[][] = [];
	for (let i = 0; i < cells.length; i += w) all.push(cells.slice(i, i + w));
	const {maxRows, focus = 0} = options;
	if (maxRows === undefined || maxRows < 1 || all.length <= maxRows) {
		return {rows: all, hiddenBefore: 0, hiddenAfter: 0};
	}
	const clamped = Math.min(Math.max(0, Number.isFinite(focus) ? focus : 0), Math.max(0, cells.length - 1));
	const start = windowStart(all.length, Math.floor(maxRows), Math.floor(clamped / w));
	const rows = all.slice(start, start + Math.floor(maxRows));
	const shown = rows.reduce((n, r) => n + r.length, 0);
	return {rows, hiddenBefore: start * w, hiddenAfter: cells.length - start * w - shown};
}

const SGR_CODE: Partial<Record<Tone, number>> = {add: 32, del: 31, warn: 33, dim: 2};

export function brailleText(cells: readonly BrailleCell[], options: {color: boolean}): string {
	if (!options.color) return cells.map(cell => cell.glyph).join('');
	const esc = String.fromCharCode(27);
	let out = '';
	for (const cell of cells) {
		const code = SGR_CODE[cell.tone];
		out += code === undefined ? cell.glyph : `${esc}[${code}m${cell.glyph}${esc}[0m`;
	}
	return out + `${esc}[0m`;
}
