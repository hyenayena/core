import type {Command} from '../../../../src/api.js';
import {buildCatalog, type CatalogCommand, type CatalogSub} from './catalog.js';
import {optionNames, parseUsage, slotKey, splitUsage} from './usage.js';

const MAX_DESCRIPTION = 100;

type Node = CatalogCommand | CatalogSub;

function checkNode(node: Node, names: readonly string[], problems: string[]): void {
	const at = names.join(' ');
	const description = node.description;
	if (description === '') problems.push(`${at}: the description is empty`);
	if (Array.from(description).length > MAX_DESCRIPTION) problems.push(`${at}: the description is longer than ${MAX_DESCRIPTION} characters`);
	if (description.endsWith('.')) problems.push(`${at}: the description ends with "."`);
	if (/\([^()]*\bhelp\)/u.test(description)) problems.push(`${at}: the description points to help`);

	const usage = node.usage ?? '';
	if (usage === '') {
		problems.push(`${at}: no usage`);
	} else {
		const words = splitUsage(usage);
		if (!names.every((w, i) => words[i] === w)) problems.push(`${at}: the usage does not start with "${at}"`);
		const tokens = parseUsage(usage, names.length);
		const slots = tokens.filter(t => t.kind === 'slot').map(t => slotKey(t.text));
		const options = tokens.filter(t => t.kind === 'flag').flatMap(t => optionNames(t.text).map(o => o.name));
		for (const slot of slots) {
			if (!node.args.some(a => a.name === slot)) problems.push(`${at}: no argument doc for "${slot}"`);
		}
		for (const name of options) {
			if (!node.options.some(o => o.name === name || o.aliases.includes(name))) problems.push(`${at}: no option doc for "${name}"`);
		}
		for (const a of node.args) {
			if (!slots.includes(a.name)) problems.push(`${at}: the argument "${a.name}" is not in the usage`);
		}
		for (const o of node.options) {
			if (![o.name, ...o.aliases].some(n => options.includes(n))) problems.push(`${at}: the option "${o.name}" is not in the usage`);
		}
	}

	for (const sub of node.subs) {
		if (sub.builtin) continue;
		if (sub.name === 'help') problems.push(`${at} help: core provides the help subcommand`);
		checkNode(sub, [...names, sub.name], problems);
	}
}

/** Problems with a command's documentation (descriptions, usages, argument and option docs); empty when it is fine. */
export function checkCommandDocs(command: Command): string[] {
	const catalog = buildCatalog([command]);
	const cmd = catalog.commands[0];
	if (!cmd) return ['the command has no valid name'];
	const problems: string[] = [];
	checkNode(cmd, [cmd.name], problems);
	return problems;
}
