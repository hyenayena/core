export type ParsedLine = {line: string; name: string; args: string[]};

export function parseLine(raw: string): ParsedLine | undefined {
	const line = raw.trim();
	if (!line) return undefined;
	const [name, ...args] = line.split(/\s+/);
	return {line, name: name!, args};
}
