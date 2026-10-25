import React from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SecretInput} from '../../src/kit/ui.js';
import {mountHarness} from '../testkit.js';

const ESC = String.fromCharCode(27);
const BACKSPACE = String.fromCharCode(127);

test('SecretInput: what is typed never reaches the screen; Enter hands it over', async () => {
	const got: string[] = [];
	const h = mountHarness(<SecretInput label="Token for demo" onSubmit={v => got.push(v)} onCancel={() => assert.fail('cancelled')} />);
	await h.settle();
	h.press('\r');
	await h.settle();
	assert.deepEqual(got, [], 'an empty value is not submitted');
	for (const ch of 's3cr3tX') h.press(ch);
	h.press(BACKSPACE);
	h.press('-paste\nd');
	await h.settle();
	assert.match(h.lastFrame(), /Token for demo/);
	assert.match(h.lastFrame(), /•+ \(13\)/);
	h.press('\r');
	await h.settle();
	assert.deepEqual(got, ['s3cr3t-pasted']);
	for (const secret of ['s3cr3t', 'paste']) assert.ok(!h.allOutput().includes(secret), `${secret} was rendered`);
	h.press('more');
	h.press('\r');
	await h.settle();
	assert.deepEqual(got, ['s3cr3t-pasted'], 'input after submit is ignored');
	h.unmount();
});

test('SecretInput: Esc cancels and forgets the value', async () => {
	let cancelled = 0;
	const h = mountHarness(<SecretInput label="x" onSubmit={() => assert.fail('submitted')} onCancel={() => cancelled++} />);
	await h.settle();
	h.press('abc');
	await h.settle();
	h.press(ESC);
	await h.settle(80);
	assert.equal(cancelled, 1);
	h.unmount();
});
