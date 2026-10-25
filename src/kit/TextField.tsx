import React, {useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {ViewHost} from '../../../../src/api.js';
import {sanitizeText} from '../hints/sanitize.js';
import {c} from '../hints/style.js';
import {stringCells, truncateCells} from '../hints/width.js';
import {useViewHost} from '../view/use-view-host.js';

export interface TextFieldProps {
	label: string;
	// Shown dim under the label, e.g. what the value is for.
	hint?: string;
	initial?: string;
	// An empty value is submitted only when optional.
	optional?: boolean;
	// Returns an error message to show, or undefined when the value is fine.
	validate?: (value: string) => string | undefined;
	onSubmit: (value: string) => void;
	onCancel: () => void;
	host?: ViewHost;
	maxLength?: number;
}

const MAX = 1024;
// A paste arrives as one input; its control characters (newlines included) are dropped.
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g');

/** A one-line text input: typing appends, Backspace deletes, Enter submits, Esc cancels. */
export function TextField({label, hint, initial = '', optional = false, validate, onSubmit, onCancel, host, maxLength = MAX}: TextFieldProps) {
	const {focused, columns} = useViewHost(host);
	// Keys can arrive faster than renders (a paste, then Enter), so the ref holds the truth.
	const valueRef = useRef(initial);
	const [value, setValueState] = useState(initial);
	const setValue = (next: string) => {
		valueRef.current = next;
		setValueState(next);
	};
	const [error, setError] = useState<string | undefined>();
	const done = useRef(false);

	useInput(
		(input, key) => {
			if (done.current || host?.isHostKey(input, key)) return;
			if (key.escape || (key.ctrl && input === 'c')) {
				done.current = true;
				return onCancel();
			}
			if (key.return) {
				const v = valueRef.current.trim();
				if (v === '' && !optional) return setError('A value is needed');
				const problem = v === '' ? undefined : validate?.(v);
				if (problem) return setError(problem);
				done.current = true;
				return onSubmit(v);
			}
			setError(undefined);
			if (key.backspace || key.delete) setValue([...valueRef.current].slice(0, -1).join(''));
			else if (!key.ctrl && !key.meta) setValue((valueRef.current + input.replace(CONTROL, '')).slice(0, maxLength));
		},
		{isActive: focused},
	);

	const width = Math.max(1, columns - 1);
	// The end of a long value stays in view, where the typing happens.
	const shown = sanitizeText(value, maxLength);
	const room = Math.max(1, width - 3);
	let tail = shown;
	while (stringCells(tail) > room) tail = [...tail].slice(1).join('');
	return (
		<Box flexDirection="column">
			<Box flexShrink={0}>
				<Text bold wrap="truncate-end">
					{truncateCells(sanitizeText(label, 200), width)}
				</Text>
			</Box>
			{hint && (
				<Box flexShrink={0}>
					<Text dimColor wrap="truncate-end">
						{truncateCells(sanitizeText(hint, 200), width)}
					</Text>
				</Box>
			)}
			<Box flexShrink={0}>
				<Text wrap="truncate-end">
					{'› '}
					{tail}
					<Text inverse={focused}> </Text>
				</Text>
			</Box>
			{error && (
				<Box flexShrink={0}>
					<Text color={c('red')} wrap="truncate-end">
						{truncateCells(sanitizeText(error, 200), width)}
					</Text>
				</Box>
			)}
			<Box flexShrink={0}>
				<Text dimColor wrap="truncate-end">
					{truncateCells(`Enter ${optional ? 'next (empty skips)' : 'next'} · Esc cancel`, width)}
				</Text>
			</Box>
		</Box>
	);
}
