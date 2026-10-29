export type UsageToken = {
	text: string;
	kind: 'flag' | 'slot' | 'more';
	variadic: boolean;
};

export type OptionName = {name: string; takesValue: boolean};

const MAX_TOKENS = 64;
const MAX_CHARS = 1024;

const isMore = (t: string) => t === '…' || t === '...';
const endsMore = (t: string) => t.endsWith('…') || t.endsWith('...');
const OPEN = new Set(['[', '<']);
const CLOSE = new Set([']', '>']);

export function splitUsage(usage: string): string[] {
	if (typeof usage !== 'string') return [];
	const text = usage.slice(0, MAX_CHARS);
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of text) {
		if (/\s/u.test(ch) && depth === 0) {
			if (cur !== '') out.push(cur);
			cur = '';
			continue;
		}
		if (OPEN.has(ch)) depth++;
		else if (CLOSE.has(ch)) depth = Math.max(0, depth - 1);
		cur += ch;
	}
	if (cur !== '') out.push(cur);
	return out;
}

export function parseUsage(usage: string, pathLen: number): UsageToken[] {
	const raw = splitUsage(usage);
	const skip = Math.max(0, Math.floor(pathLen) || 0);
	const rest = raw.slice(skip, skip + MAX_TOKENS);
	const tokens: UsageToken[] = [];
	for (const text of rest) {
		if (isMore(text)) {
			for (let i = tokens.length - 1; i >= 0; i--) {
				const t = tokens[i]!;
				if (t.kind === 'slot') {
					t.variadic = true;
					break;
				}
			}
			tokens.push({text, kind: 'more', variadic: false});
		} else if (text.startsWith('-') || text.startsWith('[-')) {
			tokens.push({text, kind: 'flag', variadic: false});
		} else {
			tokens.push({text, kind: 'slot', variadic: endsMore(text) || text.includes('…')});
		}
	}
	return tokens;
}

export function optionNames(token: string): OptionName[] {
	if (typeof token !== 'string') return [];
	const words: {text: string; grouped: boolean}[] = [];
	let depth = 0;
	let cur = '';
	let grouped = true;
	const flush = () => {
		if (cur === '') return;
		words.push({text: cur, grouped});
		cur = '';
		grouped = true;
	};
	for (const ch of token.slice(0, MAX_CHARS)) {
		if (depth === 0 && (ch === '[' || ch === ']' || ch === '|' || ch === '(' || ch === ')')) {
			flush();
			grouped = false;
			continue;
		}
		if (depth === 0 && /\s/u.test(ch)) {
			flush();
			continue;
		}
		if (ch === '<') depth++;
		else if (ch === '>') depth = Math.max(0, depth - 1);
		cur += ch;
	}
	flush();
	const out: OptionName[] = [];
	words.forEach((w, i) => {
		if (!w.text.startsWith('-') || w.text === '-' || isMore(w.text)) return;
		const eq = w.text.indexOf('=');
		const name = eq > 0 ? w.text.slice(0, eq) : w.text.replace(/(…|\.\.\.)$/, '');
		const next = words[i + 1];
		const takesValue = eq > 0 || (next !== undefined && next.grouped && !next.text.startsWith('-') && !isMore(next.text));
		if (!out.some(o => o.name === name)) out.push({name, takesValue});
	});
	return out;
}

export function slotKey(text: string): string {
	let s = typeof text === 'string' ? text.trim() : '';
	for (;;) {
		const before = s;
		s = s.replace(/(…|\.\.\.)$/, '').trim();
		if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('<') && s.endsWith('>'))) s = s.slice(1, -1).trim();
		if (s === before) return s;
	}
}

export function slotFlags(text: string): {optional: boolean; repeatable: boolean} {
	const s = typeof text === 'string' ? text.trim() : '';
	return {optional: s.startsWith('['), repeatable: s.includes('…') || s.includes('...')};
}

export type TakesValue = (name: string) => boolean | undefined;

export type ArgState = {
	active: number;
	option?: string;
};

function usageTakesValue(tokens: readonly UsageToken[]): Map<string, boolean> {
	const map = new Map<string, boolean>();
	for (const t of tokens) {
		if (t.kind !== 'flag') continue;
		for (const o of optionNames(t.text)) if (!map.has(o.name)) map.set(o.name, o.takesValue);
	}
	return map;
}

export function argState(
	tokens: readonly UsageToken[],
	typedArgs: readonly string[],
	endsWithSpace: boolean,
	takesValue?: TakesValue,
): ArgState {
	const fromUsage = usageTakesValue(tokens);
	const wantsValue = (arg: string): boolean => {
		if (arg.includes('=')) return false;
		let v: boolean | undefined;
		try {
			v = takesValue?.(arg);
		} catch {
			v = undefined;
		}
		return v ?? fromUsage.get(arg) ?? false;
	};
	const completed = endsWithSpace ? typedArgs : typedArgs.slice(0, -1);
	let n = 0;
	let pending: string | undefined;
	for (const a of completed) {
		if (pending !== undefined) {
			pending = undefined;
			continue;
		}
		if (a.startsWith('-')) {
			if (wantsValue(a)) pending = a;
			continue;
		}
		n++;
	}
	if (pending !== undefined) return {active: -1, option: pending};
	const slots: number[] = [];
	tokens.forEach((t, i) => {
		if (t.kind === 'slot') slots.push(i);
	});
	if (slots.length === 0) return {active: -1};
	if (n < slots.length) return {active: slots[n]!};
	const last = slots[slots.length - 1]!;
	return {active: tokens[last]!.variadic ? last : -1};
}

export function currentPlaceholder(
	tokens: readonly UsageToken[],
	typedArgs: readonly string[],
	endsWithSpace: boolean,
	takesValue?: TakesValue,
): number {
	return argState(tokens, typedArgs, endsWithSpace, takesValue).active;
}
