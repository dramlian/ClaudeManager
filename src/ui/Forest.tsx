import { useEffect, useRef } from 'react';

/** Pixel size: the scene is drawn at 1/PX resolution and scaled up with crisp edges. */
const PX = 3;

const C = {
  moon: '#efe6a4',
  moonShade: '#d9cf86',
  halo: '#22383a',
  star: '#e9f2e6',
  starDim: '#7fa7a0',
  hill: '#0f2628',
  pineFar: '#10292a',
  pineMid: '#0b1d1f',
  pineNear: '#050c0d',
  pineEdge: '#1d4542',
  ground: '#071113',
  grass: '#12302e',
  mist: '#2c5552',
  wall: '#2a3b33',
  wallDark: '#1d2a25',
  roof: '#3b2a24',
  roofEdge: '#59392c',
  window: '#ffb347',
  windowHot: '#ffd27a',
  smoke: '#3d5c58',
  path: '#24352f',
  pathDark: '#1a2924',
  capRed: '#e0573a',
  capGlow: '#5fe0cf',
  dot: '#efe6a4',
  stem: '#c9c2a0',
  firefly: '#e9f59a',
  fireflyDim: '#6f7d3a',
};

/** Small deterministic RNG so the scene is stable between redraws. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const GROUND = ['#163a37', '#10302d', '#0b2220', '#071514', '#040b0b'];
const FLOWERS = ['#efe6a4', '#5fe0cf', '#ff8a5c', '#c9b8f0'];
const SKY_STOPS =['#05090c', '#071114', '#0a181b', '#0e2124', '#143236'].map(hex);

function canvas(W: number, H: number) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d')!] as const;
}

function painter(ctx: CanvasRenderingContext2D) {
  return (x: number, y: number, c: string, w = 1, h = 1) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
}

/** Stepped pine: tiers of widening rows, pixel-art style. */
function pine(px: ReturnType<typeof painter>, cx: number, base: number, h: number, color: string, edge?: string) {
  const top = base - h;
  const tiers = Math.max(2, Math.round(h / 7));
  const tierH = h / tiers;
  const maxHalf = Math.max(2, Math.round(h * 0.28));
  for (let y = 0; y < h - 2; y++) {
    const tier = Math.floor(y / tierH);
    const inTier = (y - tier * tierH) / tierH;
    const half = Math.round(((tier + 1) / tiers) * maxHalf * (0.45 + 0.55 * inTier));
    px(cx - half, top + y, color, half * 2 + 1, 1);
    if (edge && inTier > 0.85) px(cx - half, top + y, edge, 1, 1); // moonlit left rim
  }
  px(cx, base - 3, color, 1, 3); // trunk
}

function skyLayer(W: number, H: number, horizon: number) {
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  const n = SKY_STOPS.length - 1;
  for (let y = 0; y < H; y++) {
    const t = Math.min(1, Math.pow(y / Math.max(1, horizon), 1.5)) * n;
    const k = Math.min(n - 1, Math.floor(t));
    const f = t - k;
    for (let x = 0; x < W; x++) {
      const [r, g, b] = f > (BAYER4[y & 3][x & 3] + 0.5) / 16 ? SKY_STOPS[k + 1] : SKY_STOPS[k];
      const i = (y * W + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Moon with a dithered halo.
  const px = painter(ctx);
  const mx = Math.round(W * 0.8);
  const my = Math.round(horizon * 0.25);
  const mr = Math.max(5, Math.round(H * 0.055));
  for (let y = -mr * 2; y <= mr * 2; y++) {
    for (let x = -mr * 2; x <= mr * 2; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= mr) px(mx + x, my + y, (x * 3 + y * 7) % 11 === 0 && d > mr * 0.35 ? C.moonShade : C.moon);
      else if (d <= mr * 1.7 && ((x + y) & 1) === 0) px(mx + x, my + y, C.halo);
    }
  }
  return { c, moon: { x: mx, y: my, r: mr * 1.8 } };
}

function layout(W: number, H: number) {
  const r = rng(11);
  const horizon = Math.round(H * 0.5);

  // ---- back layer: rolling hills + far pines ----
  const [back, bctx] = canvas(W, H);
  const bpx = painter(bctx);
  for (let x = 0; x < W; x++) {
    const h = Math.round(H * 0.1 + 6 * Math.sin(x / 31) + 4 * Math.sin(x / 13 + 2));
    bpx(x, horizon - h + Math.round(H * 0.08), C.hill, 1, H);
  }
  for (let x = -6; x < W + 6; x += 3 + Math.floor(r() * 4)) {
    const base = horizon + Math.round(H * 0.1) + Math.floor(r() * 6);
    pine(bpx, x, base, Math.round(H * (0.08 + r() * 0.08)), C.pineFar);
  }
  // mid pines
  for (let x = -8; x < W + 8; x += 5 + Math.floor(r() * 7)) {
    const base = horizon + Math.round(H * 0.24) + Math.floor(r() * 8);
    pine(bpx, x, base, Math.round(H * (0.14 + r() * 0.12)), C.pineMid, r() < 0.5 ? C.pineEdge : undefined);
  }

  // ---- front layer: ground, cottage, mushrooms, framing pines ----
  const [front, fctx] = canvas(W, H);
  const fpx = painter(fctx);
  const groundY = Math.round(H * 0.8);
  const groundAt = (x: number) => groundY + Math.round(2 * Math.sin(x / 17) + 1.5 * Math.sin(x / 7 + 1));

  // Mossy ground: dithered gradient from moonlit moss at the top to near-black at the bottom.
  for (let x = 0; x < W; x++) {
    const g = groundAt(x);
    for (let y = g; y < H; y++) {
      const t = Math.pow((y - g) / Math.max(1, H - g), 0.7) * (GROUND.length - 1);
      const k = Math.min(GROUND.length - 2, Math.floor(t));
      fpx(x, y, t - k > (BAYER4[y & 3][x & 3] + 0.5) / 16 ? GROUND[k + 1] : GROUND[k]);
    }
    if (r() < 0.4) fpx(x, g - 1, C.grass); // grass tufts
    if (r() < 0.1) fpx(x, g - 2, C.grass);
  }

  // Cottage in the clearing (right of the start card).
  const hw = Math.max(18, Math.round(W * 0.07));
  const hx = Math.round(W * 0.745);
  const hh = Math.round(hw * 0.62);
  const hy = groundY - hh;
  fpx(hx, hy, C.wall, hw, hh);
  fpx(hx + hw - 3, hy, C.wallDark, 3, hh);
  // timber frame
  fpx(hx, hy, C.roofEdge, hw, 1);
  fpx(hx, hy, C.roofEdge, 1, hh);
  fpx(hx + Math.round(hw / 2), hy, C.wallDark, 1, hh);
  const roofSteps = Math.round(hw * 0.55) + 2;
  for (let i = 0; i <= roofSteps; i++) {
    // stepped roof with an overhang
    const y = hy - 1 - Math.round(i * 0.75);
    fpx(hx - 3 + i, y, C.roof, hw + 6 - i * 2, 1);
    fpx(hx - 3 + i, y, C.roofEdge, 1, 1);
  }
  const chim = { x: hx + Math.round(hw * 0.68), y: hy - Math.round(roofSteps * 0.5) - 4 };
  fpx(chim.x, chim.y, C.roof, 3, 6);
  fpx(chim.x - 1, chim.y, C.roofEdge, 5, 1);
  const win = { x: hx + 3, y: hy + 3, w: 5, h: 4 };
  const door = { x: hx + Math.round(hw * 0.62), y: groundY - 7, w: 4, h: 7 };
  fpx(door.x, door.y, C.roof, door.w, door.h);
  fpx(door.x, door.y, C.roofEdge, door.w, 1);
  fpx(door.x + door.w - 1, door.y + 3, C.window); // door knob glint

  // Winding path from the door down to the bottom edge.
  for (let y = groundY; y < H; y++) {
    const k = (y - groundY) / Math.max(1, H - groundY);
    const cx = door.x + 2 - k * W * 0.08 + Math.sin(k * 5) * 4;
    const half = 1.5 + k * 9;
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      const edge = Math.abs(x - cx) > half - 1.5;
      if (!edge || ((x + y) & 1) === 0) fpx(x, y, (x * 7 + y * 3) % 9 === 0 ? C.pathDark : C.path);
    }
  }

  // Tiny flowers in the moss.
  for (let i = 0; i < W / 6; i++) {
    const x = Math.floor(r() * W);
    const y = groundAt(x) + 2 + Math.floor(r() * (H - groundY - 4));
    fpx(x, y, FLOWERS[Math.floor(r() * FLOWERS.length)]);
  }

  // Mushrooms: classic red-with-dots and glowing teal ones, at the edges and by the cottage.
  const mushrooms: { x: number; y: number; glow: boolean; s: number }[] = [];
  for (const fx of [0.05, 0.11, 0.2, 0.24, 0.71, 0.86, 0.88, 0.95]) {
    const x = Math.round(W * fx + (r() - 0.5) * 6);
    const s = r() < 0.45 ? 2 : 1; // size
    const glow = r() < 0.45;
    const y = groundAt(x) + 2 + Math.floor(r() * 6);
    mushrooms.push({ x, y, glow, s });
    const stemH = 2 + s * 2;
    fpx(x - (s - 1), y - stemH, C.stem, s, stemH);
    const capW = 3 + s * 2 + (s - 1);
    const capC = glow ? C.capGlow : C.capRed;
    const cl = x - Math.floor(capW / 2);
    fpx(cl, y - stemH - 1, capC, capW, 1);
    fpx(cl + 1, y - stemH - 2, capC, capW - 2, s);
    if (s === 2) fpx(cl + 2, y - stemH - 4, capC, capW - 4, 1);
    if (!glow) {
      fpx(cl + 1, y - stemH - 2, C.dot);
      fpx(cl + capW - 2, y - stemH - 1, C.dot);
      if (s === 2) fpx(x, y - stemH - 3, C.dot);
    }
  }

  // Big framing pines on both edges.
  for (const [cx, hf] of [
    [W * 0.02, 0.62],
    [W * 0.09, 0.48],
    [W * 0.17, 0.36],
    [W * 0.98, 0.66],
    [W * 0.92, 0.42],
  ] as const) {
    pine(fpx, Math.round(cx), groundY + 3, Math.round(H * hf), C.pineNear, C.pineEdge);
  }

  const { c: sky, moon } = skyLayer(W, H, horizon);
  const stars = Array.from({ length: Math.round((W * horizon) / 220) }, () => ({
    x: Math.floor(r() * W),
    y: Math.floor(r() * horizon * 0.9),
    phase: r() * 6.28,
    bright: r() < 0.15,
  })).filter((s) => Math.hypot(s.x - moon.x, s.y - moon.y) > moon.r);
  const fireflies = Array.from({ length: Math.max(14, Math.round(W / 14)) }, () => ({
    x: r() * W,
    y: H * (0.55 + r() * 0.38),
    ax: 4 + r() * 10,
    ay: 2 + r() * 6,
    speed: 0.3 + r() * 0.6,
    phase: r() * 6.28,
  }));
  const mistBands = [
    { y: horizon + Math.round(H * 0.11), h: 4, speed: 0.004 },
    { y: horizon + Math.round(H * 0.27), h: 5, speed: -0.006 },
  ];
  return { sky, back, front, stars, fireflies, mistBands, win, chim, mushrooms };
}

function draw(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, L: ReturnType<typeof layout>) {
  const px = painter(ctx);
  ctx.drawImage(L.sky, 0, 0);

  for (const s of L.stars) {
    if (Math.sin(t / 900 + s.phase) < -0.6) continue;
    px(s.x, s.y, s.bright ? C.star : C.starDim);
    if (s.bright && Math.sin(t / 700 + s.phase) > 0.75) {
      px(s.x - 1, s.y, C.starDim);
      px(s.x + 1, s.y, C.starDim);
      px(s.x, s.y - 1, C.starDim);
      px(s.x, s.y + 1, C.starDim);
    }
  }

  ctx.drawImage(L.back, 0, 0);

  // Drifting mist: a sparse dither pattern that slides sideways.
  for (const m of L.mistBands) {
    const off = Math.floor(t * m.speed);
    for (let y = 0; y < m.h; y++) {
      const density = y === 0 || y === m.h - 1 ? 4 : 2;
      for (let x = 0; x < W; x++) {
        if (((x + off + y * 2) % (density * 2)) === 0 && Math.sin((x + off) / 23) > -0.3) px(x, m.y + y, C.mist);
      }
    }
  }

  ctx.drawImage(L.front, 0, 0);

  // Cottage window flicker + chimney smoke.
  const w = L.win;
  px(w.x, w.y, Math.sin(t / 300) + Math.sin(t / 170) > 1.2 ? C.windowHot : C.window, w.w, w.h);
  px(w.x + Math.floor(w.w / 2), w.y, C.roof, 1, w.h); // window cross
  for (let i = 0; i < 6; i++) {
    const age = ((t / 600 + i * 0.9) % 6) / 6;
    const sx = L.chim.x + Math.round(Math.sin(age * 5 + i) * 2 + age * 6);
    const sy = L.chim.y - 1 - Math.round(age * 16);
    if (age < 0.85) px(sx, sy, C.smoke, age > 0.5 ? 1 : 2, 1);
  }

  // Glowing mushrooms pulse softly.
  for (const m of L.mushrooms) {
    if (!m.glow || Math.sin(t / 800 + m.x) < 0.2) continue;
    const top = m.y - (2 + m.s * 2) - (m.s === 2 ? 5 : 3);
    px(m.x - m.s, top, C.capGlow, m.s * 2 + 1, 1);
  }

  // Fireflies.
  for (const f of L.fireflies) {
    const s = t / 1000;
    const x = f.x + Math.sin(s * f.speed + f.phase) * f.ax;
    const y = f.y + Math.sin(s * f.speed * 1.7 + f.phase * 2) * f.ay;
    const blink = Math.sin(s * 2.2 + f.phase * 3);
    if (blink < -0.3) continue;
    px(x, y, C.firefly);
    if (blink > 0.6) {
      px(x - 1, y, C.fireflyDim);
      px(x + 1, y, C.fireflyDim);
      px(x, y - 1, C.fireflyDim);
      px(x, y + 1, C.fireflyDim);
    }
  }
}

/** Animated pixel-art fairytale forest at night (original artwork, drawn procedurally). */
export function Forest() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const ctx = el.getContext('2d')!;
    let L: ReturnType<typeof layout> | null = null;
    let W = 1;
    let H = 1;
    let raf = 0;
    let last = -1e9;

    const resize = () => {
      W = Math.max(40, Math.ceil(el.clientWidth / PX));
      H = Math.max(40, Math.ceil(el.clientHeight / PX));
      el.width = W;
      el.height = H;
      L = layout(W, H);
      last = -1e9;
    };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!L || t - last < 100) return; // ~10 fps: smooth enough for fireflies and mist
      last = t;
      draw(ctx, W, H, t, L);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas className="scene" ref={ref} />;
}
