import { useEffect, useRef, useState } from 'react';

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </svg>
);
const RefreshIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5" />
  </svg>
);

/** Title-bar version label. Lights up and pops open when a newer release is available. */
export function UpdateBadge() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  /** Set after a manual check so "up to date" is only claimed once a check really ran. */
  const [checked, setChecked] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const announced = useRef<string | null>(null);

  useEffect(() => {
    window.electron.getUpdate().then(setInfo);
    return window.electron.onUpdate((_id, u) => setInfo(u));
  }, []);

  // Pop open once per new version, so it is noticed without nagging.
  useEffect(() => {
    if (info?.phase === 'available' && info.latest && announced.current !== info.latest) {
      announced.current = info.latest;
      setOpen(true);
    }
  }, [info]);

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

  if (!info) return null;
  const { phase, latest, current, percent, selfUpdate } = info;
  const act = (a: UpdateAction) => window.electron.updateAction(a);
  const hasUpdate = !!latest && phase !== 'idle' && phase !== 'checking';

  const pill =
    phase === 'downloading'
      ? `↓ ${percent ?? 0}%`
      : phase === 'ready'
        ? '↻ restart to update'
        : hasUpdate
          ? `↑ ${latest}`
          : null;

  let status: string;
  if (!info.canCheck) status = 'Development build: update checks are off.';
  else if (phase === 'checking') status = 'Checking for updates…';
  else if (phase === 'available') status = `Version ${latest} is available.`;
  else if (phase === 'downloading') status = `Downloading ${latest}… ${percent ?? 0}%`;
  else if (phase === 'ready') status = `Version ${latest} is downloaded and ready to install.`;
  else if (phase === 'error') status = latest ? `Couldn't download ${latest}.` : "Couldn't check for updates.";
  else status = checked ? 'You are on the latest version.' : 'No update found yet.';

  return (
    <div className="update" ref={ref}>
      <button
        className={`update-btn ${hasUpdate ? 'has-update' : ''} ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={hasUpdate ? `Version ${latest} is available` : `Version ${current}`}
      >
        <span>v{current}</span>
        {pill && <span className="update-pill">{pill}</span>}
      </button>

      {open && (
        <div className="menu update-menu">
          <div className="menu-header">
            <span>Version</span>
          </div>
          <div className="update-info">
            <div className="menu-name">ClaudeManager {current}</div>
            <div className="menu-path">{status}</div>
            {phase === 'error' && info.error && <div className="menu-path update-error">{info.error}</div>}
          </div>
          {phase === 'downloading' && (
            <div className="update-progress">
              <div style={{ width: `${percent ?? 0}%` }} />
            </div>
          )}
          <div className="menu-sep" />

          {phase === 'ready' && (
            <button className="menu-item" onClick={() => act('install')}>
              <span className="menu-icon">
                <RefreshIcon />
              </span>
              <span className="menu-text">
                <span className="menu-name">Restart and update</span>
                <span className="menu-path">Closes all running conversations</span>
              </span>
            </button>
          )}
          {hasUpdate && selfUpdate && (phase === 'available' || phase === 'error') && (
            <button className="menu-item" onClick={() => act('download')}>
              <span className="menu-icon">
                <DownloadIcon />
              </span>
              <span className="menu-text">
                <span className="menu-name">{phase === 'error' ? 'Try again' : `Update to ${latest}`}</span>
                <span className="menu-path">Downloads in the background</span>
              </span>
            </button>
          )}
          {hasUpdate && !selfUpdate && (
            <button className="menu-item" onClick={() => act('open')}>
              <span className="menu-icon">
                <DownloadIcon />
              </span>
              <span className="menu-text">
                <span className="menu-name">Get {latest}</span>
                <span className="menu-path">Portable build: opens the download page</span>
              </span>
            </button>
          )}
          {!hasUpdate && (
            <button
              className="menu-item"
              disabled={!info.canCheck || phase === 'checking'}
              onClick={() => {
                setChecked(true);
                act('check');
              }}
            >
              <span className="menu-icon">
                <RefreshIcon />
              </span>
              <span className="menu-text">
                <span className="menu-name">Check for updates</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
