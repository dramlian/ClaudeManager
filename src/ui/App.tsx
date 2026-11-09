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
  useEffect(() => window.electron.onRemote((id, remote) => patch(id, { remote })), [patch]);

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

  // Who Claude Code is logged in as (undefined until the first answer).
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined);
  const accountKey = useRef<string | null | undefined>(undefined);
  const applyAccount = useCallback((a: AccountInfo | null) => {
    setAccount(a);
    if (!a) return;
    // Plan usage belongs to the account: drop the cached numbers when it changes.
    const key = a.loggedIn ? (a.email ?? a.authMethod ?? '') : null;
    if (accountKey.current !== undefined && accountKey.current !== key) {
      setUsage(null);
      localStorage.removeItem('planUsage');
    }
    accountKey.current = key;
  }, []);
  useEffect(() => {
    window.electron.getAccount().then(applyAccount);
    return window.electron.onAccount((_id, a) => applyAccount(a));
  }, [applyAccount]);
  const logout = useCallback(async () => applyAccount(await window.electron.logout()), [applyAccount]);

  const openTab = useCallback((cwd: string) => {
    const tab: Tab = {
      id: newId(),
      cwd,
      title: null,
      status: { running: false, cwd },
      ctx: EMPTY,
      remote: null,
      busy: false,
      unread: false,
      gen: 0,
    };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  }, []);

  // A window opened by "Pop out" adopts the running tab(s) it was handed.
  useEffect(() => {
    window.electron.getWindowInit().then((adopt) => {
      if (!adopt.length) return;
      const adopted: Tab[] = adopt.map((a) => ({
        id: a.id,
        cwd: a.cwd,
        title: a.title,
        status: { running: true, cwd: a.cwd },
        ctx: EMPTY,
        remote: null,
        busy: false,
        unread: false,
        gen: 0,
        attach: true,
      }));
      setTabs((ts) => [...ts, ...adopted]);
      setActiveId(adopted[adopted.length - 1].id);
    });
  }, []);

  // `claude auth login` in its own tab: it prints the login URL and may ask for a pasted code.
  const openLogin = useCallback(() => {
    const existing = tabsRef.current.find((t) => t.mode === 'login' && t.status.running);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const tab: Tab = {
      id: newId(),
      cwd: '',
      title: null,
      status: { running: false, cwd: null },
      ctx: EMPTY,
      remote: null,
      busy: false,
      unread: false,
      gen: 0,
      mode: 'login',
    };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  }, []);

  const newConversation = useCallback(() => {
    const active = tabsRef.current.find((t) => t.id === activeRef.current);
    if (active?.cwd) openTab(active.cwd);
  }, [openTab]);

  const activate = useCallback(
    (id: string) => {
      setActiveId(id);
      patch(id, { unread: false });
    },
    [patch]
  );

  const removeTab = useCallback((id: string) => {
    const ts = tabsRef.current;
    const idx = ts.findIndex((t) => t.id === id);
    const rest = ts.filter((t) => t.id !== id);
    setTabs(rest);
    if (activeRef.current === id) {
      const next = rest[Math.min(idx, rest.length - 1)];
      setActiveId(next ? next.id : null);
    }
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      window.electron.closeSession(id);
      removeTab(id);
    },
    [removeTab]
  );

  // A successful login closes its tab; the header shows the new account.
  useEffect(
    () =>
      window.electron.onSessionStatus((id, status) => {
        const t = tabsRef.current.find((x) => x.id === id);
        if (t?.mode === 'login' && !status.running && status.exitCode === 0) closeTab(id);
      }),
    [closeTab]
  );

  // Move a running conversation into its own window (the Claude process keeps running).
  const popOutTab = useCallback(
    async (id: string) => {
      const t = tabsRef.current.find((x) => x.id === id);
      if (t && (await window.electron.popOut({ id: t.id, cwd: t.cwd, title: t.title }))) removeTab(id);
    },
    [removeTab]
  );

  const restartTab = useCallback(
    (id: string) => {
      setTabs((ts) =>
        ts.map((t) => (t.id === id ? { ...t, gen: t.gen + 1, ctx: EMPTY, remote: null, title: null, busy: false, attach: false } : t))
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
      else if (e.ctrlKey && e.shiftKey && e.code === 'KeyN') window.electron.newWindow();
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
  }, [newConversation, closeTab, activate]);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const label = (t: Tab) => (t.mode === 'login' ? 'Claude login' : (t.title ?? folderName(t.cwd)));

  useEffect(() => {
    window.electron.setWindowTitle(active ? `${label(active)} - ClaudeManager` : 'ClaudeManager');
  }, [active?.title, active?.cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <Header usage={usage} account={account} onLogin={openLogin} onLogout={logout} />
      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          activeId={activeId}
          label={label}
          onActivate={activate}
          onClose={closeTab}
          currentFolder={active?.cwd || null}
          onOpen={openTab}
          onNewWindow={window.electron.newWindow}
        />
      )}
      <main className="content">
        {tabs.map((t) => (
          <TerminalView
            key={`${t.id}-${t.gen}`}
            tabId={t.id}
            cwd={t.cwd}
            attach={!!t.attach}
            mode={t.mode ?? 'chat'}
            active={t.id === activeId}
            status={t.status}
            ctx={t.ctx}
            remote={t.remote}
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
            onPopOut={() => popOutTab(t.id)}
          />
        ))}
        {tabs.length === 0 && (
          <StartScreen
            onOpen={openTab}
          />
        )}
      </main>
    </div>
  );
}
