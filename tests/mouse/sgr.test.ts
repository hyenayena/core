import test from 'node:test';
import assert from 'node:assert/strict';
import {createMouseTokenizer, decode, type RawMouse} from '../../src/mouse/sgr.js';

const ESC = String.fromCharCode(27);
const sgr = (code: number, x: number, y: number, final = 'M') => `${ESC}[<${code};${x};${y}${final}`;
const x10 = (code: number, x: number, y: number) => `${ESC}[M${String.fromCharCode(code + 32, x + 32, y + 32)}`;

function feed(chunks: string[], options: {x10?: boolean} = {}) {
	const tok = createMouseTokenizer();
	tok.setX10(options.x10 ?? false);
	let text = '';
	const events: RawMouse[] = [];
	let hold = 'none';
	for (const chunk of chunks) {
		const r = tok.push(chunk);
		text += r.text;
		events.push(...r.events);
		hold = r.hold;
	}
	return {text, events, hold, flush: () => tok.flush()};
}

test('decode maps buttons, release, wheel and modifiers', () => {
	const at = (code: number, release = false) => decode({code, x: 3, y: 2, release}, 80, 24);
	assert.deepEqual(at(0), {kind: 'press', button: 'left', x: 2, y: 1, shift: false, meta: false, ctrl: false});
	assert.equal(at(1)?.button, 'middle');
	assert.equal(at(2)?.button, 'right');
	assert.deepEqual(at(0, true), {kind: 'release', button: 'left', x: 2, y: 1, shift: false, meta: false, ctrl: false});
	assert.deepEqual(at(3), {kind: 'release', button: 'none', x: 2, y: 1, shift: false, meta: false, ctrl: false});
	assert.deepEqual(at(64), {kind: 'wheel', button: 'none', wheel: 'up', x: 2, y: 1, shift: false, meta: false, ctrl: false});
	assert.equal(at(65)?.wheel, 'down');
	assert.equal(at(66), undefined);
	assert.equal(at(67), undefined);
	assert.equal(at(64, true), undefined);
	assert.equal(at(32), undefined);
	assert.equal(at(35), undefined);
	assert.equal(at(96), undefined);
	assert.equal(at(128), undefined);
	const mods = at(4 | 8 | 16);
	assert.equal(mods?.kind, 'press');
	assert.equal(mods?.button, 'left');
	assert.deepEqual([mods?.shift, mods?.meta, mods?.ctrl], [true, true, true]);
	assert.deepEqual([at(4)?.shift, at(8)?.meta, at(16)?.ctrl], [true, true, true]);
	assert.deepEqual([at(64 | 4)?.wheel, at(64 | 4)?.shift], ['up', true]);
});

test('decode converts to 0-based and drops coordinates outside the screen', () => {
	assert.deepEqual(decode({code: 0, x: 1, y: 1, release: false}, 80, 24)?.x, 0);
	assert.equal(decode({code: 0, x: 0, y: 1, release: false}, 80, 24), undefined);
	assert.equal(decode({code: 0, x: 1, y: 0, release: false}, 80, 24), undefined);
	assert.equal(decode({code: 0, x: 80, y: 24, release: false}, 80, 24)?.y, 23);
	assert.equal(decode({code: 0, x: 81, y: 1, release: false}, 80, 24), undefined);
	assert.equal(decode({code: 0, x: 1, y: 25, release: false}, 80, 24), undefined);
	assert.equal(decode({code: 0, x: 1, y: 1, release: false}, 0, 0), undefined);
});

test('SGR reports are consumed and decoded, text around them passes through', () => {
	const r = feed([`ab${sgr(0, 10, 5)}c${sgr(0, 10, 5, 'm')}${sgr(65, 1, 1)}d`]);
	assert.equal(r.text, 'abcd');
	assert.deepEqual(r.events, [
		{code: 0, x: 10, y: 5, release: false},
		{code: 0, x: 10, y: 5, release: true},
		{code: 65, x: 1, y: 1, release: false},
	]);
	assert.equal(r.hold, 'none');
});

test('surrogate pairs and ordinary escapes pass through unchanged', () => {
	const input = `😀${ESC}[A${ESC}b${ESC}${ESC}[1;5C${sgr(0, 1, 1)}é😀`;
	const r = feed([input]);
	assert.equal(r.text, `😀${ESC}[A${ESC}b${ESC}${ESC}[1;5Cé😀`);
	assert.equal(r.events.length, 1);
});

test('a report split at every boundary across 2 chunks is joined', () => {
	const report = `x${sgr(64, 123, 45)}y`;
	for (let i = 1; i < report.length; i++) {
		const r = feed([report.slice(0, i), report.slice(i)]);
		assert.equal(r.text, 'xy', `split at ${i}`);
		assert.deepEqual(r.events, [{code: 64, x: 123, y: 45, release: false}], `split at ${i}`);
	}
});

test('a report split at every pair of boundaries across 3 chunks is joined', () => {
	const report = `x${sgr(2, 7, 8, 'm')}y`;
	for (let i = 1; i < report.length; i++) {
		for (let j = i + 1; j < report.length; j++) {
			const r = feed([report.slice(0, i), report.slice(i, j), report.slice(j)]);
			assert.equal(r.text, 'xy', `split at ${i}, ${j}`);
			assert.deepEqual(r.events, [{code: 2, x: 7, y: 8, release: true}]);
		}
	}
});

test('hold reports a trailing ESC or ESC[ as short and a partial report as long', () => {
	assert.equal(feed([`a${ESC}`]).hold, 'short');
	assert.equal(feed([`a${ESC}[`]).hold, 'short');
	assert.equal(feed([`a${ESC}[<`]).hold, 'long');
	assert.equal(feed([`a${ESC}[<0;1`]).hold, 'long');
	assert.equal(feed([`${ESC}[M`], {x10: true}).hold, 'long');
	assert.equal(feed([`${ESC}[M`]).hold, 'none');
	assert.equal(feed([`${ESC}[1`]).hold, 'none');
});

test('flush returns a held ESC or ESC[ as text and drops a partial report', () => {
	let r = feed([`a${ESC}`]);
	assert.equal(r.text, 'a');
	assert.equal(r.flush(), ESC);
	r = feed([`${ESC}[`]);
	assert.equal(r.flush(), `${ESC}[`);
	r = feed([`${ESC}[<0;12`]);
	assert.equal(r.flush(), '');
	r = feed([`${ESC}[M!`], {x10: true});
	assert.equal(r.flush(), '');
	const tok = createMouseTokenizer();
	tok.push(`${ESC}[<0;1`);
	assert.equal(tok.flush(), '');
	assert.deepEqual(tok.push(';1M'), {text: ';1M', events: [], hold: 'none'});
	assert.equal(tok.flush(), '');
});

test('malformed reports are dropped and parsing resumes at the offending character', () => {
	const letters = feed([`${ESC}[<0;1;aM`]);
	assert.equal(letters.text, 'aM');
	assert.equal(letters.events.length, 0);
	assert.equal(feed([`${ESC}[<12345;1;1M`]).text, '5;1;1M');
	assert.equal(feed([`${ESC}[<0;1M`]).text, 'M');
	assert.equal(feed([`${ESC}[<0;;1M`]).text, ';1M');
	assert.equal(feed([`${ESC}[<;1;1M`]).text, ';1;1M');
	assert.equal(feed([`${ESC}[<0;1;1;1M`]).text, ';1M');
	assert.equal(feed([`${ESC}[<0;1;1X`]).text, 'X');
	const nested = feed([`${ESC}[<0;1${sgr(0, 2, 3)}z`]);
	assert.equal(nested.text, 'z');
	assert.deepEqual(nested.events, [{code: 0, x: 2, y: 3, release: false}]);
	const key = feed([`${ESC}[<0${ESC}[A`]);
	assert.equal(key.text, `${ESC}[A`);
	assert.equal(key.events.length, 0);
});

test('the longest valid report is accepted, overlong runs are cut', () => {
	const r = feed([sgr(9999, 9999, 9999)]);
	assert.deepEqual(r.events, [{code: 9999, x: 9999, y: 9999, release: false}]);
	assert.equal(feed([`${ESC}[<00000`]).text, '0');
});

test('X10 reports are consumed only while enabled', () => {
	const on = feed([`a${x10(0, 5, 6)}b`], {x10: true});
	assert.equal(on.text, 'ab');
	assert.deepEqual(on.events, [{code: 0, x: 5, y: 6, release: false}]);
	assert.equal(decode(on.events[0]!, 80, 24)?.button, 'left');
	assert.equal(decode(feed([x10(3, 5, 6)], {x10: true}).events[0]!, 80, 24)?.kind, 'release');
	const off = feed([`a${x10(0, 5, 6)}b`]);
	assert.equal(off.text, `a${x10(0, 5, 6)}b`);
	assert.equal(off.events.length, 0);
	const split = feed([`${ESC}[M`, String.fromCharCode(32), String.fromCharCode(33, 34)], {x10: true});
	assert.deepEqual(split.events, [{code: 0, x: 1, y: 2, release: false}]);
	assert.equal(split.text, '');
});

test('bracketed paste content passes through verbatim, reports included', () => {
	const paste = `${ESC}[200~hi ${sgr(0, 1, 1)} ${ESC}[A${ESC}[201~`;
	const r = feed([`${paste}${sgr(0, 2, 2)}`]);
	assert.equal(r.text, paste);
	assert.deepEqual(r.events, [{code: 0, x: 2, y: 2, release: false}]);
	for (let i = 1; i < paste.length; i++) {
		const split = feed([paste.slice(0, i), paste.slice(i), sgr(0, 3, 3)]);
		assert.equal(split.text, paste, `split at ${i}`);
		assert.equal(split.events.length, 1, `split at ${i}`);
	}
	const open = feed([`${ESC}[200~${sgr(0, 1, 1)}`]);
	assert.equal(open.text, `${ESC}[200~${sgr(0, 1, 1)}`);
	assert.equal(open.hold, 'none');
});

test('a held ESC[ flushed into the paste start still enters the paste', () => {
	const tok = createMouseTokenizer();
	tok.push(`${ESC}[`);
	assert.equal(tok.flush(), `${ESC}[`);
	assert.equal(tok.push(`200~${sgr(0, 1, 1)}`).text, `200~${sgr(0, 1, 1)}`);
});

test('at most 256 events per chunk, the rest are still consumed', () => {
	const r = feed([`${sgr(0, 1, 1).repeat(300)}k`]);
	assert.equal(r.events.length, 256);
	assert.equal(r.text, 'k');
	const tok = createMouseTokenizer();
	tok.push(sgr(0, 1, 1).repeat(300));
	assert.equal(tok.push(sgr(0, 1, 1)).events.length, 1);
});
