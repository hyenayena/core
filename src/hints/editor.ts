import {acceptEdit, type HintItem, type HintResult} from './model.js';
import {graphemes} from './width.js';

export type KeyInput = {
	input: string;
	paste?: string;
	upArrow?: boolean;
	downArrow?: boolean;
	leftArrow?: boolean;
	rightArrow?: boolean;
	home?: boolean;
	end?: boolean;
	pageUp?: boolean;
	pageDown?: boolean;
	return?: boolean;
	escape?: boolean;
	tab?: boolean;
	shift?: boolean;
	backspace?: boolean;
	delete?: boolean;
	ctrl?: boolean;
	meta?: boolean;
};

export type Cycle = {
	start: number;
	len: number;
	original: string;
	items: HintItem[];
	result: HintResult;
};

export type PromptState = {
	value: string;
	cursor: number;
	historyIndex: number;
	sel: number;
	navigated: boolean;
	dismissed: boolean;
	cycle?: Cycle;
};

export type StepEnv = {
	history: readonly string[];
	hints: (value: string) => HintResult;
};

export type StepResult = {
	state: PromptState;
	effect?: 'submit' | 'interrupt' | 'tab';
	line?: string;
};

export const initialState: PromptState = {
	value: '',
	cursor: 0,
	historyIndex: -1,
	sel: 0,
	navigated: false,
	dismissed: false,
};

const MAX_INSERT = 8192;
const ESC = 0x1b;

function isInvisible(c: number): boolean {
	return (
		(c >= 0x202a && c <= 0x202e) ||
		(c >= 0x2066 && c <= 0x2069) ||
		c === 0x200b ||
		c === 0x200e ||
		c === 0x200f ||
		(c >= 0x2060 && c <= 0x2064) ||
		c === 0x061c ||
		c === 0xfeff ||
		c === 0x00ad ||
		(c >= 0xfff9 && c <= 0xfffb) ||
		(c >= 0xe0000 && c <= 0xe007f)
	);
}

function skipCsi(s: string, from: number): number {
	let j = from;
	while (j < s.length && s.charCodeAt(j) >= 0x30 && s.charCodeAt(j) <= 0x3f) j++;
	while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f) j++;
	return j < s.length && s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e ? j + 1 : j;
}

function skipString(s: string, from: number): number {
	for (let j = from; j < s.length; j++) {
		const c = s.charCodeAt(j);
		if (c === 0x07 || c === 0x9c) return j + 1;
		if (c === ESC && s.charCodeAt(j + 1) === 0x5c) return j + 2;
	}
	return s.length;
}

export function sanitizeInsert(input: string): string {
	if (typeof input !== 'string' || input === '') return '';
	const s = input.slice(0, MAX_INSERT);
	let out = '';
	let i = 0;
	while (i < s.length) {
		const c = s.charCodeAt(i);
		if (c === ESC) {
			const n = s.charCodeAt(i + 1);
			if (n === 0x5b) i = skipCsi(s, i + 2);
			else if ([0x5d, 0x50, 0x5f, 0x5e, 0x58].includes(n)) i = skipString(s, i + 2);
			else i += 2;
			continue;
		}
		if (c === 0x9b) {
			i = skipCsi(s, i + 1);
			continue;
		}
		if ([0x9d, 0x90, 0x9f, 0x9e, 0x98].includes(c)) {
			i = skipString(s, i + 1);
			continue;
		}
		if (c === 0x09 || c === 0x0a || c === 0x0d || c === 0x85 || c === 0x2028 || c === 0x2029) {
			out += ' ';
			i++;
			continue;
		}
		if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || isInvisible(c)) {
			i++;
			continue;
		}
		const cp = s.codePointAt(i) as number;
		if (isInvisible(cp)) {
			i += 2;
			continue;
		}
		const ch = String.fromCodePoint(cp);
		out += cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(0xfffd) : ch;
		i += ch.length;
	}
	return out;
}

function boundaries(value: string): number[] {
	const out = [0];
	let at = 0;
	for (const g of graphemes(value)) {
		at += g.length;
		out.push(at);
	}
	return out;
}

function prevBoundary(value: string, cursor: number): number {
	let best = 0;
	for (const b of boundaries(value)) {
		if (b < cursor) best = b;
		else break;
	}
	return best;
}

function nextBoundary(value: string, cursor: number): number {
	for (const b of boundaries(value)) if (b > cursor) return b;
	return value.length;
}

function safeHints(env: StepEnv, value: string): HintResult | undefined {
	try {
		return env.hints(value);
	} catch {
		return undefined;
	}
}

function clampCursor(s: PromptState): number {
	return Math.min(Math.max(0, Number.isFinite(s.cursor) ? s.cursor : 0), s.value.length);
}

function activeResult(s: PromptState, env: StepEnv): HintResult | undefined {
	if (s.historyIndex !== -1 || s.dismissed) return undefined;
	if (s.value.trim() === '' || s.cursor !== s.value.length) return undefined;
	const h = safeHints(env, s.value);
	return h && h.items.length > 0 ? h : undefined;
}

function usageOnlyResult(s: PromptState, env: StepEnv): HintResult | undefined {
	if (s.historyIndex !== -1 || s.dismissed) return undefined;
	if (s.value.trim() === '' || s.cursor !== s.value.length) return undefined;
	const h = safeHints(env, s.value);
	return h && h.items.length === 0 && h.usage ? h : undefined;
}

function validCycle(s: PromptState): Cycle | undefined {
	const c = s.cycle;
	if (!c || c.items.length === 0) return undefined;
	const item = c.items[s.sel];
	if (!item || c.len !== item.insert.length) return undefined;
	if (!s.value.startsWith(item.insert, c.start)) return undefined;
	return c;
}

export function visibleHints(s: PromptState, env: StepEnv): HintResult | undefined {
	const c = validCycle(s);
	if (c) return {...c.result, items: c.items};
	return activeResult(s, env) ?? usageOnlyResult(s, env);
}

export function ghostText(s: PromptState, env: StepEnv): string {
	if (validCycle(s)) return '';
	const h = activeResult(s, env);
	const item = h?.items[s.sel];
	if (!h || !item || !item.prefix) return '';
	return graphemes(item.insert).slice(graphemes(h.token).length).join('');
}

function reset(s: PromptState, patch: Partial<PromptState>): PromptState {
	const next: PromptState = {...s, sel: 0, navigated: false, dismissed: false, ...patch};
	delete next.cycle;
	return next;
}

function insertText(s: PromptState, text: string): PromptState {
	if (text === '') return s;
	const cursor = clampCursor(s);
	return reset(s, {
		value: s.value.slice(0, cursor) + text + s.value.slice(cursor),
		cursor: cursor + text.length,
	});
}

function accept(s: PromptState, h: HintResult, index: number, cycle: boolean): PromptState {
	const item = h.items[index];
	if (!item) return s;
	const {value, cursor} = acceptEdit(s.value, h, item);
	const next = reset(s, {value, cursor});
	if (cycle && h.items.length > 1) {
		next.sel = index;
		next.cycle = {
			start: h.tokenStart,
			len: item.insert.length,
			original: s.value,
			items: h.items,
			result: h,
		};
	}
	return next;
}

function cycleTo(s: PromptState, c: Cycle, index: number): PromptState {
	const item = c.items[index] as HintItem;
	const end = c.start + c.len;
	const value = s.value.slice(0, c.start) + item.insert + s.value.slice(end);
	const delta = item.insert.length - c.len;
	return {
		...s,
		value,
		cursor: s.cursor + delta,
		sel: index,
		navigated: false,
		cycle: {...c, len: item.insert.length},
	};
}

function history(s: PromptState, env: StepEnv, up: boolean): PromptState {
	const list = env.history;
	const next = up
		? Math.min(s.historyIndex + 1, list.length - 1)
		: Math.max(s.historyIndex - 1, -1);
	if (next === s.historyIndex) return s;
	const text = next === -1 ? '' : (list[list.length - 1 - next] ?? '');
	return reset(s, {value: text, cursor: text.length, historyIndex: next});
}

function isSpecial(k: KeyInput): boolean {
	return Boolean(
		k.upArrow || k.downArrow || k.leftArrow || k.rightArrow || k.home || k.end ||
			k.pageUp || k.pageDown || k.return || k.escape || k.tab || k.backspace || k.delete,
	);
}

export function step(s: PromptState, k: KeyInput, env: StepEnv): StepResult {
	try {
		return run(s, k, env);
	} catch {
		return {state: s};
	}
}

function run(s: PromptState, k: KeyInput, env: StepEnv): StepResult {
	if (k.ctrl && k.input === 'c') return {state: s, effect: 'interrupt'};

	if (typeof k.paste === 'string') return {state: insertText(s, sanitizeInsert(k.paste))};

	const input = typeof k.input === 'string' ? k.input : '';
	if (!isSpecial(k) && !k.ctrl && !k.meta) {
		return {state: insertText(s, sanitizeInsert(input))};
	}

	const cycle = validCycle(s);
	if (cycle) {
		const n = cycle.items.length;
		if (k.tab) {
			return {state: cycleTo(s, cycle, (s.sel + (k.shift ? n - 1 : 1)) % n)};
		}
		if (k.escape) {
			return {
				state: reset(s, {value: cycle.original, cursor: cycle.original.length, dismissed: true}),
			};
		}
		if (k.return) return submit(s);
		return run(reset(s, {}), k, env);
	}
	if (s.cycle) s = reset(s, {});

	const h = activeResult(s, env);
	const navigated = Boolean(h) && s.navigated;
	const sel = h ? Math.min(Math.max(0, s.sel), h.items.length - 1) : 0;

	if (k.return) {
		if (h && navigated) return {state: accept(s, h, sel, false)};
		return submit(s);
	}

	if (k.tab) {
		if (!h) return {state: s, ...(!k.shift && {effect: 'tab' as const})};
		if (k.shift && !navigated) return {state: accept(s, h, h.items.length - 1, true)};
		return {state: accept(s, h, sel, true)};
	}

	if (k.escape) {
		if (!h) return {state: usageOnlyResult(s, env) ? {...s, dismissed: true} : s};
		if (navigated) return {state: {...s, sel: 0, navigated: false}};
		return {state: {...s, dismissed: true}};
	}

	if (k.upArrow || k.downArrow) {
		if (h) {
			const n = h.items.length;
			const to = (sel + (k.upArrow ? n - 1 : 1)) % n;
			return {state: {...s, sel: to, navigated: true}};
		}
		return {state: history(s, env, Boolean(k.upArrow))};
	}

	const cursor = clampCursor(s);

	if (k.rightArrow || k.end) {
		const item = h?.items[sel];
		if (h && item?.prefix && cursor === s.value.length) return {state: accept(s, h, sel, false)};
		const to = k.end ? s.value.length : nextBoundary(s.value, cursor);
		return {state: reset(s, {cursor: to})};
	}
	if (k.leftArrow) return {state: reset(s, {cursor: prevBoundary(s.value, cursor)})};
	if (k.home) return {state: reset(s, {cursor: 0})};

	if (k.backspace || k.delete) {
		if (cursor === 0) return {state: s};
		const from = prevBoundary(s.value, cursor);
		return {state: reset(s, {value: s.value.slice(0, from) + s.value.slice(cursor), cursor: from})};
	}

	if (k.ctrl && input === 'a') return {state: reset(s, {cursor: 0})};
	if (k.ctrl && input === 'e') return {state: reset(s, {cursor: s.value.length})};
	if (k.ctrl && input === 'u') return {state: reset(s, {value: s.value.slice(cursor), cursor: 0})};

	return {state: s};
}

export function clickCursor(s: PromptState, graphemeIndex: number): PromptState {
	try {
		const b = boundaries(s.value);
		const i = Math.min(Math.max(0, Math.floor(graphemeIndex) || 0), b.length - 1);
		return reset(s, {cursor: b[i] as number});
	} catch {
		return s;
	}
}

export function clickHint(s: PromptState, itemIndex: number, env: StepEnv): PromptState {
	try {
		const h = visibleHints(s, env);
		if (!h || !Number.isInteger(itemIndex) || !h.items[itemIndex]) return s;
		const c = validCycle(s);
		const base = c ? {...s, value: c.original, cursor: c.original.length} : s;
		return accept(base, h, itemIndex, false);
	} catch {
		return s;
	}
}

function submit(s: PromptState): StepResult {
	return {state: {...initialState}, effect: 'submit', line: s.value};
}
