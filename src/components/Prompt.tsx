import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, measureElement, useInput, usePaste, useWindowSize, type DOMElement, type Key} from 'ink';
import type {Catalog} from '../hints/catalog.js';
import {computeHints} from '../hints/model.js';
import {
	clickCursor,
	clickHint,
	ghostText,
	initialState,
	step,
	visibleHints,
	type KeyInput,
	type PromptState,
	type StepEnv,
} from '../hints/editor.js';
import {layoutHints, type HintRow} from '../hints/layout.js';
import {indexAtCell, windowLine, type Windowed} from '../hints/viewport.js';
import {c} from '../hints/style.js';
import {graphemes, stringCells} from '../hints/width.js';
import Hints from './Hints.js';
import type {MouseInputEvent} from '../mouse/sgr.js';

type Props = {
	prompt?: string;
	history: string[];
	catalog: Catalog;
	onSubmit: (line: string) => void;
	onInterrupt: () => void;
	columns?: number;
	rows?: number;
	active?: boolean;
	onLeftEdge?: () => void;
	onIdleTab?: () => void;
	isHostKey?: (input: string, key: Key) => boolean;
	mouseRef?: React.MutableRefObject<((e: MouseInputEvent) => boolean) | null>;
};

type Rendered = {
	state: PromptState;
	win: Windowed;
	length: number;
	cursor: number;
	promptWidth: number;
	rows: HintRow[];
};

function toKeyInput(input: string, key: Key): KeyInput {
	return {
		input,
		upArrow: key.upArrow,
		downArrow: key.downArrow,
		leftArrow: key.leftArrow,
		rightArrow: key.rightArrow,
		home: key.home,
		end: key.end,
		pageUp: key.pageUp,
		pageDown: key.pageDown,
		return: key.return,
		escape: key.escape,
		tab: key.tab,
		shift: key.shift,
		backspace: key.backspace,
		delete: key.delete,
		ctrl: key.ctrl,
		meta: key.meta,
	};
}

function graphemeIndex(value: string, cursor: number): number {
	let units = 0;
	let index = 0;
	for (const g of graphemes(value)) {
		if (units >= cursor) break;
		units += g.length;
		index++;
	}
	return index;
}

export default function Prompt({
	prompt = '> ',
	history,
	catalog,
	onSubmit,
	onInterrupt,
	active = true,
	onLeftEdge,
	onIdleTab,
	isHostKey,
	mouseRef,
	...size
}: Props) {
	const stateRef = useRef<PromptState>(initialState);
	const [state, setState] = useState<PromptState>(initialState);
	const historyRef = useRef(history);
	historyRef.current = history;
	const terminal = useWindowSize();
	const columns = size.columns ?? terminal.columns;
	const rows = size.rows ?? terminal.rows;

	const env = useMemo<StepEnv>(
		() => ({
			get history() {
				return historyRef.current;
			},
			hints: value => computeHints(catalog, value),
		}),
		[catalog],
	);

	const apply = (key: KeyInput) => {
		const result = step(stateRef.current, key, env);
		stateRef.current = result.state;
		setState(result.state);
		if (result.effect === 'interrupt') onInterrupt();
		else if (result.effect === 'submit') onSubmit(result.line ?? '');
		else if (result.effect === 'tab') onIdleTab?.();
	};

	useInput(
		(input, key) => {
			if (isHostKey?.(input, key)) return;
			if (key.pageUp || key.pageDown || (key.shift && (key.upArrow || key.downArrow))) return;
			if (key.leftArrow && onLeftEdge && stateRef.current.value === '') return onLeftEdge();
			apply(toKeyInput(input, key));
		},
		{isActive: active},
	);
	usePaste(text => apply({input: '', paste: text}), {isActive: active});

	const hints = visibleHints(state, env);
	const ghost = ghostText(state, env);
	const hintRows = hints ? layoutHints(hints, {sel: state.sel}, {columns, rows}) : [];

	const gs = graphemes(state.value);
	const promptCells = graphemes(prompt).length;
	const cursorIndex = graphemeIndex(state.value, state.cursor);
	const win = windowLine(gs, cursorIndex, ghost, columns - 1 - promptCells);
	const ghostCell = ghost !== '' && state.cursor >= state.value.length;

	const rootRef = useRef<DOMElement>(null);
	const rendered = useRef<Rendered | null>(null);
	rendered.current = {
		state,
		win,
		length: gs.length,
		cursor: cursorIndex,
		promptWidth: stringCells(prompt),
		rows: hintRows,
	};

	const onMouse = (e: MouseInputEvent): boolean => {
		if (e.kind !== 'press' || e.button !== 'left') return false;
		const view = rendered.current;
		const node = rootRef.current;
		if (!view || !node || view.state !== stateRef.current) return false;
		const box = measureElement(node);
		const x = e.x - box.x;
		const y = e.y - box.y;
		if (x < 0 || y < 0 || x >= box.width || y >= box.height) return false;
		let next: PromptState;
		if (y === 0) {
			next = clickCursor(view.state, indexAtCell(view.win, view.length, view.cursor, x - view.promptWidth));
		} else {
			const row = view.rows[y - 1];
			if (row?.kind !== 'item' || row.item === undefined) return false;
			next = clickHint(view.state, row.item, env);
			if (next === view.state) return false;
		}
		stateRef.current = next;
		setState(next);
		return true;
	};
	const onMouseRef = useRef(onMouse);
	onMouseRef.current = onMouse;

	useEffect(() => {
		if (!mouseRef) return;
		const handler = (e: MouseInputEvent) => onMouseRef.current(e);
		mouseRef.current = handler;
		return () => {
			if (mouseRef.current === handler) mouseRef.current = null;
		};
	}, [mouseRef]);

	return (
		<Box ref={rootRef} flexDirection="column">
			<Text wrap="truncate-end">
				<Text color={c('cyan')} dimColor={!active}>
					{prompt}
				</Text>
				{win.before}
				<Text inverse={active} dimColor={ghostCell}>
					{win.cursorCell || ' '}
				</Text>
				{win.after}
				<Text dimColor>{win.ghost}</Text>
			</Text>
			<Hints rows={hintRows} />
		</Box>
	);
}
