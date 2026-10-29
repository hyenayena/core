import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createRegistry, settingsTabs} from '../src/commands.js';
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

test('agentCommands defaults to policy, rejects unknown values and round-trips', () => {
	const dir = tempDir();
	assert.equal(loadPrefs(dir).agentCommands, 'policy');
	writeFileSync(join(dir, 'appearance.json'), '{"agentCommands":"always"}');
	assert.equal(loadPrefs(dir).agentCommands, 'policy');
	setPrefs({agentCommands: 'off'});
	assert.equal(loadPrefs(dir).agentCommands, 'off');
	setPrefs({agentCommands: 'policy'});
});

test('settings offers an Assistant tab bound to agentCommands', () => {
	const dir = tempDir();
	loadPrefs(dir);
	const tab = settingsTabs(createRegistry([]).commands).find(t => t.title === 'Assistant');
	const setting = tab?.settings.find(s => s.key === 'agentCommands');
	assert.ok(setting);
	assert.deepEqual(setting.options.map(o => o.value), ['policy', 'ask', 'off']);
	assert.equal(setting.get(), 'policy');
	setting.set('ask');
	assert.equal(getPrefs().agentCommands, 'ask');
	setting.set('policy');
});

test('panelShare keeps a saved value between 0.1 and 0.9 and drops anything else', () => {
	const dir = tempDir();
	assert.equal(loadPrefs(dir).panelShare, 0.4);
	for (const [raw, want] of [['0.25', 0.25], ['0.05', 0.4], ['0.95', 0.4], ['"0.3"', 0.4], ['null', 0.4]] as const) {
		writeFileSync(join(dir, 'appearance.json'), `{"panelShare":${raw}}`);
		assert.equal(loadPrefs(dir).panelShare, want, raw);
	}
});

test('settings tabs are sorted by title', () => {
	const tab = (title: string) => ({
		name: title.toLowerCase(),
		description: '',
		run: () => {},
		settings: {title, settings: [{key: 'k', label: 'K', options: [{value: 'a', label: 'A'}], get: () => 'a', set: () => {}}]},
	});
	const tabs = collectSettingsTabs([tab('Yena'), tab('appearance'), tab('Claude')]);
	assert.deepEqual(tabs.map(t => t.title), ['appearance', 'Claude', 'Yena']);
});
