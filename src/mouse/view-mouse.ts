export type ViewMouseEvent = {
	kind: 'press' | 'release' | 'wheel';
	button: 'left' | 'middle' | 'right' | 'none';
	wheel?: 'up' | 'down';
	x: number;
	y: number;
	width: number;
	height: number;
	shift: boolean;
	meta: boolean;
	ctrl: boolean;
	region?: 'header';
};

export type ViewMouseHost = {
	subscribeMouse(listener: (event: ViewMouseEvent) => boolean | void): () => void;
};
