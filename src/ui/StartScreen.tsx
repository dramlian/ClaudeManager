import { useEffect, useState } from 'react';

type Props = { onOpen: (folder: string) => void; onBrowse: () => void };

export function StartScreen({ onOpen, onBrowse }: Props) {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    window.electron.getRecentFolders().then(setRecent);
  }, []);

  return (
    <div className="start">
      <div className="start-card">
        <div className="start-logo">✻</div>
        <h1>Claude Code</h1>
        <p className="sub">
          Pick a project folder. Claude runs with <code>--dangerously-skip-permissions</code>.
        </p>
        <button className="primary" onClick={onBrowse}>
          Open folder…
        </button>

        {recent.length > 0 && (
          <div className="recent">
            <div className="recent-title">Recent</div>
            {recent.map((f) => (
              <div key={f} className="recent-item" onClick={() => onOpen(f)} title={f}>
                <span className="recent-name">{f.split(/[\\/]/).filter(Boolean).pop()}</span>
                <span className="recent-path">{f}</span>
                <button
                  className="recent-remove"
                  title="Remove from list"
                  onClick={async (e) => {
                    e.stopPropagation();
                    setRecent(await window.electron.removeRecentFolder(f));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
