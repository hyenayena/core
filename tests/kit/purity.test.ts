import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const entry = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/kit/text.ts');
const FROM = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

test('kit/text.ts imports only relative modules, transitively', () => {
	const seen = new Set<string>();
	const walk = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		const source = readFileSync(file, 'utf8');
		for (const m of source.matchAll(FROM)) {
			const spec = (m[1] ?? m[2] ?? m[3]) as string;
			assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${file} imports ${spec}`);
			assert.ok(!/\/(components|view|kit\/ui)\b/.test(spec), `${file} imports ${spec}`);
			walk(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
		}
	};
	walk(entry);
	assert.ok(seen.size >= 8);
});
