import React from 'react';
import {Box, Text} from 'ink';
import {colorEnabled} from '../hints/style.js';
import {getPrefs, type TitleBarColor} from '../view/prefs.js';
import {stringCells, truncateCells} from '../hints/width.js';

export function titleBarText(title: string, detail: string, columns: number): {left: string; right: string} {
	const width = Math.max(1, columns);
	const right = detail === '' ? '' : truncateCells(` ${detail} `, Math.max(0, width - 4));
	const room = Math.max(1, width - stringCells(right));
	const left = truncateCells(` ${title} `, room);
	return {left: left + ' '.repeat(Math.max(0, room - stringCells(left))), right};
}

const BAR: Record<Exclude<TitleBarColor, 'inverse'>, {backgroundColor: string; color: string}> = {
	olive: {backgroundColor: '#808000', color: '#000000'},
	blue: {backgroundColor: '#1f4e8c', color: '#ffffff'},
	teal: {backgroundColor: '#00796b', color: '#ffffff'},
	gray: {backgroundColor: '#5a5a5a', color: '#ffffff'},
};

export function titleBarStyle(env: Record<string, string | undefined> = process.env, color: TitleBarColor = getPrefs().titleBar) {
	return colorEnabled(env) && color !== 'inverse' ? BAR[color] : {inverse: true};
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
