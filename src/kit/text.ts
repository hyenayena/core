export {graphemes, cellWidth, stringCells, truncateCells, sliceCells} from '../hints/width.js';
export {sanitizeText, sanitizeBlock, sanitizeMultilineInput} from '../hints/sanitize.js';
export {wrapRows, wrapLines, styledCells, sliceStyledCells, stripStyles} from '../transcript/wrap.js';
export {tailRows, type TailRows} from './tail.js';
export {windowLine, indexAtCell, type Windowed} from '../hints/viewport.js';
export {windowStart} from './window.js';
export {inputRowCount, inputWindow, offsetAtCell, type InputWindowRow} from './input-window.js';
export {hangingRows} from './hanging.js';
export {COMMAND_TOOLS, formatCommandList, formatRunResult, resolveCommandLine, type CommandToolSpec, type ResolvedCommandLine} from './agent.js';
export {checkCommandDocs} from '../hints/docs-lint.js';
export {sanitizeStyled} from './styled-sanitize.js';
export {tokenizeWords, wordDiff, pairRuns, type Range} from './word-diff.js';
export {
	prepareDiffCard,
	renderDiffCard,
	fileKindGlyph,
	SIDE_BY_SIDE_MIN_WIDTH,
	type DiffCard,
	type DiffCardRow,
	type CodeToken,
	type DiffHighlighter,
	type PrepareOptions,
	type RenderOptions,
	type PreparedDiffCard,
} from './diff-card.js';
export {wrapCodeTokens, renderCodeFrame, type CodeFrameOptions} from './code-frame.js';
export {formatElapsed, statusRow, ruledRows, paintTokens, type StatusRowOptions, type RuledRowsOptions} from './status-row.js';
export type {Tone, FrameRow, PickerItem} from './types.js';
export {
	gridLayout,
	boxRows,
	badgeRows,
	frameAround,
	joinBlocks,
	type Span,
	type SpanRow,
	type GridLayout,
	type GridRow,
	type BoxOptions,
	type BoxHighlight,
	type BoxBadge,
	type FrameOptions,
} from './boxes.js';
export {
	BRAILLE_FILL,
	brailleCells,
	brailleRows,
	brailleText,
	type DotState,
	type BrailleCell,
} from './braille.js';
export {
	TONE_SGR,
	MAX_STYLED_BLOCKS,
	MAX_TABLE_ROWS,
	MAX_ROW_CELLS,
	MAX_SPANS,
	MAX_SPAN_CODE_POINTS,
	span,
	line,
	decorLine,
	rule,
	table,
	textBlock,
	normalizeStyled,
	plainLines,
	renderStyled,
	printStyled,
	type NormalSpan,
	type NormalCell,
	type NormalBlock,
	type NormalStyled,
} from './styled.js';
export {
	COLOR_DEPTHS,
	THEME_TONES,
	DARK_THEME,
	SPAN_TONE_THEME,
	SGR_ATTR,
	SGR_RESET,
	activeTheme,
	detectColorDepth,
	colorDepth,
	withColorDepth,
	sgrTable,
	toneSgr,
	toneParams,
	paintTone,
	inkTone,
	type ColorDepth,
	type ThemeTone,
	type Theme,
	type ToneDef,
	type Attrs,
	type Hex,
	type Ansi16,
	type InkToneProps,
} from './theme.js';
export {GLYPHS, SPINNER_GLYPHS, glyph, spinnerFrames, asciiGlyphs, type GlyphDef, type GlyphName, type SpinnerGlyphName} from './glyphs.js';
export {
	registerGallerySection,
	gallerySections,
	type GallerySection,
	type GalleryRenderer,
	type GalleryRenderOptions,
} from './gallery.js';
