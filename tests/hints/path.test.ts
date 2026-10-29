import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCatalog} from '../../src/hints/catalog.js';
import {helpTarget, policyOf, walkPath} from '../../src/hints/path.js';
import {catalog} from './fixture.js';

const doc = catalog.byName.get('doc')!;

test('walkPath follows names, then aliases, and stops at the first unknown token', () => {
	const mod = catalog.byName.get('mod')!;
	const w = walkPath(mod, ['rm', 'x', 'y']);
	assert.deepEqual(w.path.map(s => s.name), ['remove']);
	assert.deepEqual(w.rest, ['x', 'y']);
	const deep = walkPath(doc, ['auth', 'login', 'me']);
	assert.deepEqual(deep.path.map(s => s.name), ['auth', 'login']);
	assert.deepEqual(deep.rest, ['me']);
	assert.deepEqual(walkPath(doc, []).path, []);
	const shadow = buildCatalog([{name: 'c', subcommands: [{name: 'a', aliases: ['b']}, {name: 'b'}]}]).byName.get('c')!;
	assert.equal(walkPath(shadow, ['b']).path[0]?.name, 'b');
});

test('policyOf takes the deepest declared policy, else the command', () => {
	const at = (...args: string[]) => policyOf(doc, walkPath(doc, args).path);
	assert.equal(doc.agent, 'confirm');
	assert.equal(at(), 'confirm');
	assert.equal(at('ask'), 'safe');
	assert.equal(at('auth'), 'confirm');
	assert.equal(at('auth', 'login'), 'safe');
	assert.equal(at('auth', 'logout'), 'deny');
	assert.equal(at('auth', 'status'), 'confirm');
	assert.equal(at('auth', 'help'), 'safe');
});

test('helpTarget answers only for the builtin help', () => {
	assert.deepEqual(helpTarget(catalog, 'doc', ['help']), ['doc']);
	assert.deepEqual(helpTarget(catalog, 'doc', ['help', 'auth', 'login']), ['doc', 'auth', 'login']);
	assert.deepEqual(helpTarget(catalog, 'doc', ['auth', 'help', 'nope']), ['doc', 'auth', 'nope']);
	assert.equal(helpTarget(catalog, 'doc', ['auth', 'login']), undefined);
	assert.equal(helpTarget(catalog, 'echo', ['help']), undefined);
	assert.equal(helpTarget(catalog, 'missing', ['help']), undefined);
	const own = buildCatalog([{name: 'o', subcommands: [{name: 'help', usage: 'o help'}, {name: 'x'}]}]);
	assert.equal(helpTarget(own, 'o', ['help']), undefined);
});
