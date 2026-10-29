import {getPrefs} from '../view/prefs.js';

export function colorEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const v = env['NO_COLOR'];
	return (v === undefined || v === '') && getPrefs().colors;
}

export function c(
	name: string,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	return colorEnabled(env) ? name : undefined;
}
