import { useEffect, useRef } from 'react';

type Props = {
  /** Folder of the active tab, if any. */
  currentFolder: string | null;
  saved: string[];
  onOpen: (folder: string) => void;
  onBrowse: () => void;
  onAddSaved: () => void;
  onRemoveSaved: (folder: string) => void;
  onNewWindow: () => void;
  onClose: () => void;
};

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

const FolderIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

/** Popover under the tab bar's "+" button. */
export function NewTabMenu({ currentFolder, saved, onOpen, onBrowse, onAddSaved, onRemoveSaved, onNewWindow, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.('.tab-new')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const choose = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div className="menu" ref={ref}>
      {currentFolder && (
        <>
          <button className="menu-item" onClick={choose(() => onOpen(currentFolder))} title={currentFolder}>
            <span className="menu-icon">+</span>
            <span className="menu-text">
              <span className="menu-name">New session in {folderName(currentFolder)}</span>
              <span className="menu-path">{currentFolder}</span>
            </span>
            <kbd>Ctrl+Shift+T</kbd>
          </button>
          <div className="menu-sep" />
        </>
      )}

      <div className="menu-header">
        <span>Saved folders</span>
        <button className="menu-add" onClick={onAddSaved} title="Save a folder to this list">
          + Add
        </button>
      </div>
      {saved.length === 0 && <div className="menu-empty">No saved folders yet.</div>}
      {saved.map((f) => (
        <div key={f} className="menu-item" role="button" onClick={choose(() => onOpen(f))} title={f}>
          <span className="menu-icon">
            <FolderIcon />
          </span>
          <span className="menu-text">
            <span className="menu-name">{folderName(f)}</span>
            <span className="menu-path">{f}</span>
          </span>
          <button
            className="menu-remove"
            title="Remove from saved folders"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveSaved(f);
            }}
          >
            <svg viewBox="0 0 12 12">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      ))}

      <div className="menu-sep" />
      <button className="menu-item" onClick={choose(onBrowse)}>
        <span className="menu-icon">…</span>
        <span className="menu-text">
          <span className="menu-name">Open other folder…</span>
        </span>
        <kbd>Ctrl+Shift+O</kbd>
      </button>
      <button className="menu-item" onClick={choose(onNewWindow)}>
        <span className="menu-icon">
          <svg viewBox="0 0 24 24">
            <path d="M4 5h16v14H4zM4 9h16" />
          </svg>
        </span>
        <span className="menu-text">
          <span className="menu-name">New window</span>
        </span>
        <kbd>Ctrl+Shift+N</kbd>
      </button>
    </div>
  );
}
