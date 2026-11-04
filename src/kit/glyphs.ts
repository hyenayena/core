export type GlyphDef = {readonly char: string; readonly ascii?: string};

export const GLYPHS = Object.freeze({
	bullet: {char: '●', ascii: '*'},
	ellipsis: {char: '…', ascii: '.'},
	marker: {char: '›', ascii: '>'},
	arrow: {char: '→', ascii: '>'},
	check: {char: '✓', ascii: 'v'},
	cross: {char: '✗', ascii: 'x'},
	warning: {char: '⚠', ascii: '!'},
	gear: {char: '⚙', ascii: '*'},
	hRule: {char: '─', ascii: '-'},
	vRule: {char: '│', ascii: '|'},
	cornerTl: {char: '╭', ascii: '+'},
	cornerTr: {char: '╮', ascii: '+'},
	cornerBl: {char: '╰', ascii: '+'},
	cornerBr: {char: '╯', ascii: '+'},
	tee: {char: '├', ascii: '+'},
	bar: {char: '▏', ascii: '|'},
	fold: {char: '⋯', ascii: '~'},
	minus: {char: '−', ascii: '-'},
	fileCode: {char: '◇', ascii: '*'},
	fileDoc: {char: '¶', ascii: '#'},
	fileData: {char: '≡', ascii: '='},
	fileShell: {char: '$', ascii: '$'},
	fileOther: {char: '▫', ascii: '-'},
	toolRead: {char: '▤', ascii: '<'},
	toolSearch: {char: '⌕', ascii: '?'},
	toolEdit: {char: '✎', ascii: '*'},
	toolShell: {char: '$', ascii: '$'},
	toolWeb: {char: '⊕', ascii: '@'},
	toolAgent: {char: '✦', ascii: '&'},
	toolTask: {char: '☰', ascii: '#'},
	toolOther: {char: '◦', ascii: '-'},
} satisfies Record<string, GlyphDef>);

export type GlyphName = keyof typeof GLYPHS;

export const SPINNER_GLYPHS = Object.freeze({
	braille: {frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], ascii: ['|', '/', '-', '\\']},
	sparkle: {frames: ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'], ascii: ['.', '+', '*', '*', '*', '*', '*', '*', '+', '+']},
});

export type SpinnerGlyphName = keyof typeof SPINNER_GLYPHS;

export function glyph(name: GlyphName, options: {ascii?: boolean} = {}): string {
	const g: GlyphDef = GLYPHS[name];
	return options.ascii === true ? (g.ascii ?? g.char) : g.char;
}

export function spinnerFrames(name: SpinnerGlyphName, options: {ascii?: boolean} = {}): readonly string[] {
	const s = SPINNER_GLYPHS[name];
	return options.ascii === true ? s.ascii : s.frames;
}

export function asciiGlyphs(env: Readonly<Record<string, string | undefined>>): boolean {
	const term = env['TERM'];
	if (term === 'linux' || term === 'dumb') return true;
	const locale = [env['LC_ALL'], env['LC_CTYPE'], env['LANG']].find(v => v !== undefined && v !== '');
	return locale !== undefined && !/utf-?8/i.test(locale);
}
