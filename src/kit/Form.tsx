import React, {useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {ViewHost} from '../../../../src/api.js';
import {sanitizeText} from '../hints/sanitize.js';
import {c} from '../hints/style.js';
import {stringCells, truncateCells} from '../hints/width.js';
import {useViewHost} from '../view/use-view-host.js';

export type FormField = {
	id: string;
	label: string;
	value: string;
	placeholder?: string;
	readOnly?: boolean;
};

export type FormButton = {id: string; label: string};

export type FormValue = {id: string; label: string; value: string};

export interface FormProps {
	title?: string;
	fields: FormField[];
	buttons: FormButton[];
	add?: {label: string; validate?: (label: string, values: FormValue[]) => string | undefined};
	onButton: (id: string, values: FormValue[]) => string | undefined;
	onCancel: () => void;
	host?: ViewHost;
	maxLength?: number;
}

const MAX = 1024;
const LABEL_MAX = 64;
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g');

const errorOf = (fn: () => string | undefined): string | undefined => {
	try {
		return fn();
	} catch (error) {
		return (error as Error).message;
	}
};

export function Form({title, fields: initial, buttons, add, onButton, onCancel, host, maxLength = MAX}: FormProps) {
	const {focused, columns} = useViewHost(host);
	const fieldsRef = useRef<FormField[]>(initial.map(f => ({...f})));
	const rowRef = useRef(Math.max(0, initial.findIndex(f => !f.readOnly)));
	const buttonRef = useRef(0);
	const addingRef = useRef<string | undefined>(undefined);
	const addedRef = useRef(0);
	const done = useRef(false);
	const [error, setError] = useState<string | undefined>();
	const [, setTick] = useState(0);
	const render = () => setTick(n => n + 1);

	const addRow = () => (add ? fieldsRef.current.length : -1);
	const buttonsRow = () => fieldsRef.current.length + (add ? 1 : 0);
	const values = (): FormValue[] => fieldsRef.current.map(f => ({id: f.id, label: f.label, value: f.value.trim()}));
	const move = (step: 1 | -1) => {
		const rows = buttonsRow() + 1;
		rowRef.current = (rowRef.current + step + rows) % rows;
	};

	useInput(
		(input, key) => {
			if (done.current || host?.isHostKey(input, key)) return;
			if (key.ctrl && input === 'c') {
				done.current = true;
				return onCancel();
			}
			const row = rowRef.current;
			if (addingRef.current !== undefined) {
				if (key.escape) addingRef.current = undefined;
				else if (key.return) {
					const label = addingRef.current.trim();
					const problem = label === '' ? 'A name is needed' : errorOf(() => add?.validate?.(label, values()));
					if (problem) {
						setError(problem);
						return;
					}
					addingRef.current = undefined;
					fieldsRef.current = [...fieldsRef.current, {id: `added:${++addedRef.current}`, label, value: ''}];
					rowRef.current = fieldsRef.current.length - 1;
				} else if (key.backspace || key.delete) addingRef.current = [...addingRef.current].slice(0, -1).join('');
				else if (!key.ctrl && !key.meta && !key.tab) addingRef.current = (addingRef.current + input.replace(CONTROL, '')).slice(0, LABEL_MAX);
				setError(undefined);
				return render();
			}
			if (key.escape) {
				done.current = true;
				return onCancel();
			}
			setError(undefined);
			if (key.upArrow || (key.tab && key.shift)) move(-1);
			else if (key.downArrow || key.tab) move(1);
			else if (row === buttonsRow()) {
				if (key.leftArrow) buttonRef.current = (buttonRef.current - 1 + buttons.length) % buttons.length;
				else if (key.rightArrow) buttonRef.current = (buttonRef.current + 1) % buttons.length;
				else if (key.return) {
					const button = buttons[buttonRef.current];
					if (!button) return;
					const problem = errorOf(() => onButton(button.id, values()));
					if (problem) setError(problem);
					else done.current = true;
				}
			} else if (row === addRow()) {
				if (key.return) addingRef.current = '';
			} else if (key.return) move(1);
			else {
				const field = fieldsRef.current[row];
				if (field && !field.readOnly && !key.leftArrow && !key.rightArrow) {
					const value =
						key.backspace || key.delete ? [...field.value].slice(0, -1).join('') : key.ctrl || key.meta ? field.value : (field.value + input.replace(CONTROL, '')).slice(0, maxLength);
					fieldsRef.current = fieldsRef.current.map((f, i) => (i === row ? {...f, value} : f));
				}
			}
			render();
		},
		{isActive: focused},
	);

	const width = Math.max(1, columns - 1);
	const fields = fieldsRef.current;
	const labelWidth = Math.min(24, Math.max(4, ...fields.map(f => stringCells(sanitizeText(f.label, LABEL_MAX)))));
	const room = Math.max(1, width - labelWidth - 5);
	const row = rowRef.current;
	const adding = addingRef.current;

	const line = (f: FormField, i: number) => {
		const active = focused && i === row;
		const shown = sanitizeText(f.value, maxLength);
		let text = shown;
		if (active) while (stringCells(text) > room - 1) text = [...text].slice(1).join('');
		else text = truncateCells(text, room);
		const label = truncateCells(sanitizeText(f.label, LABEL_MAX), labelWidth).padEnd(labelWidth);
		return (
			<Box key={f.id} flexShrink={0}>
				<Text wrap="truncate-end">
					<Text color={active ? c('cyan') : undefined}>{active ? '› ' : '  '}</Text>
					<Text bold={active} dimColor={f.readOnly}>
						{label}
					</Text>
					{'  '}
					<Text dimColor={f.readOnly}>{text}</Text>
					{active && !f.readOnly && <Text inverse> </Text>}
					{shown === '' && f.placeholder && !active && <Text dimColor>{truncateCells(sanitizeText(f.placeholder, 200), room)}</Text>}
				</Text>
			</Box>
		);
	};

	const addActive = focused && add !== undefined && row === addRow();
	const onButtons = row === buttonsRow();
	return (
		<Box flexDirection="column" width={width}>
			{title && (
				<Box flexShrink={0}>
					<Text bold wrap="truncate-end">
						{truncateCells(sanitizeText(title, 200), width)}
					</Text>
				</Box>
			)}
			{fields.map(line)}
			{add && (
				<Box flexShrink={0}>
					<Text wrap="truncate-end">
						<Text color={addActive ? c('cyan') : undefined}>{addActive ? '› ' : '  '}</Text>
						{adding === undefined ? (
							<Text dimColor={!addActive}>{`+ ${truncateCells(sanitizeText(add.label, 64), width - 4)}`}</Text>
						) : (
							<>
								<Text bold>{'name: '}</Text>
								<Text>{truncateCells(sanitizeText(adding, LABEL_MAX), Math.max(1, width - 10))}</Text>
								<Text inverse> </Text>
							</>
						)}
					</Text>
				</Box>
			)}
			<Box flexShrink={0} marginTop={1}>
				<Text wrap="truncate-end">
					{'  '}
					{buttons.map((b, i) => {
						const chosen = i === buttonRef.current;
						const label = `[ ${sanitizeText(b.label, 40)} ]`;
						return (
							<Text key={b.id}>
								{i > 0 ? '  ' : ''}
								<Text inverse={focused && onButtons && chosen} bold={chosen} dimColor={!chosen}>
									{label}
								</Text>
							</Text>
						);
					})}
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
					{truncateCells(
						adding !== undefined
							? 'Enter add · Esc stop adding'
							: onButtons
								? '←→ choose · Enter press · ↑↓ fields · Esc cancel'
								: '↑↓ move · type to edit · Enter next · Esc cancel',
						width,
					)}
				</Text>
			</Box>
		</Box>
	);
}
