export const COLUMN_BREAKPOINTS = {normal: 60, wide: 120, sideBySide: 160} as const;
export const ROW_BREAKPOINTS = {short: 12, normal: 17, tall: 24} as const;
export const FIXED_SHARE = 0.5;

export type ColumnTier = 'compact' | 'normal' | 'wide';
export type RowTier = 'tiny' | 'short' | 'normal' | 'tall';

export function columnTier(columns: number): ColumnTier {
	if (!(columns >= COLUMN_BREAKPOINTS.normal)) return 'compact';
	return columns >= COLUMN_BREAKPOINTS.wide ? 'wide' : 'normal';
}

const rowsOrDefault = (rows: number): number => (Number.isFinite(rows) ? Math.floor(rows) : ROW_BREAKPOINTS.tall);

export function rowTier(rows: number): RowTier {
	const r = rowsOrDefault(rows);
	if (r < ROW_BREAKPOINTS.short) return 'tiny';
	if (r < ROW_BREAKPOINTS.normal) return 'short';
	return r < ROW_BREAKPOINTS.tall ? 'normal' : 'tall';
}

// Ink clears the screen when the live area is not shorter than the terminal.
export function liveRowCap(rows: number): number {
	const r = rowsOrDefault(rows);
	return Math.max(0, r >= ROW_BREAKPOINTS.short ? r - 3 : r - 1);
}

export function fixedRowBudget(rows: number, share: number = FIXED_SHARE): number {
	const s = Number.isFinite(share) ? Math.max(0, share) : FIXED_SHARE;
	return Math.min(liveRowCap(rows), Math.floor(rowsOrDefault(rows) * s));
}

export type RowPart = {
	id: string;
	min: number;
	desired: number;
	priority: number;
	drop?: number;
	fixed?: boolean;
	steps?: readonly number[];
};

export type RowAllocation = {
	heights: Readonly<Record<string, number>>;
	used: number;
	budget: number;
	tier: RowTier;
};

type Item = {part: RowPart; index: number; min: number; desired: number; priority: number; drop: number; fixed: boolean; steps: number[]};

const whole = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);
const num = (x: number | undefined): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

export function allocateRows(parts: readonly RowPart[], rows: number, options: {budget?: number; share?: number} = {}): RowAllocation {
	const tier = rowTier(rows);
	const cap = liveRowCap(rows);
	const heights: Record<string, number> = {};
	const seen = new Set<string>();
	const items: Item[] = [];
	parts.forEach((part, index) => {
		if (seen.has(part.id)) {
			heights[part.id] ??= 0;
			return;
		}
		seen.add(part.id);
		heights[part.id] = 0;
		const min = whole(part.min);
		const priority = num(part.priority);
		items.push({
			part,
			index,
			min,
			desired: Math.max(min, whole(part.desired)),
			priority,
			drop: part.drop === undefined ? priority : num(part.drop),
			fixed: part.fixed === true,
			steps: [...new Set((part.steps ?? []).map(whole))].sort((a, b) => a - b),
		});
	});

	const share = options.share ?? FIXED_SHARE;
	const fixedMins = items.reduce((sum, it) => sum + (it.fixed ? it.min : 0), 0);
	const budget =
		options.budget !== undefined
			? Math.min(cap, whole(options.budget))
			: Math.min(cap, Math.max(fixedRowBudget(rows, share), fixedMins));

	let admitted = tier === 'tiny' ? items.filter(it => it.fixed) : items.slice();
	let minSum = admitted.reduce((sum, it) => sum + it.min, 0);
	while (minSum > budget && admitted.length > 0) {
		let victim = admitted[0]!;
		for (const it of admitted) {
			if (it.fixed !== victim.fixed ? !it.fixed : it.drop < victim.drop || (it.drop === victim.drop && it.index > victim.index)) victim = it;
		}
		admitted = admitted.filter(it => it !== victim);
		minSum -= victim.min;
	}

	let left = budget - minSum;
	for (const it of admitted) heights[it.part.id] = it.min;
	const order = [...admitted].sort((a, b) => b.priority - a.priority || a.index - b.index);
	for (const it of order) {
		const limit = Math.min(it.desired, it.min + left);
		let h = limit;
		if (it.steps.length > 0) {
			h = it.min;
			for (const s of it.steps) if (s <= limit && s >= it.min) h = s;
		}
		heights[it.part.id] = h;
		left -= h - it.min;
	}

	const used = admitted.reduce((sum, it) => sum + heights[it.part.id]!, 0);
	return {heights, used, budget, tier};
}
