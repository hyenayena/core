import React from 'react';
import {Text} from 'ink';
import type {HintRow, Segment} from '../hints/layout.js';
import {inkTone} from '../kit/theme.js';

function segmentProps(seg: Segment) {
	return {
		...(seg.tone === undefined ? {} : inkTone(seg.tone)),
		...(seg.surface === true ? inkTone('surface') : {}),
		...(seg.bold === true ? {bold: true} : {}),
		...(seg.underline === true ? {underline: true} : {}),
		...(seg.inverse === true ? {inverse: true} : {}),
	};
}

export default function Hints({rows}: {rows: HintRow[]}) {
	return (
		<>
			{rows.map((row, r) => (
				<Text key={r} wrap="truncate-end">
					{row.segments.map((seg, i) => (
						<Text key={i} {...segmentProps(seg)}>
							{seg.text}
						</Text>
					))}
				</Text>
			))}
		</>
	);
}
