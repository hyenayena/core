import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerBuiltinSections} from '../../src/gallery/sections.js';
import {stringCells} from '../../src/hints/width.js';
import {loadGallery, renderGallery} from '../../src/kit/gallery.js';
import {stripStyles} from '../../src/transcript/wrap.js';

for (const columns of [50, 100, 160]) {
	for (const ascii of [false, true]) {
		test(`theme, glyphs and console fit ${columns - 1} cells at ${columns} columns (ascii ${ascii})`, async () => {
			registerBuiltinSections();
			const loaded = await loadGallery(['theme', 'glyphs', 'console']);
			const errors: string[] = [];
			const rows = renderGallery(loaded, {width: columns - 1, rows: 24, depth: 'none', ascii}, name => errors.push(name));
			assert.deepEqual(errors, []);
			for (const row of rows) assert.ok(stringCells(stripStyles(row)) <= columns - 1, stripStyles(row));
		});
	}
}
