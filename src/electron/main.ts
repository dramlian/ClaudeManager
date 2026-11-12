import fs from 'fs';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import { pathToFileURL } from 'url';
import { getPreloadPath, getUIPath, isDev } from './pathResolver.js';
import { ClaudeSession, limit, runClaude } from './claudeSession.js';
import { readClipboardForPaste, sweepPastes } from './clipboardPaste.js';
import { initUpdater } from './updater.js';

/** The workspace: one parent folder whose direct subfolders are offered as projects. */
const workspaceFile = () => path.join(app.getPath('userData'), 'workspace.json');
/** Don't send absurdly large listings to the UI. */
const MAX_WORKSPACE_FOLDERS = 5000;

function readWorkspaceRoot(): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(workspaceFile(), 'utf8').replace(/^﻿/, ''));
    return typeof j?.root === 'string' && j.root ? j.root : null;
  } catch {
    return null;
  }
}

function writeWorkspaceRoot(root: string) {
  fs.mkdirSync(path.dirname(workspaceFile()), { recursive: true });
  fs.writeFileSync(workspaceFile(), JSON.stringify({ root }, null, 2));
}

/** The workspace root and its direct subfolders (one level only, hidden ones skipped). */
function readWorkspace(): WorkspaceInfo {
  const root = readWorkspaceRoot();
  if (!root) return { root: null, folders: [] };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { root, folders: [], missing: true };
  }
  const folders = entries
    .filter((d) => !d.name.startsWith('.') && !d.name.startsWith('$'))
    .map((d) => ({ name: d.name, path: path.join(root, d.name), dirent: d }))
    .filter(({ dirent, path: p }) => {
      if (dirent.isDirectory()) return true;
      if (!dirent.isSymbolicLink()) return false; // junctions / symlinks to folders count too
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    })
    .map(({ name, path: p }) => ({ name, path: p }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    .slice(0, MAX_WORKSPACE_FOLDERS);
  return { root, folders };
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

/**
 * Current git branch of the repo containing `dir`, read straight from HEAD (no git binary needed).
 * Handles worktrees/submodules (where .git is a file pointing elsewhere) and detached HEAD.
 */
function gitBranch(dir: string): GitBranch | null {
  if (typeof dir !== 'string' || !dir) return null;
  let p = path.resolve(dir);
  for (;;) {
    const dotGit = path.join(p, '.git');
    try {
      const st = fs.statSync(dotGit);
      let gitDir = dotGit;
      if (st.isFile()) {
        const m = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
        if (!m) return null;
        gitDir = path.resolve(p, m[1].trim());
      }
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      if (ref) return { name: ref[1], detached: false };
      return /^[0-9a-f]{7,}$/i.test(head) ? { name: head.slice(0, 7), detached: true } : null;
    } catch {
      /* no .git here: keep walking up */
    }
    const parent = path.dirname(p);
    if (parent === p) return null;
    p = parent;
  }
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

/** Who Claude Code is logged in as, straight from the CLI (it knows every storage/auth variant). */
async function fetchAccount(): Promise<AccountInfo | null> {
  const { stdout } = await runClaude(['auth', 'status', '--json']);
  try {
    // `auth status` exits non-zero when logged out but still prints the JSON.
    const j = JSON.parse(stdout.slice(stdout.indexOf('{')));
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return {
      loggedIn: !!j.loggedIn,
      email: str(j.email),
      orgName: str(j.orgName),
      plan: str(j.subscriptionType) ?? str(j.planTier),
      authMethod: str(j.authMethod),
    };
  } catch {
    return null;
  }
}

/** Windows currently showing one of our own native modal dialogs (they legitimately disable it). */
const ownModal = new Set<number>();

/**
 * Programs Claude runs can show a modal popup (a MessageBox, a credential or sign-in prompt) that
 * picks our window as its owner: the foreground window, or the console's root owner since we
 * reparent the pseudoconsole. Windows then disables the owner, which freezes the whole app (every
 * tab) until the popup closes, and for good if the popup's process dies first (a tool timeout,
 * Ctrl+C). Undo that right away: the popup stays on top of us, but the app keeps working.
 */
function keepEnabled(win: BrowserWindow) {
  if (process.platform !== 'win32') return;
  const WM_ENABLE = 0x000a;
  let restoring = false;
  win.hookWindowMessage(WM_ENABLE, (wParam) => {
    if (restoring || wParam.readUInt32LE(0) !== 0) return; // being enabled, or our own toggle
    setImmediate(() => {
      if (win.isDestroyed() || ownModal.has(win.id)) return;
      // Electron still thinks the window is enabled, so setEnabled(true) alone is a no-op:
      // toggle to force the native EnableWindow call.
      restoring = true;
      try {
        win.setEnabled(false);
        win.setEnabled(true);
      } finally {
        restoring = false;
      }
    });
  });
}

function isTrustedSender(frameUrl: string | undefined) {
  if (!frameUrl) return false;
  if (isDev()) return new URL(frameUrl).host === 'localhost:5123';
  return frameUrl === pathToFileURL(getUIPath()).toString();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // One Claude process per tab. Each belongs to the window showing it and keeps running in the
  // background until its tab is closed, its window is closed, or the app quits.
  const runtimeDir = ClaudeSession.setupRuntime();
  sweepPastes();
  const sessions = new Map<string, ClaudeSession>();
  /** Tabs handed to a window that hasn't loaded yet (popped out), keyed by webContents id. */
  const pendingAdopt = new Map<number, AdoptTab[]>();
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,40}$/.test(id);

  // ---------- Plan usage (account-wide, sent to every window) ----------
  const pushUsage = async (only?: BrowserWindow) => {
    const usage = await fetchPlanUsage();
    if (!usage) return;
    for (const w of only ? [only] : BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('usage:update', '', usage);
    }
  };
  setInterval(() => pushUsage(), 5 * 60_000);

  // ---------- Account (login status, sent to every window) ----------
  const pushAccount = async () => {
    const account = await fetchAccount();
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('account:update', '', account);
    }
    return account;
  };

  // Logging in (or out, or a token refresh) rewrites the credentials file: refresh right away.
  // watchFile polls, so it also works when the file doesn't exist yet (not logged in).
  fs.watchFile(credentialsFile(), { interval: 2000 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    pushAccount();
    pushUsage();
  });

  // ---------- Windows ----------
  const createWindow = (adopt?: AdoptTab[], from?: BrowserWindow | null) => {
    // Open next to the window it came from, so it's obvious which one is new.
    const b = from && !from.isDestroyed() && !from.isMaximized() ? from.getBounds() : null;
    const win = new BrowserWindow({
      width: b?.width ?? 1200,
      height: b?.height ?? 800,
      ...(b && { x: b.x + 40, y: b.y + 40 }),
      minWidth: 640,
      minHeight: 400,
      frame: false,
      backgroundColor: '#0a1214',
      show: false,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const wcId = win.webContents.id;
    if (adopt?.length) pendingAdopt.set(wcId, adopt);
    keepEnabled(win);

    win.once('ready-to-show', () => win.show());
    win.webContents.on('did-finish-load', () => pushUsage(win));
    // Links clicked inside the terminal open in the real browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });

    win.on('closed', () => {
      // Kill this window's sessions, plus any popped-out tab it never got to pick up.
      const orphans = new Set((pendingAdopt.get(wcId) ?? []).map((t) => t.id));
      pendingAdopt.delete(wcId);
      for (const [id, s] of sessions) {
        if (s.ownerId === wcId || orphans.has(id)) {
          s.dispose();
          sessions.delete(id);
        }
      }
    });

    if (isDev()) win.loadURL('http://localhost:5123');
    else win.loadFile(getUIPath());
    return win;
  };

  type IpcEvent = Electron.IpcMainInvokeEvent | Electron.IpcMainEvent;
  const winOf = (e: IpcEvent) => BrowserWindow.fromWebContents(e.sender);
  const guard =
    <A extends unknown[], R>(fn: (e: IpcEvent, ...args: A) => R) =>
    (event: IpcEvent, ...args: A): R | undefined => {
      if (!isTrustedSender(event.senderFrame?.url)) return undefined;
      return fn(event, ...args);
    };

  // ---------- Sessions ----------
  ipcMain.handle(
    'session:start',
    guard((e, tabId: string, cwd: string, cols: number, rows: number, mode?: SessionMode) => {
      if (!validId(tabId)) return { running: false, cwd, error: 'Invalid tab id' } satisfies SessionStatus;
      const login = mode === 'login';
      // The login flow doesn't belong to a project; run it from the home folder.
      if (login) cwd = app.getPath('home');
      if (typeof cwd !== 'string' || !fs.existsSync(cwd)) {
        return { running: false, cwd, error: `Folder not found: ${cwd}` } satisfies SessionStatus;
      }
      let s = sessions.get(tabId);
      if (!s) {
        s = new ClaudeSession(e.sender, tabId, runtimeDir);
        sessions.set(tabId, s);
      } else {
        s.attach(e.sender);
      }
      // Don't wait for the credentials poll: show the new account as soon as login finishes.
      s.onExit = login ? () => (pushAccount(), pushUsage()) : undefined;
      return s.start(cwd, cols, rows, login ? 'login' : 'chat');
    })
  );
  // A window picks up a running session (after a pop-out) instead of starting a new one.
  ipcMain.handle(
    'session:attach',
    guard((e, tabId: string, cols: number, rows: number) => {
      const s = sessions.get(tabId);
      if (!s) return null;
      const snapshot = s.attach(e.sender);
      s.resize(cols, rows);
      return snapshot;
    })
  );
  ipcMain.handle(
    'session:close',
    guard((_e, tabId: string) => {
      sessions.get(tabId)?.dispose();
      sessions.delete(tabId);
    })
  );
  ipcMain.on('pty:input', guard((_e, tabId: string, data: string) => sessions.get(tabId)?.write(String(data))));
  ipcMain.on(
    'pty:resize',
    guard((e, tabId: string, cols: number, rows: number) => {
      const s = sessions.get(tabId);
      // Only the window currently showing the session may resize it.
      if (s && s.ownerId === e.sender.id) s.resize(cols, rows);
    })
  );

  // ---------- Windows: new / pop-out ----------
  ipcMain.on('window:new', guard((e) => createWindow(undefined, winOf(e))));
  ipcMain.handle(
    'window:popout',
    guard((e, tab: AdoptTab) => {
      const s = tab && validId(tab.id) ? sessions.get(tab.id) : undefined;
      if (!s || s.ownerId !== e.sender.id) return false;
      s.detach();
      createWindow(
        [{ id: tab.id, cwd: String(tab.cwd), title: typeof tab.title === 'string' ? tab.title : null }],
        winOf(e)
      );
      return true;
    })
  );
  ipcMain.handle(
    'window:init',
    guard((e) => {
      const adopt = pendingAdopt.get(e.sender.id) ?? [];
      pendingAdopt.delete(e.sender.id);
      return adopt;
    })
  );
  ipcMain.on(
    'window:title',
    guard((e, title: string) => winOf(e)?.setTitle(String(title).slice(0, 200)))
  );
  ipcMain.on(
    'frame:action',
    guard((e, action: FrameWindowAction) => {
      const win = winOf(e);
      if (!win) return;
      if (action === 'CLOSE') win.close();
      if (action === 'MINIMIZE') win.minimize();
      if (action === 'MAXIMIZE') (win.isMaximized() ? win.unmaximize() : win.maximize());
    })
  );

  // ---------- Folders ----------
  const pickDir = async (e: IpcEvent, title: string) => {
    const win = winOf(e);
    const opts: Electron.OpenDialogOptions = { title, properties: ['openDirectory'] };
    if (!win) {
      const res = await dialog.showOpenDialog(opts);
      return res.canceled ? null : res.filePaths[0];
    }
    const id = win.id;
    ownModal.add(id);
    try {
      const res = await dialog.showOpenDialog(win, opts);
      return res.canceled ? null : res.filePaths[0];
    } finally {
      ownModal.delete(id);
    }
  };
  ipcMain.handle('workspace:get', guard(() => readWorkspace()));
  ipcMain.handle(
    'workspace:set',
    guard(async (e) => {
      const root = await pickDir(e, 'Choose your workspace folder');
      if (root) writeWorkspaceRoot(root);
      return readWorkspace();
    })
  );

  // ---------- Account ----------
  ipcMain.handle('account:get', guard(() => fetchAccount()));
  ipcMain.handle(
    'account:logout',
    guard(async () => {
      await runClaude(['auth', 'logout']);
      return pushAccount();
    })
  );

  // ---------- Updates ----------
  const updater = initUpdater();
  ipcMain.handle('update:get', guard(() => updater.get()));
  ipcMain.on(
    'update:action',
    guard((_e, action: UpdateAction) => {
      if (['check', 'download', 'install', 'open'].includes(action)) updater.act(action);
    })
  );

  // ---------- Misc ----------
  ipcMain.handle('clipboard:read', guard(() => clipboard.readText()));
  ipcMain.handle('clipboard:paste', guard(() => readClipboardForPaste()));
  ipcMain.on(
    'clipboard:write',
    guard((_e, text: string) => {
      if (typeof text === 'string' && text.length <= 4_000_000) clipboard.writeText(text);
    })
  );
  ipcMain.handle('git:branch', guard((_e, dir: string) => gitBranch(dir)));
  ipcMain.handle('vscode:open', guard((_e, folder: string) => openInVSCode(folder)));

  createWindow();
});

app.on('window-all-closed', () => app.quit());

