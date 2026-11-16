import React from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {MountControl} from '../../../../src/api.js';
import {CodeWordView, ConfirmView, NewSecretView, SecretView} from '../../src/transfer/views.js';
import {mountHarness} from '../testkit.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;

function setup<T>() {
	const done: T[] = [];
	let closed = 0;
	const control: MountControl = {close: () => void closed++};
	return {done, control, onDone: (v: T) => void done.push(v), closes: () => closed};
}

const type = async (h: ReturnType<typeof mountHarness>, text: string) => {
	if (text !== '') {
		h.press(text);
		await h.settle();
	}
	h.press('\r');
	await h.settle();
};

test('NewSecretView: a matching pair is handed over', async () => {
	const s = setup<string | undefined>();
	const h = mountHarness(<NewSecretView control={s.control} onDone={s.onDone} />);
	await h.settle();
	assert.match(h.lastFrame(), /Password for the export \(empty: generate a code word\)/);
	await type(h, 'long enough pw');
	assert.match(h.lastFrame(), /Type the password again/);
	await type(h, 'long enough pw');
	assert.deepEqual(s.done, ['long enough pw']);
	assert.equal(s.closes(), 1);
	assert.ok(!h.allOutput().includes('long enough pw'));
	h.unmount();
});

test('NewSecretView: a mismatch shows a message and starts again', async () => {
	const s = setup<string | undefined>();
	const h = mountHarness(<NewSecretView control={s.control} onDone={s.onDone} />);
	await h.settle();
	await type(h, 'long enough pw');
	await type(h, 'another pw here');
	assert.match(h.lastFrame(), /The passwords do not match/);
	assert.match(h.lastFrame(), /Password for the export/);
	assert.deepEqual(s.done, []);
	await type(h, 'long enough pw');
	await type(h, 'long enough pw');
	assert.deepEqual(s.done, ['long enough pw']);
	h.unmount();
});

test('NewSecretView: a short password is refused, empty asks for a code word, Esc cancels', async () => {
	const s = setup<string | undefined>();
	const h = mountHarness(<NewSecretView control={s.control} onDone={s.onDone} />);
	await h.settle();
	await type(h, 'short');
	assert.match(h.lastFrame(), /Use at least 8 characters, or leave it empty for a code word/);
	assert.deepEqual(s.done, []);
	await type(h, '');
	assert.deepEqual(s.done, ['']);
	h.unmount();

	const c = setup<string | undefined>();
	const h2 = mountHarness(<NewSecretView control={c.control} onDone={c.onDone} />);
	await h2.settle();
	h2.press('abc');
	h2.press(ESC);
	await h2.settle();
	assert.deepEqual(c.done, [undefined]);
	h2.unmount();
});

test('SecretView hands over the value or undefined on Esc', async () => {
	const s = setup<string | undefined>();
	const h = mountHarness(<SecretView control={s.control} onDone={s.onDone} label="Code word of the export file" />);
	await h.settle();
	assert.match(h.lastFrame(), /Code word of the export file/);
	await type(h, 'ABCD');
	assert.deepEqual(s.done, ['ABCD']);
	h.unmount();
	const c = setup<string | undefined>();
	const h2 = mountHarness(<SecretView control={c.control} onDone={c.onDone} label="x" />);
	await h2.settle();
	h2.press(ESC);
	await h2.settle();
	assert.deepEqual(c.done, [undefined]);
	h2.unmount();
});

test('CodeWordView: Enter acknowledges, Esc does not', async () => {
	const a = setup<boolean>();
	const h = mountHarness(<CodeWordView control={a.control} onDone={a.onDone} code="7KQ2-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF" />);
	await h.settle();
	assert.match(h.lastFrame(), /7KQ2-AAAA/);
	assert.match(h.lastFrame(), /shown only this once/);
	h.press('\r');
	await h.settle();
	assert.deepEqual(a.done, [true]);
	h.unmount();
	const b = setup<boolean>();
	const h2 = mountHarness(<CodeWordView control={b.control} onDone={b.onDone} code="X" />);
	await h2.settle();
	h2.press(ESC);
	await h2.settle();
	assert.deepEqual(b.done, [false]);
	h2.unmount();
});

test('ConfirmView: apply, cancel and Esc', async () => {
	const a = setup<boolean>();
	const h = mountHarness(<ConfirmView control={a.control} onDone={a.onDone} summary="Apply the import? 2 changes." />);
	await h.settle();
	assert.match(h.lastFrame(), /Apply the import\? 2 changes\./);
	h.press('\r');
	await h.settle();
	assert.deepEqual(a.done, [true]);
	h.unmount();

	const b = setup<boolean>();
	const h2 = mountHarness(<ConfirmView control={b.control} onDone={b.onDone} summary="s" />);
	await h2.settle();
	h2.press(DOWN);
	await h2.settle();
	h2.press('\r');
	await h2.settle();
	assert.deepEqual(b.done, [false]);
	h2.unmount();

	const c = setup<boolean>();
	const h3 = mountHarness(<ConfirmView control={c.control} onDone={c.onDone} summary="s" />);
	await h3.settle();
	h3.press(ESC);
	await h3.settle();
	assert.deepEqual(c.done, []);
	assert.equal(c.closes(), 1);
	h3.unmount();
});
