import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	clickCursor,
	clickHint,
	ghostText,
	initialState,
	sanitizeInsert,
	step,
	visibleHints,
	type KeyInput,
	type PromptState,
	type StepResult,
} from '../../src/hints/editor.js';
import {env} from './fixture.js';

const text = (input: string): KeyInput => ({input});
const key = (name: keyof KeyInput, extra: Partial<KeyInput> = {}): KeyInput => ({input: '', [name]: true, ...extra});
const ctrl = (c: string): KeyInput => ({input: c, ctrl: true});

function run(keys: KeyInput[], history: string[] = [], from: PromptState = initialState) {
	const e = env(history);
	let state = from;
	let last: StepResult = {state};
	for (const k of keys) {
		last = step(state, k, e);
		state = last.state;
	}
	return {state, last, env: e};
}

const typed = (s: string) => [...s].map(text);
const tab = key('tab');
const shiftTab = key('tab', {shift: true});
const up = key('upArrow');
const down = key('downArrow');
const esc = key('escape');
const enter = key('return');

test('printable input is inserted at the cursor', () => {
	const {state} = run([...typed('abd'), key('leftArrow'), text('c')]);
	assert.equal(state.value, 'abcd');
	assert.equal(state.cursor, 3);
});

test('Enter submits and resets', () => {
	const {state, last} = run([...typed('hello'), enter]);
	assert.equal(last.effect, 'submit');
	assert.equal(last.line, 'hello');
	assert.deepEqual(state, initialState);
});

test('Ctrl+C interrupts without touching the state', () => {
	const before = run(typed('ab')).state;
	const r = step(before, ctrl('c'), env());
	assert.equal(r.effect, 'interrupt');
	assert.equal(r.state, before);
});

test('typed-only Enter executes exactly the typed line', () => {
	const {last} = run([...typed('ex'), enter]);
	assert.equal(last.effect, 'submit');
	assert.equal(last.line, 'ex');
});

test('ghost shows the rest of the best prefix match', () => {
	const r = run(typed('ex'));
	assert.equal(ghostText(r.state, r.env), 'it');
});

test('fuzzy matches have no ghost', () => {
	const r = run(typed('xt'));
	assert.equal(ghostText(r.state, r.env), '');
	assert.ok(visibleHints(r.state, r.env));
});

test('no hints when the line is blank or the cursor is not at the end', () => {
	const e = env();
	assert.equal(visibleHints(initialState, e), undefined);
	const r = run([...typed('ex'), key('leftArrow')]);
	assert.equal(visibleHints(r.state, r.env), undefined);
	assert.equal(ghostText(r.state, r.env), '');
});

test('Tab accepts the selected item with a trailing space', () => {
	const r = run([...typed('ex'), tab]);
	assert.equal(r.state.value, 'exit ');
	assert.equal(r.state.cursor, 5);
	assert.equal(r.state.cycle, undefined);
});

test('Tab with one item advances the stage', () => {
	const r = run([...typed('mod ins'), tab]);
	assert.equal(r.state.value, 'mod install ');
	assert.equal(r.state.cycle, undefined);
	const next = run([...typed('mod'), tab]);
	assert.equal(next.state.value, 'mod ');
	assert.equal(visibleHints(next.state, next.env)!.stage, 'sub');
});

test('Tab then Tab cycles through the frozen list and wraps', () => {
	const r1 = run([...typed('mod '), tab]);
	assert.equal(r1.state.value, 'mod install ');
	assert.ok(r1.state.cycle);
	const names = ['install', 'update', 'remove', 'list', 'help'];
	let s = r1.state;
	for (let i = 1; i <= 6; i++) {
		s = step(s, tab, r1.env).state;
		assert.equal(s.value, `mod ${names[i % 5]} `);
		assert.equal(s.cursor, s.value.length);
	}
	const back = step(s, shiftTab, r1.env).state;
	assert.equal(back.value, 'mod install ');
	const wrap = step(back, shiftTab, r1.env).state;
	assert.equal(wrap.value, 'mod help ');
});

test('cycling keeps showing the frozen list with the current selection', () => {
	const r = run([...typed('mod '), tab, tab]);
	const v = visibleHints(r.state, r.env)!;
	assert.equal(v.items.length, 5);
	assert.equal(r.state.sel, 1);
	assert.equal(ghostText(r.state, r.env), '');
});

test('Shift+Tab accepts the last item then cycles', () => {
	const r = run([...typed('mod '), shiftTab]);
	assert.equal(r.state.value, 'mod help ');
	const r2 = step(r.state, shiftTab, r.env);
	assert.equal(r2.state.value, 'mod list ');
});

test('Esc during cycling restores the original and dismisses', () => {
	const cyc = run([...typed('mod '), tab, tab, esc]);
	assert.equal(cyc.state.value, 'mod ');
	assert.equal(cyc.state.dismissed, true);
	assert.equal(cyc.state.cycle, undefined);
});

test('Enter while cycling executes the visible line', () => {
	const r = run([...typed('mod '), tab, tab, enter]);
	assert.equal(r.last.effect, 'submit');
	assert.equal(r.last.line, 'mod update ');
});

test('any other key leaves cycling and acts normally', () => {
	const r = run([...typed('mod '), tab, text('x')]);
	assert.equal(r.state.value, 'mod install x');
	assert.equal(r.state.cycle, undefined);
	const b = run([...typed('mod '), tab, key('backspace')]);
	assert.equal(b.state.value, 'mod install');
	const l = run([...typed('mod '), tab, key('leftArrow')]);
	assert.equal(l.state.cycle, undefined);
	assert.equal(l.state.cursor, 11);
});

test('Up/Down preview without changing the value, wrapping', () => {
	const base = run(typed('mod '));
	const d = step(base.state, down, base.env).state;
	assert.equal(d.value, 'mod ');
	assert.equal(d.sel, 1);
	assert.equal(d.navigated, true);
	const u = step(base.state, up, base.env).state;
	assert.equal(u.sel, 4);
	const w = run([...typed('mod '), down, down, down, down, down]).state;
	assert.equal(w.sel, 0);
});

test('Enter after Up/Down accepts without executing, the second Enter executes', () => {
	const r = run([...typed('mod '), down, enter]);
	assert.equal(r.last.effect, undefined);
	assert.equal(r.state.value, 'mod update ');
	assert.equal(r.state.navigated, false);
	assert.equal(r.state.cycle, undefined);
	const r2 = step(r.state, enter, r.env);
	assert.equal(r2.effect, 'submit');
	assert.equal(r2.line, 'mod update ');
});

test('Tab while previewing accepts the highlighted item', () => {
	const r = run([...typed('mod '), down, down, tab]);
	assert.equal(r.state.value, 'mod remove ');
	assert.ok(r.state.cycle);
});

test('Esc while previewing returns to suggesting, a second Esc dismisses', () => {
	const r = run([...typed('mod '), down, esc]);
	assert.equal(r.state.navigated, false);
	assert.equal(r.state.sel, 0);
	assert.equal(r.state.dismissed, false);
	const r2 = step(r.state, esc, r.env);
	assert.equal(r2.state.dismissed, true);
	assert.equal(visibleHints(r2.state, r.env), undefined);
});

test('typing while previewing resets the selection', () => {
	const r = run([...typed('mod '), down, down, text('r')]);
	assert.equal(r.state.sel, 0);
	assert.equal(r.state.navigated, false);
	assert.equal(r.state.value, 'mod r');
});

test('Backspace re-filters and resets the selection', () => {
	const r = run([...typed('mod ins'), key('backspace')]);
	assert.equal(r.state.value, 'mod in');
	assert.equal(r.state.sel, 0);
	assert.ok(visibleHints(r.state, r.env));
	const empty = run([...typed('e'), key('backspace')]);
	assert.equal(empty.state.value, '');
	assert.equal(visibleHints(empty.state, empty.env), undefined);
});

test('Delete behaves like Backspace', () => {
	assert.equal(run([...typed('ab'), key('delete')]).state.value, 'a');
});

test('history: an empty line goes to history', () => {
	const r = run([up], ['one', 'two']);
	assert.equal(r.state.value, 'two');
	assert.equal(r.state.historyIndex, 0);
	assert.equal(run([up, up, down], ['one', 'two']).state.value, 'two');
});

test('history: recall disables hints, Up/Down keep browsing', () => {
	const r = run([up, up], ['exit', 'echo hi', 'ex']);
	assert.equal(r.state.value, 'echo hi');
	assert.equal(visibleHints(r.state, r.env), undefined);
	const back = step(r.state, down, r.env).state;
	assert.equal(back.value, 'ex');
});

test('history: Esc on a visible list lets Up reach history', () => {
	const r = run([...typed('ex'), esc, up], ['older']);
	assert.equal(r.state.value, 'older');
	const stay = run([...typed('ex'), up], ['older']);
	assert.equal(stay.state.value, 'ex');
	assert.equal(stay.state.sel, 0);
});

test('history: Down on a fresh line and Up without history keep the text', () => {
	assert.equal(run([...typed('zzz'), down]).state.value, 'zzz');
	assert.equal(run([...typed('zzz'), esc, up], []).state.value, 'zzz');
	assert.equal(run([...typed('zzz'), up], []).state.value, 'zzz');
});

test('Right at the end with a ghost accepts without cycling', () => {
	const r = run([...typed('ex'), key('rightArrow')]);
	assert.equal(r.state.value, 'exit ');
	assert.equal(r.state.cycle, undefined);
	const e = run([...typed('mod i'), key('end')]);
	assert.equal(e.state.value, 'mod i ');
});

test('Right and End without a ghost only move the cursor', () => {
	const fuzzy = run([...typed('xt'), key('rightArrow')]);
	assert.equal(fuzzy.state.value, 'xt');
	const mid = run([...typed('exit'), key('leftArrow'), key('leftArrow'), key('rightArrow')]);
	assert.equal(mid.state.cursor, 3);
	const toEnd = run([...typed('exit'), key('home'), key('end')]);
	assert.equal(toEnd.state.cursor, 4);
	assert.equal(toEnd.state.value, 'exit');
});

test('navigated preview on a fuzzy match does not apply Right', () => {
	const r = run([...typed('xt'), down, key('rightArrow')]);
	assert.equal(r.state.value, 'xt');
});

test('a chunk is text even with tab or carriage return inside', () => {
	const r = run([...typed('ex'), text('a\tb\rc\nd')]);
	assert.equal(r.state.value, 'exa b c d');
	assert.equal(r.last.effect, undefined);
	assert.equal(r.state.cycle, undefined);
});

test('paste inserts sanitised text once and never accepts', () => {
	const r = run([...typed('mod '), {input: '', paste: 'ins\ttall\u001b[31m\u001b]0;x\u0007!'}]);
	assert.equal(r.state.value, 'mod ins tall!');
	assert.equal(r.last.effect, undefined);
	assert.equal(run([{input: '', paste: ''}]).state, initialState);
});

test('sanitizeInsert', () => {
	assert.equal(sanitizeInsert('a\tb\nc\rd'), 'a b c d');
	assert.equal(sanitizeInsert('a\u001b[Ab'), 'ab');
	assert.equal(sanitizeInsert('x\u0000y\u007fz\u009bq'), 'xyzq'.slice(0, 3));
	assert.equal(sanitizeInsert('a' + String.fromCharCode(0x2028) + 'b' + String.fromCharCode(0x85) + 'c'), 'a b c');
	assert.equal(sanitizeInsert('‮evil​'), 'evil');
	assert.equal(sanitizeInsert('日本😀'), '日本😀');
	assert.equal(sanitizeInsert('\u001b'), '');
	assert.equal(sanitizeInsert(String.fromCharCode(0xd800)), String.fromCharCode(0xfffd));
	assert.equal(sanitizeInsert(undefined as never), '');
	assert.ok(sanitizeInsert('a'.repeat(100000)).length <= 8192);
});

test('cursor and Backspace move by grapheme', () => {
	const family = '👨‍👩‍👧';
	const s = run([...typed('a'), text(family), text('é'), text('日')]).state;
	assert.equal(s.value, 'a' + family + 'é日');
	const l1 = run([key('leftArrow')], [], s).state;
	assert.equal(l1.cursor, s.value.length - 1);
	const l2 = run([key('leftArrow'), key('leftArrow')], [], s).state;
	assert.equal(l2.cursor, 1 + family.length);
	const l3 = run([key('leftArrow'), key('leftArrow'), key('leftArrow')], [], s).state;
	assert.equal(l3.cursor, 1);
	const r = run([key('leftArrow'), key('leftArrow'), key('rightArrow')], [], s).state;
	assert.equal(r.cursor, s.value.length - 1);
	const b = run([key('backspace'), key('backspace')], [], s).state;
	assert.equal(b.value, 'a' + family);
	assert.equal(run([key('backspace')], [], b).state.value, 'a');
});

test('Home, Ctrl+A, Ctrl+E and Ctrl+U', () => {
	const s = run(typed('hello')).state;
	assert.equal(run([key('home')], [], s).state.cursor, 0);
	assert.equal(run([ctrl('a')], [], s).state.cursor, 0);
	assert.equal(run([ctrl('a'), ctrl('e')], [], s).state.cursor, 5);
	const cut = run([key('leftArrow'), key('leftArrow'), ctrl('u')], [], s).state;
	assert.equal(cut.value, 'lo');
	assert.equal(cut.cursor, 0);
	assert.equal(run([ctrl('u')], [], s).state.value, '');
});

test('leaving the end of the line hides hints and clears the selection state', () => {
	const r = run([...typed('mod '), down, key('leftArrow')]);
	assert.equal(r.state.navigated, false);
	assert.equal(visibleHints(r.state, r.env), undefined);
	assert.equal(step(r.state, enter, r.env).effect, 'submit');
});

test('Tab, Shift+Tab and Esc are no-ops when idle', () => {
	const s = run(typed('zzz')).state;
	for (const k of [tab, shiftTab, esc]) assert.equal(step(s, k, env()).state, s);
	assert.equal(step(initialState, tab, env()).state, initialState);
});

test('unknown keys leave the state unchanged', () => {
	const s = run(typed('ex')).state;
	for (const k of [key('pageUp'), key('pageDown'), {input: 'b', meta: true}, ctrl('w'), ctrl('k'), {input: ''}]) {
		assert.equal(step(s, k, env()).state, s);
	}
});

test('step is total on malformed state and a failing hints function', () => {
	const bad = {value: 'ex', cursor: 99, historyIndex: 7, sel: NaN, navigated: true, dismissed: false} as PromptState;
	const throwing = {history: [], hints: () => { throw new Error('boom'); }};
	const garbage = {history: [], hints: () => ({stage: 'sub', items: null}) as never};
	const keys = [text('a'), tab, shiftTab, esc, up, down, enter, key('leftArrow'), key('rightArrow'), key('end'), key('home'), key('backspace')];
	for (const e of [throwing, garbage, env()]) {
		for (const k of keys) {
			assert.doesNotThrow(() => step(bad, k, e));
			const withCycle = {...bad, cycle: {start: -3, len: 99, original: 'x', items: [], result: {} as never}};
			assert.doesNotThrow(() => step(withCycle, k, e));
		}
	}
	assert.doesNotThrow(() => step(bad, null as never, env()));
});

test('usage-only results are visible but not interactive', () => {
	const r = run(typed('claude ask '));
	const v = visibleHints(r.state, r.env)!;
	assert.equal(v.items.length, 0);
	assert.ok(v.usage);
	assert.equal(ghostText(r.state, r.env), '');
	assert.ok(visibleHints(run(typed('mod remove x')).state, r.env));
	assert.equal(visibleHints(run(typed('claude auth login ')).state, r.env)!.items.length, 0);
});

test('usage-only: Tab and Shift+Tab are no-ops, Up and Down reach history', () => {
	const r = run(typed('claude ask '), ['older']);
	assert.equal(step(r.state, tab, r.env).state, r.state);
	assert.equal(step(r.state, shiftTab, r.env).state, r.state);
	const u = step(r.state, up, r.env).state;
	assert.equal(u.value, 'older');
	assert.equal(u.navigated, false);
	assert.equal(visibleHints(u, r.env), undefined);
});

test('usage-only: Enter executes the typed line and Right moves nothing', () => {
	const r = run([...typed('claude ask '), enter]);
	assert.equal(r.last.effect, 'submit');
	assert.equal(r.last.line, 'claude ask ');
	const e = run([...typed('claude ask '), key('rightArrow')]);
	assert.equal(e.state.value, 'claude ask ');
});

test('usage-only: Esc dismisses the usage row', () => {
	const r = run([...typed('claude ask '), esc]);
	assert.equal(r.state.dismissed, true);
	assert.equal(r.state.value, 'claude ask ');
	assert.equal(visibleHints(r.state, r.env), undefined);
	assert.equal(visibleHints(run([...typed('claude ask '), key('leftArrow')]).state, r.env), undefined);
});

const left = key('leftArrow');

test('clickCursor moves to a grapheme index in code units and clamps', () => {
	const s: PromptState = {...initialState, value: 'a\u{1F600}b', cursor: 4};
	assert.equal(clickCursor(s, 0).cursor, 0);
	assert.equal(clickCursor(s, 1).cursor, 1);
	assert.equal(clickCursor(s, 2).cursor, 3);
	assert.equal(clickCursor(s, 3).cursor, 4);
	assert.equal(clickCursor(s, 99).cursor, 4);
	assert.equal(clickCursor(s, -5).cursor, 0);
	assert.equal(clickCursor(s, Number.NaN).cursor, 0);
	assert.equal(clickCursor(s, 1).value, 'a\u{1F600}b');
});

test('clickCursor resets the selection like a cursor key and keeps history', () => {
	const r = run([...typed('e'), down]);
	assert.equal(r.state.navigated, true);
	const c = clickCursor(r.state, 0);
	assert.equal(c.sel, 0);
	assert.equal(c.navigated, false);
	assert.deepEqual(c, step(r.state, left, r.env).state);
	const h = run([key('upArrow')], ['echo hi']);
	assert.equal(h.state.historyIndex, 0);
	const hc = clickCursor(h.state, 2);
	assert.equal(hc.historyIndex, 0);
	assert.equal(hc.value, 'echo hi');
	assert.equal(hc.cursor, 2);
});

test('clickCursor during a Tab cycle keeps the value and ends the cycle', () => {
	const r = run([...typed('mod '), tab, tab]);
	assert.ok(r.state.cycle);
	const c = clickCursor(r.state, 1);
	assert.equal(c.value, 'mod update ');
	assert.equal(c.cursor, 1);
	assert.equal(c.cycle, undefined);
});

test('clickHint accepts the item like Enter after navigation', () => {
	const r = run(typed('ec'));
	const h = visibleHints(r.state, r.env)!;
	const i = h.items.findIndex(x => x.insert === 'echo');
	assert.ok(i >= 0);
	const c = clickHint(r.state, i, r.env);
	assert.equal(c.value, 'echo ');
	assert.equal(c.cursor, 5);
	assert.equal(c.cycle, undefined);
	const downs = i === 0 ? h.items.length : i;
	const nav = run([...typed('ec'), ...Array.from({length: downs}, () => down), enter]);
	assert.equal(nav.last.effect, undefined);
	assert.deepEqual(c, nav.state);
});

test('clickHint during a Tab cycle accepts the clicked item and ends the cycle', () => {
	const r = run([...typed('mod '), tab, tab]);
	assert.equal(r.state.value, 'mod update ');
	const c = clickHint(r.state, 2, r.env);
	assert.equal(c.value, 'mod remove ');
	assert.equal(c.cursor, c.value.length);
	assert.equal(c.cycle, undefined);
	const first = clickHint(r.state, 0, r.env);
	assert.equal(first.value, 'mod install ');
});

test('clickHint changes nothing out of range, after dismissal or on usage only', () => {
	const r = run(typed('ec'));
	const n = visibleHints(r.state, r.env)!.items.length;
	for (const i of [-1, n, 99, 0.5, Number.NaN]) assert.equal(clickHint(r.state, i, r.env), r.state);
	const d = run([...typed('ec'), esc]);
	assert.equal(d.state.dismissed, true);
	assert.equal(clickHint(d.state, 0, d.env), d.state);
	const u = run(typed('echo '));
	const v = visibleHints(u.state, u.env);
	assert.ok(v && v.items.length === 0 && v.usage);
	assert.equal(clickHint(u.state, 0, u.env), u.state);
	assert.equal(clickHint(initialState, 0, r.env), initialState);
});

test('clickCursor and clickHint are total', () => {
	const bad = {value: 5, cursor: 'x'} as unknown as PromptState;
	assert.doesNotThrow(() => clickCursor(bad, 1));
	assert.doesNotThrow(() => clickHint(bad, 0, env()));
	const throwing = {
		history: [],
		hints: () => {
			throw new Error('boom');
		},
	};
	const s = run(typed('ec')).state;
	assert.equal(clickHint(s, 0, throwing), s);
});

test('Tab with nothing to complete reports the tab effect; with hints it completes; Shift+Tab never reports it', () => {
	assert.equal(run([tab]).last.effect, 'tab');
	assert.equal(run([...typed('zzzz'), tab]).last.effect, 'tab');
	const completed = run([...typed('ec'), tab]);
	assert.equal(completed.last.effect, undefined);
	assert.notEqual(completed.state.value, 'ec');
	assert.equal(run([shiftTab]).last.effect, undefined);
});
