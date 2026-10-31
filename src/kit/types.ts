export type Tone = 'plain' | 'dim' | 'add' | 'del' | 'warn' | 'info';

export type FrameRow = {text: string; tone: Tone};

export type PickerItem = {id: string; label: string; meta?: string};

export const TONE_STYLE: Record<Tone, {color?: string; dim?: boolean}> = {
	plain: {},
	dim: {dim: true},
	add: {color: 'green'},
	del: {color: 'red'},
	warn: {color: 'yellow'},
	info: {color: 'cyan'},
};
