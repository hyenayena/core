// Ctrl+§ reaches the app as a plain "§" in most terminals (Ctrl is dropped for non-ASCII keys),
// so the character itself is the toggle and cannot be typed into inputs.
const CONSOLE_TOGGLE = new Set(['§']);

export function isConsoleToggle(input: string): boolean {
	return CONSOLE_TOGGLE.has(input);
}
