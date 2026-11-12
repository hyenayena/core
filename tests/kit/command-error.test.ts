import assert from 'node:assert/strict';
import {test} from 'node:test';
import {COMMAND_ERROR_KINDS, commandError, commandErrorKind, errorClass} from '../../src/kit/command-error.js';

test('commandError is a plain Error with its kind and message', () => {
	const error = commandError('usage', 'bad line');
	assert.ok(error instanceof Error);
	assert.equal(error.kind, 'usage');
	assert.equal(error.message, 'bad line');
	assert.equal(error.constructor, Error);
});

test('commandErrorKind reads a typed error and falls back to failed', () => {
	for (const kind of COMMAND_ERROR_KINDS) assert.equal(commandErrorKind(commandError(kind, 'x')), kind);
	assert.equal(commandErrorKind(new Error('x')), 'failed');
	assert.equal(commandErrorKind('usage'), 'failed');
	assert.equal(commandErrorKind(null), 'failed');
	assert.equal(commandErrorKind(undefined), 'failed');
	assert.equal(commandErrorKind(Object.assign(new Error('x'), {kind: 'weird'})), 'failed');
	const hostile = {
		get kind(): never {
			throw new Error('getter');
		},
	};
	assert.equal(commandErrorKind(hostile), 'failed');
});

test('errorClass names the constructor, never throws', () => {
	class DiskFull extends Error {}
	assert.equal(errorClass(new TypeError('x')), 'TypeError');
	assert.equal(errorClass(new DiskFull('x')), 'DiskFull');
	assert.equal(errorClass('text'), 'string');
	assert.equal(errorClass(null), 'object');
	assert.equal(errorClass(undefined), 'undefined');
	const hostile = {
		get constructor(): never {
			throw new Error('getter');
		},
	};
	assert.equal(errorClass(hostile), 'object');
	assert.equal(errorClass({constructor: {name: 'bad name\nSECRET'}}), 'object');
});
