import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	createOutputStore,
	missingOutputText,
	needsBuffer,
	previewOutput,
	readOutput,
	READ_MAX_LINES,
} from '../../src/kit/text.js';
import {
	INLINE_MAX_CHARS,
	INLINE_MAX_LINES,
	PREVIEW_HEAD_LINES,
	PREVIEW_LINE_CHARS,
	PREVIEW_TAIL_LINES,
} from '../../src/kit/output-store.js';

const numbered = (n: number, prefix = 'line'): string => Array.from({length: n}, (_, i) => `${prefix} ${i + 1}`).join('\n');

test('ids are tag-n, never reused, with a random three-character tag per store', () => {
	const a = createOutputStore();
	const first = a.put('x')!;
	assert.match(first.id, /^[a-z0-9]{3}-1$/);
	assert.equal(a.put('y')!.id, first.id.replace(/-1$/, '-2'));
	assert.equal(createOutputStore({tag: 'abc'}).put('z')!.id, 'abc-1');
});

test('the store drops the oldest outputs by count and by characters', () => {
	const byCount = createOutputStore({maxEntries: 2, tag: 't'});
	byCount.put('a');
	byCount.put('b');
	byCount.put('c');
	assert.equal(byCount.size, 2);
	assert.equal(byCount.get('t-1'), undefined);
	assert.ok(byCount.get('t-3'));

	const byChars = createOutputStore({maxChars: 10, tag: 't'});
	byChars.put('12345');
	byChars.put('12345');
	byChars.put('123456');
	assert.equal(byChars.size, 1);
	assert.ok(byChars.get('t-3'));
});

test('get refreshes recency and an oversized text is refused', () => {
	const store = createOutputStore({maxEntries: 2, tag: 't'});
	store.put('a');
	store.put('b');
	store.get('t-1');
	store.put('c');
	assert.ok(store.get('t-1'));
	assert.equal(store.get('t-2'), undefined);
	assert.equal(createOutputStore({maxChars: 3}).put('abcd'), undefined);
	store.clear();
	assert.equal(store.size, 0);
	assert.equal(store.put('d')!.id, 't-4');
});

test('needsBuffer triggers over the character or line thresholds', () => {
	assert.equal(needsBuffer('a'.repeat(INLINE_MAX_CHARS)), false);
	assert.equal(needsBuffer('a'.repeat(INLINE_MAX_CHARS + 1)), true);
	assert.equal(needsBuffer(numbered(INLINE_MAX_LINES).replace(/line /g, '')), false);
	assert.equal(needsBuffer(Array.from({length: INLINE_MAX_LINES + 1}, () => 'x').join('\n')), true);
	assert.equal(needsBuffer(''), false);
});

test('previewOutput keeps the head and the tail around a marker', () => {
	const stored = createOutputStore({tag: 't'}).put(numbered(200))!;
	const lines = previewOutput(stored, {truncated: false}).split('\n');
	assert.equal(lines[0], 'line 1');
	const marker = lines.findIndex(l => l.startsWith('… [output t-1'));
	assert.ok(marker > 0 && marker <= PREVIEW_HEAD_LINES);
	assert.match(lines[marker]!, new RegExp(`^… \\[output t-1: 200 lines, 2 KB; lines ${marker + 1}-185 not shown; read_output id="t-1"\\] …$`));
	assert.equal(lines.at(-1), 'line 200');
	assert.ok(lines.length - marker - 1 <= PREVIEW_TAIL_LINES);
	assert.equal(lines.at(-(lines.length - marker - 1))!, `line ${200 - (lines.length - marker - 1) + 1}`);
});

test('previewOutput names a console truncation and clips long lines', () => {
	const stored = createOutputStore({tag: 't'}).put(`${'x'.repeat(5000)}\n${numbered(100)}`)!;
	const text = previewOutput(stored, {truncated: true});
	assert.match(text, /; the console kept only the start and the end; read_output id="t-1"\]/);
	const first = text.split('\n')[0]!;
	assert.equal(first.length, PREVIEW_LINE_CHARS);
	assert.ok(first.endsWith('…'));
});

test('previewOutput of a few huge lines never repeats a line', () => {
	const stored = createOutputStore({tag: 't'}).put(Array.from({length: 90}, (_, i) => `${i}${'y'.repeat(300)}`).join('\n'))!;
	const text = previewOutput(stored, {truncated: false});
	const rows = text.split('\n');
	assert.equal(new Set(rows).size, rows.length);
	assert.ok(text.length < 4000);
});

test('readOutput pages by line range with numbers, a header and a footer', () => {
	const stored = createOutputStore({tag: 't'}).put(numbered(250))!;
	const first = readOutput(stored, {});
	assert.equal(first.isError, false);
	const rows = first.text.split('\n');
	assert.equal(rows[0], '[output t-1: lines 1-100 of 250]');
	assert.equal(rows[1], '1: line 1');
	assert.equal(rows[100], '100: line 100');
	assert.equal(rows[101], '[more: from=101]');
	const last = readOutput(stored, {from: 201, lines: 400});
	assert.equal(last.text.split('\n')[0], '[output t-1: lines 201-250 of 250]');
	assert.ok(!last.text.includes('[more'));
	assert.equal(readOutput(stored, {from: 1, lines: 9999}).text.split('\n')[0], `[output t-1: lines 1-${Math.min(READ_MAX_LINES, 250)} of 250]`);
});

test('readOutput clips long lines and stops at the character budget', () => {
	const stored = createOutputStore({tag: 't'}).put(Array.from({length: 100}, () => 'z'.repeat(900)).join('\n'))!;
	const result = readOutput(stored, {lines: 100});
	assert.ok(result.text.length < 17 * 1024);
	assert.match(result.text, /\[more: from=\d+\]$/);
	const clipped = createOutputStore().put('q'.repeat(3000))!;
	assert.equal(readOutput(clipped, {}).text.split('\n')[1]!.length, '1: '.length + 1000);
});

test('readOutput refuses a start beyond the end', () => {
	const stored = createOutputStore({tag: 't'}).put('a\nb')!;
	assert.deepEqual(readOutput(stored, {from: 3}), {text: 'Output t-1 has 2 lines.', isError: true});
});

test('grep matches case-insensitively with original line numbers and pages', () => {
	const text = Array.from({length: 300}, (_, i) => (i % 3 === 0 ? `ERROR at ${i + 1}` : `fine ${i + 1}`)).join('\n');
	const stored = createOutputStore({tag: 't'}).put(text)!;
	const hit = readOutput(stored, {grep: 'error', lines: 3});
	assert.equal(hit.isError, false);
	assert.equal(hit.text, '[output t-1: 3 matching lines from line 1]\n1: ERROR at 1\n4: ERROR at 4\n7: ERROR at 7\n[more: from=8]');
	const next = readOutput(stored, {grep: '^error', from: 298, lines: 3});
	assert.equal(next.text, '[output t-1: 1 matching lines from line 298]\n298: ERROR at 298');
	const none = readOutput(stored, {grep: 'nothing here'});
	assert.equal(none.text, '[output t-1: 0 matching lines from line 1]');
});

test('grep refuses an invalid or overlong pattern', () => {
	const stored = createOutputStore({tag: 't'}).put('a')!;
	assert.deepEqual(readOutput(stored, {grep: '('}), {text: 'The grep pattern is not a valid regular expression.', isError: true});
	assert.equal(readOutput(stored, {grep: 'a'.repeat(201)}).isError, true);
});

test('grep gives up on a catastrophic pattern within the timeout', () => {
	const stored = createOutputStore({tag: 't'}).put(`${'a'.repeat(40)}!`)!;
	const started = Date.now();
	const result = readOutput(stored, {grep: '(a+)+$'});
	assert.ok(Date.now() - started < 2000);
	assert.deepEqual(result, {text: 'The grep pattern took too long; use a simpler one.', isError: true});
});

test('missingOutputText sanitises the id and says what is kept', () => {
	const text = missingOutputText(`x${String.fromCharCode(27)}[31m`);
	assert.ok(!text.includes(String.fromCharCode(27)));
	assert.match(text, /is no longer kept \(only the last 20 outputs of this chat are, and none survive a reload\)\. Run the command again\.$/);
});
