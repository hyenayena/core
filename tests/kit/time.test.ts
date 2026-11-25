import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {
	MAX_TIME_ZONE_CHARS,
	canonicalTimeZone,
	currentTimeZone,
	formatLocalTime,
	formatUtcOffset,
	resetTimeZoneForTests,
	setTimeZone,
	systemTimeZone,
	configuredTimeZone,
	withTimeZone,
	zonedParts,
	zonedTime,
} from '../../src/kit/time.js';

const KYIV = 'Europe/Kyiv';

afterEach(() => resetTimeZoneForTests());

test('canonicalTimeZone keeps Kyiv as typed and fixes the case of known names', () => {
	assert.equal(canonicalTimeZone('Europe/Kyiv'), 'Europe/Kyiv');
	assert.equal(canonicalTimeZone('  europe/paris '), 'Europe/Paris');
	assert.equal(canonicalTimeZone('utc'), 'UTC');
	assert.equal(canonicalTimeZone('UTC'), 'UTC');
});

test('canonicalTimeZone rejects bogus input', () => {
	for (const bad of ['', '   ', 'Bogus/Zone', '+02:00', '../etc', 'a'.repeat(MAX_TIME_ZONE_CHARS + 1), 5, undefined, null, {}]) {
		assert.equal(canonicalTimeZone(bad), undefined, String(bad));
	}
});

test('systemTimeZone reads TZ, then falls back to a valid zone', () => {
	const saved = process.env['TZ'];
	try {
		process.env['TZ'] = ':Europe/Kyiv';
		resetTimeZoneForTests();
		assert.equal(systemTimeZone(), 'Europe/Kyiv');
		process.env['TZ'] = 'Bogus';
		resetTimeZoneForTests();
		assert.ok(canonicalTimeZone(systemTimeZone()));
		process.env['TZ'] = 'Asia/Tokyo';
		assert.ok(systemTimeZone());
	} finally {
		if (saved === undefined) delete process.env['TZ'];
		else process.env['TZ'] = saved;
	}
});

test('currentTimeZone follows withTimeZone, then the configured zone, then the system zone', () => {
	const system = currentTimeZone();
	setTimeZone('Asia/Tokyo');
	assert.equal(configuredTimeZone(), 'Asia/Tokyo');
	assert.equal(currentTimeZone(), 'Asia/Tokyo');
	assert.equal(withTimeZone('UTC', () => withTimeZone('America/New_York', () => currentTimeZone())), 'America/New_York');
	assert.equal(withTimeZone('UTC', () => currentTimeZone()), 'UTC');
	setTimeZone(undefined);
	assert.equal(currentTimeZone(), system);
});

test('zonedParts gives wall fields, weekday and offset', () => {
	const p = zonedParts(Date.UTC(2026, 10, 25, 7, 14, 30), KYIV);
	assert.deepEqual(p, {year: 2026, month: 11, day: 25, hour: 9, minute: 14, second: 30, weekday: 3, offsetMinutes: 120});
	assert.equal(zonedParts(Date.UTC(2026, 6, 1, 12), KYIV).offsetMinutes, 180);
	assert.equal(zonedParts(Date.UTC(2026, 0, 1, 0), 'UTC').hour, 0);
	assert.equal(zonedParts(Date.UTC(2026, 0, 1, 0), 'Asia/Kolkata').offsetMinutes, 330);
});

test('zonedTime converts wall time and rejects impossible fields', () => {
	assert.equal(zonedTime({year: 2026, month: 11, day: 25, hour: 9, minute: 14}, KYIV), Date.UTC(2026, 10, 25, 7, 14));
	assert.equal(zonedTime({year: 2026, month: 2, day: 30, hour: 1, minute: 0}, KYIV), undefined);
	assert.equal(zonedTime({year: 2026, month: 13, day: 1, hour: 1, minute: 0}, KYIV), undefined);
	assert.equal(zonedTime({year: 2026, month: 1, day: 1, hour: 24, minute: 0}, KYIV), undefined);
});

test('zonedTime in a DST gap moves forward and in an overlap takes the earlier instant', () => {
	assert.equal(zonedTime({year: 2026, month: 3, day: 29, hour: 3, minute: 30}, KYIV), Date.UTC(2026, 2, 29, 1, 30));
	assert.equal(zonedTime({year: 2026, month: 3, day: 29, hour: 4, minute: 0}, KYIV), Date.UTC(2026, 2, 29, 1, 0));
	assert.equal(zonedTime({year: 2026, month: 10, day: 25, hour: 3, minute: 30}, KYIV), Date.UTC(2026, 9, 25, 0, 30));
	assert.equal(zonedTime({year: 2026, month: 10, day: 25, hour: 4, minute: 0}, KYIV), Date.UTC(2026, 9, 25, 2, 0));
});

test('formatUtcOffset and formatLocalTime', () => {
	assert.equal(formatUtcOffset(120), 'UTC+02:00');
	assert.equal(formatUtcOffset(-210), 'UTC-03:30');
	assert.equal(formatUtcOffset(0), 'UTC+00:00');
	assert.equal(formatLocalTime(Date.UTC(2026, 10, 25, 7, 14), KYIV), '2026-11-25 Wed 09:14 (Europe/Kyiv, UTC+02:00)');
	assert.equal(formatLocalTime(Date.UTC(2026, 10, 25, 0, 5), 'UTC'), '2026-11-25 Wed 00:05 (UTC, UTC+00:00)');
});

test('canonicalTimeZone refuses values that could reach TZ or a path as anything but a zone name', () => {
	const hostile = ['../x', '../../etc/passwd', 'Europe/Kyiv\nX=1', 'Europe\nKyiv', 'Europe/Kyiv X=1', 'Europe/Kyiv;rm', '$(id)', ':UTC', '/etc/localtime', '.UTC', '0', 'UTC\0', 'a'.repeat(65), 'Europe/' + 'a'.repeat(60)];
	for (const bad of hostile) assert.equal(canonicalTimeZone(bad), undefined, JSON.stringify(bad));
	assert.equal(canonicalTimeZone('Europe/Kyiv\n'), 'Europe/Kyiv', 'only the ends are trimmed');
	assert.equal(canonicalTimeZone('a'.repeat(64)), undefined, 'a name of the maximum length that is not a zone');
});

test('setTimeZone with a hostile value leaves the system zone in force', () => {
	const system = currentTimeZone();
	for (const bad of ['../x', 'Europe/Kyiv\nX=1', ':UTC', '', 'a'.repeat(65)]) {
		setTimeZone(bad);
		assert.equal(configuredTimeZone(), undefined, JSON.stringify(bad));
		assert.equal(currentTimeZone(), system);
	}
});
