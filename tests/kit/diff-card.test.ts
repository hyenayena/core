import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	SIDE_BY_SIDE_MIN_WIDTH,
	fileKindGlyph,
	prepareDiffCard,
	renderDiffCard,
	stripStyles,
	styledCells,
	type CodeToken,
	type DiffCard,
	type DiffCardRow,
	type DiffHighlighter,
	type PrepareOptions,
} from '../../src/kit/text.js';
import {withColorDepth} from '../../src/kit/theme.js';

const ESC = String.fromCharCode(27);

const editRows: DiffCardRow[] = [
	{kind: 'ctx', text: 'function total(items) {', oldNo: 10, newNo: 10},
	{kind: 'del', text: '\tconst sum = items.length + 1;', oldNo: 11},
	{kind: 'add', text: '\tconst sum = items.length + 2;', newNo: 11},
	{kind: 'add', text: '\tconst extra = 3;', newNo: 12},
	{kind: 'ctx', text: '\treturn sum;', oldNo: 12, newNo: 13},
	{kind: 'fold', count: 24},
	{kind: 'ctx', text: '}', oldNo: 40, newNo: 41},
];

const edit: DiffCard = {path: 'src/app/total.ts', tool: 'Edit', added: 2, removed: 1, rows: editRows};

const render = (card: DiffCard, width: number, depth: 'truecolor' | '256' | '16' | 'none', extra: object = {}, prep: PrepareOptions = {}) =>
	withColorDepth(depth, () => renderDiffCard(prepareDiffCard(card, prep), {width, depth, ...extra}));

test('unified rows never exceed the width, at several widths and depths', () => {
	for (const width of [20, 40, 80, 120]) {
		for (const depth of ['truecolor', '256', '16', 'none'] as const) {
			for (const row of render(edit, width, depth, {lead: '● Edit'})) assert.ok(styledCells(row) <= width, `${width} ${depth}: ${stripStyles(row)}`);
		}
	}
});

test('split rows never exceed the width at 159 and 200', () => {
	for (const width of [SIDE_BY_SIDE_MIN_WIDTH, 200]) {
		const rows = render(edit, width, 'truecolor');
		for (const row of rows) assert.ok(styledCells(row) <= width, stripStyles(row));
		assert.ok(rows.some(r => stripStyles(r).includes('│') && stripStyles(r).split('│').length >= 3));
	}
});

test('auto layout is unified below 159 and split from 159', () => {
	const below = render(edit, 158, 'none').map(stripStyles);
	assert.ok(below.every(r => r.split('│').length <= 2));
	const at = render(edit, 159, 'none').map(stripStyles);
	assert.ok(at.some(r => r.split('│').length === 3));
	assert.ok(render(edit, 200, 'none', {layout: 'unified'}).map(stripStyles).every(r => r.split('│').length <= 2));
});

test('header: lead, glyph, path with muted dir and bold name, counts, new-file badge', () => {
	const head = render(edit, 80, 'none', {lead: '● Edit'})[0]!;
	assert.equal(stripStyles(head), '● Edit  ◇ src/app/total.ts  +2 −1');
	const created = render({...edit, created: true, rows: [{kind: 'add', text: 'x', newNo: 1}]}, 80, 'none')[0]!;
	assert.match(stripStyles(created), /new file$/);
	assert.equal(render(edit, 80, 'none', {header: false}).length, render(edit, 80, 'none').length - 1);
	assert.match(stripStyles(render(edit, 80, 'none', {ascii: true})[0]!), /^\* src\/app\/total\.ts {2}\+2 -1$/);
});

test('a long path keeps the file name and cuts the directory from the left', () => {
	const card = {...edit, path: 'a/very/long/directory/chain/that/does/not/fit/in/the/header/total.ts'};
	const head = stripStyles(render(card, 40, 'none', {lead: '● Edit'})[0]!);
	assert.ok(styledCells(head) <= 40);
	assert.match(head, /…[^ ]*total\.ts/);
	assert.match(head, /\+2 −1/);
});

test('two gutters from width 60, one below', () => {
	const wide = render(edit, 80, 'none').map(stripStyles);
	assert.match(wide[1]!, /│ 10 10 {3}function/);
	assert.match(wide[2]!, /11 {4}- /);
	assert.match(wide[3]!, / {3}11 \+ /);
	const narrow = render(edit, 59, 'none').map(stripStyles);
	assert.match(narrow[1]!, /^ {2}│ 10 {3}function/);
	assert.match(narrow[2]!, /│ 11 - /);
	assert.match(narrow[3]!, /│ 11 \+ /);
});

test('fold rows carry the count, long context runs fold and keep three each side', () => {
	const rows = render(edit, 80, 'none').map(stripStyles);
	assert.ok(rows.some(r => r.includes('⋯ 24 unchanged lines')));
	const ctx = Array.from({length: 20}, (_v, i): DiffCardRow => ({kind: 'ctx', text: `line ${i}`, oldNo: i + 1, newNo: i + 1}));
	const out = render({path: 'a.txt', added: 0, removed: 0, rows: ctx}, 80, 'none').map(stripStyles);
	assert.equal(out.filter(r => r.includes('unchanged')).length, 1);
	assert.ok(out.some(r => r.includes('⋯ 14 unchanged lines')));
	assert.equal(out.length, 1 + 3 + 1 + 3);
	const one = render({path: 'a.txt', added: 0, removed: 0, rows: [{kind: 'fold', count: 1}, {kind: 'fold', text: '... 5 unchanged lines'}, {kind: 'fold'}]}, 80, 'none').map(stripStyles);
	assert.match(one[1]!, /⋯ 1 unchanged line$/);
	assert.match(one[2]!, /⋯ \.\.\. 5 unchanged lines$/);
	assert.match(one[3]!, /⋯ unchanged lines$/);
});

test('cap keeps the head and the tail and counts the hidden rows', () => {
	const rows: DiffCardRow[] = Array.from({length: 100}, (_v, i) => ({kind: 'add', text: `l${i}`, newNo: i + 1}));
	const out = render({path: 'a.txt', added: 100, removed: 0, rows}, 80, 'none', {maxRows: 40}).map(stripStyles);
	assert.equal(out.length, 1 + 40);
	assert.match(out[32]!, /… \+61 lines \(ctrl\+o to expand\)$/);
	assert.match(out[33]!, /l92$/);
	assert.match(out[40]!, /l99$/);
	const full = render({path: 'a.txt', added: 100, removed: 0, rows}, 80, 'none');
	assert.equal(full.length, 101);
});

test('plain (created) rows: no sign, no tint, new-number gutter, notes muted', () => {
	const card: DiffCard = {
		path: 'new.ts',
		added: 3,
		removed: 0,
		created: true,
		rows: [
			{kind: 'add', text: 'const a = 1;', newNo: 1},
			{kind: 'add', text: 'const b = 2;', newNo: 2},
			{kind: 'note', text: '… +1 lines (ctrl+o to expand)'},
		],
	};
	const rows = render(card, 80, 'truecolor');
	assert.ok(rows.slice(1).every(r => !r.includes('48;2;')));
	const text = rows.map(stripStyles);
	assert.match(text[1]!, /^ {2}│ 1 const a = 1;$/);
	assert.match(text[3]!, /… \+1 lines \(ctrl\+o to expand\)$/);
	assert.ok(render(card, 200, 'none').slice(1).every(r => r.split('│').length === 2));
});

test('truecolor: tinted rows are padded to the full width with the background, words get their own tint', () => {
	const rows = render(edit, 80, 'truecolor');
	const del = rows[2]!;
	const add = rows[3]!;
	assert.equal(styledCells(del), 80);
	assert.equal(styledCells(add), 80);
	assert.ok(del.includes('48;2;74;31;36'));
	assert.ok(add.includes('48;2;31;58;36'));
	assert.ok(del.includes('48;2;122;46;54'), 'removed word tint');
	assert.ok(add.includes('48;2;47;107;58'), 'added word tint');
	assert.ok(!rows[1]!.includes('48;2;'));
	assert.ok(rows.every(r => !r.includes(`${ESC}[0;m`)));
});

test('word tint covers only the changed token', () => {
	const del = render(edit, 80, 'truecolor')[2]!;
	const marked = del.split(`${ESC}[`).filter(p => p.includes('48;2;122;46;54')).map(p => stripStyles(`${ESC}[${p}`));
	assert.deepEqual(marked.map(m => m.replace(/\s+$/, '')), ['1']);
});

test('16 colours: no background and no syntax tones; the row foreground carries add/remove', () => {
	const hl: DiffHighlighter = lines => lines.map(l => [{text: l, tone: 'code.keyword'}]);
	const rows = render(edit, 80, '16', {}, {highlight: hl});
	assert.ok(rows.every(r => !/\b48;/.test(r)));
	assert.ok(rows.every(r => !r.includes('38;')));
	assert.ok(rows[3]!.includes(`${ESC}[32m`) || rows[3]!.includes(`${ESC}[0;32m`));
	assert.ok(rows[2]!.includes('31'));
	assert.match(stripStyles(rows[2]!), /- /);
	assert.match(stripStyles(rows[3]!), /\+ /);
});

test('none: no colour parameters, signs present, attributes only', () => {
	const rows = render(edit, 80, 'none', {}, {highlight: lines => lines.map(l => [{text: l, tone: 'code.keyword'}])});
	for (const r of rows) {
		for (const m of r.matchAll(new RegExp(`${ESC}\\[([0-9;]*)m`, 'g'))) {
			for (const p of m[1]!.split(';')) assert.ok(['', '0', '1', '2', '4', '7', '22'].includes(p), `param ${p}`);
		}
	}
	assert.match(stripStyles(rows[2]!), / - /);
	assert.match(stripStyles(rows[3]!), / \+ /);
	assert.ok(rows[3]!.includes(`${ESC}[1;4m`), 'added word underline+bold');
	assert.ok(rows[2]!.includes(`${ESC}[7m`), 'removed word inverse');
});

test('a highlighter paints tones at truecolor and 256, per block with ctx from the new side', () => {
	const calls: string[][] = [];
	const hl: DiffHighlighter = lines => {
		calls.push([...lines]);
		return lines.map((l): CodeToken[] => {
			const i = l.indexOf('const');
			return i < 0 ? [{text: l}] : [{text: l.slice(0, i)}, {text: 'const', tone: 'code.keyword'}, {text: l.slice(i + 5)}];
		});
	};
	const rows = render(edit, 80, 'truecolor', {}, {highlight: hl});
	assert.ok(rows[2]!.includes('38;2;198;120;221'));
	assert.ok(rows[3]!.includes('38;2;198;120;221'));
	assert.equal(calls.length, 3);
	assert.deepEqual(calls[0], ['function total(items) {', '    const sum = items.length + 2;', '    const extra = 3;', '    return sum;']);
	assert.deepEqual(calls[1], ['function total(items) {', '    const sum = items.length + 1;', '    return sum;']);
	assert.deepEqual(calls[2], ['}']);
	const r256 = render(edit, 80, '256', {}, {highlight: hl});
	assert.ok(r256[3]!.includes('38;5;170'));
	assert.ok(r256[3]!.includes('48;5;22'));
});

test('a throwing, mismatching or oversized highlighter leaves the text plain', () => {
	const plain = render(edit, 80, 'truecolor').map(stripStyles);
	for (const hl of [
		(() => {
			throw new Error('boom');
		}) as DiffHighlighter,
		(() => []) as DiffHighlighter,
		(lines => lines.map(() => [{text: 'tampered', tone: 'code.keyword'}])) as DiffHighlighter,
		(() => undefined) as DiffHighlighter,
	]) {
		const rows = render(edit, 80, 'truecolor', {}, {highlight: hl});
		assert.deepEqual(rows.map(stripStyles), plain);
		assert.ok(rows.every(r => !r.includes('38;2;198')));
	}
	let called = 0;
	const big: DiffCard = {path: 'a.ts', added: 1, removed: 0, rows: [{kind: 'add', text: 'x'.repeat(1001), newNo: 1}]};
	render(big, 80, 'truecolor', {}, {highlight: lines => (called++, lines.map(l => [{text: l}]))});
	assert.equal(called, 0);
});

test('continuation rows keep a blank gutter and the line background', () => {
	const card: DiffCard = {path: 'a.ts', added: 1, removed: 0, rows: [{kind: 'add', text: 'abcdefghij'.repeat(10), newNo: 5}]};
	const rows = render(card, 40, 'truecolor');
	assert.ok(rows.length >= 4);
	for (const r of rows.slice(1)) {
		assert.equal(styledCells(r), 40);
		assert.ok(r.includes('48;2;31;58;36'));
	}
	assert.match(stripStyles(rows[2]!), /^ {2}│ {5}[a-j]+$/);
	assert.equal(stripStyles(rows.slice(1).join('')).replace(/[^a-j]/g, '').length, 100);
});

test('split: each half wraps on its own and uneven runs leave the short side blank', () => {
	const card: DiffCard = {
		path: 'a.ts',
		added: 1,
		removed: 2,
		rows: [
			{kind: 'del', text: 'one', oldNo: 1},
			{kind: 'del', text: 'two', oldNo: 2},
			{kind: 'add', text: 'x'.repeat(200), newNo: 1},
		],
	};
	const rows = render(card, 160, 'none');
	for (const r of rows) assert.ok(styledCells(r) <= 160);
	const text = rows.slice(1).map(stripStyles);
	assert.ok(text.length >= 3);
	assert.match(text[0]!, /- one.*│.*\+ x/);
	assert.match(text.find(r => r.includes('- two'))!, /- two\s+│\s*$/);
});

test('scrubbing: control characters and escapes in text and path never reach the output', () => {
	const evil = `a${ESC}[2Jb${ESC}]0;t\u0007c‮d`;
	const card: DiffCard = {path: `dir/${evil}.ts`, added: 1, removed: 0, rows: [{kind: 'add', text: evil, newNo: 1}, {kind: 'note', text: evil}, {kind: 'fold', text: evil}]};
	for (const depth of ['truecolor', 'none'] as const) {
		for (const row of render(card, 80, depth)) {
			assert.ok(!row.includes(`${ESC}[2J`));
			assert.ok(!row.includes(`${ESC}]`));
			assert.ok(!row.includes('‮'));
			assert.ok(!row.includes('\u0007'));
		}
	}
});

test('fileKindGlyph by extension and name', () => {
	assert.equal(fileKindGlyph('src/a.ts'), 'fileCode');
	assert.equal(fileKindGlyph('README.md'), 'fileDoc');
	assert.equal(fileKindGlyph('package.json'), 'fileData');
	assert.equal(fileKindGlyph('bin/install.sh'), 'fileShell');
	assert.equal(fileKindGlyph('Dockerfile'), 'fileShell');
	assert.equal(fileKindGlyph('image.png'), 'fileOther');
	assert.equal(fileKindGlyph('LICENSE'), 'fileOther');
});
