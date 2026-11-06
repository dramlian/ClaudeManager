import { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './Header';
import { StartScreen } from './StartScreen';
import { TabBar, type Tab } from './TabBar';
import { TerminalView } from './TerminalView';

const EMPTY: ContextInfo = {
  percent: null,
  usedTokens: null,
  windowSize: null,
  model: null,
  effort: null,
  currentDir: null,
  costUsd: null,
  sessionId: null,
  linesAdded: null,
  linesRemoved: null,
};

let counter = 0;
const newId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`;
const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const patch = useCallback((id: string, p: Partial<Tab>) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  useEffect(() => window.electron.onContext((id, ctx) => patch(id, { ctx })), [patch]);

  // Plan usage is account-wide: keep the latest report from any tab, cached across restarts.
  const [usage, setUsage] = useState<PlanUsage | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('planUsage') ?? 'null');
    } catch {
      return null;
    }
  });
  useEffect(
    () =>
      window.electron.onUsage((_id, u) => {
        setUsage(u);
        localStorage.setItem('planUsage', JSON.stringify(u));
      }),
    []
  );
  useEffect(() => window.electron.onSessionStatus((id, status) => patch(id, { status, busy: false })), [patch]);

  const openTab = useCallback((cwd: string) => {
    const tab: Tab = {
      id: newId(),
      cwd,
      title: null,
      status: { running: false, cwd },
      ctx: EMPTY,
      busy: false,
      unread: false,
      gen: 0,
    };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  }, []);

  const pickAndOpen = useCallback(async () => {
    const folder = await window.electron.pickFolder();
    if (folder) openTab(folder);
  }, [openTab]);

  // Saved folders, shared by the "+" menu and the start screen.
  const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => {
    window.electron.getSavedFolders().then(setSaved);
  }, []);
  const addSaved = useCallback(async () => setSaved(await window.electron.addSavedFolder()), []);
  const removeSaved = useCallback(
    async (folder: string) => setSaved(await window.electron.removeSavedFolder(folder)),
    []
  );

  const newConversation = useCallback(() => {
    const active = tabsRef.current.find((t) => t.id === activeRef.current);
    if (active) openTab(active.cwd);
    else pickAndOpen();
  }, [openTab, pickAndOpen]);

  const activate = useCallback(
    (id: string) => {
      setActiveId(id);
      patch(id, { unread: false });
    },
    [patch]
  );

  const closeTab = useCallback((id: string) => {
    window.electron.closeSession(id);
    const ts = tabsRef.current;
    const idx = ts.findIndex((t) => t.id === id);
    const rest = ts.filter((t) => t.id !== id);
    setTabs(rest);
    if (activeRef.current === id) {
      const next = rest[Math.min(idx, rest.length - 1)];
      setActiveId(next ? next.id : null);
    }
  }, []);

  const restartTab = useCallback(
    (id: string) => {
      setTabs((ts) =>
        ts.map((t) => (t.id === id ? { ...t, gen: t.gen + 1, ctx: EMPTY, title: null, busy: false } : t))
      );
    },
    []
  );

  // Keyboard shortcuts (Ctrl+Shift so they don't collide with Claude Code's own Ctrl keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ts = tabsRef.current;
      const idx = ts.findIndex((t) => t.id === activeRef.current);
      let handled = true;
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') newConversation();
      else if (e.ctrlKey && e.shiftKey && e.code === 'KeyO') pickAndOpen();
      else if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') activeRef.current && closeTab(activeRef.current);
      else if (e.ctrlKey && e.key === 'Tab' && ts.length > 1)
        activate(ts[(idx + (e.shiftKey ? -1 : 1) + ts.length) % ts.length].id);
      else if (e.ctrlKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        const target = n === 9 ? ts[ts.length - 1] : ts[n - 1];
        if (target) activate(target.id);
        else handled = false;
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [newConversation, pickAndOpen, closeTab, activate]);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const label = (t: Tab) => t.title ?? folderName(t.cwd);

  useEffect(() => {
    window.electron.setWindowTitle(active ? `${label(active)} - ClaudeManager` : 'ClaudeManager');
  }, [active?.title, active?.cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <Header usage={usage} />
      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          activeId={activeId}
          label={label}
          onActivate={activate}
          onClose={closeTab}
          currentFolder={active?.cwd ?? null}
          saved={saved}
          onOpen={openTab}
          onBrowse={pickAndOpen}
          onAddSaved={addSaved}
          onRemoveSaved={removeSaved}
        />
      )}
      <main className="content">
        {tabs.map((t) => (
          <TerminalView
            key={`${t.id}-${t.gen}`}
            tabId={t.id}
            cwd={t.cwd}
            active={t.id === activeId}
            status={t.status}
            ctx={t.ctx}
            onStatus={(status) => patch(t.id, { status })}
            onTitle={(title) => patch(t.id, { title })}
            onBusy={(busy, hiddenOutput) =>
              setTabs((ts) =>
                ts.map((x) =>
                  x.id === t.id
                    ? { ...x, busy, unread: x.unread || (!busy && hiddenOutput) }
                    : x
                )
              )
            }
            onRestart={() => restartTab(t.id)}
          />
        ))}
        {tabs.length === 0 && (
          <StartScreen
            onOpen={openTab}
            onBrowse={pickAndOpen}
            saved={saved}
            onAddSaved={addSaved}
            onRemoveSaved={removeSaved}
          />
        )}
      </main>
    </div>
  );
}
