import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Box, Text, measureElement, useApp, useInput, useStdin, useStdout, useWindowSize, type DOMElement} from 'ink';
import Prompt from './components/Prompt.js';
import MountBoundary from './components/MountBoundary.js';
import TitleBar from './components/TitleBar.js';
import Transcript, {scrollHint} from './components/Transcript.js';
import type {
	Command,
	CommandBridge,
	CommandContext,
	FocusDirection,
	Logger,
	MountControl,
	MountTarget,
	PrintOptions,
	UiElement,
	ViewHost,
} from '../../../src/api.js';
import {noopLog} from './noop-log.js';
import type {Registry} from './commands.js';
import {buildCatalog, type CatalogSub} from './hints/catalog.js';
import {sanitizeText} from './hints/sanitize.js';
import {errorLines} from './error-lines.js';
import {parseLine} from './parse-line.js';
import {createCommandBridge, type AgentViewHandle} from './agent/bridge.js';
import {unknownCommandLines} from './hints/typo.js';
import {c} from './hints/style.js';
import {focusMove, isConsoleToggle, isHostKey, isQuitLine} from './view/keys.js';
import type {ViewCommandHost, ViewCommandInfo} from './view/view-commands.js';
import {ViewLayoutContext} from './view/use-view-host.js';
import {copyToClipboard} from './view/clipboard.js';
import {actionAt, cleanActions} from './transcript/actions.js';
import {suspendTerminal} from './view/suspend.js';
import {DEFAULT_PREFS, getPrefs, setPrefs, subscribePrefs} from './view/prefs.js';
import {areaAt, inside, toLocal, wheelDelta, type Rect} from './mouse/hit.js';
import type {MouseInputEvent} from './mouse/sgr.js';
import type {ViewMouseEvent, ViewMouseHost} from './mouse/view-mouse.js';
import {createRowCache, normalizeAnchor, sameAnchor, scrollAnchor, visibleWindow, type Anchor, type VisibleRow} from './transcript/scroll.js';
import {
	createLayoutCache,
	emptySpan,
	lineSpan,
	markAt,
	rowCells,
	selectedText,
	spanOf,
	wordSpan,
	type Mark,
	type Span,
} from './transcript/selection.js';

type Line = {id: number; text: string; color?: string; welcome?: boolean};

type Pending = {id: number; resolve: () => void; reject: (error: Error) => void};

type Mounted = {id: number; element: UiElement; activity?: boolean};

type ActivityInfo = {agent: boolean};

type Focus = 'main' | 'panel';

type MouseListener = {mountId: number; fn: (event: ViewMouseEvent) => boolean | void};

export type AppMouse = {
	onMouse(listener: (e: MouseInputEvent) => void): () => void;
	setWanted(on: boolean): void;
	pause(): void;
	resume(): void;
};

const MAX_PANEL_LINES = 500;
// The full-screen app keeps its own scrollback; the oldest lines go past this.
export const MAX_LINES = 5000;
const TITLE_MAX = 200;
// Below this width the open console covers the chat instead of sitting beside it
const SPLIT_MIN_COLUMNS = 60;
const MAX_MOUSE_LISTENERS = 8;
// The same cap as a line typed in the console or run by an assistant.
const RUN_LINE_MAX = 4096;
// Presses this close in time on one cell count as a double or triple click.
const MULTI_CLICK_MS = 400;
// How long "Copied" stays over the transcript.
const COPY_NOTICE_MS = 2000;
// How long a console opened for an assistant stays after the last owner ended, unless the user touched it.
export const AUTO_PANEL_GRACE_MS = 3000;

export const WELCOME = 'yena — type "help" for the list of commands';
export const WELCOME_WITH_VIEW = 'press Tab (or Ctrl+T) to open the console';
export const PANEL_TITLE = 'Console · Tab close · ⇧← chat';

export type PanelGeometry = {split: boolean; panelColumns: number; mainColumns: number; panelRows: number};

/** Sizes of the chat and console areas while a main view is shown. */
export function panelGeometry(columns: number, rows: number, open: boolean, share = DEFAULT_PREFS.panelShare): PanelGeometry {
	const panelRows = Math.max(3, rows);
	if (!open) return {split: false, panelColumns: 0, mainColumns: columns, panelRows};
	if (columns < SPLIT_MIN_COLUMNS) return {split: false, panelColumns: columns, mainColumns: 0, panelRows};
	const panelColumns = Math.min(columns - 30, Math.max(28, Math.round(columns * share)));
	return {split: true, panelColumns, mainColumns: columns - panelColumns, panelRows};
}

/** The panel share that puts the console's border at column `x` (0-based), within the panel's limits. */
export function shareAtBorder(columns: number, x: number): number {
	const {panelColumns} = panelGeometry(columns, 0, true, (columns - x) / columns);
	return panelColumns / columns;
}

const autostartCommands = (commands: Command[]): Command[] =>
	commands.filter(command => {
		try {
			return command?.autostart === true && typeof command.run === 'function';
		} catch {
			return false;
		}
	});

const subInfo = (s: CatalogSub): ViewCommandInfo => ({
	name: s.name,
	description: s.description,
	...(s.usage !== '' && {usage: s.usage}),
	...(s.aliases.length > 0 && {aliases: [...s.aliases]}),
	...(s.subs.length > 0 && {subcommands: s.subs.map(subInfo)}),
});

let nextId = 0;
let nextMountId = 0;

export default function App({
	registry,
	log = noopLog,
	mouse,
	graceMs = AUTO_PANEL_GRACE_MS,
}: {
	registry: Registry;
	log?: Logger;
	mouse?: AppMouse;
	graceMs?: number;
}) {
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
			...(autostartCommands(registry.commands).length > 0
				? {text: WELCOME_WITH_VIEW, color: c('gray')}
				: {text: WELCOME, color: c('green')}),
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
	// While the console's border is dragged the share lives here; it is saved when the button is let go.
	const [dragShare, setDragShare] = useState<number | null>(null);
	const geo = panelGeometry(columns, rows, panelOpen, dragShare ?? getPrefs().panelShare);
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
		columns,
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
	// The same values the hosts report, handed to the mounted views in this render (see ViewLayoutContext).
	const mainLayout = useMemo(() => ({focused: active === 'main', columns: geo.mainColumns}), [active, geo.mainColumns]);
	const panelLayout = useMemo(() => ({focused: active === 'panel', columns: panelInner}), [active, panelInner]);
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

	// Bumped on every user action on the console; an auto-opened console closes only if it stayed at its opening value.
	const panelEpoch = useRef(0);
	const activityMounts = useRef(new Map<number, ActivityInfo>());
	const autoOpened = useRef(false);
	const autoEpoch = useRef(0);
	const owners = useRef(0);
	const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const alive = useRef(true);
	const clearGrace = () => {
		if (graceTimer.current) clearTimeout(graceTimer.current);
		graceTimer.current = null;
	};
	useEffect(
		() => () => {
			alive.current = false;
			clearGrace();
		},
		[],
	);

	// An assistant run or activity view begins: open the console beside the chat if it is closed.
	const startOwner = () => {
		owners.current++;
		clearGrace();
		const l = live.current;
		if (!l.side || l.panelOpen || autoOpened.current) return;
		autoOpened.current = true;
		autoEpoch.current = panelEpoch.current;
		setPanelOpen(true);
		refreshCatalog();
		// Beside the chat the focus stays there; a console that covers the chat takes it.
		setFocus(l.columns >= SPLIT_MIN_COLUMNS ? 'main' : 'panel');
	};
	const endOwner = () => {
		owners.current = Math.max(0, owners.current - 1);
		if (owners.current > 0 || !autoOpened.current) return;
		if (panelEpoch.current !== autoEpoch.current) {
			autoOpened.current = false;
			return;
		}
		clearGrace();
		graceTimer.current = setTimeout(() => {
			graceTimer.current = null;
			if (!alive.current || owners.current > 0 || !autoOpened.current) return;
			autoOpened.current = false;
			if (panelEpoch.current !== autoEpoch.current) return;
			setPanelOpen(false);
			setFocus('main');
		}, graceMs);
	};

	const moveFocus = (direction: FocusDirection): boolean => {
		const l = live.current;
		if (!l.side || !l.panelOpen || !l.split) return false;
		const to: Focus = direction === 'right' ? 'panel' : 'main';
		if (l.active === to) return false;
		panelEpoch.current++;
		setFocus(to);
		return true;
	};

	// The latest submit, for views that run console lines (it reads this render's state).
	const submitRef = useRef<(raw: string) => Promise<void>>(async () => {});

	const togglePanel = (): boolean => {
		const l = live.current;
		if (!l.side) return false;
		panelEpoch.current++;
		autoOpened.current = false;
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

	const makeHost = (target: MountTarget, mountId: number): ViewHost & ViewMouseHost & ViewCommandHost => ({
		runLine: line => {
			if (typeof line !== 'string' || line.length > RUN_LINE_MAX || /[\p{Cc}\p{Cf}]/u.test(line)) return false;
			const parsed = parseLine(line);
			if (!parsed || !registry.find(parsed.name)) return false;
			const l = live.current;
			// The output goes to the console, so it is shown; the input stays where the user typed.
			if (l.side && !l.panelOpen) {
				refreshCatalog();
				setPanelOpen(true);
			}
			// Runs in the background like a typed line; the caller only learns whether it was a command.
			void submitRef.current(line);
			return true;
		},
		listCommands: () =>
			buildCatalog(registry.commands).commands.map(c => ({
				name: c.name,
				description: c.description,
				...(c.usage !== undefined && {usage: c.usage}),
				...(c.subs.length > 0 && {subcommands: c.subs.map(subInfo)}),
			})),
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
			if ((target === 'main' && direction !== 'right') || (target === 'panel' && direction !== 'left')) return false;
			return moveFocus(direction);
		},
		isHostKey,
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
		let agentView = false;
		if (target === 'main') {
			setMain(null);
			setMainTitle(undefined);
			setFocus('panel');
		} else {
			setPanelView(null);
			const info = activityMounts.current.get(id);
			activityMounts.current.delete(id);
			agentView = info?.agent === true;
			if (info) endOwner();
		}
		if (error) {
			log.warn('view failed', {id, err: error});
			current.reject(error);
		} else {
			log.debug('view closed', {id, ...(agentView && {agent: true})});
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

	const [anchor, setAnchor] = useState<Anchor | null>(null);
	const rowCache = useRef(createRowCache()).current;
	const layoutOf = useRef(createLayoutCache(rowCache)).current;
	// Text selected with the mouse in the transcript; copied when the button is let go.
	const [selection, setSelectionState] = useState<Span | null>(null);
	// Mouse events come faster than renders, so the ref holds the truth.
	const selectionRef = useRef<Span | null>(null);
	const setSelection = (span: Span | null) => {
		if (selectionRef.current === span) return;
		selectionRef.current = span;
		setSelectionState(span);
	};
	const dragRef = useRef<{anchor: Mark; moved: boolean} | null>(null);
	const clicksRef = useRef({at: 0, x: -1, y: -1, count: 0});
	const shownRowsRef = useRef<VisibleRow[]>([]);
	const [copyNotice, setCopyNotice] = useState<string | undefined>(undefined);
	const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (noticeTimer.current) clearTimeout(noticeTimer.current);
		},
		[],
	);
	const showCopyNotice = (text: string) => {
		if (noticeTimer.current) clearTimeout(noticeTimer.current);
		setCopyNotice(text);
		noticeTimer.current = setTimeout(() => {
			noticeTimer.current = null;
			if (alive.current) setCopyNotice(undefined);
		}, COPY_NOTICE_MS);
	};
	const clearSelection = () => {
		dragRef.current = null;
		setSelection(null);
	};
	const linesRef = useRef(lines);
	linesRef.current = lines;
	// While the console covers the chat its width is 0; keep wrapping at the last real width.
	const widthRef = useRef(Math.max(1, columns));
	const shownWidth = side ? geo.mainColumns : columns;
	if (shownWidth > 0) widthRef.current = shownWidth;
	const width = widthRef.current;
	const transcriptBoxRef = useRef<DOMElement>(null);
	const viewportHeight = () => {
		const height = transcriptBoxRef.current ? measureElement(transcriptBoxRef.current).height : 0;
		return height > 0 ? height : Math.max(1, rows - 6);
	};
	const hintShown = useRef(false);
	// A scrolled view always shows the hint, so its top is clamped with the hint row taken.
	const anchoredViewport = () => Math.max(1, viewportHeight() - (hintShown.current ? 0 : 1));
	// Set when a main view mounts: its first print (the banner) goes above the welcome hint, so the hint reads under it.
	const welcomeBelowNext = useRef(false);
	const printMain = (text: string, color?: string, options?: PrintOptions) => {
		const actions = cleanActions(options?.actions);
		const render = typeof options?.render === 'function' ? options.render : undefined;
		const line = {id: nextId++, text, color, ...(actions && {actions}), ...(render && {render})};
		if (!welcomeBelowNext.current) {
			setLines(prev => [...prev, line].slice(-MAX_LINES));
			return;
		}
		welcomeBelowNext.current = false;
		setLines(prev => {
			const at = prev.findIndex(l => l.welcome);
			return (at < 0 ? [...prev, line] : [...prev.slice(0, at), line, ...prev.slice(at)]).slice(-MAX_LINES);
		});
	};
	const scrollBy = (delta: number) => {
		const viewport = anchoredViewport();
		setAnchor(a => scrollAnchor(linesRef.current, a, delta, rowCache, widthRef.current, viewport));
	};
	useEffect(() => {
		const next = normalizeAnchor(lines, anchor, rowCache, width, anchoredViewport());
		if (!sameAnchor(next, anchor)) setAnchor(next);
	}, [lines, width, anchor, rows, main]);
	const [panelScroll, setPanelScroll] = useState(0);
	const panelScrollRef = useRef(0);
	panelScrollRef.current = panelScroll;
	const panelLinesRef = useRef(panelLines);
	panelLinesRef.current = panelLines;
	const printPanel = (text: string, color?: string) => {
		// One panel line per row, so the panel scroll can keep counting lines.
		const parts = text.split(/\r?\n/);
		setPanelLines(prev => [...prev, ...parts.map(part => ({id: nextId++, text: part, color}))].slice(-MAX_PANEL_LINES));
		if (panelScrollRef.current > 0) setPanelScroll(s => Math.min(s + parts.length, MAX_PANEL_LINES - 1));
	};
	const panelScrollBy = (delta: number) =>
		setPanelScroll(s =>
			Math.max(0, Math.min(Math.max(0, panelLinesRef.current.length - live.current.panelOutputRows), s + delta)),
		);
	const sideRef = useRef(side);
	sideRef.current = side;
	// Console output stays in the panel while it sits beside a view, else it goes to the scrollback.
	const printConsole = (text: string, color?: string) => (sideRef.current ? printPanel : printMain)(text, color);

	// A passive panel view: no focus change, opens the console, hides the prompt. Used by assistant commands and `activity` mounts.
	const mountActivity = (
		build: (control: MountControl) => UiElement,
		print: (text: string) => void,
		agent: boolean,
	): AgentViewHandle => {
		const refused = (error: Error): AgentViewHandle => ({done: Promise.reject(error), close: () => {}});
		if (pending.current.panel) return refused(new Error('A view is already mounted'));
		const id = nextMountId++;
		openMounts.current.add(id);
		const control: MountControl = {close: () => settle('panel', id), print, host: makeHost('panel', id)};
		let element: UiElement;
		try {
			element = build(control);
		} catch (error) {
			dropMount('panel', id);
			return refused(error instanceof Error ? error : new Error(String(error)));
		}
		let resolve!: () => void;
		let reject!: (error: Error) => void;
		const done = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		pending.current.panel = {id, resolve, reject};
		activityMounts.current.set(id, {agent});
		log.debug('view mounted', {id, ...(agent ? {agent: true} : {activity: true})});
		setPanelView({id, element, activity: true});
		startOwner();
		return {done, close: () => settle('panel', id)};
	};

	const mount =
		(fallbackPrint: (text: string) => void, onMain: () => void): NonNullable<CommandContext['mount']> =>
		(build, options) => {
			if (options?.activity === true) {
				if (options.target !== 'panel') return Promise.reject(new Error('Activity views can only be shown in the console panel'));
				return mountActivity(build, fallbackPrint, false).done;
			}
			return new Promise<void>((resolve, reject) => {
				const target: MountTarget = options?.target === 'panel' ? 'panel' : 'main';
				if (pending.current[target]) {
					reject(new Error('A view is already mounted'));
					return;
				}
				const id = nextMountId++;
				openMounts.current.add(id);
				const control: MountControl = {
					close: () => settle(target, id),
					print: target === 'main' ? (text, options) => printMain(text, undefined, options) : fallbackPrint,
					host: makeHost(target, id),
					copyToClipboard: text => copyToClipboard(stdout, text),
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
					welcomeBelowNext.current = true;
					setAnchor(null);
					clearSelection();
					setMain({id, element});
					setFocus('main');
				} else {
					setPanelView({id, element});
					setFocus('panel');
				}
			});
		};

	const clearAll = () => {
		clearSelection();
		setLines([]);
		setPanelLines([]);
		setAnchor(null);
		setPanelScroll(0);
	};

	// The bridge outlives renders, so it reads the latest closures through this ref.
	const mountAgentView = (build: (control: MountControl) => UiElement, print: (text: string) => void) => mountActivity(build, print, true);
	const bridgeDeps = useRef({tee: printConsole, clear: clearAll, afterRun: refreshCatalog, mountView: mountAgentView, beforeRun: startOwner, endRun: endOwner});
	bridgeDeps.current = {tee: printConsole, clear: clearAll, afterRun: refreshCatalog, mountView: mountAgentView, beforeRun: startOwner, endRun: endOwner};
	const bridgeRef = useRef<CommandBridge | null>(null);
	bridgeRef.current ??= createCommandBridge({
		find: name => registry.find(name),
		catalog: () => buildCatalog(registry.commands),
		mode: () => getPrefs().agentCommands,
		tee: (text, color) => bridgeDeps.current.tee(text, color),
		clear: () => bridgeDeps.current.clear(),
		exit,
		mountView: (build, print) => bridgeDeps.current.mountView(build, print),
		afterRun: () => bridgeDeps.current.afterRun(),
		beforeRun: () => bridgeDeps.current.beforeRun(),
		endRun: () => bridgeDeps.current.endRun(),
		log,
	});
	const commandBridge = bridgeRef.current;

	const makeCtx = (print: (text: string, color?: string) => void): CommandContext => {
		// A command that opened the main view keeps printing into the scrollback above it.
		let ownsMain = false;
		const out = (text: string, color?: string) => (ownsMain ? printMain : print)(text, color);
		return {
			print: text => out(text),
			clear: clearAll,
			exit,
			copyToClipboard: text => copyToClipboard(stdout, text),
			suspend: fn => suspendTerminal(stdin as never, stdout as never, fn, mouse),
			mount: mount(
				text => out(text),
				() => {
					ownsMain = true;
				},
			),
			commandBridge,
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
		const parsed = parseLine(raw);
		if (!parsed) return;
		const {name, args} = parsed;

		setHistory(prev => (prev.at(-1) === line ? prev : [...prev, line]));

		const command = registry.find(name);
		if (!command) {
			log.debug('unknown command', {unknownCommand: true});
			for (const text of unknownCommandLines(catalog, name)) printConsole(text, c('red'));
			return;
		}
		await runCommand(command, name, args, printConsole);
	};

	submitRef.current = handleSubmit;


	useInput((input, key) => {
		// Any key ends a selection, as in a terminal; the key still does its work.
		if (selectionRef.current || dragRef.current) clearSelection();
		const direction = focusMove(key);
		if (direction) {
			moveFocus(direction);
			return;
		}
		if (!isConsoleToggle(input, key)) {
			// The transcript scrolls unless the side console has the input.
			if (side && active === 'panel') {
				panelEpoch.current++;
				return;
			}
			const page = Math.max(1, viewportHeight() - 1);
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
	const mainViewRef = useRef<DOMElement>(null);
	const consoleBodyRef = useRef<DOMElement>(null);
	// The first listener returning exactly true consumes the event.
	const dispatchToView = (target: MountTarget, e: MouseInputEvent, rect: Rect): boolean => {
		const mountId = pending.current[target]?.id;
		if (mountId === undefined || e.kind === 'drag') return false;
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
	// The transcript row and cell under the pointer, clamped to the transcript box.
	const markUnder = (e: MouseInputEvent, rect: Rect): Mark | undefined => {
		const shown = shownRowsRef.current;
		if (shown.length === 0 || rect.height <= 0) return undefined;
		const y = Math.max(0, Math.min(rect.height - 1, e.y - rect.y));
		// Rows sit at the bottom of the box and the overflow is clipped at the top.
		const index = Math.max(0, Math.min(shown.length - 1, shown.length - (rect.height - y)));
		const row = shown[index]!;
		const line = linesRef.current.find(x => x.id === row.id);
		if (!line) return undefined;
		const x = Math.max(0, Math.min(rect.width, e.x - rect.x));
		return markAt(row.id, layoutOf(line, widthRef.current), row.row, x);
	};

	const copySelection = (span: Span) => {
		const text = selectedText(linesRef.current, span, layoutOf, widthRef.current);
		if (text === '') return;
		showCopyNotice(copyToClipboard(stdout, text) ? `Copied ${text.length} character${text.length === 1 ? '' : 's'}` : 'Too long to copy');
	};

	// Press, drag and release over the transcript select text; true when the event was used for that.
	const selectionMouse = (e: MouseInputEvent): boolean => {
		const box = transcriptBoxRef.current;
		const drag = dragRef.current;
		if (e.kind === 'drag') {
			if (!drag || !box) return false;
			const abs: Rect = measureElement(box);
			// Past the top or bottom edge the transcript scrolls one row per move.
			if (e.y < abs.y) scrollBy(1);
			else if (e.y >= abs.y + abs.height) scrollBy(-1);
			const head = markUnder(e, abs);
			if (!head) return true;
			drag.moved = true;
			setSelection(spanOf(drag.anchor, head));
			return true;
		}
		if (e.kind === 'release') {
			if (!drag) return false;
			dragRef.current = null;
			const current = selectionRef.current;
			if (drag.moved && current && !emptySpan(current)) copySelection(current);
			return true;
		}
		if (e.kind !== 'press' || e.button !== 'left' || !box) return false;
		const abs: Rect = measureElement(box);
		if (!inside(abs, e.x, e.y)) {
			clearSelection();
			return false;
		}
		const mark = markUnder(e, abs);
		if (!mark) {
			clearSelection();
			return true;
		}
		const now = Date.now();
		const c = clicksRef.current;
		const count = now - c.at <= MULTI_CLICK_MS && c.x === e.x && c.y === e.y ? (c.count % 3) + 1 : 1;
		clicksRef.current = {at: now, x: e.x, y: e.y, count};
		if (count === 1) {
			const line = linesRef.current.find(x => x.id === mark.id);
			const action = line && actionAt(line, layoutOf(line, widthRef.current), mark.offset);
			if (action) {
				clearSelection();
				showCopyNotice(copyToClipboard(stdout, action.copy) ? `Copied ${action.copy.length} character${action.copy.length === 1 ? '' : 's'}` : 'Too long to copy');
				return true;
			}
			dragRef.current = {anchor: mark, moved: false};
			setSelection(null);
			return true;
		}
		const line = linesRef.current.find(x => x.id === mark.id);
		if (!line) return true;
		const layout = layoutOf(line, widthRef.current);
		const span = count === 2 ? wordSpan(layout, mark) : lineSpan(layout, mark.id);
		dragRef.current = null;
		setSelection(emptySpan(span) ? null : span);
		if (!emptySpan(span)) copySelection(span);
		return true;
	};

	// Mouse events come faster than renders, so the ref holds the share being dragged.
	const resizeRef = useRef<number | null>(null);
	// A press on the console's left border starts a resize; drags move it and the release saves it.
	const resizeMouse = (e: MouseInputEvent, l: typeof snapshot, panelRect: Rect | undefined): boolean => {
		if (resizeRef.current !== null) {
			if (e.kind === 'drag') {
				resizeRef.current = shareAtBorder(l.columns, e.x);
				setDragShare(resizeRef.current);
			} else if (e.kind === 'release') {
				setPrefs({panelShare: resizeRef.current});
				resizeRef.current = null;
				setDragShare(null);
			}
			return true;
		}
		if (e.kind !== 'press' || e.button !== 'left' || !l.split || !panelRect) return false;
		if (e.x !== panelRect.x || !inside(panelRect, e.x, e.y)) return false;
		clearSelection();
		panelEpoch.current++;
		resizeRef.current = shareAtBorder(l.columns, e.x);
		setDragShare(resizeRef.current);
		return true;
	};

	const handleMouse = (e: MouseInputEvent) => {
		if (!getPrefs().mouse) return;
		const l = live.current;
		const touchedConsole = (e.kind === 'press' || e.wheel !== undefined) && l.side && l.panelOpen;
		const panelRect = l.split && panelRef.current ? measureElement(panelRef.current) : undefined;
		if (resizeMouse(e, l, panelRect)) return;
		const area = areaAt(e, {side: l.side, panelOpen: l.panelOpen, split: l.split, panelRect});
		if (touchedConsole && area === 'panel') panelEpoch.current++;
		if (e.kind === 'press' && e.button === 'left') {
			if (l.side && l.panelOpen && l.split && area !== l.active) {
				panelEpoch.current++;
				setFocus(area);
				live.current = {...l, active: area};
			}
		}
		if (selectionMouse(e)) return;
		// Views get presses, releases and the wheel; drags only select.
		if (e.kind === 'drag') return;
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

	const consoleBody = (inner: number, height?: number) => {
		const view = panelView && (
			<ViewLayoutContext.Provider value={panelLayout}>
				<MountBoundary key={panelView.id} onError={error => settle('panel', panelView.id, error)}>
					{panelView.element as ReactNode}
				</MountBoundary>
			</ViewLayoutContext.Provider>
		);
		if (panelView && !panelView.activity) return view;
		// The prompt keeps its place in the tree while an activity view is shown, so the draft survives.
		const prompt = (
			<Prompt
				history={history}
				catalog={catalog}
				onSubmit={handleSubmit}
				onInterrupt={exit}
				mouseRef={promptMouse}
				columns={inner}
				{...(height !== undefined && {rows: height})}
				active={active === 'panel' && !panelView}
				isHostKey={isHostKey}
				{...(side && {onIdleTab: () => void togglePanel()})}
				{...(side && geo.split && {onLeftEdge: () => {
						panelEpoch.current++;
						setFocus('main');
					}})}
			/>
		);
		return (
			<>
				{view}
				<Box key="prompt" flexDirection="column" display={panelView ? 'none' : 'flex'}>
					{prompt}
				</Box>
			</>
		);
	};

	const panel = () => {
		const height = geo.panelRows;
		const newer = Math.min(panelScroll, Math.max(0, panelLines.length - panelOutputRows));
		const outputRows = Math.max(0, panelOutputRows - (newer > 0 ? 1 : 0));
		const end = Math.max(0, panelLines.length - newer);
		const resizeColor = dragShare !== null ? c('cyan') : undefined;
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
				borderDimColor={active !== 'panel' && dragShare === null}
				{...(resizeColor && {borderColor: resizeColor})}
				paddingLeft={1}
			>
				<Box flexShrink={0}>
					<Text dimColor wrap="truncate-end">
						{geo.split ? PANEL_TITLE : 'Console · Tab close'}
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

	const view = visibleWindow(lines, anchor, rowCache, width, rows);
	hintShown.current = view.newer > 0;
	shownRowsRef.current = view.rows;
	const marks = selection
		? (row: VisibleRow) => {
				if (row.id < selection.from.id || row.id > selection.to.id) return undefined;
				const line = lines.find(x => x.id === row.id);
				return line ? rowCells(row, selection, layoutOf(line, width)) : undefined;
			}
		: undefined;
	const transcript = <Transcript rows={view.rows} newer={view.newer} boxRef={transcriptBoxRef} marks={marks} notice={copyNotice} />;

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
							<ViewLayoutContext.Provider value={mainLayout}>
								<MountBoundary key={main.id} onError={error => settle('main', main.id, error)}>
									{/* UiElement is opaque in the host contract; it is a React element here */}
									{main.element as ReactNode}
								</MountBoundary>
							</ViewLayoutContext.Provider>
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
