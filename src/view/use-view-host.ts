import {createContext, useContext, useEffect, useState} from 'react';
import {useWindowSize} from 'ink';
import type {ViewHost} from '../../../../src/api.js';

export type ViewLayout = {focused: boolean; columns: number};

/**
 * The layout of the area a view is mounted in, provided by the app around each area. A mounted
 * element is the same object from render to render, so React skips it when the app re-renders;
 * context still reaches it in that same pass, so a view never draws one frame at a stale width
 * (e.g. while the side console opens). Hosts without it fall back to the subscription below.
 */
export const ViewLayoutContext = createContext<ViewLayout | undefined>(undefined);

/** Focus and width of a view; without a host it owns the whole terminal and is always focused. */
export function useViewHost(host: ViewHost | undefined): ViewLayout {
	const {columns} = useWindowSize();
	const read = (): ViewLayout => (host ? {focused: host.isFocused(), columns: host.columns()} : {focused: true, columns});
	const provided = useContext(ViewLayoutContext);
	const [layout, setLayout] = useState(read);
	useEffect(() => {
		if (!host) return;
		const sync = () =>
			setLayout(prev => {
				const next = read();
				return prev.focused === next.focused && prev.columns === next.columns ? prev : next;
			});
		sync();
		return host.subscribe(sync);
	}, [host]);
	if (host && provided) return provided;
	return host ? layout : {focused: true, columns};
}
