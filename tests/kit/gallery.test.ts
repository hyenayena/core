import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gallerySections, loadGallery, registerGallerySection, renderGallery, type GallerySection} from '../../src/kit/gallery.js';
import {registerBuiltinSections} from '../../src/gallery/sections.js';
import {styledCells, stripStyles} from '../../src/transcript/wrap.js';
import type {ColorDepth} from '../../src/kit/theme.js';

const ESC = String.fromCharCode(27);
registerBuiltinSections();

const ok = (name: string, rows: string[]): GallerySection => ({name, title: name, load: () => () => rows});

test('registration: valid, duplicate and invalid', () => {
	assert.equal(registerGallerySection(ok('sample-a', ['x'])), true);
	assert.equal(registerGallerySection(ok('sample-a', ['y'])), false, 'first wins');
	assert.equal(registerGallerySection(ok('theme', ['y'])), false, 'a built-in name is taken');
	for (const name of ['', 'A', '1a', 'a b', 'a'.repeat(33)]) assert.equal(registerGallerySection(ok(name, [])), false, name);
	assert.equal(registerGallerySection({name: 'nofn', title: 't', load: 1 as never}), false);
	assert.equal(registerGallerySection(null as never), false);
	const names = gallerySections().map(s => s.name);
	assert.deepEqual(names.slice(0, 2), ['theme', 'glyphs']);
	assert.ok(names.indexOf('sample-a') > 1);
});

test('rows never reach the last column, for built-ins and an over-long row', async () => {
	registerGallerySection(ok('wide-row', ['w'.repeat(500), `${ESC}[31m${'r'.repeat(300)}${ESC}[0m`]));
	const loaded = await loadGallery([]);
	for (const cols of [40, 80, 160]) {
		for (const depth of ['truecolor', '256', '16', 'none'] as ColorDepth[]) {
			for (const ascii of [false, true]) {
				for (const row of renderGallery(loaded, {width: cols - 1, depth, ascii})) {
					assert.ok(styledCells(row) <= cols - 1, `${cols} ${depth}: ${styledCells(row)}`);
				}
			}
		}
	}
});

test('a throwing renderer and a rejecting load become an error row', async () => {
	registerGallerySection({name: 'boom-render', title: 'Boom', load: () => () => {
		throw new Error('bad\nthing');
	}});
	registerGallerySection({name: 'boom-load', title: 'Load', load: () => Promise.reject(new Error('nope'))});
	const seen: string[] = [];
	const rows = renderGallery(await loadGallery(['boom-render', 'boom-load']), {width: 60, depth: 'none', ascii: false}, s => seen.push(s));
	const text = stripStyles(rows.join('\n'));
	assert.match(text, /boom-render failed: bad thing/);
	assert.match(text, /boom-load failed: nope/);
	assert.deepEqual(seen, ['boom-render', 'boom-load']);
});

test('non-SGR escapes are stripped and the plain form has no ESC', async () => {
	registerGallerySection(ok('esc-test', [`a${ESC}[2Jb${ESC}]0;title\x07c ${ESC}[1mbold${ESC}[0m`]));
	const loaded = await loadGallery(['esc-test']);
	const rows = renderGallery(loaded, {width: 60, depth: '16', ascii: false});
	const joined = rows.join('\n');
	assert.ok(!joined.includes(`${ESC}[2J`) && !joined.includes(`${ESC}]`));
	assert.ok(joined.includes(`${ESC}[1m`));
	assert.ok(!stripStyles(joined).includes(ESC));
	assert.match(stripStyles(joined), /abc bold/);
});

test('an unknown section names the known ones', async () => {
	await assert.rejects(() => loadGallery(['nope']), /^Error: Unknown gallery section: nope\. Sections: theme, glyphs/);
});
