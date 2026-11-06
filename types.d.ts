type ContextInfo = {
  /** 0-100, null when unknown (before the first reply) */
  percent: number | null;
  usedTokens: number | null;
  windowSize: number | null;
  model: string | null;
  costUsd: number | null;
  sessionId: string | null;
  linesAdded: number | null;
  linesRemoved: number | null;
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
    writeToPty: (tabId: string, data: string) => void;
    resizePty: (tabId: string, cols: number, rows: number) => void;
    setWindowTitle: (title: string) => void;
    pickFolder: () => Promise<string | null>;
    getRecentFolders: () => Promise<string[]>;
    removeRecentFolder: (folder: string) => Promise<string[]>;
    sendFrameAction: (action: FrameWindowAction) => void;
    onPtyData: (cb: (tabId: string, data: string) => void) => UnsubscribeFunction;
    onSessionStatus: (cb: (tabId: string, status: SessionStatus) => void) => UnsubscribeFunction;
    onContext: (cb: (tabId: string, ctx: ContextInfo) => void) => UnsubscribeFunction;
  };
}
