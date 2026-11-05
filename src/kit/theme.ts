import type {SpanTone} from '../../../../src/api.js';

export type ColorDepth = 'truecolor' | '256' | '16' | 'none';

export const COLOR_DEPTHS: readonly ColorDepth[] = Object.freeze(['truecolor', '256', '16', 'none'] as const);

export const THEME_TONES = [
	'text',
	'muted',
	'accent',
	'ok',
	'warn',
	'error',
	'added',
	'removed',
	'addedBg',
	'removedBg',
	'addedWord',
	'removedWord',
	'focus',
	'frame',
	'running',
	'surface',
	'heading',
	'link',
	'code.inline',
	'code.keyword',
	'code.string',
	'code.number',
	'code.comment',
	'code.function',
	'code.type',
	'code.constant',
	'code.variable',
	'code.attribute',
	'code.tag',
	'code.regexp',
	'code.meta',
	'code.punctuation',
] as const;

export type ThemeTone = (typeof THEME_TONES)[number];

export type Hex = `#${string}`;
export type Ansi16 = number;

export type Attrs = {bold?: true; dim?: true; italic?: true; underline?: true; inverse?: true; strike?: true};

export type ToneDef = {
	truecolor: Attrs & {fg?: Hex; bg?: Hex};
	c256: Attrs & {fg?: number; bg?: number};
	c16: Attrs & {fg?: Ansi16; bg?: Ansi16};
	none: Attrs;
};

export type Theme = Readonly<Record<ThemeTone, ToneDef>>;

const B = {bold: true} as const;
const D = {dim: true} as const;
const I = {italic: true} as const;
const U = {underline: true} as const;

const def = (truecolor: ToneDef['truecolor'], c256: ToneDef['c256'], c16: ToneDef['c16'], none: Attrs = {}): ToneDef => ({truecolor, c256, c16, none});

const OK = def({fg: '#98c379'}, {fg: 114}, {fg: 2});
const ERROR = def({fg: '#e06c75'}, {fg: 168}, {fg: 1});

const DARK: Record<ThemeTone, ToneDef> = {
	text: def({}, {}, {}),
	muted: def({fg: '#8b8b8b'}, {fg: 245}, D, D),
	accent: def({fg: '#56b6c2'}, {fg: 73}, {fg: 6}),
	ok: OK,
	warn: def({fg: '#e5c07b'}, {fg: 180}, {fg: 3}),
	error: ERROR,
	added: OK,
	removed: ERROR,
	addedBg: def({bg: '#1f3a24'}, {bg: 22}, {fg: 2}),
	removedBg: def({bg: '#4a1f24'}, {bg: 52}, {fg: 1}),
	addedWord: def({bg: '#2f6b3a', ...B}, {bg: 28, ...B}, {fg: 2, inverse: true}, {...B, underline: true}),
	removedWord: def({bg: '#7a2e36', ...B}, {bg: 88, ...B}, {fg: 1, inverse: true}, {inverse: true}),
	focus: def({fg: '#61afef', ...B}, {fg: 75, ...B}, {fg: 4, ...B}, B),
	frame: def({fg: '#5c6370'}, {fg: 241}, D, D),
	running: def({fg: '#d77757'}, {fg: 173}, {fg: 3}),
	surface: def({bg: '#3a3a3a'}, {bg: 237}, {bg: 8}),
	heading: def({fg: '#61afef', ...B}, {fg: 75, ...B}, {fg: 4, ...B}, B),
	link: def({fg: '#56b6c2', ...U}, {fg: 73, ...U}, {fg: 6, ...U}, U),
	'code.inline': def({fg: '#d19a66'}, {fg: 173}, {fg: 3}),
	'code.keyword': def({fg: '#c678dd'}, {fg: 170}, {fg: 5}),
	'code.string': def({fg: '#98c379'}, {fg: 114}, {fg: 2}),
	'code.number': def({fg: '#d19a66'}, {fg: 173}, {fg: 3}),
	'code.comment': def({fg: '#7f848e', ...I}, {fg: 244, ...I}, D, D),
	'code.function': def({fg: '#61afef'}, {fg: 75}, {fg: 4}),
	'code.type': def({fg: '#e5c07b'}, {fg: 180}, {fg: 3}),
	'code.constant': def({fg: '#56b6c2'}, {fg: 73}, {fg: 6}),
	'code.variable': def({}, {}, {}),
	'code.attribute': def({fg: '#d19a66'}, {fg: 173}, {fg: 3}),
	'code.tag': def({fg: '#e06c75'}, {fg: 168}, {fg: 1}),
	'code.regexp': def({fg: '#56b6c2'}, {fg: 73}, {fg: 6}),
	'code.meta': def({fg: '#7f848e'}, {fg: 244}, D, D),
	'code.punctuation': def({}, {}, {}),
};

export const DARK_THEME: Theme = Object.freeze(DARK);

export const activeTheme = (): Theme => DARK_THEME;

export const SPAN_TONE_THEME: Readonly<Record<SpanTone, ThemeTone>> = Object.freeze({accent: 'accent', muted: 'muted', ok: 'ok', warn: 'warn', error: 'error'});

export function detectColorDepth(env: Readonly<Record<string, string | undefined>>): ColorDepth {
	const noColor = env['NO_COLOR'];
	const forced = env['YENA_COLOR'];
	const colorterm = env['COLORTERM'];
	const term = env['TERM'];
	if (noColor !== undefined && noColor !== '') return 'none';
	if (forced !== undefined && (COLOR_DEPTHS as readonly string[]).includes(forced)) return forced as ColorDepth;
	if (colorterm === 'truecolor' || colorterm === '24bit' || (term !== undefined && term.endsWith('-direct'))) return 'truecolor';
	if (term !== undefined && term.includes('256color')) return '256';
	if (term === 'dumb') return 'none';
	return '16';
}

let detected: ColorDepth | undefined;
let colorsOn = true;
const overrides: ColorDepth[] = [];

export function setColorsEnabled(on: boolean): void {
	colorsOn = on;
}

export function colorDepth(env?: Readonly<Record<string, string | undefined>>): ColorDepth {
	const top = overrides.at(-1);
	if (top !== undefined) return top;
	if (!colorsOn) return 'none';
	if (env !== undefined) return detectColorDepth(env);
	return (detected ??= detectColorDepth(process.env));
}

export function withColorDepth<T>(depth: ColorDepth, fn: () => T): T {
	overrides.push(depth);
	try {
		return fn();
	} finally {
		overrides.pop();
	}
}

export function resetColorDepthCacheForTests(): void {
	detected = undefined;
	colorsOn = true;
	overrides.length = 0;
	sgrTables.clear();
	inkTables.clear();
}

const ESC = String.fromCharCode(27);
export const SGR_RESET = `${ESC}[0m`;

export const SGR_ATTR = Object.freeze({
	reset: SGR_RESET,
	bold: `${ESC}[1m`,
	boldOff: `${ESC}[22m`,
	dim: `${ESC}[2m`,
	italic: `${ESC}[3m`,
	italicOff: `${ESC}[23m`,
	underline: `${ESC}[4m`,
	underlineOff: `${ESC}[24m`,
	inverse: `${ESC}[7m`,
	inverseOff: `${ESC}[27m`,
	strike: `${ESC}[9m`,
	strikeOff: `${ESC}[29m`,
	fgOff: `${ESC}[39m`,
	bgOff: `${ESC}[49m`,
});

type Layer = Attrs & {fg?: Hex | number; bg?: Hex | number};

function layerOf(d: ToneDef, depth: ColorDepth): Layer {
	switch (depth) {
		case 'truecolor':
			return d.truecolor;
		case '256':
			return d.c256;
		case '16':
			return d.c16;
		case 'none':
			return d.none;
	}
}

function attrCodes(l: Attrs): string[] {
	const out: string[] = [];
	if (l.bold) out.push('1');
	if (l.dim) out.push('2');
	if (l.italic) out.push('3');
	if (l.underline) out.push('4');
	if (l.inverse) out.push('7');
	if (l.strike) out.push('9');
	return out;
}

function hexRgb(hex: string): string {
	const n = parseInt(hex.slice(1), 16);
	return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}

function colorCode(v: Hex | number, depth: ColorDepth, bg: boolean): string {
	if (depth === 'truecolor') return `${bg ? 48 : 38};2;${hexRgb(v as string)}`;
	if (depth === '256') return `${bg ? 48 : 38};5;${v as number}`;
	const i = v as number;
	return String(i < 8 ? (bg ? 40 : 30) + i : (bg ? 100 : 90) + i - 8);
}

function paramsOf(d: ToneDef, depth: ColorDepth): string {
	const l = layerOf(d, depth);
	const codes = attrCodes(l);
	if (depth !== 'none') {
		if (l.fg !== undefined) codes.push(colorCode(l.fg, depth, false));
		if (l.bg !== undefined) codes.push(colorCode(l.bg, depth, true));
	}
	return codes.join(';');
}

const sgrTables = new Map<Theme, Map<ColorDepth, Readonly<Record<ThemeTone, string>>>>();

export function sgrTable(depth: ColorDepth = colorDepth()): Readonly<Record<ThemeTone, string>> {
	const theme = activeTheme();
	let byDepth = sgrTables.get(theme);
	if (!byDepth) sgrTables.set(theme, (byDepth = new Map()));
	let table = byDepth.get(depth);
	if (!table) {
		const t = {} as Record<ThemeTone, string>;
		for (const tone of THEME_TONES) {
			const p = paramsOf(theme[tone], depth);
			t[tone] = p === '' ? '' : `${ESC}[${p}m`;
		}
		byDepth.set(depth, (table = Object.freeze(t)));
	}
	return table;
}

export const toneSgr = (tone: ThemeTone, depth?: ColorDepth): string => sgrTable(depth)[tone];

// Parameters without the ESC[ ... m frame, for callers that merge them into one sequence.
export const toneParams = (tone: ThemeTone, depth: ColorDepth = colorDepth()): string => paramsOf(activeTheme()[tone], depth);

export function paintTone(text: string, tone: ThemeTone, depth?: ColorDepth): string {
	const open = toneSgr(tone, depth);
	if (open === '' || text === '') return text;
	return text
		.split('\n')
		.map(l => (l === '' ? l : `${open}${l}${SGR_RESET}`))
		.join('\n');
}

export type InkToneProps = {
	color?: string;
	backgroundColor?: string;
	bold?: true;
	dimColor?: true;
	italic?: true;
	underline?: true;
	inverse?: true;
	strikethrough?: true;
};

const CHALK = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

function inkColor(v: Hex | number, depth: ColorDepth): string {
	if (depth === 'truecolor') return v as string;
	if (depth === '256') return `ansi256(${v as number})`;
	const i = v as number;
	return i < 8 ? CHALK[i]! : `${CHALK[i - 8]}Bright`;
}

const inkTables = new Map<Theme, Map<ColorDepth, Readonly<Record<ThemeTone, Readonly<InkToneProps>>>>>();

function inkTable(depth: ColorDepth): Readonly<Record<ThemeTone, Readonly<InkToneProps>>> {
	const theme = activeTheme();
	let byDepth = inkTables.get(theme);
	if (!byDepth) inkTables.set(theme, (byDepth = new Map()));
	let table = byDepth.get(depth);
	if (!table) {
		const t = {} as Record<ThemeTone, Readonly<InkToneProps>>;
		for (const tone of THEME_TONES) {
			const l = layerOf(theme[tone], depth);
			const p: InkToneProps = {};
			if (depth !== 'none') {
				if (l.fg !== undefined) p.color = inkColor(l.fg, depth);
				if (l.bg !== undefined) p.backgroundColor = inkColor(l.bg, depth);
			}
			if (l.bold) p.bold = true;
			if (l.dim) p.dimColor = true;
			if (l.italic) p.italic = true;
			if (l.underline) p.underline = true;
			if (l.inverse) p.inverse = true;
			if (l.strike) p.strikethrough = true;
			t[tone] = Object.freeze(p);
		}
		byDepth.set(depth, (table = Object.freeze(t)));
	}
	return table;
}

export const inkTone = (tone: ThemeTone, depth: ColorDepth = colorDepth()): Readonly<InkToneProps> => inkTable(depth)[tone];
