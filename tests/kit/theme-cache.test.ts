import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, after} from 'node:test';
import {colorDepth, resetColorDepthCacheForTests, setColorsEnabled, sgrTable, withColorDepth} from '../../src/kit/theme.js';
import {loadPrefs, setPrefs} from '../../src/view/prefs.js';

const KEYS = ['NO_COLOR', 'YENA_COLOR', 'COLORTERM', 'TERM'];
const dir = mkdtempSync(join(tmpdir(), 'core-theme-cache-'));
after(() => rmSync(dir, {recursive: true, force: true}));

function countEnv<T>(fn: () => T): {reads: Map<string, number>; result: T} {
	const reads = new Map<string, number>();
	const real = process.env;
	process.env = new Proxy(real, {
		get(target, key, receiver) {
			if (typeof key === 'string' && KEYS.includes(key)) reads.set(key, (reads.get(key) ?? 0) + 1);
			return Reflect.get(target, key, receiver);
		},
	});
	try {
		return {reads, result: fn()};
	} finally {
		process.env = real;
	}
}

test('the environment is read at most once per key, however often the depth is asked', () => {
	resetColorDepthCacheForTests();
	const {reads} = countEnv(() => {
		for (let i = 0; i < 10000; i++) {
			colorDepth();
			sgrTable();
		}
	});
	for (const k of KEYS) assert.ok((reads.get(k) ?? 0) <= 1, `${k} read ${reads.get(k)} times`);
});

test('colours on/off and overrides are read live without a new environment read', () => {
	resetColorDepthCacheForTests();
	colorDepth();
	const {reads, result} = countEnv(() => {
		const out: string[] = [];
		setColorsEnabled(false);
		out.push(colorDepth());
		setColorsEnabled(true);
		out.push(colorDepth());
		out.push(withColorDepth('16', () => withColorDepth('truecolor', () => colorDepth())));
		return out;
	});
	assert.equal(result[0], 'none');
	assert.notEqual(result[1], 'none');
	assert.equal(result[2], 'truecolor');
	assert.equal(reads.size, 0);
});

test('an override is restored after a throw and sgrTable returns the same object per depth', () => {
	resetColorDepthCacheForTests();
	const before = colorDepth();
	assert.throws(() => withColorDepth('16', () => {
		throw new Error('x');
	}));
	assert.equal(colorDepth(), before);
	assert.equal(sgrTable('256'), sgrTable('256'));
	assert.notEqual(sgrTable('256'), sgrTable('16'));
});

test('turning colours off in the prefs gives none', () => {
	resetColorDepthCacheForTests();
	loadPrefs(dir);
	setPrefs({colors: false});
	assert.equal(colorDepth(), 'none');
	setPrefs({colors: true});
	assert.notEqual(colorDepth(), 'none');
	resetColorDepthCacheForTests();
});
