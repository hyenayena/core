import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GLYPHS, SPINNER_GLYPHS, asciiGlyphs, glyph, spinnerFrames, type GlyphName} from '../../src/kit/glyphs.js';
import {cellWidth, stringCells} from '../../src/hints/width.js';

const names = Object.keys(GLYPHS) as GlyphName[];

test('every glyph is one cell wide, without a variation selector', () => {
	for (const n of names) {
		const {char} = GLYPHS[n];
		assert.equal(stringCells(char), 1, n);
		assert.ok(!char.includes('️'), n);
		assert.equal(cellWidth(char), 1, n);
	}
	for (const s of Object.values(SPINNER_GLYPHS)) for (const f of s.frames) assert.equal(stringCells(f), 1, f);
});

test('ASCII fallbacks are printable and as wide as the glyph', () => {
	for (const n of names) {
		const a = GLYPHS[n].ascii;
		assert.ok(a !== undefined && /^[\x20-\x7e]+$/.test(a), n);
		assert.equal(stringCells(a), stringCells(GLYPHS[n].char), n);
	}
	for (const s of Object.values(SPINNER_GLYPHS)) for (const f of s.ascii) assert.match(f, /^[\x20-\x7e]$/);
	assert.equal(glyph('check'), '✓');
	assert.equal(glyph('check', {ascii: true}), 'v');
	assert.equal(spinnerFrames('braille', {ascii: true}).length, 4);
});

test('wrap glyph', () => {
	assert.equal(glyph('wrap'), '↪');
	assert.equal(glyph('wrap', {ascii: true}), '>');
});

test('asciiGlyphs from the environment', () => {
	assert.equal(asciiGlyphs({TERM: 'linux'}), true);
	assert.equal(asciiGlyphs({TERM: 'dumb'}), true);
	assert.equal(asciiGlyphs({TERM: 'xterm-256color'}), false);
	assert.equal(asciiGlyphs({}), false);
	assert.equal(asciiGlyphs({LANG: 'en_US.UTF-8'}), false);
	assert.equal(asciiGlyphs({LANG: 'C'}), true);
	assert.equal(asciiGlyphs({LC_ALL: 'POSIX', LANG: 'en_US.UTF-8'}), true);
	assert.equal(asciiGlyphs({LC_ALL: 'en_US.utf8'}), false);
});

test('meter and branch glyphs', () => {
	assert.equal(glyph('meterOn'), '▰');
	assert.equal(glyph('meterOff', {ascii: true}), '-');
	assert.equal(glyph('branch'), '⎇');
	assert.equal(glyph('branch', {ascii: true}), '@');
});
