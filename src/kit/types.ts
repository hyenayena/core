import type {ThemeTone} from './theme.js';

export type Tone = 'plain' | 'dim' | 'add' | 'del' | 'warn' | 'info';

export type FrameRow = {text: string; tone: Tone; styled?: true};

export type PickerItem = {id: string; label: string; meta?: string};

export const TONE_THEME: Record<Tone, ThemeTone | null> = {
	plain: null,
	dim: 'muted',
	add: 'added',
	del: 'removed',
	warn: 'warn',
	info: 'accent',
};
