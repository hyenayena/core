import type {Command, CommandContext, Logger} from '../../../../src/api.js';
import {sliceStyledCells, stripStyles} from '../transcript/wrap.js';
import {commandError} from '../kit/command-error.js';
import {loadGallery, renderGallery} from '../kit/gallery.js';
import {asciiGlyphs} from '../kit/glyphs.js';
import {COLOR_DEPTHS, colorDepth, paintTone, withColorDepth, type ColorDepth} from '../kit/theme.js';
import {registerBuiltinSections} from './sections.js';

const MIN_WIDTH = 20;
const MAX_WIDTH = 500;
const MIN_ROWS = 6;
const MAX_ROWS = 200;
const DEFAULT_ROWS = 24;
const USAGE = 'ui gallery [section…] [--width <n>] [--rows <n>] [--depth <depth>] [--ascii]';

type Parsed = {sections: string[]; width?: number; rows?: number; depth?: ColorDepth; ascii: boolean};

function parseGallery(args: readonly string[]): Parsed {
	const out: Parsed = {sections: [], ascii: false};
	for (let i = 0; i < args.length; i++) {
		const a = args[i]!;
		if (a === '--ascii') out.ascii = true;
		else if (a === '--width') {
			const v = args[++i];
			const n = Number(v);
			if (v === undefined || !/^\d+$/.test(v) || n < MIN_WIDTH || n > MAX_WIDTH) {
				throw commandError('invalid', `--width needs a number of columns from ${MIN_WIDTH} to ${MAX_WIDTH}. See "ui gallery help"`);
			}
			out.width = n;
		} else if (a === '--rows') {
			const v = args[++i];
			const n = Number(v);
			if (v === undefined || !/^\d+$/.test(v) || n < MIN_ROWS || n > MAX_ROWS) {
				throw commandError('invalid', `--rows needs a number of rows from ${MIN_ROWS} to ${MAX_ROWS}. See "ui gallery help"`);
			}
			out.rows = n;
		} else if (a === '--depth') {
			const v = args[++i];
			if (v === undefined || !(COLOR_DEPTHS as readonly string[]).includes(v)) {
				throw commandError('invalid', `--depth needs one of: ${COLOR_DEPTHS.join(', ')}. See "ui gallery help"`);
			}
			out.depth = v as ColorDepth;
		} else if (a.startsWith('-')) throw commandError('usage', `Unknown option: ${a.slice(0, 64)}. See "ui gallery help"`);
		else out.sections.push(a);
	}
	return out;
}

async function gallery(args: readonly string[], ctx: CommandContext, log: Logger): Promise<void> {
	const {sections, width, rows, depth, ascii} = parseGallery(args);
	const started = Date.now();
	const loaded = await loadGallery(sections);
	const useAscii = ascii || asciiGlyphs(process.env);
	const onError = (section: string, err: unknown) => log.warn('gallery section failed', {section, err});
	const plain = stripStyles(renderGallery(loaded, {width: (width ?? 80) - 1, rows: rows ?? DEFAULT_ROWS, depth: 'none', ascii: useAscii}, onError).join('\n'));
	ctx.print(plain, {
		render: w => {
			const laidOut = width !== undefined ? width - 1 : w;
			const d = depth ?? colorDepth();
			const out = renderGallery(loaded, {width: laidOut, rows: rows ?? DEFAULT_ROWS, depth: d, ascii: useAscii});
			if (laidOut <= w) return out.join('\n');
			const note = withColorDepth(d, () => paintTone(`laid out for ${width} columns, cut to ${w}`, 'muted'));
			return [...out.map(row => sliceStyledCells(row, 0, w)), sliceStyledCells(note, 0, w)].join('\n');
		},
	});
	log.debug('gallery', {sections: loaded.map(l => l.section.name), ms: Date.now() - started});
}

export function createUiCommand(log: Logger): Command {
	registerBuiltinSections();
	return {
		name: 'ui',
		description: 'Look at the shared interface pieces',
		usage: 'ui <subcommand>',
		args: [{name: 'subcommand', description: 'What to show; ui help lists them'}],
		agent: 'safe',
		subcommands: [
			{
				name: 'gallery',
				usage: USAGE,
				description: 'Show the theme, glyphs and module samples',
				args: [{name: 'section', description: 'Section to show; none shows all'}],
				options: [
					{name: '--width', value: '<n>', description: 'Terminal columns to lay out for, 20 to 500'},
					{name: '--rows', value: '<n>', description: 'Terminal rows to lay out for, 6 to 200'},
					{name: '--depth', value: '<depth>', description: 'truecolor, 256, 16 or none; default: detected'},
					{name: '--ascii', description: 'Use the ASCII fallbacks of the glyphs'},
				],
				notes: ['Built-in sections: theme, glyphs, console.', 'Modules add their own sections.'],
			},
		],
		async run(args, ctx) {
			const [sub, ...rest] = args;
			switch (sub) {
				case undefined:
					return ctx.showHelp ? ctx.showHelp() : ctx.print('ui <subcommand>');
				case 'gallery':
					return gallery(rest, ctx, log);
				default:
					throw commandError('usage', `Unknown subcommand: ${sub.slice(0, 64)}. See "ui help"`);
			}
		},
	};
}
