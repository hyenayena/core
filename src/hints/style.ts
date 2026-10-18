export function colorEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const v = env['NO_COLOR'];
	return v === undefined || v === '';
}

/** Returns the colour name, or undefined when colour is disabled (attributes stay). */
export function c(
	name: string,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	return colorEnabled(env) ? name : undefined;
}
