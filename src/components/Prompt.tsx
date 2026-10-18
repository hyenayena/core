import React, {useMemo, useRef, useState} from 'react';
import {Box, Text, useInput, usePaste, useWindowSize, type Key} from 'ink';
import type {Catalog} from '../hints/catalog.js';
import {computeHints} from '../hints/model.js';
import {
	ghostText,
	initialState,
	step,
	visibleHints,
	type KeyInput,
	type PromptState,
	type StepEnv,
} from '../hints/editor.js';
import {layoutHints} from '../hints/layout.js';
import {windowLine} from '../hints/viewport.js';
import {c} from '../hints/style.js';
import {graphemes} from '../hints/width.js';
import Hints from './Hints.js';

type Props = {
	prompt?: string;
	history: string[];
	catalog: Catalog;
	onSubmit: (line: string) => void;
	onInterrupt: () => void;
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

export default function Prompt({prompt = '> ', history, catalog, onSubmit, onInterrupt}: Props) {
	// Keys can arrive faster than React re-renders, so the source of truth lives
	// in a ref and the state copy only drives rendering.
	const stateRef = useRef<PromptState>(initialState);
	const [state, setState] = useState<PromptState>(initialState);
	const historyRef = useRef(history);
	historyRef.current = history;
	const {columns, rows} = useWindowSize();

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
	};

	useInput((input, key) => apply(toKeyInput(input, key)));
	usePaste(text => apply({input: '', paste: text}));

	const hints = visibleHints(state, env);
	const ghost = ghostText(state, env);
	const hintRows = hints ? layoutHints(hints, {sel: state.sel}, {columns, rows}) : [];

	const gs = graphemes(state.value);
	const promptCells = graphemes(prompt).length;
	const win = windowLine(gs, graphemeIndex(state.value, state.cursor), ghost, columns - 1 - promptCells);
	const ghostCell = ghost !== '' && state.cursor >= state.value.length;

	return (
		<Box flexDirection="column">
			<Text wrap="truncate-end">
				<Text color={c('cyan')}>{prompt}</Text>
				{win.before}
				<Text inverse dimColor={ghostCell}>
					{win.cursorCell || ' '}
				</Text>
				{win.after}
				<Text dimColor>{win.ghost}</Text>
			</Text>
			<Hints rows={hintRows} />
		</Box>
	);
}
