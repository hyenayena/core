import {segmentBar} from '../kit/segment-bar.js';
import {SGR_ATTR, SGR_RESET, colorDepth, toneSgr, type ColorDepth, type ThemeTone} from '../kit/theme.js';

export type PanelTitleOptions = {
	focused: boolean;
	split: boolean;
	folds?: 'unfold' | 'fold';
	width: number;
	depth?: ColorDepth;
	ascii?: boolean;
};

function paint(text: string, tone: ThemeTone, depth: ColorDepth, bold = false): string {
	const open = (bold ? SGR_ATTR.bold : '') + toneSgr(tone, depth);
	return open === '' ? text : `${open}${text}${SGR_RESET}`;
}

export function panelTitleRow(o: PanelTitleOptions): string {
	const depth = o.depth ?? colorDepth();
	const ascii = o.ascii === true;
	const hint = (text: string): {forms: string[]} => ({forms: [paint(text, 'muted', depth)]});
	const title = {forms: [paint('Console', o.focused ? 'focus' : 'frame', depth, true)], keep: true};
	const arrow = ascii ? 'Shift+Left' : '⇧←';
	return segmentBar(
		[
			title,
			hint('Tab close'),
			...(o.split ? [hint(`${arrow} chat`)] : []),
			...(o.folds === undefined ? [] : [hint(o.folds === 'unfold' ? '^O unfold' : '^O fold')]),
		],
		o.width,
		{depth, ascii},
	);
}
