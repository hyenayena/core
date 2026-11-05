import assert from 'node:assert/strict';
import {test} from 'node:test';
import {meterBar, segmentBar, stripStyles, styledCells} from '../../src/kit/text.js';
import {SGR_RESET, toneSgr, withColorDepth} from '../../src/kit/theme.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const plain = (s: string): string => stripStyles(s);

const SEGMENTS = [
	{forms: ['activity long', 'activity', 'act'], keep: true},
	{forms: ['model (task light)', 'model']},
	{forms: ['ctx ### 48%', 'ctx 48%']},
	{forms: ['project branch', 'project']},
];

test('full form when it fits', () => {
	withColorDepth('none', () => {
		assert.equal(plain(segmentBar(SEGMENTS, 200)), 'activity long · model (task light) · ctx ### 48% · project branch');
	});
});
test('shortens from the rightmost segment leftwards', () => {
	withColorDepth('none', () => {
		assert.equal(plain(segmentBar(SEGMENTS, 64)), 'activity long · model (task light) · ctx ### 48% · project');
		assert.equal(plain(segmentBar(SEGMENTS, 57)), 'activity long · model (task light) · ctx 48% · project');
		assert.equal(plain(segmentBar(SEGMENTS, 53)), 'activity long · model · ctx 48% · project');
		assert.equal(plain(segmentBar(SEGMENTS, 35)), 'act · model · ctx 48% · project');
	});
});

test('drops from the right, never a kept segment, then cuts', () => {
	withColorDepth('none', () => {
		assert.equal(plain(segmentBar(SEGMENTS, 25)), 'act · model · ctx 48%');
		assert.equal(plain(segmentBar(SEGMENTS, 12)), 'act · model');
		assert.equal(plain(segmentBar(SEGMENTS, 8)), 'act');
		assert.equal(plain(segmentBar(SEGMENTS, 2)), 'a…');
		assert.equal(plain(segmentBar([{forms: ['abcdefghij'], keep: true}], 5)), 'abcd…');
	});
});

test('width never exceeded for 1..200', () => {
	for (const depth of ['none', '16', 'truecolor'] as const) {
		withColorDepth(depth, () => {
			for (let w = 1; w <= 200; w++) {
				const row = segmentBar(SEGMENTS, w);
				assert.ok(styledCells(row) <= w, `${depth} ${w}`);
			}
		});
	}
});

test('styled input is measured by cells and hostile sequences are stripped', () => {
	withColorDepth('none', () => {
		const red = `${ESC}[31mred${SGR_RESET}`;
		assert.equal(plain(segmentBar([{forms: [red]}, {forms: ['x']}], 10)), "red · x");
		const row = plain(segmentBar([{forms: [`a${ESC}]0;title${BEL}b${ESC}[2Jc`]}], 20));
		assert.equal(row, 'abc');
	});
});

test('empty segments are skipped and ascii ellipsis', () => {
	withColorDepth('none', () => {
		assert.equal(plain(segmentBar([{forms: ['']}, {forms: ['a']}], 10)), 'a');
		assert.equal(plain(segmentBar([{forms: ['abcdefghij']}], 5, {ascii: true})), 'abcd.');
		assert.equal(plain(segmentBar([{forms: ['a']}, {forms: ['b']}], 10, {separator: ' | '})), 'a | b');
	});
});

test('separator is muted per depth', () => {
	withColorDepth('truecolor', () => {
		const row = segmentBar([{forms: ['a']}, {forms: ['b']}], 10);
		assert.equal(row, `a${toneSgr('muted', 'truecolor')} · ${SGR_RESET}b`);
	});
	withColorDepth('16', () => {
		assert.ok(segmentBar([{forms: ['a']}, {forms: ['b']}], 10).includes(toneSgr('muted', '16')));
	});
});

test('meterBar fractions and edges', () => {
	withColorDepth('none', () => {
		assert.equal(plain(meterBar(0, 6)), '▱▱▱▱▱▱');
		assert.equal(plain(meterBar(0.5, 6)), '▰▰▰▱▱▱');
		assert.equal(plain(meterBar(1, 6)), '▰▰▰▰▰▰');
		assert.equal(plain(meterBar(2, 6)), '▰▰▰▰▰▰');
		assert.equal(plain(meterBar(-1, 6)), '▱▱▱▱▱▱');
		assert.equal(plain(meterBar(Number.NaN, 6)), '▱▱▱▱▱▱');
		assert.equal(plain(meterBar(0.5, 6, {ascii: true})), '###---');
		assert.equal(plain(meterBar(0.5, 0)), '');
	});
});

test('meterBar tones per depth', () => {
	withColorDepth('truecolor', () => {
		assert.equal(meterBar(0.5, 2, {tone: 'warn'}), `${toneSgr('warn', 'truecolor')}▰${SGR_RESET}${toneSgr('frame', 'truecolor')}▱${SGR_RESET}`);
	});
	withColorDepth('16', () => {
		assert.ok(meterBar(1, 2, {tone: 'error'}).startsWith(toneSgr('error', '16')));
	});
});
