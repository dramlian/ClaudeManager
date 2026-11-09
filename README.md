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

- Account: the title bar shows who Claude Code is logged in as (`claude auth status --json`). Its menu can
  **Log out** (`claude auth logout`) or **Log in / Switch account**, which runs `claude auth login` in a terminal tab
  so the browser link and the paste-the-code prompt both work. The tab closes itself once login succeeds, and the
  header and plan usage update for the new account.

## Scripts

| command            | what                                                     |
| ------------------ | -------------------------------------------------------- |
| `npm run dev`      | Vite dev server + Electron with hot reload               |
| `npm start`        | build and run the production bundle                      |
| `npm run dist:win` | build `dist/ClaudeManager-<v>-portable.exe` and `-setup.exe` |

## Versions and updates

The version lives in `package.json` and is shown next to the app name in the title bar. The app checks GitHub
Releases at startup and every 4 hours (`src/electron/updater.ts`, `electron-updater`). When a newer release
exists, the version label lights up and a popup offers **Update**: it downloads in the background, then
**Restart and update** installs it. Only the installed (`-setup.exe`) build can update itself; the portable exe
shows the same popup but opens the download page.

To release a new version:

```
npm run release        # = npm version patch && git push --follow-tags
```

(use `npm version minor` / `major` + `git push --follow-tags` for bigger bumps). The pushed `v*` tag triggers
`.github/workflows/release.yml`, which builds the installers and publishes them as a GitHub Release.

## Tabs

Each tab is its own Claude conversation with its own process. Tabs keep running in the background while you work in
another tab, and a conversation only ends when you close its tab or quit the app. Tab dots: green = idle,
pulsing orange = working, light orange ring = finished while you were away, grey = exited.

| shortcut              | action                                   |
| --------------------- | ---------------------------------------- |
| `Ctrl+Shift+T` / `+`  | new conversation in the current folder   |
| `Ctrl+Shift+W` / middle-click | close conversation               |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | next / previous tab              |
| `Ctrl+1`…`Ctrl+9`     | jump to tab (9 = last)                   |
| `Ctrl+C`              | copy when text is selected, otherwise interrupt Claude |
| `F12`                 | DevTools                                 |

Shortcuts use `Ctrl+Shift` because Claude Code itself uses `Ctrl+T`, `Ctrl+W` and similar.
