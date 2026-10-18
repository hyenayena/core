import assert from 'node:assert/strict';
import {test} from 'node:test';
import {c, colorEnabled} from '../../src/hints/style.js';

test('NO_COLOR set and non-empty disables colour', () => {
	assert.equal(colorEnabled({NO_COLOR: '1'}), false);
	assert.equal(colorEnabled({NO_COLOR: '0'}), false);
	assert.equal(colorEnabled({NO_COLOR: ''}), true);
	assert.equal(colorEnabled({}), true);
	assert.equal(c('cyan', {NO_COLOR: '1'}), undefined);
	assert.equal(c('cyan', {}), 'cyan');
});
