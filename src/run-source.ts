import type {CommandContext} from '../../../src/api.js';

export type RunSource = {view: 'main' | 'panel'};

// The host CommandContext has no place for the origin of a run, so it travels as a symbol property.
const RUN_SOURCE = Symbol('core.runSource');

export function withRunSource(ctx: CommandContext, source: RunSource): CommandContext {
	return Object.defineProperty({...ctx}, RUN_SOURCE, {value: source, enumerable: true});
}

export function runSourceOf(ctx: CommandContext): RunSource | undefined {
	const source = (ctx as unknown as Record<symbol, unknown>)[RUN_SOURCE];
	if (typeof source !== 'object' || source === null) return undefined;
	const view = (source as {view?: unknown}).view;
	return view === 'main' || view === 'panel' ? {view} : undefined;
}
