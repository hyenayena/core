import test from 'node:test';
import assert from 'node:assert/strict';
import {WHEEL_ROWS, areaAt, inside, toLocal, wheelDelta, type Rect} from '../../src/mouse/hit.js';
import type {MouseInputEvent} from '../../src/mouse/sgr.js';

const rect: Rect = {x: 60, y: 0, width: 40, height: 30};

const event = (patch: Partial<MouseInputEvent>): MouseInputEvent => ({
	kind: 'press',
	button: 'left',
	x: 0,
	y: 0,
	shift: false,
	meta: false,
	ctrl: false,
	...patch,
});

test('inside is half-open on both axes', () => {
	assert.equal(inside(rect, 60, 0), true);
	assert.equal(inside(rect, 99, 29), true);
	assert.equal(inside(rect, 59, 0), false);
	assert.equal(inside(rect, 100, 0), false);
	assert.equal(inside(rect, 60, 30), false);
	assert.equal(inside({x: 0, y: 0, width: 0, height: 0}, 0, 0), false);
});

test('toLocal subtracts the rect origin', () => {
	assert.deepEqual(toLocal(rect, 65, 3), {x: 5, y: 3});
});

test('without a main view everything is the console', () => {
	assert.equal(areaAt({x: 0, y: 0}, {side: false, panelOpen: false, split: false}), 'panel');
	assert.equal(areaAt({x: 70, y: 5}, {side: false, panelOpen: true, split: true, panelRect: rect}), 'panel');
});

test('a main view with the console closed owns the screen', () => {
	assert.equal(areaAt({x: 70, y: 5}, {side: true, panelOpen: false, split: false}), 'main');
});

test('an open console that is not split covers everything', () => {
	assert.equal(areaAt({x: 0, y: 0}, {side: true, panelOpen: true, split: false}), 'panel');
});

test('a split layout picks the area under the pointer', () => {
	const layout = {side: true, panelOpen: true, split: true, panelRect: rect};
	assert.equal(areaAt({x: 59, y: 5}, layout), 'main');
	assert.equal(areaAt({x: 60, y: 5}, layout), 'panel');
	assert.equal(areaAt({x: 99, y: 29}, layout), 'panel');
	assert.equal(areaAt({x: 70, y: 5}, {side: true, panelOpen: true, split: true}), 'main', 'no measured panel');
});

test('wheelDelta scrolls one row per event and ignores other events', () => {
	assert.equal(WHEEL_ROWS, 1);
	assert.equal(wheelDelta(event({kind: 'wheel', button: 'none', wheel: 'up'})), 1);
	assert.equal(wheelDelta(event({kind: 'wheel', button: 'none', wheel: 'down'})), -1);
	assert.equal(wheelDelta(event({kind: 'wheel', button: 'none'})), 0);
	assert.equal(wheelDelta(event({})), 0);
	assert.equal(wheelDelta(event({kind: 'release', button: 'none'})), 0);
});
