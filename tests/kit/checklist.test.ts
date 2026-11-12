import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checklistRows, stripStyles, styledCells, type ChecklistItem} from '../../src/kit/text.js';
import {withColorDepth} from '../../src/kit/theme.js';

const ESC = String.fromCharCode(27);
const plain = (rows: string[]): string[] => rows.map(r => stripStyles(r));

const ITEMS: ChecklistItem[] = [
	{text: 'Read the code', state: 'done'},
	{text: 'Write tests', state: 'active'},
	{text: 'Update the docs', state: 'open'},
	{text: 'Ship', state: 'open'},
];

const raw = (o: Partial<Parameters<typeof checklistRows>[0]> = {}): string[] =>
	checklistRows({title: 'Plan', items: ITEMS, width: 60, mode: 'summary', ...o});
const run = (o: Partial<Parameters<typeof checklistRows>[0]> = {}): string[] => plain(raw(o));

test('summary: header, active item with spinner, next open item', () => {
	withColorDepth('none', () => {
		assert.deepEqual(run({spinner: '⠹'}), ['☰ Plan 1/4 ▰▱▱▱', '  ⠹ Write tests', '  ○ Update the docs']);
	});
});
test('summary idle uses the marker instead of the spinner', () => {
	withColorDepth('none', () => {
		assert.equal(run()[1], '  › Write tests');
	});
});
test('summary without an active item shows the next open one only', () => {
	withColorDepth('none', () => {
		const rows = run({items: [{text: 'a', state: 'done'}, {text: 'b', state: 'open'}, {text: 'c', state: 'open'}]});
		assert.deepEqual(rows, ['☰ Plan 1/3 ▰▱▱', '  ○ b']);
	});
});
test('all done: header only, ok meter, done label on the right', () => {
	withColorDepth('none', () => {
		const rows = run({items: [{text: 'a', state: 'done'}, {text: 'b', state: 'done'}], doneLabel: 'done', width: 30});
		assert.equal(rows.length, 1);
		assert.equal(rows[0]!.length, 30);
		assert.ok(rows[0]!.startsWith('☰ Plan 2/2 ▰▰'));
		assert.ok(rows[0]!.endsWith('✓ done'));
	});
	withColorDepth('16', () => {
		const rows = raw({items: [{text: 'a', state: 'done'}], doneLabel: 'done'});
		assert.ok(rows[0]!.includes(ESC));
	});
});
test('flash goes right of the header and is cut to fit', () => {
	withColorDepth('none', () => {
		const rows = run({flash: 'Write all the tests', width: 36});
		assert.ok(styledCells(rows[0]!) <= 36);
		assert.ok(rows[0]!.includes('✓ Write'));
		assert.ok(rows[0]!.endsWith('…'));
	});
});
test('line mode is one row and shortens from the end', () => {
	withColorDepth('none', () => {
		assert.deepEqual(run({mode: 'line', spinner: '⠹', width: 100}), ['☰ Plan 1/4 ▰▱▱▱ · ⠹ Write tests · next: Update the docs']);
		const narrow = run({mode: 'line', width: 30});
		assert.equal(narrow.length, 1);
		assert.ok(styledCells(narrow[0]!) <= 30);
		assert.ok(narrow[0]!.startsWith('☰ Plan 1/4'));
	});
});
test('full mode lists every item when it fits', () => {
	withColorDepth('none', () => {
		assert.deepEqual(run({mode: 'full'}), ['☰ Plan 1/4 ▰▱▱▱', '  ✓ Read the code', '  › Write tests', '  ○ Update the docs', '  ○ Ship']);
	});
});
test('full mode windows around the active item with +N more', () => {
	withColorDepth('none', () => {
		const items: ChecklistItem[] = Array.from({length: 30}, (_, i) => ({text: `step ${i}`, state: i < 15 ? 'done' : i === 15 ? 'active' : 'open'}));
		const rows = run({mode: 'full', items, maxRows: 8});
		assert.equal(rows.length, 8);
		assert.ok(rows.some(r => r.includes('step 15')));
		assert.equal(rows[7], '  … +24 more');
	});
});
test('ascii glyphs', () => {
	withColorDepth('none', () => {
		assert.deepEqual(run({ascii: true, mode: 'full'}).slice(0, 2), ['# Plan 1/4 #---', '  v Read the code']);
		assert.equal(run({ascii: true, mode: 'full'})[3], '  o Update the docs');
	});
});
test('every row fits the width, wide characters included', () => {
	withColorDepth('16', () => {
		const items: ChecklistItem[] = [
			{text: '漢字'.repeat(40), state: 'done'},
			{text: 'x'.repeat(300), state: 'active'},
			{text: '🙂 emoji row', state: 'open'},
		];
		for (const width of [20, 40, 80]) {
			for (const mode of ['line', 'summary', 'full'] as const) {
				for (const row of checklistRows({title: 'Plan', items, width, mode, flash: '漢字'.repeat(30), spinner: '⠹'})) {
					assert.ok(styledCells(row) <= width, `${mode} ${width}: ${styledCells(row)}`);
				}
			}
		}
	});
});
test('colour depth: none is plain, 16 has codes, running and ok tones used', () => {
	withColorDepth('none', () => assert.ok(!/\[[0-9;]*3[0-9]m|38;/.test(raw({spinner: '⠹'}).join(''))));
	withColorDepth('16', () => assert.ok(/\[(9[0-9]|3[0-7])m/.test(raw({spinner: '⠹'}).join(''))));
});
test('hostile text is scrubbed', () => {
	withColorDepth('none', () => {
		const evil = `a${ESC}[31mred\nline${ESC}]0;title\u0007 \u202eevil`;
		const rows = raw({items: [{text: evil, state: 'active'}], title: `T${ESC}[2J`, mode: 'full'});
		for (const row of rows) {
			const bare = row.split(ESC + '[').map((c, i) => (i === 0 ? c : c.replace(/^[0-9;]*m/, ''))).join('');
			assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e]/.test(bare), JSON.stringify(row));
			assert.ok(!row.includes('\n'));
		}
	});
});
test('empty list gives the header only', () => {
	withColorDepth('none', () => assert.deepEqual(run({items: [], mode: 'full'}), ['☰ Plan 0/0']));
});

test('full mode never returns more rows than maxRows', () => {
	for (let total = 1; total <= 8; total++) {
		const items: ChecklistItem[] = Array.from({length: total}, (_, i) => ({text: `Step ${i}`, state: i === 2 ? 'active' : 'open'}));
		for (let maxRows = 1; maxRows <= 6; maxRows++) {
			const rows = checklistRows({title: 'Plan', items, width: 40, mode: 'full', maxRows});
			assert.ok(rows.length <= maxRows, `${total} items, maxRows ${maxRows}: ${rows.length}`);
			if (total >= maxRows && maxRows >= 2) assert.match(stripStyles(rows.at(-1)!), /\+\d+ more/, `${total}/${maxRows}`);
		}
	}
});
