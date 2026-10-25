import React, {useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {ViewHost} from '../../../../src/api.js';
import {sanitizeText} from '../hints/sanitize.js';
import {truncateCells} from '../hints/width.js';
import {useViewHost} from '../view/use-view-host.js';

export interface SecretInputProps {
	// What is asked for, e.g. "Token for stripe-main". Sanitised.
	label: string;
	onSubmit: (value: string) => void;
	onCancel: () => void;
	host?: ViewHost;
	maxLength?: number;
	// Enter on an empty value submits '' (skip) instead of doing nothing.
	optional?: boolean;
}

const MAX = 8192;
// Pasted text arrives as one input; control characters (newlines of a paste included) are dropped.
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g');

/**
 * A one-line input that never shows what is typed: only how many characters it holds.
 * The value lives in a ref, so it is in no rendered output and no React state.
 */
export function SecretInput({label, onSubmit, onCancel, host, maxLength = MAX, optional = false}: SecretInputProps) {
	const {focused, columns} = useViewHost(host);
	const value = useRef('');
	const [length, setLength] = useState(0);
	const done = useRef(false);

	useInput(
		(input, key) => {
			if (done.current || host?.isHostKey(input, key)) return;
			if (key.escape || (key.ctrl && input === 'c')) {
				done.current = true;
				value.current = '';
				return onCancel();
			}
			if (key.return) {
				if (value.current === '' && !optional) return;
				done.current = true;
				const v = value.current;
				value.current = '';
				return onSubmit(v);
			}
			if (key.backspace || key.delete) {
				value.current = [...value.current].slice(0, -1).join('');
			} else if (!key.ctrl && !key.meta) {
				value.current = (value.current + input.replace(CONTROL, '')).slice(0, maxLength);
			}
			setLength([...value.current].length);
		},
		{isActive: focused},
	);

	const width = Math.max(1, columns - 1);
	const dots = '•'.repeat(Math.min(length, Math.max(0, width - 20)));
	return (
		<Box flexDirection="column">
			<Box flexShrink={0}>
				<Text bold wrap="truncate-end">
					{truncateCells(sanitizeText(label, 200), width)}
				</Text>
			</Box>
			<Box flexShrink={0}>
				<Text wrap="truncate-end">{truncateCells(`› ${dots}${length > 0 ? ` (${length})` : ''}`, width)}</Text>
			</Box>
			<Box flexShrink={0}>
				<Text dimColor wrap="truncate-end">
					{truncateCells(`Hidden input · Enter ${optional ? 'save (empty skips)' : 'save'} · Esc cancel`, width)}
				</Text>
			</Box>
		</Box>
	);
}
