import React from 'react';
import {render} from 'ink';
import type {ModuleMain} from '../../../src/api.js';
import App from './app.js';
import {createRegistry} from './commands.js';

const main: ModuleMain = yena => {
	render(<App registry={createRegistry(yena.commands)} log={yena.log} />, {exitOnCtrlC: false});
};

export default main;
