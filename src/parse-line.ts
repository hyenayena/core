export type ParsedLine = {line: string; name: string; args: string[]};

export type Word = {text: string; start: number; end: number; quoted: boolean};

export class LineError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LineError';
	}
}

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/u.test(ch);
const isQuote = (ch: string | undefined): ch is '"' | "'" => ch === '"' || ch === "'";
const OPTION_EQ = /^-[^=\s]*=$/u;

export function splitWords(line: string, opts: {partial?: boolean} = {}): {words: Word[]; open?: '"' | "'"} {
	const words: Word[] = [];
	const n = line.length;
	let i = 0;
	while (i < n) {
		if (isSpace(line[i])) {
			i++;
			continue;
		}
		const start = i;
		let text = '';
		let quote: '"' | "'" | undefined;
		let seenEq = false;
		while (i < n && !isSpace(line[i])) {
			const ch = line[i]!;
			if (isQuote(ch) && i === start) {
				quote = ch;
				i++;
				break;
			}
			text += ch;
			i++;
			if (ch === '=' && !seenEq) {
				seenEq = true;
				if (OPTION_EQ.test(text) && isQuote(line[i])) {
					quote = line[i] as '"' | "'";
					i++;
					break;
				}
			}
		}
		if (quote === undefined) {
			words.push({text, start, end: i, quoted: false});
			continue;
		}
		let closed = false;
		while (i < n) {
			const ch = line[i]!;
			if (quote === '"' && ch === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
				text += line[i + 1];
				i += 2;
				continue;
			}
			if (ch === quote && (i + 1 === n || isSpace(line[i + 1]))) {
				i++;
				closed = true;
				break;
			}
			text += ch;
			i++;
		}
		if (!closed) {
			if (!opts.partial) throw new LineError(`The line has an unclosed ${quote} quote`);
			words.push({text, start, end: n, quoted: true});
			return {words, open: quote};
		}
		words.push({text, start, end: i, quoted: true});
	}
	return {words};
}

export function quoteWord(w: string): string {
	const plain = w !== '' && !/\s/u.test(w) && !isQuote(w[0]) && !/^-[^=\s]*=["']/u.test(w);
	return plain ? w : `"${w.replace(/[\\"]/g, '\\$&')}"`;
}

export function joinWords(ws: readonly string[]): string {
	return ws.map(quoteWord).join(' ');
}

export function parseLine(raw: string): ParsedLine | undefined {
	const line = raw.trim();
	if (!line) return undefined;
	const [first, ...rest] = splitWords(line).words;
	if (!first || first.text === '') throw new LineError('The line has no command name');
	return {line, name: first.text, args: rest.map(w => w.text)};
}
