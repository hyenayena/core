export type ViewCommandInfo = {name: string; description: string; usage?: string; aliases?: string[]; subcommands?: ViewCommandInfo[]};

export type ViewCommandHost = {
	runLine(line: string): boolean;
	listCommands(): ViewCommandInfo[];
};
