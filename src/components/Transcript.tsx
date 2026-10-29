import React, {type Ref} from 'react';
import {Box, Text, type DOMElement} from 'ink';
import type {VisibleRow} from '../transcript/scroll.js';
import {sliceStyledCells, stripStyles} from '../transcript/wrap.js';
import {sliceCells, truncateCells} from '../hints/width.js';

export const scrollHint = (newer: number, keys = 'PgDn or Shift+↓') =>
	`↓ ${newer} newer line${newer === 1 ? '' : 's'}${keys === '' ? '' : ` · ${keys}`}`;

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
	return (
		<Text color={row.color} wrap="truncate-end">
			{sliceStyledCells(row.text, 0, from)}
			<Text inverse>{sliceCells(stripStyles(row.text), from, to - from)}</Text>
			{sliceStyledCells(row.text, to, Number.MAX_SAFE_INTEGER)}
		</Text>
	);
}

export default function Transcript({
	rows,
	newer,
	boxRef,
	marks,
	notice,
	columns,
}: {
	rows: VisibleRow[];
	newer: number;
	boxRef?: Ref<DOMElement>;
	marks?: RowMarks | undefined;
	notice?: string | undefined;
	columns?: number | undefined;
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
						{columns === undefined ? scrollHint(newer) : truncateCells(scrollHint(newer), columns)}
					</Text>
				</Box>
			)}
		</>
	);
}
