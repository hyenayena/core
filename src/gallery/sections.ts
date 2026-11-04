import {styledCells} from '../transcript/wrap.js';
import {stringCells, truncateCells} from '../hints/width.js';
import {defineBuiltinSection, type GalleryRenderer} from '../kit/gallery.js';
import {GLYPHS, SPINNER_GLYPHS} from '../kit/glyphs.js';
import {COLOR_DEPTHS, SGR_ATTR, THEME_TONES, paintTone, type ColorDepth} from '../kit/theme.js';

const SAMPLE = 'Sample text';
const SAMPLE_CELLS = 12;
const NAME_CELLS = 16;

const padStyled = (s: string, cells: number): string => s + ' '.repeat(Math.max(0, cells - styledCells(s)));

const pad = (s: string, cells: number): string => s + ' '.repeat(Math.max(0, cells - stringCells(s)));

const themeRenderer: GalleryRenderer = ({width, depth}) => {
	const nameW = Math.min(NAME_CELLS, Math.max(6, width - SAMPLE_CELLS - 1));
	const cols: ColorDepth[] = [...COLOR_DEPTHS];
	while (cols.length > 1 && nameW + 1 + cols.length * SAMPLE_CELLS > width) cols.splice(cols.map(d => d === depth).lastIndexOf(false), 1);
	const label = (d: ColorDepth) => (d === depth ? `${SGR_ATTR.bold}${d}${SGR_ATTR.reset}` : paintTone(d, 'muted', depth));
	const rows = [' '.repeat(nameW + 1) + cols.map(d => padStyled(label(d), SAMPLE_CELLS)).join('')];
	for (const tone of THEME_TONES) {
		rows.push(pad(truncateCells(tone, nameW), nameW + 1) + cols.map(d => padStyled(paintTone(SAMPLE, tone, d), SAMPLE_CELLS)).join(''));
	}
	return rows;
};

const glyphsRenderer: GalleryRenderer = ({width, ascii}) => {
	const items = Object.entries(GLYPHS).map(([name, g]) => {
		const shown = ascii ? g.ascii : g.char;
		return `${name} ${shown} (${g.ascii})`;
	});
	const itemW = Math.max(...items.map(stringCells)) + 2;
	const perRow = Math.max(1, Math.floor((width + 2) / itemW));
	const rows: string[] = [];
	for (let i = 0; i < items.length; i += perRow) {
		rows.push(
			items
				.slice(i, i + perRow)
				.map(it => pad(truncateCells(it, Math.min(itemW - 2, width)), itemW))
				.join('')
				.trimEnd(),
		);
	}
	for (const [name, s] of Object.entries(SPINNER_GLYPHS)) {
		rows.push(truncateCells(`${name}: ${(ascii ? s.ascii : s.frames).join(' ')}`, width));
	}
	rows.push(paintTone(ascii ? 'ASCII fallbacks are in use' : 'Unicode glyphs are in use; the ASCII fallback is in brackets', 'muted'));
	return rows;
};

export function registerBuiltinSections(): void {
	defineBuiltinSection({name: 'theme', title: 'Theme', description: 'Every tone at the active colour depth', load: () => themeRenderer});
	defineBuiltinSection({name: 'glyphs', title: 'Glyphs', description: 'Symbols and their ASCII fallbacks', load: () => glyphsRenderer});
}
