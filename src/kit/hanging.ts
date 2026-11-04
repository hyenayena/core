import {styledCells, wrapRows} from '../transcript/wrap.js';

export function hangingRows(prefix: string, text: string, width: number): string[] {
	const indent = styledCells(prefix);
	const room = Math.max(1, Math.floor(width) - indent);
	const pad = ' '.repeat(indent);
	return wrapRows(text, room).map((row, i) => (i === 0 ? prefix : pad) + row.replace(/ +$/, ''));
}
