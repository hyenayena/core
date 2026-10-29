import type {AgentPolicy} from '../../../../src/api.js';
import type {Catalog, CatalogCommand, CatalogSub} from './catalog.js';

export type Walk = {path: CatalogSub[]; rest: string[]};

function findSub(subs: readonly CatalogSub[], token: string): CatalogSub | undefined {
	return subs.find(s => s.name === token) ?? subs.find(s => s.aliases.includes(token));
}

/** Follows the subcommands named by `args` (name before alias); stops at the first token that matches none. */
export function walkPath(cmd: CatalogCommand, args: readonly string[]): Walk {
	const path: CatalogSub[] = [];
	let subs = cmd.subs;
	let i = 0;
	for (; i < args.length; i++) {
		const sub = findSub(subs, args[i]!);
		if (!sub) break;
		path.push(sub);
		subs = sub.subs;
	}
	return {path, rest: args.slice(i)};
}

/** The deepest policy declared on the path, otherwise the command's. */
export function policyOf(cmd: CatalogCommand, path: readonly CatalogSub[]): AgentPolicy {
	for (let i = path.length - 1; i >= 0; i--) {
		const agent = path[i]!.agent;
		if (agent !== undefined) return agent;
	}
	return cmd.agent;
}

/** For a line that ends on core's own `help` subcommand: the path to describe (parent path plus the rest). */
export function helpTarget(catalog: Catalog, name: string, args: readonly string[]): string[] | undefined {
	const cmd = catalog.byName.get(name);
	if (!cmd) return undefined;
	const {path, rest} = walkPath(cmd, args);
	const last = path[path.length - 1];
	if (!last?.builtin) return undefined;
	return [cmd.name, ...path.slice(0, -1).map(s => s.name), ...rest];
}
