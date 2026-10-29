import test from 'node:test';
import assert from 'node:assert/strict';
import {CLIPBOARD_MAX_CHARS, clipboardSequence, copyToClipboard} from '../src/view/clipboard.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test('OSC 52 carries the text as base64, so nothing in it can escape', () => {
	assert.equal(clipboardSequence('hi ✓'), `${ESC}]52;c;${Buffer.from('hi ✓').toString('base64')}${BEL}`);
	const evil = `${ESC}]0;x${BEL}`;
	assert.equal(clipboardSequence(evil).slice(7, -1).includes(ESC), false);
});

test('copyToClipboard writes once, refuses oversized text and survives a failing stream', () => {
	const out: string[] = [];
	const env = {};
	assert.equal(copyToClipboard({write: s => out.push(s)}, 'abc', env), true);
	assert.equal(out.length, 1);
	assert.equal(copyToClipboard({write: s => out.push(s)}, 'x'.repeat(CLIPBOARD_MAX_CHARS + 1), env), false);
	assert.equal(out.length, 1);
	assert.equal(
		copyToClipboard(
			{
				write: () => {
					throw new Error('closed');
				},
			},
			'a',
			env,
		),
		false,
	);
});
