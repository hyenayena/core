# core

Command REPL for yena (Ink). Commands receive a `CommandContext` (see `src/api.ts` in the host).

## Screen layout: main view and console

- The app is full screen: `main.tsx` renders in the alternate screen (the terminal's own screen and scrollback come back on exit). There is no `<Static>`: `App` keeps the printed lines itself (last 5000) and draws them as a transcript above the main view (or the console prompt), clipped at the top. PageUp/PageDown scroll it by a page, Shift+↑/↓ by a line, unless the side console has the input; while scrolled up a `↓ N newer lines · PgDn or Shift+↓` row shows and new output keeps the view on the same lines. The side panel is the full terminal height.
- At startup `main.tsx` sets the terminal window/tab title to `yena` (OSC 0, only when stdout is a TTY; `src/view/title.ts`).
- The console is the command prompt (with hints, below). With no main view it owns the whole screen, as a plain REPL.
- A main view (e.g. the claude chat) is mounted with `ctx.mount(build)` (target `main`, the default). It then owns the screen and the input, and the console becomes a side panel on the right: Esc twice (within 500 ms) opens and closes it: in the chat on an idle, empty draft (the view calls `host.togglePanel()`), in the console on an empty line. Every terminal sends Esc, unlike ⌘/Ctrl combinations (PhpStorm keeps ⌘ for itself and reserves Ctrl+T). `§` (what Ctrl+§ sends in most terminals, so it cannot be typed) and Ctrl+T still toggle where they arrive. Opening focuses the console, closing focuses the main view.
- With the panel open, ← on an empty console line moves the input to the main view; a main view moves it back with `control.host.move('right')` (the claude chat does it on → with an empty draft). Both stay mounted; only the focused one reads keys.
- The panel takes 40% of the width (at least 28 columns, leaving at least 30), at most 20 rows (rows - 3). Below 60 columns the open console covers the main view instead (it stays mounted, hidden).
- Console commands print into the panel (last 500 lines kept, the visible tail shown) while a main view is shown, into the scrollback otherwise. A command that mounted the main view prints into the scrollback from then on.
- Vim-style `:q` (or `:q!`) as a whole console line closes the side console; when the console is the whole screen it exits the app. A main view can exit the app with `host.quit()` (the claude chat does it on `:q`).
- Mounting a main view clears the transcript (except the welcome line), so a new chat does not show the previous one; a view that resumes a conversation prints its history itself.
- `ctx.suspend(fn)` hands the terminal to a blocking child (an editor, an interactive login): key reading and raw mode are detached, the alternate screen is left, and afterwards the screen is entered again and repainted (`src/view/suspend.ts`). `fn` should use `spawnSync`, so nothing renders over the child.
- `ctx.copyToClipboard(text)` writes OSC 52 (base64, so the text cannot carry escapes; at most 50 000 characters; `src/view/clipboard.ts`).
- The `settings` command contributes an `Appearance` tab: title bar colour (Olive, Blue, Teal, Gray, Inverse) and colours on/off, saved to `<core data dir>/appearance.json` (`src/view/prefs.ts`); `NO_COLOR` still wins.
- A main view may call `host.setTitle(title, detail?)`: a one-row olive bar (#808000, black text; inverse with `NO_COLOR`) above the transcript shows the title on the left (bold, shortened first) and the detail right-aligned (`components/TitleBar.tsx`); both are sanitised; it disappears when the view closes or the title is undefined.
- The hint catalog is rebuilt when the console opens and after every command finishes, so a plugin may change its `subcommands` at runtime (the claude module lists Claude Code commands this way).
- Commands with `autostart: true` run once at startup with no arguments (their output goes to the scrollback); the welcome line then mentions Esc Esc.
- `settings` opens a settings screen in the console: one tab per command that declares `settings` (`SettingsTab {title, settings: Setting[]}`, choice settings with `get`/`set`; malformed entries are dropped, text is sanitised). ↑↓ select, Enter saves the choice and keeps the screen open (`Saved · <setting>: <option>`); ←→ switch tabs (← on the first tab moves to the main view); only Esc or Ctrl+C closes it. The screen gets the whole panel (`host.rows()`) and scrolls to keep the selection (and its label) visible; the hint row shows `· <shown>/<total>` when it scrolls.

## `ctx.mount(build, options?)`

Shows an Ink view in `options.target`: `main` (default) or `panel` (in place of the console prompt).

- `build(control)` runs once, synchronously; the returned element is shown in that area.
- `control.print` prints into that area's output (scrollback for `main`); `control.host` (`ViewHost`) gives `isFocused()`, `columns()`, `rows()` (the panel height less its title, or the terminal height), `subscribe(listener)`, `move(direction)`, `togglePanel()`, `setTitle(title, detail?)` and `isHostKey(input, key)`. A view must read input only while focused (`useInput(..., {isActive})`), lay out in `columns()` and ignore host keys.
- The returned promise resolves when `control.close()` is called (idempotent) or the app unmounts.
- It rejects if that area already shows a view (`A view is already mounted`), `build` throws, or the element throws while rendering.
- With no main view, a `main` mount replaces the console until it is closed.
- The view is wrapped in `MountBoundary` (error boundary): a render error rejects the `mount` promise and restores the prompt.
- A view flushes completed output through `control.print` / `ctx.print` into the transcript and must not render its own `<Static>`.
- `main.tsx` renders with `exitOnCtrlC: false`: at the prompt Ctrl+C exits; inside a view the view receives it. A view that ignores Ctrl+C cannot be interrupted (raw mode); `MountBoundary` only catches render errors.
- Every `.tsx` file imports React explicitly: the host runs tsx from its own root, where the module's JSX settings do not apply.

## Logging
`App` takes an optional `log` prop (`Logger` from the host `src/api.ts`); `main.tsx` passes `yena.log` (scope `core`). Without it `src/noop-log.ts` is used and nothing is written. Records:
- warn `command failed` {command, err}: the command name and the error only.
- debug `view mounted` {id}, debug `view closed` {id}; warn `view failed` {id, err}.
- debug `unknown command` {unknownCommand: true}: the typed token is not logged.

Arguments and typed input are never logged. Records go to `logs/yena.log` in the host (debug needs `YENA_LOG_LEVEL=debug`); see the host `CLAUDE.md`. Test: `tests/log.test.tsx`.

## Hints

While typing at the prompt (cursor at the end of the line) core lists matching commands, then the subcommands of a known command, under it, with a dimmed ghost completion after the cursor. The data comes from `Command`/`Subcommand` metadata (`name`, `description`, `usage`, `aliases`, `subcommands`) and is validated, sanitised (`sanitizeText`) and capped once in `src/hints/catalog.ts`.

Keys:
- Tab accepts the selected suggestion (a space is appended) and keeps cycling on further presses; Shift+Tab cycles backwards (the first Shift+Tab without navigation takes the last item).
- Up/Down move the selection while the list has items and something was typed; otherwise they browse history. Down on a fresh line and Up with an empty history do nothing.
- Esc: after Tab restores the original text and closes the list; after Up/Down only resets the selection; otherwise closes the list. Up then goes to history.
- Right or End at the end of the line accepts a prefix ghost; otherwise they move the cursor. Home, Ctrl+A, Ctrl+E, Left, Right move the cursor; Ctrl+U deletes to the start; Backspace and Delete both delete backwards.
- Enter runs the line exactly as typed. Only after explicit Up/Down navigation does the first Enter just complete the line (`mod `) and the second run it. After Tab or Shift+Tab, Enter runs the visible line.
- Ctrl+C exits, also with the list open.

Usage row: when a known command or subcommand has `usage`, a dim usage line is shown, and while typing arguments the current placeholder is bold and underlined (`claude ask ` highlights `<text>`; a variadic `<name>…` stays highlighted; flags and positions past the last slot are not). It appears for subcommand lists and, with no items left, as a non-interactive usage-only row (`claude ask `): Tab and the ghost do nothing, Right/End only move the cursor, Up recalls history, Esc dismisses it, a cursor off the end hides it. Commands without `usage` get no name-only row.

Behaviour changes to the original prompt: a long line scrolls horizontally on one row instead of wrapping; the cursor and Backspace work on graphemes; pasted text is sanitised (tabs and newlines become spaces, escapes are stripped) and never submits or accepts; the echo of a submitted line is sanitised and collapses space runs; Esc, Tab, Home and End are bound. Command names, aliases, usage and descriptions from plugins are sanitised before display. An unknown command prints `Unknown command: x`, followed by `Did you mean: y?` when a close match exists (typed token of 2 or more characters; distance 1 up to 4 characters, 2 above, or a prefix); `help <command>` shows usage, description and subcommands, and `help <unknown>` fails with `Error: Unknown command: x`.

Layout: rows >= 17 allow 7 hint rows, 11 to 16 allow 4, 10 or fewer allow 2 (never more than rows - 2); extra items become `+N more`; below 20 columns only names are shown, below 8 columns no list. The live frame never exceeds the terminal height minus one row and no line exceeds the width minus one. `NO_COLOR` (non-empty) removes colours; bold, dim, underline, inverse and the `›` marker stay.

Errors: a command that throws prints `Error: <message>` in red, extra message lines indented by two spaces, at most 20 lines of 4096 characters, each line sanitised; a message that cannot be read prints `unprintable error`, an empty one `unknown error`. `registry.find` ignores null or primitive entries and entries whose `name` getter throws; the first match wins.

Not implemented yet (planned only when requested): nested subcommands (`Subcommand.subcommands?` in the host contract, Phase 2a) and dynamic argument completion (`Command.complete?`/`Candidate`, Phase 2b: additive optional members, 150 ms timeout, debounce, sanitised, at most 50 candidates; `claude` would supply `--new`/`--from-file`, `mod` the installed module names). Today `claude auth status|key|…` is not offered.

Manual TTY check:
1. `./yena`. Type `e`: list with `echo`, `exit`, `help`, `clear`, `claude`, ghost, first row marked `›`.
2. Tab accepts `echo `; type `hi`, Enter prints `hi`.
3. Type `ex`, Esc: the list disappears; Up recalls history; Down returns to empty.
4. Type `m`, Down, Enter: the line becomes `mod ` and nothing runs; Enter again runs `mod`.
5. `claude ` shows subcommands and usage; `claude ask ` shows a usage-only row with `<text>` highlighted.
6. `ecoh` Enter: `Unknown command: ecoh` then `Did you mean: echo?`.
7. Type `cl`, Tab, Tab, Shift+Tab cycles; Esc after Tab restores `cl`.
8. Paste a multi-line block and a block with a tab: one line, no flicker, nothing accepted.
9. Resize narrower/shorter with the list open: no wrapping, no stale lines.
10. Type CJK/emoji and move the cursor with Left/Right.
11. `NO_COLOR=1`: the highlight stays readable (underline, marker).
12. Ctrl+C at the prompt exits; inside `claude chat` the prompt and hints are hidden.
13. With the claude module and a credential: the chat opens at startup. Esc Esc opens the console on the right, ← moves to the chat, → (empty draft) back, Esc Esc on an empty console line closes it. PageUp/Shift+↑ scroll the chat transcript. `settings` shows the Claude tab; pick a model, Esc, then `chat` opens a new chat with it (status bar shows the model). Below 60 columns the console covers the chat.

## Tests

`npm test` (`node --import tsx --test "tests/**/*.test.ts" "tests/**/*.test.tsx"`) runs unit tests per `src/hints/` module (`tests/hints/*.test.ts`, shared commands in `tests/hints/fixture.ts`) and drives the real `App` through fake TTY streams: `mountHarness(element, size?, {debug?})` in `tests/testkit.ts` returns `press`, `settle`, `lastFrame`, `allOutput`, `frameCount`, `resize(columns, rows)`, `unmount`, `raw` (raw-mode log); `fakeLogger` records log calls. `tests/mount.test.tsx`, `tests/log.test.tsx` and `tests/hints/*.test.tsx` use it. `npm run typecheck` runs `tsc -p . && tsc -p tests`.
