import React, {useEffect} from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Text, useInput} from 'ink';
import type {MountControl, Setting, SettingsTab} from '../../../src/api.js';
import Settings from '../src/components/Settings.js';
import {collectSettingsTabs} from '../src/view/settings-tabs.js';
import {mountHarness} from './testkit.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;

function Form({control}: {control: MountControl}) {
	useInput(input => {
		if (input === 'd') control.close();
	});
	return <Text>FORM OPEN</Text>;
}

function Broken(): React.ReactElement {
	useEffect(() => {}, []);
	throw new Error('form exploded');
}

test('an action row opens its view in place; closing it returns to the list read again', async () => {
	let names = ['first'];
	const tabs = (): SettingsTab[] => [
		{
			title: 'Accounts',
			actions: [{key: 'add', label: 'Add account…', description: 'step by step', open: control => <Form control={control} />}],
			settings: names.map(n => ({key: n, label: n, options: [{value: 'on', label: 'On'}], get: () => 'on', set: () => {}})),
		},
	];
	let closed = 0;
	const h = mountHarness(<Settings tabs={tabs()} control={{close: () => closed++}} reload={tabs} />);
	await h.settle();
	assert.match(h.lastFrame(), /› ▸ Add account… — step by step/);
	h.press('\r');
	await h.settle();
	assert.match(h.lastFrame(), /FORM OPEN/);
	h.press(ESC);
	await h.settle(80);
	assert.equal(closed, 0, 'keys belong to the open view, Esc does not close the settings');
	names = ['first', 'second'];
	h.press('d');
	await h.settle();
	assert.doesNotMatch(h.lastFrame(), /FORM OPEN/);
	assert.match(h.lastFrame(), /second/);
	h.unmount();
});

test('a view that throws closes with a message instead of breaking the settings', async () => {
	const tabs: SettingsTab[] = [{title: 'T', settings: [], actions: [{key: 'x', label: 'Broken…', open: () => <Broken />}]}];
	const h = mountHarness(<Settings tabs={tabs} control={{close() {}}} />);
	await h.settle();
	h.press('\r');
	await h.settle(80);
	assert.match(h.lastFrame(), /Cannot open: form exploded/);
	assert.match(h.lastFrame(), /Broken…/);
	h.unmount();
});

test('choice rows still save after the actions', async () => {
	const saved: string[] = [];
	const tabs: SettingsTab[] = [
		{
			title: 'T',
			actions: [{key: 'a', label: 'Act…', open: () => <Text>x</Text>}],
			settings: [{key: 's', label: 'Mode', options: [{value: 'a', label: 'A'}, {value: 'b', label: 'B'}], get: () => 'a', set: v => void saved.push(v)}],
		},
	];
	const h = mountHarness(<Settings tabs={tabs} control={{close() {}}} />);
	await h.settle();
	h.press(DOWN);
	await h.settle();
	h.press(DOWN);
	await h.settle();
	h.press('\r');
	await h.settle();
	assert.deepEqual(saved, ['b']);
	h.unmount();
});

test('collectSettingsTabs keeps valid actions, drops broken ones, and keeps a tab that has only actions', () => {
	const open = () => ({});
	const tabs = collectSettingsTabs([
		{name: 'a', description: '', run() {}, settings: {title: 'Only actions', settings: [], actions: [{key: 'k', label: 'Go', open}, {key: '', label: 'x', open}, {key: 'n', label: 'No open'} as never]}},
		{name: 'b', description: '', run() {}, settings: {title: 'Empty', settings: [], actions: []}},
	]);
	assert.deepEqual(tabs.map(t => [t.title, t.actions?.map(a => a.key)]), [['Only actions', ['k']]]);
});

test('collectSettingsTabs strips a malformed inline but keeps the setting, and holds up to 40 settings', () => {
	const base = {options: [{value: 'a', label: 'A'}], get: () => 'a', set() {}};
	const settings = [
		{...base, key: 'ok', label: 'Ok', inline: {row: 'r', label: 'Row', section: 'S', extra: 1}},
		{...base, key: 'trim', label: 'Trim', inline: {row: 'r', label: '', section: 7}},
		{...base, key: 'norow', label: 'No row', inline: {label: 'x'}},
		{...base, key: 'str', label: 'Str', inline: 'r'},
		...Array.from({length: 50}, (_v, i) => ({...base, key: `k${i}`, label: `K${i}`})),
	] as unknown as Setting[];
	const [tab] = collectSettingsTabs([{name: 'a', description: '', run() {}, settings: {title: 'T', settings}}]);
	assert.equal(tab?.settings.length, 40);
	assert.deepEqual(
		tab?.settings.slice(0, 4).map(s => [s.key, s.inline]),
		[
			['ok', {row: 'r', label: 'Row', section: 'S'}],
			['trim', {row: 'r'}],
			['norow', undefined],
			['str', undefined],
		],
	);
	assert.equal('inline' in tab!.settings[2]!, false);
});
