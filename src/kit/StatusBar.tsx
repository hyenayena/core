import React from 'react';
import {Text} from 'ink';
import {sanitizeText} from '../hints/sanitize.js';

export function StatusBar({text}: {text: string}) {
	return (
		<Text dimColor wrap="truncate">
			{sanitizeText(text, 1000)}
		</Text>
	);
}
