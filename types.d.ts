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

/** Remote Control link for a session (open in claude.ai or the Claude app), QR pre-rendered. */
type RemoteInfo = {
  url: string;
  /** SVG markup of the QR code; empty while it is still being generated. */
  qrSvg: string;
};

type SessionSnapshot = {
  status: SessionStatus;
  /** Raw terminal output so far, replayed into the new window's terminal. */
  history: string;
  ctx: ContextInfo;
  remote: RemoteInfo | null;
};

type GitBranch = {
  /** Branch name, or the short commit hash when HEAD is detached. */
  name: string;
  detached: boolean;
};

/** Claude Code login, from `claude auth status --json`. */
type AccountInfo = {
  loggedIn: boolean;
  email: string | null;
  orgName: string | null;
  /** e.g. "pro", "max"; null for API-key / Console logins. */
  plan: string | null;
  /** e.g. "claude.ai", "console", "api_key". */
  authMethod: string | null;
};

/** What a tab runs: a normal conversation, or the interactive `claude auth login` flow. */
type SessionMode = 'chat' | 'login';

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
    startSession: (tabId: string, cwd: string, cols: number, rows: number, mode?: SessionMode) => Promise<SessionStatus>;
    /** Current login; null if the CLI couldn't be asked. */
    getAccount: () => Promise<AccountInfo | null>;
    /** Runs `claude auth logout`; resolves to the account afterwards. */
    logout: () => Promise<AccountInfo | null>;
    /** Login changed (log in, log out, or another account). */
    onAccount: (cb: (tabId: string, account: AccountInfo | null) => void) => UnsubscribeFunction;
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
    /** null when the folder is not inside a git repo. */
    getGitBranch: (dir: string) => Promise<GitBranch | null>;
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
    /** Remote Control link became available (null again after a restart). */
    onRemote: (cb: (tabId: string, remote: RemoteInfo | null) => void) => UnsubscribeFunction;
  };
}
