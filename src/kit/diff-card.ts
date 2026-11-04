import {sanitizeBlock, sanitizeText} from '../hints/sanitize.js';
import {cellWidth, graphemes, sliceCells, stringCells, truncateCells} from '../hints/width.js';
import {sliceStyledCells, styledCells} from '../transcript/wrap.js';
import {glyph, type GlyphName} from './glyphs.js';
import {SGR_ATTR, SGR_RESET, colorDepth, toneParams, type ColorDepth, type ThemeTone} from './theme.js';
import {pairRuns, wordDiff, type Range} from './word-diff.js';

export type DiffCardRow =
	| {kind: 'ctx' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number}
	| {kind: 'fold'; count?: number; text?: string}
	| {kind: 'note'; text: string};

export type CodeToken = {text: string; tone?: ThemeTone};

export type DiffHighlighter = (lines: readonly string[]) => readonly (readonly CodeToken[])[] | undefined;

// `plain` draws add rows without tint and sign (a created file or a new cell source); `created` implies it.
export type DiffCard = {path: string; tool?: string; added: number; removed: number; created?: boolean; plain?: boolean; rows: readonly DiffCardRow[]};

export type PrepareOptions = {scrub?: (line: string) => string; highlight?: DiffHighlighter; foldContext?: number};

export type RenderOptions = {
	width: number;
	depth?: ColorDepth;
	ascii?: boolean;
	header?: boolean;
	indent?: number;
	rule?: boolean;
	layout?: 'auto' | 'unified' | 'split';
	maxRows?: number;
	tailRows?: number;
	moreHint?: string;
	lead?: string;
	right?: string;
};

export const SIDE_BY_SIDE_MIN_WIDTH = 159;
const TWO_GUTTERS_MIN_WIDTH = 60;
const HIGHLIGHT_MAX_LINES = 2000;
const HIGHLIGHT_MAX_CHARS = 64 * 1024;
const HIGHLIGHT_MAX_LINE = 1000;
const HIGHLIGHT_CARD_BUDGET = 256 * 1024;
const PATH_MAX = 400;
const ESC = String.fromCharCode(27);

type Seg = {text: string; tone?: ThemeTone; word?: true};

type PreparedLine = {kind: 'ctx' | 'add' | 'del'; oldNo?: number; newNo?: number; text: string; segs: Seg[]};
type PreparedFold = {kind: 'fold'; label: string};
type PreparedNote = {kind: 'note'; text: string};
type PreparedItem = PreparedLine | PreparedFold | PreparedNote;

export type PreparedDiffCard = {
	readonly path: string;
	readonly tool?: string;
	readonly added: number;
	readonly removed: number;
	readonly created: boolean;
	readonly plain: boolean;
	readonly items: readonly PreparedItem[];
	readonly maxNo: number;
	readonly hasOld: boolean;
	readonly hasNew: boolean;
};

const defaultScrub = (line: string): string => sanitizeBlock(line).replace(/\n/g, ' ');

function foldLabel(row: {count?: number; text?: string}, scrub: (s: string) => string): string {
	if (typeof row.count === 'number' && Number.isFinite(row.count) && row.count >= 0) {
		const n = Math.floor(row.count);
		return `${n} unchanged line${n === 1 ? '' : 's'}`;
	}
	return typeof row.text === 'string' && row.text !== '' ? scrub(row.text) : 'unchanged lines';
}

function segsOf(text: string, tokens: readonly CodeToken[] | undefined, ranges: readonly Range[] | undefined): Seg[] {
	const toks: readonly CodeToken[] = tokens ?? [{text}];
	if (ranges === undefined || ranges.length === 0) return toks.filter(t => t.text !== '').map(t => (t.tone === undefined ? {text: t.text} : {text: t.text, tone: t.tone}));
	const edges = [...new Set(ranges.flatMap(r => [r.from, r.to]))].sort((a, b) => a - b);
	const out: Seg[] = [];
	let pos = 0;
	for (const t of toks) {
		const end = pos + t.text.length;
		let from = pos;
		for (const e of [...edges.filter(x => x > pos && x < end), end]) {
			if (e > from) {
				const word = ranges.some(r => r.from <= from && e <= r.to);
				const seg: Seg = {text: t.text.slice(from - pos, e - pos)};
				if (t.tone !== undefined) seg.tone = t.tone;
				if (word) seg.word = true;
				out.push(seg);
				from = e;
			}
		}
		pos = end;
	}
	return out;
}

function highlightSide(lines: PreparedLine[], assign: (l: PreparedLine) => boolean, highlight: DiffHighlighter, budget: {left: number}, tokens: Map<PreparedLine, CodeToken[]>): void {
	if (lines.length === 0 || lines.length > HIGHLIGHT_MAX_LINES) return;
	let chars = 0;
	for (const l of lines) {
		if (l.text.length > HIGHLIGHT_MAX_LINE) return;
		chars += l.text.length + 1;
	}
	if (chars > HIGHLIGHT_MAX_CHARS || chars > budget.left) return;
	budget.left -= chars;
	let result: ReturnType<DiffHighlighter>;
	try {
		result = highlight(lines.map(l => l.text));
	} catch {
		return;
	}
	if (!Array.isArray(result) || result.length !== lines.length) return;
	lines.forEach((l, i) => {
		if (!assign(l)) return;
		const row = result![i];
		if (!Array.isArray(row)) return;
		const ok = row.every(t => t !== null && typeof t === 'object' && typeof t.text === 'string') && row.map(t => t.text).join('') === l.text;
		if (ok) tokens.set(l, row.map(t => ({...t})));
	});
}

export function prepareDiffCard(card: DiffCard, options: PrepareOptions = {}): PreparedDiffCard {
	const scrub = options.scrub ?? defaultScrub;
	const clean = (s: string): string => scrub(String(s).replace(/\t/g, '    '));
	const fc = Math.max(0, Math.floor(options.foldContext ?? 3));
	const plain = card.created === true || card.plain === true;

	const folded: DiffCardRow[] = [];
	for (let i = 0; i < card.rows.length; ) {
		if (card.rows[i]!.kind !== 'ctx') {
			folded.push(card.rows[i++]!);
			continue;
		}
		let j = i;
		while (j < card.rows.length && card.rows[j]!.kind === 'ctx') j++;
		const run = card.rows.slice(i, j);
		if (run.length > 2 * fc + 1) {
			folded.push(...run.slice(0, fc), {kind: 'fold', count: run.length - 2 * fc}, ...run.slice(run.length - fc));
		} else folded.push(...run);
		i = j;
	}

	const items: PreparedItem[] = folded.map(r => {
		if (r.kind === 'fold') return {kind: 'fold', label: foldLabel(r, clean)};
		if (r.kind === 'note') return {kind: 'note', text: clean(r.text)};
		const line: PreparedLine = {kind: r.kind, text: clean(r.text), segs: []};
		if (typeof r.oldNo === 'number') line.oldNo = r.oldNo;
		if (typeof r.newNo === 'number') line.newNo = r.newNo;
		return line;
	});

	const ranges = new Map<PreparedLine, Range[]>();
	if (!plain) {
		const pairs = pairRuns(items.map(it => (it.kind === 'add' || it.kind === 'del' || it.kind === 'ctx' ? it.kind : 'ctx')));
		for (const [d, a] of pairs) {
			const del = items[d] as PreparedLine;
			const add = items[a] as PreparedLine;
			const diff = wordDiff(del.text, add.text);
			if (diff === undefined) continue;
			ranges.set(del, diff.a);
			ranges.set(add, diff.b);
		}
	}

	const tokens = new Map<PreparedLine, CodeToken[]>();
	if (options.highlight !== undefined) {
		const budget = {left: HIGHLIGHT_CARD_BUDGET};
		let block: PreparedLine[] = [];
		const flush = () => {
			if (block.length === 0) return;
			const newSide = block.filter(l => l.kind !== 'del');
			highlightSide(newSide, () => true, options.highlight!, budget, tokens);
			if (!plain && block.some(l => l.kind === 'del')) {
				highlightSide(
					block.filter(l => l.kind !== 'add'),
					l => l.kind === 'del',
					options.highlight!,
					budget,
					tokens,
				);
			}
			block = [];
		};
		for (const it of items) {
			if (it.kind === 'fold' || it.kind === 'note') flush();
			else block.push(it);
		}
		flush();
	}

	let maxNo = 0;
	let hasOld = false;
	let hasNew = false;
	for (const it of items) {
		if (it.kind === 'fold' || it.kind === 'note') continue;
		it.segs = segsOf(it.text, tokens.get(it), ranges.get(it));
		if (it.oldNo !== undefined) {
			hasOld = true;
			maxNo = Math.max(maxNo, it.oldNo);
		}
		if (it.newNo !== undefined) {
			hasNew = true;
			maxNo = Math.max(maxNo, it.newNo);
		}
	}

	return {
		path: sanitizeText(card.path, PATH_MAX),
		...(card.tool !== undefined && {tool: card.tool}),
		added: card.added,
		removed: card.removed,
		created: card.created === true,
		plain,
		items,
		maxNo,
		hasOld,
		hasNew,
	};
}

const CODE_EXT = new Set(
	'ts tsx js jsx mjs cjs mts cts py go rs java kt kts swift c h cc cpp cxx hpp hh cs php rb sql lua css scss sass html htm vue svelte'.split(' '),
);
const DOC_EXT = new Set(['md', 'markdown', 'txt', 'rst', 'adoc']);
const DATA_EXT = new Set(['json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'csv', 'lock']);
const SHELL_EXT = new Set(['sh', 'bash', 'zsh', 'fish']);
const SHELL_NAMES = new Set(['dockerfile', 'makefile', '.bashrc', '.profile', '.zshrc']);

export function fileKindGlyph(path: string): GlyphName {
	const name = (path.split('/').pop() ?? '').toLowerCase();
	if (SHELL_NAMES.has(name)) return 'fileShell';
	const dot = name.lastIndexOf('.');
	const ext = dot > 0 ? name.slice(dot + 1) : '';
	if (CODE_EXT.has(ext)) return 'fileCode';
	if (DOC_EXT.has(ext)) return 'fileDoc';
	if (DATA_EXT.has(ext)) return 'fileData';
	if (SHELL_EXT.has(ext)) return 'fileShell';
	return 'fileOther';
}

type Run = {text: string; params: string};

function paint(runs: readonly Run[]): string {
	let out = '';
	let cur = '';
	for (const r of runs) {
		if (r.text === '') continue;
		if (r.params !== cur) {
			if (r.params === '') out += SGR_RESET;
			else out += `${ESC}[${cur === '' ? '' : '0;'}${r.params}m`;
			cur = r.params;
		}
		out += r.text;
	}
	return cur === '' ? out : out + SGR_RESET;
}

const join = (...parts: string[]): string => parts.filter(p => p !== '').join(';');

function chunkSegs(segs: readonly Seg[], width: number): Seg[][] {
	const max = Math.max(1, width);
	const rows: Seg[][] = [[]];
	let cells = 0;
	for (const s of segs) {
		for (const g of graphemes(s.text)) {
			const w = cellWidth(g);
			if (cells + w > max && cells > 0) {
				rows.push([]);
				cells = 0;
			}
			const row = rows[rows.length - 1]!;
			const last = row[row.length - 1];
			if (last !== undefined && last.tone === s.tone && last.word === s.word) last.text += g;
			else row.push({...s, text: g});
			cells += w;
		}
	}
	return rows;
}

type Ctx = {
	width: number;
	depth: ColorDepth;
	ascii: boolean;
	tinted: boolean;
	frame: string;
	muted: string;
	syntax: boolean;
};

const pad = (n: number): string => ' '.repeat(Math.max(0, n));

function lineParams(c: Ctx, kind: PreparedLine['kind'], plain: boolean): {base: string; tint: string; word: string; sign: string} {
	if (plain || kind === 'ctx') return {base: '', tint: '', word: '', sign: ''};
	const add = kind === 'add';
	const base = toneParams(add ? 'addedBg' : 'removedBg', c.depth);
	return {
		base,
		tint: c.tinted ? base : '',
		word: toneParams(add ? 'addedWord' : 'removedWord', c.depth),
		sign: toneParams(add ? 'added' : 'removed', c.depth),
	};
}

function textRuns(c: Ctx, segs: readonly Seg[], p: ReturnType<typeof lineParams>): Run[] {
	return segs.map(s => ({
		text: s.text,
		params: join(s.word === true ? p.word : p.base, c.syntax && s.tone !== undefined ? toneParams(s.tone, c.depth) : ''),
	}));
}

function numCell(n: number | undefined, w: number): string {
	return n === undefined ? pad(w) : String(n).padStart(w, ' ');
}

export function renderDiffCard(card: PreparedDiffCard, options: RenderOptions): string[] {
	const width = Math.max(1, Math.floor(options.width));
	const depth = options.depth ?? colorDepth();
	const ascii = options.ascii === true;
	const indent = Math.max(0, Math.floor(options.indent ?? 2));
	const rule = options.rule !== false;
	const c: Ctx = {
		width,
		depth,
		ascii,
		tinted: depth === 'truecolor' || depth === '256',
		frame: toneParams('frame', depth),
		muted: toneParams('muted', depth),
		syntax: depth === 'truecolor' || depth === '256',
	};
	const clip = (row: string): string => (styledCells(row) > width ? sliceStyledCells(row, 0, width) : row);
	const ruleRuns = (): Run[] => {
		const r: Run[] = [{text: pad(indent), params: ''}];
		if (rule) r.push({text: glyph('vRule', {ascii}), params: c.frame}, {text: ' ', params: ''});
		return r;
	};
	const prefixCells = indent + (rule ? 2 : 0);
	const gw = card.maxNo > 0 ? String(card.maxNo).length : 0;
	const split = !card.plain && options.layout !== 'unified' && (options.layout === 'split' || width >= SIDE_BY_SIDE_MIN_WIDTH);

	const body: string[] = [];
	const emitFull = (text: string, params: string) => {
		const avail = Math.max(1, width - prefixCells);
		body.push(clip(paint([...ruleRuns(), {text: truncateCells(text, avail), params}])));
	};
	const foldRow = (label: string) => emitFull(`${glyph('fold', {ascii})} ${label}`, c.muted);

	if (!split) {
		const two = width >= TWO_GUTTERS_MIN_WIDTH && card.hasOld && card.hasNew;
		const gutterCells = gw === 0 ? 0 : two ? gw * 2 + 2 : gw + 1;
		const signCells = card.plain ? 0 : 2;
		const tw = Math.max(1, width - prefixCells - gutterCells - signCells);
		for (const it of card.items) {
			if (it.kind === 'fold') {
				foldRow(it.label);
				continue;
			}
			if (it.kind === 'note') {
				emitFull(it.text, c.muted);
				continue;
			}
			const p = lineParams(c, it.kind, card.plain);
			const gutter = (l: PreparedLine, first: boolean): string => {
				if (gw === 0) return '';
				if (!first) return pad(gutterCells);
				if (two) return `${numCell(l.oldNo, gw)} ${numCell(l.newNo, gw)} `;
				const n = l.kind === 'del' ? (l.oldNo ?? l.newNo) : (l.newNo ?? l.oldNo);
				return `${numCell(n, gw)} `;
			};
			const signChar = it.kind === 'add' ? '+' : it.kind === 'del' ? '-' : ' ';
			chunkSegs(it.segs, tw).forEach((chunk, ci) => {
				const runs: Run[] = [...ruleRuns()];
				if (gutterCells > 0) runs.push({text: gutter(it, ci === 0), params: join(p.tint, c.muted)});
				if (signCells > 0) {
					runs.push({text: ci === 0 ? signChar : ' ', params: join(p.tint, ci === 0 ? p.sign : '')}, {text: ' ', params: p.tint});
				}
				runs.push(...textRuns(c, chunk, p));
				if (p.tint !== '') {
					const used = prefixCells + gutterCells + signCells + chunk.reduce((n, s) => n + stringCells(s.text), 0);
					runs.push({text: pad(width - used), params: p.tint});
				}
				body.push(clip(paint(runs)));
			});
		}
	} else {
		const inner = Math.max(2, width - prefixCells);
		const leftW = Math.floor((inner - 1) / 2);
		const rightW = inner - 1 - leftW;
		const gutterCells = gw === 0 ? 0 : gw + 1;
		const half = (l: PreparedLine | undefined, side: 'old' | 'new', w: number): Run[][] => {
			if (l === undefined) return [[{text: pad(w), params: ''}]];
			const p = lineParams(c, l.kind, false);
			const tw = Math.max(1, w - gutterCells - 2);
			return chunkSegs(l.segs, tw).map((chunk, ci) => {
				const runs: Run[] = [];
				if (gutterCells > 0) runs.push({text: ci === 0 ? `${numCell(side === 'old' ? l.oldNo : l.newNo, gw)} ` : pad(gutterCells), params: join(p.tint, c.muted)});
				const signChar = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ';
				runs.push({text: ci === 0 ? signChar : ' ', params: join(p.tint, ci === 0 ? p.sign : '')}, {text: ' ', params: p.tint});
				runs.push(...textRuns(c, chunk, p));
				const used = gutterCells + 2 + chunk.reduce((n, s) => n + stringCells(s.text), 0);
				runs.push({text: pad(w - used), params: p.tint});
				return runs;
			});
		};
		const emitPair = (l: PreparedLine | undefined, r: PreparedLine | undefined) => {
			const lh = half(l, 'old', leftW);
			const rh = half(r, 'new', rightW);
			const n = Math.max(lh.length, rh.length);
			for (let i = 0; i < n; i++) {
				const runs = [...ruleRuns(), ...(lh[i] ?? [{text: pad(leftW), params: ''}]), {text: glyph('vRule', {ascii}), params: c.frame}, ...(rh[i] ?? [{text: pad(rightW), params: ''}])];
				body.push(clip(paint(runs)));
			}
		};
		const items = card.items;
		for (let i = 0; i < items.length; ) {
			const it = items[i]!;
			if (it.kind === 'fold') {
				foldRow(it.label);
				i++;
			} else if (it.kind === 'note') {
				emitFull(it.text, c.muted);
				i++;
			} else if (it.kind === 'ctx') {
				emitPair(it, it);
				i++;
			} else {
				const dels: PreparedLine[] = [];
				const adds: PreparedLine[] = [];
				while (i < items.length && items[i]!.kind === 'del') dels.push(items[i++] as PreparedLine);
				while (i < items.length && items[i]!.kind === 'add') adds.push(items[i++] as PreparedLine);
				for (let k = 0; k < Math.max(dels.length, adds.length); k++) emitPair(dels[k], adds[k]);
			}
		}
	}

	let rows = body;
	const maxRows = options.maxRows;
	if (maxRows !== undefined && maxRows > 0 && body.length > maxRows) {
		const tail = Math.min(Math.max(0, Math.floor(options.tailRows ?? 8)), maxRows - 2);
		const head = maxRows - tail - 1;
		const hidden = body.length - head - tail;
		const hint = options.moreHint ?? '(ctrl+o to expand)';
		const more: string[] = [];
		const text = `${glyph('ellipsis', {ascii})} +${hidden} lines${hint === '' ? '' : ` ${hint}`}`;
		more.push(clip(paint([...ruleRuns(), {text: truncateCells(text, Math.max(1, width - prefixCells)), params: c.muted}])));
		rows = [...body.slice(0, head), ...more, ...body.slice(body.length - tail)];
	}

	if (options.header === false) return rows;
	return [headerRow(card, c, options.lead, options.right), ...rows];
}

function headerRow(card: PreparedDiffCard, c: Ctx, lead: string | undefined, right: string | undefined): string {
	const {width, depth, ascii} = c;
	const g = glyph(fileKindGlyph(card.path), {ascii});
	const stats = `+${card.added} ${glyph('minus', {ascii})}${card.removed}`;
	const badge = card.created ? 'new file' : '';
	const leadPart = lead === undefined || lead === '' ? '' : `${lead}  `;
	const fixed = styledCells(leadPart) + 2;
	const slash = card.path.lastIndexOf('/');
	const dir = slash >= 0 ? card.path.slice(0, slash + 1) : '';
	const name = card.path.slice(slash + 1);
	const nameCells = stringCells(name);
	const variants: [boolean, boolean][] = [
		[true, badge !== ''],
		[true, false],
		[false, false],
	];
	let showStats = true;
	let showBadge = false;
	let avail = 0;
	for (const [s, b] of variants) {
		showStats = s;
		showBadge = b;
		avail = width - fixed - (s ? 2 + stringCells(stats) : 0) - (b ? 2 + stringCells(badge) : 0);
		if (avail >= nameCells) break;
	}
	let shownDir = '';
	let shownName = name;
	if (avail < nameCells) shownName = truncateCells(name, Math.max(1, avail));
	else if (stringCells(dir) <= avail - nameCells) shownDir = dir;
	else if (avail - nameCells >= 2) {
		const keep = avail - nameCells - 1;
		shownDir = `${glyph('ellipsis', {ascii})}${sliceCells(dir, stringCells(dir) - keep, keep)}`;
	}
	const tone = (text: string, t: ThemeTone): string => {
		const p = toneParams(t, depth);
		return p === '' ? text : `${ESC}[${p}m${text}${SGR_RESET}`;
	};
	let row = `${leadPart}${tone(g, 'muted')} ${shownDir === '' ? '' : tone(shownDir, 'muted')}${SGR_ATTR.bold}${shownName}${SGR_ATTR.boldOff}`;
	if (showStats) row += `  ${tone(`+${card.added}`, 'added')} ${tone(`${glyph('minus', {ascii})}${card.removed}`, 'removed')}`;
	if (showBadge) row += `  ${tone(badge, 'accent')}`;
	const rightText = right === undefined ? '' : sanitizeText(right, 40);
	if (rightText !== '') {
		const gap = width - styledCells(row) - stringCells(rightText);
		if (gap >= 2) row += `${' '.repeat(gap)}${tone(rightText, 'muted')}`;
	}
	return styledCells(row) > width ? sliceStyledCells(row, 0, width) : row;
}
