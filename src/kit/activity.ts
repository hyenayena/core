import type {EventBus} from '../../../../src/api.js';
import {sanitizeText} from '../hints/sanitize.js';
import {glyph, spinnerFrames} from './glyphs.js';
import {segmentBar, type BarSegment} from './segment-bar.js';
import {SGR_RESET, colorDepth, toneSgr, type ColorDepth, type ThemeTone} from './theme.js';

export const ACTIVITY_TOPIC = 'yena.activity';
export const ACTIVITY_FLASH_MS = 4000;
export const ACTIVITY_STALE_MS = 30 * 60 * 1000;
export const ACTIVITY_MAX_ITEMS = 12;

export type ActivityState = 'running' | 'ok' | 'failed' | 'cancelled' | 'gone';

export type ActivityReport = {
	source: string;
	id: string;
	label: string;
	state: ActivityState;
	done?: number;
	total?: number;
	detail?: string;
};

const STATES: readonly string[] = ['running', 'ok', 'failed', 'cancelled', 'gone'];
const NAME = /^[a-z][a-z0-9._:-]{0,63}$/;
const TEXT_MAX = 60;
const COUNT_MAX = 1e9;

export function reportActivity(events: EventBus | undefined, report: ActivityReport): void {
	try {
		events?.emit(ACTIVITY_TOPIC, report);
	} catch {
		// A broken subscriber must never fail the work that reports progress.
	}
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= COUNT_MAX;

export function readActivity(payload: unknown): ActivityReport | undefined {
	if (typeof payload !== 'object' || payload === null) return undefined;
	const p = payload as Record<string, unknown>;
	const {source, id, state} = p;
	if (typeof source !== 'string' || !NAME.test(source)) return undefined;
	if (typeof id !== 'string' || !NAME.test(id)) return undefined;
	if (typeof state !== 'string' || !STATES.includes(state)) return undefined;
	if (typeof p['label'] !== 'string') return undefined;
	const label = sanitizeText(p['label'], TEXT_MAX);
	if (label === '') return undefined;
	const report: ActivityReport = {source, id, label, state: state as ActivityState};
	if (isCount(p['done']) && isCount(p['total']) && p['done'] <= p['total']) {
		report.done = p['done'];
		report.total = p['total'];
	}
	if (typeof p['detail'] === 'string') {
		const detail = sanitizeText(p['detail'], TEXT_MAX);
		if (detail !== '') report.detail = detail;
	}
	return report;
}

export type ActivityItem = ActivityReport & {key: string; seenAt: number; finishedAt?: number};

export type ActivityFeed = {readonly items: readonly ActivityItem[]};

export const EMPTY_ACTIVITY: ActivityFeed = Object.freeze({items: Object.freeze([]) as readonly ActivityItem[]});

const activityKey = (r: {source: string; id: string}): string => `${r.source}:${r.id}`;

export function applyActivity(feed: ActivityFeed, report: ActivityReport, now: number): ActivityFeed {
	const key = activityKey(report);
	if (report.state === 'gone') return feed.items.some(i => i.key === key) ? {items: feed.items.filter(i => i.key !== key)} : feed;
	const item: ActivityItem = {...report, key, seenAt: now, ...(report.state === 'running' ? {} : {finishedAt: now})};
	const at = feed.items.findIndex(i => i.key === key);
	const items = at < 0 ? [...feed.items, item] : feed.items.map((i, n) => (n === at ? item : i));
	while (items.length > ACTIVITY_MAX_ITEMS) {
		const finished = items.findIndex(i => i.finishedAt !== undefined);
		items.splice(finished < 0 ? 0 : finished, 1);
	}
	return {items};
}

const expiresAt = (i: ActivityItem): number => (i.finishedAt === undefined ? i.seenAt + ACTIVITY_STALE_MS : i.finishedAt + ACTIVITY_FLASH_MS);

export function visibleActivity(feed: ActivityFeed, now: number): readonly ActivityItem[] {
	return feed.items.filter(i => expiresAt(i) > now);
}

export function nextActivityChange(feed: ActivityFeed, now: number): number | undefined {
	const times = feed.items.map(expiresAt).filter(t => t > now);
	return times.length === 0 ? undefined : Math.min(...times) - now;
}

export type ActivityRowOptions = {frame: number; depth?: ColorDepth; ascii?: boolean};

function paint(text: string, tone: ThemeTone, depth: ColorDepth): string {
	const open = toneSgr(tone, depth);
	return open === '' || text === '' ? text : `${open}${text}${SGR_RESET}`;
}

export function activityRow(items: readonly ActivityReport[], width: number, options: ActivityRowOptions): string {
	if (items.length === 0) return '';
	const depth = options.depth ?? colorDepth();
	const ascii = options.ascii === true;
	const frames = spinnerFrames('braille', {ascii});
	const mark = (state: ActivityState): string => {
		switch (state) {
			case 'running':
				return paint(frames[((options.frame % frames.length) + frames.length) % frames.length]!, 'running', depth);
			case 'ok':
				return paint(glyph('check', {ascii}), 'ok', depth);
			case 'failed':
				return paint(glyph('cross', {ascii}), 'error', depth);
			default:
				return paint(ascii ? '.' : '·', 'warn', depth);
		}
	};
	const segments: BarSegment[] = items.map(i => {
		const m = mark(i.state);
		const full = `${m} ${i.label}`;
		const counts = i.done !== undefined && i.total !== undefined ? paint(`${i.done}/${i.total}`, 'muted', depth) : '';
		const detail = i.detail === undefined ? '' : paint(i.detail, 'muted', depth);
		const forms = [
			[full, counts, detail],
			[full, counts],
			[full],
		].map(parts => parts.filter(p => p !== '').join(' '));
		return {forms: [...new Set([...forms, m])]};
	});
	return segmentBar(segments, width, {depth, ascii});
}
