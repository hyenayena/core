import React from 'react';
import type {MountControl, UiElement} from '../../../../src/api.js';
import {TextField} from '../kit/TextField.js';
import {MAX_TIME_ZONE_CHARS, canonicalTimeZone, configuredTimeZone, systemTimeZone} from '../kit/time.js';
import {setPrefs} from './prefs.js';

export function timeZoneField(control: MountControl): UiElement {
	return (
		<TextField
			label="Time zone"
			hint={`IANA name such as Europe/Kyiv; empty uses the system zone (${systemTimeZone()})`}
			initial={configuredTimeZone() ?? ''}
			optional
			maxLength={MAX_TIME_ZONE_CHARS}
			validate={v => (canonicalTimeZone(v) ? undefined : `Unknown time zone "${v}"; use an IANA name such as Europe/Kyiv`)}
			onSubmit={v => {
				setPrefs({timeZone: v === '' ? undefined : canonicalTimeZone(v)});
				control.close();
			}}
			onCancel={() => control.close()}
			{...(control.host && {host: control.host})}
		/>
	);
}
