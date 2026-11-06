import fs from 'fs';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { pathToFileURL } from 'url';
import { getPreloadPath, getUIPath, isDev } from './pathResolver.js';
import { ClaudeSession } from './claudeSession.js';

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
    backgroundColor: '#0d0d0f',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());

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
