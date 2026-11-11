import type {ThemeTone} from '../kit/theme.js';
import {splitWords} from '../parse-line.js';
import type {Catalog, CatalogSub} from './catalog.js';
import type {Windowed} from './viewport.js';
import {graphemes} from './width.js';

export type SyntaxRole = 'command' | 'unknown' | 'subcommand' | 'option' | 'string';

export type SyntaxRange = {start: number; end: number; role: SyntaxRole};

export const SYNTAX_TONE: Readonly<Record<SyntaxRole, {tone: ThemeTone; bold?: true}>> = Object.freeze({
	command: {tone: 'accent', bold: true},
	unknown: {tone: 'error'},
	subcommand: {tone: 'code.function'},
	option: {tone: 'code.attribute'},
	string: {tone: 'code.string'},
});

const OPTION = /^--?[A-Za-z]/u;

export function syntaxRanges(value: string, catalog: Catalog): SyntaxRange[] {
	const out: SyntaxRange[] = [];
	if (typeof value !== 'string' || value === '') return out;
	const {words} = splitWords(value, {partial: true});
	let level: {subs: CatalogSub[]} | undefined;
	let subsOpen = true;
	words.forEach((w, i) => {
		if (i === 0) {
			const command = catalog.byName.get(w.text);
			if (command) {
				out.push({start: w.start, end: w.end, role: 'command'});
				level = command;
			} else if (!w.quoted && w.end < value.length) {
				out.push({start: w.start, end: w.end, role: 'unknown'});
			}
			return;
		}
		if (OPTION.test(w.text)) {
			const eq = w.text.indexOf('=');
			if (eq < 0) {
				out.push({start: w.start, end: w.end, role: 'option'});
			} else {
				out.push({start: w.start, end: w.start + eq, role: 'option'});
				if (w.quoted) out.push({start: w.start + eq + 1, end: w.end, role: 'string'});
			}
			return;
		}
		if (w.quoted) {
			out.push({start: w.start, end: w.end, role: 'string'});
			subsOpen = false;
			return;
		}
		if (!subsOpen || !level) return;
		const sub = level.subs.find(s => s.name === w.text || s.aliases.includes(w.text));
		if (sub) {
			out.push({start: w.start, end: w.end, role: 'subcommand'});
			level = sub;
		} else {
			subsOpen = false;
		}
	});
	return out;
}

export type PromptSegment = {text: string; tone?: ThemeTone; bold?: true; cursor?: true; ghost?: true};

export function promptSegments(value: string, win: Windowed, ranges: readonly SyntaxRange[]): PromptSegment[] {
	const gs = graphemes(value);
	const offsets: number[] = [];
	let at = 0;
	for (const g of gs) {
		offsets.push(at);
		at += g.length;
	}
	const styleAt = (index: number): Pick<PromptSegment, 'tone' | 'bold'> => {
		const offset = offsets[index];
		const range = offset === undefined ? undefined : ranges.find(r => offset >= r.start && offset < r.end);
		return range ? SYNTAX_TONE[range.role] : {};
	};
	const out: PromptSegment[] = [];
	const push = (text: string, extra: Omit<PromptSegment, 'text'> = {}): void => {
		if (text === '') return;
		const last = out.at(-1);
		const same = last && last.tone === extra.tone && last.bold === extra.bold && last.cursor === extra.cursor && last.ghost === extra.ghost;
		if (same) last.text += text;
		else out.push({text, ...extra});
	};
	const pushGraphemes = (list: readonly string[], from: number): void => {
		list.forEach((g, k) => push(g, styleAt(from + k)));
	};

	let before = win.before;
	if (win.leftCut && before.startsWith('…')) {
		push('…');
		before = before.slice('…'.length);
	}
	const shown = graphemes(before);
	pushGraphemes(shown, win.start);
	const cursorAt = win.start + shown.length;
	const atEnd = cursorAt >= gs.length;
	push(win.cursorCell || ' ', {...(atEnd ? {ghost: true as const} : styleAt(cursorAt)), cursor: true});

	let after = win.after;
	let tail = '';
	if (win.rightCut && after.endsWith('…')) {
		after = after.slice(0, -'…'.length);
		tail = '…';
	}
	pushGraphemes(graphemes(after), cursorAt + 1);
	push(tail);
	push(win.ghost, {ghost: true});
	return out;
}
