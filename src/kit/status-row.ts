import {sanitizeBlock, sanitizeText} from '../hints/sanitize.js';
import {stringCells, truncateCells} from '../hints/width.js';
import {sliceStyledCells, styledCells, wrapRows} from '../transcript/wrap.js';
import type {CodeToken} from './diff-card.js';
import {glyph} from './glyphs.js';
import {sanitizeStyled} from './styled-sanitize.js';
import {SGR_ATTR, SGR_RESET, colorDepth, toneSgr, type ColorDepth, type ThemeTone} from './theme.js';

const DETAIL_MAX = 400;

export function formatElapsed(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return '0.0s';
	if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export type StatusRowOptions = {
	mark: string;
	glyph?: string;
	title: string;
	detail?: string;
	right?: string;
	rightTone?: ThemeTone;
	width: number;
	depth?: ColorDepth;
};

function paint(text: string, tone: ThemeTone, depth: ColorDepth): string {
	const open = toneSgr(tone, depth);
	return open === '' || text === '' ? text : `${open}${text}${SGR_RESET}`;
}

export function statusRow(o: StatusRowOptions): string {
	const width = Math.max(1, Math.floor(o.width));
	const depth = o.depth ?? colorDepth();
	const lead = [sanitizeStyled(o.mark), o.glyph === undefined || o.glyph === '' ? '' : sanitizeStyled(o.glyph)].filter(p => p !== '').join(' ');
	const title = sanitizeStyled(o.title);
	const detailText = sanitizeText(o.detail ?? '', DETAIL_MAX);
	const rightText = sanitizeText(o.right ?? '', DETAIL_MAX);
	const head = lead === '' ? title : `${lead} ${title}`;
	const headCells = styledCells(head);
	const detailCells = detailText === '' ? 0 : 2 + stringCells(detailText);
	const rightCells = rightText === '' ? 0 : 2 + stringCells(rightText);
	const rightPart = (): string => paint(rightText, o.rightTone ?? 'muted', depth);
	const finish = (row: string): string => (styledCells(row) > width ? sliceStyledCells(row, 0, width) : row);

	if (headCells + detailCells + rightCells <= width) {
		const detail = detailText === '' ? '' : `  ${paint(detailText, 'muted', depth)}`;
		if (rightText === '') return head + detail;
		const gap = width - headCells - detailCells - stringCells(rightText);
		return `${head}${detail}${' '.repeat(gap)}${rightPart()}`;
	}
	if (headCells + rightCells <= width && rightText !== '') {
		const gap = width - headCells - stringCells(rightText);
		return `${head}${' '.repeat(gap)}${rightPart()}`;
	}
	if (headCells <= width) return head;
	const cut = sliceStyledCells(head, 0, Math.max(0, width - 1));
	return finish(`${cut}${glyph('ellipsis')}`);
}

export type RuledRowsOptions = {
	width: number;
	maxRows?: number;
	keep?: 'head' | 'tail';
	indent?: number;
	tone?: ThemeTone;
	ruleTone?: ThemeTone;
	ascii?: boolean;
	depth?: ColorDepth;
	moreHint?: string;
};

export function ruledRows(lines: readonly string[], o: RuledRowsOptions): string[] {
	const width = Math.max(1, Math.floor(o.width));
	const depth = o.depth ?? colorDepth();
	const ascii = o.ascii === true;
	const indent = Math.max(0, Math.floor(o.indent ?? 2));
	const textWidth = Math.max(1, width - indent - 2);
	const rows = lines.flatMap(l => sanitizeBlock(l).split('\n')).flatMap(l => wrapRows(l, textWidth, {mode: 'char'}));
	if (rows.length === 0) return [];
	const rule = paint(glyph('vRule', {ascii}), o.ruleTone ?? 'frame', depth);
	const tone = o.tone ?? 'muted';
	const line = (text: string): string => {
		const row = `${' '.repeat(indent)}${rule} ${paint(text, tone, depth)}`;
		return styledCells(row) > width ? sliceStyledCells(row, 0, width) : row;
	};
	const max = o.maxRows;
	if (max === undefined || max < 2 || rows.length <= max) return rows.map(line);
	const hidden = rows.length - (max - 1);
	const hint = o.moreHint ?? '(ctrl+o to expand)';
	const tail = o.keep === 'tail';
	const more = `${glyph('ellipsis', {ascii})} +${hidden} ${tail ? 'earlier lines' : 'lines'}${hint === '' ? '' : ` ${hint}`}`;
	const moreRow = line(truncateCells(more, textWidth));
	return tail ? [moreRow, ...rows.slice(hidden).map(line)] : [...rows.slice(0, max - 1).map(line), moreRow];
}

// Syntax colours only where the terminal can show distinct hues (as the diff card does).
export function paintTokens(tokens: readonly CodeToken[], depth: ColorDepth = colorDepth()): string {
	const syntax = depth === 'truecolor' || depth === '256';
	return tokens
		.map(t => {
			if (!syntax || t.tone === undefined) return t.text;
			const open = toneSgr(t.tone, depth);
			return open === '' || t.text === '' ? t.text : `${open}${t.text}${SGR_ATTR.fgOff}`;
		})
		.join('');
}
