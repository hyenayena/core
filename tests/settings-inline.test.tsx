import React from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {MountControl, Setting, SettingsTab, ViewHost} from '../../../src/api.js';
import Settings, {SETTINGS_HINT, SETTINGS_INLINE_HINT} from '../src/components/Settings.js';
import {mountHarness} from './testkit.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const LEFT = `${ESC}[D`;
const RIGHT = `${ESC}[C`;
const TAB = '\t';

const MODELS = [
	{value: 'haiku', label: 'haiku'},
	{value: 'sonnet', label: 'sonnet'},
	{value: 'opus', label: 'opus'},
];
const EFFORTS = [
	{value: 'low', label: 'low'},
	{value: 'medium', label: 'medium'},
	{value: 'high', label: 'high'},
];

type Store = Record<string, string>;

function tier(store: Store, sets: string[], row: string, field: 'model' | 'effort', fail = false): Setting {
	const key = `${row}.${field}`;
	return {
		key,
		label: `${row} tier: ${field}`,
		description: `The ${field} of the ${row} tier.`,
		options: field === 'model' ? MODELS : EFFORTS,
		inline: {row, section: 'Model tiers'},
		get: () => store[key],
		set: value => {
			if (fail) throw new Error('disk full');
			sets.push(`${key}=${value}`);
			store[key] = value;
		},
	};
}

function tabs(store: Store, sets: string[], fail = false): SettingsTab[] {
	return [
		{
			title: 'Chat',
			settings: [
				{key: 'mode', label: 'Permission mode', options: [{value: 'ask', label: 'Ask'}, {value: 'auto', label: 'Auto'}], get: () => 'ask', set: () => {}},
				...['light', 'strong'].flatMap(row => [tier(store, sets, row, 'model', fail), tier(store, sets, row, 'effort', fail)]),
			],
		},
		{title: 'Other', settings: [{key: 'x', label: 'Other choice', options: [{value: 'a', label: 'A'}], get: () => 'a', set: () => {}}]},
	];
}

const initial = (): Store => ({'light.model': 'haiku', 'light.effort': 'medium', 'strong.model': 'opus', 'strong.effort': 'high'});

async function down(h: ReturnType<typeof mountHarness>, n: number) {
	for (let i = 0; i < n; i++) {
		h.press(DOWN);
		await h.settle();
	}
}

const hostWith = (isHostKey: (input: string) => boolean): ViewHost =>
	({isFocused: () => true, columns: () => 80, rows: () => 39, subscribe: () => () => {}, isHostKey, move: () => true});

test('inline settings draw one heading and compact rows instead of option lists', async () => {
	const h = mountHarness(<Settings tabs={tabs(initial(), [])} control={{close() {}}} />);
	await h.settle();
	const frame = h.lastFrame();
	assert.equal(frame.match(/Model tiers/g)?.length, 1);
	assert.match(frame, / {2}light {3}→ \[haiku\] {2}\[medium\]/);
	assert.match(frame, / {2}strong {2}→ \[opus\] {3}\[high\]/);
	assert.doesNotMatch(frame, /light tier: model|The model of|○ sonnet|● haiku/);
	assert.match(frame, /○ Auto/);
	assert.ok(frame.includes(SETTINGS_HINT));
	h.unmount();
});

test('↓ moves field by field across rows and the hint switches to the inline one', async () => {
	const h = mountHarness(<Settings tabs={tabs(initial(), [])} control={{close() {}}} />);
	await h.settle();
	await down(h, 2);
	assert.match(h.lastFrame(), /› light {3}→ \[haiku\]/);
	assert.ok(h.lastFrame().includes(SETTINGS_INLINE_HINT));
	await down(h, 2);
	assert.match(h.lastFrame(), /› strong {2}→ \[opus\]/);
	assert.match(h.lastFrame(), / {2}light {3}→/);
	h.unmount();
});

test('Enter and Space cycle the focused field with wrap and save at once', async () => {
	const store = initial();
	const sets: string[] = [];
	const h = mountHarness(<Settings tabs={tabs(store, sets)} control={{close() {}}} />);
	await h.settle();
	await down(h, 3);
	h.press('\r');
	await h.settle();
	assert.match(h.lastFrame(), /light {3}→ \[haiku\] {2}\[high\]/);
	assert.match(h.lastFrame(), /Saved · light tier: effort: high/);
	h.press(' ');
	await h.settle();
	assert.match(h.lastFrame(), /\[low\]/);
	assert.deepEqual(sets, ['light.effort=high', 'light.effort=low']);
	h.unmount();
});

test('a rejected save shows the error and keeps the old value', async () => {
	const h = mountHarness(<Settings tabs={tabs(initial(), [], true)} control={{close() {}}} />);
	await h.settle();
	await down(h, 2);
	h.press(' ');
	await h.settle();
	assert.match(h.lastFrame(), /Cannot save: disk full/);
	assert.match(h.lastFrame(), /› light {3}→ \[haiku\]/);
	h.unmount();
});

test('host keys and ←/→ neither save nor close; Esc closes', async () => {
	const sets: string[] = [];
	let closed = 0;
	const control: MountControl = {close: () => closed++, host: hostWith(input => input === TAB)};
	const h = mountHarness(<Settings tabs={tabs(initial(), sets)} control={control} />);
	await h.settle();
	await down(h, 2);
	h.press(TAB);
	await h.settle();
	h.press(RIGHT);
	await h.settle();
	assert.match(h.lastFrame(), /Other choice/);
	assert.match(h.lastFrame(), /› ● A/);
	assert.ok(h.lastFrame().includes(SETTINGS_HINT), 'a tab without inline settings keeps the normal hint');
	h.press(LEFT);
	await h.settle();
	assert.deepEqual(sets, []);
	assert.equal(closed, 0);
	h.press(ESC);
	await h.settle(80);
	assert.equal(closed, 1);
	h.unmount();
});

test('a value that is not loaded shows [?] and cycles to the first option', async () => {
	const store: Store = {};
	const sets: string[] = [];
	const h = mountHarness(<Settings tabs={tabs(store, sets)} control={{close() {}}} />);
	await h.settle();
	assert.match(h.lastFrame(), /light {3}→ \[\?\] {6}\[\?\]/);
	await down(h, 2);
	h.press('\r');
	await h.settle();
	assert.deepEqual(sets, ['light.model=haiku']);
	h.unmount();
});
