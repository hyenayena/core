import React from 'react';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Text} from 'ink';
import {ListPicker, useViewHost} from '../../src/kit/ui.js';
import {subscribeTerminalSize, terminalSizeOf, useTerminalSize} from '../../src/kit/terminal-size.js';
import {createFakeStdout, mountHarness} from '../testkit.js';

function Size() {
	const {columns, rows} = useTerminalSize();
	return <Text>{`size ${columns}x${rows}`}</Text>;
}

function Host() {
	const {columns} = useViewHost(undefined);
	return <Text>{`host ${columns}`}</Text>;
}

test('eight components on one stdout share one resize listener', async () => {
	const stdout = createFakeStdout({columns: 80, rows: 40});
	const h = mountHarness(
		<>
			{Array.from({length: 8}, (_, i) => <Size key={i} />)}
		</>,
		undefined,
		{stdout},
	);
	await h.settle();
	assert.equal(stdout.listenerCount('resize'), 2);
	h.resize(50, 20);
	await h.settle();
	assert.equal((h.lastFrame().match(/size 50x20/g) ?? []).length, 8);
	h.unmount();
	assert.equal(stdout.listenerCount('resize'), 0);
});

test('roots on separate stdouts do not share listeners', async () => {
	const a = createFakeStdout();
	const b = createFakeStdout();
	const ha = mountHarness(<Size />, undefined, {stdout: a});
	const hb = mountHarness(<Size />, undefined, {stdout: b});
	await ha.settle();
	assert.equal(a.listenerCount('resize'), 2);
	assert.equal(b.listenerCount('resize'), 2);
	ha.unmount();
	assert.equal(b.listenerCount('resize'), 2);
	hb.resize(60, 30);
	await hb.settle();
	assert.match(hb.lastFrame(), /size 60x30/);
	hb.unmount();
});

test('subscribe, unsubscribe and fallbacks', () => {
	const out = Object.assign(new EventEmitter(), {columns: 100 as number | undefined, rows: 30 as number | undefined});
	let calls = 0;
	const offs = [1, 2, 3].map(() => subscribeTerminalSize(out, () => calls++));
	assert.equal(out.listenerCount('resize'), 1);
	out.emit('resize');
	assert.equal(calls, 3);
	offs.forEach(off => off());
	offs[0]!();
	assert.equal(out.listenerCount('resize'), 0);
	const first = terminalSizeOf(out);
	assert.equal(terminalSizeOf(out), first);
	out.columns = 0;
	out.rows = undefined;
	assert.deepEqual(terminalSizeOf(out), {columns: 80, rows: 24});
});

test('ListPicker and useViewHost together use one listener', async () => {
	const stdout = createFakeStdout();
	const h = mountHarness(
		<>
			<ListPicker title="T" empty="none" action="Pick" items={[{id: 'a', label: 'one'}]} onPick={() => {}} close={() => {}} />
			<Host />
		</>,
		undefined,
		{stdout},
	);
	await h.settle();
	assert.equal(stdout.listenerCount('resize'), 2);
	h.unmount();
});

test('a resize with unchanged size skips React renders but Ink still repaints the frame', async () => {
	const stdout = createFakeStdout({columns: 80, rows: 40});
	let renders = 0;
	function Counted() {
		const {columns} = useTerminalSize();
		renders++;
		return <Text>{`cols ${columns}`}</Text>;
	}
	const h = mountHarness(<Counted />, undefined, {stdout});
	await h.settle();
	const rendersBefore = renders;
	const framesBefore = h.frameCount();
	stdout.emit('resize');
	await h.settle();
	assert.equal(renders, rendersBefore);
	assert.ok(h.frameCount() > framesBefore);
	assert.match(h.lastFrame(), /cols 80/);
	h.unmount();
});

test('a size change re-lays out every subscriber in the same tick', async () => {
	const stdout = createFakeStdout({columns: 80, rows: 40});
	const seen: number[] = [];
	function Probe({id}: {id: number}) {
		const {columns} = useTerminalSize();
		seen[id] = columns;
		return <Text>{`p${id}:${columns}`}</Text>;
	}
	const h = mountHarness(<><Probe id={0} /><Probe id={1} /><Probe id={2} /></>, undefined, {stdout});
	await h.settle();
	h.resize(33, 40);
	await h.settle();
	assert.deepEqual(seen, [33, 33, 33]);
	h.unmount();
});

test('StrictMode double subscribe leaves one listener and cleans up', async () => {
	const stdout = createFakeStdout();
	const h = mountHarness(<React.StrictMode><Size /><Size /></React.StrictMode>, undefined, {stdout});
	await h.settle();
	assert.equal(stdout.listenerCount('resize'), 2);
	h.resize(44, 10);
	await h.settle();
	assert.match(h.lastFrame(), /size 44x10/);
	h.unmount();
	assert.equal(stdout.listenerCount('resize'), 0);
});

test('unsubscribing inside a resize callback does not skip other listeners', () => {
	const out = Object.assign(new EventEmitter(), {columns: 100, rows: 30});
	const calls: string[] = [];
	let offB = () => {};
	const offA = subscribeTerminalSize(out, () => {
		calls.push('a');
		offB();
		offA();
	});
	offB = subscribeTerminalSize(out, () => calls.push('b'));
	subscribeTerminalSize(out, () => calls.push('c'));
	out.emit('resize');
	assert.deepEqual(calls, ['a', 'b', 'c']);
	out.emit('resize');
	assert.deepEqual(calls, ['a', 'b', 'c', 'c']);
});
