import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sanitizeBlock as s, sanitizeMultilineInput, sanitizeText} from '../../src/kit/text.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test('OSC 8 hyperlinks (BEL and ST) lose payload but keep label', () => {
	assert.equal(s(`${ESC}]8;;http://evil${BEL}click${ESC}]8;;${BEL}`), 'click');
	assert.equal(s(`${ESC}]8;;http://evil${ESC}\\click${ESC}]8;;${ESC}\\`), 'click');
});

test('OSC 52 and OSC 0 are removed with payload; unterminated OSC to the end', () => {
	assert.equal(s(`a${ESC}]52;c;ZXZpbA==${BEL}b`), 'ab');
	assert.equal(s(`a${ESC}]0;title${ESC}\\b`), 'ab');
	assert.equal(s(`a${ESC}]52;c;AAAA tail`), 'a');
});

test('C1 CSI and OSC introducers are removed with payload', () => {
	assert.equal(s('a\u009b31mb'), 'ab');
	assert.equal(s(`a\u009d0;title${BEL}b`), 'ab');
	assert.equal(s('a\u0085b\u0080c'), 'abc');
});

test('DCS, APC, PM, SOS are removed', () => {
	for (const k of ['P', '_', '^', 'X']) assert.equal(s(`a${ESC}${k}data${ESC}\\b`), 'ab');
});

test('SGR and other CSI are removed', () => {
	assert.equal(s(`${ESC}[31;1mred${ESC}[0m ${ESC}[2J${ESC}[?25l`), 'red ');
});

test('lone ESC and two-character sequences are removed', () => {
	assert.equal(s(`a${ESC}b`), 'a');
	assert.equal(s(`a${ESC}\nb`), 'a\nb');
	assert.equal(s(`a${ESC}cb`), 'ab');
});

test('bidi, zero-width and tag characters are removed; ZWJ kept', () => {
	assert.equal(s('a‮b⁦c‎؜d'), 'abcd');
	assert.equal(s('a​b⁠c﻿d­e'), 'abcde');
	assert.equal(s('a\u{e0041}\u{e007f}b'), 'ab');
	assert.equal(s('\u{1f468}‍\u{1f469}'), '\u{1f468}‍\u{1f469}');
});

test('lone surrogates become U+FFFD, pairs survive', () => {
	assert.equal(s('a\ud800b'), 'a�b');
	assert.equal(s('a\udc00b'), 'a�b');
	assert.equal(s('\u{1f600}'), '\u{1f600}');
});

test('CR, BS, BEL, DEL, NUL are removed; CRLF and U+2028/2029 become LF', () => {
	assert.equal(s('a\r\nb\rc'), 'a\nbc');
	assert.equal(s(`a\bb${BEL}c\u007fd\u0000e`), 'abcde');
	assert.equal(s('a b c'), 'a\nb\nc');
});

test('newline kept and tab expanded to 4 spaces', () => {
	assert.equal(s('a\tb\nc'), 'a    b\nc');
});

test('sanitizing the concatenation handles escapes split across chunks', () => {
	const chunks = [`a${ESC}]52;c;`, `ZXZpbA==${BEL}b`];
	assert.notEqual(chunks.map(s).join(''), 'ab');
	assert.equal(s(chunks.join('')), 'ab');
});

test('non-strings give an empty string', () => {
	assert.equal(s(undefined), '');
	assert.equal(s(42), '');
	assert.equal(sanitizeMultilineInput(null), '');
});

test('sanitizeMultilineInput keeps newline and tab, folds CR', () => {
	assert.equal(sanitizeMultilineInput(`a\tb\r\nc\rd${ESC}[31me‮f`), 'a\tb\nc\nde' + 'f');
});

// Format characters the old core list missed (the probe set).
const PROBE = [0x180e, 0x206a, 0x206f, 0x0600, 0x070f, 0x08e2, 0x110bd, 0x1d173, 0x1d17a, 0xe0001, 0xe0020];

test('every probe code point is stripped by all three sanitizers', () => {
	for (const cp of PROBE) {
		const ch = String.fromCodePoint(cp);
		assert.equal(s(`a${ch}b`), 'ab', cp.toString(16));
		assert.equal(sanitizeMultilineInput(`a${ch}b`), 'ab', cp.toString(16));
		assert.equal(sanitizeText(`a${ch}b`, 20), 'ab', cp.toString(16));
	}
});

test('every Cf code point is stripped except ZWJ in block and input', () => {
	for (let cp = 0; cp <= 0x10ffff; cp++) {
		if (cp >= 0xd800 && cp <= 0xdfff) continue;
		const ch = String.fromCodePoint(cp);
		if (!/^\p{Cf}$/u.test(ch)) continue;
		const keep = cp === 0x200d;
		assert.equal(s(`a${ch}b`), keep ? `a${ch}b` : 'ab', cp.toString(16));
		assert.equal(sanitizeText(`a${ch}b`, 20), 'ab', cp.toString(16));
	}
});

test('sanitizeText still collapses spaces, strips ZWJ and truncates', () => {
	assert.equal(sanitizeText('  a\t\n b‍c  ', 20), 'a bc');
	assert.equal(sanitizeText('abcdefghij', 5), 'abcd…');
});

function unsafe(out: string, allowTab: boolean): string | undefined {
	for (let i = 0; i < out.length; i++) {
		const c = out.charCodeAt(i);
		if (c === 0x0a || (allowTab && c === 0x09)) continue;
		if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return `control ${c.toString(16)}`;
		if (c >= 0xd800 && c <= 0xdbff) {
			const d = out.charCodeAt(i + 1);
			if (!(d >= 0xdc00 && d <= 0xdfff)) return 'lone high surrogate';
			const cp = out.codePointAt(i) as number;
			if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag';
			if (/^\p{Cf}$/u.test(String.fromCodePoint(cp))) return 'astral Cf';
			i++;
			continue;
		}
		if (c >= 0xdc00 && c <= 0xdfff) return 'lone low surrogate';
		if (c !== 0x200d && /^\p{Cf}$/u.test(out[i] as string)) return `Cf ${c.toString(16)}`;
	}
	return undefined;
}

test('fuzz: output never contains unsafe characters', () => {
	const pool = [
		'a', ' ', '\n', '\r', '\t', ESC, '[', ']', 'P', '\\', BEL, '\u009b', '\u009d', '\u0085', '‍', '‮', ' ',
		'\ud800', '\udc00', '\u{1f600}', '\u{e0041}', '\u{1d173}', '᠎', '؀', '31m', ';', '0', '\u0000', '\u007f',
	];
	let seed = 12345;
	const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	for (let n = 0; n < 3000; n++) {
		let str = '';
		const len = Math.floor(rnd() * 30);
		for (let i = 0; i < len; i++) str += pool[Math.floor(rnd() * pool.length)];
		assert.equal(unsafe(s(str), false), undefined, JSON.stringify(str));
		assert.equal(unsafe(sanitizeMultilineInput(str), true), undefined, JSON.stringify(str));
		const t = sanitizeText(str, 40);
		assert.equal(unsafe(t.replace(/‍/g, ''), false), undefined, JSON.stringify(str));
		assert.ok(!t.includes('\n') && !t.includes('\t'));
	}
});
