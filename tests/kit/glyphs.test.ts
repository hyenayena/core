import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GLYPHS, SPINNER, asciiGlyphs, glyph, spinnerFrame, spinnerFrames, type GlyphName} from '../../src/kit/glyphs.js';
import {cellWidth, stringCells} from '../../src/hints/width.js';

const names = Object.keys(GLYPHS) as GlyphName[];

test('every glyph is one cell wide, without a variation selector', () => {
	for (const n of names) {
		const {char} = GLYPHS[n];
		assert.equal(stringCells(char), 1, n);
		assert.ok(!char.includes('️'), n);
		assert.equal(cellWidth(char), 1, n);
	}
	assert.equal(SPINNER.frames.length, 8);
	for (const f of SPINNER.frames) assert.equal(stringCells(f), 1, f);
});

test('ASCII fallbacks are printable and as wide as the glyph', () => {
	for (const n of names) {
		const a = GLYPHS[n].ascii;
		assert.ok(a !== undefined && /^[\x20-\x7e]+$/.test(a), n);
		assert.equal(stringCells(a), stringCells(GLYPHS[n].char), n);
	}
	for (const f of SPINNER.ascii) assert.match(f, /^[\x20-\x7e]$/);
	assert.equal(glyph('check'), '✓');
	assert.equal(glyph('check', {ascii: true}), 'v');
	assert.equal(spinnerFrames({ascii: true}).length, 4);
	assert.equal(SPINNER.intervalMs, 120);
	assert.equal(spinnerFrame(0), '⣾');
	assert.equal(spinnerFrame(2), '⣻');
	assert.equal(spinnerFrame(8), '⣾');
	assert.equal(spinnerFrame(-1), '⣷');
	assert.equal(spinnerFrame(5, {ascii: true}), '/');
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

test('todo glyph', () => {
	assert.equal(glyph('todo'), '○');
	assert.equal(glyph('todo', {ascii: true}), 'o');
});
