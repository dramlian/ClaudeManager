type ContextInfo = {
  /** 0-100, null when unknown (before the first reply) */
  percent: number | null;
  usedTokens: number | null;
  windowSize: number | null;
  model: string | null;
  /** Reasoning effort level, e.g. "medium". */
  effort: string | null;
  /** Directory Claude reports it is working in (may differ from the tab folder). */
  currentDir: string | null;
  costUsd: number | null;
  sessionId: string | null;
  linesAdded: number | null;
  linesRemoved: number | null;
};

type UsageLimit = {
  /** 0-100 */
  percent: number;
  /** Epoch ms when the window resets, null if unknown. */
  resetsAt: number | null;
};

/** Plan usage limits (subscription accounts only); shared by all tabs. */
type PlanUsage = {
  session: UsageLimit | null;
  week: UsageLimit | null;
};

/** A running tab handed from one window to another. */
type AdoptTab = {
  id: string;
  cwd: string;
  title: string | null;
};

type SessionSnapshot = {
  status: SessionStatus;
  /** Raw terminal output so far, replayed into the new window's terminal. */
  history: string;
  ctx: ContextInfo;
};

type FrameWindowAction = 'CLOSE' | 'MAXIMIZE' | 'MINIMIZE';

type SessionStatus = {
  running: boolean;
  cwd: string | null;
  exitCode?: number | null;
  error?: string;
};

type UnsubscribeFunction = () => void;

interface Window {
  electron: {
    startSession: (tabId: string, cwd: string, cols: number, rows: number) => Promise<SessionStatus>;
    closeSession: (tabId: string) => Promise<void>;
    /** Pick up a running session (null if it no longer exists). */
    attachSession: (tabId: string, cols: number, rows: number) => Promise<SessionSnapshot | null>;
    /** Move a running tab into a new window; resolves false if it couldn't. */
    popOut: (tab: AdoptTab) => Promise<boolean>;
    newWindow: () => void;
    /** Tabs this window should adopt on startup (it was opened by a pop-out). */
    getWindowInit: () => Promise<AdoptTab[]>;
    writeToPty: (tabId: string, data: string) => void;
    resizePty: (tabId: string, cols: number, rows: number) => void;
    setWindowTitle: (title: string) => void;
    pickFolder: () => Promise<string | null>;
    clipboardRead: () => Promise<string>;
    clipboardWrite: (text: string) => void;
    openInVSCode: (folder: string) => Promise<{ ok: boolean; error?: string }>;
    getRecentFolders: () => Promise<string[]>;
    removeRecentFolder: (folder: string) => Promise<string[]>;
    getSavedFolders: () => Promise<string[]>;
    /** Opens a folder picker and saves the choice; resolves to the updated list. */
    addSavedFolder: () => Promise<string[]>;
    removeSavedFolder: (folder: string) => Promise<string[]>;
    sendFrameAction: (action: FrameWindowAction) => void;
    onPtyData: (cb: (tabId: string, data: string) => void) => UnsubscribeFunction;
    onSessionStatus: (cb: (tabId: string, status: SessionStatus) => void) => UnsubscribeFunction;
    onContext: (cb: (tabId: string, ctx: ContextInfo) => void) => UnsubscribeFunction;
    onUsage: (cb: (tabId: string, usage: PlanUsage) => void) => UnsubscribeFunction;
  };
}
