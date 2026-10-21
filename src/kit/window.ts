/** First line of a window of `size` lines that keeps `focus` visible, with `anchor` (e.g. its label) when it fits. */
export function windowStart(total: number, size: number, focus: number, anchor: number = focus): number {
	if (total <= size) return 0;
	const max = total - size;
	let start = Math.min(Math.max(0, focus - Math.floor(size / 2)), max);
	if (anchor < start && focus - anchor < size) start = anchor;
	if (focus >= start + size) start = focus - size + 1;
	return Math.min(Math.max(0, start), max);
}
