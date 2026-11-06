import { useEffect, useState } from 'react';

type Props = {
  label: string;
  limit: UsageLimit | null;
  /** Format the reset time as a weekday rather than a countdown. */
  longWindow?: boolean;
};

function level(p: number) {
  if (p >= 85) return 'danger';
  if (p >= 60) return 'warn';
  return 'ok';
}

function fmtCountdown(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtWhen(t: number) {
  return new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Compact plan-usage gauge for the title bar. */
export function UsageMeter({ label, limit, longWindow }: Props) {
  // Re-render every 30s so the countdown stays current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // A cached value whose window has already reset is stale: treat as 0%.
  const expired = !!limit?.resetsAt && limit.resetsAt <= now;
  const p = limit ? (expired ? 0 : limit.percent) : null;
  const resets = limit?.resetsAt && !expired ? limit.resetsAt : null;
  const resetText = resets ? (longWindow ? fmtWhen(resets) : fmtCountdown(resets - now)) : null;

  return (
    <div
      className={`usage context ${p === null ? 'idle' : level(p)}`}
      title={
        p === null
          ? `${label} usage appears after Claude's first reply (subscription plans only)`
          : `${label}: ${p.toFixed(0)}% used${resets ? `
Resets ${new Date(resets).toLocaleString()}` : ''}`
      }
    >
      <span className="context-label">{label}</span>
      <div className="bar">
        <div className="fill" style={{ width: `${p ?? 0}%` }} />
      </div>
      <span className="pct">{p === null ? '—' : `${Math.round(p)}%`}</span>
      {resetText && <span className="tokens">{longWindow ? resetText : `resets in ${resetText}`}</span>}
    </div>
  );
}
