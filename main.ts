// AERTHYS — The Floating Isles
// A travel poster for a place that does not exist, drawn entirely in code.
// Pure Node.js stdlib (node:fs, node:path, node:zlib). No network, no assets,
// no randomness: every run writes the exact same bytes to entry.png.
//
// The poster: a sunset sky over a sea of clouds, a floating island crowned
// by a striped lighthouse, a waterfall spilling off its edge, a small
// hot-air balloon drifting by — and the name AERTHYS set large across the sky.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------------------
// Canvas: a 1024x1024 RGB image, rendered at 2x supersampling (2048x2048)
// and box-downsampled for smooth anti-aliased edges.
// ---------------------------------------------------------------------------

const OUT_W = 1024;
const OUT_H = 1024;
const SS = 2; // supersampling factor
const W = OUT_W * SS;
const H = OUT_H * SS;

type RGB = [number, number, number];

const buf = new Float32Array(W * H * 3);

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function setPx(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

// Blend a colour over the pixel at (x, y) with opacity a in [0, 1].
function blendPx(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  if (a >= 1) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  } else {
    buf[i] = buf[i] * (1 - a) + r * a;
    buf[i + 1] = buf[i + 1] * (1 - a) + g * a;
    buf[i + 2] = buf[i + 2] * (1 - a) + b * a;
  }
}

// Hex colour like "#f2a65a" -> [r, g, b].
function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// ---------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------

// Vertical gradient across the whole canvas. Stops are [position 0..1, colour].
function vgrad(stops: Array<[number, RGB]>): void {
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k];
    const [p1, c1] = stops[k + 1];
    const f = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
    const c = lerpColor(c0, c1, Math.max(0, Math.min(1, f)));
    for (let x = 0; x < W; x++) setPx(x, y, c[0], c[1], c[2]);
  }
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) blendPx(x, y, c[0], c[1], c[2], a);
  }
}

// Filled circle, optionally with a radial gradient from centre to edge.
function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1, edge?: RGB): void {
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(W - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(H - 1, Math.ceil(cy + r));
  const rr = r * r;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > rr) continue;
      // Soft 1.5px edge.
      const d = Math.sqrt(d2);
      let cov = 1;
      if (d > r - 1.5) cov = Math.max(0, (r - d) / 1.5);
      if (edge) {
        const cc = lerpColor(c, edge, d / r);
        blendPx(x, y, cc[0], cc[1], cc[2], a * cov);
      } else {
        blendPx(x, y, c[0], c[1], c[2], a * cov);
      }
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  const xa = Math.max(0, Math.floor(cx - rx));
  const xb = Math.min(W - 1, Math.ceil(cx + rx));
  const ya = Math.max(0, Math.floor(cy - ry));
  const yb = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      let cov = 1;
      if (d > 0.94) cov = Math.max(0, (1 - d) / 0.06);
      blendPx(x, y, c[0], c[1], c[2], a * cov);
    }
  }
}

// Point-in-polygon (even-odd) test.
function insidePoly(px: number, py: number, pts: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function fillPoly(pts: Array<[number, number]>, c: RGB, a = 1): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const xa = Math.max(0, Math.floor(minX));
  const xb = Math.min(W - 1, Math.ceil(maxX));
  const ya = Math.max(0, Math.floor(minY));
  const yb = Math.min(H - 1, Math.ceil(maxY));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (insidePoly(x + 0.5, y + 0.5, pts)) blendPx(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Thick line segment with round caps.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
  const r = w / 2;
  const xa = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1));
  const xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + r + 1));
  const ya = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1));
  const yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + r + 1));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let t = len2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = x0 + t * dx;
      const qy = y0 + t * dy;
      const d = Math.hypot(px - qx, py - qy);
      if (d > r) continue;
      let cov = 1;
      if (d > r - 1.2) cov = Math.max(0, (r - d) / 1.2);
      blendPx(x, y, c[0], c[1], c[2], a * cov);
    }
  }
}

// ---------------------------------------------------------------------------
// Vector stroke font (my own letterforms, on a 10 wide x 14 tall grid).
// Each glyph is a list of polylines; rendered as thick round-capped strokes.
// ---------------------------------------------------------------------------

type Glyph = Array<Array<[number, number]>>;

const FONT: Record<string, Glyph> = {
  A: [[[0, 14], [5, 0], [10, 14]], [[2.6, 9], [7.4, 9]]],
  B: [[[0, 0], [0, 14]], [[0, 0], [6.5, 0], [9, 2.5], [9, 5], [6.5, 7], [0, 7]], [[6.5, 7], [9, 9.5], [9, 11.5], [6.5, 14], [0, 14]]],
  C: [[[9.5, 3], [7, 0], [3, 0], [0, 3], [0, 11], [3, 14], [7, 14], [9.5, 11]]],
  D: [[[0, 0], [0, 14], [6, 14], [9.5, 11], [9.5, 3], [6, 0], [0, 0]]],
  E: [[[9, 0], [0, 0], [0, 14], [9, 14]], [[0, 7], [6.5, 7]]],
  F: [[[0, 14], [0, 0], [9, 0]], [[0, 7], [6.5, 7]]],
  G: [[[9.5, 3], [7, 0], [3, 0], [0, 3], [0, 11], [3, 14], [7, 14], [10, 11], [10, 7], [5, 7]]],
  H: [[[0, 0], [0, 14]], [[10, 0], [10, 14]], [[0, 7], [10, 7]]],
  I: [[[5, 0], [5, 14]], [[2, 0], [8, 0]], [[2, 14], [8, 14]]],
  J: [[[8, 0], [8, 11], [6, 14], [2.5, 14], [0.5, 11]]],
  K: [[[0, 0], [0, 14]], [[9.5, 0], [0, 7], [9.5, 14]]],
  L: [[[0, 0], [0, 14], [9, 14]]],
  M: [[[0, 14], [0, 0], [5, 8], [10, 0], [10, 14]]],
  N: [[[0, 14], [0, 0], [10, 14], [10, 0]]],
  O: [[[3, 0], [7, 0], [10, 3], [10, 11], [7, 14], [3, 14], [0, 11], [0, 3], [3, 0]]],
  P: [[[0, 14], [0, 0], [7, 0], [9.5, 2.5], [9.5, 5], [7, 7], [0, 7]]],
  Q: [[[3, 0], [7, 0], [10, 3], [10, 11], [7, 14], [3, 14], [0, 11], [0, 3], [3, 0]], [[6, 10], [10, 14]]],
  R: [[[0, 14], [0, 0], [7, 0], [9.5, 2.5], [9.5, 5], [7, 7], [0, 7]], [[6, 7], [10, 14]]],
  S: [[[9.5, 3], [7, 0], [3, 0], [1, 2], [1, 5], [3, 7], [7, 7], [9, 9], [9, 12], [7, 14], [3, 14], [0.5, 11]]],
  T: [[[0, 0], [10, 0]], [[5, 0], [5, 14]]],
  U: [[[0, 0], [0, 11], [2, 14], [8, 14], [10, 11], [10, 0]]],
  V: [[[0, 0], [5, 14], [10, 0]]],
  W: [[[0, 0], [2.5, 14], [5, 7], [7.5, 14], [10, 0]]],
  X: [[[0, 0], [10, 14]], [[10, 0], [0, 14]]],
  Y: [[[0, 0], [5, 7], [10, 0]], [[5, 7], [5, 14]]],
  Z: [[[0, 0], [10, 0], [0, 14], [10, 14]]],
  " ": [],
  "'": [[[5, 0], [5, 4]]],
  "-": [[[1, 7], [9, 7]]],
  ".": [[[5, 13], [5, 14]]],
};

// Width of one glyph cell (in grid units) plus tracking; narrow letters get
// a smaller advance so the setting does not look gappy.
function glyphAdvance(ch: string): number {
  if (ch === "I") return 7.5;
  if (ch === " ") return 6;
  if (ch === "'") return 4;
  if (ch === ".") return 4;
  if (ch === "J") return 8;
  return 11;
}

function textWidth(text: string, scale: number): number {
  let w = 0;
  for (const ch of text) w += glyphAdvance(ch) * scale;
  return w - 1.5 * scale; // drop trailing tracking
}

// Draw text with its top-left at (x, y); scale = pixels per grid unit.
function drawText(x: number, y: number, text: string, scale: number, stroke: number, c: RGB, a = 1): void {
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch.toUpperCase()];
    if (glyph) {
      for (const poly of glyph) {
        for (let i = 0; i < poly.length - 1; i++) {
          const [ax, ay] = poly[i];
          const [bx, by] = poly[i + 1];
          thickLine(cx + ax * scale, y + ay * scale, cx + bx * scale, y + by * scale, stroke, c, a);
        }
      }
    }
    cx += glyphAdvance(ch) * scale;
  }
}

function drawTextCentred(cx: number, y: number, text: string, scale: number, stroke: number, c: RGB, a = 1): void {
  drawText(cx - textWidth(text, scale) / 2, y, text, scale, stroke, c, a);
}

// ---------------------------------------------------------------------------
// PNG encoder (colour type 2, RGB, 8 bit). One filter per row, chosen by the
// smallest sum of absolute signed byte values; zlib level 9.
// ---------------------------------------------------------------------------

function crc32Table(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC_TABLE = crc32Table();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgb: Buffer, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Filter each row: try filters 0..4, keep the one with the smallest
  // sum of absolute values of the signed filtered bytes.
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const prev = Buffer.alloc(w * 3);
  const filt = Buffer.alloc(w * 3);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * w * 3, (y + 1) * w * 3);
    let bestType = 0;
    let bestScore = Infinity;
    let best = Buffer.alloc(w * 3);
    for (let f = 0; f <= 4; f++) {
      let score = 0;
      for (let i = 0; i < w * 3; i++) {
        const left = i >= 3 ? row[i - 3] : 0;
        const up = prev[i];
        const upLeft = i >= 3 ? prev[i - 3] : 0;
        let p: number;
        if (f === 0) p = row[i];
        else if (f === 1) p = row[i] - left;
        else if (f === 2) p = row[i] - up;
        else if (f === 3) p = row[i] - ((left + up) >> 1);
        else {
          const pa = Math.abs(up - upLeft);
          const pb = Math.abs(left - upLeft);
          const pc = Math.abs(left + up - 2 * upLeft);
          // Standard Paeth: pick the nearest of left / up / up-left.
          const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          p = row[i] - pr;
        }
        const b = p & 255;
        filt[i] = b;
        score += b < 128 ? b : 256 - b;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = f;
        best = Buffer.from(filt);
      }
    }
    raw[y * (w * 3 + 1)] = bestType;
    best.copy(raw, y * (w * 3 + 1) + 1);
    row.copy(prev);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The poster. All scene coordinates are in 1024-space and scaled by SS.
// ---------------------------------------------------------------------------

const s = (v: number): number => v * SS;

// Sunset sky.
function drawSky(): void {
  vgrad([
    [0.0, hex("#1d0f3e")],
    [0.28, hex("#4a2560")],
    [0.5, hex("#8e3a63")],
    [0.66, hex("#d4695c")],
    [0.8, hex("#f2a65a")],
    [1.0, hex("#ffd98a")],
  ]);
}

// Fixed star field in the deep part of the sky (deterministic positions).
function drawStars(): void {
  const stars: Array<[number, number, number, number]> = [
    [60, 60, 2.2, 0.9], [140, 110, 1.6, 0.6], [230, 50, 2.0, 0.8], [330, 90, 1.5, 0.5],
    [420, 45, 2.4, 0.9], [520, 80, 1.6, 0.6], [610, 55, 2.0, 0.7], [700, 95, 1.5, 0.5],
    [790, 48, 2.2, 0.8], [880, 100, 1.6, 0.6], [960, 60, 2.0, 0.8], [100, 180, 1.8, 0.6],
    [270, 160, 2.2, 0.8], [470, 150, 1.6, 0.5], [660, 170, 2.0, 0.7], [830, 160, 1.8, 0.6],
    [940, 210, 1.6, 0.5], [180, 260, 1.5, 0.4], [380, 240, 1.8, 0.5], [760, 250, 1.6, 0.5],
    [30, 300, 1.6, 0.4], [980, 320, 1.5, 0.4], [560, 210, 1.5, 0.4], [40, 140, 1.8, 0.6],
  ];
  for (const [x, y, r, a] of stars) {
    fillCircle(s(x), s(y), s(r), hex("#fff6d8"), a);
  }
}

// The low sun and its glow (smooth radial falloff, no hard rings).
function drawSun(): void {
  const cx = s(718);
  const cy = s(468);
  const steps = 26;
  for (let i = steps; i >= 1; i--) {
    const t = i / steps; // 1 at the outer edge, near 0 at the core
    const r = 62 + (196 - 62) * t;
    const c = lerpColor(hex("#ffe9a8"), hex("#ffb35c"), t);
    const a = 0.06 + 0.34 * (1 - t) * (1 - t);
    fillCircle(cx, cy, s(r), c, a);
  }
  fillCircle(cx, cy, s(64), hex("#fff3c4"), 1);
  fillCircle(cx, cy, s(52), hex("#fffbe0"), 1);
}

// A distant mountain ridge, hazed by the sunset.
function drawRidge(): void {
  const c = hex("#5a2d55");
  fillPoly(
    [
      [s(0), s(716)], [s(120), s(688)], [s(260), s(706)], [s(400), s(682)],
      [s(560), s(704)], [s(700), s(686)], [s(840), s(708)], [s(1024), s(690)],
      [s(1024), s(760)], [s(0), s(760)],
    ],
    c,
    0.55,
  );
}

// The sea of clouds the islands float above: layered warm ellipses.
function drawCloudSea(): void {
  const layers: Array<[number, number, number, number, string, number]> = [
    // x, y, rx, ry, colour, alpha
    [120, 800, 260, 70, "#e98a7e", 0.9],
    [420, 830, 300, 80, "#f2a183", 0.95],
    [760, 810, 280, 75, "#e98a7e", 0.9],
    [980, 850, 240, 80, "#f2a183", 0.95],
    [60, 880, 260, 80, "#d97a7e", 0.9],
    [380, 900, 320, 85, "#e08a7e", 0.95],
    [720, 890, 300, 85, "#d97a7e", 0.9],
    [1000, 920, 260, 85, "#e08a7e", 0.95],
    [200, 950, 300, 90, "#c96a72", 0.95],
    [560, 960, 320, 90, "#d97a7e", 0.95],
    [880, 970, 300, 90, "#c96a72", 0.95],
  ];
  for (const [x, y, rx, ry, col, a] of layers) {
    fillEllipse(s(x), s(y), s(rx), s(ry), hex(col), a);
  }
  // Soft cloud puffs on the surface, kept faint so they read as mist.
  const puffs: Array<[number, number, number]> = [
    [180, 790, 40], [300, 810, 50], [470, 795, 43], [640, 815, 52],
    [820, 795, 45], [940, 820, 41], [90, 860, 45], [250, 880, 54],
    [520, 870, 50], [700, 885, 48], [900, 875, 52], [380, 930, 52], [620, 935, 50],
  ];
  for (const [x, y, r] of puffs) {
    fillCircle(s(x), s(y), s(r), hex("#f7c193"), 0.26);
  }
}

// A small pine tree (stacked triangles) at (x, baseY), height h (1024-space).
function drawPine(x: number, baseY: number, h: number, c: RGB): void {
  const wdt = h * 0.42;
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    const topY = baseY - h + i * h * 0.28;
    const half = wdt * (0.55 + t * 0.45);
    fillPoly(
      [
        [s(x), s(topY)],
        [s(x - half), s(topY + h * 0.42)],
        [s(x + half), s(topY + h * 0.42)],
      ],
      c,
    );
  }
  fillRect(s(x - h * 0.03), s(baseY - h * 0.12), s(x + h * 0.03), s(baseY), hex("#5a3428"));
}

// A floating island: grassy plateau on top, rocky underside tapering to a point.
function drawIsland(cx: number, topY: number, halfW: number, depth: number, rock: RGB, grass: RGB): void {
  // Rocky underside: a smooth, symmetric taper from the plateau to the tip,
  // with a slight deterministic wobble so the rock edge is not a straight cone.
  const pts: Array<[number, number]> = [
    [s(cx - halfW), s(topY)],
    [s(cx + halfW), s(topY)],
  ];
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const wob = ((i * 37) % 5 - 2) * depth * 0.018;
    const x = cx + halfW * (1 - t) + wob;
    const y = topY + depth * Math.pow(t, 1.5);
    pts.push([s(x), s(y)]);
  }
  for (let i = steps - 1; i >= 1; i--) {
    const t = i / steps;
    const wob = ((i * 53) % 5 - 2) * depth * 0.018;
    const x = cx - halfW * (1 - t) + wob;
    const y = topY + depth * Math.pow(t, 1.5);
    pts.push([s(x), s(y)]);
  }
  fillPoly(pts, rock);
  // Grassy cap.
  fillEllipse(s(cx), s(topY), s(halfW), s(halfW * 0.16), grass);
  fillRect(s(cx - halfW), s(topY - halfW * 0.05), s(cx + halfW), s(topY + halfW * 0.1), grass);
}

// The lighthouse on the main island, with a sweeping beam.
function drawLighthouse(baseX: number, baseY: number): void {
  const cream = hex("#f7ead2");
  const red = hex("#c94f43");
  const dark = hex("#3a2430");
  // Light beam, sweeping up-left.
  fillPoly(
    [
      [s(baseX + 6), s(baseY - 118)],
      [s(baseX - 210), s(baseY - 168)],
      [s(baseX - 210), s(baseY - 96)],
    ],
    hex("#ffe9a8"),
    0.16,
  );
  // Tower: tapered, banded.
  const topW = 15;
  const botW = 22;
  const topY = baseY - 112;
  fillPoly(
    [[s(baseX - botW), s(baseY)], [s(baseX + botW), s(baseY)], [s(baseX + topW), s(topY)], [s(baseX - topW), s(topY)]],
    cream,
  );
  // Red bands (clipped by drawing narrower trapezoids at the right heights).
  const band = (y0: number, y1: number): void => {
    const f0 = (y0 - topY) / (baseY - topY);
    const f1 = (y1 - topY) / (baseY - topY);
    const w0 = topW + (botW - topW) * f0;
    const w1 = topW + (botW - topW) * f1;
    fillPoly(
      [[s(baseX - w0), s(y0)], [s(baseX + w0), s(y0)], [s(baseX + w1), s(y1)], [s(baseX - w1), s(y1)]],
      red,
    );
  };
  band(baseY - 96, baseY - 74);
  band(baseY - 52, baseY - 30);
  // Gallery + lamp room + dome.
  fillRect(s(baseX - 20), s(topY - 8), s(baseX + 20), s(topY), dark);
  fillRect(s(baseX - 12), s(topY - 26), s(baseX + 12), s(topY - 8), hex("#ffe9a8"));
  fillRect(s(baseX - 13), s(topY - 28), s(baseX + 13), s(topY - 26), dark);
  fillPoly([[s(baseX - 14), s(topY - 28)], [s(baseX + 14), s(topY - 28)], [s(baseX), s(topY - 44)]], red);
  // Lamp glow.
  fillCircle(s(baseX), s(topY - 17), s(26), hex("#ffe9a8"), 0.5);
  fillCircle(s(baseX), s(topY - 17), s(12), hex("#fffbe0"), 0.9);
}

// Waterfall spilling off the main island into the clouds.
function drawWaterfall(x: number, y0: number, y1: number): void {
  const water = hex("#cfe8f2");
  const white = hex("#f4fbff");
  fillPoly(
    [
      [s(x - 13), s(y0)], [s(x + 13), s(y0)],
      [s(x + 17), s(y1)], [s(x - 17), s(y1)],
    ],
    water,
    0.92,
  );
  thickLine(s(x - 4), s(y0 + 6), s(x - 6), s(y1 - 8), s(5), white, 0.85);
  thickLine(s(x + 5), s(y0 + 10), s(x + 7), s(y1 - 12), s(4), white, 0.7);
  // Mist where it meets the clouds.
  fillEllipse(s(x), s(y1 + 6), s(34), s(14), hex("#f4fbff"), 0.6);
}

// A small hot-air balloon drifting in the sky.
function drawBalloon(x: number, y: number): void {
  const red = hex("#e2574c");
  const cream = hex("#f7ead2");
  const gold = hex("#f2a65a");
  fillEllipse(s(x), s(y), s(36), s(42), red);
  fillEllipse(s(x), s(y), s(13), s(42), cream);
  fillEllipse(s(x), s(y), s(5), s(42), gold);
  fillPoly([[s(x - 14), s(y + 38)], [s(x + 14), s(y + 38)], [s(x + 8), s(y + 52)], [s(x - 8), s(y + 52)]], cream);
  thickLine(s(x - 12), s(y + 38), s(x - 8), s(y + 52), s(2), hex("#5a3428"), 0.9);
  thickLine(s(x + 12), s(y + 38), s(x + 8), s(y + 52), s(2), hex("#5a3428"), 0.9);
  fillRect(s(x - 8), s(y + 52), s(x + 8), s(y + 64), hex("#5a3428"));
}

// A tiny house with a lit window on the right-hand isle.
function drawHouse(x: number, baseY: number): void {
  const wall = hex("#f7ead2");
  const roof = hex("#c94f43");
  fillRect(s(x - 16), s(baseY - 26), s(x + 16), s(baseY), wall);
  fillPoly([[s(x - 20), s(baseY - 26)], [s(x + 20), s(baseY - 26)], [s(x), s(baseY - 44)]], roof);
  fillRect(s(x - 5), s(baseY - 16), s(x + 5), s(baseY - 6), hex("#ffd98a"));
  fillRect(s(x - 2), s(baseY - 6), s(x + 2), s(baseY), hex("#5a3428"));
}

// Birds: simple two-stroke chevrons.
function drawBirds(): void {
  const c = hex("#2a1245");
  const birds: Array<[number, number, number]> = [
    [300, 330, 10], [340, 300, 8], [380, 340, 9], [820, 280, 10], [870, 320, 8], [910, 290, 9],
  ];
  for (const [x, y, r] of birds) {
    thickLine(s(x - r), s(y), s(x), s(y + r * 0.6), s(3), c, 0.8);
    thickLine(s(x), s(y + r * 0.6), s(x + r), s(y), s(3), c, 0.8);
  }
}

// Dark foreground cliffs framing the bottom corners.
function drawCliffs(): void {
  const c = hex("#241233");
  fillPoly([[s(0), s(1024)], [s(0), s(884)], [s(120), s(936)], [s(300), s(1024)]], c);
  fillPoly([[s(1024), s(1024)], [s(1024), s(902)], [s(904), s(950)], [s(730), s(1024)]], c);
  // A pine silhouette on the left cliff.
  drawPine(84, 936, 64, hex("#1a0d26"));
}

// The poster's type: name, subtitle, tagline — cream on the dusk sky.
function drawType(): void {
  const cream = hex("#fff3d6");
  const shadow = hex("#2a1245");
  const cx = OUT_W / 2;

  // Thin cream frame.
  const f = 26;
  const fw = 3;
  fillRect(s(f), s(f), s(OUT_W - f), s(f + fw), cream, 0.45);
  fillRect(s(f), s(OUT_H - f - fw), s(OUT_W - f), s(OUT_H - f), cream, 0.45);
  fillRect(s(f), s(f), s(f + fw), s(OUT_H - f), cream, 0.45);
  fillRect(s(OUT_W - f - fw), s(f), s(OUT_W - f), s(OUT_H - f), cream, 0.45);

  // Title with a soft shadow, then the cream face.
  const titleScale = 7.9;
  const titleStroke = 19;
  const titleY = 96;
  drawTextCentred(s(cx), s(titleY + 7), "AERTHYS", titleScale * SS, titleStroke * SS, shadow, 0.5);
  drawTextCentred(s(cx), s(titleY), "AERTHYS", titleScale * SS, titleStroke * SS, cream, 1);

  // Subtitle with a small rule on each side.
  const subScale = 2.7;
  const subStroke = 6.5;
  const subY = 226;
  const subW = textWidth("THE FLOATING ISLES", subScale);
  drawTextCentred(s(cx), s(subY), "THE FLOATING ISLES", subScale * SS, subStroke * SS, cream, 1);
  const gap = 26;
  const ruleY = subY + 9;
  fillRect(s(cx - subW / 2 - gap - 92), s(ruleY), s(cx - subW / 2 - gap), s(ruleY + 3), cream, 0.8);
  fillRect(s(cx + subW / 2 + gap), s(ruleY), s(cx + subW / 2 + gap + 92), s(ruleY + 3), cream, 0.8);

  // Tagline along the bottom, above the cliffs.
  const tagScale = 2.2;
  const tagStroke = 5.5;
  drawTextCentred(s(cx), s(946), "WHERE THE SUN SETS LAST", tagScale * SS, tagStroke * SS, cream, 1);
}

// ---------------------------------------------------------------------------
// Downsample the 2x buffer to 1024x1024 RGB and encode.
// ---------------------------------------------------------------------------

function downsample(): Buffer {
  const rgb = Buffer.alloc(OUT_W * OUT_H * 3);
  for (let y = 0; y < OUT_H; y++) {
    for (let x = 0; x < OUT_W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * W + (x * SS + dx)) * 3;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const o = (y * OUT_W + x) * 3;
      const n = SS * SS;
      rgb[o] = clamp255(Math.round(r / n));
      rgb[o + 1] = clamp255(Math.round(g / n));
      rgb[o + 2] = clamp255(Math.round(b / n));
    }
  }
  return rgb;
}

function main(): void {
  drawSky();
  drawStars();
  drawSun();
  drawRidge();
  drawCloudSea();

  // Main island, centred, with the lighthouse.
  drawIsland(512, 556, 168, 236, hex("#6b3f4a"), hex("#7fae62"));
  drawPine(398, 556, 52, hex("#3f6b3a"));
  drawPine(428, 558, 40, hex("#4a7a42"));
  drawPine(640, 558, 46, hex("#3f6b3a"));
  drawLighthouse(520, 556);
  drawWaterfall(636, 556, 796);

  // Two smaller isles drifting nearby.
  drawIsland(168, 646, 74, 96, hex("#5a3340"), hex("#6f9a55"));
  drawPine(168, 646, 44, hex("#3f6b3a"));
  drawIsland(856, 606, 88, 108, hex("#5a3340"), hex("#6f9a55"));
  drawHouse(856, 606);

  drawBalloon(228, 296);
  drawBirds();
  drawCliffs();
  drawType();

  const png = encodePNG(downsample(), OUT_W, OUT_H);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
}

main();
