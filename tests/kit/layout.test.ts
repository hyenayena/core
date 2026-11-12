import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	COLUMN_BREAKPOINTS,
	ROW_BREAKPOINTS,
	allocateRows,
	columnTier,
	fixedRowBudget,
	liveRowCap,
	rowTier,
	type RowPart,
} from '../../src/kit/layout.js';

test('column tiers switch at 60 and 120', () => {
	assert.equal(COLUMN_BREAKPOINTS.sideBySide, 160);
	for (const [c, tier] of [[59, 'compact'], [60, 'normal'], [119, 'normal'], [120, 'wide'], [159, 'wide'], [160, 'wide'], [NaN, 'compact'], [-5, 'compact']] as const) {
		assert.equal(columnTier(c), tier, `columns=${c}`);
	}
});

test('row tiers switch at 12, 17 and 24', () => {
	assert.deepEqual(ROW_BREAKPOINTS, {short: 12, normal: 17, tall: 24});
	for (const [r, tier] of [[0, 'tiny'], [11, 'tiny'], [12, 'short'], [16, 'short'], [17, 'normal'], [23, 'normal'], [24, 'tall'], [200, 'tall'], [NaN, 'tall']] as const) {
		assert.equal(rowTier(r), tier, `rows=${r}`);
	}
});

test('live cap and fixed budget for rows 0..200', () => {
	for (let rows = 0; rows <= 200; rows++) {
		const cap = liveRowCap(rows);
		assert.equal(cap, rows >= 12 ? rows - 3 : Math.max(0, rows - 1), `rows=${rows}`);
		assert.ok(cap <= Math.max(0, rows - 1));
		assert.equal(fixedRowBudget(rows), Math.min(cap, Math.floor(rows * 0.5)));
		assert.ok(fixedRowBudget(rows, 1) <= cap);
	}
});

const parts = (): RowPart[] => [
	{id: 'status', min: 1, desired: 1, priority: 100, fixed: true},
	{id: 'input', min: 1, desired: 4, priority: 90, fixed: true},
	{id: 'plan', min: 2, desired: 8, priority: 50},
	{id: 'tail', min: 0, desired: 6, priority: 10},
];

test('allocator invariants for every row count', () => {
	for (let rows = 0; rows <= 200; rows++) {
		const a = allocateRows(parts(), rows);
		assert.ok(a.used <= a.budget, `rows=${rows}`);
		assert.ok(a.budget <= liveRowCap(rows));
		assert.ok(liveRowCap(rows) <= Math.max(0, rows - 1));
		assert.deepEqual(Object.keys(a.heights).sort(), ['input', 'plan', 'status', 'tail']);
		assert.equal(Object.values(a.heights).reduce((s, h) => s + h, 0), a.used);
		if (a.tier === 'tiny') {
			assert.equal(a.heights.plan, 0);
			assert.equal(a.heights.tail, 0);
		}
	}
});

test('priority decides who grows first and desired caps the growth', () => {
	const a = allocateRows(parts(), 24);
	assert.equal(a.budget, 12);
	assert.deepEqual(a.heights, {status: 1, input: 4, plan: 7, tail: 0});
	assert.deepEqual(allocateRows(parts(), 100).heights, {status: 1, input: 4, plan: 8, tail: 6});
});

test('parts that do not fit are dropped by lowest drop value, non-fixed first', () => {
	const p: RowPart[] = [
		{id: 'a', min: 3, desired: 3, priority: 1},
		{id: 'b', min: 3, desired: 3, priority: 9, drop: 0},
		{id: 'c', min: 3, desired: 3, priority: 5},
		{id: 'f', min: 3, desired: 3, priority: 0, fixed: true},
	];
	const a = allocateRows(p, 24, {budget: 9});
	assert.deepEqual(a.heights, {a: 3, b: 0, c: 3, f: 3});
	assert.deepEqual(allocateRows(p, 24, {budget: 2}).heights, {a: 0, b: 0, c: 0, f: 0});
	assert.equal(allocateRows(p, 24, {budget: 6}).heights.f, 3);
});

test('steps snap the height down to an allowed value', () => {
	const p: RowPart[] = [{id: 's', min: 2, desired: 12, priority: 1, steps: [2, 5, 9]}];
	assert.equal(allocateRows(p, 40, {budget: 8}).heights.s, 5);
	assert.equal(allocateRows(p, 40, {budget: 30}).heights.s, 9);
	assert.equal(allocateRows(p, 40, {budget: 3}).heights.s, 2);
});

test('duplicate ids: the first wins, later ones get nothing', () => {
	const a = allocateRows([{id: 'x', min: 1, desired: 3, priority: 1}, {id: 'x', min: 5, desired: 5, priority: 9}], 30);
	assert.deepEqual(a.heights, {x: 3});
	assert.equal(a.used, 3);
});

test('NaN and negative inputs are treated as zero', () => {
	const a = allocateRows([{id: 'n', min: NaN, desired: -4, priority: NaN}, {id: 'm', min: 1.9, desired: 2.5, priority: 1}], NaN);
	assert.deepEqual(a.heights, {n: 0, m: 2});
	const b = allocateRows(parts(), 20, {budget: NaN});
	assert.equal(b.budget, 0);
	assert.equal(b.used, 0);
	assert.equal(allocateRows(parts(), 20, {budget: 999}).budget, liveRowCap(20));
});
