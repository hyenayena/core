import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import type {MountControl, Setting, SettingAction, SettingsTab} from '../../../../src/api.js';
import {sanitizeText} from '../hints/sanitize.js';
import {c} from '../hints/style.js';
import {truncateCells} from '../hints/width.js';
import {windowStart} from '../kit/window.js';
import {useViewHost} from '../view/use-view-host.js';
import MountBoundary from './MountBoundary.js';

const TEXT_MAX = 200;
export const SETTINGS_HINT = '↑↓ select · Enter save · ←→ tab · Esc close';

type Option = {setting: Setting; index: number} | {action: SettingAction};

type Line =
	| {kind: 'label'; key: string; text: string}
	| {kind: 'description'; key: string; text: string}
	| {kind: 'option'; key: string; text: string; detail: string; at: number; chosen: boolean}
	| {kind: 'action'; key: string; text: string; detail: string; at: number};

const clean = (text: unknown) => sanitizeText(text, TEXT_MAX);

const message = (error: unknown) => clean(error instanceof Error ? error.message : String(error)) || 'unknown error';

function optionsOf(tab: SettingsTab | undefined): Option[] {
	const out: Option[] = [];
	for (const action of tab?.actions ?? []) out.push({action});
	for (const setting of tab?.settings ?? []) {
		setting.options.forEach((_o, index) => out.push({setting, index}));
	}
	return out;
}

function linesOf(tab: SettingsTab | undefined, value: (setting: Setting) => string | undefined): Line[] {
	const lines: Line[] = [];
	let at = 0;
	for (const action of tab?.actions ?? []) {
		const detail = action.description ? ` — ${clean(action.description)}` : '';
		lines.push({kind: 'action', key: `a:${action.key}`, text: clean(action.label), detail, at: at++});
	}
	for (const setting of tab?.settings ?? []) {
		lines.push({kind: 'label', key: `l:${setting.key}`, text: clean(setting.label)});
		if (setting.description) lines.push({kind: 'description', key: `d:${setting.key}`, text: clean(setting.description)});
		const current = value(setting) ?? '';
		setting.options.forEach((option, i) => {
			lines.push({
				kind: 'option',
				key: `o:${setting.key}:${i}`,
				text: clean(option.label),
				detail: option.description ? ` — ${clean(option.description)}` : '',
				at: at++,
				chosen: option.value === current,
			});
		});
	}
	return lines;
}

type Opened = {id: number; element: React.ReactNode};
let nextOpened = 0;

export default function Settings({tabs: initial, control, reload}: {tabs: SettingsTab[]; control: MountControl; reload?: () => SettingsTab[]}) {
	const [tabs, setTabs] = useState(initial);
	// The view of an action row, shown in place of the list until it closes.
	const [opened, setOpened] = useState<Opened | null>(null);
	const {focused, columns} = useViewHost(control.host);
	const terminal = useWindowSize();
	const height = control.host?.rows?.() ?? terminal.rows - 1;
	const [tab, setTab] = useState(0);
	const [cursor, setCursor] = useState(0);
	const [values, setValues] = useState<Record<string, string | undefined>>({});
	const [status, setStatus] = useState<{text: string; error?: boolean} | undefined>();
	const saving = useRef(false);
	const alive = useRef(true);
	useEffect(
		() => () => {
			alive.current = false;
		},
		[],
	);

	const current = tabs[tab];
	const options = optionsOf(current);
	const valueKey = (setting: Setting) => `${tab}:${setting.key}`;

	const closeOpened = (id: number, error?: Error) => {
		if (!alive.current) return;
		setOpened(o => (o?.id === id ? null : o));
		if (reload) {
			try {
				setTabs(reload());
			} catch (e) {
				setStatus({text: `Cannot read the settings: ${message(e)}`, error: true});
				return;
			}
		}
		if (error) setStatus({text: `Cannot open: ${message(error)}`, error: true});
	};

	const openAction = (action: SettingAction) => {
		const id = nextOpened++;
		let closed = false;
		const close = (error?: Error) => {
			if (closed) return;
			closed = true;
			closeOpened(id, error);
		};
		try {
			const element = action.open({
				close: () => close(),
				...(control.host && {host: control.host}),
				...(control.print && {print: control.print}),
				...(control.copyToClipboard && {copyToClipboard: control.copyToClipboard}),
			}) as React.ReactNode;
			if (!closed) setOpened({id, element: <MountBoundary onError={error => close(error)}>{element}</MountBoundary>});
		} catch (error) {
			setStatus({text: `Cannot open: ${message(error)}`, error: true});
		}
	};

	useEffect(() => {
		setCursor(0);
		setStatus(undefined);
		for (const setting of current?.settings ?? []) {
			Promise.resolve()
				.then(() => setting.get())
				.then(
					value => alive.current && setValues(v => ({...v, [valueKey(setting)]: value})),
					error => alive.current && setStatus({text: `Cannot read "${clean(setting.label)}": ${message(error)}`, error: true}),
				);
		}
	}, [tab, current]);

	// Saving keeps the window open; only Esc closes it.
	const save = (row: Option) => {
		if ('action' in row) return openAction(row.action);
		const option = row.setting.options[row.index];
		if (!option || saving.current) return;
		saving.current = true;
		Promise.resolve()
			.then(() => row.setting.set(option.value))
			.then(
				() => {
					saving.current = false;
					if (!alive.current) return;
					setValues(v => ({...v, [valueKey(row.setting)]: option.value}));
					setStatus({text: `Saved · ${clean(row.setting.label)}: ${clean(option.label)}`});
				},
				error => {
					saving.current = false;
					if (alive.current) setStatus({text: `Cannot save: ${message(error)}`, error: true});
				},
			);
	};

	useInput(
		(input, key) => {
			if (control.host?.isHostKey(input, key)) return;
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
			if (key.downArrow) return setCursor(i => Math.min(options.length - 1, i + 1));
			if (key.return) {
				const row = options[cursor];
				if (row) save(row);
			}
		},
		{isActive: focused && opened === null},
	);

	const width = Math.max(1, columns - 1);
	const fit = (text: string) => truncateCells(text, width);
	const row = (key: string, node: React.ReactNode) => (
		<Box key={key} flexShrink={0}>
			{node}
		</Box>
	);

	if (opened) return <Box flexDirection="column">{opened.element}</Box>;

	if (tabs.length === 0) {
		return (
			<Box flexDirection="column">
				{row('t', <Text bold>Settings</Text>)}
				{row('e', <Text dimColor>No module provides settings.</Text>)}
				{row('h', <Text dimColor>Esc close</Text>)}
			</Box>
		);
	}

	const lines = linesOf(current, s => values[valueKey(s)]);
	const focusLine = Math.max(0, lines.findIndex(l => (l.kind === 'option' || l.kind === 'action') && l.at === cursor));
	let labelLine = focusLine;
	while (labelLine > 0 && lines[labelLine]?.kind !== 'label') labelLine--;
	const budget = Math.max(1, height - 2 - (status ? 1 : 0));
	const start = windowStart(lines.length, budget, focusLine, labelLine);
	const visible = lines.slice(start, start + budget);
	const more = lines.length > budget ? ` · ${start + visible.length}/${lines.length}` : '';

	return (
		<Box flexDirection="column">
			{row(
				'tabs',
				<Text wrap="truncate-end">
					<Text bold>Settings </Text>
					{tabs.map((t, i) => (
						<Text key={i} inverse={i === tab} color={i === tab ? undefined : c('gray')}>
							{` ${clean(t.title)} `}
						</Text>
					))}
				</Text>,
			)}
			{visible.map(line => {
				if (line.kind === 'label') {
					return row(
						line.key,
						<Text bold wrap="truncate-end">
							{fit(line.text)}
						</Text>,
					);
				}
				if (line.kind === 'description') {
					return row(
						line.key,
						<Text dimColor wrap="truncate-end">
							{fit(line.text)}
						</Text>,
					);
				}
				const selected = line.at === cursor;
				if (line.kind === 'action') {
					return row(
						line.key,
						<Text wrap="truncate-end" inverse={selected && focused}>
							{fit(`${selected ? '›' : ' '} ▸ ${line.text}`)}
							<Text dimColor>{line.detail}</Text>
						</Text>,
					);
				}
				return row(
					line.key,
					<Text wrap="truncate-end" inverse={selected && focused}>
						{fit(`${selected ? '›' : ' '} ${line.chosen ? '●' : '○'} ${line.text}`)}
						<Text dimColor>{line.detail}</Text>
					</Text>,
				);
			})}
			{status &&
				row(
					'status',
					<Text color={status.error ? c('red') : c('green')} wrap="truncate-end">
						{fit(status.text)}
					</Text>,
				)}
			{row(
				'hint',
				<Text dimColor wrap="truncate-end">
					{fit(SETTINGS_HINT + more)}
				</Text>,
			)}
		</Box>
	);
}
