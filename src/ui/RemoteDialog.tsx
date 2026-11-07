import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  remote: RemoteInfo | null;
  running: boolean;
  folderName: string;
  onClose: () => void;
};

/**
 * QR code for continuing this conversation on claude.ai / the Claude app (Remote Control).
 * Everything shown here was prepared by the main process when the session started, so it opens
 * instantly and never touches the terminal, even while Claude is busy with a long task.
 */
export function RemoteDialog({ remote, running, folderName, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    // Capture Esc before it reaches the terminal, where it would interrupt Claude.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const qrSrc = remote?.qrSvg ? `data:image/svg+xml;utf8,${encodeURIComponent(remote.qrSvg)}` : null;

  return createPortal(
    // Stop clicks here from bubbling (through the portal) to the terminal, which would grab focus.
    <div className="modal-backdrop" onMouseDown={onClose} onClick={(e) => e.stopPropagation()}>
      <div
        className="modal remote-modal"
        role="dialog"
        aria-label="Remote access"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">Remote access</span>
          <span className="modal-sub">{folderName}</span>
          <button ref={closeRef} className="modal-x" title="Close (Esc)" onClick={onClose}>
            <svg viewBox="0 0 10 10">
              <path d="M1 1l8 8M9 1l-8 8" />
            </svg>
          </button>
        </div>

        {remote ? (
          <>
            <div className="qr-frame">
              {qrSrc ? <img src={qrSrc} alt={`QR code for ${remote.url}`} /> : <div className="qr-wait">Rendering…</div>}
            </div>
            <p className="modal-hint">Scan with your phone to continue this conversation in the Claude app or on claude.ai.</p>
            <div className="remote-url" title={remote.url}>
              {remote.url}
            </div>
            <div className="modal-actions">
              <button
                className="footer-btn"
                onClick={() => {
                  window.electron.clipboardWrite(remote.url);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
              <button className="footer-btn" onClick={() => window.open(remote.url)}>
                Open in browser
              </button>
            </div>
          </>
        ) : (
          <div className="qr-frame empty">
            <div className="qr-wait">
              {running ? (
                <>
                  Waiting for Remote Control…
                  <small>
                    The link appears once Claude has connected. It needs a claude.ai subscription login; if it never shows
                    up, run <code>/remote-control</code> in the chat.
                  </small>
                </>
              ) : (
                'Claude is not running.'
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
