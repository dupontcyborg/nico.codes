import sharp from "sharp";
import { writeFileSync } from "fs";

const SRC = "public/nico.jpg";
const OUT_DIR = "public";

// 4x4 Bayer matrix (normalized 0..1, then offset)
const bayer4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

// 8x8 Bayer matrix
const bayer8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((row) => row.map((v) => (v + 0.5) / 64));

async function loadGray(width: number) {
  const { data, info } = await sharp(SRC)
    .resize({ width, fit: "cover" })
    .grayscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), w: info.width, h: info.height };
}

function bayerDither(
  pixels: Uint8Array,
  w: number,
  h: number,
  matrix: number[][],
  threshold = 0.5,
) {
  const m = matrix.length;
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = pixels[i] / 255;
      const t = matrix[y % m][x % m];
      out[i] = v + (t - threshold) > 0.5 ? 255 : 0;
    }
  }
  return out;
}

function floydSteinberg(pixels: Uint8Array, w: number, h: number) {
  const buf = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) buf[i] = pixels[i];
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i];
      const newPx = old < 128 ? 0 : 255;
      out[i] = newPx;
      const err = old - newPx;
      if (x + 1 < w) buf[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) buf[i + w - 1] += (err * 3) / 16;
        buf[i + w] += (err * 5) / 16;
        if (x + 1 < w) buf[i + w + 1] += (err * 1) / 16;
      }
    }
  }
  return out;
}

function atkinson(pixels: Uint8Array, w: number, h: number) {
  const buf = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) buf[i] = pixels[i];
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i];
      const newPx = old < 128 ? 0 : 255;
      out[i] = newPx;
      const err = (old - newPx) / 8;
      const add = (dx: number, dy: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) buf[ny * w + nx] += err;
      };
      add(1, 0); add(2, 0);
      add(-1, 1); add(0, 1); add(1, 1);
      add(0, 2);
    }
  }
  return out;
}

async function save(
  data: Uint8Array,
  w: number,
  h: number,
  filename: string,
) {
  // Convert grayscale to 4-channel RGBA where 0 = transparent black, 255 = opaque white
  // This way the portrait sits on whatever background.
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = data[i];
    rgba[i * 4 + 0] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = v; // 0 black/transparent, 255 white
  }
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(`${OUT_DIR}/${filename}`);
  console.log(`wrote ${filename}`);
}

async function main() {
  // Three resolutions, three algorithms = 9 options? Let's do 3 sizes x 3 algos = trim to ~6
  const sizes = [120, 200, 320];
  const algos = [
    { name: "fs", fn: (p: Uint8Array, w: number, h: number) => floydSteinberg(p, w, h) },
    { name: "atk", fn: (p: Uint8Array, w: number, h: number) => atkinson(p, w, h) },
    { name: "bayer8", fn: (p: Uint8Array, w: number, h: number) => bayerDither(p, w, h, bayer8) },
  ];

  for (const size of sizes) {
    const { data, w, h } = await loadGray(size);
    for (const algo of algos) {
      const out = algo.fn(data, w, h);
      await save(out, w, h, `nico-${algo.name}-${size}.png`);
    }
  }
}

main();
