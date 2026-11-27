import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {Text} from 'ink';
import {useFrame, useFrameDeadline} from '../../src/kit/ui.js';
import {frameClock} from '../../src/kit/frame-clock.js';
import {mountHarness, wait} from '../testkit.js';

function Probe({active, pace}: {active: boolean; pace?: number}) {
	return <Text>{`t${useFrame(active, pace)}`}</Text>;
}

function Deadline({at, onRender}: {at: number; onRender: () => void}) {
	useFrameDeadline(at);
	onRender();
	return <Text>d</Text>;
}

test('an inactive useFrame reads 0 and subscribes nothing', async () => {
	const h = mountHarness(<Probe active={false} />);
	await wait(120);
	assert.equal(h.lastFrame().trim(), 't0');
	assert.equal(frameClock.size(), 0);
	h.unmount();
});

test('the value is quantised to the pace', async () => {
	const h = mountHarness(<Probe active pace={1000} />);
	await h.settle();
	await wait(150);
	const value = Number(/t(\d+)/.exec(h.lastFrame())![1]);
	assert.equal(value % 1000, 0);
	h.unmount();
	assert.equal(frameClock.size(), 0);
});

test('two components on one clock commit once per tick', async () => {
	const h = mountHarness(
		<>
			<Probe active pace={50} />
			<Probe active pace={50} />
		</>,
	);
	await h.settle();
	const before = h.frameCount();
	const ticks = frameClock.tick();
	await wait(520);
	const frames = h.frameCount() - before;
	const elapsed = frameClock.tick() - ticks;
	assert.ok(elapsed >= 4, `ticks ${elapsed}`);
	assert.ok(frames <= elapsed + 1, `frames ${frames} for ${elapsed} ticks`);
	h.unmount();
});

test('useFrameDeadline re-renders once after the deadline', async () => {
	let renders = 0;
	const h = mountHarness(<Deadline at={Date.now() + 120} onRender={() => void renders++} />);
	await h.settle();
	const first = renders;
	await wait(400);
	assert.equal(renders, first + 1);
	h.unmount();
});
