import { UsageMeter } from './UsageMeter';

type Props = {
  usage: PlanUsage | null;
  onOpenFolder: () => void;
  onRestart?: () => void;
};

export function Header({ usage, onOpenFolder, onRestart }: Props) {
  return (
    <header className="header">
      <div className="brand">
        <span className="logo">✻</span>
        <span className="brand-name">ClaudeManager</span>
      </div>

      <div className="spacer" />

      <div className="usage-group">
        <UsageMeter label="Session" limit={usage?.session ?? null} />
        <UsageMeter label="Week" limit={usage?.week ?? null} longWindow />
      </div>

      <div className="actions">
        <button className="icon-btn" onClick={onOpenFolder} title="Open folder in a new tab (Ctrl+Shift+O)">
          <svg viewBox="0 0 24 24">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        </button>
        {onRestart && (
          <button className="icon-btn" onClick={onRestart} title="Restart Claude in this tab">
            <svg viewBox="0 0 24 24">
              <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
            </svg>
          </button>
        )}
      </div>

      <div className="window-controls">
        <button onClick={() => window.electron.sendFrameAction('MINIMIZE')} title="Minimize">
          <svg viewBox="0 0 12 12">
            <path d="M2 6h8" />
          </svg>
        </button>
        <button onClick={() => window.electron.sendFrameAction('MAXIMIZE')} title="Maximize">
          <svg viewBox="0 0 12 12">
            <rect x="2" y="2" width="8" height="8" />
          </svg>
        </button>
        <button className="close" onClick={() => window.electron.sendFrameAction('CLOSE')} title="Close">
          <svg viewBox="0 0 12 12">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>
    </header>
  );
}
