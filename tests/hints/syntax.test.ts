import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCatalog} from '../../src/hints/catalog.js';
import {SYNTAX_TONE, promptSegments, syntaxRanges, type SyntaxRange} from '../../src/hints/syntax.js';
import {windowLine} from '../../src/hints/viewport.js';
import {graphemes} from '../../src/hints/width.js';

const catalog = buildCatalog([
	{
		name: 'dev',
		description: 'd',
		subcommands: [
			{name: 'test', aliases: ['t'], description: 't', options: [{name: '--file', aliases: ['-f']}], subcommands: [{name: 'unit', description: 'u'}]},
			{name: 'check', description: 'c'},
		],
	},
	{name: 'echo', description: 'e'},
]);

const roles = (value: string) => syntaxRanges(value, catalog).map(r => `${value.slice(r.start, r.end)}:${r.role}`);

test('a known command is a command; an unknown finished first word is unknown', () => {
	assert.deepEqual(roles('echo hi'), ['echo:command']);
	assert.deepEqual(roles('nope hi'), ['nope:unknown']);
});

test('an unknown first word is plain while it is still being typed', () => {
	assert.deepEqual(roles('no'), []);
	assert.deepEqual(roles('"no'), []);
	assert.deepEqual(roles(''), []);
});

test('subcommands by name or alias, nested, and only at their depth', () => {
	assert.deepEqual(roles('dev test unit'), ['dev:command', 'test:subcommand', 'unit:subcommand']);
	assert.deepEqual(roles('dev t'), ['dev:command', 't:subcommand']);
	assert.deepEqual(roles('dev other test'), ['dev:command']);
	assert.deepEqual(roles('dev check unit'), ['dev:command', 'check:subcommand']);
});

test('options up to the equals sign, quoted words as strings', () => {
	assert.deepEqual(roles('dev test --file x'), ['dev:command', 'test:subcommand', '--file:option']);
	assert.deepEqual(roles('dev test --file=value'), ['dev:command', 'test:subcommand', '--file:option']);
	assert.deepEqual(roles('dev test -f'), ['dev:command', 'test:subcommand', '-f:option']);
	assert.deepEqual(roles('echo "a b" c'), ['echo:command', '"a b":string']);
	assert.deepEqual(roles('echo --msg="a b"'), ['echo:command', '--msg:option', '"a b":string']);
	assert.deepEqual(roles('echo -5'), ['echo:command']);
});

test('an open quote is a string to the end of the line', () => {
	const r = syntaxRanges('echo "a b', catalog);
	assert.deepEqual(r.at(-1), {start: 5, end: 9, role: 'string'});
});

test('the tones come from the theme', () => {
	assert.deepEqual(SYNTAX_TONE.command, {tone: 'accent', bold: true});
	assert.equal(SYNTAX_TONE.unknown.tone, 'error');
	assert.equal(SYNTAX_TONE.subcommand.tone, 'code.function');
	assert.equal(SYNTAX_TONE.option.tone, 'code.attribute');
	assert.equal(SYNTAX_TONE.string.tone, 'code.string');
});

const segs = (value: string, cursor: number, max: number, ghost = '') => {
	const gs = graphemes(value);
	const win = windowLine(gs, cursor, ghost, max);
	return {win, segments: promptSegments(value, win, syntaxRanges(value, catalog))};
};

test('promptSegments covers the shown text with the cursor cell and the ghost', () => {
	const {segments} = segs('dev test', 8, 40, ' --file');
	assert.equal(segments.map(s => s.text).join(''), 'dev test --file');
	assert.deepEqual(segments[0], {text: 'dev', tone: 'accent', bold: true});
	assert.equal(segments.find(s => s.text === 'test')?.tone, 'code.function');
	assert.equal(segments.some(s => s.cursor), true);
	assert.equal(segments.at(-1)!.ghost, true);
});

test('promptSegments keeps tones aligned in a scrolled window', () => {
	const value = 'echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa dev test --file x';
	const {win, segments} = segs(value, graphemes(value).length, 20);
	assert.equal(win.leftCut, true);
	assert.equal(segments[0]!.text.startsWith('…'), true);
	assert.equal(segments[0]!.tone, undefined);
	const shown = segments.map(s => s.text).join('');
	assert.equal(shown.length <= 20, true);
	assert.equal(segments.find(s => s.text === '--file')?.tone, 'code.attribute');
});

test('promptSegments puts the cursor on a real character mid-line', () => {
	const {segments} = segs('dev test', 2, 40);
	const cursor = segments.find(s => s.cursor)!;
	assert.equal(cursor.text, 'v');
	assert.equal(cursor.tone, 'accent');
	assert.equal(cursor.ghost, undefined);
	const ranges: SyntaxRange[] = [];
	assert.equal(promptSegments('', windowLine([], 0, '', 10), ranges).map(s => s.text).join(''), ' ');
});
