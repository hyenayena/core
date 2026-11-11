import {sanitizeText} from '../hints/sanitize.js';
import {sliceStyledCells, styledCells} from '../transcript/wrap.js';
import type {Line, RowsOf} from '../transcript/scroll.js';
import {glyph} from '../kit/glyphs.js';
import {formatElapsed, statusRow} from '../kit/status-row.js';
import {SGR_RESET, colorDepth, toneSgr, type ColorDepth, type ThemeTone} from '../kit/theme.js';

export type PanelEntry = Pick<Line, 'id' | 'text' | 'tone' | 'render'>;

export type PanelStatus = 'running' | 'ok' | 'failed';

export type PanelSection = {
	id: number;
	kind: 'command' | 'loose';
	echo?: string;
	caller?: string;
	status: PanelStatus;
	startedAt: number;
	ms?: number;
	note?: string;
	entries: PanelEntry[];
	folded?: boolean;
};

export const MAX_SECTIONS = 100;
export const MAX_ENTRIES = 500;
export const OPEN_SECTIONS = 2;
const ECHO_MAX = 4096;
const CALLER_MAX = 40;
const NOTE_MAX = 400;
const INDENT = 2;

export function beginSection(sections: readonly PanelSection[], start: {id: number; echo: string; caller?: string}, now: number): PanelSection[] {
	const section: PanelSection = {
		id: start.id,
		kind: 'command',
		echo: sanitizeText(start.echo, ECHO_MAX),
		status: 'running',
		startedAt: now,
		entries: [],
	};
	const caller = start.caller === undefined ? '' : sanitizeText(start.caller, CALLER_MAX);
	if (caller !== '') section.caller = caller;
	return capEntries([...sections, section].slice(-MAX_SECTIONS));
}

function capEntries(sections: PanelSection[]): PanelSection[] {
	let total = sections.reduce((n, s) => n + s.entries.length, 0);
	let list = sections;
	while (total > MAX_ENTRIES && list.length > 1) {
		total -= list[0]!.entries.length;
		list = list.slice(1);
	}
	if (total > MAX_ENTRIES) {
		const only = list[0]!;
		list = [{...only, entries: only.entries.slice(total - MAX_ENTRIES)}];
	}
	return list;
}

export function appendEntries(sections: readonly PanelSection[], target: number | undefined, entries: readonly PanelEntry[], now: number): PanelSection[] {
	if (entries.length === 0) return [...sections];
	const at = target === undefined ? -1 : sections.findIndex(s => s.id === target);
	const open = at >= 0 && sections[at]!.status === 'running';
	if (open) return capEntries(sections.map((s, i) => (i === at ? {...s, entries: [...s.entries, ...entries]} : s)));
	const last = sections.at(-1);
	if (last?.kind === 'loose') {
		return capEntries(sections.map((s, i) => (i === sections.length - 1 ? {...s, entries: [...s.entries, ...entries]} : s)));
	}
	const loose: PanelSection = {id: entries[0]!.id, kind: 'loose', status: 'ok', startedAt: now, entries: [...entries]};
	return capEntries([...sections, loose].slice(-MAX_SECTIONS));
}

export function endSection(
	sections: readonly PanelSection[],
	id: number,
	status: 'ok' | 'failed',
	now: number,
	note?: string,
): PanelSection[] {
	return sections.map(s => {
		if (s.id !== id || s.kind !== 'command' || s.status !== 'running') return s;
		const next: PanelSection = {...s, status, ms: Math.max(0, now - s.startedAt)};
		const clean = note === undefined ? '' : sanitizeText(note, NOTE_MAX);
		if (clean !== '') next.note = clean;
		return next;
	});
}

function foldedAt(sections: readonly PanelSection[], index: number, expandAll: boolean): boolean {
	const s = sections[index]!;
	if (s.kind !== 'command' || s.status === 'running') return false;
	if (s.folded !== undefined) return s.folded;
	if (expandAll || s.entries.length === 0) return false;
	const newer = sections.slice(index + 1).filter(x => x.kind === 'command').length;
	return newer >= OPEN_SECTIONS;
}

export function toggleFold(sections: readonly PanelSection[], id: number, expandAll = false): PanelSection[] {
	const index = sections.findIndex(s => s.id === id);
	if (index < 0 || sections[index]!.kind !== 'command' || sections[index]!.status === 'running') return [...sections];
	const folded = foldedAt(sections, index, expandAll);
	return sections.map((s, i) => (i === index ? {...s, folded: !folded} : s));
}

export const hasFolds = (sections: readonly PanelSection[]): boolean =>
	sections.some(s => s.kind === 'command' && s.status !== 'running' && s.entries.length > 0);

export type PanelRow = {key: string; text: string; sectionId?: number; header?: true};

export type SectionRowsOptions = {width: number; expandAll?: boolean; depth?: ColorDepth; ascii?: boolean; now?: number};

function paint(text: string, tone: ThemeTone, depth: ColorDepth): string {
	const open = toneSgr(tone, depth);
	return open === '' || text === '' ? text : `${open}${text}${SGR_RESET}`;
}

export function sectionRows(sections: readonly PanelSection[], rowsOf: RowsOf, options: SectionRowsOptions): PanelRow[] {
	const width = Math.max(1, Math.floor(options.width));
	const depth = options.depth ?? colorDepth();
	const ascii = options.ascii === true;
	const now = options.now ?? Date.now();
	const expandAll = options.expandAll === true;
	const fit = (text: string, max: number): string => (styledCells(text) <= max ? text : sliceStyledCells(text, 0, max));
	const out: PanelRow[] = [];
	const entryRows = (section: PanelSection): PanelRow[] =>
		section.entries.flatMap(entry =>
			rowsOf(entry, Math.max(1, width - INDENT)).map((text, r) => {
				const painted = entry.tone === undefined || text === '' ? text : paint(text, entry.tone, depth);
				return {key: `${section.id}:${entry.id}:${r}`, text: fit(`${' '.repeat(INDENT)}${painted}`, width), sectionId: section.id};
			}),
		);

	sections.forEach((section, index) => {
		if (section.kind === 'loose') {
			out.push(...entryRows(section).map(({key, text}) => ({key, text})));
			return;
		}
		const folded = foldedAt(sections, index, expandAll);
		const body = entryRows(section);
		const elapsed = section.ms ?? Math.max(0, now - section.startedAt);
		const right = [section.caller, folded && body.length > 0 ? `+${body.length}` : undefined, elapsed >= 1000 ? formatElapsed(elapsed) : undefined]
			.filter((p): p is string => p !== undefined)
			.join(' · ');
		const mark =
			section.status === 'failed'
				? paint(glyph('cross', {ascii}), 'error', depth)
				: paint(glyph('prompt', {ascii}), section.status === 'running' ? 'running' : 'accent', depth);
		out.push({
			key: `${section.id}:head`,
			text: fit(statusRow({mark, title: section.echo ?? '', right, width, depth}), width),
			sectionId: section.id,
			header: true,
		});
		if (folded) return;
		out.push(...body);
		if (section.status === 'failed' && section.note !== undefined) {
			out.push({
				key: `${section.id}:note`,
				text: fit(`${' '.repeat(INDENT)}${paint(section.note, 'error', depth)}`, width),
				sectionId: section.id,
			});
		}
		if (body.length > 0 || section.note !== undefined) {
			out.push({key: `${section.id}:rule`, text: paint(glyph('hRule', {ascii}).repeat(width), 'frame', depth), sectionId: section.id});
		}
	});
	return out;
}
