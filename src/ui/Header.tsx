import { AccountMenu } from './AccountMenu';
import { UsageMeter } from './UsageMeter';

type Props = {
  usage: PlanUsage | null;
  account: AccountInfo | null | undefined;
  onLogin: () => void;
  onLogout: () => Promise<void>;
};

export function Header({ usage, account, onLogin, onLogout }: Props) {
  return (
    <header className="header">
      <div className="brand">
        <span className="logo">&gt;_</span>
        <span className="brand-name">claude-manager</span>
      </div>

      <div className="spacer" />

      <div className="usage-group">
        <UsageMeter label="Session" limit={usage?.session ?? null} />
        <UsageMeter label="Week" limit={usage?.week ?? null} longWindow />
      </div>

      <AccountMenu account={account} onLogin={onLogin} onLogout={onLogout} />

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
