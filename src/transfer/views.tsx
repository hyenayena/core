import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {MountControl} from '../../../../src/api.js';
import {sanitizeText} from '../hints/sanitize.js';
import {truncateCells} from '../hints/width.js';
import {ListPicker} from '../kit/ListPicker.js';
import {SecretInput} from '../kit/SecretInput.js';
import {inkTone} from '../kit/theme.js';
import {useViewHost} from '../view/use-view-host.js';
import {PASSWORD_MAX, PASSWORD_MIN} from './crypto.js';

type ViewProps<T> = {control: MountControl; onDone: (value: T) => void};

type Stage = {stage: 'first' | 'again'; first: string; notice?: string; round: number};

export function NewSecretView({control, onDone}: ViewProps<string | undefined>) {
	const {columns} = useViewHost(control.host);
	const [state, setState] = useState<Stage>({stage: 'first', first: '', round: 0});
	const finish = (value: string | undefined) => {
		control.close();
		onDone(value);
	};
	const retry = (notice: string) => setState(s => ({stage: 'first', first: '', notice, round: s.round + 1}));
	const width = Math.max(1, columns - 1);
	return (
		<Box flexDirection="column">
			{state.notice !== undefined && (
				<Text {...inkTone('warn')} wrap="truncate-end">
					{truncateCells(state.notice, width)}
				</Text>
			)}
			{state.stage === 'first' ? (
				<SecretInput
					key={`first-${state.round}`}
					label="Password for the export (empty: generate a code word)"
					optional
					maxLength={PASSWORD_MAX}
					{...(control.host && {host: control.host})}
					onSubmit={value => {
						if (value === '') return finish('');
						if ([...value].length < PASSWORD_MIN) return retry('Use at least 8 characters, or leave it empty for a code word');
						setState(s => ({stage: 'again', first: value, round: s.round + 1}));
					}}
					onCancel={() => finish(undefined)}
				/>
			) : (
				<SecretInput
					key={`again-${state.round}`}
					label="Type the password again"
					maxLength={PASSWORD_MAX}
					{...(control.host && {host: control.host})}
					onSubmit={value => (value === state.first ? finish(value) : retry('The passwords do not match'))}
					onCancel={() => finish(undefined)}
				/>
			)}
		</Box>
	);
}

export function SecretView({control, onDone, label}: ViewProps<string | undefined> & {label: string}) {
	const finish = (value: string | undefined) => {
		control.close();
		onDone(value);
	};
	return <SecretInput label={label} maxLength={PASSWORD_MAX} {...(control.host && {host: control.host})} onSubmit={finish} onCancel={() => finish(undefined)} />;
}

export function CodeWordView({control, onDone, code}: ViewProps<boolean> & {code: string}) {
	const {focused, columns} = useViewHost(control.host);
	const finish = (value: boolean) => {
		control.close();
		onDone(value);
	};
	useInput(
		(input, key) => {
			if (control.host?.isHostKey(input, key)) return;
			if (key.return) return finish(true);
			if (key.escape || (key.ctrl && input === 'c')) finish(false);
		},
		{isActive: focused},
	);
	const width = Math.max(1, columns - 1);
	const row = (text: string) => truncateCells(text, width);
	return (
		<Box flexDirection="column">
			<Text bold wrap="truncate-end">
				{row(code)}
			</Text>
			<Text wrap="truncate-end">{row('Write it down: it is shown only this once and is needed to import the file.')}</Text>
			<Text dimColor wrap="truncate-end">
				{row('Enter: I have written it down · Esc: cancel the export')}
			</Text>
		</Box>
	);
}

export function ConfirmView({control, onDone, summary}: ViewProps<boolean> & {summary: string}) {
	return (
		<ListPicker
			title={sanitizeText(summary, 200)}
			empty=""
			action="Choose"
			items={[
				{id: 'apply', label: 'Apply the import'},
				{id: 'cancel', label: 'Cancel'},
			]}
			{...(control.host && {host: control.host})}
			onPick={id => {
				onDone(id === 'apply');
			}}
			close={control.close}
		/>
	);
}
