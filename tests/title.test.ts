import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_TITLE, setTerminalTitle, titleSequence} from '../src/view/title.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test('the title sequence is OSC 0 with the sanitised title', () => {
	assert.equal(titleSequence(APP_TITLE), `${ESC}]0;yena${BEL}`);
	assert.doesNotMatch(titleSequence(`a${BEL}b${ESC}c`).slice(4, -1), /[\x07\x1b]/);
});

test('the title is written only to a terminal and write errors are ignored', () => {
	const out: string[] = [];
	setTerminalTitle({isTTY: false, write: s => out.push(s)}, 'yena');
	assert.equal(out.length, 0);
	setTerminalTitle({isTTY: true, write: s => out.push(s)}, 'yena');
	assert.deepEqual(out, [`${ESC}]0;yena${BEL}`]);
	setTerminalTitle(
		{
			isTTY: true,
			write: () => {
				throw new Error('closed');
			},
		},
		'yena',
	);
});
