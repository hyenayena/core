import assert from 'node:assert/strict';
import {test} from 'node:test';
import {errorLogFields, stackFrames} from '../src/error-lines.js';
import {commandError} from '../src/kit/command-error.js';

test('errorLogFields carries only kind, class and a well-formed code', () => {
	assert.deepEqual(errorLogFields(commandError('not-found', 'SECRET')), {kind: 'not-found', errClass: 'Error'});
	assert.deepEqual(errorLogFields(Object.assign(new TypeError('x'), {code: 'ENOENT'})), {kind: 'failed', errClass: 'TypeError', code: 'ENOENT'});
});

test('errorLogFields drops a code that is not an upper-case identifier', () => {
	for (const code of ['enoent', 'E NOENT', 'E\nSECRET', 'A'.repeat(41), '', 5, {}, null, '9X']) {
		assert.equal('code' in errorLogFields(Object.assign(new Error('x'), {code})), false, String(code));
	}
	assert.equal(errorLogFields(Object.assign(new Error('x'), {code: 'A'.repeat(40)})).code, 'A'.repeat(40));
});

test('errorLogFields survives hostile getters and non-errors', () => {
	const hostile = {
		get kind(): never { throw new Error('k'); },
		get code(): never { throw new Error('c'); },
		get constructor(): never { throw new Error('n'); },
	};
	assert.deepEqual(errorLogFields(hostile), {kind: 'failed', errClass: 'object'});
	assert.deepEqual(errorLogFields('SECRET text'), {kind: 'failed', errClass: 'string'});
	assert.deepEqual(errorLogFields(undefined), {kind: 'failed', errClass: 'undefined'});
	assert.deepEqual(errorLogFields(Object.assign(new Error('x'), {kind: 'SECRET'})), {kind: 'failed', errClass: 'Error'});
});

test('stackFrames returns frames only, never message lines', () => {
	const frames = stackFrames(new Error('first SECRET\n  at fake (secret.js:1:1)\nlast SECRET'));
	assert.ok(frames !== undefined);
	assert.doesNotMatch(frames, /SECRET|secret\.js|fake/);
	for (const line of frames.split('\n')) assert.match(line, /^at /);
});

test('stackFrames caps the frame count and handles odd values', () => {
	const error = new Error('x');
	error.stack = ['Error: x', ...Array.from({length: 40}, (_, i) => `    at f${i} (file.js:${i}:1)`)].join('\n');
	assert.equal(stackFrames(error)?.split('\n').length, 12);
	assert.equal(stackFrames('SECRET'), undefined);
	assert.equal(stackFrames({stack: 'at SECRET'}), undefined);
	const noStack = new Error('x');
	noStack.stack = undefined;
	assert.equal(stackFrames(noStack), undefined);
	const hostile = new Error('x');
	Object.defineProperty(hostile, 'stack', {get() { throw new Error('s'); }});
	assert.equal(stackFrames(hostile), undefined);
});

test('stackFrames does not leak a message lengthened after creation', () => {
	const error = new Error('a');
	error.message = 'a\n  at SECRET (x.js:1:1)';
	assert.doesNotMatch(stackFrames(error) ?? '', /SECRET/);
});

test('stackFrames with a message shortened after creation', () => {
	const error = new Error('a\n  at SECRET (x.js:1:1)');
	error.message = 'a';
	assert.doesNotMatch(stackFrames(error) ?? '', /SECRET/);
});
