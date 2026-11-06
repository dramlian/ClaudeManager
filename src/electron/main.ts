import fs from 'fs';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import { pathToFileURL } from 'url';
import { getPreloadPath, getUIPath, isDev } from './pathResolver.js';
import { ClaudeSession, limit } from './claudeSession.js';

const MAX_RECENT = 8;
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');

function readRecent(): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf8').replace(/^\uFEFF/, ''));
    return Array.isArray(list) ? list.filter((f) => typeof f === 'string' && fs.existsSync(f)) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  fs.mkdirSync(path.dirname(recentFile()), { recursive: true });
  fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, MAX_RECENT), null, 2));
}

/** Folders the user pinned; kept even if temporarily missing (e.g. an unplugged drive). */
const savedFile = () => path.join(app.getPath('userData'), 'saved-folders.json');

function readSaved(): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(savedFile(), 'utf8').replace(/^﻿/, ''));
    return Array.isArray(list) ? list.filter((f) => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

function writeSaved(list: string[]) {
  fs.mkdirSync(path.dirname(savedFile()), { recursive: true });
  fs.writeFileSync(savedFile(), JSON.stringify(list, null, 2));
}

function pushRecent(folder: string) {
  writeRecent([folder, ...readRecent().filter((f) => f.toLowerCase() !== folder.toLowerCase())]);
}

/** Locate VS Code's Code.exe (user install, system install, or via the `code` shim on PATH). */
function findVSCode(): string | null {
  const candidates = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
  ];
  try {
    for (const shim of execFileSync('where.exe', ['code'], { encoding: 'utf8' }).split(/\r?\n/)) {
      // <install>\bin\code.cmd -> <install>\Code.exe
      if (shim.trim()) candidates.push(path.join(path.dirname(path.dirname(shim.trim())), 'Code.exe'));
    }
  } catch {
    /* not on PATH */
  }
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

function openInVSCode(folder: string): { ok: boolean; error?: string } {
  if (typeof folder !== 'string' || !fs.existsSync(folder)) return { ok: false, error: `Folder not found: ${folder}` };
  const exe = findVSCode();
  if (exe) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_ENV;
    spawn(exe, [folder], { detached: true, stdio: 'ignore', env }).unref();
    return { ok: true };
  }
  // Fall back to VS Code's URL handler (works for any install that registered it).
  shell.openExternal(`vscode://file/${folder.replace(/\\/g, '/')}`);
  return { ok: true };
}

/**
 * Plan usage, fetched the same way Claude Code's /usage does: the user's own OAuth token
 * (written by `claude` login) against Anthropic's usage endpoint. Lets the title bar show
 * usage at startup instead of waiting for the first reply. We never refresh the token
 * ourselves; if it is expired we just skip until Claude Code refreshes it.
 */
/** Where Claude Code stores its login (OAuth) tokens on Windows/Linux. */
const credentialsFile = () =>
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(app.getPath('home'), '.claude'), '.credentials.json');

async function fetchPlanUsage(): Promise<PlanUsage | null> {
  try {
    const creds = JSON.parse(fs.readFileSync(credentialsFile(), 'utf8'));
    const oauth = creds?.claudeAiOauth;
    if (!oauth?.accessToken || (oauth.expiresAt && oauth.expiresAt < Date.now())) return null;
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'ClaudeManager',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const usage: PlanUsage = { session: limit(j.five_hour), week: limit(j.seven_day) };
    return usage.session || usage.week ? usage : null;
  } catch {
    return null;
  }
}

function isTrustedSender(frameUrl: string | undefined) {
  if (!frameUrl) return false;
  if (isDev()) return new URL(frameUrl).host === 'localhost:5123';
  return frameUrl === pathToFileURL(getUIPath()).toString();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    frame: false,
    backgroundColor: '#0a0f0c',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  const pushUsage = async () => {
    const usage = await fetchPlanUsage();
    if (usage && !win.isDestroyed()) win.webContents.send('usage:update', '', usage);
  };
  win.webContents.on('did-finish-load', pushUsage);
  const usageTimer = setInterval(pushUsage, 5 * 60_000);
  win.on('closed', () => clearInterval(usageTimer));
  // Logging in (or out, or a token refresh) rewrites the credentials file: refresh usage right away.
  // watchFile polls, so it also works when the file doesn't exist yet (not logged in).
  const creds = credentialsFile();
  fs.watchFile(creds, { interval: 2000 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) pushUsage();
  });
  win.on('closed', () => fs.unwatchFile(creds));

  if (isDev()) {
    win.loadURL('http://localhost:5123');
  } else {
    win.loadFile(getUIPath());
  }

  // Links clicked inside the terminal open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  // One Claude process per tab. They all keep running in the background until
  // their tab is closed or the app quits.
  const runtimeDir = ClaudeSession.setupRuntime();
  const sessions = new Map<string, ClaudeSession>();
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,40}$/.test(id);

  const guard = <A extends unknown[], R>(fn: (...args: A) => R) =>
    (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, ...args: A): R | undefined => {
      if (!isTrustedSender(event.senderFrame?.url)) return undefined;
      return fn(...args);
    };

  ipcMain.handle(
    'session:start',
    guard((tabId: string, cwd: string, cols: number, rows: number) => {
      if (!validId(tabId)) return { running: false, cwd, error: 'Invalid tab id' } satisfies SessionStatus;
      if (typeof cwd !== 'string' || !fs.existsSync(cwd)) {
        return { running: false, cwd, error: `Folder not found: ${cwd}` } satisfies SessionStatus;
      }
      pushRecent(cwd);
      let s = sessions.get(tabId);
      if (!s) {
        s = new ClaudeSession(win, tabId, runtimeDir);
        sessions.set(tabId, s);
      }
      return s.start(cwd, cols, rows);
    })
  );
  ipcMain.handle(
    'session:close',
    guard((tabId: string) => {
      sessions.get(tabId)?.dispose();
      sessions.delete(tabId);
    })
  );
  ipcMain.on('pty:input', guard((tabId: string, data: string) => sessions.get(tabId)?.write(String(data))));
  ipcMain.on(
    'pty:resize',
    guard((tabId: string, cols: number, rows: number) => sessions.get(tabId)?.resize(cols, rows))
  );
  ipcMain.on(
    'window:title',
    guard((title: string) => win.setTitle(String(title).slice(0, 200)))
  );

  ipcMain.handle(
    'folder:pick',
    guard(async () => {
      const res = await dialog.showOpenDialog(win, {
        title: 'Open a project folder for Claude',
        properties: ['openDirectory'],
      });
      return res.canceled ? null : res.filePaths[0];
    })
  );
  ipcMain.handle('saved:list', guard(() => readSaved()));
  ipcMain.handle(
    'saved:add',
    guard(async () => {
      const res = await dialog.showOpenDialog(win, {
        title: 'Save a folder to your list',
        properties: ['openDirectory'],
      });
      const list = readSaved();
      const folder = res.canceled ? null : res.filePaths[0];
      if (folder && !list.some((f) => f.toLowerCase() === folder.toLowerCase())) {
        list.push(folder);
        writeSaved(list);
      }
      return list;
    })
  );
  ipcMain.handle(
    'saved:remove',
    guard((folder: string) => {
      const list = readSaved().filter((f) => f !== folder);
      writeSaved(list);
      return list;
    })
  );
  ipcMain.handle('clipboard:read', guard(() => clipboard.readText()));
  ipcMain.on(
    'clipboard:write',
    guard((text: string) => {
      if (typeof text === 'string' && text.length <= 4_000_000) clipboard.writeText(text);
    })
  );
  ipcMain.handle('vscode:open', guard((folder: string) => openInVSCode(folder)));
  ipcMain.handle('folder:recent', guard(() => readRecent()));
  ipcMain.handle(
    'folder:removeRecent',
    guard((folder: string) => {
      writeRecent(readRecent().filter((f) => f !== folder));
      return readRecent();
    })
  );

  ipcMain.on(
    'frame:action',
    guard((action: FrameWindowAction) => {
      if (action === 'CLOSE') win.close();
      if (action === 'MINIMIZE') win.minimize();
      if (action === 'MAXIMIZE') (win.isMaximized() ? win.unmaximize() : win.maximize());
    })
  );

  win.on('closed', () => {
    for (const s of sessions.values()) s.dispose();
    sessions.clear();
  });
});

app.on('window-all-closed', () => app.quit());
