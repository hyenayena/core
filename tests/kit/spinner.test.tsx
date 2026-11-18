import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {Text} from 'ink';
import {Spinner, useSpinner} from '../../src/kit/ui.js';
import {spinnerClock} from '../../src/kit/spinner-clock.js';
import {mountHarness, wait} from '../testkit.js';

const DENSE = /[⣾⣽⣻⢿⡿⣟⣯⣷]/;

function Probe({active}: {active: boolean}) {
	return <Text>{`[${useSpinner(active)}]`}</Text>;
}

function countTimers<T>(run: () => Promise<T>): Promise<{started: number; result: T}> {
	const real = globalThis.setInterval;
	let started = 0;
	globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
		started++;
		return real(...args);
	}) as typeof setInterval;
	return run()
		.then(result => ({started, result}))
		.finally(() => {
			globalThis.setInterval = real;
		});
}

const text = (frame: string | undefined): string => (frame ?? '').replace(/\s+/g, '');

test('many spinners share one timer and one frame', async () => {
	const {started} = await countTimers(async () => {
		const hs = [1, 2, 3].map(() => mountHarness(<Probe active />));
		await hs[0]!.settle();
		const first = text(hs[0]!.lastFrame());
		await wait(300);
		const frames = hs.map(h => text(h.lastFrame()));
		for (const f of frames) assert.match(f, new RegExp(`^\\[${DENSE.source}\\]$`));
		assert.equal(new Set(frames).size, 1);
		assert.notEqual(frames[0], first);
		for (const h of hs) h.unmount();
	});
	assert.equal(started, 1);
	assert.equal(spinnerClock.size(), 0);
});

test('an inactive spinner starts no timer and shows frame 0', async () => {
	const {started} = await countTimers(async () => {
		const h = mountHarness(<Probe active={false} />);
		await wait(60);
		assert.equal(text(h.lastFrame()), '[⣾]');
		h.unmount();
	});
	assert.equal(started, 0);
});

test('Spinner advances', async () => {
	const h = mountHarness(<Spinner />);
	await h.settle();
	const first = text(h.lastFrame());
	await wait(300);
	assert.notEqual(text(h.lastFrame()), first);
	h.unmount();
});

test('ASCII mode uses the ASCII frames', async () => {
	const saved = process.env['TERM'];
	process.env['TERM'] = 'dumb';
	try {
		const h = mountHarness(<Spinner />);
		await h.settle();
		assert.match(text(h.lastFrame()), /^[|/\\-]$/);
		h.unmount();
	} finally {
		if (saved === undefined) delete process.env['TERM'];
		else process.env['TERM'] = saved;
	}
});

test('toggling active true, false, true leaks no timer or subscriber', async () => {
	let set: (v: boolean) => void = () => {};
	function Toggle() {
		const [active, setActive] = React.useState(true);
		set = setActive;
		return <Probe active={active} />;
	}
	const {started} = await countTimers(async () => {
		const h = mountHarness(<Toggle />);
		await h.settle();
		assert.equal(spinnerClock.size(), 1);
		set(false);
		await wait(60);
		assert.equal(spinnerClock.size(), 0);
		set(true);
		await wait(60);
		assert.equal(spinnerClock.size(), 1);
		h.unmount();
	});
	assert.equal(started, 2);
	assert.equal(spinnerClock.size(), 0);
});
