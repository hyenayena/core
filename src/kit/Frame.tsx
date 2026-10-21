import React from 'react';
import {Box, Text} from 'ink';
import {sanitizeBlock} from '../hints/sanitize.js';
import type {FrameRow, Tone} from './types.js';

const TONE: Record<Tone, {color?: string; dim?: boolean}> = {
	plain: {},
	dim: {dim: true},
	add: {color: 'green'},
	del: {color: 'red'},
	warn: {color: 'yellow'},
	info: {color: 'cyan'},
};

export function Frame({rows, width}: {rows: FrameRow[]; width: number}) {
	const rule = '─'.repeat(Math.max(2, Math.min(width, 72)));
	return (
		<Box flexDirection="column">
			<Text dimColor wrap="truncate">{`┌${rule}`}</Text>
			{rows.map((row, i) => (
				<Text key={i} wrap="truncate" color={TONE[row.tone].color} dimColor={TONE[row.tone].dim === true}>
					{`│ ${sanitizeBlock(row.text).replace(/\n/g, ' ')}`}
				</Text>
			))}
			<Text dimColor wrap="truncate">{`└${rule}`}</Text>
		</Box>
	);
}
