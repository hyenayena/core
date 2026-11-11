import {SGR_ATTR, SGR_RESET, colorDepth, toneSgr, type ColorDepth} from '../kit/theme.js';
import type {Segment} from './layout.js';

export function paintSegments(segments: readonly Segment[], depth: ColorDepth = colorDepth()): string {
	return segments
		.map(seg => {
			const open = [
				seg.tone === undefined ? '' : toneSgr(seg.tone, depth),
				seg.surface === true ? toneSgr('surface', depth) : '',
				seg.bold === true ? SGR_ATTR.bold : '',
				seg.underline === true ? SGR_ATTR.underline : '',
				seg.inverse === true ? SGR_ATTR.inverse : '',
			].join('');
			return open === '' || seg.text === '' ? seg.text : `${open}${seg.text}${SGR_RESET}`;
		})
		.join('');
}
