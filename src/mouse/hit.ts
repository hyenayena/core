import type {MouseInputEvent} from './sgr.js';

export type Rect = {x: number; y: number; width: number; height: number};
export type Area = 'main' | 'panel';
export type AreaLayout = {side: boolean; panelOpen: boolean; split: boolean; panelRect?: Rect | undefined};

export const WHEEL_LINES = 3;

export const inside = (rect: Rect, x: number, y: number): boolean =>
	x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

export const toLocal = (rect: Rect, x: number, y: number): {x: number; y: number} => ({x: x - rect.x, y: y - rect.y});

/** The area under the pointer; only a split layout has two areas side by side. */
export function areaAt(point: {x: number; y: number}, layout: AreaLayout): Area {
	if (!layout.side) return 'panel';
	if (!layout.panelOpen) return 'main';
	if (!layout.split) return 'panel';
	return layout.panelRect && inside(layout.panelRect, point.x, point.y) ? 'panel' : 'main';
}

/** Lines to scroll back (positive) or forward (negative) for a wheel event, 0 for anything else. */
export function wheelDelta(e: MouseInputEvent): number {
	if (e.kind !== 'wheel') return 0;
	return e.wheel === 'up' ? WHEEL_LINES : e.wheel === 'down' ? -WHEEL_LINES : 0;
}
