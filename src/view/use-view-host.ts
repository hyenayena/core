import {useEffect, useState} from 'react';
import {useWindowSize} from 'ink';
import type {ViewHost} from '../../../../src/api.js';

export type ViewLayout = {focused: boolean; columns: number};

/** Focus and width of a view; without a host it owns the whole terminal and is always focused. */
export function useViewHost(host: ViewHost | undefined): ViewLayout {
	const {columns} = useWindowSize();
	const read = (): ViewLayout => (host ? {focused: host.isFocused(), columns: host.columns()} : {focused: true, columns});
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
	return host ? layout : {focused: true, columns};
}
