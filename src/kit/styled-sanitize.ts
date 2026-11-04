import {sanitizeBlock} from '../hints/sanitize.js';

const SGR_TOKEN = new RegExp(`(${String.fromCharCode(27)}\\[[0-9;]{0,64}m)`);

// Keeps only SGR sequences; every other control sequence in the text between them is removed.
export function sanitizeStyled(row: string): string {
	return String(row)
		.split(SGR_TOKEN)
		.map((part, i) => (i % 2 === 1 ? part : sanitizeBlock(part).replace(/\n/g, ' ')))
		.join('');
}
