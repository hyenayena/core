export type MouseInputEvent = {
	kind: 'press' | 'release' | 'wheel';
	button: 'left' | 'middle' | 'right' | 'none';
	wheel?: 'up' | 'down';
	x: number;
	y: number;
	shift: boolean;
	meta: boolean;
	ctrl: boolean;
};

// x and y are the terminal's 1-based cells; `release` is the SGR `m` final.
export type RawMouse = {code: number; x: number; y: number; release: boolean};

// `flushable`: the held part (a lone ESC or `ESC[`) comes back as text from `flush`; anything else held is dropped.
export type TokenizerResult = {text: string; events: RawMouse[]; hold: 'none' | 'short' | 'long'; flushable: boolean};

export type MouseTokenizer = {
	push(chunk: string): TokenizerResult;
	flush(): string;
	setX10(on: boolean): void;
};

const ESC = String.fromCharCode(27);
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;
const MAX_DIGITS = 4;
const MAX_SEQUENCE = 32;
const MAX_EVENTS = 256;

type Pending =
	| {kind: 'esc'}
	| {kind: 'csi'}
	| {kind: 'sgr'; fields: number[]; digits: number}
	| {kind: 'x10'; values: number[]}
	| {kind: 'discard'};

const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const code = (ch: string) => ch.codePointAt(0)!;

export function createMouseTokenizer(): MouseTokenizer {
	let x10 = false;
	let inPaste = false;
	// Progress through PASTE_START (outside a paste) or PASTE_END (inside one) over the text emitted so far.
	let marker = 0;
	let state: Pending | undefined;
	let seq = '';

	const track = (out: string[], ch: string) => {
		out.push(ch);
		const target = inPaste ? PASTE_END : PASTE_START;
		if (ch === target[marker]) {
			marker++;
			if (marker === target.length) {
				inPaste = !inPaste;
				marker = 0;
			}
		} else {
			marker = ch === ESC ? 1 : 0;
		}
	};

	const emit = (out: string[], text: string) => {
		for (const ch of text) track(out, ch);
	};

	const reset = () => {
		state = undefined;
		seq = '';
	};

	// A broken report is swallowed up to its final byte so that no part of it reaches text input.
	const discard = () => {
		state = {kind: 'discard'};
		seq = '';
	};

	const push = (chunk: string): TokenizerResult => {
		const out: string[] = [];
		const events: RawMouse[] = [];
		const chars = Array.from(chunk);

		const complete = (raw: RawMouse) => {
			if (events.length < MAX_EVENTS) events.push(raw);
			reset();
		};

		let i = 0;
		while (i < chars.length) {
			const ch = chars[i]!;
			if (!state) {
				if (inPaste || ch !== ESC) {
					track(out, ch);
				} else {
					state = {kind: 'esc'};
					seq = ch;
				}
				i++;
				continue;
			}
			if (state.kind !== 'discard' && seq.length + ch.length > MAX_SEQUENCE) {
				discard();
				continue;
			}
			switch (state.kind) {
				case 'esc':
					if (ch === '[') {
						state = {kind: 'csi'};
						seq += ch;
						i++;
					} else {
						// Not a CSI (Alt+key, a lone Esc): the ESC is ordinary input, the character is parsed again.
						emit(out, seq);
						reset();
					}
					break;
				case 'csi':
					if (ch === '<') {
						state = {kind: 'sgr', fields: [0], digits: 0};
						seq += ch;
						i++;
					} else if (ch === 'M' && x10) {
						state = {kind: 'x10', values: []};
						seq += ch;
						i++;
					} else {
						emit(out, seq);
						reset();
					}
					break;
				case 'sgr': {
					const s = state;
					if (isDigit(ch) && s.digits < MAX_DIGITS) {
						s.fields[s.fields.length - 1] = s.fields[s.fields.length - 1]! * 10 + Number(ch);
						s.digits++;
						seq += ch;
						i++;
					} else if (ch === ';' && s.digits > 0 && s.fields.length < 3) {
						s.fields.push(0);
						s.digits = 0;
						seq += ch;
						i++;
					} else if ((ch === 'M' || ch === 'm') && s.digits > 0 && s.fields.length === 3) {
						i++;
						complete({code: s.fields[0]!, x: s.fields[1]!, y: s.fields[2]!, release: ch === 'm'});
					} else {
						discard();
					}
					break;
				}
				case 'discard': {
					const c = code(ch);
					if (c >= 0x20 && c <= 0x3f) {
						i++;
					} else if (c >= 0x40 && c <= 0x7e) {
						i++;
						reset();
					} else {
						// ESC, a control or non-ASCII text cannot belong to the report: it is parsed again.
						reset();
					}
					break;
				}
				case 'x10': {
					const s = state;
					s.values.push(code(ch));
					seq += ch;
					i++;
					if (s.values.length === 3) {
						complete({code: s.values[0]! - 32, x: s.values[1]! - 32, y: s.values[2]! - 32, release: false});
					}
					break;
				}
			}
		}

		const held = state;
		const hold: TokenizerResult['hold'] = !held ? 'none' : held.kind === 'esc' ? 'short' : 'long';
		return {text: out.join(''), events, hold, flushable: held?.kind === 'esc' || held?.kind === 'csi'};
	};

	const flush = (): string => {
		const held = state;
		const text = seq;
		reset();
		if (!held || (held.kind !== 'esc' && held.kind !== 'csi')) return '';
		const out: string[] = [];
		emit(out, text);
		return out.join('');
	};

	return {
		push,
		flush,
		setX10(on) {
			x10 = on;
		},
	};
}

export function decode(raw: RawMouse, columns: number, rows: number): MouseInputEvent | undefined {
	const code = raw.code;
	if (!Number.isInteger(code) || code < 0) return undefined;
	const base = code & ~28;
	if (base & 32 || base >= 128) return undefined;
	const x = raw.x - 1;
	const y = raw.y - 1;
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= columns || y >= rows) return undefined;
	const mods = {shift: (code & 4) !== 0, meta: (code & 8) !== 0, ctrl: (code & 16) !== 0};
	const low = base & 3;
	if (base & 64) {
		if (raw.release || low > 1) return undefined;
		return {kind: 'wheel', button: 'none', wheel: low === 0 ? 'up' : 'down', x, y, ...mods};
	}
	const button = (['left', 'middle', 'right', 'none'] as const)[low]!;
	const kind = raw.release || low === 3 ? 'release' : 'press';
	return {kind, button, x, y, ...mods};
}
