import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  onOpen: (folder: string) => void;
  /** 'menu' = compact, inside the "+" popover; 'start' = on the start screen. */
  variant: 'menu' | 'start';
};

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

const FolderIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

/** Names starting with the query first, then names containing it; alphabetical within each. */
function filterFolders(folders: WorkspaceInfo['folders'], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return folders;
  const starts: WorkspaceInfo['folders'] = [];
  const contains: WorkspaceInfo['folders'] = [];
  for (const f of folders) {
    const i = f.name.toLowerCase().indexOf(q);
    if (i === 0) starts.push(f);
    else if (i > 0) contains.push(f);
  }
  return [...starts, ...contains];
}

/** Highlight the matched part of a folder name. */
function Highlight({ name, query }: { name: string; query: string }) {
  const q = query.trim();
  const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + q.length)}</mark>
      {name.slice(i + q.length)}
    </>
  );
}

/**
 * One workspace folder (e.g. C:\code) and a search over its direct subfolders.
 * Type to filter, ↑/↓ to move, Enter to open.
 */
export function FolderSearch({ onOpen, variant }: Props) {
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    window.electron.getWorkspace().then((w) => alive && setWs(w));
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => filterFolders(ws?.folders ?? [], query), [ws, query]);

  useEffect(() => setSel(0), [query, ws]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.fs-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const change = async () => {
    setWs(await window.electron.setWorkspace());
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && matches[sel]) {
      e.preventDefault();
      onOpen(matches[sel].path);
    }
  };

  const header = (
    <div className={variant === 'menu' ? 'menu-header' : 'recent-title row'}>
      <span>Workspace</span>
      {ws?.root && (
        <button className="menu-add" onClick={change} title="Choose a different workspace folder">
          Change
        </button>
      )}
    </div>
  );

  if (!ws) return <div className={`folder-search fs-${variant}`}>{header}</div>;

  if (!ws.root) {
    return (
      <div className={`folder-search fs-${variant}`}>
        {header}
        <div className="menu-empty">
          Pick the folder that holds your projects, then search its subfolders here.
        </div>
        <button className="fs-set" onClick={change}>
          Choose workspace folder…
        </button>
      </div>
    );
  }

  return (
    <div className={`folder-search fs-${variant}`}>
      {header}
      <div className="fs-root" title={ws.root}>
        {folderName(ws.root)}
        <span className="fs-root-path">{ws.root}</span>
      </div>
      <input
        className="fs-input"
        autoFocus
        spellCheck={false}
        placeholder={`Search ${ws.folders.length} folder${ws.folders.length === 1 ? '' : 's'}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="fs-list" ref={listRef}>
        {ws.missing && <div className="menu-empty">This folder can't be read. Choose another one.</div>}
        {!ws.missing && matches.length === 0 && (
          <div className="menu-empty">{query ? 'No matching folders.' : 'This folder has no subfolders.'}</div>
        )}
        {matches.map((f, i) => (
          <button
            key={f.path}
            className={`fs-item ${i === sel ? 'selected' : ''}`}
            onClick={() => onOpen(f.path)}
            onMouseMove={() => setSel(i)}
            title={f.path}
          >
            <span className="menu-icon">
              <FolderIcon />
            </span>
            <span className="fs-name">
              <Highlight name={f.name} query={query} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
