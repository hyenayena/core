import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCapture} from '../../src/agent/capture.js';

const fill = (limits: {chars: number; lines: number}, lines: string[]) => {
	const c = createCapture(limits);
	for (const line of lines) c.push(line);
	return c;
};

test('output within the limits is kept whole', () => {
	const c = fill({chars: 100, lines: 10}, ['a', 'b', '', 'c']);
	assert.equal(c.truncated, false);
	assert.equal(c.text(), 'a\nb\n\nc');
});

test('too many lines keep the start and the end with a marker between', () => {
	const c = fill({chars: 10_000, lines: 9}, Array.from({length: 100}, (_, i) => `l${i}`));
	assert.equal(c.truncated, true);
	const out = c.text().split('\n');
	assert.deepEqual(out.slice(0, 6), ['l0', 'l1', 'l2', 'l3', 'l4', 'l5']);
	assert.match(out[6]!, /^… \[91 lines, \d+ characters omitted\] …$/);
	assert.deepEqual(out.slice(7), ['l97', 'l98', 'l99']);
});

test('too many characters stay within the budget and keep the last lines', () => {
	const c = fill({chars: 300, lines: 1000}, Array.from({length: 50}, (_, i) => `line ${i} `.padEnd(20, '.')));
	const text = c.text();
	assert.equal(c.truncated, true);
	assert.ok(text.length <= 300 + 60, String(text.length));
	assert.ok(text.startsWith('line 0 '));
	assert.ok(text.endsWith('line 49 '.padEnd(20, '.')));
});

test('one huge line is cut, with the omitted size said', () => {
	const c = fill({chars: 300, lines: 10}, ['x'.repeat(5000)]);
	const text = c.text();
	assert.equal(c.truncated, true);
	assert.ok(text.length <= 360);
	assert.match(text, /… \[\d+ characters omitted\] …$/);
});
