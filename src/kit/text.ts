// Pure helpers shared with other modules; must not import React or Ink (see tests/kit/purity.test.ts).
export {graphemes, cellWidth, stringCells, truncateCells, sliceCells} from '../hints/width.js';
export {sanitizeText, sanitizeBlock, sanitizeMultilineInput} from '../hints/sanitize.js';
export {wrapRows, wrapLines, styledCells} from '../transcript/wrap.js';
export {tailRows, type TailRows} from './tail.js';
export {windowLine, indexAtCell, type Windowed} from '../hints/viewport.js';
export {windowStart} from './window.js';
export {inputRowCount, inputWindow, offsetAtCell, type InputWindowRow} from './input-window.js';
export {hangingRows} from './hanging.js';
export {COMMAND_TOOLS, formatCommandList, formatRunResult, resolveCommandLine, type CommandToolSpec, type ResolvedCommandLine} from './agent.js';
export {checkCommandDocs} from '../hints/docs-lint.js';
export type {Tone, FrameRow, PickerItem} from './types.js';
export {
	BRAILLE_FILL,
	brailleCells,
	brailleRows,
	brailleText,
	type DotState,
	type BrailleCell,
} from './braille.js';
