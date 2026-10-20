import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {loadPrefs, getPrefs, setPrefs, subscribePrefs} from '../src/view/prefs.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'core-prefs-mouse-'));

test('mouse is on when the key is missing', () => {
	const dir = tempDir();
	assert.equal(loadPrefs(dir).mouse, true);
	writeFileSync(join(dir, 'appearance.json'), '{"titleBar":"blue","colors":false}');
	const prefs = loadPrefs(dir);
	assert.equal(prefs.mouse, true);
	assert.equal(prefs.titleBar, 'blue');
});

test('an invalid mouse value falls back to on', () => {
	const dir = tempDir();
	for (const raw of ['"off"', '0', 'null', '[]']) {
		writeFileSync(join(dir, 'appearance.json'), `{"mouse":${raw}}`);
		assert.equal(loadPrefs(dir).mouse, true, raw);
	}
});

test('mouse off is saved, notifies listeners and survives a reload', () => {
	const dir = tempDir();
	loadPrefs(dir);
	let calls = 0;
	const off = subscribePrefs(() => calls++);
	setPrefs({mouse: false});
	off();
	assert.equal(calls, 1);
	assert.equal(getPrefs().mouse, false);
	assert.equal(JSON.parse(readFileSync(join(dir, 'appearance.json'), 'utf8')).mouse, false);
	assert.equal(loadPrefs(dir).mouse, false);
	setPrefs({mouse: true});
	assert.equal(loadPrefs(dir).mouse, true);
});
