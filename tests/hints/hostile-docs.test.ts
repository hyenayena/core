import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCatalog} from '../../src/hints/catalog.js';
import {helpError, helpLines} from '../../src/hints/help.js';
import {layoutHints} from '../../src/hints/layout.js';
import {computeHints} from '../../src/hints/model.js';
import {stringCells} from '../../src/hints/width.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const evil = `a${ESC}[31mred${ESC}]0;title${BEL}‮\u0085x`;
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u202e]');

const loop: Record<string, unknown> = {name: 'loop', usage: 'h loop', description: 'd', subcommands: []};
(loop['subcommands'] as unknown[]).push(loop);

const hostile = buildCatalog([
	{
		name: 'h',
		description: evil,
		usage: `h <${evil}> [--x ${evil}]…`,
		agent: 'safe',
		args: [
			{name: 'ok', description: evil},
			{name: 5, description: {}},
			null,
			'text',
			{
				get name(): string {
					throw new Error('boom');
				},
			},
			{name: 'big', description: 'z'.repeat(100_000)},
		],
		options: [
			{name: '--a', aliases: ['-a', 7, evil], value: evil, description: evil},
			{
				name: '--b',
				get description(): string {
					throw new Error('boom');
				},
			},
			{name: 'plain'},
			{name: `--${'n'.repeat(500)}`},
		],
		notes: [evil, 'n'.repeat(100_000), 5, null, ...Array.from({length: 5000}, (_, i) => `note ${i}`)],
		subcommands: [
			loop,
			{name: 'ok', usage: evil, description: evil, agent: 'bogus', aliases: [evil, 'x', 3], args: 'no', options: {length: 3}, notes: 7},
			{
				get name(): string {
					throw new Error('boom');
				},
			},
			{name: 'help', usage: 'h help', description: 'mine', agent: 'deny'},
		],
	},
]);

test('hostile docs never throw and are sanitised and capped in the catalog', () => {
	const h = hostile.byName.get('h')!;
	assert.deepEqual(h.args.map(a => a.name), ['ok', 'big']);
	assert.deepEqual(h.options.map(o => o.name), ['--a', '--b']);
	assert.ok(h.notes.length <= 40);
	for (const text of [h.description, ...h.args.map(a => a.description), ...h.options.map(o => o.description), ...h.notes]) {
		assert.ok(text.length <= 200);
		assert.equal(CONTROL.test(text), false);
	}
	const ok = h.subs.find(s => s.name === 'ok')!;
	assert.equal(ok.agent, 'confirm');
	assert.deepEqual(ok.args, []);
	assert.deepEqual(ok.options, []);
	assert.deepEqual(ok.notes, []);
	assert.deepEqual(h.subs.find(s => s.name === 'help')!.agent, 'deny');
	assert.equal(h.subs.some(s => s.builtin), false);
});

test('help of hostile nodes has no control characters and bounded lines', () => {
	for (const path of [['h'], ['h', 'ok'], ['h', 'loop'], ['h', 'loop', 'loop'], ['h', 'help']]) {
		assert.equal(helpError(hostile, path), undefined, path.join(' '));
		const lines = helpLines(hostile, path);
		assert.ok(lines.length < 100, path.join(' '));
		for (const line of lines) {
			assert.equal(CONTROL.test(line), false, path.join(' '));
			assert.ok(stringCells(line) < 400, path.join(' '));
		}
	}
});

test('hint rows of hostile docs stay clean and shorter than the terminal width', () => {
	for (const line of ['h', 'h ', 'h o', 'h ok ', 'h ok x ', 'h -', 'h --', 'h --a ', 'h loop ', 'h help ', 'h x y z -a ']) {
		const hints = computeHints(hostile, line);
		for (const columns of [8, 21, 40, 100]) {
			for (const row of layoutHints(hints, {sel: 0, color: false}, {columns, rows: 24})) {
				const text = row.segments.map(s => s.text).join('');
				assert.equal(CONTROL.test(text), false, `${line} @${columns}`);
				assert.ok(stringCells(text) < columns, `${line} @${columns}: ${text}`);
			}
		}
	}
});
