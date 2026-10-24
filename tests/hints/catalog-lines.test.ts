import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCatalog} from '../../src/hints/catalog.js';
import {completionLines} from '../../src/hints/catalog-lines.js';
import type {Command} from '../../../../src/api.js';

const cmd = (name: string, description: string, subs: Array<{name: string; description?: string}> = []): Command =>
	({name, description, run() {}, subcommands: subs.map(s => ({description: '', ...s}))}) as unknown as Command;

test('canonical names and descriptions become tab separated lines', () => {
	const catalog = buildCatalog([cmd('alpha', 'First\tone\x1b[31m', [{name: 'run', description: 'Run it'}]), cmd('bad name', 'x'), cmd('-dash', 'x'), cmd('beta', 'Second')]);
	const lines = completionLines(catalog);
	assert.equal(lines.length, 3);
	assert.equal(lines[1], 'alpha run\tRun it');
	assert.equal(lines[2], 'beta\tSecond');
	assert.match(lines[0]!, /^alpha\tFirst /);
	assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(lines[0]!.split('\t')[1]!));
});

test('descriptions are capped at 80 characters', () => {
	const [line] = completionLines(buildCatalog([cmd('long', 'x'.repeat(500))]));
	assert.ok(line!.split('\t')[1]!.length <= 80);
});

test('command and subcommand counts are capped and bad subcommand names are skipped', () => {
	const many = Array.from({length: 600}, (_, i) => cmd(`c${i}`, 'd'));
	const subs = [{name: 'ok'}, {name: 'bad\tname'}, {name: 'two words'}, ...Array.from({length: 150}, (_, i) => ({name: `s${i}`}))];
	const lines = completionLines(buildCatalog([cmd('first', 'd', subs), ...many]));
	const tops = lines.filter(l => !l.split('\t')[0]!.includes(' '));
	assert.equal(tops.length, 500);
	const firstSubs = lines.filter(l => l.startsWith('first '));
	assert.equal(firstSubs.length, 100);
	assert.ok(firstSubs.every(l => /^first [A-Za-z0-9._-]+\t/.test(l)));
	assert.ok(lines.every(l => l.split('\t').length === 2));
});
