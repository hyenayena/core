import {sanitizeText} from './hints/sanitize.js';

const MAX_ERROR_LINES = 20;
const MAX_ERROR_LINE = 4096;

export function errorLines(error: unknown): string[] {
	let message: string;
	try {
		message = error instanceof Error ? String(error.message) : String(error);
	} catch {
		message = 'unprintable error';
	}
	const lines = message
		.slice(0, MAX_ERROR_LINES * MAX_ERROR_LINE)
		.split('\n')
		.slice(0, MAX_ERROR_LINES)
		.map(l => sanitizeText(l, MAX_ERROR_LINE));
	const out = lines.filter(l => l !== '');
	return out.length > 0 ? out : ['unknown error'];
}
