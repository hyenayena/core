// Optional runtime members of the ViewHost that core passes to views (beyond api.ts, like
// subscribeMouse): a view may run a console line as if the user typed it in the console.
export type ViewCommandInfo = {name: string; description: string; usage?: string};

export type ViewCommandHost = {
	/**
	 * Starts the line in the console as if typed there (echo, history and output in the console, which
	 * opens beside the view). False, with nothing run, when the first word is not a command.
	 */
	runLine(line: string): boolean;
	/** The console's commands, already sanitised, for hints. */
	listCommands(): ViewCommandInfo[];
};
