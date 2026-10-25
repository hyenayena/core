import React from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SecretInput, TextField} from '../../src/kit/ui.js';
import {mountHarness} from '../testkit.js';

const ESC = String.fromCharCode(27);
const BACKSPACE = String.fromCharCode(127);

test('TextField: typing, Backspace and a paste edit the value; Enter submits it trimmed', async () => {
	const got: string[] = [];
	const h = mountHarness(<TextField label="Name" hint="a-z only" onSubmit={v => got.push(v)} onCancel={() => assert.fail('cancelled')} />);
	await h.settle();
	h.press('yenx');
	h.press(BACKSPACE);
	h.press('a-bot\n ');
	await h.settle();
	assert.match(h.lastFrame(), /Name/);
	assert.match(h.lastFrame(), /a-z only/);
	assert.match(h.lastFrame(), /› yena-bot/);
	h.press('\r');
	await h.settle();
	assert.deepEqual(got, ['yena-bot']);
	h.unmount();
});

test('TextField: a required field refuses empty, validate shows its message and blocks', async () => {
	const got: string[] = [];
	const h = mountHarness(
		<TextField label="Name" validate={v => (/^[a-z]+$/.test(v) ? undefined : 'Only a-z')} onSubmit={v => got.push(v)} onCancel={() => {}} />,
	);
	await h.settle();
	h.press('\r');
	await h.settle();
	assert.match(h.lastFrame(), /A value is needed/);
	h.press('A1');
	await h.settle();
	h.press('\r');
	await h.settle();
	assert.match(h.lastFrame(), /Only a-z/);
	assert.deepEqual(got, []);
	h.press(BACKSPACE);
	h.press(BACKSPACE);
	h.press('ok');
	await h.settle();
	assert.doesNotMatch(h.lastFrame(), /Only a-z/, 'typing clears the error');
	h.press('\r');
	await h.settle();
	assert.deepEqual(got, ['ok']);
	h.unmount();
});

test('TextField: an optional field submits empty; Esc cancels', async () => {
	const got: string[] = [];
	let cancelled = 0;
	const h = mountHarness(<TextField label="Email" optional onSubmit={v => got.push(v)} onCancel={() => cancelled++} />);
	await h.settle();
	assert.match(h.lastFrame(), /empty skips/);
	h.press('\r');
	await h.settle();
	assert.deepEqual(got, ['']);
	h.unmount();
	const c = mountHarness(<TextField label="x" onSubmit={() => assert.fail('submitted')} onCancel={() => cancelled++} />);
	await c.settle();
	c.press(ESC);
	await c.settle(80);
	assert.equal(cancelled, 1);
	c.unmount();
});

test('SecretInput: optional submits an empty value to skip', async () => {
	const got: string[] = [];
	const h = mountHarness(<SecretInput label="token" optional onSubmit={v => got.push(v)} onCancel={() => assert.fail('cancelled')} />);
	await h.settle();
	assert.match(h.lastFrame(), /empty skips/);
	h.press('\r');
	await h.settle();
	assert.deepEqual(got, ['']);
	h.unmount();
});
