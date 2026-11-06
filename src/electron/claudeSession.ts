import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { app, BrowserWindow, type WebContents } from 'electron';
import type { IPty } from '@lydell/node-pty';

const require = createRequire(import.meta.url);
const pty: typeof import('@lydell/node-pty') = require('@lydell/node-pty');

/**
 * How context % works:
 * Claude Code pipes a JSON blob (model, cost, context_window, transcript_path, ...)
 * into the configured `statusLine` command on every update. We inject our own
 * statusLine via `--settings`, whose script dumps that JSON to a state file that
 * the main process watches and forwards to the UI.
 */
const STATUSLINE_SCRIPT = `
const fs = require('fs');
const out = process.argv[2];
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  try { fs.writeFileSync(out + '.tmp', input); fs.renameSync(out + '.tmp', out); } catch {}
  try {
    const j = JSON.parse(input);
    const name = (j.model && j.model.display_name) || '';
    process.stdout.write('\\x1b[2m' + name + '\\x1b[0m');
  } catch {}
});
`;

const DEFAULT_CONTEXT: ContextInfo = {
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

function findClaude(): string {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(process.env.APPDATA ?? '', 'npm', 'claude.cmd'),
  ];
  try {
    const found = execFileSync('where.exe', ['claude'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // prefer real executables over shell shims
    found.sort((a, b) => Number(b.endsWith('.exe')) - Number(a.endsWith('.exe')));
    candidates.unshift(...found);
  } catch {
    /* not on PATH */
  }
  const hit = candidates.find((c) => c && fs.existsSync(c) && /\.(exe|cmd)$/i.test(c));
  if (!hit) {
    throw new Error(
      'Could not find the Claude Code CLI. Install it (https://claude.com/claude-code) and make sure `claude` is on your PATH.'
    );
  }
  return hit;
}

export class ClaudeSession {
  private proc: IPty | null = null;
  private stateFile: string;
  private settingsFile: string;
  private watching = false;
  private lastContext: ContextInfo = { ...DEFAULT_CONTEXT };

  private launcherFile: string;
  /** Raw terminal output, replayed when the tab moves to another window. */
  private history: string[] = [];
  private historyLen = 0;
  private cwd: string | null = null;
  private exitCode: number | null | undefined;
  /** Window the session reports to; null while it is being moved between windows. */
  private target: WebContents | null;

  /** Prepare the shared runtime folder once per app start; returns its path. */
  static setupRuntime(): string {
    const dir = path.join(app.getPath('userData'), 'runtime');
    fs.mkdirSync(dir, { recursive: true });
    sweepStaleFiles(dir);
    fs.writeFileSync(path.join(dir, 'statusline.cjs'), STATUSLINE_SCRIPT);
    return dir;
  }

  constructor(
    target: WebContents,
    readonly tabId: string,
    dir: string
  ) {
    this.target = target;
    const id = `${process.pid}-${tabId}`;
    const scriptFile = path.join(dir, 'statusline.cjs');
    const launcher = path.join(dir, `statusline-${id}.cmd`);
    this.launcherFile = launcher;
    this.stateFile = path.join(dir, `state-${id}.json`);
    this.settingsFile = path.join(dir, `settings-${id}.json`);

    // Run the hook with Electron's bundled Node so users don't need Node installed.
    fs.writeFileSync(
      launcher,
      [
        '@echo off',
        'set ELECTRON_RUN_AS_NODE=1',
        `"${process.execPath}" "${scriptFile}" "${this.stateFile}"`,
        '',
      ].join('\r\n')
    );
    fs.writeFileSync(
      this.settingsFile,
      JSON.stringify(
        {
          statusLine: {
            type: 'command',
            command: `"${launcher.replace(/\\/g, '/')}"`,
            padding: 0,
          },
        },
        null,
        2
      )
    );
  }

  get running() {
    return this.proc !== null;
  }

  /** webContents id of the owning window, or null while detached. */
  get ownerId(): number | null {
    return this.target && !this.target.isDestroyed() ? this.target.id : null;
  }

  get status(): SessionStatus {
    return { running: this.running, cwd: this.cwd, ...(this.exitCode !== undefined && { exitCode: this.exitCode }) };
  }

  /** Stop reporting to the current window (the tab is being moved). */
  detach() {
    this.target = null;
  }

  /** Report to a new window; returns what it needs to rebuild the terminal. */
  attach(target: WebContents) {
    this.target = target;
    this.send('context:update', this.lastContext);
    return { status: this.status, history: this.history.join(''), ctx: this.lastContext };
  }

  private record(data: string) {
    this.history.push(data);
    this.historyLen += data.length;
    // Keep roughly the last 4 MB.
    while (this.historyLen > 4_000_000 && this.history.length > 1) {
      this.historyLen -= this.history.shift()!.length;
    }
  }

  start(cwd: string, cols: number, rows: number): SessionStatus {
    this.stop();
    this.resetContext();
    this.history = [];
    this.historyLen = 0;
    this.cwd = cwd;
    this.exitCode = undefined;

    let file: string;
    try {
      file = findClaude();
    } catch (e) {
      return { running: false, cwd, error: (e as Error).message };
    }

    const args = ['--dangerously-skip-permissions', '--settings', this.settingsFile];
    const env = { ...process.env, FORCE_COLOR: '1', COLORTERM: 'truecolor' } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_ENV;
    // Don't let markers from a parent Claude session (if the app was launched from one) leak in.
    for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) {
      delete env[k];
    }

    const isCmd = file.toLowerCase().endsWith('.cmd');
    const proc = pty.spawn(isCmd ? 'cmd.exe' : file, isCmd ? ['/c', file, ...args] : args, {
      name: 'xterm-256color',
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      cwd,
      env,
      useConptyDll: true,
    });
    this.proc = proc;

    proc.onData((data) => {
      this.record(data);
      this.send('pty:data', data);
    });
    proc.onExit(({ exitCode }) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.exitCode = exitCode;
      this.send('session:status', { running: false, cwd, exitCode });
    });

    this.watch();
    return { running: true, cwd };
  }

  write(data: string) {
    this.proc?.write(data);
  }

  resize(cols: number, rows: number) {
    if (!this.proc || cols < 2 || rows < 2) return;
    try {
      this.proc.resize(cols, rows);
    } catch {
      /* pty already gone */
    }
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    if (p) {
      try {
        p.kill();
      } catch {
        /* ignore */
      }
    }
  }

  dispose() {
    this.stop();
    fs.unwatchFile(this.stateFile);
    for (const f of [this.stateFile, this.settingsFile, this.launcherFile]) {
      fs.rmSync(f, { force: true });
    }
  }

  private resetContext() {
    fs.rmSync(this.stateFile, { force: true });
    this.lastContext = { ...DEFAULT_CONTEXT };
    this.send('context:update', this.lastContext);
  }

  private watch() {
    if (this.watching) return;
    this.watching = true;
    fs.watchFile(this.stateFile, { interval: 400 }, (curr) => {
      if (curr.mtimeMs === 0) return;
      this.readState();
    });
  }

  private readState() {
    let j: any;
    try {
      j = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      return;
    }
    const cw = j.context_window ?? {};
    const modelId: string = j.model?.id ?? '';
    let windowSize: number | null = num(cw.context_window_size);
    let used: number | null = null;
    let percent: number | null = num(cw.used_percentage);

    const cu = cw.current_usage;
    if (cu && typeof cu === 'object') {
      used = sum(cu.input_tokens, cu.cache_creation_input_tokens, cu.cache_read_input_tokens);
    }
    if (used === null && j.transcript_path) {
      used = usageFromTranscript(j.transcript_path);
    }
    if (windowSize === null) {
      windowSize = /\[1m\]|1m/i.test(modelId) ? 1_000_000 : 200_000;
    }
    // Prefer exact token math; the CLI's used_percentage is rounded to an integer.
    if (used !== null && windowSize > 0) {
      percent = (used / windowSize) * 100;
    }
    if (used === null && percent !== null) {
      used = Math.round((percent / 100) * windowSize);
    }

    this.lastContext = {
      percent: percent === null ? null : Math.min(100, Math.max(0, percent)),
      usedTokens: used,
      windowSize,
      model: j.model?.display_name ?? (modelId || null),
      effort: typeof j.effort?.level === 'string' ? j.effort.level : null,
      currentDir: j.workspace?.current_dir ?? j.cwd ?? null,
      costUsd: num(j.cost?.total_cost_usd),
      sessionId: j.session_id ?? null,
      linesAdded: num(j.cost?.total_lines_added),
      linesRemoved: num(j.cost?.total_lines_removed),
    };
    this.send('context:update', this.lastContext);

    const rl = j.rate_limits;
    if (rl && typeof rl === 'object') {
      const usage: PlanUsage = { session: limit(rl.five_hour), week: limit(rl.seven_day) };
      // Plan usage is account-wide: tell every window.
      if (usage.session || usage.week) {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('usage:update', '', usage);
      }
    }
  }

  private send(channel: string, payload: unknown) {
    if (this.target && !this.target.isDestroyed()) this.target.send(channel, this.tabId, payload);
  }
}

/** Remove per-instance files left behind by app instances that were killed. */
function sweepStaleFiles(dir: string) {
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/^(?:settings|state|statusline)-(\d+)(?:-[\w-]+)?\.(?:json|cmd)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    let alive = pid === process.pid;
    if (!alive) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        /* not running */
      }
    }
    if (!alive) fs.rmSync(path.join(dir, name), { force: true });
  }
}

/** { used_percentage, resets_at } from the status-line JSON -> UsageLimit. */
export function limit(v: any): UsageLimit | null {
  const percent = num(v?.used_percentage) ?? num(v?.utilization);
  if (percent === null) return null;
  let resetsAt: number | null = null;
  const r = v.resets_at;
  if (typeof r === 'number' && Number.isFinite(r)) resetsAt = r < 1e12 ? r * 1000 : r; // seconds or ms
  else if (typeof r === 'string' && !Number.isNaN(Date.parse(r))) resetsAt = Date.parse(r);
  return { percent: Math.min(100, Math.max(0, percent)), resetsAt };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function sum(...vals: unknown[]): number | null {
  const n = vals.map(num).filter((v): v is number => v !== null);
  return n.length ? n.reduce((a, b) => a + b, 0) : null;
}

/** Fallback for older CLI versions: last main-chain assistant usage in the transcript. */
function usageFromTranscript(file: string): number | null {
  try {
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"usage"')) continue;
      const e = JSON.parse(line);
      if (e.isSidechain || e.isApiErrorMessage) continue;
      const u = e.message?.usage;
      if (u) return sum(u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens);
    }
  } catch {
    /* ignore */
  }
  return null;
}
