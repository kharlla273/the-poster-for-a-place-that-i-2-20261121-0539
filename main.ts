// Velmaris — a travel poster for a place that isn't there.
//
// A dependency-free Node 22 program: it renders a 1024x1024 travel poster
// for the invented island of VELMARIS (a floating rock isle with a lighthouse,
// a waterfall pouring into a golden lagoon) and writes it to /output/entry.png.
// Pure TypeScript + node:zlib / node:fs only — no network, no fonts, no deps.
// The lettering is a hand-drawn 5x7 bitmap font scaled up; the scene is
// painted pixel by pixel from gradients and shape tests, deterministically
// (seeded PRNG), so every run produces the same poster.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const W = 1024;
const H = 1024;
const HORIZON = 600;
const OUT = "/output/entry.png";

// ---------------------------------------------------------------- utilities
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
type RGB = [number, number, number];
function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Deterministic PRNG (mulberry32) + value noise, so the poster is identical
// on every run.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);
function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u);
}
function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash1(xi * 57 + yi * 131);
  const b = hash1((xi + 1) * 57 + yi * 131);
  const c = hash1(xi * 57 + (yi + 1) * 131);
  const d = hash1((xi + 1) * 57 + (yi + 1) * 131);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

// ------------------------------------------------------------------- bitmap font
// 5x7 glyphs, rows top to bottom, '#' = ink.
const FONT: Record<string, string[]> = {
  A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  B: ["#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "],
  C: [" ####", "#    ", "#    ", "#    ", "#    ", "#    ", " ####"],
  D: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
  F: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#    "],
  G: [" ####", "#    ", "#    ", "# ###", "#   #", "#   #", " ### "],
  H: ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  I: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "#####"],
  J: ["  ###", "   # ", "   # ", "   # ", "   # ", "#  # ", " ##  "],
  K: ["#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"],
  N: ["#   #", "##  #", "##  #", "# # #", "#  ##", "#  ##", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  P: ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "],
  Q: [" ### ", "#   #", "#   #", "#   #", "# # #", "#  # ", " ## #"],
  R: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
  S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "#   #", "# # #", "# # #", "## ##", "#   #"],
  X: ["#   #", "#   #", " # # ", "  #  ", " # # ", "#   #", "#   #"],
  Y: ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "],
  Z: ["#####", "    #", "   # ", "  #  ", " #   ", "#    ", "#####"],
  "0": [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  "3": ["#### ", "    #", "    #", " ### ", "    #", "    #", "#### "],
  "4": ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  "6": [" ### ", "#    ", "#    ", "#### ", "#   #", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  "8": [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  "9": [" ### ", "#   #", "#   #", " ####", "    #", "    #", " ### "],
  " ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
  ".": ["     ", "     ", "     ", "     ", "     ", " ##  ", " ##  "],
  "-": ["     ", "     ", "     ", "#####", "     ", "     ", "     "],
  "'": ["  #  ", "  #  ", "     ", "     ", "     ", "     ", "     "],
};

// ------------------------------------------------------------------- PNG writer
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  // One scanline per row: filter byte + RGB. Choose per row between
  // filter 0 (None) and filter 2 (Up) by smallest sum of absolute bytes.
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    let sum0 = 0;
    let sum2 = 0;
    for (let i = 0; i < stride; i++) {
      sum0 += Math.abs(row[i]);
      sum2 += Math.abs(row[i] - prev[i]);
    }
    const off = y * (stride + 1);
    if (sum2 < sum0) {
      raw[off] = 2;
      for (let i = 0; i < stride; i++) raw[off + 1 + i] = (row[i] - prev[i]) & 0xff;
    } else {
      raw[off] = 0;
      Buffer.from(row).copy(raw, off + 1);
    }
    Buffer.from(row).copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- the poster
const img = new Uint8Array(W * H * 3);
function px(x: number, y: number): number {
  return (y * W + x) * 3;
}
function setPix(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const o = px(x, y);
  img[o] = clamp(Math.round(c[0]), 0, 255);
  img[o + 1] = clamp(Math.round(c[1]), 0, 255);
  img[o + 2] = clamp(Math.round(c[2]), 0, 255);
}
function blendPix(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  const o = px(x, y);
  img[o] = clamp(Math.round(lerp(img[o], c[0], a)), 0, 255);
  img[o + 1] = clamp(Math.round(lerp(img[o + 1], c[1], a)), 0, 255);
  img[o + 2] = clamp(Math.round(lerp(img[o + 2], c[2], a)), 0, 255);
}

// Sky stops (golden hour) and sea stops.
const SKY: [number, RGB][] = [
  [0.0, [26, 48, 84]],
  [0.22, [62, 105, 148]],
  [0.42, [214, 148, 106]],
  [0.55, [247, 196, 116]],
  [0.585, [250, 214, 140]],
];
const SEA: [number, RGB][] = [
  [0.0, [64, 138, 148]],
  [0.25, [38, 106, 128]],
  [0.6, [20, 70, 102]],
  [1.0, [10, 42, 72]],
];
function ramp(stops: [number, RGB][], t: number): RGB {
  const tt = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    if (tt <= stops[i + 1][0]) {
      const f = (tt - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return mix(stops[i][1], stops[i + 1][1], clamp(f, 0, 1));
    }
  }
  return stops[stops.length - 1][1];
}

const SUN_X = 712;
const SUN_Y = 486;
const SUN_R = 52;

// Soft clouds, fixed by the seeded rng.
const CLOUDS = Array.from({ length: 9 }, (_, i) => ({
  x: 60 + rand() * 900,
  y: 210 + rand() * 300,
  rx: 90 + rand() * 150,
  ry: 14 + rand() * 22,
  a: 0.10 + rand() * 0.14,
}));

function ridgeY(x: number, base: number, amp: number, freq: number): number {
  return base - amp * (0.55 + 0.45 * noise1(x * freq));
}

function render(): void {
  // 1. Base sky + sea, sun glow, sun disc, sea glitter.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c: RGB;
      if (y < HORIZON) {
        c = ramp(SKY, y / HORIZON);
        // Sun glow.
        const dx = x - SUN_X;
        const dy = (y - SUN_Y) * 1.15;
        const d = Math.sqrt(dx * dx + dy * dy);
        const glow = Math.exp(-(d * d) / (2 * 190 * 190));
        c = mix(c, [255, 214, 150], glow * 0.55);
        if (d < SUN_R) {
          const edge = smoothstep(SUN_R, SUN_R - 6, d);
          c = mix(c, [255, 214, 128], 0.35 + 0.65 * edge);
        }
      } else {
        const t = (y - HORIZON) / (H - HORIZON);
        c = ramp(SEA, t);
        // Sun glitter column on the water.
        const halfW = 46 + t * 150;
        const dx = Math.abs(x - SUN_X);
        if (dx < halfW) {
          const shimmer = 0.5 + 0.5 * noise2(x * 0.045, y * 0.11);
          const fall = (1 - dx / halfW) * (1 - t * 0.55);
          const g = shimmer * fall;
          c = mix(c, [255, 205, 130], g * 0.5);
          if (shimmer > 0.86) c = mix(c, [255, 240, 200], (shimmer - 0.86) * 3 * fall);
        }
        // Gentle wave striping.
        const w = Math.sin(y * 0.55 + noise1(x * 0.02) * 6) * 0.5 + 0.5;
        if (w > 0.93) c = mix(c, [140, 200, 210], (w - 0.93) * 4 * 0.25);
      }
      setPix(x, y, c);
    }
  }

  // 2. Clouds (soft ellipses, warm-lit).
  for (const cl of CLOUDS) {
    const x0 = Math.max(0, Math.floor(cl.x - cl.rx));
    const x1 = Math.min(W - 1, Math.ceil(cl.x + cl.rx));
    const y0 = Math.max(0, Math.floor(cl.y - cl.ry * 2));
    const y1 = Math.min(HORIZON - 1, Math.ceil(cl.y + cl.ry * 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ex = (x - cl.x) / cl.rx;
        const ey = (y - cl.y) / cl.ry;
        const d2 = ex * ex + ey * ey;
        if (d2 < 1) {
          const a = cl.a * smoothstep(1, 0.55, d2) * (0.75 + 0.25 * noise2(x * 0.05, y * 0.2));
          const lit: RGB = y < cl.y ? [255, 226, 180] : [244, 190, 150];
          blendPix(x, y, lit, a);
        }
      }
    }
  }

  // 3. Distant ridge silhouettes along the horizon (two hazy layers).
  for (const layer of [
    { base: HORIZON - 26, amp: 46, freq: 0.006, col: [96, 116, 158] as RGB, alpha: 0.55 },
    { base: HORIZON - 8, amp: 30, freq: 0.011, col: [58, 82, 122] as RGB, alpha: 0.8 },
  ]) {
    for (let x = 0; x < W; x++) {
      const ry = ridgeY(x, layer.base, layer.amp, layer.freq);
      for (let y = Math.max(0, Math.floor(ry)); y < HORIZON; y++) {
        const edge = smoothstep(ry + 3, ry, y);
        blendPix(x, y, layer.col, layer.alpha * (0.35 + 0.65 * edge));
      }
    }
  }

  // 4. The floating isle of Velmaris — rock, grass, trees, lighthouse,
  //    waterfall. Centre-left, hovering above the lagoon.
  const IX = 400;
  const ITOP = 372; // grass line
  const ITIP = 528; // underside tip
  const IRX = 196; // half width at the grass line
  for (let y = 330; y <= ITIP + 6; y++) {
    // Half-width profile: wide flat top, tapering to a point below.
    let hw: number;
    if (y < ITOP) hw = 0;
    else if (y < 428) hw = IRX * (0.94 + 0.06 * Math.cos(((y - ITOP) / 56) * Math.PI));
    else hw = IRX * Math.pow(1 - (y - 428) / (ITIP - 428), 0.72);
    const wob = (noise1(y * 0.09) - 0.5) * 14;
    const cx = IX + wob * 0.4;
    const x0 = Math.max(0, Math.floor(cx - hw));
    const x1 = Math.min(W - 1, Math.ceil(cx + hw));
    for (let x = x0; x <= x1; x++) {
      const edge = clamp((hw - Math.abs(x - cx)) / 10, 0, 1);
      const t = clamp((y - ITOP) / (ITIP - ITOP), 0, 1);
      let c = mix([122, 84, 66], [52, 38, 48], t); // sunlit rock to shadowed base
      // Grassy crown.
      if (y < ITOP + 16) c = mix([198, 164, 92], [128, 158, 82], clamp((y - ITOP) / 16, 0, 1));
      // Warm rim light on the sun side (right edge).
      const rim = smoothstep(0.55, 1, (x - cx) / Math.max(hw, 1));
      if (rim > 0) c = mix(c, [232, 170, 110], rim * 0.5 * (1 - t * 0.5));
      blendPix(x, y, c, 0.35 + 0.65 * edge);
    }
  }
  // Trees: dark green tufts on the grass.
  for (const [tx, ty, tr] of [
    [300, 366, 15],
    [330, 360, 19],
    [470, 362, 17],
    [505, 368, 12],
  ] as const) {
    for (let y = ty - tr; y <= ty + 4; y++) {
      for (let x = tx - tr; x <= tx + tr; x++) {
        const dx = (x - tx) / tr;
        const dy = (y - ty) / (tr * 0.8);
        if (dx * dx + dy * dy < 1) blendPix(x, y, [46, 92, 58], 0.9);
      }
    }
  }
  // Lighthouse on the isle: white tower, coral bands, lamp room, light beams.
  const LX = IX;
  const LTOP = 268;
  const LBOT = ITOP + 2;
  for (let y = LTOP; y <= LBOT; y++) {
    const taper = lerp(11, 15, (y - LTOP) / (LBOT - LTOP));
    for (let x = Math.floor(LX - taper); x <= Math.ceil(LX + taper); x++) {
      let c: RGB = [248, 244, 232];
      if ((y > 300 && y < 318) || (y > 340 && y < 356)) c = [214, 92, 74]; // coral bands
      if (x > LX + taper - 3) c = mix(c, [120, 110, 110], 0.45); // shaded side
      setPix(x, y, c);
    }
  }
  // Gallery + lamp room + dome.
  for (let y = LTOP - 26; y < LTOP; y++) {
    const hw = y < LTOP - 14 ? 9 : 15;
    for (let x = LX - hw; x <= LX + hw; x++) {
      setPix(x, y, y < LTOP - 14 ? [52, 48, 52] : [40, 40, 46]);
    }
  }
  for (let y = LTOP - 34; y < LTOP - 26; y++) {
    const hw = 12 - (LTOP - 26 - y);
    for (let x = LX - hw; x <= LX + hw; x++) setPix(x, y, [214, 92, 74]);
  }
  // Lamp glow.
  for (let y = LTOP - 40; y <= LTOP + 8; y++) {
    for (let x = LX - 30; x <= LX + 30; x++) {
      const d = Math.sqrt((x - LX) * (x - LX) + (y - (LTOP - 16)) * (y - (LTOP - 16)));
      if (d < 30) blendPix(x, y, [255, 240, 180], (1 - d / 30) * 0.5);
    }
  }
  // Light beams sweeping to both sides.
  for (const dir of [-1, 1]) {
    for (let s = 0; s < 260; s++) {
      const bx = LX + dir * (20 + s);
      const by = LTOP - 16 + Math.round(s * 0.10);
      const spread = 4 + s * 0.05;
      for (let y = Math.floor(by - spread); y <= Math.ceil(by + spread); y++) {
        const a = 0.42 * (1 - s / 260) * (1 - Math.abs(y - by) / spread);
        blendPix(bx, y, [255, 238, 170], Math.max(0, a));
      }
    }
  }

  // Waterfall from the isle's tip down to the lagoon, with foam.
  for (let y = ITIP - 4; y < HORIZON + 2; y++) {
    const t = (y - ITIP) / (HORIZON - ITIP);
    const hw = 10 + t * 22;
    const cx = IX + Math.sin(y * 0.05) * 4 + t * 10;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const a = 0.95 * (1 - Math.abs(x - cx) / hw) * (0.6 + 0.4 * noise2(x * 0.2, y * 0.1));
      blendPix(x, y, [225, 244, 248], a);
    }
  }
  for (let y = HORIZON - 8; y <= HORIZON + 12; y++) {
    for (let x = IX - 46; x <= IX + 66; x++) {
      const dx = (x - (IX + 10)) / 52;
      const dy = (y - (HORIZON + 2)) / 11;
      if (dx * dx + dy * dy < 1) {
        blendPix(x, y, [235, 248, 250], 0.55 * (1 - (dx * dx + dy * dy)) * (0.6 + 0.4 * noise2(x * 0.3, y * 0.3)));
      }
    }
  }

  // 5. A smaller sister islet on the right, with one tree.
  const SX = 856;
  const STOP = 452;
  const STIP = 522;
  for (let y = STOP; y <= STIP; y++) {
    const hw = y < 486 ? 62 : 62 * Math.pow(1 - (y - 486) / (STIP - 486), 0.7);
    for (let x = Math.floor(SX - hw); x <= Math.ceil(SX + hw); x++) {
      const t = clamp((y - STOP) / (STIP - STOP), 0, 1);
      let c = mix([110, 76, 62], [48, 36, 46], t);
      if (y < STOP + 10) c = [150, 158, 84];
      blendPix(x, y, c, 0.9);
    }
  }
  for (let y = STOP - 26; y <= STOP; y++) {
    for (let x = SX - 12; x <= SX + 12; x++) {
      const dx = (x - SX) / 12;
      const dy = (y - (STOP - 12)) / 14;
      if (dx * dx + dy * dy < 1) blendPix(x, y, [44, 88, 56], 0.9);
    }
  }

  // 6. Birds.
  const birds: [number, number, number][] = [
    [180, 250, 10],
    [235, 225, 8],
    [560, 210, 9],
    [620, 245, 7],
    [880, 300, 9],
  ];
  for (const [bx, by, s] of birds) {
    for (let i = 0; i <= s; i++) {
      setPix(Math.round(bx - i), Math.round(by + i * 0.45), [30, 40, 58]);
      setPix(Math.round(bx + i), Math.round(by + i * 0.45), [30, 40, 58]);
    }
  }

  // 7. Vignette — gentle darkening at the corners.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const v = 1 - 0.16 * smoothstep(0.75, 1.35, d);
      const o = px(x, y);
      img[o] = Math.round(img[o] * v);
      img[o + 1] = Math.round(img[o + 1] * v);
      img[o + 2] = Math.round(img[o + 2] * v);
    }
  }
}

// ------------------------------------------------------------------- lettering
function textWidth(text: string, scale: number): number {
  let w = 0;
  for (const ch of text) {
    const g = FONT[ch] ?? FONT[" "];
    void g;
    w += 6 * scale;
  }
  return w - scale;
}
function drawGlyph(ch: string, x0: number, y0: number, scale: number, c: RGB): void {
  const g = FONT[ch] ?? FONT[" "];
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (g[r][col] === "#") {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            setPix(x0 + col * scale + dx, y0 + r * scale + dy, c);
          }
        }
      }
    }
  }
}
function drawText(text: string, cx: number, y0: number, scale: number): void {
  const w = textWidth(text, scale);
  let x = Math.round(cx - w / 2);
  const outline: RGB = [24, 38, 60];
  const ink: RGB = [255, 244, 214];
  // Outline pass (8 directions), then the cream face.
  for (const [ox, oy] of [
    [-3, 0], [3, 0], [0, -3], [0, 3], [-3, -3], [3, -3], [-3, 3], [3, 3],
  ] as const) {
    let xx = x;
    for (const ch of text) {
      drawGlyph(ch, xx + ox, y0 + oy, scale, outline);
      xx += 6 * scale;
    }
  }
  let xx = x;
  for (const ch of text) {
    drawGlyph(ch, xx, y0, scale, ink);
    xx += 6 * scale;
  }
  // Thin gold rule + diamond beneath the name.
  const ry = y0 + 7 * scale + 16;
  for (let x2 = Math.round(cx - w / 2); x2 <= Math.round(cx + w / 2); x2++) {
    setPix(x2, ry, [255, 214, 140]);
    setPix(x2, ry + 1, [200, 160, 90]);
  }
  const d = 7;
  for (let i = -d; i <= d; i++) {
    for (let j = -d + Math.abs(i); j <= d - Math.abs(i); j++) {
      setPix(Math.round(cx + i), ry + 22 + j, [255, 214, 140]);
    }
  }
}

// ------------------------------------------------------------------- main
function main(): void {
  render();
  drawText("VELMARIS", W / 2, 64, 13);
  const png = encodePNG(img, W, H);
  mkdirSync("/output", { recursive: true });
  writeFileSync(OUT, png);
  console.log(`wrote ${OUT}: ${W}x${H}, ${png.length} bytes`);
}

main();
