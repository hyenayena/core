import React from 'react';
import {render} from 'ink';
import type {ModuleMain} from '../../../src/api.js';
import App from './app.js';
import {createRegistry} from './commands.js';
import {APP_TITLE, setTerminalTitle} from './view/title.js';

const main: ModuleMain = yena => {
	setTerminalTitle(process.stdout, APP_TITLE);
	render(<App registry={createRegistry(yena.commands)} log={yena.log} />, {
		exitOnCtrlC: false,
		// Full screen: the app keeps and scrolls its own transcript; the terminal's screen is restored on exit.
		alternateScreen: true,
	});
};

export default main;
