import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sanitizeBlock, sanitizeMultilineInput, sanitizeText} from '../../src/hints/sanitize.js';

const ATOMS = [
	'\u001b', '\u009b', '\u009d', '\u0090', '\u009c', '\u0007', '\\', '[', ']', 'P', '(', 'B', 'm', 'a', ' ', '\n', '\r', '\t',
	'\u0000', '\u007f', '\u0085', '‍', '​', '‮', ' ', ' ', '﻿', '­', '\u{e0041}', '\ud800',
	'\udc00', '😀', '漢', 'é', '́', '؜', '᠎', '\u{1d173}',
];

const UNSAFE = new RegExp(
	'[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029]|\\p{Cf}|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]',
	'u',
);
const UNSAFE_KEEP_ZWJ = new RegExp(UNSAFE.source.replace('\\p{Cf}', '(?!\\u200d)\\p{Cf}'), 'u');

function sample(next: () => number): string {
	let out = '';
	const n = Math.floor(next() * 24);
	for (let i = 0; i < n; i++) out += ATOMS[Math.floor(next() * ATOMS.length)];
	return out;
}

test('sanitizeText, sanitizeBlock and sanitizeMultilineInput never emit unsafe characters (fuzz)', () => {
	let seed = 4242;
	const next = (): number => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	for (let i = 0; i < 30000; i++) {
		const s = sample(next);
		assert.equal(UNSAFE.test(sanitizeText(s, 200)), false, JSON.stringify(s));
		assert.equal(UNSAFE_KEEP_ZWJ.test(sanitizeBlock(s)), false, JSON.stringify(s));
		assert.equal(UNSAFE_KEEP_ZWJ.test(sanitizeMultilineInput(s)), false, JSON.stringify(s));
		assert.equal(sanitizeBlock(s).includes('\r'), false);
	}
});

test('sanitizeText strips every format character including ZWJ; the block variants keep only ZWJ', () => {
	assert.equal(sanitizeText('a‍b᠎c\u{1d173}d', 50), 'abcd');
	assert.equal(sanitizeBlock('a‍b᠎'), 'a‍b');
});
