import {stringCells, truncateCells} from '../hints/width.js';
import {sanitizeText} from '../hints/sanitize.js';
import {sliceStyledCells, styledCells} from '../transcript/wrap.js';
import {glyph} from './glyphs.js';
import {meterBar, segmentBar} from './segment-bar.js';
import {windowStart} from './window.js';
import {SGR_ATTR, SGR_RESET, colorDepth, toneSgr, type ColorDepth, type ThemeTone} from './theme.js';

export type ChecklistItem = {text: string; state: 'done' | 'active' | 'open'};

export type ChecklistOptions = {
	title: string;
	items: readonly ChecklistItem[];
	width: number;
	mode: 'line' | 'summary' | 'full';
	maxRows?: number;
	spinner?: string;
	flash?: string;
	doneLabel?: string;
	depth?: ColorDepth;
	ascii?: boolean;
};

const TEXT_MAX = 200;
const METER_MAX = 10;
const LINE_METER_CELLS = 3;
const INDENT = '  ';

function paint(text: string, tone: ThemeTone, depth: ColorDepth): string {
	const open = toneSgr(tone, depth);
	return open === '' || text === '' ? text : `${open}${text}${SGR_RESET}`;
}

function bold(text: string, depth: ColorDepth): string {
	return depth === 'none' || text === '' ? text : `${SGR_ATTR.bold}${text}${SGR_ATTR.boldOff}`;
}

function clip(row: string, width: number, ascii: boolean): string {
	if (styledCells(row) <= width) return row;
	return `${sliceStyledCells(row, 0, Math.max(0, width - 1))}${glyph('ellipsis', {ascii})}`;
}

function oneLine(text: string): string {
	return sanitizeText(text, TEXT_MAX);
}

export function checklistRows(o: ChecklistOptions): string[] {
	const width = Math.max(1, Math.floor(Number.isFinite(o.width) ? o.width : 1));
	const depth = o.depth ?? colorDepth();
	const ascii = o.ascii === true;
	const items = o.items.map(i => ({text: oneLine(i.text), state: i.state}));
	const total = items.length;
	const done = items.filter(i => i.state === 'done').length;
	const allDone = total > 0 && done === total;
	const title = oneLine(o.title);
	const count = `${done}/${total}`;
	const meterTone: ThemeTone = allDone ? 'ok' : 'accent';
	const meter = (cells: number): string => meterBar(total === 0 ? 0 : done / total, cells, {tone: meterTone, depth, ascii});
	const icon = paint(glyph('toolTask', {ascii}), 'muted', depth);
	const head = (cells: number): string =>
		[icon, bold(title, depth), paint(count, 'muted', depth), ...(cells > 0 ? [meter(cells)] : [])].join(' ');
	const flashText = o.flash !== undefined && o.flash !== '' ? oneLine(o.flash) : allDone && o.doneLabel !== undefined ? oneLine(o.doneLabel) : '';
	const flashed = (max: number): string => {
		if (flashText === '' || max < 3) return '';
		const mark = glyph('check', {ascii});
		return paint(`${mark} ${truncateCells(flashText, max - 2, glyph('ellipsis', {ascii}))}`, 'ok', depth);
	};
	const spinner = o.spinner !== undefined && o.spinner !== '' ? o.spinner : undefined;
	const activeIndex = items.findIndex(i => i.state === 'active');
	const nextIndex = items.findIndex((i, n) => i.state === 'open' && n > activeIndex);
	const focus = activeIndex >= 0 ? activeIndex : Math.max(0, items.findIndex(i => i.state === 'open'));

	const itemRow = (i: {text: string; state: ChecklistItem['state']}): string => {
		switch (i.state) {
			case 'done':
				return `${INDENT}${paint(glyph('check', {ascii}), 'ok', depth)} ${paint(i.text, 'muted', depth)}`;
			case 'active':
				return spinner !== undefined
					? `${INDENT}${paint(spinner, 'running', depth)} ${i.text}`
					: `${INDENT}${paint(glyph('marker', {ascii}), 'running', depth)} ${i.text}`;
			case 'open':
				return `${INDENT}${paint(glyph('todo', {ascii}), 'muted', depth)} ${paint(i.text, 'muted', depth)}`;
		}
	};

	if (o.mode === 'line') {
		const shorten = (text: string, prefix: string, tone: ThemeTone | undefined): string[] => {
			const mk = (t: string): string => {
				const body = tone === undefined ? t : paint(t, tone, depth);
				return `${prefix}${body}`;
			};
			const forms = [mk(text)];
			for (const cap of [24, 12]) if (stringCells(text) > cap) forms.push(mk(truncateCells(text, cap, glyph('ellipsis', {ascii}))));
			return forms;
		};
		const segments = [
			{forms: [head(Math.min(total, METER_MAX)), head(Math.min(total, LINE_METER_CELLS)), head(0)], keep: true},
		];
		if (!allDone && activeIndex >= 0) {
			const mark = spinner !== undefined ? paint(spinner, 'running', depth) : paint(glyph('marker', {ascii}), 'running', depth);
			segments.push({forms: shorten(items[activeIndex]!.text, `${mark} `, undefined), keep: false});
		}
		if (!allDone && nextIndex >= 0) {
			segments.push({forms: shorten(items[nextIndex]!.text, 'next: ', 'muted'), keep: false});
		}
		const tail = flashed(Math.min(width, 30));
		if (tail !== '') segments.push({forms: [tail], keep: false});
		return [clip(segmentBar(segments, width, {depth, ascii}), width, ascii)];
	}

	const headRow = (): string => {
		const cells = Math.min(total, METER_MAX);
		let left = head(cells);
		let leftCells = styledCells(left);
		if (leftCells > width) {
			left = head(0);
			leftCells = styledCells(left);
		}
		if (leftCells >= width) return clip(left, width, ascii);
		const right = flashed(width - leftCells - 1);
		if (right === '') return left;
		const gap = Math.max(1, width - leftCells - styledCells(right));
		return `${left}${' '.repeat(gap)}${right}`;
	};
	const rows = [clip(headRow(), width, ascii)];

	if (o.mode === 'summary') {
		if (allDone) return rows;
		if (activeIndex >= 0) rows.push(clip(itemRow(items[activeIndex]!), width, ascii));
		if (nextIndex >= 0) rows.push(clip(itemRow(items[nextIndex]!), width, ascii));
		return rows;
	}

	const budget = o.maxRows === undefined ? total : Math.max(0, Math.floor(o.maxRows) - 1);
	if (budget <= 0 || total === 0) return rows;
	if (total <= budget) {
		for (const i of items) rows.push(clip(itemRow(i), width, ascii));
		return rows;
	}
	const size = Math.max(1, budget - 1);
	const start = windowStart(total, size, focus);
	for (const i of items.slice(start, start + size)) rows.push(clip(itemRow(i), width, ascii));
	const hidden = total - size;
	rows.push(clip(`${INDENT}${paint(`${glyph('ellipsis', {ascii})} +${hidden} more`, 'muted', depth)}`, width, ascii));
	return rows;
}
