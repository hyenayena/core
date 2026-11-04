import React from 'react';
import {Text} from 'ink';
import {cleanRow, type SpanRow} from './boxes.js';
import {TONE_THEME} from './types.js';
import {colorDepth, inkTone} from './theme.js';

export type SpanRowsProps = {rows: readonly SpanRow[]};

export function SpanRows({rows}: SpanRowsProps) {
	const depth = colorDepth();
	return (
		<>
			{rows.map((row, i) => {
				const spans = cleanRow(row);
				return (
					<Text key={i} wrap="truncate">
						{spans.length === 0
							? ' '
							: spans.map((s, j) => {
									const theme = TONE_THEME[s.tone ?? 'plain'];
									const style = theme === null ? {} : inkTone(theme, depth);
									return (
										<Text key={j} {...style} bold={style.bold === true || s.bold === true} inverse={style.inverse === true || s.inverse === true}>
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
