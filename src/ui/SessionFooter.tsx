type Props = {
  ctx: ContextInfo;
  cwd: string;
  running: boolean;
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
export function SessionFooter({ ctx, cwd, running }: Props) {
  const p = ctx.percent;
  const folderName = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;

  return (
    <footer className="session-footer">
      <span className="crumb" title={cwd}>
        <span className={`dot ${running ? 'live' : ''}`} />
        <span className="crumb-name">{folderName}</span>
        <span className="crumb-path">{cwd}</span>
      </span>
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
