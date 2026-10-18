import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Box, Static, Text, useApp} from 'ink';
import Prompt from './components/Prompt.js';
import MountBoundary from './components/MountBoundary.js';
import type {CommandContext, Logger, UiElement} from '../../../src/api.js';
import {noopLog} from './noop-log.js';
import type {Registry} from './commands.js';
import {buildCatalog} from './hints/catalog.js';
import {sanitizeText} from './hints/sanitize.js';
import {unknownCommandLines} from './hints/typo.js';
import {c} from './hints/style.js';

type Line = {id: number; text: string; color?: string};

type Pending = {id: number; resolve: () => void; reject: (error: Error) => void};

const MAX_ERROR_LINES = 20;
const MAX_ERROR_LINE = 4096;

function errorLines(error: unknown): string[] {
	let message: string;
	try {
		message = error instanceof Error ? String(error.message) : String(error);
	} catch {
		message = 'unprintable error';
	}
	const lines = message
		.slice(0, MAX_ERROR_LINES * MAX_ERROR_LINE)
		.split('\n')
		.slice(0, MAX_ERROR_LINES)
		.map(l => sanitizeText(l, MAX_ERROR_LINE));
	const out = lines.filter(l => l !== '');
	return out.length > 0 ? out : ['unknown error'];
}

let nextId = 0;
let nextMountId = 0;

export default function App({registry, log = noopLog}: {registry: Registry; log?: Logger}) {
	const {exit} = useApp();
	const [lines, setLines] = useState<Line[]>([
		{id: nextId++, text: 'yena — type "help" for the list of commands', color: c('green')},
	]);
	const catalog = useMemo(() => buildCatalog(registry.commands), [registry]);
	const [history, setHistory] = useState<string[]>([]);

	const [mounted, setMounted] = useState<{id: number; element: UiElement} | null>(null);
	const pending = useRef<Pending | null>(null);

	const settle = (id: number, error?: Error) => {
		const current = pending.current;
		if (!current || current.id !== id) return;
		pending.current = null;
		setMounted(null);
		if (error) {
			log.warn('view failed', {id, err: error});
			current.reject(error);
		} else {
			log.debug('view closed', {id});
			current.resolve();
		}
	};

	// An unmount (exit, signal) must not leave a command awaiting forever
	useEffect(
		() => () => {
			pending.current?.resolve();
			pending.current = null;
		},
		[],
	);

	const print = (text: string, color?: string) =>
		setLines(prev => [...prev, {id: nextId++, text, color}]);

	const ctx: CommandContext = {
		print: text => print(text),
		// Clear the real terminal too, since <Static> output stays on screen
		clear: () => {
			process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
			setLines([]);
		},
		exit,
		mount: build =>
			new Promise<void>((resolve, reject) => {
				if (pending.current) {
					reject(new Error('A view is already mounted'));
					return;
				}
				const id = nextMountId++;
				let element: UiElement;
				try {
					element = build({close: () => settle(id)});
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
					return;
				}
				pending.current = {id, resolve, reject};
				log.debug('view mounted', {id});
				setMounted({id, element});
			}),
	};

	const handleSubmit = async (raw: string) => {
		const line = raw.trim();
		print(`> ${sanitizeText(raw, 4096)}`, c('gray'));
		if (!line) return;

		setHistory(prev => (prev.at(-1) === line ? prev : [...prev, line]));

		const [name, ...args] = line.split(/\s+/);
		const command = registry.find(name!);
		if (!command) {
			log.debug('unknown command', {unknownCommand: true});
			for (const text of unknownCommandLines(catalog, name!)) print(text, c('red'));
			return;
		}

		try {
			await command.run(args, ctx);
		} catch (error) {
			log.warn('command failed', {command: name, err: error});
			errorLines(error).forEach((text, i) => print(i === 0 ? `Error: ${text}` : `  ${text}`, c('red')));
		}
	};

	return (
		<Box flexDirection="column">
			<Static items={lines}>
				{line => (
					<Text key={line.id} color={line.color}>
						{line.text}
					</Text>
				)}
			</Static>
			{mounted ? (
				<MountBoundary key={mounted.id} onError={error => settle(mounted.id, error)}>
					{/* UiElement is opaque in the host contract; it is a React element here */}
					{mounted.element as ReactNode}
				</MountBoundary>
			) : (
				<Prompt history={history} catalog={catalog} onSubmit={handleSubmit} onInterrupt={exit} />
			)}
		</Box>
	);
}
