import React from 'react';
import {render} from 'ink';
import type {ModuleMain} from '../../../src/api.js';
import App from './app.js';
import {createRegistry} from './commands.js';
import {APP_TITLE, setTerminalTitle} from './view/title.js';

const main: ModuleMain = yena => {
	setTerminalTitle(process.stdout, APP_TITLE);
	render(<App registry={createRegistry(yena.commands)} log={yena.log} />, {exitOnCtrlC: false});
};

export default main;
