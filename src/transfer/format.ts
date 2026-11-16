import path from 'node:path';

export function utcStamp(date: Date, seconds = false): string {
	return date.toISOString().slice(0, seconds ? 19 : 16).replace(/[:T]/g, '-');
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KiB', 'MiB', 'GiB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export const exportsDir = (dataDir: string): string => path.join(dataDir, 'exports');

export const resolveFile = (dataDir: string, file: string): string => path.resolve(exportsDir(dataDir), file);

export const clip = (text: string, max = 64): string => text.slice(0, max);

export function compareVersions(a: string, b: string): number {
	const parse = (v: string) => v.split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
	const [x, y] = [parse(a), parse(b)];
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
	return 0;
}
