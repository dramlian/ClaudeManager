type Props = {
  cwd: string | null;
  ctx: ContextInfo;
  running: boolean;
  onOpenFolder: () => void;
  onRestart?: () => void;
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

export function Header({ cwd, ctx, running, onOpenFolder, onRestart }: Props) {
  const p = ctx.percent;
  const folderName = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : null;
  const hasLines = !!(ctx.linesAdded || ctx.linesRemoved);

  return (
    <header className="header">
      <div className="brand">
        <span className="logo">✻</span>
        <span className="brand-name">ClaudeManager</span>
      </div>

      {cwd && (
        <div className="crumb" title={cwd}>
          <span className={`dot ${running ? 'live' : ''}`} />
          <span className="crumb-name">{folderName}</span>
          <span className="crumb-path">{cwd}</span>
        </div>
      )}

      <div className="spacer" />

      {cwd && (
        <div className="stats">
          {ctx.model && <span className="chip model">{ctx.model}</span>}
          {hasLines && (
            <span className="chip">
              <span className="add">+{ctx.linesAdded ?? 0}</span>{' '}
              <span className="rem">−{ctx.linesRemoved ?? 0}</span>
            </span>
          )}

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
        </div>
      )}

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
