import {wrapRows} from '../transcript/wrap.js';

export type TailRows = {rows: string[]; hiddenLines: number};

/**
 * The last `rows` screen rows of `lines` wrapped to `width`. When something is cut, the first row
 * is the `… N earlier lines` indicator and `hiddenLines` counts the lines not shown in full.
 */
export function tailRows(lines: readonly string[], width: number, rows: number): TailRows {
	const budget = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 0;
	const wrapped = lines.map(line => wrapRows(line, width));
	const total = wrapped.reduce((n, r) => n + r.length, 0);
	if (total <= budget) return {rows: wrapped.flat(), hiddenLines: 0};
	if (budget <= 1) return {rows: wrapped.flat().slice(total - budget), hiddenLines: 0};
	const keep = budget - 1;
	const flat = wrapped.flat();
	const shown = flat.slice(total - keep);
	let seen = 0;
	let fullyShown = 0;
	for (let i = wrapped.length - 1; i >= 0 && seen + wrapped[i]!.length <= keep; i--) {
		seen += wrapped[i]!.length;
		fullyShown++;
	}
	const hiddenLines = wrapped.length - fullyShown;
	return {rows: [`… ${hiddenLines} earlier ${hiddenLines === 1 ? 'line' : 'lines'}`, ...shown], hiddenLines};
}
