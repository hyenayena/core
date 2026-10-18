import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sanitizeText, sanitizeToken} from '../../src/hints/sanitize.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(7);
const CSI8 = String.fromCharCode(0x9b);
const OSC8 = String.fromCharCode(0x9d);
const U = (n: number) => String.fromCharCode(n);

function assertClean(s: string): void {
	for (const ch of s) {
		const c = ch.codePointAt(0) as number;
		assert.ok(c >= 0x20 && !(c >= 0x7f && c <= 0x9f), `control ${c.toString(16)}`);
		assert.ok(!(c >= 0x202a && c <= 0x202e) && !(c >= 0x2066 && c <= 0x2069), 'bidi');
		assert.ok(c !== 0x200b && c !== 0xfeff && c !== 0x200e && c !== 0x200f);
	}
}

test('non-strings give empty', () => {
	for (const v of [undefined, null, 1, {}, [], Symbol('x')]) assert.equal(sanitizeText(v, 10), '');
});

test('OSC 52 and OSC 8 are removed with BEL and ST terminators', () => {
	assert.equal(sanitizeText(`a${ESC}]52;c;SGVsbG8=${BEL}b`, 50), 'ab');
	assert.equal(sanitizeText(`a${ESC}]8;;http://x${ESC}\\link${ESC}]8;;${ESC}\\b`, 50), 'alinkb');
	assert.equal(sanitizeText(`a${ESC}]8;;http://x${BEL}link${ESC}]8;;${BEL}`, 50), 'alink');
});

test('unterminated OSC consumes the remainder', () => {
	assert.equal(sanitizeText(`keep${ESC}]52;c;AAAA rest`, 50), 'keep');
});

test('CSI, SGR, DCS, 8-bit sequences and two-character escapes', () => {
	assert.equal(sanitizeText(`${ESC}[31;1mred${ESC}[0m ${ESC}[2Jx`, 50), 'red x');
	assert.equal(sanitizeText(`a${ESC}Pq data${ESC}\\b`, 50), 'ab');
	assert.equal(sanitizeText(`a${CSI8}31mb`, 50), 'ab');
	assert.equal(sanitizeText(`a${OSC8}0;title${BEL}b`, 50), 'ab');
	assert.equal(sanitizeText(`a${ESC}cb${ESC}`, 50), 'ab');
	assert.equal(sanitizeText(`a${ESC}(Bb`, 50), 'ab');
});

test('bidi, zero-width and tag characters are removed', () => {
	const s = `a${U(0x202e)}b${U(0x2066)}c${U(0x200b)}d${U(0xfeff)}e${U(0xad)}f\u{e0041}g${U(0x200d)}h`;
	assert.equal(sanitizeText(s, 50), 'abcdefgh');
});

test('whitespace controls become single spaces', () => {
	assert.equal(sanitizeText(`a\tb\n\nc\r\nd${U(0x2028)}e${U(0x2029)}f  g`, 50), 'a b c d e f g');
	assert.equal(sanitizeText('  \n x \t ', 50), 'x');
	assert.equal(sanitizeText(`a${U(1)}${U(0x7f)}${U(0x85)}b`, 50), 'ab');
});

test('lone surrogates become U+FFFD', () => {
	assert.equal(sanitizeText(`a${U(0xd800)}b${U(0xdc00)}c`, 50), 'a�b�c');
	assert.equal(sanitizeText('x😀y', 50), 'x😀y');
});

test('truncates by code points on a grapheme boundary', () => {
	assert.equal(sanitizeText('abcdef', 4), 'abc…');
	assert.equal(sanitizeText('abcd', 4), 'abcd');
	assert.equal(sanitizeText('ééé', 3), 'é…');
	assert.equal(sanitizeText('abc', 0), '');
});

test('10 KB hostile input is bounded and clean', () => {
	const hostile = (`${ESC}]52;c;x${BEL}${U(0x202e)}a\n`).repeat(1000) + 'z'.repeat(10_000);
	const out = sanitizeText(hostile, 200);
	assert.ok(Array.from(out).length <= 200);
	assertClean(out);
	const unterminated = ESC + ']' + 'x'.repeat(10_000);
	assert.equal(sanitizeText(unterminated, 10), '');
	const csi = (ESC + '[').repeat(5000);
	assert.equal(sanitizeText(csi, 10), '');
});

test('sanitizeToken defaults to 40', () => {
	assert.equal(Array.from(sanitizeToken('a'.repeat(100))).length, 40);
	assert.equal(sanitizeToken(`x${ESC}[31my`), 'xy');
});
