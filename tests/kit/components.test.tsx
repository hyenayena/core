import React from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Text} from 'ink';
import {Frame, ListPicker, Spinner, SPINNERS, StatusBar, useSpinnerFrame} from '../../src/kit/ui.js';
import {mountHarness, wait} from '../testkit.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;
const SGR = new RegExp(ESC + '\\[[0-9;?]*[A-Za-z]', 'g');
const plain = (s: string) => s.replace(SGR, '');

const items = Array.from({length: 30}, (_v, i) => ({id: `id${i}`, label: `item ${i}`, meta: `m${i}`}));

test('ListPicker: arrows move, Enter picks and closes, Esc closes', async () => {
	const picked: string[] = [];
	let closed = 0;
	const h = mountHarness(
		<ListPicker title="Pick" empty="none" action="resume" items={items} onPick={id => picked.push(id)} close={() => closed++} />,
	);
	await h.settle();
	assert.match(plain(h.lastFrame()), /↑↓ select · Enter resume · Esc close/);
	h.press(DOWN);
	h.press(DOWN);
	h.press(UP);
	await h.settle();
	h.press('\r');
	await h.settle();
	assert.deepEqual(picked, ['id1']);
	assert.equal(closed, 1);
	h.press(ESC);
	await h.settle(80);
	assert.equal(closed, 2);
	h.unmount();
});

test('ListPicker: windowing keeps the cursor visible', async () => {
	const h = mountHarness(<ListPicker title="Pick" empty="none" action="x" items={items} onPick={() => {}} close={() => {}} />, {
		columns: 60,
		rows: 8,
	});
	for (let i = 0; i < 20; i++) h.press(DOWN);
	await h.settle(80);
	const out = plain(h.lastFrame());
	assert.match(out, /› item 20/);
	assert.doesNotMatch(out, /item 0\b/);
	h.unmount();
});

test('ListPicker: empty list shows the empty text; labels are sanitised and scrubbed', async () => {
	const empty = mountHarness(<ListPicker title="Pick" empty="Nothing here" action="x" items={[]} onPick={() => {}} close={() => {}} />);
	await empty.settle();
	assert.match(plain(empty.lastFrame()), /Nothing here/);
	assert.match(plain(empty.lastFrame()), /Esc close/);
	empty.unmount();

	const evil = [{id: 'a', label: `x${ESC}]0;t\u0007y‮z secret`, meta: `${ESC}[31mm​`}];
	const h = mountHarness(
		<ListPicker title="Pick" empty="n" action="x" items={evil} scrub={s => s.replace('secret', '***')} onPick={() => {}} close={() => {}} />,
	);
	await h.settle();
	const out = plain(h.lastFrame());
	assert.match(out, /› xyz \*\*\* · m/);
	assert.ok(!h.allOutput().includes(`${ESC}]0`));
	assert.ok(!h.allOutput().includes('‮'));
	h.unmount();
});

function Probe({active}: {active: boolean}) {
	return <Text>{`[${useSpinnerFrame(['a', 'b', 'c'], 15, active)}]`}</Text>;
}

test('Spinner advances frames', async () => {
	const h = mountHarness(<Spinner frames={SPINNERS.squareCorners} intervalMs={15} />);
	await h.settle();
	const first = plain(h.lastFrame());
	await wait(80);
	assert.notEqual(plain(h.lastFrame()), first);
	h.unmount();
});

test('useSpinnerFrame starts no timer while inactive', async () => {
	const real = globalThis.setInterval;
	let started = 0;
	globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
		started++;
		return real(...args);
	}) as typeof setInterval;
	try {
		const h = mountHarness(<Probe active={false} />);
		await wait(60);
		assert.match(plain(h.lastFrame()), /\[a\]/);
		h.unmount();
		assert.equal(started, 0);
	} finally {
		globalThis.setInterval = real;
	}
});

test('Frame draws a box with tone colours and sanitised rows', async () => {
	const rows = [
		{text: `plain${ESC}[2J\nnext‮`, tone: 'plain' as const},
		{text: 'added', tone: 'add' as const},
		{text: 'removed', tone: 'del' as const},
	];
	const h = mountHarness(<Frame rows={rows} width={20} />);
	await h.settle();
	const raw = h.lastFrame();
	const out = plain(raw);
	assert.match(out, /┌─{20}/);
	assert.match(out, /│ plain next/);
	assert.match(out, /└─{20}/);
	assert.ok(!raw.includes(`${ESC}[2J`));
	assert.ok(!raw.includes('‮'));
	h.unmount();
});

test('StatusBar strips escapes and shows the text', async () => {
	const h = mountHarness(<StatusBar text={`ok${ESC}]52;c;AAAA\u0007 · ‮done`} />);
	await h.settle();
	assert.match(plain(h.lastFrame()), /ok · done/);
	assert.ok(!h.allOutput().includes(`${ESC}]52`));
	h.unmount();
});
