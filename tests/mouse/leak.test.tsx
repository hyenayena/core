import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text} from 'ink';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {createMouseTerminal} from '../../src/mouse/terminal.js';
import {createFakeStdout, createFakeTty, mountHarness, wait} from '../testkit.js';
import type {Command} from '../../../../src/api.js';

const ESC = '\x1b';
const CTRL_T = '\x14';

function setup(withView = false) {
	const commands: Command[] = withView
		? [
				{
					name: 'chat',
					description: 'open the chat',
					autostart: true,
					run: async (_a, ctx) => {
						await ctx.mount!(() => <Text>CHAT</Text>);
					},
				},
			]
		: [];
	const size = {columns: 100, rows: 30};
	const tty = createFakeTty();
	const stdout = createFakeStdout(size);
	const proxy = createInputProxy(tty, {size: () => ({columns: stdout.columns, rows: stdout.rows})});
	const mouse = createMouseTerminal(stdout, proxy);
	const h = mountHarness(<App registry={createRegistry(commands)} mouse={mouse} />, size, {tty, stdin: proxy.stream, stdout});
	const promptLine = () =>
		h
			.lastFrame()
			.split('\n')
			.map(l => l.replace(/^│ /, ''))
			.filter(l => l.startsWith('> '))
			.at(-1) ?? '';
	return {h, promptLine};
}

const assertClean = (line: string, expected: string) => {
	assert.equal(line.trimEnd(), `> ${expected}`);
	assert.ok(!line.includes('[<') && !line.includes(';') && !line.includes('M'), line);
};

test('reports interleaved with typing never reach the Prompt', async () => {
	const {h, promptLine} = setup();
	await h.settle(60);
	h.press(`qq${ESC}[<64;5;5Mqq${ESC}[<0;3;3M${ESC}[<65;5;5Mqq`);
	await h.settle(80);
	assertClean(promptLine(), 'qqqqqq');
	h.unmount();
});

test('reports split over chunks never reach the Prompt', async () => {
	const {h, promptLine} = setup();
	await h.settle(60);
	h.press(`ab${ESC}[<6`);
	h.press(`4;12;`);
	h.press(`4Mcd`);
	await h.settle(80);
	assertClean(promptLine(), 'abcd');
	h.unmount();
});

test('report halves delayed past the Esc flush never reach the Prompt', async () => {
	const {h, promptLine} = setup();
	await h.settle(60);
	h.press(`ab${ESC}[<`);
	await wait(30);
	h.press('0;3;');
	await wait(25);
	h.press('3Mcd');
	await h.settle(80);
	assertClean(promptLine(), 'abcd');
	h.unmount();
});

test('bracketed paste still works', async () => {
	const {h, promptLine} = setup();
	await h.settle(60);
	h.press(`${ESC}[200~hello world${ESC}[201~`);
	await h.settle(80);
	assert.equal(promptLine().trimEnd(), '> hello world');
	h.unmount();
});

test('Ctrl+T still closes the side console; double Esc does not', async () => {
	const {h} = setup(true);
	await h.settle(60);
	h.press(CTRL_T);
	await h.settle(80);
	assert.match(h.lastFrame(), /Console/);
	h.press(ESC);
	await h.settle(40);
	h.press(ESC);
	await h.settle(80);
	assert.match(h.lastFrame(), /Console/);
	h.press(CTRL_T);
	await h.settle(80);
	assert.doesNotMatch(h.lastFrame(), /Console/);
	h.unmount();
});

test('Ctrl+C still exits', async () => {
	const {h} = setup();
	await h.settle(60);
	const exited = h.waitUntilExit();
	h.press('\x03');
	await Promise.race([exited, wait(1000).then(() => assert.fail('the app did not exit'))]);
});
