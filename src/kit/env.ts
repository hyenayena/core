const SECRET_ENV_NAMES = [
	/^AWS_|TOKEN|SECRET|PASSW|API_?KEY|CREDENTIAL/i,
	/PRIVATE|COOKIE|AUTH/i,
	/.PWD$/i,
	/^DATABASE_URL$|_DSN$|_URI$|_CONNECTION_STRING$/i,
	/(ACCESS|SIGNING)_?KEY/i,
	/_SK$/i,
	/(^|_)DEPLOY_?KEY/i,
	/WEBHOOK|SIGNING|BEARER/i,
	/ENCRYPTION_?KEY|MASTER_?KEY|SESSION_?(KEY|SECRET)/i,
];

const VALUE_SCAN_MAX = 8192;

function hasUrlUserinfo(value: string): boolean {
	const v = value.length > VALUE_SCAN_MAX ? value.slice(0, VALUE_SCAN_MAX) : value;
	let i = v.indexOf('://');
	while (i !== -1) {
		let j = i + 3;
		while (j < v.length && !/[\s/@?#]/.test(v[j] as string)) j++;
		if (j > i + 3 && v[j] === '@') return true;
		i = v.indexOf('://', i + 3);
	}
	return false;
}

const SAFE_ENV_NAME =
	/^(PATH|HOME|USER|LOGNAME|SHELL|PWD|OLDPWD|TERM|COLORTERM|LANG|LANGUAGE|TZ|TMPDIR|TEMP|TMP|NO_COLOR|FORCE_COLOR|HOSTNAME|NODE_ENV|EDITOR|PAGER|SHLVL|_)$|^LC_/;

/** Copy of `env` without agent sockets, secret-named variables and values with URL userinfo. */
export function scrubSecretEnv(
	env: Readonly<Record<string, string | undefined>>,
	keep: readonly string[] = [],
): Record<string, string | undefined> {
	const out: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(env)) {
		if (keep.includes(name) || SAFE_ENV_NAME.test(name)) {
			out[name] = value;
		} else if (
			name === 'SSH_AUTH_SOCK' ||
			name === 'SSH_AGENT_PID' ||
			SECRET_ENV_NAMES.some(re => re.test(name)) ||
			(typeof value === 'string' && hasUrlUserinfo(value))
		) {
			continue;
		} else {
			out[name] = value;
		}
	}
	return out;
}
