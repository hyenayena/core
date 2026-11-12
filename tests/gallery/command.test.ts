import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {CommandContext, PrintOptions} from '../../../../src/api.js';
import {createUiCommand} from '../../src/gallery/command.js';
import {registerGallerySection} from '../../src/kit/gallery.js';
import {stringCells} from '../../src/hints/width.js';
import {noopLog} from '../../src/noop-log.js';
import {stripStyles} from '../../src/transcript/wrap.js';

const ESC = String.fromCharCode(27);

function ctxWith(extra: Partial<CommandContext> = {}) {
	const prints: {text: string; options?: PrintOptions | undefined}[] = [];
	const ctx = {print: (text: string, options?: PrintOptions) => prints.push({text, options}), ...extra} as CommandContext;
	return {ctx, prints};
}

test('the ui command is safe, with a gallery subcommand', () => {
	const c = createUiCommand(noopLog);
	assert.equal(c.agent, 'safe');
	assert.deepEqual(c.subcommands?.map(s => [s.name, s.agent]), [['gallery', undefined]]);
});

test('ui alone shows the help, or the usage without showHelp', async () => {
	const c = createUiCommand(noopLog);
	let shown = 0;
	await c.run([], ctxWith({showHelp: () => void shown++}).ctx);
	assert.equal(shown, 1);
	const {ctx, prints} = ctxWith();
	await c.run([], ctx);
	assert.equal(prints[0]?.text, 'ui <subcommand>');
	await assert.rejects(() => Promise.resolve(c.run(['nope'], ctx)), /Unknown subcommand: nope/);
});

test('gallery validates its options', async () => {
	const c = createUiCommand(noopLog);
	const {ctx} = ctxWith();
	for (const args of [['gallery', '--width'], ['gallery', '--width', '10'], ['gallery', '--width', '501'], ['gallery', '--width', 'x'], ['gallery', '--depth', 'rgb'], ['gallery', '--depth'], ['gallery', '--bogus']]) {
		await assert.rejects(() => Promise.resolve(c.run(args, ctx)), Error, args.join(' '));
	}
	await assert.rejects(() => Promise.resolve(c.run(['gallery', 'nope'], ctx)), /Unknown gallery section: nope/);
});

test('gallery prints a plain fallback and a render function laid out per width', async () => {
	const c = createUiCommand(noopLog);
	const {ctx, prints} = ctxWith();
	await c.run(['gallery', 'theme', '--depth', '16'], ctx);
	assert.equal(prints.length, 1);
	const {text, options} = prints[0]!;
	assert.ok(!text.includes(ESC));
	assert.match(text, /Theme/);
	assert.equal(typeof options?.render, 'function');
	const wide = String(options!.render!(120));
	const narrow = String(options!.render!(40));
	assert.ok(wide.includes(`${ESC}[`));
	assert.notEqual(wide, narrow);
	assert.ok(stripStyles(wide).split('\n').every(r => r.length <= 120));
});

test('--width fixes the layout width and --depth none removes colour', async () => {
	const c = createUiCommand(noopLog);
	const {ctx, prints} = ctxWith();
	await c.run(['gallery', 'glyphs', '--width', '30', '--depth', 'none', '--ascii'], ctx);
	const out = String(prints[0]!.options!.render!(200));
	assert.ok(stripStyles(out).split('\n').every(r => r.length <= 29));
	assert.match(stripStyles(out), /bullet \* \(\*\)/);
});

test('--rows is validated like --width', async () => {
	const c = createUiCommand(noopLog);
	for (const bad of ['5', '201', 'x', '1.5', '-3']) {
		await assert.rejects(async () => c.run(['gallery', '--rows', bad], ctxWith().ctx), /--rows needs a number of rows from 6 to 200\. See "ui gallery help"/, bad);
	}
	await assert.rejects(async () => c.run(['gallery', '--rows'], ctxWith().ctx), /--rows needs a number/);
});

test('--rows reaches the renderer, default 24', async () => {
	const seen: number[] = [];
	registerGallerySection({name: 'rowsprobe', title: 'Probe', load: () => ({rows}) => (seen.push(rows), ['x'])});
	const c = createUiCommand(noopLog);
	await c.run(['gallery', 'rowsprobe', '--rows', '40'], ctxWith().ctx);
	await c.run(['gallery', 'rowsprobe'], ctxWith().ctx);
	assert.deepEqual(seen, [40, 24]);
});

test('a --width wider than the showing area is cut with a note', async () => {
	const c = createUiCommand(noopLog);
	const {ctx, prints} = ctxWith();
	await c.run(['gallery', 'glyphs', '--width', '100', '--depth', 'none'], ctx);
	const rows = stripStyles(String(prints[0]!.options!.render!(60))).split('\n');
	assert.ok(rows.every(r => stringCells(r) <= 60));
	assert.equal(rows.at(-1), 'laid out for 100 columns, cut to 60');
	const fits = stripStyles(String(prints[0]!.options!.render!(120)));
	assert.ok(!fits.includes('laid out for'));
});
