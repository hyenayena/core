import React from 'react';
import {Box, Text} from 'ink';
import {sanitizeBlock} from '../hints/sanitize.js';
import {TONE_THEME, type FrameRow} from './types.js';
import {colorDepth, inkTone} from './theme.js';

export function Frame({rows, width}: {rows: FrameRow[]; width: number}) {
	const depth = colorDepth();
	const rule = '─'.repeat(Math.max(2, Math.min(width, 72)));
	return (
		<Box flexDirection="column">
			<Text dimColor wrap="truncate">{`┌${rule}`}</Text>
			{rows.map((row, i) => (
				<Text key={i} wrap="truncate" {...(TONE_THEME[row.tone] === null ? {} : inkTone(TONE_THEME[row.tone]!, depth))}>
					{`│ ${sanitizeBlock(row.text).replace(/\n/g, ' ')}`}
				</Text>
			))}
			<Text dimColor wrap="truncate">{`└${rule}`}</Text>
		</Box>
	);
}
