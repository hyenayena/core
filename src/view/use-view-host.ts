import {createContext, useContext, useEffect, useState} from 'react';
import {useWindowSize} from 'ink';
import type {ViewHost} from '../../../../src/api.js';

export type ViewLayout = {focused: boolean; columns: number};

export const ViewLayoutContext = createContext<ViewLayout | undefined>(undefined);

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
