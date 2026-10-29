import React from 'react';
import {render} from 'ink';
import type {ModuleMain} from '../../../src/api.js';
import App from './app.js';
import {createRegistry} from './commands.js';
import {APP_TITLE, setTerminalTitle} from './view/title.js';
import {loadPrefs} from './view/prefs.js';
import {createInputProxy} from './mouse/input.js';
import {createMouseTerminal} from './mouse/terminal.js';

const main: ModuleMain = yena => {
	setTerminalTitle(process.stdout, APP_TITLE);
	loadPrefs(yena.dataDir);
	const registry = createRegistry(yena.commands);
	const proxy = process.stdin.isTTY ? createInputProxy(process.stdin) : undefined;
	const mouse = proxy ? createMouseTerminal(process.stdout, proxy) : undefined;
	if (mouse) process.once('exit', () => mouse.shutdown());
	render(<App registry={registry} log={yena.log} mouse={mouse} alerts={yena.alerts} />, {
		...(proxy ? {stdin: proxy.stream as unknown as NodeJS.ReadStream} : {}),
		exitOnCtrlC: false,
		alternateScreen: true,
	});
};

export default main;
