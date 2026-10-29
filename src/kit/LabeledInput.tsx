import React from 'react';
import {Box, Text} from 'ink';
import {stringCells} from '../hints/width.js';
import {inputRowCount, inputWindow} from './input-window.js';

export type LabeledInputProps = {
	label: string;
	text: string;
	columns: number;
	maxRows: number;
	labelColor?: string;
	focused?: boolean;
};

const textCells = (label: string, columns: number) => Math.max(2, Math.floor(columns) - stringCells(label));

export function labeledInputRows(label: string, text: string, columns: number): number {
	return inputRowCount(text, textCells(label, columns));
}

export function LabeledInput({label, text, columns, maxRows, labelColor, focused = true}: LabeledInputProps) {
	const rows = inputWindow(text, text.length, textCells(label, columns), Math.max(1, Math.floor(maxRows) || 1));
	const pad = ' '.repeat(stringCells(label));
	return (
		<Box flexDirection="column">
			{rows.map((row, i) => (
				<Box key={i} flexShrink={0}>
					<Text wrap="truncate-end">
						{i === 0 ? <Text color={labelColor}>{label}</Text> : pad}
						{row.before}
						{row.cell !== null && <Text inverse={focused}>{row.cell}</Text>}
						{row.after}
					</Text>
				</Box>
			))}
		</Box>
	);
}
