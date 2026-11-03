import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stringCells} from '../../src/hints/width.js';
import {layoutInlineRows, type InlineRow} from '../../src/view/inline-rows.js';

const MODELS = ['haiku', 'sonnet', 'opus'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function tiers(focus?: [number, number], values: [string, string][] = [['haiku', 'medium'], ['sonnet', 'medium'], ['opus', 'medium'], ['opus', 'high']]): InlineRow[] {
	return ['light', 'standard', 'strong', 'max'].map((label, r) => ({
		label,
		fields: [
			{options: MODELS, current: values[r]![0], focused: focus?.[0] === r && focus[1] === 0},
			{options: EFFORTS, current: values[r]![1], focused: focus?.[0] === r && focus[1] === 1},
		],
	}));
}

const plain = (rows: ReturnType<typeof layoutInlineRows>) => rows.map(r => r.map(s => s.text).join(''));

test('aligned rows match the mockup and mark the focused field', () => {
	const rows = layoutInlineRows(tiers([2, 0]), 79);
	assert.deepEqual(plain(rows), [
		'  light     → [haiku]  [medium]',
		'  standard  → [sonnet] [medium]',
		'› strong    → [opus]   [medium]',
		'  max       → [opus]   [high]',
	]);
	assert.deepEqual(
		rows[2]!.filter(s => s.focused).map(s => s.text),
		['[opus]'],
	);
	assert.equal(rows[0]!.some(s => s.focused), false);
});

test('column widths come from every option, so changing a value does not shift the layout', () => {
	const before = plain(layoutInlineRows(tiers(), 79));
	const after = plain(layoutInlineRows(tiers(undefined, [['haiku', 'max'], ['sonnet', 'medium'], ['opus', 'medium'], ['opus', 'high']]), 79));
	assert.equal(after[0]!.indexOf('[max]'), before[0]!.indexOf('[medium]'));
	const rows = layoutInlineRows([{label: 'a', fields: [{options: ['x', 'longer'], current: 'x', focused: false}, {options: ['y'], current: 'y', focused: false}]}], 79);
	assert.equal(plain(rows)[0], '  a  → [x]      [y]');
});

test('a value not loaded or matching no option shows [?]', () => {
	const rows = layoutInlineRows([{label: 'light', fields: [{options: MODELS, focused: false}]}], 79);
	assert.equal(plain(rows)[0], '  light  → [?]');
});

test('long labels and option labels are capped', () => {
	const rows = layoutInlineRows([{label: 'x'.repeat(40), fields: [{options: ['y'.repeat(40)], current: 'y'.repeat(40), focused: true}]}], 200);
	const [line] = plain(rows);
	assert.equal(line, `› ${'x'.repeat(19)}…  → [${'y'.repeat(15)}…]`);
});

test('narrow widths drop the alignment, then shrink the label, then cut, never past the width', () => {
	const compact = plain(layoutInlineRows(tiers([0, 1]), 30));
	assert.equal(compact[0], '› light → [haiku] [medium]');
	assert.equal(compact[1], '  standard → [sonnet] [medium]');
	const shrunk = plain(layoutInlineRows(tiers(), 28));
	assert.equal(shrunk[1], '  stand… → [sonnet] [medium]');
	const cut = plain(layoutInlineRows(tiers(), 20));
	assert.equal(cut[1], '  s → [sonnet] [med…');
	for (const width of [1, 2, 5, 10, 15, 20, 25, 26, 27, 30, 31]) {
		for (const line of plain(layoutInlineRows(tiers([3, 1]), width))) {
			assert.ok(stringCells(line) <= width, `width ${width}: ${line}`);
		}
	}
});

test('the highlight stays on the part of the focused field that is shown', () => {
	const rows = layoutInlineRows([{label: 'light', fields: [{options: ['haiku'], current: 'haiku', focused: false}, {options: ['medium'], current: 'medium', focused: true}]}], 20);
	assert.deepEqual(plain(rows), ['› l → [haiku] [medi…']);
	assert.deepEqual(rows[0]!.filter(s => s.focused).map(s => s.text), ['[medi']);
});

test('wide and emoji labels stay within every width from 1 to 200, and the aligned layout does not move while cycling', () => {
	const options = [['俳句', 'ソネット長い名前', '👍🏽'], ['é', 'x'.repeat(30), '中文']];
	const rows = (values: number[], focus: number): InlineRow[] =>
		['軽量', 'standard 🦊', 'x'.repeat(25)].map((label, r) => ({
			label,
			fields: options.map((opts, f) => ({options: opts, current: opts[(values[r]! + f) % opts.length], focused: focus === r * 2 + f})),
		}));
	for (let width = 1; width <= 200; width++) {
		const layouts = [[0, 0, 0], [1, 2, 0], [2, 1, 1]].map((values, i) => plain(layoutInlineRows(rows(values, i), width)));
		for (const lines of layouts) for (const line of lines) assert.ok(stringCells(line) <= width, `width ${width}: ${line}`);
	}
	const secondField = [[0, 0, 0], [1, 2, 0], [2, 1, 1]].flatMap(values =>
		plain(layoutInlineRows(rows(values, -1), 200)).map(l => {
			const head = l.slice(0, l.indexOf(']') + 1);
			return stringCells(head) + l.slice(head.length).search(/\[/);
		}),
	);
	assert.equal(new Set(secondField).size, 1, 'the second field starts in the same column whatever the values');
});
