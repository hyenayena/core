import type {EventBus} from '../../../../src/api.js';

export const RELOAD_TOPIC = 'yena.reload';

export type ReloadNotice = {via: 'console' | 'view' | 'bridge'; view?: 'main' | 'panel'; caller?: string};

const VIA: readonly string[] = ['console', 'view', 'bridge'];
const CALLER = /^[A-Za-z0-9._-]{1,40}$/;

export function reportReload(events: EventBus | undefined, notice: ReloadNotice): void {
	try {
		events?.emit(RELOAD_TOPIC, notice);
	} catch {
		// A broken subscriber must never stop the reload.
	}
}

export function readReload(payload: unknown): ReloadNotice | undefined {
	if (typeof payload !== 'object' || payload === null) return undefined;
	const p = payload as Record<string, unknown>;
	const via = p['via'];
	if (typeof via !== 'string' || !VIA.includes(via)) return undefined;
	const notice: ReloadNotice = {via: via as ReloadNotice['via']};
	if (via === 'view' && (p['view'] === 'main' || p['view'] === 'panel')) notice.view = p['view'];
	if (via === 'bridge' && typeof p['caller'] === 'string' && CALLER.test(p['caller'])) notice.caller = p['caller'];
	return notice;
}
