import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Box, Text, measureElement, useApp, useInput, useStdin, useStdout, useWindowSize, type DOMElement} from 'ink';
import Prompt from './components/Prompt.js';
import MountBoundary from './components/MountBoundary.js';
import TitleBar from './components/TitleBar.js';
import Transcript, {scrollHint} from './components/Transcript.js';
import type {
	Command,
	CommandContext,
	FocusDirection,
	Logger,
	MountControl,
	MountTarget,
	UiElement,
	ViewHost,
} from '../../../src/api.js';
import {noopLog} from './noop-log.js';
import type {Registry} from './commands.js';
import {buildCatalog} from './hints/catalog.js';
import {sanitizeText} from './hints/sanitize.js';
import {unknownCommandLines} from './hints/typo.js';
import {c} from './hints/style.js';
import {isConsoleToggle, isQuitLine} from './view/keys.js';
import {copyToClipboard} from './view/clipboard.js';
import {suspendTerminal} from './view/suspend.js';
import {getPrefs, subscribePrefs} from './view/prefs.js';
import {areaAt, inside, toLocal, wheelDelta, type Rect} from './mouse/hit.js';
import type {MouseInputEvent} from './mouse/sgr.js';
import type {ViewMouseEvent, ViewMouseHost} from './mouse/view-mouse.js';

type Line = {id: number; text: string; color?: string; welcome?: boolean};

type Pending = {id: number; resolve: () => void; reject: (error: Error) => void};

type Mounted = {id: number; element: UiElement};

type Focus = 'main' | 'panel';

type MouseListener = {mountId: number; fn: (event: ViewMouseEvent) => boolean | void};

export type AppMouse = {
	onMouse(listener: (e: MouseInputEvent) => void): () => void;
	setWanted(on: boolean): void;
	pause(): void;
	resume(): void;
};

const MAX_ERROR_LINES = 20;
const MAX_ERROR_LINE = 4096;
const MAX_PANEL_LINES = 500;
// The full-screen app keeps its own scrollback; the oldest lines go past this.
export const MAX_LINES = 5000;
const TITLE_MAX = 200;
// Below this width the open console covers the chat instead of sitting beside it
const SPLIT_MIN_COLUMNS = 60;
const MAX_MOUSE_LISTENERS = 8;

export const WELCOME = 'yena — type "help" for the list of commands';
export const WELCOME_WITH_VIEW = 'yena — press Esc twice to open the console; type "help" there for the list of commands';
export const PANEL_TITLE = 'Console · Esc Esc close · ← chat';

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

export type PanelGeometry = {split: boolean; panelColumns: number; mainColumns: number; panelRows: number};

/** Sizes of the chat and console areas while a main view is shown. */
export function panelGeometry(columns: number, rows: number, open: boolean): PanelGeometry {
	const panelRows = Math.max(3, rows);
	if (!open) return {split: false, panelColumns: 0, mainColumns: columns, panelRows};
	if (columns < SPLIT_MIN_COLUMNS) return {split: false, panelColumns: columns, mainColumns: 0, panelRows};
	const panelColumns = Math.min(columns - 30, Math.max(28, Math.round(columns * 0.4)));
	return {split: true, panelColumns, mainColumns: columns - panelColumns, panelRows};
}

const autostartCommands = (commands: Command[]): Command[] =>
	commands.filter(command => {
		try {
			return command?.autostart === true && typeof command.run === 'function';
		} catch {
			return false;
		}
	});

let nextId = 0;
let nextMountId = 0;

export default function App({registry, log = noopLog, mouse}: {registry: Registry; log?: Logger; mouse?: AppMouse}) {
	const {exit} = useApp();
	const {stdout} = useStdout();
	const {stdin} = useStdin();
	const [, setPrefsTick] = useState(0);
	useEffect(() => subscribePrefs(() => setPrefsTick(n => n + 1)), []);
	const mouseWanted = getPrefs().mouse;
	useEffect(() => {
		if (!mouse) return;
		mouse.setWanted(mouseWanted);
		return () => mouse.setWanted(false);
	}, [mouse, mouseWanted]);
	const {columns, rows} = useWindowSize();
	const [lines, setLines] = useState<Line[]>(() => [
		{
			id: nextId++,
			text: autostartCommands(registry.commands).length > 0 ? WELCOME_WITH_VIEW : WELCOME,
			color: c('green'),
			welcome: true,
		},
	]);
	const [panelLines, setPanelLines] = useState<Line[]>([]);
	// Rebuilt when the console opens and after each command: plugins may add subcommands at runtime.
	const [catalogTick, setCatalogTick] = useState(0);
	const refreshCatalog = () => setCatalogTick(n => n + 1);
	const catalog = useMemo(() => buildCatalog(registry.commands), [registry, catalogTick]);
	const [history, setHistory] = useState<string[]>([]);

	const [main, setMain] = useState<Mounted | null>(null);
	const [mainTitle, setMainTitle] = useState<{title: string; detail: string} | undefined>(undefined);
	const [panelView, setPanelView] = useState<Mounted | null>(null);
	const [panelOpen, setPanelOpen] = useState(false);
	const [focus, setFocus] = useState<Focus>('main');
	const pending = useRef<Record<MountTarget, Pending | null>>({main: null, panel: null});

	// With no main view the console owns the screen, as a plain REPL.
	const side = main !== null;
	const geo = panelGeometry(columns, rows, panelOpen);
	const consoleShown = !side || panelOpen;
	const active: Focus = !side ? 'panel' : !panelOpen ? 'main' : focus;
	const panelInner = side ? Math.max(1, geo.panelColumns - 2) : columns;
	useEffect(() => {
		if (active === 'panel') refreshCatalog();
	}, [active]);

	// Hosts are created once per view, so they read the latest layout through this ref.
	// Without a chat the console view has the screen, less one row so Ink never clears it.
	const panelViewRows = side ? Math.max(1, geo.panelRows - 1) : Math.max(1, rows - 1);
	const panelOutputRows = Math.max(0, geo.panelRows - 3);
	const snapshot = {
		active,
		side,
		split: geo.split,
		panelOpen,
		hasPanelView: panelView !== null,
		mainColumns: geo.mainColumns,
		panelInner,
		rows,
		panelViewRows,
		panelOutputRows,
	};
	const live = useRef(snapshot);
	live.current = snapshot;
	const listeners = useRef<Set<() => void>>(new Set());
	useEffect(() => {
		for (const l of [...listeners.current]) {
			try {
				l();
			} catch {
				continue;
			}
		}
	}, [active, geo.mainColumns, panelInner, panelOpen, side, rows, panelViewRows]);

	const togglePanel = (): boolean => {
		const l = live.current;
		if (!l.side) return false;
		const open = !l.panelOpen;
		if (open) refreshCatalog();
		setPanelOpen(open);
		setFocus(open ? 'panel' : 'main');
		return true;
	};

	const openMounts = useRef(new Set<number>());
	const mouseListeners = useRef<Record<MountTarget, Set<MouseListener>>>({main: new Set(), panel: new Set()});
	const dropMount = (target: MountTarget, mountId: number) => {
		openMounts.current.delete(mountId);
		for (const l of [...mouseListeners.current[target]]) if (l.mountId === mountId) mouseListeners.current[target].delete(l);
	};

	const makeHost = (target: MountTarget, mountId: number): ViewHost & ViewMouseHost => ({
		subscribeMouse: fn => {
			const set = mouseListeners.current[target];
			if (typeof fn !== 'function' || !openMounts.current.has(mountId) || set.size >= MAX_MOUSE_LISTENERS) return () => {};
			const entry: MouseListener = {mountId, fn};
			set.add(entry);
			return () => {
				set.delete(entry);
			};
		},
		isFocused: () => live.current.active === target,
		columns: () => (target === 'main' ? live.current.mainColumns : live.current.panelInner),
		rows: () => (target === 'main' ? live.current.rows : live.current.panelViewRows),
		subscribe: listener => {
			listeners.current.add(listener);
			return () => {
				listeners.current.delete(listener);
			};
		},
		move: (direction: FocusDirection) => {
			const l = live.current;
			if (!l.side || !l.panelOpen || !l.split) return false;
			const to: Focus | undefined = target === 'main' && direction === 'right' ? 'panel' : target === 'panel' && direction === 'left' ? 'main' : undefined;
			if (!to) return false;
			setFocus(to);
			return true;
		},
		isHostKey: isConsoleToggle,
		togglePanel,
		quit: () => exit(),
		setTitle: (title, detail) => {
			if (target !== 'main' || pending.current.main?.id !== mountId) return;
			const clean = typeof title === 'string' ? sanitizeText(title, TITLE_MAX) : '';
			const extra = typeof detail === 'string' ? sanitizeText(detail, TITLE_MAX) : '';
			setMainTitle(prev =>
				clean === '' ? undefined : prev?.title === clean && prev.detail === extra ? prev : {title: clean, detail: extra},
			);
		},
	});

	const settle = (target: MountTarget, id: number, error?: Error) => {
		const current = pending.current[target];
		if (!current || current.id !== id) return;
		pending.current[target] = null;
		dropMount(target, id);
		if (target === 'main') {
			setMain(null);
			setMainTitle(undefined);
			setFocus('panel');
		} else {
			setPanelView(null);
		}
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
			for (const target of ['main', 'panel'] as const) {
				pending.current[target]?.resolve();
				pending.current[target] = null;
			}
		},
		[],
	);

	const [scroll, setScroll] = useState(0);
	const scrollRef = useRef(0);
	scrollRef.current = scroll;
	const linesRef = useRef(lines);
	linesRef.current = lines;
	const printMain = (text: string, color?: string) => {
		setLines(prev => [...prev, {id: nextId++, text, color}].slice(-MAX_LINES));
		// Keep a scrolled-up view on the same lines while new output arrives below.
		if (scrollRef.current > 0) setScroll(s => Math.min(s + 1, MAX_LINES - 1));
	};
	const scrollBy = (delta: number) =>
		setScroll(s => Math.max(0, Math.min(Math.max(0, linesRef.current.length - 1), s + delta)));
	const [panelScroll, setPanelScroll] = useState(0);
	const panelScrollRef = useRef(0);
	panelScrollRef.current = panelScroll;
	const panelLinesRef = useRef(panelLines);
	panelLinesRef.current = panelLines;
	const printPanel = (text: string, color?: string) => {
		setPanelLines(prev => [...prev, {id: nextId++, text, color}].slice(-MAX_PANEL_LINES));
		if (panelScrollRef.current > 0) setPanelScroll(s => Math.min(s + 1, MAX_PANEL_LINES - 1));
	};
	const panelScrollBy = (delta: number) =>
		setPanelScroll(s =>
			Math.max(0, Math.min(Math.max(0, panelLinesRef.current.length - live.current.panelOutputRows), s + delta)),
		);
	const sideRef = useRef(side);
	sideRef.current = side;
	// Console output stays in the panel while it sits beside a view, else it goes to the scrollback.
	const printConsole = (text: string, color?: string) => (sideRef.current ? printPanel : printMain)(text, color);

	const mount =
		(fallbackPrint: (text: string) => void, onMain: () => void): NonNullable<CommandContext['mount']> =>
		(build, options) =>
			new Promise<void>((resolve, reject) => {
				const target: MountTarget = options?.target === 'panel' ? 'panel' : 'main';
				if (pending.current[target]) {
					reject(new Error('A view is already mounted'));
					return;
				}
				const id = nextMountId++;
				openMounts.current.add(id);
				const control: MountControl = {
					close: () => settle(target, id),
					print: target === 'main' ? text => printMain(text) : fallbackPrint,
					host: makeHost(target, id),
				};
				let element: UiElement;
				try {
					element = build(control);
				} catch (error) {
					dropMount(target, id);
					reject(error instanceof Error ? error : new Error(String(error)));
					return;
				}
				pending.current[target] = {id, resolve, reject};
				log.debug('view mounted', {id});
				if (target === 'main') {
					onMain();
					// A new main view (a new chat) starts on a clean transcript; the welcome hint stays.
					setLines(prev => prev.filter(l => l.welcome));
					setScroll(0);
					setMain({id, element});
					setFocus('main');
				} else {
					setPanelView({id, element});
					setFocus('panel');
				}
			});

	const makeCtx = (print: (text: string, color?: string) => void): CommandContext => {
		// A command that opened the main view keeps printing into the scrollback above it.
		let ownsMain = false;
		const out = (text: string, color?: string) => (ownsMain ? printMain : print)(text, color);
		return {
			print: text => out(text),
			clear: () => {
				setLines([]);
				setPanelLines([]);
				setScroll(0);
				setPanelScroll(0);
			},
			exit,
			copyToClipboard: text => copyToClipboard(stdout, text),
			suspend: fn => suspendTerminal(stdin as never, stdout as never, fn, mouse),
			mount: mount(
				text => out(text),
				() => {
					ownsMain = true;
				},
			),
		};
	};

	const runCommand = async (command: Command, name: string, args: string[], print: (text: string, color?: string) => void) => {
		try {
			await command.run(args, makeCtx(print));
		} catch (error) {
			log.warn('command failed', {command: name, err: error});
			errorLines(error).forEach((text, i) => print(i === 0 ? `Error: ${text}` : `  ${text}`, c('red')));
		} finally {
			refreshCatalog();
		}
	};

	useEffect(() => {
		for (const command of autostartCommands(registry.commands)) {
			let name = 'unknown';
			try {
				name = String(command.name);
			} catch {}
			void runCommand(command, name, [], printMain);
		}
	}, [registry]);

	const handleSubmit = async (raw: string) => {
		const line = raw.trim();
		if (isQuitLine(line)) {
			// Next to a view ":q" closes the console; a console that is the whole screen exits.
			if (side && panelOpen) togglePanel();
			else exit();
			return;
		}
		printConsole(`> ${sanitizeText(raw, 4096)}`, c('gray'));
		if (!line) return;

		setHistory(prev => (prev.at(-1) === line ? prev : [...prev, line]));

		const [name, ...args] = line.split(/\s+/);
		const command = registry.find(name!);
		if (!command) {
			log.debug('unknown command', {unknownCommand: true});
			for (const text of unknownCommandLines(catalog, name!)) printConsole(text, c('red'));
			return;
		}
		await runCommand(command, name!, args, printConsole);
	};

	useInput((input, key) => {
		if (!isConsoleToggle(input, key)) {
			// The transcript scrolls unless the side console has the input.
			if (side && active === 'panel') return;
			const page = Math.max(1, rows - 6);
			if (key.pageUp) scrollBy(page);
			else if (key.pageDown) scrollBy(-page);
			else if (key.shift && key.upArrow) scrollBy(1);
			else if (key.shift && key.downArrow) scrollBy(-1);
			return;
		}
		togglePanel();
	});

	const panelRef = useRef<DOMElement>(null);
	const promptMouse = useRef<((e: MouseInputEvent) => boolean) | null>(null);
	// Views never receive mouse events: a click on one only moves the focus to its area.
	const mainViewRef = useRef<DOMElement>(null);
	const consoleBodyRef = useRef<DOMElement>(null);
	// The first listener returning exactly true consumes the event.
	const dispatchToView = (target: MountTarget, e: MouseInputEvent, rect: Rect): boolean => {
		const mountId = pending.current[target]?.id;
		if (mountId === undefined) return false;
		const local = toLocal(rect, e.x, e.y);
		const event: ViewMouseEvent = Object.freeze({
			kind: e.kind,
			button: e.button,
			...(e.wheel !== undefined && {wheel: e.wheel}),
			x: local.x,
			y: local.y,
			width: rect.width,
			height: rect.height,
			shift: e.shift,
			meta: e.meta,
			ctrl: e.ctrl,
		});
		for (const l of [...mouseListeners.current[target]]) {
			if (l.mountId !== mountId) continue;
			try {
				if (l.fn(event) === true) return true;
			} catch {
				continue;
			}
		}
		return false;
	};
	const handleMouse = (e: MouseInputEvent) => {
		if (!getPrefs().mouse) return;
		const l = live.current;
		const panelRect = l.split && panelRef.current ? measureElement(panelRef.current) : undefined;
		const area = areaAt(e, {side: l.side, panelOpen: l.panelOpen, split: l.split, panelRect});
		if (e.kind === 'press' && e.button === 'left') {
			if (l.side && l.panelOpen && l.split && area !== l.active) {
				setFocus(area);
				live.current = {...l, active: area};
			}
		}
		const hasView = area === 'main' ? l.side : l.hasPanelView;
		const box = area === 'main' ? mainViewRef.current : consoleBodyRef.current;
		if (hasView && box) {
			const rect = measureElement(box);
			if (inside(rect, e.x, e.y)) {
				if (dispatchToView(area, e, rect)) return;
				if (area === 'panel') return;
			}
		}
		if (e.kind === 'press' && e.button === 'left') {
			if (area === 'panel' && !l.hasPanelView) promptMouse.current?.(e);
			return;
		}
		const delta = wheelDelta(e);
		if (delta === 0) return;
		if (!l.side || area === 'main') scrollBy(delta);
		else if (!l.hasPanelView) panelScrollBy(delta);
	};
	const mouseHandler = useRef(handleMouse);
	mouseHandler.current = handleMouse;
	useEffect(() => mouse?.onMouse(e => mouseHandler.current(e)), [mouse]);

	const consoleBody = (inner: number, height?: number) =>
		panelView ? (
			<MountBoundary key={panelView.id} onError={error => settle('panel', panelView.id, error)}>
				{panelView.element as ReactNode}
			</MountBoundary>
		) : (
			<Prompt
				history={history}
				catalog={catalog}
				onSubmit={handleSubmit}
				onInterrupt={exit}
				mouseRef={promptMouse}
				columns={inner}
				{...(height !== undefined && {rows: height})}
				active={active === 'panel'}
				isHostKey={isConsoleToggle}
				{...(side && geo.split && {onLeftEdge: () => setFocus('main')})}
				{...(side && {onDoubleEscape: () => void togglePanel()})}
			/>
		);

	const panel = () => {
		const height = geo.panelRows;
		const newer = Math.min(panelScroll, Math.max(0, panelLines.length - panelOutputRows));
		const outputRows = Math.max(0, panelOutputRows - (newer > 0 ? 1 : 0));
		const end = Math.max(0, panelLines.length - newer);
		return (
			<Box
				ref={panelRef}
				flexDirection="column"
				width={geo.panelColumns}
				height={height}
				borderStyle="single"
				borderTop={false}
				borderRight={false}
				borderBottom={false}
				borderDimColor={active !== 'panel'}
				paddingLeft={1}
			>
				<Box flexShrink={0}>
					<Text dimColor wrap="truncate-end">
						{geo.split ? PANEL_TITLE : 'Console · Esc Esc close'}
					</Text>
				</Box>
				{/* A console view gets the whole panel; the output only fills what the prompt leaves */}
				{!panelView && (
					<Box flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="flex-end" overflow="hidden">
						{panelLines.slice(Math.max(0, end - outputRows), end).map(line => (
							<Box key={line.id} flexShrink={0}>
								<Text color={line.color} wrap="truncate-end">
									{line.text}
								</Text>
							</Box>
						))}
					</Box>
				)}
				{!panelView && newer > 0 && (
					<Box flexShrink={0}>
						<Text dimColor wrap="truncate-end">
							{scrollHint(newer, '')}
						</Text>
					</Box>
				)}
				<Box ref={consoleBodyRef} flexDirection="column" flexShrink={0} overflow="hidden">
					{consoleBody(panelInner, height - 1)}
				</Box>
			</Box>
		);
	};

	const transcript = <Transcript lines={lines} scroll={scroll} maxRows={rows} />;

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			{main ? (
				<Box flexDirection="row" flexGrow={1}>
					{/* Kept mounted while covered, so the view and its session survive */}
					<Box
						flexDirection="column"
						width={geo.mainColumns > 0 ? geo.mainColumns : undefined}
						display={geo.mainColumns > 0 ? 'flex' : 'none'}
					>
						{mainTitle !== undefined && <TitleBar {...mainTitle} columns={geo.mainColumns} />}
						{transcript}
						<Box ref={mainViewRef} flexDirection="column" flexShrink={0}>
							<MountBoundary key={main.id} onError={error => settle('main', main.id, error)}>
								{/* UiElement is opaque in the host contract; it is a React element here */}
								{main.element as ReactNode}
							</MountBoundary>
						</Box>
					</Box>
					{panelOpen && panel()}
				</Box>
			) : (
				<Box flexDirection="column" flexGrow={1}>
					{transcript}
					{consoleShown && (
						<Box ref={consoleBodyRef} flexDirection="column" flexShrink={0}>
							{consoleBody(columns)}
						</Box>
					)}
				</Box>
			)}
		</Box>
	);
}
