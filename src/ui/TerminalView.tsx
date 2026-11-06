import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SessionFooter } from './SessionFooter';

type Props = {
  tabId: string;
  cwd: string;
  active: boolean;
  status: SessionStatus;
  ctx: ContextInfo;
  onStatus: (s: SessionStatus) => void;
  onTitle: (title: string | null) => void;
  /** hiddenOutput: Claude wrote output while this tab wasn't visible. */
  onBusy: (busy: boolean, hiddenOutput: boolean) => void;
  onRestart: () => void;
};

const GENERIC_TITLES = /^(claude( code)?|cmd(\.exe)?|.*\\claude\.exe)$/i;

/** Claude puts the conversation topic in the terminal title, prefixed by a spinner glyph. */
function cleanTitle(raw: string): string | null {
  const t = raw.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return !t || GENERIC_TITLES.test(t) ? null : t;
}

export function TerminalView({ tabId, cwd, active, status, ctx, onStatus, onTitle, onBusy, onRestart }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Keep latest callbacks without re-running the mount effect.
  const cb = useRef({ onStatus, onTitle, onBusy });
  cb.current = { onStatus, onTitle, onBusy };
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let disposed = false;
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: {
        background: '#0d0d0f',
        foreground: '#e6e1dc',
        cursor: '#d97757',
        cursorAccent: '#0d0d0f',
        selectionBackground: '#d9775766',
        black: '#1a1a1e',
        brightBlack: '#5c5c66',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, url) => window.open(url)));
    term.open(host.current!);
    termRef.current = term;
    fitRef.current = fit;

    // Ctrl+C copies when text is selected; otherwise it reaches Claude as an interrupt.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      return true;
    });

    // "Busy" = Claude has written output recently (its spinner redraws constantly while working).
    let busy = false;
    // Bytes written while hidden; small footer/status-line redraws don't count as "new reply".
    let hiddenBytes = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const markActivity = (bytes: number) => {
      if (!activeRef.current) hiddenBytes += bytes;
      if (!busy) {
        busy = true;
        cb.current.onBusy(true, false);
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        busy = false;
        if (!disposed) cb.current.onBusy(false, hiddenBytes > 1500 && !activeRef.current);
        hiddenBytes = 0;
      }, 1500);
    };

    let started = false;
    let lastEcho = 0;
    const offData = window.electron.onPtyData((id, d) => {
      if (id !== tabId) return;
      term.write(d);
      // Ignore the redraw caused by our own keystrokes/resizes.
      if (started && performance.now() - lastEcho > 250) markActivity(d.length);
    });
    const input = term.onData((d) => {
      lastEcho = performance.now();
      window.electron.writeToPty(tabId, d);
    });
    const title = term.onTitleChange((t) => cb.current.onTitle(cleanTitle(t)));

    const doFit = () => {
      if (disposed || !host.current || host.current.clientWidth === 0) return;
      const { cols, rows } = term;
      fit.fit();
      if (started && (cols !== term.cols || rows !== term.rows)) {
        lastEcho = performance.now();
        window.electron.resizePty(tabId, term.cols, term.rows);
      }
    };

    const ro = new ResizeObserver(() => requestAnimationFrame(doFit));
    ro.observe(host.current!);

    // Delay start slightly so React StrictMode's mount/unmount/mount doesn't spawn twice.
    const startTimer = setTimeout(async () => {
      doFit();
      const s = await window.electron.startSession(tabId, cwd, term.cols, term.rows);
      if (disposed) return;
      setTimeout(() => (started = true), 3000); // skip the startup banner when tracking activity
      cb.current.onStatus(s);
      if (s.error) term.write(`\r\n\x1b[31m${s.error}\x1b[0m\r\n`);
    }, 50);

    return () => {
      disposed = true;
      clearTimeout(startTimer);
      clearTimeout(idleTimer);
      ro.disconnect();
      offData();
      input.dispose();
      title.dispose();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, cwd]);

  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [active]);

  const exited = !status.running && (status.exitCode !== undefined || !!status.error);

  return (
    <div className={`terminal-wrap ${active ? 'active' : ''}`} onClick={() => termRef.current?.focus()}>
      <div className="terminal-area">
        <div className="terminal" ref={host} />
      </div>
      <SessionFooter ctx={ctx} cwd={cwd} running={status.running} />
      {exited && (
        <div className="exit-banner">
          <span>
            {status.error
              ? 'Claude failed to start.'
              : `Claude exited${status.exitCode ? ` (code ${status.exitCode})` : ''}.`}
          </span>
          <button className="primary small" onClick={onRestart}>
            Restart
          </button>
        </div>
      )}
    </div>
  );
}
