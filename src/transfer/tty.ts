import {spawnSync} from 'node:child_process';

function ask(script: string, prompt: string): string {
	const result = spawnSync('sh', ['-c', script, 'sh', prompt], {stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', env: {PATH: process.env.PATH ?? ''}});
	return typeof result.stdout === 'string' ? result.stdout : '';
}

export function readHidden(prompt: string): string {
	return ask('printf "%s" "$1" >&2; stty -echo; IFS= read -r t; stty echo; printf "\\n" >&2; printf "%s" "$t"', prompt);
}

export function readLine(prompt: string): string {
	return ask('printf "%s" "$1" >&2; IFS= read -r t; printf "%s" "$t"', prompt);
}

export const hasTerminal = (): boolean => Boolean(process.stdin.isTTY && process.stderr.isTTY);

// stderr only: stdout may be piped
export const writeTerminal = (text: string): void => void process.stderr.write(text);
