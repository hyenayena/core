import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useState} from 'react';
import {Text, useInput} from 'ink';
import App from '../src/app.js';
import {createRegistry} from '../src/commands.js';
import {frameMetrics, startFrameMetrics} from '../src/kit/frame-metrics.js';
import {mountHarness} from './testkit.js';
import type {Command} from '../../../src/api.js';

function Tall() {
	const [rows, setRows] = useState(1);
	useInput(input => {
		if (input === '+') setRows(r => r + 2);
	});
	return (
		<>
			{Array.from({length: rows}, (_, i) => (
				<Text key={i}>row {i}</Text>
			))}
		</>
	);
}

test('the live height probe counts changes of the mounted view', async () => {
	const records: Array<Record<string, unknown> | undefined> = [];
	startFrameMetrics({log: {debug: (_m, f) => void records.push(f), level: () => 'debug'}});
	const commands: Command[] = [{name: 'view', description: 'mount', run: (_a, ctx) => void ctx.mount!(() => <Tall />)}];
	const h = mountHarness(<App registry={createRegistry(commands)} />);
	try {
		await h.settle();
		h.press('view');
		await h.settle();
		h.press('\r');
		await h.settle();
		const turn = frameMetrics().turn();
		frameMetrics().render(1);
		h.press('+');
		await h.settle();
		frameMetrics().render(1);
		await h.settle();
		frameMetrics().render(1);
		h.press('+');
		await h.settle();
		frameMetrics().render(1);
		turn.end('ok');
		assert.equal(records.length, 1);
		assert.equal(records[0]!.heightChanges, 2);
		assert.equal(records[0]!.renders, 4);
	} finally {
		h.unmount();
		startFrameMetrics();
	}
});
