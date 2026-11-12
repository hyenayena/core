import {sanitizeText} from '../hints/sanitize.js';
import {commandError} from './command-error.js';
import {sanitizeStyled} from './styled-sanitize.js';
import {wrapRows} from '../transcript/wrap.js';
import {SGR_ATTR, paintTone, withColorDepth, type ColorDepth} from './theme.js';

export type GalleryRenderOptions = {width: number; rows: number; depth: ColorDepth; ascii: boolean};

export type GalleryRenderer = (options: GalleryRenderOptions) => readonly string[];

export type GallerySection = {
	name: string;
	title: string;
	description?: string;
	load: () => GalleryRenderer | Promise<GalleryRenderer>;
};

export type LoadedGallerySection = {section: GallerySection; renderer: GalleryRenderer};

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const LOAD_TIMEOUT_MS = 5000;

const builtin: GallerySection[] = [];
const added: GallerySection[] = [];

const taken = (name: string): boolean => builtin.some(s => s.name === name) || added.some(s => s.name === name);

// Core-internal: the built-in sections (not part of the kit's exports).
export function defineBuiltinSection(section: GallerySection): void {
	if (!taken(section.name)) builtin.push(section);
}

export function registerGallerySection(section: GallerySection): boolean {
	try {
		if (typeof section !== 'object' || section === null) return false;
		const {name, title, load} = section;
		if (typeof name !== 'string' || !NAME.test(name) || typeof title !== 'string' || typeof load !== 'function') return false;
		if (taken(name)) return false;
		added.push({
			name,
			title,
			load,
			...(typeof section.description === 'string' && {description: section.description}),
		});
		return true;
	} catch {
		return false;
	}
}

export const gallerySections = (): readonly GallerySection[] => [...builtin, ...added];

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function loadOne(section: GallerySection): Promise<LoadedGallerySection> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('load timed out')), LOAD_TIMEOUT_MS);
		});
		const renderer = await Promise.race([Promise.resolve().then(() => section.load()), timeout]);
		if (typeof renderer !== 'function') throw new Error('load returned no renderer');
		return {section, renderer};
	} catch (err) {
		return {
			section,
			renderer: () => {
				throw err;
			},
		};
	} finally {
		clearTimeout(timer);
	}
}

export async function loadGallery(names: readonly string[]): Promise<LoadedGallerySection[]> {
	const all = gallerySections();
	const chosen =
		names.length === 0
			? all
			: names.map(n => {
					const s = all.find(x => x.name === n);
					if (!s) throw commandError('not-found', `Unknown gallery section: ${sanitizeText(n, 40)}. Sections: ${all.map(x => x.name).join(', ')}`);
					return s;
				});
	return Promise.all(chosen.map(loadOne));
}

function rowsOf(lines: readonly string[], width: number): string[] {
	const out: string[] = [];
	for (const line of lines) {
		for (const row of String(line).split('\n')) out.push(...wrapRows(sanitizeStyled(row), width));
	}
	return out;
}

export function renderGallery(
	loaded: readonly LoadedGallerySection[],
	options: Omit<GalleryRenderOptions, 'rows'> & {rows?: number},
	onError?: (section: string, err: unknown) => void,
): string[] {
	const width = Math.max(1, Math.floor(options.width));
	const rows = options.rows !== undefined && Number.isFinite(options.rows) ? Math.max(1, Math.floor(options.rows)) : 24;
	return withColorDepth(options.depth, () => {
		const out: string[] = [];
		loaded.forEach(({section, renderer}, i) => {
			if (i > 0) out.push('');
			out.push(...rowsOf([`${SGR_ATTR.bold}${paintTone(section.title, 'accent')}`], width));
			out.push(paintTone((options.ascii ? '-' : '─').repeat(width), 'frame'));
			try {
				out.push(...rowsOf(renderer({width, rows, depth: options.depth, ascii: options.ascii}), width));
			} catch (err) {
				try {
					onError?.(section.name, err);
				} catch {}
				out.push(...rowsOf([paintTone(`${section.name} failed: ${sanitizeText(message(err), 200)}`, 'error')], width));
			}
		});
		return out;
	});
}
