import { app, BrowserWindow, shell } from 'electron';
import electronUpdater from 'electron-updater';

// electron-updater is CommonJS: the named export isn't visible to ESM imports.
const { autoUpdater } = electronUpdater;

const RELEASES_URL = 'https://github.com/dramlian/ClaudeManager/releases/latest';
const CHECK_EVERY_MS = 4 * 60 * 60_000;

/**
 * In-app updates from GitHub Releases (see "publish" in electron-builder.json).
 * Only the installed (NSIS) build can replace itself. The portable exe still checks, but its
 * button opens the release page instead. Nothing is downloaded until the user asks.
 */
export function initUpdater() {
  const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
  const state: UpdateInfo = {
    current: app.getVersion(),
    phase: 'idle',
    latest: null,
    percent: null,
    error: null,
    canCheck: app.isPackaged,
    selfUpdate: app.isPackaged && !portable,
  };
  /** The running check was asked for by the user: report "up to date" and errors. */
  let manual = false;

  const set = (p: Partial<UpdateInfo>) => {
    Object.assign(state, p);
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('update:status', '', state);
    }
  };

  // Set explicitly so every build flavour (installed, portable) checks the same place,
  // whether or not electron-builder generated an app-update.yml for it.
  autoUpdater.setFeedURL({ provider: 'github', owner: 'dramlian', repo: 'ClaudeManager' });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = state.selfUpdate;

  autoUpdater.on('checking-for-update', () => set({ phase: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ phase: 'available', latest: info.version }));
  autoUpdater.on('update-not-available', () => set({ phase: 'idle', latest: null }));
  autoUpdater.on('download-progress', (p) => set({ phase: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ phase: 'ready', latest: info.version, percent: 100 }));
  autoUpdater.on('error', (err) => {
    const downloading = state.phase === 'downloading';
    // Background checks fail quietly (offline, release still uploading, ...).
    if (!manual && !downloading) return set({ phase: state.latest ? 'available' : 'idle' });
    const error = String(err?.message ?? err).split('\n')[0].slice(0, 200);
    set({ phase: 'error', error, percent: null });
  });

  const check = (byUser: boolean) => {
    if (!state.canCheck || ['checking', 'downloading', 'ready'].includes(state.phase)) return;
    manual = byUser;
    autoUpdater.checkForUpdates().catch(() => {
      /* reported through the 'error' event */
    });
  };

  if (state.canCheck) {
    setTimeout(() => check(false), 5_000);
    setInterval(() => check(false), CHECK_EVERY_MS);
  }

  return {
    get: () => state,
    act(action: UpdateAction) {
      if (action === 'check') return check(true);
      if (action === 'open') return void shell.openExternal(RELEASES_URL);
      if (!state.selfUpdate) return;
      if (action === 'download' && state.latest && (state.phase === 'available' || state.phase === 'error')) {
        manual = true;
        set({ phase: 'downloading', percent: 0, error: null });
        autoUpdater.downloadUpdate().catch(() => {
          /* reported through the 'error' event */
        });
      }
      // Silent install, then start the new version.
      if (action === 'install' && state.phase === 'ready') autoUpdater.quitAndInstall(true, true);
    },
  };
}
