import React, {type ReactNode, type Ref} from 'react';
import {Box, Text, type DOMElement} from 'ink';
import {asciiGlyphs} from '../kit/glyphs.js';
import {inkTone} from '../kit/theme.js';
import {panelTitleRow} from '../panel/title.js';
import type {PanelRow} from '../panel/sections.js';
import {scrollHint} from './Transcript.js';
import {sliceStyledCells, styledCells} from '../transcript/wrap.js';

export type ConsolePanelProps = {
	panelRef: Ref<DOMElement>;
	bodyRef: Ref<DOMElement>;
	outputRef: Ref<DOMElement>;
	columns: number;
	height: number;
	width: number;
	focused: boolean;
	dragging: boolean;
	split: boolean;
	folds: 'unfold' | 'fold' | undefined;
	activity: string;
	hasView: boolean;
	rows: readonly PanelRow[];
	newer: number;
	children: ReactNode;
};

export default function ConsolePanel(p: ConsolePanelProps) {
	const fit = (text: string) => (styledCells(text) <= p.width ? text : sliceStyledCells(text, 0, p.width - 1) + '…');
	const border = inkTone(p.dragging ? 'accent' : p.focused ? 'focus' : 'frame');
	const title = panelTitleRow({
		focused: p.focused,
		split: p.split,
		...(p.folds !== undefined && {folds: p.folds}),
		width: p.width,
		ascii: asciiGlyphs(process.env),
	});
	return (
		<Box
			ref={p.panelRef}
			flexDirection="column"
			width={p.columns}
			height={p.height}
			borderStyle="single"
			borderTop={false}
			borderRight={false}
			borderBottom={false}
			{...(border.color !== undefined && {borderColor: border.color})}
			{...(border.dimColor && {borderDimColor: true})}
			paddingLeft={1}
		>
			<Box flexShrink={0}>
				<Text wrap="truncate-end">{title}</Text>
			</Box>
			{!p.hasView && p.activity !== '' && (
				<Box flexShrink={0}>
					<Text wrap="truncate-end">{p.activity}</Text>
				</Box>
			)}
			{!p.hasView && (
				<Box ref={p.outputRef} flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="flex-end" overflow="hidden">
					{p.rows.map(row => (
						<Box key={row.key} flexShrink={0}>
							<Text wrap="truncate-end">{row.text === '' ? ' ' : row.text}</Text>
						</Box>
					))}
				</Box>
			)}
			{!p.hasView && p.newer > 0 && (
				<Box flexShrink={0}>
					<Text {...inkTone('muted')} wrap="truncate-end">
						{fit(scrollHint(p.newer, ''))}
					</Text>
				</Box>
			)}
			<Box ref={p.bodyRef} flexDirection="column" flexShrink={0} overflow="hidden">
				{p.children}
			</Box>
		</Box>
	);
}
