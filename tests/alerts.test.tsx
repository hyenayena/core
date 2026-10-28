import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Text} from 'ink';
import App, {alertLines} from '../src/app.js';
import {createRegistry} from '../src/commands.js';
import {mountHarness} from './testkit.js';
import type {Command} from '../../../src/api.js';

const ESC = String.fromCharCode(27);
const ALERT = {text: 'Dev mode: /workplace/yena failed to start, running the image. Run fix to repair it.', detail: 'exited with code 5 before it was ready'};

test('alertLines sanitizes, caps and skips bad entries', () => {
	const lines = alertLines([{text: `red ${ESC}[31mtext${ESC}[0m`, detail: 'x'.repeat(1000)}, {text: 3}, null, 'nope']);
	assert.equal(lines.length, 2);
	assert.equal(lines[0]!.text, '! red text');
	assert.ok(lines[1]!.text.length <= 302);
	assert.deepEqual(alertLines(undefined), []);
	assert.equal(alertLines(Array.from({length: 9}, () => ({text: 'a'}))).length, 5);
});

test('the UI shows the startup alert under the welcome hint', async () => {
	const h = mountHarness(<App registry={createRegistry([])} alerts={[ALERT]} />, {columns: 140, rows: 30});
	await h.settle();
	assert.match(h.lastFrame(), /! Dev mode: \/workplace\/yena failed to start, running the image\. Run fix to repair it\./);
	assert.match(h.lastFrame(), /exited with code 5 before it was ready/);
	h.unmount();
});

test('the alert stays when a main view clears the transcript', async () => {
	const commands: Command[] = [{name: 'view', description: 'main view', autostart: true, run: (_a, ctx) => void ctx.mount!(() => <Text>MAIN</Text>)}];
	const h = mountHarness(<App registry={createRegistry(commands)} alerts={[ALERT]} />, {columns: 140, rows: 30});
	await h.settle(100);
	assert.match(h.lastFrame(), /MAIN/);
	assert.match(h.lastFrame(), /Run fix to repair it/);
	h.unmount();
});

test('no alerts, no alert lines', async () => {
	const h = mountHarness(<App registry={createRegistry([])} />);
	await h.settle();
	assert.doesNotMatch(h.allOutput(), /^! /m);
	h.unmount();
});
