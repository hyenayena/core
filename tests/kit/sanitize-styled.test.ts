import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sanitizeStyled} from '../../src/kit/text.js';

const ESC = String.fromCharCode(27);

test('sanitizeStyled keeps SGR sequences', () => {
	const row = `${ESC}[38;2;1;2;3mred${ESC}[0m plain`;
	assert.equal(sanitizeStyled(row), row);
});

test('sanitizeStyled strips OSC, other CSI sequences, newlines and bidi controls', () => {
	const out = sanitizeStyled(`a${ESC}]0;title\u0007b${ESC}[2Jc${ESC}[31md\ne‮f`);
	assert.equal(out, `abc${ESC}[31md ef`);
});

test('sanitizeStyled of a non-string is empty', () => {
	assert.equal(sanitizeStyled(undefined as unknown as string), 'undefined');
});
