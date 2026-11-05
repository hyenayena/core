import {sliceStyledCells, styledCells} from '../transcript/wrap.js';
import {glyph} from './glyphs.js';
import {sanitizeStyled} from './styled-sanitize.js';
import {SGR_RESET, colorDepth, toneSgr, type ColorDepth, type ThemeTone} from './theme.js';

export type BarSegment = {forms: readonly string[]; keep?: boolean};

export type SegmentBarOptions = {separator?: string; depth?: ColorDepth; ascii?: boolean};

export type MeterBarOptions = {tone?: ThemeTone; emptyTone?: ThemeTone; ascii?: boolean; depth?: ColorDepth};

const DEFAULT_SEPARATOR = ' · ';

function paint(text: string, tone: ThemeTone, depth: ColorDepth): string {
	const open = toneSgr(tone, depth);
	return open === '' || text === '' ? text : `${open}${text}${SGR_RESET}`;
}

export function segmentBar(segments: readonly BarSegment[], width: number, options: SegmentBarOptions = {}): string {
	const max = Math.max(1, Math.floor(Number.isFinite(width) ? width : 1));
	const depth = options.depth ?? colorDepth();
	const separator = paint(options.separator ?? DEFAULT_SEPARATOR, 'muted', depth);
	const items = segments
		.map(s => ({forms: s.forms.map(f => sanitizeStyled(f)).filter(f => f !== ''), keep: s.keep === true}))
		.filter(s => s.forms.length > 0);
	const pick = items.map(() => 0);
	const compose = (alive: readonly number[]): string => alive.map(i => items[i]!.forms[pick[i]!]!).join(separator);
	let alive = items.map((_, i) => i);
	const fits = (): boolean => styledCells(compose(alive)) <= max;

	if (fits()) return compose(alive);
	for (let i = items.length - 1; i >= 0; i--) {
		while (pick[i]! < items[i]!.forms.length - 1) {
			pick[i]!++;
			if (fits()) return compose(alive);
		}
	}
	for (let i = items.length - 1; i >= 0; i--) {
		if (items[i]!.keep || alive.length === 1) continue;
		alive = alive.filter(a => a !== i);
		if (fits()) return compose(alive);
	}
	const row = compose(alive);
	if (styledCells(row) <= max) return row;
	return `${sliceStyledCells(row, 0, Math.max(0, max - 1))}${glyph('ellipsis', {ascii: options.ascii === true})}`;
}

export function meterBar(fraction: number, cells: number, options: MeterBarOptions = {}): string {
	const total = Math.max(0, Math.floor(Number.isFinite(cells) ? cells : 0));
	const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
	const depth = options.depth ?? colorDepth();
	const ascii = options.ascii === true;
	const on = Math.round(f * total);
	const filled = glyph('meterOn', {ascii}).repeat(on);
	const empty = glyph('meterOff', {ascii}).repeat(total - on);
	return paint(filled, options.tone ?? 'accent', depth) + paint(empty, options.emptyTone ?? 'frame', depth);
}
