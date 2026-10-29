import type {Catalog} from './catalog.js';
import {sanitizeText} from './sanitize.js';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_COMMANDS = 500;
const MAX_SUBS = 100;
const MAX_DESCRIPTION = 80;

const describe = (text: string): string => sanitizeText(text, MAX_DESCRIPTION).replace(/[\t\r\n]/g, ' ');

export function completionLines(catalog: Catalog): string[] {
	const lines: string[] = [];
	let commands = 0;
	for (const cmd of catalog.commands) {
		if (commands >= MAX_COMMANDS) break;
		if (!NAME.test(cmd.name)) continue;
		commands++;
		lines.push(`${cmd.name}\t${describe(cmd.description)}`);
		let subs = 0;
		for (const sub of cmd.subs) {
			if (subs >= MAX_SUBS) break;
			if (sub.builtin || !NAME.test(sub.name)) continue;
			subs++;
			lines.push(`${cmd.name} ${sub.name}\t${describe(sub.description)}`);
		}
	}
	return lines;
}
