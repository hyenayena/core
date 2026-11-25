import {randomInt} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {sanitizeText} from '../hints/sanitize.js';

export const INLINE_MAX_CHARS = 4096;
export const INLINE_MAX_LINES = 80;
export const PREVIEW_HEAD_LINES = 30;
export const PREVIEW_HEAD_CHARS = 2000;
export const PREVIEW_TAIL_LINES = 15;
export const PREVIEW_TAIL_CHARS = 1200;
export const PREVIEW_LINE_CHARS = 240;
export const STORE_MAX_ENTRIES = 20;
export const STORE_MAX_CHARS = 4 * 1024 * 1024;
export const READ_DEFAULT_LINES = 100;
export const READ_MAX_LINES = 400;
export const READ_MAX_CHARS = 16 * 1024;
export const READ_LINE_CHARS = 1000;
export const GREP_MAX_PATTERN = 200;
export const GREP_LINE_CHARS = 2000;
export const GREP_TIMEOUT_MS = 250;

export type StoredOutput = {id: string; lines: readonly string[]; chars: number};

export type OutputStore = {
	put: (text: string) => StoredOutput | undefined;
	get: (id: string) => StoredOutput | undefined;
	readonly size: number;
	clear: () => void;
};

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

export function createOutputStore(opts: {maxEntries?: number; maxChars?: number; tag?: string} = {}): OutputStore {
	const maxEntries = opts.maxEntries ?? STORE_MAX_ENTRIES;
	const maxChars = opts.maxChars ?? STORE_MAX_CHARS;
	const tag = opts.tag ?? Array.from({length: 3}, () => BASE36[randomInt(BASE36.length)]).join('');
	const entries = new Map<string, StoredOutput>();
	let total = 0;
	let counter = 0;

	return {
		put(text) {
			if (text.length > maxChars) return undefined;
			counter += 1;
			const entry: StoredOutput = {id: `${tag}-${counter}`, lines: text.split('\n'), chars: text.length};
			entries.set(entry.id, entry);
			total += entry.chars;
			while (entries.size > maxEntries || total > maxChars) {
				const [oldest, dropped] = entries.entries().next().value as [string, StoredOutput];
				entries.delete(oldest);
				total -= dropped.chars;
			}
			return entry;
		},
		get(id) {
			const entry = entries.get(id);
			if (!entry) return undefined;
			entries.delete(id);
			entries.set(id, entry);
			return entry;
		},
		get size() {
			return entries.size;
		},
		clear() {
			entries.clear();
			total = 0;
		},
	};
}

export function needsBuffer(text: string): boolean {
	if (text.length > INLINE_MAX_CHARS) return true;
	let lines = 1;
	for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
		lines++;
		if (lines > INLINE_MAX_LINES) return true;
	}
	return false;
}

const clip = (line: string, max: number): string => (line.length > max ? `${line.slice(0, max - 1)}…` : line);

export function previewOutput(stored: StoredOutput, opts: {truncated: boolean}): string {
	const {lines} = stored;
	const head: string[] = [];
	let headUsed = 0;
	while (head.length < PREVIEW_HEAD_LINES && head.length < lines.length) {
		const line = clip(lines[head.length]!, PREVIEW_LINE_CHARS);
		if (head.length > 0 && headUsed + line.length + 1 > PREVIEW_HEAD_CHARS) break;
		head.push(line);
		headUsed += line.length + 1;
	}
	const tail: string[] = [];
	let tailUsed = 0;
	while (tail.length < PREVIEW_TAIL_LINES && head.length + tail.length < lines.length) {
		const line = clip(lines[lines.length - 1 - tail.length]!, PREVIEW_LINE_CHARS);
		if (tail.length > 0 && tailUsed + line.length + 1 > PREVIEW_TAIL_CHARS) break;
		tail.unshift(line);
		tailUsed += line.length + 1;
	}
	const first = head.length + 1;
	const last = lines.length - tail.length;
	const kb = Math.max(1, Math.round(stored.chars / 1024));
	const note = opts.truncated ? '; the console kept only the start and the end' : '';
	const marker = `… [output ${stored.id}: ${lines.length} lines, ${kb} KB; lines ${first}-${last} not shown${note}; read_output id="${stored.id}"] …`;
	return [...head, marker, ...tail].join('\n');
}

export const missingOutputText = (id: string): string =>
	`Output "${sanitizeText(id, 32)}" is no longer kept (only the last ${STORE_MAX_ENTRIES} outputs of this chat are, and none survive a reload). Run the command again.`;

export type ReadOutputResult = {text: string; isError: boolean};

const fail = (text: string): ReadOutputResult => ({text, isError: true});

const GREP_SCRIPT = `
const re = new RegExp(pattern, 'i');
const found = [];
for (let i = start; i < lines.length && found.length < max; i++) {
	const line = lines[i];
	if (re.test(line.length > cap ? line.slice(0, cap) : line)) found.push(i);
}
found;
`;

function readRows(stored: StoredOutput, indexes: Iterable<number>, count: number): {rows: string[]; last: number} {
	const rows: string[] = [];
	let used = 0;
	let last = 0;
	for (const index of indexes) {
		const row = `${index + 1}: ${clip(stored.lines[index]!, READ_LINE_CHARS)}`;
		if (rows.length > 0 && used + row.length + 1 > READ_MAX_CHARS) break;
		rows.push(row);
		used += row.length + 1;
		last = index + 1;
		if (rows.length >= count) break;
	}
	return {rows, last};
}

function grepOutput(stored: StoredOutput, opts: {from: number; lines: number; grep: string}): ReadOutputResult {
	if (opts.grep.length > GREP_MAX_PATTERN) return fail(`The grep pattern is longer than ${GREP_MAX_PATTERN} characters.`);
	try {
		new RegExp(opts.grep, 'i');
	} catch {
		return fail('The grep pattern is not a valid regular expression.');
	}
	let found: number[];
	try {
		const raw = runInNewContext(
			GREP_SCRIPT,
			{lines: stored.lines, pattern: opts.grep, start: opts.from - 1, max: opts.lines + 1, cap: GREP_LINE_CHARS},
			{timeout: GREP_TIMEOUT_MS},
		) as ArrayLike<number>;
		found = Array.from(raw);
	} catch {
		return fail('The grep pattern took too long; use a simpler one.');
	}
	const shown = readRows(stored, found.slice(0, opts.lines), opts.lines);
	const cut = shown.rows.length < found.length;
	const header = `[output ${stored.id}: ${shown.rows.length} matching lines from line ${opts.from}]`;
	const parts = [header, ...shown.rows];
	if (cut) parts.push(`[more: from=${shown.last + 1}]`);
	return {text: parts.join('\n'), isError: false};
}

export function readOutput(stored: StoredOutput, opts: {from?: number; lines?: number; grep?: string}): ReadOutputResult {
	const total = stored.lines.length;
	const from = Math.max(1, Math.floor(opts.from ?? 1));
	const count = Math.min(READ_MAX_LINES, Math.max(1, Math.floor(opts.lines ?? READ_DEFAULT_LINES)));
	if (from > total) return fail(`Output ${stored.id} has ${total} lines.`);
	if (opts.grep !== undefined) return grepOutput(stored, {from, lines: count, grep: opts.grep});
	const end = Math.min(total, from - 1 + count);
	const shown = readRows(stored, Array.from({length: end - from + 1}, (_, i) => from - 1 + i), count);
	const parts = [`[output ${stored.id}: lines ${from}-${shown.last} of ${total}]`, ...shown.rows];
	if (shown.last < total) parts.push(`[more: from=${shown.last + 1}]`);
	return {text: parts.join('\n'), isError: false};
}
