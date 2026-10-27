import type {PrintAction} from '../../../../src/api.js';
import type {LineLayout} from './selection.js';

export const MAX_ACTIONS = 200;

/** The valid actions of a print, at most `MAX_ACTIONS`; undefined when none is left. */
export function cleanActions(actions: unknown): PrintAction[] | undefined {
	if (!Array.isArray(actions)) return undefined;
	const out: PrintAction[] = [];
	for (const a of actions as unknown[]) {
		if (out.length >= MAX_ACTIONS) break;
		if (typeof a !== 'object' || a === null) continue;
		const {line, copy} = a as Record<string, unknown>;
		if (typeof line === 'number' && Number.isSafeInteger(line) && line >= 0 && typeof copy === 'string' && copy !== '') out.push({line, copy});
	}
	return out.length > 0 ? out : undefined;
}

/** The action of the printed line that holds `offset` of the line's plain text; pass the line's layout for the width shown (`renderedLine`). */
export function actionAt(line: {actions?: readonly PrintAction[] | undefined}, layout: LineLayout, offset: number): PrintAction | undefined {
	if (!line.actions) return undefined;
	let index = 0;
	const end = Math.min(offset, layout.plain.length);
	for (let i = layout.plain.indexOf('\n'); i >= 0 && i < end; i = layout.plain.indexOf('\n', i + 1)) index++;
	return line.actions.find(a => a.line === index);
}
