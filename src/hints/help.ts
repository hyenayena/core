import type {Catalog, CatalogSub} from './catalog.js';
import {stringCells} from './width.js';
import {unknownCommandLines} from './typo.js';

const MIN_NAME_COLUMN = 8;

function pad(s: string, cells: number): string {
	return s + ' '.repeat(Math.max(0, cells - stringCells(s)));
}

function subLabel(sub: CatalogSub): string {
	return sub.aliases.length > 0 ? `${sub.name} (${sub.aliases.join(', ')})` : sub.name;
}

function subLines(subs: readonly CatalogSub[], indent: string): string[] {
	const labelW = Math.max(0, ...subs.map(s => stringCells(subLabel(s))));
	const usageW = Math.max(0, ...subs.map(s => stringCells(s.usage)));
	const lines: string[] = [];
	for (const s of subs) {
		lines.push(
			`${indent}${pad(subLabel(s), labelW)}  ${pad(s.usage, usageW)}  ${s.description}`.trimEnd(),
		);
		lines.push(...subLines(s.subs, indent + '  '));
	}
	return lines;
}

/** Lines for `help` (no name) or `help <name>`; an unknown name yields the unknown-command lines. */
export function helpLines(catalog: Catalog, name?: string): string[] {
	if (name === undefined) {
		const w = Math.max(MIN_NAME_COLUMN, ...catalog.commands.map(c => stringCells(c.name)));
		return catalog.commands.map(c => `  ${pad(c.name, w)} ${c.description}`.trimEnd());
	}
	const cmd = catalog.byName.get(name);
	if (!cmd) return unknownCommandLines(catalog, name);
	const lines = [cmd.usage ?? cmd.name];
	if (cmd.description !== '') lines.push(cmd.description);
	lines.push(...subLines(cmd.subs, '  '));
	return lines;
}
