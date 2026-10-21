export type Tone = 'plain' | 'dim' | 'add' | 'del' | 'warn' | 'info';

export type FrameRow = {text: string; tone: Tone};

export type PickerItem = {id: string; label: string; meta?: string};
