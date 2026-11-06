export type Tab = {
  id: string;
  cwd: string;
  /** Conversation title reported by Claude via the terminal title; null until set. */
  title: string | null;
  status: SessionStatus;
  ctx: ContextInfo;
  /** Claude is currently producing output. */
  busy: boolean;
  /** Finished work while the tab was in the background. */
  unread: boolean;
  /** Bumped on restart to remount the terminal. */
  gen: number;
};

type Props = {
  tabs: Tab[];
  activeId: string | null;
  label: (t: Tab) => string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
};

export function TabBar({ tabs, activeId, label, onActivate, onClose, onNew }: Props) {
  return (
    <nav className="tabbar">
      <div className="tabs">
        {tabs.map((t, i) => {
          const state = !t.status.running ? 'stopped' : t.busy ? 'busy' : t.unread ? 'unread' : 'idle';
          return (
            <div
              key={t.id}
              className={`tab ${t.id === activeId ? 'active' : ''}`}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.id);
                } else if (e.button === 0) onActivate(t.id);
              }}
              title={`${label(t)}\n${t.cwd}${i < 9 ? `\nCtrl+${i + 1}` : ''}`}
            >
              <span className={`tab-dot ${state}`} />
              <span className="tab-label">{label(t)}</span>
              {t.ctx.percent !== null && (
                <span className={`tab-ctx ${t.ctx.percent >= 85 ? 'danger' : t.ctx.percent >= 60 ? 'warn' : ''}`}>
                  {Math.round(t.ctx.percent)}%
                </span>
              )}
              <button
                className="tab-close"
                title="Close conversation (Ctrl+Shift+W)"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onClose(t.id)}
              >
                <svg viewBox="0 0 12 12">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <button className="tab-new" onClick={onNew} title="New conversation in this folder (Ctrl+Shift+T)">
        <svg viewBox="0 0 12 12">
          <path d="M6 2v8M2 6h8" />
        </svg>
      </button>
    </nav>
  );
}
