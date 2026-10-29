import React from 'react';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Form, type FormValue} from '../../src/kit/ui.js';
import {mountHarness} from '../testkit.js';

const ESC = String.fromCharCode(27);
const BACKSPACE = String.fromCharCode(127);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const RIGHT = `${ESC}[C`;
const LEFT = `${ESC}[D`;
const SHIFT_TAB = `${ESC}[Z`;

const BUTTONS = [
	{id: 'cancel', label: 'Cancel'},
	{id: 'save', label: 'Save'},
];

const valueOf = (values: FormValue[], id: string) => values.find(v => v.id === id)?.value;

test('Form: typing edits the focused field, rows move with arrows and Tab, a button gets every value', async () => {
	const got: {id: string; values: FormValue[]}[] = [];
	const h = mountHarness(
		<Form
			title="New task"
			fields={[
				{id: 'project', label: 'Project', value: 'web', readOnly: true},
				{id: 'id', label: 'ID', value: 'TASK-1'},
				{id: 'desc', label: 'Description', value: '', placeholder: 'what to do'},
			]}
			buttons={BUTTONS}
			onButton={(id, values) => void got.push({id, values})}
			onCancel={() => assert.fail('cancelled')}
		/>,
	);
	await h.settle();
	assert.match(h.lastFrame(), /New task/);
	assert.match(h.lastFrame(), /what to do/);
	assert.match(h.lastFrame(), /\[ Cancel \] {2}\[ Save \]/);
	h.press(BACKSPACE);
	await h.settle();
	h.press('2');
	await h.settle();
	await h.settle();
	assert.match(h.lastFrame(), /› ID\s+TASK-2/);
	h.press('\r');
	await h.settle();
	h.press('fix login');
	await h.settle();
	await h.settle();
	assert.match(h.lastFrame(), /› Description\s+fix login/);
	h.press(UP);
	await h.settle();
	h.press(UP);
	await h.settle();
	h.press('x');
	await h.settle();
	h.press(DOWN);
	await h.settle();
	h.press(SHIFT_TAB);
	await h.settle();
	h.press('\t');
	await h.settle();
	h.press('\t');
	await h.settle();
	h.press('\t');
	await h.settle();
	await h.settle();
	assert.match(h.lastFrame(), /choose/);
	h.press(RIGHT);
	await h.settle();
	h.press('\r');
	await h.settle();
	await h.settle();
	assert.equal(got.length, 1);
	assert.equal(got[0]!.id, 'save');
	assert.equal(valueOf(got[0]!.values, 'project'), 'web');
	assert.equal(valueOf(got[0]!.values, 'id'), 'TASK-2');
	assert.equal(valueOf(got[0]!.values, 'desc'), 'fix login');
	h.press('\r');
	await h.settle();
	await h.settle();
	assert.equal(got.length, 1, 'input after a button is ignored');
	h.unmount();
});

test('Form: a message from onButton is shown and the form stays; ← wraps to the last button', async () => {
	const pressed: string[] = [];
	const h = mountHarness(
		<Form
			fields={[{id: 'a', label: 'A', value: ''}]}
			buttons={BUTTONS}
			onButton={(id, values) => {
				pressed.push(id);
				return valueOf(values, 'a') === '' ? 'A is required' : undefined;
			}}
			onCancel={() => {}}
		/>,
	);
	await h.settle();
	h.press(DOWN);
	await h.settle();
	h.press(LEFT);
	await h.settle();
	h.press('\r');
	await h.settle();
	await h.settle();
	assert.match(h.lastFrame(), /A is required/);
	h.press(UP);
	await h.settle();
	h.press('ok');
	await h.settle();
	h.press(DOWN);
	await h.settle();
	await h.settle();
	assert.doesNotMatch(h.lastFrame(), /A is required/);
	h.press('\r');
	await h.settle();
	await h.settle();
	assert.deepEqual(pressed, ['save', 'save']);
	h.unmount();
});

test('Form: the add row asks for a name, validates it and appends an empty field', async () => {
	const got: FormValue[][] = [];
	const h = mountHarness(
		<Form
			fields={[{id: 'a', label: 'Status', value: 'new'}]}
			buttons={[{id: 'save', label: 'Save'}]}
			add={{label: 'Add field', validate: (label, values) => (values.some(v => v.label.toLowerCase() === label.toLowerCase()) ? `${label} exists` : undefined)}}
			onButton={(_id, values) => void got.push(values)}
			onCancel={() => {}}
		/>,
	);
	await h.settle();
	h.press(DOWN);
	await h.settle();
	await h.settle();
	assert.match(h.lastFrame(), /› \+ Add field/);
	h.press('\r');
	await h.settle();
	h.press('status');
	await h.settle();
	h.press('\r');
	await h.settle();
	await h.settle();
	assert.match(h.lastFrame(), /status exists/);
	for (let i = 0; i < 6; i++) h.press(BACKSPACE);
	h.press('Priority');
	await h.settle();
	h.press('\r');
	await h.settle();
	h.press('high');
	await h.settle();
	await h.settle();
	assert.match(h.lastFrame(), /› Priority\s+high/);
	h.press(DOWN);
	await h.settle();
	h.press('\r');
	await h.settle();
	h.press('Owner');
	await h.settle();
	h.press(ESC);
	await h.settle();
	await h.settle();
	assert.doesNotMatch(h.lastFrame(), /Owner/);
	h.press(DOWN);
	await h.settle();
	h.press('\r');
	await h.settle();
	await h.settle();
	assert.deepEqual(got[0], [
		{id: 'a', label: 'Status', value: 'new'},
		{id: 'added:1', label: 'Priority', value: 'high'},
	]);
	h.unmount();
});

test('Form: Esc and Ctrl+C cancel; control characters and escape sequences in values and labels never reach the frame', async () => {
	let cancelled = 0;
	const h = mountHarness(
		<Form
			title={`T${ESC}[31m`}
			fields={[{id: 'a', label: `L${ESC}]0;x`, value: `v${ESC}[2J`}]}
			buttons={BUTTONS}
			onButton={() => undefined}
			onCancel={() => cancelled++}
		/>,
	);
	await h.settle();
	assert.ok(!h.lastFrame().includes(ESC));
	h.press(ESC);
	await h.settle();
	await h.settle();
	assert.equal(cancelled, 1);
	h.press(ESC);
	await h.settle();
	await h.settle();
	assert.equal(cancelled, 1);
	h.unmount();
	const h2 = mountHarness(<Form fields={[]} buttons={BUTTONS} onButton={() => undefined} onCancel={() => cancelled++} />);
	await h2.settle();
	h2.press(String.fromCharCode(3));
	await h2.settle();
	await h2.settle();
	assert.equal(cancelled, 2);
	h2.unmount();
});
