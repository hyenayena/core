import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {scrubSecretEnv} from '../../src/kit/text.js';

describe('scrubSecretEnv', () => {
	it('removes agent sockets and token-like variables', () => {
		const env = {
			PATH: '/bin',
			HOME: '/root',
			SSH_AUTH_SOCK: '/s',
			SSH_AGENT_PID: '1',
			GITHUB_TOKEN: 'g',
			AWS_SECRET_ACCESS_KEY: 'a',
			DB_PASSWORD: 'p',
			MY_api_key: 'k',
			GOOGLE_CREDENTIALS: 'c',
		};
		assert.deepEqual(scrubSecretEnv(env), {PATH: '/bin', HOME: '/root'});
	});

	it('drops secret-like names', () => {
		const bad = [
			'PRIVATE_KEY', 'DATABASE_URL', 'COOKIE', 'AUTH_HEADER', 'DB_PWD', 'REDIS_URI', 'SENTRY_DSN',
			'SIGNING_KEY', 'STRIPE_SK', 'MY_DEPLOY_KEY', 'SLACK_WEBHOOK_URL', 'MASTER_KEY', 'SESSION_SECRET',
		];
		assert.deepEqual(scrubSecretEnv(Object.fromEntries(bad.map(n => [n, 'x']))), {});
	});

	it('drops URLs with userinfo under any name and keeps credential-free URLs', () => {
		const out = scrubSecretEnv({
			FOO: 'postgres://u:p@h/db',
			ALL_PROXY: 'http://user@proxy.local:3128',
			NO_AT: 'http://proxy.local:3128',
			PATH_AT: 'https://example.com/a@b',
		});
		assert.deepEqual(Object.keys(out).sort(), ['NO_AT', 'PATH_AT']);
	});

	it('ignores bytes after 8 KiB and stays fast on a 1 MiB value', () => {
		const start = performance.now();
		const out = scrubSecretEnv({BIG: 'a://'.repeat(262144), LATE: 'x'.repeat(9000) + 'http://u:p@h/'});
		assert.ok(performance.now() - start < 100);
		assert.deepEqual(Object.keys(out).sort(), ['BIG', 'LATE']);
	});

	it('keeps safe names and listed names', () => {
		const good = ['PATH', 'HOME', 'USER', 'SHELL', 'PWD', 'TERM', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'NO_COLOR', '_', 'CUSTOM_FLAG'];
		const input = Object.fromEntries(good.map(n => [n, 'v']));
		assert.deepEqual(scrubSecretEnv(input), input);
		assert.equal(scrubSecretEnv({GITHUB_TOKEN: 'g'}, ['GITHUB_TOKEN']).GITHUB_TOKEN, 'g');
		assert.equal(scrubSecretEnv({X: 'https://u:p@h/'}, ['X']).X, 'https://u:p@h/');
	});
});
