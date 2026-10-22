import React from 'react';
import {Box, Text} from 'ink';
import {sanitizeBlock} from '../hints/sanitize.js';
import {tailRows} from './tail.js';

export type OutputTailProps = {lines: readonly string[]; width: number; rows: number; title?: string};

export function OutputTail({lines, width, rows, title}: OutputTailProps) {
	const titleRows = title !== undefined && rows > 1 ? 1 : 0;
	const clean = lines.map(line => sanitizeBlock(typeof line === 'string' ? line : String(line)));
	const tail = tailRows(clean, Math.max(1, width), rows - titleRows);
	const cut = tail.hiddenLines > 0;
	return (
		<Box flexDirection="column" flexShrink={0}>
			{titleRows > 0 && (
				<Text bold wrap="truncate-end">
					{sanitizeBlock(title!).replace(/\n/g, ' ')}
				</Text>
			)}
			{tail.rows.map((row, i) => (
				<Text key={i} dimColor={cut && i === 0} wrap="truncate-end">
					{row}
				</Text>
			))}
		</Box>
	);
}
