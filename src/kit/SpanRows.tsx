import React from 'react';
import {Text} from 'ink';
import {colorEnabled} from '../hints/style.js';
import {cleanRow, type SpanRow} from './boxes.js';
import {TONE_STYLE} from './types.js';

export type SpanRowsProps = {rows: readonly SpanRow[]};

export function SpanRows({rows}: SpanRowsProps) {
	const colors = colorEnabled();
	return (
		<>
			{rows.map((row, i) => {
				const spans = cleanRow(row);
				return (
					<Text key={i} wrap="truncate">
						{spans.length === 0
							? ' '
							: spans.map((s, j) => {
									const style = TONE_STYLE[s.tone ?? 'plain'];
									return (
										<Text
											key={j}
											color={colors ? style.color : undefined}
											dimColor={style.dim === true}
											bold={s.bold === true}
											inverse={s.inverse === true}
										>
											{s.text}
										</Text>
									);
								})}
					</Text>
				);
			})}
		</>
	);
}
