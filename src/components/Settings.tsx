import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {MountControl, Setting, SettingsTab} from '../../../../src/api.js';
import {sanitizeText} from '../hints/sanitize.js';
import {c} from '../hints/style.js';
import {truncateCells} from '../hints/width.js';
import {useViewHost} from '../view/use-view-host.js';

const TEXT_MAX = 200;
export const SETTINGS_HINT = '↑↓ select · Enter save · ←→ tab · Esc close';

type Row = {setting: Setting; index: number};

const clean = (text: unknown) => sanitizeText(text, TEXT_MAX);

function rowsOf(tab: SettingsTab | undefined): Row[] {
	const out: Row[] = [];
	for (const setting of tab?.settings ?? []) {
		setting.options.forEach((_o, index) => out.push({setting, index}));
	}
	return out;
}

const message = (error: unknown) => clean(error instanceof Error ? error.message : String(error)) || 'unknown error';

export default function Settings({tabs, control}: {tabs: SettingsTab[]; control: MountControl}) {
	const {focused, columns} = useViewHost(control.host);
	const [tab, setTab] = useState(0);
	const [cursor, setCursor] = useState(0);
	const [values, setValues] = useState<Record<string, string | undefined>>({});
	const [status, setStatus] = useState<{text: string; error?: boolean} | undefined>();
	const alive = useRef(true);
	useEffect(
		() => () => {
			alive.current = false;
		},
		[],
	);

	const current = tabs[tab];
	const rows = rowsOf(current);

	useEffect(() => {
		setCursor(0);
		setStatus(undefined);
		for (const setting of current?.settings ?? []) {
			Promise.resolve()
				.then(() => setting.get())
				.then(
					value => alive.current && setValues(v => ({...v, [`${tab}:${setting.key}`]: value})),
					error => alive.current && setStatus({text: `Cannot read "${clean(setting.label)}": ${message(error)}`, error: true}),
				);
		}
	}, [tab, current]);

	const save = (row: Row) => {
		const option = row.setting.options[row.index];
		if (!option) return;
		Promise.resolve()
			.then(() => row.setting.set(option.value))
			.then(
				() => {
					if (!alive.current) return;
					setValues(v => ({...v, [`${tab}:${row.setting.key}`]: option.value}));
					setStatus({text: `${clean(row.setting.label)}: ${clean(option.label)}`});
				},
				error => alive.current && setStatus({text: `Cannot save: ${message(error)}`, error: true}),
			);
	};

	useInput(
		(input, key) => {
			if (control.host?.isHostKey(input)) return;
			if (key.escape || (key.ctrl && input === 'c')) return control.close();
			if (key.leftArrow) {
				if (tab > 0) setTab(tab - 1);
				else control.host?.move('left');
				return;
			}
			if (key.rightArrow) {
				if (tab < tabs.length - 1) setTab(tab + 1);
				return;
			}
			if (key.upArrow) return setCursor(i => Math.max(0, i - 1));
			if (key.downArrow) return setCursor(i => Math.min(rows.length - 1, i + 1));
			if (key.return) {
				const row = rows[cursor];
				if (row) save(row);
			}
		},
		{isActive: focused},
	);

	const width = Math.max(1, columns - 1);
	const fit = (text: string) => truncateCells(text, width);

	if (tabs.length === 0) {
		return (
			<Box flexDirection="column">
				<Text bold>Settings</Text>
				<Text dimColor>No module provides settings.</Text>
				<Text dimColor>Esc close</Text>
			</Box>
		);
	}

	const lines: React.ReactNode[] = [];
	let at = 0;
	for (const setting of current?.settings ?? []) {
		const value = values[`${tab}:${setting.key}`];
		lines.push(
			<Text key={`h:${setting.key}`} bold wrap="truncate-end">
				{fit(clean(setting.label))}
			</Text>,
		);
		if (setting.description) {
			lines.push(
				<Text key={`d:${setting.key}`} dimColor wrap="truncate-end">
					{fit(clean(setting.description))}
				</Text>,
			);
		}
		setting.options.forEach((option, i) => {
			const selected = at === cursor;
			const chosen = option.value === (value ?? '');
			const label = `${selected ? '›' : ' '} ${chosen ? '●' : '○'} ${clean(option.label)}`;
			const desc = option.description ? ` — ${clean(option.description)}` : '';
			lines.push(
				<Text key={`o:${setting.key}:${i}`} wrap="truncate-end" inverse={selected && focused}>
					{fit(label)}
					<Text dimColor>{fit(desc)}</Text>
				</Text>,
			);
			at++;
		});
	}

	return (
		<Box flexDirection="column">
			<Text wrap="truncate-end">
				<Text bold>Settings </Text>
				{tabs.map((t, i) => (
					<Text key={i} inverse={i === tab} color={i === tab ? undefined : c('gray')}>
						{` ${clean(t.title)} `}
					</Text>
				))}
			</Text>
			{lines}
			{status && (
				<Text color={status.error ? c('red') : c('green')} wrap="truncate-end">
					{fit(status.text)}
				</Text>
			)}
			<Text dimColor wrap="truncate-end">
				{fit(SETTINGS_HINT)}
			</Text>
		</Box>
	);
}
