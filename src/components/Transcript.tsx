import React from 'react';
import {Box, Text} from 'ink';

export type TranscriptLine = {id: number; text: string; color?: string};

export const scrollHint = (newer: number) => `↓ ${newer} newer line${newer === 1 ? '' : 's'} · PgDn or Shift+↓`;

/**
 * The scrollback of the full-screen app. `scroll` counts logical lines hidden below the
 * view; the last lines before them are drawn bottom-up and the overflow is clipped at the top.
 */
export default function Transcript({lines, scroll, maxRows}: {lines: TranscriptLine[]; scroll: number; maxRows: number}) {
	const end = Math.max(0, lines.length - scroll);
	// Every line takes at least one row, so this many always fills the view.
	const visible = lines.slice(Math.max(0, end - Math.max(1, maxRows)), end);
	return (
		<>
			<Box flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="flex-end" overflow="hidden">
				{visible.map(line => (
					<Box key={line.id} flexShrink={0}>
						<Text color={line.color}>{line.text === '' ? ' ' : line.text}</Text>
					</Box>
				))}
			</Box>
			{scroll > 0 && (
				<Box flexShrink={0}>
					<Text dimColor wrap="truncate-end">
						{scrollHint(scroll)}
					</Text>
				</Box>
			)}
		</>
	);
}
