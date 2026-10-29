const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}/u;
const PICTOGRAPHIC = /^\p{Extended_Pictographic}/u;
const MARK = /^\p{M}/u;

const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x1100, 0x115f],
	[0x2e80, 0x303e],
	[0x3041, 0x33ff],
	[0x3400, 0x4dbf],
	[0x4e00, 0x9fff],
	[0xa000, 0xa4cf],
	[0xa960, 0xa97f],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe30, 0xfe6f],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x20000, 0x3fffd],
];

export function graphemes(s: string): string[] {
	if (typeof s !== 'string' || s === '') return [];
	const out: string[] = [];
	for (const part of segmenter.segment(s)) out.push(part.segment);
	return out;
}

export function cellWidth(g: string): 0 | 1 | 2 {
	if (typeof g !== 'string' || g === '') return 0;
	const cp = g.codePointAt(0) as number;
	if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 0;
	if ((cp >= 0x200b && cp <= 0x200d) || cp === 0x2060 || cp === 0xfeff) return 0;
	if (MARK.test(g)) return 0;
	if (g.includes('️') && PICTOGRAPHIC.test(g)) return 2;
	if (EMOJI_PRESENTATION.test(g)) return 2;
	for (const [lo, hi] of WIDE_RANGES) {
		if (cp >= lo && cp <= hi) return 2;
	}
	return 1;
}

export function stringCells(s: string): number {
	let n = 0;
	for (const g of graphemes(s)) n += cellWidth(g);
	return n;
}

export function truncateCells(s: string, max: number, ellipsis = '…'): string {
	if (!(max > 0)) return '';
	if (stringCells(s) <= max) return s;
	const budget = max - stringCells(ellipsis);
	if (budget < 0) return sliceCells(s, 0, max);
	return sliceCells(s, 0, budget) + ellipsis;
}

export function sliceCells(s: string, startCell: number, maxCells: number): string {
	if (!(maxCells > 0)) return '';
	const start = Math.max(0, startCell);
	const end = start + maxCells;
	let pos = 0;
	let out = '';
	for (const g of graphemes(s)) {
		const w = cellWidth(g);
		if (pos >= start && pos + w <= end) out += g;
		pos += w;
		if (pos >= end) break;
	}
	return out;
}
