import assert from 'node:assert/strict';
import {test} from 'node:test';
import {actionAt, cleanActions, MAX_ACTIONS} from '../../src/transcript/actions.js';
import {lineLayout} from '../../src/transcript/selection.js';

test('cleanActions keeps only valid actions, up to the cap', () => {
	assert.equal(cleanActions(undefined), undefined);
	assert.equal(cleanActions('x'), undefined);
	assert.deepEqual(
		cleanActions([{line: 0, copy: 'a'}, {line: -1, copy: 'b'}, {line: 1.5, copy: 'c'}, {line: 2, copy: ''}, {line: 3}, null, {line: 4, copy: 'd'}]),
		[{line: 0, copy: 'a'}, {line: 4, copy: 'd'}],
	);
	assert.equal(cleanActions([{line: 1, copy: ''}]), undefined);
	assert.equal(cleanActions(Array.from({length: MAX_ACTIONS + 5}, (_, i) => ({line: i, copy: 'x'})))!.length, MAX_ACTIONS);
});

test('actionAt finds the action of the printed line under the offset', () => {
	const text = '\u001b[2mhead\u001b[0m\nbody\nend';
	const layout = lineLayout(text, ['head', 'body', 'end']);
	const line = {id: 1, text, actions: [{line: 0, copy: 'A'}, {line: 2, copy: 'C'}]};
	assert.equal(actionAt(line, layout, 2)?.copy, 'A');
	assert.equal(actionAt(line, layout, 6), undefined);
	assert.equal(actionAt(line, layout, 11)?.copy, 'C');
	assert.equal(actionAt({id: 2, text}, layout, 0), undefined);
});
