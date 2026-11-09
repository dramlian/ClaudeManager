import { useEffect, useRef } from 'react';
import { FolderSearch } from './FolderSearch';

type Props = {
  /** Folder of the active tab, if any. */
  currentFolder: string | null;
  onOpen: (folder: string) => void;
  onNewWindow: () => void;
  onClose: () => void;
};

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Popover under the tab bar's "+" button. */
export function NewTabMenu({ currentFolder, onOpen, onNewWindow, onClose }: Props) {
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

      <FolderSearch
        variant="menu"
        onOpen={(f) => {
          onClose();
          onOpen(f);
        }}
      />

      <div className="menu-sep" />
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
