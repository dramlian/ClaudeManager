import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { clipboard } from 'electron';

/**
 * Claude Code can't read an image from the clipboard through our pseudo-terminal, but it does
 * attach any image whose file path is pasted. So a clipboard image is saved as a PNG and its
 * path is pasted instead; a file copied in Explorer pastes its path.
 */
const PASTE_DIR = path.join(os.tmpdir(), 'ClaudeManager-pastes');
const PASTE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export function sweepPastes() {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(PASTE_DIR)) {
      const f = path.join(PASTE_DIR, name);
      if (now - fs.statSync(f).mtimeMs > PASTE_MAX_AGE_MS) fs.rmSync(f, { force: true });
    }
  } catch {
    /* folder doesn't exist yet */
  }
}

/** Quote a path for the terminal only when it needs it. */
const quotePath = (p: string) => (/\s/.test(p) ? `"${p}"` : p);

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export async function readClipboardForPaste(): Promise<ClipboardPaste> {
  const text = await clipboard.readText();
  if (text) return { kind: 'text', text };

  const items = await clipboard.read();
  // Files copied in Explorer: paste their paths (images among them get attached by Claude).
  for (const item of items) {
    if (!item.types.includes('text/uri-list')) continue;
    const uris = (await (await item.getType('text/uri-list')).text()).split(/\r?\n/);
    const paths = uris
      .filter((u) => u.startsWith('file:'))
      .map((u) => {
        try {
          return fileURLToPath(u.trim());
        } catch {
          return '';
        }
      })
      .filter((p) => p && fs.existsSync(p));
    if (paths.length) return { kind: 'file', text: paths.map(quotePath).join(' ') };
  }
  // Image data (screenshots, "Copy image"): save it and paste the path.
  for (const item of items) {
    const type = item.types.find((t) => t in IMAGE_EXT);
    if (!type) continue;
    const blob = (await item.getType(type)) as Blob;
    fs.mkdirSync(PASTE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(PASTE_DIR, `pasted-${stamp}.${IMAGE_EXT[type]}`);
    fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    return { kind: 'image', text: quotePath(file) };
  }
  return { kind: 'empty', text: '' };
}
