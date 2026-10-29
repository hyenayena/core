import {stringCells} from '../hints/width.js';
import {wrapRows} from '../transcript/wrap.js';

export function hangingRows(prefix: string, text: string, width: number): string[] {
	const indent = stringCells(prefix);
	const room = Math.max(1, Math.floor(width) - indent);
	const pad = ' '.repeat(indent);
	return wrapRows(text, room).map((row, i) => (i === 0 ? prefix : pad) + row.replace(/ +$/, ''));
}
