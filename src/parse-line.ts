export type ParsedLine = {line: string; name: string; args: string[]};

/** Splits a submitted line into command name and arguments; undefined for a blank line. */
export function parseLine(raw: string): ParsedLine | undefined {
	const line = raw.trim();
	if (!line) return undefined;
	const [name, ...args] = line.split(/\s+/);
	return {line, name: name!, args};
}
