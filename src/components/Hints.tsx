import React from 'react';
import {Text} from 'ink';
import type {HintRow} from '../hints/layout.js';

export default function Hints({rows}: {rows: HintRow[]}) {
	return (
		<>
			{rows.map((row, r) => (
				<Text key={r} wrap="truncate-end">
					{row.segments.map((seg, i) => (
						<Text
							key={i}
							bold={seg.bold}
							underline={seg.underline}
							dimColor={seg.dim}
							inverse={seg.inverse}
							color={seg.color}
						>
							{seg.text}
						</Text>
					))}
				</Text>
			))}
		</>
	);
}
