import type {Command, CommandContext, HeadlessMain} from '../../../src/api.js';
import {createCommandBridge, hasUnsafeChars, MAX_LINE} from './agent/bridge.js';
import {createRegistry} from './commands.js';
import {buildCatalog} from './hints/catalog.js';
import {completionLines} from './hints/catalog-lines.js';
import {walkPath} from './hints/path.js';
import {sanitizeBlock} from './hints/sanitize.js';
import {plainLines} from './kit/styled.js';
import {unknownCommandLines} from './hints/typo.js';
import {parseLine} from './parse-line.js';
import {getPrefs, loadPrefs} from './view/prefs.js';
import {isQuitLine} from './view/keys.js';

const fail = (message: string): Error => Object.assign(new Error(message), {exitCode: 2});

const headless: HeadlessMain = async (yena, request) => {
	const registry = createRegistry(yena.commands);
	const catalog = () => buildCatalog(registry.commands);
	if (request.catalog) {
		const lines = completionLines(catalog());
		if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
		return;
	}
	loadPrefs(yena.dataDir);

	const line = request.args.join(' ');
	if (line.trim() === '') throw fail('The command line is empty');
	if (line.length > MAX_LINE) throw fail(`The command line is longer than ${MAX_LINE} characters`);
	if (hasUnsafeChars(line)) throw fail('The command line contains control or formatting characters');
	const parsed = parseLine(line);
	if (!parsed || isQuitLine(parsed.line)) throw fail('The line is not a runnable command');

	const command: Command | undefined = registry.find(parsed.name);
	if (!command) {
		const [unknown, hint] = unknownCommandLines(catalog(), parsed.name);
		throw fail(hint === undefined ? unknown! : `${unknown}. ${hint}`);
	}

	const print = (text: unknown) => {
		process.stdout.write(`${sanitizeBlock(typeof text === 'string' ? text : String(text))}\n`);
	};
	const ctx: CommandContext = {
		print,
		printStyled: blocks => {
			const lines = plainLines(blocks);
			if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
		},
		clear() {},
		exit() {},
		headless: true,
		suspend: fn => Promise.resolve().then(fn),
		commandBridge: createCommandBridge({
			find: name => registry.find(name),
			catalog,
			mode: () => getPrefs().agentCommands,
			tee() {},
			clear() {},
			exit() {},
			log: yena.log,
		}),
	};

	const catalogCommand = catalog().byName.get(parsed.name);
	const subPath = catalogCommand ? walkPath(catalogCommand, parsed.args).path.map(s => s.name).join(' ') : '';
	const started = Date.now();
	const done = (status: 'ok' | 'error') => {
		try {
			yena.log.info('headless command', {
				command: catalogCommand?.name ?? 'unknown',
				...(subPath !== '' && {subcommand: subPath}),
				status,
				ms: Date.now() - started,
			});
		} catch {}
	};
	try {
		await command.run(parsed.args, ctx);
	} catch (error) {
		done('error');
		throw error;
	}
	done('ok');
};

export default headless;
