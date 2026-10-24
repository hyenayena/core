import React, {type Ref} from 'react';
import {Box, Text, type DOMElement} from 'ink';
import type {VisibleRow} from '../transcript/scroll.js';
import {sliceStyledCells, stripStyles} from '../transcript/wrap.js';
import {sliceCells} from '../hints/width.js';

export const scrollHint = (newer: number, keys = 'PgDn or Shift+↓') =>
	`↓ ${newer} newer line${newer === 1 ? '' : 's'}${keys === '' ? '' : ` · ${keys}`}`;

/** The selected cells [from, to) of a row, or undefined. */
export type RowMarks = (row: VisibleRow) => [number, number] | undefined;

function Row({row, cells}: {row: VisibleRow; cells: [number, number] | undefined}) {
	if (!cells) {
		return (
			<Text color={row.color} wrap="truncate-end">
				{row.text === '' ? ' ' : row.text}
			</Text>
		);
	}
	const [from, to] = cells;
	// The selected part is drawn plain and inverted; the rest keeps its styles.
	return (
		<Text color={row.color} wrap="truncate-end">
			{sliceStyledCells(row.text, 0, from)}
			<Text inverse>{sliceCells(stripStyles(row.text), from, to - from)}</Text>
			{sliceStyledCells(row.text, to, Number.MAX_SAFE_INTEGER)}
		</Text>
	);
}

/**
 * The scrollback of the full-screen app, as screen rows already wrapped to its width.
 * `newer` counts the rows hidden below the view; the overflow is clipped at the top.
 * `notice` is a short message drawn over the bottom right corner (it takes no row).
 */
export default function Transcript({
	rows,
	newer,
	boxRef,
	marks,
	notice,
}: {
	rows: VisibleRow[];
	newer: number;
	boxRef?: Ref<DOMElement>;
	marks?: RowMarks | undefined;
	notice?: string | undefined;
}) {
	return (
		<>
			<Box ref={boxRef} flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="flex-end" overflow="hidden">
				{rows.map(row => (
					<Box key={row.key} flexShrink={0}>
						<Row row={row} cells={marks?.(row)} />
					</Box>
				))}
				{notice !== undefined && (
					<Box position="absolute" bottom={0} right={1}>
						<Text inverse>{` ${notice} `}</Text>
					</Box>
				)}
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
