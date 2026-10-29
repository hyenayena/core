export const MAX_OUTPUT_CHARS = 24 * 1024;
export const MAX_OUTPUT_LINES = 600;

export type CaptureLimits = {chars: number; lines: number};

export type Capture = {
	push: (line: string) => void;
	readonly truncated: boolean;
	text: () => string;
};

export function createCapture(limits: CaptureLimits = {chars: MAX_OUTPUT_CHARS, lines: MAX_OUTPUT_LINES}): Capture {
	const headChars = Math.floor((limits.chars * 2) / 3);
	const headLines = Math.floor((limits.lines * 2) / 3);
	const tailChars = limits.chars - headChars;
	const tailLines = limits.lines - headLines;
	const head: string[] = [];
	const tail: string[] = [];
	let headUsed = 0;
	let tailUsed = 0;
	let headOpen = true;
	let omittedLines = 0;
	let omittedChars = 0;

	const toTail = (line: string) => {
		let piece = line;
		if (piece.length > tailChars - 1) {
			piece = line.slice(line.length - (tailChars - 1));
			omittedChars += line.length - piece.length;
		}
		tail.push(piece);
		tailUsed += piece.length + 1;
		while (tail.length > tailLines || tailUsed > tailChars) {
			const dropped = tail.shift()!;
			tailUsed -= dropped.length + 1;
			omittedLines++;
			omittedChars += dropped.length + 1;
		}
	};

	return {
		push(line) {
			if (headOpen) {
				const room = headChars - headUsed - 1;
				if (head.length < headLines && line.length <= room) {
					head.push(line);
					headUsed += line.length + 1;
					return;
				}
				headOpen = false;
				if (head.length < headLines && room > 0 && line.length > tailChars) {
					head.push(line.slice(0, room));
					headUsed += room + 1;
					omittedChars += line.length - room;
					return;
				}
			}
			toTail(line);
		},
		get truncated() {
			return omittedLines > 0 || omittedChars > 0;
		},
		text() {
			if (omittedLines === 0 && omittedChars === 0) return [...head, ...tail].join('\n');
			const what = omittedLines > 0 ? `${omittedLines} lines, ${omittedChars} characters` : `${omittedChars} characters`;
			return [...head, `… [${what} omitted] …`, ...tail].join('\n');
		},
	};
}
