import type {BuildInfo, Logger, ModuleRegistry} from '../../../../src/api.js';
import type {KdfParams} from './crypto.js';
import type {Prompts} from './prompts.js';

export type TransferEnv = {
	modules?: ModuleRegistry;
	build?: BuildInfo;
	dataDir: string;
	log: Logger;
	prompts: Prompts;
	kdf?: KdfParams;
	now: () => Date;
	track: (...secrets: string[]) => () => void;
};
