import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createRegistry} from '../src/commands.js';
import {loadPrefs, getPrefs, setPrefs, subscribePrefs} from '../src/view/prefs.js';
import {collectSettingsTabs} from '../src/view/settings-tabs.js';

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

test('the Appearance tab offers Mouse On/Off bound to the preference', () => {
	const dir = tempDir();
	loadPrefs(dir);
	const tabs = collectSettingsTabs(createRegistry([]).commands);
	const appearance = tabs.find(t => t.title === 'Appearance');
	const mouse = appearance?.settings.find(s => s.key === 'mouse');
	assert.ok(mouse, 'the Mouse setting survives settings validation');
	assert.equal(mouse.label, 'Mouse');
	assert.deepEqual(mouse.options.map(o => o.value), ['on', 'off']);
	assert.equal(mouse.get(), 'on');
	mouse.set('off');
	assert.equal(getPrefs().mouse, false);
	assert.equal(mouse.get(), 'off');
	assert.equal(loadPrefs(dir).mouse, false);
	mouse.set('on');
	assert.equal(getPrefs().mouse, true);
	assert.equal(mouse.get(), 'on');
});
