import React, {type Ref} from 'react';
import {Box, Text, type DOMElement} from 'ink';
import type {VisibleRow} from '../transcript/scroll.js';

export const scrollHint = (newer: number, keys = 'PgDn or Shift+↓') =>
	`↓ ${newer} newer line${newer === 1 ? '' : 's'}${keys === '' ? '' : ` · ${keys}`}`;

/**
 * The scrollback of the full-screen app, as screen rows already wrapped to its width.
 * `newer` counts the rows hidden below the view; the overflow is clipped at the top.
 */
export default function Transcript({rows, newer, boxRef}: {rows: VisibleRow[]; newer: number; boxRef?: Ref<DOMElement>}) {
	return (
		<>
			<Box ref={boxRef} flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="flex-end" overflow="hidden">
				{rows.map(row => (
					<Box key={row.key} flexShrink={0}>
						<Text color={row.color} wrap="truncate-end">
							{row.text === '' ? ' ' : row.text}
						</Text>
					</Box>
				))}
			</Box>
			{newer > 0 && (
				<Box flexShrink={0}>
					<Text dimColor wrap="truncate-end">
						{scrollHint(newer)}
					</Text>
				</Box>
			)}
		</>
	);
}
