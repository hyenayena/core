import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {EventBus} from '../../../../src/api.js';
import {RELOAD_TOPIC, readReload, reportReload} from '../../src/kit/text.js';

test('readReload accepts the three forms and keeps view and caller only where they belong', () => {
	assert.deepEqual(readReload({via: 'console'}), {via: 'console'});
	assert.deepEqual(readReload({via: 'view', view: 'main'}), {via: 'view', view: 'main'});
	assert.deepEqual(readReload({via: 'view', view: 'panel', caller: 'yena'}), {via: 'view', view: 'panel'});
	assert.deepEqual(readReload({via: 'bridge', caller: 'yena', view: 'main'}), {via: 'bridge', caller: 'yena'});
	assert.deepEqual(readReload({via: 'console', view: 'main', caller: 'yena'}), {via: 'console'});
});

test('readReload drops a bad view or caller and rejects junk', () => {
	assert.deepEqual(readReload({via: 'view', view: 'side'}), {via: 'view'});
	assert.deepEqual(readReload({via: 'bridge', caller: 'a b'}), {via: 'bridge'});
	assert.deepEqual(readReload({via: 'bridge', caller: 'x'.repeat(41)}), {via: 'bridge'});
	assert.deepEqual(readReload({via: 'bridge', caller: 5}), {via: 'bridge'});
	for (const junk of [undefined, null, 'console', 3, [], {}, {via: 'other'}, {via: 7}]) assert.equal(readReload(junk), undefined);
});

test('reportReload emits on the topic and survives a missing or throwing bus', () => {
	const seen: unknown[] = [];
	const bus: EventBus = {emit: (topic, payload) => void seen.push([topic, payload]), on: () => () => {}};
	reportReload(bus, {via: 'console'});
	assert.deepEqual(seen, [[RELOAD_TOPIC, {via: 'console'}]]);
	reportReload(undefined, {via: 'console'});
	reportReload({emit: () => { throw new Error('boom'); }, on: () => () => {}}, {via: 'console'});
});
