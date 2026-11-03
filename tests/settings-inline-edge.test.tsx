import React from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {MountControl, Setting, SettingsTab, ViewHost} from '../../../src/api.js';
import Settings, {SETTINGS_HINT, SETTINGS_INLINE_HINT} from '../src/components/Settings.js';
import {stringCells} from '../src/hints/width.js';
import {mountHarness} from './testkit.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;
const LEFT = `${ESC}[D`;
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');

const OPTS = [
	{value: 'a', label: 'a'},
	{value: 'b', label: 'b'},
];

function inline(key: string, row: string, sets: string[], section: string | undefined = 'S', store: Record<string, string> = {}): Setting {
	return {
		key,
		label: key,
		options: OPTS,
		inline: {row, ...(section !== undefined && {section})},
		get: () => store[key] ?? 'a',
		set: value => {
			sets.push(`${key}=${value}`);
			store[key] = value;
		},
	};
}

function radio(key: string, sets: string[]): Setting {
	return {key, label: `Radio ${key}`, options: [{value: '1', label: 'One'}, {value: '2', label: 'Two'}], get: () => '1', set: value => void sets.push(`${key}=${value}`)};
}

function mixed(sets: string[], opened: string[]): SettingsTab[] {
	return [
		{
			title: 'Mixed',
			actions: [{key: 'act', label: 'Do it', open: control => (opened.push('act'), control.close(), {})}],
			settings: [
				radio('r1', sets),
				inline('x.m', 'x', sets),
				inline('x.e', 'x', sets),
				inline('y.m', 'y', sets),
				radio('r2', sets),
				inline('z.m', 'z', sets),
				inline('x2.m', 'x', sets),
			],
		},
	];
}

type Calls = {moves: string[]};
const host = (columns: number, rows: number, calls: Calls = {moves: []}): ViewHost => ({
	isFocused: () => true,
	columns: () => columns,
	rows: () => rows,
	subscribe: () => () => {},
	isHostKey: input => input === '\t',
	move: direction => (calls.moves.push(direction), true),
});

const plainLines = (frame: string) => frame.replace(ANSI, '').split('\n');

test('↓ visits actions, radio options and inline fields in one order; Space acts only on inline fields', async () => {
	const sets: string[] = [];
	const opened: string[] = [];
	const h = mountHarness(<Settings tabs={mixed(sets, opened)} control={{close() {}}} />);
	await h.settle();
	const frame = h.lastFrame();
	assert.equal(frame.match(/^\s*S\s*$/gm)?.length, 2, 'the section heading is drawn once per inline block');
	assert.equal(plainLines(frame).filter(l => /^[ ›] x {2}→/.test(l)).length, 2, 'a row key repeated later starts a new row');
	const seen: Array<[number, string]> = [];
	for (let stop = 0; stop < 12; stop++) {
		const before = sets.length;
		h.press(' ');
		await h.settle();
		seen.push([stop, sets.slice(before).join(',')]);
		h.press(DOWN);
		await h.settle();
	}
	assert.deepEqual(
		seen.filter(([, s]) => s !== '').map(([stop, s]) => `${stop}:${s}`),
		['3:x.m=b', '4:x.e=b', '5:y.m=b', '8:z.m=b', '9:x2.m=b', '10:x2.m=a', '11:x2.m=b'],
	);
	assert.deepEqual(opened, []);
	assert.ok(h.lastFrame().includes(SETTINGS_INLINE_HINT));
	for (let i = 0; i < 2; i++) {
		h.press(UP);
		await h.settle();
	}
	assert.ok(h.lastFrame().includes(SETTINGS_HINT), 'back on a radio option the normal hint returns');
	assert.match(h.lastFrame(), /› ○ Two/);
	h.unmount();
});

test('Enter while a save is pending is ignored; the next cycle starts from the saved value', async () => {
	const sets: string[] = [];
	let release: () => void = () => {};
	const store: Record<string, string> = {};
	const slow: Setting = {
		...inline('s', 's', sets, undefined, store),
		set: value =>
			new Promise<void>(resolve => {
				sets.push(`s=${value}`);
				release = () => {
					store.s = value;
					resolve();
				};
			}),
	};
	const h = mountHarness(<Settings tabs={[{title: 'T', settings: [slow]}]} control={{close() {}}} />);
	await h.settle();
	h.press('\r');
	await h.settle();
	h.press(' ');
	await h.settle();
	assert.deepEqual(sets, ['s=b']);
	release();
	await h.settle();
	assert.match(h.lastFrame(), /› s {2}→ \[b\]/);
	h.press('\r');
	await h.settle();
	assert.deepEqual(sets, ['s=b', 's=a']);
	h.unmount();
});

test('← on the first tab hands focus to the host, Ctrl+C closes, Tab never saves', async () => {
	const sets: string[] = [];
	const calls: Calls = {moves: []};
	let closed = 0;
	const control: MountControl = {close: () => closed++, host: host(80, 39, calls)};
	const h = mountHarness(<Settings tabs={[{title: 'T', settings: [inline('k', 'k', sets)]}]} control={control} />);
	await h.settle();
	h.press('\t');
	await h.settle();
	h.press(LEFT);
	await h.settle();
	assert.deepEqual(calls.moves, ['left']);
	assert.deepEqual(sets, []);
	h.press(String.fromCharCode(3));
	await h.settle();
	assert.equal(closed, 1);
	h.unmount();
});

test('an inline row without a section has no heading and uses its own label', async () => {
	const s: Setting = {...inline('k', 'row-id', [], undefined), inline: {row: 'row-id', label: 'Pretty'}};
	const h = mountHarness(<Settings tabs={[{title: 'T', settings: [s]}]} control={{close() {}}} />);
	await h.settle();
	const lines = plainLines(h.lastFrame());
	assert.ok(lines.some(l => /^› Pretty {2}→ \[a\]$/.test(l.trimEnd())), lines.join('\n'));
	assert.ok(!lines.some(l => l.includes('row-id')));
	h.unmount();
});

test('escape-laden labels, sections and option labels reach the screen sanitised', async () => {
	const evil = `${ESC}]0;pwn${BEL}${ESC}[31m`;
	const s: Setting = {
		key: 'k',
		label: 'k',
		options: [{value: 'a', label: `A${evil}`}],
		inline: {row: 'r', label: `L${evil}`, section: `Sec${evil}`},
		get: () => 'a',
		set() {},
	};
	const h = mountHarness(<Settings tabs={[{title: 'T', settings: [s]}]} control={{close() {}}} />);
	await h.settle();
	const frame = h.lastFrame();
	assert.ok(!frame.includes(BEL));
	assert.ok(!frame.includes(`${ESC}]`));
	assert.ok(!frame.includes(`${ESC}[31m`));
	assert.match(frame.replace(ANSI, ''), /Sec/);
	h.unmount();
});

test('rows of a mixed tab never reach the last column, with wide and emoji labels', async () => {
	const wide = (key: string, row: string, label: string, options: string[], section?: string): Setting => ({
		key,
		label: key,
		options: options.map((o, i) => ({value: String(i), label: o})),
		inline: {row, label, ...(section !== undefined && {section})},
		get: () => '0',
		set() {},
	});
	const tabs: SettingsTab[] = [
		{
			title: '設定',
			settings: [
				radio('r', []),
				wide('a', 'a', '軽量ティア', ['俳句モデル', 'b'], 'モデル 🦊'),
				wide('b', 'a', '軽量ティア', ['👍🏽👍🏽', 'x'.repeat(30)], 'モデル 🦊'),
				wide('c', 'c', 'x'.repeat(40), ['é', '中'], 'モデル 🦊'),
			],
		},
	];
	for (const columns of [...Array.from({length: 45}, (_v, i) => i + 1), 60, 80, 120, 200]) {
		const h = mountHarness(<Settings tabs={tabs} control={{close() {}, host: host(columns, 39)}} />, {columns: 220, rows: 40});
		await h.settle(15);
		h.press(DOWN.repeat(3));
		await h.settle(15);
		for (const line of plainLines(h.lastFrame()).filter(l => !l.startsWith('Settings '))) {
			assert.ok(stringCells(line.trimEnd()) <= Math.max(1, columns - 1), `columns ${columns}: ${JSON.stringify(line)}`);
		}
		h.unmount();
	}
});

test('a short panel scrolls so the focused inline row stays visible', async () => {
	const sets: string[] = [];
	const settings = Array.from({length: 12}, (_v, i) => inline(`k${i}`, `row${i}`, sets));
	const h = mountHarness(<Settings tabs={[{title: 'T', settings}]} control={{close() {}, host: host(80, 7)}} />);
	await h.settle();
	for (let i = 1; i < 12; i++) {
		h.press(DOWN);
		await h.settle(15);
		assert.match(h.lastFrame(), new RegExp(`› row${i} +→`), `row ${i}`);
	}
	h.press(' ');
	await h.settle();
	assert.deepEqual(sets, ['k11=b']);
	h.unmount();
});
