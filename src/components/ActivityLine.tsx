import React from 'react';
import {Text} from 'ink';
import {activityRow, type ActivityReport} from '../kit/activity.js';
import {asciiGlyphs} from '../kit/glyphs.js';
import {useSpinnerTick} from '../kit/Spinner.js';

export type ActivityLineProps = {
	items: readonly ActivityReport[];
	width: number;
};

export default function ActivityLine({items, width}: ActivityLineProps) {
	const frame = useSpinnerTick(items.some(i => i.state === 'running'));
	return <Text wrap="truncate-end">{activityRow(items, width, {frame, ascii: asciiGlyphs(process.env)})}</Text>;
}
