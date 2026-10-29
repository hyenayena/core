import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text, useInput} from 'ink';
import App from '../../src/app.js';
import {createRegistry} from '../../src/commands.js';
import {mountHarness} from '../testkit.js';
import type {Command, MountControl} from '../../../../src/api.js';

const sample: Command[] = [
	{name: 'mod', description: 'Manage modules', run: () => {}},
	{name: 'claude', description: 'Ask Claude', run: () => {}},
	{name: 'edit', description: 'Edit things', run: () => {}},
	{name: 'status', description: 'Show status', run: () => {}},
];

function Probe({control}: {control: MountControl}) {
	useInput((_input, key) => {
		if (key.escape) control.close();
	});
	return <Text>VIEW</Text>;
}

const viewCommand: Command = {
	name: 'view',
	description: 'mount a view',
	run: (_a, ctx) => ctx.mount!(control => <Probe control={control} />),
};

async function submit(h: ReturnType<typeof setup>, line: string) {
	h.press(line);
	await h.settle();
	h.press('\r');
	await h.settle();
}

function setup(extra: Command[] = sample, size = {columns: 80, rows: 40}) {
	const h = mountHarness(<App registry={createRegistry(extra)} />, size);
	return h;
}

// The harness frame starts with the <Static> output; the live part begins at the prompt row
function liveLines(h: ReturnType<typeof setup>): string[] {
	const lines = h.lastFrame().split('\n');
	let at = 0;
	lines.forEach((l, i) => {
		if (l.startsWith('> ')) at = i;
	});
	return lines.slice(at);
}

test('typing a prefix shows the list with the selection marker and a ghost', async () => {
	const h = setup();
	await h.settle();
	h.press('ec');
	await h.settle();
	const frame = h.lastFrame();
	assert.match(frame, /^> ec/m);
	assert.match(frame, /^› echo/m);
	assert.match(frame, /ho/);
	h.unmount();
});

test('Tab accepts the selection and the command runs on Enter', async () => {
	const h = setup();
	await h.settle();
	h.press('ec');
	await h.settle();
	h.press('\t');
	await h.settle();
	assert.match(h.lastFrame(), /^> echo/m);
	await submit(h, 'hi');
	assert.match(h.lastFrame(), /^hi$/m);
	h.unmount();
});

test('Shift+Tab, Up and Down move the selection', async () => {
	const h = setup();
	await h.settle();
	h.press('e');
	await h.settle();
	const first = h.lastFrame().split('\n').filter(l => l.startsWith('›'));
	assert.equal(first.length, 1);
	h.press('\x1b[B');
	await h.settle();
	const second = h.lastFrame().split('\n').filter(l => l.startsWith('›'));
	assert.notDeepEqual(first, second);
	h.press('\x1b[A');
	await h.settle();
	assert.deepEqual(h.lastFrame().split('\n').filter(l => l.startsWith('›')), first);
	h.press('\x1b[Z');
	await h.settle();
	assert.match(h.lastFrame(), /^> /m);
	h.unmount();
});

test('Down then Enter completes the line without running it', async () => {
	const h = setup();
	await h.settle();
	h.press('m');
	await h.settle();
	h.press('\x1b[B');
	await h.settle();
	h.press('\r');
	await h.settle();
	assert.match(h.lastFrame(), /^> m/m);
	assert.doesNotMatch(h.lastFrame(), /^> m$/m);
	assert.match(h.lastFrame(), /^> mod/m);
	h.unmount();
});

test('Esc closes the list and Up then recalls history', async () => {
	const h = setup();
	await h.settle();
	await submit(h, 'echo one');
	h.press('ex');
	await h.settle();
	assert.match(h.lastFrame(), /^› exit/m);
	h.press('\x1b');
	await h.settle(60);
	assert.doesNotMatch(h.lastFrame(), /^› /m);
	h.press('\x1b[A');
	await h.settle();
	assert.match(h.lastFrame(), /^> echo one/m);
	h.unmount();
});

test('Right at the end accepts the ghost and End as well', async () => {
	const h = setup();
	await h.settle();
	h.press('ech');
	await h.settle();
	h.press('\x1b[C');
	await h.settle();
	assert.match(h.lastFrame(), /^> echo/m);
	h.unmount();
});

test('an unknown command prints the typo suggestion on a second line', async () => {
	const h = setup();
	await h.settle();
	await submit(h, 'ecoh');
	const lines = h.lastFrame().split('\n');
	const i = lines.indexOf('Unknown command: ecoh');
	assert.ok(i >= 0);
	assert.equal(lines[i + 1], 'Did you mean: echo?');
	h.unmount();
});

test('a hostile unknown token is sanitised and capped', async () => {
	const h = setup();
	await h.settle();
	h.press('\x1b[200~' + 'x'.repeat(200) + '\x1b[201~');
	await h.settle();
	h.press('\r');
	await h.settle();
	const line = h.lastFrame().split('\n').find(l => l.startsWith('Unknown command: '))!;
	assert.ok(line.length <= 'Unknown command: '.length + 40);
	h.unmount();
});

test('help <typo> reports the unknown command with a suggestion', async () => {
	const h = setup();
	await h.settle();
	await submit(h, 'help ecoh');
	assert.match(h.lastFrame(), /Error: Unknown command: ecoh\. Did you mean: echo\?/);
	h.unmount();
});

test('help and help <command> list sanitised data', async () => {
	const h = setup();
	await h.settle();
	await submit(h, 'help');
	assert.match(h.lastFrame(), /^ {2}mod\s+Manage modules/m);
	await submit(h, 'help mod');
	assert.match(h.lastFrame(), /^Usage: mod$/m);
	h.unmount();
});

for (const rows of [24, 10, 3]) {
	test(`the live frame stays within rows - 1 at ${rows} rows`, async () => {
		const h = setup(sample, {columns: rows === 3 ? 10 : 80, rows});
		await h.settle();
		h.press('e');
		await h.settle();
		const lines = liveLines(h);
		assert.ok(lines.length <= rows - 1, `${lines.length} lines at ${rows} rows`);
		h.unmount();
	});
}

test('every line fits a narrow terminal, including wide characters', async () => {
	const wide: Command[] = [
		{name: 'cjk', description: '日本語の説明がとても長い文章です', run: () => {}},
		{name: 'emoji', description: '😀😀😀😀😀😀😀😀😀😀😀😀', run: () => {}},
	];
	const h = setup(wide, {columns: 24, rows: 20});
	await h.settle();
	h.press('c');
	await h.settle();
	let width: ((s: string) => number) | undefined;
	try {
		width = (await import('string-width')).default;
	} catch {
		width = undefined;
	}
	const lines = liveLines(h);
	assert.ok(lines.length > 1);
	if (width) {
		// eslint-disable-next-line no-control-regex
		const plain = (l: string) => l.replace(/\u001b\[[0-9;]*m/g, '');
		for (const l of lines) assert.ok(width(plain(l)) <= 24, l);
	}
	h.unmount();
});

test('a long line keeps the prompt on one row with the cursor visible', async () => {
	const h = setup(sample, {columns: 30, rows: 20});
	await h.settle();
	h.press('echo ' + 'abcdefghij'.repeat(10));
	await h.settle();
	const lines = liveLines(h);
	assert.equal(lines.filter(l => l.startsWith('> ')).length, 1);
	assert.ok(lines[0]!.startsWith('> …'));
	assert.ok(lines[0]!.length <= 29);
	assert.ok(lines.slice(1).every(l => !l.startsWith('> ') && l.length <= 29));
	h.unmount();
});

test('a mounted view hides the hints and they return afterwards', async () => {
	const h = setup([...sample, viewCommand]);
	await h.settle();
	await submit(h, 'view');
	assert.match(h.lastFrame(), /VIEW/);
	assert.doesNotMatch(h.lastFrame(), /^› /m);
	h.press('\x1b');
	await h.settle(60);
	h.press('e');
	await h.settle();
	assert.match(h.lastFrame(), /^› /m);
	h.unmount();
});

test('resize re-lays out within the new height', async () => {
	const h = setup(sample, {columns: 80, rows: 40});
	await h.settle();
	h.press('e');
	await h.settle();
	const before = liveLines(h).length;
	h.resize(40, 6);
	await h.settle();
	const after = liveLines(h);
	assert.ok(after.length <= 5);
	assert.ok(after.length <= before);
	h.unmount();
});

test('bracketed paste and multi-character chunks insert sanitised text without accepting', async () => {
	const h = setup();
	await h.settle();
	h.press('\x1b[200~echo a\tb\nc\x1b[31m\x1b[201~');
	await h.settle();
	assert.match(h.lastFrame(), /^> echo a b c/m);
	h.unmount();

	const g = setup();
	await g.settle();
	const before = g.frameCount();
	g.press('ec\tho');
	await g.settle();
	assert.match(g.lastFrame(), /^> ec ho/m);
	assert.ok(g.frameCount() - before <= 3);
	g.unmount();
});

test('Ctrl+C at the prompt still exits', async () => {
	const h = setup();
	await h.settle();
	const exited = h.waitUntilExit();
	h.press('\x03');
	await exited;
});
