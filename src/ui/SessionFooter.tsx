import { useCallback, useEffect, useState } from 'react';
import { RemoteDialog } from './RemoteDialog';

type Props = {
  ctx: ContextInfo;
  cwd: string;
  running: boolean;
  remote: RemoteInfo | null;
  onPopOut: () => void;
};

const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${+(n / 1000).toFixed(1)}k`
      : `${n}`;

function level(p: number) {
  if (p >= 85) return 'danger';
  if (p >= 60) return 'warn';
  return 'ok';
}

/** Per-conversation status bar shown under each terminal: working folder, model, effort, context usage. */
export function SessionFooter({ ctx, cwd, running, remote, onPopOut }: Props) {
  const [showRemote, setShowRemote] = useState(false);
  const closeRemote = useCallback(() => setShowRemote(false), []);
  const p = ctx.percent;
  // Follow Claude if it changes directory; fall back to the folder the tab was opened in.
  const dir = ctx.currentDir ?? cwd;
  const folderName = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;

  // Git branch of the working folder; re-checked every few seconds to catch checkouts.
  const [branch, setBranch] = useState<GitBranch | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      window.electron.getGitBranch(dir).then((b) => {
        if (alive) setBranch((prev) => (prev?.name === b?.name && prev?.detached === b?.detached ? prev : b));
      });
    check();
    const id = setInterval(check, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [dir]);

  return (
    <footer className="session-footer">
      <span className="crumb" title={dir}>
        <span className={`dot ${running ? 'live' : ''}`} />
        <span className="crumb-name">{folderName}</span>
        <span className="crumb-path">{dir}</span>
      </span>
      {branch && (
        <span
          className={`stat branch ${branch.detached ? 'detached' : ''}`}
          title={branch.detached ? `Detached HEAD at ${branch.name}` : `Git branch: ${branch.name}`}
        >
          <svg viewBox="0 0 24 24">
            <path d="M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="stat-value">{branch.name}</span>
        </span>
      )}
      <button
        className="footer-btn"
        title={`Open ${dir} in VS Code`}
        onClick={(e) => {
          e.stopPropagation();
          window.electron.openInVSCode(dir);
        }}
      >
        <svg viewBox="0 0 24 24">
          <path d="M17 3l4 2v14l-4 2L7 12zM17 3L3 14l2 2 12-9M17 21L3 10l2-2 12 9" />
        </svg>
        VS Code
      </button>
      <button
        className="footer-btn"
        title="Move this conversation to its own window (Claude keeps running)"
        onClick={(e) => {
          e.stopPropagation();
          onPopOut();
        }}
      >
        <svg viewBox="0 0 24 24">
          <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
        Pop out
      </button>
      <button
        className={`footer-btn remote-btn ${remote ? 'ready' : ''}`}
        title={remote ? 'Show a QR code to continue this conversation on your phone' : 'Remote Control is connecting…'}
        onClick={(e) => {
          e.stopPropagation();
          setShowRemote(true);
        }}
      >
        <svg viewBox="0 0 24 24">
          <path d="M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2" />
        </svg>
        Remote
        <span className="remote-dot" />
      </button>
      {showRemote && <RemoteDialog remote={remote} running={running} folderName={folderName} onClose={closeRemote} />}
      <span className="stat" title="Model">
        <span className="stat-label">Model</span>
        <span className={`stat-value model ${ctx.model ? '' : 'idle'}`}>{ctx.model ?? '—'}</span>
      </span>
      <span className="stat" title="Reasoning effort">
        <span className="stat-label">Effort</span>
        <span className={`stat-value ${ctx.effort ? '' : 'idle'}`}>{ctx.effort ?? '—'}</span>
      </span>

      <div className="spacer" />

      <div
        className={`context ${p === null ? 'idle' : level(p)}`}
        title={
          p === null
            ? 'Context usage appears after the first response'
            : `${ctx.usedTokens?.toLocaleString() ?? '?'} / ${ctx.windowSize?.toLocaleString() ?? '?'} tokens`
        }
      >
        <span className="context-label">Context</span>
        <div className="bar">
          <div className="fill" style={{ width: `${p ?? 0}%` }} />
        </div>
        <span className="pct">{p === null ? '—' : `${p.toFixed(p < 10 ? 1 : 0)}%`}</span>
        {ctx.usedTokens !== null && ctx.windowSize !== null && (
          <span className="tokens">
            {fmtTokens(ctx.usedTokens)} / {fmtTokens(ctx.windowSize)}
          </span>
        )}
      </div>
    </footer>
  );
}
