import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareDiffCard, renderDiffCard, stripStyles, styledCells, type DiffCard, type DiffCardRow} from '../../src/kit/text.js';
import {withColorDepth} from '../../src/kit/theme.js';

const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[([0-9;:]*)m`, 'g');

const hostile = [
	'漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字',
	'😀😀😀 emoji 👨‍👩‍👧 family é́ combining',
	`\t\ttabbed\tcolumns\there ${ESC}[31mred${ESC}[0m ${ESC}]0;title\u0007 end`,
	'x'.repeat(500),
];

const OFF: Record<string, string> = {'22': '1', '23': '3', '24': '4', '27': '7', '39': 'fg', '49': 'bg'};

function openStyles(sequences: string[]): string[] {
	const open = new Set<string>();
	for (const seq of sequences) {
		const p = seq === '' ? ['0'] : seq.split(/[;:]/);
		for (let i = 0; i < p.length; i++) {
			const n = p[i] as string;
			if (n === '0') open.clear();
			else if (n === '38' || n === '48') {
				open.add(n === '38' ? 'fg' : 'bg');
				i += p[i + 1] === '5' ? 2 : 4;
			} else if (OFF[n]) open.delete(OFF[n] as string);
			else if (/^(3[0-7]|9[0-7])$/.test(n)) open.add('fg');
			else if (/^(4[0-7]|10[0-7])$/.test(n)) open.add('bg');
			else open.add(n);
		}
	}
	return [...open];
}

const rows: DiffCardRow[] = [];
hostile.forEach((text, i) => {
	rows.push({kind: 'ctx', text, oldNo: 1 + i * 3, newNo: 1 + i * 3});
	rows.push({kind: 'del', text, oldNo: 2 + i * 3});
	rows.push({kind: 'add', text: `${text}!`, newNo: 2 + i * 3});
});
for (let i = 0; i < 30; i++) rows.push({kind: 'ctx', text: `line ${i}`, oldNo: 100 + i, newNo: 100 + i});

const card: DiffCard = {path: `${ESC}[31mevil/${'漢'.repeat(30)}/f.ts`, tool: 'Edit', added: 4, removed: 4, rows};
const created: DiffCard = {path: 'new.txt', tool: 'Write', created: true, added: 4, removed: 0, rows: rows.filter(r => r.kind === 'add')};

test('hostile text never exceeds the width, leaks control characters or leaves a style open at a row end', () => {
	for (const c of [card, created]) {
		for (const width of [40, 80, 120, 159, 160, 200]) {
			for (const depth of ['truecolor', '256', '16', 'none'] as const) {
				const out = withColorDepth(depth, () => renderDiffCard(prepareDiffCard(c), {width, depth, lead: '● Edit'}));
				for (const row of out) {
					const tag = `${c.tool} ${width} ${depth}`;
					assert.ok(styledCells(row) <= width, `${tag}: ${styledCells(row)} cells`);
					const bare = row.replace(SGR, '');
					assert.doesNotMatch(bare, new RegExp('[\\x00-\\x08\\x0b-\\x1f\\x7f-\\x9f]'), tag);
					const params = [...row.matchAll(SGR)].map(m => m[1] ?? '');
					assert.deepEqual(openStyles(params), [], `${tag}: row ends with an open style`);
					if (depth === 'none') assert.equal(params.filter(p => /(^|;)(3[0-7]|4[0-7]|38|48|9[0-7]|10[0-7])(;|$)/.test(p)).length, 0, tag);
				}
				assert.ok(stripStyles(out.join('\n')).length > 0);
			}
		}
	}
});

test('the per-card highlight budget (256 KiB) stops highlighting later blocks', () => {
	const big: DiffCardRow[] = [];
	for (let b = 0; b < 8; b++) {
		if (b > 0) big.push({kind: 'fold', count: 5});
		for (let i = 0; i < 60; i++) big.push({kind: 'add', text: 'y'.repeat(900), newNo: b * 100 + i + 1});
	}
	const calls: number[] = [];
	prepareDiffCard({path: 'a.ts', added: 480, removed: 0, rows: big}, {
		highlight: lines => {
			calls.push(lines.length);
			return lines.map(l => [{text: l}]);
		},
	});
	assert.ok(calls.length >= 1 && calls.length < 8, `${calls.length} blocks highlighted`);
	assert.ok(calls.reduce((a, b) => a + b * 901, 0) <= 256 * 1024);
});
