import React, {useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import type {ViewHost} from '../../../../src/api.js';
import {sanitizeText} from '../hints/sanitize.js';
import {stringCells, truncateCells} from '../hints/width.js';
import {useViewHost} from '../view/use-view-host.js';
import type {PickerItem} from './types.js';
import {windowStart} from './window.js';

export interface ListPickerProps {
	title: string;
	empty: string;
	// Verb for Enter in the key hint, e.g. "resume".
	action: string;
	items: PickerItem[];
	// Applied before sanitising, e.g. a secret redactor; defaults to identity.
	scrub?: (s: string) => string;
	onPick: (id: string) => void;
	close: () => void;
	host?: ViewHost;
}

const identity = (s: string) => s;

/** A list in the console panel: ↑↓ select, Enter picks (and closes), Esc closes. */
export function ListPicker({title, empty, action, items, scrub = identity, onPick, close, host}: ListPickerProps) {
	const terminal = useWindowSize();
	const {focused, columns} = useViewHost(host);
	const rows = host?.rows?.() ?? terminal.rows - 1;
	const [cursor, setCursor] = useState(0);

	useInput(
		(input, key) => {
			if (host?.isHostKey(input, key)) return;
			if (key.escape || (key.ctrl && input === 'c')) return close();
			if (key.upArrow) return setCursor(i => Math.max(0, i - 1));
			if (key.downArrow) return setCursor(i => Math.min(items.length - 1, i + 1));
			if (key.return) {
				const item = items[cursor];
				if (item) {
					close();
					onPick(item.id);
				}
			}
		},
		{isActive: focused},
	);

	const clean = (s: string) => sanitizeText(scrub(s), 200);
	const width = Math.max(1, columns - 1);
	const budget = Math.max(1, rows - 2);
	const start = windowStart(items.length, budget, cursor);
	const visible = items.slice(start, start + budget);

	return (
		<Box flexDirection="column">
			<Box flexShrink={0}>
				<Text bold wrap="truncate-end">
					{truncateCells(items.length === 0 ? empty : title, width)}
				</Text>
			</Box>
			{visible.map((item, i) => {
				const selected = start + i === cursor;
				const meta = item.meta ? ` · ${clean(item.meta)}` : '';
				const label = truncateCells(`${selected ? '›' : ' '} ${clean(item.label)}`, Math.max(1, width - stringCells(meta)));
				return (
					<Box key={item.id} flexShrink={0}>
						<Text wrap="truncate-end" inverse={selected && focused}>
							{label}
							<Text dimColor>{meta}</Text>
						</Text>
					</Box>
				);
			})}
			<Box flexShrink={0}>
				<Text dimColor wrap="truncate-end">
					{truncateCells(items.length === 0 ? 'Esc close' : `↑↓ select · Enter ${action} · Esc close`, width)}
				</Text>
			</Box>
		</Box>
	);
}
