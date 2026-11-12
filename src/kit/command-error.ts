import type {CommandError, CommandErrorKind} from '../../../../src/api.js';

export const COMMAND_ERROR_KINDS: readonly CommandErrorKind[] = ['usage', 'not-found', 'not-isolated', 'invalid', 'failed'];

const CLASS_NAME = /^[A-Za-z_$][\w$]{0,63}$/;

export function commandError(kind: CommandErrorKind, message: string): CommandError {
	return Object.assign(new Error(message), {kind});
}

export function commandErrorKind(error: unknown): CommandErrorKind {
	try {
		if (typeof error !== 'object' || error === null) return 'failed';
		const kind = (error as {kind?: unknown}).kind;
		return COMMAND_ERROR_KINDS.find(k => k === kind) ?? 'failed';
	} catch {
		return 'failed';
	}
}

export function errorClass(error: unknown): string {
	try {
		if (typeof error === 'object' && error !== null) {
			const name = (error as {constructor?: {name?: unknown}}).constructor?.name;
			if (typeof name === 'string' && CLASS_NAME.test(name)) return name;
		}
	} catch {
		return typeof error;
	}
	return typeof error;
}
