import test from 'node:test';
import assert from 'node:assert/strict';
import {createRowCache, type Line} from '../../src/transcript/scroll.js';
import {
	createLayoutCache,
	emptySpan,
	lineLayout,
	lineSpan,
	markAt,
	rowCells,
	selectedText,
	spanOf,
	wordSpan,
} from '../../src/transcript/selection.js';
import {sliceStyledCells, stripStyles, wrapRows} from '../../src/transcript/wrap.js';

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

test('a layout finds every wrapped row in the plain text, past dropped spaces and newlines', () => {
	const text = `${RED}hello${RESET} world\nsecond line`;
	const layout = lineLayout(text, wrapRows(text, 6));
	assert.equal(layout.plain, 'hello world\nsecond line');
	assert.deepEqual(layout.rows, ['hello ', 'world', 'second', 'line']);
	assert.deepEqual(layout.starts, [0, 6, 12, 19]);
});

test('marks are characters under cells; wide characters take two cells', () => {
	const layout = lineLayout('a界b', ['a界b']);
	assert.deepEqual(markAt(1, layout, 0, 0), {id: 1, offset: 0, end: 1});
	assert.deepEqual(markAt(1, layout, 0, 1), {id: 1, offset: 1, end: 2});
	assert.deepEqual(markAt(1, layout, 0, 2), {id: 1, offset: 1, end: 2});
	assert.deepEqual(markAt(1, layout, 0, 3), {id: 1, offset: 2, end: 3});
	assert.deepEqual(markAt(1, layout, 0, 40), {id: 1, offset: 3, end: 3});
});

test('a span includes both ends whichever way it was dragged', () => {
	const a = {id: 1, offset: 2, end: 3};
	const b = {id: 3, offset: 0, end: 1};
	assert.deepEqual(spanOf(a, b), {from: {id: 1, offset: 2}, to: {id: 3, offset: 1}});
	assert.deepEqual(spanOf(b, a), spanOf(a, b));
	assert.equal(emptySpan(spanOf(a, a)), false);
	assert.equal(emptySpan({from: {id: 1, offset: 3}, to: {id: 1, offset: 3}}), true);
});

test('the selected text joins lines with newlines, keeps wrapped lines whole and drops escapes and trailing spaces', () => {
	const lines: Line[] = [
		{id: 1, text: `${RED}first line${RESET}   `},
		{id: 2, text: 'a long second line that wraps'},
		{id: 3, text: 'third'},
	];
	const layoutOf = createLayoutCache(createRowCache());
	const span = {from: {id: 1, offset: 6}, to: {id: 3, offset: 3}};
	assert.equal(selectedText(lines, span, layoutOf, 8), 'line\na long second line that wraps\nthi');
	assert.equal(selectedText(lines, span, layoutOf, 80), 'line\na long second line that wraps\nthi');
});

test('row cells follow the span on every wrapped row', () => {
	const text = 'hello world';
	const layout = lineLayout(text, wrapRows(text, 5));
	const span = {from: {id: 7, offset: 3}, to: {id: 7, offset: 8}};
	assert.deepEqual(layout.rows, ['hello', 'world']);
	assert.deepEqual(rowCells({key: '7:0', id: 7, row: 0, text: 'hello'}, span, layout), [3, 5]);
	assert.deepEqual(rowCells({key: '7:1', id: 7, row: 1, text: 'world'}, span, layout), [0, 2]);
	assert.equal(rowCells({key: '8:0', id: 8, row: 0, text: 'x'}, span, layout), undefined);
});

test('double click takes a word (paths included), triple click the line', () => {
	const layout = lineLayout('open src/app.tsx now', ['open src/app.tsx now']);
	assert.equal(stripStyles('x'), 'x');
	const mark = markAt(4, layout, 0, 8);
	assert.deepEqual(wordSpan(layout, mark), {from: {id: 4, offset: 5}, to: {id: 4, offset: 16}});
	assert.deepEqual(wordSpan(layout, markAt(4, layout, 0, 4)), {from: {id: 4, offset: 4}, to: {id: 4, offset: 5}});
	assert.deepEqual(lineSpan(layout, 4), {from: {id: 4, offset: 0}, to: {id: 4, offset: 20}});
});

test('styled cell slices keep the styles and end with a reset', () => {
	const text = `ab${RED}cd${RESET}ef`;
	assert.equal(sliceStyledCells(text, 0, 2), `ab${RED}${RESET}${RESET}`);
	assert.equal(stripStyles(sliceStyledCells(text, 1, 5)), 'bcde');
	assert.equal(sliceStyledCells('plain', 1, 3), 'la');
	assert.equal(sliceStyledCells('plain', 3, 3), '');
});
