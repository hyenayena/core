import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import React from 'react';
import {Text} from 'ink';
// Ink's own chalk: the harness has no colour level, so the highlight would not show in the output.
import chalk from 'chalk';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {createInputProxy} from '../../src/mouse/input.js';
import {createMouseTerminal} from '../../src/mouse/terminal.js';
import {CLIPBOARD_DIR_ENV, clipboardSequence, copyToClipboard} from '../../src/view/clipboard.js';
import {createFakeStdout, createFakeTty, mountHarness} from '../testkit.js';
import type {Command, MountControl} from '../../../../src/api.js';

const ESC = '\x1b';
// 1-based cells, as the terminal sends them.
const press = (x: number, y: number) => `${ESC}[<0;${x};${y}M`;
const drag = (x: number, y: number) => `${ESC}[<32;${x};${y}M`;
const release = (x: number, y: number) => `${ESC}[<0;${x};${y}m`;

function setup() {
	delete process.env[CLIPBOARD_DIR_ENV];
	let control: MountControl | undefined;
	const commands: Command[] = [
		{
			name: 'chat',
			description: 'open the chat',
			autostart: true,
			run: async (_a, ctx) => {
				await ctx.mount!(c => {
					control = c;
					return <Text>CHAT</Text>;
				});
			},
		},
	];
	const size = {columns: 80, rows: 20};
	const tty = createFakeTty();
	const stdout = createFakeStdout(size);
	const proxy = createInputProxy(tty, {size: () => ({columns: stdout.columns, rows: stdout.rows})});
	const mouse = createMouseTerminal(stdout, proxy);
	const h = mountHarness(<App registry={createRegistry(commands)} mouse={mouse} />, size, {tty, stdin: proxy.stream, stdout});
	const send = async (text: string) => {
		h.press(text);
		await h.settle(40);
	};
	// The 1-based screen row showing `text`.
	const rowOf = (text: string): number => {
		const at = h.lastFrame().split('\n').findIndex(l => l.includes(text));
		assert.ok(at >= 0, `${text} is on the screen`);
		return at + 1;
	};
	return {h, send, rowOf, print: (t: string) => control!.print!(t)};
}

const copied = (out: string, text: string) => out.includes(clipboardSequence(text));
const INVERSE = '\x1b[7m';

test.before(() => {
	chalk.level = 1;
});
test.after(() => {
	chalk.level = 0;
});

test('dragging over the transcript selects, highlights and copies the text', async () => {
	const {h, send, rowOf, print} = setup();
	await h.settle(60);
	print('alpha beta gamma');
	print('second line here');
	await h.settle(40);
	const y1 = rowOf('alpha beta');
	const y2 = rowOf('second line');
	await send(press(7, y1));
	await send(drag(10, y1));
	await send(drag(6, y2));
	// The highlight is drawn while dragging.
	assert.ok(h.lastFrame().includes(`${INVERSE}beta gamma`), 'inverse highlight');
	await send(release(6, y2));
	assert.ok(copied(h.allOutput(), 'beta gamma\nsecond'), 'copied with OSC 52');
	assert.match(h.lastFrame(), /Copied 17 characters/);
	h.unmount();
});

test('a plain click copies nothing; double click copies a word, triple click the line', async () => {
	const {h, send, rowOf, print} = setup();
	await h.settle(60);
	print('open src/app.tsx now');
	await h.settle(40);
	const y = rowOf('open src');
	await send(press(9, y) + release(9, y));
	assert.equal(h.allOutput().includes(`${ESC}]52;`), false);
	await send(press(9, y) + release(9, y));
	assert.ok(copied(h.allOutput(), 'src/app.tsx'));
	await send(press(9, y) + release(9, y));
	assert.ok(copied(h.allOutput(), 'open src/app.tsx now'));
	h.unmount();
});

test('a key press clears the selection; drags over the chat view select nothing', async () => {
	const {h, send, rowOf, print} = setup();
	await h.settle(60);
	print('some words');
	await h.settle(40);
	const y = rowOf('some words');
	await send(press(1, y) + drag(4, y));
	assert.ok(h.lastFrame().includes(`${INVERSE}some`), 'highlighted while dragging');
	await send('x');
	assert.equal(h.lastFrame().includes(INVERSE), false, 'no highlight after a key');
	const view = rowOf('CHAT');
	await send(press(1, view) + drag(4, view) + release(4, view));
	assert.equal(h.allOutput().includes(`${ESC}]52;`), false);
	h.unmount();
});

test('the launcher folder gets the copied text as a file', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'yena-clip-'));
	try {
		const target = path.join(dir, 'clip');
		assert.equal(copyToClipboard({write: () => true}, 'hello', {[CLIPBOARD_DIR_ENV]: target}), true);
		const files = readdirSync(target);
		assert.equal(files.length, 1);
		assert.match(files[0]!, /^\d+-\d+-\d+\.txt$/);
		assert.equal(readFileSync(path.join(target, files[0]!), 'utf8'), 'hello');
		// A relative folder is refused; OSC 52 still went out.
		assert.equal(copyToClipboard({write: () => true}, 'x', {[CLIPBOARD_DIR_ENV]: 'rel'}), true);
		assert.equal(existsSync('rel'), false);
		// Without a working terminal the folder alone is enough.
		const broken = {
			write: () => {
				throw new Error('closed');
			},
		};
		assert.equal(copyToClipboard(broken, 'y', {[CLIPBOARD_DIR_ENV]: target}), true);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});
