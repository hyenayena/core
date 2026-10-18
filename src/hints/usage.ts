export type UsageToken = {
	text: string;
	kind: 'flag' | 'slot' | 'more';
	variadic: boolean;
};

const MAX_TOKENS = 64;
const MAX_CHARS = 1024;

const isMore = (t: string) => t === '…' || t === '...';
const endsMore = (t: string) => t.endsWith('…') || t.endsWith('...');

export function parseUsage(usage: string, pathLen: number): UsageToken[] {
	if (typeof usage !== 'string') return [];
	const raw = usage.slice(0, MAX_CHARS).split(/\s+/).filter(Boolean);
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
			tokens.push({text, kind: 'slot', variadic: endsMore(text)});
		}
	}
	return tokens;
}

export function currentPlaceholder(
	tokens: readonly UsageToken[],
	typedArgs: readonly string[],
	endsWithSpace: boolean,
): number {
	const slots: number[] = [];
	tokens.forEach((t, i) => {
		if (t.kind === 'slot') slots.push(i);
	});
	if (slots.length === 0) return -1;
	const completed = endsWithSpace ? typedArgs : typedArgs.slice(0, -1);
	const n = completed.filter(a => !a.startsWith('-')).length;
	if (n < slots.length) return slots[n]!;
	const last = slots[slots.length - 1]!;
	return tokens[last]!.variadic ? last : -1;
}
