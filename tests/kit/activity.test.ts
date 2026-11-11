import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {EventBus} from '../../../../src/api.js';
import {
	ACTIVITY_FLASH_MS,
	ACTIVITY_MAX_ITEMS,
	ACTIVITY_STALE_MS,
	ACTIVITY_TOPIC,
	EMPTY_ACTIVITY,
	activityRow,
	applyActivity,
	nextActivityChange,
	readActivity,
	reportActivity,
	stripStyles,
	styledCells,
	visibleActivity,
	type ActivityFeed,
	type ActivityReport,
} from '../../src/kit/text.js';
import {withColorDepth} from '../../src/kit/theme.js';

const ESC = String.fromCharCode(27);
const base: ActivityReport = {source: 'dev', id: 'test', label: 'dev', state: 'running'};

test('readActivity accepts a valid report and sanitizes the texts', () => {
	const r = readActivity({source: 'dev', id: 'run:1', label: `te${ESC}[31mst\n`, state: 'ok', done: 3, total: 10, detail: 'x'.repeat(200)});
	assert.ok(r);
	assert.equal(r.label, 'test');
	assert.equal(r.done, 3);
	assert.equal(r.total, 10);
	assert.ok((r.detail ?? '').length <= 60);
	assert.equal(JSON.stringify(r).includes(ESC), false);
});

test('readActivity rejects bad ids, states, labels and non-objects', () => {
	for (const bad of [null, 'x', 5, [], {}, {...base, source: 'Dev'}, {...base, id: '1x'}, {...base, id: 'a b'}, {...base, source: 'a'.repeat(65)}, {...base, state: 'weird'}, {...base, label: ''}, {...base, label: 4}]) {
		assert.equal(readActivity(bad), undefined, JSON.stringify(bad));
	}
});

test('readActivity drops counts that are not finite integers in range with done <= total', () => {
	for (const counts of [{done: 5, total: 3}, {done: -1, total: 3}, {done: 1.5, total: 3}, {done: NaN, total: 3}, {done: 1, total: Infinity}, {done: 1, total: 2e9}, {done: 1}, {total: 1}, {done: '1', total: '2'}]) {
		const r = readActivity({...base, ...counts});
		assert.ok(r);
		assert.equal(r.done, undefined, JSON.stringify(counts));
		assert.equal(r.total, undefined, JSON.stringify(counts));
	}
	assert.equal(readActivity({...base, done: 0, total: 0})?.total, 0);
});

test('reportActivity emits on the topic and never throws', () => {
	const seen: [string, unknown][] = [];
	const bus: EventBus = {emit: (t, p) => void seen.push([t, p]), on: () => () => {}};
	reportActivity(bus, base);
	assert.deepEqual(seen, [[ACTIVITY_TOPIC, base]]);
	reportActivity(undefined, base);
	reportActivity({emit: () => { throw new Error('boom'); }, on: () => () => {}}, base);
});

test('finished items flash for ACTIVITY_FLASH_MS, gone removes at once', () => {
	let feed: ActivityFeed = applyActivity(EMPTY_ACTIVITY, base, 0);
	assert.equal(visibleActivity(feed, 1000).length, 1);
	assert.equal(nextActivityChange(feed, 1000), ACTIVITY_STALE_MS - 1000);
	feed = applyActivity(feed, {...base, state: 'ok'}, 1000);
	assert.equal(feed.items.length, 1);
	assert.equal(visibleActivity(feed, 1000 + ACTIVITY_FLASH_MS - 1).length, 1);
	assert.equal(visibleActivity(feed, 1000 + ACTIVITY_FLASH_MS).length, 0);
	assert.equal(nextActivityChange(feed, 1000 + 100), ACTIVITY_FLASH_MS - 100);
	assert.equal(nextActivityChange(feed, 1000 + ACTIVITY_FLASH_MS), undefined);
	feed = applyActivity(feed, {...base, state: 'gone'}, 1500);
	assert.equal(feed.items.length, 0);
	assert.equal(applyActivity(EMPTY_ACTIVITY, {...base, state: 'gone'}, 0), EMPTY_ACTIVITY);
});

test('a running item without a report goes stale, a report refreshes it', () => {
	const feed = applyActivity(EMPTY_ACTIVITY, base, 0);
	assert.equal(visibleActivity(feed, ACTIVITY_STALE_MS - 1).length, 1);
	assert.equal(visibleActivity(feed, ACTIVITY_STALE_MS).length, 0);
	const fresh = applyActivity(feed, {...base, done: 1, total: 2}, ACTIVITY_STALE_MS - 1);
	assert.equal(visibleActivity(fresh, ACTIVITY_STALE_MS + 5).length, 1);
});

test('the key is source and id; the same key keeps its place', () => {
	let feed = applyActivity(EMPTY_ACTIVITY, base, 0);
	feed = applyActivity(feed, {...base, source: 'chat'}, 0);
	feed = applyActivity(feed, {...base, label: 'again'}, 1);
	assert.deepEqual(feed.items.map(i => `${i.key}:${i.label}`), ['dev:test:again', 'chat:test:dev']);
});

test('at most ACTIVITY_MAX_ITEMS items; the oldest finished item is dropped first', () => {
	let feed = EMPTY_ACTIVITY;
	feed = applyActivity(feed, {...base, id: 'first'}, 0);
	feed = applyActivity(feed, {...base, id: 'done', state: 'ok'}, 0);
	for (let i = 0; i < ACTIVITY_MAX_ITEMS - 2; i++) feed = applyActivity(feed, {...base, id: `r${i}`}, 0);
	assert.equal(feed.items.length, ACTIVITY_MAX_ITEMS);
	feed = applyActivity(feed, {...base, id: 'extra'}, 0);
	assert.equal(feed.items.length, ACTIVITY_MAX_ITEMS);
	assert.equal(feed.items.some(i => i.id === 'done'), false);
	assert.equal(feed.items.some(i => i.id === 'first'), true);
	for (let i = 0; i < 20; i++) feed = applyActivity(feed, {...base, id: `more${i}`}, 0);
	assert.equal(feed.items.length, ACTIVITY_MAX_ITEMS);
});

const items: ActivityReport[] = [
	{source: 'dev', id: 'test', label: 'dev', state: 'running', done: 120, total: 340, detail: 'core'},
	{source: 'scheduler', id: 'nightly', label: 'nightly', state: 'ok'},
	{source: 'chat', id: 'main', label: 'chat', state: 'failed'},
	{source: 'chat', id: 'b', label: 'other', state: 'cancelled'},
];

test('activityRow fits the width at every size and is empty without items', () => {
	assert.equal(activityRow([], 40, {frame: 0}), '');
	for (const depth of ['truecolor', '16', 'none'] as const) {
		for (const width of [1, 3, 10, 28, 40, 80]) {
			for (const ascii of [false, true]) {
				const row = activityRow(items, width, {frame: 2, depth, ascii});
				assert.ok(styledCells(row) <= width, `${depth} ${width} ${ascii}: ${styledCells(row)}`);
			}
		}
	}
});

test('activityRow marks each state and drops the detail and counts when narrow', () => {
	const wide = stripStyles(activityRow(items, 200, {frame: 0, depth: 'none'}));
	assert.match(wide, /⠋ dev 120\/340 core/);
	assert.match(wide, /✓ nightly/);
	assert.match(wide, /✗ chat/);
	assert.match(wide, /· other/);
	const mid = stripStyles(activityRow(items.slice(0, 1), 12, {frame: 0, depth: 'none'}));
	assert.match(mid, /^⠋ dev/);
	assert.doesNotMatch(mid, /core/);
});

test('activityRow has no escape codes without colours and uses ASCII marks on request', () => {
	const none = activityRow(items, 200, {frame: 1, depth: 'none'});
	assert.equal(none.replaceAll(`${ESC}[2m`, '').replaceAll(`${ESC}[0m`, '').includes(ESC), false, 'only dim and reset remain');
	const ascii = activityRow(items, 200, {frame: 1, depth: 'none', ascii: true});
	assert.match(ascii, /^\/ dev/);
	assert.match(ascii, /v nightly/);
	assert.match(ascii, /x chat/);
	withColorDepth('truecolor', () => assert.ok(activityRow(items, 200, {frame: 0}).includes(ESC)));
});
