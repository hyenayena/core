import {buildCatalog} from '../hints/catalog.js';
import {layoutHints} from '../hints/layout.js';
import {computeHints} from '../hints/model.js';
import {paintSegments} from '../hints/paint.js';
import {promptSegments, syntaxRanges} from '../hints/syntax.js';
import {windowLine} from '../hints/viewport.js';
import {graphemes, stringCells} from '../hints/width.js';
import {activityRow} from '../kit/activity.js';
import type {GalleryRenderer} from '../kit/gallery.js';
import {glyph} from '../kit/glyphs.js';
import {renderStyled, table} from '../kit/styled.js';
import {SGR_ATTR, SGR_RESET, paintTone, toneSgr} from '../kit/theme.js';
import {appendEntries, beginSection, endSection, sectionRows, type PanelEntry, type PanelSection} from '../panel/sections.js';
import {panelTitleRow} from '../panel/title.js';
import {sliceStyledCells, styledCells, wrapRows} from '../transcript/wrap.js';

const NOW = 1_000_000;
const COMMANDS = [
	{
		name: 'dev',
		description: 'Development tools',
		subcommands: [
			{name: 'check', description: 'Typecheck, then run the tests'},
			{name: 'test', description: 'Run the tests', options: [{name: '--file', value: '<path>', description: 'Only this test file'}]},
			{name: 'typecheck', description: 'Only typecheck'},
		],
	},
];

function sections(): PanelSection[] {
	let id = 1;
	const entry = (text: string, tone?: PanelEntry['tone']): PanelEntry => (tone === undefined ? {id: id++, text} : {id: id++, text, tone});
	let list: PanelSection[] = [];
	list = beginSection(list, {id: 100, echo: 'mod list'}, NOW);
	list = appendEntries(list, 100, [entry('core 0.22.2'), entry('dev 0.7.0'), entry('chat 0.5.2')], NOW);
	list = endSection(list, 100, 'ok', NOW + 400);
	list = beginSection(list, {id: 101, echo: 'dev check core', caller: 'claude'}, NOW + 1000);
	list = appendEntries(list, 101, [entry('Error: 2 tests failed', 'error')], NOW + 1000);
	list = endSection(list, 101, 'failed', NOW + 13_000);
	list = beginSection(list, {id: 102, echo: 'task list'}, NOW + 14_000);
	const styled = [
		table(
			[
				['TASK-34', 'Add the activity API to the core kit', 'done'],
				['UI-6', 'Redesign the side console panel', 'running'],
			],
			{head: ['Id', 'Title', 'State'], flex: 1},
		),
	];
	const rendered: PanelEntry = {
		id: id++,
		text: 'TASK-34  UI-6',
		render: w => renderStyled(styled, w, {color: 'none'}),
	};
	list = appendEntries(list, 102, [rendered], NOW + 14_000);
	return list;
}

function rowsOf(entry: PanelEntry, width: number): string[] {
	const out = entry.render?.(width);
	return wrapRows(out === undefined ? entry.text : typeof out === 'string' ? out : out.text, width);
}

export const consoleRenderer: GalleryRenderer = ({width, depth, ascii}) => {
	const inner = Math.max(1, width - 2);
	const frame = paintTone(glyph('vRule', {ascii}), 'frame', depth);
	const fit = (text: string): string => (styledCells(text) <= inner ? text : sliceStyledCells(text, 0, inner));
	const edge = (text: string): string => `${frame} ${fit(text)}`;
	const catalog = buildCatalog(COMMANDS);

	const promptLine = (value: string): string => {
		const prompt = `${glyph('prompt', {ascii})} `;
		const gs = graphemes(value);
		const win = windowLine(gs, gs.length, '', Math.max(1, inner - stringCells(prompt) - 1));
		const body = promptSegments(value, win, syntaxRanges(value, catalog))
			.map(seg => {
				const open = (seg.bold ? SGR_ATTR.bold : '') + (seg.tone === undefined ? '' : toneSgr(seg.tone, depth)) + (seg.cursor ? SGR_ATTR.inverse : '');
				return open === '' ? seg.text : `${open}${seg.text}${SGR_RESET}`;
			})
			.join('');
		return paintTone(prompt, 'focus', depth) + body;
	};

	const rows: string[] = [
		panelTitleRow({focused: true, split: true, folds: 'unfold', width: inner, depth, ascii}),
		panelTitleRow({focused: false, split: true, width: inner, depth, ascii}),
		activityRow(
			[
				{source: 'dev', id: 'test', label: 'dev', state: 'running', done: 120, total: 340},
				{source: 'scheduler', id: 'nightly', label: 'nightly', state: 'ok'},
				{source: 'chat', id: 'main', label: 'chat', state: 'running'},
			],
			inner,
			{frame: 0, depth, ascii},
		),
		...sectionRows(sections(), rowsOf, {width: inner, depth, ascii, now: NOW + 20_000}).map(r => r.text),
		promptLine('dev test core --file x'),
		promptLine('dev '),
		...layoutHints(computeHints(catalog, 'dev '), {sel: 1, anchor: 2 + stringCells('dev ')}, {columns: inner, rows: 24}).map(row =>
			paintSegments(row.segments, depth),
		),
	];
	return rows.map(edge);
};
