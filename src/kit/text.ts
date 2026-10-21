// Pure helpers shared with other modules; must not import React or Ink (see tests/kit/purity.test.ts).
export {graphemes, cellWidth, stringCells, truncateCells, sliceCells} from '../hints/width.js';
export {sanitizeText, sanitizeBlock, sanitizeMultilineInput} from '../hints/sanitize.js';
export {wrapRows, wrapLines} from '../transcript/wrap.js';
export {windowLine, indexAtCell, type Windowed} from '../hints/viewport.js';
export {windowStart} from './window.js';
export {inputWindow, offsetAtCell, type InputWindowRow} from './input-window.js';
export type {Tone, FrameRow, PickerItem} from './types.js';
