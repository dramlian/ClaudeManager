import { useEffect, useRef, useState } from 'react';

type Props = {
  /** undefined while loading, null if the CLI couldn't be asked. */
  account: AccountInfo | null | undefined;
  onLogin: () => void;
  onLogout: () => Promise<void>;
};

const PersonIcon = () => (
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
  </svg>
);

const methodLabel = (a: AccountInfo) => {
  if (a.authMethod === 'claude.ai') return a.plan ? `Claude ${a.plan[0].toUpperCase()}${a.plan.slice(1)}` : 'Claude subscription';
  if (a.authMethod === 'console') return 'Anthropic Console';
  if (a.authMethod === 'api_key') return 'API key';
  return a.authMethod;
};

/** Title-bar button showing who Claude Code is logged in as, with log in / switch / log out. */
export function AccountMenu({ account, onLogin, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const loggedIn = !!account?.loggedIn;
  const name = account === undefined ? '…' : loggedIn ? (account!.email ?? methodLabel(account!) ?? 'Logged in') : 'Log in';

  const login = () => {
    setOpen(false);
    onLogin();
  };
  const logout = async () => {
    setBusy(true);
    try {
      await onLogout();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="account" ref={ref}>
      <button
        className={`account-btn ${loggedIn ? '' : 'logged-out'} ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={loggedIn ? `Logged in as ${name}` : 'Not logged in to Claude Code'}
      >
        <PersonIcon />
        <span className="account-name">{name}</span>
      </button>

      {open && (
        <div className="menu account-menu">
          <div className="menu-header">
            <span>Claude account</span>
          </div>
          {account === null && <div className="menu-empty">Couldn't read the login status from the Claude CLI.</div>}
          {account && !account.loggedIn && <div className="menu-empty">Not logged in.</div>}
          {account?.loggedIn && (
            <div className="account-info">
              <div className="menu-name">{account.email ?? 'Logged in'}</div>
              <div className="menu-path">{[methodLabel(account), account.orgName].filter(Boolean).join(' · ')}</div>
            </div>
          )}
          <div className="menu-sep" />
          <button className="menu-item" onClick={login} disabled={busy}>
            <span className="menu-icon">
              <PersonIcon />
            </span>
            <span className="menu-text">
              <span className="menu-name">{loggedIn ? 'Switch account…' : 'Log in…'}</span>
              <span className="menu-path">Opens the Claude login in a new tab</span>
            </span>
          </button>
          {loggedIn && (
            <button className="menu-item" onClick={logout} disabled={busy}>
              <span className="menu-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
                </svg>
              </span>
              <span className="menu-text">
                <span className="menu-name">{busy ? 'Logging out…' : 'Log out'}</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
