export const MAX_TIME_ZONE_CHARS = 64;

export type ZonedParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	weekday: number;
	offsetMinutes: number;
};

export type WallTime = {year: number; month: number; day: number; hour: number; minute: number; second?: number};

const NAME = /^[A-Za-z][A-Za-z0-9_+\-/]*$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MAX_FORMATTERS = 32;
const DAY_MS = 86_400_000;

let supported: readonly string[] | undefined;
let system: string | undefined;
let configured: string | undefined;
const overrides: string[] = [];
const formatters = new Map<string, Intl.DateTimeFormat>();

const knownZones = (): readonly string[] => {
	if (supported) return supported;
	const supportedValuesOf = (Intl as {supportedValuesOf?: (key: string) => string[]}).supportedValuesOf;
	supported = typeof supportedValuesOf === 'function' ? supportedValuesOf.call(Intl, 'timeZone') : [];
	return supported;
};

// Validity is judged by constructing a formatter: the resolved name is never used, as it rewrites Europe/Kyiv to Europe/Kiev.
export function canonicalTimeZone(name: unknown): string | undefined {
	if (typeof name !== 'string') return undefined;
	const zone = name.trim();
	if (zone.length === 0 || zone.length > MAX_TIME_ZONE_CHARS || !NAME.test(zone)) return undefined;
	try {
		new Intl.DateTimeFormat('en-US', {timeZone: zone});
	} catch {
		return undefined;
	}
	const lower = zone.toLowerCase();
	const known = knownZones().find(z => z.toLowerCase() === lower);
	if (known) return known;
	return lower === 'utc' ? 'UTC' : zone;
}

export function systemTimeZone(): string {
	if (system) return system;
	const fromEnv = canonicalTimeZone(process.env['TZ']?.replace(/^:/, ''));
	if (fromEnv) return (system = fromEnv);
	let resolved: string | undefined;
	try {
		resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		resolved = undefined;
	}
	return (system = canonicalTimeZone(resolved) ?? 'UTC');
}

export function setTimeZone(name: string | undefined): void {
	configured = name === undefined ? undefined : canonicalTimeZone(name);
}

export const configuredTimeZone = (): string | undefined => configured;

export const currentTimeZone = (): string => overrides.at(-1) ?? configured ?? systemTimeZone();

export function withTimeZone<T>(zone: string, fn: () => T): T {
	overrides.push(zone);
	try {
		return fn();
	} finally {
		overrides.pop();
	}
}

export function resetTimeZoneForTests(): void {
	system = undefined;
	configured = undefined;
	supported = undefined;
	overrides.length = 0;
	formatters.clear();
}

function formatterFor(zone: string): Intl.DateTimeFormat {
	let f = formatters.get(zone);
	if (f) return f;
	f = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
	});
	if (formatters.size >= MAX_FORMATTERS) formatters.delete(formatters.keys().next().value as string);
	formatters.set(zone, f);
	return f;
}

export function zonedParts(ms: number, zone: string = currentTimeZone()): ZonedParts {
	const raw: Record<string, number> = {};
	for (const p of formatterFor(zone).formatToParts(ms)) if (p.type !== 'literal') raw[p.type] = Number(p.value);
	const year = raw['year'] ?? 0;
	const month = raw['month'] ?? 1;
	const day = raw['day'] ?? 1;
	const hour = (raw['hour'] ?? 0) % 24;
	const minute = raw['minute'] ?? 0;
	const second = raw['second'] ?? 0;
	const wall = Date.UTC(year, month - 1, day, hour, minute, second);
	return {
		year,
		month,
		day,
		hour,
		minute,
		second,
		weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
		offsetMinutes: Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000),
	};
}

const inRange = (v: number, min: number, max: number): boolean => Number.isInteger(v) && v >= min && v <= max;

// A wall time in a DST gap moves forward (as a JS Date does); a repeated one takes the earlier instant.
export function zonedTime(wall: WallTime, zone: string = currentTimeZone()): number | undefined {
	const second = wall.second ?? 0;
	if (!inRange(wall.month, 1, 12) || !inRange(wall.day, 1, 31) || !inRange(wall.hour, 0, 23)) return undefined;
	if (!inRange(wall.minute, 0, 59) || !inRange(second, 0, 59) || !Number.isInteger(wall.year)) return undefined;
	const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, second);
	const check = new Date(asUtc);
	if (!Number.isFinite(asUtc) || check.getUTCMonth() + 1 !== wall.month || check.getUTCDate() !== wall.day) return undefined;
	const before = asUtc - zonedParts(asUtc - DAY_MS, zone).offsetMinutes * 60000;
	const after = asUtc - zonedParts(asUtc + DAY_MS, zone).offsetMinutes * 60000;
	const valid = [before, after].filter(t => t + zonedParts(t, zone).offsetMinutes * 60000 === asUtc);
	if (valid.length === 0) return before;
	return Math.min(...valid);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function formatUtcOffset(minutes: number): string {
	const abs = Math.abs(minutes);
	return `UTC${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function formatLocalTime(ms: number, zone: string = currentTimeZone()): string {
	const p = zonedParts(ms, zone);
	const date = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
	return `${date} ${WEEKDAYS[p.weekday]} ${pad(p.hour)}:${pad(p.minute)} (${zone}, ${formatUtcOffset(p.offsetMinutes)})`;
}
