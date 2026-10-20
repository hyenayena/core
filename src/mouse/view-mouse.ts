export type ViewMouseEvent = {
	kind: 'press' | 'release' | 'wheel';
	button: 'left' | 'middle' | 'right' | 'none';
	wheel?: 'up' | 'down';
	// 0-based, relative to the view box
	x: number;
	y: number;
	// view box size at event time
	width: number;
	height: number;
	shift: boolean;
	meta: boolean;
	ctrl: boolean;
};

export type ViewMouseHost = {
	subscribeMouse(listener: (event: ViewMouseEvent) => boolean | void): () => void;
};
