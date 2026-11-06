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
      // OSC 8 hyperlinks (Claude's login URL is one, wrapped over several lines). xterm's default
      // handler pops a confirm() and an empty window.open(), which the main process blocks.
      linkHandler: {
        activate: (_e, uri) => window.open(uri),
        allowNonHttpProtocols: false,
      },
      theme: {
        background: '#0a0f0c',
        foreground: '#d5e3d9',
        cursor: '#3ddc84',
        cursorAccent: '#0a0f0c',
        selectionBackground: '#3ddc8440',
        black: '#131c17',
        brightBlack: '#71897a',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, url) => window.open(url)));
    term.open(host.current!);
    termRef.current = term;
    fitRef.current = fit;

    const copySelection = () => {
      window.electron.clipboardWrite(term.getSelection());
      term.clearSelection();
    };
    // Paste text through xterm so bracketed-paste mode is respected. With no text on the
    // clipboard, pass Ctrl+V through so Claude can try its own (image) paste.
    const paste = async () => {
      const text = await window.electron.clipboardRead();
      if (disposed) return;
      if (text) term.paste(text);
      else window.electron.writeToPty(tabId, '\x16');
    };

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
      const key = e.key.toLowerCase();
      // Ctrl+C copies when text is selected; otherwise it reaches Claude as an interrupt.
      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        e.preventDefault();
        if (term.hasSelection()) copySelection();
        return false;
      }
      // Ctrl+V / Ctrl+Shift+V paste (e.g. the login code). preventDefault stops a second, native paste.
      if (key === 'v') {
        e.preventDefault();
        paste();
        return false;
      }
      return true;
    });

    // Right-click: copy if something is selected, otherwise paste (like Windows Terminal).
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) copySelection();
      else paste();
    };
    const hostEl = host.current!;
    hostEl.addEventListener('contextmenu', onContextMenu);

    // OSC 52 clipboard writes: Claude's "c to copy" on the login URL (and /copy) use this.
    const osc52 = term.parser.registerOscHandler(52, (data) => {
      const b64 = data.slice(data.indexOf(';') + 1);
      if (!b64 || b64 === '?' || b64.length > 4_000_000) return true; // ignore clipboard *reads*
      try {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        window.electron.clipboardWrite(new TextDecoder().decode(bytes));
      } catch {
        /* malformed base64 */
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
      osc52.dispose();
      hostEl.removeEventListener('contextmenu', onContextMenu);
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
