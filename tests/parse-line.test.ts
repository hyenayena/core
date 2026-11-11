import assert from 'node:assert/strict';
import {test} from 'node:test';
import {joinWords, LineError, parseLine, quoteWord, splitWords} from '../src/parse-line.js';

const texts = (line: string): string[] => splitWords(line).words.map(w => w.text);

test('words split on any unquoted whitespace', () => {
	assert.deepEqual(texts('  a \t b c  '), ['a', 'b', 'c']);
	assert.deepEqual(texts(''), []);
});

test('a quote opens at the start of a word or after the = of an option', () => {
	const rules: Array<[string, string[]]> = [
		['a "b c"', ['a', 'b c']],
		["a 'b c'", ['a', 'b c']],
		['--opt="a b" x', ['--opt=a b', 'x']],
		["-o='a b'", ['-o=a b']],
		['a=\'b c\'', ["a='b", "c'"]],
		['--opt="a b"c', []],
		['a"b c"', ['a"b', 'c"']],
		['x "a \\" b" y', ['x', 'a " b', 'y']],
		['"a \\\\ b"', ['a \\ b']],
		['"a \\n b"', ['a \\n b']],
		["'a \\\" b'", ['a \\" b']],
		['a\\ b', ['a\\', 'b']],
		['""', ['']],
		['"a" "b"', ['a', 'b']],
		['"a"b c"', ['a"b c']],
		['"it\'s fine"', ["it's fine"]],
		["'say \"hi\"'", ['say "hi"']],
		['"a  b"', ['a  b']],
	];
	for (const [line, want] of rules) {
		if (want.length === 0) assert.throws(() => splitWords(line), LineError, line);
		else assert.deepEqual(texts(line), want, line);
	}
});

test('word positions and the quoted flag refer to the line', () => {
	const {words} = splitWords('ab "c d" e');
	assert.deepEqual(words.map(w => [w.start, w.end, w.quoted]), [[0, 2, false], [3, 8, true], [9, 10, false]]);
});

test('an unclosed quote throws in strict mode and reports itself in partial mode', () => {
	assert.throws(() => splitWords('a "b'), {name: 'LineError', message: 'The line has an unclosed " quote'});
	assert.throws(() => splitWords("a 'b"), {message: "The line has an unclosed ' quote"});
	assert.throws(() => splitWords('"a\\"'), LineError);
	const partial = splitWords('a "b c', {partial: true});
	assert.equal(partial.open, '"');
	assert.deepEqual(partial.words.map(w => [w.text, w.quoted]), [['a', false], ['b c', true]]);
	assert.equal(splitWords('a "b" ', {partial: true}).open, undefined);
});

test('parseLine trims, keeps the raw line and rejects an empty command name', () => {
	assert.equal(parseLine('   '), undefined);
	assert.deepEqual(parseLine('  mod  add "a b" '), {line: 'mod  add "a b"', name: 'mod', args: ['add', 'a b']});
	assert.deepEqual(parseLine('"mod" list'), {line: '"mod" list', name: 'mod', args: ['list']});
	assert.throws(() => parseLine('"" x'), {message: 'The line has no command name'});
	assert.throws(() => parseLine('x "y'), LineError);
});

test('quoteWord leaves plain words alone and escapes the rest', () => {
	for (const w of ['a', '--opt=x', 'a"b', "it's", 'a\\b', '-x', '--']) assert.equal(quoteWord(w), w);
	assert.equal(quoteWord(''), '""');
	assert.equal(quoteWord('a b'), '"a b"');
	assert.equal(quoteWord('"x'), '"\\"x"');
	assert.equal(quoteWord("'x"), `"'x"`);
	assert.equal(quoteWord('--opt="a'), '"--opt=\\"a"');
	assert.equal(quoteWord('a\\ b'), '"a\\\\ b"');
});

test('splitWords(joinWords(words)) returns the words for random strings', () => {
	const alphabet = ['a', ' ', '"', "'", '\\', '=', '-', 'é'];
	let seed = 12345;
	const next = (n: number): number => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed % n;
	};
	for (let round = 0; round < 3000; round++) {
		const count = next(5);
		const words = Array.from({length: count}, () => Array.from({length: next(7)}, () => alphabet[next(alphabet.length)]).join(''));
		assert.deepEqual(texts(joinWords(words)), words, JSON.stringify(words));
	}
});
