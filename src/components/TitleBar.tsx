import React from 'react';
import {Box, Text} from 'ink';
import {colorEnabled} from '../hints/style.js';
import {stringCells, truncateCells} from '../hints/width.js';

/** One inverse row: the title on the left, the detail right-aligned, the title shortened first. */
export function titleBarText(title: string, detail: string, columns: number): {left: string; right: string} {
	const width = Math.max(1, columns);
	const right = detail === '' ? '' : truncateCells(` ${detail} `, Math.max(0, width - 4));
	const room = Math.max(1, width - stringCells(right));
	const left = truncateCells(` ${title} `, room);
	return {left: left + ' '.repeat(Math.max(0, room - stringCells(left))), right};
}

export const TITLE_BAR_BG = '#808000';
const TITLE_BAR_FG = '#000000';

/** Olive with black text; with NO_COLOR an inverse bar. */
export function titleBarStyle(env: Record<string, string | undefined> = process.env) {
	return colorEnabled(env) ? {backgroundColor: TITLE_BAR_BG, color: TITLE_BAR_FG} : {inverse: true};
}

export default function TitleBar({title, detail, columns}: {title: string; detail: string; columns: number}) {
	const {left, right} = titleBarText(title, detail, columns);
	return (
		<Box flexShrink={0}>
			<Text {...titleBarStyle()} wrap="truncate-end">
				<Text bold>{left}</Text>
				{right}
			</Text>
		</Box>
	);
}
