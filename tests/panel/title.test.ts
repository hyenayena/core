import assert from 'node:assert/strict';
import {test} from 'node:test';
import {panelTitleRow} from '../../src/panel/title.js';
import {stripStyles, styledCells} from '../../src/kit/text.js';
import {toneSgr} from '../../src/kit/theme.js';

const plain = (o: Parameters<typeof panelTitleRow>[0]) => stripStyles(panelTitleRow({depth: 'none', ...o}));

test('the title and its key hints', () => {
	assert.equal(plain({focused: true, split: true, width: 80}), 'Console · Tab close · ⇧← chat');
	assert.equal(plain({focused: true, split: false, width: 80}), 'Console · Tab close');
	assert.equal(plain({focused: true, split: true, folds: 'unfold', width: 80}), 'Console · Tab close · ⇧← chat · ^O unfold');
	assert.match(plain({focused: true, split: false, folds: 'fold', width: 80}), /\^O fold$/);
	assert.match(plain({focused: true, split: true, width: 80, ascii: true}), /Shift\+Left chat/);
});

test('narrow widths drop the hints from the right and keep the title', () => {
	const o = {focused: true, split: true, folds: 'unfold' as const};
	assert.equal(plain({...o, width: 30}), 'Console · Tab close · ⇧← chat');
	assert.equal(plain({...o, width: 20}), 'Console · Tab close');
	assert.equal(plain({...o, width: 9}), 'Console');
	for (let width = 1; width < 60; width++) assert.ok(styledCells(panelTitleRow({...o, width, depth: 'truecolor'})) <= width, String(width));
});

test('Console is bold in the focus tone when focused and in the frame tone otherwise', () => {
	const focused = panelTitleRow({focused: true, split: false, width: 40, depth: 'truecolor'});
	const idle = panelTitleRow({focused: false, split: false, width: 40, depth: 'truecolor'});
	assert.ok(focused.includes(toneSgr('focus', 'truecolor')));
	assert.ok(idle.includes(toneSgr('frame', 'truecolor')));
	assert.equal(idle.includes(toneSgr('focus', 'truecolor')), false);
	assert.ok(idle.includes('\x1b[1m'));
});
