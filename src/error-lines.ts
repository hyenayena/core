import {sanitizeText} from './hints/sanitize.js';
import type {CommandErrorKind} from '../../../src/api.js';
import {commandErrorKind, errorClass} from './kit/command-error.js';

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

const CODE = /^[A-Z][A-Z0-9_]{0,39}$/;
const MAX_FRAMES = 12;

export function errorLogFields(error: unknown): {kind: CommandErrorKind; errClass: string; code?: string} {
	let code: unknown;
	try {
		code = typeof error === 'object' && error !== null ? (error as {code?: unknown}).code : undefined;
	} catch {}
	return {
		kind: commandErrorKind(error),
		errClass: errorClass(error),
		...(typeof code === 'string' && CODE.test(code) && {code}),
	};
}

export function stackFrames(error: unknown): string | undefined {
	try {
		if (!(error instanceof Error)) return undefined;
		const stack = error.stack;
		if (typeof stack !== 'string') return undefined;
		const skip = String(error.message).split('\n').length;
		const frames = stack
			.split('\n')
			.slice(skip)
			.filter(line => /^\s+at /.test(line))
			.slice(0, MAX_FRAMES)
			.map(line => line.trim());
		return frames.length > 0 ? frames.join('\n') : undefined;
	} catch {
		return undefined;
	}
}
