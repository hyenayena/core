import React from 'react';
import {Text} from 'ink';
import {brailleCells, brailleRows, type BrailleCell, type DotState} from './braille.js';
import {c} from '../hints/style.js';

export type BrailleBarProps = {states: readonly DotState[]; width: number; maxRows?: number; focus?: number};

const COLOR = {add: 'green', del: 'red', warn: 'yellow'} as const;

function Cell({cell}: {cell: BrailleCell}) {
	if (cell.tone === 'dim') return <Text dimColor>{cell.glyph}</Text>;
	if (cell.tone === 'plain' || cell.tone === 'info') return <Text>{cell.glyph}</Text>;
	const color = c(COLOR[cell.tone]);
	return (
		<Text color={color} inverse={color === undefined && cell.tone === 'del'}>
			{cell.glyph}
		</Text>
	);
}

export function BrailleBar({states, width, maxRows, focus}: BrailleBarProps) {
	const options = {...(maxRows === undefined ? {} : {maxRows}), ...(focus === undefined ? {} : {focus})};
	const {rows} = brailleRows(brailleCells(states), width, options);
	return (
		<>
			{rows.map((row, r) => (
				<Text key={r} wrap="truncate">
					{row.map((cell, i) => (
						<Cell key={i} cell={cell} />
					))}
				</Text>
			))}
		</>
	);
}
