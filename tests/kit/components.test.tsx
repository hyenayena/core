import React from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Text} from 'ink';
import {BrailleBar, Frame, LabeledInput, labeledInputRows, ListPicker, Spinner, SPINNERS, StatusBar, useSpinnerFrame} from '../../src/kit/ui.js';
import {hangingRows, stringCells} from '../../src/kit/text.js';
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

test('SPINNERS has the Claude Code sparkle and blink frames', () => {
	assert.deepEqual(SPINNERS.sparkle, ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']);
	assert.deepEqual(SPINNERS.blink, ['●', ' ']);
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

test('BrailleBar: rows at a narrow width, NO_COLOR uses inverse for fail', async () => {
	const states = [...Array.from({length: 16}, () => 'pass' as const), ...Array.from({length: 8}, () => 'fail' as const)];
	const h = mountHarness(<BrailleBar states={states} width={2} />);
	await h.settle();
	assert.equal(plain(h.lastFrame()).split('\n').filter(l => l.trim()).length, 2);
	h.unmount();

	const prev = process.env['NO_COLOR'];
	process.env['NO_COLOR'] = '1';
	try {
		const n = mountHarness(<BrailleBar states={states} width={5} />);
		await n.settle();
		assert.ok(!new RegExp(ESC + '\\[(3[0-7]|9[0-7])m').test(n.lastFrame()));
		n.unmount();
		// The harness runs without chalk colour levels, so inspect the element props instead of SGR.
		type El = React.ReactElement<{children?: El | El[]; inverse?: boolean; color?: string; dimColor?: boolean}>;
		const root = BrailleBar({states, width: 5}) as El;
		const rows = ([] as El[]).concat(root.props.children ?? []);
		const cells = rows.flatMap(row => ([] as El[]).concat(row.props.children ?? []));
		const props = cells.map(cell => (cell.type as (p: unknown) => El)(cell.props).props);
		assert.ok(props.some(p => p.inverse === true && p.color === undefined));
		assert.ok(props.every(p => p.color === undefined));
	} finally {
		if (prev === undefined) delete process.env['NO_COLOR'];
		else process.env['NO_COLOR'] = prev;
	}
});

const LONG_TEXT = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
const wordsOf = (frame: string) => plain(frame).replace(/[›│]/g, ' ').split(/\s+/).filter(Boolean);

test('hangingRows: wraps by words and indents the rows after the first under the text', () => {
	const rows = hangingRows('❯ 1 ', LONG_TEXT, 24);
	assert.equal(rows[0], '❯ 1 alpha beta gamma');
	assert.ok(rows.slice(1).every(r => r.startsWith('    ')));
	assert.ok(rows.every(r => stringCells(r) <= 24));
	assert.equal(rows.map(r => r.trim().replace(/^❯ 1 /, '')).join(' '), LONG_TEXT);
});

test('LabeledInput: a long typed value wraps under its label, nothing is cut', async () => {
	assert.equal(labeledInputRows('Reason: ', LONG_TEXT, 30), 4, 'one cell per row is kept for the cursor');
	const h = mountHarness(<LabeledInput label="Reason: " text={LONG_TEXT} columns={30} maxRows={5} />, {columns: 40, rows: 10});
	await h.settle();
	const frame = plain(h.lastFrame());
	assert.match(frame, /^Reason: alpha/m);
	assert.deepEqual(wordsOf(frame).slice(1), LONG_TEXT.split(' '));
	assert.doesNotMatch(frame, /…/);
	h.unmount();
});

test('LabeledInput: with fewer rows than it needs, the end being typed stays in view', async () => {
	const h = mountHarness(<LabeledInput label="Reason: " text={LONG_TEXT} columns={30} maxRows={1} />, {columns: 40, rows: 10});
	await h.settle();
	assert.match(plain(h.lastFrame()), /^Reason: .*mu/m);
	h.unmount();
});

test('ListPicker: the selected item is shown in full; the others stay one row', async () => {
	const list = [
		{id: 'a', label: `first ${LONG_TEXT}`},
		{id: 'b', label: `second ${LONG_TEXT}`},
	];
	const h = mountHarness(<ListPicker title="Pick" empty="none" action="x" items={list} onPick={() => {}} close={() => {}} />, {
		columns: 30,
		rows: 20,
	});
	await h.settle();
	const frame = plain(h.lastFrame());
	for (const w of LONG_TEXT.split(' ')) assert.ok(wordsOf(frame).includes(w), `"${w}" of the selected item is shown`);
	assert.match(frame, /second alpha.*…/, 'an unselected item keeps one row');
	assert.ok(frame.split('\n').every(r => stringCells(r) <= 29));
	h.unmount();
});
