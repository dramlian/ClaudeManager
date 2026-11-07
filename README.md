# ClaudeManager

A small Electron desktop wrapper around the Claude Code CLI. It opens `claude --dangerously-skip-permissions`
in a project folder and shows live **context %**, model, session cost and lines changed in the title bar.

Project layout follows [electron-course](https://github.com/N-Ziermann-YouTube/electron-course):
React + Vite UI in `src/ui`, Electron main/preload in `src/electron`.

## How it works

- `src/electron/claudeSession.ts` spawns `claude` in a real pseudo-terminal (`@lydell/node-pty`, prebuilt, no
  build tools needed) and streams it to an xterm.js terminal in the renderer.
- Context usage: the app passes `--settings <file>` with a `statusLine` command. Claude Code pipes its status JSON
  (`context_window`, `model`, `cost`, …) into that command. The script runs on Electron's bundled Node and writes the
  JSON to a state file that the main process watches. Percent = `current_usage` tokens / `context_window_size`.
  Your own `~/.claude/settings.json` still applies; only `statusLine` is overridden inside the app.

- Remote access: every session starts with `--remote-control`. The main process picks the session's
  `claude.ai/code/session_…` link out of the terminal output and pre-renders a QR code (`qrcode`) as soon as it
  appears. The footer's **Remote** button (dot turns teal once the link is ready) shows it in an overlay that never
  touches the terminal, so it opens instantly even while Claude is busy. Needs a claude.ai subscription login.

## Scripts

| command            | what                                                     |
| ------------------ | -------------------------------------------------------- |
| `npm run dev`      | Vite dev server + Electron with hot reload               |
| `npm start`        | build and run the production bundle                      |
| `npm run dist:win` | build `dist/ClaudeManager-<v>-portable.exe` and `-setup.exe` |

## Tabs

Each tab is its own Claude conversation with its own process. Tabs keep running in the background while you work in
another tab, and a conversation only ends when you close its tab or quit the app. Tab dots: green = idle,
pulsing orange = working, light orange ring = finished while you were away, grey = exited.

| shortcut              | action                                   |
| --------------------- | ---------------------------------------- |
| `Ctrl+Shift+T` / `+`  | new conversation in the current folder   |
| `Ctrl+Shift+O`        | new conversation in another folder       |
| `Ctrl+Shift+W` / middle-click | close conversation               |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | next / previous tab              |
| `Ctrl+1`…`Ctrl+9`     | jump to tab (9 = last)                   |
| `Ctrl+C`              | copy when text is selected, otherwise interrupt Claude |
| `F12`                 | DevTools                                 |

Shortcuts use `Ctrl+Shift` because Claude Code itself uses `Ctrl+T`, `Ctrl+W` and similar.
