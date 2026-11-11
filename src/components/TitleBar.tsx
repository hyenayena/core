import React from 'react';
import {Box, Text} from 'ink';
import {inkTone, type InkToneProps} from '../kit/theme.js';
import {getPrefs, type TitleBarColor} from '../view/prefs.js';
import {stringCells, truncateCells} from '../hints/width.js';

export function titleBarText(title: string, detail: string, columns: number): {left: string; right: string} {
	const width = Math.max(1, columns);
	const right = detail === '' ? '' : truncateCells(` ${detail} `, Math.max(0, width - 4));
	const room = Math.max(1, width - stringCells(right));
	const left = truncateCells(` ${title} `, room);
	return {left: left + ' '.repeat(Math.max(0, room - stringCells(left))), right};
}

export function titleBarStyle(color: TitleBarColor = getPrefs().titleBar, focused = true): Readonly<InkToneProps> {
	if (!focused) return inkTone('frame');
	return color === 'inverse' ? {inverse: true} : inkTone(`titleBar.${color}`);
}

export default function TitleBar({title, detail, columns, focused = true}: {title: string; detail: string; columns: number; focused?: boolean}) {
	const {left, right} = titleBarText(title, detail, columns);
	return (
		<Box flexShrink={0}>
			<Text {...titleBarStyle(getPrefs().titleBar, focused)} wrap="truncate-end">
				<Text bold>{left}</Text>
				{right}
			</Text>
		</Box>
	);
}
