import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	COLOR_DEPTHS,
	DARK_THEME,
	SPAN_TONE_THEME,
	THEME_TONES,
	colorDepth,
	detectColorDepth,
	inkTone,
	paintTone,
	resetColorDepthCacheForTests,
	sgrTable,
	toneSgr,
	withColorDepth,
} from '../../src/kit/theme.js';
import {TONE_SGR} from '../../src/kit/styled.js';
import {TONE_THEME} from '../../src/kit/types.js';

const ESC = String.fromCharCode(27);

test('every tone defines all four depths with valid values', () => {
	for (const tone of THEME_TONES) {
		const d = DARK_THEME[tone];
		for (const key of ['truecolor', 'c256', 'c16', 'none'] as const) assert.equal(typeof d[key], 'object', `${tone}.${key}`);
		for (const v of [d.truecolor.fg, d.truecolor.bg]) if (v !== undefined) assert.match(v, /^#[0-9a-f]{6}$/, tone);
		for (const v of [d.c256.fg, d.c256.bg]) if (v !== undefined) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, tone);
		for (const v of [d.c16.fg, d.c16.bg]) if (v !== undefined) assert.ok(Number.isInteger(v) && v >= 0 && v <= 15, tone);
		assert.equal('fg' in d.none || 'bg' in d.none, false, `${tone} none has a colour`);
	}
});

test('SGR forms per depth', () => {
	assert.equal(toneSgr('accent', 'truecolor'), `${ESC}[38;2;86;182;194m`);
	assert.equal(toneSgr('accent', '256'), `${ESC}[38;5;73m`);
	assert.equal(toneSgr('accent', '16'), `${ESC}[36m`);
	assert.equal(toneSgr('accent', 'none'), '');
	assert.equal(toneSgr('addedBg', 'truecolor'), `${ESC}[48;2;31;58;36m`);
	assert.equal(toneSgr('addedBg', '256'), `${ESC}[48;5;22m`);
	assert.equal(toneSgr('surface', '16'), `${ESC}[100m`);
	assert.equal(toneSgr('muted', '16'), `${ESC}[2m`);
	assert.equal(toneSgr('muted', '256'), `${ESC}[38;5;245m`);
	assert.equal(toneSgr('muted', 'none'), `${ESC}[2m`);
	assert.equal(toneSgr('focus', '16'), `${ESC}[1;34m`);
	assert.equal(toneSgr('heading', 'truecolor'), `${ESC}[1;38;2;97;175;239m`);
	assert.equal(toneSgr('heading', 'none'), `${ESC}[1m`);
	assert.equal(toneSgr('link', '16'), `${ESC}[4;36m`);
	assert.equal(toneSgr('link', 'none'), `${ESC}[4m`);
	assert.equal(toneSgr('code.inline', '256'), `${ESC}[38;5;173m`);
	assert.equal(toneSgr('code.inline', 'none'), '');
	assert.equal(toneSgr('code.comment', 'truecolor'), `${ESC}[3;38;2;127;132;142m`);
	assert.equal(toneSgr('text', 'truecolor'), '');
});

test('none emits no colour parameters', () => {
	for (const tone of THEME_TONES) assert.doesNotMatch(toneSgr(tone, 'none'), /3[0-9];|38|48|9[0-7]|4[0-7]|10[0-7]/, tone);
});

test('16-colour background tones carry no background', () => {
	for (const tone of ['addedBg', 'removedBg'] as const) {
		assert.equal(DARK_THEME[tone].c16.bg, undefined);
		assert.doesNotMatch(toneSgr(tone, '16'), /;4[0-7]|\[4[0-7]|10[0-7]/);
	}
});

test('legacy span tone codes are the 16-colour values', () => {
	assert.deepEqual({...TONE_SGR}, {accent: '36', muted: '2', ok: '32', warn: '33', error: '31'});
});

test('paintTone wraps each line and leaves the text alone without a style', () => {
	assert.equal(paintTone('a\nb', 'ok', '16'), `${ESC}[32ma${ESC}[0m\n${ESC}[32mb${ESC}[0m`);
	assert.equal(paintTone('a', 'ok', 'none'), 'a');
	assert.equal(paintTone('a', 'text', '16'), 'a');
});

test('depth detection', () => {
	assert.equal(detectColorDepth({NO_COLOR: '1', COLORTERM: 'truecolor'}), 'none');
	assert.equal(detectColorDepth({NO_COLOR: '', COLORTERM: 'truecolor'}), 'truecolor');
	assert.equal(detectColorDepth({YENA_COLOR: '256', COLORTERM: 'truecolor'}), '256');
	assert.equal(detectColorDepth({YENA_COLOR: 'bogus', TERM: 'xterm-256color'}), '256');
	assert.equal(detectColorDepth({COLORTERM: '24bit'}), 'truecolor');
	assert.equal(detectColorDepth({TERM: 'xterm-direct'}), 'truecolor');
	assert.equal(detectColorDepth({TERM: 'xterm-256color'}), '256');
	assert.equal(detectColorDepth({TERM: 'dumb'}), 'none');
	assert.equal(detectColorDepth({TERM: 'xterm'}), '16');
	assert.equal(detectColorDepth({}), '16');
	assert.equal(colorDepth({YENA_COLOR: '16'}), '16');
});

test('withColorDepth nests and restores after a throw', () => {
	resetColorDepthCacheForTests();
	const outer = colorDepth();
	withColorDepth('16', () => {
		assert.equal(colorDepth(), '16');
		withColorDepth('truecolor', () => assert.equal(colorDepth(), 'truecolor'));
		assert.equal(colorDepth(), '16');
	});
	assert.throws(() => withColorDepth('none', () => {
		throw new Error('x');
	}));
	assert.equal(colorDepth(), outer);
});

test('inkTone forms', () => {
	assert.deepEqual(inkTone('accent', 'truecolor'), {color: '#56b6c2'});
	assert.deepEqual(inkTone('accent', '256'), {color: 'ansi256(73)'});
	assert.deepEqual(inkTone('accent', '16'), {color: 'cyan'});
	assert.deepEqual(inkTone('accent', 'none'), {});
	assert.deepEqual(inkTone('muted', '16'), {dimColor: true});
	assert.deepEqual(inkTone('surface', '16'), {backgroundColor: 'blackBright'});
	assert.deepEqual(inkTone('addedWord', 'none'), {bold: true, underline: true});
	assert.deepEqual(inkTone('code.comment', '256'), {color: 'ansi256(244)', italic: true});
});

test('SPAN_TONE_THEME and TONE_THEME point at real tones', () => {
	for (const t of ['accent', 'muted', 'ok', 'warn', 'error'] as const) assert.ok(THEME_TONES.includes(SPAN_TONE_THEME[t]));
	for (const t of Object.values(TONE_THEME)) assert.ok(t === null || THEME_TONES.includes(t));
	assert.equal(COLOR_DEPTHS.length, 4);
	assert.equal(sgrTable('16'), sgrTable('16'));
});
